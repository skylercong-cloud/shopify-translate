import { eq, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { sessions, users } from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export function createAuthRepository(db: Database) {
  return {
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
          user: true,
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
      await db.delete(sessions).where(lt(sessions.expiresAt, now));
    },
  };
}
