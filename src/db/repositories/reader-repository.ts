import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
  ReaderRevisionHistoryItem,
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
          blockTranslationId: blockTranslations.id,
          translationStatus: blockTranslations.status,
          currentRevisionId: blockTranslations.currentRevisionId,
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

      const translationIds = rows
        .map((row) => row.blockTranslationId)
        .filter((id): id is string => id !== null);
      const currentRevisionIds = new Map<string, string | null>();
      for (const row of rows) {
        if (row.blockTranslationId) {
          currentRevisionIds.set(
            row.blockTranslationId,
            row.currentRevisionId,
          );
        }
      }
      const revisionRows =
        translationIds.length === 0
          ? []
          : await db
              .select({
                id: translationRevisions.id,
                blockTranslationId:
                  translationRevisions.blockTranslationId,
                source: translationRevisions.source,
                translatedText: translationRevisions.translatedText,
                sourceFingerprint:
                  translationRevisions.sourceFingerprint,
                provider: translationRevisions.provider,
                modelId: translationRevisions.modelId,
                promptVersionId: translationRevisions.promptVersionId,
                glossaryVersionId: translationRevisions.glossaryVersionId,
                modelCallId: translationRevisions.modelCallId,
                createdAt: translationRevisions.createdAt,
              })
              .from(translationRevisions)
              .where(
                inArray(
                  translationRevisions.blockTranslationId,
                  translationIds,
                ),
              )
              .orderBy(
                desc(translationRevisions.createdAt),
                desc(translationRevisions.id),
              );
      const revisionHistory = new Map<
        string,
        ReaderRevisionHistoryItem[]
      >();

      for (const revision of revisionRows) {
        const currentRevisionId = currentRevisionIds.get(
          revision.blockTranslationId,
        );
        const history = revisionHistory.get(revision.blockTranslationId) ?? [];

        history.push({
          id: revision.id,
          source: revision.source,
          translatedText: revision.translatedText,
          provider: revision.provider,
          modelId: revision.modelId,
          promptVersionId: revision.promptVersionId,
          glossaryVersionId: revision.glossaryVersionId,
          modelCallId: revision.modelCallId,
          sourceFingerprint: revision.sourceFingerprint,
          createdAt: revision.createdAt,
          current: revision.id === currentRevisionId,
        });
        revisionHistory.set(revision.blockTranslationId, history);
      }

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
        revisionHistory: row.blockTranslationId
          ? (revisionHistory.get(row.blockTranslationId) ?? [])
          : [],
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
