CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_pages_title_trgm_idx" ON "source_pages" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_pages_path_trgm_idx" ON "source_pages" USING gin ("path" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_blocks_source_text_trgm_idx" ON "content_blocks" USING gin ("source_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translation_revisions_translated_text_trgm_idx" ON "translation_revisions" USING gin ("translated_text" gin_trgm_ops);
