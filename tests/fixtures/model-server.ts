import { createServer, type IncomingHttpHeaders } from "node:http";

export type ModelFixtureRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  rawBody: string;
};

type TranslatedText =
  | string
  | ((request: ModelFixtureRequest) => string);

type ModelFixtureScript =
  | {
      kind: "success";
      translatedText: TranslatedText;
      usage: { inputTokens: number; outputTokens: number } | null;
      waitFor?: Promise<void>;
    }
  | {
      kind: "transient_error";
      status: number;
      retryAfter?: string;
    }
  | { kind: "malformed_json" };

const activeServers = new Set<{
  close(): Promise<void>;
}>();

function successBody(
  script: Extract<ModelFixtureScript, { kind: "success" }>,
  request: ModelFixtureRequest,
): string {
  const translatedText =
    typeof script.translatedText === "function"
      ? script.translatedText(request)
      : script.translatedText;

  return JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({ translatedText }),
        },
      },
    ],
    ...(script.usage
      ? {
          usage: {
            prompt_tokens: script.usage.inputTokens,
            completion_tokens: script.usage.outputTokens,
          },
        }
      : {}),
  });
}

export const modelResponse = {
  success(
    translatedText: TranslatedText,
    usage = { inputTokens: 20, outputTokens: 10 },
  ): ModelFixtureScript {
    return { kind: "success", translatedText, usage };
  },

  invalidPlaceholders(
    translatedText: TranslatedText,
  ): ModelFixtureScript {
    return {
      kind: "success",
      translatedText,
      usage: { inputTokens: 20, outputTokens: 10 },
    };
  },

  transientError(
    status = 503,
    retryAfter?: string,
  ): ModelFixtureScript {
    return { kind: "transient_error", status, retryAfter };
  },

  malformedJson(): ModelFixtureScript {
    return { kind: "malformed_json" };
  },

  missingUsage(translatedText: TranslatedText): ModelFixtureScript {
    return { kind: "success", translatedText, usage: null };
  },

  delayedSuccess(
    translatedText: TranslatedText,
    usage = { inputTokens: 20, outputTokens: 10 },
  ): {
    script: ModelFixtureScript;
    release(): void;
  } {
    let release!: () => void;
    const waitFor = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      script: { kind: "success", translatedText, usage, waitFor },
      release,
    };
  },
};

export async function startModelServer(options?: {
  maxRequestBytes?: number;
}) {
  const maxRequestBytes = options?.maxRequestBytes ?? 64 * 1024;
  const requests: ModelFixtureRequest[] = [];
  const scripts: ModelFixtureScript[] = [];
  const server = createServer(async (request, response) => {
    let rawBody = "";
    let bodyBytes = 0;

    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);
      bodyBytes += bytes.byteLength;
      if (bodyBytes > maxRequestBytes) {
        response.writeHead(413, { "content-type": "text/plain" });
        response.end("request too large");
        return;
      }
      rawBody += bytes.toString("utf8");
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("invalid request json");
      return;
    }

    const recorded: ModelFixtureRequest = {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      headers: request.headers,
      body,
      rawBody,
    };
    requests.push(recorded);

    const script = scripts.shift();
    if (!script) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("no scripted model response");
      return;
    }

    if (script.kind === "transient_error") {
      response.writeHead(script.status, {
        "content-type": "application/json",
        ...(script.retryAfter
          ? { "retry-after": script.retryAfter }
          : {}),
      });
      response.end(JSON.stringify({ error: "temporary failure" }));
      return;
    }
    if (script.kind === "malformed_json") {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end("{");
      return;
    }

    await script.waitFor;
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(successBody(script, recorded));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Model fixture server did not bind to a TCP port");
  }

  let closed = false;
  const fixture = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    enqueue(...responses: ModelFixtureScript[]) {
      scripts.push(...responses);
    },
    async close() {
      if (closed) return;
      closed = true;
      activeServers.delete(fixture);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  activeServers.add(fixture);
  return fixture;
}

export async function closeAllModelServers(): Promise<void> {
  await Promise.all(
    Array.from(activeServers, (server) => server.close()),
  );
}
