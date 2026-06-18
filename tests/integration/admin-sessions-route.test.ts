import { cookies } from "next/headers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/admin/sessions/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const repository = createAuthRepository(db);
const mockedCookies = vi.mocked(cookies);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  vi.clearAllMocks();
  await db.delete(users);
});

async function authenticateWithOtherSession() {
  const user = await repository.upsertAdminPassword("hash");
  const currentToken = createSessionToken();
  const otherToken = createSessionToken();
  await repository.createSession(
    newSessionRecord(currentToken, user.id, new Date(), 30),
  );
  await repository.createSession(
    newSessionRecord(otherToken, user.id, new Date(), 30),
  );
  mockedCookies.mockResolvedValue({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME ? { value: currentToken } : undefined,
  } as Awaited<ReturnType<typeof cookies>>);

  return { currentToken, otherToken };
}

describe("POST /api/admin/sessions", () => {
  it("revokes other admin sessions while preserving the current session", async () => {
    const { currentToken, otherToken } = await authenticateWithOtherSession();

    const response = await POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?sessions=revoked",
    );
    await expect(
      repository.findSessionByTokenHash(hashSessionToken(currentToken)),
    ).resolves.toBeDefined();
    await expect(
      repository.findSessionByTokenHash(hashSessionToken(otherToken)),
    ).resolves.toBeUndefined();
  });

  it("redirects missing sessions to login", async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
  });
});
