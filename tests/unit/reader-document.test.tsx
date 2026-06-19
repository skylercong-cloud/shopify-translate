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
    blockCount: 3,
    fetchedAt: new Date("2026-06-18T08:00:00.000Z"),
    publishedAt: new Date("2026-06-18T08:00:00.000Z"),
  },
  summary: {
    blockCount: 3,
    translatedCount: 1,
    pendingCount: 1,
    reviewRequiredCount: 0,
    failedCount: 0,
    oversizedCount: 0,
  },
  blocks: [
    {
      id: "heading-id",
      ordinal: 0,
      type: "heading",
      headingPath: ["Build apps"],
      sourceText: "Build apps",
      payload: {},
      translatable: true,
      fingerprint: "heading-fingerprint",
      translationStatus: "pending",
      translatedText: null,
      currentRevisionSource: null,
      revisionHistory: [],
    },
    {
      id: "paragraph-id",
      ordinal: 1,
      type: "paragraph",
      headingPath: ["Build apps"],
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
        {
          id: "ai-revision-id",
          source: "ai",
          translatedText: "用 Shopify CLI。",
          provider: "deepseek",
          modelId: "deepseek-chat",
          promptVersionId: "prompt-id",
          glossaryVersionId: "glossary-id",
          modelCallId: "model-call-id",
          sourceFingerprint: "paragraph-fingerprint",
          createdAt: new Date("2026-06-18T08:01:00.000Z"),
          current: false,
        },
      ],
    },
    {
      id: "code-id",
      ordinal: 2,
      type: "code",
      headingPath: ["Build apps"],
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
  it("renders immutable translation revision history for translatable blocks", () => {
    render(<ReaderDocument page={page} />);

    expect(screen.getByText("Translation history (2)")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Block manual correction")).toBeInTheDocument();
    expect(screen.getByText("AI translation")).toBeInTheDocument();
    expect(screen.getByText("deepseek / deepseek-chat")).toBeInTheDocument();
    expect(screen.getAllByText("使用 Shopify CLI。").length).toBeGreaterThan(1);
    expect(screen.getByText("用 Shopify CLI。")).toBeInTheDocument();
    expect(screen.getByText("Jun 18, 2026, 4:05 PM")).toBeInTheDocument();
    expect(screen.getByText("shopify app dev")).toBeInTheDocument();
  });
});
