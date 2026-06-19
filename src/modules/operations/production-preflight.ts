import { join } from "node:path";

export type ProductionPreflightCheck = {
  message: string;
  name: string;
  status: "fail" | "pass";
};

export type ProductionPreflightResult = {
  checks: ProductionPreflightCheck[];
  ok: boolean;
};

export type ProductionPreflightOptions = {
  cwd: string;
  envFileName?: string;
  fileExists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
};

const requiredDeploymentFiles = [
  "Caddyfile",
  "Dockerfile",
  "compose.production.yaml",
];

const requiredEnvKeys = [
  "DATABASE_URL",
  "APP_ORIGIN",
  "SITE_DOMAIN",
  "POSTGRES_PASSWORD",
  "MODEL_KEY_ENCRYPTION_KEY",
  "SESSION_DAYS",
] as const;

const placeholderFragments = [
  "docs.example.com",
  "replace-with",
  "example-password",
];

function parseDotenv(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return values;
}

function pass(name: string, message: string): ProductionPreflightCheck {
  return { message, name, status: "pass" };
}

function fail(name: string, message: string): ProductionPreflightCheck {
  return { message, name, status: "fail" };
}

function hasPlaceholder(value: string) {
  const lowered = value.toLowerCase();
  return placeholderFragments.some((fragment) => lowered.includes(fragment));
}

function checkEnvValue(
  key: (typeof requiredEnvKeys)[number],
  values: Map<string, string>,
): ProductionPreflightCheck {
  const value = values.get(key)?.trim();
  if (!value) {
    return fail(key, `${key} is required in .env.production`);
  }

  if (hasPlaceholder(value)) {
    return fail(key, `${key} still uses a placeholder value`);
  }

  if (key === "APP_ORIGIN") {
    try {
      const origin = new URL(value);
      if (origin.protocol !== "https:" || origin.pathname !== "/") {
        return fail(key, "APP_ORIGIN must be an HTTPS origin without a path");
      }
    } catch {
      return fail(key, "APP_ORIGIN must be a valid HTTPS origin");
    }
  }

  if (key === "SITE_DOMAIN" && value.includes("://")) {
    return fail(key, "SITE_DOMAIN must be a hostname without a scheme");
  }

  if (key === "SESSION_DAYS") {
    const days = Number(value);
    if (!Number.isSafeInteger(days) || days <= 0 || days > 90) {
      return fail(key, "SESSION_DAYS must be an integer between 1 and 90");
    }
  }

  if (key === "POSTGRES_PASSWORD" && value.length < 20) {
    return fail(key, "POSTGRES_PASSWORD must be at least 20 characters");
  }

  if (key === "MODEL_KEY_ENCRYPTION_KEY" && value.length < 32) {
    return fail(
      key,
      "MODEL_KEY_ENCRYPTION_KEY must be at least 32 characters",
    );
  }

  return pass(key, `${key} is set`);
}

export async function runProductionPreflight(
  options: ProductionPreflightOptions,
): Promise<ProductionPreflightResult> {
  const envFileName = options.envFileName ?? ".env.production";
  const checks: ProductionPreflightCheck[] = [];
  const envPath = join(options.cwd, envFileName);

  const envFileExists = await options.fileExists(envPath);
  checks.push(
    envFileExists
      ? pass(envFileName, `${envFileName} exists`)
      : fail(envFileName, `${envFileName} is missing`),
  );

  for (const fileName of requiredDeploymentFiles) {
    const path = join(options.cwd, fileName);
    const exists = await options.fileExists(path);
    checks.push(
      exists
        ? pass(fileName, `${fileName} exists`)
        : fail(fileName, `${fileName} is missing`),
    );
  }

  if (!envFileExists) {
    return {
      checks,
      ok: false,
    };
  }

  const envText = await options.readTextFile(envPath);
  const envValues = parseDotenv(envText);
  for (const key of requiredEnvKeys) {
    checks.push(checkEnvValue(key, envValues));
  }

  return {
    checks,
    ok: checks.every((check) => check.status === "pass"),
  };
}
