import { describe, expect, it } from "vitest";

import { normalizeCorrectionReturnTo } from "@/modules/translation/correction-return";

describe("normalizeCorrectionReturnTo", () => {
  it("allows reader document paths", () => {
    expect(normalizeCorrectionReturnTo("/docs/apps/build")).toBe(
      "/docs/apps/build",
    );
    expect(
      normalizeCorrectionReturnTo("/docs/apps/build?language=en"),
    ).toBe("/docs/apps/build?language=en");
  });

  it("allows the admin translation review workbench", () => {
    expect(normalizeCorrectionReturnTo("/admin/review")).toBe(
      "/admin/review",
    );
    expect(
      normalizeCorrectionReturnTo("/admin/review?status=review_required"),
    ).toBe("/admin/review?status=review_required");
  });

  it("falls back to admin for unsafe or unrelated paths", () => {
    expect(normalizeCorrectionReturnTo("https://example.com/docs/apps")).toBe(
      "/admin",
    );
    expect(normalizeCorrectionReturnTo("//example.com/docs/apps")).toBe(
      "/admin",
    );
    expect(normalizeCorrectionReturnTo("/api/admin/corrections")).toBe(
      "/admin",
    );
    expect(normalizeCorrectionReturnTo("/admin/password")).toBe("/admin");
    expect(normalizeCorrectionReturnTo("not a path")).toBe("/admin");
  });
});
