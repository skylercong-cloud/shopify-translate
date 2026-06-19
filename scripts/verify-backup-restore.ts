import {
  nodeRestoreVerificationDependencies,
  verifyBackupRestore,
} from "@/modules/operations/restore-verification";
import { runRestoreVerificationCli } from "@/modules/operations/restore-verification-cli";

process.exitCode = await runRestoreVerificationCli({
  env: process.env,
  logger: console,
  now: new Date(),
  verifyRestore: (options) =>
    verifyBackupRestore(options, nodeRestoreVerificationDependencies),
});

