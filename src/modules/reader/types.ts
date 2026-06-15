import type {
  blockTranslations,
  contentBlocks,
  translationRevisionSources,
} from "@/db/schema";

export type ReaderBlockType =
  typeof contentBlocks.$inferSelect.type;
export type ReaderTranslationStatus =
  typeof blockTranslations.$inferSelect.status;
export type ReaderRevisionSource =
  (typeof translationRevisionSources)[number];

export type ReaderTranslationSummary = {
  blockCount: number;
  translatedCount: number;
  pendingCount: number;
  reviewRequiredCount: number;
  failedCount: number;
  oversizedCount: number;
};

export type ReaderBlock = {
  id: string;
  ordinal: number;
  type: ReaderBlockType;
  headingPath: string[];
  sourceText: string;
  payload: Record<string, unknown>;
  translatable: boolean;
  fingerprint: string;
  translationStatus: ReaderTranslationStatus;
  translatedText: string | null;
  currentRevisionSource: ReaderRevisionSource | null;
};

export type ReaderPage = {
  id: string;
  canonicalUrl: string;
  path: string;
  title: string | null;
  lastSuccessAt: Date | null;
  version: {
    id: string;
    versionNumber: number;
    blockCount: number;
    fetchedAt: Date;
    publishedAt: Date;
  };
  summary: ReaderTranslationSummary;
  blocks: ReaderBlock[];
};
