import type { AppEnv } from "@/lib/env";

import { decodeMasterKey } from "./encryption";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

export function requireModelEncryptionKey(
  env: Pick<AppEnv, "MODEL_KEY_ENCRYPTION_KEY">,
): Buffer {
  if (!env.MODEL_KEY_ENCRYPTION_KEY) {
    throw new Error(
      "MODEL_KEY_ENCRYPTION_KEY is required for model operations",
    );
  }

  return decodeMasterKey(env.MODEL_KEY_ENCRYPTION_KEY);
}
