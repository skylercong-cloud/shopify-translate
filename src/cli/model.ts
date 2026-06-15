import { readFile } from "node:fs/promises";

import { password } from "@inquirer/prompts";

import { db, pool } from "@/db/client";
import { createJobRepository } from "@/db/repositories/job-repository";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import { getEnv } from "@/lib/env";
import { createTranslationConfigService } from "@/modules/translation/config-service";
import { runModelCli } from "@/modules/translation/model-cli";
import { requireModelEncryptionKey } from "@/modules/translation/runtime-config";
import {
  createTranslationAdminService,
  createTranslationAdminStore,
} from "@/modules/translation/translation-admin-service";

async function main() {
  const repository = createTranslationConfigRepository(db);
  const service = createTranslationConfigService(repository);
  const adminService = createTranslationAdminService({
    store: createTranslationAdminStore(db),
    translationRepository: createTranslationRepository(db),
    configRepository: repository,
    jobRepository: createJobRepository(db),
    now: () => new Date(),
  });

  await runModelCli(process.argv.slice(2), {
    service,
    adminService,
    getMasterKey: () => requireModelEncryptionKey(getEnv()),
    promptApiKey: (provider) =>
      password({
        message: `${provider} API key:`,
        mask: "*",
      }),
    promptNewMasterKey: () =>
      password({
        message: "New MODEL_KEY_ENCRYPTION_KEY:",
        mask: "*",
      }),
    readTextFile: (path) => readFile(path, "utf8"),
    writeOutput: (output) => console.log(output),
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
