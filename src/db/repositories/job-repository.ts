import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { jobs } from "@/db/schema";
import type {
  ClaimedJob,
  EnqueueJobInput,
  EnqueueJobResult,
} from "@/modules/jobs/types";

type Database = NodePgDatabase<typeof schema>;

const ACTIVE_DEDUPE_INDEX = "jobs_active_dedupe_idx";
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

type PgError = {
  code?: string;
  constraint?: string;
  cause?: unknown;
};

function isActiveDedupeConflict(error: unknown): boolean {
  let current = error;

  while (current && typeof current === "object") {
    const pgError = current as PgError;
    if (
      pgError.code === "23505" &&
      pgError.constraint === ACTIVE_DEDUPE_INDEX
    ) {
      return true;
    }
    current = pgError.cause;
  }

  return false;
}

function leaseLost(): Error {
  return new Error("Job lease is not owned by this worker");
}

export function createJobRepository(db: Database) {
  async function enqueue(
    input: EnqueueJobInput,
  ): Promise<EnqueueJobResult> {
    for (let conflictAttempt = 0; conflictAttempt < 3; conflictAttempt += 1) {
      try {
        const [job] = await db
          .insert(jobs)
          .values({
            ...input,
            maxAttempts: input.maxAttempts ?? 3,
          })
          .returning();
        return { job, action: "created" };
      } catch (error) {
        if (!isActiveDedupeConflict(error)) {
          throw error;
        }
      }

      const existing = await db.transaction(async (transaction) => {
        const [activeJob] = await transaction
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.dedupeKey, input.dedupeKey),
              inArray(jobs.status, ["queued", "running"]),
            ),
          )
          .limit(1)
          .for("update");

        if (!activeJob) {
          return undefined;
        }

        if (activeJob.status === "running") {
          return {
            job: activeJob,
            action: "deduplicated" as const,
          };
        }

        const nextPriority = Math.max(activeJob.priority, input.priority);
        const nextRunAt =
          activeJob.runAt <= input.runAt ? activeJob.runAt : input.runAt;
        const promoted =
          nextPriority !== activeJob.priority ||
          nextRunAt.getTime() !== activeJob.runAt.getTime();

        if (!promoted) {
          return {
            job: activeJob,
            action: "deduplicated" as const,
          };
        }

        const [job] = await transaction
          .update(jobs)
          .set({
            priority: nextPriority,
            runAt: nextRunAt,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, activeJob.id))
          .returning();

        return { job, action: "promoted" as const };
      });

      if (existing) {
        return existing;
      }
    }

    throw new Error("Unable to enqueue job after concurrent state changes");
  }

  async function claimNext(input: {
    queue: "ingestion" | "translation";
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ClaimedJob | undefined> {
    return db.transaction(async (transaction) => {
      await transaction
        .update(jobs)
        .set({
          status: "failed",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: "lease_exhausted",
          lastErrorMessage: "Job lease expired after the final attempt",
          completedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(jobs.queue, input.queue),
            eq(jobs.status, "running"),
            lte(jobs.leaseExpiresAt, input.now),
            gte(jobs.attempts, jobs.maxAttempts),
          ),
        );

      const [candidate] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.queue, input.queue),
            lt(jobs.attempts, jobs.maxAttempts),
            or(
              and(
                eq(jobs.status, "queued"),
                lte(jobs.runAt, input.now),
              ),
              and(
                eq(jobs.status, "running"),
                lte(jobs.leaseExpiresAt, input.now),
              ),
            ),
          ),
        )
        .orderBy(desc(jobs.priority), asc(jobs.runAt), asc(jobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });

      if (!candidate) {
        return undefined;
      }

      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
      const [claimed] = await transaction
        .update(jobs)
        .set({
          status: "running",
          attempts: sql`${jobs.attempts} + 1`,
          leaseOwner: input.workerId,
          leaseExpiresAt,
          updatedAt: input.now,
        })
        .where(eq(jobs.id, candidate.id))
        .returning();

      return claimed as ClaimedJob;
    });
  }

  async function renewLease(
    jobId: string,
    workerId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const renewed = await db
      .update(jobs)
      .set({
        leaseExpiresAt: expiresAt,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, "running"),
          eq(jobs.leaseOwner, workerId),
        ),
      )
      .returning({ id: jobs.id });

    return renewed.length === 1;
  }

  async function complete(
    jobId: string,
    workerId: string,
    now: Date,
  ): Promise<void> {
    const completed = await db
      .update(jobs)
      .set({
        status: "succeeded",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, "running"),
          eq(jobs.leaseOwner, workerId),
        ),
      )
      .returning({ id: jobs.id });

    if (completed.length !== 1) {
      throw leaseLost();
    }
  }

  async function retryOrFail(input: {
    jobId: string;
    workerId: string;
    now: Date;
    runAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<"queued" | "failed"> {
    return db.transaction(async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1)
        .for("update");

      if (
        !job ||
        job.status !== "running" ||
        job.leaseOwner !== input.workerId
      ) {
        throw leaseLost();
      }

      const failed = job.attempts >= job.maxAttempts;
      const status = failed ? "failed" : "queued";
      await transaction
        .update(jobs)
        .set({
          status,
          runAt: failed ? job.runAt : input.runAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage.slice(
            0,
            MAX_ERROR_MESSAGE_LENGTH,
          ),
          completedAt: failed ? input.now : null,
          updatedAt: input.now,
        })
        .where(eq(jobs.id, input.jobId));

      return status;
    });
  }

  async function fail(input: {
    jobId: string;
    workerId: string;
    now: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const failed = await db
      .update(jobs)
      .set({
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage.slice(
          0,
          MAX_ERROR_MESSAGE_LENGTH,
        ),
        completedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(jobs.id, input.jobId),
          eq(jobs.status, "running"),
          eq(jobs.leaseOwner, input.workerId),
        ),
      )
      .returning({ id: jobs.id });

    if (failed.length !== 1) {
      throw leaseLost();
    }
  }

  async function defer(input: {
    jobId: string;
    workerId: string;
    runAt: Date;
    reasonCode: string;
    reasonMessage: string;
    now: Date;
  }): Promise<boolean> {
    const deferred = await db
      .update(jobs)
      .set({
        status: "queued",
        attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
        runAt: input.runAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: input.reasonCode,
        lastErrorMessage: input.reasonMessage.slice(
          0,
          MAX_ERROR_MESSAGE_LENGTH,
        ),
        completedAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(jobs.id, input.jobId),
          eq(jobs.status, "running"),
          eq(jobs.leaseOwner, input.workerId),
        ),
      )
      .returning({ id: jobs.id });

    return deferred.length === 1;
  }

  return {
    enqueue,
    claimNext,
    renewLease,
    complete,
    retryOrFail,
    fail,
    defer,
  };
}
