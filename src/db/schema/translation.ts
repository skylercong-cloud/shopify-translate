import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { contentBlocks } from "./ingestion";
import { jobs } from "./jobs";
import {
  glossaryVersions,
  promptVersions,
  translationProviderEnum,
} from "./translation-config";

export const translationStatuses = [
  "pending",
  "ai_translated",
  "manually_corrected",
  "review_required",
  "failed",
  "oversized",
] as const;
export const translationRevisionSources = [
  "ai",
  "ai_memory",
  "global_manual",
  "block_manual",
] as const;
export const translationCorrectionScopes = ["global", "block"] as const;
export const tokenReservationStatuses = [
  "reserved",
  "request_started",
  "settled",
  "released",
] as const;
export const modelCallStatuses = [
  "succeeded",
  "transient_error",
  "configuration_error",
  "validation_error",
  "protocol_error",
] as const;

export const translationStatusEnum = pgEnum(
  "translation_status",
  translationStatuses,
);
export const translationRevisionSourceEnum = pgEnum(
  "translation_revision_source",
  translationRevisionSources,
);
export const translationCorrectionScopeEnum = pgEnum(
  "translation_correction_scope",
  translationCorrectionScopes,
);
export const tokenReservationStatusEnum = pgEnum(
  "token_reservation_status",
  tokenReservationStatuses,
);
export const modelCallStatusEnum = pgEnum(
  "model_call_status",
  modelCallStatuses,
);

export const modelCalls = pgTable(
  "model_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    blockId: uuid("block_id").references(() => contentBlocks.id, {
      onDelete: "set null",
    }),
    provider: translationProviderEnum("provider").notNull(),
    modelId: text("model_id").notNull(),
    promptVersionId: uuid("prompt_version_id").references(
      () => promptVersions.id,
      { onDelete: "set null" },
    ),
    glossaryVersionId: uuid("glossary_version_id").references(
      () => glossaryVersions.id,
      { onDelete: "set null" },
    ),
    callSequence: integer("call_sequence").notNull().default(1),
    status: modelCallStatusEnum("status").notNull(),
    httpStatus: integer("http_status"),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    latencyMs: integer("latency_ms"),
    requestHash: text("request_hash").notNull(),
    responseHash: text("response_hash"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("model_calls_job_idx").on(table.jobId, table.callSequence),
    index("model_calls_block_idx").on(table.blockId, table.createdAt),
    check("model_calls_sequence_check", sql`${table.callSequence} > 0`),
    check(
      "model_calls_input_tokens_check",
      sql`${table.inputTokens} is null or ${table.inputTokens} >= 0`,
    ),
    check(
      "model_calls_output_tokens_check",
      sql`${table.outputTokens} is null or ${table.outputTokens} >= 0`,
    ),
    check(
      "model_calls_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
    check(
      "model_calls_model_id_not_empty_check",
      sql`length(trim(${table.modelId})) > 0`,
    ),
    check(
      "model_calls_request_hash_not_empty_check",
      sql`length(${table.requestHash}) > 0`,
    ),
  ],
);

export const blockTranslations = pgTable(
  "block_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockId: uuid("block_id")
      .notNull()
      .unique()
      .references(() => contentBlocks.id, { onDelete: "cascade" }),
    sourceFingerprint: text("source_fingerprint").notNull(),
    status: translationStatusEnum("status").notNull().default("pending"),
    currentRevisionId: uuid("current_revision_id").references(
      (): AnyPgColumn => translationRevisions.id,
      { onDelete: "set null" },
    ),
    reviewReason: text("review_reason"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("block_translations_status_idx").on(table.status, table.updatedAt),
    check(
      "block_translations_fingerprint_not_empty_check",
      sql`length(${table.sourceFingerprint}) > 0`,
    ),
  ],
);

export const translationRevisions = pgTable(
  "translation_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockTranslationId: uuid("block_translation_id")
      .notNull()
      .references((): AnyPgColumn => blockTranslations.id, {
        onDelete: "cascade",
      }),
    source: translationRevisionSourceEnum("source").notNull(),
    translatedText: text("translated_text").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    provider: translationProviderEnum("provider"),
    modelId: text("model_id"),
    promptVersionId: uuid("prompt_version_id").references(
      () => promptVersions.id,
      { onDelete: "set null" },
    ),
    glossaryVersionId: uuid("glossary_version_id").references(
      () => glossaryVersions.id,
      { onDelete: "set null" },
    ),
    modelCallId: uuid("model_call_id").references(() => modelCalls.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("translation_revisions_memory_idx").on(
      table.sourceFingerprint,
      table.promptVersionId,
      table.glossaryVersionId,
      table.createdAt,
    ),
    index("translation_revisions_translation_idx").on(
      table.blockTranslationId,
      table.createdAt,
    ),
    check(
      "translation_revisions_text_not_empty_check",
      sql`length(trim(${table.translatedText})) > 0`,
    ),
    check(
      "translation_revisions_fingerprint_not_empty_check",
      sql`length(${table.sourceFingerprint}) > 0`,
    ),
  ],
);

export const translationCorrections = pgTable(
  "translation_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: translationCorrectionScopeEnum("scope").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    blockId: uuid("block_id").references(() => contentBlocks.id, {
      onDelete: "restrict",
    }),
    translatedText: text("translated_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("translation_corrections_global_idx").on(
      table.sourceFingerprint,
      table.createdAt,
    ),
    index("translation_corrections_block_idx").on(
      table.blockId,
      table.sourceFingerprint,
      table.createdAt,
    ),
    check(
      "translation_corrections_scope_shape_check",
      sql`(${table.scope} = 'global' and ${table.blockId} is null)
        or (${table.scope} = 'block' and ${table.blockId} is not null)`,
    ),
    check(
      "translation_corrections_fingerprint_not_empty_check",
      sql`length(${table.sourceFingerprint}) > 0`,
    ),
    check(
      "translation_corrections_text_not_empty_check",
      sql`length(trim(${table.translatedText})) > 0`,
    ),
  ],
);

export const translationUsageDays = pgTable(
  "translation_usage_days",
  {
    usageDate: date("usage_date", { mode: "string" }).primaryKey(),
    tokenLimit: bigint("token_limit", { mode: "number" }).notNull(),
    reservedTokens: bigint("reserved_tokens", { mode: "number" })
      .notNull()
      .default(0),
    chargedTokens: bigint("charged_tokens", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "translation_usage_days_limit_check",
      sql`${table.tokenLimit} > 0`,
    ),
    check(
      "translation_usage_days_reserved_check",
      sql`${table.reservedTokens} >= 0`,
    ),
    check(
      "translation_usage_days_charged_check",
      sql`${table.chargedTokens} >= 0`,
    ),
    check(
      "translation_usage_days_capacity_check",
      sql`${table.reservedTokens} + ${table.chargedTokens} <= ${table.tokenLimit}`,
    ),
  ],
);

export const tokenReservations = pgTable(
  "token_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usageDate: date("usage_date", { mode: "string" })
      .notNull()
      .references(() => translationUsageDays.usageDate, {
        onDelete: "restrict",
      }),
    jobId: uuid("job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    blockId: uuid("block_id").references(() => contentBlocks.id, {
      onDelete: "set null",
    }),
    provider: translationProviderEnum("provider").notNull(),
    status: tokenReservationStatusEnum("status")
      .notNull()
      .default("reserved"),
    reservedTokens: bigint("reserved_tokens", { mode: "number" }).notNull(),
    chargedTokens: bigint("charged_tokens", { mode: "number" })
      .notNull()
      .default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestStartedAt: timestamp("request_started_at", {
      withTimezone: true,
    }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("token_reservations_status_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    index("token_reservations_job_idx").on(table.jobId),
    check(
      "token_reservations_reserved_check",
      sql`${table.reservedTokens} > 0`,
    ),
    check(
      "token_reservations_charged_check",
      sql`${table.chargedTokens} >= 0
        and ${table.chargedTokens} <= ${table.reservedTokens}`,
    ),
  ],
);
