# Shopify.dev 中文阅读代理

面向个人使用的 Shopify 开发文档中文阅读工具。当前 Phase 1 已完成单用户密码登录、安全会话、受保护阅读界面、健康检查与自动化测试基础。

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

默认访问地址为 `http://127.0.0.1:3000`。密码哈希保存在 PostgreSQL 中；浏览器只保存 HttpOnly 会话 cookie，数据库仅保存会话 token 的 SHA-256 哈希。

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

## 当前范围

Phase 1 尚未包含 Shopify.dev 内容抓取、AI 翻译、术语保护、中英文统一搜索、管理后台、每日增量更新、备份和生产部署。这些能力将在后续阶段接入。
