import type { AppConfig } from './config';
import type { HttpClient } from './http/client';
import type { Logger } from './logger';
import type { Storage } from './storage/types';
import type {
  Attachment,
  BotCategory,
  BotRecord,
  BotUser,
  InlineKeyboard,
  IncomingMessage,
  KeyboardButton,
  MessengerApi,
  OutgoingMessage,
  ReplyKeyboard,
} from './types';

export interface BotMenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  adminOnly?: boolean;
}

export interface BotCommandSpec {
  command: string;
  description: string;
  adminOnly?: boolean;
}

export interface BotRequirement {
  key: string;
  label: string;
  description: string;
  required: boolean;
  env?: string;
  helpUrl?: string;
}

export interface FlowState {
  state: string;
  data: Record<string, unknown>;
  startedAt: string;
}

export interface ReplyOptions {
  parseMode?: 'HTML' | 'Markdown';
  inline?: InlineKeyboard;
  keyboard?: ReplyKeyboard;
  disablePreview?: boolean;
  replyTo?: string;
}

export interface BotContext {
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
  readonly flow: FlowState | null;
  readonly services: BotServices;
  readonly params: string[];
  readonly text: string;

  reply(text: string, options?: ReplyOptions): Promise<void>;
  replyHtml(html: string, options?: ReplyOptions): Promise<void>;
  replyPhoto(url: string, caption?: string, keyboard?: InlineKeyboard): Promise<void>;
  replyDocument(url: string, fileName: string, caption?: string): Promise<void>;
  replyVoice(url: string, caption?: string): Promise<void>;
  replyVideo(url: string, caption?: string, keyboard?: InlineKeyboard): Promise<void>;
  edit(text: string, options?: ReplyOptions): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  typing(action?: 'typing' | 'upload_photo' | 'upload_document' | 'record_voice'): Promise<void>;

  showMenu(title?: string): Promise<void>;
  showAdminPanel(): Promise<void>;

  setFlow(state: string, data?: Record<string, unknown>): Promise<void>;
  updateFlow(data: Record<string, unknown>): Promise<void>;
  clearFlow(): Promise<void>;
  ask(prompt: string, state: string, data?: Record<string, unknown>): Promise<void>;

  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
  setting<T>(key: string, fallback: T): T;

  guardRate(scope: string, limit: number, windowMs: number): Promise<boolean>;
  requireConfigured(keys: string[]): Promise<boolean>;
  platformSupports(feature: 'inlineKeyboard' | 'editMessage' | 'files' | 'voice'): boolean;
  tr(fa: string, en: string): string;
  formatNumber(value: number, digits?: number): string;
  formatMoney(value: number, currency?: string): string;
  formatDate(iso: string | Date): string;
  formatDateTime(iso: string | Date): string;
  escape(text: string): string;

  notifyAdmin(text: string): Promise<void>;
  recordEvent(type: string, level: 'debug' | 'info' | 'warn' | 'error', payload?: Record<string, unknown>): Promise<void>;
  enqueue(type: string, payload?: Record<string, unknown>, runAt?: Date): Promise<void>;
}

export interface BotJobContext {
  readonly bot: BotRecord;
  readonly storage: Storage;
  readonly api: MessengerApi;
  readonly logger: Logger;
  readonly services: BotServices;
  readonly payload: Record<string, unknown>;
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
  send(chatId: string, text: string, inline?: InlineKeyboard): Promise<void>;
  enqueue(type: string, payload?: Record<string, unknown>, runAt?: Date): Promise<void>;
  notifyAdmin(text: string): Promise<void>;
}

export type BotJobHandler = (context: BotJobContext) => Promise<void>;

export interface BotServices {
  isConfigured(key: string): boolean;
  requirementStatus(): Array<{ key: string; label: string; configured: boolean; required: boolean }>;
  ai: {
    available: boolean;
    chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
    complete(prompt: string, system?: string, options?: { maxTokens?: number; temperature?: number; jsonMode?: boolean }): Promise<string>;
    json<T>(prompt: string, system: string): Promise<T | null>;
    translate(text: string, target: string): Promise<string>;
    transcribe(audioUrl: string, fileName?: string): Promise<string>;
    speech(text: string): Promise<{ data: Uint8Array; mime: string } | null>;
  };
  weather: {
    available: boolean;
    current(city: string): Promise<{
      city: string;
      temperature: number;
      apparent: number;
      humidity: number;
      windSpeed: number;
      code: number;
      description: string;
      isDay: boolean;
    }>;
    forecast(city: string, days?: number): Promise<Array<{ date: string; min: number; max: number; code: number; description: string; precipitation: number }>>;
  };
  news: {
    available: boolean;
    latest(options?: { topic?: string; limit?: number; language?: string }): Promise<Array<{ title: string; link: string; source: string; publishedAt: string; summary: string }>>;
  };
  market: {
    currencyRates(base?: string, symbols?: string[]): Promise<Record<string, number>>;
    goldPrice(): Promise<{ ounceUsd: number; gram18: number; gram24: number; mesghal: number; updatedAt: string; source: string }>;
    crypto(symbols?: string[]): Promise<Record<string, { usd: number; change24h: number }>>;
  };
  media: {
    available: boolean;
    resolve(url: string): Promise<Array<{ url: string; quality?: string; type: 'video' | 'audio' | 'image'; size?: number; thumbnail?: string }>>;
    summarizeUrl(url: string): Promise<{ title: string; text: string; siteName: string; url: string }>;
  };
  speech: {
    sttAvailable: boolean;
    ttsAvailable: boolean;
    transcribe(fileUrl: string, fileName?: string): Promise<string>;
    synthesize(text: string, voice?: string): Promise<{ data: Uint8Array; mime: string } | null>;
  };
  links: {
    shorten(url: string): Promise<string>;
    expand(url: string): Promise<string>;
  };
  webwatch: {
    check(url: string): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }>;
  };
  files: {
    download(url: string): Promise<{ data: Uint8Array; contentType: string; fileName: string | null }>;
  };
}

export type BotAction = (ctx: BotContext, param?: string) => Promise<void>;

export interface BotDefinition {
  id: string;
  name: string;
  category: BotCategory;
  summary: string;
  description: string;
  icon: string;
  tags: string[];
  version: string;
  commands: BotCommandSpec[];
  menu: BotMenuItem[];
  requirements: BotRequirement[];
  defaultConfig: Record<string, unknown>;
  actions: Record<string, BotAction>;
  onStart?: (ctx: BotContext) => Promise<void>;
  onText?: (ctx: BotContext) => Promise<void>;
  onMedia?: (ctx: BotContext, attachment: Attachment) => Promise<void>;
  onCommand?: (ctx: BotContext, command: string) => Promise<boolean>;
  steps?: Record<string, BotAction>;
  jobs?: Record<string, BotJobHandler>;
  help?: string;
}

export type { BotCategory, BotRecord, BotUser, IncomingMessage, MessengerApi, OutgoingMessage, ReplyKeyboard, KeyboardButton, InlineKeyboard };
