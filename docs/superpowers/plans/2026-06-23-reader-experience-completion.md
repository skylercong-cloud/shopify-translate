# Reader Experience Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This project is being executed inline because the user explicitly disabled subagents.

**Goal:** Complete the approved on-demand translation behavior, Scheme C focused reader, real Shopify document parsing, and styled login experience.

**Architecture:** Keep the existing PostgreSQL-backed ingestion and translation workers. Propagate an on-demand fetch priority into generated translation jobs, lazily expose the discovered document hierarchy through a navigation API, and keep the reader focused by moving correction controls out of document blocks. Normalize Shopify Markdown front matter before semantic block extraction.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL, Drizzle ORM, unified/remark, Vitest, Testing Library.

---

### Task 1: Parse real Shopify Markdown front matter

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/modules/ingestion/markdown-parser.ts`
- Modify: `tests/unit/ingestion-parser.test.ts`

- [ ] Add a parser test containing Shopify's `---` metadata envelope and assert that `title`, `description`, and `api_version` do not become content blocks.
- [ ] Run the focused parser test and verify that it fails because the metadata is selected as the page title.
- [ ] Add `remark-frontmatter`, register it before parsing, and leave YAML nodes outside the emitted content blocks.
- [ ] Run the focused parser tests and verify that the H1 becomes `GraphQL Admin API reference`.

### Task 2: Preserve high priority through translation enqueueing

**Files:**
- Modify: `src/modules/jobs/worker.ts`
- Modify: `src/modules/ingestion/ingestion-service.ts`
- Modify: `src/db/repositories/ingestion-repository.ts`
- Modify: `tests/unit/worker.test.ts`
- Modify: `tests/integration/ingestion-repository.test.ts`

- [ ] Add failing tests proving a priority-100 `fetch_page` job creates priority-100 `translate_block` jobs while background fetches still create priority-0 translations.
- [ ] Pass the claimed fetch job priority into `ingestPage` and then into `savePageVersion`.
- [ ] Map only priority-100 on-demand fetches to priority-100 translation jobs; keep discovery and daily background translations at priority 0.
- [ ] Run focused unit and integration tests.

### Task 3: Promote pending translations when a cached page is visited

**Files:**
- Create: `src/modules/reader/request-translations.ts`
- Create: `tests/unit/reader-request-translations.test.ts`
- Modify: `src/app/(app)/docs/[...slug]/page.tsx`

- [ ] Write a failing unit test proving pending and failed blocks are enqueued at priority 100, while translated, manually corrected, review-required, oversized, and code blocks are skipped.
- [ ] Implement a small reader translation-request service using the existing job repository dedupe behavior.
- [ ] Invoke it after a cached reader page is loaded so queued background jobs are promoted without waiting inside the HTTP request for a model response.
- [ ] Run focused tests.

### Task 4: Add lazy Shopify-style document navigation

**Files:**
- Create: `src/modules/reader/navigation.ts`
- Create: `src/db/repositories/navigation-repository.ts`
- Create: `src/app/api/navigation/route.ts`
- Create: `src/app/(app)/reader-navigation.tsx`
- Create: `tests/unit/reader-navigation.test.ts`
- Create: `tests/integration/navigation-repository.test.ts`
- Modify: `src/app/(app)/layout.tsx`

- [ ] Write failing unit tests for deriving immediate child folders/pages from normalized `/docs/**` paths and for stable title/path ordering.
- [ ] Write a failing integration test for loading active published pages under a requested path prefix.
- [ ] Implement a prefix repository and a validated authenticated navigation endpoint.
- [ ] Implement the Scheme C narrow rail and a lazily expanding directory drawer, highlighting the current path.
- [ ] Add a compact global search form to the application header while keeping admin links separate from the document tree.
- [ ] Run focused tests.

### Task 5: Render a focused semantic document

**Files:**
- Modify: `src/app/(app)/docs/[...slug]/reader-document.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/reader-document.test.tsx`
- Modify: `tests/unit/reader-render.test.tsx`

- [ ] Write failing tests proving the translated first heading becomes the page title, lists/tables/notices/images retain structure, and manual correction forms plus block IDs are absent from the reader.
- [ ] Render each stored block type with semantic HTML and stable heading anchors.
- [ ] Add a collapsed in-page table of contents generated from heading blocks.
- [ ] Keep concise translation status at page level and link correction work to the existing admin review page.
- [ ] Scope document H1 sizing independently from the homepage H1.
- [ ] Run focused tests.

### Task 6: Style the login page

**Files:**
- Modify: `src/app/globals.css`
- Create: `tests/unit/app-styles.test.ts`
- Modify: `tests/unit/login-form.test.tsx`

- [ ] Add a failing stylesheet contract test for `.login-page`, `.login-card`, inputs, error text, and submitting state.
- [ ] Implement a responsive centered login card consistent with the focused reader palette.
- [ ] Verify keyboard focus, disabled state, and mobile sizing in component/style tests.

### Task 7: Verify and publish

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment.md` if the re-ingestion command needs documenting.

- [ ] Update behavior documentation: cached reads, on-demand priority, background budget, focused navigation, and re-ingesting previously malformed pages.
- [ ] Run `corepack pnpm test`.
- [ ] Run `corepack pnpm typecheck`.
- [ ] Run `corepack pnpm lint`.
- [ ] Run the production build with required environment variables.
- [ ] Run `git diff --check`, review the final diff, commit scoped changes, and push `main`.
