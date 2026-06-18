import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/admin/corrections/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import {
  blockTranslations,
  contentBlocks,
  sourcePages,
  translationCorrections,
  translationRevisions,
  translationSettings,
  users,
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
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import {
  createSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const authRepository = createAuthRepository(db);
const ingestionRepository = createIngestionRepository(db);
const mockedCookies = vi.mocked(cookies);
const createdUrls: string[] = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

async function cleanDatabase() {
  vi.clearAllMocks();
  await db.delete(translationCorrections);
  if (createdUrls.length > 0) {
    await db
      .delete(sourcePages)
      .where(inArray(sourcePages.canonicalUrl, createdUrls.splice(0)));
  }
  await db.delete(users);
  await db
    .insert(translationSettings)
    .values({ singleton: true })
    .onConflictDoNothing();
}

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

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

async function createPage(markdown: string) {
  const canonicalUrl = `https://shopify.dev/docs/correction-${randomUUID()}`;
  createdUrls.push(canonicalUrl);
  const fetchedAt = new Date("2026-06-18T08:00:00.000Z");
  const [page] = await ingestionRepository.upsertDiscoveredPages({
    discoveredAt: fetchedAt,
    pages: [{ canonicalUrl }],
  });
  const source = fingerprintPageInput(
    parseSourcePage({ body: markdown, sourceFormat: "text" }),
  );
  const published = await ingestionRepository.publishParsedPage({
    pageId: page.id,
    parsedPage: source.parsedPage,
    pageFingerprint: source.pageFingerprint,
    blockFingerprints: source.blockFingerprints,
    diff: diffBlocks([], source.blocks),
    fetchedAt,
  });
  if (published.kind !== "published") {
    throw new Error("Expected source publication");
  }

  const blocks = await db
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.pageVersionId, published.versionId))
    .orderBy(contentBlocks.ordinal);

  return {
    returnTo: new URL(canonicalUrl).pathname,
    block: blocks.find((block) => block.translatable)!,
  };
}

async function authenticate() {
  const user = await authRepository.upsertAdminPassword("hash");
  const token = createSessionToken();
  await authRepository.createSession(
    newSessionRecord(token, user.id, new Date(), 30),
  );
  mockedCookies.mockResolvedValue({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME ? { value: token } : undefined,
  } as Awaited<ReturnType<typeof cookies>>);
}

function correctionRequest(values: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  return new Request("http://localhost/api/admin/corrections", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/corrections", () => {
  it("records a manual correction for an authenticated administrator", async () => {
    const { block, returnTo } = await createPage("# Guide\n\nBuild apps.");
    await authenticate();

    const response = await POST(
      correctionRequest({
        blockId: block.id,
        expectedSourceFingerprint: block.fingerprint,
        translatedText: "构建应用。",
        scope: "global",
        returnTo,
      }),
    );

    const state = await db.query.blockTranslations.findFirst({
      where: eq(blockTranslations.blockId, block.id),
    });
    const revision = state
      ? await db.query.translationRevisions.findFirst({
          where: eq(
            translationRevisions.id,
            state.currentRevisionId!,
          ),
        })
      : null;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://127.0.0.1:3000${returnTo}?correction=updated`,
    );
    expect(state).toMatchObject({ status: "manually_corrected" });
    expect(revision).toMatchObject({
      source: "global_manual",
      translatedText: "构建应用。",
    });
  });

  it("redirects unauthenticated requests to login", async () => {
    const { block, returnTo } = await createPage("# Guide\n\nBuild apps.");
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST(
      correctionRequest({
        blockId: block.id,
        expectedSourceFingerprint: block.fingerprint,
        translatedText: "构建应用。",
        scope: "global",
        returnTo,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, block.id),
      }),
    ).resolves.toMatchObject({
      currentRevisionId: null,
      status: "pending",
    });
    await expect(
      db.query.translationCorrections.findFirst(),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid correction text without publishing a correction", async () => {
    const { block, returnTo } = await createPage("# Guide\n\nBuild apps.");
    await authenticate();

    const response = await POST(
      correctionRequest({
        blockId: block.id,
        expectedSourceFingerprint: block.fingerprint,
        translatedText: "  ",
        scope: "global",
        returnTo,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://127.0.0.1:3000${returnTo}?correction=invalid`,
    );
    await expect(
      db.query.blockTranslations.findFirst({
        where: eq(blockTranslations.blockId, block.id),
      }),
    ).resolves.toMatchObject({
      currentRevisionId: null,
      status: "pending",
    });
    await expect(
      db.query.translationCorrections.findFirst(),
    ).resolves.toBeUndefined();
  });
});
