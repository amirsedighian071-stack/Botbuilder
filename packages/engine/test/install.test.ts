import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLogger,
  createMemoryStorage,
  HttpClient,
  loadConfig,
  SecretsManager,
  sha256,
  type AppConfig,
  type BotDefinition,
  type ChatMemberResult,
  type MessengerApi,
  type OutgoingMessage,
  type SendResult,
} from '@botforge/core';
import { BotManager, JobQueue, ensureInstalledBot } from '@botforge/engine';

const config: AppConfig = loadConfig({
  NODE_ENV: 'test',
  SECRET_MASTER_KEY: 'installer-test-master-key-32-characters',
  JWT_SECRET: 'installer-test-jwt-secret-32-characters',
  DATABASE_DRIVER: 'memory',
  SSRF_PROTECTION: 'false',
  PUBLIC_BASE_URL: 'https://botforge-installer.test',
});

const TOKEN = '123456789:AAHabcdefghijklmnopqrstuvwxyz012345';

class StubAdapter implements MessengerApi {
  readonly platform = 'telegram' as const;
  readonly botId = 'bot_stub';
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
  webhookUrl = '';
  deleted = 0;

  async sendMessage(): Promise<SendResult> {
    return { ok: true, messageId: '1' };
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
    return { id: '123456789', username: 'installer_bot', firstName: 'Installer' };
  }
  async setWebhook(url: string): Promise<boolean> {
    this.webhookUrl = url;
    return true;
  }
  async deleteWebhook(): Promise<boolean> {
    this.deleted += 1;
    return true;
  }
}

function template(): BotDefinition {
  return {
    id: 'install-demo',
    name: 'ربات نصب آزمایشی',
    category: 'E',
    summary: 'آزمایش نصب',
    description: 'آزمایش نصب',
    icon: 'box',
    tags: ['install'],
    version: '1.0.0',
    commands: [{ command: 'start', description: 'شروع' }],
    menu: [],
    requirements: [],
    defaultConfig: { greeting: 'سلام' },
    actions: {
      start: async (ctx) => {
        await ctx.reply('شروع شد');
      },
    },
    steps: {},
    jobs: {},
  };
}

async function harness() {
  const storage = createMemoryStorage();
  await storage.init();
  const logger = createLogger({ level: 'error' });
  const adapter = new StubAdapter();
  const templates = new Map<string, BotDefinition>([[template().id, template()]]);
  const queue = new JobQueue({ storage, logger, handlers: {}, concurrency: 1 });
  const manager = new BotManager({
    storage,
    config,
    logger,
    http: new HttpClient({ logger, timeoutMs: 1000, retries: 0, ssrfProtection: false }),
    secrets: new SecretsManager({ masterKey: config.SECRET_MASTER_KEY }),
    queue,
    templates,
    adapterFactory: () => adapter,
  });
  return { storage, manager, adapter, logger };
}

test('ensureInstalledBot creates the packaged bot with its installer identity', async () => {
  const { storage, manager, adapter, logger } = await harness();
  const result = await ensureInstalledBot({
    storage,
    manager,
    logger,
    spec: {
      templateId: 'install-demo',
      name: 'ربات فروشگاه',
      slug: 'install-demo-quick',
      platform: 'telegram',
      token: TOKEN,
      botId: 'bot_installer_fixed',
      webhookSecret: 'installer-webhook-secret',
      config: { greeting: 'درود' },
      forceMembership: {
        enabled: true,
        channels: [{ id: 'ch_1', platform: 'telegram', chatId: '@demo', title: 'کانال', required: true }],
        message: 'ابتدا عضو شوید',
        buttonLabel: 'بررسی عضویت',
        recheckLabel: 'عضو شدم',
        bypassAdmins: true,
        cacheSeconds: 60,
      },
    },
  });

  assert.equal(result.created, true);
  assert.equal(result.bot.id, 'bot_installer_fixed');
  assert.equal(result.bot.slug, 'install-demo-quick');
  assert.equal(result.bot.webhookSecret, 'installer-webhook-secret');
  assert.equal(result.bot.config.greeting, 'درود');
  assert.equal(result.bot.forceMembership.enabled, true);
  assert.equal(result.webhookRegistered, true);
  assert.ok(result.webhookUrl.endsWith(`/webhooks/telegram/bot_installer_fixed/${sha256('webhook:installer-webhook-secret').slice(0, 32)}`));
  assert.equal(adapter.webhookUrl, result.webhookUrl);

  const stored = await storage.bots.findById('bot_installer_fixed');
  assert.ok(stored);
  assert.notEqual(stored?.tokenCipher, TOKEN);
  assert.equal(stored?.tokenHint, '1234••••2345');
});

test('ensureInstalledBot is idempotent and keeps the same bot record', async () => {
  const { storage, manager, logger } = await harness();
  const base = {
    templateId: 'install-demo',
    name: 'نسخه اول',
    slug: 'install-demo-repeat',
    platform: 'telegram' as const,
    token: TOKEN,
    botId: 'bot_installer_repeat',
    webhookSecret: 'installer-webhook-secret',
  };
  const first = await ensureInstalledBot({ storage, manager, logger, spec: base });
  const second = await ensureInstalledBot({ storage, manager, logger, spec: { ...base, name: 'نسخه دوم' } });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.bot.id, first.bot.id);
  assert.equal(second.bot.name, 'نسخه دوم');
  const count = await storage.bots.count();
  assert.equal(count, 1);
});

test('ensureInstalledBot rejects invalid input before touching storage', async () => {
  const { storage, manager, logger } = await harness();
  await assert.rejects(
    () => ensureInstalledBot({ storage, manager, logger, spec: { templateId: 'install-demo', name: 'x', slug: 'ab', platform: 'telegram', token: TOKEN } }),
    /شناسه نصب/,
  );
  await assert.rejects(
    () => ensureInstalledBot({ storage, manager, logger, spec: { templateId: 'install-demo', name: 'x', slug: 'valid-slug', platform: 'telegram', token: 'short' } }),
    /توکن ربات/,
  );
  await assert.rejects(
    () => ensureInstalledBot({ storage, manager, logger, spec: { templateId: 'missing-template', name: 'x', slug: 'valid-slug', platform: 'telegram', token: TOKEN } }),
    /قالب/,
  );
  assert.equal(await storage.bots.count(), 0);
});

test('ensureInstalledBot validates force membership payloads', async () => {
  const { storage, manager, logger } = await harness();
  await assert.rejects(
    () =>
      ensureInstalledBot({
        storage,
        manager,
        logger,
        spec: { templateId: 'install-demo', name: 'x', slug: 'valid-slug', platform: 'telegram', token: TOKEN, forceMembership: { enabled: 'yes' } },
      }),
    /عضویت اجباری/,
  );
});

void ({} as OutgoingMessage);
