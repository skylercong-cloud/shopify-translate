import type { createJobRepository } from "@/db/repositories/job-repository";
import type { ClaimedJob } from "@/modules/jobs/types";

type JobRepository = Pick<
  ReturnType<typeof createJobRepository>,
  | "claimNext"
  | "renewLease"
  | "complete"
  | "retryOrFail"
  | "fail"
> & {
  defer?: ReturnType<typeof createJobRepository>["defer"];
};

export type JobExecutionResult =
  | { outcome: "completed" }
  | {
      outcome: "deferred";
      runAt: Date;
      code: string;
      message: string;
    }
  | {
      outcome: "retry";
      code: string;
      message: string;
      delayMs?: number;
    }
  | {
      outcome: "failed";
      code: string;
      message: string;
    };

export type LeasedJobRunResult =
  | "idle"
  | "worked"
  | "lease_lost"
  | "aborted";

type IntervalCallback = () => void | Promise<void>;

function errorDetails(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof Error) {
    return { code: "worker_job_failed", message: error.message };
  }
  return { code: "worker_job_failed", message: "Worker job failed" };
}

export function createLeasedJobRunner<
  TPayload extends Record<string, unknown>,
>(options: {
  repository: JobRepository;
  queue: "ingestion" | "translation";
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  execute(
    job: ClaimedJob<TPayload>,
    signal: AbortSignal,
  ): Promise<JobExecutionResult>;
  now?: () => Date;
  setIntervalImpl?: (
    callback: IntervalCallback,
    milliseconds: number,
  ) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}) {
  const now = options.now ?? (() => new Date());
  const setIntervalImpl =
    options.setIntervalImpl ??
    ((callback: IntervalCallback, milliseconds: number) =>
      setInterval(() => void callback(), milliseconds));
  const clearIntervalImpl =
    options.clearIntervalImpl ??
    ((handle: unknown) =>
      clearInterval(handle as ReturnType<typeof setInterval>));

  return {
    async runOnce(
      outerSignal?: AbortSignal,
    ): Promise<LeasedJobRunResult> {
      if (outerSignal?.aborted) return "aborted";

      const job = (await options.repository.claimNext({
        queue: options.queue,
        workerId: options.workerId,
        now: now(),
        leaseMs: options.leaseMs,
      })) as ClaimedJob<TPayload> | undefined;
      if (!job) return "idle";

      const jobController = new AbortController();
      const abortJob = () => jobController.abort();
      outerSignal?.addEventListener("abort", abortJob, { once: true });

      let leaseOwned = true;
      let renewalPromise: Promise<void> | undefined;
      let intervalCleared = false;
      const intervalHandle = setIntervalImpl(() => {
        if (!leaseOwned || renewalPromise) return;
        renewalPromise = (async () => {
          try {
            leaseOwned = await options.repository.renewLease(
              job.id,
              options.workerId,
              new Date(now().getTime() + options.leaseMs),
            );
            if (!leaseOwned) jobController.abort();
          } catch {
            leaseOwned = false;
            jobController.abort();
          } finally {
            renewalPromise = undefined;
          }
        })();
        return renewalPromise;
      }, options.heartbeatMs);

      async function stopRenewal(): Promise<void> {
        if (!intervalCleared) {
          clearIntervalImpl(intervalHandle);
          intervalCleared = true;
        }
        await renewalPromise;
      }

      try {
        let execution: JobExecutionResult;
        try {
          execution = await options.execute(job, jobController.signal);
        } catch (error) {
          if (outerSignal?.aborted) {
            return "aborted";
          }
          if (!leaseOwned) return "lease_lost";
          if (jobController.signal.aborted) return "aborted";
          const details = errorDetails(error);
          execution = {
            outcome: "retry",
            code: details.code,
            message: details.message,
          };
        }

        await stopRenewal();
        if (!leaseOwned) return "lease_lost";
        if (outerSignal?.aborted || jobController.signal.aborted) {
          return "aborted";
        }

        if (execution.outcome === "completed") {
          await options.repository.complete(
            job.id,
            options.workerId,
            now(),
          );
          return "worked";
        }
        if (execution.outcome === "deferred") {
          if (!options.repository.defer) {
            throw new Error("Job repository does not support deferral");
          }
          const deferred = await options.repository.defer({
            jobId: job.id,
            workerId: options.workerId,
            runAt: execution.runAt,
            reasonCode: execution.code,
            reasonMessage: execution.message,
            now: now(),
          });
          return deferred ? "worked" : "lease_lost";
        }
        if (execution.outcome === "failed") {
          await options.repository.fail({
            jobId: job.id,
            workerId: options.workerId,
            now: now(),
            errorCode: execution.code,
            errorMessage: execution.message,
          });
          return "worked";
        }

        const retryAt = now();
        await options.repository.retryOrFail({
          jobId: job.id,
          workerId: options.workerId,
          now: retryAt,
          runAt: new Date(
            retryAt.getTime() + (execution.delayMs ?? 60_000),
          ),
          errorCode: execution.code,
          errorMessage: execution.message,
        });
        return "worked";
      } finally {
        outerSignal?.removeEventListener("abort", abortJob);
        await stopRenewal();
      }
    },
  };
}
