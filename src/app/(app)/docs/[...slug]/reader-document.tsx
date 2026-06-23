import Link from "next/link";
import type { ReactNode } from "react";

import type { ReaderBlock, ReaderPage } from "@/modules/reader/types";
import {
  codeLanguage,
  displayTextForLanguage,
} from "@/modules/reader/render-block";
import type { ReaderLanguage } from "@/modules/reader/render-block";

import { LanguageSwitch } from "./language-switch";

type ListPayload = {
  ordered: boolean;
  items: Array<{
    text: string;
    children: ListPayload[];
  }>;
};

function blockKey(block: ReaderBlock): string {
  return `${block.ordinal}:${block.id}`;
}

function blockAnchor(block: ReaderBlock): string {
  return `reader-block-${block.id}`;
}

function shouldRenderBlock(block: ReaderBlock, page: ReaderPage): boolean {
  return !(
    block.ordinal === 0 &&
    block.type === "heading" &&
    block.sourceText === page.title
  );
}

function InlineReaderText({ block }: { block: ReaderBlock }) {
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

function LanguageVariant({
  language,
  children,
}: {
  language: ReaderLanguage;
  children: ReactNode;
}) {
  return (
    <div data-reader-language={language} hidden={language === "en"}>
      {children}
    </div>
  );
}

function isListPayload(value: unknown): value is ListPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ListPayload>;
  return typeof candidate.ordered === "boolean" && Array.isArray(candidate.items);
}

function ListContent({
  payload,
  text,
}: {
  payload: ListPayload;
  text: string;
}) {
  const lines = text.split("\n");
  let lineIndex = 0;

  function renderList(list: ListPayload, path: string): ReactNode {
    const items = list.items.map((item, index) => {
      const itemPath = `${path}-${index}`;
      const label = lines[lineIndex] ?? item.text;
      lineIndex += 1;
      return (
        <li key={itemPath}>
          {label}
          {item.children.map((child, childIndex) =>
            renderList(child, `${itemPath}-${childIndex}`),
          )}
        </li>
      );
    });
    return list.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }

  return renderList(payload, "list");
}

function ListBlock({ block }: { block: ReaderBlock }) {
  if (!isListPayload(block.payload)) {
    return <p><InlineReaderText block={block} /></p>;
  }

  return (
    <>
      <LanguageVariant language="zh">
        <ListContent
          payload={block.payload}
          text={displayTextForLanguage(block, "zh")}
        />
      </LanguageVariant>
      <LanguageVariant language="en">
        <ListContent payload={block.payload} text={block.sourceText} />
      </LanguageVariant>
    </>
  );
}

function rowsFromText(text: string): string[][] {
  return text.split("\n").map((row) => row.split("\t"));
}

function TableContent({ text }: { text: string }) {
  const [headers = [], ...rows] = rowsFromText(text);
  return (
    <div className="reader-table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={`${index}:${header}`} scope="col">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${cellIndex}:${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableBlock({ block }: { block: ReaderBlock }) {
  return (
    <>
      <LanguageVariant language="zh">
        <TableContent text={displayTextForLanguage(block, "zh")} />
      </LanguageVariant>
      <LanguageVariant language="en">
        <TableContent text={block.sourceText} />
      </LanguageVariant>
    </>
  );
}

function NoticeBlock({ block }: { block: ReaderBlock }) {
  const title = typeof block.payload.title === "string"
    ? block.payload.title
    : "Note";
  const kind = typeof block.payload.kind === "string"
    ? block.payload.kind
    : "note";
  return (
    <aside className={`reader-notice reader-notice--${kind}`}>
      <strong>{title}</strong>
      <p><InlineReaderText block={block} /></p>
    </aside>
  );
}

function safeImageSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function ImageBlock({ block }: { block: ReaderBlock }) {
  const src = safeImageSource(block.payload.src);
  const text = displayTextForLanguage(block, "zh");
  const [alt = "", caption = ""] = text.split("\n", 2);
  return (
    <figure className="reader-block--image">
      {src ? (
        // Shopify documentation images use dynamic CDN hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={alt} loading="lazy" src={src} />
      ) : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

function ReaderBlockView({ block }: { block: ReaderBlock }) {
  if (block.type === "code") {
    const language = codeLanguage(block);
    return (
      <figure className="reader-block reader-block--code">
        {language ? <figcaption>{language}</figcaption> : null}
        <pre><code>{block.sourceText}</code></pre>
      </figure>
    );
  }

  const id = blockAnchor(block);
  if (block.type === "heading") {
    const depth = typeof block.payload.depth === "number"
      ? block.payload.depth
      : 2;
    return (
      <section
        className={`reader-block reader-block--heading reader-block--heading-${Math.min(depth, 6)}`}
        data-translation-status={block.translationStatus}
        id={id}
      >
        <h2><InlineReaderText block={block} /></h2>
      </section>
    );
  }

  let content: ReactNode;
  if (block.type === "list") content = <ListBlock block={block} />;
  else if (block.type === "table") content = <TableBlock block={block} />;
  else if (block.type === "notice") content = <NoticeBlock block={block} />;
  else if (block.type === "image") content = <ImageBlock block={block} />;
  else content = <p><InlineReaderText block={block} /></p>;

  return (
    <section
      className={`reader-block reader-block--${block.type}`}
      data-translation-status={block.translationStatus}
      id={id}
    >
      {content}
    </section>
  );
}

function formatSyncTime(value: Date | null): string {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

export function ReaderDocument({ page }: { page: ReaderPage }) {
  const titleBlock = page.blocks.find(
    (block) => block.type === "heading" && block.sourceText === page.title,
  );
  const blocks = page.blocks.filter((block) => shouldRenderBlock(block, page));
  const headings = blocks.filter((block) => block.type === "heading");
  const articleId = `reader-document-${page.id}`;

  return (
    <article
      className="reader-document"
      data-language="zh"
      id={articleId}
    >
      <header className="reader-document__header">
        <p className="reader-document__eyebrow">Shopify.dev 中文文档</p>
        <h1>
          {titleBlock ? (
            <InlineReaderText block={titleBlock} />
          ) : (
            page.title ?? page.path
          )}
        </h1>
        <div className="reader-document__actions">
          <a href={page.canonicalUrl} rel="noreferrer" target="_blank">
            官方原文
          </a>
          <Link href="/admin/review">管理译文</Link>
          <span>{page.summary.translatedCount} / {page.summary.blockCount} 个内容块已翻译</span>
          <span>同步于 {formatSyncTime(page.lastSuccessAt)}</span>
          <LanguageSwitch targetId={articleId} />
        </div>
      </header>

      {headings.length > 0 ? (
        <details className="reader-table-of-contents">
          <summary>本页目录</summary>
          <ol>
            {headings.map((heading) => (
              <li key={heading.id}>
                <a href={`#${blockAnchor(heading)}`}>
                  <InlineReaderText block={heading} />
                </a>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <div className="reader-document__body">
        {blocks.map((block) => (
          <ReaderBlockView block={block} key={blockKey(block)} />
        ))}
      </div>
    </article>
  );
}
