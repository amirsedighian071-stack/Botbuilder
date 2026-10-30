import type { AppConfig, HttpClient, Logger } from '@botforge/core';

export interface ServiceDeps {
  http: HttpClient;
  config: AppConfig;
  logger: Logger;
  getSetting<T>(key: string, fallback: T): Promise<T>;
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}
