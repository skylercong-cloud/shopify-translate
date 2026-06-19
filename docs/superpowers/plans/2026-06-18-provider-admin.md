# Provider Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected `/admin` workflow for updating DeepSeek and Qwen provider settings without exposing plaintext or encrypted API keys.

**Architecture:** Reuse the existing translation configuration service for provider validation, API-key encryption, and key hints. Add a protected App Router POST endpoint for provider form submissions, then render one compact provider form per configured provider on the operations page. Keep API-key replacement explicit: an empty key field means "do not submit", and the route requires a key for this first secure web configuration increment.

**Tech Stack:** Next.js App Router route handlers, Drizzle/PostgreSQL repositories, Vitest integration and component tests, existing AES-GCM secret encryption utilities.

---

### Task 1: Protected Provider Update Route

**Files:**
- Create: `src/app/api/admin/providers/route.ts`
- Create: `tests/integration/admin-provider-route.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/admin-provider-route.test.ts` that:
- authenticates a test admin through the existing session cookie mock;
- posts provider, model ID, base URL, enabled flag, and API key to `/api/admin/providers`;
- expects a `303` redirect to `/admin?providers=updated`;
- asserts the database row is upserted with the submitted public fields and a `keyHint`;
- decrypts `encryptedApiKey` with the test master key and confirms the plaintext is stored only inside the encrypted envelope;
- asserts unauthenticated requests redirect to `/login`;
- asserts invalid provider/base URL/API key redirects to `/admin?providers=invalid`.

Use the same database safety guard and session helper style as `tests/integration/admin-settings-route.test.ts`.

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-provider-route.test.ts
```

Expected: FAIL because `@/app/api/admin/providers/route` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/admin/providers/route.ts` with:
- `POST(request: Request)`;
- `getCurrentUser()` authentication;
- `redirectTo("/login")` for unauthenticated requests;
- form parsing for `provider`, `modelId`, `baseUrl`, `apiKey`, and checkbox-style `enabled`;
- `decodeMasterKey(getEnv().MODEL_KEY_ENCRYPTION_KEY ?? "")`;
- `createTranslationConfigService(createTranslationConfigRepository(db)).configureProvider(..., masterKey)`;
- success redirect `/admin?providers=updated`;
- catch-all invalid redirect `/admin?providers=invalid`.

Provider parsing must only allow `deepseek` or `qwen`. The route must never include the API key or encrypted payload in redirects, errors, or response bodies.

- [ ] **Step 4: Run route test, typecheck, and commit**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-provider-route.test.ts
corepack pnpm typecheck
```

Commit:

```powershell
git add src/app/api/admin/providers/route.ts tests/integration/admin-provider-route.test.ts
git commit -m "feat: update providers from admin"
```

### Task 2: Provider Forms On Operations Page

**Files:**
- Modify: `src/app/(app)/admin/operations-overview.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/admin-overview.test.tsx`

- [ ] **Step 1: Write the failing component test**

Extend `tests/unit/admin-overview.test.tsx` to assert:
- each provider card contains a form named `deepseek provider form` or `qwen provider form`;
- the form posts to `/api/admin/providers`;
- hidden provider input is present;
- model ID and base URL fields default to the current public values;
- API key field is empty and uses password input type;
- enabled checkbox reflects the current enabled state;
- submit button text is `保存 provider 设置`.

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
```

Expected: FAIL because provider forms are not rendered.

- [ ] **Step 3: Implement the provider forms**

Add a `ProviderAdminForm` component to `src/app/(app)/admin/operations-overview.tsx`. Render it inside `ProviderCard` after the safe provider metadata. Use:
- `action="/api/admin/providers"`;
- `method="post"`;
- hidden `provider`;
- `modelId` text input;
- `baseUrl` URL input;
- `apiKey` password input with placeholder indicating replacement;
- `enabled` checkbox.

The page must continue to render only `keyHint`, never encrypted or plaintext keys.

- [ ] **Step 4: Add styling and verify**

Extend the existing operations form CSS so provider forms use the same visual language as runtime and glossary forms.

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
corepack pnpm typecheck
corepack pnpm lint
```

Commit:

```powershell
git add "src/app/(app)/admin/operations-overview.tsx" src/app/globals.css tests/unit/admin-overview.test.tsx
git commit -m "feat: render provider admin forms"
```

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Update docs**

Document that `/admin` can update model provider base URL, model ID, enabled state, and replace API keys. Note that existing keys are represented only as hints and are never displayed.

- [ ] **Step 2: Run full verification**

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

If E2E hits `EPERM: operation not permitted, lstat 'C:\Users\admin'` in the sandbox, rerun the same E2E command with escalation.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-provider-admin.md
git commit -m "docs: describe provider admin"
```

---

## Self-Review

- Spec coverage: Covers Phase 5 provider/model settings and API-key edit screens. It intentionally does not implement prompt editing, translation correction UI, session administration, or backups.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Uses existing `TranslationProvider`, `configureProvider`, `OperationsProviderStatus`, and current operations page form conventions.
