import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

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

describe("database sessions", () => {
  it("looks up a session using only the token hash", async () => {
    const user = await repository.upsertAdminPassword("hash");
    const token = createSessionToken();
    await repository.createSession(
      newSessionRecord(token, user.id, new Date(), 30),
    );

    const stored = await repository.findSessionByTokenHash(
      hashSessionToken(token),
    );

    expect(stored?.tokenHash).not.toBe(token);
    expect(stored?.user.username).toBe("admin");
  });
});
