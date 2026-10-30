import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  badRequest,
  botTokenSchema,
  conflict,
  createBotSchema,
  forceMembershipSchema,
  notFound,
  platformSchema,
  sanitizeText,
  slugSchema,
  type BotRecord,
} from '@botforge/core';
import { assertScope, assertWrite, audit, authenticate } from '../plugins/auth';
import type { AppContext } from '../context';

const patchBotSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  status: z.enum(['active', 'paused', 'maintenance', 'disabled']).optional(),
  config: z.record(z.unknown()).optional(),
});

const settingsPutSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  value: z.union([z.string().max(4000), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())]),
});

const userPatchSchema = z.object({
  blocked: z.boolean().optional(),
  role: z.enum(['user', 'admin', 'owner']).optional(),
  notes: z.string().max(2000).optional(),
});

const broadcastBodySchema = z.object({
  text: z.string().trim().min(1).max(3800),
  parseMode: z.enum(['HTML', 'Markdown']).default('HTML'),
});

function botSummary(bot: BotRecord): Record<string, unknown> {
  return {
    id: bot.id,
    slug: bot.slug,
    templateId: bot.templateId,
    name: bot.name,
    platform: bot.platform,
    status: bot.status,
    tokenHint: bot.tokenHint,
    ownerId: bot.ownerId,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    forceMembership: { ...bot.forceMembership, channels: bot.forceMembership.channels.length },
    configKeys: Object.keys(bot.config ?? {}),
  };
}

async function loadBot(context: AppContext, id: string): Promise<BotRecord> {
  const bot = await context.storage.bots.findById(id);
  if (!bot) throw notFound('ربات پیدا نشد');
  return bot;
}

export async function registerBotRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/bots', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        platform: platformSchema.optional(),
        status: z.enum(['active', 'paused', 'maintenance', 'disabled']).optional(),
        search: z.string().trim().max(80).optional(),
      })
      .parse(request.query);
    const result = await context.storage.bots.list(query);
    return { ...result, items: result.items.map(botSummary) };
  });

  app.post('/api/bots', async (request, reply) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const parsed = createBotSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('اطلاعات ربات نامعتبر است', parsed.error.flatten());
    const input = parsed.data;
    if (!slugSchema.safeParse(input.slug).success) throw badRequest('شناسه ربات فقط می‌تواند شامل حروف لاتین، عدد و خط تیره باشد');
    if (!botTokenSchema.safeParse(input.token).success) throw badRequest('فرمت توکن ربات معتبر نیست');

    const created = await context.manager.createBot({
      templateId: input.templateId,
      name: input.name,
      slug: input.slug,
      platform: input.platform,
      token: input.token,
      config: input.config,
      ownerId: principal.kind === 'admin' ? principal.admin.id : undefined,
    });
    await audit(context, request, principal, 'bot.created', created.id, {
      template: created.templateId,
      platform: created.platform,
    });
    reply.code(201).send({
      bot: botSummary(created),
      webhookUrl: context.manager.webhookUrl(created),
      tokenHint: created.tokenHint,
    });
  });

  app.get('/api/bots/:id', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const [users, messagesToday, events24h, jobsPending, adminUsers] = await Promise.all([
      context.storage.users.count(bot.id),
      context.storage.messages.countSince(bot.id, new Date(Date.now() - 86_400_000).toISOString()),
      context.storage.events.countSince(bot.id, new Date(Date.now() - 86_400_000).toISOString()),
      context.storage.jobs.countPending(bot.id),
      context.storage.users.countAdmins(bot.id),
    ]);
    const template = context.templates.get(bot.templateId);
    return {
      bot: {
        ...botSummary(bot),
        forceMembership: bot.forceMembership,
        config: bot.config,
      },
      webhookUrl: context.manager.webhookUrl(bot),
      template: template
        ? {
            id: template.id,
            name: template.name,
            icon: template.icon,
            category: template.category,
            commands: template.commands,
            requirements: template.requirements,
          }
        : null,
      stats: {
        users,
        admins: adminUsers,
        messagesToday,
        events24h,
        jobsPending,
      },
    };
  });

  app.patch('/api/bots/:id', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const parsed = patchBotSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('درخواست نامعتبر است', parsed.error.flatten());
    const patch: Partial<BotRecord> = { updatedAt: new Date().toISOString() };
    if (parsed.data.name) patch.name = sanitizeText(parsed.data.name, 80);
    if (parsed.data.status) patch.status = parsed.data.status;
    if (parsed.data.config) {
      const template = context.templates.get(bot.templateId);
      patch.config = { ...template?.defaultConfig, ...bot.config, ...parsed.data.config };
    }
    const updated = await context.storage.bots.update(bot.id, patch);
    if (!updated) throw notFound('ربات پیدا نشد');
    await context.manager.reload(bot.id);
    await context.storage.events.log({
      botId: bot.id,
      type: 'bot.updated',
      level: 'info',
      payload: { fields: Object.keys(patch) },
    });
    await audit(context, request, principal, 'bot.updated', bot.id, { fields: Object.keys(patch) });
    return { bot: botSummary(updated) };
  });

  app.delete('/api/bots/:id', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const removed = await context.manager.deleteBot(bot.id);
    await audit(context, request, principal, 'bot.deleted', bot.id, { name: bot.name });
    return { ok: removed };
  });

  app.post('/api/bots/:id/webhook/register', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const registered = await context.manager.registerWebhook(bot);
    await audit(context, request, principal, 'bot.webhook_registered', bot.id, { registered });
    return { registered, url: context.manager.webhookUrl(bot) };
  });

  app.post('/api/bots/:id/webhook/delete', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const removed = await context.manager.deleteWebhook(bot);
    await audit(context, request, principal, 'bot.webhook_deleted', bot.id, { removed });
    return { removed };
  });

  app.get('/api/bots/:id/settings', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const runtime = await context.manager.getRuntime(bot.id);
    const stored = await runtime.settings.all();
    const template = context.templates.get(bot.templateId);
    const built = await runtime.services();
    const requirementStatus = template
      ? template.requirements.map((requirement) => {
          const raw = stored[requirement.key] ?? bot.config?.[requirement.key];
          const configured = raw !== undefined && raw !== null && String(raw).trim().length > 0;
          return {
            key: requirement.key,
            label: requirement.label,
            description: requirement.description,
            required: requirement.required,
            env: requirement.env ?? null,
            configured,
          };
        })
      : [];
    return {
      settings: stored,
      config: bot.config,
      requirements: requirementStatus,
      available: {
        ai: built.ai.available,
        speechToText: built.speech.sttAvailable,
        textToSpeech: built.speech.ttsAvailable,
      },
    };
  });

  app.put('/api/bots/:id/settings', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const parsed = settingsPutSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('تنظیمات نامعتبر است', parsed.error.flatten());
    const runtime = await context.manager.getRuntime(bot.id);
    await runtime.settings.set(parsed.data.key, parsed.data.value);
    await context.storage.events.log({
      botId: bot.id,
      type: 'bot.setting_updated',
      level: 'info',
      payload: { key: parsed.data.key },
    });
    await audit(context, request, principal, 'bot.setting_updated', bot.id, { key: parsed.data.key });
    return { ok: true, key: parsed.data.key };
  });

  app.delete('/api/bots/:id/settings/:key', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id, key } = request.params as { id: string; key: string };
    const bot = await loadBot(context, id);
    const runtime = await context.manager.getRuntime(bot.id);
    await runtime.settings.delete(key);
    await audit(context, request, principal, 'bot.setting_deleted', bot.id, { key });
    return { ok: true };
  });

  app.get('/api/bots/:id/force-membership', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    return { forceMembership: bot.forceMembership };
  });

  app.put('/api/bots/:id/force-membership', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const parsed = forceMembershipSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('تنظیمات عضویت اجباری نامعتبر است', parsed.error.flatten());
    await context.storage.bots.update(bot.id, {
      forceMembership: parsed.data,
      updatedAt: new Date().toISOString(),
    });
    await context.manager.reload(bot.id);
    await audit(context, request, principal, 'bot.force_membership_updated', bot.id, {
      enabled: parsed.data.enabled,
      channels: parsed.data.channels.length,
    });
    return { ok: true, forceMembership: parsed.data };
  });

  app.get('/api/bots/:id/users', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'users:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        search: z.string().trim().max(80).optional(),
        blocked: z.coerce.boolean().optional(),
        role: z.enum(['user', 'admin', 'owner']).optional(),
      })
      .parse(request.query);
    return context.storage.users.list(bot.id, query);
  });

  app.patch('/api/bots/:id/users/:userId', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'users:write');
    assertWrite(principal);
    const { id, userId } = request.params as { id: string; userId: string };
    const bot = await loadBot(context, id);
    const parsed = userPatchSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('درخواست نامعتبر است', parsed.error.flatten());
    if (parsed.data.blocked !== undefined) {
      await context.storage.users.setBlocked(bot.id, userId, parsed.data.blocked);
    }
    if (parsed.data.role) {
      await context.storage.users.setRole(bot.id, userId, parsed.data.role);
    }
    if (parsed.data.notes !== undefined) {
      await context.storage.users.updateNotes(bot.id, userId, sanitizeText(parsed.data.notes, 2000));
    }
    await audit(context, request, principal, 'bot.user_updated', bot.id, { userId, fields: Object.keys(parsed.data) });
    return { ok: true };
  });

  app.delete('/api/bots/:id/users/:userId', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'users:write');
    assertWrite(principal);
    const { id, userId } = request.params as { id: string; userId: string };
    const bot = await loadBot(context, id);
    const removed = await context.storage.users.delete(bot.id, userId);
    await audit(context, request, principal, 'bot.user_deleted', bot.id, { userId });
    return { ok: removed };
  });

  app.post('/api/bots/:id/broadcast', async (request, reply) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'broadcast');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    if (bot.status === 'disabled') throw conflict('ربات غیرفعال است و ارسال پیام همگانی ممکن نیست');
    const parsed = broadcastBodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('متن پیام نامعتبر است', parsed.error.flatten());
    const runtime = await context.manager.getRuntime(bot.id);
    try {
      const result = await runtime.broadcast.start(parsed.data.text, parsed.data.parseMode);
      await audit(context, request, principal, 'bot.broadcast_started', bot.id, { total: result.total });
      reply.code(202).send({ accepted: true, total: result.total, jobId: result.job.id });
    } catch (error) {
      throw new AppError('VALIDATION', (error as Error).message);
    }
  });

  app.get('/api/bots/:id/broadcast', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'broadcast');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const progress = await context.storage.settings.get(bot.id, '__broadcast_progress');
    return { progress: progress ?? null };
  });

  app.get('/api/bots/:id/events', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
        level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
      })
      .parse(request.query);
    return context.storage.events.list(bot.id, query);
  });

  app.get('/api/bots/:id/messages', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    const [recent, today, total] = await Promise.all([
      context.storage.messages.recent(bot.id, query.limit),
      context.storage.messages.countSince(bot.id, new Date(Date.now() - 86_400_000).toISOString()),
      context.storage.messages.countTotal(bot.id),
    ]);
    return { items: recent, today, total };
  });

  app.get('/api/bots/:id/jobs', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(['pending', 'running', 'done', 'failed', 'dead']).optional(),
      })
      .parse(request.query);
    return context.storage.jobs.list(bot.id, query);
  });

  app.get('/api/bots/:id/documents/:collection', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id, collection } = request.params as { id: string; collection: string };
    const bot = await loadBot(context, id);
    if (!/^[a-z0-9_]{2,40}$/.test(collection)) throw badRequest('نام مجموعه نامعتبر است');
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        search: z.string().trim().max(80).optional(),
      })
      .parse(request.query);
    return context.storage.documents.list(bot.id, collection, query);
  });

  app.get('/api/bots/:id/documents/:collection/:docId', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id, docId } = request.params as { id: string; docId: string };
    const bot = await loadBot(context, id);
    const doc = await context.storage.documents.findById(bot.id, docId);
    if (!doc) throw notFound('سند پیدا نشد');
    return doc;
  });

  app.delete('/api/bots/:id/documents/:docId', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id, docId } = request.params as { id: string; docId: string };
    const bot = await loadBot(context, id);
    const removed = await context.storage.documents.delete(bot.id, docId);
    await audit(context, request, principal, 'bot.document_deleted', bot.id, { docId });
    return { ok: removed };
  });

  app.get('/api/bots/:id/dashboard', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await loadBot(context, id);
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [users, newUsers, messagesToday, errors, jobsPending, events, broadcast] = await Promise.all([
      context.storage.users.count(bot.id),
      context.storage.users.countSince(bot.id, dayAgo),
      context.storage.messages.countSince(bot.id, dayAgo),
      context.storage.events.countSince(bot.id, weekAgo, 'error'),
      context.storage.jobs.countPending(bot.id),
      context.storage.events.recent(10),
      context.storage.settings.get(bot.id, '__broadcast_progress'),
    ]);
    return {
      bot: botSummary(bot),
      metrics: {
        users,
        newUsers24h: newUsers,
        messages24h: messagesToday,
        errors7d: errors,
        jobsPending,
      },
      events: events.filter((event) => event.botId === bot.id),
      broadcast: broadcast ?? null,
      webhookUrl: context.manager.webhookUrl(bot),
    };
  });
}
