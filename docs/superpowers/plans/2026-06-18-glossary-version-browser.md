# Glossary Version Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected `/admin/glossary` browser that shows glossary snapshot versions, full term lists, and differences against the active glossary.

**Architecture:** Preserve the existing snapshot activation model. A pure diff helper compares normalized glossary terms, a repository loads recent glossary versions with terms, and a server-rendered admin page displays active-only and version-only changes for audit.

**Tech Stack:** Next.js App Router, React Server Components, Drizzle ORM, TypeScript, Testing Library, Vitest.

---

## File Structure

- Create `src/modules/glossary/types.ts`: browser item and diff types.
- Create `src/modules/glossary/diff.ts`: pure glossary-term diff helper.
- Create `src/db/repositories/glossary-browser-repository.ts`: load recent versions and terms.
- Create `src/app/(app)/admin/glossary/page.tsx`: protected route.
- Create `src/app/(app)/admin/glossary/glossary-browser.tsx`: browser UI.
- Modify `src/app/(app)/layout.tsx`: add compact nav entry.
- Modify `src/app/globals.css`: glossary browser styles.
- Create `tests/unit/glossary-diff.test.ts`.
- Create `tests/unit/glossary-browser.test.tsx`.
- Update README and roadmap.

## Task 1: Diff Helper

**Files:**
- Create `tests/unit/glossary-diff.test.ts`
- Create `src/modules/glossary/types.ts`
- Create `src/modules/glossary/diff.ts`

- [x] **Step 1: Write failing diff tests**

Assert that comparing an old version with active terms returns:

- `activeOnlyTerms` for terms added in active;
- `versionOnlyTerms` for terms removed from active;
- no false changes when casing differs but normalized terms match.

- [x] **Step 2: Implement diff helper**

Implement `compareGlossaryTerms(versionTerms, activeTerms)` using normalized terms as identity and source terms for display.

- [x] **Step 3: Run diff tests**

Run:

```powershell
corepack pnpm test
```

Expected: PASS.

Note: `corepack pnpm test` passed on June 18, 2026 with 46 files and 296 tests after the glossary diff helper was added.

## Task 2: Browser UI

**Files:**
- Create `tests/unit/glossary-browser.test.tsx`
- Create `src/app/(app)/admin/glossary/glossary-browser.tsx`

- [x] **Step 1: Write failing render test**

Assert that the browser renders:

- heading `Glossary versions`;
- active version badge;
- full term list;
- `Added in active` and `Removed from active` diff sections;
- empty state when no glossary versions exist.

- [x] **Step 2: Implement UI component**

Render version cards from typed items. For active version, show a note that it is the active glossary. For other versions, show diff sections only when arrays are non-empty.

- [x] **Step 3: Run UI tests**

Run:

```powershell
corepack pnpm test
```

Expected: PASS.

Note: `corepack pnpm test` passed on June 18, 2026 with 47 files and 298 tests after the glossary browser UI was added.

## Task 3: Repository And Route

**Files:**
- Create `src/db/repositories/glossary-browser-repository.ts`
- Create `src/app/(app)/admin/glossary/page.tsx`
- Modify `src/app/(app)/layout.tsx`
- Modify `src/app/globals.css`

- [x] **Step 1: Implement repository**

Load the latest 20 glossary versions ordered by version descending, load their terms ordered by normalized term, compute diffs against the active glossary, and return browser items.

- [x] **Step 2: Implement route and nav**

Render `/admin/glossary` with repository data and add a compact `G` navigation entry.

- [x] **Step 3: Run typecheck and tests**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm test
```

Expected: PASS.

Note: `corepack pnpm typecheck` and `corepack pnpm test` passed on June 18, 2026 after `/admin/glossary`, repository loading, and navigation were added.

## Task 4: Documentation, Verification, Commit

**Files:**
- Modify `README.md`
- Modify `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify this plan.

- [x] **Step 1: Document glossary browser**

Mention `/admin/glossary` in admin documentation and mark glossary history/diff browsing as implemented, leaving per-term edit controls as a future enhancement.

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
git add src/modules/glossary/types.ts src/modules/glossary/diff.ts src/db/repositories/glossary-browser-repository.ts src/app/(app)/admin/glossary/page.tsx src/app/(app)/admin/glossary/glossary-browser.tsx src/app/(app)/layout.tsx src/app/globals.css tests/unit/glossary-diff.test.ts tests/unit/glossary-browser.test.tsx README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-glossary-version-browser.md
git commit -m "feat: add glossary version browser"
```

## Self-Review

- Spec coverage: Adds glossary version and diff browsing without changing the snapshot activation model. Per-term edit buttons remain a future enhancement.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Browser items carry terms and precomputed diffs from repository to component.
- Verification note: `git diff --check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and production `corepack pnpm build` passed on June 18, 2026. Build includes `/admin/glossary` and still reports the known Next.js multiple-lockfile workspace-root warning.
