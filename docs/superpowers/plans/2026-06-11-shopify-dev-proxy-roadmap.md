# Shopify.dev Chinese Proxy Delivery Roadmap

> **For agentic workers:** Each phase gets its own implementation plan. Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to execute an approved phase plan.

**Goal:** Deliver the approved Shopify.dev Chinese translation proxy as a sequence of
working, testable increments without coupling authentication, ingestion, translation,
search, and production operations into one risky change.

**Architecture:** A TypeScript modular monolith uses Next.js App Router for the web
application and PostgreSQL for application data, search data, and durable jobs. A
separate worker process imports the same domain modules. Docker Compose runs the web,
worker, PostgreSQL, and reverse proxy on one server.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, PostgreSQL, Drizzle ORM,
Vitest, Testing Library, Playwright, Docker Compose, Caddy, DeepSeek API, Alibaba
Cloud Model Studio compatible API.

---

## Delivery Principles

- Every phase ends with working software and explicit acceptance checks.
- Every behavior change starts with a failing test.
- Database changes use committed migrations.
- External services are hidden behind typed adapters and are mocked in unit tests.
- No phase requires a cloud server until the deployment phase.
- API keys and passwords never enter Git history.
- Code blocks and protected technical terms are treated as immutable content.

## Phase 1: Application Foundation And Single-User Access

Detailed plan:
`docs/superpowers/plans/2026-06-11-shopify-dev-proxy-phase-1-foundation.md`

Deliverables:

- Next.js application and shared module structure.
- Environment validation.
- PostgreSQL connection and initial migrations.
- Single admin user with Argon2id password hashing.
- Interactive `admin set-password` CLI.
- Database-backed 30-day sessions with hashed session tokens.
- Login, logout, protected application shell, and no-index defaults.
- Health and readiness endpoints.
- Unit, integration, and browser tests.

Exit criteria:

- An unauthenticated visitor can only access login and health endpoints.
- The admin password can be created or reset without appearing in command history.
- A successful login creates a secure session and opens the protected shell.
- An expired or revoked session returns to login.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`,
  `pnpm test:e2e`, and `pnpm build` pass.

## Phase 2: Shopify Content Discovery And Versioned Ingestion

Status: Implemented and verified on June 12, 2026.

Design:
`docs/superpowers/specs/2026-06-12-shopify-content-ingestion-design.md`

Detailed implementation plan:
`docs/superpowers/plans/2026-06-12-shopify-content-ingestion.md`

Deliverables:

- Sitemap discovery constrained to approved Shopify.dev sections.
- URL canonicalization and robots/access policy checks.
- Rate-limited source client with timeout, retry, user agent, and response-size limits.
- Plain-text-first fetching with HTML fallback.
- Structured page and content-block parser.
- Stable content fingerprints.
- Versioned page persistence and atomic current-version promotion.
- PostgreSQL-backed durable jobs and worker process.
- On-demand high-priority fetch jobs.
- Daily discovery and change-detection schedules.

Exit criteria:

- A fixture sitemap produces only approved canonical URLs.
- A fixture documentation page produces stable blocks for headings, prose, lists,
  tables, notices, code, and images.
- Fetching the same content twice creates no new published version.
- Changing one fixture paragraph marks only that block as changed.
- A failed refresh leaves the last successful version readable.

## Phase 3: Protected Translation Pipeline And Model Failover

Deliverables:

- Glossary and prompt-version schema.
- Protected-token extraction and exact restoration.
- Translation-memory lookup by content fingerprint.
- Unified model-provider interface.
- DeepSeek primary adapter.
- Alibaba Cloud Model Studio/Qwen fallback adapter.
- Structured translation response validation.
- Retry, failover, usage accounting, and daily Token limits.
- Translation states and manual-correction precedence.
- Encrypted API-key storage with a server-held master key.

Exit criteria:

- Code, comments, URLs, numbers, identifiers, and locked terms remain byte-for-byte
  unchanged.
- Cached or manually corrected blocks do not call a model.
- DeepSeek failure invokes Qwen under the configured policy.
- Two provider failures preserve English content and enqueue a retry.
- Every model call records provider, model, prompt version, tokens, latency, and status.

## Phase 4: Focused Reader And Unified Search

Status: Phase 4A focused reader surface and the initial Phase 4B unified cached
search were implemented and browser verified on June 18, 2026. Dedicated
PostgreSQL full-text/trigram index optimization remains a follow-up after
behavior is measured against a larger cached corpus.

Deliverables:

- Focused reading layout with collapsed navigation.
- Chinese/English page switching without changing the document URL.
- Scroll-position and navigation-state preservation.
- Translation-state badges and official-source links.
- Chinese application-layer tokenization.
- PostgreSQL English full-text, trigram, Chinese token, and identifier search.
- Mixed-language search ranking and language-specific snippets.
- On-demand fetch/translation trigger for uncached pages.

Exit criteria:

- Chinese, English, and exact API identifiers locate the same relevant document.
- Untranslated pages remain searchable in English.
- Language switching keeps the page, scroll position, and code blocks unchanged.
- Code blocks in Chinese mode equal stored Shopify source exactly.
- The layout passes desktop and mobile browser tests.

## Phase 5: Personal Administration And Operations

Status: Initial Phase 5A operations overview, degraded-state alerts, provider
settings/API-key replacement, Prompt snapshot activation, runtime numeric
settings form, glossary snapshot activation, and reader-block manual
correction forms were implemented on June 18, 2026. Full glossary CRUD/history
browsing, richer translation diff/history browsing, password/session
administration, and backup automation remain pending for later Phase 5
increments.

Deliverables:

- Provider, model, Prompt, and daily-budget settings.
- Glossary CRUD with validation and conflict detection.
- Translation editor with English diff and manual-review history.
- Job, failure, Token usage, sync, database, and disk status views.
- Session revocation and password-change screen.
- Daily `pg_dump` backup with 14-day retention.
- Backup checksums and restore verification.
- Clear degraded-state banners and operational alerts.

Exit criteria:

- A manual correction wins over AI output until source content changes.
- Prompt and glossary changes are versioned.
- API keys are never returned in full after storage.
- Backup retention deletes only expired backup files.
- Restore verification succeeds against a temporary database.
- Disk/database failure stops new translation writes and surfaces an alert.

## Phase 6: Production Packaging And Mainland Deployment

Deliverables:

- Multi-stage production Docker images for web and worker.
- Docker Compose services, volumes, health checks, and resource limits.
- Caddy HTTPS and security headers.
- Production environment template and secret bootstrap guide.
- Server provisioning checklist for a 2-vCPU/4-GB Linux host.
- Domain, Hubei ICP filing, and public-security filing checklist.
- Deployment, rollback, upgrade, and disaster-recovery runbooks.
- Optional OSS/COS/OBS off-server backup copy.

Exit criteria:

- A clean Linux host can deploy from the documented commands.
- No application service is directly exposed except the reverse proxy.
- Database and backup volumes survive container recreation.
- Health checks detect failed web, worker, and database services.
- Rollback restores the previous image and compatible database state.
- The production site rejects unauthenticated document and API access.

## Spec Coverage Map

| Design requirement | Delivery phase |
| --- | --- |
| Single-user password, session security, protected routes | Phase 1 |
| Sitemap, page parsing, versioning, daily change checks | Phase 2 |
| DeepSeek primary, Qwen fallback, terminology protection | Phase 3 |
| Focused reader, language switch, unified bilingual search | Phase 4 |
| Manual correction, model settings, monitoring, 14-day backups | Phase 5 |
| Rate limits, security headers, Docker, HTTPS, server purchase, domain and Hubei filing | Phase 6 |

## Explicitly Deferred Beyond Version 1

- Multiple users, roles, invitations, and SSO.
- Browser extension or mobile application.
- Local GPU model serving.
- Elasticsearch or another external search cluster.
- Reimplementation of Shopify API Explorer.
- Unlimited immediate translation of the entire site.

## Primary References

- Next.js App Router: <https://nextjs.org/docs/app>
- Drizzle ORM PostgreSQL guide:
  <https://orm.drizzle.team/docs/get-started-postgresql>
- Vitest guide: <https://vitest.dev/guide/>
- Playwright test documentation: <https://playwright.dev/docs/intro>
- PostgreSQL SQL dump documentation:
  <https://www.postgresql.org/docs/current/backup-dump.html>
