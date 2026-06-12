import type { ProtectedToken } from "@/modules/ingestion/types";

export type InlineBuilder = {
  append(text: string): void;
  token(
    kind: ProtectedToken["kind"],
    value: string,
    render?: () => void,
  ): void;
  finish(): { text: string; protectedTokens: ProtectedToken[] };
};

export function classifyInlineCode(
  value: string,
): ProtectedToken["kind"] {
  if (/\s/.test(value)) return "inline_code";
  if (
    /[\\/]/.test(value) ||
    /\.(?:toml|json|ya?ml|tsx?|jsx?|liquid|graphql|md)$/i.test(value)
  ) {
    return "file_path";
  }
  if (/^[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(value)) {
    return "identifier";
  }
  return "inline_code";
}

export function createInlineBuilder(): InlineBuilder {
  let text = "";
  let pendingSpace = false;
  const protectedTokens: ProtectedToken[] = [];

  function append(value: string): void {
    for (const character of value) {
      if (/\s/.test(character)) {
        pendingSpace = text.length > 0;
        continue;
      }
      if (pendingSpace) {
        text += " ";
        pendingSpace = false;
      }
      text += character;
    }
  }

  return {
    append,
    token(kind, value, render = () => append(value)) {
      const start = text.length + (pendingSpace && text.length > 0 ? 1 : 0);
      render();
      protectedTokens.push({
        kind,
        value,
        start,
        end: text.length,
      });
    },
    finish() {
      return { text, protectedTokens };
    },
  };
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

type ListTextPayload = {
  items: Array<{
    text: string;
    children: ListTextPayload[];
  }>;
};

export function flattenListText(list: ListTextPayload): string {
  const lines: string[] = [];

  function visit(current: ListTextPayload): void {
    for (const item of current.items) {
      if (item.text) lines.push(item.text);
      for (const child of item.children) {
        visit(child);
      }
    }
  }

  visit(list);
  return lines.join("\n");
}
