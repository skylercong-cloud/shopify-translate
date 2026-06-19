import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranslationReviewPanel } from "@/app/(app)/admin/review/translation-review";
import type { TranslationReviewItem } from "@/modules/review/types";

function item(
  overrides: Partial<TranslationReviewItem> = {},
): TranslationReviewItem {
  return {
    blockId: "block-id",
    pagePath: "/docs/apps/build",
    pageTitle: "Build apps",
    ordinal: 1,
    blockType: "paragraph",
    headingPath: ["Build apps", "Create an app"],
    sourceText: "Use Shopify CLI with shopify app dev.",
    sourceFingerprint: "fingerprint",
    status: "ai_translated",
    translatedText: "使用 Shopify CLI 和 shopify app dev。",
    currentRevisionSource: "ai",
    revisionCreatedAt: new Date("2026-06-18T08:00:00.000Z"),
    updatedAt: new Date("2026-06-18T08:05:00.000Z"),
    ...overrides,
  };
}

describe("TranslationReviewPanel", () => {
  it("renders source and translation side by side with correction forms", () => {
    render(
      <TranslationReviewPanel
        items={[
          item(),
          item({
            blockId: "pending-block-id",
            ordinal: 2,
            sourceText: "Configure checkout extensions.",
            sourceFingerprint: "pending-fingerprint",
            status: "pending",
            translatedText: null,
            currentRevisionSource: null,
            revisionCreatedAt: null,
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Translation review" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Build apps" })[0],
    ).toHaveAttribute("href", "/docs/apps/build");
    expect(
      screen.getByText("Use Shopify CLI with shopify app dev."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("使用 Shopify CLI 和 shopify app dev。").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Configure checkout extensions."))
      .toBeInTheDocument();
    expect(screen.getByText("No translation yet")).toBeInTheDocument();

    const correctionForm = screen.getByRole("form", {
      name: "Correction form for block-id",
    });
    expect(correctionForm).toHaveAttribute(
      "action",
      "/api/admin/corrections",
    );
    expect(
      correctionForm.querySelector('input[name="blockId"]'),
    ).toHaveAttribute("value", "block-id");
    expect(
      correctionForm.querySelector(
        'input[name="expectedSourceFingerprint"]',
      ),
    ).toHaveAttribute("value", "fingerprint");
    expect(
      correctionForm.querySelector('input[name="returnTo"]'),
    ).toHaveAttribute("value", "/admin/review");
    expect(
      within(correctionForm).getByLabelText("Manual translation"),
    ).toHaveDisplayValue("使用 Shopify CLI 和 shopify app dev。");
    expect(within(correctionForm).getByLabelText("Scope")).toHaveDisplayValue(
      "block",
    );
  });

  it("renders an empty state when there are no reviewable blocks", () => {
    render(<TranslationReviewPanel items={[]} />);

    expect(screen.getByText("No translatable blocks cached yet."))
      .toBeInTheDocument();
  });
});
