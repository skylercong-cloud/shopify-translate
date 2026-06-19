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

export type ClaimedJob<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> = Omit<JobRecord, "payload"> & {
  payload: TPayload;
  leaseOwner: string;
  leaseExpiresAt: Date;
};
