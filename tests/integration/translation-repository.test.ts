import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import {
  blockTranslations,
  contentBlocks,
  glossaryVersions,
  jobs,
  modelCalls,
  promptVersions,
  sourcePages,
  translationCorrections,
  translationRevisions,
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
const repository = createTranslationRepository(db);
const createdUrls: string[] = [];
const createdPromptIds: string[] = [];
const createdGlossaryIds: string[] = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  await db.delete(translationCorrections);
  await db.delete(jobs).where(eq(jobs.queue, "translation"));
  if (createdUrls.length > 0) {
    await db
      .delete(sourcePages)
      .where(inArray(sourcePages.canonicalUrl, createdUrls.splice(0)));
  }
  if (createdPromptIds.length > 0) {
    await db
      .delete(promptVersions)
      .where(inArray(promptVersions.id, createdPromptIds.splice(0)));
  }
  if (createdGlossaryIds.length > 0) {
    await db
      .delete(glossaryVersions)
      .where(inArray(glossaryVersions.id, createdGlossaryIds.splice(0)));
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

async function createPage(markdown: string, fetchedAt = new Date()) {
  const canonicalUrl = `https://shopify.dev/docs/translation-${randomUUID()}`;
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
    throw new Error("Expected the first source version to publish");
  }

  return {
    page,
    source,
    versionId: published.versionId,
    blocks: await db
      .select()
      .from(contentBlocks)
      .where(eq(contentBlocks.pageVersionId, published.versionId))
      .orderBy(contentBlocks.ordinal),
  };
}

async function republishPage(input: {
  pageId: string;
  previous: ReturnType<typeof fingerprintPageInput>;
  markdown: string;
  fetchedAt: Date;
}) {
  const source = fingerprintPageInput(
    parseSourcePage({ body: input.markdown, sourceFormat: "text" }),
  );
  const published = await ingestionRepository.publishParsedPage({
    pageId: input.pageId,
    parsedPage: source.parsedPage,
    pageFingerprint: source.pageFingerprint,
    blockFingerprints: source.blockFingerprints,
    diff: diffBlocks(input.previous.blocks, source.blocks),
    fetchedAt: input.fetchedAt,
  });
  if (published.kind !== "published") {
    throw new Error("Expected a new source version to publish");
  }
  return {
    source,
    versionId: published.versionId,
    blocks: await db
      .select()
      .from(contentBlocks)
      .where(eq(contentBlocks.pageVersionId, published.versionId))
      .orderBy(contentBlocks.ordinal),
  };
}

async function createMemoryVersions() {
  const suffix = randomUUID();
  const [prompt] = await db
    .insert(promptVersions)
    .values({
      version: Math.floor(Math.random() * 1_000_000) + 10_000,
      systemPrompt: "Translate.",
      userPromptTemplate: "{{sourceText}}",
      contentFingerprint: `prompt-${suffix}`,
      active: false,
    })
    .returning();
  const [glossary] = await db
    .insert(glossaryVersions)
    .values({
      version: Math.floor(Math.random() * 1_000_000) + 10_000,
      contentFingerprint: `glossary-${suffix}`,
      active: false,
    })
    .returning();
  createdPromptIds.push(prompt.id);
  createdGlossaryIds.push(glossary.id);
  return { prompt, glossary };
}

describe("translation repository", () => {
  it("loads the current block with adjacent source context", async () => {
    const published = await createPage(
      "# Guide\n\nFirst paragraph.\n\nSecond paragraph.",
    );
    const current = published.blocks[1];

    await expect(repository.loadBlockContext(current.id)).resolves.toEqual({
      block: expect.objectContaining({
        id: current.id,
        pageTitle: "Guide",
        sourceText: "First paragraph.",
      }),
      previousText: "Guide",
      nextText: "Second paragraph.",
      translation: expect.objectContaining({
        blockId: current.id,
        status: "pending",
      }),
    });
  });

  it("preserves an unchanged current revision", async () => {
    const fetchedAt = new Date("2026-06-15T01:00:00.000Z");
    const published = await createPage("# Guide\n\nBuild apps.", fetchedAt);
    const block = published.blocks[1];
    const first = await repository.publishRevision({
      blockId: block.id,
      expectedSourceFingerprint: block.fingerprint,
      source: "ai",
      translatedText: "构建应用。",
      provider: "deepseek",
      modelId: "deepseek-chat",
      promptVersionId: null,
      glossaryVersionId: null,
      modelCallId: null,
      now: fetchedAt,
    });
    expect(first.kind).toBe("published");
    if (first.kind !== "published") throw new Error("Expected publication");

    const unchanged = await ingestionRepository.publishParsedPage({
      pageId: published.page.id,
      parsedPage: published.source.parsedPage,
      pageFingerprint: published.source.pageFingerprint,
      blockFingerprints: published.source.blockFingerprints,
      diff: diffBlocks(published.source.blocks, published.source.blocks),
      fetchedAt: new Date("2026-06-15T02:00:00.000Z"),
    });

    expect(unchanged.kind).toBe("unchanged");
    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, block.id),
      }),
    ).resolves.toMatchObject({
      currentRevisionId: first.revision.id,
      status: "ai_translated",
    });
  });

  it("preserves corrected history and flags changed source for review", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const previousBlock = published.blocks[1];
    const corrected = await repository.recordCorrection({
      scope: "block",
      blockId: previousBlock.id,
      sourceFingerprint: previousBlock.fingerprint,
      translatedText: "构建应用程序。",
      now: new Date("2026-06-15T02:00:00.000Z"),
    });
    expect(corrected.kind).toBe("published");
    if (corrected.kind !== "published") {
      throw new Error("Expected correction publication");
    }

    const changed = await republishPage({
      pageId: published.page.id,
      previous: published.source,
      markdown: "# Guide\n\nBuild better apps.",
      fetchedAt: new Date("2026-06-15T03:00:00.000Z"),
    });
    const changedBlock = changed.blocks[1];

    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, changedBlock.id),
      }),
    ).resolves.toMatchObject({
      sourceFingerprint: changedBlock.fingerprint,
      status: "review_required",
      currentRevisionId: corrected.revision.id,
    });
    await expect(
      db.query.translationRevisions.findFirst({
        where: eq(translationRevisions.id, corrected.revision.id),
      }),
    ).resolves.toMatchObject({
      translatedText: "构建应用程序。",
      sourceFingerprint: previousBlock.fingerprint,
    });
  });

  it("finds block and global corrections only for matching fingerprints", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];
    await repository.recordCorrection({
      scope: "global",
      blockId: block.id,
      sourceFingerprint: block.fingerprint,
      translatedText: "全局译文。",
      now: new Date("2026-06-15T01:00:00.000Z"),
    });
    await repository.recordCorrection({
      scope: "block",
      blockId: block.id,
      sourceFingerprint: block.fingerprint,
      translatedText: "当前块译文。",
      now: new Date("2026-06-15T02:00:00.000Z"),
    });

    await expect(
      repository.findBlockCorrection(block.id, block.fingerprint),
    ).resolves.toMatchObject({ translatedText: "当前块译文。" });
    await expect(
      repository.findGlobalCorrection(block.fingerprint),
    ).resolves.toMatchObject({ translatedText: "全局译文。" });
    await expect(
      repository.findBlockCorrection(block.id, "different"),
    ).resolves.toBeNull();
    await expect(
      repository.findGlobalCorrection("different"),
    ).resolves.toBeNull();
  });

  it("keys AI memory by source, prompt, and glossary versions", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];
    const versions = await createMemoryVersions();
    const stored = await repository.publishRevision({
      blockId: block.id,
      expectedSourceFingerprint: block.fingerprint,
      source: "ai",
      translatedText: "构建应用。",
      provider: "deepseek",
      modelId: "deepseek-chat",
      promptVersionId: versions.prompt.id,
      glossaryVersionId: versions.glossary.id,
      modelCallId: null,
      now: new Date("2026-06-15T01:00:00.000Z"),
    });
    expect(stored.kind).toBe("published");

    await expect(
      repository.findAiMemory(
        block.fingerprint,
        versions.prompt.id,
        versions.glossary.id,
      ),
    ).resolves.toMatchObject({ translatedText: "构建应用。" });
    await expect(
      repository.findAiMemory(
        block.fingerprint,
        randomUUID(),
        versions.glossary.id,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.findAiMemory(
        block.fingerprint,
        versions.prompt.id,
        randomUUID(),
      ),
    ).resolves.toBeNull();
  });

  it("publishes revisions atomically and rejects stale source", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];
    const first = await repository.publishRevision({
      blockId: block.id,
      expectedSourceFingerprint: block.fingerprint,
      source: "ai",
      translatedText: "构建应用。",
      provider: "deepseek",
      modelId: "deepseek-chat",
      promptVersionId: null,
      glossaryVersionId: null,
      modelCallId: null,
      now: new Date("2026-06-15T01:00:00.000Z"),
    });
    expect(first.kind).toBe("published");
    if (first.kind !== "published") throw new Error("Expected publication");

    await expect(
      repository.publishRevision({
        blockId: block.id,
        expectedSourceFingerprint: "stale-fingerprint",
        source: "ai",
        translatedText: "陈旧译文。",
        provider: "qwen",
        modelId: "qwen-plus",
        promptVersionId: null,
        glossaryVersionId: null,
        modelCallId: null,
        now: new Date("2026-06-15T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ kind: "stale_source" });

    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, block.id),
      }),
    ).resolves.toMatchObject({
      currentRevisionId: first.revision.id,
      status: "ai_translated",
    });
    await expect(
      db.query.translationRevisions.findMany({
        where: eq(
          translationRevisions.blockTranslationId,
          first.revision.blockTranslationId,
        ),
      }),
    ).resolves.toHaveLength(1);
  });

  it("records failure metadata without deleting a valid revision", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];
    const revision = await repository.publishRevision({
      blockId: block.id,
      expectedSourceFingerprint: block.fingerprint,
      source: "ai",
      translatedText: "构建应用。",
      provider: "deepseek",
      modelId: "deepseek-chat",
      promptVersionId: null,
      glossaryVersionId: null,
      modelCallId: null,
      now: new Date("2026-06-15T01:00:00.000Z"),
    });
    expect(revision.kind).toBe("published");
    if (revision.kind !== "published") throw new Error("Expected publication");

    await expect(
      repository.markFailed(
        block.id,
        block.fingerprint,
        "provider_timeout",
        "Provider request timed out",
        new Date("2026-06-15T02:00:00.000Z"),
      ),
    ).resolves.toEqual({ kind: "updated" });
    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, block.id),
      }),
    ).resolves.toMatchObject({
      status: "ai_translated",
      currentRevisionId: revision.revision.id,
      lastErrorCode: "provider_timeout",
      lastErrorMessage: "Provider request timed out",
    });
  });

  it("marks oversized source without creating a model call", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];

    await expect(
      repository.markOversized(
        block.id,
        block.fingerprint,
        "Request exceeds the configured input limit",
        new Date("2026-06-15T01:00:00.000Z"),
      ),
    ).resolves.toEqual({ kind: "updated" });
    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, block.id),
      }),
    ).resolves.toMatchObject({
      status: "oversized",
      lastErrorCode: "oversized",
      lastErrorMessage: "Request exceeds the configured input limit",
    });
    await expect(
      db.select().from(modelCalls).where(eq(modelCalls.blockId, block.id)),
    ).resolves.toHaveLength(0);
  });

  it("appends immutable revisions for manual corrections", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];
    const global = await repository.recordCorrection({
      scope: "global",
      blockId: block.id,
      sourceFingerprint: block.fingerprint,
      translatedText: "第一版。",
      now: new Date("2026-06-15T01:00:00.000Z"),
    });
    const local = await repository.recordCorrection({
      scope: "block",
      blockId: block.id,
      sourceFingerprint: block.fingerprint,
      translatedText: "第二版。",
      now: new Date("2026-06-15T02:00:00.000Z"),
    });
    expect(global.kind).toBe("published");
    expect(local.kind).toBe("published");
    if (global.kind !== "published" || local.kind !== "published") {
      throw new Error("Expected correction publications");
    }

    const revisions = await db
      .select()
      .from(translationRevisions)
      .where(
        eq(
          translationRevisions.blockTranslationId,
          local.revision.blockTranslationId,
        ),
      )
      .orderBy(translationRevisions.createdAt);
    expect(revisions).toEqual([
      expect.objectContaining({
        id: global.revision.id,
        source: "global_manual",
        translatedText: "第一版。",
      }),
      expect.objectContaining({
        id: local.revision.id,
        source: "block_manual",
        translatedText: "第二版。",
      }),
    ]);
  });
});
