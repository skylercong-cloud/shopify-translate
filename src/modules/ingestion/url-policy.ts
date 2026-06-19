import {
  SHOPIFY_DEV_ORIGIN,
  SHOPIFY_DOCS_ROOT,
} from "@/modules/ingestion/constants";
import { IngestionError } from "@/modules/ingestion/errors";

function parseUrl(input: string, base?: string): URL {
  try {
    return new URL(input, base);
  } catch {
    throw new IngestionError("source_url_invalid", "Source URL is invalid");
  }
}

function requireShopifyOrigin(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.origin !== SHOPIFY_DEV_ORIGIN ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new IngestionError(
      "source_url_not_allowed",
      "Source URL must use the approved Shopify.dev origin",
    );
  }
}

function requireQueryFree(url: URL): void {
  if (url.search !== "") {
    throw new IngestionError(
      "source_url_query_not_allowed",
      "Source URL must not include a query string",
    );
  }
}

export function canonicalizeShopifyDocsUrl(input: string): string {
  const url = parseUrl(input);
  requireShopifyOrigin(url);
  requireQueryFree(url);

  if (
    url.pathname.toLowerCase().endsWith(".txt") ||
    (url.pathname !== SHOPIFY_DOCS_ROOT &&
      !url.pathname.startsWith(`${SHOPIFY_DOCS_ROOT}/`))
  ) {
    throw new IngestionError(
      "source_url_path_not_allowed",
      "Source URL must identify an approved Shopify.dev docs page",
    );
  }

  if (
    url.pathname.length > SHOPIFY_DOCS_ROOT.length &&
    url.pathname.endsWith("/")
  ) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  url.hash = "";
  return url.toString();
}

export function resolveApprovedRedirect(
  currentUrl: string,
  location: string,
): string {
  return canonicalizeShopifyDocsUrl(
    parseUrl(location, currentUrl).toString(),
  );
}

export function canonicalizeSameOriginResourceUrl(input: string): string {
  const url = parseUrl(input);
  requireShopifyOrigin(url);
  requireQueryFree(url);
  url.hash = "";
  return url.toString();
}

export function resolveSameOriginResourceRedirect(
  currentUrl: string,
  location: string,
): string {
  return canonicalizeSameOriginResourceUrl(
    parseUrl(location, currentUrl).toString(),
  );
}
