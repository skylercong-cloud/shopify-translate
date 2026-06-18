export type SearchMatchKind =
  | "title"
  | "path"
  | "source"
  | "translation"
  | "identifier";

export type ReaderSearchResult = {
  pageId: string;
  path: string;
  canonicalUrl: string;
  title: string | null;
  snippet: string;
  matchKind: SearchMatchKind;
  score: number;
};
