import { createHash } from "node:crypto";

import type {
  RuntimeSettingsUpdate,
  StoredGlossaryVersion,
  StoredPromptVersion,
  StoredProviderConfig,
  TranslationConfigRepository,
  TranslationRuntimeSettings,
  TranslationProvider as RepositoryTranslationProvider,
} from "@/db/repositories/translation-config-repository";

import { decryptSecret, encryptSecret } from "./encryption";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_QWEN_BASE_URL,
} from "./runtime-config";

export type TranslationProvider = RepositoryTranslationProvider;

export type RuntimeProviderConfig = Omit<
  StoredProviderConfig,
  "encryptedApiKey"
> & {
  apiKey: string;
};

export type TranslationWorkerReadiness = {
  deepseek: RuntimeProviderConfig;
  qwen: RuntimeProviderConfig | null;
  prompt: StoredPromptVersion;
  glossary: StoredGlossaryVersion;
  settings: TranslationRuntimeSettings;
};

const DEFAULT_PROVIDER_URLS: Record<TranslationProvider, string> = {
  deepseek: DEFAULT_DEEPSEEK_BASE_URL,
  qwen: DEFAULT_QWEN_BASE_URL,
};

function normalizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provider base URL is invalid");
  }

  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Provider base URL is unsafe");
  }

  return url.toString().replace(/\/$/, "");
}

function keyHint(apiKey: string): string {
  return `****${apiKey.slice(-4)}`;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function decryptProvider(
  stored: StoredProviderConfig,
  masterKey: Buffer,
): RuntimeProviderConfig {
  const { encryptedApiKey, ...publicConfig } = stored;
  return {
    ...publicConfig,
    apiKey: decryptSecret(encryptedApiKey, masterKey),
  };
}

export function createTranslationConfigService(
  repository: TranslationConfigRepository,
) {
  return {
    async configureProvider(
      input: {
        provider: TranslationProvider;
        modelId: string;
        apiKey: string;
        baseUrl?: string;
        enabled?: boolean;
      },
      masterKey: Buffer,
    ) {
      const apiKey = requiredText(input.apiKey, "Provider API key");
      await repository.upsertProvider({
        provider: input.provider,
        baseUrl: normalizeBaseUrl(
          input.baseUrl ?? DEFAULT_PROVIDER_URLS[input.provider],
        ),
        modelId: requiredText(input.modelId, "Provider model ID"),
        encryptedApiKey: encryptSecret(apiKey, masterKey),
        keyHint: keyHint(apiKey),
        enabled: input.enabled ?? true,
      });
      return {
        provider: input.provider,
        apiKeyConfigured: true as const,
      };
    },

    listProviders() {
      return repository.listProviders().then((providers) =>
        providers.map((stored) => ({
          id: stored.id,
          provider: stored.provider,
          baseUrl: stored.baseUrl,
          modelId: stored.modelId,
          keyHint: stored.keyHint,
          enabled: stored.enabled,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
          apiKeyConfigured: true as const,
        })),
      );
    },

    getSettings() {
      return repository.getSettings();
    },

    async updateSettings(input: RuntimeSettingsUpdate) {
      const validated: RuntimeSettingsUpdate = {};
      for (const [name, value] of Object.entries(input)) {
        if (value !== undefined) {
          validated[name as keyof RuntimeSettingsUpdate] =
            positiveSafeInteger(value, name);
        }
      }
      if (Object.keys(validated).length === 0) {
        throw new Error("At least one translation setting is required");
      }
      return repository.updateSettings(validated);
    },

    async activatePrompt(input: {
      systemPrompt: string;
      userPromptTemplate: string;
    }) {
      const systemPrompt = normalizeMultiline(input.systemPrompt);
      const userPromptTemplate = normalizeMultiline(
        input.userPromptTemplate,
      );
      if (!systemPrompt) {
        throw new Error("System prompt is required");
      }
      if (!userPromptTemplate.includes("{{sourceText}}")) {
        throw new Error(
          "User prompt template must contain {{sourceText}}",
        );
      }

      return await repository.createAndActivatePrompt({
        systemPrompt,
        userPromptTemplate,
        contentFingerprint: fingerprint({
          systemPrompt,
          userPromptTemplate,
        }),
      });
    },

    async activateGlossary(input: { terms: string[] }) {
      if (input.terms.length === 0) {
        throw new Error("Glossary must contain at least one term");
      }

      const seen = new Set<string>();
      const terms = input.terms.map((value) => {
        const sourceTerm = value.trim();
        if (
          sourceTerm.length === 0 ||
          !/^[\x20-\x7e]+$/.test(sourceTerm)
        ) {
          throw new Error(
            "Glossary terms must be non-empty printable ASCII",
          );
        }

        const normalizedTerm = sourceTerm.toLowerCase();
        if (seen.has(normalizedTerm)) {
          throw new Error(
            `Glossary contains a duplicate term: ${sourceTerm}`,
          );
        }
        seen.add(normalizedTerm);
        return { sourceTerm, normalizedTerm };
      });
      terms.sort((left, right) =>
        left.normalizedTerm < right.normalizedTerm
          ? -1
          : left.normalizedTerm > right.normalizedTerm
            ? 1
            : 0,
      );

      return await repository.createAndActivateGlossary({
        terms,
        contentFingerprint: fingerprint(terms),
      });
    },

    async loadWorkerReadiness(
      masterKey: Buffer,
    ): Promise<TranslationWorkerReadiness> {
      const [deepseek, qwen, prompt, glossary, settings] =
        await Promise.all([
          repository.getProvider("deepseek"),
          repository.getProvider("qwen"),
          repository.getActivePrompt(),
          repository.getActiveGlossary(),
          repository.getSettings(),
        ]);

      if (!deepseek || !deepseek.enabled) {
        throw new Error(
          "DeepSeek provider configuration is required and must be enabled",
        );
      }
      if (!prompt) {
        throw new Error("An active prompt version is required");
      }
      if (!glossary) {
        throw new Error("An active glossary version is required");
      }
      if (settings.dailyTokenLimit === null) {
        throw new Error("A daily token limit is required");
      }

      return {
        deepseek: decryptProvider(deepseek, masterKey),
        qwen:
          qwen && qwen.enabled ? decryptProvider(qwen, masterKey) : null,
        prompt,
        glossary,
        settings,
      };
    },
  };
}

export type TranslationConfigService = ReturnType<
  typeof createTranslationConfigService
>;
