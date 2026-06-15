import type { ReaderBlock, ReaderPage } from "@/modules/reader/types";
import {
  codeLanguage,
  displayTextForLanguage,
  statusLabel,
} from "@/modules/reader/render-block";
import { LanguageSwitch } from "./language-switch";

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

function ReaderText({ block }: { block: ReaderBlock }) {
  return (
    <>
      <span data-reader-language="zh">
        {displayTextForLanguage(block, "zh")}
      </span>
      <span data-reader-language="en" hidden>
        {displayTextForLanguage(block, "en")}
      </span>
    </>
  );
}

function ReaderBlockView({ block }: { block: ReaderBlock }) {
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
        <h2>
          <ReaderText block={block} />
        </h2>
      </section>
    );
  }

  return (
    <section className="reader-block">
      <div className="reader-block__meta">
        <span>{status}</span>
      </div>
      <p>
        <ReaderText block={block} />
      </p>
    </section>
  );
}

export function ReaderDocument({ page }: { page: ReaderPage }) {
  const blocks = page.blocks.filter((block) =>
    shouldRenderBlock(block, page),
  );
  const bodyId = `reader-body-${page.id}`;

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
          <LanguageSwitch targetId={bodyId} />
        </div>
      </header>
      <div
        className="reader-document__body"
        data-language="zh"
        id={bodyId}
      >
        {blocks.map((block) => (
          <ReaderBlockView block={block} key={blockKey(block)} />
        ))}
      </div>
    </article>
  );
}
