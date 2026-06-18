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

function CorrectionForm({
  block,
  returnTo,
}: {
  block: ReaderBlock;
  returnTo: string;
}) {
  if (!block.translatable) return null;

  return (
    <form
      aria-label={`Correction form for ${block.id}`}
      action="/api/admin/corrections"
      className="reader-correction-form"
      method="post"
    >
      <input name="blockId" type="hidden" value={block.id} />
      <input
        name="expectedSourceFingerprint"
        type="hidden"
        value={block.fingerprint}
      />
      <input name="returnTo" type="hidden" value={returnTo} />
      <label>
        <span>Manual translation</span>
        <textarea
          defaultValue={block.translatedText ?? ""}
          name="translatedText"
          rows={4}
        />
      </label>
      <label>
        <span>Scope</span>
        <select defaultValue="global" name="scope">
          <option value="global">global</option>
          <option value="block">block</option>
        </select>
      </label>
      <button type="submit">保存人工修正</button>
    </form>
  );
}

function ReaderBlockView({
  block,
  returnTo,
}: {
  block: ReaderBlock;
  returnTo: string;
}) {
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
        <div className="reader-block__meta">
          <span>{status}</span>
          <span>Block ID: {block.id}</span>
        </div>
        <h2>
          <ReaderText block={block} />
        </h2>
        <CorrectionForm block={block} returnTo={returnTo} />
      </section>
    );
  }

  return (
    <section className="reader-block">
      <div className="reader-block__meta">
        <span>{status}</span>
        <span>Block ID: {block.id}</span>
      </div>
      <p>
        <ReaderText block={block} />
      </p>
      <CorrectionForm block={block} returnTo={returnTo} />
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
          <ReaderBlockView
            block={block}
            key={blockKey(block)}
            returnTo={page.path}
          />
        ))}
      </div>
    </article>
  );
}
