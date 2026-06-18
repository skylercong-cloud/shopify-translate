import { createHash } from "node:crypto";
import { basename, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runDatabaseBackup } from "@/modules/operations/backup";

type FakeStat = {
  mtime: Date;
  isFile(): boolean;
};

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createDependencies(options: {
  existingFiles?: string[];
  mtimes?: Record<string, Date>;
  dumpContent?: string;
} = {}) {
  const backupDir = "C:\\backups";
  const dumpContent = options.dumpContent ?? "dump-content";
  const writes = new Map<string, string>();
  const removed: string[] = [];

  return {
    backupDir,
    writes,
    removed,
    dependencies: {
      mkdir: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      readFile: vi.fn(async () => Buffer.from(dumpContent, "utf8")),
      writeFile: vi.fn(async (path: string, data: string) => {
        writes.set(path, data);
      }),
      readdir: vi.fn(async () => options.existingFiles ?? []),
      stat: vi.fn(async (path: string): Promise<FakeStat> => {
        const name = basename(path);
        return {
          mtime:
            options.mtimes?.[name] ??
            new Date("2026-06-18T00:00:00.000Z"),
          isFile: () => true,
        };
      }),
      rm: vi.fn(async (path: string) => {
        removed.push(path);
      }),
    },
  };
}

describe("database backup runner", () => {
  it("runs pg_dump in custom format and writes a checksum file", async () => {
    const now = new Date("2026-06-18T07:06:05.000Z");
    const { backupDir, dependencies, writes } = createDependencies();

    const result = await runDatabaseBackup(
      {
        databaseUrl: "postgres://app:app@127.0.0.1:5432/shopify_docs",
        backupDir,
        now,
        retentionDays: 14,
      },
      dependencies,
    );

    const expectedDump = join(
      backupDir,
      "shopify-docs-20260618-070605.dump",
    );
    const expectedChecksum = `${expectedDump}.sha256`;

    expect(dependencies.mkdir).toHaveBeenCalledWith(backupDir, {
      recursive: true,
    });
    expect(dependencies.runCommand).toHaveBeenCalledWith("pg_dump", [
      "postgres://app:app@127.0.0.1:5432/shopify_docs",
      "-Fc",
      "-f",
      expectedDump,
    ]);
    expect(result).toEqual({
      dumpPath: expectedDump,
      checksumPath: expectedChecksum,
      deletedFiles: [],
    });
    expect(writes.get(expectedChecksum)).toBe(
      `${checksum("dump-content")}  ${basename(expectedDump)}\n`,
    );
  });

  it("deletes only expired backup artifacts that match the backup pattern", async () => {
    const now = new Date("2026-06-18T00:00:00.000Z");
    const { backupDir, dependencies, removed } = createDependencies({
      existingFiles: [
        "shopify-docs-20260603-000000.dump",
        "shopify-docs-20260603-000000.dump.sha256",
        "shopify-docs-20260610-000000.dump",
        "notes.txt",
      ],
      mtimes: {
        "shopify-docs-20260603-000000.dump": new Date(
          "2026-06-03T00:00:00.000Z",
        ),
        "shopify-docs-20260603-000000.dump.sha256": new Date(
          "2026-06-03T00:00:00.000Z",
        ),
        "shopify-docs-20260610-000000.dump": new Date(
          "2026-06-10T00:00:00.000Z",
        ),
        "notes.txt": new Date("2026-06-01T00:00:00.000Z"),
      },
    });

    const result = await runDatabaseBackup(
      {
        databaseUrl: "postgres://app:app@127.0.0.1:5432/shopify_docs",
        backupDir,
        now,
        retentionDays: 14,
      },
      dependencies,
    );

    expect(removed.map((path) => basename(path)).sort()).toEqual([
      "shopify-docs-20260603-000000.dump",
      "shopify-docs-20260603-000000.dump.sha256",
    ]);
    expect(result.deletedFiles.map((path) => basename(path)).sort()).toEqual([
      "shopify-docs-20260603-000000.dump",
      "shopify-docs-20260603-000000.dump.sha256",
    ]);
  });
});
