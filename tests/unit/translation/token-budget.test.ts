import { describe, expect, it } from "vitest";

import {
  estimateStrictReservation,
  getNextShanghaiReset,
  getShanghaiUsageDate,
} from "@/modules/translation/token-budget";

describe("translation token budget", () => {
  it("uses the Shanghai calendar date across the UTC 16:00 boundary", () => {
    expect(
      getShanghaiUsageDate(new Date("2026-06-15T15:59:59.999Z")),
    ).toBe("2026-06-15");
    expect(
      getShanghaiUsageDate(new Date("2026-06-15T16:00:00.000Z")),
    ).toBe("2026-06-16");
  });

  it("returns the next Shanghai midnight", () => {
    expect(
      getNextShanghaiReset(new Date("2026-06-15T15:59:59.999Z")),
    ).toEqual(new Date("2026-06-15T16:00:00.000Z"));
    expect(
      getNextShanghaiReset(new Date("2026-06-15T16:00:00.000Z")),
    ).toEqual(new Date("2026-06-16T16:00:00.000Z"));
  });

  it("reserves serialized UTF-8 bytes plus the maximum output tokens", () => {
    expect(estimateStrictReservation('{"text":"Shopify"}', 128)).toBe(
      Buffer.byteLength('{"text":"Shopify"}', "utf8") + 128,
    );
  });

  it("counts Chinese input as UTF-8 bytes", () => {
    expect(estimateStrictReservation('{"text":"中文"}', 64)).toBe(
      Buffer.byteLength('{"text":"中文"}', "utf8") + 64,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maximum output tokens: %s",
    (maxOutputTokens) => {
      expect(() =>
        estimateStrictReservation("request", maxOutputTokens),
      ).toThrow("maxOutputTokens must be a positive safe integer");
    },
  );
});
