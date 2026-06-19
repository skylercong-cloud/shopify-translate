import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("search index migration", () => {
  it("adds trigram indexes for cached bilingual search fields", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "drizzle/0003_search_indexes.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("create extension if not exists pg_trgm");
    expect(sql).toContain('using gin ("title" gin_trgm_ops)');
    expect(sql).toContain('using gin ("path" gin_trgm_ops)');
    expect(sql).toContain('using gin ("source_text" gin_trgm_ops)');
    expect(sql).toContain('using gin ("translated_text" gin_trgm_ops)');
  });
});
