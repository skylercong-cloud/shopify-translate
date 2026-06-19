import { describe, expect, it, vi } from "vitest";

import { createTranslationWorker } from "@/modules/jobs/translation-worker";
import type { ClaimedJob } from "@/modules/jobs/types";
import type { TranslationRunResult } from "@/modules/translation/translation-service";

const now = new Date("2026-06-15T08:00:00.000Z");

function claimedJob(
  payload: Record<string, unknown> = {
    blockId: "00000000-0000-4000-8000-000000000002",
    contentFingerprint: "fingerprint",
  },
): ClaimedJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    queue: "translation",
    type: "translate_block",
    dedupeKey: "translate:block:fingerprint",
    payload,
    priority: 0,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    runAt: now,
    leaseOwner: "translation-worker",
    leaseExpiresAt: new Date(now.getTime() + 180_000),
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function dependencies(
  result: TranslationRunResult = {
    outcome: "completed",
    source: "ai",
  },
) {
  return {
    jobRepository: {
      claimNext: vi.fn().mockResolvedValue(claimedJob()),
      renewLease: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(undefined),
      retryOrFail: vi.fn().mockResolvedValue("queued" as const),
      fail: vi.fn().mockResolvedValue(undefined),
      defer: vi.fn().mockResolvedValue(true),
    },
    translationService: {
      run: vi.fn().mockResolvedValue(result),
    },
    tokenBudget: {
      getAvailability: vi.fn().mockResolvedValue({
        configured: true,
        exhausted: false,
        remaining: 100_000,
        resetAt: new Date("2026-06-15T16:00:00.000Z"),
      }),
    },
    ensureReady: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

function worker(
  deps: ReturnType<typeof dependencies>,
  overrides: Partial<Parameters<typeof createTranslationWorker>[0]> = {},
) {
  return createTranslationWorker({
    ...deps,
    workerId: "translation-worker",
    leaseMs: 180_000,
    heartbeatMs: 60_000,
    pollIntervalMs: 1_000,
    now: () => now,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => undefined,
    ...overrides,
  });
}

describe("translation worker", () => {
  it("checks readiness before claiming and permits absent Qwen upstream", async () => {
    const deps = dependencies();
    const readinessOrder = deps.ensureReady.mock.invocationCallOrder;
    const claimOrder = deps.jobRepository.claimNext.mock.invocationCallOrder;

    await expect(worker(deps).runOnce()).resolves.toBe("worked");

    expect(deps.ensureReady).toHaveBeenCalledOnce();
    expect(readinessOrder[0]).toBeLessThan(claimOrder[0]);
    expect(deps.jobRepository.claimNext).toHaveBeenCalledWith({
      queue: "translation",
      workerId: "translation-worker",
      now,
      leaseMs: 180_000,
    });
  });

  it("does not claim when the daily budget is exhausted", async () => {
    const deps = dependencies();
    deps.tokenBudget.getAvailability.mockResolvedValue({
      configured: true,
      exhausted: true,
      remaining: 0,
      resetAt: new Date("2026-06-15T16:00:00.000Z"),
    });

    await expect(worker(deps).runOnce()).resolves.toBe(
      "budget_exhausted",
    );

    expect(deps.jobRepository.claimNext).not.toHaveBeenCalled();
    expect(deps.sleep).toHaveBeenCalledWith(8 * 60 * 60 * 1_000);
  });

  it.each([
    { outcome: "completed", source: "ai" },
    { outcome: "skipped" },
    { outcome: "stale" },
  ] satisfies TranslationRunResult[])(
    "completes a job for $outcome",
    async (result) => {
      const deps = dependencies(result);

      await expect(worker(deps).runOnce()).resolves.toBe("worked");

      expect(deps.jobRepository.complete).toHaveBeenCalledWith(
        expect.any(String),
        "translation-worker",
        now,
      );
    },
  );

  it("defers budget exhaustion without consuming the attempt", async () => {
    const resumeAt = new Date("2026-06-15T16:00:00.000Z");
    const deps = dependencies({
      outcome: "deferred",
      reason: "budget_exhausted",
      resumeAt,
    });

    await expect(worker(deps).runOnce()).resolves.toBe("worked");

    expect(deps.jobRepository.defer).toHaveBeenCalledWith({
      jobId: expect.any(String),
      workerId: "translation-worker",
      runAt: resumeAt,
      reasonCode: "budget_exhausted",
      reasonMessage: "Daily translation budget is exhausted",
      now,
    });
    expect(deps.jobRepository.retryOrFail).not.toHaveBeenCalled();
  });

  it("requeues retryable translation failures", async () => {
    const deps = dependencies({
      outcome: "retryable_failure",
      code: "provider_timeout",
      message: "Provider request timed out",
    });

    await expect(worker(deps).runOnce()).resolves.toBe("worked");

    expect(deps.jobRepository.retryOrFail).toHaveBeenCalledWith({
      jobId: expect.any(String),
      workerId: "translation-worker",
      now,
      runAt: new Date("2026-06-15T08:01:00.000Z"),
      errorCode: "provider_timeout",
      errorMessage: "Provider request timed out",
    });
  });

  it("fails terminal translation failures immediately", async () => {
    const deps = dependencies({
      outcome: "terminal_failure",
      code: "provider_http_401",
      message: "Provider request failed with HTTP 401",
    });

    await expect(worker(deps).runOnce()).resolves.toBe("worked");

    expect(deps.jobRepository.fail).toHaveBeenCalledWith({
      jobId: expect.any(String),
      workerId: "translation-worker",
      now,
      errorCode: "provider_http_401",
      errorMessage: "Provider request failed with HTTP 401",
    });
  });

  it("fails unsupported job payloads without invoking translation", async () => {
    const deps = dependencies();
    deps.jobRepository.claimNext.mockResolvedValue(
      claimedJob({ blockId: "", contentFingerprint: 12 }),
    );

    await expect(worker(deps).runOnce()).resolves.toBe("worked");

    expect(deps.translationService.run).not.toHaveBeenCalled();
    expect(deps.jobRepository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "worker_payload_invalid",
      }),
    );
  });

  it("aborts an in-flight translation during graceful shutdown", async () => {
    const deps = dependencies();
    deps.translationService.run.mockImplementation(
      async (_input, signal?: AbortSignal) =>
        await new Promise<TranslationRunResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const controller = new AbortController();
    const running = worker(deps).runOnce(controller.signal);
    await vi.waitFor(() =>
      expect(deps.translationService.run).toHaveBeenCalledOnce(),
    );

    controller.abort();

    await expect(running).resolves.toBe("aborted");
    expect(deps.jobRepository.complete).not.toHaveBeenCalled();
    expect(deps.jobRepository.retryOrFail).not.toHaveBeenCalled();
    expect(deps.jobRepository.fail).not.toHaveBeenCalled();
  });
});
