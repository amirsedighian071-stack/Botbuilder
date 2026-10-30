import {
  AppError,
  badRequest,
  createLogger,
  createWebhookSecret,
  notFound,
  randomId,
  safeEqual,
  webhookPathSecret,
  type AppConfig,
  type BotDefinition,
  type BotRecord,
  type BotStatus,
  type HttpClient,
  type Logger,
  type MessengerApi,
  type PlatformName,
  type SecretsManager,
  type StoredSecret,
  type Storage,
} from '@botforge/core';
import { createAdapter, detectPlatformFromToken, type AdapterConfig } from '@botforge/platform-adapters';
import type { JobQueue } from './queue/worker';
import { BotRuntime } from './runtime/bot-runtime';

export interface BotManagerOptions {
  storage: Storage;
  config: AppConfig;
  logger: Logger;
  http: HttpClient;
  secrets: SecretsManager;
  queue: JobQueue;
  templates: Map<string, BotDefinition>;
  /** Overrides adapter construction (used by tests and by embedded runtimes). */
  adapterFactory?: (config: AdapterConfig & { platform: PlatformName }) => MessengerApi;
}

export interface CreateBotInput {
  templateId: string;
  name: string;
  slug: string;
  platform: PlatformName;
  token: string;
  ownerId?: string;
  config?: Record<string, unknown>;
  status?: BotStatus;
  skipVerification?: boolean;
}

export interface WebhookDelivery {
  botId: string;
  pathSecret: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  remoteIp: string;
}

const DEFAULT_FORCE_MEMBERSHIP = {
  enabled: false,
  channels: [],
  message: 'برای استفاده از ربات ابتدا در کانال‌های زیر عضو شوید.',
  buttonLabel: 'عضویت در کانال',
  recheckLabel: 'بررسی مجدد',
  bypassAdmins: true,
  cacheSeconds: 300,
};

export class BotManager {
  private readonly runtimes = new Map<string, BotRuntime>();
  private readonly adapters = new Map<string, MessengerApi>();

  constructor(private readonly options: BotManagerOptions) {
    this.options.queue.register('bot.job', async (payload, context) => {
      const botId = context.job.botId;
      const runtime = await this.getRuntime(botId);
      const jobType = String(payload.jobType ?? '');
      const jobPayload = (payload.payload ?? {}) as Record<string, unknown>;
      await runtime.executeJob(jobType, jobPayload);
    });
    this.options.queue.register('message.send', async (payload) => {
      const botId = String(payload.botId ?? '');
      const chatId = String(payload.chatId ?? '');
      const text = String(payload.text ?? '');
      if (!botId || !chatId || !text) return;
      const runtime = await this.getRuntime(botId);
      await runtime.send(chatId, { text, parseMode: 'HTML', disablePreview: true });
    });
    this.options.queue.register('broadcast.batch', async (payload) => {
      const botId = String(payload.botId ?? '');
      if (!botId) return;
      const runtime = await this.getRuntime(botId);
      await runtime.broadcast.processBatch(payload as never);
    });
  }

  async loadActive(): Promise<BotRuntime[]> {
    const bots = await this.options.storage.bots.listActive();
    const runtimes: BotRuntime[] = [];
    for (const bot of bots) {
      try {
        runtimes.push(await this.getRuntime(bot.id));
      } catch (error) {
        this.options.logger.error('failed to load bot runtime', {
          botId: bot.id,
          error: (error as Error).message,
        });
      }
    }
    this.options.logger.info('bot runtimes loaded', { count: runtimes.length });
    return runtimes;
  }

  async getRuntime(botId: string): Promise<BotRuntime> {
    const existing = this.runtimes.get(botId);
    if (existing) return existing;
    const bot = await this.options.storage.bots.findById(botId);
    if (!bot) throw notFound('ربات پیدا نشد');
    const template = this.options.templates.get(bot.templateId);
    if (!template) throw notFound('قالب ربات پیدا نشد');
    const runtime = await this.buildRuntime(bot, template);
    this.runtimes.set(botId, runtime);
    return runtime;
  }

  private async buildRuntime(bot: BotRecord, template: BotDefinition): Promise<BotRuntime> {
    const token = this.options.secrets.open(bot.tokenCipher);
    const adapterConfig: AdapterConfig & { platform: PlatformName } = {
      platform: bot.platform,
      token,
      botId: bot.id,
      logger: this.options.logger.child({ botId: bot.id, platform: bot.platform }),
    };
    const adapter = this.options.adapterFactory
      ? this.options.adapterFactory(adapterConfig)
      : createAdapter(adapterConfig);
    this.adapters.set(bot.id, adapter);
    const runtime = new BotRuntime({
      bot,
      template,
      api: adapter,
      storage: this.options.storage,
      config: this.options.config,
      logger: this.options.logger.child({ botId: bot.id, template: template.id }),
      http: this.options.http,
      secrets: this.options.secrets,
      queue: this.options.queue,
    });
    await runtime.init();
    return runtime;
  }

  async verifyToken(platform: PlatformName, token: string): Promise<{ id: string; username: string; firstName: string }> {
    const detected = detectPlatformFromToken(token);
    if (detected && detected !== platform) {
      throw badRequest(`توکن وارد شده مربوط به ${detected} است، نه ${platform}`);
    }
    const verifyConfig: AdapterConfig & { platform: PlatformName } = {
      platform,
      token,
      botId: 'verify',
      logger: this.options.logger.child({ scope: 'token-verification', platform }),
    };
    const adapter = this.options.adapterFactory ? this.options.adapterFactory(verifyConfig) : createAdapter(verifyConfig);
    try {
      const identity = await adapter.getMe();
      if (!identity.id || identity.id === 'verify') {
        throw new AppError('UNAUTHORIZED', 'توکن ربات توسط پلتفرم تأیید نشد');
      }
      return identity;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UNAUTHORIZED', `تأیید توکن ربات ناموفق بود: ${(error as Error).message}`);
    }
  }

  async createBot(input: CreateBotInput): Promise<BotRecord> {
    const template = this.options.templates.get(input.templateId);
    if (!template) throw notFound('قالب ربات پیدا نشد');

    const existing = await this.options.storage.bots.findBySlug(input.slug);
    if (existing) throw new AppError('CONFLICT', 'این شناسه ربات قبلاً استفاده شده است');

    if (!input.skipVerification) {
      await this.verifyToken(input.platform, input.token);
    }

    const sealed = this.options.secrets.seal(input.token);
    const now = new Date().toISOString();
    const record: BotRecord = {
      id: randomId('bot_'),
      slug: input.slug,
      templateId: input.templateId,
      name: input.name,
      platform: input.platform,
      status: input.status ?? 'active',
      tokenCipher: sealed.cipher,
      tokenHint: sealed.hint,
      ownerId: input.ownerId ?? 'system',
      config: { ...template.defaultConfig, ...(input.config ?? {}) },
      forceMembership: { ...DEFAULT_FORCE_MEMBERSHIP },
      webhookSecret: createWebhookSecret(),
      createdAt: now,
      updatedAt: now,
    };

    await this.options.storage.bots.create(record);
    const runtime = await this.getRuntime(record.id);
    await runtime.init();

    const webhookRegistered = await this.registerWebhook(record);
    await this.options.storage.events.log({
      botId: record.id,
      type: 'bot.created',
      level: 'info',
      payload: { template: record.templateId, platform: record.platform, webhookRegistered },
    });
    this.options.logger.info('bot created', { botId: record.id, template: record.templateId, webhookRegistered });
    return record;
  }

  templateFor(templateId: string): BotDefinition | undefined {
    return this.options.templates.get(templateId);
  }

  sealSecret(value: string): StoredSecret {
    return this.options.secrets.seal(value);
  }

  openToken(bot: BotRecord): string {
    return this.options.secrets.open(bot.tokenCipher);
  }

  webhookUrl(bot: BotRecord): string {
    const base = this.options.config.PUBLIC_BASE_URL.replace(/\/+$/, '');
    const prefix = this.options.config.WEBHOOK_PATH_PREFIX.replace(/\/+$/, '');
    return `${base}${prefix}/${bot.platform}/${bot.id}/${webhookPathSecret(bot.webhookSecret)}`;
  }

  async registerWebhook(bot: BotRecord): Promise<boolean> {
    try {
      const adapter = await this.getAdapter(bot.id);
      const url = this.webhookUrl(bot);
      const ok = await adapter.setWebhook(url, bot.webhookSecret);
      if (!ok) {
        await this.options.storage.events.log({
          botId: bot.id,
          type: 'webhook.register_failed',
          level: 'warn',
          payload: { url },
        });
      }
      return ok;
    } catch (error) {
      this.options.logger.warn('webhook registration failed', { botId: bot.id, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Points the platform webhook at an externally deployed URL (Cloudflare Worker or Railway),
   * instead of the control plane's own PUBLIC_BASE_URL.
   */
  async registerWebhookAt(botId: string, url: string, secret: string): Promise<boolean> {
    try {
      const adapter = await this.getAdapter(botId);
      const ok = await adapter.setWebhook(url, secret);
      if (!ok) {
        await this.options.storage.events.log({
          botId,
          type: 'webhook.register_failed',
          level: 'warn',
          payload: { url, scope: 'external' },
        });
      }
      return ok;
    } catch (error) {
      this.options.logger.warn('external webhook registration failed', {
        botId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async deleteWebhook(bot: BotRecord): Promise<boolean> {
    try {
      const adapter = await this.getAdapter(bot.id);
      return await adapter.deleteWebhook();
    } catch {
      return false;
    }
  }

  private async getAdapter(botId: string): Promise<MessengerApi> {
    const cached = this.adapters.get(botId);
    if (cached) return cached;
    await this.getRuntime(botId);
    const adapter = this.adapters.get(botId);
    if (!adapter) throw notFound('آداپتور ربات در دسترس نیست');
    return adapter;
  }

  async handleWebhook(delivery: WebhookDelivery): Promise<{ accepted: boolean; reason?: string }> {
    const bot = await this.options.storage.bots.findById(delivery.botId);
    if (!bot) throw notFound('ربات پیدا نشد');

    const expectedPathSecret = webhookPathSecret(bot.webhookSecret);
    if (!safeEqual(expectedPathSecret, delivery.pathSecret)) {
      this.options.logger.warn('webhook secret mismatch', { botId: bot.id, ip: delivery.remoteIp });
      throw new AppError('UNAUTHORIZED', 'امضای وب‌هوک نامعتبر است');
    }

    if (bot.platform === 'telegram') {
      const header = delivery.headers['x-telegram-bot-api-secret-token'];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!provided || !safeEqual(provided, bot.webhookSecret)) {
        throw new AppError('UNAUTHORIZED', 'هدر امنیتی وب‌هوک تلگرام نامعتبر است');
      }
    }

    if (bot.status === 'disabled') return { accepted: false, reason: 'bot_disabled' };

    const runtime = await this.getRuntime(bot.id);
    await runtime.handleUpdate(delivery.body);
    return { accepted: true };
  }

  async stopBot(botId: string): Promise<void> {
    this.runtimes.delete(botId);
    this.adapters.delete(botId);
  }

  async deleteBot(botId: string): Promise<boolean> {
    const bot = await this.options.storage.bots.findById(botId);
    if (!bot) return false;
    await this.deleteWebhook(bot);
    await this.stopBot(botId);
    return this.options.storage.bots.delete(botId);
  }

  get loadedCount(): number {
    return this.runtimes.size;
  }

  async reload(botId: string): Promise<BotRuntime> {
    await this.stopBot(botId);
    return this.getRuntime(botId);
  }
}

export function createBotManager(options: BotManagerOptions): BotManager {
  return new BotManager({ ...options, logger: options.logger ?? createLogger({ level: 'info' }) });
}
