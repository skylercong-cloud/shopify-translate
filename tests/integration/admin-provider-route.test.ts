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

import { POST } from "@/app/api/admin/providers/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import {
  modelProviderConfigs,
  translationSettings,
  users,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import {
  createSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";
import { decryptSecret } from "@/modules/translation/encryption";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const authRepository = createAuthRepository(db);
const mockedCookies = vi.mocked(cookies);
const masterKey = Buffer.alloc(32, 41);
const encodedMasterKey = masterKey.toString("base64");

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

async function cleanDatabase() {
  vi.clearAllMocks();
  process.env.MODEL_KEY_ENCRYPTION_KEY = encodedMasterKey;
  await db.delete(modelProviderConfigs);
  await db.delete(users);
  await db
    .insert(translationSettings)
    .values({ singleton: true })
    .onConflictDoNothing();
}

beforeEach(cleanDatabase);
afterEach(async () => {
  await cleanDatabase();
  delete process.env.MODEL_KEY_ENCRYPTION_KEY;
});

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

function providerRequest(values: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  return new Request("http://localhost/api/admin/providers", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/providers", () => {
  it("upserts an encrypted provider configuration for an authenticated administrator", async () => {
    await authenticate();

    const response = await POST(
      providerRequest({
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        apiKey: "sk-deepseek-secret",
        enabled: "on",
      }),
    );

    const stored = await db.query.modelProviderConfigs.findFirst();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?providers=updated",
    );
    expect(stored).toMatchObject({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      modelId: "deepseek-chat",
      keyHint: "****cret",
      enabled: true,
    });
    expect(stored?.encryptedApiKey).not.toContain("sk-deepseek-secret");
    expect(decryptSecret(stored!.encryptedApiKey, masterKey)).toBe(
      "sk-deepseek-secret",
    );
  });

  it("redirects unauthenticated requests to login", async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST(
      providerRequest({
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        apiKey: "sk-deepseek-secret",
        enabled: "on",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
    await expect(
      db.query.modelProviderConfigs.findFirst(),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["unsupported provider", { provider: "openai" }],
    ["unsafe base URL", { baseUrl: "http://api.deepseek.com" }],
    ["blank API key", { apiKey: "  " }],
  ])("rejects %s without changing provider settings", async (_caseName, overrides) => {
    await authenticate();

    const response = await POST(
      providerRequest({
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        apiKey: "sk-deepseek-secret",
        enabled: "on",
        ...overrides,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?providers=invalid",
    );
    await expect(
      db.query.modelProviderConfigs.findFirst(),
    ).resolves.toBeUndefined();
  });
});
