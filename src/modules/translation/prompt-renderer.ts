export type TranslationPromptVariables = {
  sourceText: string;
  previousContext: string | null;
  nextContext: string | null;
  protectedTerms: string[];
};

function structuredSource(
  variables: TranslationPromptVariables,
): string {
  return [
    `<previous_context>${JSON.stringify(variables.previousContext)}</previous_context>`,
    `<source_block>${JSON.stringify(variables.sourceText)}</source_block>`,
    `<next_context>${JSON.stringify(variables.nextContext)}</next_context>`,
    `<protected_terms>${JSON.stringify(variables.protectedTerms)}</protected_terms>`,
  ].join("\n");
}

export function renderTranslationPrompt(
  input: TranslationPromptVariables & { template: string },
): string {
  if (!input.template.includes("{{sourceText}}")) {
    throw new Error(
      "Translation prompt template must contain {{sourceText}}",
    );
  }

  return input.template.replaceAll(
    "{{sourceText}}",
    structuredSource(input),
  );
}
