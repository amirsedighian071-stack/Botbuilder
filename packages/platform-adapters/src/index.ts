import { createLogger, type Logger, type MessengerApi, type PlatformName } from '@botforge/core';
import { BaseAdapter, type AdapterConfig } from './base';
import { createBaleAdapter } from './bale';
import { createRubikaAdapter } from './rubika';
import { createTelegramAdapter } from './telegram';

export { BaseAdapter, AdapterError, buildInlineKeyboard } from './base';
export type { AdapterConfig, ApiEnvelope, MethodCallOptions } from './base';
export { TelegramAdapter, createTelegramAdapter, TELEGRAM_API_BASE } from './telegram';
export { BaleAdapter, createBaleAdapter, BALE_API_BASE } from './bale';
export { RubikaAdapter, createRubikaAdapter, RUBIKA_API_BASE } from './rubika';
export { parseUpdate, parseTelegramUpdate, parseRubikaUpdate, extractCommand } from './parse';

export const SUPPORTED_PLATFORMS: PlatformName[] = ['telegram', 'bale', 'rubika'];

export interface AdapterFactoryOptions {
  platform: PlatformName;
  token: string;
  botId: string;
  botUsername?: string;
  logger?: Logger;
  baseUrl?: string;
}

export function createAdapter(options: AdapterFactoryOptions): BaseAdapter {
  const config: AdapterConfig = {
    token: options.token,
    botId: options.botId,
    platform: options.platform,
    botUsername: options.botUsername,
    baseUrl: options.baseUrl,
    logger: options.logger ?? createLogger({ level: 'info', bindings: { adapter: options.platform } }),
  };
  switch (options.platform) {
    case 'telegram':
      return createTelegramAdapter(config);
    case 'bale':
      return createBaleAdapter(config);
    case 'rubika':
      return createRubikaAdapter(config);
    default: {
      const exhaustive: never = options.platform;
      throw new Error(`Unsupported platform: ${String(exhaustive)}`);
    }
  }
}

export function detectPlatformFromToken(token: string): PlatformName | null {
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return 'telegram';
  if (/^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) return 'bale';
  if (/^[A-Za-z0-9]{20,}$/.test(token)) return 'rubika';
  return null;
}

export function validateToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length < 20 || trimmed.length > 200) return false;
  if (/\s/.test(trimmed)) return false;
  return detectPlatformFromToken(trimmed) !== null || /^[A-Za-z0-9:_-]+$/.test(trimmed);
}

export type Adapter = BaseAdapter & MessengerApi;
