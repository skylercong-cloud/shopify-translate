import type {
  RestoreVerificationOptions,
  RestoreVerificationResult,
} from "@/modules/operations/restore-verification";

export type RestoreVerificationCliEnvironment = Record<
  string,
  string | undefined
>;

export type RestoreVerificationCliLogger = {
  error(message: string): void;
  log(message: string): void;
};

export type RestoreVerificationCliOptions = {
  env: RestoreVerificationCliEnvironment;
  logger: RestoreVerificationCliLogger;
  now: Date;
  verifyRestore(
    options: RestoreVerificationOptions,
  ): Promise<RestoreVerificationResult>;
};

function requiredValue(
  env: RestoreVerificationCliEnvironment,
  key: string,
) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalValue(
  env: RestoreVerificationCliEnvironment,
  key: string,
) {
  return env[key]?.trim() || undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runRestoreVerificationCli({
  env,
  logger,
  now,
  verifyRestore,
}: RestoreVerificationCliOptions) {
  try {
    const result = await verifyRestore({
      checksumPath: optionalValue(env, "BACKUP_CHECKSUM_PATH"),
      databaseUrl: requiredValue(env, "DATABASE_URL"),
      dumpPath: requiredValue(env, "BACKUP_DUMP_PATH"),
      now,
      pgRestorePath: optionalValue(env, "RESTORE_VERIFY_PG_RESTORE_PATH"),
      psqlPath: optionalValue(env, "RESTORE_VERIFY_PSQL_PATH"),
      temporaryDatabasePrefix: optionalValue(
        env,
        "RESTORE_VERIFY_DATABASE_PREFIX",
      ),
    });

    logger.log(`Backup checksum verified: ${result.checksumPath}`);
    logger.log(`Restore verified from: ${result.dumpPath}`);
    logger.log(
      `Temporary database dropped: ${result.temporaryDatabaseName}`,
    );

    return 0;
  } catch (error) {
    logger.error(errorMessage(error));
    return 1;
  }
}

