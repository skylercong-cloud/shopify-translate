import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createAuthService } from "@/modules/auth/auth-service";

const repository = createAuthRepository(db);
const service = createAuthService(repository);

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

describe("setAdminPassword", () => {
  it("replaces the password hash and revokes existing sessions", async () => {
    await service.setAdminPassword("first password value");
    const first = await repository.findAdmin();
    await repository.createSession({
      id: "00000000-0000-4000-8000-000000000001",
      tokenHash: "b".repeat(64),
      userId: first!.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.setAdminPassword("second password value");
    const second = await repository.findAdmin();
    const revoked = await db.query.sessions.findFirst();

    expect(first?.id).toBe(second?.id);
    expect(first?.passwordHash).not.toBe(second?.passwordHash);
    expect(revoked).toBeUndefined();
  });
});
