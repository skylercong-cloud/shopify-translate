import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { sessions, users } from "@/db/schema";

const repository = createAuthRepository(db);
const createdUserIds: string[] = [];

beforeAll(async () => {
  await db.execute(sql`select 1`);
});

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(users).where(eq(users.id, createdUserIds.pop()!));
});

describe("auth repository", () => {
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
});
