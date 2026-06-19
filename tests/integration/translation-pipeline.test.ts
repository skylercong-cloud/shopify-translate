import { randomBytes, randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createJobRepository } from "@/db/repositories/job-repository";
import { createTokenBudgetRepository } from "@/db/repositories/token-budget-repository";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import {
  blockTranslations,
  contentBlocks,
  glossaryTerms,
  glossaryVersions,
  jobs,
  modelCalls,
  modelProviderConfigs,
  promptVersions,
  sourcePages,
  tokenReservations,
  translationCorrections,
  translationRevisions,
  translationSettings,
  translationUsageDays,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { diffBlocks } from "@/modules/ingestion/diff";
import {
  fingerprintBlock,
  fingerprintPage,
} from "@/modules/ingestion/fingerprint";
import { parseSourcePage } from "@/modules/ingestion/parser";
import type {
  FingerprintedBlock,
  ParsedPage,
} from "@/modules/ingestion/types";
import { createTranslationWorker } from "@/modules/jobs/translation-worker";
import {
  createTranslationAdminService,
  createTranslationAdminStore,
} from "@/modules/translation/translation-admin-service";
import {
  createTranslationConfigService,
  type TranslationWorkerReadiness,
} from "@/modules/translation/config-service";
import { createModelCallAudit } from "@/modules/translation/model-call-audit";
import { createOpenAiCompatibleProviderClient } from "@/modules/translation/provider-client";
import { protectTranslationInput } from "@/modules/translation/protection";
import { renderTranslationPrompt } from "@/modules/translation/prompt-renderer";
import { estimateStrictReservation } from "@/modules/translation/token-budget";
import { createTranslationService } from "@/modules/translation/translation-service";
import {
  modelResponse,
  startModelServer,
  type ModelFixtureRequest,
} from "../fixtures/model-server";

const ingestionRepository = createIngestionRepository(db);
const jobRepository = createJobRepository(db);
const tokenBudget = createTokenBudgetRepository(db);
const configRepository = createTranslationConfigRepository(db);
const translationRepository = createTranslationRepository(db);
const configService = createTranslationConfigService(configRepository);
const createdUrls: string[] = [];
const now = new Date("2026-06-15T08:00:00.000Z");

type PublishedPage = Awaited<ReturnType<typeof publishPage>>;

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  await db.delete(modelCalls);
  await db.delete(tokenReservations);
  await db.delete(translationUsageDays);
  await db.delete(translationCorrections);
  await db.delete(jobs).where(eq(jobs.queue, "translation"));
  if (createdUrls.length > 0) {
    await db
      .delete(sourcePages)
      .where(inArray(sourcePages.canonicalUrl, createdUrls.splice(0)));
  }
  await db.delete(modelProviderConfigs);
  await db.delete(glossaryTerms);
  await db.delete(glossaryVersions);
  await db.delete(promptVersions);
  await db
    .update(translationSettings)
    .set({ dailyTokenLimit: null, updatedAt: now })
    .where(eq(translationSettings.singleton, true));
});

function fingerprintPageInput(parsedPage: ParsedPage) {
  const blocks: FingerprintedBlock[] = parsedPage.blocks.map((block) => ({
    ...block,
    contentFingerprint: fingerprintBlock(block),
  }));
  return {
    parsedPage,
    blocks,
    blockFingerprints: blocks.map((block) => block.contentFingerprint),
    pageFingerprint: fingerprintPage(blocks),
  };
}

async function publishPage(
  markdown: string,
  input?: {
    pageId?: string;
    canonicalUrl?: string;
    previous?: ReturnType<typeof fingerprintPageInput>;
    fetchedAt?: Date;
  },
) {
  const canonicalUrl =
    input?.canonicalUrl ??
    `https://shopify.dev/docs/pipeline-${randomUUID()}`;
  let pageId = input?.pageId;
  if (!pageId) {
    createdUrls.push(canonicalUrl);
    const [page] = await ingestionRepository.upsertDiscoveredPages({
      discoveredAt: input?.fetchedAt ?? now,
      pages: [{ canonicalUrl }],
    });
    pageId = page.id;
  }

  const source = fingerprintPageInput(
    parseSourcePage({ body: markdown, sourceFormat: "text" }),
  );
  const published = await ingestionRepository.publishParsedPage({
    pageId,
    parsedPage: source.parsedPage,
    pageFingerprint: source.pageFingerprint,
    blockFingerprints: source.blockFingerprints,
    diff: diffBlocks(input?.previous?.blocks ?? [], source.blocks),
    fetchedAt: input?.fetchedAt ?? now,
  });
  if (published.kind !== "published") {
    throw new Error("Expected source page publication");
  }

  return {
    pageId,
    canonicalUrl,
    source,
    versionId: published.versionId,
    blocks: await db
      .select()
      .from(contentBlocks)
      .where(eq(contentBlocks.pageVersionId, published.versionId))
      .orderBy(contentBlocks.ordinal),
  };
}

function sourceBlock(request: ModelFixtureRequest): string {
  const messages = request.body.messages;
  if (!Array.isArray(messages)) {
    throw new Error("Expected provider messages");
  }
  const userMessage = messages.find(
    (message) =>
      message &&
      typeof message === "object" &&
      (message as { role?: unknown }).role === "user",
  ) as { content?: unknown } | undefined;
  if (typeof userMessage?.content !== "string") {
    throw new Error("Expected provider user prompt");
  }
  const match = userMessage.content.match(
    /<source_block>(.+)<\/source_block>/,
  );
  if (!match) throw new Error("Expected protected source block");
  return JSON.parse(match[1]) as string;
}

function preserveProtectedSource(prefix: string) {
  return (request: ModelFixtureRequest) =>
    `${prefix}: ${sourceBlock(request)}`;
}

async function configureRuntime(input: {
  deepseekBaseUrl: string;
  qwenBaseUrl?: string;
  dailyTokenLimit?: number;
}) {
  const masterKey = randomBytes(32);
  await configService.configureProvider(
    {
      provider: "deepseek",
      baseUrl: input.deepseekBaseUrl,
      modelId: "deepseek-test",
      apiKey: "deepseek-fixture-key",
    },
    masterKey,
  );
  if (input.qwenBaseUrl) {
    await configService.configureProvider(
      {
        provider: "qwen",
        baseUrl: input.qwenBaseUrl,
        modelId: "qwen-test",
        apiKey: "qwen-fixture-key",
      },
      masterKey,
    );
  }
  await configService.updateSettings({
    dailyTokenLimit: input.dailyTokenLimit ?? 100_000,
    requestTimeoutMs: 5_000,
    maxInputBytes: 64 * 1024,
    maxOutputTokens: 64,
    workerConcurrency: 1,
  });
  await configService.activatePrompt({
    systemPrompt: "Translate documentation into Chinese.",
    userPromptTemplate: "{{sourceText}}",
  });
  await configService.activateGlossary({
    terms: ["Shopify CLI"],
  });
  return configService.loadWorkerReadiness(masterKey);
}

function createClients(readiness: TranslationWorkerReadiness) {
  return {
    deepseek: createOpenAiCompatibleProviderClient({
      provider: "deepseek",
      baseUrl: readiness.deepseek.baseUrl,
      apiKey: readiness.deepseek.apiKey,
      timeoutMs: readiness.settings.requestTimeoutMs,
      maxResponseBytes: readiness.settings.maxInputBytes,
    }),
    qwen:
      readiness.qwen === null
        ? null
        : createOpenAiCompatibleProviderClient({
            provider: "qwen",
            baseUrl: readiness.qwen.baseUrl,
            apiKey: readiness.qwen.apiKey,
            timeoutMs: readiness.settings.requestTimeoutMs,
            maxResponseBytes: readiness.settings.maxInputBytes,
          }),
  };
}

function createWorker(readiness: TranslationWorkerReadiness) {
  const clients = createClients(readiness);
  const service = createTranslationService({
    translationRepository,
    tokenBudget,
    audit: createModelCallAudit(db),
    readiness,
    clients,
    now: () => now,
    sleep: vi.fn().mockResolvedValue(undefined),
  });
  return {
    clients,
    worker: createTranslationWorker({
      jobRepository,
      translationService: service,
      tokenBudget,
      ensureReady: async () => undefined,
      workerId: `translation-pipeline-${randomUUID()}`,
      leaseMs: 180_000,
      heartbeatMs: 60_000,
      pollIntervalMs: 1,
      now: () => now,
      sleep: vi.fn().mockResolvedValue(undefined),
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    }),
  };
}

async function currentRevision(blockId: string) {
  const state = await db.query.blockTranslations.findFirst({
    where: eq(blockTranslations.blockId, blockId),
  });
  if (!state?.currentRevisionId) return null;
  return (
    (await db.query.translationRevisions.findFirst({
      where: eq(
        translationRevisions.id,
        state.currentRevisionId,
      ),
    })) ?? null
  );
}

function reservationForBlock(
  page: PublishedPage,
  blockId: string,
  readiness: TranslationWorkerReadiness,
) {
  const block = page.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new Error("Expected source block");
  const index = page.blocks.indexOf(block);
  const protectedInput = protectTranslationInput({
    sourceText: block.sourceText,
    blockKind: block.type,
    parserTokens: Array.isArray(block.payload.protectedTokens)
      ? block.payload.protectedTokens
      : [],
    glossaryTerms: readiness.glossary.terms.map(
      (term) => term.sourceTerm,
    ),
  });
  if ("translatable" in protectedInput) {
    throw new Error("Expected translatable source");
  }
  const client = createClients(readiness).deepseek;
  const requestBody = client.serializeRequest({
    modelId: readiness.deepseek.modelId,
    systemPrompt: readiness.prompt.systemPrompt,
    userPrompt: renderTranslationPrompt({
      template: readiness.prompt.userPromptTemplate,
      sourceText: protectedInput.protectedText,
      previousContext: page.blocks[index - 1]?.sourceText ?? null,
      nextContext: page.blocks[index + 1]?.sourceText ?? null,
      protectedTerms: protectedInput.placeholders.map(
        (placeholder) => placeholder.sourceValue,
      ),
    }),
    maxOutputTokens: readiness.settings.maxOutputTokens,
  });
  return estimateStrictReservation(
    requestBody,
    readiness.settings.maxOutputTokens,
  );
}

describe("protected translation pipeline", () => {
  it("publishes a DeepSeek revision while preserving protected text", async () => {
    const deepseek = await startModelServer();
    deepseek.enqueue(
      modelResponse.success(preserveProtectedSource("Chinese")),
    );
    const page = await publishPage(
      "Use Shopify CLI with `shopify app dev`.\n\n```sh\nshopify app dev\n```",
    );
    const paragraph = page.blocks.find(
      (block) => block.type === "paragraph",
    )!;
    const code = page.blocks.find((block) => block.type === "code")!;
    const readiness = await configureRuntime({
      deepseekBaseUrl: deepseek.baseUrl,
    });
    const { worker } = createWorker(readiness);

    await expect(worker.runOnce()).resolves.toBe("worked");

    expect(deepseek.requests).toHaveLength(1);
    expect(deepseek.requests[0]).toMatchObject({
      method: "POST",
      path: "/chat/completions",
    });
    expect(deepseek.requests[0].headers.authorization).toBe(
      "Bearer deepseek-fixture-key",
    );
    await expect(currentRevision(paragraph.id)).resolves.toMatchObject({
      source: "ai",
      provider: "deepseek",
      translatedText:
        "Chinese: Use Shopify CLI with shopify app dev.",
    });
    await expect(currentRevision(code.id)).resolves.toBeNull();
    await expect(
      db.select().from(modelCalls),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(tokenReservations),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: "deepseek",
        status: "settled",
      }),
    ]);
  });

  it("audits invalid DeepSeek placeholders and publishes Qwen fallback", async () => {
    const deepseek = await startModelServer();
    const qwen = await startModelServer();
    deepseek.enqueue(
      modelResponse.invalidPlaceholders((request) => {
        const match = sourceBlock(request).match(
          /^Use (.+) with (.+)\.$/u,
        );
        if (!match) throw new Error("Expected two protected values");
        return `Chinese: Use ${match[2]} with ${match[1]}.`;
      }),
    );
    qwen.enqueue(
      modelResponse.success(preserveProtectedSource("Chinese")),
    );
    const page = await publishPage(
      "Use Shopify CLI with `shopify app dev`.",
    );
    const block = page.blocks[0];
    const readiness = await configureRuntime({
      deepseekBaseUrl: deepseek.baseUrl,
      qwenBaseUrl: qwen.baseUrl,
    });
    const { worker } = createWorker(readiness);

    await expect(worker.runOnce()).resolves.toBe("worked");

    expect(deepseek.requests).toHaveLength(1);
    expect(qwen.requests).toHaveLength(1);
    const audits = await db
      .select()
      .from(modelCalls)
      .orderBy(modelCalls.callSequence);
    expect(audits).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        status: "validation_error",
        errorCode: "placeholder_reordered",
      }),
      expect.objectContaining({
        provider: "qwen",
        status: "succeeded",
      }),
    ]);
    await expect(
      db.select().from(tokenReservations),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "deepseek",
          status: "settled",
        }),
        expect.objectContaining({
          provider: "qwen",
          status: "settled",
        }),
      ]),
    );
    await expect(currentRevision(block.id)).resolves.toMatchObject({
      source: "ai",
      provider: "qwen",
      translatedText:
        "Chinese: Use Shopify CLI with shopify app dev.",
    });
  });

  it("reuses a global manual correction without a model request", async () => {
    const deepseek = await startModelServer();
    const readiness = await configureRuntime({
      deepseekBaseUrl: deepseek.baseUrl,
    });
    const first = await publishPage("Build apps.");
    const firstBlock = first.blocks[0];
    const admin = createTranslationAdminService({
      store: createTranslationAdminStore(db),
      translationRepository,
      configRepository,
      jobRepository,
      now: () => now,
    });
    await admin.recordManualCorrection({
      blockId: firstBlock.id,
      translatedText: "Chinese: Build apps.",
      scope: "global",
    });
    await db.delete(jobs).where(eq(jobs.queue, "translation"));
    const second = await publishPage("Build apps.");
    const secondBlock = second.blocks[0];
    const { worker } = createWorker(readiness);

    await expect(worker.runOnce()).resolves.toBe("worked");

    expect(deepseek.requests).toHaveLength(0);
    await expect(currentRevision(secondBlock.id)).resolves.toMatchObject({
      source: "global_manual",
      translatedText: "Chinese: Build apps.",
    });
  });

  it("defers a second job at the Shanghai reset without consuming an attempt", async () => {
    const deepseek = await startModelServer();
    deepseek.enqueue(
      modelResponse.missingUsage(preserveProtectedSource("Chinese")),
    );
    const first = await publishPage("Build alpha apps.");
    const second = await publishPage("Build bravo apps.");
    const firstBlock = first.blocks[0];
    const secondBlock = second.blocks[0];
    const readiness = await configureRuntime({
      deepseekBaseUrl: deepseek.baseUrl,
    });
    const firstReservation = reservationForBlock(
      first,
      firstBlock.id,
      readiness,
    );
    const secondReservation = reservationForBlock(
      second,
      secondBlock.id,
      readiness,
    );
    const limit = firstReservation + secondReservation - 1;
    await configService.updateSettings({ dailyTokenLimit: limit });
    readiness.settings.dailyTokenLimit = limit;
    const { worker } = createWorker(readiness);

    await expect(worker.runOnce()).resolves.toBe("worked");
    await expect(worker.runOnce()).resolves.toBe("worked");

    expect(deepseek.requests).toHaveLength(1);
    const secondJob = await db.query.jobs.findFirst({
      where: eq(
        jobs.dedupeKey,
        `translate:${secondBlock.id}:${secondBlock.fingerprint}`,
      ),
    });
    expect(secondJob).toMatchObject({
      status: "queued",
      attempts: 0,
      runAt: new Date("2026-06-15T16:00:00.000Z"),
      lastErrorCode: "budget_exhausted",
    });
  });

  it("does not publish provider output after the source page changes", async () => {
    const deepseek = await startModelServer();
    const delayed = modelResponse.delayedSuccess(
      preserveProtectedSource("Chinese"),
    );
    deepseek.enqueue(delayed.script);
    const original = await publishPage("Build apps.");
    const originalBlock = original.blocks[0];
    const readiness = await configureRuntime({
      deepseekBaseUrl: deepseek.baseUrl,
    });
    const { worker } = createWorker(readiness);

    const running = worker.runOnce();
    await vi.waitFor(() => {
      expect(deepseek.requests).toHaveLength(1);
    });
    await publishPage("Build better apps.", {
      pageId: original.pageId,
      canonicalUrl: original.canonicalUrl,
      previous: original.source,
      fetchedAt: new Date("2026-06-15T08:01:00.000Z"),
    });
    delayed.release();

    await expect(running).resolves.toBe("worked");
    await expect(currentRevision(originalBlock.id)).resolves.toBeNull();
    await expect(
      db
        .select()
        .from(translationRevisions)
        .where(
          eq(
            translationRevisions.sourceFingerprint,
            originalBlock.fingerprint,
          ),
        ),
    ).resolves.toHaveLength(0);
  });
});
