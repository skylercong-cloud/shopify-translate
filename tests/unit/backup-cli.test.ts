import { describe, expect, it } from "vitest";

import type { BackupOptions, BackupResult } from "@/modules/operations/backup";
import { runBackupCli } from "@/modules/operations/backup-cli";

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
  overrides: Partial<BackupResult> = {},
): BackupResult {
  return {
    checksumPath: "backups/shopify-docs-20260618-072000.dump.sha256",
    deletedFiles: ["backups/shopify-docs-20260601-072000.dump"],
    dumpPath: "backups/shopify-docs-20260618-072000.dump",
    ...overrides,
  };
}

describe("backup CLI", () => {
  const now = new Date("2026-06-18T07:20:00.000Z");

  it("runs a database backup with default backup settings", async () => {
    const { errors, logger, messages } = createLogger();
    const calls: BackupOptions[] = [];

    const exitCode = await runBackupCli({
      env: {
        DATABASE_URL: "postgres://app:app@127.0.0.1:5432/shopify_docs",
      },
      logger,
      now,
      runBackup: async (options) => {
        calls.push(options);
        return createResult();
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        backupDir: "backups",
        databaseUrl: "postgres://app:app@127.0.0.1:5432/shopify_docs",
        now,
        retentionDays: 14,
      },
    ]);
    expect(messages).toEqual([
      "Backup written: backups/shopify-docs-20260618-072000.dump",
      "Checksum written: backups/shopify-docs-20260618-072000.dump.sha256",
      "Expired backup files deleted: 1",
    ]);
    expect(errors).toEqual([]);
  });

  it("uses backup directory and retention overrides from the environment", async () => {
    const { logger } = createLogger();
    const calls: BackupOptions[] = [];

    await runBackupCli({
      env: {
        BACKUP_DIR: "C:\\backups\\shopify-docs",
        BACKUP_RETENTION_DAYS: "30",
        DATABASE_URL: "postgres://example",
      },
      logger,
      now,
      runBackup: async (options) => {
        calls.push(options);
        return createResult();
      },
    });

    expect(calls).toEqual([
      {
        backupDir: "C:\\backups\\shopify-docs",
        databaseUrl: "postgres://example",
        now,
        retentionDays: 30,
      },
    ]);
  });

  it("reports a missing database URL without running a backup", async () => {
    const { errors, logger, messages } = createLogger();
    const calls: BackupOptions[] = [];

    const exitCode = await runBackupCli({
      env: {},
      logger,
      now,
      runBackup: async (options) => {
        calls.push(options);
        return createResult();
      },
    });

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(messages).toEqual([]);
    expect(errors).toEqual(["DATABASE_URL is required"]);
  });

  it("reports invalid retention days without running a backup", async () => {
    const { errors, logger } = createLogger();
    const calls: BackupOptions[] = [];

    const exitCode = await runBackupCli({
      env: {
        BACKUP_RETENTION_DAYS: "0",
        DATABASE_URL: "postgres://example",
      },
      logger,
      now,
      runBackup: async (options) => {
        calls.push(options);
        return createResult();
      },
    });

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(errors).toEqual([
      "BACKUP_RETENTION_DAYS must be a positive safe integer",
    ]);
  });
});
