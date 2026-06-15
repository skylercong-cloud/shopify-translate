import { describe, expect, it, vi } from "vitest";

import type {
  StoredGlossaryVersion,
  StoredPromptVersion,
  StoredProviderConfig,
  TranslationConfigRepository,
  TranslationRuntimeSettings,
} from "@/db/repositories/translation-config-repository";
import {
  createTranslationConfigService,
  type TranslationProvider,
} from "@/modules/translation/config-service";
import {
  decryptSecret,
  encryptSecret,
} from "@/modules/translation/encryption";

const masterKey = Buffer.alloc(32, 13);
const now = new Date("2026-06-15T00:00:00Z");

function provider(
  name: TranslationProvider,
  apiKey = `${name}-secret`,
): StoredProviderConfig {
  return {
    id: `${name}-id`,
    provider: name,
    baseUrl:
      name === "deepseek"
        ? "https://api.deepseek.com"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelId: `${name}-model`,
    encryptedApiKey: encryptSecret(apiKey, masterKey),
    keyHint: `****${apiKey.slice(-4)}`,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function prompt(): StoredPromptVersion {
  return {
    id: "prompt-id",
    version: 1,
    systemPrompt: "Translate accurately.",
    userPromptTemplate: "{{sourceText}}",
    contentFingerprint: "prompt-fingerprint",
    active: true,
    createdAt: now,
  };
}

function glossary(): StoredGlossaryVersion {
  return {
    id: "glossary-id",
    version: 1,
    contentFingerprint: "glossary-fingerprint",
    active: true,
    createdAt: now,
    terms: [
      {
        id: "term-id",
        sourceTerm: "Shopify CLI",
        normalizedTerm: "shopify cli",
      },
    ],
  };
}

function settings(
  overrides: Partial<TranslationRuntimeSettings> = {},
): TranslationRuntimeSettings {
  return {
    dailyTokenLimit: 100_000,
    budgetTimeZone: "Asia/Shanghai",
    requestTimeoutMs: 60_000,
    maxInputBytes: 1_048_576,
    maxOutputTokens: 4_096,
    workerConcurrency: 1,
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<TranslationConfigRepository> = {},
): TranslationConfigRepository {
  return {
    upsertProvider: vi.fn(),
    getProvider: vi.fn().mockResolvedValue(null),
    listProviders: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(settings()),
    createAndActivatePrompt: vi.fn(),
    getActivePrompt: vi.fn().mockResolvedValue(prompt()),
    createAndActivateGlossary: vi.fn(),
    getActiveGlossary: vi.fn().mockResolvedValue(glossary()),
    ...overrides,
  };
}

describe("translation configuration service", () => {
  it("encrypts provider credentials before persistence", async () => {
    const upsertProvider = vi.fn();
    const service = createTranslationConfigService(
      createRepository({ upsertProvider }),
    );

    await service.configureProvider(
      {
        provider: "deepseek",
        modelId: "deepseek-chat",
        apiKey: "sk-plain-secret",
      },
      masterKey,
    );

    expect(upsertProvider).toHaveBeenCalledOnce();
    const stored = upsertProvider.mock.calls[0][0] as StoredProviderConfig;
    expect(stored.baseUrl).toBe("https://api.deepseek.com");
    expect(stored.encryptedApiKey).not.toContain("sk-plain-secret");
    expect(decryptSecret(stored.encryptedApiKey, masterKey)).toBe(
      "sk-plain-secret",
    );
    expect(stored.keyHint).toBe("****cret");
  });

  it.each([
    "http://api.example.com",
    "ftp://api.example.com",
    "https://user:password@api.example.com",
    "https://api.example.com?key=value",
    "https://api.example.com#fragment",
  ])("rejects an unsafe provider base URL: %s", async (baseUrl) => {
    const service = createTranslationConfigService(createRepository());

    await expect(
      service.configureProvider(
        {
          provider: "deepseek",
          baseUrl,
          modelId: "deepseek-chat",
          apiKey: "secret",
        },
        masterKey,
      ),
    ).rejects.toThrow("base URL");
  });

  it.each([
    "http://127.0.0.1:4010/v1",
    "http://localhost:4010/v1",
    "https://private.example.com/openai/v1",
  ])("accepts an allowed provider base URL: %s", async (baseUrl) => {
    const upsertProvider = vi.fn();
    const service = createTranslationConfigService(
      createRepository({ upsertProvider }),
    );

    await service.configureProvider(
      {
        provider: "qwen",
        baseUrl,
        modelId: "qwen-model",
        apiKey: "secret",
      },
      masterKey,
    );

    expect(upsertProvider.mock.calls[0][0].baseUrl).toBe(baseUrl);
  });

  it("normalizes and fingerprints an immutable glossary snapshot", async () => {
    const createAndActivateGlossary = vi.fn().mockResolvedValue(glossary());
    const service = createTranslationConfigService(
      createRepository({ createAndActivateGlossary }),
    );

    await service.activateGlossary({
      terms: ["  Shopify CLI  ", "GraphQL", "Admin API"],
    });

    expect(createAndActivateGlossary).toHaveBeenCalledWith({
      contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      terms: [
        { sourceTerm: "Admin API", normalizedTerm: "admin api" },
        { sourceTerm: "GraphQL", normalizedTerm: "graphql" },
        { sourceTerm: "Shopify CLI", normalizedTerm: "shopify cli" },
      ],
    });
  });

  it.each([
    ["duplicate", ["Shopify CLI", "shopify cli"]],
    ["non-ASCII", ["Shopify 商店"]],
    ["control character", ["Shopify\tCLI"]],
    ["empty", ["  "]],
  ])("rejects %s glossary terms", async (_caseName, terms) => {
    const service = createTranslationConfigService(createRepository());

    await expect(service.activateGlossary({ terms })).rejects.toThrow(
      "Glossary",
    );
  });

  it("normalizes prompts and requires a source placeholder", async () => {
    const createAndActivatePrompt = vi.fn().mockResolvedValue(prompt());
    const service = createTranslationConfigService(
      createRepository({ createAndActivatePrompt }),
    );

    await service.activatePrompt({
      systemPrompt: " Translate accurately.\r\n",
      userPromptTemplate: " Source:\r\n{{sourceText}}\r\n",
    });

    expect(createAndActivatePrompt).toHaveBeenCalledWith({
      systemPrompt: "Translate accurately.",
      userPromptTemplate: "Source:\n{{sourceText}}",
      contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await expect(
      service.activatePrompt({
        systemPrompt: "Translate.",
        userPromptTemplate: "No source placeholder.",
      }),
    ).rejects.toThrow("{{sourceText}}");
  });

  it("validates and updates shared runtime settings", async () => {
    const updateSettings = vi.fn().mockResolvedValue(settings());
    const service = createTranslationConfigService(
      createRepository({ updateSettings }),
    );

    await service.updateSettings({
      dailyTokenLimit: 200_000,
      requestTimeoutMs: 30_000,
      maxInputBytes: 500_000,
      maxOutputTokens: 2_000,
      workerConcurrency: 2,
    });

    expect(updateSettings).toHaveBeenCalledWith({
      dailyTokenLimit: 200_000,
      requestTimeoutMs: 30_000,
      maxInputBytes: 500_000,
      maxOutputTokens: 2_000,
      workerConcurrency: 2,
    });

    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        service.updateSettings({ dailyTokenLimit: invalid }),
      ).rejects.toThrow("dailyTokenLimit");
    }
  });

  it("reads shared runtime settings without model credentials", async () => {
    const getSettings = vi.fn().mockResolvedValue(settings());
    const service = createTranslationConfigService(
      createRepository({ getSettings }),
    );

    await expect(service.getSettings()).resolves.toEqual(settings());
    expect(getSettings).toHaveBeenCalledOnce();
  });

  it("loads readiness with required DeepSeek and optional Qwen", async () => {
    const deepseek = provider("deepseek");
    const repository = createRepository({
      getProvider: vi.fn(async (name: TranslationProvider) =>
        name === "deepseek" ? deepseek : null,
      ),
    });
    const service = createTranslationConfigService(repository);

    await expect(service.loadWorkerReadiness(masterKey)).resolves.toEqual({
      deepseek: expect.objectContaining({
        provider: "deepseek",
        apiKey: "deepseek-secret",
      }),
      qwen: null,
      prompt: prompt(),
      glossary: glossary(),
      settings: settings(),
    });
  });

  it.each([
    ["DeepSeek", { deepseek: null, activePrompt: prompt(), activeGlossary: glossary(), runtimeSettings: settings() }],
    ["prompt", { deepseek: provider("deepseek"), activePrompt: null, activeGlossary: glossary(), runtimeSettings: settings() }],
    ["glossary", { deepseek: provider("deepseek"), activePrompt: prompt(), activeGlossary: null, runtimeSettings: settings() }],
    ["daily token limit", { deepseek: provider("deepseek"), activePrompt: prompt(), activeGlossary: glossary(), runtimeSettings: settings({ dailyTokenLimit: null }) }],
  ])("rejects readiness without %s", async (_name, state) => {
    const repository = createRepository({
      getProvider: vi.fn(async (name: TranslationProvider) =>
        name === "deepseek" ? state.deepseek : null,
      ),
      getActivePrompt: vi.fn().mockResolvedValue(state.activePrompt),
      getActiveGlossary: vi.fn().mockResolvedValue(state.activeGlossary),
      getSettings: vi.fn().mockResolvedValue(state.runtimeSettings),
    });
    const service = createTranslationConfigService(repository);

    await expect(service.loadWorkerReadiness(masterKey)).rejects.toThrow(
      String(_name),
    );
  });
});
