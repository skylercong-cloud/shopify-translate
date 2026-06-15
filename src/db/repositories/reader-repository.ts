import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  blockTranslations,
  contentBlocks,
  pageVersions,
  sourcePages,
  translationRevisions,
} from "@/db/schema";
import type {
  ReaderBlock,
  ReaderPage,
  ReaderTranslationStatus,
  ReaderTranslationSummary,
} from "@/modules/reader/types";

type Database = NodePgDatabase<typeof schema>;

function fallbackStatus(
  translatable: boolean,
  status: ReaderTranslationStatus | null,
): ReaderTranslationStatus {
  if (!translatable) return "pending";
  return status ?? "pending";
}

function summarize(blocks: ReaderBlock[]): ReaderTranslationSummary {
  const translatable = blocks.filter((block) => block.translatable);

  return {
    blockCount: blocks.length,
    translatedCount: translatable.filter(
      (block) =>
        block.translationStatus === "ai_translated" ||
        block.translationStatus === "manually_corrected",
    ).length,
    pendingCount: translatable.filter(
      (block) => block.translationStatus === "pending",
    ).length,
    reviewRequiredCount: translatable.filter(
      (block) => block.translationStatus === "review_required",
    ).length,
    failedCount: translatable.filter(
      (block) => block.translationStatus === "failed",
    ).length,
    oversizedCount: translatable.filter(
      (block) => block.translationStatus === "oversized",
    ).length,
  };
}

export function createReaderRepository(db: Database) {
  return {
    async loadReaderPageByPath(path: string): Promise<ReaderPage | null> {
      const [page] = await db
        .select({
          id: sourcePages.id,
          canonicalUrl: sourcePages.canonicalUrl,
          path: sourcePages.path,
          title: sourcePages.title,
          lastSuccessAt: sourcePages.lastSuccessAt,
          versionId: pageVersions.id,
          versionNumber: pageVersions.versionNumber,
          blockCount: pageVersions.blockCount,
          fetchedAt: pageVersions.fetchedAt,
          publishedAt: pageVersions.publishedAt,
        })
        .from(sourcePages)
        .innerJoin(
          pageVersions,
          eq(pageVersions.id, sourcePages.currentVersionId),
        )
        .where(
          and(eq(sourcePages.path, path), eq(sourcePages.status, "active")),
        )
        .limit(1);
      if (!page) return null;

      const rows = await db
        .select({
          id: contentBlocks.id,
          ordinal: contentBlocks.ordinal,
          type: contentBlocks.type,
          headingPath: contentBlocks.headingPath,
          sourceText: contentBlocks.sourceText,
          payload: contentBlocks.payload,
          translatable: contentBlocks.translatable,
          fingerprint: contentBlocks.fingerprint,
          translationStatus: blockTranslations.status,
          translatedText: translationRevisions.translatedText,
          currentRevisionSource: translationRevisions.source,
        })
        .from(contentBlocks)
        .leftJoin(
          blockTranslations,
          eq(blockTranslations.blockId, contentBlocks.id),
        )
        .leftJoin(
          translationRevisions,
          eq(translationRevisions.id, blockTranslations.currentRevisionId),
        )
        .where(eq(contentBlocks.pageVersionId, page.versionId))
        .orderBy(asc(contentBlocks.ordinal));

      const blocks: ReaderBlock[] = rows.map((row) => ({
        id: row.id,
        ordinal: row.ordinal,
        type: row.type,
        headingPath: row.headingPath,
        sourceText: row.sourceText,
        payload: row.payload,
        translatable: row.translatable,
        fingerprint: row.fingerprint,
        translationStatus: fallbackStatus(
          row.translatable,
          row.translationStatus,
        ),
        translatedText: row.translatedText ?? null,
        currentRevisionSource: row.currentRevisionSource ?? null,
      }));

      return {
        id: page.id,
        canonicalUrl: page.canonicalUrl,
        path: page.path,
        title: page.title,
        lastSuccessAt: page.lastSuccessAt,
        version: {
          id: page.versionId,
          versionNumber: page.versionNumber,
          blockCount: page.blockCount,
          fetchedAt: page.fetchedAt,
          publishedAt: page.publishedAt,
        },
        summary: summarize(blocks),
        blocks,
      };
    },
  };
}

export type ReaderRepository = ReturnType<typeof createReaderRepository>;
