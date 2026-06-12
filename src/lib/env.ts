import { z } from "zod";

import { MAXIMUM_SESSION_DAYS } from "@/modules/auth/constants";

const appOriginSchema = z.string().url().refine(
  (value) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return false;
    }

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  },
  {
    message: "must be an HTTP(S) origin without credentials, path, or query",
  },
);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().url(),
    APP_ORIGIN: appOriginSchema,
    SESSION_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .max(MAXIMUM_SESSION_DAYS)
      .default(30),
    SOURCE_REQUEST_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(4)
      .default(2),
    SOURCE_REQUEST_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(250)
      .default(500),
    SOURCE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(20_000),
    SOURCE_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024)
      .default(8 * 1024 * 1024),
    INGESTION_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .default(1_000),
    INGESTION_LEASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),
  })
  .superRefine((env, context) => {
    if (env.INGESTION_LEASE_MS < env.SOURCE_TIMEOUT_MS * 2) {
      context.addIssue({
        code: "custom",
        path: ["INGESTION_LEASE_MS"],
        message: "must be at least twice SOURCE_TIMEOUT_MS",
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(
  input: NodeJS.ProcessEnv | Record<string, string>,
): AppEnv {
  return envSchema.parse(input);
}

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
