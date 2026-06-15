import { describe, expect, it } from "vitest";

import type { ProtectedToken } from "@/modules/ingestion/types";
import {
  PlaceholderValidationError,
  protectTranslationInput,
  type PlaceholderValidationCode,
} from "@/modules/translation/protection";

function token(
  sourceText: string,
  value: string,
  kind: ProtectedToken["kind"] = "inline_code",
  visibleValue = value,
): ProtectedToken {
  const start = sourceText.indexOf(visibleValue);
  return {
    kind,
    value,
    start,
    end: start + visibleValue.length,
  };
}

describe("translation input protection", () => {
  it("protects parser offsets and restores visible source text", () => {
    const sourceText =
      "Open Admin GraphQL API and run npm run dev.";
    const result = protectTranslationInput({
      sourceText,
      blockKind: "paragraph",
      parserTokens: [
        token(
          sourceText,
          "https://shopify.dev/docs/api/admin-graphql",
          "url",
          "Admin GraphQL API",
        ),
        token(sourceText, "npm run dev"),
      ],
      glossaryTerms: [],
    });

    expect(result).toMatchObject({
      protectedText: "Open ⟦P0001⟧ and run ⟦P0002⟧.",
    });
    if ("translatable" in result) throw new Error("Expected protection");
    expect(
      result.restore("打开 ⟦P0001⟧ 并运行 ⟦P0002⟧。"),
    ).toBe("打开 Admin GraphQL API 并运行 npm run dev。");
  });

  it("matches glossary terms case-insensitively with longest match first", () => {
    const result = protectTranslationInput({
      sourceText: "Use Shopify CLI with shopify app dev.",
      blockKind: "paragraph",
      parserTokens: [],
      glossaryTerms: ["Shopify", "Shopify CLI"],
    });

    expect(result).toMatchObject({
      protectedText: "Use ⟦P0001⟧ with ⟦P0002⟧ app dev.",
      placeholders: [
        { placeholder: "⟦P0001⟧", sourceValue: "Shopify CLI" },
        { placeholder: "⟦P0002⟧", sourceValue: "shopify" },
      ],
    });
  });

  it("uses Unicode word boundaries and avoids identifier substrings", () => {
    const result = protectTranslationInput({
      sourceText:
        "MyShopifyApp 中文Shopify9 Shopify Shopify_Theme",
      blockKind: "paragraph",
      parserTokens: [],
      glossaryTerms: ["Shopify"],
    });

    expect(result).toMatchObject({
      protectedText:
        "MyShopifyApp 中文Shopify9 ⟦P0001⟧ Shopify_Theme",
    });
  });

  it("assigns distinct placeholders to repeated terms", () => {
    const result = protectTranslationInput({
      sourceText: "Shopify and Shopify",
      blockKind: "paragraph",
      parserTokens: [],
      glossaryTerms: ["Shopify"],
    });

    expect(result).toMatchObject({
      protectedText: "⟦P0001⟧ and ⟦P0002⟧",
      placeholders: [
        { placeholder: "⟦P0001⟧", sourceValue: "Shopify" },
        { placeholder: "⟦P0002⟧", sourceValue: "Shopify" },
      ],
    });
  });

  it("masks placeholder-looking source text without collisions", () => {
    const result = protectTranslationInput({
      sourceText: "Keep ⟦P0001⟧ and Shopify.",
      blockKind: "paragraph",
      parserTokens: [],
      glossaryTerms: ["Shopify"],
    });

    expect(result).toMatchObject({
      protectedText: "Keep ⟦P0002⟧ and ⟦P0003⟧.",
    });
    if ("translatable" in result) throw new Error("Expected protection");
    expect(result.restore("保留 ⟦P0002⟧ 和 ⟦P0003⟧。")).toBe(
      "保留 ⟦P0001⟧ 和 Shopify。",
    );
  });

  it("does not translate code blocks", () => {
    expect(
      protectTranslationInput({
        sourceText: "const shopify = true;",
        blockKind: "code",
        parserTokens: [],
        glossaryTerms: ["Shopify"],
      }),
    ).toEqual({ translatable: false });
  });

  it("rejects invalid or overlapping parser offsets", () => {
    const sourceText = "Shopify CLI";

    expect(() =>
      protectTranslationInput({
        sourceText,
        blockKind: "paragraph",
        parserTokens: [
          { kind: "identifier", value: "Shopify", start: -1, end: 7 },
        ],
        glossaryTerms: [],
      }),
    ).toThrow("parser token offsets");
    expect(() =>
      protectTranslationInput({
        sourceText,
        blockKind: "paragraph",
        parserTokens: [
          { kind: "identifier", value: "Shopify", start: 0, end: 7 },
          { kind: "inline_code", value: "CLI", start: 4, end: 11 },
        ],
        glossaryTerms: [],
      }),
    ).toThrow("overlap");
  });

  it.each([
    ["placeholder_missing", "使用 ⟦P0001⟧。"],
    [
      "placeholder_duplicate",
      "使用 ⟦P0001⟧、⟦P0001⟧ 和 ⟦P0002⟧。",
    ],
    ["placeholder_reordered", "使用 ⟦P0002⟧ 和 ⟦P0001⟧。"],
    [
      "placeholder_unknown",
      "使用 ⟦P0001⟧、⟦P0002⟧ 和 ⟦P9999⟧。",
    ],
  ] as const)("rejects %s during restoration", (code, candidate) => {
    const result = protectTranslationInput({
      sourceText: "Shopify CLI",
      blockKind: "paragraph",
      parserTokens: [
        {
          kind: "identifier",
          value: "Shopify",
          start: 0,
          end: 7,
        },
        { kind: "inline_code", value: "CLI", start: 8, end: 11 },
      ],
      glossaryTerms: [],
    });
    if ("translatable" in result) throw new Error("Expected protection");

    expect(() => result.restore(candidate)).toThrow(
      expect.objectContaining<Partial<PlaceholderValidationError>>({
        code: code as PlaceholderValidationCode,
      }),
    );
  });
});
