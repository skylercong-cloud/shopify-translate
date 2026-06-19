import { createHash } from "node:crypto";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  modelCalls,
  modelCallStatuses,
  translationProviders,
} from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ModelCallStatus = (typeof modelCallStatuses)[number];
type TranslationProvider = (typeof translationProviders)[number];

export type ModelCallAuditInput = {
  jobId: string | null;
  blockId: string | null;
  provider: TranslationProvider;
  modelId: string;
  promptVersionId: string | null;
  glossaryVersionId: string | null;
  callSequence: number;
  status: ModelCallStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  requestBody: string;
  responseBodyHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date;
};

export interface ModelCallAudit {
  record(input: ModelCallAuditInput): Promise<{ id: string }>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createModelCallAudit(db: Database): ModelCallAudit {
  return {
    async record(input) {
      const [stored] = await db
        .insert(modelCalls)
        .values({
          jobId: input.jobId,
          blockId: input.blockId,
          provider: input.provider,
          modelId: input.modelId,
          promptVersionId: input.promptVersionId,
          glossaryVersionId: input.glossaryVersionId,
          callSequence: input.callSequence,
          status: input.status,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          latencyMs: input.latencyMs,
          requestHash: sha256(input.requestBody),
          responseHash: input.responseBodyHash,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage?.slice(0, 2_000) ?? null,
          createdAt: input.startedAt,
          completedAt: input.completedAt,
        })
        .returning({ id: modelCalls.id });
      return stored;
    },
  };
}
