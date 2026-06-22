import { describe, expect, it, vi } from "vitest";

import { IngestionError } from "@/modules/ingestion/errors";
import {
  createRequestGate,
  createSourceClient,
} from "@/modules/ingestion/source-client";

const canonicalUrl = "https://shopify.dev/docs/apps";

function clientWith(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createSourceClient>[0]> = {},
) {
  return createSourceClient({
    fetchImpl,
    requestGate: createRequestGate({
      concurrency: 2,
      requestIntervalMs: 0,
    }),
    timeoutMs: 1_000,
    maxResponseBytes: 1_024,
    ...overrides,
  });
}

describe("source client", () => {
  it("fetches the text representation first with conditional headers", async () => {
    const body = "# Apps\n\nBuild apps.";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          etag: '"abc"',
          "last-modified": "Thu, 11 Jun 2026 00:00:00 GMT",
        },
      }),
    );

    const result = await clientWith(fetchImpl).fetchPage({
      canonicalUrl,
      etag: '"old"',
      lastModified: "Wed, 10 Jun 2026 00:00:00 GMT",
    });

    expect(result).toEqual({
      kind: "content",
      requestedUrl: `${canonicalUrl}.txt`,
      finalUrl: `${canonicalUrl}.txt`,
      sourceFormat: "text",
      contentType: "text/plain",
      body,
      bytes: new TextEncoder().encode(body).byteLength,
      etag: '"abc"',
      lastModified: "Thu, 11 Jun 2026 00:00:00 GMT",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0];
    const requestHeaders = new Headers(init?.headers);
    expect(requestHeaders.get("if-none-match")).toBe('"old"');
    expect(requestHeaders.get("if-modified-since")).toBe(
      "Wed, 10 Jun 2026 00:00:00 GMT",
    );
  });

  it.each([
    new Response("", { status: 404 }),
    new Response("", { status: 406 }),
    new Response("not markdown", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }),
    new Response("", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
    new Response("short unstructured response", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  ])("falls back to HTML for an unusable text response", async (first) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(
        new Response("<main><h1>Apps</h1></main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    const result = await clientWith(fetchImpl).fetchPage({ canonicalUrl });

    expect(result).toMatchObject({
      kind: "content",
      requestedUrl: canonicalUrl,
      finalUrl: canonicalUrl,
      sourceFormat: "html",
      contentType: "text/html",
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${canonicalUrl}.txt`,
      canonicalUrl,
    ]);
  });

  it("returns not_modified without reading or falling back", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 304 }));

    await expect(
      clientWith(fetchImpl).fetchPage({ canonicalUrl }),
    ).resolves.toEqual({
      kind: "not_modified",
      requestedUrl: `${canonicalUrl}.txt`,
      finalUrl: `${canonicalUrl}.txt`,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([404, 410] as const)(
    "returns gone when the canonical HTML page responds %s",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("", { status: 404 }))
        .mockResolvedValueOnce(new Response("", { status }));

      await expect(
        clientWith(fetchImpl).fetchPage({ canonicalUrl }),
      ).resolves.toEqual({
        kind: "gone",
        requestedUrl: canonicalUrl,
        finalUrl: canonicalUrl,
        status,
      });
    },
  );

  it("rejects a cross-origin redirect before issuing another request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/docs/apps.txt" },
      }),
    );

    await expect(
      clientWith(fetchImpl).fetchPage({ canonicalUrl }),
    ).rejects.toMatchObject({
      code: "source_url_not_allowed",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stops after three redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const current = new URL(String(url));
      const count = Number(current.searchParams.get("redirect") ?? "0");
      return new Response(null, {
        status: 302,
        headers: {
          location: `${canonicalUrl}.txt#redirect-${count + 1}`,
        },
      });
    });

    await expect(
      clientWith(fetchImpl).fetchPage({ canonicalUrl }),
    ).rejects.toMatchObject({
      code: "source_redirect_limit",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects a streaming body as soon as it exceeds the byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("# Heading\n"));
        controller.enqueue(new TextEncoder().encode("too large"));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      clientWith(fetchImpl, { maxResponseBytes: 10 }).fetchPage({
        canonicalUrl,
      }),
    ).rejects.toMatchObject({
      code: "source_response_too_large",
      retryable: false,
    });
  });

  it("classifies timeouts as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    await expect(
      clientWith(fetchImpl, { timeoutMs: 5 }).fetchPage({ canonicalUrl }),
    ).rejects.toMatchObject({
      code: "source_timeout",
      retryable: true,
    });
  });

  it.each([429, 500, 503])(
    "classifies HTTP %s as retryable without HTML fallback",
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("unavailable", {
          status,
          headers: status === 429 ? { "retry-after": "60" } : undefined,
        }),
      );

      await expect(
        clientWith(fetchImpl).fetchPage({ canonicalUrl }),
      ).rejects.toMatchObject({
        code: status === 429 ? "source_rate_limited" : "source_server_error",
        retryable: true,
        retryAfterMs: status === 429 ? 60_000 : undefined,
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([401, 403])("classifies HTTP %s as terminal", async (status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("denied", { status }));

    await expect(
      clientWith(fetchImpl).fetchPage({ canonicalUrl }),
    ).rejects.toMatchObject({
      code: "source_access_denied",
      retryable: false,
    });
  });

  it("fetches same-origin text resources for Robots and Sitemap", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<urlset />", {
        headers: { "content-type": "application/xml" },
      }),
    );

    await expect(
      clientWith(fetchImpl).fetchTextResource(
        "https://shopify.dev/sitemap.xml",
      ),
    ).resolves.toMatchObject({
      finalUrl: "https://shopify.dev/sitemap.xml",
      contentType: "application/xml",
      body: "<urlset />",
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(new Headers(init?.headers).get("accept")).toBe(
      "application/xml, text/xml, */*;q=0.1",
    );
  });

  it("wraps network failures as retryable ingestion errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("connection reset"));

    const promise = clientWith(fetchImpl).fetchPage({ canonicalUrl });

    await expect(promise).rejects.toBeInstanceOf(IngestionError);
    await expect(promise).rejects.toMatchObject({
      code: "source_network_error",
      retryable: true,
    });
  });
});
