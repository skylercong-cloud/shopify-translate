# Translation Review Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected `/admin/review` workbench that shows English source and current Chinese translation side by side, with a manual correction form for each translatable block.

**Architecture:** Keep the review workbench read-only except for posting to the existing manual-correction endpoint. A new review repository loads current-page translatable blocks with their current translation revision, and a server-rendered admin page displays the side-by-side review cards.

**Tech Stack:** Next.js App Router, React Server Components, Drizzle ORM, TypeScript, Testing Library, Vitest.

---

## File Structure

- Create `src/modules/review/types.ts`: review item/page types.
- Create `src/db/repositories/translation-review-repository.ts`: current-block review query.
- Create `src/modules/translation/correction-return.ts`: safe return path normalization shared by correction routes.
- Modify `src/app/api/admin/corrections/route.ts`: allow `/admin/review` as a correction return path.
- Create `src/app/(app)/admin/review/page.tsx`: load review data.
- Create `src/app/(app)/admin/review/translation-review.tsx`: render review workbench.
- Modify `src/app/(app)/layout.tsx`: add a compact nav link to the review workbench.
- Modify `src/app/globals.css`: style the review cards and side-by-side panes.
- Create `tests/unit/translation-review.test.tsx`: render review cards and forms.
- Create `tests/unit/correction-return.test.ts`: verify safe return path rules.
- Update README and roadmap.

## Task 1: Failing Review UI Test

**Files:**
- Create `tests/unit/translation-review.test.tsx`

- [x] **Step 1: Write failing render test**

Assert that `TranslationReviewPanel` renders:

- heading `Translation review`;
- page link `/docs/apps/build`;
- English source text;
- current Chinese translation;
- an empty-state message for untranslated blocks;
- correction forms posting to `/api/admin/corrections` with `returnTo=/admin/review`.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/translation-review.test.tsx
```

Expected: FAIL because the component does not exist.

## Task 2: Return Path Safety

**Files:**
- Create `src/modules/translation/correction-return.ts`
- Modify `src/app/api/admin/corrections/route.ts`
- Create `tests/unit/correction-return.test.ts`

- [x] **Step 1: Write failing return-path tests**

Assert that:

- `/docs/apps/build` is accepted;
- `/admin/review` is accepted;
- external URLs and unrelated app paths fall back to `/admin`.

- [x] **Step 2: Implement shared normalizer**

Export `normalizeCorrectionReturnTo(value: string): string` and use it in the correction route before appending `correction=updated|invalid`.

- [x] **Step 3: Run focused tests**

Run:

```powershell
corepack pnpm test -- tests/unit/correction-return.test.ts
```

Expected: PASS.

Note: `corepack pnpm test` passed on June 18, 2026 with 45 files and 294 tests after the new return-path and review UI tests were added.

## Task 3: Review Data And Page

**Files:**
- Create `src/modules/review/types.ts`
- Create `src/db/repositories/translation-review-repository.ts`
- Create `src/app/(app)/admin/review/page.tsx`
- Create `src/app/(app)/admin/review/translation-review.tsx`
- Modify `src/app/(app)/layout.tsx`
- Modify `src/app/globals.css`

- [x] **Step 1: Implement review repository**

Load current-page translatable blocks by joining `source_pages`, `page_versions`, `content_blocks`, `block_translations`, and `translation_revisions`. Use the current content-block fingerprint for the correction form, order review-required/failed/pending rows before AI/manual rows, and limit to 50 rows.

- [x] **Step 2: Implement review page and UI**

Render side-by-side source/translation panes, status metadata, a reader-page link, and a manual correction form per block.

- [x] **Step 3: Run focused UI test**

Run:

```powershell
corepack pnpm test -- tests/unit/translation-review.test.tsx tests/unit/correction-return.test.ts
```

Expected: PASS.

Note: `corepack pnpm typecheck` and `corepack pnpm test` passed on June 18, 2026 after the repository, route, navigation entry, and review UI were connected.

## Task 4: Documentation, Verification, Commit

**Files:**
- Modify `README.md`
- Modify `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify this plan.

- [x] **Step 1: Document review workbench**

Mention `/admin/review` in the operations/admin documentation and mark the side-by-side review browser as implemented in the roadmap.

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

Expected: PASS. The known Next.js multiple-lockfile warning may appear.

- [x] **Step 4: Commit**

Run:

```powershell
git add src/modules/review/types.ts src/db/repositories/translation-review-repository.ts src/modules/translation/correction-return.ts src/app/api/admin/corrections/route.ts src/app/(app)/admin/review/page.tsx src/app/(app)/admin/review/translation-review.tsx src/app/(app)/layout.tsx src/app/globals.css tests/unit/translation-review.test.tsx tests/unit/correction-return.test.ts README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-translation-review-workbench.md
git commit -m "feat: add translation review workbench"
```

## Self-Review

- Spec coverage: Adds a protected side-by-side translation review browser with manual correction entry points. It does not implement advanced word-level diffs.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Review types flow from repository to server component to form rendering.
- Verification note: `git diff --check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and production `corepack pnpm build` passed on June 18, 2026. Build includes `/admin/review` and still reports the known Next.js multiple-lockfile workspace-root warning.
