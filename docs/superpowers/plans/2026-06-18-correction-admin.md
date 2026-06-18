# Correction Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected web workflow for manually correcting translated blocks from the reader page.

**Architecture:** Reuse `TranslationAdminService.recordManualCorrection()` so web corrections share the same stale-source, translatable-block, immutable correction, and revision-publication rules as the CLI. Add a protected POST route for corrections, then render a compact correction form under each translatable reader block with hidden block ID and fingerprint.

**Tech Stack:** Next.js App Router route handlers, existing translation admin service/repositories, React reader component tests, Vitest integration tests.

---

### Task 1: Protected Manual Correction Route

**Files:**
- Create: `src/app/api/admin/corrections/route.ts`
- Create: `tests/integration/admin-correction-route.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/admin-correction-route.test.ts` that:
- creates a fixture current source page with one translatable block;
- authenticates a test admin through the existing session cookie mock;
- posts `blockId`, `translatedText`, `scope`, `expectedSourceFingerprint`, and `returnTo`;
- expects a `303` redirect to `<returnTo>?correction=updated`;
- asserts `block_translations` points to a `manually_corrected` current revision;
- asserts unauthenticated requests redirect to `/login`;
- asserts invalid blank translated text redirects to `<returnTo>?correction=invalid` without publishing a correction.

- [ ] **Step 2: Run the route test to verify it fails**

Run the full integration suite if the targeted command hits sandbox EPERM:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
```

Expected: FAIL because `@/app/api/admin/corrections/route` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/admin/corrections/route.ts` with:
- authentication via `getCurrentUser()`;
- safe relative `returnTo` parsing that accepts only `/docs/...` paths and otherwise falls back to `/admin`;
- scope parsing for `global` or `block`;
- `createTranslationAdminService(...)` wired with `createTranslationAdminStore(db)`, `createTranslationRepository(db)`, `createTranslationConfigRepository(db)`, and `createJobRepository(db)`;
- success redirect `?correction=updated`;
- invalid redirect `?correction=invalid`;
- no response body containing translated text.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
```

Commit:

```powershell
git add src/app/api/admin/corrections/route.ts tests/integration/admin-correction-route.test.ts
git commit -m "feat: record corrections from admin"
```

### Task 2: Reader Correction Forms

**Files:**
- Modify: `src/app/(app)/docs/[...slug]/reader-document.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/reader-render.test.tsx`

- [ ] **Step 1: Write the failing reader component test**

Extend `tests/unit/reader-render.test.tsx` to assert a translatable paragraph renders:
- visible `Block ID: <id>`;
- a form named `Correction form for <id>`;
- action `/api/admin/corrections`;
- hidden `blockId`, `expectedSourceFingerprint`, and `returnTo` values;
- `Manual translation` textarea defaulting to the current translated text or empty string;
- `Scope` select defaulting to `global`;
- submit button `保存人工修正`.

- [ ] **Step 2: Run the reader test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/reader-render.test.tsx
```

Expected: FAIL because correction forms are not rendered.

- [ ] **Step 3: Implement reader forms**

Render the correction form only for `block.translatable === true`. Keep code blocks unchanged. Use current document `page.path` as `returnTo`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/reader-render.test.tsx
corepack pnpm typecheck
corepack pnpm lint
```

Commit:

```powershell
git add "src/app/(app)/docs/[...slug]/reader-document.tsx" src/app/globals.css tests/unit/reader-render.test.tsx
git commit -m "feat: render correction forms"
```

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Update docs**

Document that reader blocks can be manually corrected from the web UI, and that corrections publish immutable manual revisions.

- [ ] **Step 2: Run full verification**

Run the standard lint, typecheck, unit, integration, E2E seed, E2E if available, and production build suite.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-correction-admin.md
git commit -m "docs: describe correction admin"
```

---

## Self-Review

- Spec coverage: Covers the first web translation editor increment: manual correction publication from reader blocks. Full English diff/history browsing remains a later increment.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Uses existing `blockId`, `expectedSourceFingerprint`, `translatedText`, and correction `scope` names from the admin service.
