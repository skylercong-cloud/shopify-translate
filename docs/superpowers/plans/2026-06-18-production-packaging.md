# Production Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the private Shopify.dev Chinese reader for a single 2-vCPU/4-GB Linux server with Docker Compose, HTTPS, persistent storage, and deployment runbooks.

**Architecture:** Build one reusable production application image and run it as separate web, ingestion worker, translation worker, and backup scheduler services. Keep PostgreSQL private on the Compose network, expose only Caddy on ports 80/443, and store secrets through `.env.production` or Docker-compatible environment injection.

**Tech Stack:** Next.js 16 standalone output, Node.js 22 Alpine, pnpm/Corepack, Docker Compose, PostgreSQL 16, Caddy 2, Vitest file-content verification.

---

## File Structure

- Create `tests/unit/production-packaging.test.ts`: verifies production deployment artifacts and docs contain the required operational safeguards.
- Create `Dockerfile`: multi-stage app image for web and worker processes.
- Create `compose.production.yaml`: production services, volumes, health checks, restart policies, and resource guidance.
- Create `Caddyfile`: HTTPS reverse proxy and security headers.
- Create `.env.production.example`: production-only template with no secrets.
- Create `docs/deployment.md`: server provisioning, secret bootstrap, deploy, backup, rollback, restore, and Hubei filing checklist.
- Modify `README.md`: link the production deployment guide and summarize production commands.
- Modify `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`: mark Phase 6 packaging deliverables implemented where covered.
- Modify this plan file as tasks complete.

## Task 1: Production Artifact Contract

**Files:**
- Create: `tests/unit/production-packaging.test.ts`

- [x] **Step 1: Write the failing test**

Create `tests/unit/production-packaging.test.ts` with assertions that:

- `Dockerfile` uses Node 22 Alpine, Corepack/pnpm, `next build`, Next standalone output, and a non-root runtime user;
- `compose.production.yaml` defines `web`, `worker`, `translation-worker`, `backup`, `db`, and `caddy` services;
- only Caddy publishes `80` and `443`;
- Postgres has no host `ports`;
- services have health checks or dependency health gates where applicable;
- backups mount a persistent backup volume;
- `.env.production.example` includes domain, app origin, database URL, session, model encryption, worker, source, translation, backup, and Caddy variables;
- `Caddyfile` reverse proxies to `web:3000` and sends core security headers;
- `docs/deployment.md` documents provisioning, secrets, deploy, migrate, backup, rollback, restore, and Hubei ICP/public-security filing.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/production-packaging.test.ts
```

Expected: FAIL because the production artifacts do not exist yet.

- [x] **Step 3: Commit the red test**

Run:

```powershell
git add tests/unit/production-packaging.test.ts docs/superpowers/plans/2026-06-18-production-packaging.md
git commit -m "docs: plan production packaging"
```

## Task 2: Docker And Compose Runtime

**Files:**
- Create: `Dockerfile`
- Create: `compose.production.yaml`
- Create: `.env.production.example`
- Test: `tests/unit/production-packaging.test.ts`

- [x] **Step 1: Implement the production image and Compose stack**

Add:

- a multi-stage `Dockerfile` with dependency, builder, and runner stages;
- `corepack enable` and locked `pnpm install --frozen-lockfile`;
- `corepack pnpm build`;
- a non-root `nextjs` runtime user;
- the Next standalone server and full project files needed by `tsx` worker entrypoints;
- `compose.production.yaml` services:
  - `db`: PostgreSQL 16, internal only, persistent volume, health check;
  - `web`: app image, `node .next/standalone/server.js`, health check on `/api/health/live`;
  - `worker`: app image, `corepack pnpm worker`;
  - `translation-worker`: app image, `corepack pnpm translation-worker`;
  - `backup`: app image, daily loop running `corepack pnpm backup`;
  - `caddy`: public `80`/`443`, reverse proxy to web, persistent Caddy data;
- `.env.production.example` with production-safe placeholders.

- [x] **Step 2: Run the production artifact test**

Run:

```powershell
corepack pnpm test -- tests/unit/production-packaging.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit runtime artifacts**

Run:

```powershell
git add Dockerfile compose.production.yaml .env.production.example tests/unit/production-packaging.test.ts docs/superpowers/plans/2026-06-18-production-packaging.md
git commit -m "feat: add production docker stack"
```

## Task 3: Caddy And Deployment Runbook

**Files:**
- Create: `Caddyfile`
- Create: `docs/deployment.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Test: `tests/unit/production-packaging.test.ts`

- [x] **Step 1: Implement Caddy and deployment documentation**

Add:

- a `Caddyfile` using `{$SITE_DOMAIN}` and reverse proxying to `web:3000`;
- `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` headers;
- a deployment guide with:
  - 2-vCPU/4-GB server baseline;
  - Docker and Git installation checklist;
  - `.env.production` creation and secret generation;
  - admin password bootstrap;
  - `docker compose --env-file .env.production -f compose.production.yaml up -d --build`;
  - migration and optional preview seed commands;
  - backup retention and off-server copy note;
  - rollback and restore procedure;
  - Hubei ICP and public-security filing checklist;
  - post-deploy smoke checks.

- [x] **Step 2: Run the production artifact test**

Run:

```powershell
corepack pnpm test -- tests/unit/production-packaging.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit documentation artifacts**

Run:

```powershell
git add Caddyfile docs/deployment.md README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md tests/unit/production-packaging.test.ts docs/superpowers/plans/2026-06-18-production-packaging.md
git commit -m "docs: add production deployment runbook"
```

## Task 4: Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-06-18-production-packaging.md`

- [ ] **Step 1: Run focused verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```powershell
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Expected: PASS. The known Next workspace-root warning is acceptable.

- [ ] **Step 3: Optionally validate Docker Compose syntax if Docker is available**

Run:

```powershell
docker compose -f compose.production.yaml --env-file .env.production.example config
```

Expected: PASS when Docker CLI is installed. If Docker is unavailable in this local environment, record that the syntax check was not run.

- [ ] **Step 4: Commit verification notes**

Run:

```powershell
git add docs/superpowers/plans/2026-06-18-production-packaging.md
git commit -m "docs: record production packaging verification"
```

## Self-Review

- Spec coverage: Covers Docker image, production Compose, Caddy HTTPS/security headers, production environment template, secret bootstrap, server provisioning checklist, Hubei ICP/public-security filing, deployment, rollback, upgrade, backup, and restore documentation. Real server purchase, real domain DNS, and real ICP submission remain intentionally deferred until deployment.
- Placeholder scan: No TBD/TODO placeholders; production secret values are explicit replace-me placeholders in the env template.
- Type consistency: This plan touches deployment artifacts and file-content tests only; no TypeScript runtime APIs are introduced.
