import type { createJobRepository } from "@/db/repositories/job-repository";
import type { TokenBudgetRepository } from "@/db/repositories/token-budget-repository";
import type { ClaimedJob } from "@/modules/jobs/types";
import type { TranslationRunResult } from "@/modules/translation/translation-service";

import {
  createLeasedJobRunner,
  type JobExecutionResult,
  type LeasedJobRunResult,
} from "./leased-job-runner";

type JobRepository = Pick<
  ReturnType<typeof createJobRepository>,
  | "claimNext"
  | "renewLease"
  | "complete"
  | "retryOrFail"
  | "fail"
  | "defer"
>;

type TranslationService = {
  run(
    input: { jobId: string; blockId: string },
    signal?: AbortSignal,
  ): Promise<TranslationRunResult>;
};

type TranslationBudget = Pick<
  TokenBudgetRepository,
  "getAvailability"
>;

type TranslationPayload = {
  blockId: string;
  contentFingerprint: string;
};

const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

function retryDelay(attempts: number): number {
  return RETRY_BACKOFF_MS[
    Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)
  ];
}

function validPayload(
  job: ClaimedJob,
): job is ClaimedJob<TranslationPayload> {
  return (
    job.queue === "translation" &&
    job.type === "translate_block" &&
    typeof job.payload.blockId === "string" &&
    job.payload.blockId.length > 0 &&
    typeof job.payload.contentFingerprint === "string" &&
    job.payload.contentFingerprint.length > 0
  );
}

function executionResult(
  result: TranslationRunResult,
  attempts: number,
): JobExecutionResult {
  if (
    result.outcome === "completed" ||
    result.outcome === "skipped" ||
    result.outcome === "stale"
  ) {
    return { outcome: "completed" };
  }
  if (result.outcome === "deferred") {
    return {
      outcome: "deferred",
      runAt: result.resumeAt,
      code: result.reason,
      message: "Daily translation budget is exhausted",
    };
  }
  if (result.outcome === "terminal_failure") {
    return {
      outcome: "failed",
      code: result.code,
      message: result.message,
    };
  }
  return {
    outcome: "retry",
    code: result.code,
    message: result.message,
    delayMs: retryDelay(attempts),
  };
}

async function sleepWithAbort(
  sleep: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!signal) {
    await sleep(milliseconds);
    return true;
  }

  let abort!: () => void;
  const onAbort = () => abort();
  const aborted = new Promise<void>((resolve) => {
    abort = resolve;
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(milliseconds), aborted]);
    return !signal.aborted;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createTranslationWorker(options: {
  jobRepository: JobRepository;
  translationService: TranslationService;
  tokenBudget: TranslationBudget;
  ensureReady(): Promise<void>;
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  pollIntervalMs: number;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  setIntervalImpl?: (
    callback: () => void | Promise<void>,
    milliseconds: number,
  ) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}) {
  let readiness: Promise<void> | undefined;
  const ensureReady = () => (readiness ??= options.ensureReady());
  const runner = createLeasedJobRunner<TranslationPayload>({
    repository: options.jobRepository,
    queue: "translation",
    workerId: options.workerId,
    leaseMs: options.leaseMs,
    heartbeatMs: options.heartbeatMs,
    now: options.now,
    setIntervalImpl: options.setIntervalImpl,
    clearIntervalImpl: options.clearIntervalImpl,
    async execute(job, signal) {
      if (!validPayload(job)) {
        return {
          outcome: "failed",
          code: "worker_payload_invalid",
          message:
            "Translation job payload must include blockId and contentFingerprint",
        };
      }
      const result = await options.translationService.run(
        { jobId: job.id, blockId: job.payload.blockId },
        signal,
      );
      return executionResult(result, job.attempts);
    },
  });

  async function runOnce(
    signal?: AbortSignal,
  ): Promise<LeasedJobRunResult | "budget_exhausted"> {
    if (signal?.aborted) return "aborted";
    await ensureReady();

    const availability = await options.tokenBudget.getAvailability(
      options.now(),
    );
    if (!availability.configured) {
      throw new Error("A daily token limit is required");
    }
    if (availability.exhausted) {
      const slept = await sleepWithAbort(
        options.sleep,
        Math.max(
          0,
          availability.resetAt.getTime() - options.now().getTime(),
        ),
        signal,
      );
      return slept ? "budget_exhausted" : "aborted";
    }

    return runner.runOnce(signal);
  }

  return {
    runOnce,
    async run(signal?: AbortSignal): Promise<void> {
      while (!signal?.aborted) {
        const result = await runOnce(signal);
        if (result === "aborted") return;
        if (result === "idle") {
          const slept = await sleepWithAbort(
            options.sleep,
            options.pollIntervalMs,
            signal,
          );
          if (!slept) return;
        }
      }
    },
  };
}
