import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  AppError,
  badRequest,
  notFound,
  randomId,
  randomToken,
  SCHEMA_STATEMENTS,
  toErrorMessage,
  webhookPathSecret,
  type AppConfig,
  type BotRecord,
  type Logger,
  type Storage,
} from '@botforge/core';
import type { BotManager } from '@botforge/engine';
import {
  createProviderGateways,
  type CloudflareCredentials,
  type DeployProvider,
  type ProviderGateways,
  type ProviderValidation,
  type RailwayCredentials,
} from './gateways';


export type DeploymentStatus =
  | 'queued'
  | 'validating'
  | 'provisioning'
  | 'uploading'
  | 'deploying'
  | 'registering'
  | 'healthy'
  | 'failed';

export type DeploymentStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface DeploymentStep {
  id: string;
  title: string;
  status: DeploymentStepStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface DeploymentLog {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface DeploymentRecord {
  id: string;
  botId: string;
  provider: DeployProvider;
  status: DeploymentStatus;
  steps: DeploymentStep[];
  logs: DeploymentLog[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  urls: { app?: string; webhook?: string; health?: string };
  environment: Record<string, string>;
  secretKeys: string[];
  credentialsCipher: string;
  accountId?: string;
  accountName?: string;
  scriptName?: string;
  databaseId?: string;
  projectId?: string;
  serviceId?: string;
  environmentId?: string;
  health?: { ok: boolean; checkedAt: string; status?: number; latencyMs?: number; error?: string };
  durationMs?: number;
}

export interface StartDeploymentInput {
  botId: string;
  provider: DeployProvider;
  credentials: CloudflareCredentials | RailwayCredentials;
  integrationKeys?: Record<string, string>;
  corsOrigins?: string;
  databaseUrl?: string;
  workerName?: string;
}

export interface DeploymentServiceOptions {
  storage: Storage;
  manager: BotManager;
  logger: Logger;
  config: AppConfig;
  gateways?: ProviderGateways;
  fetchImpl?: typeof fetch;
}

const COLLECTION = 'deployments';
const WORKER_CRON = '*/1 * * * *';

const STATUS_LABELS: Record<DeploymentStatus, string> = {
  queued: 'در صف',
  validating: 'اعتبارسنجی',
  provisioning: 'آماده‌سازی منابع',
  uploading: 'بارگذاری کد',
  deploying: 'استقرار',
  registering: 'اتصال وب‌هوک',
  healthy: 'سالم و فعال',
  failed: 'ناموفق',
};

export function statusLabel(status: DeploymentStatus): string {
  return STATUS_LABELS[status];
}

function nowIso(): string {
  return new Date().toISOString();
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

export class DeploymentService {
  private readonly gateways: ProviderGateways;
  private readonly running = new Map<string, Promise<void>>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeploymentServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.gateways =
      options.gateways ??
      createProviderGateways({
        cloudflareApiBase: options.config.CLOUDFLARE_API_BASE,
        railwayApiUrl: options.config.RAILWAY_API_URL,
        fetchImpl: this.fetchImpl,
      });
  }

  providerCatalog() {
    return {
      providers: [
        {
          id: 'cloudflare',
          name: 'Cloudflare Workers',
          description:
            'ورکر سبک با D1 برای وب‌هوک، کاتالوگ و سلامت. مناسب‌ترین گزینه برای استقرار سریع پرترافیک.',
          capabilities: ['وب‌هوک', 'D1', 'cron', 'کاتالوگ'],
          limitations: ['پردازش رسانه و ffmpeg پشتیبانی نمی‌شود'],
          credentials: [
            {
              key: 'apiToken',
              label: 'API Token',
              hint: 'توکن با دسترسی Workers Scripts:Edit، D1:Edit و Account Settings:Read',
              link: 'https://dash.cloudflare.com/profile/api-tokens',
              secret: true,
            },
            {
              key: 'accountId',
              label: 'Account ID (اختیاری)',
              hint: 'در صورت داشتن چند حساب، شناسه حساب مقصد را وارد کنید',
              link: 'https://dash.cloudflare.com/',
              secret: false,
            },
          ],
        },
        {
          id: 'railway',
          name: 'Railway',
          description:
            'کنترل‌پلین کامل Node.js با پشتیبانی از PostgreSQL، رسانه و ffmpeg. مناسب برای همه ۳۲ ربات.',
          capabilities: ['همه ربات‌ها', 'رسانه', 'PostgreSQL', 'صف کار'],
          limitations: ['نیازمند اتصال مخزن GitHub به حساب Railway'],
          credentials: [
            {
              key: 'apiToken',
              label: 'Railway API Token',
              hint: 'از Account Settings → Tokens ساخته می‌شود',
              link: 'https://railway.com/account/tokens',
              secret: true,
            },
            {
              key: 'databaseUrl',
              label: 'DATABASE_URL (اختیاری)',
              hint: 'رشته اتصال PostgreSQL؛ در صورت خالی بودن، SQLite استفاده می‌شود',
              link: 'https://railway.com/new',
              secret: false,
            },
          ],
        },
      ],
    };
  }

  async validatePlatformToken(platform: 'telegram' | 'bale' | 'rubika', token: string) {
    const identity = await this.options.manager.verifyToken(platform, token.trim());
    return {
      ok: true,
      platform,
      bot: { id: identity.id, username: identity.username, firstName: identity.firstName },
      message: `توکن ${platform} معتبر است: @${identity.username}`,
    };
  }

  async validateProvider(
    provider: DeployProvider,
    credentials: CloudflareCredentials | RailwayCredentials,
  ): Promise<ProviderValidation> {
    if (provider === 'cloudflare') return this.gateways.validateCloudflare(credentials as CloudflareCredentials);
    if (provider === 'railway') return this.gateways.validateRailway(credentials as RailwayCredentials);
    throw badRequest('سرویس میزبانی پشتیبانی نمی‌شود');
  }

  private documentKey(id: string): string {
    return `dep_${id}`;
  }

  async listDeployments(botId: string): Promise<DeploymentRecord[]> {
    const result = await this.options.storage.documents.list(botId, COLLECTION, { pageSize: 50, direction: 'desc' });
    return result.items
      .map((item) => item.data as unknown as DeploymentRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getDeployment(botId: string, id: string): Promise<DeploymentRecord> {
    const doc = await this.options.storage.documents.findByKey(botId, COLLECTION, this.documentKey(id));
    if (!doc) throw notFound('استقرار پیدا نشد');
    return doc.data as unknown as DeploymentRecord;
  }

  private async save(record: DeploymentRecord): Promise<DeploymentRecord> {
    record.updatedAt = nowIso();
    await this.options.storage.documents.upsert({
      botId: record.botId,
      collection: COLLECTION,
      key: this.documentKey(record.id),
      data: record as unknown as Record<string, unknown>,
    });
    return record;
  }

  private log(record: DeploymentRecord, message: string, level: DeploymentLog['level'] = 'info'): void {
    record.logs.push({ at: nowIso(), level, message });
    if (record.logs.length > 200) record.logs.splice(0, record.logs.length - 200);
  }

  private step(record: DeploymentRecord, id: string, title: string, status: DeploymentStepStatus, detail?: string): void {
    const existing = record.steps.find((item) => item.id === id);
    if (existing) {
      existing.status = status;
      if (detail) existing.detail = detail;
      if (status === 'running') existing.startedAt = nowIso();
      if (status === 'done' || status === 'failed' || status === 'skipped') existing.finishedAt = nowIso();
      return;
    }
    record.steps.push({
      id,
      title,
      status,
      detail,
      startedAt: status === 'running' ? nowIso() : undefined,
      finishedAt: status === 'done' || status === 'failed' ? nowIso() : undefined,
    });
  }

  private async workerBundle(): Promise<string> {
    const configured = this.options.config.DEPLOY_WORKER_BUNDLE;
    const path = isAbsolute(configured) ? configured : join(process.cwd(), configured);
    try {
      return await readFile(path, 'utf8');
    } catch {
      throw new AppError(
        'NOT_CONFIGURED',
        `بسته ورکر در مسیر ${path} پیدا نشد. ابتدا «npm run build» را اجرا کنید تا dist/cloudflare-worker/index.js ساخته شود.`,
      );
    }
  }

  private buildEnvironment(input: {
    provider: DeployProvider;
    requirements: Record<string, string>;
    corsOrigins?: string;
    databaseUrl?: string;
  }): { environment: Record<string, string>; secrets: Record<string, string> } {
    const secrets: Record<string, string> = {
      SECRET_MASTER_KEY: randomToken(32, 'hex'),
      JWT_SECRET: randomToken(32, 'hex'),
      ADMIN_SEED_PASSWORD: `${randomToken(9, 'base64url')}#9`,
      ...input.requirements,
    };
    const environment: Record<string, string> = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      WEBHOOK_PATH_PREFIX: '/webhooks',
      MEDIA_PUBLIC_PREFIX: '/media',
      MAX_UPLOAD_MB: input.provider === 'cloudflare' ? '20' : '48',
      CORS_ORIGINS: input.corsOrigins ?? '*',
      ADMIN_SEED_EMAIL: 'admin@botforge.local',
    };
    if (input.provider === 'cloudflare') {
      environment.DATABASE_DRIVER = 'd1';
      environment.MEDIA_DIR = '/tmp/media';
    } else if (input.databaseUrl) {
      environment.DATABASE_DRIVER = 'postgres';
      secrets.DATABASE_URL = input.databaseUrl;
    } else {
      environment.DATABASE_DRIVER = 'sqlite';
      environment.SQLITE_PATH = '/app/.data/botforge.sqlite';
      environment.MEDIA_DIR = '/app/.data/media';
    }
    return { environment, secrets };
  }

  async start(input: StartDeploymentInput): Promise<DeploymentRecord> {
    const bot = await this.options.storage.bots.findById(input.botId);
    if (!bot) throw notFound('ربات پیدا نشد');
    if (bot.status === 'disabled') throw badRequest('ربات غیرفعال است و قابل استقرار نیست');

    const template = this.options.manager.templateFor(bot.templateId);
    const validation = await this.validateProvider(input.provider, input.credentials);
    if (!validation.ok) throw new AppError('VALIDATION', validation.message);

    const { environment, secrets } = this.buildEnvironment({
      provider: input.provider,
      requirements: input.integrationKeys ?? {},
      corsOrigins: input.corsOrigins,
      databaseUrl: (input.credentials as RailwayCredentials).databaseUrl,
    });

    const record: DeploymentRecord = {
      id: randomId('dep_'),
      botId: bot.id,
      provider: input.provider,
      status: 'queued',
      steps: [],
      logs: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      urls: {},
      environment,
      secretKeys: Object.keys(secrets),
      credentialsCipher: this.options.manager.sealSecret(JSON.stringify(input.credentials)).cipher,
      accountId: validation.accountId,
      accountName: validation.accountName,
      scriptName:
        input.provider === 'cloudflare'
          ? `${this.options.config.DEPLOY_WORKER_PREFIX}-${bot.slug}`.slice(0, 54)
          : undefined,
    };
    this.log(record, `درخواست استقرار روی ${input.provider} ثبت شد.`);
    this.log(record, validation.message);
    await this.save(record);

    const task = this.run(record.id, input, secrets, Boolean(template)).catch(async (error) => {
      const current = await this.getDeployment(record.botId, record.id).catch(() => null);
      if (!current || current.status === 'failed') return;
      current.status = 'failed';
      current.error = toErrorMessage(error);
      current.finishedAt = nowIso();
      this.log(current, current.error, 'error');
      await this.save(current);
    });
    this.running.set(record.id, task);
    void task.finally(() => this.running.delete(record.id));
    return record;
  }

  private async run(
    id: string,
    input: StartDeploymentInput,
    secrets: Record<string, string>,
    templateFound: boolean,
  ): Promise<void> {
    const startedAt = Date.now();
    const bot = await this.options.storage.bots.findById(input.botId);
    if (!bot) throw notFound('ربات پیدا نشد');
    const record = await this.getDeployment(bot.id, id);
    if (!templateFound) this.log(record, 'قالب ربات در ثبت محلی پیدا نشد؛ استقرار ادامه می‌یابد.', 'warn');

    try {
      record.status = 'validating';
      this.step(record, 'validate', 'اعتبارسنجی توکن‌ها', 'running');
      await this.save(record);
      const providerCheck = await this.validateProvider(input.provider, input.credentials);
      if (!providerCheck.ok) throw new AppError('VALIDATION', providerCheck.message);
      const platformIdentity = await this.options.manager.verifyToken(
        bot.platform,
        this.options.manager.openToken(bot),
      );
      this.log(record, `توکن ربات تأیید شد: @${platformIdentity.username}`);
      record.accountId = providerCheck.accountId ?? record.accountId;
      record.accountName = providerCheck.accountName ?? record.accountName;
      this.step(record, 'validate', 'اعتبارسنجی توکن‌ها', 'done');
      await this.save(record);

      if (input.provider === 'cloudflare') {
        await this.deployCloudflare(record, bot, input, secrets, startedAt);
      } else {
        await this.deployRailway(record, bot, input, secrets, startedAt);
      }

      record.status = 'healthy';
      record.finishedAt = nowIso();
      record.durationMs = Date.now() - startedAt;
      this.log(record, 'استقرار با موفقیت پایان یافت و سلامت سرویس تأیید شد.');
      await this.save(record);
      await this.options.storage.events.log({
        botId: bot.id,
        type: 'deployment.succeeded',
        level: 'info',
        payload: { provider: record.provider, url: record.urls.app ?? null, durationMs: record.durationMs },
      });
    } catch (error) {
      record.status = 'failed';
      record.error = toErrorMessage(error);
      record.finishedAt = nowIso();
      record.durationMs = Date.now() - startedAt;
      const failing = record.steps.find((step) => step.status === 'running');
      if (failing) {
        failing.status = 'failed';
        failing.finishedAt = nowIso();
        failing.detail = record.error.slice(0, 300);
      }
      this.log(record, `استقرار ناموفق بود: ${record.error}`, 'error');
      await this.save(record);
      await this.options.storage.events.log({
        botId: bot.id,
        type: 'deployment.failed',
        level: 'error',
        payload: { provider: record.provider, error: record.error.slice(0, 300) },
      });
    }
  }

  private async applySchemaStatements(): Promise<string[]> {
    return [...SCHEMA_STATEMENTS];
  }

  private async deployCloudflare(
    record: DeploymentRecord,
    bot: BotRecord,
    input: StartDeploymentInput,
    secrets: Record<string, string>,
    startedAt: number,
  ): Promise<void> {
    const credentials = input.credentials as CloudflareCredentials;
    const accountId = record.accountId;
    if (!accountId) throw new AppError('VALIDATION', 'شناسه حساب Cloudflare مشخص نشد');
    const token = credentials.apiToken.trim();

    record.status = 'provisioning';
    this.step(record, 'database', 'ساخت و آماده‌سازی D1', 'running');
    await this.save(record);
    const database = await this.gateways.cloudflareEnsureDatabase(
      accountId,
      token,
      `botforge-${bot.slug}`.slice(0, 48),
      await this.applySchemaStatements(),
    );
    record.databaseId = database.id;
    this.log(record, `پایگاه D1 «${database.name}» ${database.created ? 'ساخته شد' : 'بازیابی شد'}.`);
    this.step(record, 'database', 'ساخت و آماده‌سازی D1', 'done', `${database.id}`);
    await this.save(record);

    record.status = 'uploading';
    this.step(record, 'upload', 'بارگذاری کد ورکر', 'running');
    await this.save(record);
    const moduleCode = await this.workerBundle();
    const workerName = record.scriptName ?? `${this.options.config.DEPLOY_WORKER_PREFIX}-${bot.slug}`;
    const deployed = await this.gateways.cloudflareUploadWorker({
      accountId,
      token,
      scriptName: workerName,
      moduleCode,
      d1DatabaseId: database.id,
      variables: {
        ...record.environment,
        PUBLIC_BASE_URL: `https://${workerName}.workers.dev`,
      },
      secrets,
      cron: WORKER_CRON,
    });
    record.scriptName = deployed.scriptName;
    this.step(record, 'upload', 'بارگذاری کد ورکر', 'done', workerName);
    this.log(record, `ورکر روی ${deployed.url} منتشر شد.`);

    record.status = 'registering';
    this.step(record, 'webhook', 'اتصال وب‌هوک پلتفرم', 'running');
    await this.save(record);
    const webhookUrl = `${deployed.url}/webhooks/${bot.platform}/${bot.id}/${webhookPathSecret(bot.webhookSecret)}`;
    const registered = await this.options.manager.registerWebhookAt(bot.id, webhookUrl, bot.webhookSecret);
    this.step(record, 'webhook', 'اتصال وب‌هوک پلتفرم', registered ? 'done' : 'failed');
    this.log(
      record,
      registered ? 'وب‌هوک پلتفرم به ورکر متصل شد.' : 'اتصال وب‌هوک ناموفق بود؛ آدرس را دستی تنظیم کنید.',
      registered ? 'info' : 'warn',
    );

    record.urls = { app: deployed.url, webhook: webhookUrl, health: `${deployed.url}/health` };
    await this.save(record);

    await this.finishWithHealthCheck(record, startedAt);
  }

  private async deployRailway(
    record: DeploymentRecord,
    bot: BotRecord,
    input: StartDeploymentInput,
    secrets: Record<string, string>,
    startedAt: number,
  ): Promise<void> {
    const credentials = input.credentials as RailwayCredentials;
    const token = credentials.apiToken.trim();
    const projectName = (credentials.projectName ?? `botforge-${bot.slug}`).slice(0, 60);

    record.status = 'provisioning';
    this.step(record, 'project', 'ساخت پروژه Railway', 'running');
    await this.save(record);
    const project = await this.gateways.railwayProject(token, projectName);
    record.projectId = project.id;
    record.environmentId = project.environmentId;
    this.step(record, 'project', 'ساخت پروژه Railway', 'done', project.name);
    this.log(record, `پروژه Railway «${project.name}» آماده شد.`);
    await this.save(record);

    this.step(record, 'service', 'ساخت سرویس از مخزن', 'running');
    await this.save(record);
    const service = await this.gateways.railwayService(token, {
      projectId: project.id,
      name: `botforge-${bot.slug}`.slice(0, 40),
      repo: this.options.config.DEPLOY_REPO,
    });
    record.serviceId = service.id;
    this.step(record, 'service', 'ساخت سرویس از مخزن', 'done', service.name);
    await this.save(record);

    record.status = 'deploying';
    this.step(record, 'variables', 'تنظیم متغیرهای محیطی', 'running');
    await this.save(record);
    await this.gateways.railwayVariables(token, {
      projectId: project.id,
      environmentId: project.environmentId,
      serviceId: service.id,
      variables: { ...record.environment, ...secrets },
    });
    this.step(record, 'variables', 'تنظیم متغیرهای محیطی', 'done', `${Object.keys({ ...record.environment, ...secrets }).length} متغیر`);
    this.log(record, 'متغیرهای محیطی روی سرویس تنظیم شد.');

    this.step(record, 'domain', 'تخصیص دامنه عمومی', 'running');
    await this.save(record);
    const appUrl = await this.gateways.railwayDomain(token, {
      environmentId: project.environmentId,
      serviceId: service.id,
    });
    const webhookUrl = `${appUrl}/webhooks/${bot.platform}/${bot.id}/${webhookPathSecret(bot.webhookSecret)}`;
    record.urls = { app: appUrl, webhook: webhookUrl, health: `${appUrl}/health` };
    this.step(record, 'domain', 'تخصیص دامنه عمومی', 'done', appUrl);
    await this.save(record);

    this.step(record, 'wait', 'انتظار برای پایان استقرار', 'running');
    await this.save(record);
    const deployment = await this.waitForRailway(token, {
      projectId: project.id,
      environmentId: project.environmentId,
      serviceId: service.id,
      deadline: Date.now() + this.options.config.DEPLOY_TIMEOUT_MS,
      record,
    });
    this.step(record, 'wait', 'انتظار برای پایان استقرار', 'done', deployment?.status ?? 'unknown');

    record.status = 'registering';
    this.step(record, 'webhook', 'اتصال وب‌هوک پلتفرم', 'running');
    await this.save(record);
    await this.gateways.railwayVariables(token, {
      projectId: project.id,
      environmentId: project.environmentId,
      serviceId: service.id,
      variables: { PUBLIC_BASE_URL: appUrl },
    });
    const registered = await this.options.manager.registerWebhookAt(bot.id, webhookUrl, bot.webhookSecret);
    this.step(record, 'webhook', 'اتصال وب‌هوک پلتفرم', registered ? 'done' : 'failed');
    this.log(
      record,
      registered ? 'وب‌هوک پلتفرم به سرویس Railway متصل شد.' : 'اتصال وب‌هوک ناموفق بود؛ آدرس را دستی تنظیم کنید.',
      registered ? 'info' : 'warn',
    );
    await this.save(record);

    await this.finishWithHealthCheck(record, startedAt);
  }

  private async waitForRailway(
    token: string,
    input: {
      projectId: string;
      environmentId: string;
      serviceId: string;
      deadline: number;
      record: DeploymentRecord;
    },
  ): Promise<{ status: string } | null> {
    let last: { status: string } | null = null;
    while (Date.now() < input.deadline) {
      const deployment = await this.gateways.railwayDeploymentStatus(token, {
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: input.serviceId,
      });
      if (deployment) {
        last = deployment;
        this.log(input.record, `وضعیت استقرار Railway: ${deployment.status}`);
        if (deployment.status === 'SUCCESS') return deployment;
        if (['FAILED', 'CRASHED', 'REMOVED'].includes(deployment.status)) {
          throw new AppError('UPSTREAM_ERROR', `استقرار Railway با وضعیت ${deployment.status} متوقف شد`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.config.DEPLOY_POLL_INTERVAL_MS));
    }
    throw new AppError('UPSTREAM_ERROR', 'زمان انتظار برای استقرار Railway به پایان رسید');
  }

  private async finishWithHealthCheck(record: DeploymentRecord, startedAt: number): Promise<void> {
    record.status = 'registering';
    this.step(record, 'health', 'بررسی سلامت سرویس', 'running');
    await this.save(record);
    const health = await this.checkUrl(record.urls.health ?? '');
    record.health = health;
    this.step(
      record,
      'health',
      'بررسی سلامت سرویس',
      health.ok ? 'done' : 'failed',
      health.ok ? `${health.latencyMs} میلی‌ثانیه` : health.error ?? 'پاسخ نامناسب',
    );
    this.log(
      record,
      health.ok ? `سلامت سرویس تأیید شد (${health.status}).` : `بررسی سلامت ناموفق بود: ${health.error ?? health.status}`,
      health.ok ? 'info' : 'error',
    );
    if (!health.ok) {
      record.error = health.error ?? `کد وضعیت ${health.status}`;
    }
    record.finishedAt = nowIso();
    record.durationMs = Date.now() - startedAt;
    record.status = health.ok ? 'healthy' : 'failed';
    await this.save(record);
  }

  async checkHealth(botId: string, deploymentId: string): Promise<DeploymentRecord> {
    const record = await this.getDeployment(botId, deploymentId);
    this.step(record, 'health', 'بررسی سلامت سرویس', 'running');
    const health = await this.checkUrl(record.urls.health ?? '');
    record.health = health;
    this.step(
      record,
      'health',
      'بررسی سلامت سرویس',
      health.ok ? 'done' : 'failed',
      health.ok ? `${health.latencyMs} میلی‌ثانیه` : health.error ?? 'پاسخ نامناسب',
    );
    this.log(record, health.ok ? 'بررسی سلامت مجدد موفق بود.' : `بررسی سلامت مجدد ناموفق: ${health.error ?? health.status}`, health.ok ? 'info' : 'error');
    if (health.ok && record.status === 'failed' && record.urls.app) record.status = 'healthy';
    await this.save(record);
    return record;
  }

  private async checkUrl(url: string): Promise<{ ok: boolean; checkedAt: string; status?: number; latencyMs?: number; error?: string }> {
    const startedAt = Date.now();
    if (!url) return { ok: false, checkedAt: nowIso(), error: 'آدرس سلامت تعریف نشده است' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const latencyMs = Date.now() - startedAt;
      const text = await response.text();
      let healthy = response.ok;
      if (healthy && text.trim().length > 0) {
        try {
          const parsed = JSON.parse(text) as { status?: string };
          if (parsed.status && parsed.status !== 'ok') healthy = false;
        } catch {
          healthy = response.ok;
        }
      }
      return {
        ok: healthy,
        checkedAt: nowIso(),
        status: response.status,
        latencyMs,
        error: healthy ? undefined : `پاسخ سلامت نامعتبر (HTTP ${response.status})`,
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        error: (error as Error).name === 'AbortError' ? 'زمان بررسی سلامت به پایان رسید' : toErrorMessage(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  buildPackage(record: DeploymentRecord, bot: BotRecord): { fileName: string; content: string }[] {
    const envFile = Object.entries({ ...record.environment })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretFile = record.secretKeys.map((key) => `${key}=<مقدار-مخفی-خود-را-وارد-کنید>`).join('\n');
    const docker = [
      'docker build -t botforge/control-plane -f apps/control-plane/Dockerfile .',
      'docker run -d --name botforge \\',
      '  --env-file .env \\',
      '  -p 8080:8080 \\',
      '  -v botforge-media:/app/.data/media \\',
      '  botforge/control-plane',
    ].join('\n');
    const webhook = [
      `# ${bot.platform} webhook`,
      `curl -X POST "https://<your-domain>/webhooks/${bot.platform}/${bot.id}/<webhook-secret>"`,
      `# آدرس کامل پس از استقرار: ${record.urls.webhook ?? 'در انتظار استقرار'}`,
    ].join('\n');
    return [
      { fileName: '.env', content: envFile },
      { fileName: '.env.secrets', content: secretFile },
      { fileName: 'deploy.sh', content: `${docker}\n` },
      { fileName: 'webhook.txt', content: webhook },
    ];
  }
}

export function createDeploymentService(options: DeploymentServiceOptions): DeploymentService {
  return new DeploymentService(options);
}
