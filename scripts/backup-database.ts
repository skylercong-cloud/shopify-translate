import { runDatabaseBackup } from "@/modules/operations/backup";
import { runBackupCli } from "@/modules/operations/backup-cli";

process.exitCode = await runBackupCli({
  env: process.env,
  logger: console,
  now: new Date(),
  runBackup: runDatabaseBackup,
});
