import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runProductionPreflight } from "@/modules/operations/production-preflight";

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const envFileName = process.argv[2] ?? ".env.production";
const result = await runProductionPreflight({
  cwd: process.cwd(),
  envFileName,
  fileExists,
  readTextFile: (path) => readFile(resolve(path), "utf8"),
});

for (const check of result.checks) {
  const label = check.status === "pass" ? "PASS" : "FAIL";
  const stream = check.status === "pass" ? console.log : console.error;
  stream(`[${label}] ${check.name}: ${check.message}`);
}

if (!result.ok) {
  process.exitCode = 1;
}
