import type { createJobRepository } from "@/db/repositories/job-repository";
import { IngestionError } from "@/modules/ingestion/errors";
import type { ClaimedJob } from "@/modules/jobs/types";

type JobRepository = Pick<
  ReturnType<typeof createJobRepository>,
  "claimNext" | "renewLease" | "complete" | "retryOrFail" | "fail"
>;

type IngestionService = {
  refreshRobotsPolicy(): Promise<unknown>;
  discoverPages(): Promise<unknown>;
  ingestPage(url: string, jobId: string): Promise<unknown>;
  cleanupExpiredPayloads(): Promise<number>;
};

type IngestionScheduler = {
  ensureMaintenanceJobs(now: Date): Promise<void>;
  scheduleDailyPageRefreshes(now: Date): Promise<number>;
};

type WorkerResult = "idle" | "worked" | "lease_lost";
type IntervalCallback = () => void | Promise<void>;

const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

class TerminalWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TerminalWorkerError";
  }
}

function errorDetails(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof TerminalWorkerError || error instanceof IngestionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "worker_job_failed", message: error.message };
  }
  return { code: "worker_job_failed", message: "Worker job failed" };
}

function retryDelay(attempts: number): number {
  return RETRY_BACKOFF_MS[
    Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)
  ];
}

function requirePayloadUrl(job: ClaimedJob): string {
  const url = job.payload.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new TerminalWorkerError(
      "worker_payload_invalid",
      "Fetch job payload must include a URL",
    );
  }
  return url;
}

function nextUtcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 1,
    ),
  );
}

export function createIngestionWorker(deps: {
  jobRepository: JobRepository;
  ingestionService: IngestionService;
  scheduler: IngestionScheduler;
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  jitter: (baseMilliseconds: number) => number;
  setIntervalImpl?: (
    callback: IntervalCallback,
    milliseconds: number,
  ) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}) {
  const setIntervalImpl =
    deps.setIntervalImpl ??
    ((callback: IntervalCallback, milliseconds: number) =>
      setInterval(() => void callback(), milliseconds));
  const clearIntervalImpl =
    deps.clearIntervalImpl ??
    ((handle: unknown) =>
      clearInterval(handle as ReturnType<typeof setInterval>));

  async function dispatch(job: ClaimedJob): Promise<void> {
    if (job.type === "discover_sitemap") {
      await deps.ingestionService.refreshRobotsPolicy();
      await deps.ingestionService.discoverPages();
      await deps.scheduler.scheduleDailyPageRefreshes(deps.now());
      await deps.scheduler.ensureMaintenanceJobs(
        nextUtcDayStart(deps.now()),
      );
      return;
    }
    if (job.type === "fetch_page") {
      await deps.ingestionService.ingestPage(
        requirePayloadUrl(job),
        job.id,
      );
      return;
    }
    if (job.type === "cleanup_payloads") {
      await deps.ingestionService.cleanupExpiredPayloads();
      await deps.scheduler.ensureMaintenanceJobs(
        nextUtcDayStart(deps.now()),
      );
      return;
    }
    throw new TerminalWorkerError(
      "worker_job_type_invalid",
      "Translation jobs cannot run on the ingestion worker",
    );
  }

  async function runOnce(): Promise<WorkerResult> {
    const claimedAt = deps.now();
    const job = await deps.jobRepository.claimNext({
      queue: "ingestion",
      workerId: deps.workerId,
      now: claimedAt,
      leaseMs: deps.leaseMs,
    });
    if (!job) return "idle";

    let leaseOwned = true;
    let renewalPromise: Promise<void> | undefined;
    let intervalCleared = false;
    const intervalHandle = setIntervalImpl(() => {
      if (!leaseOwned || renewalPromise) return;
      renewalPromise = (async () => {
        try {
          leaseOwned = await deps.jobRepository.renewLease(
            job.id,
            deps.workerId,
            new Date(deps.now().getTime() + deps.leaseMs),
          );
        } catch {
          leaseOwned = false;
        } finally {
          renewalPromise = undefined;
        }
      })();
      return renewalPromise;
    }, Math.max(1, Math.floor(deps.leaseMs / 3)));

    async function stopRenewal(): Promise<void> {
      if (!intervalCleared) {
        clearIntervalImpl(intervalHandle);
        intervalCleared = true;
      }
      await renewalPromise;
    }

    try {
      await dispatch(job);
      await stopRenewal();
      if (!leaseOwned) return "lease_lost";
      await deps.jobRepository.complete(job.id, deps.workerId, deps.now());
      return "worked";
    } catch (error) {
      await stopRenewal();
      if (!leaseOwned) return "lease_lost";

      const details = errorDetails(error);
      if (error instanceof TerminalWorkerError) {
        await deps.jobRepository.fail({
          jobId: job.id,
          workerId: deps.workerId,
          now: deps.now(),
          errorCode: details.code,
          errorMessage: details.message,
        });
        return "worked";
      }

      const baseDelay = retryDelay(job.attempts);
      const now = deps.now();
      await deps.jobRepository.retryOrFail({
        jobId: job.id,
        workerId: deps.workerId,
        now,
        runAt: new Date(
          now.getTime() + baseDelay + Math.max(0, deps.jitter(baseDelay)),
        ),
        errorCode: details.code,
        errorMessage: details.message,
      });
      return "worked";
    } finally {
      await stopRenewal();
    }
  }

  return {
    runOnce,
    async run(signal?: AbortSignal): Promise<void> {
      while (!signal?.aborted) {
        const result = await runOnce();
        if (result === "idle" && !signal?.aborted) {
          await deps.sleep(deps.pollIntervalMs);
        }
      }
    },
  };
}
