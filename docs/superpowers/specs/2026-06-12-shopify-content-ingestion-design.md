# Shopify.dev 内容发现与版本化采集设计

日期：2026-06-12  
状态：设计已确认，等待书面规格审核  
阶段：Phase 2

## 1. 目标

Phase 2 为个人 Shopify.dev 中文阅读工具建立可靠的英文原文采集层。系统从
Shopify 官方 Sitemap 发现公开文档，安全地抓取 `/docs/**` 页面，将内容解析为
稳定的结构化区块，并在 PostgreSQL 中保存可追溯的页面版本。

本阶段不调用 AI 模型。它只为新增或发生变化的可翻译区块创建待翻译任务，供
Phase 3 的 DeepSeek/Qwen 翻译 Worker 消费。

## 2. 范围

### 2.1 本阶段包含

- `https://shopify.dev/docs` 与 `https://shopify.dev/docs/**`。
- 位于 `/docs/api/**` 下的 API Reference。
- Shopify 官方 Sitemap 的递归发现和每日重新发现。
- URL 规范化、范围白名单、Robots 规则和重定向检查。
- `.txt` 优先、HTML 后备的页面获取。
- 标题、正文、列表、表格、提示、代码和图片的结构化解析。
- 页面级与区块级 SHA-256 内容指纹。
- 页面版本、区块、抓取记录和持久化任务。
- 新增或变化区块的待翻译任务。
- 高优先级按需抓取入口和每日后台刷新。
- 失败时保留上一成功版本。

### 2.2 本阶段不包含

- `/changelog/**`。数据模型和 URL 策略允许后续增加新的受控范围，但 Phase 2
  不发现或抓取 Changelog。
- AI 翻译、术语保护、模型切换和 Token 统计。
- 中文阅读页面和中英文切换。
- 中英文统一搜索。
- 管理后台任务界面。
- 登录区域、Partner Dashboard、社区或任何外部站点。
- 对 Shopify API Explorer 等交互工具的复刻。

## 3. 总体架构

```text
每日调度 / 按需请求
        |
        v
Sitemap Discovery
        |
        v
URL Policy + Robots Policy
        |
        v
PostgreSQL Jobs
        |
        v
Ingestion Worker
        |
        +--> Source Client (.txt first, HTML fallback)
        |
        +--> Structured Parser
        |
        +--> Fingerprint + Block Diff
        |
        v
Transactional Version Publisher
        |
        +--> Current English Version
        |
        `--> Translation Queue (not consumed until Phase 3)
```

Web 应用与 Worker 继续使用同一个 TypeScript 代码库和领域模块。Web 进程负责
认证后的请求入口，Worker 进程只领取 `ingestion` 队列。PostgreSQL 同时保存业务
数据、任务、租约和调度状态，不引入 Redis。

## 4. 模块边界

### 4.1 URL Policy

负责将输入 URL 转换为唯一规范 URL，并在任何网络请求前后执行范围检查。

允许的规范 URL 必须满足：

- 协议为 `https:`。
- 主机名严格等于 `shopify.dev`。
- 不包含用户名、密码或非默认端口。
- 路径严格等于 `/docs`，或以 `/docs/` 开头。
- 不包含查询参数或 Hash。
- 不命中当前有效 Robots 策略的禁止规则。

规范化行为：

- 主机名转为小写。
- 移除默认端口。
- 移除 `/docs/` 以外的尾部斜杠。
- 丢弃 Hash；带查询参数的候选 URL 直接拒绝，不通过静默删参改变语义。
- `.txt` 是获取格式，不是规范页面 URL，发现和存储时不得以 `.txt` 结尾。

重定向最多跟随 3 次。每一个 `Location` 都必须重新通过 URL Policy；跳转到其他
域名、其他协议或白名单外路径时立即终止。

### 4.2 Robots Policy

Worker 每日读取 `https://shopify.dev/robots.txt`，解析适用于本应用 User-Agent
及通配 User-Agent 的规则，并保存最后一次成功策略。

- 有缓存策略时，临时读取失败继续使用最近成功策略并记录降级状态。
- 从未成功读取策略时采用 fail-closed：不发现或抓取新页面。
- Robots 明确禁止的 URL 不创建抓取任务；已经存在的页面保留上一成功版本。
- Sitemap 地址优先使用 Robots 中声明的同域地址，缺失时使用
  `https://shopify.dev/sitemap.xml`。

### 4.3 Sitemap Discovery

Discovery 支持 Sitemap Index 与 URL Set，递归读取同域 Sitemap。每个 Sitemap
响应同样应用超时、大小和重定向限制。

发现流程：

1. 读取当前 Robots 策略。
2. 读取声明的 Sitemap，并递归遍历同域子 Sitemap。
3. 对每个 `<loc>` 执行 URL Policy。
4. 只保留 `/docs` 与 `/docs/**` 的唯一规范 URL。
5. Upsert 页面记录，并为需要检查的页面创建低优先级抓取任务。
6. 使用 `<lastmod>` 作为调度优先级提示，但不将其视为内容已变化的证明。

单次 Discovery 设置有界保护：Sitemap 响应不超过 8 MiB、递归深度不超过 5、
最多读取 100 个 Sitemap 文件、最多接受 200,000 个候选 URL。超限时任务失败并
保留已发布内容，不以不完整发现结果批量停用页面。

页面从 Sitemap 消失只记录 `missing_from_sitemap_at`，不会立即删除或停用。只有
页面直接请求返回 `404` 或 `410` 时才标记为 `gone`。

### 4.4 Source Client

Source Client 接受已经通过策略检查的规范 URL，并按以下顺序获取：

1. 请求 `canonicalUrl + ".txt"`。
2. `.txt` 返回成功且通过主体完整性检查时，使用纯文本/Markdown 解析器。
3. `.txt` 返回 `404/406`、Content-Type 异常、主体为空或缺少可识别主内容时，
   请求规范 URL 并使用 HTML 解析器。
4. 其他临时错误进入重试，不因一次网络故障立即切换格式掩盖问题。

默认网络限制：

- 固定 User-Agent：`ShopifyDocsPersonalReader/0.1`。
- 全局最多 2 个并发来源请求。
- 相邻请求启动时间至少间隔 500 ms。
- 单次连接和读取总超时 20 秒。
- 单个响应正文最多 8 MiB。
- 最多 3 次重定向。
- 仅接受文本、Markdown、HTML 与 XML 类型。

客户端保存并发送 `ETag` 与 `Last-Modified` 条件请求。`304 Not Modified` 只更新
页面检查时间，不进入解析和版本创建。

重试规则：

- 网络错误、超时、`429` 和 `5xx` 最多尝试 3 次。
- `429` 优先遵守有效的 `Retry-After`。
- 退避时间默认为 1 分钟、5 分钟、30 分钟，并加入小幅随机抖动。
- `401`、`403`、策略拒绝、响应超限和无效 Content-Type 不做自动重试。
- `404` 或 `410` 将页面标记为 `gone`，但不删除历史版本。

### 4.5 Structured Parser

两种输入格式都先解析为 AST，再转换为统一的 `ParsedPage`，不使用正则表达式
直接切割 HTML 或 Markdown。

```ts
type BlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "notice"
  | "code"
  | "image";

type ParsedBlock = {
  type: BlockType;
  ordinal: number;
  headingPath: string[];
  sourceText: string;
  payload: Record<string, unknown>;
  translatable: boolean;
};

type ParsedPage = {
  title: string;
  blocks: ParsedBlock[];
  sourceFormat: "text" | "html";
};
```

HTML 解析只读取主要文档区域，并移除导航、页脚、登录入口、搜索、按钮和脚本。
无法唯一识别主内容区域时解析失败，不发布猜测结果。

区块规则：

- `heading` 保存层级和文本。
- `paragraph` 保存自然语言正文及行内链接/代码的结构化标记。
- `list` 保存有序/无序类型、嵌套层级和条目。
- `table` 保存表头、行、单元格和对齐信息。
- `notice` 保存提示类别、标题和正文。
- `code` 保存语言标识和原始代码；`translatable` 永远为 `false`。
- `image` 保存 Shopify 原始地址、Alt 和 Caption，不下载图片。

行内代码、URL、文件路径和 API identifier 保留为结构化 token，Phase 3 可以在不
改变原值的前提下翻译周围自然语言。

解析结果必须至少包含一个标题或自然语言正文区块。区块数量、嵌套深度或单区块
大小超过安全上限时解析失败，并保留上一版本。

### 4.6 Fingerprint And Diff

页面和区块使用 SHA-256 指纹。指纹输入是类型化的规范 JSON，不依赖数据库 ID。

自然语言规范化：

- 换行统一为 LF。
- 去除行尾空白。
- 普通文本中的连续空白折叠为一个空格。
- 保留标点、大小写、链接目标和结构顺序。

代码规范化只统一换行，不折叠空白；存储的 `sourceText` 保留解析得到的原文。

区块差异按以下顺序计算：

1. 使用 `type + contentFingerprint` 做精确配对；重复内容按距离最近的 ordinal
   确定性配对。
2. 未配对区块使用类型、标题路径和相邻上下文进行序列对齐。
3. 精确配对但位置变化的区块标记为 `moved`，不创建翻译任务。
4. 对齐后内容变化的区块标记为 `modified`。
5. 新出现的区块标记为 `added`，未出现的旧区块标记为 `deleted`。

页面指纹由按顺序排列的区块类型与区块指纹生成。页面指纹相同则不创建新版本；
页面顺序变化会创建新版本，但只移动且内容未变的区块不会重新翻译。

### 4.7 Version Publisher

发布器在一个 PostgreSQL 事务中执行：

1. 锁定目标页面行。
2. 再次比较当前页面指纹，防止并发 Worker 重复发布。
3. 插入新的 `page_versions`。
4. 插入该版本的全部 `content_blocks` 和 `block_changes` 差异记录。
5. 为 `added`、`modified` 且可翻译的区块插入 `translation` 队列任务。
6. 更新页面标题、状态、最近成功时间和 `current_version_id`。
7. 提交事务后将抓取任务标记为成功。

任何插入、校验或任务创建失败都会回滚事务。当前版本指针只会指向完整的新版本，
用户不会看到半发布页面。

首次成功采集时，所有可翻译区块视为 `added`。`deleted`、`moved`、代码区块和
完全未变化区块不创建翻译任务。

## 5. 数据模型

### 5.1 `source_pages`

- `id`
- `canonical_url`，唯一
- `path`
- `title`
- `status`：`active | gone | blocked`
- `current_version_id`，可空
- `etag`，可空
- `last_modified`，可空
- `last_checked_at`
- `last_success_at`
- `missing_from_sitemap_at`，可空
- `created_at`
- `updated_at`

### 5.2 `page_versions`

- `id`
- `page_id`
- `version_number`，同一页面内递增且唯一
- `source_format`：`text | html`
- `content_fingerprint`
- `block_count`
- `fetched_at`
- `published_at`
- `created_at`

历史版本长期保留。相同页面指纹不会产生新记录。

### 5.3 `content_blocks`

- `id`
- `page_version_id`
- `ordinal`
- `type`
- `heading_path`，JSONB
- `source_text`
- `payload`，JSONB
- `content_fingerprint`
- `translatable`
- `created_at`

`page_version_id + ordinal` 唯一。

### 5.4 `block_changes`

- `id`
- `page_version_id`
- `kind`：`added | modified | moved | deleted`
- `previous_block_id`，可空
- `current_block_id`，可空
- `created_at`

`added` 没有 `previous_block_id`，`deleted` 没有 `current_block_id`，`modified` 和
`moved` 同时引用前后区块。完全未变化且位置也未变化的区块不需要差异记录。
该表让删除区块可以在不向新版本插入墓碑内容的情况下被准确记录。

### 5.5 `fetch_attempts`

- `id`
- `job_id`
- `page_id`，可空
- `requested_url`
- `final_url`，可空
- `source_format`，可空
- `http_status`，可空
- `result`
- `response_bytes`
- `duration_ms`
- `etag`，可空
- `last_modified`，可空
- `error_code`，可空
- `error_message`，可空且截断
- `created_at`

抓取元数据长期保留，用于诊断更新频率和失败原因。

### 5.6 `source_payloads`

- `id`
- `fetch_attempt_id`
- `content_type`
- `body`
- `expires_at`
- `created_at`

原始响应仅用于短期诊断，正文受 8 MiB 上限约束，默认保留 7 天。每日维护任务
删除过期记录。正式阅读和历史版本不依赖该表。

### 5.7 `jobs`

- `id`
- `queue`：`ingestion | translation`
- `type`：`discover_sitemap | fetch_page | translate_block | cleanup_payloads`
- `dedupe_key`
- `payload`，JSONB
- `priority`
- `status`：`queued | running | succeeded | failed`
- `attempts`
- `max_attempts`
- `run_at`
- `lease_owner`，可空
- `lease_expires_at`，可空
- `last_error_code`，可空
- `last_error_message`，可空且截断
- `created_at`
- `updated_at`
- `completed_at`，可空

活动状态的 `dedupe_key` 唯一。Phase 2 Worker 只领取 `ingestion` 队列；
`translation` 任务保留到 Phase 3。

## 6. 持久化任务与调度

Worker 使用 `SELECT ... FOR UPDATE SKIP LOCKED` 原子领取任务，并写入 2 分钟租约。
长任务定期续租；进程异常后，租约过期的任务重新回到可领取状态。

任务优先级从高到低：

1. 用户按需请求的 `fetch_page`。
2. 失败后的到期重试。
3. Sitemap 发现的新页面。
4. 每日例行变化检查。
5. 诊断 Payload 清理。

同一规范 URL 只允许一个活动抓取任务。新的高优先级请求命中已排队任务时，提升
原任务优先级并提前 `run_at`，而不是插入重复任务。正在运行的任务不被抢占。

Worker 启动时确保存在以下周期任务：

- 每 24 小时一个 `discover_sitemap`。
- 每日为所有 `active` 页面安排一次变化检查，并在 24 小时窗口内分批执行。
- 每日一个 `cleanup_payloads`。

调度使用数据库中的唯一 `dedupe_key` 保证多 Worker 启动时不会重复创建同一周期
任务，不依赖单机内存定时器的唯一性。

## 7. 按需抓取接口

领域层提供：

```ts
requestPageIngestion(url: string, priority: "normal" | "high"): Promise<{
  pageId: string | null;
  jobId: string;
  state: "already_current" | "queued" | "promoted";
}>;
```

该接口先执行 URL Policy，再查询现有页面和活动任务。Phase 2 通过集成测试验证
高优先级排队和去重；Phase 4 的阅读路由将直接调用它。当前阶段不增加公开匿名
抓取接口。

## 8. 状态与错误处理

- `304`：更新 `last_checked_at`，不解析，不创建版本。
- 内容指纹相同：更新检查时间和来源缓存头，不创建版本。
- `404/410`：页面标记为 `gone`，当前版本继续可读。
- Robots 新增禁止：页面标记为 `blocked`，不再刷新，当前版本继续保留。
- 网络或来源临时故障：按计划重试，当前版本不变。
- 解析失败：记录错误和短期原始 Payload，不发布新版本。
- 数据库事务失败：不移动当前版本指针，任务可重试。
- Worker 崩溃：租约过期后恢复任务。
- Sitemap 部分失败或超限：本次 Discovery 失败，不根据不完整结果停用页面。

错误日志和数据库消息不保存 Cookie、密码、连接密码或未来的 AI API Key。
错误正文统一截断，并为可预期错误使用稳定错误码。

## 9. 测试策略

### 9.1 单元测试

- URL 规范化、范围拒绝和每次重定向复查。
- Robots 允许/禁止与无缓存时 fail-closed。
- Sitemap Index、URL Set、重复 URL、范围过滤和上限。
- `.txt` 选择、HTML 后备、超时、大小限制和重试分类。
- Markdown 与 HTML Fixture 的统一结构化结果。
- 各区块类型的规范化和指纹稳定性。
- 插入、移动、修改、删除和重复内容的差异结果。
- 任务退避、租约过期和优先级提升。

### 9.2 集成测试

- Fixture Sitemap 只创建允许的规范页面。
- 首次抓取原子创建页面、版本、区块和待翻译任务。
- 相同内容再次抓取不创建新版本或新翻译任务。
- 只修改一个段落时，仅该区块为 `modified` 并产生一个翻译任务。
- 只移动区块时创建页面版本，但不产生翻译任务。
- 解析失败和事务失败均保留上一 `current_version_id`。
- 相同 URL 的普通任务与高优先级任务合并。
- Worker 租约过期后另一 Worker 可以重新领取。
- `404/410`、Robots 禁止和 Sitemap 消失采用各自定义的保留策略。

测试使用本地 Fixture HTTP Server，不在自动化测试中请求 Shopify.dev。

### 9.3 端到端与构建验证

Phase 2 没有新的最终阅读 UI，因此不增加依赖外部网络的浏览器流程。现有登录
E2E 必须继续通过，同时执行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm build`

## 10. 验收标准

1. Fixture Sitemap 仅产生 `https://shopify.dev/docs` 和
   `https://shopify.dev/docs/**` 的唯一规范 URL。
2. API Reference 的 `/docs/api/**` 页面进入相同采集流程。
3. Fixture 页面稳定解析标题、正文、列表、表格、提示、代码和图片。
4. 相同内容重复抓取不创建新页面版本。
5. 修改一个 Fixture 段落时，仅该区块需要翻译。
6. 移动未修改区块不会创建翻译任务。
7. 抓取、解析或发布失败不会替换上一成功版本。
8. 重复任务合并，按需任务可提升优先级，过期租约可恢复。
9. `404/410` 和 Robots 禁止不会删除历史版本。
10. 全部单元、集成、现有 E2E 和生产构建验证通过。

## 11. 后续阶段接口

Phase 3 消费 `translation` 队列，并以 `content_blocks.id`、内容指纹和结构化 Payload
作为翻译输入。Phase 4 从 `source_pages.current_version_id` 读取完整英文页面，并在
页面尚未收录或需要刷新时调用 `requestPageIngestion`。

新增 `/changelog/**` 时必须通过一个显式的 Source Scope 配置加入白名单，并为其
单独提供 Fixture 和解析规则；不得通过放宽到整个 `shopify.dev` 域名实现。

## 12. 官方来源

- Shopify.dev Robots 与纯文本页面说明：
  <https://shopify.dev/robots.txt>
- Shopify.dev Sitemap：
  <https://shopify.dev/sitemap.xml>
- Shopify Dev Docs：
  <https://shopify.dev/docs>
- Shopify API Reference 入口：
  <https://shopify.dev/docs/api>
