import { upstreamError } from '../errors';
import type { Logger } from '../logger';
import { assertSafeUrl } from '../security/ssrf';

export interface HttpClientOptions {
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  maxResponseBytes?: number;
  ssrfProtection?: boolean;
  allowPrivateHosts?: boolean;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  body?: string | URLSearchParams | Uint8Array | FormData;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  skipSsrfCheck?: boolean;
  followRedirects?: boolean;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  body: T;
  text: string;
}

export class HttpClient {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly userAgent: string;
  private readonly maxResponseBytes: number;
  private readonly ssrfProtection: boolean;
  private readonly allowPrivateHosts: boolean;
  private readonly logger?: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ?? 'BotForge/1.0 (+https://github.com/amirsedighian071-stack/Botbuilder)';
    this.maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    this.ssrfProtection = options.ssrfProtection ?? true;
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T = unknown>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  async post<T = unknown>(url: string, body?: unknown, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const payload = body instanceof URLSearchParams || typeof body === 'string' || body instanceof Uint8Array
      ? { body: body as string | URLSearchParams | Uint8Array }
      : { json: body };
    return this.request<T>(url, { ...options, method: 'POST', ...payload });
  }

  async request<T = unknown>(rawUrl: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const url = this.buildUrl(rawUrl, options.query);
    const method = options.method ?? 'GET';
    const attempts = (options.retries ?? this.retries) + 1;
    let lastError: unknown;

    if (this.ssrfProtection && !options.skipSsrfCheck) {
      await assertSafeUrl(url, { allowPrivate: this.allowPrivateHosts });
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const headers: Record<string, string> = {
          'user-agent': this.userAgent,
          accept: 'application/json, text/plain, */*',
          ...options.headers,
        };
        let body: unknown;
        if (options.json !== undefined) {
          headers['content-type'] = headers['content-type'] ?? 'application/json';
          body = JSON.stringify(options.json);
        } else if (options.body !== undefined) {
          body = options.body;
        }

        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: body as never,
          signal: controller.signal,
          redirect: options.followRedirects === false ? 'manual' : 'follow',
        });

        const text = await this.readCapped(response);
        const parsed = this.tryParse(text);
        const result: HttpResponse<T> = {
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          body: parsed as T,
          text,
        };

        if (!response.ok) {
          if (response.status >= 500 && attempt < attempts) {
            await this.backoff(attempt);
            continue;
          }
          throw upstreamError(`Upstream responded with ${response.status}`, {
            status: response.status,
            body: text.slice(0, 400),
          });
        }
        return result;
      } catch (error) {
        lastError = error;
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const retryable = isAbort || error instanceof TypeError || (error instanceof Error && /fetch failed/i.test(error.message));
        if (attempt < attempts && retryable) {
          this.logger?.warn('http retry', { url: this.sanitize(url), attempt, error: String(error) });
          await this.backoff(attempt);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw upstreamError('درخواست به سرویس بیرونی ناموفق بود', { cause: String(lastError) });
  }

  async requestBinary(
    url: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; ok: boolean; contentType: string; data: Uint8Array }> {
    if (this.ssrfProtection && !options.skipSsrfCheck) {
      await assertSafeUrl(url, { allowPrivate: this.allowPrivateHosts });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'user-agent': this.userAgent, ...options.headers };
      let body: unknown;
      if (options.json !== undefined) {
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        body = JSON.stringify(options.json);
      } else if (options.body !== undefined) {
        body = options.body;
      }
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'POST',
        headers,
        body: body as never,
        signal: controller.signal,
      });
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > this.maxResponseBytes) {
        throw upstreamError('حجم پاسخ سرویس بیرونی بیش از حد مجاز است');
      }
      return {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        data: new Uint8Array(arrayBuffer),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.get<T>(url, options);
    if (response.body === null || typeof response.body !== 'object') {
      throw upstreamError('پاسخ سرویس بیرونی JSON معتبر نبود');
    }
    return response.body;
  }

  async download(url: string, options: RequestOptions = {}): Promise<{ data: Uint8Array; contentType: string; fileName: string | null }> {
    if (this.ssrfProtection && !options.skipSsrfCheck) {
      await assertSafeUrl(url, { allowPrivate: this.allowPrivateHosts });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'user-agent': this.userAgent, ...options.headers },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw upstreamError(`دانلود فایل ناموفق بود (${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > this.maxResponseBytes) {
        throw upstreamError('حجم فایل دانلودی بیش از حد مجاز است');
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      return {
        data: new Uint8Array(arrayBuffer),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        fileName: match ? decodeURIComponent(match[1]) : null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(rawUrl: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(rawUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel();
        throw upstreamError('پاسخ سرویس بیرونی بیش از حد بزرگ است');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }

  private tryParse(text: string): unknown {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(4000, 250 * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private sanitize(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return '[invalid-url]';
    }
  }
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  return new HttpClient(options);
}
