import robotsParser from "robots-parser";

import {
  DEFAULT_SITEMAP_URL,
  SHOPIFY_ROBOTS_URL,
  SOURCE_USER_AGENT,
} from "@/modules/ingestion/constants";
import { IngestionError } from "@/modules/ingestion/errors";
import {
  canonicalizeSameOriginResourceUrl,
  canonicalizeShopifyDocsUrl,
} from "@/modules/ingestion/url-policy";

export type RobotsPolicy = {
  body: string;
  sitemapUrls: string[];
  isAllowed(url: string): boolean;
};

export function createRobotsPolicy(body: string): RobotsPolicy {
  const parsed = robotsParser(SHOPIFY_ROBOTS_URL, body);
  const sitemapUrls = Array.from(
    new Set(
      parsed.getSitemaps().flatMap((url) => {
        try {
          return [canonicalizeSameOriginResourceUrl(url)];
        } catch {
          return [];
        }
      }),
    ),
  );

  return {
    body,
    sitemapUrls:
      sitemapUrls.length > 0 ? sitemapUrls : [DEFAULT_SITEMAP_URL],
    isAllowed(input) {
      try {
        const url = canonicalizeShopifyDocsUrl(input);
        return parsed.isAllowed(url, SOURCE_USER_AGENT) === true;
      } catch {
        return false;
      }
    },
  };
}

export function requireRobotsPolicy(
  policy: RobotsPolicy | undefined,
): RobotsPolicy {
  if (!policy) {
    throw new IngestionError(
      "robots_policy_unavailable",
      "Robots policy is unavailable",
      true,
    );
  }

  return policy;
}
