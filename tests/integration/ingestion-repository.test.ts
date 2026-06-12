import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { sourcePages } from "@/db/schema";
import { getEnv } from "@/lib/env";

const repository = createIngestionRepository(db);
const createdUrls: string[] = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  if (createdUrls.length === 0) return;
  await db
    .delete(sourcePages)
    .where(inArray(sourcePages.canonicalUrl, createdUrls.splice(0)));
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

  it("upserts pages discovered in a complete Sitemap run", async () => {
    const id = randomUUID();
    const firstUrl = `https://shopify.dev/docs/test-${id}/one`;
    const secondUrl = `https://shopify.dev/docs/test-${id}/two`;
    createdUrls.push(firstUrl, secondUrl);
    const firstDiscovery = new Date("2026-06-12T00:00:00Z");
    const secondDiscovery = new Date("2026-06-13T00:00:00Z");

    const firstResult = await repository.upsertDiscoveredPages({
      discoveredAt: firstDiscovery,
      pages: [
        { canonicalUrl: firstUrl },
        {
          canonicalUrl: secondUrl,
          lastModifiedAt: new Date("2026-06-11T00:00:00Z"),
        },
      ],
    });
    expect(firstResult.map((page) => page.canonicalUrl).sort()).toEqual(
      [firstUrl, secondUrl].sort(),
    );

    await repository.upsertDiscoveredPages({
      discoveredAt: secondDiscovery,
      pages: [{ canonicalUrl: firstUrl }],
    });
    const missing = await repository.markMissingFromCompletedDiscovery({
      discoveryStartedAt: secondDiscovery,
      completedAt: new Date("2026-06-13T00:05:00Z"),
    });

    const stored = await db.query.sourcePages.findMany({
      where: inArray(sourcePages.canonicalUrl, [firstUrl, secondUrl]),
    });
    const first = stored.find((page) => page.canonicalUrl === firstUrl);
    const second = stored.find((page) => page.canonicalUrl === secondUrl);

    expect(missing).toBeGreaterThanOrEqual(1);
    expect(first).toMatchObject({
      path: new URL(firstUrl).pathname,
      lastDiscoveredAt: secondDiscovery,
      missingFromSitemapAt: null,
    });
    expect(second).toMatchObject({
      lastDiscoveredAt: firstDiscovery,
      missingFromSitemapAt: new Date("2026-06-13T00:05:00Z"),
    });
  });

  it("clears a previous missing marker when a page is rediscovered", async () => {
    const canonicalUrl = `https://shopify.dev/docs/test-${randomUUID()}`;
    createdUrls.push(canonicalUrl);
    const discoveredAt = new Date("2026-06-12T00:00:00Z");

    await repository.upsertDiscoveredPages({
      discoveredAt,
      pages: [{ canonicalUrl }],
    });
    await db
      .update(sourcePages)
      .set({ missingFromSitemapAt: new Date("2026-06-13T00:00:00Z") })
      .where(eq(sourcePages.canonicalUrl, canonicalUrl));
    await repository.upsertDiscoveredPages({
      discoveredAt: new Date("2026-06-14T00:00:00Z"),
      pages: [{ canonicalUrl }],
    });

    const stored = await db.query.sourcePages.findFirst({
      where: eq(sourcePages.canonicalUrl, canonicalUrl),
    });
    expect(stored?.missingFromSitemapAt).toBeNull();
  });
});
