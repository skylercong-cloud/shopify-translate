export function normalizeSearchQuery(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function searchTerms(input: string): string[] {
  const normalized = normalizeSearchQuery(input);
  return normalized ? normalized.split(" ") : [];
}

export function buildLikePattern(input: string): string {
  return `%${normalizeSearchQuery(input).replace(/[\\%_]/g, "\\$&")}%`;
}
