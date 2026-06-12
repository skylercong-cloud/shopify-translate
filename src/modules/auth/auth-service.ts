import { getEnv } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import {
  createSessionToken,
  hashSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";
import type {
  AuthRepository,
  SessionRepository,
} from "@/modules/auth/types";

export function createAuthService(
  repository: AuthRepository & SessionRepository,
) {
  async function authenticateAdmin(password: string) {
    const admin = await repository.findAdmin();

    if (!admin) {
      return null;
    }

    const authenticated = await verifyPassword(admin.passwordHash, password);

    return authenticated ? admin : null;
  }

  return {
    async setAdminPassword(password: string) {
      const passwordHash = await hashPassword(password);
      return repository.replaceAdminPasswordAndRevokeSessions(passwordHash);
    },

    authenticateAdmin,

    async login(password: string, now = new Date()) {
      const admin = await authenticateAdmin(password);

      if (!admin) {
        return null;
      }

      const token = createSessionToken();
      const record = newSessionRecord(
        token,
        admin.id,
        now,
        getEnv().SESSION_DAYS,
      );

      await repository.createSession(record);

      return { token, expiresAt: record.expiresAt };
    },

    async logout(token: string) {
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },
  };
}
