CREATE TYPE "public"."translation_provider" AS ENUM('deepseek', 'qwen');--> statement-breakpoint
CREATE TYPE "public"."model_call_status" AS ENUM('succeeded', 'transient_error', 'configuration_error', 'validation_error', 'protocol_error');--> statement-breakpoint
CREATE TYPE "public"."token_reservation_status" AS ENUM('reserved', 'request_started', 'settled', 'released');--> statement-breakpoint
CREATE TYPE "public"."translation_correction_scope" AS ENUM('global', 'block');--> statement-breakpoint
CREATE TYPE "public"."translation_revision_source" AS ENUM('ai', 'ai_memory', 'global_manual', 'block_manual');--> statement-breakpoint
CREATE TYPE "public"."translation_status" AS ENUM('pending', 'ai_translated', 'manually_corrected', 'review_required', 'failed', 'oversized');--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"glossary_version_id" uuid NOT NULL,
	"source_term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "glossary_terms_source_not_empty_check" CHECK (length(trim("glossary_terms"."source_term")) > 0),
	CONSTRAINT "glossary_terms_normalized_not_empty_check" CHECK (length("glossary_terms"."normalized_term") > 0)
);
--> statement-breakpoint
CREATE TABLE "glossary_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"content_fingerprint" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "glossary_versions_version_check" CHECK ("glossary_versions"."version" > 0),
	CONSTRAINT "glossary_versions_fingerprint_not_empty_check" CHECK (length("glossary_versions"."content_fingerprint") > 0)
);
--> statement-breakpoint
CREATE TABLE "model_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "translation_provider" NOT NULL,
	"base_url" text NOT NULL,
	"model_id" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"key_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_configs_provider_unique" UNIQUE("provider"),
	CONSTRAINT "model_provider_configs_base_url_not_empty_check" CHECK (length(trim("model_provider_configs"."base_url")) > 0),
	CONSTRAINT "model_provider_configs_model_id_not_empty_check" CHECK (length(trim("model_provider_configs"."model_id")) > 0),
	CONSTRAINT "model_provider_configs_api_key_not_empty_check" CHECK (length("model_provider_configs"."encrypted_api_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_version_check" CHECK ("prompt_versions"."version" > 0),
	CONSTRAINT "prompt_versions_system_prompt_not_empty_check" CHECK (length(trim("prompt_versions"."system_prompt")) > 0),
	CONSTRAINT "prompt_versions_user_template_not_empty_check" CHECK (length(trim("prompt_versions"."user_prompt_template")) > 0),
	CONSTRAINT "prompt_versions_fingerprint_not_empty_check" CHECK (length("prompt_versions"."content_fingerprint") > 0)
);
--> statement-breakpoint
CREATE TABLE "translation_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"daily_token_limit" bigint,
	"budget_time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"request_timeout_ms" integer DEFAULT 60000 NOT NULL,
	"max_input_bytes" integer DEFAULT 1048576 NOT NULL,
	"max_output_tokens" integer DEFAULT 4096 NOT NULL,
	"worker_concurrency" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_settings_singleton_check" CHECK ("translation_settings"."singleton" = true),
	CONSTRAINT "translation_settings_daily_token_limit_check" CHECK ("translation_settings"."daily_token_limit" is null or "translation_settings"."daily_token_limit" > 0),
	CONSTRAINT "translation_settings_timezone_check" CHECK ("translation_settings"."budget_time_zone" = 'Asia/Shanghai'),
	CONSTRAINT "translation_settings_request_timeout_check" CHECK ("translation_settings"."request_timeout_ms" > 0),
	CONSTRAINT "translation_settings_max_input_bytes_check" CHECK ("translation_settings"."max_input_bytes" > 0),
	CONSTRAINT "translation_settings_max_output_tokens_check" CHECK ("translation_settings"."max_output_tokens" > 0),
	CONSTRAINT "translation_settings_worker_concurrency_check" CHECK ("translation_settings"."worker_concurrency" > 0)
);
--> statement-breakpoint
CREATE TABLE "block_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"source_fingerprint" text NOT NULL,
	"status" "translation_status" DEFAULT 'pending' NOT NULL,
	"current_revision_id" uuid,
	"review_reason" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_translations_block_id_unique" UNIQUE("block_id"),
	CONSTRAINT "block_translations_fingerprint_not_empty_check" CHECK (length("block_translations"."source_fingerprint") > 0)
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"block_id" uuid,
	"provider" "translation_provider" NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version_id" uuid,
	"glossary_version_id" uuid,
	"call_sequence" integer DEFAULT 1 NOT NULL,
	"status" "model_call_status" NOT NULL,
	"http_status" integer,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"latency_ms" integer,
	"request_hash" text NOT NULL,
	"response_hash" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "model_calls_sequence_check" CHECK ("model_calls"."call_sequence" > 0),
	CONSTRAINT "model_calls_input_tokens_check" CHECK ("model_calls"."input_tokens" is null or "model_calls"."input_tokens" >= 0),
	CONSTRAINT "model_calls_output_tokens_check" CHECK ("model_calls"."output_tokens" is null or "model_calls"."output_tokens" >= 0),
	CONSTRAINT "model_calls_latency_check" CHECK ("model_calls"."latency_ms" is null or "model_calls"."latency_ms" >= 0),
	CONSTRAINT "model_calls_model_id_not_empty_check" CHECK (length(trim("model_calls"."model_id")) > 0),
	CONSTRAINT "model_calls_request_hash_not_empty_check" CHECK (length("model_calls"."request_hash") > 0)
);
--> statement-breakpoint
CREATE TABLE "token_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_date" date NOT NULL,
	"job_id" uuid,
	"block_id" uuid,
	"provider" "translation_provider" NOT NULL,
	"status" "token_reservation_status" DEFAULT 'reserved' NOT NULL,
	"reserved_tokens" bigint NOT NULL,
	"charged_tokens" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "token_reservations_reserved_check" CHECK ("token_reservations"."reserved_tokens" > 0),
	CONSTRAINT "token_reservations_charged_check" CHECK ("token_reservations"."charged_tokens" >= 0
        and "token_reservations"."charged_tokens" <= "token_reservations"."reserved_tokens")
);
--> statement-breakpoint
CREATE TABLE "translation_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "translation_correction_scope" NOT NULL,
	"source_fingerprint" text NOT NULL,
	"block_id" uuid,
	"translated_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_corrections_scope_shape_check" CHECK (("translation_corrections"."scope" = 'global' and "translation_corrections"."block_id" is null)
        or ("translation_corrections"."scope" = 'block' and "translation_corrections"."block_id" is not null)),
	CONSTRAINT "translation_corrections_fingerprint_not_empty_check" CHECK (length("translation_corrections"."source_fingerprint") > 0),
	CONSTRAINT "translation_corrections_text_not_empty_check" CHECK (length(trim("translation_corrections"."translated_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "translation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_translation_id" uuid NOT NULL,
	"source" "translation_revision_source" NOT NULL,
	"translated_text" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"provider" "translation_provider",
	"model_id" text,
	"prompt_version_id" uuid,
	"glossary_version_id" uuid,
	"model_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_revisions_text_not_empty_check" CHECK (length(trim("translation_revisions"."translated_text")) > 0),
	CONSTRAINT "translation_revisions_fingerprint_not_empty_check" CHECK (length("translation_revisions"."source_fingerprint") > 0)
);
--> statement-breakpoint
CREATE TABLE "translation_usage_days" (
	"usage_date" date PRIMARY KEY NOT NULL,
	"token_limit" bigint NOT NULL,
	"reserved_tokens" bigint DEFAULT 0 NOT NULL,
	"charged_tokens" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_usage_days_limit_check" CHECK ("translation_usage_days"."token_limit" > 0),
	CONSTRAINT "translation_usage_days_reserved_check" CHECK ("translation_usage_days"."reserved_tokens" >= 0),
	CONSTRAINT "translation_usage_days_charged_check" CHECK ("translation_usage_days"."charged_tokens" >= 0),
	CONSTRAINT "translation_usage_days_capacity_check" CHECK ("translation_usage_days"."reserved_tokens" + "translation_usage_days"."charged_tokens" <= "translation_usage_days"."token_limit")
);
--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_glossary_version_id_glossary_versions_id_fk" FOREIGN KEY ("glossary_version_id") REFERENCES "public"."glossary_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_translations" ADD CONSTRAINT "block_translations_block_id_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."content_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_translations" ADD CONSTRAINT "block_translations_current_revision_id_translation_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."translation_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_block_id_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."content_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_glossary_version_id_glossary_versions_id_fk" FOREIGN KEY ("glossary_version_id") REFERENCES "public"."glossary_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_reservations" ADD CONSTRAINT "token_reservations_usage_date_translation_usage_days_usage_date_fk" FOREIGN KEY ("usage_date") REFERENCES "public"."translation_usage_days"("usage_date") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_reservations" ADD CONSTRAINT "token_reservations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_reservations" ADD CONSTRAINT "token_reservations_block_id_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."content_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_corrections" ADD CONSTRAINT "translation_corrections_block_id_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."content_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_revisions" ADD CONSTRAINT "translation_revisions_block_translation_id_block_translations_id_fk" FOREIGN KEY ("block_translation_id") REFERENCES "public"."block_translations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_revisions" ADD CONSTRAINT "translation_revisions_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_revisions" ADD CONSTRAINT "translation_revisions_glossary_version_id_glossary_versions_id_fk" FOREIGN KEY ("glossary_version_id") REFERENCES "public"."glossary_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_revisions" ADD CONSTRAINT "translation_revisions_model_call_id_model_calls_id_fk" FOREIGN KEY ("model_call_id") REFERENCES "public"."model_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_terms_version_normalized_idx" ON "glossary_terms" USING btree ("glossary_version_id","normalized_term");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_versions_version_idx" ON "glossary_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_versions_one_active_idx" ON "glossary_versions" USING btree ("active") WHERE "glossary_versions"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_version_idx" ON "prompt_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_one_active_idx" ON "prompt_versions" USING btree ("active") WHERE "prompt_versions"."active" = true;--> statement-breakpoint
CREATE INDEX "block_translations_status_idx" ON "block_translations" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "model_calls_job_idx" ON "model_calls" USING btree ("job_id","call_sequence");--> statement-breakpoint
CREATE INDEX "model_calls_block_idx" ON "model_calls" USING btree ("block_id","created_at");--> statement-breakpoint
CREATE INDEX "token_reservations_status_expiry_idx" ON "token_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "token_reservations_job_idx" ON "token_reservations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "translation_corrections_global_idx" ON "translation_corrections" USING btree ("source_fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "translation_corrections_block_idx" ON "translation_corrections" USING btree ("block_id","source_fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "translation_revisions_memory_idx" ON "translation_revisions" USING btree ("source_fingerprint","prompt_version_id","glossary_version_id","created_at");--> statement-breakpoint
CREATE INDEX "translation_revisions_translation_idx" ON "translation_revisions" USING btree ("block_translation_id","created_at");--> statement-breakpoint
INSERT INTO "translation_settings" ("singleton")
VALUES (true)
ON CONFLICT ("singleton") DO NOTHING;--> statement-breakpoint
INSERT INTO "block_translations" ("block_id", "source_fingerprint", "status")
SELECT "id", "fingerprint", 'pending'
FROM "content_blocks"
WHERE "translatable" = true
ON CONFLICT ("block_id") DO NOTHING;
