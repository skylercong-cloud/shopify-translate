import { cookies } from "next/headers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/logout/route";
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

describe("POST /api/auth/logout", () => {
  it("deletes the hashed session and clears the session cookie", async () => {
    const user = await repository.upsertAdminPassword("hash");
    const token = createSessionToken();
    await repository.createSession(
      newSessionRecord(token, user.id, new Date(), 30),
    );
    mockedCookies.mockResolvedValue({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME ? { value: token } : undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
    await expect(
      repository.findSessionByTokenHash(hashSessionToken(token)),
    ).resolves.toBeUndefined();
    expect(response.headers.get("set-cookie")).toContain(
      `${SESSION_COOKIE_NAME}=`,
    );
    expect(response.headers.get("set-cookie")).toContain("Expires=");
  });
});
