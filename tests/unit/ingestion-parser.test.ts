import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseSourcePage } from "@/modules/ingestion/parser";

describe("structured page parser", () => {
  it("ignores Shopify YAML front matter when parsing Markdown", () => {
    const page = parseSourcePage({
      sourceFormat: "text",
      body: `---
title: GraphQL Admin API reference
description: >-
  The Admin API lets you build apps and integrations that extend and enhance the
  Shopify admin.
api_version: 2026-04
source_url:
  html: 'https://shopify.dev/docs/api/admin-graphql/latest'
  md: 'https://shopify.dev/docs/api/admin-graphql/latest.md'
---

# GraphQL Admin API reference

The Admin API lets you build apps and integrations.
`,
    });

    expect(page.title).toBe("GraphQL Admin API reference");
    expect(page.blocks.map((block) => block.sourceText)).toEqual([
      "GraphQL Admin API reference",
      "The Admin API lets you build apps and integrations.",
    ]);
  });

  it.each([
    ["text", "tests/fixtures/ingestion/page.md"],
    ["html", "tests/fixtures/ingestion/page.html"],
  ] as const)(
    "parses %s into the same semantic block sequence",
    async (sourceFormat, path) => {
      const body = await readFile(path, "utf8");
      const page = parseSourcePage({ body, sourceFormat });

      expect(page.title).toBe("Build Shopify apps");
      expect(page.sourceFormat).toBe(sourceFormat);
      expect(page.blocks.map((block) => block.type)).toEqual([
        "heading",
        "paragraph",
        "heading",
        "list",
        "table",
        "notice",
        "code",
        "image",
      ]);
      expect(page.blocks.map((block) => block.ordinal)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(page.blocks[1].headingPath).toEqual(["Build Shopify apps"]);
      expect(page.blocks[3].headingPath).toEqual([
        "Build Shopify apps",
        "Development steps",
      ]);

      const paragraph = page.blocks[1];
      expect(paragraph.payload).toMatchObject({
        protectedTokens: expect.arrayContaining([
          expect.objectContaining({
            kind: "url",
            value: "https://shopify.dev/docs/api/admin-graphql",
          }),
          expect.objectContaining({
            kind: "inline_code",
            value: "npm run dev",
          }),
          expect.objectContaining({
            kind: "file_path",
            value: "shopify.app.toml",
          }),
          expect.objectContaining({
            kind: "identifier",
            value: "Product",
          }),
        ]),
      });

      expect(page.blocks[3].payload).toMatchObject({
        ordered: false,
        items: [
          {
            text: "Create the app",
            children: [
              {
                ordered: true,
                items: [
                  { text: "Configure the project", children: [] },
                  {
                    text: "Run the development server",
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(page.blocks[3].sourceText).toBe(
        "Create the app\nConfigure the project\nRun the development server",
      );
      expect(page.blocks[4].payload).toMatchObject({
        headers: ["Field", "Description"],
        rows: [
          ["name", "App name"],
          ["handle", "App handle"],
        ],
      });
      expect(page.blocks[5]).toMatchObject({
        sourceText: "Keep access tokens private.",
        payload: { kind: "warning", title: "Warning" },
      });
      expect(page.blocks[6]).toMatchObject({
        translatable: false,
        sourceText:
          '// Keep this comment in English\nconst productType = "Product";',
        payload: { language: "typescript" },
      });
      expect(page.blocks[7]).toMatchObject({
        sourceText: "App architecture\nArchitecture diagram",
        payload: {
          src: "https://cdn.shopify.com/example/app.png",
          alt: "App architecture",
          caption: "Architecture diagram",
        },
      });
    },
  );

  it("removes HTML chrome instead of treating it as document content", async () => {
    const body = await readFile(
      "tests/fixtures/ingestion/page.html",
      "utf8",
    );
    const page = parseSourcePage({ body, sourceFormat: "html" });
    const text = page.blocks.map((block) => block.sourceText).join("\n");

    expect(text).not.toContain("Docs navigation");
    expect(text).not.toContain("Log in");
    expect(text).not.toContain("Shopify footer");
    expect(text).not.toContain("must not run");
  });

  it("rejects HTML without one unambiguous main content root", () => {
    expect(() =>
      parseSourcePage({
        sourceFormat: "html",
        body: "<main><h1>One</h1></main><main><h1>Two</h1></main>",
      }),
    ).toThrowError(/main content/i);
    expect(() =>
      parseSourcePage({
        sourceFormat: "html",
        body: "<div><h1>Missing main</h1></div>",
      }),
    ).toThrowError(/main content/i);
  });

  it("rejects empty, oversized, deeply nested, or excessive content", () => {
    expect(() =>
      parseSourcePage({ sourceFormat: "text", body: "" }),
    ).toThrowError(/content/i);
    expect(() =>
      parseSourcePage(
        { sourceFormat: "text", body: "# Heading\n\nToo large" },
        { maxBlocks: 10, maxNestingDepth: 10, maxBlockBytes: 4 },
      ),
    ).toThrowError(/block size/i);
    expect(() =>
      parseSourcePage(
        {
          sourceFormat: "text",
          body: "# Heading\n\n- One\n  - Two\n    - Three",
        },
        { maxBlocks: 10, maxNestingDepth: 1, maxBlockBytes: 1_024 },
      ),
    ).toThrowError(/nesting/i);
    expect(() =>
      parseSourcePage(
        { sourceFormat: "text", body: "# One\n\n## Two" },
        { maxBlocks: 1, maxNestingDepth: 10, maxBlockBytes: 1_024 },
      ),
    ).toThrowError(/block count/i);
  });
});
