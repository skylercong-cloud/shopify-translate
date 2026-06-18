import type { BackupOptions, BackupResult } from "@/modules/operations/backup";

export type BackupCliEnvironment = Record<string, string | undefined>;

export type BackupCliLogger = {
  error(message: string): void;
  log(message: string): void;
};

export type BackupCliOptions = {
  env: BackupCliEnvironment;
  logger: BackupCliLogger;
  now: Date;
  runBackup(options: BackupOptions): Promise<BackupResult>;
};

const DEFAULT_BACKUP_DIR = "backups";
const DEFAULT_RETENTION_DAYS = 14;

function requireDatabaseUrl(env: BackupCliEnvironment) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrl;
}

function parseRetentionDays(rawValue: string | undefined) {
  const value = rawValue?.trim();
  if (!value) return DEFAULT_RETENTION_DAYS;

  const retentionDays = Number(value);
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("BACKUP_RETENTION_DAYS must be a positive safe integer");
  }
  return retentionDays;
}

function backupDir(env: BackupCliEnvironment) {
  return env.BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runBackupCli({
  env,
  logger,
  now,
  runBackup,
}: BackupCliOptions) {
  try {
    const result = await runBackup({
      backupDir: backupDir(env),
      databaseUrl: requireDatabaseUrl(env),
      now,
      retentionDays: parseRetentionDays(env.BACKUP_RETENTION_DAYS),
    });

    logger.log(`Backup written: ${result.dumpPath}`);
    logger.log(`Checksum written: ${result.checksumPath}`);
    logger.log(`Expired backup files deleted: ${result.deletedFiles.length}`);

    return 0;
  } catch (error) {
    logger.error(errorMessage(error));
    return 1;
  }
}
