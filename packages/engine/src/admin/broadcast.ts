import {
  toErrorMessage,
  type BotRecord,
  type JobRecord,
  type Logger,
  type MessengerApi,
  type Storage,
} from '@botforge/core';
import { TokenBucket } from '@botforge/core';
import { BotSettingsStore } from '../runtime/settings';

export interface BroadcastProgress {
  active: boolean;
  sent: number;
  failed: number;
  total: number;
  startedAt: string;
  finishedAt?: string;
  text: string;
  lastError?: string;
}

const PROGRESS_KEY = '__broadcast_progress';

export interface BroadcastPayload {
  text: string;
  parseMode?: 'HTML' | 'Markdown';
  offset: number;
  total: number;
  sent: number;
  failed: number;
  startedAt: string;
}

export interface BroadcastServiceOptions {
  bot: BotRecord;
  api: MessengerApi;
  storage: Storage;
  settings: BotSettingsStore;
  logger: Logger;
  batchSize?: number;
  ratePerSecond?: number;
}

export class BroadcastService {
  private readonly bucket: TokenBucket;
  private readonly batchSize: number;

  constructor(private readonly options: BroadcastServiceOptions) {
    this.batchSize = Math.max(1, options.batchSize ?? 25);
    this.bucket = new TokenBucket(10, options.ratePerSecond ?? 5);
  }

  async start(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<{ total: number; job: JobRecord }> {
    const total = await this.options.storage.users.count(this.options.bot.id);
    if (total === 0) throw new Error('هیچ کاربری برای ارسال پیام همگانی وجود ندارد');
    const payload: BroadcastPayload = {
      text,
      parseMode,
      offset: 0,
      total,
      sent: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    };
    const job = await this.options.storage.jobs.create({
      botId: this.options.bot.id,
      type: 'broadcast.batch',
      payload: payload as unknown as Record<string, unknown>,
      maxAttempts: 3,
    });
    await this.saveProgress({
      active: true,
      sent: 0,
      failed: 0,
      total,
      startedAt: payload.startedAt,
      text: text.slice(0, 200),
    });
    return { total, job };
  }

  async processBatch(payload: BroadcastPayload): Promise<BroadcastPayload | null> {
    const users = await this.options.storage.users.listAll(this.options.bot.id, this.batchSize, payload.offset);
    if (users.length === 0) {
      await this.finish(payload);
      return null;
    }

    let sent = payload.sent;
    let failed = payload.failed;
    let lastError: string | undefined;

    for (const user of users) {
      if (user.isBlocked) continue;
      await this.bucket.take(1);
      const result = await this.options.api.sendMessage(user.chatId, {
        text: payload.text,
        parseMode: payload.parseMode ?? 'HTML',
        disablePreview: true,
      });
      if (result.ok) {
        sent += 1;
        await this.options.storage.messages.log({
          botId: this.options.bot.id,
          platform: this.options.bot.platform,
          direction: 'out',
          chatId: user.chatId,
          userId: user.platformUserId,
          text: payload.text,
          status: 'broadcast',
        });
      } else {
        failed += 1;
        lastError = result.error;
        if (/blocked|deactivated|chat not found|403/i.test(result.error ?? '')) continue;
      }
    }

    const nextOffset = payload.offset + users.length;
    const next: BroadcastPayload = { ...payload, offset: nextOffset, sent, failed };
    const isDone = nextOffset >= payload.total || users.length < this.batchSize;

    await this.saveProgress({
      active: !isDone,
      sent,
      failed,
      total: payload.total,
      startedAt: payload.startedAt,
      finishedAt: isDone ? new Date().toISOString() : undefined,
      text: payload.text.slice(0, 200),
      lastError,
    });

    if (isDone) {
      await this.finish(next, lastError);
      return null;
    }

    await this.options.storage.jobs.create({
      botId: this.options.bot.id,
      type: 'broadcast.batch',
      payload: next as unknown as Record<string, unknown>,
      maxAttempts: 3,
    });
    return next;
  }

  private async finish(payload: BroadcastPayload, lastError?: string): Promise<void> {
    await this.saveProgress({
      active: false,
      sent: payload.sent,
      failed: payload.failed,
      total: payload.total,
      startedAt: payload.startedAt,
      finishedAt: new Date().toISOString(),
      text: payload.text.slice(0, 200),
      lastError,
    });
    this.options.logger.info('broadcast finished', {
      sent: payload.sent,
      failed: payload.failed,
      total: payload.total,
    });
  }

  private async saveProgress(progress: BroadcastProgress): Promise<void> {
    try {
      await this.options.settings.set(PROGRESS_KEY, progress);
    } catch (error) {
      this.options.logger.warn('broadcast progress save failed', { error: toErrorMessage(error) });
    }
  }

  async progress(): Promise<BroadcastProgress | null> {
    return this.options.settings.get<BroadcastProgress | null>(PROGRESS_KEY, null);
  }

  async cancel(): Promise<void> {
    const progress = await this.progress();
    if (!progress) return;
    await this.options.settings.set(PROGRESS_KEY, { ...progress, active: false, finishedAt: new Date().toISOString() });
  }
}
