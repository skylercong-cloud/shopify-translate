import { describe, expect, it } from "vitest";

import type {
  RestoreVerificationOptions,
  RestoreVerificationResult,
} from "@/modules/operations/restore-verification";
import { runRestoreVerificationCli } from "@/modules/operations/restore-verification-cli";

function createLogger() {
  const messages: string[] = [];
  const errors: string[] = [];

  return {
    errors,
    logger: {
      error(message: string) {
        errors.push(message);
      },
      log(message: string) {
        messages.push(message);
      },
    },
    messages,
  };
}

function createResult(
  overrides: Partial<RestoreVerificationResult> = {},
): RestoreVerificationResult {
  return {
    checksumPath: "backups/shopify-docs-20260618-072000.dump.sha256",
    dumpPath: "backups/shopify-docs-20260618-072000.dump",
    temporaryDatabaseName: "shopify_docs_restore_verify_20260618_072000_abcd",
    ...overrides,
  };
}

describe("restore verification CLI", () => {
  const now = new Date("2026-06-18T07:20:00.000Z");

  it("runs restore verification with required and optional environment settings", async () => {
    const { errors, logger, messages } = createLogger();
    const calls: RestoreVerificationOptions[] = [];

    const exitCode = await runRestoreVerificationCli({
      env: {
        BACKUP_CHECKSUM_PATH:
          "backups/shopify-docs-20260618-072000.dump.sha256",
        BACKUP_DUMP_PATH: "backups/shopify-docs-20260618-072000.dump",
        DATABASE_URL: "postgres://app:app@db:5432/shopify_docs",
        RESTORE_VERIFY_DATABASE_PREFIX: "restore_verify",
        RESTORE_VERIFY_PG_RESTORE_PATH: "/usr/bin/pg_restore",
        RESTORE_VERIFY_PSQL_PATH: "/usr/bin/psql",
      },
      logger,
      now,
      verifyRestore: async (options) => {
        calls.push(options);
        return createResult({
          checksumPath: options.checksumPath,
          dumpPath: options.dumpPath,
          temporaryDatabaseName: "restore_verify_20260618_072000_abcd",
        });
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        checksumPath: "backups/shopify-docs-20260618-072000.dump.sha256",
        databaseUrl: "postgres://app:app@db:5432/shopify_docs",
        dumpPath: "backups/shopify-docs-20260618-072000.dump",
        now,
        pgRestorePath: "/usr/bin/pg_restore",
        psqlPath: "/usr/bin/psql",
        temporaryDatabasePrefix: "restore_verify",
      },
    ]);
    expect(messages).toEqual([
      "Backup checksum verified: backups/shopify-docs-20260618-072000.dump.sha256",
      "Restore verified from: backups/shopify-docs-20260618-072000.dump",
      "Temporary database dropped: restore_verify_20260618_072000_abcd",
    ]);
    expect(errors).toEqual([]);
  });

  it("reports a missing dump path without running restore verification", async () => {
    const { errors, logger, messages } = createLogger();
    const calls: RestoreVerificationOptions[] = [];

    const exitCode = await runRestoreVerificationCli({
      env: {
        DATABASE_URL: "postgres://app:app@db:5432/shopify_docs",
      },
      logger,
      now,
      verifyRestore: async (options) => {
        calls.push(options);
        return createResult();
      },
    });

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(messages).toEqual([]);
    expect(errors).toEqual(["BACKUP_DUMP_PATH is required"]);
  });

  it("reports a missing database URL without running restore verification", async () => {
    const { errors, logger } = createLogger();
    const calls: RestoreVerificationOptions[] = [];

    const exitCode = await runRestoreVerificationCli({
      env: {
        BACKUP_DUMP_PATH: "backups/shopify-docs-20260618-072000.dump",
      },
      logger,
      now,
      verifyRestore: async (options) => {
        calls.push(options);
        return createResult();
      },
    });

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(errors).toEqual(["DATABASE_URL is required"]);
  });
});
