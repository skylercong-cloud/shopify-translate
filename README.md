# Shopify.dev 中文阅读代理

面向个人使用的 Shopify 开发文档中文阅读工具。当前已完成单用户访问控制、Shopify.dev 英文文档采集、受保护的后台 AI 翻译流水线、独立的中文阅读界面，以及缓存文档的中英文统一搜索。

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

## 阅读界面

- 登录后访问本地 `/docs/**` 路由，例如 `/docs/apps/build`，即可打开对应 Shopify.dev 文档的专注阅读页。
- 页面从 PostgreSQL 读取已采集的英文 source blocks 和当前翻译 revision；访问阅读页不会实时调用 AI。
- 默认显示中文翻译。点击 `English` 可在同一 URL 下切换英文原文，点击 `中文` 可切回中文；切换不会改变文档 URL。
- 代码块始终显示 Shopify 源内容，不参与中文改写；页面顶部提供官方来源链接、翻译数量和翻译状态提示。
- 未缓存的 `/docs/**` 页面会自动创建高优先级采集任务。后台 worker 拉取内容并为新块排队翻译后，刷新该路径即可读取缓存结果。

## 统一搜索

- 登录后可在首页或 `/search?q=...` 搜索已缓存页面。
- 搜索覆盖当前页面版本的标题、路径、英文 source blocks、中文翻译 revision，以及代码/API identifier。
- 中文译文、英文原文和精确 identifier 查询会返回同一个 `/docs/**` 阅读页；搜索结果显示命中类型和对应摘要。
- 搜索只读取 PostgreSQL 中的缓存内容，不访问 Shopify.dev，也不会触发 AI 翻译。未缓存页面仍通过直接访问 `/docs/**` 路径排队采集。

## 运维概览

- 登录后访问 `/admin` 可查看只读运维概览。
- 页面展示模型供应商、模型 ID、API key hint、启用状态、Prompt/术语库版本、Token 预算、Worker 并发、后台任务计数和最近失败任务。
- 页面顶部会根据当前状态显示降级告警，包括没有启用模型供应商、缺少 active Prompt、缺少 active 术语库和后台失败任务。
- 页面可更新 DeepSeek/Qwen 的 Base URL、模型 ID、启用状态，并通过密码输入框替换 API key。
- 页面可更新每日 Token 预算、请求超时、最大输入字节数、最大输出 Token 和 Worker 并发。
- 页面可用每行一个术语的文本框激活新的术语库快照；术语会按可打印 ASCII 和重复项规则校验。
- 运维概览不会返回或渲染 API key 明文，也不会返回数据库中的加密密文；已配置密钥只显示 `keyHint`。

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

当前翻译后台已支持 DeepSeek 主用、Qwen 备用、专业术语保护、预算限额、人工修正、后台重译和本地自动化验证。独立中文阅读界面、中英文切换、官方来源链接、未缓存页面按需采集、缓存文档的中英文统一搜索、带降级告警的运维概览、网页端 provider 设置、网页端运行参数设置，以及网页端术语库快照激活均已接入。
