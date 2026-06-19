import { XMLParser } from "fast-xml-parser";

import { IngestionError } from "@/modules/ingestion/errors";
import type { RobotsPolicy } from "@/modules/ingestion/robots-policy";
import type { SourceClient } from "@/modules/ingestion/source-client";
import type { DiscoveredPage } from "@/modules/ingestion/types";
import {
  canonicalizeSameOriginResourceUrl,
  canonicalizeShopifyDocsUrl,
} from "@/modules/ingestion/url-policy";

const DEFAULT_LIMITS = {
  maxDepth: 5,
  maxFiles: 100,
  maxCandidates: 200_000,
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseLastModified(value: unknown): Date | undefined {
  const text = textValue(value);
  if (!text) return undefined;
  const milliseconds = Date.parse(text);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds);
}

function sitemapError(code: string, message: string): IngestionError {
  return new IngestionError(code, message);
}

export async function discoverSitemapUrls(input: {
  roots: string[];
  fetchResource: SourceClient["fetchTextResource"];
  robots: RobotsPolicy;
  limits?: {
    maxDepth: number;
    maxFiles: number;
    maxCandidates: number;
  };
}): Promise<DiscoveredPage[]> {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const pending: Array<{ url: string; depth: number }> = [];
  const visited = new Set<string>();
  const discovered = new Map<string, DiscoveredPage>();
  let filesRead = 0;
  let candidatesRead = 0;

  for (const root of input.roots) {
    try {
      pending.push({
        url: canonicalizeSameOriginResourceUrl(root),
        depth: 0,
      });
    } catch {
      // Robots can contain third-party Sitemap declarations; they are ignored.
    }
  }

  while (pending.length > 0) {
    const next = pending.shift()!;
    if (visited.has(next.url)) continue;
    if (next.depth > limits.maxDepth) {
      throw sitemapError(
        "sitemap_depth_limit",
        "Sitemap recursion exceeded the configured depth limit",
      );
    }
    if (filesRead >= limits.maxFiles) {
      throw sitemapError(
        "sitemap_file_limit",
        "Sitemap discovery exceeded the configured file limit",
      );
    }

    visited.add(next.url);
    filesRead += 1;
    const response = await input.fetchResource(next.url);
    let document: Record<string, unknown>;
    try {
      document = parser.parse(response.body) as Record<string, unknown>;
    } catch {
      throw sitemapError("sitemap_xml_invalid", "Sitemap XML is invalid");
    }

    const index = document.sitemapindex as
      | { sitemap?: unknown }
      | undefined;
    if (index) {
      for (const entry of asArray(index.sitemap)) {
        if (!entry || typeof entry !== "object") continue;
        const loc = textValue((entry as { loc?: unknown }).loc);
        if (!loc) continue;

        let childUrl: string;
        try {
          childUrl = canonicalizeSameOriginResourceUrl(loc);
        } catch {
          continue;
        }
        if (next.depth >= limits.maxDepth && !visited.has(childUrl)) {
          throw sitemapError(
            "sitemap_depth_limit",
            "Sitemap recursion exceeded the configured depth limit",
          );
        }
        pending.push({ url: childUrl, depth: next.depth + 1 });
      }
      continue;
    }

    const urlSet = document.urlset as { url?: unknown } | undefined;
    if (!urlSet) {
      throw sitemapError(
        "sitemap_document_invalid",
        "XML document is not a Sitemap index or URL set",
      );
    }

    for (const entry of asArray(urlSet.url)) {
      candidatesRead += 1;
      if (candidatesRead > limits.maxCandidates) {
        throw sitemapError(
          "sitemap_candidate_limit",
          "Sitemap discovery exceeded the configured candidate limit",
        );
      }
      if (!entry || typeof entry !== "object") continue;
      const loc = textValue((entry as { loc?: unknown }).loc);
      if (!loc) continue;

      let canonicalUrl: string;
      try {
        canonicalUrl = canonicalizeShopifyDocsUrl(loc);
      } catch {
        continue;
      }
      if (!input.robots.isAllowed(canonicalUrl)) continue;

      const lastModifiedAt = parseLastModified(
        (entry as { lastmod?: unknown }).lastmod,
      );
      const existing = discovered.get(canonicalUrl);
      if (
        !existing ||
        (lastModifiedAt &&
          (!existing.lastModifiedAt ||
            lastModifiedAt > existing.lastModifiedAt))
      ) {
        discovered.set(canonicalUrl, {
          canonicalUrl,
          lastModifiedAt: lastModifiedAt ?? existing?.lastModifiedAt,
        });
      }
    }
  }

  return Array.from(discovered.values()).sort((left, right) =>
    left.canonicalUrl.localeCompare(right.canonicalUrl),
  );
}
