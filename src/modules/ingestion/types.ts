export type SourceFormat = "text" | "html";
export type IngestionPriority = "normal" | "high";

export type DiscoveredPage = {
  canonicalUrl: string;
  lastModifiedAt?: Date;
};
