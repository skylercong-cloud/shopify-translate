import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReaderDocument } from "@/app/(app)/docs/[...slug]/reader-document";
import {
  displayTextForLanguage,
  statusLabel,
} from "@/modules/reader/render-block";
import type { ReaderBlock, ReaderPage } from "@/modules/reader/types";

const now = new Date("2026-06-16T00:00:00.000Z");

afterEach(cleanup);

function block(overrides: Partial<ReaderBlock> = {}): ReaderBlock {
  return {
    id: "block-id",
    ordinal: 0,
    type: "paragraph",
    headingPath: [],
    sourceText: "Use Shopify CLI.",
    payload: {},
    translatable: true,
    fingerprint: "fingerprint",
    translationStatus: "pending",
    translatedText: null,
    currentRevisionSource: null,
    revisionHistory: [],
    ...overrides,
  };
}

function page(blocks: ReaderBlock[]): ReaderPage {
  return {
    id: "page-id",
    canonicalUrl: "https://shopify.dev/docs/apps/build",
    path: "/docs/apps/build",
    title: "Build apps",
    lastSuccessAt: now,
    version: {
      id: "version-id",
      versionNumber: 1,
      blockCount: blocks.length,
      fetchedAt: now,
      publishedAt: now,
    },
    summary: {
      blockCount: blocks.length,
      translatedCount: blocks.filter((item) => item.translatedText).length,
      pendingCount: blocks.filter(
        (item) => item.translationStatus === "pending",
      ).length,
      reviewRequiredCount: 0,
      failedCount: 0,
      oversizedCount: 0,
    },
    blocks,
  };
}

describe("reader rendering", () => {
  it("chooses translated text in Chinese mode and source text in English mode", () => {
    const translated = block({
      translatedText: "使用 Shopify CLI。",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
    });

    expect(displayTextForLanguage(translated, "zh")).toBe(
      "使用 Shopify CLI。",
    );
    expect(displayTextForLanguage(translated, "en")).toBe(
      "Use Shopify CLI.",
    );
    expect(displayTextForLanguage(block(), "zh")).toBe(
      "Use Shopify CLI.",
    );
  });

  it("labels reader translation states", () => {
    expect(statusLabel("ai_translated", "ai")).toBe("AI translated");
    expect(statusLabel("manually_corrected", "block_manual")).toBe(
      "Manual correction",
    );
    expect(statusLabel("review_required", null)).toBe("Review required");
    expect(statusLabel("oversized", null)).toBe("Oversized");
  });

  it("renders a focused semantic document without inline admin controls", () => {
    const heading = block({
      id: "heading-id",
      type: "heading",
      sourceText: "Build apps",
      translatedText: "构建应用",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
    });
    const paragraph = block({
      id: "paragraph-id",
      ordinal: 1,
      translatedText: "使用 Shopify CLI。",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
    });
    const list = block({
      id: "list-id",
      ordinal: 2,
      type: "list",
      sourceText: "First step\nSecond step",
      translatedText: "第一步\n第二步",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
      payload: {
        ordered: false,
        items: [
          { text: "First step", children: [] },
          { text: "Second step", children: [] },
        ],
      },
    });
    const table = block({
      id: "table-id",
      ordinal: 3,
      type: "table",
      sourceText: "Field\tDescription\nname\tName",
      translatedText: "字段\t说明\nname\t名称",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
      payload: {
        headers: ["Field", "Description"],
        rows: [["name", "Name"]],
      },
    });
    const notice = block({
      id: "notice-id",
      ordinal: 4,
      type: "notice",
      sourceText: "Keep tokens private.",
      translatedText: "请妥善保管令牌。",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
      payload: { kind: "warning", title: "Warning" },
    });
    const code = block({
      id: "code-id",
      ordinal: 5,
      type: "code",
      sourceText: "shopify app dev",
      payload: { language: "sh" },
      translatable: false,
    });

    render(
      <ReaderDocument
        page={page([heading, paragraph, list, table, notice, code])}
      />,
    );

    expect(screen.getByRole("heading", { name: "构建应用" }))
      .toBeInTheDocument();
    expect(screen.getByText("使用 Shopify CLI。")).toBeVisible();
    expect(screen.getByText("第一步")).toBeVisible();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("请妥善保管令牌。")).toBeVisible();
    expect(screen.getByText("shopify app dev")).toBeInTheDocument();
    expect(screen.queryByText(/Block ID:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "管理译文" })).toHaveAttribute(
      "href",
      "/admin/review",
    );
    expect(screen.getByRole("link", { name: "官方原文" })).toHaveAttribute(
      "href",
      "https://shopify.dev/docs/apps/build",
    );
  });

  it("switches languages without changing the document URL", () => {
    window.history.pushState(null, "", "/docs/apps/build");
    const beforePath = window.location.pathname;
    const paragraph = block({
      id: "paragraph-id",
      translatedText: "使用 Shopify CLI。",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
    });
    const code = block({
      id: "code-id",
      ordinal: 1,
      type: "code",
      sourceText: "shopify app dev",
      payload: { language: "sh" },
      translatable: false,
    });

    render(<ReaderDocument page={page([paragraph, code])} />);
    expect(screen.getByText("使用 Shopify CLI。")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(window.location.pathname).toBe(beforePath);
    expect(screen.getByText("Use Shopify CLI.")).toBeVisible();
    expect(screen.getByText("shopify app dev")).toBeVisible();
  });
});
