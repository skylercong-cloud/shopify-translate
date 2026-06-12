import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("robots.txt", () => {
  it("disallows all crawlers", async () => {
    const robotsPath = resolve("public/robots.txt");
    const contents = await readFile(robotsPath, "utf8");

    expect(contents.replaceAll("\r\n", "\n")).toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });
});
