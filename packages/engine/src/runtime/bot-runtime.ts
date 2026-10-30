import {
  AppError,
  SlidingWindowRateLimiter,
  escapeHtml as coreEscapeHtml,
  formatDate as coreFormatDate,
  formatDateTime as coreFormatDateTime,
  formatMoney as coreFormatMoney,
  formatNumber as coreFormatNumber,
  isAppError,
  toErrorMessage,
  type AppConfig,
  type BotContext,
  type BotDefinition,
  type BotJobContext,
  type BotRecord,
  type BotServices,
  type BotStatus,
  type BotUser,
  type HttpClient,
  type IncomingMessage,
  type InlineKeyboard,
  type JobRecord,
  type Logger,
  type MessengerApi,
  type OutgoingMessage,
  type ReplyOptions,
  type SecretsManager,
  type Storage,
  type FlowState,
  type ReplyKeyboard,
} from '@botforge/core';
import { extractCommand, parseUpdate } from '@botforge/platform-adapters';
import { handleAdminAction, handleAdminCommand, handleAdminFlow, renderAdminHome, type AdminBridge } from '../admin/panel';
import { BroadcastService } from '../admin/broadcast';
import { buildForceMembershipPrompt, checkMembership, invalidateMembershipCache, isForceMembershipActive } from '../force-membership';
import type { JobQueue } from '../queue/worker';
import { createBotServices, type BuiltServices } from '../services';
import { BotSettingsStore } from './settings';

export interface BotRuntimeOptions {
  bot: BotRecord;
  template: BotDefinition;
  api: MessengerApi;
  storage: Storage;
  config: AppConfig;
  logger: Logger;
  http: HttpClient;
  secrets: SecretsManager;
  queue: JobQueue;
  userRateLimit?: { limit: number; windowMs: number };
}

const FLOW_KEY = 'flow';
const KEYBOARD_MAP_KEY = 'kbd_map';
const MENU_TTL_MS = 60_000;

interface KeyboardMapEntry {
  label: string;
  data: string;
  expiresAt: number;
}

class BotContextImpl implements BotContext {
  readonly bot: BotRecord;
  readonly api: MessengerApi;
  readonly storage: Storage;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly http: HttpClient;
  readonly message: IncomingMessage;
  readonly user: BotUser;
  readonly isAdmin: boolean;
  readonly isGroup: boolean;
  readonly language: 'fa' | 'en';
  readonly services: BotServices;
  readonly params: string[];
  readonly text: string;
  flow: FlowState | null;

  private readonly runtime: BotRuntime;

  constructor(runtime: BotRuntime, params: {
    message: IncomingMessage;
    user: BotUser;
    isAdmin: boolean;
    services: BotServices;
    flow: FlowState | null;
  }) {
    this.runtime = runtime;
    this.bot = runtime.botRecord;
    this.api = runtime.apiClient;
    this.storage = runtime.storageRef;
    this.config = runtime.appConfig;
    this.logger = runtime.loggerRef;
    this.http = runtime.httpClient;
    this.message = params.message;
    this.user = params.user;
    this.isAdmin = params.isAdmin;
    this.isGroup = params.message.chatType === 'group';
    this.language = params.user.language === 'en' ? 'en' : 'fa';
    this.services = params.services;
    this.flow = params.flow;
    this.text = params.message.text;
    this.params = params.message.args.split(/\s+/).filter(Boolean);
  }

  async reply(text: string, options: ReplyOptions = {}): Promise<void> {
    await this.runtime.send(this.message.chatId, {
      text,
      parseMode: options.parseMode ?? 'HTML',
      inlineKeyboard: options.inline,
      keyboard: options.keyboard,
      disablePreview: options.disablePreview ?? true,
      replyToMessageId: options.replyTo,
    });
  }

  async replyHtml(html: string, options: ReplyOptions = {}): Promise<void> {
    await this.reply(html, { ...options, parseMode: 'HTML' });
  }

  async replyPhoto(url: string, caption?: string, keyboard?: InlineKeyboard): Promise<void> {
    if (this.platformSupports('files')) {
      const result = await this.api.sendPhoto(this.message.chatId, url, caption, keyboard);
      if (result.ok) return;
    }
    await this.reply(`${caption ?? ''}\n${url}`.trim(), { inline: keyboard });
  }

  async replyDocument(url: string, fileName: string, caption?: string): Promise<void> {
    if (this.platformSupports('files')) {
      const result = await this.api.sendDocument(this.message.chatId, url, fileName, caption);
      if (result.ok) return;
    }
    await this.reply(`${caption ?? ''}\n${url}`.trim());
  }

  async replyVoice(url: string, caption?: string): Promise<void> {
    if (this.platformSupports('voice')) {
      const result = await this.api.sendVoice(this.message.chatId, url, caption);
      if (result.ok) return;
    }
    await this.reply(`${caption ?? ''}\n${url}`.trim());
  }

  async replyVideo(url: string, caption?: string, keyboard?: InlineKeyboard): Promise<void> {
    const result = await this.api.sendVideo(this.message.chatId, url, caption, keyboard);
    if (!result.ok) await this.reply(`${caption ?? ''}\n${url}`.trim(), { inline: keyboard });
  }

  async edit(text: string, options: ReplyOptions = {}): Promise<void> {
    if (this.api.capabilities.editMessage && this.message.messageId) {
      const result = await this.api.editMessage(this.message.chatId, this.message.messageId, {
        text,
        parseMode: options.parseMode ?? 'HTML',
        inlineKeyboard: options.inline,
      });
      if (result.ok) return;
    }
    await this.reply(text, options);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.api.deleteMessage(this.message.chatId, messageId);
  }

  async typing(action: 'typing' | 'upload_photo' | 'upload_document' | 'record_voice' = 'typing'): Promise<void> {
    await this.api.sendChatAction(this.message.chatId, action);
  }

  async showMenu(title?: string): Promise<void> {
    await this.runtime.renderMenu(this.message.chatId, title);
  }

  async showAdminPanel(): Promise<void> {
    await renderAdminHome(this, this.runtime.adminBridge());
  }

  async setFlow(state: string, data: Record<string, unknown> = {}): Promise<void> {
    this.flow = { state, data, startedAt: new Date().toISOString() };
    await this.storage.sessions.set(this.bot.id, this.user.id, FLOW_KEY, this.flow, 3600);
  }

  async updateFlow(data: Record<string, unknown>): Promise<void> {
    if (!this.flow) return;
    this.flow = { ...this.flow, data: { ...this.flow.data, ...data } };
    await this.storage.sessions.set(this.bot.id, this.user.id, FLOW_KEY, this.flow, 3600);
  }

  async clearFlow(): Promise<void> {
    this.flow = null;
    await this.storage.sessions.delete(this.bot.id, this.user.id, FLOW_KEY);
  }

  async ask(prompt: string, state: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.setFlow(state, data);
    await this.reply(prompt);
  }

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    return this.runtime.settings.get(key, fallback);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.runtime.settings.set(key, value);
  }

  setting<T>(key: string, fallback: T): T {
    return this.runtime.settingsSnapshot[key] === undefined ? fallback : (this.runtime.settingsSnapshot[key] as T);
  }

  async guardRate(scope: string, limit: number, windowMs: number): Promise<boolean> {
    return this.runtime.guardRate(`${this.user.id}:${scope}`, limit, windowMs);
  }

  async requireConfigured(keys: string[]): Promise<boolean> {
    const missing = keys.filter((key) => !this.services.isConfigured(key));
    if (missing.length === 0) return true;
    const labels = missing
      .map((key) => {
        const requirement = this.runtime.template.requirements.find((item) => item.key === key);
        return `• ${requirement?.label ?? key} — کلید <code>${key}</code>`;
      })
      .join('\n');
    await this.reply(
      `برای استفاده از این بخش، سرویس‌های زیر باید پیکربندی شوند:\n\n${labels}\n\n` +
        'مدیر ربات می‌تواند از دستور /admin و بخش «کلیدهای سرویس» مقداردهی کند.',
    );
    return false;
  }

  platformSupports(feature: 'inlineKeyboard' | 'editMessage' | 'files' | 'voice'): boolean {
    const capabilities = this.api.capabilities;
    if (feature === 'inlineKeyboard') return capabilities.inlineKeyboard;
    if (feature === 'editMessage') return capabilities.editMessage;
    if (feature === 'files') return capabilities.files;
    return capabilities.voice;
  }

  tr(fa: string, en: string): string {
    return this.language === 'en' ? en : fa;
  }

  formatNumber(value: number, digits = 2): string {
    return coreFormatNumber(value, this.language, digits);
  }

  formatMoney(value: number, currency = 'تومان'): string {
    return coreFormatMoney(value, this.language, currency);
  }

  formatDate(iso: string | Date): string {
    return coreFormatDate(iso, this.language);
  }

  formatDateTime(iso: string | Date): string {
    return coreFormatDateTime(iso, this.language);
  }

  escape(text: string): string {
    return coreEscapeHtml(text);
  }

  async notifyAdmin(text: string): Promise<void> {
    await this.runtime.notifyAdmins(text);
  }

  async recordEvent(type: string, level: 'debug' | 'info' | 'warn' | 'error', payload: Record<string, unknown> = {}): Promise<void> {
    await this.runtime.recordEvent(type, level, payload);
  }

  async enqueue(type: string, payload: Record<string, unknown> = {}, runAt?: Date): Promise<void> {
    await this.runtime.enqueueBotJob(type, payload, runAt);
  }
}

export class BotRuntime implements AdminBridge {
  readonly bot: BotRecord;
  readonly template: BotDefinition;
  readonly api: MessengerApi;
  readonly storage: Storage;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly settings: BotSettingsStore;
  readonly broadcast: BroadcastService;
  readonly http: HttpClient;
  readonly secrets: SecretsManager;

  private readonly userLimiter: SlidingWindowRateLimiter;
  private readonly scopedLimiters = new Map<string, SlidingWindowRateLimiter>();
  private readonly servicesCacheTtlMs = 60_000;
  private servicesCache: { at: number; built: BuiltServices } | null = null;
  private readonly menuCache = new Map<string, { text: string; keyboard: InlineKeyboard; at: number }>();
  settingsSnapshot: Record<string, unknown> = {};

  get botRecord(): BotRecord {
    return this.bot;
  }

  get apiClient(): MessengerApi {
    return this.api;
  }

  get storageRef(): Storage {
    return this.storage;
  }

  get appConfig(): AppConfig {
    return this.config;
  }

  get loggerRef(): Logger {
    return this.logger;
  }

  get httpClient(): HttpClient {
    return this.http;
  }

  constructor(options: BotRuntimeOptions) {
    this.bot = options.bot;
    this.template = options.template;
    this.api = options.api;
    this.storage = options.storage;
    this.config = options.config;
    this.logger = options.logger;
    this.queue = options.queue;
    this.http = options.http;
    this.secrets = options.secrets;
    this.settings = new BotSettingsStore({
      storage: options.storage,
      botId: options.bot.id,
      secrets: options.secrets,
      baseConfig: options.bot.config,
      defaults: options.template.defaultConfig,
    });
    this.broadcast = new BroadcastService({
      bot: options.bot,
      api: options.api,
      storage: options.storage,
      settings: this.settings,
      logger: options.logger,
      batchSize: options.config.BROADCAST_BATCH_SIZE,
      ratePerSecond: options.config.BROADCAST_RATE_PER_SECOND,
    });
    const limit = options.userRateLimit ?? { limit: 20, windowMs: 10_000 };
    this.userLimiter = new SlidingWindowRateLimiter({ limit: limit.limit, windowMs: limit.windowMs });
  }

  async init(): Promise<void> {
    this.settingsSnapshot = await this.settings.all().catch(() => ({}));
    await this.recordEvent('bot.init', 'info', { template: this.template.id, platform: this.bot.platform });
  }

  adminBridge(): AdminBridge {
    return this;
  }

  templateName(): string {
    return this.template.name;
  }

  templateMenu(): Array<{ id: string; label: string; adminOnly?: boolean }> {
    return this.template.menu;
  }

  requirements(): Array<{ key: string; label: string; configured: boolean; required: boolean }> {
    const requirements = this.template.requirements;
    return requirements.map((requirement) => ({
      key: requirement.key,
      label: requirement.label,
      required: requirement.required,
      configured: this.servicesBuilt?.isConfigured(requirement.key) ?? false,
    }));
  }

  private servicesBuilt: BuiltServices | null = null;

  async services(): Promise<BotServices> {
    const built = await this.getBuiltServices();
    return built.services;
  }

  private async getBuiltServices(): Promise<BuiltServices> {
    const now = Date.now();
    if (this.servicesCache && now - this.servicesCache.at < this.servicesCacheTtlMs) {
      return this.servicesCache.built;
    }
    const built = await createBotServices(
      {
        http: this.http,
        config: this.config,
        logger: this.logger,
        getSetting: (key, fallback) => this.settings.get(key, fallback),
      },
      this.template.requirements,
    );
    this.servicesCache = { at: now, built };
    this.servicesBuilt = built;
    return built;
  }

  async updateStatus(status: BotStatus): Promise<void> {
    await this.storage.bots.update(this.bot.id, { status });
    this.bot.status = status;
    await this.recordEvent('bot.status', 'info', { status });
    this.logger.info('bot status changed', { botId: this.bot.id, status });
  }

  async recordEvent(type: string, level: 'debug' | 'info' | 'warn' | 'error', payload: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.storage.events.log({ botId: this.bot.id, type, level, payload });
    } catch (error) {
      this.logger.warn('event log failed', { error: toErrorMessage(error) });
    }
  }

  async notifyAdmins(text: string): Promise<void> {
    try {
      const admins = await this.storage.users.list(this.bot.id, { role: 'admin', pageSize: 5 });
      const owners = await this.storage.users.list(this.bot.id, { role: 'owner', pageSize: 3 });
      const targets = [...owners.items, ...admins.items];
      for (const admin of targets) {
        await this.api.sendMessage(admin.chatId, { text, parseMode: 'HTML', disablePreview: true });
      }
    } catch (error) {
      this.logger.warn('notify admins failed', { error: toErrorMessage(error) });
    }
  }

  guardRate(key: string, limit: number, windowMs: number): boolean {
    const scoped = `${key}:${limit}:${windowMs}`;
    let limiter = this.scopedLimiters.get(scoped);
    if (!limiter) {
      limiter = new SlidingWindowRateLimiter({ limit, windowMs });
      this.scopedLimiters.set(scoped, limiter);
    }
    return limiter.consume(key).allowed;
  }

  async handleUpdate(raw: unknown): Promise<void> {
    const message = parseUpdate(this.bot.platform, raw);
    if (!message) return;
    await this.handleMessage(message);
  }

  async handleMessage(message: IncomingMessage): Promise<void> {
    const fresh = await this.storage.updates.mark(this.bot.id, message.updateId);
    if (!fresh) {
      this.logger.debug('duplicate update ignored', { updateId: message.updateId });
      return;
    }

    let user: BotUser;
    try {
      const result = await this.storage.users.upsert({
        botId: this.bot.id,
        platform: message.platform,
        platformUserId: message.userId,
        chatId: message.chatId,
        username: message.username,
        firstName: message.firstName,
        language: 'fa',
      });
      user = result.user;
      if (result.created) {
        await this.recordEvent('user.created', 'info', { userId: message.userId });
      }
    } catch (error) {
      this.logger.error('user upsert failed', { error: toErrorMessage(error) });
      return;
    }

    await this.storage.messages
      .log({
        botId: this.bot.id,
        platform: this.bot.platform,
        direction: 'in',
        chatId: message.chatId,
        userId: message.userId,
        text: message.text || message.callbackData || '[media]',
      })
      .catch(() => undefined);
    await this.storage.users.touch(this.bot.id, message.userId, 1).catch(() => undefined);

    if (user.isBlocked) {
      this.logger.debug('blocked user ignored', { userId: user.id });
      return;
    }

    const rate = this.userLimiter.consume(user.id);
    if (!rate.allowed) {
      const notified = await this.storage.sessions.get<number>(this.bot.id, user.id, 'rate_notice');
      if (!notified) {
        await this.api.sendMessage(message.chatId, {
          text: 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند لحظه صبر کنید.',
          disablePreview: true,
        });
        await this.storage.sessions.set(this.bot.id, user.id, 'rate_notice', Date.now(), Math.max(5, rate.retryAfterSeconds));
      }
      return;
    }

    if (this.bot.status === 'disabled') return;

    const isAdmin = await this.resolveAdmin(message, user);

    if (this.bot.status === 'maintenance' && !isAdmin) {
      await this.api.sendMessage(message.chatId, {
        text: 'ربات در حال به‌روزرسانی است. لطفاً کمی بعد دوباره تلاش کنید.',
        disablePreview: true,
      });
      return;
    }
    if (this.bot.status === 'paused' && !isAdmin) {
      return;
    }

    const built = await this.getBuiltServices();
    const flow = await this.storage.sessions.get<FlowState>(this.bot.id, user.id, FLOW_KEY);
    const ctx = new BotContextImpl(this, { message, user, isAdmin, services: built.services, flow: flow ?? null });

    if (!(await this.enforceMembership(ctx))) return;

    try {
      await this.dispatch(ctx, built);
    } catch (error) {
      await this.handleError(ctx, error);
    }
  }

  private async resolveAdmin(message: IncomingMessage, user: BotUser): Promise<boolean> {
    if (user.role === 'admin' || user.role === 'owner') return true;
    if (message.chatType !== 'group') return false;
    const member = await this.api.getChatMember(message.chatId, message.userId);
    return member.status === 'administrator' || member.status === 'creator';
  }

  private async dispatch(ctx: BotContext, built: BuiltServices): Promise<void> {
    const message = ctx.message;
    const bridge = this.adminBridge();

    if (message.callbackData) {
      await this.api.answerCallback(message.callbackQueryId ?? '', '');
      const handled = await this.handleCallback(ctx, bridge, message.callbackData);
      if (!handled) {
        this.logger.debug('unhandled callback', { data: message.callbackData });
      }
      return;
    }

    const parsed = message.command ? { command: message.command, args: message.args } : extractCommand(message.text);

    if (ctx.flow && ctx.isAdmin) {
      if (await handleAdminFlow(ctx, bridge, ctx.flow.state, ctx.flow.data)) return;
    }

    if (parsed.command) {
      const command = parsed.command;
      if (command === 'start') {
        await ctx.clearFlow();
        if (this.template.onStart) await this.template.onStart(ctx);
        else await this.renderMenu(message.chatId);
        return;
      }
      if (command === 'menu') {
        await this.renderMenu(message.chatId);
        return;
      }
      if (command === 'help') {
        await this.sendHelp(ctx);
        return;
      }
      if (command === 'id') {
        const lines = [
          `شناسه شما: <code>${message.userId}</code>`,
          `شناسه گفتگو: <code>${message.chatId}</code>`,
        ];
        if (ctx.user.username) lines.push(`نام کاربری: @${ctx.user.username}`);
        await ctx.reply(lines.join('\n'));
        return;
      }
      if (command === 'cancel' || command === 'reset') {
        await ctx.clearFlow();
        await ctx.reply('عملیات جاری لغو شد.');
        await this.renderMenu(message.chatId);
        return;
      }

      const adminCommand = await handleAdminCommand(ctx, bridge, command);
      if (adminCommand.handled) return;

      if (this.template.onCommand) {
        const handled = await this.template.onCommand(ctx, command);
        if (handled) return;
      }

      const mapped = this.template.actions[command];
      if (mapped) {
        await mapped(ctx, parsed.args);
        return;
      }

      const commandSpec = this.template.commands.find((item) => item.command === command);
      if (!commandSpec) {
        await ctx.reply('دستور ناشناخته. برای دیدن منو از /menu استفاده کنید.');
        return;
      }
      await this.renderMenu(message.chatId);
      return;
    }

    if (ctx.flow && !this.template.steps?.[ctx.flow.state] && !ctx.flow.state.startsWith('__admin')) {
      await ctx.clearFlow();
    }

    if (message.attachments.length > 0 && this.template.onMedia) {
      await this.template.onMedia(ctx, message.attachments[0]);
      return;
    }

    if (ctx.flow && this.template.steps?.[ctx.flow.state]) {
      await this.template.steps[ctx.flow.state](ctx, ctx.text);
      return;
    }

    if (!ctx.flow) {
      const keyboardEntry = await this.resolveTextKeyboardSelection(ctx);
      if (keyboardEntry) {
        const handled = await this.handleCallback(ctx, bridge, keyboardEntry);
        if (handled) return;
      }
    }

    if (ctx.isGroup && !this.template.tags.includes('group') && !this.template.onText) {
      return;
    }

    if (this.template.onText) {
      await this.template.onText(ctx);
      return;
    }

    await ctx.reply('برای شروع از /menu استفاده کنید.');
  }

  private async handleCallback(ctx: BotContext, bridge: AdminBridge, data: string): Promise<boolean> {
    if (data === 'a:__fsm_check') {
      await invalidateMembershipCache({ botId: this.bot.id, userId: ctx.user.id, storage: this.storage });
      const allowed = await this.enforceMembership(ctx);
      if (allowed) {
        await ctx.reply('عضویت شما تأیید شد. خوش آمدید.');
        await this.renderMenu(ctx.message.chatId);
      }
      return true;
    }
    if (data === 'a:__menu') {
      await this.renderMenu(ctx.message.chatId);
      return true;
    }
    if (data.startsWith('adm:')) {
      const parts = data.slice(4).split(':');
      const action = parts[0];
      const args = parts.slice(1);
      return handleAdminAction(ctx, bridge, action, args);
    }
    if (data.startsWith('a:')) {
      const parts = data.slice(2).split(':');
      const actionId = parts[0];
      const param = parts.slice(1).join(':');
      const action = this.template.actions[actionId];
      if (!action) {
        await ctx.reply('این گزینه در دسترس نیست.');
        return true;
      }
      await action(ctx, param);
      return true;
    }
    return false;
  }

  private async resolveTextKeyboardSelection(ctx: BotContext): Promise<string | null> {
    const raw = ctx.text.trim();
    if (!/^\d{1,2}$/.test(raw)) return null;
    const map = await this.storage.sessions.get<Record<string, KeyboardMapEntry>>(this.bot.id, ctx.user.id, KEYBOARD_MAP_KEY);
    if (!map) return null;
    const entry = map[raw];
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) return null;
    return entry.data;
  }

  private async enforceMembership(ctx: BotContext): Promise<boolean> {
    const config = this.bot.forceMembership;
    if (!isForceMembershipActive(config)) return true;
    if (ctx.isAdmin && config.bypassAdmins) return true;
    const result = await checkMembership({
      bot: this.bot,
      api: this.api,
      storage: this.storage,
      userId: ctx.user.id,
    });
    if (result.ok) return true;
    const prompt = buildForceMembershipPrompt(config, result.missing);
    await ctx.reply(prompt.text, { inline: prompt.keyboard });
    return false;
  }

  async send(chatId: string, message: OutgoingMessage): Promise<void> {
    const prepared = this.prepareOutgoing(message);
    if (prepared.inlineKeyboard && !this.api.capabilities.inlineKeyboard) {
      const { text, map } = this.flattenKeyboard(prepared.text, prepared.inlineKeyboard);
      await this.api.sendMessage(chatId, { ...prepared, text, inlineKeyboard: undefined });
      if (Object.keys(map).length > 0) {
        await this.storage.sessions.set(
          this.bot.id,
          chatId,
          KEYBOARD_MAP_KEY,
          map,
          600,
        );
      }
      return;
    }
    const result = await this.api.sendMessage(chatId, prepared);
    if (!result.ok) {
      this.logger.warn('message send failed', { chatId, error: result.error });
      await this.recordEvent('message.send_failed', 'warn', { chatId, error: result.error });
    }
    await this.storage.messages
      .log({
        botId: this.bot.id,
        platform: this.bot.platform,
        direction: 'out',
        chatId,
        userId: chatId,
        text: prepared.text,
        status: result.ok ? 'ok' : 'failed',
      })
      .catch(() => undefined);
  }

  private prepareOutgoing(message: OutgoingMessage): OutgoingMessage {
    if (!this.api.capabilities.htmlParseMode && message.parseMode === 'HTML') {
      return {
        ...message,
        text: message.text.replace(/<\/?(b|strong|i|em|code|pre|a)[^>]*>/gi, ''),
        parseMode: undefined,
      };
    }
    return message;
  }

  private flattenKeyboard(text: string, keyboard: InlineKeyboard): { text: string; map: Record<string, KeyboardMapEntry> } {
    const map: Record<string, KeyboardMapEntry> = {};
    const lines: string[] = [text, ''];
    let counter = 0;
    const expiresAt = Date.now() + 600_000;
    for (const row of keyboard.rows) {
      for (const button of row) {
        if (!button.callbackData) {
          if (button.url) lines.push(`${button.text}: ${button.url}`);
          continue;
        }
        counter += 1;
        map[String(counter)] = { label: button.text, data: button.callbackData, expiresAt };
        lines.push(`${counter}. ${button.text}`);
      }
    }
    if (counter > 0) lines.push('', 'شماره گزینه مورد نظر را ارسال کنید.');
    return { text: lines.join('\n'), map };
  }

  async renderMenu(chatId: string, title?: string): Promise<void> {
    const cached = this.menuCache.get(chatId);
    if (cached && Date.now() - cached.at < MENU_TTL_MS && !title) {
      await this.send(chatId, { text: cached.text, inlineKeyboard: cached.keyboard, parseMode: 'HTML' });
      return;
    }

    const items = this.template.menu;
    const rows: InlineKeyboard['rows'] = [];
    for (let index = 0; index < items.length; index += 2) {
      rows.push(
        items.slice(index, index + 2).map((item) => ({
          text: item.label,
          callbackData: `a:${item.id}`,
        })),
      );
    }
    rows.push([{ text: 'پنل مدیریت', callbackData: 'adm:home' }]);

    const header = title ?? [
      `<b>${coreEscapeHtml(this.template.name)}</b>`,
      '',
      this.template.summary,
      '',
      'یک گزینه را انتخاب کنید:',
    ].join('\n');
    const text = header;
    const keyboard: InlineKeyboard = { rows };
    this.menuCache.set(chatId, { text, keyboard, at: Date.now() });
    await this.send(chatId, { text, inlineKeyboard: keyboard, parseMode: 'HTML' });
  }

  private async sendHelp(ctx: BotContext): Promise<void> {
    const commands = this.template.commands
      .map((command) => `/${command.command} — ${command.description}${command.adminOnly ? ' (مدیر)' : ''}`)
      .join('\n');
    const lines = [
      `<b>راهنمای ${coreEscapeHtml(this.template.name)}</b>`,
      '',
      this.template.help ?? this.template.description,
      '',
      '<b>دستورها</b>',
      commands || '/menu — منوی اصلی',
      '',
      '<b>دستورهای عمومی</b>',
      '/menu — منوی اصلی',
      '/cancel — لغو عملیات جاری',
      '/id — شناسه شما',
      '/help — همین راهنما',
      '',
      ADMIN_HELP_SUMMARY,
    ];
    await ctx.reply(lines.join('\n'), { inline: { rows: [[{ text: 'منوی اصلی', callbackData: 'a:__menu' }]] } });
  }

  async handleError(ctx: BotContext, error: unknown): Promise<void> {
    const message = error instanceof AppError ? error.message : toErrorMessage(error);
    this.logger.error('handler error', {
      botId: this.bot.id,
      userId: ctx.user.id,
      error: message,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
    });
    await this.recordEvent('handler.error', 'error', { error: message.slice(0, 500) });
    const userMessage = isAppError(error) && error.expose
      ? message
      : 'خطایی رخ داد. لطفاً دوباره تلاش کنید یا بعداً سر بزنید.';
    try {
      await ctx.reply(userMessage);
    } catch {
      /* ignore delivery failures */
    }
  }

  async enqueue(type: string, payload: Record<string, unknown>, options: { runAt?: Date; maxAttempts?: number } = {}): Promise<JobRecord> {
    return this.queue.enqueue(this.bot.id, type, payload, options);
  }

  async enqueueBotJob(type: string, payload: Record<string, unknown> = {}, runAt?: Date): Promise<void> {
    await this.queue.enqueue(this.bot.id, 'bot.job', { jobType: type, payload }, { runAt });
  }

  async executeJob(jobType: string, payload: Record<string, unknown>): Promise<void> {
    const handler = this.template.jobs?.[jobType];
    if (!handler) throw new Error(`Job type "${jobType}" is not registered by template ${this.template.id}`);
    const built = await this.getBuiltServices();
    const jobContext: BotJobContext = {
      bot: this.bot,
      storage: this.storage,
      api: this.api,
      logger: this.logger.child({ jobType }),
      services: built.services,
      payload,
      getSetting: (key, fallback) => this.settings.get(key, fallback),
      setSetting: (key, value) => this.settings.set(key, value),
      send: async (chatId, text, inline) => {
        await this.send(chatId, { text, parseMode: 'HTML', inlineKeyboard: inline, disablePreview: true });
      },
      enqueue: (type, jobPayload, runAt) => this.enqueueBotJob(type, jobPayload ?? {}, runAt),
      notifyAdmin: (text) => this.notifyAdmins(text),
    };
    await handler(jobContext);
  }
}

const ADMIN_HELP_SUMMARY = '<b>مدیریت</b>\n/admin — پنل مدیریت\n/stats — آمار\n/broadcast — پیام همگانی';
