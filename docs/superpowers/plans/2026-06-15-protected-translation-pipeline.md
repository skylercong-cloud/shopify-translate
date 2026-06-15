# Protected Translation Pipeline Implementation Plan

> **Execution mode:** Main thread only. Follow test-driven development for every behavior change, commit each completed task, and do not call real model APIs in automated tests.

**Goal:** Add a durable protected-term translation pipeline that translates Shopify documentation blocks once, stores revisions in PostgreSQL, reuses translation memory, routes DeepSeek to Qwen on eligible failures, and enforces a strict shared daily token budget.

**Architecture:** The translation worker claims durable `translation` jobs and delegates one content block at a time to a provider-neutral `TranslationService`. The service resolves manual and AI memory first, protects code and terminology with deterministic placeholders, reserves budget atomically, calls an OpenAI-compatible provider adapter, validates and restores the response, then publishes an immutable revision. Provider configuration, encrypted API keys, prompt versions, glossary versions, corrections, usage, reservations, and call audits are stored in PostgreSQL and managed through a local CLI.

**Tech Stack:** TypeScript, Node.js native `fetch` and `crypto`, PostgreSQL 16, Drizzle ORM, Zod, Vitest, existing durable job queue and worker patterns.

---

## Non-Negotiable Invariants

1. A user request never triggers a model call. The reader always serves persisted data.
2. Each model request translates exactly one block. Neighbor blocks are read-only context.
3. Code blocks are never translated.
4. Protected tokens must return with identical count, order, placeholder text, and restored source value.
5. DeepSeek is required for worker startup. Qwen is optional and only receives eligible fallback calls.
6. Configuration and authentication errors are terminal and never trigger provider fallback.
7. Validation failures fall back immediately to Qwen when Qwen is configured.
8. Daily budget is shared across providers, input and output, and resets at midnight in `Asia/Shanghai`.
9. A model call cannot begin without a strict atomic reservation.
10. Manual corrections are immutable revisions and override AI memory.
11. Existing published translations remain readable when a later translation attempt fails.
12. Tests use local fetch fixtures only and never consume provider quota.

---

## Task 1: Add Translation Persistence Schema

**Files:**
- Create: `src/db/schema/translation-config.ts`
- Create: `src/db/schema/translation.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/unit/db/translation-schema.test.ts`
- Create: `tests/integration/translation-schema.test.ts`
- Generate: `drizzle/0002_protected_translation.sql`
- Modify: `drizzle/meta/_journal.json`
- Generate: `drizzle/meta/0002_snapshot.json`

### Step 1: Write failing schema contract tests

Create `tests/unit/db/translation-schema.test.ts` and assert that the schema exports:

```ts
expect(translationProviderEnum.enumValues).toEqual(["deepseek", "qwen"]);
expect(translationStatusEnum.enumValues).toEqual([
  "pending",
  "ai_translated",
  "manually_corrected",
  "review_required",
  "failed",
  "oversized",
]);
expect(tokenReservationStatusEnum.enumValues).toEqual([
  "reserved",
  "request_started",
  "settled",
  "released",
]);
```

Create `tests/integration/translation-schema.test.ts` and assert:

- one provider configuration per provider;
- one active prompt version at a time;
- one active glossary version at a time;
- one translation state row per content block;
- normalized glossary terms are unique within a version;
- token usage cannot become negative;
- reservation amounts are positive;
- global corrections have no `block_id`;
- block corrections require `block_id`.

Run:

```powershell
corepack pnpm test -- tests/unit/db/translation-schema.test.ts
```

Expected: FAIL because translation schema exports do not exist.

### Step 2: Implement configuration tables

Create `src/db/schema/translation-config.ts` with:

```ts
export const translationProviderEnum = pgEnum("translation_provider", [
  "deepseek",
  "qwen",
]);

export const modelProviderConfigs = pgTable("model_provider_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: translationProviderEnum("provider").notNull().unique(),
  baseUrl: text("base_url").notNull(),
  modelId: text("model_id").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  requestTimeoutMs: integer("request_timeout_ms").notNull().default(60_000),
  maxInputBytes: integer("max_input_bytes").notNull().default(1_048_576),
  maxOutputTokens: integer("max_output_tokens").notNull().default(4_096),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Add positive checks for numeric limits and base URL/model ID non-empty checks.

Add singleton `translation_settings` using a fixed boolean primary key:

```ts
{
  singleton: boolean("singleton").primaryKey().default(true),
  dailyTokenLimit: bigint("daily_token_limit", { mode: "number" }),
  createdAt,
  updatedAt,
}
```

Add a check that `singleton = true` and `daily_token_limit > 0` when present.

Add immutable version tables:

```ts
prompt_versions(id, version, system_prompt, user_prompt_template, active, created_at)
glossary_versions(id, version, active, created_at)
glossary_terms(id, glossary_version_id, source_term, normalized_term, created_at)
```

Use partial unique indexes to permit only one active prompt and glossary version. Add unique indexes on version numbers and `(glossary_version_id, normalized_term)`.

### Step 3: Implement translation, budget, and audit tables

Create `src/db/schema/translation.ts` with enums:

```ts
translation_status
translation_revision_source = ai | ai_memory | global_manual | block_manual
translation_correction_scope = global | block
token_reservation_status = reserved | request_started | settled | released
model_call_status =
  succeeded | transient_error | configuration_error | validation_error | protocol_error
```

Add:

```text
block_translations
  id uuid pk
  block_id uuid unique fk content_blocks cascade
  source_fingerprint text not null
  status translation_status not null default pending
  current_revision_id uuid nullable
  last_error_code text nullable
  last_error_message text nullable
  updated_at timestamptz

translation_revisions
  id uuid pk
  block_translation_id uuid fk cascade
  source translation_revision_source
  translated_text text
  source_fingerprint text
  provider translation_provider nullable
  model_id text nullable
  prompt_version_id uuid nullable
  glossary_version_id uuid nullable
  model_call_id uuid nullable
  created_at timestamptz

translation_corrections
  id uuid pk
  scope translation_correction_scope
  source_fingerprint text
  block_id uuid nullable
  translated_text text
  created_at timestamptz

translation_usage_days
  usage_date date pk
  token_limit bigint
  reserved_tokens bigint default 0
  charged_tokens bigint default 0
  created_at timestamptz
  updated_at timestamptz

token_reservations
  id uuid pk
  usage_date date fk translation_usage_days restrict
  job_id uuid nullable fk jobs set null
  block_id uuid nullable fk content_blocks set null
  provider translation_provider
  status token_reservation_status
  reserved_tokens bigint
  charged_tokens bigint default 0
  created_at timestamptz
  request_started_at timestamptz nullable
  settled_at timestamptz nullable

model_calls
  id uuid pk
  job_id uuid nullable fk jobs set null
  block_id uuid nullable fk content_blocks set null
  provider translation_provider
  model_id text
  status model_call_status
  request_hash text
  response_hash text nullable
  input_tokens bigint nullable
  output_tokens bigint nullable
  error_code text nullable
  error_message text nullable
  created_at timestamptz
  completed_at timestamptz nullable
```

Break circular foreign keys by defining `blockTranslations.currentRevisionId` with `AnyPgColumn`, following the existing source page/current version pattern.

Add constraints:

- usage and charged values are non-negative;
- `reserved_tokens + charged_tokens <= token_limit`;
- reservation charged amount is between zero and reserved amount;
- global correction requires `block_id IS NULL`;
- block correction requires `block_id IS NOT NULL`;
- translated text and source fingerprints are non-empty.

### Step 4: Export schema and generate migration

Modify `src/db/schema/index.ts`:

```ts
export * from "./translation-config";
export * from "./translation";
```

Generate the migration using the existing approved database environment:

```powershell
$env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'
corepack pnpm db:generate --name protected_translation
```

Inspect the SQL. Add a deterministic data migration that creates `pending` rows for existing translatable content blocks:

```sql
INSERT INTO "block_translations" ("block_id", "source_fingerprint", "status")
SELECT "id", "fingerprint", 'pending'
FROM "content_blocks"
WHERE "translatable" = true
ON CONFLICT ("block_id") DO NOTHING;
```

### Step 5: Run migration and tests

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='postgres://app:app@127.0.0.1:5432/shopify_docs_test'
$env:APP_ORIGIN='http://127.0.0.1:3000'
$env:SESSION_DAYS='30'
corepack pnpm db:migrate
corepack pnpm test -- tests/unit/db/translation-schema.test.ts
corepack pnpm test:integration -- tests/integration/translation-schema.test.ts
```

Expected: PASS.

### Step 6: Commit

```powershell
git add src/db/schema tests/unit/db/translation-schema.test.ts tests/integration/translation-schema.test.ts drizzle
git commit -m "feat: add translation persistence schema"
```

---

## Task 2: Encrypt Provider Credentials and Validate Runtime Configuration

**Files:**
- Create: `src/modules/translation/encryption.ts`
- Create: `src/modules/translation/runtime-config.ts`
- Modify: `src/config/env.ts`
- Create: `tests/unit/translation/encryption.test.ts`
- Create: `tests/unit/translation/runtime-config.test.ts`

### Step 1: Write failing encryption tests

Cover:

- a 32-byte base64 master key is accepted;
- missing, malformed, or wrong-length keys are rejected;
- encrypting the same API key twice produces different envelopes;
- both envelopes decrypt to the original value;
- altered ciphertext, IV, tag, or version fails closed;
- empty API keys are rejected.

Use an envelope with explicit versioning:

```ts
type EncryptedSecretEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
};
```

Run:

```powershell
corepack pnpm test -- tests/unit/translation/encryption.test.ts
```

Expected: FAIL.

### Step 2: Implement AES-256-GCM helpers

Create:

```ts
export function decodeMasterKey(encoded: string): Buffer;
export function encryptSecret(plaintext: string, masterKey: Buffer): string;
export function decryptSecret(envelopeJson: string, masterKey: Buffer): string;
```

Rules:

- decode strictly from base64 and require exactly 32 bytes;
- generate a fresh 12-byte IV using `randomBytes`;
- use `createCipheriv("aes-256-gcm", key, iv)`;
- serialize the envelope as compact JSON;
- parse and validate envelope fields with Zod before decryption;
- never include plaintext or encrypted values in thrown messages.

### Step 3: Add optional environment input and scoped requirement

Modify the global environment schema so web and ingestion processes may start without model credentials:

```ts
MODEL_KEY_ENCRYPTION_KEY: z.string().optional()
```

Create:

```ts
export function requireModelEncryptionKey(
  env: Pick<AppEnv, "MODEL_KEY_ENCRYPTION_KEY">,
): Buffer;
```

This function is called only by model CLI commands and the translation worker.

Add:

```ts
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
```

### Step 4: Run tests and typecheck

```powershell
corepack pnpm test -- tests/unit/translation/encryption.test.ts tests/unit/translation/runtime-config.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 5: Commit

```powershell
git add src/config/env.ts src/modules/translation tests/unit/translation
git commit -m "feat: protect model provider credentials"
```

---

## Task 3: Add Versioned Translation Configuration and CLI

**Files:**
- Create: `src/db/repositories/translation-config-repository.ts`
- Create: `src/modules/translation/config-service.ts`
- Create: `src/cli/model.ts`
- Modify: `package.json`
- Create: `tests/integration/translation-config-repository.test.ts`
- Create: `tests/unit/translation/config-service.test.ts`

### Step 1: Write failing repository and service tests

Test:

- provider upsert encrypts at the service boundary and repository only receives ciphertext;
- provider lookup returns no decrypted key;
- activating a new prompt deactivates the previous prompt in one transaction;
- activating a new glossary deactivates the previous glossary in one transaction;
- glossary terms are trimmed, printable ASCII, case-insensitively unique, and stored with lowercase normalization;
- daily token limit is required, positive, and replaceable;
- readiness requires enabled DeepSeek, an active prompt, an active glossary, and a daily limit;
- Qwen absence does not fail readiness.

Run:

```powershell
corepack pnpm test -- tests/unit/translation/config-service.test.ts
corepack pnpm test:integration -- tests/integration/translation-config-repository.test.ts
```

Expected: FAIL.

### Step 2: Implement repository transactions

Expose:

```ts
export type StoredProviderConfig = {
  provider: "deepseek" | "qwen";
  baseUrl: string;
  modelId: string;
  encryptedApiKey: string;
  requestTimeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  enabled: boolean;
};

export interface TranslationConfigRepository {
  upsertProvider(config: StoredProviderConfig): Promise<void>;
  getProvider(provider: TranslationProvider): Promise<StoredProviderConfig | null>;
  listProviders(): Promise<StoredProviderConfig[]>;
  setDailyTokenLimit(limit: number): Promise<void>;
  getDailyTokenLimit(): Promise<number | null>;
  createAndActivatePrompt(input: PromptVersionInput): Promise<PromptVersion>;
  getActivePrompt(): Promise<PromptVersion | null>;
  createAndActivateGlossary(terms: string[]): Promise<GlossaryVersionWithTerms>;
  getActiveGlossary(): Promise<GlossaryVersionWithTerms | null>;
}
```

Use serializable transactions or row locking for activation so two concurrent activations cannot leave multiple active versions.

### Step 3: Implement configuration service

Expose:

```ts
configureProvider(input, plaintextApiKey, masterKey)
setDailyTokenLimit(limit)
activatePrompt({ systemPrompt, userPromptTemplate })
activateGlossary({ terms })
loadWorkerReadiness(masterKey)
```

Validate URLs with `new URL()` and only allow `https:` except `http://127.0.0.1` and `http://localhost` for local fixture tests.

Return decrypted credentials only from `loadWorkerReadiness`, in memory, and never log the result.

### Step 4: Add non-interactive and interactive CLI commands

Create `src/cli/model.ts` with commands:

```text
pnpm model provider set deepseek --model <id> [--base-url <url>]
pnpm model provider set qwen --model <id> [--base-url <url>]
pnpm model provider list
pnpm model budget set --daily-tokens <positive integer>
pnpm model prompt activate --system-file <path> --user-file <path>
pnpm model glossary activate --file <newline-delimited path>
pnpm model readiness
```

For `provider set`, prompt for the API key using masked `@inquirer/prompts` input when `--api-key` is absent. Do not offer a command-line API-key flag in documented usage because shell history is persistent.

Add:

```json
"model": "tsx src/cli/model.ts"
```

The `provider list` output must show provider, base URL, model ID, limits, enabled status, and `apiKeyConfigured: true`; it must never print ciphertext.

### Step 5: Run tests

```powershell
corepack pnpm test -- tests/unit/translation/config-service.test.ts
corepack pnpm test:integration -- tests/integration/translation-config-repository.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 6: Commit

```powershell
git add src/db/repositories/translation-config-repository.ts src/modules/translation/config-service.ts src/cli/model.ts package.json tests
git commit -m "feat: manage translation configuration"
```

---

## Task 4: Protect Terminology and Validate Model Output

**Files:**
- Create: `src/modules/translation/protection.ts`
- Create: `src/modules/translation/output-validation.ts`
- Create: `tests/unit/translation/protection.test.ts`
- Create: `tests/unit/translation/output-validation.test.ts`

### Step 1: Write failing protection tests

Cover:

- protected parser tokens are replaced first;
- glossary terms are matched case-insensitively;
- longest glossary match wins;
- `Shopify` does not match inside `MyShopifyApp`;
- Unicode letters and digits count as word characters at term boundaries;
- original source casing is restored;
- repeated terms receive distinct sequential placeholders;
- placeholder-looking source text is protected from collision;
- code blocks return `translatable: false` without model input;
- restoration rejects missing, duplicate, reordered, or unknown placeholders.

Example:

```ts
const result = protectTranslationInput({
  sourceText: "Use Shopify CLI with shopify app dev.",
  blockKind: "paragraph",
  parserTokens: [],
  glossaryTerms: ["Shopify CLI", "Shopify"],
});

expect(result.protectedText).toBe(
  "Use ⟦P0001⟧ with ⟦P0002⟧ app dev.",
);
expect(result.restore("使用 ⟦P0001⟧ 运行 ⟦P0002⟧ app dev。")).toBe(
  "使用 Shopify CLI 运行 shopify app dev。",
);
```

Run:

```powershell
corepack pnpm test -- tests/unit/translation/protection.test.ts tests/unit/translation/output-validation.test.ts
```

Expected: FAIL.

### Step 2: Implement deterministic protection

Expose:

```ts
export type ProtectedTranslationInput = {
  protectedText: string;
  placeholders: Array<{ placeholder: string; sourceValue: string }>;
  restore(candidate: string): string;
};

export function protectTranslationInput(input: {
  sourceText: string;
  blockKind: ContentBlockKind;
  parserTokens: ProtectedToken[];
  glossaryTerms: string[];
}): ProtectedTranslationInput | { translatable: false };
```

Algorithm:

1. Return non-translatable for fenced and indented code block kinds.
2. Mask literal source substrings matching `/⟦P\d{4,}⟧/u`.
3. Apply parser-provided offsets in ascending order after validating non-overlap.
4. Find glossary matches in remaining unprotected spans.
5. Sort candidates by start offset, then descending source term length.
6. Reject matches whose adjacent character satisfies `/[\p{L}\p{N}_]/u`.
7. Choose non-overlapping longest matches.
8. Replace selected spans from right to left.
9. Assign placeholders in final left-to-right order.

### Step 3: Implement strict output validation

Provider responses must parse as:

```ts
const translationResponseSchema = z.object({
  translatedText: z.string().min(1),
}).strict();
```

Validate:

- the result is not blank;
- every expected placeholder appears exactly once;
- placeholders appear in original order;
- no unknown placeholder appears;
- the restored result contains no internal placeholder;
- restored output is below the provider response byte limit.

Return typed validation errors with stable codes:

```text
invalid_json
empty_translation
placeholder_missing
placeholder_duplicate
placeholder_reordered
placeholder_unknown
response_too_large
```

### Step 4: Run tests

```powershell
corepack pnpm test -- tests/unit/translation/protection.test.ts tests/unit/translation/output-validation.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 5: Commit

```powershell
git add src/modules/translation/protection.ts src/modules/translation/output-validation.ts tests/unit/translation
git commit -m "feat: protect translation terminology"
```

---

## Task 5: Add Bounded OpenAI-Compatible Provider Adapters

**Files:**
- Create: `src/modules/translation/provider-errors.ts`
- Create: `src/modules/translation/provider-client.ts`
- Create: `tests/unit/translation/provider-client.test.ts`

### Step 1: Write failing provider tests

Use an injected fixture `fetch` and cover:

- bearer authorization and `/chat/completions` URL construction;
- DeepSeek request includes disabled thinking configuration;
- Qwen request uses the common OpenAI-compatible body;
- timeout aborts the request;
- response body is bounded while streaming;
- HTTP 401/403 becomes `configuration_error`;
- HTTP 408/429/500/502/503/504 becomes `transient_error`;
- malformed success payload becomes `protocol_error`;
- valid JSON content and usage are returned;
- absent usage remains `null`;
- API key, request authorization, and response body never appear in error messages.

Request contract:

```ts
type TranslationProviderRequest = {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
};

type TranslationProviderResult = {
  content: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  requestBody: string;
  responseBodyHash: string;
};
```

Run:

```powershell
corepack pnpm test -- tests/unit/translation/provider-client.test.ts
```

Expected: FAIL.

### Step 2: Implement stable error taxonomy

Create:

```ts
export type ProviderFailureKind =
  | "configuration_error"
  | "transient_error"
  | "protocol_error";

export class ProviderCallError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
  ) { ... }
}
```

Classify local invalid URL, missing key, unsupported protocol, 401, and 403 as configuration errors. Parse `Retry-After` for transient responses.

### Step 3: Implement bounded native fetch client

Expose:

```ts
export function createOpenAiCompatibleProviderClient(options: {
  provider: TranslationProvider;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}): TranslationProviderClient;
```

Build the endpoint with:

```ts
new URL("chat/completions", ensureTrailingSlash(baseUrl))
```

Use:

```json
{
  "model": "<explicit model id>",
  "messages": [
    { "role": "system", "content": "<system prompt>" },
    { "role": "user", "content": "<user prompt>" }
  ],
  "temperature": 0,
  "stream": false,
  "max_tokens": 4096,
  "response_format": { "type": "json_object" }
}
```

For DeepSeek add:

```json
"thinking": { "type": "disabled" }
```

Read `response.body` incrementally and cancel when the byte limit is exceeded.

### Step 4: Run tests

```powershell
corepack pnpm test -- tests/unit/translation/provider-client.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 5: Commit

```powershell
git add src/modules/translation/provider-errors.ts src/modules/translation/provider-client.ts tests/unit/translation/provider-client.test.ts
git commit -m "feat: add translation provider adapters"
```

---

## Task 6: Enforce Atomic Daily Token Reservations

**Files:**
- Create: `src/db/repositories/token-budget-repository.ts`
- Create: `src/modules/translation/token-budget.ts`
- Create: `tests/unit/translation/token-budget.test.ts`
- Create: `tests/integration/token-budget-repository.test.ts`

### Step 1: Write failing time and estimation tests

Cover:

- Shanghai usage date before and after UTC 16:00;
- next reset is the next `Asia/Shanghai` midnight;
- strict reservation equals UTF-8 byte length of the serialized request plus maximum output tokens;
- multibyte Chinese input counts bytes, not JavaScript code units;
- invalid non-positive limits are rejected.

Expose:

```ts
export function getShanghaiUsageDate(now: Date): string;
export function getNextShanghaiReset(now: Date): Date;
export function estimateStrictReservation(
  serializedRequest: string,
  maxOutputTokens: number,
): number;
```

### Step 2: Write failing atomic repository tests

Run concurrent reservations against a small limit and assert:

- total accepted reservations never exceed the limit;
- an insufficient reservation returns `{ reserved: false, resumeAt }`;
- marking a reservation `request_started` is idempotent;
- settlement moves reserved amount to charged actual usage;
- missing provider usage charges the full reservation;
- stale `reserved` reservations release without charge;
- stale `request_started` reservations charge the full amount;
- no counter becomes negative;
- all providers share the same daily row.

Run:

```powershell
corepack pnpm test:integration -- tests/integration/token-budget-repository.test.ts
```

Expected: FAIL.

### Step 3: Implement transactional reservation repository

Expose:

```ts
reserve({
  jobId,
  blockId,
  provider,
  tokens,
  now,
}): Promise<
  | { reserved: true; reservationId: string }
  | { reserved: false; reason: "budget_exhausted"; resumeAt: Date }
>

markRequestStarted(reservationId, now): Promise<void>

settle({
  reservationId,
  reportedInputTokens,
  reportedOutputTokens,
  now,
}): Promise<{ chargedTokens: number }>

reconcileStale({
  reservedBefore,
  requestStartedBefore,
  now,
}): Promise<{ released: number; charged: number }>

getAvailability(now): Promise<
  | { configured: false }
  | { configured: true; exhausted: boolean; remaining: number; resetAt: Date }
>
```

Use row-level locking on `translation_usage_days`. Create the day row from the current configured limit, then execute a conditional update:

```sql
UPDATE translation_usage_days
SET reserved_tokens = reserved_tokens + $tokens
WHERE usage_date = $date
  AND charged_tokens + reserved_tokens + $tokens <= token_limit
RETURNING usage_date;
```

Insert the reservation only after the conditional update succeeds, in the same transaction.

### Step 4: Implement settlement safety

For actual usage:

```ts
charged = usage === null
  ? reservedTokens
  : Math.min(reservedTokens, inputTokens + outputTokens);
```

Settle only from `reserved` or `request_started`. Repeated settlement returns the stored charged value without changing counters.

### Step 5: Run tests

```powershell
corepack pnpm test -- tests/unit/translation/token-budget.test.ts
corepack pnpm test:integration -- tests/integration/token-budget-repository.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 6: Commit

```powershell
git add src/db/repositories/token-budget-repository.ts src/modules/translation/token-budget.ts tests
git commit -m "feat: enforce translation token budgets"
```

---

## Task 7: Persist Translation Memory, Revisions, and Corrections

**Files:**
- Create: `src/db/repositories/translation-repository.ts`
- Modify: `src/db/repositories/ingestion-repository.ts`
- Create: `tests/integration/translation-repository.test.ts`
- Modify: `tests/integration/ingestion-repository.test.ts`

### Step 1: Write failing repository tests

Cover:

- publishing translatable source blocks creates `pending` translation rows;
- unchanged republishing preserves the current revision;
- changed source fingerprints preserve history and set corrected blocks to `review_required`;
- block correction lookup outranks global correction;
- global correction lookup is keyed by source fingerprint;
- AI memory is keyed by source fingerprint, prompt version, and glossary version;
- publishing a revision updates the current pointer atomically;
- a failed attempt records error metadata without deleting the current revision;
- oversized status records no model call;
- context lookup returns previous and next source blocks from the same version;
- manual corrections append immutable revisions.

Run:

```powershell
corepack pnpm test:integration -- tests/integration/translation-repository.test.ts
```

Expected: FAIL.

### Step 2: Implement source publication synchronization

When `publishSourceVersion` inserts a translatable block:

```ts
await tx.insert(blockTranslations).values({
  blockId,
  sourceFingerprint: block.fingerprint,
  status: "pending",
}).onConflictDoUpdate({
  target: blockTranslations.blockId,
  set: {
    sourceFingerprint: block.fingerprint,
    status: sql`
      CASE
        WHEN ${blockTranslations.status} = 'manually_corrected'
          AND ${blockTranslations.sourceFingerprint} <> ${block.fingerprint}
          THEN 'review_required'
        WHEN ${blockTranslations.sourceFingerprint} <> ${block.fingerprint}
          THEN 'pending'
        ELSE ${blockTranslations.status}
      END
    `,
    updatedAt: now,
  },
});
```

Keep the old revision pointer so the reader may continue serving it with review state until replacement.

### Step 3: Implement repository interface

Expose:

```ts
loadBlockContext(blockId): Promise<{
  block: SourceBlock;
  previousText: string | null;
  nextText: string | null;
  translation: BlockTranslationState;
} | null>

findBlockCorrection(blockId, sourceFingerprint)
findGlobalCorrection(sourceFingerprint)
findAiMemory(sourceFingerprint, promptVersionId, glossaryVersionId)

publishRevision({
  blockId,
  expectedSourceFingerprint,
  source,
  translatedText,
  provider,
  modelId,
  promptVersionId,
  glossaryVersionId,
  modelCallId,
  now,
})

recordCorrection({
  scope,
  blockId,
  sourceFingerprint,
  translatedText,
  now,
})

markFailed(blockId, expectedSourceFingerprint, code, message, now)
markOversized(blockId, expectedSourceFingerprint, message, now)
```

All publication methods must compare `expectedSourceFingerprint` in the update. If source changed mid-call, return `stale_source` and do not publish.

### Step 4: Run tests

```powershell
corepack pnpm test:integration -- tests/integration/translation-repository.test.ts tests/integration/ingestion-repository.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 5: Commit

```powershell
git add src/db/repositories/translation-repository.ts src/db/repositories/ingestion-repository.ts tests/integration
git commit -m "feat: persist translation revisions"
```

---

## Task 8: Orchestrate Memory, Provider Routing, and Validation

**Files:**
- Create: `src/modules/translation/translation-service.ts`
- Create: `src/modules/translation/prompt-renderer.ts`
- Create: `src/modules/translation/model-call-audit.ts`
- Create: `tests/unit/translation/prompt-renderer.test.ts`
- Create: `tests/unit/translation/translation-service.test.ts`

### Step 1: Write failing prompt tests

The user prompt template receives exactly:

```ts
{
  sourceText,
  previousContext,
  nextContext,
  protectedTerms,
}
```

Use fixed markers:

```text
<previous_context>...</previous_context>
<source_block>...</source_block>
<next_context>...</next_context>
<protected_terms>...</protected_terms>
```

Reject prompt templates that omit `{{sourceText}}`. Escape marker-like text in source/context as JSON strings so source text cannot alter prompt structure.

### Step 2: Write failing orchestration tests

Cover this exact precedence:

1. block manual correction;
2. global manual correction;
3. AI memory for active prompt/glossary;
4. DeepSeek request;
5. Qwen fallback.

Also cover:

- code blocks return `skipped`;
- a request above provider input limit marks `oversized`;
- a strict reservation above the entire daily limit marks `oversized`;
- insufficient remaining budget returns `deferred` with reset time;
- DeepSeek transient errors receive initial call plus two retries;
- retries use bounded exponential delays supplied through an injected sleeper;
- DeepSeek validation failure immediately routes to Qwen without retrying DeepSeek;
- DeepSeek configuration failure is terminal with no Qwen call;
- Qwen receives one attempt only;
- absent Qwen causes eligible DeepSeek failure to return retryable failure;
- failed calls settle reported usage;
- missing usage settles the full reservation;
- stale source publication returns `stale`;
- successful output restores exact protected values and publishes a revision.

Return:

```ts
type TranslationRunResult =
  | { outcome: "completed"; source: TranslationRevisionSource }
  | { outcome: "skipped" }
  | { outcome: "deferred"; resumeAt: Date; reason: "budget_exhausted" }
  | { outcome: "stale" }
  | { outcome: "retryable_failure"; code: string; message: string }
  | { outcome: "terminal_failure"; code: string; message: string };
```

Run:

```powershell
corepack pnpm test -- tests/unit/translation/translation-service.test.ts
```

Expected: FAIL.

### Step 3: Implement audit lifecycle

Before each provider call:

1. serialize the exact request body;
2. reserve strict budget;
3. insert `model_calls` with request SHA-256 and start status;
4. mark reservation `request_started`;
5. invoke provider;
6. store only response SHA-256 and bounded metadata;
7. settle usage in `finally`.

Never persist API keys, authorization headers, raw prompts, or raw model responses in `model_calls`.

### Step 4: Implement provider routing

DeepSeek attempts:

```ts
const delaysMs = [0, 1_000, 2_000];
```

Retry only `transient_error`. Respect a provider `Retry-After` value capped at 30 seconds.

Fallback rules:

| DeepSeek result | Qwen configured | Action |
|---|---:|---|
| success + valid | either | publish |
| validation error | yes | Qwen once |
| validation error | no | retryable failure |
| transient exhausted | yes | Qwen once |
| transient exhausted | no | retryable failure |
| configuration error | either | terminal failure |
| protocol error | yes | Qwen once |
| protocol error | no | retryable failure |

Qwen failure becomes retryable unless it is a configuration error, which is terminal for that job attempt.

### Step 5: Implement memory publication

Manual memory is published as a new revision for the current block so every served translation has local revision history:

```text
block correction -> block_manual
global correction -> global_manual
AI memory -> ai_memory
provider result -> ai
```

No budget reservation or model audit is created for memory hits.

### Step 6: Run tests

```powershell
corepack pnpm test -- tests/unit/translation/prompt-renderer.test.ts tests/unit/translation/translation-service.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 7: Commit

```powershell
git add src/modules/translation tests/unit/translation
git commit -m "feat: orchestrate protected translations"
```

---

## Task 9: Run Translation Jobs Without Consuming Attempts on Budget Deferral

**Files:**
- Modify: `src/db/repositories/job-repository.ts`
- Create: `src/modules/jobs/leased-job-runner.ts`
- Modify: `src/modules/jobs/ingestion-worker.ts`
- Create: `src/modules/jobs/translation-worker.ts`
- Create: `src/worker/translation-main.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `tests/integration/job-repository.test.ts`
- Modify: `tests/unit/jobs/ingestion-worker.test.ts`
- Create: `tests/unit/jobs/translation-worker.test.ts`

### Step 1: Write failing job repository tests

Generalize:

```ts
claimNext({
  queue: "ingestion" | "translation",
  workerId,
  leaseMs,
  now,
})
```

Add:

```ts
defer({
  jobId,
  workerId,
  runAt,
  reasonCode,
  reasonMessage,
  now,
}): Promise<boolean>
```

Assert that `defer`:

- only affects a running job owned by the worker;
- returns it to `queued`;
- clears lease ownership;
- sets the future `run_at`;
- decrements the claim-added attempt without going below zero;
- preserves reason metadata;
- does not mark the job failed when `attempts === max_attempts`.

### Step 2: Extract the shared lease lifecycle

Move lease renewal, completion, retry, failure, abort handling, and cleanup into:

```ts
export function createLeasedJobRunner<TPayload>(options: {
  repository: JobRepository;
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  execute(job: ClaimedJob<TPayload>, signal: AbortSignal): Promise<JobExecutionResult>;
  now?: () => Date;
  sleep?: Sleep;
}): LeasedJobRunner;
```

Support:

```ts
type JobExecutionResult =
  | { outcome: "completed" }
  | { outcome: "deferred"; runAt: Date; code: string; message: string }
  | { outcome: "retry"; code: string; message: string; delayMs?: number }
  | { outcome: "failed"; code: string; message: string };
```

Refactor the ingestion worker onto this runner without changing existing behavior.

### Step 3: Write failing translation worker tests

Cover:

- readiness is checked before claiming;
- missing DeepSeek, active prompt, active glossary, daily budget, or encryption key prevents startup;
- Qwen may be absent;
- exhausted daily budget sleeps until reset without claiming;
- `completed`, `skipped`, and `stale` complete the job;
- `deferred` uses repository defer;
- retryable failure uses queue retry policy;
- terminal failure marks failed immediately;
- unsupported job payload fails safely;
- graceful shutdown aborts an in-flight request and releases the loop.

### Step 4: Implement translation worker and entrypoint

The worker claims only:

```text
queue = translation
type = translate_block
payload = { blockId: string, contentFingerprint: string }
```

At startup:

1. parse environment;
2. decode `MODEL_KEY_ENCRYPTION_KEY`;
3. load and validate worker readiness;
4. reconcile stale token reservations;
5. construct provider clients and translation service;
6. enter the polling loop.

Before each claim, call budget availability. If exhausted, sleep until reset and do not claim.

Add:

```json
"translation-worker": "tsx src/worker/translation-main.ts",
"translation-worker:dev": "tsx watch src/worker/translation-main.ts"
```

Add documented environment values:

```text
MODEL_KEY_ENCRYPTION_KEY=
TRANSLATION_WORKER_ID=translation-1
TRANSLATION_POLL_INTERVAL_MS=1000
TRANSLATION_LEASE_MS=180000
TRANSLATION_HEARTBEAT_MS=60000
TRANSLATION_STALE_RESERVATION_MS=300000
TRANSLATION_STALE_REQUEST_MS=900000
```

### Step 5: Run tests

```powershell
corepack pnpm test -- tests/unit/jobs/ingestion-worker.test.ts tests/unit/jobs/translation-worker.test.ts
corepack pnpm test:integration -- tests/integration/job-repository.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 6: Commit

```powershell
git add src/db/repositories/job-repository.ts src/modules/jobs src/worker/translation-main.ts package.json .env.example tests
git commit -m "feat: run durable translation workers"
```

---

## Task 10: Add Manual Correction and Retranslation Commands

**Files:**
- Modify: `src/cli/model.ts`
- Create: `src/modules/translation/translation-admin-service.ts`
- Create: `tests/unit/translation/translation-admin-service.test.ts`
- Create: `tests/integration/translation-admin-service.test.ts`

### Step 1: Write failing admin service tests

Cover:

- global correction defaults to the current source fingerprint;
- block-only correction requires a block ID;
- correcting a stale/non-current fingerprint requires an explicit override;
- each correction creates an immutable correction and revision;
- retranslation can target one block, one page path, or all current translatable blocks;
- retranslation jobs use active prompt/glossary versions;
- repeated requests do not create duplicate active jobs;
- no active prompt/glossary makes retranslation fail before enqueueing.

### Step 2: Implement admin service

Expose:

```ts
recordManualCorrection({
  blockId,
  translatedText,
  scope: "global" | "block",
  expectedSourceFingerprint?,
})

enqueueRetranslation({
  blockId?,
  pagePath?,
  all?: boolean,
})
```

Use job dedupe keys:

```text
retranslate:<blockId>:<sourceFingerprint>:<promptVersionId>:<glossaryVersionId>
```

### Step 3: Add CLI commands

```text
pnpm model correction add --block-id <uuid> --file <translation.txt> [--scope global|block]
pnpm model correction history --block-id <uuid>
pnpm model retranslate --block-id <uuid>
pnpm model retranslate --page <canonical path>
pnpm model retranslate --all
```

Require `--confirm-all` for `--all` in non-interactive execution. Print counts only, not full translated content.

### Step 4: Run tests

```powershell
corepack pnpm test -- tests/unit/translation/translation-admin-service.test.ts
corepack pnpm test:integration -- tests/integration/translation-admin-service.test.ts
corepack pnpm typecheck
```

Expected: PASS.

### Step 5: Commit

```powershell
git add src/cli/model.ts src/modules/translation/translation-admin-service.ts tests
git commit -m "feat: administer translation revisions"
```

---

## Task 11: Verify the Full Pipeline With Local Provider Fixtures

**Files:**
- Create: `tests/fixtures/model-server.ts`
- Create: `tests/integration/translation-pipeline.test.ts`
- Modify: `tests/helpers/database.ts`
- Modify: `tests/helpers/setup.ts`

### Step 1: Create a bounded local provider fixture

The fixture server must:

- bind to `127.0.0.1` on an ephemeral port;
- capture request headers and JSON bodies in memory;
- expose scripted responses for success, transient errors, invalid placeholders, malformed JSON, missing usage, and delayed responses;
- reject requests larger than a configurable byte limit;
- close after every test file.

No test may contain a real provider base URL and API key together.

### Step 2: Write the end-to-end integration cases

Case A, DeepSeek success:

1. publish a source page with a paragraph and code block;
2. configure local DeepSeek fixture, prompt, glossary, and budget;
3. claim the generated translation job;
4. execute the service/worker once;
5. assert one model call, one settled reservation, one AI revision;
6. assert protected `Shopify CLI` and inline code are exact;
7. assert code block produced no model request.

Case B, fallback:

1. DeepSeek returns reordered placeholders;
2. Qwen returns valid output;
3. assert DeepSeek validation audit and Qwen success audit;
4. assert two reservations settle independently;
5. assert final revision provider is Qwen.

Case C, memory:

1. manually correct one fingerprint globally;
2. publish the same source text on another page;
3. run its job;
4. assert a `global_manual` revision and zero model calls.

Case D, budget:

1. configure a limit that accepts one call but not a second;
2. run two jobs;
3. assert first completes and second returns to queued at next Shanghai reset;
4. assert the deferred job did not consume an attempt.

Case E, source race:

1. delay provider response;
2. publish a changed source version before response completion;
3. release provider response;
4. assert stale output is not published.

### Step 3: Run integration and regression tests

```powershell
corepack pnpm test:integration -- tests/integration/translation-pipeline.test.ts
corepack pnpm test
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm build
```

Expected: PASS and zero outbound provider calls.

### Step 4: Commit

```powershell
git add tests
git commit -m "test: verify protected translation pipeline"
```

---

## Task 12: Document Operations and Perform Release Verification

**Files:**
- Create: `docs/translation-operations.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-15-protected-translation-pipeline-design.md`

### Step 1: Document setup in executable order

`docs/translation-operations.md` must cover:

1. generate a 32-byte base64 encryption key;
2. set `MODEL_KEY_ENCRYPTION_KEY` without printing it;
3. configure DeepSeek and optional Qwen;
4. set the shared daily token limit;
5. activate prompt and glossary versions;
6. check readiness;
7. start ingestion and translation workers;
8. inspect provider configuration without exposing secrets;
9. add and inspect corrections;
10. enqueue scoped retranslation;
11. rotate an API key;
12. rotate the master encryption key through a dedicated decrypt/re-encrypt maintenance command;
13. reconcile stale reservations after an unclean shutdown;
14. diagnose `failed`, `review_required`, and `oversized` states;
15. back up PostgreSQL daily and retain 14 days.

Include the official defaults:

```text
DeepSeek: https://api.deepseek.com
Qwen Beijing: https://dashscope.aliyuncs.com/compatible-mode/v1
```

State clearly that model IDs are explicit configuration and must not be inferred.

### Step 2: Add master-key rotation command

If Task 3 does not yet include it, extend `src/cli/model.ts`:

```text
pnpm model key rotate
```

The command:

1. requires current `MODEL_KEY_ENCRYPTION_KEY`;
2. securely prompts for the new base64 key;
3. locks provider config rows;
4. decrypts and re-encrypts every configured API key in one transaction;
5. prints only the number of rotated provider keys.

Add unit/integration coverage before documenting it.

### Step 3: Mark the design implementation status

Change the design status only after all checks pass:

```text
状态：已实现并通过本地自动化验证
```

### Step 4: Run final verification from a clean process state

```powershell
git diff --check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm build
git status --short
```

Expected:

- no whitespace errors;
- lint/typecheck/build pass;
- all unit, integration, and E2E tests pass;
- only intentional documentation changes remain before the final commit.

### Step 5: Commit

```powershell
git add README.md docs src/cli/model.ts tests
git commit -m "docs: document translation operations"
```

---

## Completion Criteria

Phase 3 is complete only when:

- migration `0002_protected_translation` applies to a fresh and an existing Phase 2 database;
- the translation worker refuses unsafe startup configuration;
- no user-facing request path performs model translation;
- DeepSeek retry and Qwen fallback rules are covered by deterministic tests;
- terminology and code protection failures cannot publish;
- the shared daily budget cannot oversubscribe under concurrent reservations;
- budget deferral does not consume job attempts;
- manual correction and translation memory precedence are proven;
- source races cannot publish stale translations;
- provider secrets are encrypted at rest and omitted from output/logs;
- all tests pass without real model API traffic;
- every task has an independent commit.
