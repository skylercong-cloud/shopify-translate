import { createHash } from "node:crypto";
import { basename } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { verifyBackupRestore } from "@/modules/operations/restore-verification";

type CommandCall = {
  args: string[];
  command: string;
};

const databaseUrl = "postgres://app:app@db:5432/shopify_docs";
const dumpPath = "C:\\backups\\shopify-docs-20260618-072000.dump";
const checksumPath = `${dumpPath}.sha256`;
const dumpContent = "custom-format-dump";
const now = new Date("2026-06-18T07:20:00.000Z");
const temporaryDatabaseName =
  "shopify_docs_restore_verify_20260618_072000_abc123";
const temporaryDatabaseUrl =
  "postgres://app:app@db:5432/shopify_docs_restore_verify_20260618_072000_abc123";

function checksumFile(content: string, path = dumpPath) {
  return `${createHash("sha256").update(content).digest("hex")}  ${basename(
    path,
  )}\n`;
}

function createDependencies(options: {
  checksumContent?: string;
  failCommandIndex?: number;
} = {}) {
  const calls: CommandCall[] = [];

  return {
    calls,
    dependencies: {
      readFile: vi.fn(async (path: string) => {
        if (path === dumpPath) return Buffer.from(dumpContent, "utf8");
        if (path === checksumPath) {
          return Buffer.from(
            options.checksumContent ?? checksumFile(dumpContent),
            "utf8",
          );
        }
        throw new Error(`Unexpected read: ${path}`);
      }),
      runCommand: vi.fn(async (command: string, args: string[]) => {
        const index = calls.length;
        calls.push({ args, command });
        if (index === options.failCommandIndex) {
          throw new Error(`${command} failed`);
        }
      }),
    },
  };
}

describe("backup restore verification", () => {
  it("checks the dump checksum, restores into a temporary database, probes it, and drops it", async () => {
    const { calls, dependencies } = createDependencies();

    const result = await verifyBackupRestore(
      {
        databaseUrl,
        dumpPath,
        nonce: "abc123",
        now,
      },
      dependencies,
    );

    expect(result).toEqual({
      checksumPath,
      dumpPath,
      temporaryDatabaseName,
    });
    expect(dependencies.readFile).toHaveBeenCalledWith(checksumPath);
    expect(dependencies.readFile).toHaveBeenCalledWith(dumpPath);
    expect(calls).toEqual([
      {
        command: "psql",
        args: [
          databaseUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `CREATE DATABASE "${temporaryDatabaseName}";`,
        ],
      },
      {
        command: "pg_restore",
        args: [
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--dbname",
          temporaryDatabaseUrl,
          dumpPath,
        ],
      },
      {
        command: "psql",
        args: [
          temporaryDatabaseUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "select count(*) from information_schema.tables;",
        ],
      },
      {
        command: "psql",
        args: [
          databaseUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `DROP DATABASE IF EXISTS "${temporaryDatabaseName}" WITH (FORCE);`,
        ],
      },
    ]);
  });

  it("rejects a checksum mismatch before creating a temporary database", async () => {
    const { calls, dependencies } = createDependencies({
      checksumContent: `${"0".repeat(64)}  ${basename(dumpPath)}\n`,
    });

    await expect(
      verifyBackupRestore(
        {
          databaseUrl,
          dumpPath,
          nonce: "abc123",
          now,
        },
        dependencies,
      ),
    ).rejects.toThrow("Backup checksum mismatch");

    expect(calls).toEqual([]);
  });

  it("drops the temporary database when restore fails after creation", async () => {
    const { calls, dependencies } = createDependencies({
      failCommandIndex: 1,
    });

    await expect(
      verifyBackupRestore(
        {
          databaseUrl,
          dumpPath,
          nonce: "abc123",
          now,
        },
        dependencies,
      ),
    ).rejects.toThrow("pg_restore failed");

    expect(calls).toEqual([
      expect.objectContaining({ command: "psql" }),
      expect.objectContaining({ command: "pg_restore" }),
      {
        command: "psql",
        args: [
          databaseUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `DROP DATABASE IF EXISTS "${temporaryDatabaseName}" WITH (FORCE);`,
        ],
      },
    ]);
  });

  it("validates required inputs before reading backup files", async () => {
    const { dependencies } = createDependencies();

    await expect(
      verifyBackupRestore(
        {
          databaseUrl: " ",
          dumpPath,
          nonce: "abc123",
          now,
        },
        dependencies,
      ),
    ).rejects.toThrow("DATABASE_URL is required");
    await expect(
      verifyBackupRestore(
        {
          databaseUrl,
          dumpPath: " ",
          nonce: "abc123",
          now,
        },
        dependencies,
      ),
    ).rejects.toThrow("dumpPath is required");
    await expect(
      verifyBackupRestore(
        {
          databaseUrl,
          dumpPath,
          nonce: "abc123",
          now,
          temporaryDatabasePrefix: "bad-prefix",
        },
        dependencies,
      ),
    ).rejects.toThrow("temporaryDatabasePrefix must contain only");

    expect(dependencies.readFile).not.toHaveBeenCalled();
  });
});
