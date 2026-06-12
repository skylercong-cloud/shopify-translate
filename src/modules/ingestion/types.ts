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

export type ParserLimits = {
  maxBlocks: number;
  maxNestingDepth: number;
  maxBlockBytes: number;
};
