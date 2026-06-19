# Prompt Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected `/admin` workflow for activating new translation prompt versions from the web UI.

**Architecture:** Reuse the existing `TranslationConfigService.activatePrompt()` validation, normalization, fingerprinting, and version activation behavior. Add a protected POST route that accepts system prompt and user prompt template, then render the active prompt metadata plus a two-textarea activation form on the operations page.

**Tech Stack:** Next.js App Router route handlers, Drizzle/PostgreSQL repositories, Vitest integration tests, React component tests.

---

### Task 1: Protected Prompt Activation Route

**Files:**
- Create: `src/app/api/admin/prompt/route.ts`
- Create: `tests/integration/admin-prompt-route.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/admin-prompt-route.test.ts` that:
- authenticates a test admin using the existing session cookie mock;
- posts `systemPrompt` and `userPromptTemplate` to `/api/admin/prompt`;
- expects a `303` redirect to `/admin?prompt=updated`;
- asserts the active prompt row is versioned and normalized;
- asserts unauthenticated requests redirect to `/login`;
- asserts invalid prompt templates without `{{sourceText}}` redirect to `/admin?prompt=invalid` without creating a prompt version.

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-prompt-route.test.ts
```

Expected: FAIL because `@/app/api/admin/prompt/route` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/admin/prompt/route.ts` with:
- `POST(request: Request)`;
- `getCurrentUser()` authentication;
- form parsing for `systemPrompt` and `userPromptTemplate`;
- `createTranslationConfigService(createTranslationConfigRepository(db)).activatePrompt(...)`;
- success redirect `/admin?prompt=updated`;
- invalid redirect `/admin?prompt=invalid`;
- login redirect for unauthenticated requests.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-prompt-route.test.ts
corepack pnpm typecheck
corepack pnpm lint
```

Commit:

```powershell
git add src/app/api/admin/prompt/route.ts tests/integration/admin-prompt-route.test.ts
git commit -m "feat: activate prompt from admin"
```

### Task 2: Prompt Form On Operations Page

**Files:**
- Modify: `src/app/(app)/admin/operations-overview.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/admin-overview.test.tsx`
- Modify: `src/modules/operations/types.ts`
- Modify: `src/db/repositories/operations-repository.ts`
- Modify: `tests/integration/operations-repository.test.ts`

- [ ] **Step 1: Expose safe active prompt text**

Extend `OperationsVersionStatus` for prompts with `systemPrompt` and `userPromptTemplate`, selected explicitly by `operations-repository`. Add integration expectations that the active prompt text is present in overview data. Do not expose any provider secrets.

- [ ] **Step 2: Render and test the prompt form**

Extend the component test to assert:
- form `aria-label="Prompt 表单"`;
- action `/api/admin/prompt`;
- `System prompt` textarea defaults to the active system prompt;
- `User prompt template` textarea defaults to the active template;
- submit button `激活 Prompt`.

Run the component test and verify it fails before implementation.

- [ ] **Step 3: Implement the UI**

Render a prompt activation form inside the version status card. Use two textareas, method POST, and a short help text that the user template must contain `{{sourceText}}`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/operations-repository.test.ts
corepack pnpm typecheck
corepack pnpm lint
```

Commit:

```powershell
git add "src/app/(app)/admin/operations-overview.tsx" src/app/globals.css src/modules/operations/types.ts src/db/repositories/operations-repository.ts tests/unit/admin-overview.test.tsx tests/integration/operations-repository.test.ts
git commit -m "feat: render prompt admin form"
```

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Update docs**

Document that `/admin` can activate new versioned Prompt snapshots, and that the user prompt template must contain `{{sourceText}}`.

- [ ] **Step 2: Run full verification**

Run the full lint, typecheck, unit, integration, E2E seed, E2E, and build suite used by previous Phase 5 increments.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-prompt-admin.md
git commit -m "docs: describe prompt admin"
```

---

## Self-Review

- Spec coverage: Covers the remaining web Prompt settings piece for Phase 5 provider/model/Prompt/daily-budget settings.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Uses existing `activatePrompt`, `activePrompt`, `systemPrompt`, and `userPromptTemplate` names.
