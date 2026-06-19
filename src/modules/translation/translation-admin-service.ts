import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  contentBlocks,
  pageVersions,
  sourcePages,
  translationCorrections,
} from "@/db/schema";

export type TranslationAdminBlock = {
  id: string;
  sourceFingerprint: string;
  current: boolean;
  translatable: boolean;
};

export type RetranslationTarget = {
  blockId?: string;
  pagePath?: string;
  all?: boolean;
};

export type TranslationAdminStore = {
  getBlock(blockId: string): Promise<TranslationAdminBlock | null>;
  listCurrentBlocks(
    target: RetranslationTarget,
  ): Promise<TranslationAdminBlock[]>;
  listCorrectionHistory(blockId: string): Promise<
    Array<{
      id: string;
      scope: "global" | "block";
      sourceFingerprint: string;
      blockId: string | null;
      createdAt: Date;
    }>
  >;
};

type CorrectionRepository = {
  recordCorrection(input: {
    scope: "global" | "block";
    blockId: string;
    sourceFingerprint: string;
    translatedText: string;
    now: Date;
  }): Promise<
    | {
        kind: "published";
        correction: { id: string };
        revision: { id: string };
      }
    | { kind: "stale_source" }
  >;
};

type ActiveVersionRepository = {
  getActivePrompt(): Promise<{ id: string } | null>;
  getActiveGlossary(): Promise<{ id: string } | null>;
};

type TranslationJobRepository = {
  enqueue(input: {
    queue: "translation";
    type: "translate_block";
    dedupeKey: string;
    payload: Record<string, unknown>;
    priority: number;
    runAt: Date;
  }): Promise<{
    action: "created" | "deduplicated" | "promoted";
    job: { id: string };
  }>;
};

export type TranslationAdminServiceOptions = {
  store: TranslationAdminStore;
  translationRepository: CorrectionRepository;
  configRepository: ActiveVersionRepository;
  jobRepository: TranslationJobRepository;
  now: () => Date;
};

export function createTranslationAdminStore(
  db: NodePgDatabase<typeof schema>,
): TranslationAdminStore {
  const currentExpression = sql<boolean>`
    ${sourcePages.currentVersionId} = ${contentBlocks.pageVersionId}
  `;

  return {
    async getBlock(blockId) {
      const [block] = await db
        .select({
          id: contentBlocks.id,
          sourceFingerprint: contentBlocks.fingerprint,
          current: currentExpression,
          translatable: contentBlocks.translatable,
        })
        .from(contentBlocks)
        .innerJoin(
          pageVersions,
          eq(pageVersions.id, contentBlocks.pageVersionId),
        )
        .innerJoin(sourcePages, eq(sourcePages.id, pageVersions.pageId))
        .where(eq(contentBlocks.id, blockId))
        .limit(1);
      return block ?? null;
    },

    listCurrentBlocks(target) {
      const conditions = [
        eq(contentBlocks.translatable, true),
        eq(sourcePages.currentVersionId, contentBlocks.pageVersionId),
      ];
      if (target.blockId) {
        conditions.push(eq(contentBlocks.id, target.blockId));
      }
      if (target.pagePath) {
        conditions.push(eq(sourcePages.path, target.pagePath));
      }

      return db
        .select({
          id: contentBlocks.id,
          sourceFingerprint: contentBlocks.fingerprint,
          current: currentExpression,
          translatable: contentBlocks.translatable,
        })
        .from(contentBlocks)
        .innerJoin(
          pageVersions,
          eq(pageVersions.id, contentBlocks.pageVersionId),
        )
        .innerJoin(sourcePages, eq(sourcePages.id, pageVersions.pageId))
        .where(and(...conditions))
        .orderBy(asc(sourcePages.path), asc(contentBlocks.ordinal));
    },

    async listCorrectionHistory(blockId) {
      const block = await this.getBlock(blockId);
      if (!block) return [];

      return db
        .select({
          id: translationCorrections.id,
          scope: translationCorrections.scope,
          sourceFingerprint: translationCorrections.sourceFingerprint,
          blockId: translationCorrections.blockId,
          createdAt: translationCorrections.createdAt,
        })
        .from(translationCorrections)
        .where(
          or(
            and(
              eq(translationCorrections.scope, "block"),
              eq(translationCorrections.blockId, blockId),
            ),
            and(
              eq(translationCorrections.scope, "global"),
              eq(
                translationCorrections.sourceFingerprint,
                block.sourceFingerprint,
              ),
            ),
          ),
        )
        .orderBy(
          desc(translationCorrections.createdAt),
          desc(translationCorrections.id),
        );
    },
  };
}

function requireOneTarget(target: RetranslationTarget): void {
  const selected = [
    Boolean(target.blockId),
    Boolean(target.pagePath),
    target.all === true,
  ].filter(Boolean).length;
  if (selected !== 1) {
    throw new Error(
      "Retranslation requires exactly one of blockId, pagePath, or all",
    );
  }
}

export function createTranslationAdminService(
  options: TranslationAdminServiceOptions,
) {
  return {
    async recordManualCorrection(input: {
      blockId?: string;
      translatedText: string;
      scope: "global" | "block";
      expectedSourceFingerprint?: string;
    }) {
      if (!input.blockId) {
        throw new Error("blockId is required for manual corrections");
      }
      if (!input.translatedText.trim()) {
        throw new Error("translatedText is required");
      }

      const block = await options.store.getBlock(input.blockId);
      if (!block) throw new Error("Translation block was not found");
      if (!block.translatable) {
        throw new Error("Translation block is not translatable");
      }

      if (!block.current && !input.expectedSourceFingerprint) {
        throw new Error(
          "A non-current block requires an explicit source fingerprint",
        );
      }
      if (
        input.expectedSourceFingerprint &&
        input.expectedSourceFingerprint !== block.sourceFingerprint
      ) {
        throw new Error(
          "The expected source fingerprint does not match the block",
        );
      }

      const result = await options.translationRepository.recordCorrection({
        blockId: block.id,
        translatedText: input.translatedText,
        scope: input.scope,
        sourceFingerprint:
          input.expectedSourceFingerprint ?? block.sourceFingerprint,
        now: options.now(),
      });
      if (result.kind === "stale_source") {
        throw new Error("The source changed before correction publication");
      }
      return result;
    },

    listCorrectionHistory(blockId: string) {
      if (!blockId) throw new Error("blockId is required");
      return options.store.listCorrectionHistory(blockId);
    },

    async enqueueRetranslation(target: RetranslationTarget) {
      requireOneTarget(target);
      const [prompt, glossary] = await Promise.all([
        options.configRepository.getActivePrompt(),
        options.configRepository.getActiveGlossary(),
      ]);
      if (!prompt) {
        throw new Error(
          "An active prompt is required before retranslation",
        );
      }
      if (!glossary) {
        throw new Error(
          "An active glossary is required before retranslation",
        );
      }

      const blocks = await options.store.listCurrentBlocks(target);
      const counts = {
        targeted: blocks.length,
        created: 0,
        deduplicated: 0,
        promoted: 0,
      };
      for (const block of blocks) {
        const result = await options.jobRepository.enqueue({
          queue: "translation",
          type: "translate_block",
          dedupeKey: [
            "retranslate",
            block.id,
            block.sourceFingerprint,
            prompt.id,
            glossary.id,
          ].join(":"),
          payload: {
            blockId: block.id,
            contentFingerprint: block.sourceFingerprint,
          },
          priority: 0,
          runAt: options.now(),
        });
        counts[result.action] += 1;
      }
      return counts;
    },
  };
}

export type TranslationAdminService = ReturnType<
  typeof createTranslationAdminService
>;
