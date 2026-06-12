import { createServer, type IncomingHttpHeaders } from "node:http";

export type FixtureRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
};

export type FixtureResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
};

type FixtureHandler =
  | FixtureResponse
  | ((request: FixtureRequest) => FixtureResponse | Promise<FixtureResponse>);

export async function startFixtureServer(
  initialRoutes: Record<string, FixtureHandler> = {},
) {
  const routes = new Map(Object.entries(initialRoutes));
  const requests: FixtureRequest[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    const recorded = {
      method: request.method ?? "GET",
      path,
      headers: request.headers,
    };
    requests.push(recorded);
    const handler = routes.get(path);
    if (!handler) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    const result =
      typeof handler === "function" ? await handler(recorded) : handler;
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }
    response.writeHead(result.status ?? 200, result.headers);
    response.end(result.body ?? "");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    requests,
    setRoute(path: string, handler: FixtureHandler) {
      routes.set(path, handler);
    },
    mappedFetch: (async (input, init) => {
      const sourceUrl = new URL(String(input));
      return fetch(`${origin}${sourceUrl.pathname}${sourceUrl.search}`, init);
    }) satisfies typeof fetch,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
