import { db, pool } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createAuthService } from "@/modules/auth/auth-service";

const password = process.env.E2E_ADMIN_PASSWORD;

if (!password) {
  throw new Error("E2E_ADMIN_PASSWORD is required");
}

try {
  await createAuthService(createAuthRepository(db)).setAdminPassword(
    password,
  );
} finally {
  await pool.end();
}
