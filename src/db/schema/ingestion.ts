import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { jobs } from "./jobs";

export const sourcePageStatuses = ["active", "gone", "blocked"] as const;
export const sourceFormats = ["text", "html"] as const;
export const contentBlockTypes = [
  "heading",
  "paragraph",
  "list",
  "table",
  "notice",
  "code",
  "image",
] as const;
export const blockChangeKinds = [
  "added",
  "modified",
  "moved",
  "deleted",
] as const;
export const fetchResults = [
  "content",
  "not_modified",
  "gone",
  "failed",
] as const;

export const sourcePageStatusEnum = pgEnum(
  "source_page_status",
  sourcePageStatuses,
);
export const sourceFormatEnum = pgEnum("source_format", sourceFormats);
export const contentBlockTypeEnum = pgEnum(
  "content_block_type",
  contentBlockTypes,
);
export const blockChangeKindEnum = pgEnum(
  "block_change_kind",
  blockChangeKinds,
);
export const fetchResultEnum = pgEnum("fetch_result", fetchResults);

export const sourcePages = pgTable("source_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalUrl: text("canonical_url").notNull().unique(),
  path: text("path").notNull(),
  title: text("title"),
  currentVersionId: uuid("current_version_id").references(
    (): AnyPgColumn => pageVersions.id,
    { onDelete: "set null" },
  ),
  etag: text("etag"),
  lastModified: text("last_modified"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastDiscoveredAt: timestamp("last_discovered_at", { withTimezone: true }),
  missingFromSitemapAt: timestamp("missing_from_sitemap_at", {
    withTimezone: true,
  }),
  status: sourcePageStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const robotsPolicies = pgTable("robots_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  origin: text("origin").notNull().unique(),
  body: text("body").notNull(),
  sitemapUrls: jsonb("sitemap_urls").$type<string[]>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references((): AnyPgColumn => sourcePages.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    sourceFormat: sourceFormatEnum("source_format").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    blockCount: integer("block_count").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("page_versions_page_version_idx").on(
      table.pageId,
      table.versionNumber,
    ),
    uniqueIndex("page_versions_page_fingerprint_idx").on(
      table.pageId,
      table.contentFingerprint,
    ),
  ],
);

export const contentBlocks = pgTable(
  "content_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageVersionId: uuid("page_version_id")
      .notNull()
      .references(() => pageVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    type: contentBlockTypeEnum("type").notNull(),
    headingPath: jsonb("heading_path").$type<string[]>().notNull(),
    sourceText: text("source_text").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    translatable: boolean("translatable").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("content_blocks_version_ordinal_idx").on(
      table.pageVersionId,
      table.ordinal,
    ),
  ],
);

export const blockChanges = pgTable(
  "block_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageVersionId: uuid("page_version_id")
      .notNull()
      .references(() => pageVersions.id, { onDelete: "cascade" }),
    kind: blockChangeKindEnum("kind").notNull(),
    previousBlockId: uuid("previous_block_id").references(
      () => contentBlocks.id,
    ),
    currentBlockId: uuid("current_block_id").references(() => contentBlocks.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "block_changes_added_shape_check",
      sql`${table.kind} <> 'added' or (${table.previousBlockId} is null and ${table.currentBlockId} is not null)`,
    ),
    check(
      "block_changes_deleted_shape_check",
      sql`${table.kind} <> 'deleted' or (${table.previousBlockId} is not null and ${table.currentBlockId} is null)`,
    ),
    check(
      "block_changes_modified_shape_check",
      sql`${table.kind} <> 'modified' or (${table.previousBlockId} is not null and ${table.currentBlockId} is not null)`,
    ),
    check(
      "block_changes_moved_shape_check",
      sql`${table.kind} <> 'moved' or (${table.previousBlockId} is not null and ${table.currentBlockId} is not null)`,
    ),
  ],
);

export const fetchAttempts = pgTable("fetch_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  pageId: uuid("page_id").references(() => sourcePages.id, {
    onDelete: "set null",
  }),
  requestedUrl: text("requested_url").notNull(),
  finalUrl: text("final_url"),
  sourceFormat: sourceFormatEnum("source_format"),
  httpStatus: integer("http_status"),
  result: fetchResultEnum("result").notNull(),
  responseBytes: integer("response_bytes").notNull(),
  durationMs: integer("duration_ms").notNull(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sourcePayloads = pgTable("source_payloads", {
  id: uuid("id").primaryKey().defaultRandom(),
  fetchAttemptId: uuid("fetch_attempt_id")
    .notNull()
    .unique()
    .references(() => fetchAttempts.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  body: text("body").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
