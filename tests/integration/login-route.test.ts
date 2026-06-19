import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { POST } from "@/app/api/auth/login/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createAuthService } from "@/modules/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { loginRateLimit } from "@/modules/auth/login-rate-limit";

const repository = createAuthRepository(db);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

async function resetAuthState() {
  loginRateLimit.reset();
  await db.delete(users);
}

beforeEach(resetAuthState);
afterEach(resetAuthState);

function loginRequest(password: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/auth/login", () => {
  it("rejects login when no administrator has been configured", async () => {
    const response = await POST(loginRequest("candidate password"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(db.query.sessions.findFirst()).resolves.toBeUndefined();
  });

  it("rejects an incorrect password without creating a session", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );

    const response = await POST(loginRequest("incorrect value"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(db.query.sessions.findFirst()).resolves.toBeUndefined();
  });

  it("creates a hashed session and sets an HttpOnly cookie", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );

    const response = await POST(loginRequest("correct password value"));
    const setCookie = response.headers.get("set-cookie");
    const stored = await db.query.sessions.findFirst();

    expect(response.status).toBe(200);
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie?.toLowerCase()).toContain("samesite=lax");
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(setCookie).not.toContain(stored!.tokenHash);
  });

  it("returns 429 with Retry-After on the sixth failed login", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(loginRequest("incorrect value"));
      expect(response.status).toBe(401);
    }

    const response = await POST(loginRequest("incorrect value"));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(
      900,
    );
  });

  it("limits concurrent failed logins to five password checks", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        POST(loginRequest("incorrect value")),
      ),
    );

    expect(
      responses.filter((response) => response.status === 401),
    ).toHaveLength(5);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(1);
  });

  it("does not hold the authentication lock while reading a request body", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );

    let releaseBody!: (body: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      releaseBody = resolve;
    });
    const slowRequest = {
      json: () => body,
    } as Request;

    const slowResponse = POST(slowRequest);
    await Promise.resolve();
    const normalResponse = POST(loginRequest("correct password value"));
    const completedWithoutWaiting = await Promise.race([
      normalResponse.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 500);
      }),
    ]);

    releaseBody(null);
    await slowResponse;

    expect(completedWithoutWaiting).toBe(true);
    expect((await normalResponse).status).toBe(200);
  });

  it("resets failed login attempts after a successful login", async () => {
    await createAuthService(repository).setAdminPassword(
      "correct password value",
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        (await POST(loginRequest("incorrect value"))).status,
      ).toBe(401);
    }

    expect(
      (await POST(loginRequest("correct password value"))).status,
    ).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await POST(loginRequest("incorrect value"))).status,
      ).toBe(401);
    }

    expect(
      (await POST(loginRequest("incorrect value"))).status,
    ).toBe(429);
  });
});
