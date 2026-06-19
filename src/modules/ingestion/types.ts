export type SourceFormat = "text" | "html";
export type IngestionPriority = "normal" | "high";

export type DiscoveredPage = {
  canonicalUrl: string;
  lastModifiedAt?: Date;
};

export type BlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "notice"
  | "code"
  | "image";

export type ProtectedToken = {
  kind: "inline_code" | "url" | "file_path" | "identifier";
  value: string;
  start: number;
  end: number;
};

export type ParsedBlock = {
  type: BlockType;
  ordinal: number;
  headingPath: string[];
  sourceText: string;
  payload: Record<string, unknown>;
  translatable: boolean;
};

export type ParsedPage = {
  title: string;
  blocks: ParsedBlock[];
  sourceFormat: SourceFormat;
};

export type FingerprintedBlock = ParsedBlock & {
  contentFingerprint: string;
};

export type BlockDiff = {
  changes: Array<
    | { kind: "added"; currentIndex: number }
    | {
        kind: "modified";
        previousIndex: number;
        currentIndex: number;
      }
    | { kind: "moved"; previousIndex: number; currentIndex: number }
    | { kind: "deleted"; previousIndex: number }
  >;
  translationCandidateIndexes: number[];
};

export type ParserLimits = {
  maxBlocks: number;
  maxNestingDepth: number;
  maxBlockBytes: number;
};
