import { render, screen, within } from "@testing-library/react";
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
    systemPrompt: "Keep technical terms in English.",
    userPromptTemplate: "Translate:\n{{sourceText}}",
    createdAt: new Date("2026-06-18T07:00:00.000Z"),
  },
  activeGlossary: {
    id: "glossary-id",
    version: 2,
    termCount: 12,
    terms: [
      { sourceTerm: "Admin API", normalizedTerm: "admin api" },
      { sourceTerm: "Shopify CLI", normalizedTerm: "shopify cli" },
    ],
    createdAt: new Date("2026-06-18T07:30:00.000Z"),
  },
  glossaryHistory: [
    {
      id: "glossary-id",
      version: 2,
      termCount: 12,
      active: true,
      createdAt: new Date("2026-06-18T07:30:00.000Z"),
    },
    {
      id: "old-glossary-id",
      version: 1,
      termCount: 2,
      active: false,
      createdAt: new Date("2026-06-17T07:30:00.000Z"),
    },
  ],
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
  security: {
    activeSessionCount: 2,
  },
  system: {
    databaseWrite: {
      checkedAt: new Date("2026-06-18T08:00:00.000Z"),
      writable: true,
    },
  },
  alerts: [
    {
      severity: "critical",
      code: "failed_jobs",
      title: "后台任务失败",
      message: "1 failed jobs need attention.",
    },
  ],
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
    const deepseekForm = screen.getByRole("form", {
      name: "deepseek provider form",
    });
    expect(deepseekForm).toHaveAttribute(
      "action",
      "/api/admin/providers",
    );
    expect(
      deepseekForm.querySelector('input[name="provider"]'),
    ).toHaveAttribute("value", "deepseek");
    expect(within(deepseekForm).getByLabelText("Model ID")).toHaveDisplayValue(
      "deepseek-chat",
    );
    expect(within(deepseekForm).getByLabelText("Base URL")).toHaveDisplayValue(
      "https://api.deepseek.com",
    );
    expect(within(deepseekForm).getByLabelText("API key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(within(deepseekForm).getByLabelText("API key")).toHaveDisplayValue(
      "",
    );
    expect(within(deepseekForm).getByLabelText("Enabled")).toBeChecked();
    expect(
      within(deepseekForm).getByRole("button", {
        name: "保存 provider 设置",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("qwen")).toBeInTheDocument();
    expect(screen.getByText("未设置 key hint")).toBeInTheDocument();
    const qwenForm = screen.getByRole("form", {
      name: "qwen provider form",
    });
    expect(qwenForm).toHaveAttribute("action", "/api/admin/providers");
    expect(qwenForm.querySelector('input[name="provider"]')).toHaveAttribute(
      "value",
      "qwen",
    );
    expect(within(qwenForm).getByLabelText("Model ID")).toHaveDisplayValue(
      "qwen-plus",
    );
    expect(within(qwenForm).getByLabelText("Base URL")).toHaveDisplayValue(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(within(qwenForm).getByLabelText("API key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(within(qwenForm).getByLabelText("Enabled")).not.toBeChecked();
    expect(screen.getByText("Prompt v3")).toBeInTheDocument();
    const promptForm = screen.getByRole("form", { name: "Prompt 表单" });
    expect(promptForm).toHaveAttribute("action", "/api/admin/prompt");
    expect(
      within(promptForm).getByLabelText("System prompt"),
    ).toHaveDisplayValue("Keep technical terms in English.");
    expect(
      within(promptForm).getByLabelText("User prompt template"),
    ).toHaveDisplayValue("Translate:\n{{sourceText}}");
    expect(
      within(promptForm).getByRole("button", { name: "激活 Prompt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("术语库 v2")).toBeInTheDocument();
    expect(screen.getAllByText("12 terms").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Admin API")).toBeInTheDocument();
    expect(screen.getByText("Shopify CLI")).toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "术语库表单" }),
    ).toHaveAttribute("action", "/api/admin/glossary");
    expect(screen.getByLabelText("Glossary terms")).toHaveDisplayValue(
      "Admin API\nShopify CLI",
    );
    expect(
      screen.getByRole("button", { name: "激活术语库" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Glossary history")).toBeInTheDocument();
    expect(screen.getByText("Glossary v2")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Glossary v1")).toBeInTheDocument();
    expect(screen.getByText("2 terms")).toBeInTheDocument();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText("500,000 tokens/day")).toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "运行设置表单" }),
    ).toHaveAttribute("action", "/api/admin/settings");
    expect(screen.getByLabelText("Daily token limit")).toHaveDisplayValue(
      "500000",
    );
    expect(screen.getByLabelText("Request timeout (ms)")).toHaveDisplayValue(
      "30000",
    );
    expect(screen.getByLabelText("Max input bytes")).toHaveDisplayValue(
      "500000",
    );
    expect(screen.getByLabelText("Max output tokens")).toHaveDisplayValue(
      "2048",
    );
    expect(screen.getByLabelText("Worker concurrency")).toHaveDisplayValue(
      "2",
    );
    expect(
      screen.getByRole("button", { name: "保存运行设置" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 active sessions")).toBeInTheDocument();
    const passwordForm = screen.getByRole("form", {
      name: "登录密码表单",
    });
    expect(passwordForm).toHaveAttribute("action", "/api/admin/password");
    expect(
      within(passwordForm).getByLabelText("Current password"),
    ).toHaveAttribute("type", "password");
    expect(
      within(passwordForm).getByLabelText("Current password"),
    ).toHaveDisplayValue("");
    expect(
      within(passwordForm).getByLabelText("New password"),
    ).toHaveAttribute("type", "password");
    expect(
      within(passwordForm).getByLabelText("New password"),
    ).toHaveDisplayValue("");
    expect(
      within(passwordForm).getByLabelText("Confirm new password"),
    ).toHaveAttribute("type", "password");
    expect(
      within(passwordForm).getByLabelText("Confirm new password"),
    ).toHaveDisplayValue("");
    const sessionsForm = screen.getByRole("form", {
      name: "会话管理表单",
    });
    expect(sessionsForm).toHaveAttribute("action", "/api/admin/sessions");
    expect(
      within(sessionsForm).getByRole("button", { name: "撤销其他会话" }),
    ).toBeInTheDocument();
    expect(screen.getByText("translation / queued")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("provider_error")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek failed")).toBeInTheDocument();
    expect(screen.getByText("需要处理")).toBeInTheDocument();
    expect(screen.getByText("后台任务失败")).toBeInTheDocument();
    expect(screen.getByText("1 failed jobs need attention.")).toBeInTheDocument();
    expect(screen.queryByText(/encrypted/i)).not.toBeInTheDocument();
  });
});
