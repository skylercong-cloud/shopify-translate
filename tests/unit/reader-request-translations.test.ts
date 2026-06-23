import { describe, expect, it, vi } from "vitest";

import { requestReaderTranslations } from "@/modules/reader/request-translations";
import type { ReaderBlock, ReaderPage } from "@/modules/reader/types";

function block(
  id: string,
  status: ReaderBlock["translationStatus"],
  translatable = true,
): ReaderBlock {
  return {
    id,
    ordinal: 0,
    type: translatable ? "paragraph" : "code",
    headingPath: [],
    sourceText: id,
    payload: {},
    translatable,
    fingerprint: `${id}-fingerprint`,
    translationStatus: status,
    translatedText: null,
    currentRevisionSource: null,
    revisionHistory: [],
  };
}

describe("reader translation requests", () => {
  it("promotes only pending and failed translatable blocks", async () => {
    const now = new Date("2026-06-23T03:00:00Z");
    const enqueue = vi.fn(async (input) => ({
      action: "created" as const,
      job: { id: input.dedupeKey },
    }));
    const page = {
      id: "page-id",
      canonicalUrl: "https://shopify.dev/docs/api/admin-graphql",
      path: "/docs/api/admin-graphql",
      title: "GraphQL Admin API reference",
      lastSuccessAt: now,
      version: {
        id: "version-id",
        versionNumber: 1,
        blockCount: 7,
        fetchedAt: now,
        publishedAt: now,
      },
      summary: {
        blockCount: 7,
        translatedCount: 1,
        pendingCount: 1,
        reviewRequiredCount: 1,
        failedCount: 1,
        oversizedCount: 1,
      },
      blocks: [
        block("pending", "pending"),
        block("failed", "failed"),
        block("translated", "ai_translated"),
        block("manual", "manually_corrected"),
        block("review", "review_required"),
        block("oversized", "oversized"),
        block("code", "pending", false),
      ],
    } as ReaderPage;

    await requestReaderTranslations({
      page,
      jobRepository: { enqueue } as never,
      now,
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(1, {
      queue: "translation",
      type: "translate_block",
      dedupeKey: "translate:pending:pending-fingerprint",
      payload: {
        blockId: "pending",
        contentFingerprint: "pending-fingerprint",
      },
      priority: 100,
      runAt: now,
    });
    expect(enqueue).toHaveBeenNthCalledWith(2, {
      queue: "translation",
      type: "translate_block",
      dedupeKey: "translate:failed:failed-fingerprint",
      payload: {
        blockId: "failed",
        contentFingerprint: "failed-fingerprint",
      },
      priority: 100,
      runAt: now,
    });
  });
});
