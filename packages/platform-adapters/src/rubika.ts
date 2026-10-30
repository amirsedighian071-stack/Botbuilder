import type { AdapterCapabilities, ChatMemberResult, InlineKeyboard, OutgoingMessage, PlatformName, SendResult } from '@botforge/core';
import { BaseAdapter, type AdapterConfig, type ApiEnvelope } from './base';

export const RUBIKA_API_BASE = 'https://botapi.rubika.ir/v3';

export interface RubikaKeypadButton {
  id: string;
  button_text: string;
  type: 'Simple';
  button_click_type?: 'Simple' | 'Selection';
}

export interface RubikaInlineKeypad {
  rows: Array<{ buttons: RubikaKeypadButton[] }>;
}

export interface RubikaChatKeypad {
  rows: Array<{ buttons: RubikaKeypadButton[] }>;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export class RubikaAdapter extends BaseAdapter {
  readonly platform: PlatformName = 'rubika';
  readonly capabilities: AdapterCapabilities = {
    inlineKeyboard: true,
    editMessage: true,
    deleteMessage: false,
    callbackQueries: true,
    files: true,
    voice: true,
    mediaGroup: false,
    htmlParseMode: false,
  };

  constructor(config: AdapterConfig) {
    super({ ...config, baseUrl: config.baseUrl ?? RUBIKA_API_BASE });
  }

  protected endpoint(method: string): string {
    return `${this.baseUrl}/${this.token}/${method}`;
  }

  protected buildBody(_method: string, params: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (key === 'inline_keyboard') {
        body.inline_keypad = this.toRubikaKeypad(value as InlineKeyboard);
        continue;
      }
      if (key === 'reply_keyboard') {
        body.chat_keypad = this.toRubikaReplyKeypad(value as { keyboard: Array<Array<{ text: string }>>; resize_keyboard?: boolean; one_time_keyboard?: boolean });
        body.chat_keypad_type = 'New';
        continue;
      }
      if (key === 'parse_mode') continue;
      body[key] = value;
    }
    return body;
  }

  protected unwrap(envelope: ApiEnvelope): { ok: boolean; result?: unknown; error?: string; code?: string } {
    if (envelope && typeof envelope === 'object') {
      if (envelope.status === 'OK') return { ok: true, result: envelope.data ?? envelope.result };
      if (typeof envelope.status === 'string' && envelope.status !== 'OK') {
        return { ok: false, error: envelope.status, code: envelope.status };
      }
      if (envelope.ok === true) return { ok: true, result: envelope.result ?? envelope.data };
    }
    return { ok: false, error: 'Rubika API error', code: 'UNKNOWN' };
  }

  protected toRubikaKeypad(keyboard: InlineKeyboard): RubikaInlineKeypad {
    let counter = 0;
    return {
      rows: keyboard.rows.map((row) => ({
        buttons: row.map((button) => {
          counter += 1;
          const id = button.callbackData && /^[a-z0-9_]{1,40}$/i.test(button.callbackData)
            ? button.callbackData
            : `btn_${Date.now().toString(36)}_${counter}`;
          return {
            id: id.slice(0, 40),
            button_text: button.text.slice(0, 40),
            type: 'Simple' as const,
            button_click_type: 'Simple' as const,
          };
        }),
      })),
    };
  }

  protected toRubikaReplyKeypad(keyboard: { rows?: Array<Array<{ text: string }>>; keyboard?: Array<Array<{ text: string }>> }): RubikaChatKeypad {
    const rows = keyboard.rows ?? keyboard.keyboard ?? [];
    return {
      rows: rows.map((row) => ({
        buttons: row.map((button, index) => ({
          id: `row_${index}`,
          button_text: button.text.slice(0, 40),
          type: 'Simple' as const,
        })),
      })),
      resize_keyboard: true,
    };
  }

  override async sendMessage(chatId: string, message: OutgoingMessage): Promise<SendResult> {
    const plain = this.capabilities.htmlParseMode ? message.text : message.text.replace(/<[^>]+>/g, '');
    return super.sendMessage(chatId, { ...message, text: plain, parseMode: undefined });
  }

  override async getMe(): Promise<{ id: string; username: string; firstName: string }> {
    try {
      const result = (await this.call('getMe', {})) as Record<string, unknown>;
      const user = (result?.user ?? result) as Record<string, unknown>;
      this.botUsername = String(user?.username ?? this.botUsername);
      return {
        id: String(user?.user_id ?? user?.id ?? this.botId),
        username: String(user?.username ?? ''),
        firstName: String(user?.first_name ?? user?.username ?? ''),
      };
    } catch {
      return { id: this.botId, username: this.botUsername, firstName: this.botUsername };
    }
  }

  override async getChatMember(chatId: string, userId: string): Promise<ChatMemberResult> {
    try {
      const result = (await this.call('getChatMember', { chat_id: chatId, user_id: userId })) as Record<string, unknown>;
      const status = String(result?.status ?? result?.member_status ?? 'unknown');
      return this.mapMemberStatus(status);
    } catch {
      return { status: 'unknown', isMember: false };
    }
  }

  override async banChatMember(chatId: string, userId: string): Promise<boolean> {
    try {
      await this.call('banChatMember', { chat_id: chatId, user_id: userId });
      return true;
    } catch {
      return false;
    }
  }

  override async unbanChatMember(chatId: string, userId: string): Promise<boolean> {
    try {
      await this.call('unbanChatMember', { chat_id: chatId, user_id: userId });
      return true;
    } catch {
      return false;
    }
  }

  override async setWebhook(url: string): Promise<boolean> {
    try {
      await this.call('updateBotEndpoints', { url });
      return true;
    } catch {
      return false;
    }
  }

  override async deleteWebhook(): Promise<boolean> {
    try {
      await this.call('updateBotEndpoints', { url: '' });
      return true;
    } catch {
      return false;
    }
  }

  override async answerCallback(): Promise<boolean> {
    return true;
  }

  override async deleteMessage(): Promise<boolean> {
    return false;
  }

  override async sendVideo(chatId: string, video: string, caption?: string): Promise<SendResult> {
    try {
      await this.call('sendFile', { chat_id: chatId, file: video, text: caption ?? '' });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  override async getFileUrl(fileId: string): Promise<string | null> {
    try {
      const result = (await this.call('getFile', { file_id: fileId })) as Record<string, unknown>;
      const url = result?.download_url ?? result?.file_url ?? result?.url;
      return url ? String(url) : null;
    } catch {
      return null;
    }
  }

  protected fileUrl(filePath: string): string {
    return filePath;
  }
}

export function createRubikaAdapter(config: AdapterConfig): RubikaAdapter {
  return new RubikaAdapter(config);
}
