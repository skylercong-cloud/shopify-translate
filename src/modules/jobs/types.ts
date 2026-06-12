import type { jobs } from "@/db/schema";

export type JobRecord = typeof jobs.$inferSelect;

export type EnqueueJobInput = {
  queue: "ingestion" | "translation";
  type:
    | "discover_sitemap"
    | "fetch_page"
    | "translate_block"
    | "cleanup_payloads";
  dedupeKey: string;
  payload: Record<string, unknown>;
  priority: number;
  runAt: Date;
  maxAttempts?: number;
};

export type EnqueueJobResult = {
  job: JobRecord;
  action: "created" | "deduplicated" | "promoted";
};

export type ClaimedJob = JobRecord & {
  leaseOwner: string;
  leaseExpiresAt: Date;
};
