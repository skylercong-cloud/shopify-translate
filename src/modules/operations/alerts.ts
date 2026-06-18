import type { OperationsAlert, OperationsOverview } from "./types";

type OperationsOverviewInput = Omit<OperationsOverview, "alerts">;

export function deriveOperationsAlerts(
  overview: OperationsOverviewInput,
): OperationsAlert[] {
  const alerts: OperationsAlert[] = [];
  const failedJobCount = overview.jobs.byQueueStatus
    .filter((item) => item.status === "failed")
    .reduce((total, item) => total + item.count, 0);

  if (overview.providers.every((provider) => !provider.enabled)) {
    alerts.push({
      severity: "critical",
      code: "no_enabled_provider",
      title: "没有启用的模型供应商",
      message:
        "Translation worker cannot call a model until DeepSeek or Qwen is enabled.",
    });
  }

  if (!overview.activePrompt) {
    alerts.push({
      severity: "warning",
      code: "missing_prompt",
      title: "未启用 Prompt",
      message: "Translation jobs require an active Prompt version.",
    });
  }

  if (!overview.activeGlossary) {
    alerts.push({
      severity: "warning",
      code: "missing_glossary",
      title: "未启用术语库",
      message: "Translation jobs require an active glossary version.",
    });
  }

  if (failedJobCount > 0) {
    alerts.push({
      severity: "critical",
      code: "failed_jobs",
      title: "后台任务失败",
      message: `${failedJobCount} failed jobs need attention.`,
    });
  }

  return alerts;
}
