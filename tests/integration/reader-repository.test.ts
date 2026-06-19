import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createReaderRepository } from "@/db/repositories/reader-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import {
  contentBlocks,
  sourcePages,
  translationCorrections,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
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

const ingestionRepository = createIngestionRepository(db);
const translationRepository = createTranslationRepository(db);
const readerRepository = createReaderRepository(db);
const createdUrls: string[] = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  await db.delete(translationCorrections);
  if (createdUrls.length > 0) {
    await db
      .delete(sourcePages)
      .where(inArray(sourcePages.canonicalUrl, createdUrls.splice(0)));
  }
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

async function publishPage(markdown: string) {
  const slug = `reader-${randomUUID()}`;
  const canonicalUrl = `https://shopify.dev/docs/${slug}`;
  const fetchedAt = new Date("2026-06-16T00:00:00.000Z");
  createdUrls.push(canonicalUrl);

  const [page] = await ingestionRepository.upsertDiscoveredPages({
    discoveredAt: fetchedAt,
    pages: [{ canonicalUrl }],
  });
  const source = fingerprintPageInput(
    parseSourcePage({ body: markdown, sourceFormat: "text" }),
  );
  const published = await ingestionRepository.publishParsedPage({
    pageId: page.id,
    parsedPage: source.parsedPage,
    pageFingerprint: source.pageFingerprint,
    blockFingerprints: source.blockFingerprints,
    diff: diffBlocks([], source.blocks),
    fetchedAt,
  });
  if (published.kind !== "published") {
    throw new Error("Expected source publication");
  }

  return {
    canonicalUrl,
    path: new URL(canonicalUrl).pathname,
    versionId: published.versionId,
    blocks: await db
      .select()
      .from(contentBlocks)
      .where(eq(contentBlocks.pageVersionId, published.versionId))
      .orderBy(contentBlocks.ordinal),
  };
}

describe("reader repository", () => {
  it("loads the current page with source blocks and current translations", async () => {
    const page = await publishPage(
      [
        "# Build apps",
        "",
        "Use Shopify CLI with `shopify app dev`.",
        "",
        "```sh",
        "shopify app dev",
        "```",
      ].join("\n"),
    );
    const paragraph = page.blocks.find(
      (block) => block.type === "paragraph",
    );
    const code = page.blocks.find((block) => block.type === "code");
    if (!paragraph || !code) {
      throw new Error("Expected paragraph and code blocks");
    }

    const published = await translationRepository.publishRevision({
      blockId: paragraph.id,
      expectedSourceFingerprint: paragraph.fingerprint,
      source: "ai",
      translatedText: "Chinese: Use Shopify CLI with shopify app dev.",
      provider: "deepseek",
      modelId: "deepseek-test",
      promptVersionId: null,
      glossaryVersionId: null,
      modelCallId: null,
      now: new Date("2026-06-16T01:00:00.000Z"),
    });
    expect(published.kind).toBe("published");

    await expect(
      readerRepository.loadReaderPageByPath(page.path),
    ).resolves.toEqual({
      id: expect.any(String),
      canonicalUrl: page.canonicalUrl,
      path: page.path,
      title: "Build apps",
      lastSuccessAt: new Date("2026-06-16T00:00:00.000Z"),
      version: expect.objectContaining({
        id: page.versionId,
        versionNumber: 1,
        blockCount: 3,
      }),
      summary: {
        blockCount: 3,
        translatedCount: 1,
        pendingCount: 1,
        reviewRequiredCount: 0,
        failedCount: 0,
        oversizedCount: 0,
      },
      blocks: [
        expect.objectContaining({
          type: "heading",
          ordinal: 0,
          sourceText: "Build apps",
          translatedText: null,
          translationStatus: "pending",
          currentRevisionSource: null,
        }),
        expect.objectContaining({
          id: paragraph.id,
          type: "paragraph",
          ordinal: 1,
          sourceText: "Use Shopify CLI with shopify app dev.",
          translatedText:
            "Chinese: Use Shopify CLI with shopify app dev.",
          translationStatus: "ai_translated",
          currentRevisionSource: "ai",
        }),
        expect.objectContaining({
          id: code.id,
          type: "code",
          ordinal: 2,
          sourceText: "shopify app dev",
          translatedText: null,
          translationStatus: "pending",
          currentRevisionSource: null,
        }),
      ],
    });
  });
});
