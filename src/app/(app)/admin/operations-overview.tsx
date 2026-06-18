import type {
  OperationsAlert,
  OperationsJobCount,
  OperationsOverview,
  OperationsProviderStatus,
  OperationsRecentFailure,
} from "@/modules/operations/types";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMaybeNumber(value: number | null, suffix: string) {
  return value === null ? "未设置" : `${formatNumber(value)} ${suffix}`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

function ProviderCard({ provider }: { provider: OperationsProviderStatus }) {
  return (
    <article className="operations-card operations-card--compact">
      <div className="operations-card__header">
        <h3>{provider.provider}</h3>
        <span
          className={
            provider.enabled
              ? "operations-badge operations-badge--ok"
              : "operations-badge"
          }
        >
          {provider.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <dl className="operations-list">
        <div>
          <dt>Model</dt>
          <dd>{provider.modelId}</dd>
        </div>
        <div>
          <dt>Base URL</dt>
          <dd>{provider.baseUrl}</dd>
        </div>
        <div>
          <dt>API key</dt>
          <dd>{provider.keyHint ?? "未设置 key hint"}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(provider.updatedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

function JobCountCard({ item }: { item: OperationsJobCount }) {
  return (
    <article className="operations-metric">
      <span>{item.queue} / {item.status}</span>
      <strong>{formatNumber(item.count)}</strong>
    </article>
  );
}

function RecentFailure({ failure }: { failure: OperationsRecentFailure }) {
  return (
    <li>
      <div>
        <strong>{failure.lastErrorCode ?? "unknown_error"}</strong>
        <span>
          {failure.queue} / {failure.type} / {failure.attempts} of{" "}
          {failure.maxAttempts}
        </span>
      </div>
      <p>{failure.lastErrorMessage ?? "No error message recorded."}</p>
      <time dateTime={failure.updatedAt.toISOString()}>
        {formatDate(failure.updatedAt)}
      </time>
    </li>
  );
}

function OperationsAlertBanner({ alert }: { alert: OperationsAlert }) {
  return (
    <article
      className={[
        "operations-alert",
        alert.severity === "critical"
          ? "operations-alert--critical"
          : "operations-alert--warning",
      ].join(" ")}
    >
      <span>{alert.severity === "critical" ? "需要处理" : "注意"}</span>
      <div>
        <strong>{alert.title}</strong>
        <p>{alert.message}</p>
      </div>
    </article>
  );
}

function RuntimeSettingsForm({
  settings,
}: {
  settings: OperationsOverview["settings"];
}) {
  return (
    <form
      aria-label="运行设置表单"
      action="/api/admin/settings"
      className="operations-settings-form"
      method="post"
    >
      <label>
        <span>Daily token limit</span>
        <input
          defaultValue={settings.dailyTokenLimit ?? ""}
          min="1"
          name="dailyTokenLimit"
          type="number"
        />
      </label>
      <label>
        <span>Request timeout (ms)</span>
        <input
          defaultValue={settings.requestTimeoutMs}
          min="1"
          name="requestTimeoutMs"
          required
          type="number"
        />
      </label>
      <label>
        <span>Max input bytes</span>
        <input
          defaultValue={settings.maxInputBytes}
          min="1"
          name="maxInputBytes"
          required
          type="number"
        />
      </label>
      <label>
        <span>Max output tokens</span>
        <input
          defaultValue={settings.maxOutputTokens}
          min="1"
          name="maxOutputTokens"
          required
          type="number"
        />
      </label>
      <label>
        <span>Worker concurrency</span>
        <input
          defaultValue={settings.workerConcurrency}
          min="1"
          name="workerConcurrency"
          required
          type="number"
        />
      </label>
      <button type="submit">保存运行设置</button>
    </form>
  );
}

export function OperationsOverviewPanel({
  overview,
}: {
  overview: OperationsOverview;
}) {
  return (
    <section className="operations-page">
      <p className="eyebrow">Personal operations</p>
      <h1>运维概览</h1>
      <p className="operations-page__summary">
        这里是只读状态页：展示模型配置、Prompt 和术语库版本、Token 预算、
        Worker 并发以及最近失败任务。API key 密文不会进入页面数据。
      </p>

      <section className="operations-alerts" aria-label="运维告警">
        {overview.alerts.length === 0 ? (
          <article className="operations-alert operations-alert--ok">
            <span>状态正常</span>
            <div>
              <strong>没有需要处理的运维告警</strong>
              <p>当前模型配置、Prompt、术语库和后台任务状态没有降级信号。</p>
            </div>
          </article>
        ) : (
          overview.alerts.map((alert) => (
            <OperationsAlertBanner key={alert.code} alert={alert} />
          ))
        )}
      </section>

      <div className="operations-grid">
        <article className="operations-card">
          <h2>运行设置</h2>
          <dl className="operations-list">
            <div>
              <dt>Daily budget</dt>
              <dd>
                {formatMaybeNumber(
                  overview.settings.dailyTokenLimit,
                  "tokens/day",
                )}
              </dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{overview.settings.budgetTimeZone}</dd>
            </div>
            <div>
              <dt>Request timeout</dt>
              <dd>{formatNumber(overview.settings.requestTimeoutMs)} ms</dd>
            </div>
            <div>
              <dt>Max input</dt>
              <dd>{formatNumber(overview.settings.maxInputBytes)} bytes</dd>
            </div>
            <div>
              <dt>Max output</dt>
              <dd>{formatNumber(overview.settings.maxOutputTokens)} tokens</dd>
            </div>
            <div>
              <dt>Worker concurrency</dt>
              <dd>{formatNumber(overview.settings.workerConcurrency)}</dd>
            </div>
          </dl>
          <RuntimeSettingsForm settings={overview.settings} />
        </article>

        <article className="operations-card">
          <h2>版本状态</h2>
          <div className="operations-version">
            <strong>
              {overview.activePrompt
                ? `Prompt v${overview.activePrompt.version}`
                : "未启用 Prompt"}
            </strong>
            {overview.activePrompt ? (
              <span>{formatDate(overview.activePrompt.createdAt)}</span>
            ) : null}
          </div>
          <div className="operations-version">
            <strong>
              {overview.activeGlossary
                ? `术语库 v${overview.activeGlossary.version}`
                : "未启用术语库"}
            </strong>
            {overview.activeGlossary ? (
              <>
                <span>{formatNumber(overview.activeGlossary.termCount)} terms</span>
                <span>{formatDate(overview.activeGlossary.createdAt)}</span>
              </>
            ) : null}
          </div>
        </article>
      </div>

      <section className="operations-section" aria-labelledby="providers-title">
        <h2 id="providers-title">模型供应商</h2>
        <div className="operations-grid operations-grid--providers">
          {overview.providers.length === 0 ? (
            <p className="operations-empty">尚未配置模型供应商。</p>
          ) : (
            overview.providers.map((provider) => (
              <ProviderCard key={provider.provider} provider={provider} />
            ))
          )}
        </div>
      </section>

      <section className="operations-section" aria-labelledby="jobs-title">
        <h2 id="jobs-title">后台任务</h2>
        {overview.jobs.byQueueStatus.length === 0 ? (
          <p className="operations-empty">当前没有后台任务记录。</p>
        ) : (
          <div className="operations-metrics">
            {overview.jobs.byQueueStatus.map((item) => (
              <JobCountCard
                key={`${item.queue}:${item.status}`}
                item={item}
              />
            ))}
          </div>
        )}
      </section>

      <section className="operations-section" aria-labelledby="failures-title">
        <h2 id="failures-title">最近失败</h2>
        {overview.jobs.recentFailures.length === 0 ? (
          <p className="operations-empty">没有失败任务。</p>
        ) : (
          <ul className="operations-failures">
            {overview.jobs.recentFailures.map((failure) => (
              <RecentFailure key={failure.id} failure={failure} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
