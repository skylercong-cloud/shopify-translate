import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/login/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createAuthService } from "@/modules/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

const repository = createAuthRepository(db);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  await db.delete(users);
});

describe("POST /api/auth/login", () => {
  it("rejects an incorrect password without creating a session", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "incorrect value" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(db.query.sessions.findFirst()).resolves.toBeUndefined();
  });

  it("creates a hashed session and sets an HttpOnly cookie", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct password value" }),
    });

    const response = await POST(request);
    const setCookie = response.headers.get("set-cookie");
    const stored = await db.query.sessions.findFirst();

    expect(response.status).toBe(200);
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie?.toLowerCase()).toContain("samesite=lax");
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(setCookie).not.toContain(stored!.tokenHash);
  });
});
