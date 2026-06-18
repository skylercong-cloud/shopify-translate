import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "@/db/client";
import { createOperationsRepository } from "@/db/repositories/operations-repository";
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
import { getEnv } from "@/lib/env";

const repository = createOperationsRepository(db);

async function cleanDatabase() {
  await db.delete(users);
  await db.delete(jobs);
  await db.delete(glossaryTerms);
  await db.delete(glossaryVersions);
  await db.delete(promptVersions);
  await db.delete(modelProviderConfigs);
  await db
    .update(translationSettings)
    .set({
      dailyTokenLimit: null,
      requestTimeoutMs: 60_000,
      maxInputBytes: 1_048_576,
      maxOutputTokens: 4_096,
      workerConcurrency: 1,
      updatedAt: new Date(),
    })
    .where(eq(translationSettings.singleton, true));
}

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

describe("operations repository", () => {
  it("loads a secret-safe operational overview", async () => {
    await db
      .insert(translationSettings)
      .values({ singleton: true })
      .onConflictDoNothing();
    await db
      .update(translationSettings)
      .set({
        dailyTokenLimit: 500_000,
        requestTimeoutMs: 30_000,
        maxInputBytes: 500_000,
        maxOutputTokens: 2_048,
        workerConcurrency: 2,
      })
      .where(eq(translationSettings.singleton, true));
    await db.insert(modelProviderConfigs).values([
      {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        encryptedApiKey: "encrypted-deepseek-secret",
        keyHint: "****seek",
        enabled: true,
      },
      {
        provider: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelId: "qwen-plus",
        encryptedApiKey: "encrypted-qwen-secret",
        keyHint: "****qwen",
        enabled: false,
      },
    ]);
    await db.insert(promptVersions).values({
      version: 3,
      systemPrompt: "Keep technical terms in English.",
      userPromptTemplate: "{{sourceText}}",
      contentFingerprint: "prompt-v3",
      active: true,
    });
    const [glossary] = await db
      .insert(glossaryVersions)
      .values({
        version: 2,
        contentFingerprint: "glossary-v2",
        active: true,
      })
      .returning();
    await db.insert(glossaryTerms).values([
      {
        glossaryVersionId: glossary.id,
        sourceTerm: "Admin API",
        normalizedTerm: "admin api",
      },
      {
        glossaryVersionId: glossary.id,
        sourceTerm: "Shopify CLI",
        normalizedTerm: "shopify cli",
      },
    ]);
    await db.insert(jobs).values([
      {
        queue: "translation",
        type: "translate_block",
        dedupeKey: "ops:translation:queued",
        payload: {},
        status: "queued",
      },
      {
        queue: "translation",
        type: "translate_block",
        dedupeKey: "ops:translation:failed",
        payload: {},
        status: "failed",
        lastErrorCode: "provider_error",
        lastErrorMessage: "DeepSeek failed",
      },
      {
        queue: "ingestion",
        type: "fetch_page",
        dedupeKey: "ops:ingestion:running",
        payload: {},
        status: "running",
      },
    ]);
    const [admin] = await db
      .insert(users)
      .values({ username: "admin", passwordHash: "hash" })
      .returning();
    await db.insert(sessions).values([
      {
        id: "00000000-0000-4000-8000-000000000011",
        tokenHash: "a".repeat(64),
        userId: admin.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        tokenHash: "b".repeat(64),
        userId: admin.id,
        expiresAt: new Date(Date.now() + 120_000),
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        tokenHash: "c".repeat(64),
        userId: admin.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);

    const overview = await repository.loadOverview();

    expect(overview.settings).toMatchObject({
      dailyTokenLimit: 500_000,
      requestTimeoutMs: 30_000,
      workerConcurrency: 2,
    });
    expect(overview.providers).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        modelId: "deepseek-chat",
        keyHint: "****seek",
        enabled: true,
      }),
      expect.objectContaining({
        provider: "qwen",
        modelId: "qwen-plus",
        keyHint: "****qwen",
        enabled: false,
      }),
    ]);
    expect(JSON.stringify(overview)).not.toContain(
      "encrypted-deepseek-secret",
    );
    expect(overview.activePrompt).toMatchObject({
      version: 3,
      systemPrompt: "Keep technical terms in English.",
      userPromptTemplate: "{{sourceText}}",
    });
    expect(overview.activeGlossary).toMatchObject({
      version: 2,
      termCount: 2,
      terms: [
        { sourceTerm: "Admin API", normalizedTerm: "admin api" },
        { sourceTerm: "Shopify CLI", normalizedTerm: "shopify cli" },
      ],
    });
    expect(overview.jobs.byQueueStatus).toEqual([
      { queue: "ingestion", status: "running", count: 1 },
      { queue: "translation", status: "failed", count: 1 },
      { queue: "translation", status: "queued", count: 1 },
    ]);
    expect(overview.jobs.recentFailures).toEqual([
      expect.objectContaining({
        queue: "translation",
        type: "translate_block",
        lastErrorCode: "provider_error",
      }),
    ]);
    expect(overview.security).toEqual({
      activeSessionCount: 2,
    });
    expect(overview.alerts).toEqual([
      expect.objectContaining({
        severity: "critical",
        code: "failed_jobs",
        message: "1 failed jobs need attention.",
      }),
    ]);
  });
});
