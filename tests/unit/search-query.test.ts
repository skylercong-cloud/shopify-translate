import { describe, expect, it } from "vitest";

import {
  buildLikePattern,
  normalizeSearchQuery,
  searchTerms,
} from "@/modules/search/query";

describe("search query helpers", () => {
  it("normalizes whitespace while preserving Chinese and API identifiers", () => {
    expect(normalizeSearchQuery("  Admin   GraphQL  ")).toBe("Admin GraphQL");
    expect(normalizeSearchQuery("  订单  webhook  ")).toBe("订单 webhook");
    expect(searchTerms("Admin GraphQL productCreate")).toEqual([
      "Admin",
      "GraphQL",
      "productCreate",
    ]);
  });

  it("escapes LIKE wildcards", () => {
    expect(buildLikePattern("products_%")).toBe("%products\\_\\%%");
  });
});
