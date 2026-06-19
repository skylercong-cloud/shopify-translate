import type { TokenBudgetRepository } from "@/db/repositories/token-budget-repository";
import type {
  StoredTranslationCorrection,
  StoredTranslationRevision,
  TranslationRepository,
  TranslationRevisionSource,
} from "@/db/repositories/translation-repository";
import type { ProtectedToken } from "@/modules/ingestion/types";
import type { DatabaseWriteHealth } from "@/modules/operations/database-write-health";

import type { TranslationWorkerReadiness } from "./config-service";
import type {
  ModelCallAudit,
  ModelCallAuditInput,
} from "./model-call-audit";
import {
  TranslationOutputValidationError,
  validateTranslationOutput,
} from "./output-validation";
import { renderTranslationPrompt } from "./prompt-renderer";
import {
  protectTranslationInput,
  type ProtectedTranslationInput,
} from "./protection";
import type {
  TranslationProviderClient,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "./provider-client";
import {
  ProviderCallError,
  type ProviderFailureKind,
} from "./provider-errors";
import { estimateStrictReservation } from "./token-budget";

type TranslationRepositoryPort = Pick<
  TranslationRepository,
  | "loadBlockContext"
  | "findBlockCorrection"
  | "findGlobalCorrection"
  | "findAiMemory"
  | "publishRevision"
  | "markFailed"
  | "markOversized"
>;

type TokenBudgetPort = Pick<
  TokenBudgetRepository,
  "reserve" | "markRequestStarted" | "settle"
>;

type WriteHealthPort = {
  check(): Promise<DatabaseWriteHealth>;
};

export type TranslationRunResult =
  | { outcome: "completed"; source: TranslationRevisionSource }
  | { outcome: "skipped" }
  | {
      outcome: "deferred";
      resumeAt: Date;
      reason: "budget_exhausted";
    }
  | { outcome: "stale" }
  | {
      outcome: "retryable_failure";
      code: string;
      message: string;
    }
  | {
      outcome: "terminal_failure";
      code: string;
      message: string;
    };

export type TranslationServiceOptions = {
  translationRepository: TranslationRepositoryPort;
  tokenBudget: TokenBudgetPort;
  audit: ModelCallAudit;
  readiness: TranslationWorkerReadiness;
  clients: {
    deepseek: TranslationProviderClient;
    qwen: TranslationProviderClient | null;
  };
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  writeHealth?: WriteHealthPort;
};

type ProviderName = "deepseek" | "qwen";

type ProviderSuccess = {
  kind: "success";
  translatedText: string;
  provider: ProviderName;
  modelId: string;
  modelCallId: string;
};

type ProviderFailure = {
  kind: "failure";
  failureKind: ProviderFailureKind | "validation_error";
  code: string;
  message: string;
  retryAfterMs?: number;
};

type ProviderAttempt =
  | ProviderSuccess
  | ProviderFailure
  | {
      kind: "deferred";
      resumeAt: Date;
    }
  | {
      kind: "oversized";
      message: string;
    };

function parserTokens(payload: Record<string, unknown>): ProtectedToken[] {
  return Array.isArray(payload.protectedTokens)
    ? (payload.protectedTokens as ProtectedToken[])
    : [];
}

function latencyMs(startedAt: Date, completedAt: Date): number {
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

function auditStatus(
  failureKind: ProviderFailure["failureKind"],
): ModelCallAuditInput["status"] {
  return failureKind;
}

function failureFrom(error: unknown): ProviderFailure {
  if (error instanceof TranslationOutputValidationError) {
    return {
      kind: "failure",
      failureKind: "validation_error",
      code: error.code,
      message: `Translation output validation failed: ${error.code}`,
    };
  }
  if (error instanceof ProviderCallError) {
    return {
      kind: "failure",
      failureKind: error.kind,
      code: error.code,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    };
  }
  return {
    kind: "failure",
    failureKind: "transient_error",
    code: "translation_call_failed",
    message: "Translation provider call failed",
  };
}

export function createTranslationService(
  options: TranslationServiceOptions,
) {
  async function writeHealthFailure(): Promise<TranslationRunResult | null> {
    const health = await options.writeHealth?.check();
    if (!health || health.writable) return null;

    return {
      outcome: "retryable_failure",
      code: health.code,
      message: health.message,
    };
  }

  async function publishMemory(input: {
    blockId: string;
    sourceFingerprint: string;
    source: TranslationRevisionSource;
    translatedText: string;
    memory?: StoredTranslationRevision;
  }): Promise<TranslationRunResult> {
    const published =
      await options.translationRepository.publishRevision({
        blockId: input.blockId,
        expectedSourceFingerprint: input.sourceFingerprint,
        source: input.source,
        translatedText: input.translatedText,
        provider: input.memory?.provider ?? null,
        modelId: input.memory?.modelId ?? null,
        promptVersionId: input.memory?.promptVersionId ?? null,
        glossaryVersionId: input.memory?.glossaryVersionId ?? null,
        modelCallId: input.memory?.modelCallId ?? null,
        now: options.now(),
      });
    return published.kind === "stale_source"
      ? { outcome: "stale" }
      : { outcome: "completed", source: input.source };
  }

  async function publishCorrection(
    blockId: string,
    sourceFingerprint: string,
    source: "block_manual" | "global_manual",
    correction: StoredTranslationCorrection,
  ): Promise<TranslationRunResult> {
    return publishMemory({
      blockId,
      sourceFingerprint,
      source,
      translatedText: correction.translatedText,
    });
  }

  async function callProvider(input: {
    jobId: string;
    blockId: string;
    provider: ProviderName;
    client: TranslationProviderClient;
    request: TranslationProviderRequest;
    protectedInput: ProtectedTranslationInput;
    callSequence: number;
    signal?: AbortSignal;
  }): Promise<ProviderAttempt> {
    const requestBody = input.client.serializeRequest(input.request);
    const requestBytes = Buffer.byteLength(requestBody, "utf8");
    const reservationTokens = estimateStrictReservation(
      requestBody,
      input.request.maxOutputTokens,
    );
    if (
      requestBytes > options.readiness.settings.maxInputBytes ||
      reservationTokens >
        (options.readiness.settings.dailyTokenLimit ?? 0)
    ) {
      return {
        kind: "oversized",
        message:
          "Translation request exceeds the configured input or daily token limit",
      };
    }

    const reserved = await options.tokenBudget.reserve({
      jobId: input.jobId,
      blockId: input.blockId,
      provider: input.provider,
      tokens: reservationTokens,
      now: options.now(),
    });
    if (!reserved.reserved) {
      return { kind: "deferred", resumeAt: reserved.resumeAt };
    }

    const startedAt = options.now();
    await options.tokenBudget.markRequestStarted(
      reserved.reservationId,
      startedAt,
    );
    let providerResult: TranslationProviderResult | null = null;

    try {
      providerResult = await input.client.translate(
        input.request,
        input.signal,
      );
      const validated = validateTranslationOutput({
        content: providerResult.content,
        protectedInput: input.protectedInput,
        maxResponseBytes: options.readiness.settings.maxInputBytes,
      });
      const completedAt = options.now();
      const audit = await options.audit.record({
        jobId: input.jobId,
        blockId: input.blockId,
        provider: input.provider,
        modelId: input.request.modelId,
        promptVersionId: options.readiness.prompt.id,
        glossaryVersionId: options.readiness.glossary.id,
        callSequence: input.callSequence,
        status: "succeeded",
        inputTokens: providerResult.usage?.inputTokens ?? null,
        outputTokens: providerResult.usage?.outputTokens ?? null,
        latencyMs: latencyMs(startedAt, completedAt),
        requestBody,
        responseBodyHash: providerResult.responseBodyHash,
        errorCode: null,
        errorMessage: null,
        startedAt,
        completedAt,
      });
      return {
        kind: "success",
        translatedText: validated.translatedText,
        provider: input.provider,
        modelId: input.request.modelId,
        modelCallId: audit.id,
      };
    } catch (error) {
      const aborted =
        input.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      const failure = aborted
        ? {
            kind: "failure" as const,
            failureKind: "transient_error" as const,
            code: "worker_shutdown",
            message: "Translation request aborted during worker shutdown",
          }
        : failureFrom(error);
      const completedAt = options.now();
      await options.audit.record({
        jobId: input.jobId,
        blockId: input.blockId,
        provider: input.provider,
        modelId: input.request.modelId,
        promptVersionId: options.readiness.prompt.id,
        glossaryVersionId: options.readiness.glossary.id,
        callSequence: input.callSequence,
        status: auditStatus(failure.failureKind),
        inputTokens: providerResult?.usage?.inputTokens ?? null,
        outputTokens: providerResult?.usage?.outputTokens ?? null,
        latencyMs: latencyMs(startedAt, completedAt),
        requestBody,
        responseBodyHash: providerResult?.responseBodyHash ?? null,
        errorCode: failure.code,
        errorMessage: failure.message,
        startedAt,
        completedAt,
      });
      if (aborted) throw error;
      return failure;
    } finally {
      await options.tokenBudget.settle({
        reservationId: reserved.reservationId,
        reportedInputTokens: providerResult?.usage?.inputTokens ?? null,
        reportedOutputTokens: providerResult?.usage?.outputTokens ?? null,
        now: options.now(),
      });
    }
  }

  async function publishProviderResult(input: {
    blockId: string;
    sourceFingerprint: string;
    success: ProviderSuccess;
  }): Promise<TranslationRunResult> {
    const published =
      await options.translationRepository.publishRevision({
        blockId: input.blockId,
        expectedSourceFingerprint: input.sourceFingerprint,
        source: "ai",
        translatedText: input.success.translatedText,
        provider: input.success.provider,
        modelId: input.success.modelId,
        promptVersionId: options.readiness.prompt.id,
        glossaryVersionId: options.readiness.glossary.id,
        modelCallId: input.success.modelCallId,
        now: options.now(),
      });
    return published.kind === "stale_source"
      ? { outcome: "stale" }
      : { outcome: "completed", source: "ai" };
  }

  async function recordFailure(
    blockId: string,
    sourceFingerprint: string,
    failure: ProviderFailure,
    terminal: boolean,
  ): Promise<TranslationRunResult> {
    const updated = await options.translationRepository.markFailed(
      blockId,
      sourceFingerprint,
      failure.code,
      failure.message,
      options.now(),
    );
    if (updated.kind === "stale_source") {
      return { outcome: "stale" };
    }
    return {
      outcome: terminal ? "terminal_failure" : "retryable_failure",
      code: failure.code,
      message: failure.message,
    };
  }

  return {
    async run(input: {
      jobId: string;
      blockId: string;
    }, signal?: AbortSignal): Promise<TranslationRunResult> {
      let callSequence = 0;
      const context =
        await options.translationRepository.loadBlockContext(
          input.blockId,
        );
      if (!context || !context.block.translatable) {
        return { outcome: "skipped" };
      }
      const block = context.block;
      if (block.type === "code") return { outcome: "skipped" };

      const writeFailure = await writeHealthFailure();
      if (writeFailure) return writeFailure;

      const blockCorrection =
        await options.translationRepository.findBlockCorrection(
          block.id,
          block.fingerprint,
        );
      if (blockCorrection) {
        return publishCorrection(
          block.id,
          block.fingerprint,
          "block_manual",
          blockCorrection,
        );
      }
      const globalCorrection =
        await options.translationRepository.findGlobalCorrection(
          block.fingerprint,
        );
      if (globalCorrection) {
        return publishCorrection(
          block.id,
          block.fingerprint,
          "global_manual",
          globalCorrection,
        );
      }
      const memory = await options.translationRepository.findAiMemory(
        block.fingerprint,
        options.readiness.prompt.id,
        options.readiness.glossary.id,
      );
      if (memory) {
        return publishMemory({
          blockId: block.id,
          sourceFingerprint: block.fingerprint,
          source: "ai_memory",
          translatedText: memory.translatedText,
          memory,
        });
      }

      const protectedInput = protectTranslationInput({
        sourceText: block.sourceText,
        blockKind: block.type,
        parserTokens: parserTokens(block.payload),
        glossaryTerms: options.readiness.glossary.terms.map(
          (term) => term.sourceTerm,
        ),
      });
      if ("translatable" in protectedInput) {
        return { outcome: "skipped" };
      }
      const userPrompt = renderTranslationPrompt({
        template: options.readiness.prompt.userPromptTemplate,
        sourceText: protectedInput.protectedText,
        previousContext: context.previousText,
        nextContext: context.nextText,
        protectedTerms: protectedInput.placeholders.map(
          (item) => item.sourceValue,
        ),
      });
      const requestBase = {
        systemPrompt: options.readiness.prompt.systemPrompt,
        userPrompt,
        maxOutputTokens: options.readiness.settings.maxOutputTokens,
      };

      let deepseekFailure: ProviderFailure | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (signal?.aborted) {
          throw new DOMException(
            "Translation request aborted",
            "AbortError",
          );
        }
        const result = await callProvider({
          jobId: input.jobId,
          blockId: block.id,
          provider: "deepseek",
          client: options.clients.deepseek,
          request: {
            ...requestBase,
            modelId: options.readiness.deepseek.modelId,
          },
          protectedInput,
          callSequence: ++callSequence,
          signal,
        });
        if (result.kind === "success") {
          return publishProviderResult({
            blockId: block.id,
            sourceFingerprint: block.fingerprint,
            success: result,
          });
        }
        if (result.kind === "deferred") {
          return {
            outcome: "deferred",
            reason: "budget_exhausted",
            resumeAt: result.resumeAt,
          };
        }
        if (result.kind === "oversized") {
          const updated =
            await options.translationRepository.markOversized(
              block.id,
              block.fingerprint,
              result.message,
              options.now(),
            );
          return updated.kind === "stale_source"
            ? { outcome: "stale" }
            : {
                outcome: "terminal_failure",
                code: "translation_request_oversized",
                message: result.message,
              };
        }

        deepseekFailure = result;
        if (
          result.failureKind !== "transient_error" ||
          attempt === 2
        ) {
          break;
        }
        const retryAfter = Math.min(
          result.retryAfterMs ?? 0,
          30_000,
        );
        await options.sleep(
          Math.max((attempt + 1) * 1_000, retryAfter),
        );
      }

      if (!deepseekFailure) {
        throw new Error("DeepSeek attempt completed without a result");
      }
      if (deepseekFailure.failureKind === "configuration_error") {
        return recordFailure(
          block.id,
          block.fingerprint,
          deepseekFailure,
          true,
        );
      }
      if (!options.clients.qwen || !options.readiness.qwen) {
        return recordFailure(
          block.id,
          block.fingerprint,
          deepseekFailure,
          false,
        );
      }

      const qwenResult = await callProvider({
        jobId: input.jobId,
        blockId: block.id,
        provider: "qwen",
        client: options.clients.qwen,
        request: {
          ...requestBase,
          modelId: options.readiness.qwen.modelId,
        },
        protectedInput,
        callSequence: ++callSequence,
        signal,
      });
      if (qwenResult.kind === "success") {
        return publishProviderResult({
          blockId: block.id,
          sourceFingerprint: block.fingerprint,
          success: qwenResult,
        });
      }
      if (qwenResult.kind === "deferred") {
        return {
          outcome: "deferred",
          reason: "budget_exhausted",
          resumeAt: qwenResult.resumeAt,
        };
      }
      if (qwenResult.kind === "oversized") {
        const updated =
          await options.translationRepository.markOversized(
            block.id,
            block.fingerprint,
            qwenResult.message,
            options.now(),
          );
        return updated.kind === "stale_source"
          ? { outcome: "stale" }
          : {
              outcome: "terminal_failure",
              code: "translation_request_oversized",
              message: qwenResult.message,
            };
      }
      return recordFailure(
        block.id,
        block.fingerprint,
        qwenResult,
        qwenResult.failureKind === "configuration_error",
      );
    },
  };
}
