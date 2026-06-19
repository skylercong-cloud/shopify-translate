import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "@/lib/env";

import * as schema from "./schema";

const pool = new Pool({
  connectionString: getEnv().DATABASE_URL,
  max: 10,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

export const db = drizzle(pool, { schema });
export { pool };
