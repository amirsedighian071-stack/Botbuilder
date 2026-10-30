import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createLogger,
  loadConfig,
  type ChatMemberResult,
  type MessengerApi,
  type SendResult,
} from '@botforge/core';
import { BotManager } from '@botforge/engine';
import { buildApp } from '../src/app';
import { createAppContext } from '../src/context';
import { createProviderGateways } from '../src/services/gateways';
import { createDeploymentService } from '../src/services/deployments';


class StubAdapter implements MessengerApi {
  readonly platform = 'telegram' as const;
  readonly botId = 'bot_deploy';
  readonly capabilities = {
    inlineKeyboard: true,
    editMessage: true,
    deleteMessage: true,
    callbackQueries: true,
    files: true,
    voice: true,
    mediaGroup: false,
    htmlParseMode: true,
  };
  webhookUrl: string | null = null;
  webhookSecret: string | null = null;

  async sendMessage(): Promise<SendResult> {
    return { ok: true };
  }
  async editMessage(): Promise<SendResult> {
    return { ok: true };
  }
  async deleteMessage(): Promise<boolean> {
    return true;
  }
  async answerCallback(): Promise<boolean> {
    return true;
  }
  async getFileUrl(fileId: string): Promise<string> {
    return `https://files.test/${fileId}`;
  }
  async getChatMember(): Promise<ChatMemberResult> {
    return { status: 'member', isMember: true };
  }
  async sendChatAction(): Promise<void> {
    return;
  }
  async sendPhoto(): Promise<SendResult> {
    return { ok: true };
  }
  async sendDocument(): Promise<SendResult> {
    return { ok: true };
  }
  async sendVoice(): Promise<SendResult> {
    return { ok: true };
  }
  async sendVideo(): Promise<SendResult> {
    return { ok: true };
  }
  async getMe() {
    return { id: '777', username: 'botforge_demo', firstName: 'Demo' };
  }
  async setWebhook(url: string, secret: string): Promise<boolean> {
    this.webhookUrl = url;
    this.webhookSecret = secret;
    return true;
  }
  async deleteWebhook(): Promise<boolean> {
    this.webhookUrl = null;
    return true;
  }
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function fakeFetch(handler: (call: FetchCall) => { status?: number; body: unknown }) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const call: FetchCall = { url: href, method: init?.method ?? 'GET', body: init?.body };
    calls.push(call);
    const result = handler(call);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

async function buildWorkerFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'botforge-bundle-'));
  const file = join(dir, 'worker.js');
  await writeFile(file, 'export default { async fetch() { return new Response("ok"); } };', 'utf8');
  return file;
}

const baseConfig = {
  NODE_ENV: 'test',
  PORT: '8091',
  DATABASE_DRIVER: 'memory',
  SECRET_MASTER_KEY: 'deploy-test-master-key-32-characters',
  JWT_SECRET: 'deploy-test-jwt-secret-32-characters',
  ADMIN_SEED_EMAIL: 'admin@botforge.test',
  ADMIN_SEED_PASSWORD: 'TestPassword#1',
  RATE_LIMIT_MAX: '1000',
  CORS_ORIGINS: '*',
  SSRF_PROTECTION: 'false',
  DEPLOY_POLL_INTERVAL_MS: '10',
  DEPLOY_TIMEOUT_MS: '5000',
  DEPLOY_WORKER_BUNDLE: await buildWorkerFixture(),
};

test('cloudflare gateway validates tokens and maps API errors', async () => {
  const ok = fakeFetch(() => ({
    body: { success: true, result: [{ id: 'acc_123456789', name: 'حساب اصلی' }] },
  }));
  const gateways = createProviderGateways({
    cloudflareApiBase: 'https://api.cloudflare.com/client/v4',
    railwayApiUrl: 'https://railway.test/graphql',
    fetchImpl: ok.impl,
  });
  const validation = await gateways.validateCloudflare({ apiToken: 'x'.repeat(40) });
  assert.equal(validation.ok, true);
  assert.equal(validation.accountId, 'acc_123456789');
  assert.equal(validation.accountName, 'حساب اصلی');

  const failing = fakeFetch(() => ({
    status: 403,
    body: { success: false, errors: [{ code: 9109, message: 'Invalid access token' }] },
  }));
  const failingGateways = createProviderGateways({
    cloudflareApiBase: 'https://api.cloudflare.com/client/v4',
    railwayApiUrl: 'https://railway.test/graphql',
    fetchImpl: failing.impl,
  });
  await assert.rejects(() => failingGateways.validateCloudflare({ apiToken: 'y'.repeat(40) }), /Invalid access token/);
});

test('railway gateway validates tokens through GraphQL', async () => {
  const railway = fakeFetch(() => ({
    body: { data: { me: { id: 'user_1', name: 'نگار', email: 'n@example.com' } } },
  }));
  const gateways = createProviderGateways({
    cloudflareApiBase: 'https://api.cloudflare.com/client/v4',
    railwayApiUrl: 'https://railway.test/graphql',
    fetchImpl: railway.impl,
  });
  const validation = await gateways.validateRailway({ apiToken: 'r'.repeat(40) });
  assert.equal(validation.ok, true);
  assert.equal(validation.accountName, 'نگار');

  const unauthorized = fakeFetch(() => ({
    status: 200,
    body: { errors: [{ message: 'Not authorized' }] },
  }));
  const failing = createProviderGateways({
    cloudflareApiBase: 'https://api.cloudflare.com/client/v4',
    railwayApiUrl: 'https://railway.test/graphql',
    fetchImpl: unauthorized.impl,
  });
  await assert.rejects(() => failing.validateRailway({ apiToken: 'r'.repeat(40) }), /Not authorized/);
});

test('cloudflare deployment provisions D1, uploads worker, connects webhook and passes health check', async () => {
  const config = loadConfig(baseConfig);
  const storage = await createAppContext({ config, logger: createLogger({ level: 'error' }), startQueue: false });
  const adapter = new StubAdapter();
  const manager = new BotManager({
    storage: storage.storage,
    config,
    logger: createLogger({ level: 'error' }),
    http: storage.http,
    secrets: storage.secrets,
    queue: storage.queue,
    templates: storage.templates,
    adapterFactory: () => adapter,
  });

  const now = new Date().toISOString();
  const bot = await storage.storage.bots.create({
    id: 'bot_deploy',
    slug: 'gold-deploy',
    templateId: 'gold-price',
    name: 'قیمت طلا',
    platform: 'telegram',
    status: 'active',
    tokenCipher: storage.secrets.seal('123456789:AAHabcdefghijklmnopqrstuvwxyz').cipher,
    tokenHint: '1234••••wxyz',
    ownerId: 'system',
    config: {},
    forceMembership: {
      enabled: false,
      channels: [],
      message: 'm',
      buttonLabel: 'b',
      recheckLabel: 'r',
      bypassAdmins: true,
      cacheSeconds: 60,
    },
    webhookSecret: 'webhook-secret-value',
    createdAt: now,
    updatedAt: now,
  });

  const { impl, calls } = fakeFetch((call) => {
    if (call.url.endsWith('/accounts')) {
      return { body: { success: true, result: [{ id: 'acc_1', name: 'حساب تست' }] } };
    }
    if (call.url.includes('/d1/database') && call.method === 'GET') {
      return { body: { success: true, result: [] } };
    }
    if (call.url.endsWith('/d1/database')) {
      return { body: { success: true, result: { uuid: 'db-uuid-1', name: 'botforge-gold-deploy' } } };
    }
    if (call.url.includes('/query')) {
      return { body: { success: true, result: [{ success: true }] } };
    }
    if (call.url.includes('/workers/subdomain')) {
      return { body: { success: true, result: { subdomain: 'team-test' } } };
    }
    if (call.url.endsWith('/health')) {
      return { body: { status: 'ok', storage: { ok: true } } };
    }
    return { body: { success: true, result: { ok: true } } };
  });

  const service = createDeploymentService({
    storage: storage.storage,
    manager,
    logger: createLogger({ level: 'error' }),
    config,
    fetchImpl: impl,
  });

  const started = await service.start({
    botId: bot.id,
    provider: 'cloudflare',
    credentials: { apiToken: 'c'.repeat(40) },
    integrationKeys: { GOLD_API_KEY: 'gold-key-value' },
  });
  assert.equal(started.status, 'queued');

  let record = await service.getDeployment(bot.id, started.id);
  const deadline = Date.now() + 10_000;
  while (!['healthy', 'failed'].includes(record.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    record = await service.getDeployment(bot.id, started.id);
  }

  assert.equal(record.status, 'healthy', JSON.stringify(record.logs, null, 2));
  assert.equal(record.urls.app, 'https://botforge-gold-deploy.team-test.workers.dev');
  assert.match(record.urls.webhook ?? '', /\/webhooks\/telegram\/bot_deploy\//);
  assert.equal(adapter.webhookUrl, record.urls.webhook);
  assert.equal(record.health?.ok, true);
  assert.equal(record.environment.DATABASE_DRIVER, 'd1');
  assert.ok(record.secretKeys.includes('SECRET_MASTER_KEY'));
  assert.ok(record.secretKeys.includes('GOLD_API_KEY'));
  assert.equal(record.secretKeys.includes('PUBLIC_BASE_URL'), false);
  assert.ok(calls.some((call) => call.url.endsWith('/workers/scripts/botforge-gold-deploy')));
  assert.ok(calls.some((call) => call.url.includes('/d1/database/db-uuid-1/query')));
});

test('deployment fails cleanly when the provider rejects the token', async () => {
  const config = loadConfig(baseConfig);
  const context = await createAppContext({ config, logger: createLogger({ level: 'error' }), startQueue: false });
  const adapter = new StubAdapter();
  const manager = new BotManager({
    storage: context.storage,
    config,
    logger: createLogger({ level: 'error' }),
    http: context.http,
    secrets: context.secrets,
    queue: context.queue,
    templates: context.templates,
    adapterFactory: () => adapter,
  });
  const now = new Date().toISOString();
  const bot = await context.storage.bots.create({
    id: 'bot_fail',
    slug: 'fail-bot',
    templateId: 'gold-price',
    name: 'قیمت',
    platform: 'telegram',
    status: 'active',
    tokenCipher: context.secrets.seal('123456789:AAHabcdefghijklmnopqrstuvwxyz').cipher,
    tokenHint: 'x',
    ownerId: 'system',
    config: {},
    forceMembership: {
      enabled: false,
      channels: [],
      message: 'm',
      buttonLabel: 'b',
      recheckLabel: 'r',
      bypassAdmins: true,
      cacheSeconds: 60,
    },
    webhookSecret: 'secret-value-123',
    createdAt: now,
    updatedAt: now,
  });
  const { impl } = fakeFetch(() => ({
    status: 403,
    body: { success: false, errors: [{ code: 9109, message: 'Invalid access token' }] },
  }));
  const service = createDeploymentService({
    storage: context.storage,
    manager,
    logger: createLogger({ level: 'error' }),
    config,
    fetchImpl: impl,
  });
  await assert.rejects(
    () =>
      service.start({
        botId: bot.id,
        provider: 'cloudflare',
        credentials: { apiToken: 'd'.repeat(40) },
      }),
    /Invalid access token/,
  );
});

test('deploy endpoints require authentication and expose provider catalog', async () => {
  const config = loadConfig(baseConfig);
  const context = await createAppContext({ config, logger: createLogger({ level: 'error' }), startQueue: false });
  const app = await buildApp(context);

  const providers = await app.inject({ method: 'GET', url: '/api/deploy/providers' });
  assert.equal(providers.statusCode, 200);
  const body = providers.json() as { providers: Array<{ id: string; credentials: unknown[] }> };
  assert.deepEqual(
    body.providers.map((provider) => provider.id),
    ['cloudflare', 'railway'],
  );
  assert.ok(body.providers[0].credentials.length >= 1);

  const guarded = await app.inject({ method: 'POST', url: '/api/deploy/validate-token', payload: {} });
  assert.equal(guarded.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@botforge.test', password: 'TestPassword#1' },
  });
  const token = (login.json() as { token: string }).token;
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/deploy/validate-token',
    headers: { authorization: `Bearer ${token}` },
    payload: { platform: 'telegram', token: 'short' },
  });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});
