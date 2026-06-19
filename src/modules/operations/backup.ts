import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

export type BackupOptions = {
  databaseUrl: string;
  backupDir: string;
  now: Date;
  retentionDays: number;
  pgDumpPath?: string;
};

export type BackupResult = {
  dumpPath: string;
  checksumPath: string;
  deletedFiles: string[];
};

export type BackupDependencies = {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  runCommand(command: string, args: string[]): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: string): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{
    mtime: Date;
    isFile(): boolean;
  }>;
  rm(path: string): Promise<unknown>;
};

const BACKUP_PATTERN =
  /^shopify-docs-\d{8}-\d{6}\.dump(?:\.sha256)?$/;

function timestamp(value: Date) {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function checksumContent(content: Buffer, dumpPath: string) {
  return `${createHash("sha256").update(content).digest("hex")}  ${basename(
    dumpPath,
  )}\n`;
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

export const nodeBackupDependencies: BackupDependencies = {
  mkdir,
  runCommand,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
};

function assertOptions(options: BackupOptions) {
  if (!options.databaseUrl.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  if (!options.backupDir.trim()) {
    throw new Error("backupDir is required");
  }
  if (
    !Number.isSafeInteger(options.retentionDays) ||
    options.retentionDays <= 0
  ) {
    throw new Error("retentionDays must be a positive safe integer");
  }
}

async function deleteExpiredBackups(
  options: BackupOptions,
  dependencies: BackupDependencies,
) {
  const cutoff = new Date(
    options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000,
  );
  const deletedFiles: string[] = [];
  const names = await dependencies.readdir(options.backupDir);

  for (const name of names) {
    if (!BACKUP_PATTERN.test(name)) continue;

    const path = join(options.backupDir, name);
    const info = await dependencies.stat(path);
    if (!info.isFile() || info.mtime >= cutoff) continue;

    await dependencies.rm(path);
    deletedFiles.push(path);
  }

  return deletedFiles;
}

export async function runDatabaseBackup(
  options: BackupOptions,
  dependencies: BackupDependencies = nodeBackupDependencies,
): Promise<BackupResult> {
  assertOptions(options);

  await dependencies.mkdir(options.backupDir, { recursive: true });
  const dumpPath = join(
    options.backupDir,
    `shopify-docs-${timestamp(options.now)}.dump`,
  );
  const checksumPath = `${dumpPath}.sha256`;

  await dependencies.runCommand(options.pgDumpPath ?? "pg_dump", [
    options.databaseUrl,
    "-Fc",
    "-f",
    dumpPath,
  ]);

  await dependencies.writeFile(
    checksumPath,
    checksumContent(await dependencies.readFile(dumpPath), dumpPath),
  );

  return {
    dumpPath,
    checksumPath,
    deletedFiles: await deleteExpiredBackups(options, dependencies),
  };
}
