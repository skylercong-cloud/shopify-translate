# Backup Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested local backup command that runs PostgreSQL `pg_dump`, writes a SHA-256 checksum, and deletes expired backup files after 14 days by default.

**Architecture:** Keep backup orchestration in a pure TypeScript operations module with injectable filesystem/process dependencies for tests. Add a thin `scripts/backup-database.ts` CLI that reads environment variables and invokes the module. Production scheduling remains a deployment/cron concern.

**Tech Stack:** Node.js `child_process`, `fs/promises`, SHA-256 checksums, Vitest unit tests, package scripts.

---

### Task 1: Backup Module

**Files:**
- Create: `src/modules/operations/backup.ts`
- Create: `tests/unit/operations-backup.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create tests that verify:
- `runDatabaseBackup()` creates the backup directory;
- invokes `pg_dump <DATABASE_URL> -Fc -f <timestamped dump path>`;
- writes `<dump>.sha256` containing the SHA-256 hash and dump basename;
- deletes only matching `shopify-docs-*.dump` and `shopify-docs-*.dump.sha256` files older than the retention window;
- leaves unrelated files untouched.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
corepack pnpm test -- tests/unit/operations-backup.test.ts
```

Expected: FAIL because `@/modules/operations/backup` does not exist.

- [ ] **Step 3: Implement backup module**

Implement `runDatabaseBackup(options, dependencies)` with:
- default command `pg_dump`;
- deterministic timestamp `YYYYMMDD-HHmmss` in UTC;
- custom-format dump arguments: `[databaseUrl, "-Fc", "-f", dumpPath]`;
- checksum content: `<hex>  <basename>\n`;
- retention cutoff based on `now - retentionDays`;
- deletion limited to backup filename patterns only.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/operations-backup.test.ts
corepack pnpm typecheck
corepack pnpm lint
```

Commit:

```powershell
git add src/modules/operations/backup.ts tests/unit/operations-backup.test.ts
git commit -m "feat: add database backup runner"
```

### Task 2: Backup CLI

**Files:**
- Create: `scripts/backup-database.ts`
- Modify: `package.json`
- Modify: `tests/unit/scaffold-config.test.ts`

- [ ] **Step 1: Write failing script/config test**

Extend `tests/unit/scaffold-config.test.ts` to assert `package.json` exposes:

```json
"backup": "tsx scripts/backup-database.ts"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm test -- tests/unit/scaffold-config.test.ts
```

Expected: FAIL because the package script is absent.

- [ ] **Step 3: Implement CLI and package script**

Create `scripts/backup-database.ts`:
- require `DATABASE_URL`;
- read `BACKUP_DIR`, default `backups`;
- read `BACKUP_RETENTION_DAYS`, default `14`;
- call `runDatabaseBackup`;
- print backup path, checksum path, and deleted count;
- set `process.exitCode = 1` on errors.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/scaffold-config.test.ts tests/unit/operations-backup.test.ts
corepack pnpm typecheck
corepack pnpm lint
```

Commit:

```powershell
git add scripts/backup-database.ts package.json tests/unit/scaffold-config.test.ts
git commit -m "feat: add backup command"
```

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/translation-operations.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Update docs**

Document `corepack pnpm backup`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, checksum files, and the remaining deployment cron step.

- [ ] **Step 2: Run full verification**

Run lint, typecheck, unit, integration, E2E seed, E2E if available, and production build.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/translation-operations.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-backup-automation.md
git commit -m "docs: describe backup automation"
```

---

## Self-Review

- Spec coverage: Covers daily backup command behavior, checksums, and retention logic. Cron scheduling and restore verification remain later deployment/operations increments.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Uses `DATABASE_URL`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `pg_dump`, and 14-day retention consistently.
