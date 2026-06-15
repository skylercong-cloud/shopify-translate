import type { TranslationConfigService } from "./config-service";
import { decodeMasterKey } from "./encryption";
import type { TranslationAdminService } from "./translation-admin-service";

type ModelCliDependencies = {
  service: TranslationConfigService;
  adminService: TranslationAdminService;
  getMasterKey(): Buffer;
  promptApiKey(provider: "deepseek" | "qwen"): Promise<string>;
  promptNewMasterKey(): Promise<string>;
  readTextFile(path: string): Promise<string>;
  writeOutput(output: string): void;
};

const USAGE = `Usage:
  pnpm model provider set <deepseek|qwen> --model <id> [--base-url <url>]
  pnpm model provider list
  pnpm model budget set --daily-tokens <positive integer>
  pnpm model settings set [--request-timeout-ms <n>] [--max-input-bytes <n>] [--max-output-tokens <n>] [--worker-concurrency <n>]
  pnpm model prompt activate --system-file <path> --user-file <path>
  pnpm model glossary activate --file <path>
  pnpm model readiness
  pnpm model key rotate
  pnpm model correction add --block-id <uuid> --file <path> [--scope global|block]
  pnpm model correction history --block-id <uuid>
  pnpm model retranslate --block-id <uuid>
  pnpm model retranslate --page <canonical path>
  pnpm model retranslate --all --confirm-all`;

function parseOptions(
  args: string[],
  allowed: readonly string[],
): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(USAGE);
    }
    if (!allowed.includes(name)) {
      throw new Error(`Unsupported option ${name}\n${USAGE}`);
    }
    if (options.has(name)) {
      throw new Error(`Duplicate option ${name}`);
    }
    options.set(name, value);
  }
  return options;
}

function requireOption(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) {
    throw new Error(`Missing required option ${name}\n${USAGE}`);
  }
  return value;
}

function parseInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function parseRetranslationTarget(args: string[]): {
  target: { blockId?: string; pagePath?: string; all?: boolean };
  confirmAll: boolean;
} {
  const target: {
    blockId?: string;
    pagePath?: string;
    all?: boolean;
  } = {};
  let confirmAll = false;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--all") {
      if (target.all) throw new Error("Duplicate option --all");
      target.all = true;
      continue;
    }
    if (option === "--confirm-all") {
      if (confirmAll) throw new Error("Duplicate option --confirm-all");
      confirmAll = true;
      continue;
    }
    if (option === "--block-id" || option === "--page") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing required value for ${option}\n${USAGE}`);
      }
      if (option === "--block-id") {
        if (target.blockId) {
          throw new Error("Duplicate option --block-id");
        }
        target.blockId = value;
      } else {
        if (target.pagePath) throw new Error("Duplicate option --page");
        target.pagePath = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option ${option}\n${USAGE}`);
  }

  return { target, confirmAll };
}

function publicProvider(
  provider: Awaited<
    ReturnType<TranslationConfigService["loadWorkerReadiness"]>
  >["deepseek"],
) {
  return {
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    modelId: provider.modelId,
    keyHint: provider.keyHint,
    enabled: provider.enabled,
    apiKeyConfigured: true,
  };
}

export async function runModelCli(
  args: string[],
  dependencies: ModelCliDependencies,
): Promise<void> {
  if (args.includes("--api-key")) {
    throw new Error(
      "--api-key is not supported; API keys must be entered through the masked prompt",
    );
  }

  const [group, command, subject, ...rest] = args;

  if (group === "provider" && command === "set") {
    if (subject !== "deepseek" && subject !== "qwen") {
      throw new Error(USAGE);
    }
    const options = parseOptions(rest, ["--model", "--base-url"]);
    const modelId = requireOption(options, "--model");
    const masterKey = dependencies.getMasterKey();
    const apiKey = await dependencies.promptApiKey(subject);
    await dependencies.service.configureProvider(
      {
        provider: subject,
        modelId,
        apiKey,
        baseUrl: options.get("--base-url"),
      },
      masterKey,
    );
    dependencies.writeOutput(`${subject} provider configured.`);
    return;
  }

  if (
    group === "provider" &&
    command === "list" &&
    subject === undefined
  ) {
    const [providers, settings] = await Promise.all([
      dependencies.service.listProviders(),
      dependencies.service.getSettings(),
    ]);
    dependencies.writeOutput(
      JSON.stringify({ providers, settings }, null, 2),
    );
    return;
  }

  if (group === "budget" && command === "set") {
    const options = parseOptions(
      subject === undefined ? rest : [subject, ...rest],
      ["--daily-tokens"],
    );
    await dependencies.service.updateSettings({
      dailyTokenLimit: parseInteger(
        requireOption(options, "--daily-tokens"),
        "--daily-tokens",
      ),
    });
    dependencies.writeOutput("Daily token budget updated.");
    return;
  }

  if (group === "settings" && command === "set") {
    const options = parseOptions(
      subject === undefined ? rest : [subject, ...rest],
      [
        "--request-timeout-ms",
        "--max-input-bytes",
        "--max-output-tokens",
        "--worker-concurrency",
      ],
    );
    const values = {
      requestTimeoutMs: options.has("--request-timeout-ms")
        ? parseInteger(
            options.get("--request-timeout-ms")!,
            "--request-timeout-ms",
          )
        : undefined,
      maxInputBytes: options.has("--max-input-bytes")
        ? parseInteger(
            options.get("--max-input-bytes")!,
            "--max-input-bytes",
          )
        : undefined,
      maxOutputTokens: options.has("--max-output-tokens")
        ? parseInteger(
            options.get("--max-output-tokens")!,
            "--max-output-tokens",
          )
        : undefined,
      workerConcurrency: options.has("--worker-concurrency")
        ? parseInteger(
            options.get("--worker-concurrency")!,
            "--worker-concurrency",
          )
        : undefined,
    };
    await dependencies.service.updateSettings(
      Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      ),
    );
    dependencies.writeOutput("Translation settings updated.");
    return;
  }

  if (group === "prompt" && command === "activate") {
    const options = parseOptions(
      subject === undefined ? rest : [subject, ...rest],
      ["--system-file", "--user-file"],
    );
    const [systemPrompt, userPromptTemplate] = await Promise.all([
      dependencies.readTextFile(
        requireOption(options, "--system-file"),
      ),
      dependencies.readTextFile(requireOption(options, "--user-file")),
    ]);
    const activated = await dependencies.service.activatePrompt({
      systemPrompt,
      userPromptTemplate,
    });
    dependencies.writeOutput(
      `Prompt version ${activated.version} activated.`,
    );
    return;
  }

  if (group === "glossary" && command === "activate") {
    const options = parseOptions(
      subject === undefined ? rest : [subject, ...rest],
      ["--file"],
    );
    const body = await dependencies.readTextFile(
      requireOption(options, "--file"),
    );
    const activated = await dependencies.service.activateGlossary({
      terms: body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
    dependencies.writeOutput(
      `Glossary version ${activated.version} activated.`,
    );
    return;
  }

  if (
    group === "key" &&
    command === "rotate" &&
    subject === undefined
  ) {
    const currentKey = dependencies.getMasterKey();
    const nextKey = decodeMasterKey(
      await dependencies.promptNewMasterKey(),
    );
    const rotated = await dependencies.service.rotateMasterKey(
      currentKey,
      nextKey,
    );
    dependencies.writeOutput(`Rotated provider keys: ${rotated}.`);
    return;
  }

  if (
    group === "readiness" &&
    command === undefined &&
    subject === undefined
  ) {
    const readiness = await dependencies.service.loadWorkerReadiness(
      dependencies.getMasterKey(),
    );
    dependencies.writeOutput(
      JSON.stringify(
        {
          ready: true,
          providers: {
            deepseek: publicProvider(readiness.deepseek),
            qwen: readiness.qwen
              ? publicProvider(readiness.qwen)
              : null,
          },
          promptVersion: readiness.prompt.version,
          glossaryVersion: readiness.glossary.version,
          glossaryTerms: readiness.glossary.terms.length,
          settings: readiness.settings,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (group === "correction" && command === "add") {
    const options = parseOptions(
      subject === undefined ? rest : [subject, ...rest],
      ["--block-id", "--file", "--scope"],
    );
    const scope = options.get("--scope") ?? "global";
    if (scope !== "global" && scope !== "block") {
      throw new Error("--scope must be global or block");
    }
    const translatedText = await dependencies.readTextFile(
      requireOption(options, "--file"),
    );
    await dependencies.adminService.recordManualCorrection({
      blockId: requireOption(options, "--block-id"),
      translatedText,
      scope,
    });
    dependencies.writeOutput("Manual correction recorded.");
    return;
  }

  if (group === "correction" && command === "history") {
    const options = parseOptions(
      subject === undefined ? rest : [subject, ...rest],
      ["--block-id"],
    );
    const history =
      await dependencies.adminService.listCorrectionHistory(
        requireOption(options, "--block-id"),
      );
    dependencies.writeOutput(
      `Correction history entries: ${history.length}.`,
    );
    return;
  }

  if (group === "retranslate") {
    const rawOptions = [command, subject, ...rest].filter(
      (value): value is string => value !== undefined,
    );
    const { target, confirmAll } =
      parseRetranslationTarget(rawOptions);
    if (target.all && !confirmAll) {
      throw new Error(
        "--confirm-all is required with --all retranslation",
      );
    }
    const result =
      await dependencies.adminService.enqueueRetranslation(target);
    dependencies.writeOutput(
      `Retranslation targeted=${result.targeted} created=${result.created} deduplicated=${result.deduplicated} promoted=${result.promoted}.`,
    );
    return;
  }

  throw new Error(USAGE);
}
