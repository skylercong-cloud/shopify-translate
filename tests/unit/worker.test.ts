import { describe, expect, it, vi } from "vitest";

import { IngestionError } from "@/modules/ingestion/errors";
import { createIngestionWorker } from "@/modules/jobs/worker";
import type { ClaimedJob } from "@/modules/jobs/types";

function claimedJob(
  type: ClaimedJob["type"],
  payload: Record<string, unknown> = {},
): ClaimedJob {
  const now = new Date("2026-06-12T00:00:00Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    queue: "ingestion",
    type,
    dedupeKey: `test:${type}`,
    payload,
    priority: 0,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    runAt: now,
    leaseOwner: "worker-test",
    leaseExpiresAt: new Date(now.getTime() + 120_000),
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function createDependencies(job: ClaimedJob) {
  const jobRepository = {
    claimNext: vi.fn(async () => job),
    renewLease: vi.fn(async () => true),
    complete: vi.fn(async () => undefined),
    retryOrFail: vi.fn(async () => "queued" as const),
    fail: vi.fn(async () => undefined),
  };
  const ingestionService = {
    refreshRobotsPolicy: vi.fn(async () => "fresh" as const),
    discoverPages: vi.fn(async () => ({ discovered: 0, queued: 0 })),
    ingestPage: vi.fn(async () => ({ kind: "not_modified" as const })),
    cleanupExpiredPayloads: vi.fn(async () => 0),
  };
  const scheduler = {
    ensureMaintenanceJobs: vi.fn(async () => undefined),
    scheduleDailyPageRefreshes: vi.fn(async () => 0),
  };
  return { jobRepository, ingestionService, scheduler };
}

describe("ingestion worker", () => {
  it("passes an on-demand fetch priority into page ingestion", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const job = claimedJob("fetch_page", {
      url: "https://shopify.dev/docs/api/admin-graphql",
    });
    job.priority = 100;
    const deps = createDependencies(job);
    const worker = createIngestionWorker({
      ...deps,
      workerId: "worker-test",
      leaseMs: 120_000,
      pollIntervalMs: 1_000,
      now: () => now,
      sleep: async () => undefined,
      jitter: () => 0,
    });

    await expect(worker.runOnce()).resolves.toBe("worked");
    expect(deps.ingestionService.ingestPage).toHaveBeenCalledWith(
      "https://shopify.dev/docs/api/admin-graphql",
      job.id,
      100,
    );
  });

  it("dispatches discovery and completes the owned job", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const deps = createDependencies(claimedJob("discover_sitemap"));
    const worker = createIngestionWorker({
      ...deps,
      workerId: "worker-test",
      leaseMs: 120_000,
      pollIntervalMs: 1_000,
      now: () => now,
      sleep: async () => undefined,
      jitter: () => 0,
    });

    await expect(worker.runOnce()).resolves.toBe("worked");
    expect(deps.ingestionService.refreshRobotsPolicy).toHaveBeenCalledOnce();
    expect(deps.ingestionService.discoverPages).toHaveBeenCalledOnce();
    expect(deps.scheduler.scheduleDailyPageRefreshes).not.toHaveBeenCalled();
    expect(deps.scheduler.ensureMaintenanceJobs).toHaveBeenCalledWith(
      new Date("2026-06-13T00:00:00Z"),
    );
    expect(deps.jobRepository.complete).toHaveBeenCalledWith(
      expect.any(String),
      "worker-test",
      now,
    );
  });

  it("renews the lease while a fetch remains active", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const deps = createDependencies(
      claimedJob("fetch_page", {
        url: "https://shopify.dev/docs/apps",
      }),
    );
    let finishFetch!: () => void;
    deps.ingestionService.ingestPage.mockImplementation(
      () => new Promise((resolve) => {
        finishFetch = () => resolve({ kind: "not_modified" });
      }),
    );
    let renewalCallback: (() => void | Promise<void>) | undefined;
    const clearIntervalImpl = vi.fn();
    const worker = createIngestionWorker({
      ...deps,
      workerId: "worker-test",
      leaseMs: 120_000,
      pollIntervalMs: 1_000,
      now: () => now,
      sleep: async () => undefined,
      jitter: () => 0,
      setIntervalImpl(callback) {
        renewalCallback = callback;
        return 1;
      },
      clearIntervalImpl,
    });

    const running = worker.runOnce();
    await vi.waitFor(() =>
      expect(deps.ingestionService.ingestPage).toHaveBeenCalledOnce(),
    );
    await renewalCallback!();
    expect(deps.jobRepository.renewLease).toHaveBeenCalledWith(
      expect.any(String),
      "worker-test",
      new Date("2026-06-12T00:02:00Z"),
    );
    finishFetch();
    await running;
    expect(clearIntervalImpl).toHaveBeenCalledOnce();
  });

  it("leaves the job for lease recovery when renewal fails", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const deps = createDependencies(
      claimedJob("fetch_page", {
        url: "https://shopify.dev/docs/apps",
      }),
    );
    deps.jobRepository.renewLease.mockRejectedValue(
      new Error("database unavailable"),
    );
    let finishFetch!: () => void;
    deps.ingestionService.ingestPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishFetch = () => resolve({ kind: "not_modified" });
        }),
    );
    let renewalCallback: (() => void | Promise<void>) | undefined;
    const worker = createIngestionWorker({
      ...deps,
      workerId: "worker-test",
      leaseMs: 120_000,
      pollIntervalMs: 1_000,
      now: () => now,
      sleep: async () => undefined,
      jitter: () => 0,
      setIntervalImpl(callback) {
        renewalCallback = callback;
        return 1;
      },
      clearIntervalImpl: () => undefined,
    });

    const running = worker.runOnce();
    await vi.waitFor(() =>
      expect(deps.ingestionService.ingestPage).toHaveBeenCalledOnce(),
    );
    await expect(renewalCallback!()).resolves.toBeUndefined();
    finishFetch();
    await expect(running).resolves.toBe("lease_lost");
    expect(deps.jobRepository.complete).not.toHaveBeenCalled();
    expect(deps.jobRepository.retryOrFail).not.toHaveBeenCalled();
    expect(deps.jobRepository.fail).not.toHaveBeenCalled();
  });

  it("requeues retryable failures with the first backoff", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const deps = createDependencies(
      claimedJob("fetch_page", {
        url: "https://shopify.dev/docs/apps",
      }),
    );
    deps.ingestionService.ingestPage.mockRejectedValue(
      new IngestionError("source_timeout", "timed out", true),
    );
    const worker = createIngestionWorker({
      ...deps,
      workerId: "worker-test",
      leaseMs: 120_000,
      pollIntervalMs: 1_000,
      now: () => now,
      sleep: async () => undefined,
      jitter: () => 0,
    });

    await expect(worker.runOnce()).resolves.toBe("worked");
    expect(deps.jobRepository.retryOrFail).toHaveBeenCalledWith({
      jobId: expect.any(String),
      workerId: "worker-test",
      now,
      runAt: new Date("2026-06-12T00:01:00Z"),
      errorCode: "source_timeout",
      errorMessage: "timed out",
    });
  });

  it("terminally fails a translation job on the ingestion queue", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const deps = createDependencies(claimedJob("translate_block"));
    const worker = createIngestionWorker({
      ...deps,
      workerId: "worker-test",
      leaseMs: 120_000,
      pollIntervalMs: 1_000,
      now: () => now,
      sleep: async () => undefined,
      jitter: () => 0,
    });

    await expect(worker.runOnce()).resolves.toBe("worked");
    expect(deps.jobRepository.fail).toHaveBeenCalledWith({
      jobId: expect.any(String),
      workerId: "worker-test",
      now,
      errorCode: "worker_job_type_invalid",
      errorMessage: "Translation jobs cannot run on the ingestion worker",
    });
    expect(deps.jobRepository.retryOrFail).not.toHaveBeenCalled();
  });
});
