CREATE TYPE "public"."block_change_kind" AS ENUM('added', 'modified', 'moved', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."content_block_type" AS ENUM('heading', 'paragraph', 'list', 'table', 'notice', 'code', 'image');--> statement-breakpoint
CREATE TYPE "public"."fetch_result" AS ENUM('content', 'not_modified', 'gone', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_format" AS ENUM('text', 'html');--> statement-breakpoint
CREATE TYPE "public"."source_page_status" AS ENUM('active', 'gone', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."job_queue" AS ENUM('ingestion', 'translation');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('discover_sitemap', 'fetch_page', 'translate_block', 'cleanup_payloads');--> statement-breakpoint
CREATE TABLE "block_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_version_id" uuid NOT NULL,
	"kind" "block_change_kind" NOT NULL,
	"previous_block_id" uuid,
	"current_block_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_changes_added_shape_check" CHECK ("block_changes"."kind" <> 'added' or ("block_changes"."previous_block_id" is null and "block_changes"."current_block_id" is not null)),
	CONSTRAINT "block_changes_deleted_shape_check" CHECK ("block_changes"."kind" <> 'deleted' or ("block_changes"."previous_block_id" is not null and "block_changes"."current_block_id" is null)),
	CONSTRAINT "block_changes_modified_shape_check" CHECK ("block_changes"."kind" <> 'modified' or ("block_changes"."previous_block_id" is not null and "block_changes"."current_block_id" is not null)),
	CONSTRAINT "block_changes_moved_shape_check" CHECK ("block_changes"."kind" <> 'moved' or ("block_changes"."previous_block_id" is not null and "block_changes"."current_block_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "content_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"type" "content_block_type" NOT NULL,
	"heading_path" jsonb NOT NULL,
	"source_text" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"translatable" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"page_id" uuid,
	"requested_url" text NOT NULL,
	"final_url" text,
	"source_format" "source_format",
	"http_status" integer,
	"result" "fetch_result" NOT NULL,
	"response_bytes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"etag" text,
	"last_modified" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_format" "source_format" NOT NULL,
	"content_fingerprint" text NOT NULL,
	"block_count" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robots_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" text NOT NULL,
	"body" text NOT NULL,
	"sitemap_urls" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "robots_policies_origin_unique" UNIQUE("origin")
);
--> statement-breakpoint
CREATE TABLE "source_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text NOT NULL,
	"path" text NOT NULL,
	"title" text,
	"current_version_id" uuid,
	"etag" text,
	"last_modified" text,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_discovered_at" timestamp with time zone,
	"missing_from_sitemap_at" timestamp with time zone,
	"status" "source_page_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_pages_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
CREATE TABLE "source_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fetch_attempt_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"body" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_payloads_fetch_attempt_id_unique" UNIQUE("fetch_attempt_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" "job_queue" NOT NULL,
	"type" "job_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "block_changes" ADD CONSTRAINT "block_changes_page_version_id_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."page_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_changes" ADD CONSTRAINT "block_changes_previous_block_id_content_blocks_id_fk" FOREIGN KEY ("previous_block_id") REFERENCES "public"."content_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_changes" ADD CONSTRAINT "block_changes_current_block_id_content_blocks_id_fk" FOREIGN KEY ("current_block_id") REFERENCES "public"."content_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_page_version_id_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."page_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempts" ADD CONSTRAINT "fetch_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempts" ADD CONSTRAINT "fetch_attempts_page_id_source_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."source_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_source_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."source_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pages" ADD CONSTRAINT "source_pages_current_version_id_page_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."page_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_payloads" ADD CONSTRAINT "source_payloads_fetch_attempt_id_fetch_attempts_id_fk" FOREIGN KEY ("fetch_attempt_id") REFERENCES "public"."fetch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_blocks_version_ordinal_idx" ON "content_blocks" USING btree ("page_version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_page_version_idx" ON "page_versions" USING btree ("page_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_page_fingerprint_idx" ON "page_versions" USING btree ("page_id","content_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_idx" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","status","run_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_lease_expires_at_idx" ON "jobs" USING btree ("lease_expires_at");