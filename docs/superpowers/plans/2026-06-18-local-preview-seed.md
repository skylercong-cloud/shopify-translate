# Local Preview Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable local preview seed command that inserts demo Shopify.dev pages, Chinese translations, and search-ready content into PostgreSQL.

**Architecture:** Keep demo page content in a small data module, keep the seed workflow in an injectable TypeScript module, and keep the CLI script thin. The workflow reuses the existing ingestion parser/fingerprint/diff pipeline and translation repository so the seeded content exercises the same reader/search paths as real crawled content.

**Tech Stack:** TypeScript, Drizzle-backed repository interfaces, existing ingestion and translation modules, Vitest unit tests, package scripts.

---

## File Structure

- Create `src/modules/preview/local-preview-data.ts`: deterministic demo pages and translations.
- Create `src/modules/preview/local-preview-seed.ts`: parse, publish, and translate demo pages using injected repositories.
- Create `scripts/seed-local-preview.ts`: real database entrypoint.
- Create `tests/unit/local-preview-seed.test.ts`: unit tests for seed orchestration with fake repositories.
- Modify `tests/unit/scaffold-config.test.ts`: assert the package script exists.
- Modify `package.json`: add `preview:seed`.
- Modify `README.md`: document local preview setup.
- Modify this plan file as tasks complete.

### Task 1: Preview Seed Module

**Files:**
- Create: `src/modules/preview/local-preview-data.ts`
- Create: `src/modules/preview/local-preview-seed.ts`
- Create: `tests/unit/local-preview-seed.test.ts`

- [x] **Step 1: Write failing seed module tests**

Create a unit test that calls `seedLocalPreview()` with fake repositories and asserts:
- both demo pages are passed through `upsertDiscoveredPages()`;
- `publishParsedPage()` receives parsed pages titled `Build apps` and `Admin GraphQL API`;
- only translated, translatable source blocks call `publishRevision()`;
- code block source such as `shopify app dev` is not translated;
- the returned summary includes `/docs/apps/build` and `/docs/api/admin-graphql`.

- [x] **Step 2: Run tests to verify failure**

Run:

```powershell
corepack pnpm test -- tests/unit/local-preview-seed.test.ts
```

Expected: FAIL because `@/modules/preview/local-preview-seed` does not exist.

- [x] **Step 3: Implement preview data and seed workflow**

Implement:
- `LOCAL_PREVIEW_PAGES` with two canonical Shopify.dev URLs and fixed Markdown bodies.
- `seedLocalPreview({ ingestionRepository, translationRepository, loadBlocksForVersion, now, pages })`.
- Parse Markdown with `parseSourcePage({ sourceFormat: "text" })`.
- Fingerprint blocks with `fingerprintBlock()` and `fingerprintPage()`.
- Diff current blocks against the new parsed blocks with `diffBlocks()`.
- Publish each page through `publishParsedPage()`.
- Load inserted blocks and publish configured Chinese translations through `publishRevision()`.

- [x] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/local-preview-seed.test.ts
corepack pnpm typecheck
corepack pnpm lint
git add src/modules/preview/local-preview-data.ts src/modules/preview/local-preview-seed.ts tests/unit/local-preview-seed.test.ts
git commit -m "feat: add local preview seed workflow"
```

### Task 2: Preview Seed CLI

**Files:**
- Create: `scripts/seed-local-preview.ts`
- Modify: `package.json`
- Modify: `tests/unit/scaffold-config.test.ts`

- [ ] **Step 1: Write failing script/config test**

Extend `tests/unit/scaffold-config.test.ts` to assert:

```json
"preview:seed": "tsx scripts/seed-local-preview.ts"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm test -- tests/unit/scaffold-config.test.ts
```

Expected: FAIL because the package script is absent.

- [ ] **Step 3: Implement CLI and package script**

Create `scripts/seed-local-preview.ts` that:
- imports `db` and `pool`;
- wires `createIngestionRepository(db)`, `createTranslationRepository(db)`, and a `loadBlocksForVersion(versionId)` query;
- calls `seedLocalPreview({ now: new Date(), ... })`;
- prints the seeded paths and translation count;
- closes `pool` in a `finally` block.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/scaffold-config.test.ts tests/unit/local-preview-seed.test.ts
corepack pnpm typecheck
corepack pnpm lint
git add scripts/seed-local-preview.ts package.json tests/unit/scaffold-config.test.ts
git commit -m "feat: add local preview seed command"
```

### Task 3: Local Preview Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-18-local-preview-seed.md`

- [ ] **Step 1: Update docs**

Document:
- run `corepack pnpm db:migrate`;
- run `corepack pnpm preview:seed`;
- visit `/docs/apps/build`, `/docs/api/admin-graphql`, and `/search?q=Shopify CLI`.

- [ ] **Step 2: Run available verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Run integration/E2E only if the current sandbox permits Node to start without the known `EPERM: operation not permitted, lstat 'C:\Users\admin'` blocker.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/superpowers/plans/2026-06-18-local-preview-seed.md
git commit -m "docs: describe local preview seed"
```

---

## Self-Review

- Spec coverage: This plan directly addresses the local preview gap by adding repeatable demo content and a documented command.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: `seedLocalPreview`, `LOCAL_PREVIEW_PAGES`, and `preview:seed` are named consistently across tasks.
