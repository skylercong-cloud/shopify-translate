import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export type RestoreVerificationOptions = {
  checksumPath?: string;
  databaseUrl: string;
  dumpPath: string;
  nonce?: string;
  now: Date;
  pgRestorePath?: string;
  psqlPath?: string;
  temporaryDatabasePrefix?: string;
};

export type RestoreVerificationResult = {
  checksumPath: string;
  dumpPath: string;
  temporaryDatabaseName: string;
};

export type RestoreVerificationDependencies = {
  readFile(path: string): Promise<Buffer>;
  runCommand(command: string, args: string[]): Promise<void>;
};

const DEFAULT_TEMPORARY_DATABASE_PREFIX = "shopify_docs_restore_verify";
const SAFE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

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

export const nodeRestoreVerificationDependencies: RestoreVerificationDependencies =
  {
    readFile,
    runCommand,
  };

function timestamp(value: Date) {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}_${hour}${minute}${second}`;
}

function assertOptions(options: RestoreVerificationOptions) {
  if (!options.databaseUrl.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  if (!options.dumpPath.trim()) {
    throw new Error("dumpPath is required");
  }
  const prefix =
    options.temporaryDatabasePrefix ?? DEFAULT_TEMPORARY_DATABASE_PREFIX;
  if (!SAFE_IDENTIFIER_PATTERN.test(prefix) || prefix.length > 32) {
    throw new Error(
      "temporaryDatabasePrefix must contain only lowercase letters, numbers, and underscores, start with a letter, and be at most 32 characters",
    );
  }
  if (options.nonce && !/^[a-z0-9]+$/.test(options.nonce)) {
    throw new Error("nonce must contain only lowercase letters and numbers");
  }
}

function temporaryDatabaseName(options: RestoreVerificationOptions) {
  const prefix =
    options.temporaryDatabasePrefix ?? DEFAULT_TEMPORARY_DATABASE_PREFIX;
  const nonce = options.nonce ?? randomBytes(3).toString("hex");

  return `${prefix}_${timestamp(options.now)}_${nonce}`;
}

function quotedIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlForDatabase(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function expectedChecksum(checksumContent: Buffer) {
  const match = checksumContent
    .toString("utf8")
    .match(/\b([a-fA-F0-9]{64})\b/);

  if (!match) {
    throw new Error("Backup checksum file does not contain a SHA-256 digest");
  }

  return match[1].toLowerCase();
}

async function verifyChecksum(
  dumpPath: string,
  checksumPath: string,
  dependencies: RestoreVerificationDependencies,
) {
  const dump = await dependencies.readFile(dumpPath);
  const actual = createHash("sha256").update(dump).digest("hex");
  const expected = expectedChecksum(await dependencies.readFile(checksumPath));

  if (actual !== expected) {
    throw new Error("Backup checksum mismatch");
  }
}

export async function verifyBackupRestore(
  options: RestoreVerificationOptions,
  dependencies: RestoreVerificationDependencies = nodeRestoreVerificationDependencies,
): Promise<RestoreVerificationResult> {
  assertOptions(options);

  const checksumPath = options.checksumPath ?? `${options.dumpPath}.sha256`;
  await verifyChecksum(options.dumpPath, checksumPath, dependencies);

  const tempDatabase = temporaryDatabaseName(options);
  const tempDatabaseUrl = databaseUrlForDatabase(
    options.databaseUrl,
    tempDatabase,
  );
  const psql = options.psqlPath ?? "psql";
  const pgRestore = options.pgRestorePath ?? "pg_restore";
  let created = false;

  try {
    await dependencies.runCommand(psql, [
      options.databaseUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `CREATE DATABASE ${quotedIdentifier(tempDatabase)};`,
    ]);
    created = true;

    await dependencies.runCommand(pgRestore, [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      tempDatabaseUrl,
      options.dumpPath,
    ]);

    await dependencies.runCommand(psql, [
      tempDatabaseUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "select count(*) from information_schema.tables;",
    ]);
  } finally {
    if (created) {
      await dependencies.runCommand(psql, [
        options.databaseUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `DROP DATABASE IF EXISTS ${quotedIdentifier(
          tempDatabase,
        )} WITH (FORCE);`,
      ]);
    }
  }

  return {
    checksumPath,
    dumpPath: options.dumpPath,
    temporaryDatabaseName: tempDatabase,
  };
}
