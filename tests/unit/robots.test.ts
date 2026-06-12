import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("robots.txt", () => {
  it("disallows all crawlers", async () => {
    const robotsPath = resolve("public/robots.txt");

    await expect(readFile(robotsPath, "utf8")).resolves.toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });
});
