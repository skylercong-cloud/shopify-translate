import { asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  glossaryTerms,
  glossaryVersions,
  jobs,
  modelProviderConfigs,
  promptVersions,
  translationSettings,
} from "@/db/schema";
import type {
  OperationsGlossaryStatus,
  OperationsOverview,
  OperationsRuntimeSettings,
} from "@/modules/operations/types";

type Database = NodePgDatabase<typeof schema>;

function toRuntimeSettings(
  row: typeof translationSettings.$inferSelect,
): OperationsRuntimeSettings {
  return {
    dailyTokenLimit: row.dailyTokenLimit,
    budgetTimeZone: "Asia/Shanghai",
    requestTimeoutMs: row.requestTimeoutMs,
    maxInputBytes: row.maxInputBytes,
    maxOutputTokens: row.maxOutputTokens,
    workerConcurrency: row.workerConcurrency,
  };
}

export function createOperationsRepository(db: Database) {
  async function loadSettings() {
    await db
      .insert(translationSettings)
      .values({ singleton: true })
      .onConflictDoNothing();

    const row = await db.query.translationSettings.findFirst({
      where: eq(translationSettings.singleton, true),
    });
    if (!row) {
      throw new Error("Translation settings row could not be created");
    }

    return toRuntimeSettings(row);
  }

  async function loadActiveGlossary(): Promise<OperationsGlossaryStatus | null> {
    const [activeGlossary] = await db
      .select({
        id: glossaryVersions.id,
        version: glossaryVersions.version,
        createdAt: glossaryVersions.createdAt,
        termCount: sql<number>`count(${glossaryTerms.id})::int`,
      })
      .from(glossaryVersions)
      .leftJoin(
        glossaryTerms,
        eq(glossaryTerms.glossaryVersionId, glossaryVersions.id),
      )
      .where(eq(glossaryVersions.active, true))
      .groupBy(
        glossaryVersions.id,
        glossaryVersions.version,
        glossaryVersions.createdAt,
      )
      .limit(1);

    return activeGlossary ?? null;
  }

  return {
    async loadOverview(): Promise<OperationsOverview> {
      const [
        settings,
        providers,
        activePrompt,
        activeGlossary,
        byQueueStatus,
        recentFailures,
      ] = await Promise.all([
        loadSettings(),
        db
          .select({
            provider: modelProviderConfigs.provider,
            baseUrl: modelProviderConfigs.baseUrl,
            modelId: modelProviderConfigs.modelId,
            keyHint: modelProviderConfigs.keyHint,
            enabled: modelProviderConfigs.enabled,
            updatedAt: modelProviderConfigs.updatedAt,
          })
          .from(modelProviderConfigs)
          .orderBy(asc(modelProviderConfigs.provider)),
        db.query.promptVersions.findFirst({
          columns: {
            id: true,
            version: true,
            createdAt: true,
          },
          where: eq(promptVersions.active, true),
        }),
        loadActiveGlossary(),
        db
          .select({
            queue: jobs.queue,
            status: jobs.status,
            count: sql<number>`count(*)::int`,
          })
          .from(jobs)
          .groupBy(jobs.queue, jobs.status)
          .orderBy(
            asc(jobs.queue),
            sql`case ${jobs.status}
              when 'failed' then 0
              when 'running' then 1
              when 'queued' then 2
              when 'succeeded' then 3
              else 4
            end`,
          ),
        db
          .select({
            id: jobs.id,
            queue: jobs.queue,
            type: jobs.type,
            attempts: jobs.attempts,
            maxAttempts: jobs.maxAttempts,
            lastErrorCode: jobs.lastErrorCode,
            lastErrorMessage: jobs.lastErrorMessage,
            updatedAt: jobs.updatedAt,
          })
          .from(jobs)
          .where(eq(jobs.status, "failed"))
          .orderBy(desc(jobs.updatedAt), desc(jobs.createdAt))
          .limit(5),
      ]);

      return {
        settings,
        providers,
        activePrompt: activePrompt ?? null,
        activeGlossary,
        jobs: {
          byQueueStatus,
          recentFailures,
        },
      };
    },
  };
}
