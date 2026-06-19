# Glossary Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected web form for activating a new glossary snapshot from newline-separated technical terms.

**Architecture:** Reuse the existing translation config service for validation, normalization, duplicate detection, versioning, and activation. Add a protected POST route that parses textarea lines and redirects back to `/admin`; extend the admin overview to show active terms and the activation form.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM, PostgreSQL, Vitest, Testing Library.

---

## File Structure

- Create `src/app/api/admin/glossary/route.ts` for protected glossary activation.
- Create `tests/integration/admin-glossary-route.test.ts` for authenticated activation, unauthenticated redirect, and invalid terms.
- Modify `src/modules/operations/types.ts` so `activeGlossary` includes current term labels.
- Modify `src/db/repositories/operations-repository.ts` to load active glossary terms.
- Modify `tests/integration/operations-repository.test.ts` for active term output.
- Modify `src/app/(app)/admin/operations-overview.tsx` to render active terms and glossary form.
- Modify `tests/unit/admin-overview.test.tsx` to assert form fields and current terms.
- Modify `src/app/globals.css` for glossary form/list styles.
- Modify docs after verification.

## Task 1: Glossary Activation Route

**Files:**
- Create: `src/app/api/admin/glossary/route.ts`
- Create: `tests/integration/admin-glossary-route.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create route tests that:

- Mock `next/headers` cookies.
- Authenticate an admin session.
- Submit newline-separated terms.
- Assert a new active glossary version with sorted terms.
- Assert unauthenticated requests redirect to `/login`.
- Assert duplicate or invalid terms redirect to `/admin?glossary=invalid` and do not replace the active glossary.

- [ ] **Step 2: Run red test**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-glossary-route.test.ts
```

Expected: FAIL because `src/app/api/admin/glossary/route.ts` does not exist.

- [ ] **Step 3: Implement route**

Add `POST(request)` that requires current user, reads `terms` from form data, splits non-empty lines, calls `createTranslationConfigService(createTranslationConfigRepository(db)).activateGlossary({ terms })`, and redirects to `/admin?glossary=updated` or `/admin?glossary=invalid`.

- [ ] **Step 4: Run route tests and typecheck**

Run target integration test and `corepack pnpm typecheck`.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/admin/glossary/route.ts tests/integration/admin-glossary-route.test.ts
git commit -m "feat: activate glossary from admin"
```

## Task 2: Operations Overview Term Data

**Files:**
- Modify: `src/modules/operations/types.ts`
- Modify: `src/db/repositories/operations-repository.ts`
- Modify: `tests/integration/operations-repository.test.ts`
- Modify: `tests/unit/admin-overview.test.tsx`

- [ ] **Step 1: Write failing assertions**

Update tests to expect `activeGlossary.terms` containing the active glossary source terms.

- [ ] **Step 2: Run red tests**

Run target unit/integration tests and confirm they fail because terms are missing.

- [ ] **Step 3: Load terms**

Update operations repository to load active glossary terms ordered by normalized term, include them in `activeGlossary`, and compute `termCount` from the term list.

- [ ] **Step 4: Run tests and typecheck**

Run target tests and `corepack pnpm typecheck`.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/operations/types.ts src/db/repositories/operations-repository.ts tests/integration/operations-repository.test.ts tests/unit/admin-overview.test.tsx
git commit -m "feat: expose active glossary terms"
```

## Task 3: Glossary Form UI

**Files:**
- Modify: `src/app/(app)/admin/operations-overview.tsx`
- Modify: `tests/unit/admin-overview.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing UI assertions**

Expect a form named `术语库表单`, action `/api/admin/glossary`, textarea label `Glossary terms`, existing active terms, and button `激活术语库`.

- [ ] **Step 2: Run red UI test**

Run `corepack pnpm test -- tests/unit/admin-overview.test.tsx`.

Expected: FAIL because the form is not rendered.

- [ ] **Step 3: Render glossary form**

Render the current active terms and a textarea prefilled with one term per line. The form posts to `/api/admin/glossary`.

- [ ] **Step 4: Run UI checks**

Run target UI test, typecheck, and lint.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(app)/admin/operations-overview.tsx src/app/globals.css tests/unit/admin-overview.test.tsx
git commit -m "feat: render glossary admin form"
```

## Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Document glossary activation**

Document that `/admin` can activate glossary snapshots from newline-separated ASCII terms.

- [ ] **Step 2: Run final verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; $env:E2E_ADMIN_PASSWORD='phase-one-test-password'; corepack pnpm test:e2e:seed
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; $env:E2E_ADMIN_PASSWORD='phase-one-test-password'; corepack pnpm test:e2e
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Expected: PASS, with only the known Next multiple-lockfile warning if it appears.

- [ ] **Step 3: Commit**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md
git commit -m "docs: describe glossary admin"
```

## Self-Review

- Spec coverage: Covers Phase 5 glossary management as versioned activation with existing validation and conflict detection. Full per-term CRUD and glossary history browsing remain later increments.
- Placeholder scan: No placeholders remain.
- Type consistency: `OperationsGlossaryStatus.terms` is consumed consistently by repository and UI.
