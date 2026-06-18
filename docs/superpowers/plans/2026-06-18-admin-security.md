# Admin Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated web controls for changing the single-user password and revoking other active sessions from `/admin`.

**Architecture:** Reuse the existing auth repository and service instead of introducing a second account system. Password changes require the current password, update the Argon2id hash inside the existing transactional password-replacement path, revoke all sessions, clear the current cookie, and redirect to login. Session revocation keeps the current session and deletes only other sessions for the admin user.

**Tech Stack:** Next.js App Router route handlers, Drizzle ORM, PostgreSQL sessions table, Argon2id password helpers, React server-rendered admin form, Vitest unit and integration tests.

---

## File Structure

- Modify `src/modules/auth/types.ts`: add repository methods for deleting other sessions.
- Modify `src/db/repositories/auth-repository.ts`: implement session deletion with `ne(sessions.tokenHash, currentTokenHash)`.
- Modify `src/modules/auth/auth-service.ts`: add `changeAdminPassword(currentPassword, newPassword)`.
- Modify `src/modules/operations/types.ts`: add `security.activeSessionCount`.
- Modify `src/db/repositories/operations-repository.ts`: load active non-expired admin sessions for the `/admin` overview.
- Create `src/app/api/admin/password/route.ts`: authenticated password-change form handler.
- Create `src/app/api/admin/sessions/route.ts`: authenticated "revoke other sessions" handler.
- Modify `src/app/(app)/admin/operations-overview.tsx`: render the security card with password and session forms.
- Modify `tests/integration/auth-repository.test.ts`: cover deleting other sessions.
- Modify `tests/integration/admin-password.test.ts`: cover current-password-gated password changes.
- Create `tests/integration/admin-password-route.test.ts`: cover route redirects, cookie clearing, and invalid submissions.
- Create `tests/integration/admin-sessions-route.test.ts`: cover revoking other sessions and unauthenticated redirects.
- Modify `tests/integration/operations-repository.test.ts`: cover `security.activeSessionCount`.
- Modify `tests/unit/admin-overview.test.tsx`: cover rendered security forms.
- Modify `README.md` and roadmap docs after implementation.

### Task 1: Auth Session And Password Primitives

**Files:**
- Modify: `tests/integration/auth-repository.test.ts`
- Modify: `tests/integration/admin-password.test.ts`
- Modify: `src/modules/auth/types.ts`
- Modify: `src/db/repositories/auth-repository.ts`
- Modify: `src/modules/auth/auth-service.ts`

- [x] **Step 1: Write failing repository and service tests**

Add an auth repository test that creates two sessions for the admin and asserts `deleteOtherSessionsForUser(user.id, currentTokenHash)` deletes only the other token hash. Add an auth service test that:
- creates password `current password value`;
- creates a session;
- calls `changeAdminPassword("wrong password", "new password value")` and expects `null` plus the original session still present;
- calls `changeAdminPassword("current password value", "new password value")` and expects a changed password hash plus all sessions revoked.

- [x] **Step 2: Run tests to verify failure**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/auth-repository.test.ts tests/integration/admin-password.test.ts
```

Expected: FAIL because the new repository and service methods do not exist.

- [x] **Step 3: Implement primitives**

Add to `AuthRepository`:

```ts
deleteOtherSessionsForUser(
  userId: string,
  currentTokenHash: string,
): Promise<void>;
```

Implement it with:

```ts
await db
  .delete(sessions)
  .where(
    and(
      eq(sessions.userId, userId),
      ne(sessions.tokenHash, currentTokenHash),
    ),
  );
```

Add to `createAuthService()`:

```ts
async changeAdminPassword(currentPassword: string, newPassword: string) {
  const admin = await authenticateAdmin(currentPassword);
  if (!admin) return null;

  const passwordHash = await hashPassword(newPassword);
  return repository.replaceAdminPasswordAndRevokeSessions(passwordHash);
}
```

- [x] **Step 4: Verify and commit**

Run the same integration command, then:

```powershell
corepack pnpm typecheck
corepack pnpm lint
git add src/modules/auth/types.ts src/db/repositories/auth-repository.ts src/modules/auth/auth-service.ts tests/integration/auth-repository.test.ts tests/integration/admin-password.test.ts
git commit -m "feat: add admin security primitives"
```

Verification note: the targeted integration command was blocked before Vitest by
`EPERM: operation not permitted, lstat 'C:\Users\admin'`, and the sandbox-outside
rerun request was rejected because the current Codex usage limit had been
reached. `corepack pnpm typecheck` and `corepack pnpm lint` passed after the
implementation.

### Task 2: Admin Password Route

**Files:**
- Create: `tests/integration/admin-password-route.test.ts`
- Create: `src/app/api/admin/password/route.ts`

- [x] **Step 1: Write failing route tests**

Test three behaviors:
- authenticated valid form changes the password, revokes the current session, clears `shopify_docs_session`, and redirects to `/login?password=updated`;
- wrong current password redirects to `/admin?password=invalid` and keeps the session;
- missing session redirects to `/login`.

- [x] **Step 2: Run test to verify failure**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-password-route.test.ts
```

Expected: FAIL because `@/app/api/admin/password/route` does not exist.

- [x] **Step 3: Implement route**

Create `POST(request: Request)` that:
- calls `getCurrentUser()` and redirects unauthenticated requests to `/login`;
- reads `currentPassword`, `newPassword`, and `confirmPassword` from `FormData`;
- rejects missing fields or mismatched confirmation with `/admin?password=invalid`;
- calls `createAuthService(createAuthRepository(db)).changeAdminPassword(currentPassword, newPassword)`;
- redirects failed authentication or password validation to `/admin?password=invalid`;
- redirects success to `/login?password=updated` and deletes `SESSION_COOKIE_NAME`.

- [x] **Step 4: Verify and commit**

Run the route test, `corepack pnpm typecheck`, and `corepack pnpm lint`, then:

```powershell
git add src/app/api/admin/password/route.ts tests/integration/admin-password-route.test.ts
git commit -m "feat: change admin password from web"
```

Verification note: `corepack pnpm typecheck` first failed because
`@/app/api/admin/password/route` did not exist. After implementation,
`corepack pnpm typecheck` and `corepack pnpm lint` passed. Targeted integration
execution remains blocked by the current sandbox/usage-limit condition recorded
in Task 1.

### Task 3: Admin Session Revocation Route And Overview Count

**Files:**
- Create: `tests/integration/admin-sessions-route.test.ts`
- Modify: `tests/integration/operations-repository.test.ts`
- Create: `src/app/api/admin/sessions/route.ts`
- Modify: `src/modules/operations/types.ts`
- Modify: `src/db/repositories/operations-repository.ts`

- [x] **Step 1: Write failing tests**

Route test:
- authenticated request with two active sessions deletes the other session but keeps the current token hash;
- missing session redirects to `/login`.

Operations repository test:
- insert one admin user, two unexpired sessions, and one expired session;
- assert `overview.security.activeSessionCount` is `2`.

- [x] **Step 2: Run tests to verify failure**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/admin-sessions-route.test.ts tests/integration/operations-repository.test.ts
```

Expected: FAIL because the sessions route and `security` overview field do not exist.

- [x] **Step 3: Implement route and overview count**

Create `POST()` in `src/app/api/admin/sessions/route.ts` that:
- reads the current session cookie;
- looks up the stored session by `hashSessionToken(token)`;
- redirects missing/expired sessions to `/login`;
- calls `deleteOtherSessionsForUser(session.user.id, currentTokenHash)`;
- redirects to `/admin?sessions=revoked`.

Extend `OperationsOverview` with:

```ts
security: {
  activeSessionCount: number;
};
```

Load the count with a `count(*)::int` query over `sessions` joined to `users`, where `users.username = "admin"` and `sessions.expiresAt > now`.

- [x] **Step 4: Verify and commit**

Run the same integration command, `corepack pnpm typecheck`, and `corepack pnpm lint`, then:

```powershell
git add src/app/api/admin/sessions/route.ts src/modules/operations/types.ts src/db/repositories/operations-repository.ts tests/integration/admin-sessions-route.test.ts tests/integration/operations-repository.test.ts
git commit -m "feat: revoke other admin sessions"
```

Verification note: `corepack pnpm typecheck` first failed because
`@/app/api/admin/sessions/route` and `overview.security` did not exist. After
implementation, `corepack pnpm typecheck`, `corepack pnpm lint`, and
`corepack pnpm test -- tests/unit/admin-overview.test.tsx tests/unit/operations-alerts.test.ts`
passed. Targeted integration execution remains blocked by the current
sandbox/usage-limit condition recorded in Task 1.

### Task 4: Admin Security UI

**Files:**
- Modify: `tests/unit/admin-overview.test.tsx`
- Modify: `src/app/(app)/admin/operations-overview.tsx`

- [ ] **Step 1: Write failing UI test**

Extend the overview fixture with:

```ts
security: { activeSessionCount: 2 }
```

Assert that:
- a form named `登录密码表单` posts to `/api/admin/password`;
- `Current password`, `New password`, and `Confirm new password` inputs are password inputs and empty;
- a form named `会话管理表单` posts to `/api/admin/sessions`;
- the active session count `2` is rendered;
- the revoke button is rendered.

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
```

Expected: FAIL because the security forms are not rendered.

- [ ] **Step 3: Implement UI**

Add a security card near the top of the operations grid:
- render `overview.security.activeSessionCount`;
- render a password form with `currentPassword`, `newPassword`, `confirmPassword`;
- use `autoComplete="current-password"` for the current field and `autoComplete="new-password"` for both new-password fields;
- render a session form with `action="/api/admin/sessions"` and method `post`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
corepack pnpm typecheck
corepack pnpm lint
git add src/app/\(app\)/admin/operations-overview.tsx tests/unit/admin-overview.test.tsx
git commit -m "feat: render admin security controls"
```

### Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-18-admin-security.md`

- [ ] **Step 1: Update docs**

Document that `/admin` supports changing the single-user password, clears/revokes sessions after password change, and can revoke other active sessions.

- [ ] **Step 2: Run full available verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm db:migrate
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; $env:E2E_ADMIN_PASSWORD='phase-one-test-password'; corepack pnpm test:e2e:seed
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Run browser E2E if the sandbox permits it; record the existing `EPERM: operation not permitted, lstat 'C:\Users\admin'` blocker if it recurs.

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md docs/superpowers/plans/2026-06-18-admin-security.md
git commit -m "docs: describe admin security controls"
```

---

## Self-Review

- Spec coverage: Covers password/session administration from Phase 5 without adding multi-user roles.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: `security.activeSessionCount`, `changeAdminPassword`, and `deleteOtherSessionsForUser` are named consistently across tests, routes, repository, and UI.
