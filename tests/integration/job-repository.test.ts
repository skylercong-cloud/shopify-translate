import { randomUUID } from "node:crypto";

import { eq, like } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createJobRepository } from "@/db/repositories/job-repository";
import { jobs } from "@/db/schema";
import { getEnv } from "@/lib/env";

const repository = createJobRepository(db);
let prefix = "";

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

beforeEach(() => {
  prefix = `job-test:${randomUUID()}`;
});

afterEach(async () => {
  await db.delete(jobs).where(like(jobs.dedupeKey, `${prefix}%`));
});

function jobInput(
  suffix: string,
  overrides: Partial<Parameters<typeof repository.enqueue>[0]> = {},
) {
  return {
    queue: "ingestion" as const,
    type: "fetch_page" as const,
    dedupeKey: `${prefix}:${suffix}`,
    payload: { url: `https://shopify.dev/docs/${suffix}` },
    priority: 10,
    runAt: new Date("2026-06-12T01:00:00Z"),
    ...overrides,
  };
}

describe("job repository", () => {
  it("deduplicates and promotes a queued page fetch", async () => {
    const first = await repository.enqueue(jobInput("page"));
    const promoted = await repository.enqueue(
      jobInput("page", {
        priority: 100,
        runAt: new Date("2026-06-12T00:00:00Z"),
      }),
    );
    const deduplicated = await repository.enqueue(
      jobInput("page", {
        priority: 50,
        runAt: new Date("2026-06-12T00:30:00Z"),
      }),
    );

    expect(first.action).toBe("created");
    expect(promoted.action).toBe("promoted");
    expect(promoted.job.id).toBe(first.job.id);
    expect(promoted.job.priority).toBe(100);
    expect(promoted.job.runAt).toEqual(
      new Date("2026-06-12T00:00:00Z"),
    );
    expect(deduplicated.action).toBe("deduplicated");
    expect(deduplicated.job.id).toBe(first.job.id);
  });

  it("does not preempt or promote a running job", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const created = await repository.enqueue(
      jobInput("running", { runAt: now }),
    );
    await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-a",
      now,
      leaseMs: 120_000,
    });

    const result = await repository.enqueue(
      jobInput("running", {
        priority: 100,
        runAt: new Date(now.getTime() - 60_000),
      }),
    );

    expect(result.action).toBe("deduplicated");
    expect(result.job.id).toBe(created.job.id);
    expect(result.job.priority).toBe(10);
    expect(result.job.status).toBe("running");
  });

  it("claims by priority and recovers an expired lease", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    await repository.enqueue(
      jobInput("low", { priority: 10, runAt: now }),
    );
    const high = await repository.enqueue(
      jobInput("high", { priority: 100, runAt: now }),
    );

    const firstClaim = await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-a",
      now,
      leaseMs: 1_000,
    });

    expect(firstClaim).toMatchObject({
      id: high.job.id,
      attempts: 1,
      leaseOwner: "worker-a",
    });

    const recovered = await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-b",
      now: new Date(now.getTime() + 1_001),
      leaseMs: 1_000,
    });

    expect(recovered).toMatchObject({
      id: high.job.id,
      attempts: 2,
      leaseOwner: "worker-b",
    });
  });

  it("renews and completes only the owned lease", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const created = await repository.enqueue(
      jobInput("complete", { runAt: now }),
    );
    await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-a",
      now,
      leaseMs: 1_000,
    });

    await expect(
      repository.renewLease(
        created.job.id,
        "worker-b",
        new Date(now.getTime() + 2_000),
      ),
    ).resolves.toBe(false);
    await expect(
      repository.renewLease(
        created.job.id,
        "worker-a",
        new Date(now.getTime() + 2_000),
      ),
    ).resolves.toBe(true);

    await repository.complete(created.job.id, "worker-a", now);

    const stored = await db.query.jobs.findFirst({
      where: eq(jobs.id, created.job.id),
    });
    expect(stored).toMatchObject({
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: now,
    });
  });

  it("retries with a truncated error and fails at max attempts", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const created = await repository.enqueue(
      jobInput("retry", { runAt: now, maxAttempts: 2 }),
    );
    await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-a",
      now,
      leaseMs: 1_000,
    });

    await expect(
      repository.retryOrFail({
        jobId: created.job.id,
        workerId: "worker-a",
        now,
        runAt: new Date(now.getTime() + 60_000),
        errorCode: "temporary",
        errorMessage: "x".repeat(3_000),
      }),
    ).resolves.toBe("queued");

    let stored = await db.query.jobs.findFirst({
      where: eq(jobs.id, created.job.id),
    });
    expect(stored).toMatchObject({
      status: "queued",
      lastErrorCode: "temporary",
    });
    expect(stored?.lastErrorMessage).toHaveLength(2_000);

    await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-b",
      now: new Date(now.getTime() + 60_000),
      leaseMs: 1_000,
    });
    await expect(
      repository.retryOrFail({
        jobId: created.job.id,
        workerId: "worker-b",
        now: new Date(now.getTime() + 60_000),
        runAt: new Date(now.getTime() + 120_000),
        errorCode: "still_temporary",
        errorMessage: "failed twice",
      }),
    ).resolves.toBe("failed");

    stored = await db.query.jobs.findFirst({
      where: eq(jobs.id, created.job.id),
    });
    expect(stored).toMatchObject({
      status: "failed",
      completedAt: new Date(now.getTime() + 60_000),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });

  it("terminally fails a job while its lease is owned", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const created = await repository.enqueue(
      jobInput("terminal", {
        runAt: now,
        maxAttempts: 3,
      }),
    );
    await repository.claimNext({
      queue: "ingestion",
      workerId: "worker-a",
      now,
      leaseMs: 120_000,
    });

    await repository.fail({
      jobId: created.job.id,
      workerId: "worker-a",
      now,
      errorCode: "worker_job_type_invalid",
      errorMessage: "wrong worker",
    });

    const stored = await db.query.jobs.findFirst({
      where: eq(jobs.id, created.job.id),
    });
    expect(stored).toMatchObject({
      status: "failed",
      attempts: 1,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: "worker_job_type_invalid",
    });
  });

  it("defers an owned translation job without consuming an attempt", async () => {
    const now = new Date("2026-06-12T00:00:00Z");
    const runAt = new Date("2026-06-12T16:00:00Z");
    const created = await repository.enqueue(
      jobInput("deferred", {
        queue: "translation",
        type: "translate_block",
        payload: {
          blockId: randomUUID(),
          contentFingerprint: "fingerprint",
        },
        runAt: now,
        maxAttempts: 1,
      }),
    );
    await repository.claimNext({
      queue: "translation",
      workerId: "translation-worker",
      now,
      leaseMs: 120_000,
    });

    await expect(
      repository.defer({
        jobId: created.job.id,
        workerId: "wrong-worker",
        runAt,
        reasonCode: "budget_exhausted",
        reasonMessage: "Daily translation budget is exhausted",
        now,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.defer({
        jobId: created.job.id,
        workerId: "translation-worker",
        runAt,
        reasonCode: "budget_exhausted",
        reasonMessage: "Daily translation budget is exhausted",
        now,
      }),
    ).resolves.toBe(true);

    const stored = await db.query.jobs.findFirst({
      where: eq(jobs.id, created.job.id),
    });
    expect(stored).toMatchObject({
      status: "queued",
      attempts: 0,
      maxAttempts: 1,
      runAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: null,
      lastErrorCode: "budget_exhausted",
      lastErrorMessage: "Daily translation budget is exhausted",
    });
  });
});
