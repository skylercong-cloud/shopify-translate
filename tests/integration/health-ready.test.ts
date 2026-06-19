import { beforeAll, describe, expect, it } from "vitest";

import { GET as live } from "@/app/api/health/live/route";
import {
  createReadinessHandler,
  GET as ready,
} from "@/app/api/health/ready/route";
import { getEnv } from "@/lib/env";

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

describe("health routes", () => {
  it("reports liveness without touching the database", async () => {
    const response = live();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "alive",
    });
  });

  it("reports readiness when PostgreSQL accepts a query", async () => {
    const response = await ready();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      database: "up",
    });
  });

  it("reports not-ready when the database check fails", async () => {
    const unavailable = createReadinessHandler(async () => {
      throw new Error("database unavailable");
    });

    const response = await unavailable();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not-ready",
      database: "down",
    });
  });
});
