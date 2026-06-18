# Reader Translation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show immutable translation revision history directly on cached reader pages so manual corrections and AI outputs are auditable without a separate admin route.

**Architecture:** Extend reader data types with a per-block `revisionHistory` array. Load revision history in `createReaderRepository()` for the current page blocks, then render it in `ReaderDocument` below the correction form. Keep this to a compact history list; full side-by-side diff remains a later enhancement.

**Tech Stack:** TypeScript, Drizzle ORM, React Server Components, Testing Library, Vitest.

---

## File Structure

- Create `tests/unit/reader-document.test.tsx`: component rendering test for revision history.
- Modify `src/modules/reader/types.ts`: add `ReaderRevisionHistoryItem` and `ReaderBlock.revisionHistory`.
- Modify `src/db/repositories/reader-repository.ts`: load revisions for current page block translations.
- Modify `src/app/(app)/docs/[...slug]/reader-document.tsx`: render history details.
- Modify `src/app/globals.css`: compact history styling.
- Modify README/roadmap after implementation.
- Modify this plan as tasks complete.

## Task 1: Failing History Render Test

**Files:**
- Create: `tests/unit/reader-document.test.tsx`

- [x] **Step 1: Write failing component test**

The test should render a `ReaderDocument` with one translatable paragraph and two history entries:

- current `block_manual` revision;
- previous `ai` revision from DeepSeek.

It should assert:

- `Translation history (2)` is visible;
- current revision is marked `Current`;
- source labels, provider/model metadata, timestamps, and translated text render;
- code/source English remains unaffected.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/reader-document.test.tsx
```

Expected: FAIL because reader types and UI do not expose history yet.

## Task 2: Reader Data Model And Repository

**Files:**
- Modify: `src/modules/reader/types.ts`
- Modify: `src/db/repositories/reader-repository.ts`

- [x] **Step 1: Add reader history types**

Add:

```typescript
export type ReaderRevisionHistoryItem = {
  id: string;
  source: ReaderRevisionSource;
  translatedText: string;
  provider: TranslationProvider | null;
  modelId: string | null;
  promptVersionId: string | null;
  glossaryVersionId: string | null;
  modelCallId: string | null;
  sourceFingerprint: string;
  createdAt: Date;
  current: boolean;
};
```

- [x] **Step 2: Load revisions by block translation ID**

In `createReaderRepository().loadReaderPageByPath()`:

- select `blockTranslationId` and `currentRevisionId`;
- collect translation IDs;
- query `translationRevisions` with `inArray`;
- group by `blockTranslationId`;
- mark `current: revision.id === currentRevisionId`;
- attach `revisionHistory` to every block, defaulting to `[]`.

## Task 3: Render History UI

**Files:**
- Modify: `src/app/(app)/docs/[...slug]/reader-document.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/reader-document.test.tsx`

- [x] **Step 1: Render compact history below correction forms**

Use a `<details>` element with summary `Translation history (n)`, an ordered list, source label, optional provider/model metadata, timestamp, and translated text preview.

- [x] **Step 2: Run focused test**

Run:

```powershell
corepack pnpm test -- tests/unit/reader-document.test.tsx
```

Expected: PASS.

## Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-18-reader-translation-history.md`

- [x] **Step 1: Document reader history**

Document that cached reader pages show immutable revision history under each translatable block.

- [x] **Step 2: Run verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Expected: PASS.

- [x] **Step 3: Commit**

Run:

```powershell
git add src/modules/reader/types.ts src/db/repositories/reader-repository.ts src/app/(app)/docs/[...slug]/reader-document.tsx src/app/globals.css tests/unit/reader-document.test.tsx README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-reader-translation-history.md
git commit -m "feat: show reader translation history"
```

## Verification Notes

- Passed: focused red/green reader history tests.
- Passed: `git diff --check`.
- Passed: `corepack pnpm lint`.
- Passed: `corepack pnpm typecheck`.
- Passed: `corepack pnpm test` with 43 files and 289 tests.
- Passed: production `corepack pnpm build`; the known Next workspace-root warning still appears because the parent checkout and worktree both have lockfiles.

## Self-Review

- Spec coverage: Provides visible immutable translation history for reader blocks. Full text diff and a dedicated history browser remain later enhancements.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Reader history source/provider types reuse existing database enums.
