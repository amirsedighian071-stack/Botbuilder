import {
  createD1Client,
  createLogger,
  createSqlStorage,
  HttpClient,
  isAppError,
  loadConfig,
  SecretsManager,
  toErrorMessage,
  type AppConfig,
  type D1Database,
  type Storage,
} from '@botforge/core';
import { BotManager, JobQueue } from '@botforge/engine';
import { botCatalog, templateCategories, botTemplates, verifyMediaToken } from '@botforge/bot-templates';

export interface Env {
  DB: D1Database;
  SECRET_MASTER_KEY: string;
  JWT_SECRET: string;
  PUBLIC_BASE_URL: string;
  WEBHOOK_PATH_PREFIX?: string;
  LOG_LEVEL?: string;
  MEDIA_DIR?: string;
  MEDIA_PUBLIC_PREFIX?: string;
  MAX_UPLOAD_MB?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  SPEECH_API_KEY?: string;
  WEATHER_API_KEY?: string;
  NEWS_API_KEY?: string;
  GOLD_API_KEY?: string;
  EXCHANGE_API_KEY?: string;
  CORS_ORIGINS?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface RuntimeBundle {
  config: AppConfig;
  storage: Storage;
  manager: BotManager;
  queue: JobQueue;
}

const bundleCache = new Map<string, Promise<RuntimeBundle>>();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Bot-Api-Secret-Token, Authorization',
  'Access-Control-Max-Age': '600',
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function configFor(env: Env): AppConfig {
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
    SECRET_MASTER_KEY: env.SECRET_MASTER_KEY,
    JWT_SECRET: env.JWT_SECRET,
    DATABASE_DRIVER: 'd1',
    WEBHOOK_PATH_PREFIX: env.WEBHOOK_PATH_PREFIX ?? '/webhooks',
    LOG_LEVEL: (env.LOG_LEVEL as AppConfig['LOG_LEVEL']) ?? 'info',
    MEDIA_DIR: env.MEDIA_DIR ?? '/tmp/media',
    MEDIA_PUBLIC_PREFIX: env.MEDIA_PUBLIC_PREFIX ?? '/media',
    MAX_UPLOAD_MB: env.MAX_UPLOAD_MB ?? '20',
    AI_API_KEY: env.AI_API_KEY,
    AI_BASE_URL: env.AI_BASE_URL,
    AI_MODEL: env.AI_MODEL,
    SPEECH_API_KEY: env.SPEECH_API_KEY,
    WEATHER_API_KEY: env.WEATHER_API_KEY,
    NEWS_API_KEY: env.NEWS_API_KEY,
    GOLD_API_KEY: env.GOLD_API_KEY,
    EXCHANGE_API_KEY: env.EXCHANGE_API_KEY,
    CORS_ORIGINS: env.CORS_ORIGINS ?? '*',
  });
  return { ...config, database: { ...config.database, driver: 'd1' } };
}

async function buildBundle(env: Env): Promise<RuntimeBundle> {
  const config = configFor(env);
  const logger = createLogger({ level: config.LOG_LEVEL });
  const storage = await createSqlStorage(createD1Client(env.DB));
  await storage.init();
  const secrets = new SecretsManager({ masterKey: config.SECRET_MASTER_KEY });
  const http = new HttpClient({ logger, timeoutMs: 12_000, retries: 1, ssrfProtection: true });
  const templates = new Map(botTemplates.map((template) => [template.id, template]));
  const queue = new JobQueue({ storage, logger, handlers: {}, concurrency: 2 });
  const manager = new BotManager({ storage, config, logger, http, secrets, queue, templates });
  return { config, storage, manager, queue };
}

function getBundle(env: Env): Promise<RuntimeBundle> {
  const cacheKey = `${env.DB ? 'd1' : 'none'}:${env.PUBLIC_BASE_URL}`;
  const cached = bundleCache.get(cacheKey);
  if (cached) return cached;
  const created = buildBundle(env);
  bundleCache.set(cacheKey, created);
  return created;
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  const text = await request.text();
  if (text.length === 0 || text.length > 2 * 1024 * 1024) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handleWebhook(request: Request, env: Env, segments: string[]): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const [, , platform, botId, secret] = segments;
  if (!platform || !botId || !secret) return json({ ok: false, error: 'not_found' }, 404);
  if (!['telegram', 'bale', 'rubika'].includes(platform)) return json({ ok: false, error: 'not_found' }, 404);

  const bundle = await getBundle(env);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'invalid_body' }, 400);

  const headers: Record<string, string | undefined> = {
    'x-telegram-bot-api-secret-token': request.headers.get('x-telegram-bot-api-secret-token') ?? undefined,
    'content-type': request.headers.get('content-type') ?? undefined,
  };

  try {
    const result = await bundle.manager.handleWebhook({
      botId,
      pathSecret: secret,
      headers,
      body,
      remoteIp: request.headers.get('cf-connecting-ip') ?? 'unknown',
    });
    return json({ ok: true, accepted: result.accepted, reason: result.reason ?? null });
  } catch (error) {
    if (isAppError(error) && error.code === 'UNAUTHORIZED') {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    return json({ ok: true, accepted: false, error: 'processing_failed' }, 200);
  }
}

async function handleMedia(request: Request, env: Env, segments: string[]): Promise<Response> {
  const bundle = await getBundle(env);
  const url = new URL(request.url);
  const file = segments[2] ?? '';
  const token = url.searchParams.get('token') ?? '';
  if (!file || !token) return json({ error: { code: 'BAD_REQUEST', message: 'فایل یا توکن نامعتبر است' } }, 400);
  if (!verifyMediaToken(file, token, bundle.config.SECRET_MASTER_KEY)) {
    return json({ error: { code: 'FORBIDDEN', message: 'توکن فایل منقضی شده است' } }, 403);
  }
  return json(
    {
      error: {
        code: 'NOT_CONFIGURED',
        message:
          'ذخیره‌سازی فایل سمت ورکر فعال نیست؛ ربات‌های رسانه‌ای را روی Railway یا سرور Node.js اجرا کنید تا مسیر /media در دسترس باشد.',
      },
    },
    501,
  );
}

async function router(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/health') {
    const bundle = await getBundle(env);
    const ok = await bundle.storage.ping();
    return json({
      status: ok ? 'ok' : 'degraded',
      runtime: 'cloudflare-worker',
      storage: { driver: 'd1', ok },
      templates: botCatalog.length,
      version: '1.0.0',
    });
  }

  if (url.pathname === '/api/catalog') {
    return json({ categories: templateCategories, bots: botCatalog, total: botCatalog.length });
  }

  if (url.pathname === '/api/templates') {
    return json({ items: botCatalog.map(({ id, name, category, summary, icon, tags, version }) => ({ id, name, category, summary, icon, tags, version })) });
  }

  if (segments[0] === 'webhooks') return handleWebhook(request, env, segments);
  if (segments[0] === 'media') return handleMedia(request, env, segments);

  if (url.pathname === '/') {
    return json({
      name: 'BotForge Cloudflare Worker',
      capabilities: ['webhooks', 'catalog', 'health', 'queue-cron'],
      templates: botCatalog.length,
    });
  }

  return json({ error: { code: 'NOT_FOUND', message: 'مسیر یافت نشد' } }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    try {
      const response = await router(request, env);
      return response;
    } catch (error) {
      const message = toErrorMessage(error);
      return json(
        {
          error: {
            code: isAppError(error) ? error.code : 'INTERNAL',
            message: isAppError(error) && error.expose ? message : 'خطای داخلی ورکر',
          },
        },
        isAppError(error) ? error.status : 500,
      );
    } finally {
      void ctx;
    }
  },

  async scheduled(_event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike): Promise<void> {
    const bundle = await getBundle(env);
    ctx.waitUntil(bundle.queue.runOnce());
  },
};

interface ScheduledEventLike {
  scheduledTime: number;
  cron: string;
}
