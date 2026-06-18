import { describe, expect, it } from "vitest";

import { deriveOperationsAlerts } from "@/modules/operations/alerts";
import type { OperationsOverview } from "@/modules/operations/types";

function overview(
  overrides: Partial<Omit<OperationsOverview, "alerts">> = {},
): Omit<OperationsOverview, "alerts"> {
  return {
    settings: {
      dailyTokenLimit: 500_000,
      budgetTimeZone: "Asia/Shanghai",
      requestTimeoutMs: 60_000,
      maxInputBytes: 1_048_576,
      maxOutputTokens: 4_096,
      workerConcurrency: 1,
    },
    providers: [
      {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-chat",
        keyHint: "****seek",
        enabled: true,
        updatedAt: new Date("2026-06-18T08:00:00.000Z"),
      },
    ],
    activePrompt: {
      id: "prompt-id",
      version: 1,
      systemPrompt: "Keep technical terms in English.",
      userPromptTemplate: "Translate:\n{{sourceText}}",
      createdAt: new Date("2026-06-18T08:00:00.000Z"),
    },
    activeGlossary: {
      id: "glossary-id",
      version: 1,
      termCount: 2,
      terms: [
        { sourceTerm: "Admin API", normalizedTerm: "admin api" },
        { sourceTerm: "Shopify CLI", normalizedTerm: "shopify cli" },
      ],
      createdAt: new Date("2026-06-18T08:00:00.000Z"),
    },
    jobs: {
      byQueueStatus: [],
      recentFailures: [],
    },
    security: {
      activeSessionCount: 1,
    },
    ...overrides,
  };
}

describe("deriveOperationsAlerts", () => {
  it("returns no alerts for healthy operations data", () => {
    expect(deriveOperationsAlerts(overview())).toEqual([]);
  });

  it("reports missing enabled providers as critical", () => {
    expect(
      deriveOperationsAlerts(
        overview({
          providers: [
            {
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              modelId: "deepseek-chat",
              keyHint: "****seek",
              enabled: false,
              updatedAt: new Date("2026-06-18T08:00:00.000Z"),
            },
          ],
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        severity: "critical",
        code: "no_enabled_provider",
      }),
    );
  });

  it("reports missing prompt and glossary versions", () => {
    expect(
      deriveOperationsAlerts(
        overview({
          activePrompt: null,
          activeGlossary: null,
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "missing_prompt",
      }),
      expect.objectContaining({
        severity: "warning",
        code: "missing_glossary",
      }),
    ]);
  });

  it("reports failed jobs with the failed count", () => {
    expect(
      deriveOperationsAlerts(
        overview({
          jobs: {
            byQueueStatus: [
              { queue: "ingestion", status: "failed", count: 2 },
              { queue: "translation", status: "failed", count: 3 },
              { queue: "translation", status: "queued", count: 5 },
            ],
            recentFailures: [],
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        severity: "critical",
        code: "failed_jobs",
        message: "5 failed jobs need attention.",
      }),
    );
  });
});
