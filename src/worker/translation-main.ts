import { db, pool } from "@/db/client";
import { createJobRepository } from "@/db/repositories/job-repository";
import { createTokenBudgetRepository } from "@/db/repositories/token-budget-repository";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import { getEnv } from "@/lib/env";
import { createTranslationWorker } from "@/modules/jobs/translation-worker";
import { checkDatabaseWriteHealth } from "@/modules/operations/database-write-health";
import { createTranslationConfigService } from "@/modules/translation/config-service";
import { createModelCallAudit } from "@/modules/translation/model-call-audit";
import { createOpenAiCompatibleProviderClient } from "@/modules/translation/provider-client";
import { requireModelEncryptionKey } from "@/modules/translation/runtime-config";
import { createTranslationService } from "@/modules/translation/translation-service";

async function main(): Promise<void> {
  const env = getEnv();
  const masterKey = requireModelEncryptionKey(env);
  const configService = createTranslationConfigService(
    createTranslationConfigRepository(db),
  );
  const readiness = await configService.loadWorkerReadiness(masterKey);
  const tokenBudget = createTokenBudgetRepository(db);
  const startupTime = new Date();

  await tokenBudget.reconcileStale({
    reservedBefore: new Date(
      startupTime.getTime() - env.TRANSLATION_STALE_RESERVATION_MS,
    ),
    requestStartedBefore: new Date(
      startupTime.getTime() - env.TRANSLATION_STALE_REQUEST_MS,
    ),
    now: startupTime,
  });

  const deepseek = createOpenAiCompatibleProviderClient({
    provider: "deepseek",
    baseUrl: readiness.deepseek.baseUrl,
    apiKey: readiness.deepseek.apiKey,
    timeoutMs: readiness.settings.requestTimeoutMs,
    maxResponseBytes: readiness.settings.maxInputBytes,
  });
  const qwen = readiness.qwen
    ? createOpenAiCompatibleProviderClient({
        provider: "qwen",
        baseUrl: readiness.qwen.baseUrl,
        apiKey: readiness.qwen.apiKey,
        timeoutMs: readiness.settings.requestTimeoutMs,
        maxResponseBytes: readiness.settings.maxInputBytes,
      })
    : null;
  const translationService = createTranslationService({
    translationRepository: createTranslationRepository(db),
    tokenBudget,
    audit: createModelCallAudit(db),
    readiness,
    clients: { deepseek, qwen },
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    writeHealth: {
      check: () => checkDatabaseWriteHealth(db),
    },
  });
  const worker = createTranslationWorker({
    jobRepository: createJobRepository(db),
    translationService,
    tokenBudget,
    ensureReady: async () => undefined,
    workerId: env.TRANSLATION_WORKER_ID,
    leaseMs: env.TRANSLATION_LEASE_MS,
    heartbeatMs: env.TRANSLATION_HEARTBEAT_MS,
    pollIntervalMs: env.TRANSLATION_POLL_INTERVAL_MS,
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  const abortController = new AbortController();
  const stop = () => abortController.abort();

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await worker.run(abortController.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
