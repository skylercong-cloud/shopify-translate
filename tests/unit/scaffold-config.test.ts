import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import playwrightConfig from "../../playwright.config";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as {
  engines: { node: string };
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

const tsconfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "tsconfig.json"), "utf8"),
) as {
  compilerOptions: { jsx: string };
};

const composeConfig = readFileSync(
  resolve(process.cwd(), "compose.yaml"),
  "utf8",
);

const eslintConfig = readFileSync(
  resolve(process.cwd(), "eslint.config.mjs"),
  "utf8",
);

describe("application scaffold configuration", () => {
  it("uses Corepack for the Playwright development server", () => {
    expect(playwrightConfig.webServer).toMatchObject({
      command:
        "corepack pnpm@10.12.4 exec next dev -H 127.0.0.1 -p 3000",
      env: {
        NODE_ENV: "development",
      },
    });
  });

  it("advertises the Node versions supported by the locked test toolchain", () => {
    expect(packageJson.engines.node).toBe(
      "^20.19.0 || ^22.13.0 || >=24.0.0",
    );
  });

  it("uses Node types matching the minimum supported runtime", () => {
    expect(packageJson.devDependencies["@types/node"]).toBe("^20.19.0");
  });

  it("exposes persistent ingestion worker scripts", () => {
    expect(packageJson.scripts.worker).toBe("tsx src/worker/main.ts");
    expect(packageJson.scripts["worker:dev"]).toBe(
      "tsx watch src/worker/main.ts",
    );
  });

  it("exposes a database backup command", () => {
    expect(packageJson.scripts.backup).toBe("tsx scripts/backup-database.ts");
  });

  it("uses the stable JSX runtime required by Next.js 16 builds", () => {
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
  });

  it("publishes the development database only on the loopback interface", () => {
    expect(composeConfig).toContain('"127.0.0.1:5432:5432"');
  });

  it("keeps generated files from nested worktrees out of linting", () => {
    expect(eslintConfig).toContain('".worktrees/**"');
    expect(eslintConfig).toContain('"work/**"');
    expect(eslintConfig).toContain('"**/.next/**"');
    expect(eslintConfig).toContain('"**/test-results/**"');
  });
});
