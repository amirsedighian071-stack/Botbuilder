import { AppError } from '../errors';
import type { BotRecord, BotUser, DocumentRecord, EventRecord, AdminRecord, ApiKeyRecord, AuditRecord, JobRecord, PlatformName, MessageDirection, UserRole } from '../types';

export type SqlDialect = 'postgres' | 'sqlite' | 'd1';

export interface SqlClient {
  readonly dialect: SqlDialect;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
}

export function toPgPlaceholders(sql: string): string {
  let index = 0;
  let out = '';
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'") {
      inSingle = !inSingle;
      out += char;
      continue;
    }
    if (char === '?' && !inSingle) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += char;
  }
  return out;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

type Row = Record<string, unknown>;

export function mapBot(row: Row): BotRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    templateId: String(row.template_id),
    name: String(row.name),
    platform: String(row.platform) as PlatformName,
    status: String(row.status) as BotRecord['status'],
    tokenCipher: String(row.token_cipher),
    tokenHint: String(row.token_hint),
    ownerId: String(row.owner_id),
    config: parseJson<Record<string, unknown>>(row.config, {}),
    forceMembership: parseJson(row.force_membership, {
      enabled: false,
      channels: [],
      message: '',
      buttonLabel: 'عضو شدم',
      recheckLabel: 'بررسی مجدد',
      bypassAdmins: true,
      cacheSeconds: 300,
    }),
    webhookSecret: String(row.webhook_secret),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapUser(row: Row): BotUser {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    platform: String(row.platform) as PlatformName,
    platformUserId: String(row.platform_user_id),
    chatId: String(row.chat_id),
    username: row.username === null || row.username === undefined ? undefined : String(row.username),
    firstName: row.first_name === null || row.first_name === undefined ? undefined : String(row.first_name),
    language: (row.language === 'en' ? 'en' : 'fa') as 'fa' | 'en',
    role: String(row.role) as UserRole,
    isBlocked: toInt(row.is_blocked) === 1,
    notes: String(row.notes ?? ''),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    messageCount: toInt(row.message_count),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  };
}

export function mapDocument(row: Row): DocumentRecord {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    collection: String(row.collection),
    key: String(row.key),
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapJob(row: Row): JobRecord {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    type: String(row.type),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    status: String(row.status) as JobRecord['status'],
    attempts: toInt(row.attempts),
    maxAttempts: toInt(row.max_attempts, 5),
    runAt: String(row.run_at),
    lastError: row.last_error === null || row.last_error === undefined ? undefined : String(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapEvent(row: Row): EventRecord {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    type: String(row.type),
    level: String(row.level) as EventRecord['level'],
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    createdAt: String(row.created_at),
  };
}

export function mapAudit(row: Row): AuditRecord {
  return {
    id: String(row.id),
    actorId: String(row.actor_id),
    actorType: String(row.actor_type) as AuditRecord['actorType'],
    action: String(row.action),
    target: String(row.target),
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
    ip: String(row.ip),
    createdAt: String(row.created_at),
  };
}

export function mapAdmin(row: Row): AdminRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: String(row.role) as AdminRecord['role'],
    isActive: toInt(row.is_active, 1) === 1,
    createdAt: String(row.created_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
  };
}

export function mapApiKey(row: Row): ApiKeyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    hash: String(row.hash),
    scopes: parseJson<string[]>(row.scopes, []),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : undefined,
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
  };
}

export interface MessageRow {
  id: string;
  direction: MessageDirection;
  text: string;
  userId: string;
  createdAt: string;
}

export function mapMessage(row: Row): MessageRow {
  return {
    id: String(row.id),
    direction: String(row.direction) as MessageDirection,
    text: String(row.text),
    userId: String(row.user_id),
    createdAt: String(row.created_at),
  };
}

export function assertRows(rows: unknown[], message: string): void {
  if (!Array.isArray(rows)) throw new AppError('INTERNAL', message);
}

export function buildWhere(clauses: Array<string | false | null | undefined>): string {
  const active = clauses.filter(Boolean) as string[];
  return active.length ? ` WHERE ${active.join(' AND ')}` : '';
}

export function textSearch(column: string): string {
  return `lower(${column}) LIKE lower(?)`;
}

export function likeValue(search: string): string {
  return `%${search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
}
