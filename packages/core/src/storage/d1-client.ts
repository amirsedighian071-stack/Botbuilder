import type { SqlClient } from './sql-client';

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number; duration?: number; last_row_id?: number };
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface D1Client extends SqlClient {
  readonly dialect: 'd1';
  readonly raw: D1Database;
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  for (const char of sql) {
    if (char === "'") inSingle = !inSingle;
    if (char === ';' && !inSingle) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }
  const last = current.trim();
  if (last.length > 0) statements.push(last);
  return statements;
}

export function createD1Client(database: D1Database): D1Client {
  return {
    dialect: 'd1',
    raw: database,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = params.length > 0 ? database.prepare(sql).bind(...params) : database.prepare(sql);
      const result = await statement.all<T>();
      if (!result.success) throw new Error(result.error ?? 'D1 query failed');
      return result.results ?? [];
    },
    async exec(sql: string): Promise<void> {
      const statements = splitStatements(sql);
      if (statements.length === 0) return;
      if (statements.length === 1) {
        const result = await database.prepare(statements[0]).run();
        if (!result.success) throw new Error(result.error ?? 'D1 statement failed');
        return;
      }
      const results = await database.batch(statements.map((statement) => database.prepare(statement)));
      const failed = results.find((result) => !result.success);
      if (failed) throw new Error(failed.error ?? 'D1 batch failed');
    },
    async close(): Promise<void> {
      return;
    },
    async ping(): Promise<boolean> {
      try {
        await database.prepare('SELECT 1 AS ok').first();
        return true;
      } catch {
        return false;
      }
    },
  };
}
