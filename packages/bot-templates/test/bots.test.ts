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
  type Storage,
} from '@botforge/core';
import { BotRuntime, JobQueue } from '@botforge/engine';
import { formBuilderBot, pollQuizBot, reminderBot } from '@botforge/bot-templates';

const config = loadConfig({
  NODE_ENV: 'test',
  SECRET_MASTER_KEY: 'bots-test-master-key-32-characters',
  JWT_SECRET: 'bots-test-jwt-secret-32-characters',
  DATABASE_DRIVER: 'memory',
  SSRF_PROTECTION: 'false',
  PUBLIC_BASE_URL: 'https://botforge.test',
  AI_API_KEY: '',
});

class FakeApi implements MessengerApi {
  readonly platform = 'telegram' as const;
  readonly botId = 'bot_flow';
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
  async sendMessage(_chatId: string, message: OutgoingMessage): Promise<SendResult> {
    this.sent.push(message);
    return { ok: true, messageId: String(this.sent.length) };
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
    return { id: 'bot_flow', username: 'flow_bot', firstName: 'Flow' };
  }
  async setWebhook(): Promise<boolean> {
    return true;
  }
  async deleteWebhook(): Promise<boolean> {
    return true;
  }
  last(): OutgoingMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

interface Harness {
  runtime: BotRuntime;
  api: FakeApi;
  storage: Storage;
  send(text: string): Promise<void>;
  callback(data: string): Promise<void>;
  makeAdmin(): Promise<void>;
}

async function harness(template: BotDefinition): Promise<Harness> {
  const storage = await createMemoryStorage();
  await storage.init();
  const now = new Date().toISOString();
  const bot: BotRecord = {
    id: 'bot_flow',
    slug: `flow-${template.id}`,
    templateId: template.id,
    name: template.name,
    platform: 'telegram',
    status: 'active',
    tokenCipher: 'cipher',
    tokenHint: '1234••••cret',
    ownerId: 'system',
    config: { ...template.defaultConfig },
    forceMembership: {
      enabled: false,
      channels: [],
      message: 'm',
      buttonLabel: 'b',
      recheckLabel: 'r',
      bypassAdmins: true,
      cacheSeconds: 60,
    },
    webhookSecret: 'secret',
    createdAt: now,
    updatedAt: now,
  };
  const api = new FakeApi();
  const logger = createLogger({ level: 'error' });
  const queue = new JobQueue({ storage, logger, handlers: {}, pollIntervalMs: 600_000 });
  const runtime = new BotRuntime({
    bot,
    template,
    api,
    storage,
    config,
    logger,
    http: new HttpClient({ ssrfProtection: false }),
    secrets: new SecretsManager({ masterKey: config.SECRET_MASTER_KEY }),
    queue,
  });
  await runtime.init();

  const makeMessage = (overrides: Partial<IncomingMessage>): IncomingMessage => ({
    platform: 'telegram',
    updateId: randomId('u_'),
    chatId: '42',
    chatType: 'private',
    userId: '42',
    firstName: 'نگار',
    text: '',
    args: '',
    attachments: [],
    isEdited: false,
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  });

  return {
    runtime,
    api,
    storage,
    async send(text) {
      await runtime.handleMessage(makeMessage({ text }));
    },
    async callback(data) {
      await runtime.handleMessage(makeMessage({ callbackData: data, callbackQueryId: 'cb' }));
    },
    async makeAdmin() {
      const user = await storage.users.findByPlatformId(bot.id, '42');
      if (!user) throw new Error('user missing');
      await storage.users.setRole(bot.id, user.id, 'admin');
    },
  };
}

test('poll bot: admin creates a poll, users vote and results aggregate', async () => {
  const h = await harness(pollQuizBot);
  await h.send('/start');
  await h.makeAdmin();

  await h.callback('a:newpoll');
  assert.match(h.api.last()?.text ?? '', /سؤال/);
  await h.send('نظرسنجی درباره ساعت کاری');
  assert.match(h.api.last()?.text ?? '', /گزینه/);
  await h.send('صبح\nعصر\nشب');
  assert.match(h.api.last()?.text ?? '', /عمومی|ناشناس/);
  await h.callback('a:mode:public');
  const pollMessage = h.api.last();
  assert.match(pollMessage?.text ?? '', /نظرسنجی درباره ساعت کاری/);
  const rows = pollMessage?.inlineKeyboard?.rows ?? [];
  assert.equal(rows.length, 4);

  const voteButtons = rows.slice(0, 3);
  const voteData = voteButtons[1][0].callbackData ?? '';
  assert.match(voteData, /^a:vote:/);
  await h.callback(voteData);
  assert.match(h.api.last()?.text ?? '', /ثبت شد/);

  const voterId = voteData.split(':')[2];
  await h.callback(`a:results:${voterId}`);
  const results = h.api.last()?.text ?? '';
  assert.match(results, /نتایج/);
  assert.match(results, /عصر/);

  await h.callback(voteData);
  assert.match(h.api.last()?.text ?? '', /ثبت شد/);
  await h.callback(`a:results:${voterId}`);
  assert.match(h.api.last()?.text ?? '', /مجموع رأی‌ها: ۱/);
});

test('form bot: admin defines a form and a submission is stored', async () => {
  const h = await harness(formBuilderBot);
  await h.send('/start');
  await h.makeAdmin();

  await h.callback('a:newform');
  await h.send('فرم عضویت باشگاه');
  await h.send('لطفاً اطلاعات خود را کامل کنید');
  await h.send('نام و نام خانوادگی*\nشماره تماس*\nسابقه ورزشی');
  assert.match(h.api.last()?.text ?? '', /ساخته شد/);

  const formDoc = await h.storage.documents.list('bot_flow', 'forms', { pageSize: 5 });
  assert.equal(formDoc.items.length, 1);
  const form = formDoc.items[0].data as { id: string; fields: Array<{ label: string; required: boolean }> };
  assert.equal(form.fields.length, 3);
  assert.equal(form.fields[0].required, true);

  await h.callback(`a:fill:${form.id}`);
  assert.match(h.api.last()?.text ?? '', /نام و نام خانوادگی/);
  await h.send('نگار احمدی');
  await h.send('09120000000');
  await h.send('بدون سابقه');
  assert.ok(
    h.api.sent.slice(-2).some((out) => /ثبت شد/.test(out.text)),
    'submission confirmation should be sent',
  );

  const submissions = await h.storage.documents.list('bot_flow', 'submissions', { pageSize: 5 });
  assert.equal(submissions.items.length, 1);
  const answers = (submissions.items[0].data as { answers: Record<string, string> }).answers;
  assert.equal(answers['شماره تماس'], '09120000000');
});

test('form bot rejects a form without fields', async () => {
  const h = await harness(formBuilderBot);
  await h.send('/start');
  await h.makeAdmin();
  await h.callback('a:newform');
  await h.send('فرم خالی');
  await h.send('توضیح');
  await h.send('   ');
  assert.match(h.api.last()?.text ?? '', /حداقل یک فیلد/);
});

test('reminder bot schedules a durable job and fires it', async () => {
  const h = await harness(reminderBot);
  await h.send('/start');
  await h.send('/remind پرداخت قبض | 10m');
  assert.match(h.api.last()?.text ?? '', /ثبت شد/);

  const reminders = await h.storage.documents.list('bot_flow', 'reminders', { pageSize: 5 });
  assert.equal(reminders.items.length, 1);
  const reminder = reminders.items[0].data as { id: string; text: string; done: boolean };
  assert.equal(reminder.text, 'پرداخت قبض');
  assert.equal(reminder.done, false);

  const jobs = await h.storage.jobs.list('bot_flow', { status: 'pending', pageSize: 10 });
  assert.equal(jobs.items.length, 1);
  assert.equal(jobs.items[0].type, 'bot.job');

  await h.runtime.executeJob('reminder.fire', { reminderId: reminder.id });
  assert.match(h.api.last()?.text ?? '', /پرداخت قبض/);

  await h.callback(`a:done:${reminder.id}`);
  assert.ok(h.api.sent.slice(-2).some((out) => /انجام‌شده ثبت شد/.test(out.text)));
  assert.match(h.api.last()?.text ?? '', /یادآوری فعالی ندارید|یادآوری‌های شما/);
  const after = await h.storage.documents.findByKey('bot_flow', 'reminders', `rem_${reminder.id}`);
  assert.equal((after?.data as { done: boolean }).done, true);
});

test('reminder bot parses Persian-friendly times and rejects invalid input', async () => {
  const h = await harness(reminderBot);
  await h.send('/start');
  await h.callback('a:add');
  assert.match(h.api.last()?.text ?? '', /متن یادآوری/);
  await h.send('جلسه تیم');
  assert.match(h.api.last()?.text ?? '', /چه زمانی/);
  await h.send('زمان نامعلوم');
  assert.match(h.api.last()?.text ?? '', /زمان قابل تشخیص نیست/);
  await h.send('14:30');
  assert.match(h.api.last()?.text ?? '', /تکرار/);
  await h.send('روزانه');
  assert.match(h.api.last()?.text ?? '', /یادآوری ثبت شد/);
  const reminders = await h.storage.documents.list('bot_flow', 'reminders', { pageSize: 5 });
  const saved = reminders.items[0].data as { repeat: string; text: string };
  assert.equal(saved.repeat, 'daily');
  assert.equal(saved.text, 'جلسه تیم');
});
