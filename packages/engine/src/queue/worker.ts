import type { JobRecord, Logger, Storage } from '@botforge/core';
import { toErrorMessage } from '@botforge/core';

export interface JobContext {
  job: JobRecord;
  storage: Storage;
  logger: Logger;
  enqueue(type: string, payload: Payload, options?: { runAt?: Date; botId?: string; maxAttempts?: number }): Promise<JobRecord>;
}

export type Payload = Record<string, unknown>;
export type JobHandler = (payload: Payload, context: JobContext) => Promise<void>;

export interface QueueOptions {
  storage: Storage;
  logger: Logger;
  handlers: Record<string, JobHandler>;
  concurrency?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  now?: () => Date;
}

export class JobQueue {
  private readonly storage: Storage;
  private readonly logger: Logger;
  private readonly handlers: Record<string, JobHandler>;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = true;
  private executionCount = 0;

  constructor(options: QueueOptions) {
    this.storage = options.storage;
    this.logger = options.logger;
    this.handlers = options.handlers;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.pollIntervalMs = Math.max(200, options.pollIntervalMs ?? 2000);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.now = options.now ?? (() => new Date());
  }

  register(type: string, handler: JobHandler): void {
    this.handlers[type] = handler;
  }

  async enqueue(
    botId: string,
    type: string,
    payload: Payload,
    options: { runAt?: Date; maxAttempts?: number; status?: JobRecord['status'] } = {},
  ): Promise<JobRecord> {
    return this.storage.jobs.create({
      botId,
      type,
      payload,
      runAt: (options.runAt ?? this.now()).toISOString(),
      maxAttempts: options.maxAttempts ?? this.maxAttempts,
      status: options.status,
    });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      void this.tick().finally(() => {
        if (!this.stopped) this.timer = setTimeout(loop, this.pollIntervalMs);
      });
    };
    this.timer = setTimeout(loop, 50);
    this.logger.info('job queue started', { concurrency: this.concurrency, handlers: Object.keys(this.handlers) });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.logger.info('job queue stopped');
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  get executed(): number {
    return this.executionCount;
  }

  /**
   * Executes one queue pass and waits until every claimed job settles.
   * Used by runtimes that cannot keep a timer alive (Cloudflare Workers cron triggers).
   */
  async runOnce(): Promise<void> {
    const wasStopped = this.stopped;
    this.stopped = false;
    try {
      await this.tick();
      let guard = 0;
      while (this.running > 0 && guard < 600) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 25);
        });
        guard += 1;
      }
    } finally {
      this.stopped = wasStopped;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    const capacity = this.concurrency - this.running;
    if (capacity <= 0) return;
    this.ticking = true;
    try {
      const jobs = await this.storage.jobs.claimDue(capacity, this.now().toISOString());
      for (const job of jobs) {
        void this.execute(job);
      }
    } catch (error) {
      this.logger.error('job claim failed', { error: toErrorMessage(error) });
    } finally {
      this.ticking = false;
    }
  }

  private async execute(job: JobRecord): Promise<void> {
    this.running += 1;
    const handler = this.handlers[job.type];
    try {
      if (!handler) {
        await this.storage.jobs.fail(job.id, `No handler registered for job type "${job.type}"`, undefined, true);
        this.logger.error('job handler missing', { jobId: job.id, type: job.type });
        return;
      }
      await handler(job.payload, {
        job,
        storage: this.storage,
        logger: this.logger.child({ jobId: job.id, jobType: job.type, botId: job.botId }),
        enqueue: (type, payload, options) =>
          this.enqueue(options?.botId ?? job.botId, type, payload, {
            runAt: options?.runAt,
            maxAttempts: options?.maxAttempts,
          }),
      });
      await this.storage.jobs.complete(job.id);
      this.executionCount += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      const dead = job.attempts >= job.maxAttempts;
      const delayMs = Math.min(3_600_000, 1000 * 2 ** Math.max(0, job.attempts - 1));
      const retryAt = dead ? undefined : new Date(Date.now() + delayMs).toISOString();
      await this.storage.jobs.fail(job.id, message, retryAt, dead);
      this.logger.warn('job failed', {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        dead,
        error: message,
      });
    } finally {
      this.running -= 1;
    }
  }
}

export interface HandlerRegistry {
  [type: string]: JobHandler;
}
