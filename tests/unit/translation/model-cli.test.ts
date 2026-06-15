import { describe, expect, it, vi } from "vitest";

import type { TranslationConfigService } from "@/modules/translation/config-service";
import { runModelCli } from "@/modules/translation/model-cli";

const masterKey = Buffer.alloc(32, 17);

function createService(
  overrides: Partial<TranslationConfigService> = {},
): TranslationConfigService {
  return {
    configureProvider: vi.fn(),
    listProviders: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({
      dailyTokenLimit: null,
      budgetTimeZone: "Asia/Shanghai",
      requestTimeoutMs: 60_000,
      maxInputBytes: 1_048_576,
      maxOutputTokens: 4_096,
      workerConcurrency: 1,
    }),
    updateSettings: vi.fn(),
    activatePrompt: vi.fn(),
    activateGlossary: vi.fn(),
    loadWorkerReadiness: vi.fn(),
    ...overrides,
  };
}

function createDependencies(
  service: TranslationConfigService,
  overrides: Partial<Parameters<typeof runModelCli>[1]> = {},
) {
  return {
    service,
    getMasterKey: vi.fn(() => masterKey),
    promptApiKey: vi.fn().mockResolvedValue("sk-secret"),
    readTextFile: vi.fn(),
    writeOutput: vi.fn(),
    ...overrides,
  };
}

describe("model CLI", () => {
  it("securely prompts for a provider API key", async () => {
    const configureProvider = vi.fn();
    const service = createService({ configureProvider });
    const dependencies = createDependencies(service);

    await runModelCli(
      [
        "provider",
        "set",
        "deepseek",
        "--model",
        "deepseek-chat",
      ],
      dependencies,
    );

    expect(dependencies.promptApiKey).toHaveBeenCalledOnce();
    expect(dependencies.getMasterKey).toHaveBeenCalledOnce();
    expect(configureProvider).toHaveBeenCalledWith(
      {
        provider: "deepseek",
        modelId: "deepseek-chat",
        apiKey: "sk-secret",
        baseUrl: undefined,
      },
      masterKey,
    );
    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      "deepseek provider configured.",
    );
  });

  it("does not accept an API key argument", async () => {
    const service = createService();
    const dependencies = createDependencies(service);

    await expect(
      runModelCli(
        [
          "provider",
          "set",
          "deepseek",
          "--model",
          "deepseek-chat",
          "--api-key",
          "leaked",
        ],
        dependencies,
      ),
    ).rejects.toThrow("--api-key");
    expect(dependencies.promptApiKey).not.toHaveBeenCalled();
  });

  it("validates the model option before prompting for a secret", async () => {
    const service = createService();
    const dependencies = createDependencies(service);

    await expect(
      runModelCli(["provider", "set", "deepseek"], dependencies),
    ).rejects.toThrow("--model");
    expect(dependencies.promptApiKey).not.toHaveBeenCalled();
  });

  it("validates the master key before prompting for a secret", async () => {
    const service = createService();
    const dependencies = createDependencies(service, {
      getMasterKey: vi.fn(() => {
        throw new Error("MODEL_KEY_ENCRYPTION_KEY is required");
      }),
    });

    await expect(
      runModelCli(
        [
          "provider",
          "set",
          "deepseek",
          "--model",
          "deepseek-chat",
        ],
        dependencies,
      ),
    ).rejects.toThrow("MODEL_KEY_ENCRYPTION_KEY");
    expect(dependencies.promptApiKey).not.toHaveBeenCalled();
  });

  it("lists providers and shared settings without encrypted values", async () => {
    const service = createService({
      listProviders: vi.fn().mockResolvedValue([
        {
          id: "provider-id",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-chat",
          keyHint: "****cret",
          enabled: true,
          createdAt: new Date("2026-06-15T00:00:00Z"),
          updatedAt: new Date("2026-06-15T00:00:00Z"),
          apiKeyConfigured: true,
        },
      ]),
    });
    const dependencies = createDependencies(service);

    await runModelCli(["provider", "list"], dependencies);

    const output = vi.mocked(dependencies.writeOutput).mock.calls[0][0];
    expect(output).toContain('"apiKeyConfigured": true');
    expect(output).toContain('"dailyTokenLimit": null');
    expect(output).not.toContain("encryptedApiKey");
    expect(output).not.toContain("sk-secret");
  });

  it("sets the daily token budget", async () => {
    const updateSettings = vi.fn();
    const service = createService({ updateSettings });
    const dependencies = createDependencies(service);

    await runModelCli(
      ["budget", "set", "--daily-tokens", "250000"],
      dependencies,
    );

    expect(updateSettings).toHaveBeenCalledWith({
      dailyTokenLimit: 250_000,
    });
  });

  it("sets shared model runtime limits", async () => {
    const updateSettings = vi.fn();
    const service = createService({ updateSettings });
    const dependencies = createDependencies(service);

    await runModelCli(
      [
        "settings",
        "set",
        "--request-timeout-ms",
        "30000",
        "--max-input-bytes",
        "500000",
        "--max-output-tokens",
        "2048",
        "--worker-concurrency",
        "2",
      ],
      dependencies,
    );

    expect(updateSettings).toHaveBeenCalledWith({
      requestTimeoutMs: 30_000,
      maxInputBytes: 500_000,
      maxOutputTokens: 2_048,
      workerConcurrency: 2,
    });
  });

  it("activates prompt files without rewriting their content", async () => {
    const activatePrompt = vi.fn().mockResolvedValue({ version: 5 });
    const service = createService({ activatePrompt });
    const readTextFile = vi
      .fn()
      .mockResolvedValueOnce("System prompt")
      .mockResolvedValueOnce("Translate {{sourceText}}");
    const dependencies = createDependencies(service, { readTextFile });

    await runModelCli(
      [
        "prompt",
        "activate",
        "--system-file",
        "system.txt",
        "--user-file",
        "user.txt",
      ],
      dependencies,
    );

    expect(activatePrompt).toHaveBeenCalledWith({
      systemPrompt: "System prompt",
      userPromptTemplate: "Translate {{sourceText}}",
    });
  });

  it("activates non-empty glossary lines from a file", async () => {
    const activateGlossary = vi.fn().mockResolvedValue({ version: 6 });
    const service = createService({ activateGlossary });
    const dependencies = createDependencies(service, {
      readTextFile: vi
        .fn()
        .mockResolvedValue("Shopify CLI\r\n\r\nAdmin API\r\n"),
    });

    await runModelCli(
      ["glossary", "activate", "--file", "glossary.txt"],
      dependencies,
    );

    expect(activateGlossary).toHaveBeenCalledWith({
      terms: ["Shopify CLI", "Admin API"],
    });
  });

  it("prints readiness metadata without decrypted API keys", async () => {
    const service = createService({
      loadWorkerReadiness: vi.fn().mockResolvedValue({
        deepseek: {
          id: "provider-id",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-chat",
          keyHint: "****cret",
          enabled: true,
          createdAt: new Date("2026-06-15T00:00:00Z"),
          updatedAt: new Date("2026-06-15T00:00:00Z"),
          apiKey: "sk-decrypted-secret",
        },
        qwen: null,
        prompt: { version: 3 },
        glossary: { version: 4, terms: [{}, {}] },
        settings: { dailyTokenLimit: 100_000 },
      }),
    });
    const dependencies = createDependencies(service);

    await runModelCli(["readiness"], dependencies);

    const output = vi.mocked(dependencies.writeOutput).mock.calls[0][0];
    expect(output).toContain('"ready": true');
    expect(output).toContain('"promptVersion": 3');
    expect(output).not.toContain("sk-decrypted-secret");
    expect(output).not.toContain('"apiKey"');
  });
});
