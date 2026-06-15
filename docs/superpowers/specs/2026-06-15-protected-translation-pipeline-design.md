# 受保护翻译管线与模型故障切换设计

日期：2026-06-15  
状态：已实现并通过本地自动化验证
阶段：Phase 3

## 1. 目标

Phase 3 在已完成的英文原文采集层之上，建立可审计、可限额、可恢复的简体中文
翻译管线。系统以 DeepSeek 为主供应商、阿里云百炼 Qwen 为备用供应商，对单个
可翻译内容块执行翻译，并确保专业术语、代码标识符、URL、路径、命令、参数、
配置键、返回字段和数字保持英文原文。

翻译结果持久化到 PostgreSQL。后续访问直接读取数据库，不会在每次访问时重新
调用模型。

## 2. 范围

### 2.1 本阶段包含

- DeepSeek 主供应商和 Qwen 备用供应商。
- OpenAI Chat Completions 兼容接口适配。
- API Key 加密存储与 CLI 配置。
- 模型 ID、Base URL、Prompt、术语库和每日 Token 上限的 CLI 管理。
- Prompt 与术语库不可变版本。
- 单内容块翻译和相邻块只读上下文。
- 受保护内容提取、占位、恢复和严格校验。
- 内容指纹级翻译记忆。
- 块级和全局人工校正及历史记录。
- 每日 Token 预留、结算、暂停和北京时间重置。
- DeepSeek 重试、Qwen 切换、错误分类和调用审计。
- 独立 Translation Worker，仅消费 `translation` 队列。
- CLI 主动批量重译。

### 2.2 本阶段不包含

- 模型、Prompt、术语或译文的 Web 管理页面。
- 中文阅读页面和语言切换。
- 中英文统一搜索和搜索索引。
- 自动将 Prompt 或术语库变更扩散到全部已有译文。
- 内容块自动拆分、截断或整页翻译。
- 本地模型或第三个模型供应商。
- 真实供应商 API 的自动化测试。

## 3. 总体架构

Phase 3 继续使用 TypeScript 模块化单体，并增加独立翻译进程：

```text
PostgreSQL translation jobs
          |
          v
Translation Worker
          |
          v
Translation Service
  |-- configuration and readiness
  |-- manual correction and memory lookup
  |-- protected-content masking
  |-- Token budget reservation
  |-- provider routing and retries
  |-- response validation and restoration
  `-- persistence and audit
          |
          +--> DeepSeek Provider Adapter
          `--> Qwen Provider Adapter
```

两家供应商共用同一翻译流程。Provider Adapter 只负责发送请求、解析兼容响应并
把 HTTP 或网络错误转换为统一错误类型，不复制预算、保护、校验或持久化逻辑。

Translation Worker 与现有 Ingestion Worker 分开运行。前者只领取
`queue = 'translation'` 的任务，后者继续只领取 `queue = 'ingestion'`。

## 4. 供应商配置

### 4.1 默认地址

- DeepSeek：`https://api.deepseek.com`
- Qwen 北京地域：
  `https://dashscope.aliyuncs.com/compatible-mode/v1`

两者均通过 OpenAI Chat Completions 兼容接口调用
`POST <base_url>/chat/completions`。CLI 允许覆盖 Base URL，但不提供默认模型
ID。模型 ID 必须显式配置，避免系统自动追随供应商的最新模型别名。

### 4.2 启动要求

Translation Worker 启动前必须满足：

- `MODEL_KEY_ENCRYPTION_KEY` 有效。
- DeepSeek API Key、模型 ID 和 Base URL 完整。
- 已设置每日 Token 上限。
- 已激活 Prompt 版本。
- 已激活术语库版本；术语列表可以为空。

Qwen 可以暂未配置。Qwen 缺失时，DeepSeek 临时失败或校验失败会保留英文并将
任务延迟重试。

### 4.3 API Key 加密

`MODEL_KEY_ENCRYPTION_KEY` 由服务器环境变量注入，必须是 Base64 编码的
32 字节随机密钥。数据库不保存主密钥。

API Key 使用 AES-256-GCM 加密：

- 每次写入生成 12 字节随机 IV。
- Provider 名称作为附加认证数据。
- 保存版本号、IV、密文和认证标签。
- 单独保存末尾 4 个字符作为非敏感 `key_hint`。
- CLI 只显示“已配置”和 `key_hint`，绝不解密回显完整 Key。

加密信封必须带版本，以便未来轮换算法。解密失败视为配置错误，日志不得包含
密文、明文 Key 或主密钥。

## 5. 配置 CLI

CLI 延续现有 `tsx` 命令模式，至少提供：

```text
pnpm model provider configure <deepseek|qwen> --model <id> [--base-url <url>]
pnpm model provider set-key <deepseek|qwen>
pnpm model provider status

pnpm model budget set --daily-tokens <positive-integer>
pnpm model budget status

pnpm model prompt create --system-file <path> --translation-file <path>
pnpm model prompt list
pnpm model prompt activate <version-id>

pnpm model glossary init
pnpm model glossary add <term>
pnpm model glossary remove <term>
pnpm model glossary import <file>
pnpm model glossary list

pnpm model correction set --block-id <uuid> [--scope <global|block>]
pnpm model correction history --block-id <uuid>

pnpm model retranslate --page-id <uuid>
pnpm model retranslate --prompt-version <uuid>
pnpm model retranslate --glossary-version <uuid>
```

`set-key` 和 `correction set` 默认使用隐藏的交互输入，也可读取明确指定的本地
文件。秘密值不得作为普通命令行参数，以免进入 shell 历史。

人工校正默认 `scope = global`，按英文内容指纹复用；显式指定 `block` 时只对
当前内容块生效。

## 6. Prompt 与术语库版本

### 6.1 Prompt

一个 Prompt 版本包含：

- System Prompt。
- 翻译指令模板。
- 创建时间和内容指纹。
- 是否为当前激活版本。

版本一经创建不可原地修改。激活新版本不会自动重译已有内容。之后首次处理的新
内容使用新版本；需要重译时由 CLI 明确选定范围并重新入队。

模型必须返回单一 JSON 对象：

```json
{
  "translated_text": "..."
}
```

不接受 Markdown 代码围栏、解释文字、多个候选译文或额外字段。

### 6.2 术语库

术语库采用不可变快照版本。每次增加、删除或导入术语都会创建新版本，并把它
设为当前版本。

匹配规则：

- 英文匹配不区分大小写。
- 要求 Unicode 单词边界，避免命中较长 identifier 的内部片段。
- 多个术语重叠时优先最长匹配，再按起始位置稳定排序。
- 恢复时保留源文本中的原始大小写和字符，不替换成术语库录入形式。
- Phase 3 不允许正则表达式术语，降低误匹配和 ReDoS 风险。

## 7. 受保护内容

### 7.1 保护来源

保护器合并以下来源：

1. 采集阶段已记录的 `protectedTokens`。
2. 当前术语库匹配。
3. URL、电子邮件、文件路径和命令片段。
4. API 名称、GraphQL type/field/mutation、Liquid object/filter/tag。
5. camelCase、PascalCase、snake_case、常见 kebab-case identifier。
6. 参数名、配置键、返回字段和数值字面量。

代码块本身为 `translatable = false`，不会创建翻译调用。

### 7.2 占位符

每个不重叠的保护区间替换为顺序占位符：

```text
⟦P0001⟧
⟦P0002⟧
```

显式采集 Token 的优先级最高，其次为最长术语匹配，最后为自动识别规则。重叠
区间只保留高优先级项目。

响应必须满足：

- 每个占位符恰好出现一次。
- 不得出现未知占位符。
- 占位符顺序必须与源文本一致。
- 恢复后的每个保护值与英文源文本逐字一致。

任一条件失败即为校验错误，译文不得发布。

## 8. 翻译请求

每个可翻译内容块单独调用模型。请求包含：

- 已占位的当前块文本。
- 块类型和标题层级。
- 页面标题。
- 前后各一个必要相邻块作为只读上下文。
- 当前 Prompt 版本和术语版本标识。
- 禁止补充、删减、解释或翻译占位符的规则。

相邻上下文也执行占位保护，并在结构中明确标记为只读。模型只能返回当前块的
`translated_text`。

若预计请求超过应用配置的模型输入限制，或块本身超过供应商请求限制：

- 不拆分。
- 不截断。
- 不调用模型。
- 状态设为 `oversized`，阅读端后续回退英文，等待人工处理。

## 9. 翻译记忆与人工校正

查找顺序固定为：

1. 当前块的最新块级人工校正。
2. 当前英文内容指纹的最新全局人工校正。
3. 相同内容指纹、目标语言、Prompt 版本和术语版本的 AI 翻译记忆。
4. 调用模型。

命中前三项时不调用模型，也不消耗 Token。

Prompt 或术语版本变化后，新内容不会命中过去版本的 AI 记忆；旧译文仍保留，
除非 CLI 主动重新入队。人工校正不受 Prompt 和术语版本限制。

英文原文变化会产生新的内容块和内容指纹。旧人工校正继续保留在历史记录中，
但不会直接应用到新文本。若变化块的上一版本存在人工校正，新块翻译成功后状态
为 `review_required`，并关联旧校正供 Phase 5 审核。

## 10. 状态模型

当前内容块翻译状态：

- `pending`：等待翻译。
- `ai_translated`：AI 译文通过全部校验。
- `manually_corrected`：命中或写入人工校正。
- `review_required`：原文变化，已有历史人工校正，新译文待复核。
- `failed`：模型、网络或校验失败，当前回退英文。
- `oversized`：块或请求超限，未调用模型。

状态更新必须与译文版本写入处于同一数据库事务。失败不得覆盖已存在的有效译文
或人工校正。

## 11. Provider 路由与故障切换

### 11.1 DeepSeek

DeepSeek 是主供应商。

- 网络错误、超时、HTTP `408`、`429` 和 `5xx`：首次调用后最多重试 2 次，
  即最多 3 次 DeepSeek 调用。
- 重试使用短指数退避并加入抖动。
- DeepSeek 临时错误耗尽后，如 Qwen 已配置则切换 Qwen。
- DeepSeek 返回结构或保护校验失败时，不重试 DeepSeek，立即切换 Qwen。
- API Key 无效、模型 ID 不存在、Base URL 错误或确定性的请求配置错误：
  立即终止当前任务，不切换 Qwen，不进行无意义重试。

### 11.2 Qwen

Qwen 作为备用供应商，每次故障切换只调用一次：

- 结果通过校验则保存。
- 结果校验失败则标记 `failed`，保留英文并延迟任务重试。
- 网络、限流或服务端错误同样返回任务级延迟重试。
- Qwen 未配置时，任何需要故障切换的情况直接进入任务级延迟重试。
- Qwen 自身配置错误会明确记录，但不会回切 DeepSeek。

### 11.3 任务级重试

两家供应商都未成功时，Translation Worker 使用持久化任务队列的分钟级退避。
重试不会删除旧译文。达到任务最大失败次数后，任务为终止失败，块状态保持
`failed`，可由 CLI 重新入队。

## 12. 每日 Token 预算

### 12.1 核算规则

- DeepSeek 和 Qwen 共用一个每日 Token 上限。
- 输入和输出 Token 全部计入。
- 成功、失败或校验未通过的调用，只要供应商返回用量就按实际用量计入。
- 供应商未返回用量时，按调用前预留量全额计入。
- 统计日按 `Asia/Shanghai` 的自然日划分，在北京时间 00:00 重置。

### 12.2 原子预留

每次调用前使用严格上界计算预留量：序列化请求的 UTF-8 字节数作为输入 Token
上界，再加上请求中显式设置的最大输出 Token。翻译请求关闭推理模式，Provider
不得生成超过该最大值的输出。随后在数据库事务中锁定当天预算行：

```text
consumed_tokens + reserved_tokens + requested_reservation <= daily_limit
```

满足条件才创建预留并发送请求。并发 Worker 因行锁和条件更新不能共同突破上限。
若 Provider 报告的实际用量异常超过预留上界，该 Provider 配置立即停用并报告
协议错误，避免继续产生不可控调用。

调用完成后：

- `reserved_tokens` 减去预留量。
- `consumed_tokens` 增加实际 Token。
- 实际用量小于预留时释放差额。
- 实际用量大于预留时记入真实值；后续调用暂停。

预留记录具有 `reserved`、`request_started`、`settled` 状态。Worker 崩溃后：

- 未开始请求的过期预留释放。
- 已开始请求但未结算的过期预留按全额预留量计入，采用费用安全优先策略。

### 12.3 额度耗尽

Translation Worker 在领取新任务前检查预算。额度耗尽时不领取任务，休眠至下一
个北京时间 00:00 后自动继续。

若任务已领取后因精确预留不足而无法调用，任务无失败计数地延迟到下一重置时间，
避免额度暂停耗尽任务重试次数。

## 13. 数据模型

新增表的职责如下。

### 13.1 配置

- `model_provider_configs`
  - Provider、Base URL、显式模型 ID。
  - 加密 API Key 信封和 `key_hint`。
  - 配置更新时间。
- `translation_settings`
  - 单例每日 Token 上限。
  - 固定预算时区 `Asia/Shanghai`。
  - 可配置请求超时、模型输入上限和 Worker 并发。
- `prompt_versions`
  - 不可变 System Prompt、翻译模板、内容指纹和激活状态。
- `glossary_versions`
  - 不可变术语快照版本和激活状态。
- `glossary_terms`
  - 所属术语版本及英文术语。

### 13.2 译文与修订

- `block_translations`
  - 每个内容块一行当前状态。
  - 当前译文修订指针。
  - 源内容指纹和待复核来源。
- `translation_revisions`
  - 不可变译文历史。
  - 来源：AI、AI 记忆、全局人工、块级人工。
  - Provider、模型、Prompt 和术语版本引用。
- `translation_corrections`
  - 人工校正历史。
  - `global` 校正按内容指纹生效。
  - `block` 校正绑定具体内容块。

### 13.3 预算与审计

- `translation_usage_days`
  - 上海日期、上限、已消费和已预留 Token。
- `token_reservations`
  - 任务、Provider、预留量、状态、过期时间和结算量。
- `model_calls`
  - 任务、块、Provider、模型、Prompt/术语版本。
  - 调用序号、状态、HTTP 状态、Token、延迟和稳定错误码。
  - 请求与响应内容哈希，不默认保存完整 Prompt 或模型正文。

人工校正和调用审计使用限制删除或 `SET NULL`，不能因清理任务、内容版本或
Provider 配置而误删。

## 14. Worker 流程

Translation Worker 对每个 `translate_block` 任务：

1. 验证 DeepSeek、预算、Prompt 和术语配置。
2. 加载内容块、页面标题、标题路径和相邻上下文。
3. 若块不可翻译则终止为成功，不调用模型。
4. 查找块级人工校正、全局人工校正和 AI 翻译记忆。
5. 提取受保护内容并生成占位文本。
6. 检查块和请求大小。
7. 预留 DeepSeek Token，执行主供应商策略并结算每次调用。
8. 必要时独立预留 Qwen Token 并执行一次备用调用。
9. 验证 JSON、占位符、恢复结果和基本结构。
10. 在事务中保存译文修订、当前状态和翻译记忆。
11. 完成任务；失败时保留英文或旧译文并按错误类别重试或终止。

Worker 复用现有租约、续租和崩溃恢复机制，但只能领取 `translation` 队列。

## 15. 安全

- API Key、主密钥和解密后的秘密不得写入日志、错误消息或模型调用审计。
- Base URL 必须为 HTTPS；测试仅允许显式注入的本地 HTTP Fixture。
- Provider 响应设置最大字节数和超时。
- 模型返回永远视为不可信输入，必须经过 JSON 和内容校验。
- CLI 写秘密时使用隐藏输入，禁止普通 `--api-key` 参数。
- Prompt 和术语文本不是秘密，但必须保留版本和操作者时间线。
- 模型调用不携带密码、Cookie、数据库连接串或其他应用秘密。

## 16. 测试

### 16.1 单元测试

- AES-GCM 加密、认证失败和 Key 格式校验。
- 术语最长优先、大小写保持和单词边界。
- identifier、URL、路径、数字及重叠 Token 保护。
- 占位符缺失、重复、乱序和未知值拒绝。
- Provider HTTP/网络错误分类。
- DeepSeek 重试和直接切换规则。
- Token 日期、预留、结算和过期预留处理。
- 翻译记忆和人工校正查找优先级。

### 16.2 集成测试

- CLI 配置加密 Key、模型 ID、预算、Prompt 和空术语版本。
- Translation Worker 缺少必要配置时拒绝启动。
- 首次翻译保存译文、修订、记忆和调用审计。
- 相同指纹和相同 Prompt/术语版本不重复调用模型。
- 块级校正优先于全局校正，全局校正优先于 AI 记忆。
- 原文变化后状态为 `review_required`，旧校正历史保留。
- DeepSeek 临时错误重试两次后切换 Qwen。
- DeepSeek 校验错误立即切换 Qwen。
- DeepSeek 配置错误不切换 Qwen。
- Qwen 未配置或失败时保留英文并延迟重试。
- 并发预留不能突破每日额度。
- 北京时间跨日后暂停任务自动恢复。

Provider 测试全部通过本地 Fixture HTTP 服务器映射，不访问真实 DeepSeek 或
阿里云。

## 17. 验收标准

- 代码块不进入翻译模型。
- 术语、URL、identifier、路径、命令、参数、配置键、字段和数字逐字不变。
- 有效人工校正或翻译记忆命中时不调用模型。
- DeepSeek 临时失败最多重试 2 次后按规则切换 Qwen。
- DeepSeek 校验失败立即切换 Qwen。
- DeepSeek 配置错误立即终止且不切换。
- Qwen 失败时仍可读取英文或已有有效译文。
- 每个调用记录 Provider、模型、版本、Token、延迟和状态。
- 多 Worker 并发不能突破北京时间每日 Token 上限。
- API Key 不进入 Git、日志或明文数据库字段。
- Prompt 和术语更新不自动重译旧内容，CLI 可主动批量重译。
- 人工校正默认按内容指纹全局复用，也可限定当前块。

## 18. 官方兼容接口参考

- DeepSeek API 文档：
  <https://api-docs.deepseek.com/>
- 阿里云百炼 OpenAI Chat 兼容接口：
  <https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope>
