import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),

  SECRET_MASTER_KEY: z.string().min(16).default('dev-master-key-change-me-please-32'),
  JWT_SECRET: z.string().min(16).default('dev-jwt-secret-change-me-please-32'),
  ADMIN_SEED_EMAIL: z.string().default('admin@botforge.local'),
  ADMIN_SEED_PASSWORD: z.string().default('ChangeMe#2026'),

  DATABASE_DRIVER: z.enum(['auto', 'postgres', 'sqlite', 'd1', 'memory']).default('auto'),
  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().default('.data/botforge.sqlite'),
  D1_BINDING: z.string().default('DB'),

  WEBHOOK_PATH_PREFIX: z.string().default('/webhooks'),
  MEDIA_DIR: z.string().default('.data/media'),
  MEDIA_PUBLIC_PREFIX: z.string().default('/media'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(48),
  WEBHOOK_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(240),
  BROADCAST_RATE_PER_SECOND: z.coerce.number().min(1).max(30).default(5),
  BROADCAST_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),

  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60000).default(2000),

  CLOUDFLARE_API_BASE: z.string().default('https://api.cloudflare.com/client/v4'),
  RAILWAY_API_URL: z.string().default('https://backboard.railway.app/graphql/v2'),
  DEPLOY_WORKER_BUNDLE: z.string().default('dist/cloudflare-worker/index.js'),
  DEPLOY_WORKER_PREFIX: z.string().default('botforge'),
  DEPLOY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(240_000),
  DEPLOY_POLL_INTERVAL_MS: z.coerce.number().int().min(10).max(30_000).default(4000),
  DEPLOY_REPO: z.string().default('amirsedighian071-stack/Botbuilder'),
  DEPLOY_BRANCH: z.string().default('main'),

  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_MAX_TOKENS: z.coerce.number().int().min(64).max(8192).default(900),

  WEATHER_API_KEY: z.string().optional(),
  GOLD_API_KEY: z.string().optional(),
  NEWS_API_KEY: z.string().optional(),
  EXCHANGE_API_KEY: z.string().optional(),
  SPEECH_API_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().default('*'),
  TRUST_PROXY: z.coerce.boolean().default(true),
  SSRF_PROTECTION: z.coerce.boolean().default(true),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProduction: boolean;
  database: {
    driver: 'postgres' | 'sqlite' | 'd1' | 'memory';
    url?: string;
    sqlitePath: string;
    d1Binding: string;
  };
};

function resolveDriver(raw: string, url?: string): AppConfig['database']['driver'] {
  if (raw === 'auto') {
    if (url && /^postgres(ql)?:\/\//i.test(url)) return 'postgres';
    return 'sqlite';
  }
  return raw as AppConfig['database']['driver'];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const data = parsed.data;
  return {
    ...data,
    corsOrigins: data.CORS_ORIGINS === '*' ? ['*'] : data.CORS_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean),
    isProduction: data.NODE_ENV === 'production',
    database: {
      driver: resolveDriver(data.DATABASE_DRIVER, data.DATABASE_URL),
      url: data.DATABASE_URL,
      sqlitePath: data.SQLITE_PATH,
      d1Binding: data.D1_BINDING,
    },
  };
}

export function redactedConfig(config: AppConfig): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...config };
  for (const key of ['SECRET_MASTER_KEY', 'JWT_SECRET', 'ADMIN_SEED_PASSWORD', 'AI_API_KEY', 'DATABASE_URL']) {
    if (clone[key]) clone[key] = '[redacted]';
  }
  return clone;
}
