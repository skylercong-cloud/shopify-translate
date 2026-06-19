# Search Index Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL search indexes and cap search candidate rows so cached bilingual search remains practical as the Shopify.dev corpus grows.

**Architecture:** Keep the existing unified search behavior and application-layer scoring. Add a raw SQL migration for `pg_trgm` GIN indexes over page title/path, source block text, and current translation text, then limit SQL candidates before page-level de-duplication.

**Tech Stack:** PostgreSQL `pg_trgm`, Drizzle migrations, TypeScript, Vitest.

---

## File Structure

- Create `drizzle/0003_search_indexes.sql`: extension and indexes.
- Modify `drizzle/meta/_journal.json`: register migration.
- Modify `src/db/repositories/search-repository.ts`: add candidate-limit helper and SQL `limit`.
- Create `tests/unit/search-index-migration.test.ts`: assert migration content.
- Create or modify `tests/unit/search-repository-candidates.test.ts`: assert candidate limit behavior.
- Update README and roadmap.

## Task 1: Migration Guard Test

**Files:**
- Create `tests/unit/search-index-migration.test.ts`

- [x] **Step 1: Write failing migration test**

Assert `drizzle/0003_search_indexes.sql` contains:

- `create extension if not exists pg_trgm`;
- a GIN trigram index on `source_pages.title`;
- a GIN trigram index on `source_pages.path`;
- a GIN trigram index on `content_blocks.source_text`;
- a GIN trigram index on `translation_revisions.translated_text`.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
corepack pnpm test
```

Expected: FAIL because the migration file does not exist.

- [x] **Step 3: Add migration and journal entry**

Create `drizzle/0003_search_indexes.sql` with `--> statement-breakpoint` separators and register it in `drizzle/meta/_journal.json`.

- [x] **Step 4: Run unit tests**

Run:

```powershell
corepack pnpm test
```

Expected: PASS.

Note: `corepack pnpm test` passed on June 19, 2026 with 48 files and 300 tests after the search index migration was added.

## Task 2: Candidate Limit

**Files:**
- Modify `src/db/repositories/search-repository.ts`
- Create `tests/unit/search-repository-candidates.test.ts`

- [x] **Step 1: Write failing helper test**

Assert `candidateLimitForSearchLimit(20) === 500`, `candidateLimitForSearchLimit(1) === 50`, and `candidateLimitForSearchLimit(0) === 0`.

- [x] **Step 2: Implement helper and SQL limit**

Export `candidateLimitForSearchLimit(limit)` and apply it to the repository query before de-duplicating by page.

- [x] **Step 3: Run unit tests**

Run:

```powershell
corepack pnpm test
```

Expected: PASS.

Note: `corepack pnpm test` passed on June 19, 2026 with 49 files and 301 tests after bounded search candidates were added.

## Task 3: Documentation, Verification, Commit

**Files:**
- Modify `README.md`
- Modify `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify this plan.

- [x] **Step 1: Document indexed search**

Mention PostgreSQL trigram indexes and bounded candidate rows in search documentation. Mark the roadmap follow-up as implemented at the index/candidate level.

- [x] **Step 2: Run verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Expected: PASS.

- [x] **Step 3: Run production build**

Run:

```powershell
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```powershell
git add drizzle/0003_search_indexes.sql drizzle/meta/_journal.json src/db/repositories/search-repository.ts tests/unit/search-index-migration.test.ts tests/unit/search-repository-candidates.test.ts README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-19-search-index-optimization.md
git commit -m "feat: add indexed search candidates"
```

## Self-Review

- Spec coverage: Adds PostgreSQL trigram indexes and bounded candidates while keeping existing bilingual search behavior.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Candidate helper remains numeric and repository still returns `ReaderSearchResult[]`.
- Verification note: `git diff --check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and production `corepack pnpm build` passed on June 19, 2026. Build completed without the previous Turbopack root warning.
