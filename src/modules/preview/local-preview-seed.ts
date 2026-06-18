import { diffBlocks } from "@/modules/ingestion/diff";
import {
  fingerprintBlock,
  fingerprintPage,
} from "@/modules/ingestion/fingerprint";
import { parseSourcePage } from "@/modules/ingestion/parser";
import type {
  BlockDiff,
  FingerprintedBlock,
  ParsedPage,
} from "@/modules/ingestion/types";

import {
  LOCAL_PREVIEW_PAGES,
  type LocalPreviewPage,
} from "./local-preview-data";

export { LOCAL_PREVIEW_PAGES };

export type PreviewSeedContentBlock = {
  id: string;
  ordinal: number;
  type: string;
  sourceText: string;
  fingerprint: string;
  translatable: boolean;
};

type StoredPreviewPage = {
  id: string;
  canonicalUrl: string;
};

type CurrentPreviewSnapshot = {
  blocks: PreviewSeedContentBlock[];
};

export type PreviewSeedIngestionRepository = {
  upsertDiscoveredPages(input: {
    discoveredAt: Date;
    pages: Array<{ canonicalUrl: string }>;
  }): Promise<StoredPreviewPage[]>;
  getCurrentPageSnapshot(
    pageId: string,
  ): Promise<CurrentPreviewSnapshot | undefined>;
  publishParsedPage(input: {
    pageId: string;
    parsedPage: ParsedPage;
    pageFingerprint: string;
    blockFingerprints: string[];
    diff: BlockDiff;
    fetchedAt: Date;
  }): Promise<
    | { kind: "published"; versionId: string; versionNumber: number }
    | { kind: "unchanged"; versionId: string }
    | { kind: "restored"; versionId: string; versionNumber: number }
  >;
};

export type PreviewSeedTranslationRepository = {
  publishRevision(input: {
    blockId: string;
    expectedSourceFingerprint: string;
    source: "ai";
    translatedText: string;
    provider: "deepseek";
    modelId: string;
    promptVersionId: null;
    glossaryVersionId: null;
    modelCallId: null;
    now: Date;
  }): Promise<unknown>;
};

export type PreviewSeedDependencies = {
  ingestionRepository: PreviewSeedIngestionRepository;
  translationRepository: PreviewSeedTranslationRepository;
  loadBlocksForVersion(versionId: string): Promise<PreviewSeedContentBlock[]>;
  now: Date;
  pages?: LocalPreviewPage[];
};

export type PreviewSeedResult = {
  pages: Array<{
    canonicalUrl: string;
    path: string;
    title: string;
    blockCount: number;
    translatedCount: number;
  }>;
  translationCount: number;
};

function fingerprintedBlocks(parsedPage: ParsedPage): FingerprintedBlock[] {
  return parsedPage.blocks.map((block) => ({
    ...block,
    contentFingerprint: fingerprintBlock(block),
  }));
}

function previousFingerprinted(
  snapshot: CurrentPreviewSnapshot | undefined,
): FingerprintedBlock[] {
  return (
    snapshot?.blocks.map((block) => ({
      headingPath: [],
      ordinal: block.ordinal,
      payload: {},
      sourceText: block.sourceText,
      translatable: block.translatable,
      type: block.type as FingerprintedBlock["type"],
      contentFingerprint: block.fingerprint,
    })) ?? []
  );
}

async function publishPage(
  page: LocalPreviewPage,
  dependencies: PreviewSeedDependencies,
) {
  const [storedPage] =
    await dependencies.ingestionRepository.upsertDiscoveredPages({
      discoveredAt: dependencies.now,
      pages: [{ canonicalUrl: page.canonicalUrl }],
    });
  if (!storedPage) {
    throw new Error(`Unable to store preview page ${page.canonicalUrl}`);
  }

  const parsedPage = parseSourcePage({
    body: page.markdown,
    sourceFormat: "text",
  });
  const currentBlocks = fingerprintedBlocks(parsedPage);
  const currentSnapshot =
    await dependencies.ingestionRepository.getCurrentPageSnapshot(
      storedPage.id,
    );
  const published =
    await dependencies.ingestionRepository.publishParsedPage({
      pageId: storedPage.id,
      parsedPage,
      pageFingerprint: fingerprintPage(currentBlocks),
      blockFingerprints: currentBlocks.map(
        (block) => block.contentFingerprint,
      ),
      diff: diffBlocks(
        previousFingerprinted(currentSnapshot),
        currentBlocks,
      ),
      fetchedAt: dependencies.now,
    });

  return {
    parsedPage,
    storedPage,
    versionId: published.versionId,
  };
}

async function publishTranslations(
  page: LocalPreviewPage,
  versionId: string,
  dependencies: PreviewSeedDependencies,
) {
  const blocks = await dependencies.loadBlocksForVersion(versionId);
  let translatedCount = 0;

  for (const block of blocks) {
    const translatedText = page.translations[block.sourceText];

    if (!block.translatable || !translatedText) {
      continue;
    }

    await dependencies.translationRepository.publishRevision({
      blockId: block.id,
      expectedSourceFingerprint: block.fingerprint,
      source: "ai",
      translatedText,
      provider: "deepseek",
      modelId: "local-preview",
      promptVersionId: null,
      glossaryVersionId: null,
      modelCallId: null,
      now: dependencies.now,
    });
    translatedCount += 1;
  }

  return {
    blockCount: blocks.length,
    translatedCount,
  };
}

export async function seedLocalPreview(
  dependencies: PreviewSeedDependencies,
): Promise<PreviewSeedResult> {
  const pages = dependencies.pages ?? LOCAL_PREVIEW_PAGES;
  const result: PreviewSeedResult = {
    pages: [],
    translationCount: 0,
  };

  for (const page of pages) {
    const published = await publishPage(page, dependencies);
    const translated = await publishTranslations(
      page,
      published.versionId,
      dependencies,
    );

    result.pages.push({
      canonicalUrl: page.canonicalUrl,
      path: new URL(page.canonicalUrl).pathname,
      title: published.parsedPage.title,
      blockCount: translated.blockCount,
      translatedCount: translated.translatedCount,
    });
    result.translationCount += translated.translatedCount;
  }

  return result;
}
