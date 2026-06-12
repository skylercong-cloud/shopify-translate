import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { getUserForSessionToken } from "@/modules/auth/current-user";
import {
  createSessionToken,
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

describe("getUserForSessionToken", () => {
  it("returns the session user before expiration", async () => {
    const user = await repository.upsertAdminPassword("hash");
    const token = createSessionToken();
    await repository.createSession(
      newSessionRecord(
        token,
        user.id,
        new Date("2026-06-10T00:00:00Z"),
        2,
      ),
    );

    await expect(
      getUserForSessionToken(
        repository,
        token,
        new Date("2026-06-11T00:00:00Z"),
      ),
    ).resolves.toEqual({
      id: user.id,
      username: "admin",
    });
  });

  it("returns null for expired sessions", async () => {
    const user = await repository.upsertAdminPassword("hash");
    const token = createSessionToken();
    await repository.createSession(
      newSessionRecord(
        token,
        user.id,
        new Date("2026-05-01T00:00:00Z"),
        1,
      ),
    );

    await expect(
      getUserForSessionToken(
        repository,
        token,
        new Date("2026-06-11T00:00:00Z"),
      ),
    ).resolves.toBeNull();
  });
});
