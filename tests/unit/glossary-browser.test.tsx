import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GlossaryBrowser } from "@/app/(app)/admin/glossary/glossary-browser";
import type { GlossaryBrowserItem } from "@/modules/glossary/types";

function version(
  overrides: Partial<GlossaryBrowserItem> = {},
): GlossaryBrowserItem {
  return {
    id: "glossary-id",
    version: 3,
    active: true,
    createdAt: new Date("2026-06-18T08:00:00.000Z"),
    terms: [
      { sourceTerm: "Admin API", normalizedTerm: "admin api" },
      { sourceTerm: "Hydrogen", normalizedTerm: "hydrogen" },
    ],
    diff: {
      activeOnlyTerms: [],
      versionOnlyTerms: [],
    },
    ...overrides,
  };
}

describe("GlossaryBrowser", () => {
  it("renders glossary versions, terms, and active diff sections", () => {
    render(
      <GlossaryBrowser
        items={[
          version(),
          version({
            id: "old-glossary-id",
            version: 2,
            active: false,
            createdAt: new Date("2026-06-17T08:00:00.000Z"),
            terms: [
              { sourceTerm: "Admin API", normalizedTerm: "admin api" },
              { sourceTerm: "Legacy API", normalizedTerm: "legacy api" },
            ],
            diff: {
              activeOnlyTerms: [
                { sourceTerm: "Hydrogen", normalizedTerm: "hydrogen" },
              ],
              versionOnlyTerms: [
                { sourceTerm: "Legacy API", normalizedTerm: "legacy api" },
              ],
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Glossary versions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Glossary v3")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("This is the active glossary."))
      .toBeInTheDocument();
    expect(screen.getAllByText("Admin API").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Glossary v2")).toBeInTheDocument();
    expect(screen.getByText("Added in active")).toBeInTheDocument();
    expect(screen.getAllByText("Hydrogen").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Removed from active")).toBeInTheDocument();
    expect(screen.getAllByText("Legacy API").length).toBeGreaterThanOrEqual(2);
  });

  it("renders an empty state when no glossary versions exist", () => {
    render(<GlossaryBrowser items={[]} />);

    expect(screen.getByText("No glossary versions have been activated yet."))
      .toBeInTheDocument();
  });
});
