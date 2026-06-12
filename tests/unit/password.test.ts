import { describe, expect, it } from "vitest";

import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/modules/auth/password";

describe("password helpers", () => {
  it("hashes with Argon2id and verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toContain("$argon2id$");
    await expect(
      verifyPassword(hash, "correct horse battery staple"),
    ).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("requires at least 12 characters", () => {
    expect(() => validatePasswordStrength("too-short")).toThrow(
      "at least 12 characters",
    );
  });
});
