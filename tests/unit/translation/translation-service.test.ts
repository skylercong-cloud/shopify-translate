import { describe, expect, it, vi } from "vitest";

import { ProviderCallError } from "@/modules/translation/provider-errors";
import { protectTranslationInput } from "@/modules/translation/protection";
import {
  createTranslationService,
  type TranslationServiceOptions,
} from "@/modules/translation/translation-service";

const now = new Date("2026-06-15T08:00:00.000Z");

function successfulContent(): string {
  const protectedInput = protectTranslationInput({
    sourceText: "Use Shopify CLI.",
    blockKind: "paragraph",
    parserTokens: [],
    glossaryTerms: ["Shopify CLI"],
  });
  if ("translatable" in protectedInput) {
    throw new Error("Expected protected input");
  }
  return JSON.stringify({
    translatedText: `使用 ${protectedInput.placeholders[0].placeholder}。`,
  });
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: "revision-id",
    blockTranslationId: "translation-id",
    source: "ai",
    translatedText: "译文",
    sourceFingerprint: "fingerprint",
    provider: "deepseek",
    modelId: "deepseek-chat",
    promptVersionId: "prompt-id",
    glossaryVersionId: "glossary-id",
    modelCallId: null,
    createdAt: now,
    ...overrides,
  };
}

function correction(text: string) {
  return {
    id: "correction-id",
    scope: "block",
    sourceFingerprint: "fingerprint",
    blockId: "block-id",
    translatedText: text,
    createdAt: now,
  };
}

function options(
  overrides: Partial<TranslationServiceOptions> = {},
): TranslationServiceOptions {
  const translationRepository = {
    loadBlockContext: vi.fn().mockResolvedValue({
      block: {
        id: "block-id",
        pageVersionId: "version-id",
        ordinal: 1,
        type: "paragraph",
        headingPath: ["Guide"],
        sourceText: "Use Shopify CLI.",
        payload: { protectedTokens: [] },
        fingerprint: "fingerprint",
        translatable: true,
        createdAt: now,
        pageTitle: "Guide",
        canonicalUrl: "https://shopify.dev/docs/guide",
      },
      previousText: "Previous.",
      nextText: "Next.",
      translation: {
        id: "translation-id",
        blockId: "block-id",
        sourceFingerprint: "fingerprint",
        status: "pending",
        currentRevisionId: null,
        reviewReason: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
    findBlockCorrection: vi.fn().mockResolvedValue(null),
    findGlobalCorrection: vi.fn().mockResolvedValue(null),
    findAiMemory: vi.fn().mockResolvedValue(null),
    publishRevision: vi.fn().mockResolvedValue({
      kind: "published",
      revision: revision(),
    }),
    markFailed: vi.fn().mockResolvedValue({ kind: "updated" }),
    markOversized: vi.fn().mockResolvedValue({ kind: "updated" }),
  };
  const tokenBudget = {
    reserve: vi.fn().mockResolvedValue({
      reserved: true,
      reservationId: "reservation-id",
    }),
    markRequestStarted: vi.fn().mockResolvedValue(undefined),
    settle: vi.fn().mockResolvedValue({ chargedTokens: 12 }),
  };
  const audit = {
    record: vi.fn().mockResolvedValue({ id: "model-call-id" }),
  };
  const successfulClient = () => ({
    serializeRequest: vi.fn().mockReturnValue('{"request":true}'),
    translate: vi.fn().mockResolvedValue({
      content: successfulContent(),
      usage: { inputTokens: 10, outputTokens: 2 },
      requestBody: '{"request":true}',
      responseBodyHash: "response-hash",
    }),
  });

  return {
    translationRepository,
    tokenBudget,
    audit,
    readiness: {
      deepseek: {
        id: "deepseek-id",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        keyHint: "****key",
        enabled: true,
        createdAt: now,
        updatedAt: now,
        apiKey: "secret",
      },
      qwen: {
        id: "qwen-id",
        provider: "qwen",
        baseUrl:
          "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelId: "qwen-plus",
        keyHint: "****key",
        enabled: true,
        createdAt: now,
        updatedAt: now,
        apiKey: "secret",
      },
      prompt: {
        id: "prompt-id",
        version: 1,
        systemPrompt: "Translate safely.",
        userPromptTemplate: "{{sourceText}}",
        contentFingerprint: "prompt-fingerprint",
        active: true,
        createdAt: now,
      },
      glossary: {
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
      },
      settings: {
        dailyTokenLimit: 100_000,
        budgetTimeZone: "Asia/Shanghai",
        requestTimeoutMs: 60_000,
        maxInputBytes: 100_000,
        maxOutputTokens: 1_000,
        workerConcurrency: 1,
      },
    },
    clients: {
      deepseek: successfulClient(),
      qwen: successfulClient(),
    },
    now: () => now,
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("translation service", () => {
  it("uses block correction before global correction, memory, or models", async () => {
    const input = options();
    vi.mocked(
      input.translationRepository.findBlockCorrection,
    ).mockResolvedValue(correction("块级译文。") as never);
    vi.mocked(
      input.translationRepository.findGlobalCorrection,
    ).mockResolvedValue(correction("全局译文。") as never);

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toEqual({
      outcome: "completed",
      source: "block_manual",
    });
    expect(
      input.translationRepository.publishRevision,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "block_manual",
        translatedText: "块级译文。",
      }),
    );
    expect(input.tokenBudget.reserve).not.toHaveBeenCalled();
    expect(input.clients.deepseek.translate).not.toHaveBeenCalled();
  });

  it("uses global correction before AI memory", async () => {
    const input = options();
    vi.mocked(
      input.translationRepository.findGlobalCorrection,
    ).mockResolvedValue(correction("全局译文。") as never);
    vi.mocked(
      input.translationRepository.findAiMemory,
    ).mockResolvedValue(revision({ translatedText: "记忆译文。" }) as never);

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      source: "global_manual",
    });
    expect(
      input.translationRepository.findAiMemory,
    ).not.toHaveBeenCalled();
    expect(input.tokenBudget.reserve).not.toHaveBeenCalled();
  });

  it("uses exact AI memory without a model call", async () => {
    const input = options();
    vi.mocked(
      input.translationRepository.findAiMemory,
    ).mockResolvedValue(revision({ translatedText: "记忆译文。" }) as never);

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      source: "ai_memory",
    });
    expect(
      input.translationRepository.findAiMemory,
    ).toHaveBeenCalledWith(
      "fingerprint",
      "prompt-id",
      "glossary-id",
    );
    expect(input.tokenBudget.reserve).not.toHaveBeenCalled();
  });

  it("skips code blocks", async () => {
    const input = options();
    const context = await input.translationRepository.loadBlockContext(
      "block-id",
    );
    if (!context) throw new Error("Expected context");
    vi.mocked(
      input.translationRepository.loadBlockContext,
    ).mockResolvedValue({
      ...context,
      block: { ...context.block, type: "code" },
    });

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toEqual({ outcome: "skipped" });
    expect(input.tokenBudget.reserve).not.toHaveBeenCalled();
  });

  it("marks an impossible request oversized before reserving", async () => {
    const input = options();
    input.readiness.settings.maxInputBytes = 1;

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({
      outcome: "terminal_failure",
      code: "translation_request_oversized",
    });
    expect(
      input.translationRepository.markOversized,
    ).toHaveBeenCalled();
    expect(input.tokenBudget.reserve).not.toHaveBeenCalled();
  });

  it("marks a strict reservation above the daily limit oversized", async () => {
    const input = options();
    input.readiness.settings.dailyTokenLimit = 1;

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({
      outcome: "terminal_failure",
      code: "translation_request_oversized",
    });
    expect(input.tokenBudget.reserve).not.toHaveBeenCalled();
  });

  it("defers until reset when the remaining budget is insufficient", async () => {
    const input = options();
    vi.mocked(input.tokenBudget.reserve).mockResolvedValue({
      reserved: false,
      reason: "budget_exhausted",
      resumeAt: new Date("2026-06-15T16:00:00.000Z"),
    });

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toEqual({
      outcome: "deferred",
      reason: "budget_exhausted",
      resumeAt: new Date("2026-06-15T16:00:00.000Z"),
    });
  });

  it("retries DeepSeek transient errors twice, then uses Qwen", async () => {
    const input = options();
    vi.mocked(input.clients.deepseek.translate)
      .mockRejectedValueOnce(
        new ProviderCallError(
          "transient_error",
          "provider_timeout",
          "timeout",
        ),
      )
      .mockRejectedValueOnce(
        new ProviderCallError(
          "transient_error",
          "provider_http_503",
          "unavailable",
        ),
      )
      .mockRejectedValueOnce(
        new ProviderCallError(
          "transient_error",
          "provider_http_503",
          "unavailable",
        ),
      );

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({ outcome: "completed", source: "ai" });
    expect(input.clients.deepseek.translate).toHaveBeenCalledTimes(3);
    expect(input.clients.qwen?.translate).toHaveBeenCalledTimes(1);
    expect(input.sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(input.sleep).toHaveBeenNthCalledWith(2, 2_000);
    expect(input.tokenBudget.settle).toHaveBeenCalledTimes(4);
    expect(input.tokenBudget.settle).toHaveBeenNthCalledWith(1, {
      reservationId: "reservation-id",
      reportedInputTokens: null,
      reportedOutputTokens: null,
      now,
    });
  });

  it("caps provider Retry-After before retrying DeepSeek", async () => {
    const input = options();
    vi.mocked(input.clients.deepseek.translate).mockRejectedValueOnce(
      new ProviderCallError(
        "transient_error",
        "provider_http_429",
        "rate limited",
        60_000,
      ),
    );

    await createTranslationService(input).run({
      jobId: "job-id",
      blockId: "block-id",
    });

    expect(input.sleep).toHaveBeenCalledWith(30_000);
    expect(input.clients.deepseek.translate).toHaveBeenCalledTimes(2);
  });

  it("routes validation failure directly to Qwen", async () => {
    const input = options();
    vi.mocked(input.clients.deepseek.translate).mockResolvedValue({
      content: '{"translatedText":"missing placeholder"}',
      usage: { inputTokens: 10, outputTokens: 2 },
      requestBody: '{"request":true}',
      responseBodyHash: "invalid-hash",
    });

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({ outcome: "completed" });
    expect(input.clients.deepseek.translate).toHaveBeenCalledOnce();
    expect(input.clients.qwen?.translate).toHaveBeenCalledOnce();
    expect(input.sleep).not.toHaveBeenCalled();
  });

  it("treats DeepSeek configuration failure as terminal", async () => {
    const input = options();
    vi.mocked(input.clients.deepseek.translate).mockRejectedValue(
      new ProviderCallError(
        "configuration_error",
        "provider_http_401",
        "unauthorized",
      ),
    );

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({
      outcome: "terminal_failure",
      code: "provider_http_401",
    });
    expect(input.clients.qwen?.translate).not.toHaveBeenCalled();
  });

  it("returns retryable failure when eligible fallback is absent", async () => {
    const input = options({
      clients: {
        ...options().clients,
        qwen: null,
      },
    });
    vi.mocked(input.clients.deepseek.translate).mockRejectedValue(
      new ProviderCallError(
        "protocol_error",
        "provider_response_invalid",
        "invalid response",
      ),
    );

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toMatchObject({
      outcome: "retryable_failure",
      code: "provider_response_invalid",
    });
  });

  it("publishes restored protected values and audits the call", async () => {
    const input = options();

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toEqual({ outcome: "completed", source: "ai" });
    expect(input.tokenBudget.markRequestStarted).toHaveBeenCalledWith(
      "reservation-id",
      now,
    );
    expect(input.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        status: "succeeded",
        requestBody: '{"request":true}',
      }),
    );
    expect(
      input.translationRepository.publishRevision,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        translatedText: "使用 Shopify CLI。",
        provider: "deepseek",
        modelCallId: "model-call-id",
      }),
    );
    expect(input.tokenBudget.settle).toHaveBeenCalledWith({
      reservationId: "reservation-id",
      reportedInputTokens: 10,
      reportedOutputTokens: 2,
      now,
    });
  });

  it("returns stale when the source changes before publication", async () => {
    const input = options();
    vi.mocked(
      input.translationRepository.publishRevision,
    ).mockResolvedValue({ kind: "stale_source" });

    await expect(
      createTranslationService(input).run({
        jobId: "job-id",
        blockId: "block-id",
      }),
    ).resolves.toEqual({ outcome: "stale" });
  });
});
