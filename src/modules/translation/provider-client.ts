import { createHash } from "node:crypto";

import { z } from "zod";

import type { TranslationProvider } from "./config-service";
import { ProviderCallError } from "./provider-errors";

export type TranslationProviderRequest = {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
};

export type TranslationProviderResult = {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
  requestBody: string;
  responseBodyHash: string;
};

export type TranslationProviderClient = {
  translate(
    request: TranslationProviderRequest,
  ): Promise<TranslationProviderResult>;
};

const providerResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

function endpointUrl(baseUrl: string): URL {
  try {
    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL("chat/completions", normalized);
  } catch {
    throw new ProviderCallError(
      "configuration_error",
      "provider_base_url_invalid",
      "Provider base URL is invalid",
    );
  }
}

function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

function classifyHttpStatus(status: number): ProviderCallError {
  const code = `provider_http_${status}`;
  if ([400, 401, 403, 404, 422].includes(status)) {
    return new ProviderCallError(
      "configuration_error",
      code,
      `Provider request failed with HTTP ${status}`,
    );
  }
  if (
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  ) {
    return new ProviderCallError(
      "transient_error",
      code,
      `Provider request failed with HTTP ${status}`,
    );
  }
  return new ProviderCallError(
    "protocol_error",
    code,
    `Provider request failed with HTTP ${status}`,
  );
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderCallError(
        "protocol_error",
        "provider_response_too_large",
        "Provider response exceeded the configured byte limit",
      );
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

function requestBody(
  provider: TranslationProvider,
  request: TranslationProviderRequest,
): string {
  return JSON.stringify({
    model: request.modelId,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    temperature: 0,
    stream: false,
    max_tokens: request.maxOutputTokens,
    response_format: { type: "json_object" },
    ...(provider === "deepseek"
      ? { thinking: { type: "disabled" } }
      : {}),
  });
}

export function createOpenAiCompatibleProviderClient(options: {
  provider: TranslationProvider;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}): TranslationProviderClient {
  const endpoint = endpointUrl(options.baseUrl);
  if (!options.apiKey.trim()) {
    throw new ProviderCallError(
      "configuration_error",
      "provider_api_key_missing",
      "Provider API key is missing",
    );
  }
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isSafeInteger(options.maxResponseBytes) ||
    options.maxResponseBytes <= 0
  ) {
    throw new ProviderCallError(
      "configuration_error",
      "provider_limits_invalid",
      "Provider request limits are invalid",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async translate(request) {
      const serializedRequest = requestBody(options.provider, request);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: serializedRequest,
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          const error = classifyHttpStatus(response.status);
          if (error.kind === "transient_error") {
            throw new ProviderCallError(
              error.kind,
              error.code,
              error.message,
              parseRetryAfter(response.headers.get("retry-after")),
            );
          }
          throw error;
        }

        const responseBody = await readBoundedBody(
          response,
          options.maxResponseBytes,
        );
        let parsed: z.infer<typeof providerResponseSchema>;
        try {
          parsed = providerResponseSchema.parse(JSON.parse(responseBody));
        } catch {
          throw new ProviderCallError(
            "protocol_error",
            "provider_response_invalid",
            "Provider returned an invalid success response",
          );
        }

        return {
          content: parsed.choices[0].message.content,
          usage: parsed.usage
            ? {
                inputTokens: parsed.usage.prompt_tokens,
                outputTokens: parsed.usage.completion_tokens,
              }
            : null,
          requestBody: serializedRequest,
          responseBodyHash: createHash("sha256")
            .update(responseBody, "utf8")
            .digest("hex"),
        };
      } catch (error) {
        if (error instanceof ProviderCallError) throw error;
        if (controller.signal.aborted) {
          throw new ProviderCallError(
            "transient_error",
            "provider_timeout",
            "Provider request timed out",
          );
        }
        throw new ProviderCallError(
          "transient_error",
          "provider_network_error",
          "Provider request failed",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
