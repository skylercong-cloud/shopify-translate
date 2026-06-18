# 翻译运维手册

本文档面向私人服务器上的单用户部署。模型翻译由后台 `translation-worker` 执行并写入 PostgreSQL；用户访问页面时只读取数据库中的译文，不会按访问实时调用模型。

## 执行顺序

1. 生成 32 字节 base64 主加密密钥：

   ```powershell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
   ```

2. 设置 `MODEL_KEY_ENCRYPTION_KEY`，不要打印到日志，也不要提交到 Git：

   ```text
   MODEL_KEY_ENCRYPTION_KEY=<32-byte-base64-key>
   ```

3. 配置 DeepSeek 和可选 Qwen。API Key 通过隐藏输入录入：

   ```powershell
   corepack pnpm model provider set deepseek --model deepseek-chat
   corepack pnpm model provider set qwen --model qwen-plus
   ```

   官方默认地址：

   ```text
   DeepSeek: https://api.deepseek.com
   Qwen Beijing: https://dashscope.aliyuncs.com/compatible-mode/v1
   ```

   模型 ID 是显式配置，系统不会推断、补全或跟随供应商别名。

4. 设置 DeepSeek 和 Qwen 共用的每日 token 上限：

   ```powershell
   corepack pnpm model budget set --daily-tokens 500000
   ```

5. 激活 Prompt 和术语库。用户 Prompt 模板必须包含 `{{sourceText}}`：

   ```powershell
   corepack pnpm model prompt activate --system-file .\ops\system-prompt.txt --user-file .\ops\user-prompt.txt
   corepack pnpm model glossary activate --file .\ops\glossary.txt
   ```

6. 检查翻译就绪状态：

   ```powershell
   corepack pnpm model readiness
   ```

7. 启动采集和翻译 worker：

   ```powershell
   corepack pnpm worker
   corepack pnpm translation-worker
   ```

8. 查看 provider 配置，不暴露密钥：

   ```powershell
   corepack pnpm model provider list
   ```

9. 添加和查看人工修正：

   ```powershell
   corepack pnpm model correction add --block-id <uuid> --file .\ops\correction.txt --scope global
   corepack pnpm model correction add --block-id <uuid> --file .\ops\correction.txt --scope block
   corepack pnpm model correction history --block-id <uuid>
   ```

10. 入队重译：

    ```powershell
    corepack pnpm model retranslate --block-id <uuid>
    corepack pnpm model retranslate --page /docs/apps/build
    corepack pnpm model retranslate --all --confirm-all
    ```

11. 轮换单个供应商 API Key：

    ```powershell
    corepack pnpm model provider set deepseek --model deepseek-chat
    ```

12. 轮换主加密密钥。先保留当前 `MODEL_KEY_ENCRYPTION_KEY`，生成新密钥，再运行：

    ```powershell
    corepack pnpm model key rotate
    ```

    命令会在一个事务里锁定 provider 配置行，使用旧主密钥解密，再用新主密钥重新加密所有 provider API Key，只打印轮换数量。成功后再把服务器环境变量更新为新密钥并重启 worker。

13. 非正常退出后 reconcile 陈旧 token reservations：

    重新启动 `translation-worker`。启动时会释放尚未发起请求的陈旧预留，并按完整预留量结算长期未完成的已开始请求。阈值由 `TRANSLATION_STALE_RESERVATION_MS` 和 `TRANSLATION_STALE_REQUEST_MS` 控制。

14. 检查数据库写入健康：

    `/admin` 会通过事务内临时表写入探测数据库写入能力。如果该探测失败，会显示 `database_writes_unavailable` critical 告警。`translation-worker` 在调用模型和预留 token 前也会执行同一类检查；写入不可用时，本轮翻译返回可重试失败，不会调用 DeepSeek/Qwen。

15. 诊断异常状态：

    ```sql
    select status, last_error_code, left(last_error_message, 200) as last_error, updated_at
    from block_translations
    where status in ('failed', 'review_required', 'oversized')
    order by updated_at desc
    limit 100;
    ```

    `failed` 通常是 provider 配置、认证、协议或重试耗尽问题。`review_required` 表示英文源文在人工修正后变化，需要人工确认。`oversized` 表示请求超过 `maxInputBytes` 或严格预算估算超过每日上限。

16. 每日备份 PostgreSQL，并保留 14 天：

    ```powershell
    $env:BACKUP_DIR = ".\backups"
    $env:BACKUP_RETENTION_DAYS = "14"
    corepack pnpm backup
    ```

    命令会读取当前 `DATABASE_URL`，调用 `pg_dump -Fc` 生成
    `shopify-docs-YYYYMMDD-HHmmss.dump`，写入同名 `.sha256` 校验文件，
    并且只删除超过保留期的 `shopify-docs-*.dump` 与
    `shopify-docs-*.dump.sha256` 文件。`BACKUP_DIR` 默认是 `backups`，
    `BACKUP_RETENTION_DAYS` 默认是 `14`。

17. 验证备份可以恢复到临时数据库：

    ```powershell
    $env:BACKUP_DUMP_PATH = ".\backups\shopify-docs-20260618-072000.dump"
    corepack pnpm backup:verify
    ```

    命令默认读取 `${BACKUP_DUMP_PATH}.sha256`，也可以通过
    `BACKUP_CHECKSUM_PATH` 指定校验文件。验证过程会创建
    `shopify_docs_restore_verify_*` 临时数据库，执行 `pg_restore`，
    运行探测查询，然后删除该临时数据库；不会覆盖当前生产数据库。
    如需自定义临时库名前缀，可设置 `RESTORE_VERIFY_DATABASE_PREFIX`。

建议在服务器上用 cron 或系统计划任务每天执行一次 `corepack pnpm backup`，并定期运行 `corepack pnpm backup:verify` 抽查最新备份。备份目录仍建议同步到对象存储或另一台服务器。

## 常用 SQL

查看翻译队列：

```sql
select status, type, attempts, run_at, last_error_code
from jobs
where queue = 'translation'
order by created_at desc
limit 100;
```

查看每日预算：

```sql
select usage_date, token_limit, reserved_tokens, charged_tokens
from translation_usage_days
order by usage_date desc
limit 14;
```

查看模型审计：

```sql
select provider, model_id, status, error_code, input_tokens, output_tokens, created_at
from model_calls
order by created_at desc
limit 100;
```
