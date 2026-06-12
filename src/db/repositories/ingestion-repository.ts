import { and, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { sourcePages } from "@/db/schema";
import type { DiscoveredPage } from "@/modules/ingestion/types";

type Database = NodePgDatabase<typeof schema>;

const INSERT_BATCH_SIZE = 500;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function createIngestionRepository(db: Database) {
  return {
    async upsertDiscoveredPages(input: {
      discoveredAt: Date;
      pages: DiscoveredPage[];
    }): Promise<Array<{ id: string; canonicalUrl: string }>> {
      if (input.pages.length === 0) return [];

      return db.transaction(async (transaction) => {
        const stored: Array<{ id: string; canonicalUrl: string }> = [];
        for (const batch of chunks(input.pages, INSERT_BATCH_SIZE)) {
          const rows = await transaction
            .insert(sourcePages)
            .values(
              batch.map((page) => ({
                canonicalUrl: page.canonicalUrl,
                path: new URL(page.canonicalUrl).pathname,
                lastDiscoveredAt: input.discoveredAt,
              })),
            )
            .onConflictDoUpdate({
              target: sourcePages.canonicalUrl,
              set: {
                path: sql`excluded.path`,
                lastDiscoveredAt: input.discoveredAt,
                missingFromSitemapAt: null,
                updatedAt: input.discoveredAt,
              },
            })
            .returning({
              id: sourcePages.id,
              canonicalUrl: sourcePages.canonicalUrl,
            });
          stored.push(...rows);
        }
        return stored;
      });
    },

    async markMissingFromCompletedDiscovery(input: {
      discoveryStartedAt: Date;
      completedAt: Date;
    }): Promise<number> {
      const missing = await db
        .update(sourcePages)
        .set({
          missingFromSitemapAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(
          and(
            isNull(sourcePages.missingFromSitemapAt),
            or(
              isNull(sourcePages.lastDiscoveredAt),
              lt(sourcePages.lastDiscoveredAt, input.discoveryStartedAt),
            ),
          ),
        )
        .returning({ id: sourcePages.id });

      return missing.length;
    },
  };
}
