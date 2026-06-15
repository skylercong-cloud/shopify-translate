import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  blockTranslations,
  contentBlocks,
  pageVersions,
  sourcePages,
  translationCorrections,
  translationRevisions,
  type translationCorrectionScopes,
  type translationRevisionSources,
  type translationProviders,
} from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
export type TranslationRevisionSource =
  (typeof translationRevisionSources)[number];
export type TranslationCorrectionScope =
  (typeof translationCorrectionScopes)[number];
export type TranslationProvider = (typeof translationProviders)[number];
export type StoredBlockTranslation =
  typeof blockTranslations.$inferSelect;
export type StoredTranslationRevision =
  typeof translationRevisions.$inferSelect;
export type StoredTranslationCorrection =
  typeof translationCorrections.$inferSelect;
export type SourceBlock = typeof contentBlocks.$inferSelect & {
  pageTitle: string | null;
  canonicalUrl: string;
};

export type PublishRevisionInput = {
  blockId: string;
  expectedSourceFingerprint: string;
  source: TranslationRevisionSource;
  translatedText: string;
  provider: TranslationProvider | null;
  modelId: string | null;
  promptVersionId: string | null;
  glossaryVersionId: string | null;
  modelCallId: string | null;
  now: Date;
};

export type RecordCorrectionInput = {
  scope: TranslationCorrectionScope;
  blockId: string;
  sourceFingerprint: string;
  translatedText: string;
  now: Date;
};

export type PublicationResult =
  | {
      kind: "published";
      revision: StoredTranslationRevision;
    }
  | { kind: "stale_source" };

export type CorrectionPublicationResult =
  | {
      kind: "published";
      correction: StoredTranslationCorrection;
      revision: StoredTranslationRevision;
    }
  | { kind: "stale_source" };

export type StateUpdateResult =
  | { kind: "updated" }
  | { kind: "stale_source" };

function nextStatus(
  current: StoredBlockTranslation,
  source: TranslationRevisionSource,
): StoredBlockTranslation["status"] {
  if (source === "block_manual" || source === "global_manual") {
    return "manually_corrected";
  }
  return current.status === "review_required"
    ? "review_required"
    : "ai_translated";
}

export function createTranslationRepository(db: Database) {
  return {
    async loadBlockContext(blockId: string): Promise<{
      block: SourceBlock;
      previousText: string | null;
      nextText: string | null;
      translation: StoredBlockTranslation | null;
    } | null> {
      const [block] = await db
        .select({
          ...getTableColumns(contentBlocks),
          pageTitle: sourcePages.title,
          canonicalUrl: sourcePages.canonicalUrl,
        })
        .from(contentBlocks)
        .innerJoin(
          pageVersions,
          eq(pageVersions.id, contentBlocks.pageVersionId),
        )
        .innerJoin(sourcePages, eq(sourcePages.id, pageVersions.pageId))
        .where(eq(contentBlocks.id, blockId))
        .limit(1);
      if (!block) return null;

      const [[previous], [next], [translation]] = await Promise.all([
        db
          .select({ sourceText: contentBlocks.sourceText })
          .from(contentBlocks)
          .where(
            and(
              eq(contentBlocks.pageVersionId, block.pageVersionId),
              lt(contentBlocks.ordinal, block.ordinal),
            ),
          )
          .orderBy(desc(contentBlocks.ordinal))
          .limit(1),
        db
          .select({ sourceText: contentBlocks.sourceText })
          .from(contentBlocks)
          .where(
            and(
              eq(contentBlocks.pageVersionId, block.pageVersionId),
              gt(contentBlocks.ordinal, block.ordinal),
            ),
          )
          .orderBy(asc(contentBlocks.ordinal))
          .limit(1),
        db
          .select()
          .from(blockTranslations)
          .where(eq(blockTranslations.blockId, blockId))
          .limit(1),
      ]);

      return {
        block,
        previousText: previous?.sourceText ?? null,
        nextText: next?.sourceText ?? null,
        translation: translation ?? null,
      };
    },

    async findBlockCorrection(
      blockId: string,
      sourceFingerprint: string,
    ): Promise<StoredTranslationCorrection | null> {
      const [correction] = await db
        .select()
        .from(translationCorrections)
        .where(
          and(
            eq(translationCorrections.scope, "block"),
            eq(translationCorrections.blockId, blockId),
            eq(
              translationCorrections.sourceFingerprint,
              sourceFingerprint,
            ),
          ),
        )
        .orderBy(
          desc(translationCorrections.createdAt),
          desc(translationCorrections.id),
        )
        .limit(1);
      return correction ?? null;
    },

    async findGlobalCorrection(
      sourceFingerprint: string,
    ): Promise<StoredTranslationCorrection | null> {
      const [correction] = await db
        .select()
        .from(translationCorrections)
        .where(
          and(
            eq(translationCorrections.scope, "global"),
            isNull(translationCorrections.blockId),
            eq(
              translationCorrections.sourceFingerprint,
              sourceFingerprint,
            ),
          ),
        )
        .orderBy(
          desc(translationCorrections.createdAt),
          desc(translationCorrections.id),
        )
        .limit(1);
      return correction ?? null;
    },

    async findAiMemory(
      sourceFingerprint: string,
      promptVersionId: string,
      glossaryVersionId: string,
    ): Promise<StoredTranslationRevision | null> {
      const [revision] = await db
        .select()
        .from(translationRevisions)
        .where(
          and(
            eq(
              translationRevisions.sourceFingerprint,
              sourceFingerprint,
            ),
            inArray(translationRevisions.source, ["ai", "ai_memory"]),
            eq(
              translationRevisions.promptVersionId,
              promptVersionId,
            ),
            eq(
              translationRevisions.glossaryVersionId,
              glossaryVersionId,
            ),
          ),
        )
        .orderBy(
          desc(translationRevisions.createdAt),
          desc(translationRevisions.id),
        )
        .limit(1);
      return revision ?? null;
    },

    publishRevision(
      input: PublishRevisionInput,
    ): Promise<PublicationResult> {
      return db.transaction(async (transaction) => {
        const [translation] = await transaction
          .select()
          .from(blockTranslations)
          .where(eq(blockTranslations.blockId, input.blockId))
          .limit(1)
          .for("update");
        if (
          !translation ||
          translation.sourceFingerprint !==
            input.expectedSourceFingerprint
        ) {
          return { kind: "stale_source" };
        }

        const [revision] = await transaction
          .insert(translationRevisions)
          .values({
            blockTranslationId: translation.id,
            source: input.source,
            translatedText: input.translatedText,
            sourceFingerprint: input.expectedSourceFingerprint,
            provider: input.provider,
            modelId: input.modelId,
            promptVersionId: input.promptVersionId,
            glossaryVersionId: input.glossaryVersionId,
            modelCallId: input.modelCallId,
            createdAt: input.now,
          })
          .returning();
        await transaction
          .update(blockTranslations)
          .set({
            status: nextStatus(translation, input.source),
            currentRevisionId: revision.id,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(blockTranslations.id, translation.id),
              eq(
                blockTranslations.sourceFingerprint,
                input.expectedSourceFingerprint,
              ),
            ),
          );

        return { kind: "published", revision };
      });
    },

    recordCorrection(
      input: RecordCorrectionInput,
    ): Promise<CorrectionPublicationResult> {
      return db.transaction(async (transaction) => {
        const [translation] = await transaction
          .select()
          .from(blockTranslations)
          .where(eq(blockTranslations.blockId, input.blockId))
          .limit(1)
          .for("update");
        if (
          !translation ||
          translation.sourceFingerprint !== input.sourceFingerprint
        ) {
          return { kind: "stale_source" };
        }

        const [correction] = await transaction
          .insert(translationCorrections)
          .values({
            scope: input.scope,
            blockId: input.scope === "block" ? input.blockId : null,
            sourceFingerprint: input.sourceFingerprint,
            translatedText: input.translatedText,
            createdAt: input.now,
          })
          .returning();
        const [revision] = await transaction
          .insert(translationRevisions)
          .values({
            blockTranslationId: translation.id,
            source:
              input.scope === "block"
                ? "block_manual"
                : "global_manual",
            translatedText: input.translatedText,
            sourceFingerprint: input.sourceFingerprint,
            createdAt: input.now,
          })
          .returning();
        await transaction
          .update(blockTranslations)
          .set({
            status: "manually_corrected",
            currentRevisionId: revision.id,
            reviewReason: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(blockTranslations.id, translation.id),
              eq(
                blockTranslations.sourceFingerprint,
                input.sourceFingerprint,
              ),
            ),
          );

        return { kind: "published", correction, revision };
      });
    },

    async markFailed(
      blockId: string,
      expectedSourceFingerprint: string,
      code: string,
      message: string,
      now: Date,
    ): Promise<StateUpdateResult> {
      const updated = await db
        .update(blockTranslations)
        .set({
          status: sql`case
            when ${blockTranslations.currentRevisionId} is null
              then 'failed'::translation_status
            else ${blockTranslations.status}
          end`,
          lastErrorCode: code,
          lastErrorMessage: message,
          updatedAt: now,
        })
        .where(
          and(
            eq(blockTranslations.blockId, blockId),
            eq(
              blockTranslations.sourceFingerprint,
              expectedSourceFingerprint,
            ),
          ),
        )
        .returning({ id: blockTranslations.id });
      return updated.length > 0
        ? { kind: "updated" }
        : { kind: "stale_source" };
    },

    async markOversized(
      blockId: string,
      expectedSourceFingerprint: string,
      message: string,
      now: Date,
    ): Promise<StateUpdateResult> {
      const updated = await db
        .update(blockTranslations)
        .set({
          status: "oversized",
          lastErrorCode: "oversized",
          lastErrorMessage: message,
          updatedAt: now,
        })
        .where(
          and(
            eq(blockTranslations.blockId, blockId),
            eq(
              blockTranslations.sourceFingerprint,
              expectedSourceFingerprint,
            ),
          ),
        )
        .returning({ id: blockTranslations.id });
      return updated.length > 0
        ? { kind: "updated" }
        : { kind: "stale_source" };
    },
  };
}

export type TranslationRepository = ReturnType<
  typeof createTranslationRepository
>;
