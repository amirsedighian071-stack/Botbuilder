import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StatementSync } from 'node:sqlite';
import type { SqlClient } from './sql-client';

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

async function loadSqlite(): Promise<SqliteModule> {
  const moduleName = 'node:sqlite';
  const sqlite = (await import(moduleName)) as unknown as SqliteModule;
  return sqlite;
}

export interface SqliteClientOptions {
  path: string;
}

export async function createSqliteClient(options: SqliteClientOptions): Promise<SqlClient> {
  const { DatabaseSync } = await loadSqlite();
  if (options.path !== ':memory:') {
    mkdirSync(dirname(options.path), { recursive: true });
  }
  const db = new DatabaseSync(options.path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const normalizeParams = (params: unknown[]): Array<string | number | null | Uint8Array> =>
    params.map((param) => {
      if (param === undefined) return null;
      if (typeof param === 'boolean') return param ? 1 : 0;
      if (param === null) return null;
      if (typeof param === 'number' || typeof param === 'string') return param;
      if (param instanceof Uint8Array) return param;
      return JSON.stringify(param);
    });

  const client: SqlClient = {
    dialect: 'sqlite',
    async query<T>(sql: string, params: unknown[] = []) {
      const statement = db.prepare(sql);
      const normalized = normalizeParams(params);
      const trimmed = sql.trimStart().slice(0, 6).toUpperCase();
      if (trimmed === 'SELECT' || /RETURNING/i.test(sql)) {
        return statement.all(...normalized) as T[];
      }
      statement.run(...normalized);
      return [] as T[];
    },
    async exec(sql: string) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
    async ping() {
      try {
        db.prepare('SELECT 1 AS ok').get();
        return true;
      } catch {
        return false;
      }
    },
  };

  return client;
}
