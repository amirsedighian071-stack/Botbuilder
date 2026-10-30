import type { AdapterCapabilities, PlatformName } from '@botforge/core';
import { BaseAdapter, type AdapterConfig, type ApiEnvelope } from './base';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

export class TelegramAdapter extends BaseAdapter {
  readonly platform: PlatformName = 'telegram';
  readonly capabilities: AdapterCapabilities = {
    inlineKeyboard: true,
    editMessage: true,
    deleteMessage: true,
    callbackQueries: true,
    files: true,
    voice: true,
    mediaGroup: true,
    htmlParseMode: true,
  };

  constructor(config: AdapterConfig) {
    super({ ...config, baseUrl: config.baseUrl ?? TELEGRAM_API_BASE });
  }

  protected endpoint(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  protected buildBody(_method: string, params: Record<string, unknown>): Record<string, unknown> {
    return params;
  }

  protected unwrap(envelope: ApiEnvelope): { ok: boolean; result?: unknown; error?: string; code?: string } {
    if (envelope && typeof envelope === 'object' && envelope.ok === true) {
      return { ok: true, result: envelope.result };
    }
    return {
      ok: false,
      error: envelope?.description ?? 'Telegram API error',
      code: envelope?.error_code ? String(envelope.error_code) : undefined,
    };
  }

  protected fileUrl(filePath: string): string {
    return `${this.baseUrl}/file/bot${this.token}/${filePath}`;
  }
}

export function createTelegramAdapter(config: AdapterConfig): TelegramAdapter {
  return new TelegramAdapter(config);
}
