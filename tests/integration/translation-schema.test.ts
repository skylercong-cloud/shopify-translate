import type { PoolClient } from "pg";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { pool } from "@/db/client";
import { getEnv } from "@/lib/env";

let client: PoolClient;

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

beforeEach(async () => {
  client = await pool.connect();
  await client.query("begin");
});

afterEach(async () => {
  await client.query("rollback");
  client.release();
});

async function insertContentBlock(): Promise<string> {
  const page = await client.query<{ id: string }>(`
    insert into source_pages (canonical_url, path)
    values (
      'https://shopify.dev/docs/schema-' || gen_random_uuid(),
      '/docs/schema'
    )
    returning id
  `);
  const version = await client.query<{ id: string }>(
    `
      insert into page_versions (
        page_id,
        version_number,
        source_format,
        content_fingerprint,
        block_count,
        fetched_at,
        published_at
      )
      values ($1, 1, 'text', 'page-fingerprint', 1, now(), now())
      returning id
    `,
    [page.rows[0].id],
  );
  const block = await client.query<{ id: string }>(
    `
      insert into content_blocks (
        page_version_id,
        ordinal,
        type,
        heading_path,
        source_text,
        payload,
        fingerprint,
        translatable
      )
      values ($1, 0, 'paragraph', '[]', 'Build apps.', '{}', 'block-fingerprint', true)
      returning id
    `,
    [version.rows[0].id],
  );

  return block.rows[0].id;
}

async function insertGlossaryVersion(): Promise<string> {
  const result = await client.query<{ id: string }>(`
    insert into glossary_versions (version, content_fingerprint, active)
    values (1, 'glossary-fingerprint', false)
    returning id
  `);
  return result.rows[0].id;
}

describe("translation persistence schema", () => {
  it("creates every translation table", async () => {
    const result = await client.query<{ tablename: string }>(`
      select tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'model_provider_configs',
          'translation_settings',
          'prompt_versions',
          'glossary_versions',
          'glossary_terms',
          'block_translations',
          'translation_revisions',
          'translation_corrections',
          'translation_usage_days',
          'token_reservations',
          'model_calls'
        )
      order by tablename
    `);

    expect(result.rows.map((row) => row.tablename)).toEqual([
      "block_translations",
      "glossary_terms",
      "glossary_versions",
      "model_calls",
      "model_provider_configs",
      "prompt_versions",
      "token_reservations",
      "translation_corrections",
      "translation_revisions",
      "translation_settings",
      "translation_usage_days",
    ]);
  });

  it("allows only one provider configuration per provider", async () => {
    await client.query(`
      insert into model_provider_configs (
        provider,
        base_url,
        model_id,
        encrypted_api_key
      )
      values ('deepseek', 'https://api.deepseek.com', 'model-a', 'encrypted-a')
    `);

    await expect(
      client.query(`
        insert into model_provider_configs (
          provider,
          base_url,
          model_id,
          encrypted_api_key
        )
        values ('deepseek', 'https://api.deepseek.com', 'model-b', 'encrypted-b')
      `),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows only one active prompt version", async () => {
    await client.query(`
      insert into prompt_versions (
        version,
        system_prompt,
        user_prompt_template,
        content_fingerprint,
        active
      )
      values (1, 'Translate safely.', '{{sourceText}}', 'prompt-one', true)
    `);

    await expect(
      client.query(`
        insert into prompt_versions (
          version,
          system_prompt,
          user_prompt_template,
          content_fingerprint,
          active
        )
        values (2, 'Translate precisely.', '{{sourceText}}', 'prompt-two', true)
      `),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows only one active glossary version", async () => {
    await client.query(`
      insert into glossary_versions (version, content_fingerprint, active)
      values (1, 'glossary-one', true)
    `);

    await expect(
      client.query(`
        insert into glossary_versions (version, content_fingerprint, active)
        values (2, 'glossary-two', true)
      `),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows only one translation state per content block", async () => {
    const blockId = await insertContentBlock();
    await client.query(
      `
        insert into block_translations (
          block_id,
          source_fingerprint
        )
        values ($1, 'fingerprint-a')
      `,
      [blockId],
    );

    await expect(
      client.query(
        `
          insert into block_translations (
            block_id,
            source_fingerprint
          )
          values ($1, 'fingerprint-b')
        `,
        [blockId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("deduplicates normalized glossary terms within a version", async () => {
    const glossaryVersionId = await insertGlossaryVersion();
    await client.query(
      `
        insert into glossary_terms (
          glossary_version_id,
          source_term,
          normalized_term
        )
        values ($1, 'Shopify CLI', 'shopify cli')
      `,
      [glossaryVersionId],
    );

    await expect(
      client.query(
        `
          insert into glossary_terms (
            glossary_version_id,
            source_term,
            normalized_term
          )
          values ($1, 'shopify cli', 'shopify cli')
        `,
        [glossaryVersionId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects negative or oversubscribed daily usage", async () => {
    await expect(
      client.query(`
        insert into translation_usage_days (
          usage_date,
          token_limit,
          reserved_tokens,
          charged_tokens
        )
        values ('2026-06-15', 100, -1, 0)
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires positive token reservations", async () => {
    await client.query(`
      insert into translation_usage_days (
        usage_date,
        token_limit,
        reserved_tokens,
        charged_tokens
      )
      values ('2026-06-15', 100, 0, 0)
    `);

    await expect(
      client.query(`
        insert into token_reservations (
          usage_date,
          provider,
          status,
          reserved_tokens
        )
        values ('2026-06-15', 'deepseek', 'reserved', 0)
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires global corrections to omit a block", async () => {
    const blockId = await insertContentBlock();

    await expect(
      client.query(
        `
          insert into translation_corrections (
            scope,
            source_fingerprint,
            block_id,
            translated_text
          )
          values ('global', 'fingerprint', $1, '构建应用。')
        `,
        [blockId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires block corrections to reference a block", async () => {
    await expect(
      client.query(`
        insert into translation_corrections (
          scope,
          source_fingerprint,
          translated_text
        )
        values ('block', 'fingerprint', '构建应用。')
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
