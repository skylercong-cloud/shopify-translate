import { describe, expect, it } from "vitest";

import {
  createLoginRateLimit,
  LOGIN_FAILURE_WINDOW_MS,
} from "../../src/modules/auth/login-rate-limit";

describe("login rate limit", () => {
  it("blocks the sixth request until the failure window expires", () => {
    const rateLimit = createLoginRateLimit();
    const now = 1_000;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(rateLimit.check(now)).toEqual({ allowed: true });
      rateLimit.recordFailure(now);
    }

    expect(rateLimit.check(now)).toEqual({
      allowed: false,
      retryAfterSeconds: LOGIN_FAILURE_WINDOW_MS / 1000,
    });
    expect(rateLimit.check(now + LOGIN_FAILURE_WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("reset clears recorded failures", () => {
    const rateLimit = createLoginRateLimit();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      rateLimit.recordFailure();
    }

    rateLimit.reset();

    expect(rateLimit.check()).toEqual({ allowed: true });
  });
});
