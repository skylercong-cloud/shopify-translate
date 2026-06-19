import { load, type CheerioAPI } from "cheerio";

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

type HtmlNode = {
  type?: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  parent?: HtmlNode | null;
  children?: HtmlNode[];
};

type ListPayload = {
  ordered: boolean;
  items: Array<{
    text: string;
    children: ListPayload[];
  }>;
};

const CONTENT_SELECTORS = ["main", "article", "[data-docs-content]"];
const BLOCK_SELECTOR =
  "h1,h2,h3,h4,h5,h6,p,ul,ol,table,aside,pre,figure,img";
const BLOCK_NAMES = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "table",
  "aside",
  "pre",
  "figure",
  "img",
]);

function renderInline($: CheerioAPI, nodes: HtmlNode[]) {
  const builder = createInlineBuilder();

  function visit(node: HtmlNode): void {
    if (node.type === "text") {
      builder.append(node.data ?? "");
      return;
    }
    if (node.name === "code") {
      const value = $(node as never).text();
      builder.token(classifyInlineCode(value), value);
      return;
    }
    if (node.name === "a") {
      const value = node.attribs?.href ?? "";
      builder.token("url", value, () => {
        for (const child of node.children ?? []) visit(child);
      });
      return;
    }
    if (node.name === "br") {
      builder.append("\n");
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }

  for (const node of nodes) visit(node);
  return builder.finish();
}

function directTextWithoutNestedLists(
  $: CheerioAPI,
  node: HtmlNode,
): string {
  const clone = $(node as never).clone();
  clone.children("ul,ol").remove();
  return renderInline($, clone.contents().toArray() as HtmlNode[]).text;
}

function parseList(
  $: CheerioAPI,
  node: HtmlNode,
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
    ordered: node.name === "ol",
    items: $(node as never)
      .children("li")
      .toArray()
      .map((item) => ({
        text: directTextWithoutNestedLists($, item as HtmlNode),
        children: $(item)
          .children("ul,ol")
          .toArray()
          .map((child) =>
            parseList($, child as HtmlNode, depth + 1, limits),
          ),
      })),
  };
}

function hasBlockAncestor(node: HtmlNode, root: HtmlNode): boolean {
  let parent = node.parent;
  while (parent && parent !== root) {
    if (parent.name && BLOCK_NAMES.has(parent.name)) return true;
    parent = parent.parent;
  }
  return false;
}

function noticeKind(node: HtmlNode): string {
  const raw =
    node.attribs?.["data-type"] ??
    node.attribs?.class ??
    "note";
  const match = /(note|tip|caution|warning)/i.exec(raw);
  return match?.[1].toLowerCase() ?? "note";
}

export function parseHtmlBlocks(
  body: string,
  limits: ParserLimits,
): ParsedBlock[] {
  const $ = load(body);
  let contentRoot: ReturnType<CheerioAPI> | undefined;

  for (const selector of CONTENT_SELECTORS) {
    const candidates = $(selector);
    if (candidates.length > 1) {
      throw new IngestionError(
        "source_main_content_ambiguous",
        "HTML source has ambiguous main content",
      );
    }
    if (candidates.length === 1) {
      contentRoot = candidates;
      break;
    }
  }
  if (!contentRoot) {
    throw new IngestionError(
      "source_main_content_missing",
      "HTML source has no identifiable main content",
    );
  }

  contentRoot
    .find(
      "nav,footer,script,style,form,button,input,select,textarea,[hidden],[aria-hidden='true']",
    )
    .remove();

  const rootNode = contentRoot.get(0) as HtmlNode;
  const blocks: ParsedBlock[] = [];
  const headings: string[] = [];
  const nodes = contentRoot
    .find(BLOCK_SELECTOR)
    .toArray()
    .filter(
      (node) => !hasBlockAncestor(node as HtmlNode, rootNode),
    ) as HtmlNode[];

  for (const node of nodes) {
    if (/^h[1-6]$/.test(node.name ?? "")) {
      const depth = Number(node.name?.slice(1));
      const sourceText = renderInline(
        $,
        $(node as never).contents().toArray() as HtmlNode[],
      ).text;
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
    if (node.name === "p") {
      const rendered = renderInline(
        $,
        $(node as never).contents().toArray() as HtmlNode[],
      );
      blocks.push({
        type: "paragraph",
        ordinal: 0,
        headingPath,
        sourceText: rendered.text,
        payload: { protectedTokens: rendered.protectedTokens },
        translatable: true,
      });
      continue;
    }

    if (node.name === "ul" || node.name === "ol") {
      const payload = parseList($, node, 1, limits);
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

    if (node.name === "table") {
      const table = $(node as never);
      const headerRow = table.find("thead tr").first();
      const headers = headerRow
        .children("th,td")
        .toArray()
        .map((cell) =>
          renderInline(
            $,
            $(cell).contents().toArray() as HtmlNode[],
          ).text,
        );
      const rows = table
        .find("tbody tr")
        .toArray()
        .map((row) =>
          $(row)
            .children("th,td")
            .toArray()
            .map((cell) =>
              renderInline(
                $,
                $(cell).contents().toArray() as HtmlNode[],
              ).text,
            ),
        );
      blocks.push({
        type: "table",
        ordinal: 0,
        headingPath,
        sourceText: [headers, ...rows]
          .map((row) => row.join("\t"))
          .join("\n"),
        payload: { headers, rows, alignments: [] },
        translatable: true,
      });
      continue;
    }

    if (node.name === "aside") {
      const kind = noticeKind(node);
      const title = `${kind[0].toUpperCase()}${kind.slice(1)}`;
      const raw = normalizeText($(node as never).text());
      const sourceText = raw.replace(
        new RegExp(`^${title}:\\s*`, "i"),
        "",
      );
      blocks.push({
        type: "notice",
        ordinal: 0,
        headingPath,
        sourceText,
        payload: { kind, title },
        translatable: true,
      });
      continue;
    }

    if (node.name === "pre") {
      const code = $(node as never).find("code").first();
      const language =
        /(?:^|\s)language-([^\s]+)/.exec(code.attr("class") ?? "")?.[1] ??
        "";
      blocks.push({
        type: "code",
        ordinal: 0,
        headingPath,
        sourceText: code.text().replace(/\r\n?/g, "\n"),
        payload: { language },
        translatable: false,
      });
      continue;
    }

    if (node.name === "figure" || node.name === "img") {
      const container = $(node as never);
      const image = node.name === "img" ? container : container.find("img").first();
      const alt = image.attr("alt") ?? "";
      const caption =
        node.name === "figure"
          ? normalizeText(container.find("figcaption").first().text())
          : "";
      blocks.push({
        type: "image",
        ordinal: 0,
        headingPath,
        sourceText: [alt, caption].filter(Boolean).join("\n"),
        payload: { src: image.attr("src") ?? "", alt, caption },
        translatable: true,
      });
    }
  }

  return blocks;
}
