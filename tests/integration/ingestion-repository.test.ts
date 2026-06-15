import { randomUUID } from "node:crypto";

import { count, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import {
  blockChanges,
  blockTranslations,
  contentBlocks,
  jobs,
  pageVersions,
  sourcePages,
} from "@/db/schema";
import { diffBlocks } from "@/modules/ingestion/diff";
import {
  fingerprintBlock,
  fingerprintPage,
} from "@/modules/ingestion/fingerprint";
import { parseSourcePage } from "@/modules/ingestion/parser";
import type {
  FingerprintedBlock,
  ParsedPage,
} from "@/modules/ingestion/types";
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
  await db.delete(jobs).where(eq(jobs.queue, "translation"));
  if (createdUrls.length === 0) return;
  await db
    .delete(sourcePages)
    .where(inArray(sourcePages.canonicalUrl, createdUrls.splice(0)));
});

function fingerprintPageInput(parsedPage: ParsedPage) {
  const blocks: FingerprintedBlock[] = parsedPage.blocks.map((block) => ({
    ...block,
    contentFingerprint: fingerprintBlock(block),
  }));
  return {
    parsedPage,
    blocks,
    blockFingerprints: blocks.map((block) => block.contentFingerprint),
    pageFingerprint: fingerprintPage(blocks),
  };
}

async function createPage(markdown: string) {
  const canonicalUrl = `https://shopify.dev/docs/test-${randomUUID()}`;
  createdUrls.push(canonicalUrl);
  const [page] = await repository.upsertDiscoveredPages({
    discoveredAt: new Date("2026-06-12T00:00:00Z"),
    pages: [{ canonicalUrl }],
  });
  return {
    page,
    source: fingerprintPageInput(
      parseSourcePage({ body: markdown, sourceFormat: "text" }),
    ),
  };
}

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

  it("publishes a first version and skips an identical second fetch", async () => {
    const { page, source } = await createPage("# Guide\n\nBuild apps.");
    const fetchedAt = new Date("2026-06-12T01:00:00Z");
    const input = {
      pageId: page.id,
      parsedPage: source.parsedPage,
      pageFingerprint: source.pageFingerprint,
      blockFingerprints: source.blockFingerprints,
      diff: diffBlocks([], source.blocks),
      fetchedAt,
      etag: '"one"',
      lastModified: "Fri, 12 Jun 2026 00:00:00 GMT",
    };

    await expect(repository.publishParsedPage(input)).resolves.toMatchObject({
      kind: "published",
      versionNumber: 1,
    });
    await expect(
      repository.publishParsedPage({
        ...input,
        fetchedAt: new Date("2026-06-12T02:00:00Z"),
      }),
    ).resolves.toMatchObject({ kind: "unchanged" });

    const [versionCount] = await db
      .select({ value: count() })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, page.id));
    const storedBlocks = await db.query.contentBlocks.findMany({
      where: inArray(
        contentBlocks.pageVersionId,
        db
          .select({ id: pageVersions.id })
          .from(pageVersions)
          .where(eq(pageVersions.pageId, page.id)),
      ),
    });
    const translationJobs = await db.query.jobs.findMany({
      where: eq(jobs.queue, "translation"),
    });
    const translationStates =
      await db.query.blockTranslations.findMany({
        where: inArray(
          blockTranslations.blockId,
          storedBlocks.map((block) => block.id),
        ),
      });
    const storedPage = await db.query.sourcePages.findFirst({
      where: eq(sourcePages.id, page.id),
    });

    expect(versionCount.value).toBe(1);
    expect(storedBlocks).toHaveLength(2);
    expect(translationJobs).toHaveLength(2);
    expect(translationStates).toHaveLength(2);
    expect(
      translationStates.every((state) => state.status === "pending"),
    ).toBe(true);
    expect(storedPage).toMatchObject({
      currentVersionId: expect.any(String),
      title: "Guide",
      etag: '"one"',
      lastCheckedAt: new Date("2026-06-12T02:00:00Z"),
    });
  });

  it("publishes only changed translatable blocks and records moves and deletions", async () => {
    const { page, source: first } = await createPage(
      "# Guide\n\nFirst paragraph.\n\nSecond paragraph.",
    );
    const firstPublished = await repository.publishParsedPage({
      pageId: page.id,
      parsedPage: first.parsedPage,
      pageFingerprint: first.pageFingerprint,
      blockFingerprints: first.blockFingerprints,
      diff: diffBlocks([], first.blocks),
      fetchedAt: new Date("2026-06-12T01:00:00Z"),
    });
    expect(firstPublished.kind).toBe("published");
    await db.delete(jobs).where(eq(jobs.queue, "translation"));

    const changed = fingerprintPageInput(
      parseSourcePage({
        sourceFormat: "text",
        body: "# Guide\n\nSecond paragraph.\n\nFirst paragraph changed.",
      }),
    );
    const result = await repository.publishParsedPage({
      pageId: page.id,
      parsedPage: changed.parsedPage,
      pageFingerprint: changed.pageFingerprint,
      blockFingerprints: changed.blockFingerprints,
      diff: diffBlocks(first.blocks, changed.blocks),
      fetchedAt: new Date("2026-06-12T02:00:00Z"),
    });

    expect(result).toMatchObject({ kind: "published", versionNumber: 2 });
    const changes = await db.query.blockChanges.findMany({
      where: eq(blockChanges.pageVersionId, result.versionId),
    });
    const translationJobs = await db.query.jobs.findMany({
      where: eq(jobs.queue, "translation"),
    });

    expect(changes.map((change) => change.kind).sort()).toEqual([
      "modified",
      "moved",
    ]);
    expect(translationJobs).toHaveLength(1);

    await db.delete(jobs).where(eq(jobs.queue, "translation"));
    const deleted = fingerprintPageInput(
      parseSourcePage({
        sourceFormat: "text",
        body: "# Guide\n\nSecond paragraph.",
      }),
    );
    const deletedResult = await repository.publishParsedPage({
      pageId: page.id,
      parsedPage: deleted.parsedPage,
      pageFingerprint: deleted.pageFingerprint,
      blockFingerprints: deleted.blockFingerprints,
      diff: diffBlocks(changed.blocks, deleted.blocks),
      fetchedAt: new Date("2026-06-12T03:00:00Z"),
    });
    const deletedChanges = await db.query.blockChanges.findMany({
      where: eq(blockChanges.pageVersionId, deletedResult.versionId),
    });

    expect(deletedChanges).toEqual([
      expect.objectContaining({
        kind: "deleted",
        previousBlockId: expect.any(String),
        currentBlockId: null,
      }),
    ]);
    await expect(
      db.query.jobs.findMany({ where: eq(jobs.queue, "translation") }),
    ).resolves.toHaveLength(0);
  });

  it("rolls back a failed publication without changing the current pointer", async () => {
    const { page, source } = await createPage("# Guide\n\nBuild apps.");
    const failingRepository = createIngestionRepository(db, {
      afterVersionInserted: async () => {
        throw new Error("forced publication failure");
      },
    });

    await expect(
      failingRepository.publishParsedPage({
        pageId: page.id,
        parsedPage: source.parsedPage,
        pageFingerprint: source.pageFingerprint,
        blockFingerprints: source.blockFingerprints,
        diff: diffBlocks([], source.blocks),
        fetchedAt: new Date("2026-06-12T01:00:00Z"),
      }),
    ).rejects.toThrow("forced publication failure");

    const storedPage = await db.query.sourcePages.findFirst({
      where: eq(sourcePages.id, page.id),
    });
    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, page.id),
    });
    expect(storedPage?.currentVersionId).toBeNull();
    expect(versions).toHaveLength(0);
  });

  it("restores an existing historical version when source content reverts", async () => {
    const { page, source: first } = await createPage(
      "# Guide\n\nFirst content.",
    );
    const firstResult = await repository.publishParsedPage({
      pageId: page.id,
      parsedPage: first.parsedPage,
      pageFingerprint: first.pageFingerprint,
      blockFingerprints: first.blockFingerprints,
      diff: diffBlocks([], first.blocks),
      fetchedAt: new Date("2026-06-12T01:00:00Z"),
    });
    const second = fingerprintPageInput(
      parseSourcePage({
        sourceFormat: "text",
        body: "# Guide\n\nSecond content.",
      }),
    );
    await repository.publishParsedPage({
      pageId: page.id,
      parsedPage: second.parsedPage,
      pageFingerprint: second.pageFingerprint,
      blockFingerprints: second.blockFingerprints,
      diff: diffBlocks(first.blocks, second.blocks),
      fetchedAt: new Date("2026-06-12T02:00:00Z"),
    });

    await expect(
      repository.publishParsedPage({
        pageId: page.id,
        parsedPage: first.parsedPage,
        pageFingerprint: first.pageFingerprint,
        blockFingerprints: first.blockFingerprints,
        diff: diffBlocks(second.blocks, first.blocks),
        fetchedAt: new Date("2026-06-12T03:00:00Z"),
      }),
    ).resolves.toMatchObject({
      kind: "restored",
      versionId: firstResult.versionId,
      versionNumber: 1,
    });

    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, page.id),
    });
    const storedPage = await db.query.sourcePages.findFirst({
      where: eq(sourcePages.id, page.id),
    });
    expect(versions).toHaveLength(2);
    expect(storedPage?.currentVersionId).toBe(firstResult.versionId);
  });

  it("serializes concurrent identical publications into one version", async () => {
    const { page, source } = await createPage("# Guide\n\nBuild apps.");
    const input = {
      pageId: page.id,
      parsedPage: source.parsedPage,
      pageFingerprint: source.pageFingerprint,
      blockFingerprints: source.blockFingerprints,
      diff: diffBlocks([], source.blocks),
      fetchedAt: new Date("2026-06-12T01:00:00Z"),
    };

    const results = await Promise.all([
      repository.publishParsedPage(input),
      repository.publishParsedPage(input),
    ]);
    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, page.id),
    });

    expect(results.map((result) => result.kind).sort()).toEqual([
      "published",
      "unchanged",
    ]);
    expect(versions).toHaveLength(1);
  });
});
