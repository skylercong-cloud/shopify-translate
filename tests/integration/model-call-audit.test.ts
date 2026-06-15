import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { modelCalls } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createModelCallAudit } from "@/modules/translation/model-call-audit";

const audit = createModelCallAudit(db);
const createdIds: string[] = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  for (const id of createdIds.splice(0)) {
    await db.delete(modelCalls).where(eq(modelCalls.id, id));
  }
});

describe("model call audit", () => {
  it("persists request hashes without raw prompts or responses", async () => {
    const requestBody =
      '{"messages":[{"role":"user","content":"private prompt"}]}';
    const stored = await audit.record({
      jobId: null,
      blockId: null,
      provider: "deepseek",
      modelId: "deepseek-chat",
      promptVersionId: null,
      glossaryVersionId: null,
      callSequence: 1,
      status: "succeeded",
      inputTokens: 10,
      outputTokens: 2,
      latencyMs: 50,
      requestBody,
      responseBodyHash: "response-hash",
      errorCode: null,
      errorMessage: null,
      startedAt: new Date("2026-06-15T08:00:00.000Z"),
      completedAt: new Date("2026-06-15T08:00:00.050Z"),
    });
    createdIds.push(stored.id);

    await expect(
      db.query.modelCalls.findFirst({
        where: eq(modelCalls.id, stored.id),
      }),
    ).resolves.toMatchObject({
      requestHash: createHash("sha256")
        .update(requestBody, "utf8")
        .digest("hex"),
      responseHash: "response-hash",
      inputTokens: 10,
      outputTokens: 2,
      latencyMs: 50,
    });

    const columns = Object.keys(modelCalls);
    expect(columns).not.toContain("requestBody");
    expect(columns).not.toContain("responseBody");
  });
});
