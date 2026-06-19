import { describe, expect, it } from "vitest";

import { candidateLimitForSearchLimit } from "@/db/repositories/search-repository";

describe("candidateLimitForSearchLimit", () => {
  it("keeps a bounded candidate pool above the requested result limit", () => {
    expect(candidateLimitForSearchLimit(20)).toBe(500);
    expect(candidateLimitForSearchLimit(1)).toBe(50);
    expect(candidateLimitForSearchLimit(0)).toBe(0);
    expect(candidateLimitForSearchLimit(-1)).toBe(0);
    expect(candidateLimitForSearchLimit(100)).toBe(1000);
  });
});
