import { createHash } from "node:crypto";

import type {
  FingerprintedBlock,
  ParsedBlock,
} from "@/modules/ingestion/types";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeProse(value: string): string {
  return normalizeLineEndings(value)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n+ */g, " ")
    .trim();
}

function canonicalize(
  value: unknown,
  normalizeStrings: boolean,
): unknown {
  if (typeof value === "string") {
    return normalizeStrings ? normalizeProse(value) : normalizeLineEndings(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, normalizeStrings));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [
          key,
          canonicalize(item, normalizeStrings),
        ]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function fingerprintBlock(block: ParsedBlock): string {
  const prose = block.type !== "code";
  return sha256({
    type: block.type,
    sourceText: canonicalize(block.sourceText, prose),
    payload: canonicalize(block.payload, prose),
    translatable: block.translatable,
  });
}

export function fingerprintPage(blocks: FingerprintedBlock[]): string {
  return sha256(
    blocks.map((block) => ({
      type: block.type,
      contentFingerprint: block.contentFingerprint,
    })),
  );
}
