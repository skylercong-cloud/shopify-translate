import type {
  BlockType,
  ProtectedToken,
} from "@/modules/ingestion/types";

const PLACEHOLDER_PATTERN = /⟦P\d{4,}⟧/gu;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u;

export type PlaceholderValidationCode =
  | "placeholder_missing"
  | "placeholder_duplicate"
  | "placeholder_reordered"
  | "placeholder_unknown";

export class PlaceholderValidationError extends Error {
  constructor(readonly code: PlaceholderValidationCode) {
    super(code);
    this.name = "PlaceholderValidationError";
  }
}

export type ProtectedTranslationInput = {
  protectedText: string;
  placeholders: Array<{
    placeholder: string;
    sourceValue: string;
  }>;
  restore(candidate: string): string;
};

type ProtectedSpan = {
  start: number;
  end: number;
};

function overlaps(
  left: ProtectedSpan,
  right: ProtectedSpan,
): boolean {
  return left.start < right.end && right.start < left.end;
}

function characterBefore(value: string, index: number): string {
  if (index <= 0) return "";
  return Array.from(value.slice(0, index)).at(-1) ?? "";
}

function characterAt(value: string, index: number): string {
  if (index >= value.length) return "";
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function isWordCharacter(value: string): boolean {
  return value !== "" && WORD_CHARACTER_PATTERN.test(value);
}

function validateParserTokens(
  sourceText: string,
  parserTokens: ProtectedToken[],
): ProtectedSpan[] {
  const spans = parserTokens
    .map((token) => ({ start: token.start, end: token.end }))
    .sort(
      (left, right) =>
        left.start - right.start || right.end - left.end,
    );
  const normalized: ProtectedSpan[] = [];

  for (const span of spans) {
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > sourceText.length
    ) {
      throw new Error("Invalid parser token offsets");
    }
    const previous = normalized.at(-1);
    if (previous && span.start < previous.end) {
      if (span.end <= previous.end) continue;
      throw new Error("Parser token offsets overlap");
    }
    normalized.push(span);
  }

  return normalized;
}

function literalPlaceholderSpans(
  sourceText: string,
  locked: ProtectedSpan[],
): ProtectedSpan[] {
  return Array.from(sourceText.matchAll(PLACEHOLDER_PATTERN))
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }))
    .filter(
      (candidate) => !locked.some((span) => overlaps(candidate, span)),
    );
}

function glossarySpans(
  sourceText: string,
  glossaryTerms: string[],
  locked: ProtectedSpan[],
): ProtectedSpan[] {
  const lowerSource = sourceText.toLowerCase();
  const normalizedTerms = Array.from(
    new Set(
      glossaryTerms
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const candidates: ProtectedSpan[] = [];

  for (const term of normalizedTerms) {
    let searchFrom = 0;
    while (searchFrom <= lowerSource.length - term.length) {
      const start = lowerSource.indexOf(term, searchFrom);
      if (start === -1) break;
      const end = start + term.length;
      const visibleValue = sourceText.slice(start, end);
      const first = characterAt(visibleValue, 0);
      const last = characterBefore(visibleValue, visibleValue.length);
      const boundaryValid =
        (!isWordCharacter(first) ||
          !isWordCharacter(characterBefore(sourceText, start))) &&
        (!isWordCharacter(last) ||
          !isWordCharacter(characterAt(sourceText, end)));
      const candidate = { start, end };

      if (
        boundaryValid &&
        !locked.some((span) => overlaps(candidate, span))
      ) {
        candidates.push(candidate);
      }
      searchFrom = start + 1;
    }
  }

  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );
  const selected: ProtectedSpan[] = [];
  for (const candidate of candidates) {
    if (!selected.some((span) => overlaps(candidate, span))) {
      selected.push(candidate);
    }
  }
  return selected;
}

function restorePlaceholders(
  candidate: string,
  placeholders: ProtectedTranslationInput["placeholders"],
): string {
  const expected = placeholders.map((item) => item.placeholder);
  const expectedSet = new Set(expected);
  const actual = Array.from(candidate.matchAll(PLACEHOLDER_PATTERN)).map(
    (match) => match[0],
  );

  if (actual.some((placeholder) => !expectedSet.has(placeholder))) {
    throw new PlaceholderValidationError("placeholder_unknown");
  }
  for (const placeholder of expected) {
    const count = actual.filter((value) => value === placeholder).length;
    if (count > 1) {
      throw new PlaceholderValidationError("placeholder_duplicate");
    }
    if (count === 0) {
      throw new PlaceholderValidationError("placeholder_missing");
    }
  }
  if (
    actual.some(
      (placeholder, index) => placeholder !== expected[index],
    )
  ) {
    throw new PlaceholderValidationError("placeholder_reordered");
  }

  const sourceByPlaceholder = new Map(
    placeholders.map((item) => [item.placeholder, item.sourceValue]),
  );
  return candidate.replace(
    PLACEHOLDER_PATTERN,
    (placeholder) => sourceByPlaceholder.get(placeholder) ?? placeholder,
  );
}

export function protectTranslationInput(input: {
  sourceText: string;
  blockKind: BlockType;
  parserTokens: ProtectedToken[];
  glossaryTerms: string[];
}): ProtectedTranslationInput | { translatable: false } {
  if (input.blockKind === "code") {
    return { translatable: false };
  }

  const parserSpans = validateParserTokens(
    input.sourceText,
    input.parserTokens,
  );
  const literalSpans = literalPlaceholderSpans(
    input.sourceText,
    parserSpans,
  );
  const locked = [...parserSpans, ...literalSpans];
  const terms = glossarySpans(
    input.sourceText,
    input.glossaryTerms,
    locked,
  );
  const spans = [...locked, ...terms].sort(
    (left, right) => left.start - right.start,
  );
  const sourcePlaceholders = new Set(
    Array.from(input.sourceText.matchAll(PLACEHOLDER_PATTERN)).map(
      (match) => match[0],
    ),
  );
  const placeholders: ProtectedTranslationInput["placeholders"] = [];
  let placeholderNumber = 1;
  let cursor = 0;
  let protectedText = "";

  for (const span of spans) {
    protectedText += input.sourceText.slice(cursor, span.start);
    let placeholder: string;
    do {
      placeholder = `⟦P${String(placeholderNumber).padStart(4, "0")}⟧`;
      placeholderNumber += 1;
    } while (
      sourcePlaceholders.has(placeholder) ||
      placeholders.some((item) => item.placeholder === placeholder)
    );

    protectedText += placeholder;
    placeholders.push({
      placeholder,
      sourceValue: input.sourceText.slice(span.start, span.end),
    });
    cursor = span.end;
  }
  protectedText += input.sourceText.slice(cursor);

  return {
    protectedText,
    placeholders,
    restore: (candidate) => restorePlaceholders(candidate, placeholders),
  };
}
