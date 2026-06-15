import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createJobRepository } from "@/db/repositories/job-repository";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import {
  blockTranslations,
  contentBlocks,
  glossaryTerms,
  glossaryVersions,
  jobs,
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
import {
  createTranslationAdminService,
  createTranslationAdminStore,
} from "@/modules/translation/translation-admin-service";

const ingestionRepository = createIngestionRepository(db);
const configRepository = createTranslationConfigRepository(db);
const translationRepository = createTranslationRepository(db);
const jobRepository = createJobRepository(db);
const createdUrls: string[] = [];
const createdPromptIds: string[] = [];
const createdGlossaryIds: string[] = [];

const service = createTranslationAdminService({
  store: createTranslationAdminStore(db),
  translationRepository,
  configRepository,
  jobRepository,
  now: () => new Date("2026-06-15T10:00:00.000Z"),
});

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
      .delete(glossaryTerms)
      .where(
        inArray(
          glossaryTerms.glossaryVersionId,
          createdGlossaryIds,
        ),
      );
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

async function createPage(markdown: string) {
  const canonicalUrl = `https://shopify.dev/docs/admin-${randomUUID()}`;
  createdUrls.push(canonicalUrl);
  const fetchedAt = new Date("2026-06-15T09:00:00.000Z");
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
  const blocks = await db
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.pageVersionId, published.versionId))
    .orderBy(contentBlocks.ordinal);
  return { page, blocks };
}

async function activateVersions() {
  const suffix = randomUUID();
  const prompt = await configRepository.createAndActivatePrompt({
    systemPrompt: "Translate.",
    userPromptTemplate: "{{sourceText}}",
    contentFingerprint: `prompt-${suffix}`,
  });
  const glossary = await configRepository.createAndActivateGlossary({
    contentFingerprint: `glossary-${suffix}`,
    terms: [{ sourceTerm: "Shopify CLI", normalizedTerm: "shopify cli" }],
  });
  createdPromptIds.push(prompt.id);
  createdGlossaryIds.push(glossary.id);
  return { prompt, glossary };
}

describe("translation admin service", () => {
  it("appends immutable correction and revision history", async () => {
    const published = await createPage("# Guide\n\nBuild apps.");
    const block = published.blocks[1];

    const first = await service.recordManualCorrection({
      blockId: block.id,
      translatedText: "构建应用。",
      scope: "global",
    });
    const second = await service.recordManualCorrection({
      blockId: block.id,
      translatedText: "构建应用程序。",
      scope: "block",
    });

    const corrections = await db
      .select()
      .from(translationCorrections)
      .orderBy(translationCorrections.createdAt);
    const state = await db.query.blockTranslations.findFirst({
      where: eq(blockTranslations.blockId, block.id),
    });
    const revisions = state
      ? await db
          .select()
          .from(translationRevisions)
          .where(
            eq(
              translationRevisions.blockTranslationId,
              state.id,
            ),
          )
          .orderBy(translationRevisions.createdAt)
      : [];

    expect(corrections).toEqual([
      expect.objectContaining({
        id: first.correction.id,
        scope: "global",
        translatedText: "构建应用。",
      }),
      expect.objectContaining({
        id: second.correction.id,
        scope: "block",
        translatedText: "构建应用程序。",
      }),
    ]);
    expect(revisions).toEqual([
      expect.objectContaining({
        id: first.revision.id,
        source: "global_manual",
      }),
      expect.objectContaining({
        id: second.revision.id,
        source: "block_manual",
      }),
    ]);
    expect(state).toMatchObject({
      status: "manually_corrected",
      currentRevisionId: second.revision.id,
    });
  });

  it("deduplicates page retranslation for active prompt and glossary versions", async () => {
    const published = await createPage(
      "# Guide\n\nUse Shopify CLI.\n\nBuild apps.",
    );
    const versions = await activateVersions();
    await db.delete(jobs).where(eq(jobs.queue, "translation"));

    await expect(
      service.enqueueRetranslation({
        pagePath: new URL(published.page.canonicalUrl).pathname,
      }),
    ).resolves.toEqual({
      targeted: 3,
      created: 3,
      deduplicated: 0,
      promoted: 0,
    });
    await expect(
      service.enqueueRetranslation({
        pagePath: new URL(published.page.canonicalUrl).pathname,
      }),
    ).resolves.toEqual({
      targeted: 3,
      created: 0,
      deduplicated: 3,
      promoted: 0,
    });

    const queued = await db.query.jobs.findMany({
      where: eq(jobs.queue, "translation"),
    });
    expect(queued).toHaveLength(3);
    for (const job of queued) {
      expect(job.dedupeKey).toContain(`:${versions.prompt.id}:`);
      expect(job.dedupeKey).toContain(`:${versions.glossary.id}`);
      expect(job.status).toBe("queued");
    }
  });
});
