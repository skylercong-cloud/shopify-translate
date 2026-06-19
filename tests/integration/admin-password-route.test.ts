import { cookies } from "next/headers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/admin/password/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createAuthService } from "@/modules/auth/auth-service";
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
const service = createAuthService(repository);
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

async function authenticate(password = "current password value") {
  await service.setAdminPassword(password);
  const admin = await repository.findAdmin();
  const token = createSessionToken();
  await repository.createSession(
    newSessionRecord(token, admin!.id, new Date(), 30),
  );
  mockedCookies.mockResolvedValue({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME ? { value: token } : undefined,
  } as Awaited<ReturnType<typeof cookies>>);

  return { admin: admin!, token };
}

function passwordRequest(values: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  return new Request("http://localhost/api/admin/password", {
    body: formData,
    method: "POST",
  });
}

describe("POST /api/admin/password", () => {
  it("changes the password, revokes sessions, and clears the current cookie", async () => {
    const { token } = await authenticate();

    const response = await POST(
      passwordRequest({
        confirmPassword: "new password value",
        currentPassword: "current password value",
        newPassword: "new password value",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login?password=updated",
    );
    expect(response.headers.get("set-cookie")).toContain(
      `${SESSION_COOKIE_NAME}=`,
    );
    expect(response.headers.get("set-cookie")).toContain("Expires=");
    await expect(
      repository.findSessionByTokenHash(hashSessionToken(token)),
    ).resolves.toBeUndefined();
    await expect(
      service.authenticateAdmin("new password value"),
    ).resolves.toMatchObject({
      username: "admin",
    });
    await expect(
      service.authenticateAdmin("current password value"),
    ).resolves.toBeNull();
  });

  it("rejects the wrong current password without changing the session", async () => {
    const { token } = await authenticate();
    const before = await repository.findAdmin();

    const response = await POST(
      passwordRequest({
        confirmPassword: "new password value",
        currentPassword: "wrong password",
        newPassword: "new password value",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?password=invalid",
    );
    await expect(repository.findAdmin()).resolves.toMatchObject({
      passwordHash: before!.passwordHash,
    });
    await expect(
      repository.findSessionByTokenHash(hashSessionToken(token)),
    ).resolves.toBeDefined();
  });

  it("rejects mismatched confirmation without changing the session", async () => {
    const { token } = await authenticate();

    const response = await POST(
      passwordRequest({
        confirmPassword: "different password value",
        currentPassword: "current password value",
        newPassword: "new password value",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?password=invalid",
    );
    await expect(
      repository.findSessionByTokenHash(hashSessionToken(token)),
    ).resolves.toBeDefined();
  });

  it("redirects unauthenticated requests to login", async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST(
      passwordRequest({
        confirmPassword: "new password value",
        currentPassword: "current password value",
        newPassword: "new password value",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
  });
});
