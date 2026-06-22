import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function readComposeService(compose: string, service: string) {
  const match = new RegExp(
    `\\r?\\n  ${service}:\\r?\\n([\\s\\S]*?)(?=\\r?\\n  [a-zA-Z0-9_-]+:\\r?\\n|\\r?\\nvolumes:|$)`,
  ).exec(compose);

  return match?.[1] ?? "";
}

describe("production packaging", () => {
  it("builds a locked production app image for web and workers", () => {
    const dockerfile = readWorkspaceFile("Dockerfile");

    expect(dockerfile).toContain("FROM node:22-alpine AS base");
    expect(dockerfile).toContain("FROM base AS deps");
    expect(dockerfile).toContain("corepack enable");
    expect(dockerfile).toContain("postgresql-client");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("corepack pnpm build");
    expect(dockerfile).toContain(".next/standalone");
    expect(dockerfile).toContain(
      "COPY --from=builder /app/.next/static ./.next/standalone/.next/static",
    );
    expect(dockerfile).toContain("adduser");
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain('CMD ["node", ".next/standalone/server.js"]');
  });

  it("provides non-secret environment values only while Next.js builds", () => {
    const dockerfile = readWorkspaceFile("Dockerfile");
    const builderStage = /FROM base AS builder([\s\S]*?)FROM base AS runner/.exec(
      dockerfile,
    )?.[1];

    expect(builderStage).toContain(
      "ENV DATABASE_URL=postgres://app:build-only@127.0.0.1:5432/shopify_docs",
    );
    expect(builderStage).toContain("ENV APP_ORIGIN=https://build.invalid");
    expect(dockerfile).not.toContain("ARG DATABASE_URL");
    expect(dockerfile).not.toContain("ARG APP_ORIGIN");
  });

  it("defines an internal production compose stack with persistent data", () => {
    const compose = readWorkspaceFile("compose.production.yaml");

    for (const service of [
      "web:",
      "worker:",
      "translation-worker:",
      "backup-init:",
      "backup:",
      "db:",
      "caddy:",
    ]) {
      expect(compose).toContain(service);
    }

    const dbService = readComposeService(compose, "db");
    const backupInitService = readComposeService(compose, "backup-init");
    const backupService = readComposeService(compose, "backup");
    const caddyService = readComposeService(compose, "caddy");

    expect(compose).toContain("postgres:16-alpine");
    expect(compose).toContain("pg_isready");
    expect(compose).toContain("/api/health/live");
    expect(compose).toContain("corepack pnpm worker");
    expect(compose).toContain("corepack pnpm translation-worker");
    expect(compose).toContain("corepack pnpm backup");
    expect(compose).toContain("SOURCE_SITEMAP_MIRROR_URL");
    expect(compose).toContain("shopify_postgres_data:");
    expect(compose).toContain("shopify_backups:");
    expect(compose).toContain("caddy_data:");
    expect(compose).toContain("caddy_config:");
    expect(dbService).not.toContain("ports:");
    expect(backupInitService).toContain('user: "0:0"');
    expect(backupInitService).toContain(
      'command: ["chown", "nextjs:nodejs", "/backups"]',
    );
    expect(backupService).toContain("condition: service_completed_successfully");
    expect(caddyService).toContain('"80:80"');
    expect(caddyService).toContain('"443:443"');
  });

  it("ships a production environment template without real secrets", () => {
    const env = readWorkspaceFile(".env.production.example");

    for (const key of [
      "NODE_ENV=production",
      "SITE_DOMAIN=",
      "APP_ORIGIN=",
      "DATABASE_URL=",
      "SESSION_DAYS=30",
      "MODEL_KEY_ENCRYPTION_KEY=",
      "SOURCE_REQUEST_CONCURRENCY=",
      "SOURCE_SITEMAP_MIRROR_URL=",
      "INGESTION_POLL_INTERVAL_MS=",
      "TRANSLATION_WORKER_ID=",
      "TRANSLATION_POLL_INTERVAL_MS=",
      "BACKUP_DIR=",
      "BACKUP_RETENTION_DAYS=14",
      "TZ=Asia/Shanghai",
    ]) {
      expect(env).toContain(key);
    }

    expect(env).not.toContain("sk-");
    expect(env).not.toContain("phase-one-test-password");
    expect(env).not.toContain("ADMIN_PASSWORD");
  });

  it("publishes a validated daily Sitemap mirror without application secrets", () => {
    const workflowPath = ".github/workflows/sync-shopify-sitemap.yml";
    expect(existsSync(resolve(process.cwd(), workflowPath))).toBe(true);

    const workflow = readWorkspaceFile(workflowPath);
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("https://shopify.dev/sitemap_standard.xml.gz");
    expect(workflow).toContain("sitemap-cache");
    expect(workflow).toContain("shopify-sitemap.xml");
    expect(workflow).toContain("$RUNNER_TEMP");
    expect(workflow).not.toContain("${{ runner.temp }}");
    expect(workflow).not.toContain("DATABASE_URL");
    expect(workflow).not.toContain("MODEL_KEY_ENCRYPTION_KEY");
  });

  it("terminates TLS with Caddy and sends baseline security headers", () => {
    const caddyfile = readWorkspaceFile("Caddyfile");

    expect(caddyfile).toContain("{$SITE_DOMAIN}");
    expect(caddyfile).toContain("reverse_proxy web:3000");
    expect(caddyfile).toContain("Strict-Transport-Security");
    expect(caddyfile).toContain("X-Content-Type-Options");
    expect(caddyfile).toContain("Referrer-Policy");
    expect(caddyfile).toContain("X-Frame-Options");
    expect(caddyfile).toContain("Permissions-Policy");
  });

  it("documents deployment, filing, backup, rollback, and recovery operations", () => {
    expect(existsSync(resolve(process.cwd(), "docs/deployment.md"))).toBe(true);

    const guide = readWorkspaceFile("docs/deployment.md");

    for (const phrase of [
      "2 vCPU",
      "4 GB",
      ".env.production",
      "MODEL_KEY_ENCRYPTION_KEY",
      "docker compose --env-file .env.production -f compose.production.yaml up -d --build",
      "docker compose --env-file .env.production -f compose.production.yaml exec web corepack pnpm db:migrate",
      "corepack pnpm admin set-password",
      "Hubei ICP",
      "public-security filing",
      "BACKUP_RETENTION_DAYS=14",
      "rollback",
      "restore",
      "/api/health/live",
    ]) {
      expect(guide).toContain(phrase);
    }
  });
});
