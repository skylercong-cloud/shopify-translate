import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiCompatibleProviderClient,
  type TranslationProviderRequest,
} from "@/modules/translation/provider-client";
import { ProviderCallError } from "@/modules/translation/provider-errors";

const request: TranslationProviderRequest = {
  modelId: "explicit-model",
  systemPrompt: "Translate safely.",
  userPrompt: "Translate this block.",
  maxOutputTokens: 2_048,
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function client(
  provider: "deepseek" | "qwen",
  fetchImpl: typeof fetch,
  overrides: Partial<{
    timeoutMs: number;
    maxResponseBytes: number;
  }> = {},
) {
  return createOpenAiCompatibleProviderClient({
    provider,
    baseUrl:
      provider === "deepseek"
        ? "https://api.deepseek.com"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-private-key",
    timeoutMs: overrides.timeoutMs ?? 1_000,
    maxResponseBytes: overrides.maxResponseBytes ?? 4_096,
    fetchImpl,
  });
}

describe("OpenAI-compatible translation provider", () => {
  it("sends the bounded DeepSeek JSON request with thinking disabled", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: '{"translatedText":"ok"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
    ) as unknown as typeof fetch;

    const result = await client("deepseek", fetchImpl).translate(request);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(String(url)).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(init?.headers).toMatchObject({
      authorization: "Bearer sk-private-key",
      "content-type": "application/json",
    });
    expect(body).toEqual({
      model: "explicit-model",
      messages: [
        { role: "system", content: "Translate safely." },
        { role: "user", content: "Translate this block." },
      ],
      temperature: 0,
      stream: false,
      max_tokens: 2_048,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(result).toMatchObject({
      content: '{"translatedText":"ok"}',
      usage: { inputTokens: 10, outputTokens: 4 },
      requestBody: JSON.stringify(body),
      responseBodyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("uses the Qwen path without DeepSeek-only fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: '{"translatedText":"ok"}' } }],
      }),
    ) as unknown as typeof fetch;

    const result = await client("qwen", fetchImpl).translate(request);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(String(url)).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(body).not.toHaveProperty("thinking");
    expect(result.usage).toBeNull();
  });

  it("aborts requests that exceed the timeout", async () => {
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    await expect(
      client("deepseek", fetchImpl, { timeoutMs: 5 }).translate(request),
    ).rejects.toMatchObject({
      kind: "transient_error",
      code: "provider_timeout",
    });
  });

  it("stops reading a success response above the byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":['));
        controller.enqueue(new TextEncoder().encode("x".repeat(100)));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream)) as unknown as typeof fetch;

    await expect(
      client("deepseek", fetchImpl, {
        maxResponseBytes: 20,
      }).translate(request),
    ).rejects.toMatchObject({
      kind: "protocol_error",
      code: "provider_response_too_large",
    });
  });

  it.each([
    [400, "configuration_error"],
    [401, "configuration_error"],
    [403, "configuration_error"],
    [404, "configuration_error"],
    [422, "configuration_error"],
    [408, "transient_error"],
    [429, "transient_error"],
    [500, "transient_error"],
    [503, "transient_error"],
  ] as const)("classifies HTTP %s as %s", async (status, kind) => {
    const fetchImpl = vi.fn(async () =>
      new Response("provider details", {
        status,
        headers:
          status === 429 ? { "retry-after": "2" } : undefined,
      }),
    ) as unknown as typeof fetch;

    try {
      await client("deepseek", fetchImpl).translate(request);
      throw new Error("Expected provider call to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderCallError);
      expect(error).toMatchObject({
        kind,
        code: `provider_http_${status}`,
        ...(status === 429 ? { retryAfterMs: 2_000 } : {}),
      });
    }
  });

  it("rejects malformed successful payloads as protocol errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [] }),
    ) as unknown as typeof fetch;

    await expect(
      client("deepseek", fetchImpl).translate(request),
    ).rejects.toMatchObject({
      kind: "protocol_error",
      code: "provider_response_invalid",
    });
  });

  it("does not expose credentials or provider bodies in errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("sk-private-key provider-secret-body", {
        status: 401,
      }),
    ) as unknown as typeof fetch;

    try {
      await client("deepseek", fetchImpl).translate(request);
      throw new Error("Expected provider call to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sk-private-key");
      expect(message).not.toContain("provider-secret-body");
      expect(message).not.toContain(request.userPrompt);
    }
  });
});
