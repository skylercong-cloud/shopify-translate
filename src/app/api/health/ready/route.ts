import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";

export function createReadinessHandler(
  checkDatabase: () => Promise<unknown>,
) {
  return async function readinessHandler() {
    try {
      await checkDatabase();

      return NextResponse.json({
        status: "ready",
        database: "up",
      });
    } catch {
      return NextResponse.json(
        {
          status: "not-ready",
          database: "down",
        },
        { status: 503 },
      );
    }
  };
}

export const GET = createReadinessHandler(() =>
  db.execute(sql`select 1`),
);
