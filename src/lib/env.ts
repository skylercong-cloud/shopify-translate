import { z } from "zod";

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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: appOriginSchema,
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
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
