import { describe, expect, it } from "vitest";

import {
  decodeMasterKey,
  decryptSecret,
  encryptSecret,
} from "@/modules/translation/encryption";

const encodedMasterKey = Buffer.alloc(32, 7).toString("base64");
const masterKey = Buffer.alloc(32, 7);

function mutateBase64(value: string): string {
  const replacement = value[0] === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

describe("translation secret encryption", () => {
  it("accepts only canonical base64 encoding of exactly 32 bytes", () => {
    expect(decodeMasterKey(encodedMasterKey)).toEqual(masterKey);

    for (const invalid of [
      "",
      "not-base64",
      Buffer.alloc(31).toString("base64"),
      Buffer.alloc(33).toString("base64"),
      encodedMasterKey.replace(/=$/, ""),
    ]) {
      expect(() => decodeMasterKey(invalid)).toThrow(
        "base64-encoded 32-byte key",
      );
    }
  });

  it("uses a fresh authenticated envelope for each encryption", () => {
    const first = encryptSecret("sk-private-value", masterKey);
    const second = encryptSecret("sk-private-value", masterKey);

    expect(first).not.toBe(second);
    expect(decryptSecret(first, masterKey)).toBe("sk-private-value");
    expect(decryptSecret(second, masterKey)).toBe("sk-private-value");
  });

  it("rejects empty plaintext secrets", () => {
    expect(() => encryptSecret("", masterKey)).toThrow(
      "Secret must not be empty",
    );
    expect(() => encryptSecret("   ", masterKey)).toThrow(
      "Secret must not be empty",
    );
  });

  it.each(["iv", "ciphertext", "authTag"] as const)(
    "rejects a modified %s",
    (field) => {
      const encrypted = encryptSecret("sk-private-value", masterKey);
      const envelope = JSON.parse(encrypted) as Record<string, string>;
      envelope[field] = mutateBase64(envelope[field]);

      expect(() =>
        decryptSecret(JSON.stringify(envelope), masterKey),
      ).toThrow("Encrypted secret is invalid");
    },
  );

  it("rejects unsupported envelope metadata and the wrong key", () => {
    const encrypted = encryptSecret("sk-private-value", masterKey);
    const envelope = JSON.parse(encrypted) as Record<string, unknown>;

    expect(() =>
      decryptSecret(
        JSON.stringify({ ...envelope, version: 2 }),
        masterKey,
      ),
    ).toThrow("Encrypted secret is invalid");
    expect(() =>
      decryptSecret(
        JSON.stringify({ ...envelope, algorithm: "aes-128-gcm" }),
        masterKey,
      ),
    ).toThrow("Encrypted secret is invalid");
    expect(() =>
      decryptSecret(encrypted, Buffer.alloc(32, 8)),
    ).toThrow("Encrypted secret is invalid");
  });

  it("does not expose plaintext or envelope contents in errors", () => {
    const plaintext = "sk-do-not-leak";
    const encrypted = encryptSecret(plaintext, masterKey);

    try {
      decryptSecret(encrypted, Buffer.alloc(32, 9));
      throw new Error("Expected decryption to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(plaintext);
      expect(message).not.toContain(encrypted);
    }
  });
});
