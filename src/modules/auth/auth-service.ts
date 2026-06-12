import { hashPassword, verifyPassword } from "@/modules/auth/password";
import type { AuthRepository } from "@/modules/auth/types";

export function createAuthService(repository: AuthRepository) {
  return {
    async setAdminPassword(password: string) {
      const passwordHash = await hashPassword(password);
      const admin = await repository.upsertAdminPassword(passwordHash);

      await repository.deleteSessionsForUser(admin.id);

      return admin;
    },

    async authenticateAdmin(password: string) {
      const admin = await repository.findAdmin();

      if (!admin) {
        return null;
      }

      const authenticated = await verifyPassword(admin.passwordHash, password);

      return authenticated ? admin : null;
    },
  };
}
