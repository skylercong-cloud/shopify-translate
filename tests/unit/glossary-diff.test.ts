import { describe, expect, it } from "vitest";

import { compareGlossaryTerms } from "@/modules/glossary/diff";
import type { GlossaryTerm } from "@/modules/glossary/types";

function term(sourceTerm: string, normalizedTerm = sourceTerm.toLowerCase()) {
  return { sourceTerm, normalizedTerm } satisfies GlossaryTerm;
}

describe("compareGlossaryTerms", () => {
  it("reports active-only and version-only terms by normalized identity", () => {
    const diff = compareGlossaryTerms(
      [
        term("Admin API", "admin api"),
        term("Shopify CLI", "shopify cli"),
        term("Removed Term", "removed term"),
      ],
      [
        term("admin api", "admin api"),
        term("Shopify CLI", "shopify cli"),
        term("Hydrogen", "hydrogen"),
      ],
    );

    expect(diff.activeOnlyTerms).toEqual([term("Hydrogen", "hydrogen")]);
    expect(diff.versionOnlyTerms).toEqual([
      term("Removed Term", "removed term"),
    ]);
  });

  it("does not report changes when only display casing differs", () => {
    const diff = compareGlossaryTerms(
      [term("Admin API", "admin api")],
      [term("admin api", "admin api")],
    );

    expect(diff.activeOnlyTerms).toEqual([]);
    expect(diff.versionOnlyTerms).toEqual([]);
  });
});
