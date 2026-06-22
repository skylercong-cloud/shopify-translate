import {
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  SOURCE_TIMEOUT_MS,
  SOURCE_USER_AGENT,
} from "@/modules/ingestion/constants";
import { IngestionError } from "@/modules/ingestion/errors";
import type { SourceFormat } from "@/modules/ingestion/types";
import {
  canonicalizeSameOriginResourceUrl,
  canonicalizeShopifyDocsUrl,
  resolveApprovedRedirect,
  resolveSameOriginResourceRedirect,
} from "@/modules/ingestion/url-policy";

const TEXT_CONTENT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/markdown",
]);
const HTML_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
]);
const RESOURCE_CONTENT_TYPES = new Set([
  ...TEXT_CONTENT_TYPES,
  "application/xml",
  "text/xml",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SourceFetchResult =
  | {
      kind: "content";
      requestedUrl: string;
      finalUrl: string;
      sourceFormat: SourceFormat;
      contentType: string;
      body: string;
      bytes: number;
      etag?: string;
      lastModified?: string;
    }
  | {
      kind: "not_modified";
      requestedUrl: string;
      finalUrl: string;
    }
  | {
      kind: "gone";
      requestedUrl: string;
      finalUrl: string;
      status: 404 | 410;
    };

export type SourceClient = {
  fetchPage(input: {
    canonicalUrl: string;
    etag?: string;
    lastModified?: string;
  }): Promise<SourceFetchResult>;
  fetchTextResource(url: string): Promise<{
    finalUrl: string;
    contentType: string;
    body: string;
    bytes: number;
  }>;
};

export type RequestGate = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

type RequestGateOptions = {
  concurrency: number;
  requestIntervalMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function createRequestGate(options: RequestGateOptions): RequestGate {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let active = 0;
  let nextStartAt = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < options.concurrency) {
      active += 1;
      return;
    }

    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  function release(): void {
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    active -= 1;
  }

  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        const currentTime = now();
        const startAt = Math.max(currentTime, nextStartAt);
        nextStartAt = startAt + options.requestIntervalMs;
        if (startAt > currentTime) {
          await sleep(startAt - currentTime);
        }
        return await operation();
      } finally {
        release();
      }
    },
  };
}

const defaultRequestGate = createRequestGate({
  concurrency: 2,
  requestIntervalMs: 500,
});

type RawResponse = {
  status: number;
  headers: Headers;
  body: string;
  bytes: number;
};

type FollowedResponse = RawResponse & {
  finalUrl: string;
};

type SourceClientOptions = {
  fetchImpl?: typeof fetch;
  requestGate?: RequestGate;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  now?: () => number;
};

function normalizeContentType(headers: Headers): string {
  return headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function parseRetryAfter(
  value: string | null,
  now: () => number,
): number | undefined {
  if (!value) return undefined;

  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim()) * 1_000;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return undefined;
  return Math.max(0, retryAt - now());
}

function classifyStatus(
  response: FollowedResponse,
  now: () => number,
): void {
  if (response.status === 429) {
    throw new IngestionError(
      "source_rate_limited",
      "Shopify.dev rate limited the source request",
      true,
      parseRetryAfter(response.headers.get("retry-after"), now),
    );
  }
  if (response.status >= 500 && response.status <= 599) {
    throw new IngestionError(
      "source_server_error",
      `Shopify.dev returned HTTP ${response.status}`,
      true,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new IngestionError(
      "source_access_denied",
      `Shopify.dev returned HTTP ${response.status}`,
    );
  }
  if (response.status < 200 || response.status > 299) {
    throw new IngestionError(
      "source_http_error",
      `Shopify.dev returned HTTP ${response.status}`,
    );
  }
}

function hasRecognizableTextContent(body: string): boolean {
  const normalized = body.trim();
  if (!normalized) return false;
  if (/^#{1,6}\s+\S/m.test(normalized)) return true;
  if (normalized.split(/\n\s*\n/).length >= 2) return true;
  return normalized.length >= 80;
}

function canonicalizeTextRepresentationUrl(input: string): string {
  const url = new URL(input);
  if (!url.pathname.toLowerCase().endsWith(".txt")) {
    throw new IngestionError(
      "source_url_path_not_allowed",
      "Text source URL must end with .txt",
    );
  }

  const pageUrl = new URL(url);
  pageUrl.pathname = pageUrl.pathname.slice(0, -4);
  return `${canonicalizeShopifyDocsUrl(pageUrl.toString())}.txt`;
}

function resolveTextRepresentationRedirect(
  currentUrl: string,
  location: string,
): string {
  return canonicalizeTextRepresentationUrl(
    new URL(location, currentUrl).toString(),
  );
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<{ body: string; bytes: number }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxResponseBytes
  ) {
    throw new IngestionError(
      "source_response_too_large",
      "Source response exceeded the configured size limit",
    );
  }

  if (!response.body) {
    return { body: "", bytes: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxResponseBytes) {
      await reader.cancel();
      throw new IngestionError(
        "source_response_too_large",
        "Source response exceeded the configured size limit",
      );
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body: new TextDecoder().decode(combined),
    bytes,
  };
}

export function createSourceClient(
  options: SourceClientOptions = {},
): SourceClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestGate = options.requestGate ?? defaultRequestGate;
  const timeoutMs = options.timeoutMs ?? SOURCE_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const now = options.now ?? Date.now;

  async function requestOnce(
    url: string,
    headers: Headers,
  ): Promise<RawResponse> {
    return requestGate.run(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          headers,
          signal: controller.signal,
        });
        const body = REDIRECT_STATUSES.has(response.status)
          ? { body: "", bytes: 0 }
          : await readBoundedBody(response, maxResponseBytes);
        return {
          status: response.status,
          headers: response.headers,
          ...body,
        };
      } catch (error) {
        if (error instanceof IngestionError) throw error;
        if (controller.signal.aborted) {
          throw new IngestionError(
            "source_timeout",
            "Source request timed out",
            true,
          );
        }
        throw new IngestionError(
          "source_network_error",
          "Source request failed",
          true,
        );
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async function followRedirects(input: {
    url: string;
    headers: Headers;
    resolveRedirect(currentUrl: string, location: string): string;
  }): Promise<FollowedResponse> {
    let currentUrl = input.url;

    for (let redirects = 0; ; redirects += 1) {
      const response = await requestOnce(currentUrl, input.headers);
      if (!REDIRECT_STATUSES.has(response.status)) {
        return { ...response, finalUrl: currentUrl };
      }

      if (redirects >= maxRedirects) {
        throw new IngestionError(
          "source_redirect_limit",
          "Source request exceeded the redirect limit",
        );
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new IngestionError(
          "source_redirect_invalid",
          "Source redirect did not include a Location header",
        );
      }
      currentUrl = input.resolveRedirect(currentUrl, location);
    }
  }

  function conditionalHeaders(input: {
    etag?: string;
    lastModified?: string;
  }): Headers {
    const headers = new Headers({
      accept: "text/plain, text/markdown, text/html;q=0.8",
      "user-agent": SOURCE_USER_AGENT,
    });
    if (input.etag) headers.set("if-none-match", input.etag);
    if (input.lastModified) {
      headers.set("if-modified-since", input.lastModified);
    }
    return headers;
  }

  async function fetchFormat(input: {
    requestedUrl: string;
    sourceFormat: SourceFormat;
    headers: Headers;
  }): Promise<SourceFetchResult | "fallback"> {
    const response = await followRedirects({
      url: input.requestedUrl,
      headers: input.headers,
      resolveRedirect:
        input.sourceFormat === "text"
          ? resolveTextRepresentationRedirect
          : resolveApprovedRedirect,
    });

    if (response.status === 304) {
      return {
        kind: "not_modified",
        requestedUrl: input.requestedUrl,
        finalUrl: response.finalUrl,
      };
    }

    if (
      input.sourceFormat === "text" &&
      (response.status === 404 || response.status === 406)
    ) {
      return "fallback";
    }

    if (response.status === 404 || response.status === 410) {
      return {
        kind: "gone",
        requestedUrl: input.requestedUrl,
        finalUrl: response.finalUrl,
        status: response.status,
      };
    }

    classifyStatus(response, now);
    const contentType = normalizeContentType(response.headers);
    if (input.sourceFormat === "text") {
      if (
        !TEXT_CONTENT_TYPES.has(contentType) ||
        !hasRecognizableTextContent(response.body)
      ) {
        return "fallback";
      }
    } else {
      if (!HTML_CONTENT_TYPES.has(contentType)) {
        throw new IngestionError(
          "source_content_type_invalid",
          `HTML source returned unsupported Content-Type ${contentType || "(missing)"}`,
        );
      }
      if (!response.body.trim()) {
        throw new IngestionError(
          "source_content_empty",
          "HTML source returned an empty response",
        );
      }
    }

    const result: SourceFetchResult = {
      kind: "content",
      requestedUrl: input.requestedUrl,
      finalUrl: response.finalUrl,
      sourceFormat: input.sourceFormat,
      contentType,
      body: response.body,
      bytes: response.bytes,
    };
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    if (etag) result.etag = etag;
    if (lastModified) result.lastModified = lastModified;
    return result;
  }

  return {
    async fetchPage(input) {
      const canonicalUrl = canonicalizeShopifyDocsUrl(input.canonicalUrl);
      const headers = conditionalHeaders(input);
      const textResult = await fetchFormat({
        requestedUrl: `${canonicalUrl}.txt`,
        sourceFormat: "text",
        headers,
      });
      if (textResult !== "fallback") return textResult;

      return fetchFormat({
        requestedUrl: canonicalUrl,
        sourceFormat: "html",
        headers,
      }).then((result) => {
        if (result === "fallback") {
          throw new Error("HTML fetch cannot request another fallback");
        }
        return result;
      });
    },

    async fetchTextResource(inputUrl) {
      const requestedUrl = canonicalizeSameOriginResourceUrl(inputUrl);
      const response = await followRedirects({
        url: requestedUrl,
        headers: new Headers({
          accept: "application/xml, text/xml, */*;q=0.1",
          "user-agent": SOURCE_USER_AGENT,
        }),
        resolveRedirect: resolveSameOriginResourceRedirect,
      });
      classifyStatus(response, now);
      const contentType = normalizeContentType(response.headers);
      if (!RESOURCE_CONTENT_TYPES.has(contentType)) {
        throw new IngestionError(
          "source_content_type_invalid",
          `Text resource returned unsupported Content-Type ${contentType || "(missing)"}`,
        );
      }
      return {
        finalUrl: response.finalUrl,
        contentType,
        body: response.body,
        bytes: response.bytes,
      };
    },
  };
}
