import { describe, expect, it } from "vitest";

import { protectTranslationInput } from "@/modules/translation/protection";
import {
  TranslationOutputValidationError,
  validateTranslationOutput,
  type TranslationOutputValidationCode,
} from "@/modules/translation/output-validation";

function protectedInput() {
  const result = protectTranslationInput({
    sourceText: "Use Shopify CLI.",
    blockKind: "paragraph",
    parserTokens: [],
    glossaryTerms: ["Shopify CLI"],
  });
  if ("translatable" in result) throw new Error("Expected protection");
  return result;
}

function expectCode(
  action: () => unknown,
  code: TranslationOutputValidationCode,
) {
  expect(action).toThrow(
    expect.objectContaining<Partial<TranslationOutputValidationError>>({
      code,
    }),
  );
}

describe("translation output validation", () => {
  it("parses strict JSON and restores protected values", () => {
    expect(
      validateTranslationOutput({
        content: JSON.stringify({
          translatedText: "使用 ⟦P0001⟧。",
        }),
        protectedInput: protectedInput(),
        maxResponseBytes: 1_024,
      }),
    ).toEqual({
      translatedText: "使用 Shopify CLI。",
    });
  });

  it.each([
    ["invalid_json", "not-json"],
    [
      "invalid_json",
      JSON.stringify({
        translatedText: "使用 ⟦P0001⟧。",
        explanation: "extra",
      }),
    ],
    ["empty_translation", JSON.stringify({ translatedText: "   " })],
  ] as const)("rejects %s response content", (code, content) => {
    expectCode(
      () =>
        validateTranslationOutput({
          content,
          protectedInput: protectedInput(),
          maxResponseBytes: 1_024,
        }),
      code,
    );
  });

  it("rejects a response above the configured byte limit", () => {
    const content = JSON.stringify({
      translatedText: "使用 ⟦P0001⟧。",
    });

    expectCode(
      () =>
        validateTranslationOutput({
          content,
          protectedInput: protectedInput(),
          maxResponseBytes: Buffer.byteLength(content, "utf8") - 1,
        }),
      "response_too_large",
    );
  });

  it.each([
    ["placeholder_missing", "没有占位符。"],
    [
      "placeholder_duplicate",
      "⟦P0001⟧ 和 ⟦P0001⟧。",
    ],
    ["placeholder_unknown", "⟦P0001⟧ 和 ⟦P9999⟧。"],
  ] as const)(
    "preserves the %s validation code",
    (code, translatedText) => {
      expectCode(
        () =>
          validateTranslationOutput({
            content: JSON.stringify({ translatedText }),
            protectedInput: protectedInput(),
            maxResponseBytes: 1_024,
          }),
        code,
      );
    },
  );
});
