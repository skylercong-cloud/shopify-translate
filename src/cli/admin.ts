import { password } from "@inquirer/prompts";

import { db, pool } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createAuthService } from "@/modules/auth/auth-service";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command !== "set-password" || args.length > 0) {
    throw new Error("Usage: pnpm admin set-password");
  }

  const newPassword = await password({
    message: "Password:",
    mask: "*",
  });
  const confirmation = await password({
    message: "Confirm password:",
    mask: "*",
  });

  if (newPassword !== confirmation) {
    throw new Error("Passwords do not match");
  }

  const repository = createAuthRepository(db);
  const service = createAuthService(repository);

  await service.setAdminPassword(newPassword);
  console.log("Admin password updated.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
