import type { AdapterCapabilities, PlatformName } from '@botforge/core';
import { BaseAdapter, type AdapterConfig, type ApiEnvelope } from './base';

export const BALE_API_BASE = 'https://tapi.bale.ai';

export class BaleAdapter extends BaseAdapter {
  readonly platform: PlatformName = 'bale';
  readonly capabilities: AdapterCapabilities = {
    inlineKeyboard: true,
    editMessage: true,
    deleteMessage: false,
    callbackQueries: true,
    files: true,
    voice: true,
    mediaGroup: false,
    htmlParseMode: true,
  };

  constructor(config: AdapterConfig) {
    super({ ...config, baseUrl: config.baseUrl ?? BALE_API_BASE });
  }

  protected endpoint(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  protected buildBody(_method: string, params: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (key === 'disable_web_page_preview') {
        body.disable_web_page_preview = value;
        continue;
      }
      body[key] = value;
    }
    return body;
  }

  protected unwrap(envelope: ApiEnvelope): { ok: boolean; result?: unknown; error?: string; code?: string } {
    if (envelope && typeof envelope === 'object' && envelope.ok === true) {
      return { ok: true, result: envelope.result };
    }
    return {
      ok: false,
      error: envelope?.description ?? envelope?.message ?? 'Bale API error',
      code: envelope?.error_code ? String(envelope.error_code) : envelope?.status,
    };
  }

  protected fileUrl(filePath: string): string {
    return `${this.baseUrl}/file/bot${this.token}/${filePath}`;
  }

  override async deleteMessage(): Promise<boolean> {
    return false;
  }
}

export function createBaleAdapter(config: AdapterConfig): BaleAdapter {
  return new BaleAdapter(config);
}
