import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  blockTranslations,
  contentBlocks,
  pageVersions,
  sourcePages,
  translationRevisions,
} from "@/db/schema";
import type { TranslationReviewItem } from "@/modules/review/types";

type Database = NodePgDatabase<typeof schema>;

function clampLimit(limit: number) {
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

export function createTranslationReviewRepository(db: Database) {
  return {
    async loadReviewItems(limit = 50): Promise<TranslationReviewItem[]> {
      const rows = await db
        .select({
          blockId: contentBlocks.id,
          pagePath: sourcePages.path,
          pageTitle: sourcePages.title,
          ordinal: contentBlocks.ordinal,
          blockType: contentBlocks.type,
          headingPath: contentBlocks.headingPath,
          sourceText: contentBlocks.sourceText,
          sourceFingerprint: contentBlocks.fingerprint,
          status: blockTranslations.status,
          translatedText: translationRevisions.translatedText,
          currentRevisionSource: translationRevisions.source,
          revisionCreatedAt: translationRevisions.createdAt,
          translationUpdatedAt: blockTranslations.updatedAt,
          blockCreatedAt: contentBlocks.createdAt,
        })
        .from(contentBlocks)
        .innerJoin(
          pageVersions,
          eq(pageVersions.id, contentBlocks.pageVersionId),
        )
        .innerJoin(
          sourcePages,
          and(
            eq(sourcePages.id, pageVersions.pageId),
            eq(sourcePages.currentVersionId, pageVersions.id),
          ),
        )
        .leftJoin(
          blockTranslations,
          eq(blockTranslations.blockId, contentBlocks.id),
        )
        .leftJoin(
          translationRevisions,
          eq(translationRevisions.id, blockTranslations.currentRevisionId),
        )
        .where(eq(contentBlocks.translatable, true))
        .orderBy(
          sql`case coalesce(${blockTranslations.status}, 'pending')
            when 'review_required' then 0
            when 'failed' then 1
            when 'pending' then 2
            when 'ai_translated' then 3
            when 'manually_corrected' then 4
            when 'oversized' then 5
            else 6
          end`,
          desc(sql`coalesce(${blockTranslations.updatedAt}, ${contentBlocks.createdAt})`),
          asc(sourcePages.path),
          asc(contentBlocks.ordinal),
        )
        .limit(clampLimit(limit));

      return rows.map((row) => ({
        blockId: row.blockId,
        pagePath: row.pagePath,
        pageTitle: row.pageTitle,
        ordinal: row.ordinal,
        blockType: row.blockType,
        headingPath: row.headingPath,
        sourceText: row.sourceText,
        sourceFingerprint: row.sourceFingerprint,
        status: row.status ?? "pending",
        translatedText: row.translatedText ?? null,
        currentRevisionSource: row.currentRevisionSource ?? null,
        revisionCreatedAt: row.revisionCreatedAt ?? null,
        updatedAt: row.translationUpdatedAt ?? row.blockCreatedAt,
      }));
    },
  };
}
