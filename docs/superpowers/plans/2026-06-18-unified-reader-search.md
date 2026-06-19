# Unified Reader Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add protected unified search across cached Shopify.dev source text, Chinese translations, titles, paths, and exact API/code identifiers.

**Architecture:** Keep search as a PostgreSQL-backed reader feature: a focused repository reads current page versions and current translation revisions, pure helpers normalize/scoring terms, and Server Components render the protected search UI. The first implementation uses deterministic SQL filtering plus application-layer scoring; dedicated PostgreSQL indexes can be added after behavior is stable and measured.

**Tech Stack:** Next.js App Router, React Server Components, Drizzle ORM, PostgreSQL, Vitest, Testing Library, Playwright.

---

## Scope

This plan implements Phase 4B search for the local cached corpus. It does not call Shopify.dev, does not call AI models, and does not introduce Elasticsearch or another search service.

The first release supports:

- Chinese query matching against current translated text.
- English query matching against original source text.
- Exact identifier/code query matching against source blocks and paths.
- One result per document with a short snippet and matched language/source reason.
- Protected `/search?q=...` UI plus a search form from the reader home page.

## File Structure

- `src/modules/search/query.ts`: normalize search input, split query terms, escape SQL `LIKE` patterns, and classify exact-code-looking terms.
- `src/modules/search/types.ts`: serializable search result and match reason types.
- `src/db/repositories/search-repository.ts`: read-only query joining active source pages, current page versions, content blocks, current block translations, and current revisions.
- `src/app/(app)/search/page.tsx`: protected Server Component route for `/search`.
- `src/app/(app)/search/search-results.tsx`: presentation component for search form, empty states, and results.
- `src/app/(app)/page.tsx`: add the same search form to the protected home page.
- `src/app/globals.css`: search form and result card styles.
- `tests/unit/search-query.test.ts`: pure query helper coverage.
- `tests/integration/search-repository.test.ts`: repository coverage with English, Chinese, and exact identifier searches.
- `tests/unit/search-results.test.tsx`: rendering coverage for search results and empty states.

## Task 1: Search Query Helpers

**Files:**
- Create: `src/modules/search/query.ts`
- Create: `src/modules/search/types.ts`
- Create: `tests/unit/search-query.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/search-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildLikePattern,
  normalizeSearchQuery,
  searchTerms,
} from "@/modules/search/query";

describe("search query helpers", () => {
  it("normalizes whitespace while preserving Chinese and API identifiers", () => {
    expect(normalizeSearchQuery("  Admin   GraphQL  ")).toBe("Admin GraphQL");
    expect(normalizeSearchQuery("  订单  webhook  ")).toBe("订单 webhook");
    expect(searchTerms("Admin GraphQL productCreate")).toEqual([
      "Admin",
      "GraphQL",
      "productCreate",
    ]);
  });

  it("escapes LIKE wildcards", () => {
    expect(buildLikePattern("products_%")).toBe("%products\\_\\%%");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/search-query.test.ts
```

Expected: FAIL because `src/modules/search/query.ts` does not exist.

- [ ] **Step 3: Implement the helpers and types**

Create `src/modules/search/query.ts`:

```ts
export function normalizeSearchQuery(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function searchTerms(input: string): string[] {
  const normalized = normalizeSearchQuery(input);
  return normalized ? normalized.split(" ") : [];
}

export function buildLikePattern(input: string): string {
  return `%${normalizeSearchQuery(input).replace(/[\\%_]/g, "\\$&")}%`;
}
```

Create `src/modules/search/types.ts`:

```ts
export type SearchMatchKind =
  | "title"
  | "path"
  | "source"
  | "translation"
  | "identifier";

export type ReaderSearchResult = {
  pageId: string;
  path: string;
  canonicalUrl: string;
  title: string | null;
  snippet: string;
  matchKind: SearchMatchKind;
  score: number;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
corepack pnpm test -- tests/unit/search-query.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/search tests/unit/search-query.test.ts
git commit -m "feat: add search query helpers"
```

## Task 2: Search Repository

**Files:**
- Create: `src/db/repositories/search-repository.ts`
- Create: `tests/integration/search-repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/search-repository.test.ts` with helpers copied from `tests/integration/reader-repository.test.ts` to publish source pages and optional current translations. Cover:

- Query `订单 webhook` finds the page whose current Chinese revision contains that text.
- Query `Admin GraphQL` finds the page whose English source contains those words.
- Query `productCreate` finds the page whose source code or prose contains that exact identifier.
- Query for a deleted or non-current page version does not return stale content.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/search-repository.test.ts
```

Expected: FAIL because `createSearchRepository` does not exist.

- [ ] **Step 3: Implement the repository**

Create `src/db/repositories/search-repository.ts` with:

- `createSearchRepository(db)`
- `searchReaderPages({ query, limit = 20 })`
- A query joining `source_pages -> page_versions -> content_blocks -> block_translations -> translation_revisions`
- Filters only `source_pages.status = 'active'` and `page_versions.id = source_pages.current_version_id`
- Uses escaped `ILIKE` patterns against `source_pages.title`, `source_pages.path`, `content_blocks.source_text`, and `translation_revisions.translated_text`
- Groups rows by page in TypeScript and keeps the highest-scoring block snippet

Scoring order:

```ts
identifier: 120
title: 100
path: 90
translation: 80
source: 70
```

- [ ] **Step 4: Run the targeted integration test**

Run the same targeted integration command.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/db/repositories/search-repository.ts tests/integration/search-repository.test.ts
git commit -m "feat: search cached reader documents"
```

## Task 3: Protected Search UI

**Files:**
- Create: `src/app/(app)/search/page.tsx`
- Create: `src/app/(app)/search/search-results.tsx`
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/search-results.test.tsx`

- [ ] **Step 1: Write failing render coverage**

Create `tests/unit/search-results.test.tsx` that renders:

- Empty query state: heading explains unified Chinese and English search.
- No results state for a non-empty query.
- Results state: title/path link points to `/docs/...`, snippet appears, and match kind label appears.

- [ ] **Step 2: Run unit test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/search-results.test.tsx
```

Expected: FAIL because `search-results.tsx` does not exist.

- [ ] **Step 3: Implement the UI**

Implement `/search?q=...` as a Server Component that calls `createSearchRepository(db).searchReaderPages({ query })`. Reuse a simple GET form with `name="q"` on both `/search` and the protected home page.

- [ ] **Step 4: Run unit tests and build**

Run:

```powershell
corepack pnpm test -- tests/unit/search-results.test.tsx
corepack pnpm typecheck
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(app)/search src/app/(app)/page.tsx src/app/globals.css tests/unit/search-results.test.tsx
git commit -m "feat: add reader search UI"
```

## Task 4: Browser Verification And Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Verify manually in browser**

Seed a cached page with one English source paragraph, one Chinese revision, and one code block. Log in, search for the Chinese phrase, the English phrase, and the identifier. Confirm all searches link to the same `/docs/**` page.

- [ ] **Step 2: Update docs**

Update README to say unified search supports Chinese translations, English source text, and exact API/code identifiers from cached pages. Update the roadmap Phase 4 status when search is verified.

- [ ] **Step 3: Run final checks**

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
$env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; $env:E2E_ADMIN_PASSWORD='phase-one-test-password'; corepack pnpm test:e2e
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md
git commit -m "docs: describe unified reader search"
```

## Self-Review

- Spec coverage: Chinese translation search, English source search, exact identifier search, protected UI, and documentation are covered. Advanced ranking/index optimization is deliberately deferred until behavior is verified.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain.
- Type consistency: `ReaderSearchResult`, `SearchMatchKind`, and `searchReaderPages` are used consistently across repository, UI, and tests.
