export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

type LoginRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type LoginFailureState = {
  failures: number;
  windowStartedAt: number;
};

export class LoginRateLimit {
  private state: LoginFailureState | null = null;
  private queue = Promise.resolve();

  check(now = Date.now()): LoginRateLimitResult {
    this.clearExpiredWindow(now);

    if (!this.state || this.state.failures < LOGIN_FAILURE_LIMIT) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(
        (this.state.windowStartedAt + LOGIN_FAILURE_WINDOW_MS - now) / 1000,
      ),
    };
  }

  recordFailure(now = Date.now()): void {
    this.clearExpiredWindow(now);

    if (!this.state) {
      this.state = { failures: 1, windowStartedAt: now };
      return;
    }

    this.state.failures += 1;
  }

  reset(): void {
    this.state = null;
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;

    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  private clearExpiredWindow(now: number): void {
    if (
      this.state &&
      now >= this.state.windowStartedAt + LOGIN_FAILURE_WINDOW_MS
    ) {
      this.reset();
    }
  }
}

export function createLoginRateLimit(): LoginRateLimit {
  return new LoginRateLimit();
}

export const loginRateLimit = createLoginRateLimit();
