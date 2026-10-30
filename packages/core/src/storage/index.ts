import type { AppConfig } from '../config';
import { createLogger, type Logger } from '../logger';
import { createMemoryStorage } from './memory';
import { createPostgresClient } from './postgres-client';
import { createSqliteClient } from './sqlite-client';
import { createSqlStorage } from './sql-storage';
import type { Storage } from './types';

export * from './types';
export { createMemoryStorage } from './memory';
export { createSqlStorage } from './sql-storage';
export { createPostgresClient } from './postgres-client';
export { createSqliteClient } from './sqlite-client';
export { createD1Client, type D1Client, type D1Database, type D1PreparedStatement, type D1Result } from './d1-client';
export { SCHEMA_STATEMENTS, TABLES } from './schema';
export {
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
  toPgPlaceholders,
  type SqlClient,
  type SqlDialect,
} from './sql-client';

export interface CreateStorageOptions {
  config: Pick<AppConfig, 'database'> & { NODE_ENV?: string };
  logger?: Logger;
}

export async function createStorageFromConfig(options: CreateStorageOptions): Promise<Storage> {
  const logger = options.logger ?? createLogger({ level: 'info' });
  const { database } = options.config;

  if (database.driver === 'memory') {
    logger.info('storage initialized', { driver: 'memory' });
    return createMemoryStorage();
  }

  if (database.driver === 'postgres') {
    if (!database.url) throw new Error('DATABASE_URL is required for the postgres driver');
    const client = await createPostgresClient({ connectionString: database.url });
    const storage = await createSqlStorage(client);
    logger.info('storage initialized', { driver: 'postgres' });
    return storage;
  }

  if (database.driver === 'd1') {
    throw new Error(
      'The D1 binding is only available inside a Cloudflare Worker runtime; use the worker entrypoint (apps/cloudflare-worker) for D1 deployments',
    );
  }

  const client = await createSqliteClient({ path: database.sqlitePath });
  const storage = await createSqlStorage(client);
  logger.info('storage initialized', { driver: 'sqlite', path: database.sqlitePath });
  return storage;
}
