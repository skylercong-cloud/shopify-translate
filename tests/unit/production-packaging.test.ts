import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function readComposeService(compose: string, service: string) {
  const match = new RegExp(
    `\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\nvolumes:|$)`,
  ).exec(compose);

  return match?.[1] ?? "";
}

describe("production packaging", () => {
  it("builds a locked production app image for web and workers", () => {
    const dockerfile = readWorkspaceFile("Dockerfile");

    expect(dockerfile).toContain("FROM node:22-alpine AS base");
    expect(dockerfile).toContain("FROM base AS deps");
    expect(dockerfile).toContain("corepack enable");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("corepack pnpm build");
    expect(dockerfile).toContain(".next/standalone");
    expect(dockerfile).toContain("adduser");
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain('CMD ["node", ".next/standalone/server.js"]');
  });

  it("defines an internal production compose stack with persistent data", () => {
    const compose = readWorkspaceFile("compose.production.yaml");

    for (const service of [
      "web:",
      "worker:",
      "translation-worker:",
      "backup:",
      "db:",
      "caddy:",
    ]) {
      expect(compose).toContain(service);
    }

    const dbService = readComposeService(compose, "db");
    const caddyService = readComposeService(compose, "caddy");

    expect(compose).toContain("postgres:16-alpine");
    expect(compose).toContain("pg_isready");
    expect(compose).toContain("/api/health/live");
    expect(compose).toContain("corepack pnpm worker");
    expect(compose).toContain("corepack pnpm translation-worker");
    expect(compose).toContain("corepack pnpm backup");
    expect(compose).toContain("shopify_postgres_data:");
    expect(compose).toContain("shopify_backups:");
    expect(compose).toContain("caddy_data:");
    expect(compose).toContain("caddy_config:");
    expect(dbService).not.toContain("ports:");
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
