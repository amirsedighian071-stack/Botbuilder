import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLogger,
  createMemoryStorage,
  HttpClient,
  loadConfig,
  randomId,
  SecretsManager,
  type BotDefinition,
  type BotRecord,
  type ChatMemberResult,
  type IncomingMessage,
  type MessengerApi,
  type OutgoingMessage,
  type SendResult,
} from '@botforge/core';
import { BotRuntime, JobQueue } from '@botforge/engine';

const config = loadConfig({
  NODE_ENV: 'test',
  SECRET_MASTER_KEY: 'engine-test-master-key-32-characters',
  JWT_SECRET: 'engine-test-jwt-secret-32-characters',
  DATABASE_DRIVER: 'memory',
  SSRF_PROTECTION: 'false',
  PUBLIC_BASE_URL: 'https://botforge.test',
});

class FakeApi implements MessengerApi {
  readonly platform = 'telegram' as const;
  readonly botId = 'bot_test';
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
  readonly sent: OutgoingMessage[] = [];
  readonly deleted: string[] = [];
  readonly answered: string[] = [];

  async sendMessage(chatId: string, message: OutgoingMessage): Promise<SendResult> {
    void chatId;
    this.sent.push(message);
    return { ok: true, messageId: String(this.sent.length) };
  }
  async editMessage(): Promise<SendResult> {
    return { ok: true };
  }
  async deleteMessage(_chatId: string, messageId: string): Promise<boolean> {
    this.deleted.push(messageId);
    return true;
  }
  async answerCallback(callbackQueryId: string): Promise<boolean> {
    this.answered.push(callbackQueryId);
    return true;
  }
  async getFileUrl(fileId: string): Promise<string> {
    return `https://files.test/${fileId}`;
  }
  async getChatMember(): Promise<ChatMemberResult> {
    return { status: 'member', isMember: true };
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
  async sendChatAction(): Promise<void> {
    return;
  }
  async getMe() {
    return { id: '1', username: 'demo_bot', firstName: 'Demo' };
  }
  async setWebhook(): Promise<boolean> {
    return true;
  }
  async deleteWebhook(): Promise<boolean> {
    return true;
  }
}

function template(): BotDefinition {
  return {
    id: 'test-bot',
    name: 'ربات آزمایشی',
    category: 'E',
    summary: 'آزمایش',
    description: 'آزمایش',
    icon: 'box',
    tags: ['test'],
    version: '1.0.0',
    commands: [{ command: 'hello', description: 'درود' }],
    menu: [{ id: 'hello', label: 'درود' }],
    requirements: [],
    defaultConfig: { greeting: 'سلام' },
    actions: {
      hello: async (ctx) => {
        const greeting = await ctx.getSetting<string>('greeting', 'سلام');
        await ctx.reply(`${greeting} ${ctx.user.firstName ?? ''}`.trim());
      },
    },
    steps: {
      name_input: async (ctx, input) => {
        await ctx.setSetting('lastName', String(input));
        await ctx.clearFlow();
        await ctx.reply(`ثبت شد: ${input}`);
      },
    },
    jobs: {
      'test.tick': async (job) => {
        await job.send('1', 'تیک اجرا شد');
      },
    },
    async onStart(ctx) {
      await ctx.reply('خوش آمدید');
    },
    async onCommand(ctx, command) {
      if (command === 'ask') {
        await ctx.ask('نام خود را بنویسید', 'name_input');
        return true;
      }
      return false;
    },
  };
}

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    updateId: randomId('u_'),
    chatId: '1',
    chatType: 'private',
    userId: '1',
    firstName: 'سارا',
    text: '',
    args: '',
    attachments: [],
    isEdited: false,
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  };
}

async function buildRuntime(overrides: Partial<BotRecord> = {}) {
  const storage = await createMemoryStorage();
  await storage.init();
  const now = new Date().toISOString();
  const bot: BotRecord = {
    id: 'bot_test',
    slug: 'test-bot',
    templateId: 'test-bot',
    name: 'ربات آزمایشی',
    platform: 'telegram',
    status: 'active',
    tokenCipher: 'cipher',
    tokenHint: '1234••••cret',
    ownerId: 'system',
    config: { greeting: 'درود' },
    forceMembership: {
      enabled: false,
      channels: [],
      message: 'عضو شوید',
      buttonLabel: 'عضویت',
      recheckLabel: 'بررسی',
      bypassAdmins: true,
      cacheSeconds: 60,
    },
    webhookSecret: 'webhook-secret',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const api = new FakeApi();
  const logger = createLogger({ level: 'error' });
  const queue = new JobQueue({ storage, logger, handlers: {}, pollIntervalMs: 600_000 });
  const runtime = new BotRuntime({
    bot,
    template: template(),
    api,
    storage,
    config,
    logger,
    http: new HttpClient({ ssrfProtection: false }),
    secrets: new SecretsManager({ masterKey: config.SECRET_MASTER_KEY }),
    queue,
  });
  await runtime.init();
  return { storage, runtime, api, queue, bot };
}

test('runtime answers /start and registers the user', async () => {
  const { runtime, api, storage } = await buildRuntime();
  await runtime.handleMessage(message({ text: '/start' }));
  assert.equal(api.sent[0].text, 'خوش آمدید');
  const user = await storage.users.findByPlatformId('bot_test', '1');
  assert.equal(user?.firstName, 'سارا');
  assert.equal(user?.role, 'user');
});

test('runtime runs template actions with layered settings', async () => {
  const { runtime, api } = await buildRuntime();
  await runtime.handleMessage(message({ text: '/hello' }));
  assert.equal(api.sent.at(-1)?.text, 'درود سارا');
});

test('runtime stores and consumes flow state', async () => {
  const { runtime, api, storage } = await buildRuntime();
  await runtime.handleMessage(message({ text: '/ask' }));
  assert.match(api.sent.at(-1)?.text ?? '', /نام خود را بنویسید/);
  await runtime.handleMessage(message({ text: 'مریم' }));
  assert.equal(api.sent.at(-1)?.text, 'ثبت شد: مریم');
  const user = await storage.users.findByPlatformId('bot_test', '1');
  assert.ok(user);
  const flow = await storage.sessions.get('bot_test', user.id, 'flow');
  assert.equal(flow, null);
});

test('runtime rejects unknown commands with guidance', async () => {
  const { runtime, api } = await buildRuntime();
  await runtime.handleMessage(message({ text: '/unknown' }));
  assert.match(api.sent.at(-1)?.text ?? '', /دستور ناشناخته/);
});

test('runtime answers with a maintenance notice and skips dispatch', async () => {
  const { runtime, api } = await buildRuntime({ status: 'maintenance' });
  await runtime.handleMessage(message({ text: '/start' }));
  assert.equal(api.sent.length, 1);
  assert.match(api.sent[0].text, /در حال به‌روزرسانی/);
});

test('runtime stays silent for paused bots', async () => {
  const { runtime, api } = await buildRuntime({ status: 'paused' });
  await runtime.handleMessage(message({ text: '/start' }));
  assert.equal(api.sent.length, 0);
});

test('runtime dispatches template jobs', async () => {
  const { runtime, api } = await buildRuntime();
  await runtime.executeJob('test.tick', {});
  assert.equal(api.sent.at(-1)?.text, 'تیک اجرا شد');
  await assert.rejects(() => runtime.executeJob('missing.job', {}), /not registered/);
});

test('queue executes registered handlers and honours retries', async () => {
  const { storage, queue } = await buildRuntime();
  let runs = 0;
  queue.register('flaky.job', async () => {
    runs += 1;
    if (runs < 2) throw new Error('موقتاً ناموفق');
  });
  const job = await queue.enqueue('bot_test', 'flaky.job', {});
  await queue.runOnce();
  const afterFirst = await storage.jobs.findById(job.id);
  assert.equal(runs, 1);
  assert.equal(afterFirst?.status, 'failed');
  await storage.jobs.reschedule(job.id, new Date(Date.now() - 1000).toISOString());
  await queue.runOnce();
  const afterSecond = await storage.jobs.findById(job.id);
  assert.equal(runs, 2);
  assert.equal(afterSecond?.status, 'done');
});
