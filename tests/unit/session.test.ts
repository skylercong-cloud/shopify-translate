import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
  sessionExpiresAt,
} from "@/modules/auth/session";

describe("session helpers", () => {
  it("creates an opaque token and a stable SHA-256 hash", () => {
    const token = createSessionToken();

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(createSessionToken()).not.toBe(token);
  });

  it("creates a database record without the raw token", () => {
    const token = createSessionToken();
    const record = newSessionRecord(
      token,
      "00000000-0000-4000-8000-000000000001",
      new Date("2026-06-11T00:00:00.000Z"),
      30,
    );

    expect(record).not.toHaveProperty("token");
    expect(record.tokenHash).toBe(hashSessionToken(token));
  });

  it("uses the configured day duration", () => {
    const now = new Date("2026-06-11T00:00:00.000Z");
    expect(sessionExpiresAt(now, 30).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
  });
});
