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
  Paginated,
  PlatformName,
  SessionRecord,
  SettingRecord,
  UserRole,
} from '../types';

export interface PageOptions {
  page?: number;
  pageSize?: number;
}

export interface UserListOptions extends PageOptions {
  search?: string;
  blocked?: boolean;
  role?: UserRole;
}

export interface UserRepository {
  create(input: {
    botId: string;
    platform: PlatformName;
    platformUserId: string;
    chatId: string;
    username?: string;
    firstName?: string;
    language?: 'fa' | 'en';
    role?: UserRole;
  }): Promise<BotUser>;
  upsert(input: {
    botId: string;
    platform: PlatformName;
    platformUserId: string;
    chatId: string;
    username?: string;
    firstName?: string;
    language?: 'fa' | 'en';
  }): Promise<{ user: BotUser; created: boolean }>;
  findById(id: string): Promise<BotUser | null>;
  findByPlatformId(botId: string, platformUserId: string): Promise<BotUser | null>;
  list(botId: string, options?: UserListOptions): Promise<Paginated<BotUser>>;
  listAll(botId: string, limit: number, offset: number): Promise<BotUser[]>;
  setBlocked(botId: string, id: string, blocked: boolean): Promise<boolean>;
  setRole(botId: string, id: string, role: UserRole): Promise<boolean>;
  updateNotes(botId: string, id: string, notes: string): Promise<boolean>;
  touch(botId: string, platformUserId: string, increments: number): Promise<void>;
  count(botId: string): Promise<number>;
  countSince(botId: string, since: string): Promise<number>;
  countAdmins(botId: string): Promise<number>;
  delete(botId: string, id: string): Promise<boolean>;
}

export interface BotRepository {
  create(input: BotRecord): Promise<BotRecord>;
  update(id: string, patch: Partial<BotRecord>): Promise<BotRecord | null>;
  findById(id: string): Promise<BotRecord | null>;
  findBySlug(slug: string): Promise<BotRecord | null>;
  list(options?: PageOptions & { platform?: PlatformName; status?: string; ownerId?: string; search?: string }): Promise<Paginated<BotRecord>>;
  listActive(): Promise<BotRecord[]>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export interface SettingRepository {
  get<T = unknown>(botId: string, key: string): Promise<T | null>;
  set(botId: string, key: string, value: unknown): Promise<void>;
  list(botId: string): Promise<SettingRecord[]>;
  delete(botId: string, key: string): Promise<boolean>;
}

export interface SessionRepository {
  get<T = unknown>(botId: string, userId: string, key: string): Promise<T | null>;
  set(botId: string, userId: string, key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  delete(botId: string, userId: string, key: string): Promise<boolean>;
  clearUser(botId: string, userId: string): Promise<number>;
  list(botId: string, userId: string): Promise<SessionRecord[]>;
}

export interface DocumentQuery extends PageOptions {
  search?: string;
  orderBy?: 'created_at' | 'updated_at';
  direction?: 'asc' | 'desc';
  filter?: Record<string, unknown>;
}

export interface DocumentRepository {
  insert(input: {
    botId: string;
    collection: string;
    key: string;
    data: Record<string, unknown>;
  }): Promise<DocumentRecord>;
  upsert(input: {
    botId: string;
    collection: string;
    key: string;
    data: Record<string, unknown>;
  }): Promise<DocumentRecord>;
  findById(botId: string, id: string): Promise<DocumentRecord | null>;
  findByKey(botId: string, collection: string, key: string): Promise<DocumentRecord | null>;
  list(botId: string, collection: string, query?: DocumentQuery): Promise<Paginated<DocumentRecord>>;
  update(botId: string, id: string, data: Record<string, unknown>): Promise<DocumentRecord | null>;
  delete(botId: string, id: string): Promise<boolean>;
  deleteByKey(botId: string, collection: string, key: string): Promise<boolean>;
  count(botId: string, collection: string): Promise<number>;
}

export interface MessageRepository {
  log(input: {
    botId: string;
    platform: PlatformName;
    direction: MessageDirection;
    chatId: string;
    userId: string;
    text: string;
    status?: string;
  }): Promise<void>;
  countSince(botId: string, since: string): Promise<number>;
  countTotal(botId: string): Promise<number>;
  recent(botId: string, limit: number): Promise<Array<{ id: string; direction: MessageDirection; text: string; userId: string; createdAt: string }>>;
  deleteOlderThan(botId: string, before: string): Promise<number>;
}

export interface JobRepository {
  create(input: {
    botId: string;
    type: string;
    payload: Record<string, unknown>;
    runAt?: string;
    maxAttempts?: number;
    status?: JobRecord['status'];
  }): Promise<JobRecord>;
  claimDue(limit: number, now?: string): Promise<JobRecord[]>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, retryAt?: string, dead?: boolean): Promise<void>;
  reschedule(id: string, runAt: string): Promise<void>;
  findById(id: string): Promise<JobRecord | null>;
  list(botId: string, options?: PageOptions & { status?: JobRecord['status'] }): Promise<Paginated<JobRecord>>;
  countPending(botId?: string): Promise<number>;
  purge(olderThan: string): Promise<number>;
}

export interface AuditRepository {
  log(input: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<AuditRecord>;
  list(options?: PageOptions & { actorId?: string; action?: string }): Promise<Paginated<AuditRecord>>;
}

export interface AdminRepository {
  create(input: { email: string; passwordHash: string; role: AdminRecord['role'] }): Promise<AdminRecord>;
  findByEmail(email: string): Promise<AdminRecord | null>;
  findById(id: string): Promise<AdminRecord | null>;
  list(): Promise<AdminRecord[]>;
  updateLastLogin(id: string): Promise<void>;
  setActive(id: string, active: boolean): Promise<boolean>;
  setPassword(id: string, passwordHash: string): Promise<boolean>;
  count(): Promise<number>;
}

export interface ApiKeyRepository {
  create(input: { name: string; prefix: string; hash: string; scopes: string[] }): Promise<ApiKeyRecord>;
  findByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
  list(): Promise<ApiKeyRecord[]>;
  revoke(id: string): Promise<boolean>;
  touch(id: string): Promise<void>;
}

export interface EventRepository {
  log(input: Omit<EventRecord, 'id' | 'createdAt'>): Promise<EventRecord>;
  list(botId: string, options?: PageOptions & { level?: EventRecord['level'] }): Promise<Paginated<EventRecord>>;
  countSince(botId: string, since: string, level?: EventRecord['level']): Promise<number>;
  recent(limit: number): Promise<EventRecord[]>;
}

export interface UpdateDedupeRepository {
  mark(botId: string, updateId: string): Promise<boolean>;
  purge(olderThan: string): Promise<number>;
}

export interface Storage {
  readonly driver: 'memory' | 'postgres' | 'sqlite' | 'd1';
  bots: BotRepository;
  users: UserRepository;
  settings: SettingRepository;
  sessions: SessionRepository;
  documents: DocumentRepository;
  messages: MessageRepository;
  jobs: JobRepository;
  audits: AuditRepository;
  admins: AdminRepository;
  apiKeys: ApiKeyRepository;
  events: EventRepository;
  updates: UpdateDedupeRepository;
  init(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
}

export function paginate<T>(items: T[], total: number, page = 1, pageSize = 20): Paginated<T> {
  return { items, total, page, pageSize };
}

export function normalizePage(options: PageOptions = {}): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(options.pageSize ?? 20)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
