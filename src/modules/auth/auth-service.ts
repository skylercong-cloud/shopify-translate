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

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c2hvcGlmeS1kb2NzLWR1bW15LXNhbHQ$4ciQ+XkFy30JpD6jUb6Vxk/a/TQbFKVxbo4wlH0J78o";

export function createAuthService(
  repository: AuthRepository & SessionRepository,
) {
  async function authenticateAdmin(password: string) {
    const admin = await repository.findAdmin();

    const authenticated = await verifyPassword(
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    return admin && authenticated ? admin : null;
  }

  return {
    async setAdminPassword(password: string) {
      const passwordHash = await hashPassword(password);
      return repository.replaceAdminPasswordAndRevokeSessions(passwordHash);
    },

    async changeAdminPassword(
      currentPassword: string,
      newPassword: string,
    ) {
      const admin = await authenticateAdmin(currentPassword);

      if (!admin) {
        return null;
      }

      const passwordHash = await hashPassword(newPassword);
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
