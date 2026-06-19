# Runtime Settings Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected web form for updating translation runtime settings without exposing or editing model API keys.

**Architecture:** Keep validation in the existing translation config service. Add a small protected route handler that parses form data into positive integers, calls `updateSettings()`, and redirects back to `/admin`; render the form inside the existing operations overview.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM, PostgreSQL, Vitest, Testing Library.

---

## File Structure

- Create `src/app/api/admin/settings/route.ts` for the protected POST handler.
- Create `tests/integration/admin-settings-route.test.ts` for authenticated update, unauthenticated redirect, and invalid input.
- Modify `src/app/(app)/admin/operations-overview.tsx` to render the runtime settings form.
- Modify `tests/unit/admin-overview.test.tsx` to assert form fields and action.
- Modify `src/app/globals.css` for form layout.
- Modify `README.md` and roadmap status after verification.

## Task 1: Protected Settings POST Route

**Files:**
- Create: `src/app/api/admin/settings/route.ts`
- Create: `tests/integration/admin-settings-route.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create tests that:

- Mock `next/headers` cookies.
- Create an admin user/session and submit form data.
- Assert settings are updated and response redirects to `/admin?settings=updated`.
- Assert unauthenticated requests redirect to `/login`.
- Assert invalid numeric values redirect to `/admin?settings=invalid`.

- [ ] **Step 2: Run red test**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-settings-route.test.ts
```

Expected: FAIL because `src/app/api/admin/settings/route.ts` does not exist.

- [ ] **Step 3: Implement route**

Add `POST(request)` that requires current user, parses form data, calls `createTranslationConfigService(createTranslationConfigRepository(db)).updateSettings(...)`, and redirects to `/admin?settings=updated` or `/admin?settings=invalid`.

- [ ] **Step 4: Run route tests and typecheck**

Run the target integration test and `corepack pnpm typecheck`.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/admin/settings/route.ts tests/integration/admin-settings-route.test.ts
git commit -m "feat: update runtime settings from admin"
```

## Task 2: Settings Form UI

**Files:**
- Modify: `src/app/(app)/admin/operations-overview.tsx`
- Modify: `tests/unit/admin-overview.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing UI assertions**

Update the admin overview test to expect a form with action `/api/admin/settings`, numeric inputs for runtime settings, and button `保存运行设置`.

- [ ] **Step 2: Run red UI test**

Run `corepack pnpm test -- tests/unit/admin-overview.test.tsx`.

Expected: FAIL because the form is not rendered yet.

- [ ] **Step 3: Implement form**

Render a POST form in the runtime settings card. Use current overview values as defaults. Keep daily token limit blank when unset.

- [ ] **Step 4: Run UI checks**

Run target UI test, `corepack pnpm typecheck`, and `corepack pnpm lint`.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(app)/admin/operations-overview.tsx src/app/globals.css tests/unit/admin-overview.test.tsx
git commit -m "feat: render runtime settings form"
```

## Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Document runtime settings form**

Document that `/admin` can update runtime numeric settings but not model API keys.

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
git commit -m "docs: describe runtime settings admin"
```

## Self-Review

- Spec coverage: Covers Phase 5 provider/settings management for numeric runtime settings. Provider/API key editing remains deferred because it needs a separate secure secret-entry flow.
- Placeholder scan: No placeholder steps remain.
- Type consistency: Existing `TranslationRuntimeSettings` and `updateSettings()` remain the source of truth.
