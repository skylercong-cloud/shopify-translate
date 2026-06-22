import type { createJobRepository } from "@/db/repositories/job-repository";
import { IngestionError } from "@/modules/ingestion/errors";
import {
  createLeasedJobRunner,
  type JobExecutionResult,
} from "@/modules/jobs/leased-job-runner";
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
  const runner = createLeasedJobRunner({
    repository: deps.jobRepository,
    queue: "ingestion",
    workerId: deps.workerId,
    leaseMs: deps.leaseMs,
    heartbeatMs: Math.max(1, Math.floor(deps.leaseMs / 3)),
    now: deps.now,
    setIntervalImpl: deps.setIntervalImpl,
    clearIntervalImpl: deps.clearIntervalImpl,
    async execute(job): Promise<JobExecutionResult> {
      try {
        if (job.type === "discover_sitemap") {
          await deps.ingestionService.refreshRobotsPolicy();
          await deps.ingestionService.discoverPages();
          await deps.scheduler.ensureMaintenanceJobs(
            nextUtcDayStart(deps.now()),
          );
          return { outcome: "completed" };
        }
        if (job.type === "fetch_page") {
          await deps.ingestionService.ingestPage(
            requirePayloadUrl(job),
            job.id,
          );
          return { outcome: "completed" };
        }
        if (job.type === "cleanup_payloads") {
          await deps.ingestionService.cleanupExpiredPayloads();
          await deps.scheduler.ensureMaintenanceJobs(
            nextUtcDayStart(deps.now()),
          );
          return { outcome: "completed" };
        }
        throw new TerminalWorkerError(
          "worker_job_type_invalid",
          "Translation jobs cannot run on the ingestion worker",
        );
      } catch (error) {
        const details = errorDetails(error);
        if (error instanceof TerminalWorkerError) {
          return { outcome: "failed", ...details };
        }
        const baseDelay = retryDelay(job.attempts);
        return {
          outcome: "retry",
          ...details,
          delayMs:
            baseDelay + Math.max(0, deps.jitter(baseDelay)),
        };
      }
    },
  });

  return {
    runOnce: runner.runOnce,
    async run(signal?: AbortSignal): Promise<void> {
      while (!signal?.aborted) {
        const result = await runner.runOnce(signal);
        if (result === "aborted") return;
        if (result === "idle" && !signal?.aborted) {
          await deps.sleep(deps.pollIntervalMs);
        }
      }
    },
  };
}
