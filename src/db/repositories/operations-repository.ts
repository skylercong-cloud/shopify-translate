import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  glossaryTerms,
  glossaryVersions,
  jobs,
  modelProviderConfigs,
  promptVersions,
  sessions,
  translationSettings,
  users,
} from "@/db/schema";
import type {
  OperationsGlossaryStatus,
  OperationsOverview,
  OperationsRuntimeSettings,
} from "@/modules/operations/types";
import { deriveOperationsAlerts } from "@/modules/operations/alerts";
import { checkDatabaseWriteHealth } from "@/modules/operations/database-write-health";

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
    const activeGlossary = await db.query.glossaryVersions.findFirst({
      columns: {
        id: true,
        version: true,
        createdAt: true,
      },
      where: eq(glossaryVersions.active, true),
    });

    if (!activeGlossary) {
      return null;
    }

    const terms = await db
      .select({
        sourceTerm: glossaryTerms.sourceTerm,
        normalizedTerm: glossaryTerms.normalizedTerm,
      })
      .from(glossaryTerms)
      .where(eq(glossaryTerms.glossaryVersionId, activeGlossary.id))
      .orderBy(asc(glossaryTerms.normalizedTerm));

    return {
      ...activeGlossary,
      termCount: terms.length,
      terms,
    };
  }

  async function loadSecurity(now = new Date()) {
    const [row] = await db
      .select({
        activeSessionCount: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(eq(users.username, "admin"), gt(sessions.expiresAt, now)),
      );

    return {
      activeSessionCount: row?.activeSessionCount ?? 0,
    };
  }

  return {
    async loadOverview(): Promise<OperationsOverview> {
      const [
        settings,
        providers,
        activePrompt,
        activeGlossary,
        security,
        databaseWrite,
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
            systemPrompt: true,
            userPromptTemplate: true,
            createdAt: true,
          },
          where: eq(promptVersions.active, true),
        }),
        loadActiveGlossary(),
        loadSecurity(),
        checkDatabaseWriteHealth(db),
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

      const overview = {
        settings,
        providers,
        activePrompt: activePrompt ?? null,
        activeGlossary,
        security,
        system: {
          databaseWrite,
        },
        jobs: {
          byQueueStatus,
          recentFailures,
        },
      };

      return {
        ...overview,
        alerts: deriveOperationsAlerts(overview),
      };
    },
  };
}
