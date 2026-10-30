import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  badRequest,
  hashApiKey,
  hashPassword,
  randomToken,
  signJwt,
  unauthorized,
  verifyPassword,
  type AdminRecord,
} from '@botforge/core';
import { ALL_SCOPES, assertScope, assertWrite, audit, authenticate } from '../plugins/auth';
import type { AppContext } from '../context';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(10).max(200),
});

const createKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(ALL_SCOPES)).min(1),
});

const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).max(200),
  role: z.enum(['superadmin', 'operator', 'viewer']),
});

function publicAdmin(admin: AdminRecord): Record<string, unknown> {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    isActive: admin.isActive,
    createdAt: admin.createdAt,
    lastLoginAt: admin.lastLoginAt ?? null,
  };
}

export async function registerAuthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('ایمیل یا گذرواژه نامعتبر است', parsed.error.flatten());
    const admin = await context.storage.admins.findByEmail(parsed.data.email);
    if (!admin || !admin.isActive || !verifyPassword(parsed.data.password, admin.passwordHash)) {
      await context.storage.audits.log({
        actorId: 'anonymous',
        actorType: 'system',
        action: 'auth.login_failed',
        target: parsed.data.email,
        ip: request.ip,
        meta: {},
      });
      throw unauthorized('ایمیل یا گذرواژه نادرست است');
    }
    await context.storage.admins.updateLastLogin(admin.id);
    const token = signJwt(
      { sub: admin.id, role: admin.role, scope: admin.role === 'viewer' ? ['bots:read', 'users:read', 'system:read'] : [...ALL_SCOPES] },
      context.config.JWT_SECRET,
      12 * 3600,
    );
    await context.storage.audits.log({
      actorId: admin.id,
      actorType: 'admin',
      action: 'auth.login',
      target: admin.email,
      ip: request.ip,
      meta: {},
    });
    reply.send({
      token,
      expiresIn: 12 * 3600,
      admin: publicAdmin(admin),
    });
  });

  app.get('/api/auth/me', async (request) => {
    const principal = await authenticate(context, request);
    if (principal.kind === 'admin') {
      return { kind: 'admin', scopes: principal.scopes, admin: publicAdmin(principal.admin) };
    }
    return {
      kind: 'apiKey',
      scopes: principal.scopes,
      key: { id: principal.key.id, name: principal.key.name, prefix: principal.key.prefix },
    };
  });

  app.post('/api/auth/password', async (request) => {
    const principal = await authenticate(context, request);
    if (principal.kind !== 'admin') throw unauthorized('تغییر گذرواژه فقط برای مدیران امکان‌پذیر است');
    assertWrite(principal);
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('گذرواژه جدید باید حداقل ۱۰ کاراکتر باشد', parsed.error.flatten());
    if (!verifyPassword(parsed.data.currentPassword, principal.admin.passwordHash)) {
      throw unauthorized('گذرواژه فعلی نادرست است');
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      throw badRequest('گذرواژه جدید باید متفاوت باشد');
    }
    await context.storage.admins.setPassword(principal.admin.id, hashPassword(parsed.data.newPassword));
    await audit(context, request, principal, 'auth.password_changed', principal.admin.email);
    return { ok: true };
  });

  app.get('/api/auth/admins', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const admins = await context.storage.admins.list();
    return { items: admins.map(publicAdmin) };
  });

  app.post('/api/auth/admins', async (request, reply) => {
    const principal = await authenticate(context, request);
    if (principal.kind !== 'admin' || principal.admin.role !== 'superadmin') {
      throw new AppError('FORBIDDEN', 'فقط مدیر ارشد می‌تواند مدیر جدید بسازد');
    }
    const parsed = createAdminSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('اطلاعات مدیر نامعتبر است', parsed.error.flatten());
    const existing = await context.storage.admins.findByEmail(parsed.data.email);
    if (existing) throw new AppError('CONFLICT', 'این ایمیل قبلاً ثبت شده است');
    const admin = await context.storage.admins.create({
      email: parsed.data.email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
    });
    await audit(context, request, principal, 'admin.created', admin.email, { role: admin.role });
    reply.code(201).send({ admin: publicAdmin(admin) });
  });

  app.patch('/api/auth/admins/:id', async (request) => {
    const principal = await authenticate(context, request);
    if (principal.kind !== 'admin' || principal.admin.role !== 'superadmin') {
      throw new AppError('FORBIDDEN', 'فقط مدیر ارشد می‌تواند وضعیت مدیران را تغییر دهد');
    }
    const params = z.object({ id: z.string().min(3) }).parse(request.params);
    const body = z.object({ active: z.boolean() }).parse(request.body);
    if (params.id === principal.admin.id && !body.active) throw badRequest('نمی‌توانید حساب خودتان را غیرفعال کنید');
    const ok = await context.storage.admins.setActive(params.id, body.active);
    await audit(context, request, principal, 'admin.status_changed', params.id, { active: body.active });
    return { ok };
  });

  app.get('/api/keys', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const keys = await context.storage.apiKeys.list();
    return {
      items: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt ?? null,
        revokedAt: key.revokedAt ?? null,
      })),
    };
  });

  app.post('/api/keys', async (request, reply) => {
    const principal = await authenticate(context, request);
    if (principal.kind !== 'admin' || principal.admin.role === 'viewer') {
      throw new AppError('FORBIDDEN', 'ساخت کلید API نیازمند دسترسی مدیر است');
    }
    const parsed = createKeySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('درخواست نامعتبر است', parsed.error.flatten());
    const raw = `bf_${randomToken(24, 'hex')}`;
    const record = await context.storage.apiKeys.create({
      name: parsed.data.name,
      prefix: raw.slice(0, 16),
      hash: hashApiKey(raw),
      scopes: parsed.data.scopes,
    });
    await audit(context, request, principal, 'apiKey.created', record.id, { scopes: record.scopes });
    reply.code(201).send({
      key: raw,
      record: { id: record.id, name: record.name, prefix: record.prefix, scopes: record.scopes, createdAt: record.createdAt },
      warning: 'این کلید فقط یک بار نمایش داده می‌شود؛ آن را در جای امن ذخیره کنید.',
    });
  });

  app.delete('/api/keys/:id', async (request) => {
    const principal = await authenticate(context, request);
    if (principal.kind !== 'admin' || principal.admin.role === 'viewer') {
      throw new AppError('FORBIDDEN', 'لغو کلید نیازمند دسترسی مدیر است');
    }
    const params = z.object({ id: z.string().min(3) }).parse(request.params);
    const ok = await context.storage.apiKeys.revoke(params.id);
    await audit(context, request, principal, 'apiKey.revoked', params.id);
    return { ok };
  });

  app.get('/api/audits', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const query = z
      .object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) })
      .parse(request.query);
    return context.storage.audits.list(query);
  });
}
