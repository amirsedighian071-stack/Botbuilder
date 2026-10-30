import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  forbidden,
  hashApiKey,
  safeEqual,
  unauthorized,
  verifyJwt,
  type AdminRecord,
  type ApiKeyRecord,
} from '@botforge/core';
import type { AppContext } from '../context';

export type AuthPrincipal =
  | { kind: 'admin'; admin: AdminRecord; scopes: string[] }
  | { kind: 'apiKey'; key: ApiKeyRecord; scopes: string[] };

declare module 'fastify' {
  interface FastifyRequest {
    principal: AuthPrincipal | null;
  }
}

export const ALL_SCOPES = ['bots:read', 'bots:write', 'users:read', 'users:write', 'broadcast', 'system:read'] as const;
export type Scope = (typeof ALL_SCOPES)[number];

const ADMIN_SCOPES: string[] = [...ALL_SCOPES];

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

function apiKeyHeader(request: FastifyRequest): string | null {
  const header = request.headers['x-api-key'];
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  return value ? value.trim() : null;
}

export async function resolvePrincipal(context: AppContext, request: FastifyRequest): Promise<AuthPrincipal | null> {
  const token = bearerToken(request);
  if (token) {
    const payload = verifyJwt(token, context.config.JWT_SECRET);
    if (!payload) return null;
    const admin = await context.storage.admins.findById(payload.sub);
    if (!admin || !admin.isActive) return null;
    const scopes = Array.isArray(payload.scope) && payload.scope.length > 0 ? payload.scope : ADMIN_SCOPES;
    if (admin.role === 'viewer') {
      return { kind: 'admin', admin, scopes: scopes.filter((scope) => scope.endsWith(':read')) };
    }
    return { kind: 'admin', admin, scopes };
  }

  const rawKey = apiKeyHeader(request);
  if (rawKey) {
    const prefix = rawKey.slice(0, 16);
    const record = await context.storage.apiKeys.findByPrefix(prefix);
    if (!record || record.revokedAt) return null;
    if (!safeEqual(record.hash, hashApiKey(rawKey))) return null;
    await context.storage.apiKeys.touch(record.id);
    return { kind: 'apiKey', key: record, scopes: record.scopes };
  }

  return null;
}

export async function authenticate(context: AppContext, request: FastifyRequest): Promise<AuthPrincipal> {
  const principal = await resolvePrincipal(context, request);
  if (!principal) throw unauthorized('برای دسترسی به این بخش باید وارد شوید');
  request.principal = principal;
  return principal;
}

export function principalLabel(principal: AuthPrincipal): string {
  return principal.kind === 'admin' ? principal.admin.email : `api-key:${principal.key.prefix}`;
}

export function actorId(principal: AuthPrincipal): string {
  return principal.kind === 'admin' ? principal.admin.id : principal.key.id;
}

export function assertScope(principal: AuthPrincipal, scope: Scope): void {
  if (principal.kind === 'admin' && principal.admin.role === 'superadmin') return;
  if (!principal.scopes.includes(scope)) throw forbidden(`دسترسی لازم وجود ندارد: ${scope}`);
}

export function assertWrite(principal: AuthPrincipal): void {
  if (principal.kind === 'admin' && principal.admin.role === 'viewer') {
    throw forbidden('حساب مشاهده‌گر اجازه تغییر ندارد');
  }
}

export async function audit(
  context: AppContext,
  request: FastifyRequest,
  principal: AuthPrincipal,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await context.storage.audits.log({
    actorId: actorId(principal),
    actorType: principal.kind === 'admin' ? 'admin' : 'system',
    action,
    target,
    ip: request.ip,
    meta: { ...details, actor: principalLabel(principal) },
  });
}

export function sendError(reply: FastifyReply, status: number, message: string, code = 'ERROR'): void {
  reply.code(status).send({ error: { code, message } });
}
