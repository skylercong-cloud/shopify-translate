import type { ReaderBlock, ReaderPage } from "@/modules/reader/types";
import {
  codeLanguage,
  displayTextForLanguage,
  statusLabel,
} from "@/modules/reader/render-block";

function blockKey(block: ReaderBlock): string {
  return `${block.ordinal}:${block.id}`;
}

function shouldRenderBlock(block: ReaderBlock, page: ReaderPage): boolean {
  return !(
    block.ordinal === 0 &&
    block.type === "heading" &&
    block.sourceText === page.title
  );
}

function ReaderBlockView({ block }: { block: ReaderBlock }) {
  const text = displayTextForLanguage(block, "zh");
  const status = statusLabel(
    block.translationStatus,
    block.currentRevisionSource,
  );

  if (block.type === "code") {
    const language = codeLanguage(block);
    return (
      <figure className="reader-block reader-block--code">
        {language ? (
          <figcaption>{language}</figcaption>
        ) : null}
        <pre>
          <code>{block.sourceText}</code>
        </pre>
      </figure>
    );
  }

  if (block.type === "heading") {
    return (
      <section className="reader-block reader-block--heading">
        <h2>{text}</h2>
      </section>
    );
  }

  return (
    <section className="reader-block">
      <div className="reader-block__meta">
        <span>{status}</span>
      </div>
      <p>{text}</p>
    </section>
  );
}

export function ReaderDocument({ page }: { page: ReaderPage }) {
  const blocks = page.blocks.filter((block) =>
    shouldRenderBlock(block, page),
  );

  return (
    <article className="reader-document">
      <header className="reader-document__header">
        <p className="reader-document__eyebrow">Cached Shopify.dev document</p>
        <h1>{page.title ?? page.path}</h1>
        <div className="reader-document__actions">
          <a href={page.canonicalUrl} rel="noreferrer" target="_blank">
            Official source
          </a>
          <span>
            {page.summary.translatedCount} translated /{" "}
            {page.summary.blockCount} blocks
          </span>
        </div>
      </header>
      <div className="reader-document__body">
        {blocks.map((block) => (
          <ReaderBlockView block={block} key={blockKey(block)} />
        ))}
      </div>
    </article>
  );
}
