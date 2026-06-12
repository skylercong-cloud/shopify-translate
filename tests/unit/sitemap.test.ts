import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { createRobotsPolicy } from "@/modules/ingestion/robots-policy";
import { discoverSitemapUrls } from "@/modules/ingestion/sitemap";

const robots = createRobotsPolicy("User-agent: *\nDisallow:");

describe("Sitemap discovery", () => {
  it("recurses through same-origin indexes and returns approved unique pages", async () => {
    const index = await readFile(
      "tests/fixtures/ingestion/sitemap-index.xml",
      "utf8",
    );
    const docs = await readFile(
      "tests/fixtures/ingestion/sitemap-docs.xml",
      "utf8",
    );
    const fetchResource = vi.fn(async (url: string) => {
      if (url === "https://shopify.dev/sitemap.xml") {
        return {
          finalUrl: url,
          contentType: "application/xml",
          body: index,
          bytes: Buffer.byteLength(index),
        };
      }
      if (url === "https://shopify.dev/sitemaps/docs.xml") {
        return {
          finalUrl: url,
          contentType: "application/xml",
          body: docs,
          bytes: Buffer.byteLength(docs),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const discovered = await discoverSitemapUrls({
      roots: ["https://shopify.dev/sitemap.xml"],
      fetchResource,
      robots,
    });

    expect(discovered).toEqual([
      {
        canonicalUrl: "https://shopify.dev/docs",
        lastModifiedAt: undefined,
      },
      {
        canonicalUrl:
          "https://shopify.dev/docs/api/admin-graphql/latest",
        lastModifiedAt: new Date("2026-06-11T00:00:00.000Z"),
      },
      {
        canonicalUrl: "https://shopify.dev/docs/apps",
        lastModifiedAt: new Date("2026-06-10T00:00:00.000Z"),
      },
    ]);
    expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([
      "https://shopify.dev/sitemap.xml",
      "https://shopify.dev/sitemaps/docs.xml",
    ]);
  });

  it("rejects a recursive index that exceeds the depth limit", async () => {
    const fetchResource = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "application/xml",
      body: `<sitemapindex><sitemap><loc>${url.replace(
        /\.xml$/,
        "-child.xml",
      )}</loc></sitemap></sitemapindex>`,
      bytes: 100,
    }));

    await expect(
      discoverSitemapUrls({
        roots: ["https://shopify.dev/root.xml"],
        fetchResource,
        robots,
        limits: { maxDepth: 1, maxFiles: 10, maxCandidates: 10 },
      }),
    ).rejects.toMatchObject({ code: "sitemap_depth_limit" });
  });

  it("rejects discoveries that exceed file or candidate limits", async () => {
    const twoChildren = `
      <sitemapindex>
        <sitemap><loc>https://shopify.dev/one.xml</loc></sitemap>
        <sitemap><loc>https://shopify.dev/two.xml</loc></sitemap>
      </sitemapindex>
    `;
    const fetchResource = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "application/xml",
      body: twoChildren,
      bytes: Buffer.byteLength(twoChildren),
    }));

    await expect(
      discoverSitemapUrls({
        roots: ["https://shopify.dev/root.xml"],
        fetchResource,
        robots,
        limits: { maxDepth: 5, maxFiles: 1, maxCandidates: 10 },
      }),
    ).rejects.toMatchObject({ code: "sitemap_file_limit" });

    const twoUrls = `
      <urlset>
        <url><loc>https://shopify.dev/docs/one</loc></url>
        <url><loc>https://shopify.dev/docs/two</loc></url>
      </urlset>
    `;
    await expect(
      discoverSitemapUrls({
        roots: ["https://shopify.dev/root.xml"],
        fetchResource: async (url) => ({
          finalUrl: url,
          contentType: "application/xml",
          body: twoUrls,
          bytes: Buffer.byteLength(twoUrls),
        }),
        robots,
        limits: { maxDepth: 5, maxFiles: 5, maxCandidates: 1 },
      }),
    ).rejects.toMatchObject({ code: "sitemap_candidate_limit" });
  });

  it("applies the current Robots policy to page candidates", async () => {
    const restrictiveRobots = createRobotsPolicy(`
User-agent: *
Disallow: /docs/private/
`);
    const body = `
      <urlset>
        <url><loc>https://shopify.dev/docs/public</loc></url>
        <url><loc>https://shopify.dev/docs/private/secret</loc></url>
      </urlset>
    `;

    await expect(
      discoverSitemapUrls({
        roots: ["https://shopify.dev/sitemap.xml"],
        fetchResource: async (url) => ({
          finalUrl: url,
          contentType: "application/xml",
          body,
          bytes: Buffer.byteLength(body),
        }),
        robots: restrictiveRobots,
      }),
    ).resolves.toEqual([
      {
        canonicalUrl: "https://shopify.dev/docs/public",
        lastModifiedAt: undefined,
      },
    ]);
  });
});
