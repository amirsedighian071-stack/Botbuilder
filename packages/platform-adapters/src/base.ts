import {
  createLogger,
  HttpClient,
  type AdapterCapabilities,
  type ChatMemberResult,
  type InlineKeyboard,
  type Logger,
  type MessengerApi,
  type OutgoingMessage,
  type PlatformName,
  type SendResult,
} from '@botforge/core';

export interface AdapterConfig {
  token: string;
  botId: string;
  platform?: PlatformName;
  botUsername?: string;
  baseUrl?: string;
  timeoutMs?: number;
  http?: HttpClient;
  logger?: Logger;
}

export interface MethodCallOptions {
  formData?: FormData;
  signal?: AbortSignal;
}

export interface ApiEnvelope {
  ok?: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  status?: string;
  data?: unknown;
  message?: string;
}

export abstract class BaseAdapter implements MessengerApi {
  abstract readonly platform: PlatformName;
  abstract readonly capabilities: AdapterCapabilities;
  readonly botId: string;
  protected readonly token: string;
  protected readonly baseUrl: string;
  protected readonly timeoutMs: number;
  protected readonly http: HttpClient;
  protected readonly logger: Logger;
  protected botUsername: string;

  constructor(config: AdapterConfig) {
    if (!config.token) throw new Error('Bot token is required');
    this.token = config.token;
    this.botId = config.botId;
    this.baseUrl = config.baseUrl ?? '';
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.logger = config.logger ?? createLogger({ level: 'info', bindings: { adapter: config.platform ?? 'bot' } });
    this.botUsername = config.botUsername ?? '';
    this.http = config.http ?? new HttpClient({ timeoutMs: this.timeoutMs, retries: 1, ssrfProtection: false });
  }

  protected abstract endpoint(method: string): string;
  protected abstract buildBody(method: string, params: Record<string, unknown>): Record<string, unknown>;
  protected abstract unwrap(envelope: ApiEnvelope): { ok: boolean; result?: unknown; error?: string; code?: string };

  protected async call(method: string, params: Record<string, unknown> = {}, options: MethodCallOptions = {}): Promise<unknown> {
    const url = this.endpoint(method);
    const body = this.buildBody(method, params);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const payload = options.formData ?? JSON.stringify(body);
    if (options.formData) delete headers['content-type'];

    const response = await this.http.request<ApiEnvelope>(url, {
      method: 'POST',
      headers,
      body: payload as never,
      timeoutMs: this.timeoutMs,
      signal: options.signal,
      skipSsrfCheck: true,
    });

    const envelope = response.body ?? {};
    const parsed = this.unwrap(envelope);
    if (!parsed.ok) {
      throw new AdapterError(parsed.error ?? 'Unknown platform error', method, parsed.code);
    }
    return parsed.result;
  }

  async sendMessage(chatId: string, message: OutgoingMessage): Promise<SendResult> {
    try {
      const params: Record<string, unknown> = {
        chat_id: chatId,
        text: message.text,
      };
      if (message.parseMode) params.parse_mode = message.parseMode;
      if (message.disablePreview) params.disable_web_page_preview = true;
      if (message.replyToMessageId) params.reply_to_message_id = message.replyToMessageId;
      const keyboard = this.serializeKeyboard(message.inlineKeyboard);
      if (keyboard) params.inline_keyboard = keyboard;
      const reply = this.serializeReplyKeyboard(message.keyboard);
      if (reply) params.reply_keyboard = reply;

      const result = (await this.call(this.sendMethod, params)) as Record<string, unknown> | undefined;
      return { ok: true, messageId: this.extractMessageId(result) };
    } catch (error) {
      this.logger.warn('sendMessage failed', { chatId, error: (error as Error).message });
      return { ok: false, error: (error as Error).message, errorCode: (error as AdapterError).code };
    }
  }

  protected sendMethod = 'sendMessage';

  async editMessage(chatId: string, messageId: string, message: OutgoingMessage): Promise<SendResult> {
    try {
      const params: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text: message.text };
      if (message.parseMode) params.parse_mode = message.parseMode;
      const keyboard = this.serializeKeyboard(message.inlineKeyboard);
      if (keyboard) params.inline_keyboard = keyboard;
      const result = (await this.call(this.editMethod, params)) as Record<string, unknown> | undefined;
      return { ok: true, messageId: this.extractMessageId(result) ?? messageId };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  protected editMethod = 'editMessageText';

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    try {
      await this.call(this.deleteMethod, { chat_id: chatId, message_id: messageId });
      return true;
    } catch (error) {
      this.logger.debug('deleteMessage failed', { error: (error as Error).message });
      return false;
    }
  }

  protected deleteMethod = 'deleteMessage';

  async answerCallback(callbackQueryId: string, text?: string, alert = false): Promise<boolean> {
    try {
      const params: Record<string, unknown> = { callback_query_id: callbackQueryId };
      if (text) params.text = text.slice(0, 200);
      if (alert) params.show_alert = true;
      await this.call('answerCallbackQuery', params);
      return true;
    } catch {
      return false;
    }
  }

  async sendPhoto(chatId: string, photo: string, caption?: string, keyboard?: InlineKeyboard): Promise<SendResult> {
    try {
      const params: Record<string, unknown> = { chat_id: chatId, photo };
      if (caption) params.caption = caption.slice(0, 1024);
      const serialized = this.serializeKeyboard(keyboard);
      if (serialized) params.inline_keyboard = serialized;
      const result = (await this.call('sendPhoto', params)) as Record<string, unknown> | undefined;
      return { ok: true, messageId: this.extractMessageId(result) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async sendDocument(chatId: string, document: string, fileName: string, caption?: string): Promise<SendResult> {
    try {
      const params: Record<string, unknown> = { chat_id: chatId, document, file_name: fileName };
      if (caption) params.caption = caption.slice(0, 1024);
      const result = (await this.call('sendDocument', params)) as Record<string, unknown> | undefined;
      return { ok: true, messageId: this.extractMessageId(result) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async sendVoice(chatId: string, voice: string, caption?: string): Promise<SendResult> {
    try {
      const params: Record<string, unknown> = { chat_id: chatId, voice };
      if (caption) params.caption = caption.slice(0, 1024);
      const result = (await this.call('sendVoice', params)) as Record<string, unknown> | undefined;
      return { ok: true, messageId: this.extractMessageId(result) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async sendVideo(chatId: string, video: string, caption?: string, keyboard?: InlineKeyboard): Promise<SendResult> {
    try {
      const params: Record<string, unknown> = { chat_id: chatId, video, supports_streaming: true };
      if (caption) params.caption = caption.slice(0, 1024);
      const serialized = this.serializeKeyboard(keyboard);
      if (serialized) params.inline_keyboard = serialized;
      const result = (await this.call('sendVideo', params)) as Record<string, unknown> | undefined;
      return { ok: true, messageId: this.extractMessageId(result) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async sendChatAction(chatId: string, action: 'typing' | 'upload_photo' | 'upload_document' | 'record_voice'): Promise<void> {
    try {
      await this.call('sendChatAction', { chat_id: chatId, action });
    } catch {
      /* best effort only */
    }
  }

  async banChatMember(chatId: string, userId: string): Promise<boolean> {
    try {
      await this.call('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: false });
      return true;
    } catch {
      return false;
    }
  }

  async unbanChatMember(chatId: string, userId: string): Promise<boolean> {
    try {
      await this.call('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true });
      return true;
    } catch {
      return false;
    }
  }

  async getChatMember(chatId: string, userId: string): Promise<ChatMemberResult> {
    try {
      const result = (await this.call('getChatMember', { chat_id: chatId, user_id: userId })) as Record<string, unknown>;
      return this.mapMemberStatus(String(result?.status ?? 'unknown'));
    } catch {
      return { status: 'unknown', isMember: false };
    }
  }

  async getMe(): Promise<{ id: string; username: string; firstName: string }> {
    try {
      const result = (await this.call('getMe', {})) as Record<string, unknown>;
      this.botUsername = String(result?.username ?? this.botUsername);
      return {
        id: String(result?.id ?? this.botId),
        username: String(result?.username ?? ''),
        firstName: String(result?.first_name ?? result?.username ?? ''),
      };
    } catch {
      return { id: this.botId, username: this.botUsername, firstName: this.botUsername };
    }
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    try {
      await this.call('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
        drop_pending_updates: false,
      });
      return true;
    } catch (error) {
      this.logger.warn('setWebhook failed', { error: (error as Error).message });
      return false;
    }
  }

  async deleteWebhook(): Promise<boolean> {
    try {
      await this.call('deleteWebhook', { drop_pending_updates: false });
      return true;
    } catch {
      return false;
    }
  }

  async getFileUrl(fileId: string): Promise<string | null> {
    try {
      const result = (await this.call('getFile', { file_id: fileId })) as Record<string, unknown>;
      const path = String(result?.file_path ?? '');
      if (!path) return null;
      return this.fileUrl(path);
    } catch {
      return null;
    }
  }

  protected abstract fileUrl(filePath: string): string;

  protected mapMemberStatus(raw: string): ChatMemberResult {
    const status = raw.toLowerCase();
    if (status === 'creator' || status === 'owner') return { status: 'creator', isMember: true };
    if (status === 'administrator' || status === 'admin') return { status: 'administrator', isMember: true };
    if (status === 'member') return { status: 'member', isMember: true };
    if (status === 'restricted') return { status: 'restricted', isMember: true };
    if (status === 'left') return { status: 'left', isMember: false };
    if (status === 'kicked') return { status: 'kicked', isMember: false };
    return { status: 'unknown', isMember: false };
  }

  protected extractMessageId(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const record = result as Record<string, unknown>;
    const value = record.message_id ?? record.messageId ?? record.id;
    return value === undefined ? undefined : String(value);
  }

  protected serializeKeyboard(keyboard?: InlineKeyboard): unknown {
    if (!keyboard) return undefined;
    return keyboard.rows.map((row) =>
      row.map((button) =>
        button.url
          ? { text: button.text, url: button.url }
          : { text: button.text, callback_data: (button.callbackData ?? '').slice(0, 64) },
      ),
    );
  }

  protected serializeReplyKeyboard(keyboard?: OutgoingMessage['keyboard']): unknown {
    if (!keyboard) return undefined;
    return {
      keyboard: keyboard.rows.map((row) =>
        row.map((button) =>
          button.requestContact ? { text: button.text, request_contact: true } : { text: button.text },
        ),
      ),
      resize_keyboard: keyboard.resize ?? true,
      one_time_keyboard: keyboard.oneTime ?? false,
    };
  }
}

export class AdapterError extends Error {
  readonly code?: string;
  readonly method: string;
  constructor(message: string, method: string, code?: string) {
    super(message);
    this.name = 'AdapterError';
    this.method = method;
    this.code = code;
  }
}

export function buildInlineKeyboard(rows: Array<Array<{ text: string; data?: string; url?: string }>>): InlineKeyboard {
  return {
    rows: rows.map((row) => row.map((button) => ({ text: button.text, callbackData: button.data, url: button.url }))),
  };
}
