import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { sourcePages } from "@/db/schema";
import type { NavigationEntry } from "@/modules/reader/navigation";

type Database = NodePgDatabase<typeof schema>;

export function createNavigationRepository(db: Database) {
  return {
    async listEntriesBelow(parent: string): Promise<NavigationEntry[]> {
      const prefix = `${parent}/`;
      return db
        .select({ path: sourcePages.path, title: sourcePages.title })
        .from(sourcePages)
        .where(
          and(
            eq(sourcePages.status, "active"),
            sql`starts_with(${sourcePages.path}, ${prefix})`,
          ),
        )
        .orderBy(asc(sourcePages.path));
    },
  };
}

export type NavigationRepository = ReturnType<
  typeof createNavigationRepository
>;
