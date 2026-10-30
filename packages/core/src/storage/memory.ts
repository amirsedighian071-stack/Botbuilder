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
  SessionRecord,
  SettingRecord,
  UserRole,
} from '../types';
import { randomId } from '../crypto';
import {
  normalizePage,
  paginate,
  type AdminRepository,
  type ApiKeyRepository,
  type AuditRepository,
  type BotRepository,
  type DocumentQuery,
  type DocumentRepository,
  type EventRepository,
  type JobRepository,
  type MessageRepository,
  type SessionRepository,
  type SettingRepository,
  type Storage,
  type UpdateDedupeRepository,
  type UserListOptions,
  type UserRepository,
} from './types';

const clone = <T>(value: T): T => (value === undefined ? value : (structuredClone(value) as T));

export interface MemoryStorageOptions {
  now?: () => Date;
}

export function createMemoryStorage(options: MemoryStorageOptions = {}): Storage {
  const nowIso = () => (options.now ? options.now() : new Date()).toISOString();

  const bots = new Map<string, BotRecord>();
  const users = new Map<string, BotUser>();
  const adminLinks = new Map<string, Set<string>>();
  const settings = new Map<string, SettingRecord>();
  const sessions = new Map<string, SessionRecord>();
  const documents = new Map<string, DocumentRecord>();
  const messages: Array<{ id: string; botId: string; platform: PlatformName; direction: MessageDirection; chatId: string; userId: string; text: string; status: string; createdAt: string }> = [];
  const jobs = new Map<string, JobRecord>();
  const audits: AuditRecord[] = [];
  const admins = new Map<string, AdminRecord>();
  const apiKeys = new Map<string, ApiKeyRecord>();
  const events: EventRecord[] = [];
  const processed = new Set<string>();

  const settingKey = (botId: string, key: string) => `${botId}::${key}`;
  const sessionKey = (botId: string, userId: string, key: string) => `${botId}::${userId}::${key}`;
  const docKey = (botId: string, collection: string, key: string) => `${botId}::${collection}::${key}`;

  const botRepo: BotRepository = {
    async create(input) {
      bots.set(input.id, clone(input));
      return clone(input);
    },
    async update(id, patch) {
      const current = bots.get(id);
      if (!current) return null;
      const next = { ...current, ...clone(patch), updatedAt: nowIso() };
      bots.set(id, next);
      return clone(next);
    },
    async findById(id) {
      const record = bots.get(id);
      return record ? clone(record) : null;
    },
    async findBySlug(slug) {
      for (const record of bots.values()) {
        if (record.slug === slug) return clone(record);
      }
      return null;
    },
    async list(query = {}) {
      const { page, pageSize, offset } = normalizePage(query);
      let items = [...bots.values()];
      if (query.platform) items = items.filter((item) => item.platform === query.platform);
      if (query.status) items = items.filter((item) => item.status === query.status);
      if (query.ownerId) items = items.filter((item) => item.ownerId === query.ownerId);
      if (query.search) {
        const needle = query.search.toLowerCase();
        items = items.filter((item) => item.name.toLowerCase().includes(needle) || item.slug.includes(needle));
      }
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(items.slice(offset, offset + pageSize).map(clone), items.length, page, pageSize);
    },
    async listActive() {
      return [...bots.values()].filter((item) => item.status === 'active').map(clone);
    },
    async delete(id) {
      return bots.delete(id);
    },
    async count() {
      return bots.size;
    },
  };

  const userRepo: UserRepository = {
    async create(input) {
      const timestamp = nowIso();
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
      users.set(user.id, user);
      return clone(user);
    },
    async upsert(input) {
      const existing = [...users.values()].find(
        (item) => item.botId === input.botId && item.platformUserId === input.platformUserId,
      );
      if (existing) {
        existing.lastSeenAt = nowIso();
        existing.chatId = input.chatId;
        if (input.username) existing.username = input.username;
        if (input.firstName) existing.firstName = input.firstName;
        if (input.language) existing.language = input.language;
        return { user: clone(existing), created: false };
      }
      const created = await userRepo.create(input);
      return { user: created, created: true };
    },
    async findById(id) {
      const user = users.get(id);
      return user ? clone(user) : null;
    },
    async findByPlatformId(botId, platformUserId) {
      const user = [...users.values()].find(
        (item) => item.botId === botId && item.platformUserId === platformUserId,
      );
      return user ? clone(user) : null;
    },
    async list(botId, query: UserListOptions = {}) {
      const { page, pageSize, offset } = normalizePage(query);
      let items = [...users.values()].filter((item) => item.botId === botId);
      if (query.search) {
        const needle = query.search.toLowerCase();
        items = items.filter(
          (item) =>
            item.platformUserId.includes(needle) ||
            (item.username ?? '').toLowerCase().includes(needle) ||
            (item.firstName ?? '').toLowerCase().includes(needle),
        );
      }
      if (query.blocked !== undefined) items = items.filter((item) => item.isBlocked === query.blocked);
      if (query.role) items = items.filter((item) => item.role === query.role);
      items.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
      return paginate(items.slice(offset, offset + pageSize).map(clone), items.length, page, pageSize);
    },
    async listAll(botId, limit, offset) {
      return [...users.values()]
        .filter((item) => item.botId === botId)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .slice(offset, offset + limit)
        .map(clone);
    },
    async setBlocked(botId, id, blocked) {
      const user = users.get(id);
      if (!user || user.botId !== botId) return false;
      user.isBlocked = blocked;
      return true;
    },
    async setRole(botId, id, role: UserRole) {
      const user = users.get(id);
      if (!user || user.botId !== botId) return false;
      user.role = role;
      const set = adminLinks.get(botId) ?? new Set<string>();
      if (role === 'admin' || role === 'owner') set.add(id);
      else set.delete(id);
      adminLinks.set(botId, set);
      return true;
    },
    async updateNotes(botId, id, notes) {
      const user = users.get(id);
      if (!user || user.botId !== botId) return false;
      user.notes = notes;
      return true;
    },
    async touch(botId, platformUserId, increments) {
      const user = [...users.values()].find(
        (item) => item.botId === botId && item.platformUserId === platformUserId,
      );
      if (!user) return;
      user.lastSeenAt = nowIso();
      if (increments > 0) user.messageCount += increments;
    },
    async count(botId) {
      return [...users.values()].filter((item) => item.botId === botId).length;
    },
    async countSince(botId, since) {
      return [...users.values()].filter((item) => item.botId === botId && item.firstSeenAt >= since).length;
    },
    async countAdmins(botId) {
      return [...users.values()].filter(
        (item) => item.botId === botId && (item.role === 'admin' || item.role === 'owner'),
      ).length;
    },
    async delete(botId, id) {
      const user = users.get(id);
      if (!user || user.botId !== botId) return false;
      return users.delete(id);
    },
  };

  const settingRepo: SettingRepository = {
    async get(botId: string, key: string) {
      const record = settings.get(settingKey(botId, key));
      return record ? (clone(record.value) as never) : null;
    },
    async set(botId, key, value) {
      settings.set(settingKey(botId, key), { botId, key, value: clone(value), updatedAt: nowIso() });
    },
    async list(botId) {
      return [...settings.values()].filter((item) => item.botId === botId).map(clone);
    },
    async delete(botId, key) {
      return settings.delete(settingKey(botId, key));
    },
  };

  const sessionRepo: SessionRepository = {
    async get(botId: string, userId: string, key: string) {
      const record = sessions.get(sessionKey(botId, userId, key));
      if (!record) return null;
      if (record.expiresAt && record.expiresAt < nowIso()) {
        sessions.delete(sessionKey(botId, userId, key));
        return null;
      }
      return clone(record.value) as never;
    },
    async set(botId, userId, key, value, ttlSeconds) {
      const expiresAt = ttlSeconds
        ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
        : undefined;
      sessions.set(sessionKey(botId, userId, key), {
        botId,
        userId,
        key,
        value: clone(value),
        updatedAt: nowIso(),
        expiresAt,
      });
    },
    async delete(botId, userId, key) {
      return sessions.delete(sessionKey(botId, userId, key));
    },
    async clearUser(botId, userId) {
      let removed = 0;
      for (const [key, record] of sessions) {
        if (record.botId === botId && record.userId === userId) {
          sessions.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async list(botId, userId) {
      return [...sessions.values()]
        .filter((item) => item.botId === botId && item.userId === userId)
        .map(clone);
    },
  };

  const documentRepo: DocumentRepository = {
    async insert(input) {
      const timestamp = nowIso();
      const record: DocumentRecord = {
        id: randomId('doc_'),
        botId: input.botId,
        collection: input.collection,
        key: input.key,
        data: clone(input.data),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const existing = documents.get(docKey(input.botId, input.collection, input.key));
      if (existing) {
        record.id = existing.id;
        record.createdAt = existing.createdAt;
      }
      documents.set(docKey(input.botId, input.collection, input.key), record);
      documents.set(`id::${record.id}`, record);
      return clone(record);
    },
    async upsert(input) {
      return documentRepo.insert(input);
    },
    async findById(botId, id) {
      const record = documents.get(`id::${id}`);
      if (!record || record.botId !== botId) return null;
      return clone(record);
    },
    async findByKey(botId, collection, key) {
      const record = documents.get(docKey(botId, collection, key));
      return record ? clone(record) : null;
    },
    async list(botId, collection, query: DocumentQuery = {}) {
      const { page, pageSize, offset } = normalizePage(query);
      let items = [...documents.values()].filter(
        (item) => !item.id.startsWith('id::') && item.botId === botId && item.collection === collection,
      );
      items = [...new Map(items.map((item) => [item.id, item])).values()];
      if (query.search) {
        const needle = query.search.toLowerCase();
        items = items.filter(
          (item) => item.key.toLowerCase().includes(needle) || JSON.stringify(item.data).toLowerCase().includes(needle),
        );
      }
      const direction = query.direction === 'asc' ? 1 : -1;
      const field = query.orderBy === 'updated_at' ? 'updatedAt' : 'createdAt';
      items.sort((a, b) => direction * (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
      return paginate(items.slice(offset, offset + pageSize).map(clone), items.length, page, pageSize);
    },
    async update(botId, id, data) {
      const record = documents.get(`id::${id}`);
      if (!record || record.botId !== botId) return null;
      record.data = clone(data);
      record.updatedAt = nowIso();
      return clone(record);
    },
    async delete(botId, id) {
      const record = documents.get(`id::${id}`);
      if (!record || record.botId !== botId) return false;
      documents.delete(`id::${id}`);
      documents.delete(docKey(record.botId, record.collection, record.key));
      return true;
    },
    async deleteByKey(botId, collection, key) {
      const record = documents.get(docKey(botId, collection, key));
      if (!record) return false;
      documents.delete(docKey(botId, collection, key));
      documents.delete(`id::${record.id}`);
      return true;
    },
    async count(botId, collection) {
      return [...documents.values()].filter(
        (item) => !item.id.startsWith('id::') && item.botId === botId && item.collection === collection,
      ).length;
    },
  };

  const messageRepo: MessageRepository = {
    async log(input) {
      messages.push({
        id: randomId('msg_'),
        botId: input.botId,
        platform: input.platform,
        direction: input.direction,
        chatId: input.chatId,
        userId: input.userId,
        text: input.text.slice(0, 2000),
        status: input.status ?? 'ok',
        createdAt: nowIso(),
      });
      if (messages.length > 20_000) messages.splice(0, messages.length - 20_000);
    },
    async countSince(botId, since) {
      return messages.filter((item) => item.botId === botId && item.createdAt >= since).length;
    },
    async countTotal(botId) {
      return messages.filter((item) => item.botId === botId).length;
    },
    async recent(botId, limit) {
      return messages
        .filter((item) => item.botId === botId)
        .slice(-limit)
        .reverse()
        .map((item) => ({
          id: item.id,
          direction: item.direction,
          text: item.text,
          userId: item.userId,
          createdAt: item.createdAt,
        }));
    },
    async deleteOlderThan(botId, before) {
      const beforeCount = messages.length;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const item = messages[index];
        if (item.botId === botId && item.createdAt < before) messages.splice(index, 1);
      }
      return beforeCount - messages.length;
    },
  };

  const jobRepo: JobRepository = {
    async create(input) {
      const timestamp = nowIso();
      const job: JobRecord = {
        id: randomId('job_'),
        botId: input.botId,
        type: input.type,
        payload: clone(input.payload),
        status: input.status ?? 'pending',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        runAt: input.runAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      jobs.set(job.id, job);
      return clone(job);
    },
    async claimDue(limit, now = nowIso()) {
      const due = [...jobs.values()]
        .filter((job) => (job.status === 'pending' || job.status === 'failed') && job.runAt <= now)
        .sort((a, b) => a.runAt.localeCompare(b.runAt))
        .slice(0, limit);
      for (const job of due) {
        job.status = 'running';
        job.attempts += 1;
        job.updatedAt = nowIso();
      }
      return due.map(clone);
    },
    async complete(id) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = 'done';
      job.updatedAt = nowIso();
    },
    async fail(id, error, retryAt, dead) {
      const job = jobs.get(id);
      if (!job) return;
      job.lastError = error.slice(0, 1000);
      job.status = dead ? 'dead' : 'failed';
      if (retryAt) job.runAt = retryAt;
      job.updatedAt = nowIso();
    },
    async reschedule(id, runAt) {
      const job = jobs.get(id);
      if (!job) return;
      job.runAt = runAt;
      job.status = 'pending';
      job.updatedAt = nowIso();
    },
    async findById(id) {
      const job = jobs.get(id);
      return job ? clone(job) : null;
    },
    async list(botId, query = {}) {
      const { page, pageSize, offset } = normalizePage(query);
      let items = [...jobs.values()].filter((item) => item.botId === botId);
      if (query.status) items = items.filter((item) => item.status === query.status);
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(items.slice(offset, offset + pageSize).map(clone), items.length, page, pageSize);
    },
    async countPending(botId) {
      return [...jobs.values()].filter(
        (item) => (botId ? item.botId === botId : true) && (item.status === 'pending' || item.status === 'failed'),
      ).length;
    },
    async purge(olderThan) {
      let removed = 0;
      for (const [id, job] of jobs) {
        if (job.status === 'done' && job.updatedAt < olderThan) {
          jobs.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };

  const auditRepo: AuditRepository = {
    async log(input) {
      const record: AuditRecord = { ...input, id: randomId('aud_'), createdAt: nowIso() };
      audits.unshift(record);
      if (audits.length > 5000) audits.length = 5000;
      return clone(record);
    },
    async list(query = {}) {
      const { page, pageSize, offset } = normalizePage(query);
      let items = [...audits];
      if (query.actorId) items = items.filter((item) => item.actorId === query.actorId);
      if (query.action) items = items.filter((item) => item.action === query.action);
      return paginate(items.slice(offset, offset + pageSize).map(clone), items.length, page, pageSize);
    },
  };

  const adminRepo: AdminRepository = {
    async create(input) {
      const record: AdminRecord = {
        id: randomId('adm_'),
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        isActive: true,
        createdAt: nowIso(),
      };
      admins.set(record.id, record);
      return clone(record);
    },
    async findByEmail(email) {
      const record = [...admins.values()].find((item) => item.email === email.toLowerCase());
      return record ? clone(record) : null;
    },
    async findById(id) {
      const record = admins.get(id);
      return record ? clone(record) : null;
    },
    async list() {
      return [...admins.values()].map(clone);
    },
    async updateLastLogin(id) {
      const record = admins.get(id);
      if (record) record.lastLoginAt = nowIso();
    },
    async setActive(id, active) {
      const record = admins.get(id);
      if (!record) return false;
      record.isActive = active;
      return true;
    },
    async setPassword(id, passwordHash) {
      const record = admins.get(id);
      if (!record) return false;
      record.passwordHash = passwordHash;
      return true;
    },
    async count() {
      return admins.size;
    },
  };

  const apiKeyRepo: ApiKeyRepository = {
    async create(input) {
      const record: ApiKeyRecord = {
        id: randomId('key_'),
        name: input.name,
        prefix: input.prefix,
        hash: input.hash,
        scopes: input.scopes,
        createdAt: nowIso(),
      };
      apiKeys.set(record.id, record);
      return clone(record);
    },
    async findByPrefix(prefix) {
      const record = [...apiKeys.values()].find((item) => item.prefix === prefix && !item.revokedAt);
      return record ? clone(record) : null;
    },
    async list() {
      return [...apiKeys.values()].map((item) => ({ ...clone(item), hash: '' }));
    },
    async revoke(id) {
      const record = apiKeys.get(id);
      if (!record) return false;
      record.revokedAt = nowIso();
      return true;
    },
    async touch(id) {
      const record = apiKeys.get(id);
      if (record) record.lastUsedAt = nowIso();
    },
  };

  const eventRepo: EventRepository = {
    async log(input) {
      const record: EventRecord = { ...input, id: randomId('evt_'), createdAt: nowIso() };
      events.unshift(record);
      if (events.length > 10_000) events.length = 10_000;
      return clone(record);
    },
    async list(botId, query = {}) {
      const { page, pageSize, offset } = normalizePage(query);
      let items = events.filter((item) => item.botId === botId);
      if (query.level) items = items.filter((item) => item.level === query.level);
      return paginate(items.slice(offset, offset + pageSize).map(clone), items.length, page, pageSize);
    },
    async countSince(botId, since, level) {
      return events.filter(
        (item) => item.botId === botId && item.createdAt >= since && (!level || item.level === level),
      ).length;
    },
    async recent(limit) {
      return events.slice(0, limit).map(clone);
    },
  };

  const updateRepo: UpdateDedupeRepository = {
    async mark(botId, updateId) {
      const key = `${botId}::${updateId}`;
      if (processed.has(key)) return false;
      processed.add(key);
      return true;
    },
    async purge() {
      const size = processed.size;
      processed.clear();
      return size;
    },
  };

  return {
    driver: 'memory',
    bots: botRepo,
    users: userRepo,
    settings: settingRepo,
    sessions: sessionRepo,
    documents: documentRepo,
    messages: messageRepo,
    jobs: jobRepo,
    audits: auditRepo,
    admins: adminRepo,
    apiKeys: apiKeyRepo,
    events: eventRepo,
    updates: updateRepo,
    async init() {
      return undefined;
    },
    async close() {
      return undefined;
    },
    async ping() {
      return true;
    },
  };
}
