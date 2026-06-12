import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./client";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
