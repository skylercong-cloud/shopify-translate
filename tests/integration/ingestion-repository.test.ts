import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { getEnv } from "@/lib/env";

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

describe("ingestion schema", () => {
  it("creates the source, version, block, policy, attempt, payload, and job tables", async () => {
    const result = await db.execute(sql`
      select tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'source_pages',
          'robots_policies',
          'page_versions',
          'content_blocks',
          'block_changes',
          'fetch_attempts',
          'source_payloads',
          'jobs'
        )
      order by tablename
    `);

    expect(result.rows.map((row) => row.tablename)).toEqual([
      "block_changes",
      "content_blocks",
      "fetch_attempts",
      "jobs",
      "page_versions",
      "robots_policies",
      "source_pages",
      "source_payloads",
    ]);
  });
});
