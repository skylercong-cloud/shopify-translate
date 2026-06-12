import { createHash } from "node:crypto";

import type { IngestionRepository } from "@/db/repositories/ingestion-repository";
import type { createJobRepository } from "@/db/repositories/job-repository";

type JobRepository = ReturnType<typeof createJobRepository>;

const SECONDS_PER_DAY = 24 * 60 * 60;

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ),
  );
}

function refreshRunAt(pageId: string, date: Date): Date {
  const digest = createHash("sha256").update(pageId).digest();
  const offsetSeconds = digest.readUInt32BE(0) % SECONDS_PER_DAY;
  return new Date(utcDayStart(date).getTime() + offsetSeconds * 1_000);
}

export function createIngestionScheduler(deps: {
  ingestionRepository: IngestionRepository;
  jobRepository: JobRepository;
}) {
  return {
    async ensureMaintenanceJobs(now: Date): Promise<void> {
      const dateKey = utcDateKey(now);
      await deps.jobRepository.enqueue({
        queue: "ingestion",
        type: "discover_sitemap",
        dedupeKey: `maintenance:discover:${dateKey}`,
        payload: {},
        priority: 0,
        runAt: now,
      });
      await deps.jobRepository.enqueue({
        queue: "ingestion",
        type: "cleanup_payloads",
        dedupeKey: `maintenance:cleanup:${dateKey}`,
        payload: {},
        priority: -10,
        runAt: now,
      });
    },

    async scheduleDailyPageRefreshes(now: Date): Promise<number> {
      const dateKey = utcDateKey(now);
      const pages =
        await deps.ingestionRepository.listActivePagesForRefresh();
      for (const page of pages) {
        await deps.jobRepository.enqueue({
          queue: "ingestion",
          type: "fetch_page",
          dedupeKey: `refresh:${page.id}:${dateKey}`,
          payload: { url: page.canonicalUrl },
          priority: 0,
          runAt: refreshRunAt(page.id, now),
        });
      }
      return pages.length;
    },
  };
}
