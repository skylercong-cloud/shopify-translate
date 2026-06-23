import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

import { IngestionError } from "@/modules/ingestion/errors";
import {
  classifyInlineCode,
  createInlineBuilder,
  flattenListText,
  normalizeText,
} from "@/modules/ingestion/inline-content";
import type {
  ParsedBlock,
  ParserLimits,
} from "@/modules/ingestion/types";

type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  url?: string;
  alt?: string | null;
  title?: string | null;
  lang?: string | null;
  align?: Array<"left" | "right" | "center" | null>;
  children?: MarkdownNode[];
};

type ListPayload = {
  ordered: boolean;
  items: Array<{
    text: string;
    children: ListPayload[];
  }>;
};

function renderInline(nodes: MarkdownNode[]) {
  const builder = createInlineBuilder();

  function visit(node: MarkdownNode): void {
    if (node.type === "text") {
      builder.append(node.value ?? "");
      return;
    }
    if (node.type === "inlineCode") {
      const value = node.value ?? "";
      builder.token(classifyInlineCode(value), value);
      return;
    }
    if (node.type === "link") {
      const value = node.url ?? "";
      builder.token("url", value, () => {
        for (const child of node.children ?? []) visit(child);
      });
      return;
    }
    if (node.type === "image") {
      const value = node.url ?? "";
      builder.token("url", value, () => builder.append(node.alt ?? ""));
      return;
    }
    if (node.type === "break") {
      builder.append("\n");
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }

  for (const node of nodes) visit(node);
  return builder.finish();
}

function renderBlockText(node: MarkdownNode): string {
  if (node.children) {
    return renderInline(node.children).text;
  }
  return normalizeText(node.value ?? "");
}

function parseList(
  node: MarkdownNode,
  depth: number,
  limits: ParserLimits,
): ListPayload {
  if (depth > limits.maxNestingDepth) {
    throw new IngestionError(
      "source_nesting_limit",
      "Source content exceeded the nesting limit",
    );
  }

  return {
    ordered: node.ordered === true,
    items: (node.children ?? [])
      .filter((child) => child.type === "listItem")
      .map((item) => {
        const text = (item.children ?? [])
          .filter((child) => child.type !== "list")
          .map(renderBlockText)
          .filter(Boolean)
          .join(" ");
        const children = (item.children ?? [])
          .filter((child) => child.type === "list")
          .map((child) => parseList(child, depth + 1, limits));
        return { text, children };
      }),
  };
}

function tableCellText(node: MarkdownNode): string {
  return renderInline(node.children ?? []).text;
}

function noticeFromBlockquote(
  node: MarkdownNode,
): { kind: string; title: string; text: string } | undefined {
  const text = (node.children ?? []).map(renderBlockText).join(" ");
  const match = /^(Note|Tip|Caution|Warning):\s*(.+)$/i.exec(text);
  if (!match) return undefined;
  const title = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
  return { kind: title.toLowerCase(), title, text: match[2] };
}

export function parseMarkdownBlocks(
  body: string,
  limits: ParserLimits,
): ParsedBlock[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .parse(body) as MarkdownNode;
  const blocks: ParsedBlock[] = [];
  const headings: string[] = [];

  for (const node of tree.children ?? []) {
    if (node.type === "heading") {
      const depth = node.depth ?? 1;
      const sourceText = renderInline(node.children ?? []).text;
      headings.length = depth;
      headings[depth - 1] = sourceText;
      blocks.push({
        type: "heading",
        ordinal: 0,
        headingPath: headings.filter(Boolean),
        sourceText,
        payload: { depth },
        translatable: true,
      });
      continue;
    }

    const headingPath = headings.filter(Boolean);
    if (node.type === "paragraph") {
      if (
        node.children?.length === 1 &&
        node.children[0].type === "image"
      ) {
        const image = node.children[0];
        const alt = image.alt ?? "";
        const caption = image.title ?? "";
        blocks.push({
          type: "image",
          ordinal: 0,
          headingPath,
          sourceText: [alt, caption].filter(Boolean).join("\n"),
          payload: { src: image.url ?? "", alt, caption },
          translatable: true,
        });
      } else {
        const rendered = renderInline(node.children ?? []);
        blocks.push({
          type: "paragraph",
          ordinal: 0,
          headingPath,
          sourceText: rendered.text,
          payload: { protectedTokens: rendered.protectedTokens },
          translatable: true,
        });
      }
      continue;
    }

    if (node.type === "list") {
      const payload = parseList(node, 1, limits);
      blocks.push({
        type: "list",
        ordinal: 0,
        headingPath,
        sourceText: flattenListText(payload),
        payload,
        translatable: true,
      });
      continue;
    }

    if (node.type === "table") {
      const rows = (node.children ?? []).map((row) =>
        (row.children ?? []).map(tableCellText),
      );
      blocks.push({
        type: "table",
        ordinal: 0,
        headingPath,
        sourceText: rows.map((row) => row.join("\t")).join("\n"),
        payload: {
          headers: rows[0] ?? [],
          rows: rows.slice(1),
          alignments: node.align ?? [],
        },
        translatable: true,
      });
      continue;
    }

    if (node.type === "blockquote") {
      const notice = noticeFromBlockquote(node);
      if (notice) {
        blocks.push({
          type: "notice",
          ordinal: 0,
          headingPath,
          sourceText: notice.text,
          payload: { kind: notice.kind, title: notice.title },
          translatable: true,
        });
      }
      continue;
    }

    if (node.type === "code") {
      blocks.push({
        type: "code",
        ordinal: 0,
        headingPath,
        sourceText: (node.value ?? "").replace(/\r\n?/g, "\n"),
        payload: { language: node.lang ?? "" },
        translatable: false,
      });
    }
  }

  return blocks;
}
