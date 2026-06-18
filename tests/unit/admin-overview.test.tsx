import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OperationsOverviewPanel } from "@/app/(app)/admin/operations-overview";
import type { OperationsOverview } from "@/modules/operations/types";

const overview: OperationsOverview = {
  settings: {
    dailyTokenLimit: 500_000,
    budgetTimeZone: "Asia/Shanghai",
    requestTimeoutMs: 30_000,
    maxInputBytes: 500_000,
    maxOutputTokens: 2_048,
    workerConcurrency: 2,
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
    {
      provider: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelId: "qwen-plus",
      keyHint: null,
      enabled: false,
      updatedAt: new Date("2026-06-18T08:05:00.000Z"),
    },
  ],
  activePrompt: {
    id: "prompt-id",
    version: 3,
    createdAt: new Date("2026-06-18T07:00:00.000Z"),
  },
  activeGlossary: {
    id: "glossary-id",
    version: 2,
    termCount: 12,
    createdAt: new Date("2026-06-18T07:30:00.000Z"),
  },
  jobs: {
    byQueueStatus: [
      { queue: "translation", status: "queued", count: 4 },
      { queue: "translation", status: "failed", count: 1 },
    ],
    recentFailures: [
      {
        id: "job-id",
        queue: "translation",
        type: "translate_block",
        attempts: 3,
        maxAttempts: 3,
        lastErrorCode: "provider_error",
        lastErrorMessage: "DeepSeek failed",
        updatedAt: new Date("2026-06-18T08:10:00.000Z"),
      },
    ],
  },
};

describe("OperationsOverviewPanel", () => {
  it("renders model, prompt, glossary, budget, and job status without secrets", () => {
    render(<OperationsOverviewPanel overview={overview} />);

    expect(
      screen.getByRole("heading", { name: "运维概览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("deepseek")).toBeInTheDocument();
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.getByText("****seek")).toBeInTheDocument();
    expect(screen.getByText("qwen")).toBeInTheDocument();
    expect(screen.getByText("未设置 key hint")).toBeInTheDocument();
    expect(screen.getByText("Prompt v3")).toBeInTheDocument();
    expect(screen.getByText("术语库 v2")).toBeInTheDocument();
    expect(screen.getByText("12 terms")).toBeInTheDocument();
    expect(screen.getByText("500,000 tokens/day")).toBeInTheDocument();
    expect(screen.getByText("translation / queued")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("provider_error")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek failed")).toBeInTheDocument();
    expect(screen.queryByText(/encrypted/i)).not.toBeInTheDocument();
  });
});
