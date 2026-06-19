import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const jobQueues = ["ingestion", "translation"] as const;
export const jobTypes = [
  "discover_sitemap",
  "fetch_page",
  "translate_block",
  "cleanup_payloads",
] as const;
export const jobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export const jobQueueEnum = pgEnum("job_queue", jobQueues);
export const jobTypeEnum = pgEnum("job_type", jobTypes);
export const jobStatusEnum = pgEnum("job_status", jobStatuses);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: jobQueueEnum("queue").notNull(),
    type: jobTypeEnum("type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    priority: integer("priority").notNull().default(0),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("jobs_active_dedupe_idx")
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("jobs_claim_idx").on(
      table.queue,
      table.status,
      table.runAt,
      table.priority,
    ),
    index("jobs_lease_expires_at_idx").on(table.leaseExpiresAt),
  ],
);
