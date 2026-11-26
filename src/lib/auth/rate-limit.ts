/** Process-local login throttles; multi-instance hosting needs shared storage. */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  maxAttempts?: number;
  windowSeconds?: number;
  lockoutSeconds?: number;
  maxClients?: number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;
  private readonly lockoutSeconds: number;
  private readonly maxClients: number;

  constructor(options: RateLimitOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowSeconds = options.windowSeconds ?? 15 * 60;
    this.lockoutSeconds = options.lockoutSeconds ?? 15 * 60;
    this.maxClients = options.maxClients ?? 4096;
  }

  get size(): number {
    return this.entries.size;
  }

  check(key: string, at: number = nowSeconds()): RateLimitDecision {
    const entry = this.entries.get(key);
    if (entry?.lockedUntil && entry.lockedUntil > at) {
      return { allowed: false, retryAfterSeconds: entry.lockedUntil - at };
    }
    if (!entry && this.entries.size >= this.maxClients) {
      this.prune(at);
      // Never evict an active lock to make room for a new identity.
      if (this.entries.size >= this.maxClients) {
        return { allowed: false, retryAfterSeconds: 1 };
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(key: string, at: number = nowSeconds()): void {
    this.prune(at);
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= this.maxClients) return;
    if (previous && previous.lockedUntil > at) return;
    const entry = previous ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => t > at - this.windowSeconds);
    entry.failures.push(at);
    if (entry.failures.length >= this.maxAttempts) {
      entry.lockedUntil = at + this.lockoutSeconds;
      entry.failures = [];
    }
    this.entries.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private prune(at: number): void {
    const cutoff = at - this.windowSeconds;
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= at && !entry.failures.some((t) => t > cutoff)) {
        this.entries.delete(key);
      }
    }
  }
}

/** A short sliding budget bounds expensive scrypt work across all addresses. */
export class LoginWorkLimiter {
  private attempts: number[] = [];

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowSeconds = 5
  ) {}

  take(at: number = nowSeconds()): RateLimitDecision {
    this.attempts = this.attempts.filter((time) => time > at - this.windowSeconds);
    if (this.attempts.length >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: this.attempts[0] + this.windowSeconds - at,
      };
    }
    this.attempts.push(at);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export const loginRateLimiter = new LoginRateLimiter();
export const loginWorkLimiter = new LoginWorkLimiter();
