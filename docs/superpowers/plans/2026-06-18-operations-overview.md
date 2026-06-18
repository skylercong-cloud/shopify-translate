# Operations Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected, read-only operations overview page for the personal Shopify.dev Chinese reader.

**Architecture:** Keep operational data access in a focused PostgreSQL repository that returns safe, serializable data only. Render the overview with Server Components under the existing protected app shell, and expose no API keys or encrypted secret payloads in UI data.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Drizzle ORM, PostgreSQL, Vitest, Testing Library.

---

## File Structure

- Create `src/modules/operations/types.ts` for serializable overview DTOs shared by repository and UI.
- Create `src/db/repositories/operations-repository.ts` for read-only settings, provider, prompt, glossary, and job summary queries.
- Create `tests/integration/operations-repository.test.ts` for database-backed coverage that proves secrets are omitted and queue counts are grouped.
- Create `src/app/(app)/admin/operations-overview.tsx` for the presentation component.
- Create `src/app/(app)/admin/page.tsx` as the protected Server Component route.
- Modify `src/app/(app)/layout.tsx` to expose protected links to the reader home and operations page.
- Create `tests/unit/admin-overview.test.tsx` for rendering states and secret-safety labels.
- Modify `tests/unit/app-shell.test.tsx` if the protected shell assertions need to account for the new operations link.
- Modify `README.md` and `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md` after browser or build verification records the Phase 5A status.

## Task 1: Operations Repository

**Files:**
- Create: `src/modules/operations/types.ts`
- Create: `src/db/repositories/operations-repository.ts`
- Test: `tests/integration/operations-repository.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/operations-repository.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createOperationsRepository } from "@/db/repositories/operations-repository";
import {
  glossaryTerms,
  glossaryVersions,
  jobs,
  modelProviderConfigs,
  promptVersions,
  translationSettings,
} from "@/db/schema";
import { getEnv } from "@/lib/env";

const repository = createOperationsRepository(db);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  await db.delete(jobs);
  await db.delete(glossaryTerms);
  await db.delete(glossaryVersions);
  await db.delete(promptVersions);
  await db.delete(modelProviderConfigs);
  await db
    .update(translationSettings)
    .set({
      dailyTokenLimit: null,
      requestTimeoutMs: 60_000,
      maxInputBytes: 1_048_576,
      maxOutputTokens: 4_096,
      workerConcurrency: 1,
      updatedAt: new Date(),
    })
    .where(eq(translationSettings.singleton, true));
});

describe("operations repository", () => {
  it("loads a secret-safe operational overview", async () => {
    await db.insert(translationSettings).values({ singleton: true }).onConflictDoNothing();
    await db
      .update(translationSettings)
      .set({
        dailyTokenLimit: 500_000,
        requestTimeoutMs: 30_000,
        maxInputBytes: 500_000,
        maxOutputTokens: 2_048,
        workerConcurrency: 2,
      })
      .where(eq(translationSettings.singleton, true));
    await db.insert(modelProviderConfigs).values([
      {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        encryptedApiKey: "encrypted-deepseek-secret",
        keyHint: "****seek",
        enabled: true,
      },
      {
        provider: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelId: "qwen-plus",
        encryptedApiKey: "encrypted-qwen-secret",
        keyHint: "****qwen",
        enabled: false,
      },
    ]);
    await db.insert(promptVersions).values({
      version: 3,
      systemPrompt: "Keep technical terms in English.",
      userPromptTemplate: "{{sourceText}}",
      contentFingerprint: "prompt-v3",
      active: true,
    });
    const [glossary] = await db
      .insert(glossaryVersions)
      .values({
        version: 2,
        contentFingerprint: "glossary-v2",
        active: true,
      })
      .returning();
    await db.insert(glossaryTerms).values([
      {
        glossaryVersionId: glossary.id,
        sourceTerm: "Admin API",
        normalizedTerm: "admin api",
      },
      {
        glossaryVersionId: glossary.id,
        sourceTerm: "Shopify CLI",
        normalizedTerm: "shopify cli",
      },
    ]);
    await db.insert(jobs).values([
      {
        queue: "translation",
        type: "translate_block",
        dedupeKey: "ops:translation:queued",
        payload: {},
        status: "queued",
      },
      {
        queue: "translation",
        type: "translate_block",
        dedupeKey: "ops:translation:failed",
        payload: {},
        status: "failed",
        lastErrorCode: "provider_error",
        lastErrorMessage: "DeepSeek failed",
      },
      {
        queue: "ingestion",
        type: "fetch_page",
        dedupeKey: "ops:ingestion:running",
        payload: {},
        status: "running",
      },
    ]);

    const overview = await repository.loadOverview();

    expect(overview.settings).toMatchObject({
      dailyTokenLimit: 500_000,
      requestTimeoutMs: 30_000,
      workerConcurrency: 2,
    });
    expect(overview.providers).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        modelId: "deepseek-chat",
        keyHint: "****seek",
        enabled: true,
      }),
      expect.objectContaining({
        provider: "qwen",
        modelId: "qwen-plus",
        keyHint: "****qwen",
        enabled: false,
      }),
    ]);
    expect(JSON.stringify(overview)).not.toContain("encrypted-deepseek-secret");
    expect(overview.activePrompt).toMatchObject({ version: 3 });
    expect(overview.activeGlossary).toMatchObject({
      version: 2,
      termCount: 2,
    });
    expect(overview.jobs.byQueueStatus).toEqual([
      { queue: "ingestion", status: "running", count: 1 },
      { queue: "translation", status: "failed", count: 1 },
      { queue: "translation", status: "queued", count: 1 },
    ]);
    expect(overview.jobs.recentFailures).toEqual([
      expect.objectContaining({
        queue: "translation",
        type: "translate_block",
        lastErrorCode: "provider_error",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration -- tests/integration/operations-repository.test.ts
```

Expected: FAIL because `src/db/repositories/operations-repository.ts` does not exist.

- [ ] **Step 3: Implement the repository**

Create `src/modules/operations/types.ts`:

```ts
import type { jobQueues, jobStatuses, jobTypes } from "@/db/schema";
import type { translationProviders } from "@/db/schema";

export type OperationsProviderStatus = {
  provider: (typeof translationProviders)[number];
  baseUrl: string;
  modelId: string;
  keyHint: string | null;
  enabled: boolean;
  updatedAt: Date;
};

export type OperationsRuntimeSettings = {
  dailyTokenLimit: number | null;
  budgetTimeZone: "Asia/Shanghai";
  requestTimeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  workerConcurrency: number;
};

export type OperationsVersionStatus = {
  id: string;
  version: number;
  createdAt: Date;
};

export type OperationsGlossaryStatus = OperationsVersionStatus & {
  termCount: number;
};

export type OperationsJobCount = {
  queue: (typeof jobQueues)[number];
  status: (typeof jobStatuses)[number];
  count: number;
};

export type OperationsRecentFailure = {
  id: string;
  queue: (typeof jobQueues)[number];
  type: (typeof jobTypes)[number];
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
};

export type OperationsOverview = {
  settings: OperationsRuntimeSettings;
  providers: OperationsProviderStatus[];
  activePrompt: OperationsVersionStatus | null;
  activeGlossary: OperationsGlossaryStatus | null;
  jobs: {
    byQueueStatus: OperationsJobCount[];
    recentFailures: OperationsRecentFailure[];
  };
};
```

Create `src/db/repositories/operations-repository.ts` with `createOperationsRepository(db).loadOverview()`. The query must select explicit provider columns and must not select `encryptedApiKey`. Use `count()` grouped by `jobs.queue` and `jobs.status`; return counts as numbers; order by queue then status. Use a left join from active glossary to terms to count the active glossary terms.

- [ ] **Step 4: Run the integration test to verify it passes**

Run the same integration command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/operations/types.ts src/db/repositories/operations-repository.ts tests/integration/operations-repository.test.ts
git commit -m "feat: load operations overview"
```

## Task 2: Protected Operations Page

**Files:**
- Create: `src/app/(app)/admin/operations-overview.tsx`
- Create: `src/app/(app)/admin/page.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Create: `tests/unit/admin-overview.test.tsx`
- Modify: `tests/unit/app-shell.test.tsx` if needed

- [ ] **Step 1: Write the failing UI test**

Create `tests/unit/admin-overview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OperationsOverviewPanel } from "@/app/(app)/admin/operations-overview";
import type { OperationsOverview } from "@/modules/operations/types";

const overview: OperationsOverview = {
  settings: {
    dailyTokenLimit: 500_000,
    budgetTimeZone: "Asia/Shanghai",
    requestTimeoutMs: 30_000,
    maxInputBytes: 500_000,
    maxOutputTokens: 2_048,
    workerConcurrency: 2,
  },
  providers: [
    {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      modelId: "deepseek-chat",
      keyHint: "****seek",
      enabled: true,
      updatedAt: new Date("2026-06-18T08:00:00.000Z"),
    },
    {
      provider: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelId: "qwen-plus",
      keyHint: null,
      enabled: false,
      updatedAt: new Date("2026-06-18T08:05:00.000Z"),
    },
  ],
  activePrompt: {
    id: "prompt-id",
    version: 3,
    createdAt: new Date("2026-06-18T07:00:00.000Z"),
  },
  activeGlossary: {
    id: "glossary-id",
    version: 2,
    termCount: 12,
    createdAt: new Date("2026-06-18T07:30:00.000Z"),
  },
  jobs: {
    byQueueStatus: [
      { queue: "translation", status: "queued", count: 4 },
      { queue: "translation", status: "failed", count: 1 },
    ],
    recentFailures: [
      {
        id: "job-id",
        queue: "translation",
        type: "translate_block",
        attempts: 3,
        maxAttempts: 3,
        lastErrorCode: "provider_error",
        lastErrorMessage: "DeepSeek failed",
        updatedAt: new Date("2026-06-18T08:10:00.000Z"),
      },
    ],
  },
};

describe("OperationsOverviewPanel", () => {
  it("renders model, prompt, glossary, budget, and job status without secrets", () => {
    render(<OperationsOverviewPanel overview={overview} />);

    expect(
      screen.getByRole("heading", { name: "运维概览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("deepseek")).toBeInTheDocument();
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.getByText("****seek")).toBeInTheDocument();
    expect(screen.getByText("qwen")).toBeInTheDocument();
    expect(screen.getByText("未设置 key hint")).toBeInTheDocument();
    expect(screen.getByText("Prompt v3")).toBeInTheDocument();
    expect(screen.getByText("术语库 v2")).toBeInTheDocument();
    expect(screen.getByText("12 terms")).toBeInTheDocument();
    expect(screen.getByText("500,000 tokens/day")).toBeInTheDocument();
    expect(screen.getByText("translation / queued")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("provider_error")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek failed")).toBeInTheDocument();
    expect(screen.queryByText(/encrypted/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx
```

Expected: FAIL because `operations-overview.tsx` does not exist.

- [ ] **Step 3: Implement the protected route and component**

Create `src/app/(app)/admin/operations-overview.tsx` exporting `OperationsOverviewPanel`. Render:

- Heading `运维概览`
- Model provider cards showing provider, model ID, base URL, enabled/disabled state, and key hint only.
- Runtime budget card showing daily token limit, timezone, request timeout, max input bytes, max output tokens, and worker concurrency.
- Active Prompt and glossary card showing versions and created dates, or explicit missing states.
- Job status cards grouped by queue/status and recent failures with truncated error messages.

Create `src/app/(app)/admin/page.tsx`:

```tsx
import { db } from "@/db/client";
import { createOperationsRepository } from "@/db/repositories/operations-repository";

import { OperationsOverviewPanel } from "./operations-overview";

export default async function AdminPage() {
  const overview = await createOperationsRepository(db).loadOverview();

  return <OperationsOverviewPanel overview={overview} />;
}
```

Modify `src/app/(app)/layout.tsx` to add protected links to `/` and `/admin`, keeping the existing logout form.

- [ ] **Step 4: Run UI tests**

Run:

```powershell
corepack pnpm test -- tests/unit/admin-overview.test.tsx tests/unit/app-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and lint**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/(app)/admin src/app/(app)/layout.tsx src/app/globals.css tests/unit/admin-overview.test.tsx tests/unit/app-shell.test.tsx
git commit -m "feat: add operations overview page"
```

## Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`

- [ ] **Step 1: Update documentation**

Update README to document `/admin` as a protected, read-only operations overview. Update the roadmap Phase 5 status to say Phase 5A read-only operations overview is implemented, while edit workflows and backup automation remain pending.

- [ ] **Step 2: Run final verification**

Run:

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
$env:NODE_ENV='test'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm test:integration
$env:NODE_ENV='production'; $env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs'; $env:APP_ORIGIN='http://127.0.0.1:3000'; $env:SESSION_DAYS='30'; corepack pnpm build
```

Expected: PASS, with only the known Next multiple-lockfile warning if it appears.

- [ ] **Step 3: Commit**

```powershell
git add README.md docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md
git commit -m "docs: describe operations overview"
```

## Self-Review

- Spec coverage: This plan covers the Phase 5 starting requirements for model/settings visibility, job/failure status, and degraded-state visibility groundwork. It does not implement editing, password changes, session revocation, or backups; those remain separate Phase 5B+ increments.
- Placeholder scan: No placeholder steps remain.
- Type consistency: `OperationsOverview`, `OperationsProviderStatus`, `OperationsJobCount`, and `loadOverview()` are used consistently across repository, route, component, and tests.
