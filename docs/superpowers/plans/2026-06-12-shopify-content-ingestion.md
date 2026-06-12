# Shopify.dev Content Discovery And Versioned Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking; every item is checked after final verification.

**Goal:** Discover approved Shopify.dev `/docs/**` pages, fetch and parse them into
stable content blocks, publish versioned English source pages atomically, and enqueue
only new or changed translatable blocks.

**Status:** Completed and verified on June 12, 2026.

**Architecture:** Keep ingestion inside the existing TypeScript modular monolith.
Pure domain modules handle URL policy, parsing, fingerprints, and diffs; PostgreSQL
repositories own durable jobs, source metadata, and transactional publishing. A
separate worker entrypoint composes those modules and consumes only the `ingestion`
queue.

**Tech Stack:** Node.js native `fetch`, Next.js 16, TypeScript, PostgreSQL 16,
Drizzle ORM, `robots-parser`, `fast-xml-parser`, `unified`, `remark-parse`,
`remark-gfm`, Cheerio, Vitest, and local HTTP fixtures.

---

## Planned File Structure

```text
package.json
pnpm-lock.yaml
.env.example
README.md
drizzle/
|-- 0001_content_ingestion.sql
`-- meta/
src/
|-- db/
|   |-- repositories/
|   |   |-- ingestion-repository.ts
|   |   `-- job-repository.ts
|   `-- schema/
|       |-- ingestion.ts
|       |-- jobs.ts
|       `-- index.ts
|-- lib/
|   `-- env.ts
|-- modules/
|   |-- ingestion/
|   |   |-- constants.ts
|   |   |-- diff.ts
|   |   |-- errors.ts
|   |   |-- fingerprint.ts
|   |   |-- html-parser.ts
|   |   |-- ingestion-service.ts
|   |   |-- markdown-parser.ts
|   |   |-- parser.ts
|   |   |-- robots-policy.ts
|   |   |-- sitemap.ts
|   |   |-- source-client.ts
|   |   |-- types.ts
|   |   `-- url-policy.ts
|   `-- jobs/
|       |-- scheduler.ts
|       |-- types.ts
|       `-- worker.ts
`-- worker/
    `-- main.ts
tests/
|-- fixtures/
|   `-- ingestion/
|       |-- page-changed.md
|       |-- page.html
|       |-- page.md
|       |-- robots.txt
|       |-- sitemap-docs.xml
|       `-- sitemap-index.xml
|-- helpers/
|   `-- fixture-server.ts
|-- integration/
|   |-- ingestion-pipeline.test.ts
|   |-- ingestion-repository.test.ts
|   `-- job-repository.test.ts
`-- unit/
    |-- ingestion-diff.test.ts
    |-- ingestion-parser.test.ts
    |-- robots-policy.test.ts
    |-- sitemap.test.ts
    |-- source-client.test.ts
    `-- url-policy.test.ts
```

## Task 1: Add Parsing Dependencies And The Ingestion Schema

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/db/schema/ingestion.ts`
- Create: `src/db/schema/jobs.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0001_content_ingestion.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0001_snapshot.json`
- Test: `tests/integration/ingestion-repository.test.ts`

- [x] **Step 1: Install the focused parser dependencies**

Run:

```powershell
corepack pnpm add cheerio fast-xml-parser robots-parser unified remark-parse remark-gfm
corepack pnpm add -D @types/robots-parser
```

Expected: `package.json` and `pnpm-lock.yaml` contain the seven runtime packages and
the Robots type package. Do not add Axios, Redis, a browser runtime, or a general job
framework.

- [x] **Step 2: Write a failing schema integration test**

Create `tests/integration/ingestion-repository.test.ts` with a database safety guard
matching the existing integration tests and this initial assertion:

```ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { getEnv } from "@/lib/env";

beforeAll(async () => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

describe("ingestion schema", () => {
  it("creates the source, version, block, policy, attempt, payload, and job tables", async () => {
    const result = await db.execute(sql`
      select tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'source_pages',
          'robots_policies',
          'page_versions',
          'content_blocks',
          'block_changes',
          'fetch_attempts',
          'source_payloads',
          'jobs'
        )
      order by tablename
    `);

    expect(result.rows.map((row) => row.tablename)).toEqual([
      "block_changes",
      "content_blocks",
      "fetch_attempts",
      "jobs",
      "page_versions",
      "robots_policies",
      "source_pages",
      "source_payloads",
    ]);
  });
});
```

- [x] **Step 3: Run the test to verify the schema is absent**

Run:

```powershell
$env:NODE_ENV="test"
$env:DATABASE_URL="postgres://app:app@127.0.0.1:5432/shopify_docs_test"
$env:APP_ORIGIN="http://127.0.0.1:3000"
$env:SESSION_DAYS="30"
corepack pnpm test:integration -- tests/integration/ingestion-repository.test.ts
```

Expected: FAIL because the eight Phase 2 tables do not exist.

- [x] **Step 4: Define the Drizzle schema**

Create `src/db/schema/jobs.ts` with exported enum value arrays and a `jobs` table.
Use a partial unique index so a `dedupe_key` can be reused after completion:

```ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const jobQueues = ["ingestion", "translation"] as const;
export const jobTypes = [
  "discover_sitemap",
  "fetch_page",
  "translate_block",
  "cleanup_payloads",
] as const;
export const jobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export const jobQueueEnum = pgEnum("job_queue", jobQueues);
export const jobTypeEnum = pgEnum("job_type", jobTypes);
export const jobStatusEnum = pgEnum("job_status", jobStatuses);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: jobQueueEnum("queue").notNull(),
    type: jobTypeEnum("type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    priority: integer("priority").notNull().default(0),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("jobs_active_dedupe_idx")
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("jobs_claim_idx").on(
      table.queue,
      table.status,
      table.runAt,
      table.priority,
    ),
    index("jobs_lease_expires_at_idx").on(table.leaseExpiresAt),
  ],
);
```

Create `src/db/schema/ingestion.ts` with the seven remaining tables. Use PostgreSQL
enums for page status, source format, block type, change kind, and fetch result.
Required constraints:

- `source_pages.canonical_url` unique.
- `robots_policies.origin` unique.
- `page_versions(page_id, version_number)` unique.
- `page_versions(page_id, content_fingerprint)` unique.
- `content_blocks(page_version_id, ordinal)` unique.
- `block_changes` check constraints for valid previous/current block combinations.
- `source_payloads.fetch_attempt_id` unique with cascade deletion.
- Foreign keys from attempts to jobs use `onDelete: "set null"` so diagnostics survive
  job retention.

Export both schema files from `src/db/schema/index.ts`:

```ts
export * from "./auth";
export * from "./ingestion";
export * from "./jobs";
```

- [x] **Step 5: Generate and inspect the migration**

Run:

```powershell
$env:DATABASE_URL="postgres://app:app@127.0.0.1:5432/shopify_docs_test"
corepack pnpm db:generate --name content_ingestion
```

Expected: one new migration and snapshot. Inspect it to confirm the partial unique
job index and all foreign keys/check constraints are present. If Drizzle generates a
different numeric filename, use that generated filename consistently.

- [x] **Step 6: Apply the migration and pass the schema test**

Run:

```powershell
corepack pnpm db:migrate
corepack pnpm test:integration -- tests/integration/ingestion-repository.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add package.json pnpm-lock.yaml src/db/schema drizzle tests/integration/ingestion-repository.test.ts
git commit -m "feat: add ingestion persistence schema"
```

## Task 2: Implement URL And Robots Policies

**Files:**

- Create: `src/modules/ingestion/constants.ts`
- Create: `src/modules/ingestion/errors.ts`
- Create: `src/modules/ingestion/url-policy.ts`
- Create: `src/modules/ingestion/robots-policy.ts`
- Create: `src/modules/ingestion/types.ts`
- Test: `tests/unit/url-policy.test.ts`
- Test: `tests/unit/robots-policy.test.ts`
- Create: `tests/fixtures/ingestion/robots.txt`

- [x] **Step 1: Write failing URL policy tests**

Create `tests/unit/url-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  canonicalizeShopifyDocsUrl,
  resolveApprovedRedirect,
  resolveSameOriginResourceRedirect,
} from "@/modules/ingestion/url-policy";

describe("Shopify docs URL policy", () => {
  it.each([
    ["https://SHOPIFY.dev:443/docs/", "https://shopify.dev/docs"],
    [
      "https://shopify.dev/docs/api/admin-graphql/latest/",
      "https://shopify.dev/docs/api/admin-graphql/latest",
    ],
    [
      "https://shopify.dev/docs/apps#authentication",
      "https://shopify.dev/docs/apps",
    ],
  ])("canonicalizes %s", (input, expected) => {
    expect(canonicalizeShopifyDocsUrl(input)).toBe(expected);
  });

  it.each([
    "http://shopify.dev/docs",
    "https://shopify.dev/changelog",
    "https://dev.shopify.com/docs",
    "https://shopify.dev/docs/apps?shpxid=1",
    "https://shopify.dev/docs/apps.txt",
    "https://user:pass@shopify.dev/docs",
  ])("rejects %s", (input) => {
    expect(() => canonicalizeShopifyDocsUrl(input)).toThrow();
  });

  it("checks every redirect against the same allowlist", () => {
    expect(
      resolveApprovedRedirect(
        "https://shopify.dev/docs/apps",
        "/docs/apps/build",
      ),
    ).toBe("https://shopify.dev/docs/apps/build");
    expect(() =>
      resolveApprovedRedirect(
        "https://shopify.dev/docs/apps",
        "https://example.com/docs/apps",
      ),
    ).toThrow();
  });

  it("allows same-origin Robots and Sitemap resources without widening page scope", () => {
    expect(
      resolveSameOriginResourceRedirect(
        "https://shopify.dev/sitemap.xml",
        "/sitemaps/docs.xml",
      ),
    ).toBe("https://shopify.dev/sitemaps/docs.xml");
    expect(() =>
      resolveSameOriginResourceRedirect(
        "https://shopify.dev/sitemap.xml",
        "https://example.com/sitemap.xml",
      ),
    ).toThrow();
  });
});
```

- [x] **Step 2: Run the URL policy test and confirm failure**

Run:

```powershell
corepack pnpm test -- tests/unit/url-policy.test.ts
```

Expected: FAIL because `url-policy.ts` does not exist.

- [x] **Step 3: Implement URL policy and stable errors**

Create `src/modules/ingestion/errors.ts`:

```ts
export class IngestionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}
```

Create constants in `src/modules/ingestion/constants.ts`:

```ts
export const SHOPIFY_DEV_ORIGIN = "https://shopify.dev";
export const SHOPIFY_DOCS_ROOT = "/docs";
export const SOURCE_USER_AGENT = "ShopifyDocsPersonalReader/0.1";
export const MAX_REDIRECTS = 3;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const SOURCE_TIMEOUT_MS = 20_000;
```

Implement `canonicalizeShopifyDocsUrl()`, `resolveApprovedRedirect()`, and
`resolveSameOriginResourceRedirect()` in `url-policy.ts`. The page functions reject
query strings, non-HTTPS URLs, credentials, non-default ports, `.txt` canonical
paths, and paths outside `/docs`. The resource redirect function allows any
query-free HTTPS path on the exact `shopify.dev` origin for Robots and Sitemap
resources, but it is never used to create `source_pages`.

- [x] **Step 4: Add Robots fixture and failing policy tests**

Create `tests/fixtures/ingestion/robots.txt`:

```text
User-agent: *
Disallow: /beta/
Disallow: /docs/api/shipping-partner-platform/
Sitemap: https://shopify.dev/sitemap.xml
```

Create `tests/unit/robots-policy.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  createRobotsPolicy,
  requireRobotsPolicy,
} from "@/modules/ingestion/robots-policy";

describe("robots policy", () => {
  it("extracts same-origin sitemaps and rejects disallowed docs paths", async () => {
    const body = await readFile(
      "tests/fixtures/ingestion/robots.txt",
      "utf8",
    );
    const policy = createRobotsPolicy(body);

    expect(policy.sitemapUrls).toEqual(["https://shopify.dev/sitemap.xml"]);
    expect(policy.isAllowed("https://shopify.dev/docs/apps")).toBe(true);
    expect(
      policy.isAllowed(
        "https://shopify.dev/docs/api/shipping-partner-platform/reference",
      ),
    ).toBe(false);
  });

  it("fails closed when no cached policy exists", () => {
    expect(() => requireRobotsPolicy(undefined)).toThrowError(
      /robots policy is unavailable/i,
    );
  });
});
```

- [x] **Step 5: Implement Robots parsing**

Wrap `robots-parser` in `robots-policy.ts`. Expose:

```ts
export type RobotsPolicy = {
  body: string;
  sitemapUrls: string[];
  isAllowed(url: string): boolean;
};

export function createRobotsPolicy(body: string): RobotsPolicy;
export function requireRobotsPolicy(
  policy: RobotsPolicy | undefined,
): RobotsPolicy;
```

Use the fixed application User-Agent, keep only same-origin HTTPS Sitemap URLs, and
fall back to `https://shopify.dev/sitemap.xml` when none are declared.

- [x] **Step 6: Run tests**

Run:

```powershell
corepack pnpm test -- tests/unit/url-policy.test.ts tests/unit/robots-policy.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add src/modules/ingestion tests/unit/url-policy.test.ts tests/unit/robots-policy.test.ts tests/fixtures/ingestion/robots.txt
git commit -m "feat: enforce Shopify source access policy"
```

## Task 3: Build The PostgreSQL Durable Job Queue

**Files:**

- Create: `src/modules/jobs/types.ts`
- Create: `src/db/repositories/job-repository.ts`
- Test: `tests/integration/job-repository.test.ts`

- [x] **Step 1: Write failing queue integration tests**

Create `tests/integration/job-repository.test.ts`. Clean only jobs whose dedupe keys
start with a random per-test prefix. Cover:

```ts
it("deduplicates and promotes a queued page fetch", async () => {
  const first = await repository.enqueue({
    queue: "ingestion",
    type: "fetch_page",
    dedupeKey: `${prefix}:page`,
    payload: { url: "https://shopify.dev/docs/apps" },
    priority: 10,
    runAt: new Date("2026-06-12T01:00:00Z"),
  });
  const promoted = await repository.enqueue({
    queue: "ingestion",
    type: "fetch_page",
    dedupeKey: `${prefix}:page`,
    payload: { url: "https://shopify.dev/docs/apps" },
    priority: 100,
    runAt: new Date("2026-06-12T00:00:00Z"),
  });

  expect(first.action).toBe("created");
  expect(promoted.action).toBe("promoted");
  expect(promoted.job.id).toBe(first.job.id);
  expect(promoted.job.priority).toBe(100);
  expect(promoted.job.runAt).toEqual(new Date("2026-06-12T00:00:00Z"));
});

it("claims by priority and recovers an expired lease", async () => {
  // Enqueue low and high jobs, claim high with worker-a, expire its lease,
  // then assert worker-b can claim the same job.
});
```

Also test `complete`, retry scheduling, terminal failure at `maxAttempts`, and error
message truncation.

- [x] **Step 2: Run the queue test and confirm failure**

Run:

```powershell
corepack pnpm test:integration -- tests/integration/job-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [x] **Step 3: Define queue types**

Create `src/modules/jobs/types.ts`:

```ts
export type EnqueueJobInput = {
  queue: "ingestion" | "translation";
  type:
    | "discover_sitemap"
    | "fetch_page"
    | "translate_block"
    | "cleanup_payloads";
  dedupeKey: string;
  payload: Record<string, unknown>;
  priority: number;
  runAt: Date;
  maxAttempts?: number;
};

export type ClaimedJob = {
  id: string;
  queue: EnqueueJobInput["queue"];
  type: EnqueueJobInput["type"];
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
};

export type EnqueueJobResult = {
  job: {
    id: string;
    priority: number;
    runAt: Date;
  };
  action: "created" | "deduplicated" | "promoted";
};
```

- [x] **Step 4: Implement atomic enqueue and claim**

Create `job-repository.ts` with:

```ts
export function createJobRepository(db: Database) {
  return {
    enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>,
    claimNext(input: {
      queue: "ingestion";
      workerId: string;
      now: Date;
      leaseMs: number;
    }): Promise<ClaimedJob | undefined>,
    renewLease(jobId: string, workerId: string, expiresAt: Date): Promise<boolean>,
    complete(jobId: string, workerId: string, now: Date): Promise<void>,
    retryOrFail(input: {
      jobId: string;
      workerId: string;
      now: Date;
      runAt: Date;
      errorCode: string;
      errorMessage: string;
    }): Promise<"queued" | "failed">,
  };
}
```

Use one SQL statement with `FOR UPDATE SKIP LOCKED` to claim either a due queued job
or a running job whose lease expired. Sort by `priority DESC`, then `run_at ASC`,
then `created_at ASC`. `enqueue()` must catch only the partial unique-index conflict,
lock the active job, raise priority with `greatest`, and move `run_at` earlier with
`least`. Return `promoted` if either priority increases or `run_at` moves earlier,
otherwise return `deduplicated`.

- [x] **Step 5: Pass queue tests**

Run:

```powershell
corepack pnpm test:integration -- tests/integration/job-repository.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add src/modules/jobs src/db/repositories/job-repository.ts tests/integration/job-repository.test.ts
git commit -m "feat: add durable PostgreSQL job queue"
```

## Task 4: Implement The Bounded Source Client

**Files:**

- Create: `src/modules/ingestion/source-client.ts`
- Test: `tests/unit/source-client.test.ts`

- [x] **Step 1: Write failing source client tests**

Use injected `fetch`, `sleep`, and clock functions. Cover:

- Requests `.txt` first.
- Falls back to HTML only for `404`, `406`, unsupported Content-Type, empty body, or
  failed main-content sanity check.
- Sends `If-None-Match` and `If-Modified-Since`.
- Returns a distinct `not_modified` result for `304`.
- Rejects cross-origin redirect before issuing the next request.
- Stops after 3 redirects.
- Aborts after 20 seconds.
- Rejects a body over 8 MiB while streaming.
- Classifies network errors, `429`, and `5xx` as retryable.
- Classifies `401`, `403`, invalid type, and response-too-large as terminal.
- Parses `Retry-After` seconds and HTTP dates.

The central success assertion should use:

```ts
expect(result).toEqual({
  kind: "content",
  requestedUrl: "https://shopify.dev/docs/apps.txt",
  finalUrl: "https://shopify.dev/docs/apps.txt",
  sourceFormat: "text",
  contentType: "text/plain",
  body: "# Apps\n\nBuild apps.",
  bytes: 19,
  etag: "\"abc\"",
  lastModified: "Thu, 11 Jun 2026 00:00:00 GMT",
});
```

- [x] **Step 2: Run the tests and confirm failure**

Run:

```powershell
corepack pnpm test -- tests/unit/source-client.test.ts
```

Expected: FAIL because `source-client.ts` does not exist.

- [x] **Step 3: Implement typed fetch outcomes**

In `source-client.ts`, export:

```ts
export type SourceFetchResult =
  | {
      kind: "content";
      requestedUrl: string;
      finalUrl: string;
      sourceFormat: "text" | "html";
      contentType: string;
      body: string;
      bytes: number;
      etag?: string;
      lastModified?: string;
    }
  | {
      kind: "not_modified";
      requestedUrl: string;
      finalUrl: string;
    }
  | {
      kind: "gone";
      requestedUrl: string;
      finalUrl: string;
      status: 404 | 410;
    };

export type SourceClient = {
  fetchPage(input: {
    canonicalUrl: string;
    etag?: string;
    lastModified?: string;
  }): Promise<SourceFetchResult>;
  fetchTextResource(url: string): Promise<{
    finalUrl: string;
    contentType: string;
    body: string;
    bytes: number;
  }>;
};
```

Implement manual redirect handling with `redirect: "manual"`. Read response streams
incrementally and cancel as soon as the byte limit is exceeded. Implement a shared
two-permit limiter and a 500 ms request-start interval; inject both in tests so unit
tests do not wait in real time. `fetchPage()` validates every redirect with the
strict docs policy; `fetchTextResource()` uses the same-origin resource redirect
policy and therefore cannot widen the set of persisted page URLs.

- [x] **Step 4: Pass source client tests**

Run:

```powershell
corepack pnpm test -- tests/unit/source-client.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/modules/ingestion/source-client.ts tests/unit/source-client.test.ts
git commit -m "feat: add bounded Shopify source client"
```

## Task 5: Discover Approved URLs From Sitemap

**Files:**

- Create: `src/modules/ingestion/sitemap.ts`
- Create: `tests/fixtures/ingestion/sitemap-index.xml`
- Create: `tests/fixtures/ingestion/sitemap-docs.xml`
- Test: `tests/unit/sitemap.test.ts`
- Modify: `src/db/repositories/ingestion-repository.ts`
- Test: `tests/integration/ingestion-repository.test.ts`

- [x] **Step 1: Add Sitemap fixtures**

`sitemap-index.xml` must reference one same-origin child Sitemap and one external
Sitemap. `sitemap-docs.xml` must contain:

- `/docs`
- `/docs/apps`
- `/docs/api/admin-graphql/latest`
- a duplicate `/docs/apps/`
- `/changelog/example`
- `/beta/example`
- a query-string URL

Include valid `<lastmod>` values for at least two allowed pages.

- [x] **Step 2: Write failing parser tests**

Create `tests/unit/sitemap.test.ts` covering URL Set, Sitemap Index, deduplication,
recursive depth, maximum file count, maximum candidate count, and external Sitemap
rejection:

```ts
expect(discovered).toEqual([
  {
    canonicalUrl: "https://shopify.dev/docs",
    lastModifiedAt: undefined,
  },
  {
    canonicalUrl: "https://shopify.dev/docs/api/admin-graphql/latest",
    lastModifiedAt: new Date("2026-06-11T00:00:00.000Z"),
  },
  {
    canonicalUrl: "https://shopify.dev/docs/apps",
    lastModifiedAt: new Date("2026-06-10T00:00:00.000Z"),
  },
]);
```

- [x] **Step 3: Implement recursive Sitemap discovery**

Use `fast-xml-parser` with external entity processing disabled. Export:

```ts
export async function discoverSitemapUrls(input: {
  roots: string[];
  fetchResource: SourceClient["fetchTextResource"];
  robots: RobotsPolicy;
  limits?: {
    maxDepth: number;
    maxFiles: number;
    maxCandidates: number;
  };
}): Promise<DiscoveredPage[]>;
```

Only recurse into same-origin HTTPS Sitemap URLs. Apply URL Policy and Robots Policy
to every page candidate. Sort the final result by canonical URL for deterministic
tests.

- [x] **Step 4: Add repository tests for complete Discovery**

Extend `ingestion-repository.test.ts` to assert:

- Upsert sets `last_discovered_at`.
- A second complete Discovery sets `missing_from_sitemap_at` only for pages absent
  from the complete result.
- A simulated failed Discovery does not call the missing-page update.
- Newly discovered pages enqueue low-priority `fetch_page` jobs.

- [x] **Step 5: Implement Discovery persistence**

Create the initial `ingestion-repository.ts` methods:

```ts
upsertDiscoveredPages(input: {
  discoveredAt: Date;
  pages: DiscoveredPage[];
}): Promise<Array<{ id: string; canonicalUrl: string }>>;

markMissingFromCompletedDiscovery(input: {
  discoveryStartedAt: Date;
  completedAt: Date;
}): Promise<number>;
```

The service layer, not the parser, calls `markMissingFromCompletedDiscovery()` only
after every Sitemap finishes successfully.

- [x] **Step 6: Run unit and integration tests**

Run:

```powershell
corepack pnpm test -- tests/unit/sitemap.test.ts
corepack pnpm test:integration -- tests/integration/ingestion-repository.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add src/modules/ingestion/sitemap.ts src/db/repositories/ingestion-repository.ts tests/fixtures/ingestion tests/unit/sitemap.test.ts tests/integration/ingestion-repository.test.ts
git commit -m "feat: discover approved Shopify documentation pages"
```

## Task 6: Parse Markdown And HTML Into Stable Blocks

**Files:**

- Create: `src/modules/ingestion/markdown-parser.ts`
- Create: `src/modules/ingestion/html-parser.ts`
- Create: `src/modules/ingestion/parser.ts`
- Modify: `src/modules/ingestion/types.ts`
- Create: `tests/fixtures/ingestion/page.md`
- Create: `tests/fixtures/ingestion/page.html`
- Test: `tests/unit/ingestion-parser.test.ts`

- [x] **Step 1: Create equivalent Markdown and HTML fixtures**

Both fixtures must represent the same document and contain:

- H1 and H2 headings.
- A paragraph with a link, inline code, file path, and API identifier.
- Nested unordered and ordered lists.
- A GFM table.
- A warning notice.
- A fenced TypeScript code block whose comments must remain unchanged.
- An image with Alt and Caption.

The HTML fixture must include distracting `nav`, search, login, footer, script, and
button elements outside a single `<main>` element.

- [x] **Step 2: Write failing parser tests**

Create `ingestion-parser.test.ts`:

```ts
it.each([
  ["text", "tests/fixtures/ingestion/page.md"],
  ["html", "tests/fixtures/ingestion/page.html"],
] as const)("parses %s into the same semantic block sequence", async (format, path) => {
  const body = await readFile(path, "utf8");
  const page = parseSourcePage({ body, sourceFormat: format });

  expect(page.title).toBe("Build Shopify apps");
  expect(page.blocks.map((block) => block.type)).toEqual([
    "heading",
    "paragraph",
    "heading",
    "list",
    "table",
    "notice",
    "code",
    "image",
  ]);
  expect(page.blocks.find((block) => block.type === "code")).toMatchObject({
    translatable: false,
    payload: { language: "typescript" },
  });
});
```

Also assert ordinals, heading paths, nested list payloads, table cells, notice type,
image URL/Alt/Caption, and protected inline token payloads. Add failure tests for no
unique HTML `<main>`, empty content, too many blocks, excessive nesting, and an
oversized block.

- [x] **Step 3: Implement shared parser types**

In `types.ts`, define `BlockType`, `ProtectedToken`, `ParsedBlock`, and `ParsedPage`.
Keep `payload` JSON-safe:

```ts
export type ProtectedToken = {
  kind: "inline_code" | "url" | "file_path" | "identifier";
  value: string;
  start: number;
  end: number;
};
```

- [x] **Step 4: Implement Markdown AST parsing**

Use `unified().use(remarkParse).use(remarkGfm).parse(body)`. Traverse MDAST nodes and
convert only supported nodes into domain blocks. Treat blockquotes whose first text
starts with `Note:`, `Tip:`, `Caution:`, or `Warning:` as notices. Preserve code
content exactly except CRLF-to-LF normalization.

- [x] **Step 5: Implement HTML DOM parsing**

Use Cheerio to parse HTML. Require exactly one `main`, `article`, or
`[data-docs-content]` candidate after applying an ordered selector list; reject
ambiguous matches at the selected priority. Remove `nav`, `footer`, `script`,
`style`, forms, buttons, and elements marked hidden. Convert semantic elements to
the same domain block payload shapes as Markdown.

- [x] **Step 6: Add parser validation and pass tests**

`parser.ts` selects the format parser, assigns ordinals, validates:

- At least one heading or paragraph.
- At most 10,000 blocks.
- At most 20 nested levels.
- At most 1 MiB UTF-8 bytes per block.

Run:

```powershell
corepack pnpm test -- tests/unit/ingestion-parser.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add src/modules/ingestion tests/fixtures/ingestion/page.md tests/fixtures/ingestion/page.html tests/unit/ingestion-parser.test.ts
git commit -m "feat: parse Shopify docs into structured blocks"
```

## Task 7: Compute Stable Fingerprints And Block Diffs

**Files:**

- Create: `src/modules/ingestion/fingerprint.ts`
- Create: `src/modules/ingestion/diff.ts`
- Create: `tests/fixtures/ingestion/page-changed.md`
- Test: `tests/unit/ingestion-diff.test.ts`

- [x] **Step 1: Write failing fingerprint tests**

Cover:

- CRLF and LF produce the same natural-language fingerprint.
- Repeated prose whitespace does not change a paragraph fingerprint.
- Code indentation changes do change a code fingerprint.
- Link destinations and inline protected token values affect the fingerprint.
- Page order affects the page fingerprint.

- [x] **Step 2: Write failing diff tests**

Use small explicit block arrays to cover:

- First version: every current block is `added`.
- One changed paragraph: one `modified`, all other mappings unchanged.
- Pure movement: one or more `moved`, no translation candidates.
- Deletion: a `deleted` change with no current block.
- Duplicate identical paragraphs: nearest ordinal wins deterministically.
- Insertion near duplicate content does not mark every following block modified.

The returned contract must be:

```ts
export type BlockDiff = {
  changes: Array<
    | { kind: "added"; currentIndex: number }
    | { kind: "modified"; previousIndex: number; currentIndex: number }
    | { kind: "moved"; previousIndex: number; currentIndex: number }
    | { kind: "deleted"; previousIndex: number }
  >;
  translationCandidateIndexes: number[];
};
```

- [x] **Step 3: Implement canonical JSON fingerprints**

`fingerprint.ts` must recursively sort object keys before JSON serialization, preserve
array order, normalize prose whitespace, and normalize only line endings for code.
Export:

```ts
fingerprintBlock(block: ParsedBlock): string;
fingerprintPage(blocks: FingerprintedBlock[]): string;
```

- [x] **Step 4: Implement deterministic matching**

`diff.ts` first pairs exact `type + fingerprint` matches using nearest ordinal and a
stable index tie-break. Then align remaining same-type blocks using heading path and
neighbor fingerprints. A current block is a translation candidate only when it is
`added` or `modified` and `translatable` is true.

- [x] **Step 5: Pass diff tests**

Run:

```powershell
corepack pnpm test -- tests/unit/ingestion-diff.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add src/modules/ingestion/fingerprint.ts src/modules/ingestion/diff.ts tests/fixtures/ingestion/page-changed.md tests/unit/ingestion-diff.test.ts
git commit -m "feat: detect stable source block changes"
```

## Task 8: Publish Page Versions Atomically

**Files:**

- Modify: `src/db/repositories/ingestion-repository.ts`
- Test: `tests/integration/ingestion-repository.test.ts`

- [x] **Step 1: Write failing publisher integration tests**

Extend the repository test with isolated source URLs and cleanup. Cover:

1. First publish creates version 1, all blocks, `added` changes, translation jobs for
   translatable blocks, and updates `current_version_id`.
2. Publishing the same page fingerprint updates `last_checked_at`, `etag`, and
   `last_modified` but creates no version or translation job.
3. One changed paragraph creates version 2, one `modified` change, and one translation
   job.
4. A moved paragraph creates version 2 and a `moved` change but no translation job.
5. A deleted block creates a `deleted` change with `current_block_id = null`.
6. A forced exception after version insertion rolls back the version, blocks, changes,
   translation jobs, and current pointer.
7. Two concurrent identical publishes produce only one new version.

- [x] **Step 2: Run the publisher tests and confirm failure**

Run:

```powershell
corepack pnpm test:integration -- tests/integration/ingestion-repository.test.ts
```

Expected: FAIL because publish methods are absent.

- [x] **Step 3: Implement page state methods**

Add:

```ts
findPageByCanonicalUrl(url: string): Promise<SourcePage | undefined>;
getCurrentPageSnapshot(pageId: string): Promise<{
  page: SourcePage;
  version?: PageVersion;
  blocks: StoredBlock[];
}>;
recordNotModified(input: {
  pageId: string;
  checkedAt: Date;
  etag?: string;
  lastModified?: string;
}): Promise<void>;
markPageGone(pageId: string, checkedAt: Date): Promise<void>;
markPageBlocked(pageId: string, checkedAt: Date): Promise<void>;
```

- [x] **Step 4: Implement transactional publish**

Add:

```ts
publishParsedPage(input: {
  pageId: string;
  parsedPage: ParsedPage;
  pageFingerprint: string;
  blockFingerprints: string[];
  diff: BlockDiff;
  fetchedAt: Date;
  etag?: string;
  lastModified?: string;
}): Promise<
  | { kind: "published"; versionId: string; versionNumber: number }
  | { kind: "unchanged"; versionId: string }
>;
```

Inside one transaction:

- Lock `source_pages` with `FOR UPDATE`.
- Re-read the current version and short-circuit if the fingerprint now matches.
- Allocate `version_number = current + 1`.
- Insert every current block.
- Translate diff indexes into persisted previous/current block IDs.
- Enqueue translation jobs with
  `dedupeKey = translate:${currentBlockId}:${contentFingerprint}`.
- Update page title, status, cache validators, timestamps, and current pointer.

Expose an optional test-only callback invoked after version insertion so rollback can
be tested without production-only branching:

```ts
type PublishHooks = {
  afterVersionInserted?: () => Promise<void>;
};
```

The repository factory accepts hooks; production passes none.

- [x] **Step 5: Pass publisher tests**

Run:

```powershell
corepack pnpm test:integration -- tests/integration/ingestion-repository.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add src/db/repositories/ingestion-repository.ts tests/integration/ingestion-repository.test.ts
git commit -m "feat: publish versioned source pages atomically"
```

## Task 9: Compose Discovery, Fetching, Parsing, And Publishing

**Files:**

- Create: `src/modules/ingestion/ingestion-service.ts`
- Test: `tests/helpers/fixture-server.ts`
- Test: `tests/integration/ingestion-pipeline.test.ts`

- [x] **Step 1: Create a local Fixture HTTP server**

`fixture-server.ts` must:

- Bind to `127.0.0.1` on an ephemeral port.
- Serve configurable Robots, Sitemap, `.txt`, and HTML responses.
- Record method, path, and headers.
- Support redirects, delayed responses, chunked oversized bodies, `304`, `404`,
  `410`, `429`, and `500`.
- Return an async `close()` and always close in `afterEach`.

The production URL policy stays fixed to `shopify.dev`; tests inject a transport that
maps approved Shopify URLs to the local server without weakening policy code.

- [x] **Step 2: Write failing service tests**

Create `ingestion-pipeline.test.ts` with real PostgreSQL, real parsers, real
repositories, and the local server. Cover:

- Successful Robots refresh stores the policy.
- Failed first Robots refresh prevents Discovery.
- Failed later Robots refresh uses the cached policy.
- Discovery persists only approved pages and enqueues fetches.
- A full page ingestion publishes English blocks and translation jobs.
- A `304` creates no version.
- A changed paragraph creates only one translation job.
- `404/410` marks `gone` and preserves `current_version_id`.
- Robots denial marks `blocked` and preserves `current_version_id`.
- Parser failure stores a 7-day diagnostic payload and preserves the current version.
- Expired diagnostic payload cleanup deletes only expired rows.

- [x] **Step 3: Define service dependencies and public API**

Create `ingestion-service.ts`:

```ts
export function createIngestionService(deps: {
  ingestionRepository: IngestionRepository;
  jobRepository: JobRepository;
  sourceClient: SourceClient;
  now: () => Date;
}) {
  return {
    refreshRobotsPolicy(): Promise<void>,
    discoverPages(): Promise<{ discovered: number; queued: number }>,
    ingestPage(url: string, jobId: string): Promise<IngestPageResult>,
    requestPageIngestion(
      url: string,
      priority: "normal" | "high",
    ): Promise<{
      pageId: string | null;
      jobId: string;
      state: "already_current" | "queued" | "promoted";
    }>,
    cleanupExpiredPayloads(): Promise<number>,
  };
}
```

- [x] **Step 4: Complete repository support for policies and diagnostics**

Add these methods to `ingestion-repository.ts` before implementing the service:

```ts
getRobotsPolicy(origin: string): Promise<StoredRobotsPolicy | undefined>;
saveRobotsPolicy(input: {
  origin: string;
  body: string;
  sitemapUrls: string[];
  fetchedAt: Date;
  expiresAt: Date;
}): Promise<StoredRobotsPolicy>;
recordFetchAttempt(input: FetchAttemptInput): Promise<{ id: string }>;
saveSourcePayload(input: {
  fetchAttemptId: string;
  contentType: string;
  body: string;
  expiresAt: Date;
}): Promise<void>;
deleteExpiredSourcePayloads(now: Date): Promise<number>;
listActivePagesForRefresh(): Promise<
  Array<{ id: string; canonicalUrl: string }>
>;
```

`saveRobotsPolicy()` only runs after successful parsing. A failed fetch must never
overwrite the last successful policy.

- [x] **Step 5: Implement orchestration and attempts**

For every source request, insert a `fetch_attempts` row with stable result/error codes.
On parse failure, save the bounded body in `source_payloads` with
`expires_at = now + 7 days`. Truncate error messages to 2,000 characters.

`requestPageIngestion()` must:

- Validate and canonicalize before touching the database.
- Return `already_current` only when a page has a current version and no refresh is
  due; Phase 2 defines this as `last_checked_at` less than 24 hours ago.
- Enqueue normal priority `10` or high priority `100`.
- Map `EnqueueJobResult.action === "promoted"` to the public `promoted` state and
  map both `created` and `deduplicated` to `queued`.
- Never expose an anonymous HTTP route in Phase 2.

- [x] **Step 6: Pass pipeline tests**

Run:

```powershell
corepack pnpm test:integration -- tests/integration/ingestion-pipeline.test.ts
```

Expected: PASS without contacting the public internet.

- [x] **Step 7: Commit**

```powershell
git add src/modules/ingestion/ingestion-service.ts tests/helpers/fixture-server.ts tests/integration/ingestion-pipeline.test.ts
git commit -m "feat: compose the Shopify ingestion pipeline"
```

## Task 10: Add The Worker Loop And Daily Scheduling

**Files:**

- Create: `src/modules/jobs/scheduler.ts`
- Create: `src/modules/jobs/worker.ts`
- Create: `src/worker/main.ts`
- Modify: `package.json`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/env.test.ts`
- Test: `tests/integration/job-repository.test.ts`
- Test: `tests/integration/ingestion-pipeline.test.ts`

- [x] **Step 1: Write failing environment and scheduler tests**

Extend `env.test.ts` for:

```ts
SOURCE_REQUEST_CONCURRENCY: "2",
SOURCE_REQUEST_INTERVAL_MS: "500",
SOURCE_TIMEOUT_MS: "20000",
SOURCE_MAX_RESPONSE_BYTES: "8388608",
INGESTION_POLL_INTERVAL_MS: "1000",
INGESTION_LEASE_MS: "120000",
```

Reject concurrency above 4, interval below 250 ms, timeout outside
`1_000..60_000`, response limit above 16 MiB, poll interval below 100 ms, and lease
shorter than twice the source timeout.

Add scheduler tests asserting:

- Repeated startup creates one active daily Discovery and cleanup job.
- Active pages receive one daily refresh job each.
- Refresh `run_at` values are spread deterministically across 24 hours.

- [x] **Step 2: Implement validated environment settings**

Add the six variables to `env.ts` with the defaults above and to `.env.example`.
Derive the source client and worker configuration only from `getEnv()`.

- [x] **Step 3: Implement scheduler**

`scheduler.ts` exports:

```ts
ensureMaintenanceJobs(now: Date): Promise<void>;
scheduleDailyPageRefreshes(now: Date): Promise<number>;
```

Use daily UTC date keys in dedupe values:

```text
maintenance:discover:2026-06-12
maintenance:cleanup:2026-06-12
refresh:<page-id>:2026-06-12
```

Distribute pages by a stable hash of page ID modulo 86,400 seconds.

- [x] **Step 4: Implement worker dispatch and lease renewal**

`worker.ts` must claim only `ingestion` jobs and dispatch:

- `discover_sitemap` -> refresh Robots, discover pages, schedule refreshes.
- `fetch_page` -> ingest the payload URL.
- `cleanup_payloads` -> delete expired source payloads.
- `translate_block` -> reject as wrong queue/type and terminally fail.

Start lease renewal every `leaseMs / 3`, clear the timer in `finally`, and complete
only if the current worker still owns the lease. Retry with 1 minute, 5 minute, and
30 minute backoff plus injected jitter.

- [x] **Step 5: Add the executable worker entrypoint**

Create `src/worker/main.ts` that composes `db`, repositories, source client, service,
scheduler, and worker. Handle `SIGINT`/`SIGTERM`, stop claiming new jobs, await the
current job, close the PostgreSQL pool, and exit cleanly.

Add scripts:

```json
{
  "worker": "tsx src/worker/main.ts",
  "worker:dev": "tsx watch src/worker/main.ts"
}
```

- [x] **Step 6: Run focused tests**

Run:

```powershell
corepack pnpm test -- tests/unit/env.test.ts
corepack pnpm test:integration -- tests/integration/job-repository.test.ts tests/integration/ingestion-pipeline.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add src/modules/jobs src/worker src/lib/env.ts .env.example package.json tests/unit/env.test.ts tests/integration
git commit -m "feat: run scheduled ingestion workers"
```

## Task 11: Document Operations And Verify Phase 2

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-11-shopify-dev-proxy-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-12-shopify-content-ingestion.md`

- [x] **Step 1: Update local operation documentation**

Add to `README.md`:

- Phase 2 scope is `/docs/**`, including `/docs/api/**`, excluding Changelog.
- `corepack pnpm worker` runs the persistent ingestion worker.
- Source rate/timeout/size environment variables.
- `.txt`-first behavior and no live translation in Phase 2.
- How to inspect queued/running/failed jobs with a read-only SQL query.
- Automated tests use fixtures and never crawl Shopify.dev.

- [x] **Step 2: Update the roadmap status**

Mark Phase 2 as implemented only after all acceptance commands pass. Link the design
and this detailed plan from the Phase 2 section. Do not mark Phase 3 started.

- [x] **Step 3: Run migration from a clean test database**

Use the dedicated `shopify_docs_test` database. Drop and recreate only that explicitly
named test database using the existing local PostgreSQL test runtime, then run:

```powershell
$env:NODE_ENV="test"
$env:DATABASE_URL="postgres://app:app@127.0.0.1:5432/shopify_docs_test"
$env:APP_ORIGIN="http://127.0.0.1:3000"
$env:SESSION_DAYS="30"
corepack pnpm db:migrate
```

Expected: both foundation and content-ingestion migrations apply successfully.

- [x] **Step 4: Run the complete verification suite**

Run:

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration

$env:E2E_ADMIN_PASSWORD="phase-one-test-password"
corepack pnpm test:e2e:seed
corepack pnpm test:e2e
corepack pnpm build
```

Expected:

- Lint and typecheck exit 0.
- All unit and integration tests pass.
- Existing authentication E2E passes.
- Production build completes.
- No test makes a request to public Shopify.dev.

- [x] **Step 5: Check migration and working-tree hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only intended Phase 2 files are modified.

- [x] **Step 6: Commit documentation and plan completion**

```powershell
git add README.md docs/superpowers/plans
git commit -m "docs: document phase two ingestion operations"
```

## Acceptance Coverage Map

| Design requirement | Implemented by |
| --- | --- |
| `/docs/**` allowlist and redirect checks | Task 2 |
| Robots caching and fail-closed behavior | Tasks 2 and 9 |
| Recursive bounded Sitemap discovery | Task 5 |
| `.txt` first, HTML fallback, request limits | Task 4 |
| Stable heading, prose, list, table, notice, code, image blocks | Task 6 |
| Stable fingerprints and block-level changes | Task 7 |
| Atomic versions and translation job selection | Task 8 |
| On-demand priority and deduplication | Tasks 3 and 9 |
| Durable leases, retries, recovery, daily schedules | Tasks 3 and 10 |
| Preserve current version on every failure class | Tasks 8 and 9 |
| API Reference included, Changelog excluded | Tasks 2, 5, and 9 |
| Full automated and production verification | Task 11 |
