import { z } from "zod";

import {
  PlaceholderValidationError,
  type PlaceholderValidationCode,
  type ProtectedTranslationInput,
} from "./protection";

export type TranslationOutputValidationCode =
  | "invalid_json"
  | "empty_translation"
  | "response_too_large"
  | PlaceholderValidationCode;

export class TranslationOutputValidationError extends Error {
  constructor(readonly code: TranslationOutputValidationCode) {
    super(code);
    this.name = "TranslationOutputValidationError";
  }
}

const translationResponseSchema = z
  .object({
    translatedText: z.string(),
  })
  .strict();

export function validateTranslationOutput(input: {
  content: string;
  protectedInput: ProtectedTranslationInput;
  maxResponseBytes: number;
}): { translatedText: string } {
  if (
    Buffer.byteLength(input.content, "utf8") > input.maxResponseBytes
  ) {
    throw new TranslationOutputValidationError("response_too_large");
  }

  let parsed: z.infer<typeof translationResponseSchema>;
  try {
    parsed = translationResponseSchema.parse(JSON.parse(input.content));
  } catch {
    throw new TranslationOutputValidationError("invalid_json");
  }
  if (parsed.translatedText.trim().length === 0) {
    throw new TranslationOutputValidationError("empty_translation");
  }

  try {
    return {
      translatedText: input.protectedInput.restore(
        parsed.translatedText,
      ),
    };
  } catch (error) {
    if (error instanceof PlaceholderValidationError) {
      throw new TranslationOutputValidationError(error.code);
    }
    throw error;
  }
}
