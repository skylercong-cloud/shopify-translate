import { describe, expect, it } from "vitest";

import { runProductionPreflight } from "@/modules/operations/production-preflight";

const requiredFiles = [
  ".env.production",
  "Caddyfile",
  "Dockerfile",
  "compose.production.yaml",
];

const validEnv = [
  "NODE_ENV=production",
  "SITE_DOMAIN=docs.example.cn",
  "APP_ORIGIN=https://docs.example.cn",
  "POSTGRES_DB=shopify_docs",
  "POSTGRES_USER=app",
  "POSTGRES_PASSWORD=production-postgres-password-32",
  "DATABASE_URL=postgres://app:production-postgres-password-32@db:5432/shopify_docs",
  "SESSION_DAYS=30",
  "MODEL_KEY_ENCRYPTION_KEY=abcdefghijklmnopqrstuvwxyz123456",
].join("\n");

function run(input: {
  envText?: string;
  existingFiles?: string[];
}) {
  const files = new Set(input.existingFiles ?? requiredFiles);

  return runProductionPreflight({
    cwd: "project",
    envFileName: ".env.production",
    fileExists: async (path) => files.has(path.replace(/^project[\\/]/, "")),
    readTextFile: async (path) => {
      if (path.endsWith(".env.production")) {
        return input.envText ?? validEnv;
      }
      throw new Error(`Unexpected read: ${path}`);
    },
  });
}

describe("runProductionPreflight", () => {
  it("passes with deployment files and production env values", async () => {
    const result = await run({});

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("reports missing required environment variables", async () => {
    const result = await run({ envText: "NODE_ENV=production" });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "DATABASE_URL",
          status: "fail",
        }),
        expect.objectContaining({
          name: "APP_ORIGIN",
          status: "fail",
        }),
        expect.objectContaining({
          name: "SITE_DOMAIN",
          status: "fail",
        }),
        expect.objectContaining({
          name: "POSTGRES_PASSWORD",
          status: "fail",
        }),
        expect.objectContaining({
          name: "MODEL_KEY_ENCRYPTION_KEY",
          status: "fail",
        }),
        expect.objectContaining({
          name: "SESSION_DAYS",
          status: "fail",
        }),
      ]),
    );
  });

  it("rejects example placeholder values", async () => {
    const result = await run({
      envText: [
        "NODE_ENV=production",
        "SITE_DOMAIN=docs.example.com",
        "APP_ORIGIN=https://docs.example.com",
        "POSTGRES_PASSWORD=replace-with-long-random-postgres-password",
        "DATABASE_URL=postgres://app:replace-with-long-random-postgres-password@db:5432/shopify_docs",
        "SESSION_DAYS=30",
        "MODEL_KEY_ENCRYPTION_KEY=replace-with-32-byte-base64-key",
      ].join("\n"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "SITE_DOMAIN",
          status: "fail",
          message: expect.stringContaining("placeholder"),
        }),
        expect.objectContaining({
          name: "POSTGRES_PASSWORD",
          status: "fail",
          message: expect.stringContaining("placeholder"),
        }),
        expect.objectContaining({
          name: "MODEL_KEY_ENCRYPTION_KEY",
          status: "fail",
          message: expect.stringContaining("placeholder"),
        }),
      ]),
    );
  });

  it("reports missing deployment files", async () => {
    const result = await run({
      existingFiles: [".env.production", "Dockerfile"],
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Caddyfile",
          status: "fail",
        }),
        expect.objectContaining({
          name: "compose.production.yaml",
          status: "fail",
        }),
      ]),
    );
  });
});
