# Backup Restore Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe command that verifies a PostgreSQL custom-format backup by checking its SHA-256 file, restoring it into a temporary database, probing the restored database, and dropping the temporary database.

**Architecture:** Keep restore verification in a pure operations module with injectable command and filesystem dependencies. Add a thin CLI wrapper and package script. The command never writes to the production database except creating and dropping a generated temporary database name through the existing `DATABASE_URL`.

**Tech Stack:** TypeScript, Node.js `crypto`, PostgreSQL CLI tools (`psql`, `pg_restore`), Vitest.

---

## File Structure

- Create `src/modules/operations/restore-verification.ts`: checksum verification, temporary database naming, create/restore/probe/drop command orchestration.
- Create `src/modules/operations/restore-verification-cli.ts`: environment parsing and CLI logging.
- Create `scripts/verify-backup-restore.ts`: script entrypoint.
- Create `tests/unit/operations-restore-verification.test.ts`: module behavior tests.
- Create `tests/unit/restore-verification-cli.test.ts`: CLI behavior tests.
- Modify `tests/unit/scaffold-config.test.ts`: package script assertion.
- Modify `package.json`: add `backup:verify`.
- Modify `README.md`, `docs/translation-operations.md`, `docs/deployment.md`, and roadmap docs with restore verification usage.
- Modify this plan as tasks complete.

## Task 1: Restore Verification Module Contract

**Files:**
- Create: `tests/unit/operations-restore-verification.test.ts`

- [x] **Step 1: Write failing module tests**

Test that `verifyBackupRestore()`:

- validates `DATABASE_URL`, `dumpPath`, and positive generated temp database name prefix;
- reads `${dumpPath}.sha256` by default;
- rejects a checksum mismatch before creating a temp database;
- runs `psql CREATE DATABASE`, `pg_restore`, `psql` probe, and `psql DROP DATABASE ... WITH (FORCE)` in order;
- drops the temp database in `finally` if restore or probe fails after creation.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/operations-restore-verification.test.ts
```

Expected: FAIL because `@/modules/operations/restore-verification` does not exist.

## Task 2: Implement Restore Verification Module

**Files:**
- Create: `src/modules/operations/restore-verification.ts`
- Test: `tests/unit/operations-restore-verification.test.ts`

- [x] **Step 1: Implement module**

Implement:

- `RestoreVerificationOptions`;
- `RestoreVerificationDependencies`;
- `verifyBackupRestore(options, dependencies)`;
- SHA-256 comparison against the first 64-character lowercase or uppercase hex digest in the checksum file;
- safe generated temp database name `shopify_docs_restore_verify_<YYYYMMDD_HHmmss>_<nonce>`;
- `CREATE DATABASE`, `pg_restore --clean --if-exists --no-owner --no-privileges --dbname <tempUrl> <dumpPath>`, probe query, and forced drop;
- cleanup in `finally` after temp DB creation.

- [x] **Step 2: Run test to verify it passes**

Run:

```powershell
corepack pnpm test -- tests/unit/operations-restore-verification.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit module**

Run:

```powershell
git add src/modules/operations/restore-verification.ts tests/unit/operations-restore-verification.test.ts docs/superpowers/plans/2026-06-18-backup-restore-verification.md
git commit -m "feat: verify backup restores"
```

## Task 3: CLI And Package Script

**Files:**
- Create: `src/modules/operations/restore-verification-cli.ts`
- Create: `scripts/verify-backup-restore.ts`
- Create: `tests/unit/restore-verification-cli.test.ts`
- Modify: `tests/unit/scaffold-config.test.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing CLI and scaffold tests**

Test that:

- `runRestoreVerificationCli()` reads `DATABASE_URL`, `BACKUP_DUMP_PATH`, optional `BACKUP_CHECKSUM_PATH`, optional `RESTORE_VERIFY_DATABASE_PREFIX`, and optional command path overrides;
- success logs checksum path, temporary database name, and dump path;
- missing `BACKUP_DUMP_PATH` exits with code 1 without calling the runner;
- `package.json` exposes `backup:verify`.

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
corepack pnpm test -- tests/unit/restore-verification-cli.test.ts tests/unit/scaffold-config.test.ts
```

Expected: FAIL because the CLI module, script, and package script do not exist.

- [x] **Step 3: Implement CLI and package script**

Create the CLI wrapper and script entrypoint:

```typescript
process.exitCode = await runRestoreVerificationCli({
  env: process.env,
  logger: console,
  now: new Date(),
  verifyRestore: verifyBackupRestore,
});
```

Add:

```json
"backup:verify": "tsx scripts/verify-backup-restore.ts"
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```powershell
corepack pnpm test -- tests/unit/restore-verification-cli.test.ts tests/unit/scaffold-config.test.ts tests/unit/operations-restore-verification.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit CLI**

Run:

```powershell
git add src/modules/operations/restore-verification-cli.ts scripts/verify-backup-restore.ts package.json tests/unit/restore-verification-cli.test.ts tests/unit/scaffold-config.test.ts docs/superpowers/plans/2026-06-18-backup-restore-verification.md
git commit -m "feat: add backup restore verification command"
```

## Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/translation-operations.md`
- Modify: `docs/deployment.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-18-backup-restore-verification.md`

- [x] **Step 1: Document restore verification**

Document:

- `BACKUP_DUMP_PATH`;
- optional `BACKUP_CHECKSUM_PATH`;
- `corepack pnpm backup:verify`;
- temporary database creation and cleanup;
- server usage through `docker compose ... exec backup corepack pnpm backup:verify`.

- [x] **Step 2: Run verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Expected: PASS.

- [x] **Step 3: Commit documentation and verification notes**

Run:

```powershell
git add README.md docs/translation-operations.md docs/deployment.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-backup-restore-verification.md
git commit -m "docs: describe backup restore verification"
```

## Verification Notes

- Passed: `git diff --check`.
- Passed: `corepack pnpm lint`.
- Passed: `corepack pnpm typecheck`.
- Passed: `corepack pnpm test` with 41 files and 284 tests.
- Passed: production `corepack pnpm build`; the known Next workspace-root warning still appears because the parent checkout and worktree both have lockfiles.

## Self-Review

- Spec coverage: Covers restore verification for local and production backups. Off-server copy automation remains provider-specific and deployment-time.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: CLI and module option names match the tests and scripts.
