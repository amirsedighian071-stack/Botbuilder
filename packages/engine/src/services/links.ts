import { AppError, upstreamError } from '@botforge/core';
import type { ServiceDeps } from './deps';

const RESERVED = new Set(['api', 'admin', 'www', 'static', 'assets', 'webhooks']);

export class LinkService {
  constructor(private readonly deps: ServiceDeps) {}

  async shorten(rawUrl: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new AppError('BAD_REQUEST', 'لینک وارد شده معتبر نیست');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new AppError('BAD_REQUEST', 'فقط لینک‌های http و https پشتیبانی می‌شوند');
    }
    if (RESERVED.has(parsed.hostname)) {
      throw new AppError('BAD_REQUEST', 'این دامنه قابل کوتاه‌سازی نیست');
    }
    const targets = [
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(parsed.toString())}`,
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(parsed.toString())}`,
    ];
    for (const target of targets) {
      try {
        const response = await this.deps.http.get<string>(target, { timeoutMs: 10_000, retries: 1 });
        const link = response.text.trim();
        if (/^https?:\/\/\S+$/.test(link)) return link;
      } catch (error) {
        this.deps.logger.debug('shortener failed', { target, error: (error as Error).message });
      }
    }
    throw upstreamError('سرویس کوتاه‌کننده لینک در دسترس نیست');
  }

  async expand(rawUrl: string): Promise<string> {
    let current = rawUrl.trim();
    try {
      const parsed = new URL(current);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
    } catch {
      throw new AppError('BAD_REQUEST', 'لینک وارد شده معتبر نیست');
    }
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await this.deps.http.get<string>(current, {
        timeoutMs: 12_000,
        retries: 0,
        followRedirects: false,
        headers: { accept: 'text/html,*/*' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return current;
    }
    return current;
  }
}
