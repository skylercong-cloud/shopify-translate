import type { GlossaryTerm, GlossaryTermDiff } from "./types";

function termsMissingFrom(
  terms: GlossaryTerm[],
  reference: GlossaryTerm[],
): GlossaryTerm[] {
  const referenceKeys = new Set(
    reference.map((term) => term.normalizedTerm),
  );

  return terms.filter((term) => !referenceKeys.has(term.normalizedTerm));
}

export function compareGlossaryTerms(
  versionTerms: GlossaryTerm[],
  activeTerms: GlossaryTerm[],
): GlossaryTermDiff {
  return {
    activeOnlyTerms: termsMissingFrom(activeTerms, versionTerms),
    versionOnlyTerms: termsMissingFrom(versionTerms, activeTerms),
  };
}
