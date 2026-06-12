import { eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { sessions, users } from "@/db/schema";
import type {
  AuthRepository,
  SessionRepository,
} from "@/modules/auth/types";

type Database = NodePgDatabase<typeof schema>;

export function createAuthRepository(db: Database) {
  const repository = {
    async upsertAdminPassword(passwordHash: string) {
      const [user] = await db
        .insert(users)
        .values({ username: "admin", passwordHash })
        .onConflictDoUpdate({
          target: users.username,
          set: { passwordHash, updatedAt: new Date() },
        })
        .returning();
      return user;
    },

    replaceAdminPasswordAndRevokeSessions(passwordHash: string) {
      return db.transaction(async (transaction) => {
        const [user] = await transaction
          .insert(users)
          .values({ username: "admin", passwordHash })
          .onConflictDoUpdate({
            target: users.username,
            set: { passwordHash, updatedAt: new Date() },
          })
          .returning();

        await transaction
          .delete(sessions)
          .where(eq(sessions.userId, user.id));

        return user;
      });
    },

    findAdmin() {
      return db.query.users.findFirst({
        where: eq(users.username, "admin"),
      });
    },

    async createSession(input: typeof sessions.$inferInsert) {
      const [session] = await db.insert(sessions).values(input).returning();
      return session;
    },

    findSessionByTokenHash(tokenHash: string) {
      return db.query.sessions.findFirst({
        where: eq(sessions.tokenHash, tokenHash),
        with: {
          user: {
            columns: {
              id: true,
              username: true,
            },
          },
        },
      });
    },

    async deleteSessionByTokenHash(tokenHash: string) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteSessionsForUser(userId: string) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },

    async deleteExpiredSessions(now: Date) {
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
    },
  } satisfies AuthRepository & SessionRepository;

  return repository;
}
