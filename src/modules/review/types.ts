import type {
  blockTranslations,
  contentBlocks,
  translationRevisions,
} from "@/db/schema";

export type TranslationReviewItem = {
  blockId: string;
  pagePath: string;
  pageTitle: string | null;
  ordinal: number;
  blockType: (typeof contentBlocks.$inferSelect)["type"];
  headingPath: string[];
  sourceText: string;
  sourceFingerprint: string;
  status: (typeof blockTranslations.$inferSelect)["status"];
  translatedText: string | null;
  currentRevisionSource:
    | (typeof translationRevisions.$inferSelect)["source"]
    | null;
  revisionCreatedAt: Date | null;
  updatedAt: Date;
};
