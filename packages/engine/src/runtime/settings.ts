import type { SecretsManager, Storage } from '@botforge/core';
import { TtlCache } from '../util/cache';

const SENSITIVE_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|WEBHOOK)$/i;
const ENCRYPTED_PREFIX = 'enc:v1:';

export interface BotSettingsOptions {
  storage: Storage;
  botId: string;
  secrets: SecretsManager;
  baseConfig: Record<string, unknown>;
  defaults: Record<string, unknown>;
}

/**
 * Layered settings store for a single bot.
 *
 * Resolution order: database row -> bot creation config -> template defaults -> caller fallback.
 * Values whose key looks sensitive are encrypted at rest with AES-256-GCM before they are written.
 */
export class BotSettingsStore {
  private readonly cache = new TtlCache<unknown>(30_000, 500);
  private readonly storage: Storage;
  private readonly botId: string;
  private readonly secrets: SecretsManager;
  private readonly baseConfig: Record<string, unknown>;
  private readonly defaults: Record<string, unknown>;

  constructor(options: BotSettingsOptions) {
    this.storage = options.storage;
    this.botId = options.botId;
    this.secrets = options.secrets;
    this.baseConfig = options.baseConfig ?? {};
    this.defaults = options.defaults ?? {};
  }

  private isSensitive(key: string): boolean {
    return SENSITIVE_PATTERN.test(key);
  }

  private decryptValue(key: string, raw: unknown): unknown {
    if (typeof raw !== 'string') return raw;
    if (!raw.startsWith(ENCRYPTED_PREFIX)) return raw;
    try {
      return this.secrets.open(raw.slice(ENCRYPTED_PREFIX.length));
    } catch {
      return '';
    }
  }

  private encryptValue(key: string, value: unknown): unknown {
    if (!this.isSensitive(key)) return value;
    if (typeof value !== 'string' || value.length === 0) return value;
    if (value.startsWith(ENCRYPTED_PREFIX)) return value;
    return `${ENCRYPTED_PREFIX}${this.secrets.seal(value).cipher}`;
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const cacheKey = `get:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as T;

    let value: unknown;
    try {
      value = await this.storage.settings.get<unknown>(this.botId, key);
    } catch {
      value = null;
    }
    if (value === null || value === undefined) {
      value = this.baseConfig[key];
    }
    if (value === null || value === undefined) {
      value = this.defaults[key];
    }
    const resolved = value === null || value === undefined ? fallback : this.decryptValue(key, value);
    this.cache.set(cacheKey, resolved, 30_000);
    return (resolved ?? fallback) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    const stored = this.encryptValue(key, value);
    await this.storage.settings.set(this.botId, key, stored);
    this.cache.set(`get:${key}`, value, 30_000);
  }

  async delete(key: string): Promise<void> {
    await this.storage.settings.delete(this.botId, key);
    this.cache.set(`get:${key}`, undefined, 1);
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.storage.settings.list(this.botId);
    const out: Record<string, unknown> = { ...this.defaults, ...this.baseConfig };
    for (const row of rows) {
      out[row.key] = this.decryptValue(row.key, row.value);
    }
    return out;
  }

  async masked(): Promise<Array<{ key: string; value: string; sensitive: boolean; source: 'database' | 'config' | 'default' }>> {
    const rows = await this.storage.settings.list(this.botId);
    const dbKeys = new Set(rows.map((row) => row.key));
    const out: Array<{ key: string; value: string; sensitive: boolean; source: 'database' | 'config' | 'default' }> = [];
    for (const row of rows) {
      const decrypted = this.decryptValue(row.key, row.value);
      const sensitive = this.isSensitive(row.key);
      out.push({
        key: row.key,
        value: sensitive ? maskSecret(String(decrypted ?? '')) : String(decrypted ?? '').slice(0, 120),
        sensitive,
        source: 'database',
      });
    }
    for (const [key, value] of Object.entries(this.defaults)) {
      if (dbKeys.has(key)) continue;
      const configured = this.baseConfig[key] ?? value;
      if (configured === undefined || configured === null || configured === '') continue;
      const sensitive = this.isSensitive(key);
      out.push({
        key,
        value: sensitive ? maskSecret(String(configured)) : String(configured).slice(0, 120),
        sensitive,
        source: this.baseConfig[key] !== undefined ? 'config' : 'default',
      });
    }
    return out;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERN.test(key);
}
