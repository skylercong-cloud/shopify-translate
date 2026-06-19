# Glossary History Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make glossary version history visible in the personal `/admin` operations page so terminology changes are auditable after new snapshots are activated.

**Architecture:** Extend operations overview data with a compact `glossaryHistory` list loaded from `glossary_versions` plus term counts. Render the list in the existing version/status card below the active glossary editor.

**Tech Stack:** TypeScript, Drizzle ORM aggregate queries, React, Testing Library, Vitest.

---

## File Structure

- Modify `src/modules/operations/types.ts`: add `OperationsGlossaryHistoryItem` and `glossaryHistory`.
- Modify `src/db/repositories/operations-repository.ts`: load recent glossary versions with term counts.
- Modify `src/app/(app)/admin/operations-overview.tsx`: render glossary history list.
- Modify `tests/unit/admin-overview.test.tsx`: assert history rendering.
- Modify README/roadmap and this plan after implementation.

## Task 1: Failing Admin Render Test

**Files:**
- Modify: `tests/unit/admin-overview.test.tsx`

- [x] **Step 1: Write failing test assertions**

Add fixture data for two glossary versions and assert:

- heading `Glossary history` renders;
- `Glossary v2` has `Active`;
- `Glossary v1` has `2 terms`;
- dates render.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
```

Expected: FAIL because UI does not render glossary history.

## Task 2: Types, Repository, And UI

**Files:**
- Modify: `src/modules/operations/types.ts`
- Modify: `src/db/repositories/operations-repository.ts`
- Modify: `src/app/(app)/admin/operations-overview.tsx`

- [x] **Step 1: Add glossary history types**

Add `OperationsGlossaryHistoryItem` with `id`, `version`, `termCount`, `active`, and `createdAt`, and include `glossaryHistory` in `OperationsOverview`.

- [x] **Step 2: Load history in repository**

Query the latest 10 glossary versions and left join term counts. Order by version descending.

- [x] **Step 3: Render history**

Render a compact list under the glossary form with active badge, term count, and created date.

- [x] **Step 4: Run focused test**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
```

Expected: PASS.

## Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-18-glossary-history-admin.md`

- [x] **Step 1: Document glossary history**

Mention that `/admin` shows recent glossary version history.

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
git add src/modules/operations/types.ts src/db/repositories/operations-repository.ts src/app/(app)/admin/operations-overview.tsx tests/unit/admin-overview.test.tsx README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-glossary-history-admin.md
git commit -m "feat: show glossary history in admin"
```

## Self-Review

- Spec coverage: Adds glossary history browsing to the existing personal admin page. Per-term CRUD and diffing remain later enhancements.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Uses existing operation overview data flow.
- Focused test note: `corepack pnpm test -- tests/unit/admin-overview.test.tsx tests/unit/operations-alerts.test.ts` passed on June 18, 2026; Vitest ran 43 files and 289 tests.
- Verification note: `git diff --check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and production `corepack pnpm build` passed on June 18, 2026. Build still reports the known Next.js multiple-lockfile workspace-root warning.
