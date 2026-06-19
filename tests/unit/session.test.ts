import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
  sessionExpiresAt,
} from "@/modules/auth/session";
import { MAXIMUM_SESSION_DAYS } from "@/modules/auth/constants";

describe("session helpers", () => {
  it("caps configured sessions at one year", () => {
    expect(MAXIMUM_SESSION_DAYS).toBe(365);
  });

  it("creates an opaque token and a stable SHA-256 hash", () => {
    const token = createSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(createSessionToken()).not.toBe(token);
  });

  it("uses the standard SHA-256 digest", () => {
    expect(hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
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

  it("rejects unsupported session durations", () => {
    const now = new Date("2026-06-11T00:00:00.000Z");

    expect(() => sessionExpiresAt(now, 0)).toThrow("sessionDays");
    expect(() => sessionExpiresAt(now, 1.5)).toThrow("sessionDays");
    expect(() =>
      sessionExpiresAt(now, MAXIMUM_SESSION_DAYS + 1),
    ).toThrow("sessionDays");
  });
});
