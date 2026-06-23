import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("application style contracts", () => {
  it("styles login, focused navigation, and semantic reader surfaces", async () => {
    const css = await readFile("src/app/globals.css", "utf8");

    for (const selector of [
      ".login-page",
      ".login-card",
      ".login-card input",
      ".login-card button",
      ".document-drawer",
      ".document-tree",
      ".app-header__search",
      ".reader-document__header h1",
      ".reader-table-of-contents",
      ".reader-table-wrap",
      ".reader-notice",
    ]) {
      expect(css, `missing ${selector}`).toContain(selector);
    }
  });
});
