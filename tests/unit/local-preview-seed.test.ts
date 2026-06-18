import { describe, expect, it } from "vitest";

import {
  LOCAL_PREVIEW_PAGES,
  seedLocalPreview,
  type PreviewSeedContentBlock,
} from "@/modules/preview/local-preview-seed";

type PublishedPage = {
  canonicalUrl: string;
  parsedTitle: string | null;
  versionId: string;
  blocks: PreviewSeedContentBlock[];
};

describe("seedLocalPreview", () => {
  it("publishes demo pages and only translates configured translatable blocks", async () => {
    const now = new Date("2026-06-18T09:00:00.000Z");
    const discoveredUrls: string[] = [];
    const publishedPages: PublishedPage[] = [];
    const revisionInputs: Array<{
      blockId: string;
      translatedText: string;
      sourceText: string;
    }> = [];
    const sourceByBlockId = new Map<string, string>();

    const result = await seedLocalPreview({
      ingestionRepository: {
        async getCurrentPageSnapshot() {
          return { blocks: [] };
        },
        async publishParsedPage(input) {
          const versionId = `version-${publishedPages.length + 1}`;
          const blocks = input.parsedPage.blocks.map((block, index) => {
            const id = `${versionId}-block-${index}`;
            sourceByBlockId.set(id, block.sourceText);
            return {
              id,
              fingerprint: input.blockFingerprints[index],
              ordinal: index,
              sourceText: block.sourceText,
              translatable: block.translatable,
              type: block.type,
            } satisfies PreviewSeedContentBlock;
          });
          publishedPages.push({
            canonicalUrl: `https://shopify.dev${input.parsedPage.title}`,
            parsedTitle: input.parsedPage.title,
            versionId,
            blocks,
          });
          return { kind: "published", versionId, versionNumber: 1 };
        },
        async upsertDiscoveredPages(input) {
          discoveredUrls.push(
            ...input.pages.map((page) => page.canonicalUrl),
          );
          return input.pages.map((page, index) => ({
            canonicalUrl: page.canonicalUrl,
            id: `page-${index + 1}`,
          }));
        },
      },
      loadBlocksForVersion: async (versionId) => {
        const page = publishedPages.find(
          (published) => published.versionId === versionId,
        );
        if (!page) throw new Error(`Missing ${versionId}`);
        return page.blocks;
      },
      now,
      translationRepository: {
        async publishRevision(input) {
          revisionInputs.push({
            blockId: input.blockId,
            sourceText: sourceByBlockId.get(input.blockId) ?? "",
            translatedText: input.translatedText,
          });
          return {
            kind: "published",
            revision: {
              id: `revision-${revisionInputs.length}`,
            },
          };
        },
      },
    });

    expect(discoveredUrls).toEqual(
      LOCAL_PREVIEW_PAGES.map((page) => page.canonicalUrl),
    );
    expect(publishedPages.map((page) => page.parsedTitle)).toEqual([
      "Build apps",
      "Admin GraphQL API",
    ]);
    expect(revisionInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceText: "Use Shopify CLI to create, run, and deploy apps.",
          translatedText:
            "使用 Shopify CLI 创建、运行和部署 apps。",
        }),
        expect.objectContaining({
          sourceText:
            "The Admin GraphQL API lets apps read and write Shopify store data.",
          translatedText:
            "Admin GraphQL API 允许 apps 读取和写入 Shopify 店铺数据。",
        }),
      ]),
    );
    expect(revisionInputs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceText: "shopify app dev",
        }),
      ]),
    );
    expect(result.pages).toEqual([
      expect.objectContaining({
        path: "/docs/apps/build",
        title: "Build apps",
      }),
      expect.objectContaining({
        path: "/docs/api/admin-graphql",
        title: "Admin GraphQL API",
      }),
    ]);
    expect(result.translationCount).toBe(revisionInputs.length);
  });
});
