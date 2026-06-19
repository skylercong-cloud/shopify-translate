# Translation Write Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent translation workers from spending model tokens when PostgreSQL write health is degraded, and surface that condition in the operations overview.

**Architecture:** Add an injectable database-write health checker that performs a transaction-scoped temporary-table write probe without changing schema. Operations overview includes the latest write-health result and derives a critical alert. Translation service calls an injectable write-health gate before manual/memory/model publication work; unhealthy status returns a retryable failure before provider calls or token reservation.

**Tech Stack:** TypeScript, Drizzle ORM transaction `execute`, PostgreSQL temporary tables, Vitest.

---

## File Structure

- Create `src/modules/operations/database-write-health.ts`: write probe and result types.
- Create `tests/unit/database-write-health.test.ts`: probe success/failure tests.
- Modify `src/modules/operations/types.ts`: add `system.databaseWrite` and `database_writes_unavailable` alert code.
- Modify `src/modules/operations/alerts.ts`: derive critical alert when database writes are unavailable.
- Modify `tests/unit/operations-alerts.test.ts`: alert coverage and healthy default fixture.
- Modify `src/db/repositories/operations-repository.ts`: load database write health into overview.
- Modify `src/modules/translation/translation-service.ts`: add optional write-health gate.
- Modify `tests/unit/translation/translation-service.test.ts`: ensure unhealthy write gate prevents model calls, reservations, and revisions.
- Modify `src/worker/translation-main.ts`: pass the database write-health checker to the translation service.
- Modify docs and roadmap after implementation.

## Task 1: Failing Safety Tests

**Files:**
- Create: `tests/unit/database-write-health.test.ts`
- Modify: `tests/unit/operations-alerts.test.ts`
- Modify: `tests/unit/translation/translation-service.test.ts`

- [x] **Step 1: Write failing tests**

Tests must prove:

- `checkDatabaseWriteHealth()` reports writable after executing a transaction-scoped temp-table write probe;
- failed probe returns `{ writable: false, code: "database_write_unavailable", message }`;
- operations alerts include `database_writes_unavailable` when `overview.system.databaseWrite.writable` is false;
- translation service returns a retryable failure with code `database_write_unavailable` before token reservation, model calls, and revision publication.

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
corepack pnpm test -- tests/unit/database-write-health.test.ts tests/unit/operations-alerts.test.ts tests/unit/translation/translation-service.test.ts
```

Expected: FAIL because the new module and types do not exist yet.

## Task 2: Health Probe And Alerts

**Files:**
- Create: `src/modules/operations/database-write-health.ts`
- Modify: `src/modules/operations/types.ts`
- Modify: `src/modules/operations/alerts.ts`
- Modify: `tests/unit/database-write-health.test.ts`
- Modify: `tests/unit/operations-alerts.test.ts`

- [x] **Step 1: Implement database write health and alert derivation**

The probe should:

- run in a Drizzle transaction;
- execute `create temporary table if not exists translation_write_health_check (value integer) on commit drop`;
- execute `insert into translation_write_health_check(value) values (1)`;
- return `checkedAt` from injected `now`;
- catch errors and return `writable: false`.

- [x] **Step 2: Run focused tests**

Run:

```powershell
corepack pnpm test -- tests/unit/database-write-health.test.ts tests/unit/operations-alerts.test.ts
```

Expected: PASS.

## Task 3: Translation Service Write Gate

**Files:**
- Modify: `src/modules/translation/translation-service.ts`
- Modify: `tests/unit/translation/translation-service.test.ts`
- Modify: `src/worker/translation-main.ts`

- [x] **Step 1: Implement write gate**

Add optional `writeHealth` to `TranslationServiceOptions`:

```typescript
writeHealth?: {
  check(): Promise<DatabaseWriteHealth>;
};
```

When `writable` is false, return:

```typescript
{
  outcome: "retryable_failure",
  code: "database_write_unavailable",
  message: health.message,
}
```

Do this after loading/skipping the block but before corrections, AI memory, token reservation, or provider calls.

- [x] **Step 2: Wire the worker**

Create the write-health checker with the shared `db` in `src/worker/translation-main.ts` and pass it to `createTranslationService()`.

- [x] **Step 3: Run focused tests**

Run:

```powershell
corepack pnpm test -- tests/unit/translation/translation-service.test.ts tests/unit/database-write-health.test.ts tests/unit/operations-alerts.test.ts
```

Expected: PASS.

## Task 4: Operations Overview And Documentation

**Files:**
- Modify: `src/db/repositories/operations-repository.ts`
- Modify: `README.md`
- Modify: `docs/translation-operations.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-18-translation-write-safety.md`

- [x] **Step 1: Load database write health into operations overview**

Add `databaseWrite: await checkDatabaseWriteHealth(db)` to `overview.system`.

- [x] **Step 2: Document the behavior**

Document that translation workers pause model usage when database write health is unavailable and that `/admin` surfaces the alert.

- [x] **Step 3: Run verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```powershell
git add src/modules/operations/database-write-health.ts src/modules/operations/types.ts src/modules/operations/alerts.ts src/db/repositories/operations-repository.ts src/modules/translation/translation-service.ts src/worker/translation-main.ts tests/unit/database-write-health.test.ts tests/unit/operations-alerts.test.ts tests/unit/translation/translation-service.test.ts README.md docs/translation-operations.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-translation-write-safety.md
git commit -m "feat: gate translations on database write health"
```

## Verification Notes

- Passed: focused red/green tests for database write health, operations alerts, and translation service write gating.
- Passed: `corepack pnpm typecheck`.
- Passed: `corepack pnpm lint`.
- Passed: `corepack pnpm test` with 42 files and 288 tests.
- Passed: `git diff --check`.
- Passed: production `corepack pnpm build`; the known Next workspace-root warning still appears because the parent checkout and worktree both have lockfiles.
- Not run locally: `corepack pnpm test:integration -- tests/integration/operations-repository.test.ts`. The first sandbox run failed with `EPERM: operation not permitted, lstat 'C:\Users\admin'`; the required elevated rerun was rejected by the system because the account hit the current usage limit.

## Self-Review

- Spec coverage: Covers database write-health alerting and translation write safety before model calls. Full disk-capacity telemetry remains a later host/observability integration.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: `DatabaseWriteHealth` is the shared result type used by operations and translation.
