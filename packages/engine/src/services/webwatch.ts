import { AppError } from '@botforge/core';
import type { ServiceDeps } from './deps';

export interface WatchResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export class WebWatchService {
  constructor(private readonly deps: ServiceDeps) {}

  async check(rawUrl: string): Promise<WatchResult> {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new AppError('BAD_REQUEST', 'آدرس سایت معتبر نیست');
    }
    if (!/^https?:$/.test(url.protocol)) {
      throw new AppError('BAD_REQUEST', 'فقط آدرس‌های http و https پشتیبانی می‌شوند');
    }
    const startedAt = Date.now();
    try {
      const response = await this.deps.http.get<string>(url.toString(), {
        timeoutMs: 15_000,
        retries: 0,
        headers: { accept: 'text/html,application/json,*/*' },
        followRedirects: true,
      });
      const latencyMs = Date.now() - startedAt;
      const ok = response.status >= 200 && response.status < 400;
      return {
        ok,
        status: response.status,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        error: (error as Error).message.slice(0, 200),
      };
    }
  }
}
