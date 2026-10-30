export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  consume(key: string, cost = 1): RateLimitResult {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: cost, windowStart: now });
      this.sweep(now);
      return {
        allowed: cost <= this.limit,
        remaining: Math.max(0, this.limit - cost),
        limit: this.limit,
        resetAt: now + this.windowMs,
        retryAfterSeconds: 0,
      };
    }
    bucket.count += cost;
    const allowed = bucket.count <= this.limit;
    const resetAt = bucket.windowStart + this.windowMs;
    return {
      allowed,
      remaining: Math.max(0, this.limit - bucket.count),
      limit: this.limit,
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  peek(key: string): RateLimitResult {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      return { allowed: true, remaining: this.limit, limit: this.limit, resetAt: now + this.windowMs, retryAfterSeconds: 0 };
    }
    const resetAt = bucket.windowStart + this.windowMs;
    const remaining = Math.max(0, this.limit - bucket.count);
    return {
      allowed: remaining > 0,
      remaining,
      limit: this.limit,
      resetAt,
      retryAfterSeconds: remaining > 0 ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    if (this.buckets.size < 2000) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(capacity: number, refillPerSecond: number, now: () => number = Date.now) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerMs = refillPerSecond / 1000;
    this.now = now;
    this.lastRefill = now();
  }

  async take(cost = 1): Promise<void> {
    for (;;) {
      const now = this.now();
      const elapsed = now - this.lastRefill;
      if (elapsed > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
        this.lastRefill = now;
      }
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 1000)));
    }
  }
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
