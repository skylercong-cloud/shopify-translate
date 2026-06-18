import { cookies } from "next/headers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/admin/prompt/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { promptVersions, translationSettings, users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import {
  createSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const authRepository = createAuthRepository(db);
const mockedCookies = vi.mocked(cookies);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

async function cleanDatabase() {
  vi.clearAllMocks();
  await db.delete(promptVersions);
  await db.delete(users);
  await db
    .insert(translationSettings)
    .values({ singleton: true })
    .onConflictDoNothing();
}

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

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

function promptRequest(values: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  return new Request("http://localhost/api/admin/prompt", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/prompt", () => {
  it("activates a normalized prompt version for an authenticated administrator", async () => {
    await authenticate();

    const response = await POST(
      promptRequest({
        systemPrompt: " Translate Shopify docs accurately.\r\n",
        userPromptTemplate: "Source:\r\n{{sourceText}}\r\n",
      }),
    );

    const stored = await db.query.promptVersions.findFirst();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?prompt=updated",
    );
    expect(stored).toMatchObject({
      version: 1,
      active: true,
      systemPrompt: "Translate Shopify docs accurately.",
      userPromptTemplate: "Source:\n{{sourceText}}",
    });
    expect(stored?.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("redirects unauthenticated requests to login", async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST(
      promptRequest({
        systemPrompt: "Translate accurately.",
        userPromptTemplate: "{{sourceText}}",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
    await expect(db.query.promptVersions.findFirst()).resolves.toBeUndefined();
  });

  it("rejects invalid prompt templates without creating a version", async () => {
    await authenticate();

    const response = await POST(
      promptRequest({
        systemPrompt: "Translate accurately.",
        userPromptTemplate: "No source placeholder.",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?prompt=invalid",
    );
    await expect(db.query.promptVersions.findFirst()).resolves.toBeUndefined();
  });
});
