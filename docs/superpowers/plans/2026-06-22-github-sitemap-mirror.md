# GitHub Sitemap Mirror Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Keep Shopify Sitemap discovery working when the production CDN route rejects the gzip child Sitemap.

**Architecture:** Shopify.dev remains the primary source. The source client gains bounded gzip decoding and a separately allowlisted GitHub raw-resource method. The ingestion service falls back to one validated mirror URL set only after official discovery throws. A daily GitHub Actions workflow publishes that mirror on an orphan branch.

**Tech Stack:** TypeScript, Next.js, Vitest, fast-xml-parser, Node.js zlib, Docker Compose, GitHub Actions.

---

### Task 1: Lock Configuration and URL Security

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/modules/ingestion/url-policy.ts`
- Test: `tests/unit/env.test.ts`
- Test: `tests/unit/url-policy.test.ts`

Add an optional `SOURCE_SITEMAP_MIRROR_URL` and accept only an HTTPS XML URL on
`raw.githubusercontent.com`, without credentials, query, or fragment. Test valid,
empty, and rejected values before implementing the schemas.

### Task 2: Support Official gzip and the Mirror Fetch Channel

**Files:**
- Modify: `src/modules/ingestion/source-client.ts`
- Test: `tests/unit/source-client.test.ts`

Read response bytes under the existing limit, decode text normally, and gunzip
official gzip Sitemap responses under the same decompressed-size limit. Add a
dedicated mirror fetch method whose redirects use the mirror allowlist. Test
successful gzip, malformed gzip, oversized output, accepted mirror XML, and a
cross-origin redirect.

### Task 3: Fall Back Only After Official Discovery Fails

**Files:**
- Modify: `src/modules/ingestion/sitemap.ts`
- Modify: `src/modules/ingestion/ingestion-service.ts`
- Modify: `src/worker/main.ts`
- Test: `tests/unit/sitemap.test.ts`
- Test: `tests/integration/ingestion-pipeline.test.ts`

Parse the mirror as a single URL set with existing candidate and Robots checks.
Wire the optional URL into the worker. Verify that official success never calls
the mirror, official failure uses it, and failure remains visible when no mirror
is configured.

### Task 4: Publish and Configure the Daily Mirror

**Files:**
- Create: `.github/workflows/sync-shopify-sitemap.yml`
- Modify: `.env.production.example`
- Modify: `compose.production.yaml`
- Modify: `docs/deployment.md`
- Modify: `README.md`
- Test: `tests/unit/production-packaging.test.ts`

Create a daily and manually triggered workflow using only GitHub checkout plus
standard shell/Python tools. Validate XML and Shopify docs URLs before publishing
the decompressed file to `sitemap-cache`. If Shopify blocks the GitHub runner,
verify and retain the existing mirror with a visible warning. Document the
production environment value, worker rebuild, and verification commands.

### Task 5: Verify and Publish

Run focused unit and integration tests, then `pnpm test`, `pnpm lint`,
`pnpm typecheck`, and a production `pnpm build`. Check the diff, commit the
complete change, and push `main`.
