import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createSearchRepository } from "@/db/repositories/search-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import { contentBlocks, sourcePages } from "@/db/schema";
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
const searchRepository = createSearchRepository(db);
const translationRepository = createTranslationRepository(db);
const createdUrls: string[] = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
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

async function publishPage(input: {
  slug: string;
  markdown: string;
  translatedParagraph?: string;
}) {
  const canonicalUrl = `https://shopify.dev/docs/${input.slug}`;
  const fetchedAt = new Date("2026-06-18T00:00:00.000Z");
  createdUrls.push(canonicalUrl);

  const [page] = await ingestionRepository.upsertDiscoveredPages({
    discoveredAt: fetchedAt,
    pages: [{ canonicalUrl }],
  });
  const source = fingerprintPageInput(
    parseSourcePage({ body: input.markdown, sourceFormat: "text" }),
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
    throw new Error("Expected page to publish");
  }

  const blocks = await db
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.pageVersionId, published.versionId))
    .orderBy(contentBlocks.ordinal);
  const paragraph = blocks.find((block) => block.type === "paragraph");

  if (paragraph && input.translatedParagraph) {
    await translationRepository.publishRevision({
      blockId: paragraph.id,
      expectedSourceFingerprint: paragraph.fingerprint,
      source: "ai",
      translatedText: input.translatedParagraph,
      provider: "deepseek",
      modelId: "deepseek-search-test",
      promptVersionId: null,
      glossaryVersionId: null,
      modelCallId: null,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });
  }

  return {
    canonicalUrl,
    path: new URL(canonicalUrl).pathname,
    pageId: page.id,
  };
}

describe("search repository", () => {
  it("searches Chinese translations, English source, and exact identifiers", async () => {
    const id = randomUUID();
    const orderPage = await publishPage({
      slug: `search-order-${id}`,
      markdown: "# Order webhooks\n\nConfigure order notifications.",
      translatedParagraph: "配置订单 webhook 通知。",
    });
    const adminPage = await publishPage({
      slug: `search-admin-${id}`,
      markdown:
        "# Admin GraphQL\n\nUse the Admin GraphQL API to manage products.",
    });
    const productPage = await publishPage({
      slug: `search-product-${id}`,
      markdown: [
        "# Products",
        "",
        "Create products with mutations.",
        "",
        "```graphql",
        "mutation { productCreate(input: {}) { product { id } } }",
        "```",
      ].join("\n"),
    });

    await expect(
      searchRepository.searchReaderPages({ query: "订单 webhook" }),
    ).resolves.toEqual([
      expect.objectContaining({
        path: orderPage.path,
        matchKind: "translation",
        snippet: "配置订单 webhook 通知。",
      }),
    ]);

    await expect(
      searchRepository.searchReaderPages({ query: "Admin GraphQL" }),
    ).resolves.toEqual([
      expect.objectContaining({
        path: adminPage.path,
        matchKind: "title",
      }),
    ]);

    await expect(
      searchRepository.searchReaderPages({ query: "productCreate" }),
    ).resolves.toEqual([
      expect.objectContaining({
        path: productPage.path,
        matchKind: "identifier",
        snippet: "mutation { productCreate(input: {}) { product { id } } }",
      }),
    ]);
  });

  it("does not return stale content from a previous page version", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/search-stale-${id}`;
    const fetchedAt = new Date("2026-06-18T02:00:00.000Z");
    createdUrls.push(canonicalUrl);

    const [page] = await ingestionRepository.upsertDiscoveredPages({
      discoveredAt: fetchedAt,
      pages: [{ canonicalUrl }],
    });
    const first = fingerprintPageInput(
      parseSourcePage({
        body: "# Stale guide\n\nThis paragraph contains obsoleteNeedle.",
        sourceFormat: "text",
      }),
    );
    const firstPublished = await ingestionRepository.publishParsedPage({
      pageId: page.id,
      parsedPage: first.parsedPage,
      pageFingerprint: first.pageFingerprint,
      blockFingerprints: first.blockFingerprints,
      diff: diffBlocks([], first.blocks),
      fetchedAt,
    });
    if (firstPublished.kind !== "published") {
      throw new Error("Expected first version");
    }

    const second = fingerprintPageInput(
      parseSourcePage({
        body: "# Stale guide\n\nThis paragraph replaced the old wording.",
        sourceFormat: "text",
      }),
    );
    const secondPublished = await ingestionRepository.publishParsedPage({
      pageId: page.id,
      parsedPage: second.parsedPage,
      pageFingerprint: second.pageFingerprint,
      blockFingerprints: second.blockFingerprints,
      diff: diffBlocks(first.blocks, second.blocks),
      fetchedAt: new Date("2026-06-18T03:00:00.000Z"),
    });
    if (secondPublished.kind !== "published") {
      throw new Error("Expected second version");
    }

    await expect(
      searchRepository.searchReaderPages({ query: "obsoleteNeedle" }),
    ).resolves.toEqual([]);
  });
});
