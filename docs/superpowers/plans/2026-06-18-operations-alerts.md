# Operations Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add degraded-state alerts to the protected operations overview.

**Architecture:** Derive alert rules in a pure operations module from the existing read-only overview data, then have the repository attach the derived alerts and the admin UI render them. Alerts remain read-only and do not perform remediation or configuration writes.

**Tech Stack:** TypeScript, Next.js 16 App Router, React, Drizzle ORM, Vitest, Testing Library.

---

## File Structure

- Create `src/modules/operations/alerts.ts` for pure degraded-state rules.
- Modify `src/modules/operations/types.ts` to add `OperationsAlert` and `alerts` on `OperationsOverview`.
- Modify `src/db/repositories/operations-repository.ts` to attach derived alerts.
- Modify `tests/unit/operations-alerts.test.ts` for pure rule coverage.
- Modify `tests/integration/operations-repository.test.ts` to prove repository output includes alerts.
- Modify `src/app/(app)/admin/operations-overview.tsx` and `tests/unit/admin-overview.test.tsx` to render alert banners.
- Modify `src/app/globals.css` for alert styling.
- Modify `README.md` and roadmap status after verification.

## Task 1: Alert Rules

**Files:**
- Create: `tests/unit/operations-alerts.test.ts`
- Create: `src/modules/operations/alerts.ts`
- Modify: `src/modules/operations/types.ts`
- Modify: `src/db/repositories/operations-repository.ts`
- Modify: `tests/integration/operations-repository.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/operations-alerts.test.ts` with tests for:

- No enabled provider produces critical `no_enabled_provider`.
- Missing active Prompt produces warning `missing_prompt`.
- Missing active glossary produces warning `missing_glossary`.
- Failed jobs produce critical `failed_jobs` with the failed count.
- Healthy data produces no alerts.

- [ ] **Step 2: Run red test**

Run `corepack pnpm test -- tests/unit/operations-alerts.test.ts`.

Expected: FAIL because `src/modules/operations/alerts.ts` does not exist.

- [ ] **Step 3: Implement alert types and rules**

Add `OperationsAlert` to `src/modules/operations/types.ts` and `deriveOperationsAlerts(overview)` to `src/modules/operations/alerts.ts`.

- [ ] **Step 4: Attach alerts in repository**

Update `createOperationsRepository(db).loadOverview()` to build the overview data without alerts, derive alerts, and return the full overview.

- [ ] **Step 5: Run tests**

Run:

```powershell
corepack pnpm test -- tests/unit/operations-alerts.test.ts
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/operations-repository.test.ts
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/operations src/db/repositories/operations-repository.ts tests/unit/operations-alerts.test.ts tests/integration/operations-repository.test.ts
git commit -m "feat: derive operations alerts"
```

## Task 2: Alert Banners

**Files:**
- Modify: `tests/unit/admin-overview.test.tsx`
- Modify: `src/app/(app)/admin/operations-overview.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing UI assertions**

Update `tests/unit/admin-overview.test.tsx` so the overview fixture includes a `failed_jobs` alert and the test expects `需要处理` plus the alert title/message.

- [ ] **Step 2: Run red UI test**

Run `corepack pnpm test -- tests/unit/admin-overview.test.tsx`.

Expected: FAIL because the component does not render alerts yet.

- [ ] **Step 3: Render alert banners**

Render an `operations-alerts` section near the top of `OperationsOverviewPanel`. Use critical and warning visual classes and render a healthy empty state when there are no alerts.

- [ ] **Step 4: Run UI/type/style checks**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
corepack pnpm typecheck
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(app)/admin/operations-overview.tsx src/app/globals.css tests/unit/admin-overview.test.tsx
git commit -m "feat: show operations alerts"
```

## Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Document alert behavior**

Document that `/admin` includes degraded-state alerts for missing model configuration, missing Prompt/glossary, and failed jobs.

- [ ] **Step 2: Run final verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Expected: PASS, with only the known Next multiple-lockfile warning if it appears.

- [ ] **Step 3: Commit**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md
git commit -m "docs: describe operations alerts"
```

## Self-Review

- Spec coverage: Covers Phase 5 degraded-state banners and operational alerts for current model/config/job data. Disk/database/backup alerts are intentionally deferred until those data sources exist.
- Placeholder scan: No placeholder instructions remain.
- Type consistency: `OperationsAlert`, `OperationsOverview.alerts`, and `deriveOperationsAlerts()` are used consistently by repository, tests, and UI.
