import { randomId } from '../crypto';
import type {
  AdminRecord,
  ApiKeyRecord,
  AuditRecord,
  BotRecord,
  BotUser,
  DocumentRecord,
  EventRecord,
  JobRecord,
  MessageDirection,
  PlatformName,
  SettingRecord,
  UserRole,
} from '../types';
import { SCHEMA_STATEMENTS } from './schema';
import {
  mapAdmin,
  mapApiKey,
  mapAudit,
  mapBot,
  mapDocument,
  mapEvent,
  mapJob,
  mapMessage,
  mapUser,
  parseJson,
  toInt,
  type SqlClient,
} from './sql-client';
import {
  normalizePage,
  paginate,
  type DocumentQuery,
  type Storage,
  type UserListOptions,
} from './types';

export async function createSqlStorage(client: SqlClient): Promise<Storage> {
  for (const statement of SCHEMA_STATEMENTS) {
    await client.exec(statement);
  }

  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    client.query<T>(sql, params);

  const storage: Storage = {
    driver: client.dialect === 'postgres' ? 'postgres' : client.dialect === 'd1' ? 'd1' : 'sqlite',

    bots: {
      async create(input) {
        await q(
          `INSERT INTO bots (id, slug, template_id, name, platform, status, token_cipher, token_hint, owner_id, config, force_membership, webhook_secret, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.id,
            input.slug,
            input.templateId,
            input.name,
            input.platform,
            input.status,
            input.tokenCipher,
            input.tokenHint,
            input.ownerId,
            JSON.stringify(input.config),
            JSON.stringify(input.forceMembership),
            input.webhookSecret,
            input.createdAt,
            input.updatedAt,
          ],
        );
        return input;
      },
      async update(id, patch) {
        const current = await storage.bots.findById(id);
        if (!current) return null;
        const next: BotRecord = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
        await q(
          `UPDATE bots SET slug = ?, template_id = ?, name = ?, platform = ?, status = ?, token_cipher = ?, token_hint = ?, owner_id = ?, config = ?, force_membership = ?, webhook_secret = ?, updated_at = ? WHERE id = ?`,
          [
            next.slug,
            next.templateId,
            next.name,
            next.platform,
            next.status,
            next.tokenCipher,
            next.tokenHint,
            next.ownerId,
            JSON.stringify(next.config),
            JSON.stringify(next.forceMembership),
            next.webhookSecret,
            next.updatedAt,
            id,
          ],
        );
        return next;
      },
      async findById(id) {
        const rows = await q('SELECT * FROM bots WHERE id = ?', [id]);
        return rows[0] ? mapBot(rows[0]) : null;
      },
      async findBySlug(slug) {
        const rows = await q('SELECT * FROM bots WHERE slug = ?', [slug]);
        return rows[0] ? mapBot(rows[0]) : null;
      },
      async list(query = {}) {
        const { page, pageSize, offset } = normalizePage(query);
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (query.platform) {
          clauses.push('platform = ?');
          params.push(query.platform);
        }
        if (query.status) {
          clauses.push('status = ?');
          params.push(query.status);
        }
        if (query.ownerId) {
          clauses.push('owner_id = ?');
          params.push(query.ownerId);
        }
        if (query.search) {
          clauses.push('(lower(name) LIKE lower(?) OR lower(slug) LIKE lower(?))');
          params.push(`%${query.search}%`, `%${query.search}%`);
        }
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const totalRows = await q(`SELECT COUNT(*) AS c FROM bots${where}`, params);
        const rows = await q(
          `SELECT * FROM bots${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows.map(mapBot), toInt(totalRows[0]?.c), page, pageSize);
      },
      async listActive() {
        const rows = await q("SELECT * FROM bots WHERE status = 'active' ORDER BY created_at DESC");
        return rows.map(mapBot);
      },
      async delete(id) {
        const rows = await q<{ id: string }>('DELETE FROM bots WHERE id = ? RETURNING id', [id]);
        return rows.length > 0;
      },
      async count() {
        const rows = await q('SELECT COUNT(*) AS c FROM bots');
        return toInt(rows[0]?.c);
      },
    },

    users: {
      async create(input) {
        const timestamp = new Date().toISOString();
        const user: BotUser = {
          id: randomId('usr_'),
          botId: input.botId,
          platform: input.platform,
          platformUserId: input.platformUserId,
          chatId: input.chatId,
          username: input.username,
          firstName: input.firstName,
          language: input.language ?? 'fa',
          role: input.role ?? 'user',
          isBlocked: false,
          notes: '',
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          messageCount: 0,
          metadata: {},
        };
        await q(
          `INSERT INTO bot_users (id, bot_id, platform, platform_user_id, chat_id, username, first_name, language, role, is_blocked, notes, first_seen_at, last_seen_at, message_count, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, 0, '{}')`,
          [
            user.id,
            user.botId,
            user.platform,
            user.platformUserId,
            user.chatId,
            user.username ?? null,
            user.firstName ?? null,
            user.language,
            user.role,
            user.firstSeenAt,
            user.lastSeenAt,
          ],
        );
        return user;
      },
      async upsert(input) {
        const existing = await storage.users.findByPlatformId(input.botId, input.platformUserId);
        const timestamp = new Date().toISOString();
        if (existing) {
          await q(
            `UPDATE bot_users SET chat_id = ?, username = COALESCE(?, username), first_name = COALESCE(?, first_name), last_seen_at = ? WHERE id = ?`,
            [input.chatId, input.username ?? null, input.firstName ?? null, timestamp, existing.id],
          );
          return {
            user: {
              ...existing,
              chatId: input.chatId,
              username: input.username ?? existing.username,
              firstName: input.firstName ?? existing.firstName,
              lastSeenAt: timestamp,
            },
            created: false,
          };
        }
        const user = await storage.users.create(input);
        return { user, created: true };
      },
      async findById(id) {
        const rows = await q('SELECT * FROM bot_users WHERE id = ?', [id]);
        return rows[0] ? mapUser(rows[0]) : null;
      },
      async findByPlatformId(botId, platformUserId) {
        const rows = await q('SELECT * FROM bot_users WHERE bot_id = ? AND platform_user_id = ?', [
          botId,
          platformUserId,
        ]);
        return rows[0] ? mapUser(rows[0]) : null;
      },
      async list(botId, query: UserListOptions = {}) {
        const { page, pageSize, offset } = normalizePage(query);
        const clauses = ['bot_id = ?'];
        const params: unknown[] = [botId];
        if (query.search) {
          clauses.push('(lower(coalesce(username, \'\')) LIKE lower(?) OR lower(coalesce(first_name, \'\')) LIKE lower(?) OR platform_user_id LIKE ?)');
          params.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
        }
        if (query.blocked !== undefined) {
          clauses.push('is_blocked = ?');
          params.push(query.blocked ? 1 : 0);
        }
        if (query.role) {
          clauses.push('role = ?');
          params.push(query.role);
        }
        const where = ` WHERE ${clauses.join(' AND ')}`;
        const totalRows = await q(`SELECT COUNT(*) AS c FROM bot_users${where}`, params);
        const rows = await q(
          `SELECT * FROM bot_users${where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows.map(mapUser), toInt(totalRows[0]?.c), page, pageSize);
      },
      async listAll(botId, limit, offset) {
        const rows = await q(
          'SELECT * FROM bot_users WHERE bot_id = ? ORDER BY last_seen_at DESC LIMIT ? OFFSET ?',
          [botId, limit, offset],
        );
        return rows.map(mapUser);
      },
      async setBlocked(botId, id, blocked) {
        const rows = await q<{ id: string }>(
          'UPDATE bot_users SET is_blocked = ? WHERE id = ? AND bot_id = ? RETURNING id',
          [blocked ? 1 : 0, id, botId],
        );
        return rows.length > 0;
      },
      async setRole(botId, id, role: UserRole) {
        const rows = await q<{ id: string }>(
          'UPDATE bot_users SET role = ? WHERE id = ? AND bot_id = ? RETURNING id',
          [role, id, botId],
        );
        return rows.length > 0;
      },
      async updateNotes(botId, id, notes) {
        const rows = await q<{ id: string }>(
          'UPDATE bot_users SET notes = ? WHERE id = ? AND bot_id = ? RETURNING id',
          [notes.slice(0, 2000), id, botId],
        );
        return rows.length > 0;
      },
      async touch(botId, platformUserId, increments) {
        await q(
          'UPDATE bot_users SET last_seen_at = ?, message_count = message_count + ? WHERE bot_id = ? AND platform_user_id = ?',
          [new Date().toISOString(), Math.max(0, increments), botId, platformUserId],
        );
      },
      async count(botId) {
        const rows = await q('SELECT COUNT(*) AS c FROM bot_users WHERE bot_id = ?', [botId]);
        return toInt(rows[0]?.c);
      },
      async countSince(botId, since) {
        const rows = await q('SELECT COUNT(*) AS c FROM bot_users WHERE bot_id = ? AND first_seen_at >= ?', [
          botId,
          since,
        ]);
        return toInt(rows[0]?.c);
      },
      async countAdmins(botId) {
        const rows = await q(
          "SELECT COUNT(*) AS c FROM bot_users WHERE bot_id = ? AND role IN ('admin', 'owner')",
          [botId],
        );
        return toInt(rows[0]?.c);
      },
      async delete(botId, id) {
        const rows = await q<{ id: string }>('DELETE FROM bot_users WHERE id = ? AND bot_id = ? RETURNING id', [
          id,
          botId,
        ]);
        return rows.length > 0;
      },
    },

    settings: {
      async get<T>(botId: string, key: string) {
        const rows = await q('SELECT * FROM settings WHERE bot_id = ? AND key = ?', [botId, key]);
        if (!rows[0]) return null;
        return parseJson<T>(rows[0].value, null as unknown as T);
      },
      async set(botId, key, value) {
        const timestamp = new Date().toISOString();
        await q(
          `INSERT INTO settings (bot_id, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (bot_id, key) DO UPDATE SET value = ?, updated_at = ?`,
          [botId, key, JSON.stringify(value), timestamp, JSON.stringify(value), timestamp],
        );
      },
      async list(botId) {
        const rows = await q('SELECT * FROM settings WHERE bot_id = ?', [botId]);
        return rows.map((row): SettingRecord => ({
          botId: String(row.bot_id),
          key: String(row.key),
          value: parseJson(row.value, null),
          updatedAt: String(row.updated_at),
        }));
      },
      async delete(botId, key) {
        const rows = await q<{ key: string }>(
          'DELETE FROM settings WHERE bot_id = ? AND key = ? RETURNING key',
          [botId, key],
        );
        return rows.length > 0;
      },
    },

    sessions: {
      async get<T>(botId: string, userId: string, key: string) {
        const rows = await q('SELECT * FROM sessions WHERE bot_id = ? AND user_id = ? AND key = ?', [
          botId,
          userId,
          key,
        ]);
        const row = rows[0];
        if (!row) return null;
        const expiresAt = row.expires_at ? String(row.expires_at) : null;
        if (expiresAt && expiresAt < new Date().toISOString()) {
          await storage.sessions.delete(botId, userId, key);
          return null;
        }
        return parseJson<T>(row.value, null as unknown as T);
      },
      async set(botId, userId, key, value, ttlSeconds) {
        const timestamp = new Date().toISOString();
        const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
        const json = JSON.stringify(value);
        await q(
          `INSERT INTO sessions (bot_id, user_id, key, value, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (bot_id, user_id, key) DO UPDATE SET value = ?, updated_at = ?, expires_at = ?`,
          [botId, userId, key, json, timestamp, expiresAt, json, timestamp, expiresAt],
        );
      },
      async delete(botId, userId, key) {
        const rows = await q<{ key: string }>(
          'DELETE FROM sessions WHERE bot_id = ? AND user_id = ? AND key = ? RETURNING key',
          [botId, userId, key],
        );
        return rows.length > 0;
      },
      async clearUser(botId, userId) {
        const rows = await q<{ key: string }>(
          'DELETE FROM sessions WHERE bot_id = ? AND user_id = ? RETURNING key',
          [botId, userId],
        );
        return rows.length;
      },
      async list(botId, userId) {
        const rows = await q('SELECT * FROM sessions WHERE bot_id = ? AND user_id = ? ORDER BY updated_at DESC', [
          botId,
          userId,
        ]);
        return rows.map((row) => ({
          botId: String(row.bot_id),
          userId: String(row.user_id),
          key: String(row.key),
          value: parseJson(row.value, null),
          updatedAt: String(row.updated_at),
          expiresAt: row.expires_at ? String(row.expires_at) : undefined,
        }));
      },
    },

    documents: {
      async insert(input: { botId: string; collection: string; key: string; data: Record<string, unknown> }) {
        const timestamp = new Date().toISOString();
        const existing = await storage.documents.findByKey(input.botId, input.collection, input.key);
        if (existing) {
          await q('UPDATE documents SET data = ?, updated_at = ? WHERE id = ?', [
            JSON.stringify(input.data),
            timestamp,
            existing.id,
          ]);
          return { ...existing, data: input.data, updatedAt: timestamp };
        }
        const id = randomId('doc_');
        await q(
          `INSERT INTO documents (id, bot_id, collection, key, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, input.botId, input.collection, input.key, JSON.stringify(input.data), timestamp, timestamp],
        );
        return {
          id,
          botId: input.botId,
          collection: input.collection,
          key: input.key,
          data: input.data,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      },
      async upsert(input: { botId: string; collection: string; key: string; data: Record<string, unknown> }) {
        const timestamp = new Date().toISOString();
        const id = randomId('doc_');
        const json = JSON.stringify(input.data);
        await q(
          `INSERT INTO documents (id, bot_id, collection, key, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (bot_id, collection, key) DO UPDATE SET data = ?, updated_at = ?`,
          [id, input.botId, input.collection, input.key, json, timestamp, timestamp, json, timestamp],
        );
        const saved = await storage.documents.findByKey(input.botId, input.collection, input.key);
        if (!saved) throw new Error('document upsert failed');
        return saved;
      },
      async findById(botId: string, id: string) {
        const rows = await q('SELECT * FROM documents WHERE bot_id = ? AND id = ?', [botId, id]);
        if (!rows[0]) return null;
        return mapDocument(rows[0]);
      },
      async findByKey(botId: string, collection: string, key: string) {
        const rows = await q('SELECT * FROM documents WHERE bot_id = ? AND collection = ? AND key = ?', [
          botId,
          collection,
          key,
        ]);
        if (!rows[0]) return null;
        return mapDocument(rows[0]);
      },
      async list(botId: string, collection: string, query: DocumentQuery = {}) {
        const { page, pageSize, offset } = normalizePage(query);
        const clauses = ['bot_id = ?', 'collection = ?'];
        const params: unknown[] = [botId, collection];
        if (query.search) {
          clauses.push('(lower(key) LIKE lower(?) OR lower(data) LIKE lower(?))');
          params.push(`%${query.search}%`, `%${query.search}%`);
        }
        const where = ` WHERE ${clauses.join(' AND ')}`;
        const orderColumn = query.orderBy === 'updated_at' ? 'updated_at' : 'created_at';
        const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
        const totalRows = await q(`SELECT COUNT(*) AS c FROM documents${where}`, params);
        const rows = await q(
          `SELECT * FROM documents${where} ORDER BY ${orderColumn} ${direction} LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows.map(mapDocument), toInt(totalRows[0]?.c), page, pageSize);
      },
      async update(botId: string, id: string, data: Record<string, unknown>) {
        const timestamp = new Date().toISOString();
        const rows = await q<{ id: string }>(
          'UPDATE documents SET data = ?, updated_at = ? WHERE bot_id = ? AND id = ? RETURNING id',
          [JSON.stringify(data), timestamp, botId, id],
        );
        if (rows.length === 0) return null;
        return storage.documents.findById(botId, id);
      },
      async delete(botId, id) {
        const rows = await q<{ id: string }>(
          'DELETE FROM documents WHERE bot_id = ? AND id = ? RETURNING id',
          [botId, id],
        );
        return rows.length > 0;
      },
      async deleteByKey(botId, collection, key) {
        const rows = await q<{ id: string }>(
          'DELETE FROM documents WHERE bot_id = ? AND collection = ? AND key = ? RETURNING id',
          [botId, collection, key],
        );
        return rows.length > 0;
      },
      async count(botId, collection) {
        const rows = await q('SELECT COUNT(*) AS c FROM documents WHERE bot_id = ? AND collection = ?', [
          botId,
          collection,
        ]);
        return toInt(rows[0]?.c);
      },
    },

    messages: {
      async log(input: {
        botId: string;
        platform: PlatformName;
        direction: MessageDirection;
        chatId: string;
        userId: string;
        text: string;
        status?: string;
      }) {
        await q(
          `INSERT INTO messages (id, bot_id, platform, direction, chat_id, user_id, text, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId('msg_'),
            input.botId,
            input.platform,
            input.direction,
            input.chatId,
            input.userId,
            input.text.slice(0, 2000),
            input.status ?? 'ok',
            new Date().toISOString(),
          ],
        );
      },
      async countSince(botId, since) {
        const rows = await q('SELECT COUNT(*) AS c FROM messages WHERE bot_id = ? AND created_at >= ?', [
          botId,
          since,
        ]);
        return toInt(rows[0]?.c);
      },
      async countTotal(botId) {
        const rows = await q('SELECT COUNT(*) AS c FROM messages WHERE bot_id = ?', [botId]);
        return toInt(rows[0]?.c);
      },
      async recent(botId, limit) {
        const rows = await q(
          'SELECT id, direction, text, user_id, created_at FROM messages WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?',
          [botId, limit],
        );
        return rows.map(mapMessage);
      },
      async deleteOlderThan(botId, before) {
        const rows = await q<{ id: string }>(
          'DELETE FROM messages WHERE bot_id = ? AND created_at < ? RETURNING id',
          [botId, before],
        );
        return rows.length;
      },
    },

    jobs: {
      async create(input) {
        const timestamp = new Date().toISOString();
        const job: JobRecord = {
          id: randomId('job_'),
          botId: input.botId,
          type: input.type,
          payload: input.payload,
          status: input.status ?? 'pending',
          attempts: 0,
          maxAttempts: input.maxAttempts ?? 5,
          runAt: input.runAt ?? timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await q(
          `INSERT INTO jobs (id, bot_id, type, payload, status, attempts, max_attempts, run_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          [job.id, job.botId, job.type, JSON.stringify(job.payload), job.status, job.maxAttempts, job.runAt, job.createdAt, job.updatedAt],
        );
        return job;
      },
      async claimDue(limit, now = new Date().toISOString()) {
        const candidates = await q(
          'SELECT id FROM jobs WHERE status IN (\'pending\', \'failed\') AND run_at <= ? ORDER BY run_at ASC LIMIT ?',
          [now, limit],
        );
        const claimed: JobRecord[] = [];
        for (const candidate of candidates) {
          const id = String(candidate.id);
          const updated = await q<{ id: string }>(
            `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status IN ('pending', 'failed') RETURNING id`,
            [new Date().toISOString(), id],
          );
          if (updated.length === 0) continue;
          const rows = await q('SELECT * FROM jobs WHERE id = ?', [id]);
          if (rows[0]) claimed.push(mapJob(rows[0]));
        }
        return claimed;
      },
      async complete(id) {
        await q("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
      },
      async fail(id, error, retryAt, dead) {
        await q('UPDATE jobs SET status = ?, last_error = ?, run_at = COALESCE(?, run_at), updated_at = ? WHERE id = ?', [
          dead ? 'dead' : 'failed',
          error.slice(0, 1000),
          retryAt ?? null,
          new Date().toISOString(),
          id,
        ]);
      },
      async reschedule(id, runAt) {
        await q("UPDATE jobs SET status = 'pending', run_at = ?, updated_at = ? WHERE id = ?", [
          runAt,
          new Date().toISOString(),
          id,
        ]);
      },
      async findById(id) {
        const rows = await q('SELECT * FROM jobs WHERE id = ?', [id]);
        return rows[0] ? mapJob(rows[0]) : null;
      },
      async list(botId, query = {}) {
        const { page, pageSize, offset } = normalizePage(query);
        const clauses = ['bot_id = ?'];
        const params: unknown[] = [botId];
        if (query.status) {
          clauses.push('status = ?');
          params.push(query.status);
        }
        const where = ` WHERE ${clauses.join(' AND ')}`;
        const totalRows = await q(`SELECT COUNT(*) AS c FROM jobs${where}`, params);
        const rows = await q(`SELECT * FROM jobs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
          ...params,
          pageSize,
          offset,
        ]);
        return paginate(rows.map(mapJob), toInt(totalRows[0]?.c), page, pageSize);
      },
      async countPending(botId) {
        const rows = botId
          ? await q("SELECT COUNT(*) AS c FROM jobs WHERE bot_id = ? AND status IN ('pending', 'failed')", [botId])
          : await q("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending', 'failed')");
        return toInt(rows[0]?.c);
      },
      async purge(olderThan) {
        const rows = await q<{ id: string }>(
          "DELETE FROM jobs WHERE status = 'done' AND updated_at < ? RETURNING id",
          [olderThan],
        );
        return rows.length;
      },
    },

    audits: {
      async log(input) {
        const record: AuditRecord = { ...input, id: randomId('aud_'), createdAt: new Date().toISOString() };
        await q(
          'INSERT INTO audits (id, actor_id, actor_type, action, target, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            record.id,
            record.actorId,
            record.actorType,
            record.action,
            record.target,
            JSON.stringify(record.meta),
            record.ip,
            record.createdAt,
          ],
        );
        return record;
      },
      async list(query = {}) {
        const { page, pageSize, offset } = normalizePage(query);
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (query.actorId) {
          clauses.push('actor_id = ?');
          params.push(query.actorId);
        }
        if (query.action) {
          clauses.push('action = ?');
          params.push(query.action);
        }
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const totalRows = await q(`SELECT COUNT(*) AS c FROM audits${where}`, params);
        const rows = await q(`SELECT * FROM audits${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
          ...params,
          pageSize,
          offset,
        ]);
        return paginate(rows.map(mapAudit), toInt(totalRows[0]?.c), page, pageSize);
      },
    },

    admins: {
      async create(input) {
        const record: AdminRecord = {
          id: randomId('adm_'),
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          role: input.role,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
        await q('INSERT INTO admins (id, email, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [
          record.id,
          record.email,
          record.passwordHash,
          record.role,
          record.createdAt,
        ]);
        return record;
      },
      async findByEmail(email) {
        const rows = await q('SELECT * FROM admins WHERE email = ?', [email.toLowerCase()]);
        return rows[0] ? mapAdmin(rows[0]) : null;
      },
      async findById(id) {
        const rows = await q('SELECT * FROM admins WHERE id = ?', [id]);
        return rows[0] ? mapAdmin(rows[0]) : null;
      },
      async list() {
        const rows = await q('SELECT * FROM admins ORDER BY created_at DESC');
        return rows.map(mapAdmin);
      },
      async updateLastLogin(id) {
        await q('UPDATE admins SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]);
      },
      async setActive(id, active) {
        const rows = await q<{ id: string }>('UPDATE admins SET is_active = ? WHERE id = ? RETURNING id', [
          active ? 1 : 0,
          id,
        ]);
        return rows.length > 0;
      },
      async setPassword(id, passwordHash) {
        const rows = await q<{ id: string }>('UPDATE admins SET password_hash = ? WHERE id = ? RETURNING id', [
          passwordHash,
          id,
        ]);
        return rows.length > 0;
      },
      async count() {
        const rows = await q('SELECT COUNT(*) AS c FROM admins');
        return toInt(rows[0]?.c);
      },
    },

    apiKeys: {
      async create(input) {
        const record: ApiKeyRecord = {
          id: randomId('key_'),
          name: input.name,
          prefix: input.prefix,
          hash: input.hash,
          scopes: input.scopes,
          createdAt: new Date().toISOString(),
        };
        await q('INSERT INTO api_keys (id, name, prefix, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          record.id,
          record.name,
          record.prefix,
          record.hash,
          JSON.stringify(record.scopes),
          record.createdAt,
        ]);
        return record;
      },
      async findByPrefix(prefix) {
        const rows = await q('SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL', [prefix]);
        return rows[0] ? mapApiKey(rows[0]) : null;
      },
      async list() {
        const rows = await q('SELECT * FROM api_keys ORDER BY created_at DESC');
        return rows.map((row) => ({ ...mapApiKey(row), hash: '' }));
      },
      async revoke(id) {
        const rows = await q<{ id: string }>(
          'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id',
          [new Date().toISOString(), id],
        );
        return rows.length > 0;
      },
      async touch(id) {
        await q('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), id]);
      },
    },

    events: {
      async log(input) {
        const record: EventRecord = { ...input, id: randomId('evt_'), createdAt: new Date().toISOString() };
        await q('INSERT INTO events (id, bot_id, type, level, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          record.id,
          record.botId,
          record.type,
          record.level,
          JSON.stringify(record.payload),
          record.createdAt,
        ]);
        return record;
      },
      async list(botId, query = {}) {
        const { page, pageSize, offset } = normalizePage(query);
        const clauses = ['bot_id = ?'];
        const params: unknown[] = [botId];
        if (query.level) {
          clauses.push('level = ?');
          params.push(query.level);
        }
        const where = ` WHERE ${clauses.join(' AND ')}`;
        const totalRows = await q(`SELECT COUNT(*) AS c FROM events${where}`, params);
        const rows = await q(`SELECT * FROM events${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
          ...params,
          pageSize,
          offset,
        ]);
        return paginate(rows.map(mapEvent), toInt(totalRows[0]?.c), page, pageSize);
      },
      async countSince(botId, since, level) {
        const rows = level
          ? await q('SELECT COUNT(*) AS c FROM events WHERE bot_id = ? AND created_at >= ? AND level = ?', [
              botId,
              since,
              level,
            ])
          : await q('SELECT COUNT(*) AS c FROM events WHERE bot_id = ? AND created_at >= ?', [botId, since]);
        return toInt(rows[0]?.c);
      },
      async recent(limit) {
        const rows = await q('SELECT * FROM events ORDER BY created_at DESC LIMIT ?', [limit]);
        return rows.map(mapEvent);
      },
    },

    updates: {
      async mark(botId, updateId) {
        try {
          const rows = await q<{ update_id: string }>(
            'INSERT INTO processed_updates (bot_id, update_id, created_at) VALUES (?, ?, ?) ON CONFLICT (bot_id, update_id) DO NOTHING RETURNING update_id',
            [botId, updateId, new Date().toISOString()],
          );
          return rows.length > 0;
        } catch {
          return false;
        }
      },
      async purge(olderThan) {
        const rows = await q<{ update_id: string }>(
          'DELETE FROM processed_updates WHERE created_at < ? RETURNING update_id',
          [olderThan],
        );
        return rows.length;
      },
    },

    async init() {
      await client.ping();
    },
    async close() {
      await client.close();
    },
    async ping() {
      return client.ping();
    },
  };

  return storage;
}
