export type GlossaryTerm = {
  sourceTerm: string;
  normalizedTerm: string;
};

export type GlossaryTermDiff = {
  activeOnlyTerms: GlossaryTerm[];
  versionOnlyTerms: GlossaryTerm[];
};

export type GlossaryBrowserItem = {
  id: string;
  version: number;
  active: boolean;
  createdAt: Date;
  terms: GlossaryTerm[];
  diff: GlossaryTermDiff;
};
