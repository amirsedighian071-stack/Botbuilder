export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    template_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    token_cipher TEXT NOT NULL,
    token_hint TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    config TEXT NOT NULL,
    force_membership TEXT NOT NULL,
    webhook_secret TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bot_users (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    username TEXT,
    first_name TEXT,
    language TEXT NOT NULL,
    role TEXT NOT NULL,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    UNIQUE (bot_id, platform_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    bot_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bot_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    PRIMARY KEY (bot_id, user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (bot_id, collection, key)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    direction TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    run_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    meta TEXT NOT NULL,
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE,
    hash TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    type TEXT NOT NULL,
    level TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS processed_updates (
    bot_id TEXT NOT NULL,
    update_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (bot_id, update_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bot_users_bot ON bot_users (bot_id, last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_lookup ON documents (bot_id, collection, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_bot_time ON messages (bot_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs (status, run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_bot_time ON events (bot_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audits_time ON audits (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at)`,
];

export interface ColumnSpec {
  name: string;
  type: string;
  notNull?: boolean;
  primaryKey?: boolean;
  default?: string;
  unique?: boolean;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  unique?: string[][];
  indexes?: Array<{ name: string; columns: string[] }>;
}

export const TABLES: TableSpec[] = [
  {
    name: 'bots',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'slug', type: 'text', notNull: true, unique: true },
      { name: 'template_id', type: 'text', notNull: true },
      { name: 'name', type: 'text', notNull: true },
      { name: 'platform', type: 'text', notNull: true },
      { name: 'status', type: 'text', notNull: true },
      { name: 'token_cipher', type: 'text', notNull: true },
      { name: 'token_hint', type: 'text', notNull: true },
      { name: 'owner_id', type: 'text', notNull: true },
      { name: 'config', type: 'text', notNull: true },
      { name: 'force_membership', type: 'text', notNull: true },
      { name: 'webhook_secret', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
      { name: 'updated_at', type: 'text', notNull: true },
    ],
  },
  {
    name: 'bot_users',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'platform', type: 'text', notNull: true },
      { name: 'platform_user_id', type: 'text', notNull: true },
      { name: 'chat_id', type: 'text', notNull: true },
      { name: 'username', type: 'text' },
      { name: 'first_name', type: 'text' },
      { name: 'language', type: 'text', notNull: true },
      { name: 'role', type: 'text', notNull: true },
      { name: 'is_blocked', type: 'integer', notNull: true, default: '0' },
      { name: 'notes', type: 'text', notNull: true, default: "''" },
      { name: 'first_seen_at', type: 'text', notNull: true },
      { name: 'last_seen_at', type: 'text', notNull: true },
      { name: 'message_count', type: 'integer', notNull: true, default: '0' },
      { name: 'metadata', type: 'text', notNull: true, default: "'{}'" },
    ],
    unique: [['bot_id', 'platform_user_id']],
    indexes: [{ name: 'idx_bot_users_bot', columns: ['bot_id', 'last_seen_at'] }],
  },
  {
    name: 'settings',
    columns: [
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'key', type: 'text', notNull: true },
      { name: 'value', type: 'text', notNull: true },
      { name: 'updated_at', type: 'text', notNull: true },
    ],
    unique: [['bot_id', 'key']],
  },
  {
    name: 'sessions',
    columns: [
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'user_id', type: 'text', notNull: true },
      { name: 'key', type: 'text', notNull: true },
      { name: 'value', type: 'text', notNull: true },
      { name: 'updated_at', type: 'text', notNull: true },
      { name: 'expires_at', type: 'text' },
    ],
    unique: [['bot_id', 'user_id', 'key']],
    indexes: [{ name: 'idx_sessions_expiry', columns: ['expires_at'] }],
  },
  {
    name: 'documents',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'collection', type: 'text', notNull: true },
      { name: 'key', type: 'text', notNull: true },
      { name: 'data', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
      { name: 'updated_at', type: 'text', notNull: true },
    ],
    unique: [['bot_id', 'collection', 'key']],
    indexes: [{ name: 'idx_documents_lookup', columns: ['bot_id', 'collection', 'created_at'] }],
  },
  {
    name: 'messages',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'platform', type: 'text', notNull: true },
      { name: 'direction', type: 'text', notNull: true },
      { name: 'chat_id', type: 'text', notNull: true },
      { name: 'user_id', type: 'text', notNull: true },
      { name: 'text', type: 'text', notNull: true },
      { name: 'status', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
    ],
    indexes: [{ name: 'idx_messages_bot_time', columns: ['bot_id', 'created_at'] }],
  },
  {
    name: 'jobs',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'type', type: 'text', notNull: true },
      { name: 'payload', type: 'text', notNull: true },
      { name: 'status', type: 'text', notNull: true },
      { name: 'attempts', type: 'integer', notNull: true, default: '0' },
      { name: 'max_attempts', type: 'integer', notNull: true, default: '5' },
      { name: 'run_at', type: 'text', notNull: true },
      { name: 'last_error', type: 'text' },
      { name: 'created_at', type: 'text', notNull: true },
      { name: 'updated_at', type: 'text', notNull: true },
    ],
    indexes: [{ name: 'idx_jobs_status_run', columns: ['status', 'run_at'] }],
  },
  {
    name: 'audits',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'actor_id', type: 'text', notNull: true },
      { name: 'actor_type', type: 'text', notNull: true },
      { name: 'action', type: 'text', notNull: true },
      { name: 'target', type: 'text', notNull: true },
      { name: 'meta', type: 'text', notNull: true },
      { name: 'ip', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
    ],
    indexes: [{ name: 'idx_audits_time', columns: ['created_at'] }],
  },
  {
    name: 'admins',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'email', type: 'text', notNull: true, unique: true },
      { name: 'password_hash', type: 'text', notNull: true },
      { name: 'role', type: 'text', notNull: true },
      { name: 'is_active', type: 'integer', notNull: true, default: '1' },
      { name: 'created_at', type: 'text', notNull: true },
      { name: 'last_login_at', type: 'text' },
    ],
  },
  {
    name: 'api_keys',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'name', type: 'text', notNull: true },
      { name: 'prefix', type: 'text', notNull: true, unique: true },
      { name: 'hash', type: 'text', notNull: true },
      { name: 'scopes', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
      { name: 'last_used_at', type: 'text' },
      { name: 'revoked_at', type: 'text' },
    ],
  },
  {
    name: 'events',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'type', type: 'text', notNull: true },
      { name: 'level', type: 'text', notNull: true },
      { name: 'payload', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
    ],
    indexes: [{ name: 'idx_events_bot_time', columns: ['bot_id', 'created_at'] }],
  },
  {
    name: 'processed_updates',
    columns: [
      { name: 'bot_id', type: 'text', notNull: true },
      { name: 'update_id', type: 'text', notNull: true },
      { name: 'created_at', type: 'text', notNull: true },
    ],
    unique: [['bot_id', 'update_id']],
  },
];
