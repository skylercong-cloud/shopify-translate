# Focused Reader Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the protected focused reader surface for cached Shopify.dev documents, including Chinese/English switching, translation status, source links, and on-demand ingestion for uncached docs paths.

**Architecture:** Keep data access in focused repositories and Server Components. Fetch persisted source blocks and current translation revisions from PostgreSQL, then pass serializable reader data into small presentation components. Keep the language switch as a narrow Client Component so the document URL and scroll position remain stable.

**Tech Stack:** Next.js App Router, React Server Components plus small Client Components, Drizzle ORM, PostgreSQL, Vitest, Playwright.

---

## Scope

This plan implements Phase 4A: the reading surface. Unified bilingual search, search indexing, Chinese tokenization, and ranking are intentionally deferred to a separate Phase 4B plan.

## File Structure

- `src/db/repositories/reader-repository.ts`: read-only queries for current source page, blocks, current translation revisions, and translation summary.
- `src/modules/reader/types.ts`: serializable reader data types shared by repository and components.
- `src/modules/reader/render-block.ts`: pure helpers for choosing Chinese/English text and rendering block-specific metadata.
- `src/app/(app)/docs/[...slug]/page.tsx`: protected document route for `/docs/**`.
- `src/app/(app)/docs/[...slug]/reader-document.tsx`: server presentation component for page chrome and block rendering.
- `src/app/(app)/docs/[...slug]/language-switch.tsx`: client language switch that preserves URL and scroll position.
- `src/app/(app)/docs/[...slug]/request-ingestion-form.tsx`: server form for uncached allowed paths.
- `src/app/(app)/docs/[...slug]/actions.ts`: server action to enqueue ingestion for a missing page.
- `tests/helpers/publish-page.ts`: shared test helper for publishing source pages and optional revisions.
- `tests/integration/reader-repository.test.ts`: repository integration coverage.
- `tests/unit/reader-render.test.tsx`: pure rendering and language fallback coverage.
- `tests/e2e/reader.spec.ts`: browser coverage for protected reader, language switch, and code block preservation.

---

## Task 1: Reader Repository

**Files:**
- Create: `src/modules/reader/types.ts`
- Create: `src/db/repositories/reader-repository.ts`
- Create: `tests/integration/reader-repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/reader-repository.test.ts` with a test that publishes a page containing a heading, paragraph with a current AI revision, and code block. Assert `loadReaderPageByPath("/docs/reader-...")` returns canonical URL, title, current version metadata, blocks in ordinal order, current translated text for the paragraph, no translated text for the code block, and summary counts.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm exec vitest run tests/integration/reader-repository.test.ts --config vitest.integration.config.ts
```

Expected: FAIL because `createReaderRepository` does not exist.

- [ ] **Step 3: Implement the minimal repository**

Create `src/modules/reader/types.ts` with exported `ReaderPage`, `ReaderBlock`, and `ReaderTranslationSummary` types. Create `src/db/repositories/reader-repository.ts` with `createReaderRepository(db)` and `loadReaderPageByPath(path)`.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run the same integration test command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/reader/types.ts src/db/repositories/reader-repository.ts tests/integration/reader-repository.test.ts
git commit -m "feat: load reader documents"
```

---

## Task 2: Server Rendered Reader Route

**Files:**
- Create: `src/modules/reader/render-block.ts`
- Create: `src/app/(app)/docs/[...slug]/page.tsx`
- Create: `src/app/(app)/docs/[...slug]/reader-document.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/reader-render.test.tsx`

- [ ] **Step 1: Write failing unit coverage**

Add tests for translated paragraph fallback, English mode source rendering, code block exact source rendering, and status badge labels.

- [ ] **Step 2: Run unit test to verify it fails**

Run:

```powershell
corepack pnpm test
```

Expected: FAIL because render helpers/components do not exist.

- [ ] **Step 3: Implement render helpers and route**

Use Server Components for data loading. The route must call `createReaderRepository(db).loadReaderPageByPath("/docs/" + slug.join("/"))`, render a not-cached state when null, and render current blocks when found.

- [ ] **Step 4: Run unit tests**

Run `corepack pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/reader src/app/(app)/docs src/app/globals.css tests/unit/reader-render.test.tsx
git commit -m "feat: render cached reader pages"
```

---

## Task 3: Client Language Switch

**Files:**
- Create: `src/app/(app)/docs/[...slug]/language-switch.tsx`
- Modify: `src/app/(app)/docs/[...slug]/reader-document.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/reader-render.test.tsx`

- [ ] **Step 1: Write failing component tests**

Assert the reader initially shows Chinese text when available, clicking English shows source text without changing `window.location.pathname`, and code blocks remain exact in both modes.

- [ ] **Step 2: Run unit test to verify it fails**

Run `corepack pnpm test`. Expected: FAIL because the switch does not exist.

- [ ] **Step 3: Implement the switch**

Use a small Client Component with `useState<"zh" | "en">("zh")`. Toggle CSS classes or `hidden` attributes without routing.

- [ ] **Step 4: Run unit tests**

Run `corepack pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(app)/docs src/app/globals.css tests/unit/reader-render.test.tsx
git commit -m "feat: switch reader languages"
```

---

## Task 4: On-Demand Ingestion for Missing Docs

**Files:**
- Create: `src/app/(app)/docs/[...slug]/actions.ts`
- Create: `src/app/(app)/docs/[...slug]/request-ingestion-form.tsx`
- Modify: `src/app/(app)/docs/[...slug]/page.tsx`
- Create: `tests/integration/reader-ingestion-action.test.ts`

- [ ] **Step 1: Write failing integration test**

Test that an allowed `/docs/**` path enqueues a high-priority ingestion job with canonical URL `https://shopify.dev/docs/...`, and a non-docs or query-bearing path is rejected.

- [ ] **Step 2: Run test to verify it fails**

Run targeted integration test. Expected: FAIL because action does not exist.

- [ ] **Step 3: Implement the action**

The server action must call existing ingestion/job services and never call translation directly.

- [ ] **Step 4: Run targeted and full integration tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(app)/docs tests/integration/reader-ingestion-action.test.ts
git commit -m "feat: request uncached reader pages"
```

---

## Task 5: Browser Verification

**Files:**
- Modify: `tests/e2e/reader.spec.ts`
- Modify: `scripts/seed-e2e-admin.ts` if reader seed data is needed

- [ ] **Step 1: Write failing E2E coverage**

Add a browser test that logs in, opens a seeded `/docs/**` page, toggles Chinese/English, verifies URL path is unchanged, and verifies a code block is identical in both modes.

- [ ] **Step 2: Run E2E to verify it fails**

Run:

```powershell
$env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; $env:E2E_ADMIN_PASSWORD='phase-one-test-password'; corepack pnpm test:e2e
```

Expected: FAIL before the route and seed are complete.

- [ ] **Step 3: Add seed support and finish browser wiring**

Seed a current source page with an AI-translated paragraph and an unchanged code block.

- [ ] **Step 4: Run E2E**

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/e2e scripts/seed-e2e-admin.ts
git commit -m "test: verify focused reader"
```

---

## Task 6: Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md` if status tracking is updated

- [ ] **Step 1: Document the reader route**

Add a short README section explaining `/docs/**`, Chinese/English toggle, official source links, and uncached-page request behavior.

- [ ] **Step 2: Run final checks**

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
$env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; $env:E2E_ADMIN_PASSWORD='phase-one-test-password'; corepack pnpm test:e2e
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

- [ ] **Step 3: Commit**

```powershell
git add README.md docs
git commit -m "docs: describe focused reader"
```
