import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReaderDocument } from "@/app/(app)/docs/[...slug]/reader-document";
import type { ReaderPage } from "@/modules/reader/types";

const page = {
  id: "page-id",
  canonicalUrl: "https://shopify.dev/docs/apps/build",
  path: "/docs/apps/build",
  title: "Build apps",
  lastSuccessAt: new Date("2026-06-18T08:00:00.000Z"),
  version: {
    id: "version-id",
    versionNumber: 1,
    blockCount: 2,
    fetchedAt: new Date("2026-06-18T08:00:00.000Z"),
    publishedAt: new Date("2026-06-18T08:00:00.000Z"),
  },
  summary: {
    blockCount: 2,
    translatedCount: 1,
    pendingCount: 0,
    reviewRequiredCount: 0,
    failedCount: 0,
    oversizedCount: 0,
  },
  blocks: [
    {
      id: "paragraph-id",
      ordinal: 0,
      type: "paragraph",
      headingPath: [],
      sourceText: "Use Shopify CLI.",
      payload: {},
      translatable: true,
      fingerprint: "paragraph-fingerprint",
      translationStatus: "manually_corrected",
      translatedText: "使用 Shopify CLI。",
      currentRevisionSource: "block_manual",
      revisionHistory: [
        {
          id: "manual-revision-id",
          source: "block_manual",
          translatedText: "使用 Shopify CLI。",
          provider: null,
          modelId: null,
          promptVersionId: null,
          glossaryVersionId: null,
          modelCallId: null,
          sourceFingerprint: "paragraph-fingerprint",
          createdAt: new Date("2026-06-18T08:05:00.000Z"),
          current: true,
        },
      ],
    },
    {
      id: "code-id",
      ordinal: 1,
      type: "code",
      headingPath: [],
      sourceText: "shopify app dev",
      payload: { language: "sh" },
      translatable: false,
      fingerprint: "code-fingerprint",
      translationStatus: "pending",
      translatedText: null,
      currentRevisionSource: null,
      revisionHistory: [],
    },
  ],
} as ReaderPage;

describe("ReaderDocument", () => {
  it("keeps correction forms and revision history in admin", () => {
    render(<ReaderDocument page={page} />);

    expect(screen.queryByText("Translation history (1)"))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "管理译文" })).toHaveAttribute(
      "href",
      "/admin/review",
    );
    expect(screen.getByText("shopify app dev")).toBeInTheDocument();
  });
});
