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

import { POST } from "@/app/api/admin/settings/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { translationSettings, users } from "@/db/schema";
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
  await db.delete(users);
  await db
    .insert(translationSettings)
    .values({ singleton: true })
    .onConflictDoNothing();
  await db
    .update(translationSettings)
    .set({
      dailyTokenLimit: null,
      requestTimeoutMs: 60_000,
      maxInputBytes: 1_048_576,
      maxOutputTokens: 4_096,
      workerConcurrency: 1,
      updatedAt: new Date(),
    });
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

function settingsRequest(values: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  return new Request("http://localhost/api/admin/settings", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/settings", () => {
  it("updates runtime settings for an authenticated administrator", async () => {
    await authenticate();

    const response = await POST(
      settingsRequest({
        dailyTokenLimit: "250000",
        requestTimeoutMs: "30000",
        maxInputBytes: "500000",
        maxOutputTokens: "2048",
        workerConcurrency: "2",
      }),
    );

    const stored = await db.query.translationSettings.findFirst();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?settings=updated",
    );
    expect(stored).toMatchObject({
      dailyTokenLimit: 250_000,
      requestTimeoutMs: 30_000,
      maxInputBytes: 500_000,
      maxOutputTokens: 2_048,
      workerConcurrency: 2,
    });
  });

  it("redirects unauthenticated requests to login", async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST(
      settingsRequest({
        requestTimeoutMs: "30000",
        maxInputBytes: "500000",
        maxOutputTokens: "2048",
        workerConcurrency: "2",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
  });

  it("rejects invalid numeric values without changing settings", async () => {
    await authenticate();

    const response = await POST(
      settingsRequest({
        dailyTokenLimit: "0",
        requestTimeoutMs: "30000",
        maxInputBytes: "500000",
        maxOutputTokens: "2048",
        workerConcurrency: "2",
      }),
    );
    const stored = await db.query.translationSettings.findFirst();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?settings=invalid",
    );
    expect(stored).toMatchObject({
      dailyTokenLimit: null,
      requestTimeoutMs: 60_000,
      maxInputBytes: 1_048_576,
      maxOutputTokens: 4_096,
      workerConcurrency: 1,
    });
  });
});
