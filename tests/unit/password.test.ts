import { describe, expect, it } from "vitest";

import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/modules/auth/password";
import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from "@/modules/auth/constants";

describe("password helpers", () => {
  it("hashes with Argon2id and verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toContain("$argon2id$");
    expect(hash).toContain("m=19456,t=2,p=1");
    await expect(
      verifyPassword(hash, "correct horse battery staple"),
    ).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("accepts the configured password length boundaries", () => {
    expect(() =>
      validatePasswordStrength("a".repeat(MINIMUM_PASSWORD_LENGTH)),
    ).not.toThrow();
    expect(() =>
      validatePasswordStrength("a".repeat(MAXIMUM_PASSWORD_LENGTH)),
    ).not.toThrow();
  });

  it("rejects passwords outside the configured length boundaries", () => {
    expect(() =>
      validatePasswordStrength("a".repeat(MINIMUM_PASSWORD_LENGTH - 1)),
    ).toThrow("at least 12 characters");
    expect(() =>
      validatePasswordStrength("a".repeat(MAXIMUM_PASSWORD_LENGTH + 1)),
    ).toThrow(
      "at most 1024 characters",
    );
  });
});
