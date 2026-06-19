import { IngestionError } from "@/modules/ingestion/errors";
import { parseHtmlBlocks } from "@/modules/ingestion/html-parser";
import { parseMarkdownBlocks } from "@/modules/ingestion/markdown-parser";
import type {
  ParsedPage,
  ParserLimits,
  SourceFormat,
} from "@/modules/ingestion/types";

const DEFAULT_LIMITS: ParserLimits = {
  maxBlocks: 10_000,
  maxNestingDepth: 20,
  maxBlockBytes: 1024 * 1024,
};

export function parseSourcePage(
  input: { body: string; sourceFormat: SourceFormat },
  limits: ParserLimits = DEFAULT_LIMITS,
): ParsedPage {
  if (!input.body.trim()) {
    throw new IngestionError(
      "source_content_empty",
      "Source content is empty",
    );
  }

  const blocks =
    input.sourceFormat === "text"
      ? parseMarkdownBlocks(input.body, limits)
      : parseHtmlBlocks(input.body, limits);

  if (blocks.length > limits.maxBlocks) {
    throw new IngestionError(
      "source_block_count_limit",
      "Source content exceeded the block count limit",
    );
  }
  for (const [ordinal, block] of blocks.entries()) {
    if (
      new TextEncoder().encode(block.sourceText).byteLength >
      limits.maxBlockBytes
    ) {
      throw new IngestionError(
        "source_block_size_limit",
        "Source block size exceeded the configured limit",
      );
    }
    block.ordinal = ordinal;
  }

  const titleBlock = blocks.find((block) => block.type === "heading");
  const proseBlock = blocks.find((block) => block.type === "paragraph");
  if (!titleBlock && !proseBlock) {
    throw new IngestionError(
      "source_content_incomplete",
      "Source content has no heading or natural-language prose",
    );
  }

  return {
    title: titleBlock?.sourceText ?? proseBlock!.sourceText.slice(0, 200),
    blocks,
    sourceFormat: input.sourceFormat,
  };
}
