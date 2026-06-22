import { describe, expect, it } from "vitest";

import {
  canonicalizeSitemapMirrorUrl,
  canonicalizeShopifyDocsUrl,
  resolveApprovedRedirect,
  resolveSameOriginResourceRedirect,
  resolveSitemapMirrorRedirect,
} from "@/modules/ingestion/url-policy";

describe("Shopify docs URL policy", () => {
  it.each([
    ["https://SHOPIFY.dev:443/docs/", "https://shopify.dev/docs"],
    [
      "https://shopify.dev/docs/api/admin-graphql/latest/",
      "https://shopify.dev/docs/api/admin-graphql/latest",
    ],
    [
      "https://shopify.dev/docs/apps#authentication",
      "https://shopify.dev/docs/apps",
    ],
  ])("canonicalizes %s", (input, expected) => {
    expect(canonicalizeShopifyDocsUrl(input)).toBe(expected);
  });

  it.each([
    "http://shopify.dev/docs",
    "https://shopify.dev/changelog",
    "https://dev.shopify.com/docs",
    "https://shopify.dev/docs/apps?shpxid=1",
    "https://shopify.dev/docs/apps.txt",
    "https://user:pass@shopify.dev/docs",
    "https://shopify.dev:8443/docs",
  ])("rejects %s", (input) => {
    expect(() => canonicalizeShopifyDocsUrl(input)).toThrow();
  });

  it("checks every document redirect against the same allowlist", () => {
    expect(
      resolveApprovedRedirect(
        "https://shopify.dev/docs/apps",
        "/docs/apps/build",
      ),
    ).toBe("https://shopify.dev/docs/apps/build");
    expect(() =>
      resolveApprovedRedirect(
        "https://shopify.dev/docs/apps",
        "https://example.com/docs/apps",
      ),
    ).toThrow();
  });

  it("allows same-origin resources without widening document scope", () => {
    expect(
      resolveSameOriginResourceRedirect(
        "https://shopify.dev/sitemap.xml",
        "/sitemaps/docs.xml",
      ),
    ).toBe("https://shopify.dev/sitemaps/docs.xml");
    expect(() =>
      resolveSameOriginResourceRedirect(
        "https://shopify.dev/sitemap.xml",
        "https://example.com/sitemap.xml",
      ),
    ).toThrow();
    expect(() =>
      resolveSameOriginResourceRedirect(
        "https://shopify.dev/sitemap.xml",
        "/sitemaps/docs.xml?version=1",
      ),
    ).toThrow();
  });

  it("allows only query-free XML resources on GitHub raw content", () => {
    const mirrorUrl =
      "https://raw.githubusercontent.com/skylercong-cloud/shopify-translate/sitemap-cache/shopify-sitemap.xml";

    expect(canonicalizeSitemapMirrorUrl(mirrorUrl)).toBe(mirrorUrl);
    expect(
      resolveSitemapMirrorRedirect(
        mirrorUrl,
        "/skylercong-cloud/shopify-translate/sitemap-cache/next.xml",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/skylercong-cloud/shopify-translate/sitemap-cache/next.xml",
    );
    expect(() =>
      canonicalizeSitemapMirrorUrl(
        "https://raw.githubusercontent.com/owner/repo/ref/sitemap.xml?token=1",
      ),
    ).toThrow();
    expect(() =>
      canonicalizeSitemapMirrorUrl(
        "https://raw.githubusercontent.com/owner/repo/ref/sitemap.json",
      ),
    ).toThrow();
    expect(() => canonicalizeSitemapMirrorUrl(`${mirrorUrl}#generated`)).toThrow();
    expect(() =>
      resolveSitemapMirrorRedirect(mirrorUrl, "https://example.com/sitemap.xml"),
    ).toThrow();
  });
});
