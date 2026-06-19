import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import {
  glossaryTerms,
  glossaryVersions,
  modelProviderConfigs,
  promptVersions,
  translationSettings,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createTranslationConfigService } from "@/modules/translation/config-service";
import { decryptSecret } from "@/modules/translation/encryption";

const repository = createTranslationConfigRepository(db);
const service = createTranslationConfigService(repository);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
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
});

describe("translation configuration repository", () => {
  it("upserts and lists encrypted provider configurations", async () => {
    await repository.upsertProvider({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      modelId: "deepseek-chat",
      encryptedApiKey: '{"encrypted":true}',
      keyHint: "****cret",
      enabled: true,
    });
    await repository.upsertProvider({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-new",
      encryptedApiKey: '{"encrypted":"new"}',
      keyHint: "****-new",
      enabled: false,
    });

    await expect(repository.getProvider("deepseek")).resolves.toMatchObject({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-new",
      encryptedApiKey: '{"encrypted":"new"}',
      keyHint: "****-new",
      enabled: false,
    });
    await expect(repository.listProviders()).resolves.toEqual([
      expect.objectContaining({ provider: "deepseek" }),
    ]);
  });

  it("replaces shared runtime settings", async () => {
    await repository.updateSettings({
      dailyTokenLimit: 123_456,
      requestTimeoutMs: 30_000,
      maxInputBytes: 500_000,
      maxOutputTokens: 2_048,
      workerConcurrency: 2,
    });

    await expect(repository.getSettings()).resolves.toMatchObject({
      dailyTokenLimit: 123_456,
      budgetTimeZone: "Asia/Shanghai",
      requestTimeoutMs: 30_000,
      maxInputBytes: 500_000,
      maxOutputTokens: 2_048,
      workerConcurrency: 2,
    });
  });

  it("activates one prompt while preserving immutable history", async () => {
    const first = await repository.createAndActivatePrompt({
      systemPrompt: "First system prompt",
      userPromptTemplate: "{{sourceText}}",
      contentFingerprint: "first-prompt",
    });
    const second = await repository.createAndActivatePrompt({
      systemPrompt: "Second system prompt",
      userPromptTemplate: "Translate {{sourceText}}",
      contentFingerprint: "second-prompt",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    await expect(repository.getActivePrompt()).resolves.toMatchObject({
      id: second.id,
      active: true,
    });
    await expect(db.query.promptVersions.findMany()).resolves.toEqual([
      expect.objectContaining({ id: first.id, active: false }),
      expect.objectContaining({ id: second.id, active: true }),
    ]);
  });

  it("serializes concurrent prompt activations", async () => {
    const activated = await Promise.all([
      repository.createAndActivatePrompt({
        systemPrompt: "Concurrent A",
        userPromptTemplate: "{{sourceText}}",
        contentFingerprint: "concurrent-a",
      }),
      repository.createAndActivatePrompt({
        systemPrompt: "Concurrent B",
        userPromptTemplate: "{{sourceText}}",
        contentFingerprint: "concurrent-b",
      }),
    ]);
    const stored = await db.query.promptVersions.findMany();

    expect(activated.map((item) => item.version).sort()).toEqual([1, 2]);
    expect(stored.filter((item) => item.active)).toHaveLength(1);
  });

  it("activates a glossary snapshot with normalized terms", async () => {
    const first = await repository.createAndActivateGlossary({
      contentFingerprint: "glossary-one",
      terms: [
        { sourceTerm: "Admin API", normalizedTerm: "admin api" },
        { sourceTerm: "Shopify CLI", normalizedTerm: "shopify cli" },
      ],
    });
    const second = await repository.createAndActivateGlossary({
      contentFingerprint: "glossary-two",
      terms: [{ sourceTerm: "GraphQL", normalizedTerm: "graphql" }],
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    await expect(repository.getActiveGlossary()).resolves.toEqual({
      ...second,
      terms: [
        expect.objectContaining({
          sourceTerm: "GraphQL",
          normalizedTerm: "graphql",
        }),
      ],
    });
    await expect(db.query.glossaryVersions.findMany()).resolves.toEqual([
      expect.objectContaining({ id: first.id, active: false }),
      expect.objectContaining({ id: second.id, active: true }),
    ]);
  });

  it("rotates all provider API keys atomically", async () => {
    const currentKey = Buffer.alloc(32, 31);
    const nextKey = Buffer.alloc(32, 32);
    await service.configureProvider(
      {
        provider: "deepseek",
        modelId: "deepseek-chat",
        apiKey: "deepseek-secret",
      },
      currentKey,
    );
    await service.configureProvider(
      {
        provider: "qwen",
        modelId: "qwen-plus",
        apiKey: "qwen-secret",
      },
      currentKey,
    );
    const before = await repository.listProviders();
    const rotationService = service as typeof service & {
      rotateMasterKey(
        oldKey: Buffer,
        newKey: Buffer,
      ): Promise<number>;
    };

    await expect(
      rotationService.rotateMasterKey(Buffer.alloc(32, 99), nextKey),
    ).rejects.toThrow("Encrypted secret is invalid");
    await expect(repository.listProviders()).resolves.toEqual(before);

    await expect(
      rotationService.rotateMasterKey(currentKey, nextKey),
    ).resolves.toBe(2);

    const rotated = await repository.listProviders();
    expect(rotated.map((provider) => provider.encryptedApiKey)).not.toEqual(
      before.map((provider) => provider.encryptedApiKey),
    );
    expect(
      decryptSecret(
        rotated.find((provider) => provider.provider === "deepseek")!
          .encryptedApiKey,
        nextKey,
      ),
    ).toBe("deepseek-secret");
    expect(
      decryptSecret(
        rotated.find((provider) => provider.provider === "qwen")!
          .encryptedApiKey,
        nextKey,
      ),
    ).toBe("qwen-secret");
    for (const provider of rotated) {
      expect(() =>
        decryptSecret(provider.encryptedApiKey, currentKey),
      ).toThrow("Encrypted secret is invalid");
    }
  });
});
