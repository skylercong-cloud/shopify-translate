# Production Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local production preflight command that catches missing deployment files and unsafe `.env.production` placeholder values before server deployment.

**Architecture:** A pure operations module reads a dotenv-style file, checks required production variables and known placeholder values, and verifies deployment artifacts exist. A small CLI script reports failures and exits non-zero.

**Tech Stack:** TypeScript, Node.js `fs`, Vitest.

---

## File Structure

- Create `src/modules/operations/production-preflight.ts`: parser and checks.
- Create `scripts/production-preflight.ts`: CLI wrapper.
- Modify `package.json`: add `deploy:preflight`.
- Modify `tests/unit/scaffold-config.test.ts`: assert script is exposed.
- Create `tests/unit/production-preflight.test.ts`: pure preflight tests.
- Update README and deployment docs.

## Task 1: Pure Preflight Tests

**Files:**
- Create `tests/unit/production-preflight.test.ts`

- [x] **Step 1: Write failing tests**

Assert that preflight:

- passes when all required files exist and `.env.production` uses real-looking values;
- reports missing `DATABASE_URL`, `APP_ORIGIN`, `SITE_DOMAIN`, `POSTGRES_PASSWORD`, `MODEL_KEY_ENCRYPTION_KEY`, and `SESSION_DAYS`;
- reports placeholder values from `.env.production.example`;
- reports missing deployment files.

- [x] **Step 2: Run tests to verify failure**

Run:

```powershell
corepack pnpm test
```

Expected: FAIL because the preflight module does not exist.

## Task 2: Implementation And CLI

**Files:**
- Create `src/modules/operations/production-preflight.ts`
- Create `scripts/production-preflight.ts`
- Modify `package.json`
- Modify `tests/unit/scaffold-config.test.ts`

- [x] **Step 1: Implement pure preflight module**

Implement `runProductionPreflight({ cwd, envFileName, readTextFile, fileExists })` returning `{ ok, checks }`, where each check has `name`, `status`, and `message`.

- [x] **Step 2: Implement CLI wrapper**

Read `.env.production` by default, print every check, and exit `1` if any check fails.

- [x] **Step 3: Add package script**

Add `"deploy:preflight": "tsx scripts/production-preflight.ts"` and cover it in scaffold config tests.

- [x] **Step 4: Run tests**

Run:

```powershell
corepack pnpm test
```

Expected: PASS.

Note: `corepack pnpm test` passed on June 19, 2026 with 50 files and 306 tests after the preflight module, CLI wrapper, and package script were added.

## Task 3: Documentation, Verification, Commit

**Files:**
- Modify `README.md`
- Modify `docs/deployment.md`
- Modify this plan.

- [x] **Step 1: Document preflight**

Mention `corepack pnpm deploy:preflight` before production deployment.

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

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```powershell
git add src/modules/operations/production-preflight.ts scripts/production-preflight.ts package.json tests/unit/production-preflight.test.ts tests/unit/scaffold-config.test.ts README.md docs/deployment.md docs/superpowers/plans/2026-06-19-production-preflight.md
git commit -m "feat: add production preflight"
```

## Self-Review

- Spec coverage: Adds a deployment-readiness check without relying on a chosen cloud vendor.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: CLI uses the same preflight result type as tests.
- Verification note: `git diff --check`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and production `corepack pnpm build` passed on June 19, 2026. `corepack pnpm deploy:preflight .env.production.example` was run outside the sandbox and correctly failed on placeholder values after passing deployment-file checks.
