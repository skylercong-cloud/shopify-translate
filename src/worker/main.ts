import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { db, pool } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createJobRepository } from "@/db/repositories/job-repository";
import { getEnv } from "@/lib/env";
import { createIngestionService } from "@/modules/ingestion/ingestion-service";
import {
  createRequestGate,
  createSourceClient,
} from "@/modules/ingestion/source-client";
import { createIngestionScheduler } from "@/modules/jobs/scheduler";
import { createIngestionWorker } from "@/modules/jobs/worker";

async function main(): Promise<void> {
  const env = getEnv();
  const ingestionRepository = createIngestionRepository(db);
  const jobRepository = createJobRepository(db);
  const sourceClient = createSourceClient({
    requestGate: createRequestGate({
      concurrency: env.SOURCE_REQUEST_CONCURRENCY,
      requestIntervalMs: env.SOURCE_REQUEST_INTERVAL_MS,
    }),
    timeoutMs: env.SOURCE_TIMEOUT_MS,
    maxResponseBytes: env.SOURCE_MAX_RESPONSE_BYTES,
  });
  const ingestionService = createIngestionService({
    ingestionRepository,
    jobRepository,
    sourceClient,
    now: () => new Date(),
  });
  const scheduler = createIngestionScheduler({
    ingestionRepository,
    jobRepository,
  });
  const worker = createIngestionWorker({
    jobRepository,
    ingestionService,
    scheduler,
    workerId: `${hostname()}:${process.pid}:${randomUUID()}`,
    leaseMs: env.INGESTION_LEASE_MS,
    pollIntervalMs: env.INGESTION_POLL_INTERVAL_MS,
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    jitter: (baseMilliseconds) =>
      Math.floor(
        Math.random() * Math.min(baseMilliseconds * 0.2, 30_000),
      ),
  });
  const abortController = new AbortController();
  const stop = () => abortController.abort();

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const startupTime = new Date();
    await scheduler.ensureMaintenanceJobs(startupTime);
    await scheduler.scheduleDailyPageRefreshes(startupTime);
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
