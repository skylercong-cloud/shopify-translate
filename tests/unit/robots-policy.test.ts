import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createRobotsPolicy,
  requireRobotsPolicy,
} from "@/modules/ingestion/robots-policy";

describe("robots policy", () => {
  it("extracts same-origin sitemaps and rejects disallowed docs paths", async () => {
    const body = await readFile(
      "tests/fixtures/ingestion/robots.txt",
      "utf8",
    );
    const policy = createRobotsPolicy(body);

    expect(policy.sitemapUrls).toEqual(["https://shopify.dev/sitemap.xml"]);
    expect(policy.isAllowed("https://shopify.dev/docs/apps")).toBe(true);
    expect(
      policy.isAllowed(
        "https://shopify.dev/docs/api/shipping-partner-platform/reference",
      ),
    ).toBe(false);
  });

  it("drops external and malformed sitemap resources", () => {
    const policy = createRobotsPolicy(`
User-agent: *
Sitemap: https://example.com/sitemap.xml
Sitemap: not-a-url
Sitemap: https://shopify.dev/docs-sitemap.xml
`);

    expect(policy.sitemapUrls).toEqual([
      "https://shopify.dev/docs-sitemap.xml",
    ]);
  });

  it("uses the default sitemap when Robots declares none", () => {
    const policy = createRobotsPolicy("User-agent: *\nDisallow:");

    expect(policy.sitemapUrls).toEqual(["https://shopify.dev/sitemap.xml"]);
  });

  it("fails closed when no cached policy exists", () => {
    expect(() => requireRobotsPolicy(undefined)).toThrowError(
      /robots policy is unavailable/i,
    );
  });
});
