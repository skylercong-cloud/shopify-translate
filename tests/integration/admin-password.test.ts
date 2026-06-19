import { sql } from "drizzle-orm";
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

  it("rolls back the password change when session revocation fails", async () => {
    await service.setAdminPassword("first password value");
    const first = await repository.findAdmin();
    await repository.createSession({
      id: "00000000-0000-4000-8000-000000000002",
      tokenHash: "c".repeat(64),
      userId: first!.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await db.execute(sql`
      create function fail_session_delete() returns trigger as $$
      begin
        raise exception 'forced session delete failure';
      end;
      $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger fail_session_delete
      before delete on sessions
      for each row execute function fail_session_delete()
    `);

    try {
      await expect(
        service.setAdminPassword("second password value"),
      ).rejects.toThrow();

      const unchanged = await repository.findAdmin();
      const session = await db.query.sessions.findFirst();

      expect(unchanged?.passwordHash).toBe(first?.passwordHash);
      expect(session).toBeDefined();
    } finally {
      await db.execute(sql`drop trigger fail_session_delete on sessions`);
      await db.execute(sql`drop function fail_session_delete()`);
    }
  });
});

describe("changeAdminPassword", () => {
  it("requires the current password before replacing the hash and revoking sessions", async () => {
    await service.setAdminPassword("current password value");
    const first = await repository.findAdmin();
    await repository.createSession({
      id: "00000000-0000-4000-8000-000000000003",
      tokenHash: "d".repeat(64),
      userId: first!.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.changeAdminPassword("wrong password", "new password value"),
    ).resolves.toBeNull();
    await expect(
      repository.findSessionByTokenHash("d".repeat(64)),
    ).resolves.toBeDefined();
    await expect(repository.findAdmin()).resolves.toMatchObject({
      passwordHash: first!.passwordHash,
    });

    await expect(
      service.changeAdminPassword(
        "current password value",
        "new password value",
      ),
    ).resolves.toMatchObject({
      id: first!.id,
      username: "admin",
    });
    const changed = await repository.findAdmin();

    expect(changed?.passwordHash).not.toBe(first?.passwordHash);
    await expect(
      repository.findSessionByTokenHash("d".repeat(64)),
    ).resolves.toBeUndefined();
  });
});
