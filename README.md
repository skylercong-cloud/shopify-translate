# Shopify.dev 中文阅读代理

面向个人使用的 Shopify 开发文档中文阅读工具。当前已完成单用户访问控制、Shopify.dev 英文文档采集，以及受保护的后台 AI 翻译流水线。

## 本地环境

- Node.js `20.19+`
- Corepack
- PostgreSQL 16，或 Docker Desktop

## 启动步骤

1. 复制环境变量示例：

   ```powershell
   Copy-Item .env.example .env
   ```

2. 启动 PostgreSQL：

   ```powershell
   docker compose up -d db
   ```

3. 安装依赖并执行迁移：

   ```powershell
   corepack pnpm install
   corepack pnpm db:migrate
   ```

4. 设置单用户登录密码：

   ```powershell
   corepack pnpm admin set-password
   ```

5. 启动应用：

   ```powershell
   corepack pnpm dev
   ```

6. 在另一个终端启动持久化采集 Worker：

   ```powershell
   corepack pnpm worker
   ```

7. 配置模型后，启动持久化翻译 Worker：
   ```powershell
   corepack pnpm translation-worker
   ```

默认访问地址为 `http://127.0.0.1:3000`。密码哈希保存在 PostgreSQL 中；浏览器只保存 HttpOnly 会话 cookie，数据库仅保存会话 token 的 SHA-256 哈希。

## 内容采集

- 采集范围为 `https://shopify.dev/docs` 和 `/docs/**`，包括 `/docs/api/**`，不包括 Changelog。
- Worker 每日刷新 Robots、Sitemap 和已收录页面，仅在内容变化时创建新版本和待翻译任务。
- 页面优先请求 Shopify.dev 的 `.txt` 表示；不可用时回退到 HTML。
- 翻译由后台 worker 按需处理并写入 PostgreSQL；用户访问页面时读取数据库，不实时调用 AI。
- 自动化测试全部使用本地 Fixture HTTP 服务，不会抓取公开 Shopify.dev。

采集参数通过环境变量配置：

| 环境变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `SOURCE_REQUEST_CONCURRENCY` | `2` | 最大并发源站请求数，范围 `1..4` |
| `SOURCE_REQUEST_INTERVAL_MS` | `500` | 两次请求启动之间的最小间隔 |
| `SOURCE_TIMEOUT_MS` | `20000` | 单次请求超时 |
| `SOURCE_MAX_RESPONSE_BYTES` | `8388608` | 单个响应最大字节数 |
| `INGESTION_POLL_INTERVAL_MS` | `1000` | Worker 空闲轮询间隔 |
| `INGESTION_LEASE_MS` | `120000` | 任务租约；必须至少为请求超时的两倍 |

开发时可使用自动重载：

```powershell
corepack pnpm worker:dev
```

只读查看最近任务状态：

```sql
select
  queue,
  type,
  status,
  attempts,
  run_at,
  last_error_code,
  left(last_error_message, 200) as last_error
from jobs
where status in ('queued', 'running', 'failed')
order by created_at desc
limit 100;
```

## 验证

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test

$env:NODE_ENV="test"
$env:DATABASE_URL="postgres://app:app@127.0.0.1:5432/shopify_docs_test"
$env:APP_ORIGIN="http://127.0.0.1:3000"
$env:SESSION_DAYS="30"
corepack pnpm db:migrate
corepack pnpm test:integration

$env:E2E_ADMIN_PASSWORD="phase-one-test-password"
corepack pnpm test:e2e:seed
corepack pnpm test:e2e
corepack pnpm build
```

首次运行 E2E 前安装 Chromium：

```powershell
corepack pnpm exec playwright install chromium
```

## 健康检查

- `GET /api/health/live`：应用进程存活
- `GET /api/health/ready`：应用和 PostgreSQL 均可用

## 翻译运维

模型供应商、每日预算、Prompt、术语库、人工修正、重译、密钥轮换和备份流程见 [翻译运维手册](docs/translation-operations.md)。

## 当前范围

当前翻译后台已支持 DeepSeek 主用、Qwen 备用、专业术语保护、预算限额、人工修正、后台重译和本地自动化验证。独立中文阅读界面、中英文切换和统一搜索将在后续阶段接入。
