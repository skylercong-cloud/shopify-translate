import type {
  ReaderBlock,
  ReaderRevisionSource,
  ReaderTranslationStatus,
} from "./types";

export type ReaderLanguage = "zh" | "en";

export function displayTextForLanguage(
  block: ReaderBlock,
  language: ReaderLanguage,
): string {
  if (language === "zh" && block.translatedText) {
    return block.translatedText;
  }
  return block.sourceText;
}

export function statusLabel(
  status: ReaderTranslationStatus,
  source: ReaderRevisionSource | null,
): string {
  if (status === "manually_corrected") return "Manual correction";
  if (status === "ai_translated") {
    return source === "ai_memory" ? "AI memory" : "AI translated";
  }
  if (status === "review_required") return "Review required";
  if (status === "failed") return "Failed";
  if (status === "oversized") return "Oversized";
  return "Pending";
}

export function codeLanguage(block: ReaderBlock): string | null {
  const language = block.payload.language;
  return typeof language === "string" && language.trim()
    ? language.trim()
    : null;
}
