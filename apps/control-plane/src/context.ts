import {
  createLogger,
  createStorageFromConfig,
  HttpClient,
  loadConfig,
  SecretsManager,
  toErrorMessage,
  type AppConfig,
  type BotDefinition,
  type Logger,
  type Storage,
} from '@botforge/core';
import { JobQueue, BotManager } from '@botforge/engine';
import { botTemplates } from '@botforge/bot-templates';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  storage: Storage;
  secrets: SecretsManager;
  http: HttpClient;
  queue: JobQueue;
  manager: BotManager;
  templates: Map<string, BotDefinition>;
  startedAt: number;
}

export interface CreateContextOptions {
  config?: AppConfig;
  storage?: Storage;
  logger?: Logger;
  startQueue?: boolean;
}

export function templateMap(): Map<string, BotDefinition> {
  const map = new Map<string, BotDefinition>();
  for (const template of botTemplates) {
    if (map.has(template.id)) throw new Error(`شناسه قالب تکراری است: ${template.id}`);
    map.set(template.id, template);
  }
  return map;
}

export async function createAppContext(options: CreateContextOptions = {}): Promise<AppContext> {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger({ level: config.LOG_LEVEL });
  const storage = options.storage ?? (await createStorageFromConfig({ config, logger }));
  await storage.init();

  const secrets = new SecretsManager({ masterKey: config.SECRET_MASTER_KEY });
  const http = new HttpClient({
    logger,
    timeoutMs: 15_000,
    retries: 1,
    ssrfProtection: config.SSRF_PROTECTION,
    maxResponseBytes: config.MAX_UPLOAD_MB * 1024 * 1024,
  });

  const templates = templateMap();
  const queue = new JobQueue({
    storage,
    logger: logger.child({ scope: 'queue' }),
    handlers: {},
    concurrency: config.QUEUE_CONCURRENCY,
    pollIntervalMs: config.QUEUE_POLL_INTERVAL_MS,
  });

  const manager = new BotManager({ storage, config, logger, http, secrets, queue, templates });

  if (options.startQueue !== false) {
    await manager.loadActive();
    queue.start();
  }

  await ensureSeedAdmin(storage, config, logger);

  return { config, logger, storage, secrets, http, queue, manager, templates, startedAt: Date.now() };
}

export async function ensureSeedAdmin(storage: Storage, config: AppConfig, logger: Logger): Promise<void> {
  const existing = await storage.admins.count();
  if (existing > 0) return;
  const { hashPassword } = await import('@botforge/core');
  await storage.admins.create({
    email: config.ADMIN_SEED_EMAIL,
    passwordHash: hashPassword(config.ADMIN_SEED_PASSWORD),
    role: 'superadmin',
  });
  logger.warn('seed admin created', { email: config.ADMIN_SEED_EMAIL });
}

export async function shutdownContext(context: AppContext): Promise<void> {
  await context.queue.stop();
  try {
    await context.storage.close();
  } catch (error) {
    context.logger.warn('storage close failed', { error: toErrorMessage(error) });
  }
}
