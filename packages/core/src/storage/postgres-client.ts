import pg from 'pg';
import { toPgPlaceholders, type SqlClient } from './sql-client';

const { Pool } = pg;

export interface PostgresClientOptions {
  connectionString: string;
  maxConnections?: number;
  ssl?: boolean;
  applicationName?: string;
}

export async function createPostgresClient(options: PostgresClientOptions): Promise<SqlClient> {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: options.applicationName ?? 'botforge-control-plane',
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
  });

  pool.on('error', () => {
    /* handled per-query; prevents unhandled pool errors from crashing the process */
  });

  const client: SqlClient = {
    dialect: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPgPlaceholders(sql), params as unknown[]);
      return result.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
  };

  return client;
}
