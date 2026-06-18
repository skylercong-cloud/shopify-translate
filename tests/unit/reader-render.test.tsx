import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReaderDocument } from "@/app/(app)/docs/[...slug]/reader-document";
import {
  displayTextForLanguage,
  statusLabel,
} from "@/modules/reader/render-block";
import type { ReaderBlock, ReaderPage } from "@/modules/reader/types";

const now = new Date("2026-06-16T00:00:00.000Z");

afterEach(() => {
  cleanup();
});

function block(
  overrides: Partial<ReaderBlock> = {},
): ReaderBlock {
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
      translatedCount: 1,
      pendingCount: 1,
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
      sourceText: "Use Shopify CLI.",
      translatedText: "Chinese: Use Shopify CLI.",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
    });

    expect(displayTextForLanguage(translated, "zh")).toBe(
      "Chinese: Use Shopify CLI.",
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
    expect(statusLabel("review_required", null)).toBe(
      "Review required",
    );
    expect(statusLabel("oversized", null)).toBe("Oversized");
  });

  it("renders cached page content, status, source link, and exact code", () => {
    const heading = block({
      id: "heading-id",
      type: "heading",
      sourceText: "Build apps",
      translationStatus: "pending",
    });
    const paragraph = block({
      id: "paragraph-id",
      ordinal: 1,
      sourceText: "Use Shopify CLI.",
      translatedText: "Chinese: Use Shopify CLI.",
      translationStatus: "ai_translated",
      currentRevisionSource: "ai",
    });
    const code = block({
      id: "code-id",
      ordinal: 2,
      type: "code",
      sourceText: "shopify app dev",
      payload: { language: "sh" },
      translatable: false,
    });

    render(<ReaderDocument page={page([heading, paragraph, code])} />);

    expect(
      screen.getByRole("heading", { name: "Build apps" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Chinese: Use Shopify CLI.")[0])
      .toBeInTheDocument();
    expect(screen.getByText("AI translated")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        element?.textContent === "Block ID: paragraph-id"
      ),
    ).toBeInTheDocument();
    const correctionForm = screen.getByRole("form", {
      name: "Correction form for paragraph-id",
    });
    expect(correctionForm).toHaveAttribute(
      "action",
      "/api/admin/corrections",
    );
    expect(
      correctionForm.querySelector('input[name="blockId"]'),
    ).toHaveAttribute("value", "paragraph-id");
    expect(
      correctionForm.querySelector(
        'input[name="expectedSourceFingerprint"]',
      ),
    ).toHaveAttribute("value", "fingerprint");
    expect(
      correctionForm.querySelector('input[name="returnTo"]'),
    ).toHaveAttribute("value", "/docs/apps/build");
    expect(
      within(correctionForm).getByLabelText("Manual translation"),
    ).toHaveDisplayValue("Chinese: Use Shopify CLI.");
    expect(within(correctionForm).getByLabelText("Scope")).toHaveDisplayValue(
      "global",
    );
    expect(
      within(correctionForm).getByRole("button", {
        name: "保存人工修正",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Official source" }))
      .toHaveAttribute("href", "https://shopify.dev/docs/apps/build");
    expect(screen.getByText("shopify app dev")).toBeInTheDocument();
  });

  it("switches languages without changing the document URL", () => {
    window.history.pushState(null, "", "/docs/apps/build");
    const beforePath = window.location.pathname;
    const paragraph = block({
      id: "paragraph-id",
      sourceText: "Use Shopify CLI.",
      translatedText: "Chinese: Use Shopify CLI.",
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

    expect(screen.getAllByText("Chinese: Use Shopify CLI.")[0])
      .toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(window.location.pathname).toBe(beforePath);
    expect(screen.getByText("Use Shopify CLI.")).toBeVisible();
    expect(screen.getByText("shopify app dev")).toBeVisible();
  });
});
