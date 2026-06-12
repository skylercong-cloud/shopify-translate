import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { sessions, users } from "@/db/schema";
import { getEnv } from "@/lib/env";

const repository = createAuthRepository(db);
const createdUserIds: string[] = [];

beforeAll(async () => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }

  await db.execute(sql`select 1`);
});

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(users).where(eq(users.id, createdUserIds.pop()!));
});

describe("auth repository", () => {
  it("handles idle connection errors without an unhandled event", () => {
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });

  it("upserts the single admin and creates a session", async () => {
    const user = await repository.upsertAdminPassword("hash-value");
    createdUserIds.push(user.id);

    const expiresAt = new Date(Date.now() + 60_000);
    await repository.createSession({
      id: randomUUID(),
      tokenHash: "a".repeat(64),
      userId: user.id,
      expiresAt,
    });

    const stored = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.userId, user.id),
        eq(sessions.tokenHash, "a".repeat(64)),
      ),
    });

    expect(user.username).toBe("admin");
    expect(stored?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("deletes sessions that expire exactly at the cleanup time", async () => {
    const user = await repository.upsertAdminPassword("hash-value");
    createdUserIds.push(user.id);

    const now = new Date("2026-06-12T00:00:00Z");
    await repository.createSession({
      id: randomUUID(),
      tokenHash: "b".repeat(64),
      userId: user.id,
      expiresAt: now,
    });
    await repository.createSession({
      id: randomUUID(),
      tokenHash: "c".repeat(64),
      userId: user.id,
      expiresAt: new Date(now.getTime() + 1),
    });

    await repository.deleteExpiredSessions(now);

    await expect(
      repository.findSessionByTokenHash("b".repeat(64)),
    ).resolves.toBeUndefined();
    await expect(
      repository.findSessionByTokenHash("c".repeat(64)),
    ).resolves.toBeDefined();
  });
});
