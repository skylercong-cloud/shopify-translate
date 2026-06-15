import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

function enumValues(name: string): readonly string[] | undefined {
  const value = (schema as Record<string, unknown>)[name];
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null ||
    !("enumValues" in value)
  ) {
    return undefined;
  }

  return (value as { enumValues: readonly string[] }).enumValues;
}

describe("translation schema", () => {
  it("defines the supported providers", () => {
    expect(enumValues("translationProviderEnum")).toEqual([
      "deepseek",
      "qwen",
    ]);
  });

  it("defines the translation lifecycle", () => {
    expect(enumValues("translationStatusEnum")).toEqual([
      "pending",
      "ai_translated",
      "manually_corrected",
      "review_required",
      "failed",
      "oversized",
    ]);
  });

  it("defines immutable revision sources and correction scopes", () => {
    expect(enumValues("translationRevisionSourceEnum")).toEqual([
      "ai",
      "ai_memory",
      "global_manual",
      "block_manual",
    ]);
    expect(enumValues("translationCorrectionScopeEnum")).toEqual([
      "global",
      "block",
    ]);
  });

  it("defines reservation and model call audit states", () => {
    expect(enumValues("tokenReservationStatusEnum")).toEqual([
      "reserved",
      "request_started",
      "settled",
      "released",
    ]);
    expect(enumValues("modelCallStatusEnum")).toEqual([
      "succeeded",
      "transient_error",
      "configuration_error",
      "validation_error",
      "protocol_error",
    ]);
  });
});
