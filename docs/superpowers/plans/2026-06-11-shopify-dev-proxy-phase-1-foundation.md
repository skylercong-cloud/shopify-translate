# Shopify.dev Proxy Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable Next.js/PostgreSQL foundation with secure single-user
authentication, protected application routes, health checks, and a test harness ready
for the ingestion and translation phases.

**Architecture:** Use one Next.js App Router codebase organized by feature modules.
Drizzle owns the PostgreSQL schema and repositories. Authentication stores only an
Argon2id password hash and SHA-256 hashes of random session tokens. Server components
protect the application layout; route handlers expose login, logout, health, and
readiness endpoints.

**Tech Stack:** Node.js 20.19 or newer, pnpm, Next.js 16.2.2, React, TypeScript,
PostgreSQL 16, Drizzle ORM, Zod, `@node-rs/argon2`, Vitest, Testing Library,
Playwright, Docker Compose.

---

## Planned File Structure

```text
.
|-- compose.yaml
|-- drizzle.config.ts
|-- eslint.config.mjs
|-- next.config.ts
|-- package.json
|-- playwright.config.ts
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- vitest.config.ts
|-- vitest.integration.config.ts
|-- public/
|   `-- robots.txt
|-- scripts/
|   `-- seed-e2e-admin.ts
|-- src/
|   |-- app/
|   |   |-- (app)/
|   |   |   |-- layout.tsx
|   |   |   `-- page.tsx
|   |   |-- api/
|   |   |   |-- auth/
|   |   |   |   |-- login/route.ts
|   |   |   |   `-- logout/route.ts
|   |   |   `-- health/
|   |   |       |-- live/route.ts
|   |   |       `-- ready/route.ts
|   |   |-- login/
|   |   |   |-- login-form.tsx
|   |   |   `-- page.tsx
|   |   |-- globals.css
|   |   `-- layout.tsx
|   |-- cli/
|   |   `-- admin.ts
|   |-- db/
|   |   |-- client.ts
|   |   |-- migrate.ts
|   |   |-- schema/
|   |   |   |-- auth.ts
|   |   |   `-- index.ts
|   |   `-- repositories/
|   |       `-- auth-repository.ts
|   |-- lib/
|   |   `-- env.ts
|   `-- modules/
|       `-- auth/
|           |-- auth-service.ts
|           |-- constants.ts
|           |-- cookies.ts
|           |-- password.ts
|           |-- session.ts
|           `-- types.ts
|-- tests/
|   |-- e2e/
|   |   `-- auth.spec.ts
|   |-- fixtures/
|   |   `-- env.ts
|   |-- integration/
|   |   |-- auth-repository.test.ts
|   |   `-- health-ready.test.ts
|   |-- unit/
|   |   |-- env.test.ts
|   |   |-- password.test.ts
|   |   `-- session.test.ts
|   `-- setup.ts
`-- drizzle/
    `-- 0000_foundation.sql
```

## Task 1: Scaffold The Application And Test Harness

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/page.tsx`
- Test: `tests/unit/home-page.test.tsx`

- [ ] **Step 1: Create the package manifest and TypeScript configuration**

Create `package.json`:

```json
{
  "name": "shopify-dev-chinese-proxy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "test:watch": "vitest --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "admin": "tsx src/cli/admin.ts"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
```

Create `eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
```

- [ ] **Step 2: Install the exact application categories and commit the lockfile**

Run:

```bash
corepack enable
pnpm add next@16.2.2 react react-dom drizzle-orm pg zod @node-rs/argon2 @inquirer/prompts
pnpm add -D typescript @types/node @types/react @types/react-dom @types/pg drizzle-kit tsx eslint eslint-config-next vitest jsdom @vitejs/plugin-react @testing-library/react @testing-library/dom @testing-library/jest-dom @playwright/test
```

Expected:

- `pnpm-lock.yaml` is created.
- Installation exits with code `0`.
- `pnpm exec next --version` reports `16.2.2`.

- [ ] **Step 3: Create the test configuration**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});
```

Create `vitest.integration.config.ts`:

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
```

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000/api/health/live",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

- [ ] **Step 4: Write the failing home-page test**

Create `tests/unit/home-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("identifies the application as a private Shopify documentation reader", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: "Shopify 开发文档中文阅读器",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("仅供个人使用")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run:

```bash
pnpm test -- tests/unit/home-page.test.tsx
```

Expected: FAIL because `src/app/page.tsx` does not exist.

- [ ] **Step 6: Add the minimal application shell**

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Shopify 开发文档中文阅读器",
  description: "个人使用的 Shopify 开发文档翻译与检索工具",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

Create `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="landing">
      <p className="eyebrow">仅供个人使用</p>
      <h1>Shopify 开发文档中文阅读器</h1>
      <p>登录后访问已同步的英文原文、中文译文和统一搜索。</p>
    </main>
  );
}
```

Create `src/app/globals.css`:

```css
:root {
  color-scheme: light;
  --background: #f2f6f4;
  --surface: #ffffff;
  --text: #17231e;
  --muted: #68756f;
  --brand: #147a5a;
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background: var(--background);
}

button,
input {
  font: inherit;
}

.landing {
  width: min(720px, calc(100% - 40px));
  margin: 18vh auto 0;
  padding: 40px;
  border-radius: 20px;
  background: var(--surface);
}

.eyebrow {
  color: var(--brand);
  font-weight: 700;
}
```

- [ ] **Step 7: Run baseline verification**

Run:

```bash
pnpm test -- tests/unit/home-page.test.tsx
pnpm typecheck
pnpm build
```

Expected: all commands exit `0`; the unit test reports `1 passed`.

- [ ] **Step 8: Commit the scaffold**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts eslint.config.mjs vitest.config.ts vitest.integration.config.ts playwright.config.ts tests/setup.ts tests/unit/home-page.test.tsx src/app
git commit -m "chore: scaffold application foundation"
```

## Task 2: Validate Environment Configuration

**Files:**

- Create: `.env.example`
- Create: `src/lib/env.ts`
- Create: `tests/fixtures/env.ts`
- Test: `tests/unit/env.test.ts`

- [ ] **Step 1: Write the failing environment tests**

Create `tests/fixtures/env.ts`:

```ts
export const validEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://app:app@127.0.0.1:5432/shopify_docs_test",
  APP_ORIGIN: "http://127.0.0.1:3000",
  SESSION_DAYS: "30",
};
```

Create `tests/unit/env.test.ts`:

```ts
import { validEnv } from "../fixtures/env";

import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("parses the required application settings", () => {
    expect(parseEnv(validEnv)).toMatchObject({
      DATABASE_URL: validEnv.DATABASE_URL,
      APP_ORIGIN: validEnv.APP_ORIGIN,
      SESSION_DAYS: 30,
    });
  });

  it("rejects an invalid origin", () => {
    expect(() =>
      parseEnv({ ...validEnv, APP_ORIGIN: "not-a-url" }),
    ).toThrow("APP_ORIGIN");
  });

  it("rejects a non-positive session duration", () => {
    expect(() =>
      parseEnv({ ...validEnv, SESSION_DAYS: "0" }),
    ).toThrow("SESSION_DAYS");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm test -- tests/unit/env.test.ts
```

Expected: FAIL because `@/lib/env` does not exist.

- [ ] **Step 3: Implement typed environment parsing**

Create `src/lib/env.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url(),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv | Record<string, string>) {
  return envSchema.parse(input);
}

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
```

Create `.env.example`:

```dotenv
NODE_ENV=development
DATABASE_URL=postgres://app:app@127.0.0.1:5432/shopify_docs
APP_ORIGIN=http://127.0.0.1:3000
SESSION_DAYS=30
```

- [ ] **Step 4: Run the environment tests**

Run:

```bash
pnpm test -- tests/unit/env.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Commit environment validation**

```bash
git add .env.example src/lib/env.ts tests/fixtures/env.ts tests/unit/env.test.ts
git commit -m "feat: validate application environment"
```

## Task 3: Add PostgreSQL, Drizzle, And The Auth Schema

**Files:**

- Create: `compose.yaml`
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/schema/auth.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/repositories/auth-repository.ts`
- Create: `drizzle/0000_foundation.sql`
- Test: `tests/integration/auth-repository.test.ts`

- [ ] **Step 1: Add the local PostgreSQL service**

Create `compose.yaml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: shopify_docs
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d shopify_docs"]
      interval: 2s
      timeout: 3s
      retries: 20
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Start it:

```bash
docker compose up -d db
docker compose ps
```

Expected: service `db` becomes `healthy`.

- [ ] **Step 2: Write the failing repository integration test**

Create `tests/integration/auth-repository.test.ts`:

```ts
import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import {
  createAuthRepository,
} from "@/db/repositories/auth-repository";
import { sessions, users } from "@/db/schema";

const repository = createAuthRepository(db);
const createdUserIds: string[] = [];

beforeAll(async () => {
  await db.execute(sql`select 1`);
});

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(users).where(eq(users.id, createdUserIds.pop()!));
});

describe("auth repository", () => {
  it("upserts the single admin and creates a session", async () => {
    const user = await repository.upsertAdminPassword("hash-value");
    createdUserIds.push(user.id);

    const expiresAt = new Date(Date.now() + 60_000);
    await repository.createSession({
      id: randomUUID(),
      tokenHash: "a".repeat(64),
      userId: user.id,
      expiresAt,
    });

    const stored = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.userId, user.id),
        eq(sessions.tokenHash, "a".repeat(64)),
      ),
    });

    expect(user.username).toBe("admin");
    expect(stored?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });
});
```

- [ ] **Step 3: Run the integration test to verify it fails**

Run:

```bash
pnpm test:integration -- tests/integration/auth-repository.test.ts
```

Expected: FAIL because the database modules and schema do not exist.

- [ ] **Step 4: Define the Drizzle schema**

Create `src/db/schema/auth.ts`:

```ts
import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));
```

Create `src/db/schema/index.ts`:

```ts
export * from "./auth";
```

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 5: Add database connection and migrations**

Create `src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "@/lib/env";

import * as schema from "./schema";

const pool = new Pool({
  connectionString: getEnv().DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });
export { pool };
```

Create `src/db/migrate.ts`:

```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./client";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Generate and apply the migration:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm db:generate -- --name foundation
pnpm db:migrate
```

Expected:

- `drizzle/0000_foundation.sql` and Drizzle metadata are generated.
- Migration exits `0`.
- Tables `users` and `sessions` exist.

- [ ] **Step 6: Implement the auth repository**

Create `src/db/repositories/auth-repository.ts`:

```ts
import { eq, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { sessions, users } from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export function createAuthRepository(db: Database) {
  return {
    async upsertAdminPassword(passwordHash: string) {
      const [user] = await db
        .insert(users)
        .values({ username: "admin", passwordHash })
        .onConflictDoUpdate({
          target: users.username,
          set: { passwordHash, updatedAt: new Date() },
        })
        .returning();
      return user;
    },

    findAdmin() {
      return db.query.users.findFirst({
        where: eq(users.username, "admin"),
      });
    },

    async createSession(input: typeof sessions.$inferInsert) {
      const [session] = await db.insert(sessions).values(input).returning();
      return session;
    },

    findSessionByTokenHash(tokenHash: string) {
      return db.query.sessions.findFirst({
        where: eq(sessions.tokenHash, tokenHash),
        with: {
          user: true,
        },
      });
    },

    async deleteSessionByTokenHash(tokenHash: string) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteSessionsForUser(userId: string) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },

    async deleteExpiredSessions(now: Date) {
      await db.delete(sessions).where(lt(sessions.expiresAt, now));
    },
  };
}
```

- [ ] **Step 7: Run the repository test**

Run:

```bash
pnpm test:integration -- tests/integration/auth-repository.test.ts
```

Expected: `1 passed`.

- [ ] **Step 8: Commit database foundation**

```bash
git add compose.yaml drizzle.config.ts drizzle src/db tests/integration/auth-repository.test.ts .env.example
git commit -m "feat: add PostgreSQL auth persistence"
```

## Task 4: Implement Password Hashing And The Admin Password CLI

**Files:**

- Create: `src/modules/auth/password.ts`
- Create: `src/modules/auth/auth-service.ts`
- Create: `src/cli/admin.ts`
- Test: `tests/unit/password.test.ts`
- Test: `tests/integration/admin-password.test.ts`

- [ ] **Step 1: Write failing password tests**

Create `tests/unit/password.test.ts`:

```ts
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/modules/auth/password";

describe("password helpers", () => {
  it("hashes with Argon2id and verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toContain("$argon2id$");
    await expect(
      verifyPassword(hash, "correct horse battery staple"),
    ).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("requires at least 12 characters", () => {
    expect(() => validatePasswordStrength("too-short")).toThrow(
      "at least 12 characters",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm test -- tests/unit/password.test.ts
```

Expected: FAIL because `password.ts` does not exist.

- [ ] **Step 3: Implement password hashing**

Create `src/modules/auth/password.ts`:

```ts
import { Algorithm, hash, verify } from "@node-rs/argon2";

const MINIMUM_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(password: string) {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error("Password must contain at least 12 characters");
  }
}

export async function hashPassword(password: string) {
  validatePasswordStrength(password);
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}
```

- [ ] **Step 4: Run password tests**

Run:

```bash
pnpm test -- tests/unit/password.test.ts
```

Expected: `2 passed`.

- [ ] **Step 5: Write the failing password-reset integration test**

Create `tests/integration/admin-password.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { createAuthService } from "@/modules/auth/auth-service";

const repository = createAuthRepository(db);
const service = createAuthService(repository);

afterEach(async () => {
  await db.delete(users);
});

describe("setAdminPassword", () => {
  it("replaces the password hash and revokes existing sessions", async () => {
    await service.setAdminPassword("first password value");
    const first = await repository.findAdmin();
    await repository.createSession({
      id: "00000000-0000-4000-8000-000000000001",
      tokenHash: "b".repeat(64),
      userId: first!.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.setAdminPassword("second password value");
    const second = await repository.findAdmin();
    const revoked = await db.query.sessions.findFirst();

    expect(first?.id).toBe(second?.id);
    expect(first?.passwordHash).not.toBe(second?.passwordHash);
    expect(revoked).toBeUndefined();
  });
});
```

- [ ] **Step 6: Implement the auth service and CLI**

Create `src/modules/auth/types.ts`:

```ts
export interface AuthRepository {
  upsertAdminPassword(passwordHash: string): Promise<{
    id: string;
    username: string;
    passwordHash: string;
  }>;
  findAdmin(): Promise<
    | {
        id: string;
        username: string;
        passwordHash: string;
      }
    | undefined
  >;
  deleteSessionsForUser(userId: string): Promise<void>;
}
```

Create `src/modules/auth/auth-service.ts`:

```ts
import { hashPassword, verifyPassword } from "./password";
import type { AuthRepository } from "./types";

export function createAuthService(repository: AuthRepository) {
  return {
    async setAdminPassword(password: string) {
      const passwordHash = await hashPassword(password);
      const user = await repository.upsertAdminPassword(passwordHash);
      await repository.deleteSessionsForUser(user.id);
      return user;
    },

    async authenticateAdmin(password: string) {
      const admin = await repository.findAdmin();
      if (!admin) return null;
      const valid = await verifyPassword(admin.passwordHash, password);
      return valid ? admin : null;
    },
  };
}
```

Create `src/cli/admin.ts`:

```ts
import { password } from "@inquirer/prompts";

import { db, pool } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createAuthService } from "@/modules/auth/auth-service";

async function setPassword() {
  const first = await password({
    message: "Enter the new admin password",
    mask: "*",
  });
  const second = await password({
    message: "Enter the password again",
    mask: "*",
  });

  if (first !== second) {
    throw new Error("Passwords do not match");
  }

  const service = createAuthService(createAuthRepository(db));
  await service.setAdminPassword(first);
  console.log("Admin password updated.");
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command !== "set-password") {
    throw new Error("Usage: pnpm admin set-password");
  }
  await setPassword();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
```

- [ ] **Step 7: Run password-service verification**

Run:

```bash
pnpm test -- tests/unit/password.test.ts
pnpm test:integration -- tests/integration/admin-password.test.ts
```

Expected: unit tests report `2 passed`; integration test reports `1 passed`.

- [ ] **Step 8: Manually verify the interactive command**

Run:

```bash
pnpm admin set-password
```

Expected:

- Input is masked.
- Mismatched values fail without updating the password.
- Matching values print `Admin password updated.`

- [ ] **Step 9: Commit password administration**

```bash
git add src/modules/auth src/cli/admin.ts tests/unit/password.test.ts tests/integration/admin-password.test.ts
git commit -m "feat: add secure admin password setup"
```

## Task 5: Add Hashed Database Sessions

**Files:**

- Create: `src/modules/auth/constants.ts`
- Create: `src/modules/auth/session.ts`
- Modify: `src/modules/auth/types.ts`
- Modify: `src/db/repositories/auth-repository.ts`
- Test: `tests/unit/session.test.ts`
- Test: `tests/integration/session-repository.test.ts`

- [ ] **Step 1: Write failing session-token tests**

Create `tests/unit/session.test.ts`:

```ts
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "@/modules/auth/session";

describe("session helpers", () => {
  it("creates an opaque token and a stable SHA-256 hash", () => {
    const token = createSessionToken();

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("uses the configured day duration", () => {
    const now = new Date("2026-06-11T00:00:00.000Z");
    expect(sessionExpiresAt(now, 30).toISOString()).toBe(
      "2026-07-11T00:00:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm test -- tests/unit/session.test.ts
```

Expected: FAIL because `session.ts` does not exist.

- [ ] **Step 3: Implement session-token helpers**

Create `src/modules/auth/constants.ts`:

```ts
export const SESSION_COOKIE_NAME = "shopify_docs_session";
```

Create `src/modules/auth/session.ts`:

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiresAt(now: Date, sessionDays: number) {
  return new Date(now.getTime() + sessionDays * 24 * 60 * 60 * 1000);
}

export function newSessionRecord(
  token: string,
  userId: string,
  now: Date,
  sessionDays: number,
) {
  return {
    id: randomUUID(),
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt: sessionExpiresAt(now, sessionDays),
  };
}
```

- [ ] **Step 4: Extend the repository contract**

Add to `src/modules/auth/types.ts`:

```ts
export interface StoredSession {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  user: {
    id: string;
    username: string;
  };
}

export interface SessionRepository {
  createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<unknown>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | undefined>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}
```

Ensure `createAuthRepository()` satisfies both `AuthRepository` and
`SessionRepository`.

- [ ] **Step 5: Add the session-service integration test**

Create `tests/integration/session-repository.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { sessions, users } from "@/db/schema";
import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

const repository = createAuthRepository(db);

afterEach(async () => {
  await db.delete(users);
});

describe("database sessions", () => {
  it("looks up a session using only the token hash", async () => {
    const user = await repository.upsertAdminPassword("hash");
    const token = createSessionToken();
    await repository.createSession(
      newSessionRecord(token, user.id, new Date(), 30),
    );

    const stored = await repository.findSessionByTokenHash(
      hashSessionToken(token),
    );

    expect(stored?.tokenHash).not.toBe(token);
    expect(stored?.user.username).toBe("admin");
  });
});
```

- [ ] **Step 6: Run all session tests**

Run:

```bash
pnpm test -- tests/unit/session.test.ts
pnpm test:integration -- tests/integration/session-repository.test.ts
```

Expected: all session tests pass.

- [ ] **Step 7: Commit session primitives**

```bash
git add src/modules/auth src/db/repositories/auth-repository.ts tests/unit/session.test.ts tests/integration/session-repository.test.ts
git commit -m "feat: add hashed database sessions"
```

## Task 6: Implement Login, Logout, And Cookie Handling

**Files:**

- Create: `src/modules/auth/cookies.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/login/login-form.tsx`
- Create: `src/app/login/page.tsx`
- Modify: `src/modules/auth/auth-service.ts`
- Test: `tests/unit/cookies.test.ts`
- Test: `tests/integration/login-route.test.ts`

- [ ] **Step 1: Write failing cookie tests**

Create `tests/unit/cookies.test.ts`:

```ts
import { sessionCookieOptions } from "@/modules/auth/cookies";

describe("sessionCookieOptions", () => {
  it("returns secure production cookie settings", () => {
    expect(sessionCookieOptions(true, new Date("2026-07-11Z"))).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: new Date("2026-07-11Z"),
    });
  });
});
```

- [ ] **Step 2: Implement cookie settings**

Create `src/modules/auth/cookies.ts`:

```ts
export function sessionCookieOptions(secure: boolean, expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires,
  };
}
```

- [ ] **Step 3: Extend the auth service with login and logout**

Replace `src/modules/auth/auth-service.ts` with:

```ts
import { getEnv } from "@/lib/env";

import { hashPassword, verifyPassword } from "./password";
import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
} from "./session";
import type { AuthRepository, SessionRepository } from "./types";

export function createAuthService(
  repository: AuthRepository & SessionRepository,
) {
  async function authenticateAdmin(password: string) {
    const admin = await repository.findAdmin();
    if (!admin) return null;
    return (await verifyPassword(admin.passwordHash, password)) ? admin : null;
  }

  return {
    async setAdminPassword(password: string) {
      const passwordHash = await hashPassword(password);
      const user = await repository.upsertAdminPassword(passwordHash);
      await repository.deleteSessionsForUser(user.id);
      return user;
    },

    authenticateAdmin,

    async login(password: string, now = new Date()) {
      const admin = await authenticateAdmin(password);
      if (!admin) return null;

      const token = createSessionToken();
      const record = newSessionRecord(
        token,
        admin.id,
        now,
        getEnv().SESSION_DAYS,
      );
      await repository.createSession(record);
      return { token, expiresAt: record.expiresAt };
    },

    async logout(token: string) {
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },
  };
}
```

- [ ] **Step 4: Write the failing login-route integration test**

Create `tests/integration/login-route.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/login/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { createAuthService } from "@/modules/auth/auth-service";

const repository = createAuthRepository(db);

afterEach(async () => {
  await db.delete(users);
});

describe("POST /api/auth/login", () => {
  it("rejects an incorrect password", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "incorrect value" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
```

- [ ] **Step 5: Implement login and logout route handlers**

Create `src/app/api/auth/login/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { getEnv } from "@/lib/env";
import { createAuthService } from "@/modules/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { sessionCookieOptions } from "@/modules/auth/cookies";

const bodySchema = z.object({
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const service = createAuthService(createAuthRepository(db));
  const session = await service.login(parsed.data.password);
  if (!session) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    session.token,
    sessionCookieOptions(
      getEnv().NODE_ENV === "production",
      session.expiresAt,
    ),
  );
  return response;
}
```

Create `src/app/api/auth/logout/route.ts`:

```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createAuthService } from "@/modules/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await createAuthService(createAuthRepository(db)).logout(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
```

- [ ] **Step 6: Add the login page**

Create `src/app/login/login-form.tsx`:

```tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: form.get("password") }),
    });
    setSubmitting(false);

    if (!response.ok) {
      setError("密码不正确");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <p className="eyebrow">个人文档工具</p>
      <h1>登录</h1>
      <label htmlFor="password">密码</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={submitting} type="submit">
        {submitting ? "正在登录..." : "登录"}
      </button>
    </form>
  );
}
```

Create `src/app/login/page.tsx`:

```tsx
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <LoginForm />
    </main>
  );
}
```

- [ ] **Step 7: Run auth-route tests**

Run:

```bash
pnpm test -- tests/unit/cookies.test.ts
pnpm test:integration -- tests/integration/login-route.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit login and logout**

```bash
git add src/app/api/auth src/app/login src/modules/auth tests/unit/cookies.test.ts tests/integration/login-route.test.ts
git commit -m "feat: add single-user login and logout"
```

## Task 7: Protect The Application Shell

**Files:**

- Create: `src/modules/auth/current-user.ts`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/page.tsx`
- Delete: `src/app/page.tsx`
- Delete: `tests/unit/home-page.test.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/integration/current-user.test.ts`
- Test: `tests/unit/app-shell.test.tsx`

- [ ] **Step 1: Write the failing current-user integration test**

Create `tests/integration/current-user.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getUserForSessionToken } from "@/modules/auth/current-user";
import {
  createSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

const repository = createAuthRepository(db);

afterEach(async () => {
  await db.delete(users);
});

describe("getUserForSessionToken", () => {
  it("returns null for expired sessions", async () => {
    const user = await repository.upsertAdminPassword("hash");
    const token = createSessionToken();
    await repository.createSession(
      newSessionRecord(
        token,
        user.id,
        new Date("2026-05-01T00:00:00Z"),
        1,
      ),
    );

    await expect(
      getUserForSessionToken(repository, token, new Date("2026-06-11T00:00:00Z")),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Implement current-user lookup**

Create `src/modules/auth/current-user.ts`:

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";

import { SESSION_COOKIE_NAME } from "./constants";
import { hashSessionToken } from "./session";
import type { SessionRepository } from "./types";

export async function getUserForSessionToken(
  repository: SessionRepository,
  token: string,
  now = new Date(),
) {
  const session = await repository.findSessionByTokenHash(
    hashSessionToken(token),
  );
  if (!session || session.expiresAt <= now) return null;
  return session.user;
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserForSessionToken(createAuthRepository(db), token);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 3: Write the failing application-shell test**

Create `tests/unit/app-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";

import DashboardPage from "@/app/(app)/page";

describe("DashboardPage", () => {
  it("shows the focused-reader empty state", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", { name: "开始阅读 Shopify 开发文档" }),
    ).toBeInTheDocument();
    expect(screen.getByText("中文与 English 统一搜索")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Create the protected focused-reader shell**

Move the root page into the `(app)` route group by deleting `src/app/page.tsx` and
its superseded test `tests/unit/home-page.test.tsx`, then create
`src/app/(app)/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <section className="empty-reader">
      <p className="eyebrow">中文与 English 统一搜索</p>
      <h1>开始阅读 Shopify 开发文档</h1>
      <p>内容抓取与翻译会在后续阶段接入。</p>
    </section>
  );
}
```

Create `src/app/(app)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { requireCurrentUser } from "@/modules/auth/current-user";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();

  return (
    <div className="app-shell">
      <aside className="collapsed-nav" aria-label="文档导航">
        <strong>S</strong>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <strong>Shopify 中文文档</strong>
          <span>{user.username}</span>
          <form action="/api/auth/logout" method="post">
            <button type="submit">退出</button>
          </form>
        </header>
        <main className="reader">{children}</main>
      </div>
    </div>
  );
}
```

Append focused-reader styles to `src/app/globals.css`:

```css
.app-shell {
  display: grid;
  grid-template-columns: 56px 1fr;
  min-height: 100vh;
}

.collapsed-nav {
  padding: 20px 0;
  color: white;
  text-align: center;
  background: #173a2e;
}

.app-main {
  min-width: 0;
}

.app-header {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 20px;
  padding: 0 24px;
  border-bottom: 1px solid #dbe5df;
  background: white;
}

.app-header span {
  margin-left: auto;
  color: var(--muted);
}

.reader {
  width: min(980px, calc(100% - 48px));
  margin: 0 auto;
  padding: 56px 0;
}

.empty-reader {
  padding: 48px;
  border-radius: 18px;
  background: white;
}
```

- [ ] **Step 5: Run protection and shell tests**

Run:

```bash
pnpm test -- tests/unit/app-shell.test.tsx
pnpm test:integration -- tests/integration/current-user.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit the protected application**

```bash
git add src/app src/modules/auth/current-user.ts tests/unit/app-shell.test.tsx tests/integration/current-user.test.ts
git commit -m "feat: protect the focused reader shell"
```

## Task 8: Add Health, Readiness, And No-Index Controls

**Files:**

- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `public/robots.txt`
- Test: `tests/integration/health-ready.test.ts`

- [ ] **Step 1: Write the failing readiness test**

Create `tests/integration/health-ready.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { GET as ready } from "@/app/api/health/ready/route";

describe("GET /api/health/ready", () => {
  it("returns ready when PostgreSQL accepts a query", async () => {
    const response = await ready();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      database: "up",
    });
  });
});
```

- [ ] **Step 2: Add liveness and readiness handlers**

Create `src/app/api/health/live/route.ts`:

```ts
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "alive" });
}
```

Create `src/app/api/health/ready/route.ts`:

```ts
import { NextResponse } from "next/server";

import { db } from "@/db/client";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: "ready",
      database: "up",
    });
  } catch {
    return NextResponse.json(
      {
        status: "not-ready",
        database: "down",
      },
      { status: 503 },
    );
  }
}
```

Create `public/robots.txt`:

```text
User-agent: *
Disallow: /
```

- [ ] **Step 3: Run health tests**

Run:

```bash
pnpm test:integration -- tests/integration/health-ready.test.ts
```

Expected: `1 passed`.

- [ ] **Step 4: Verify the database-down response**

Run:

```bash
docker compose stop db
pnpm test:integration -- tests/integration/health-ready.test.ts
```

Expected: the positive readiness test fails because the handler returns `503`.

Restart and re-run:

```bash
docker compose start db
pnpm db:migrate
pnpm test:integration -- tests/integration/health-ready.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit health controls**

```bash
git add src/app/api/health public/robots.txt tests/integration/health-ready.test.ts
git commit -m "feat: add health and no-index controls"
```

## Task 9: Add End-To-End Authentication Coverage

**Files:**

- Create: `tests/e2e/auth.spec.ts`
- Create: `scripts/seed-e2e-admin.ts`
- Modify: `package.json`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add a deterministic E2E admin seed**

Create `scripts/seed-e2e-admin.ts`:

```ts
import { db, pool } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createAuthService } from "@/modules/auth/auth-service";

const password = process.env.E2E_ADMIN_PASSWORD;
if (!password) {
  throw new Error("E2E_ADMIN_PASSWORD is required");
}

await createAuthService(createAuthRepository(db)).setAdminPassword(password);
await pool.end();
```

Add to `package.json` scripts:

```json
{
  "test:e2e:seed": "tsx scripts/seed-e2e-admin.ts"
}
```

- [ ] **Step 2: Write the failing browser test**

Create `tests/e2e/auth.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("requires login and supports logout", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("密码").fill("phase-one-test-password");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", {
      name: "开始阅读 Shopify 开发文档",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
```

- [ ] **Step 3: Run the test to verify the required setup failure**

Run:

```powershell
pnpm exec playwright install chromium
$env:E2E_ADMIN_PASSWORD="phase-one-test-password"
pnpm test:e2e:seed
pnpm test:e2e
```

Expected on the first run: FAIL if the logout form receives a JSON response instead
of navigating to login.

- [ ] **Step 4: Make logout browser-friendly**

Update `src/app/api/auth/logout/route.ts` to redirect normal form submissions:

```ts
const response = NextResponse.redirect(new URL("/login", getEnv().APP_ORIGIN), {
  status: 303,
});
response.cookies.delete(SESSION_COOKIE_NAME);
return response;
```

Keep the database session deletion before creating the response.

- [ ] **Step 5: Run the E2E test**

Run:

```powershell
$env:E2E_ADMIN_PASSWORD="phase-one-test-password"
pnpm test:e2e:seed
pnpm test:e2e
```

Expected: Chromium project reports `1 passed`.

- [ ] **Step 6: Commit browser coverage**

```bash
git add scripts/seed-e2e-admin.ts package.json playwright.config.ts tests/e2e/auth.spec.ts src/app/api/auth/logout/route.ts
git commit -m "test: cover single-user authentication flow"
```

## Task 10: Complete Phase-One Verification And Documentation

**Files:**

- Create: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Document local setup**

Create `README.md`:

````markdown
# Shopify.dev Chinese Proxy

Private, single-user Shopify developer documentation reader.

## Local setup

1. Install Node.js 20.19+ and enable Corepack.
2. Copy `.env.example` to `.env`.
3. Start PostgreSQL with `docker compose up -d db`.
4. Install packages with `pnpm install`.
5. Run migrations with `pnpm db:migrate`.
6. Set the admin password with `pnpm admin set-password`.
7. Start the app with `pnpm dev`.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
$env:E2E_ADMIN_PASSWORD="phase-one-test-password"
pnpm test:e2e:seed
pnpm test:e2e
pnpm build
```

The ingestion, translation, search, administration, backup, and production deployment
features are delivered in later phases.
````

Append to `.gitignore`:

```gitignore
.next/
playwright-report/
test-results/
coverage/
*.log
```

- [ ] **Step 2: Run the complete phase verification**

Run:

```powershell
docker compose up -d db
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
$env:E2E_ADMIN_PASSWORD="phase-one-test-password"
pnpm test:e2e:seed
pnpm test:e2e
pnpm build
```

Expected:

- Every command exits `0`.
- Unit, integration, and Chromium E2E suites report zero failures.
- Next.js production build succeeds.

- [ ] **Step 3: Review the Git diff against Phase 1 exit criteria**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD
```

Expected:

- No whitespace errors.
- Only Phase 1 application, tests, configuration, and documentation are changed.
- No `.env`, password, session token, or API key is staged.

- [ ] **Step 4: Commit Phase 1 completion**

```bash
git add README.md .gitignore
git commit -m "docs: add phase one setup and verification"
```

- [ ] **Step 5: Record the phase checkpoint**

Run:

```bash
git log --oneline --decorate -10
git status --short
```

Expected:

- Phase 1 commits are visible in task order.
- Working tree is clean.
- Phase 2 planning can start from the verified code rather than from assumptions.
