import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_QWEN_BASE_URL,
  requireModelEncryptionKey,
} from "@/modules/translation/runtime-config";

import { validEnv } from "../../fixtures/env";

const encodedMasterKey = Buffer.alloc(32, 11).toString("base64");

describe("translation runtime configuration", () => {
  it("keeps the model encryption key optional for general processes", () => {
    expect(parseEnv(validEnv).MODEL_KEY_ENCRYPTION_KEY).toBeUndefined();
    expect(
      parseEnv({
        ...validEnv,
        MODEL_KEY_ENCRYPTION_KEY: encodedMasterKey,
      }).MODEL_KEY_ENCRYPTION_KEY,
    ).toBe(encodedMasterKey);
  });

  it("requires a valid master key at the translation boundary", () => {
    expect(() =>
      requireModelEncryptionKey(parseEnv(validEnv)),
    ).toThrow("MODEL_KEY_ENCRYPTION_KEY");
    expect(() =>
      requireModelEncryptionKey(
        parseEnv({
          ...validEnv,
          MODEL_KEY_ENCRYPTION_KEY: "invalid",
        }),
      ),
    ).toThrow("base64-encoded 32-byte key");

    expect(
      requireModelEncryptionKey(
        parseEnv({
          ...validEnv,
          MODEL_KEY_ENCRYPTION_KEY: encodedMasterKey,
        }),
      ),
    ).toEqual(Buffer.alloc(32, 11));
  });

  it("uses the confirmed official provider endpoints", () => {
    expect(DEFAULT_DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
    expect(DEFAULT_QWEN_BASE_URL).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
  });
});
