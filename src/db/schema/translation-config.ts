import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const translationProviders = ["deepseek", "qwen"] as const;

export const translationProviderEnum = pgEnum(
  "translation_provider",
  translationProviders,
);

export const modelProviderConfigs = pgTable(
  "model_provider_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: translationProviderEnum("provider").notNull().unique(),
    baseUrl: text("base_url").notNull(),
    modelId: text("model_id").notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    keyHint: text("key_hint"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "model_provider_configs_base_url_not_empty_check",
      sql`length(trim(${table.baseUrl})) > 0`,
    ),
    check(
      "model_provider_configs_model_id_not_empty_check",
      sql`length(trim(${table.modelId})) > 0`,
    ),
    check(
      "model_provider_configs_api_key_not_empty_check",
      sql`length(${table.encryptedApiKey}) > 0`,
    ),
  ],
);

export const translationSettings = pgTable(
  "translation_settings",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    dailyTokenLimit: bigint("daily_token_limit", { mode: "number" }),
    budgetTimeZone: text("budget_time_zone")
      .notNull()
      .default("Asia/Shanghai"),
    requestTimeoutMs: integer("request_timeout_ms")
      .notNull()
      .default(60_000),
    maxInputBytes: integer("max_input_bytes")
      .notNull()
      .default(1_048_576),
    maxOutputTokens: integer("max_output_tokens").notNull().default(4_096),
    workerConcurrency: integer("worker_concurrency").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "translation_settings_singleton_check",
      sql`${table.singleton} = true`,
    ),
    check(
      "translation_settings_daily_token_limit_check",
      sql`${table.dailyTokenLimit} is null or ${table.dailyTokenLimit} > 0`,
    ),
    check(
      "translation_settings_timezone_check",
      sql`${table.budgetTimeZone} = 'Asia/Shanghai'`,
    ),
    check(
      "translation_settings_request_timeout_check",
      sql`${table.requestTimeoutMs} > 0`,
    ),
    check(
      "translation_settings_max_input_bytes_check",
      sql`${table.maxInputBytes} > 0`,
    ),
    check(
      "translation_settings_max_output_tokens_check",
      sql`${table.maxOutputTokens} > 0`,
    ),
    check(
      "translation_settings_worker_concurrency_check",
      sql`${table.workerConcurrency} > 0`,
    ),
  ],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    userPromptTemplate: text("user_prompt_template").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("prompt_versions_version_idx").on(table.version),
    uniqueIndex("prompt_versions_one_active_idx")
      .on(table.active)
      .where(sql`${table.active} = true`),
    check("prompt_versions_version_check", sql`${table.version} > 0`),
    check(
      "prompt_versions_system_prompt_not_empty_check",
      sql`length(trim(${table.systemPrompt})) > 0`,
    ),
    check(
      "prompt_versions_user_template_not_empty_check",
      sql`length(trim(${table.userPromptTemplate})) > 0`,
    ),
    check(
      "prompt_versions_fingerprint_not_empty_check",
      sql`length(${table.contentFingerprint}) > 0`,
    ),
  ],
);

export const glossaryVersions = pgTable(
  "glossary_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("glossary_versions_version_idx").on(table.version),
    uniqueIndex("glossary_versions_one_active_idx")
      .on(table.active)
      .where(sql`${table.active} = true`),
    check("glossary_versions_version_check", sql`${table.version} > 0`),
    check(
      "glossary_versions_fingerprint_not_empty_check",
      sql`length(${table.contentFingerprint}) > 0`,
    ),
  ],
);

export const glossaryTerms = pgTable(
  "glossary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    glossaryVersionId: uuid("glossary_version_id")
      .notNull()
      .references(() => glossaryVersions.id, { onDelete: "cascade" }),
    sourceTerm: text("source_term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("glossary_terms_version_normalized_idx").on(
      table.glossaryVersionId,
      table.normalizedTerm,
    ),
    check(
      "glossary_terms_source_not_empty_check",
      sql`length(trim(${table.sourceTerm})) > 0`,
    ),
    check(
      "glossary_terms_normalized_not_empty_check",
      sql`length(${table.normalizedTerm}) > 0`,
    ),
  ],
);
