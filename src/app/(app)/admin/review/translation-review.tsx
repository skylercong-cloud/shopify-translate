import Link from "next/link";

import type { TranslationReviewItem } from "@/modules/review/types";

const statusLabels: Record<TranslationReviewItem["status"], string> = {
  pending: "Pending",
  ai_translated: "AI translated",
  manually_corrected: "Manual correction",
  review_required: "Review required",
  failed: "Failed",
  oversized: "Oversized",
};

const revisionSourceLabels: Record<
  NonNullable<TranslationReviewItem["currentRevisionSource"]>,
  string
> = {
  ai: "AI",
  ai_memory: "AI memory",
  global_manual: "Global manual",
  block_manual: "Block manual",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

function ReviewCard({ item }: { item: TranslationReviewItem }) {
  const title = item.pageTitle ?? item.pagePath;
  const heading = item.headingPath.length > 0
    ? item.headingPath.join(" / ")
    : "Document body";

  return (
    <li className="translation-review-card">
      <article>
        <header className="translation-review-card__header">
          <div>
            <Link href={item.pagePath}>{title}</Link>
            <p>
              Block #{item.ordinal + 1} · {item.blockType} · {heading}
            </p>
          </div>
          <div className="translation-review-card__badges">
            <span className="operations-badge">{statusLabels[item.status]}</span>
            {item.currentRevisionSource ? (
              <span>
                {revisionSourceLabels[item.currentRevisionSource]} ·{" "}
                {item.revisionCreatedAt
                  ? formatDate(item.revisionCreatedAt)
                  : "No revision date"}
              </span>
            ) : null}
          </div>
        </header>

        <div className="translation-review-card__diff">
          <section>
            <h3>English source</h3>
            <p>{item.sourceText}</p>
          </section>
          <section>
            <h3>Current Chinese</h3>
            {item.translatedText ? (
              <p>{item.translatedText}</p>
            ) : (
              <p className="translation-review-card__empty">
                No translation yet
              </p>
            )}
          </section>
        </div>

        <form
          aria-label={`Correction form for ${item.blockId}`}
          action="/api/admin/corrections"
          className="translation-review-form"
          method="post"
        >
          <input name="blockId" type="hidden" value={item.blockId} />
          <input
            name="expectedSourceFingerprint"
            type="hidden"
            value={item.sourceFingerprint}
          />
          <input name="returnTo" type="hidden" value="/admin/review" />
          <label>
            <span>Manual translation</span>
            <textarea
              defaultValue={item.translatedText ?? ""}
              name="translatedText"
              required
              rows={4}
            />
          </label>
          <label>
            <span>Scope</span>
            <select defaultValue="block" name="scope">
              <option value="block">block</option>
              <option value="global">global</option>
            </select>
          </label>
          <button type="submit">Save correction</button>
        </form>
      </article>
    </li>
  );
}

export function TranslationReviewPanel({
  items,
}: {
  items: TranslationReviewItem[];
}) {
  return (
    <section className="translation-review-page">
      <p className="eyebrow">Manual review</p>
      <h1>Translation review</h1>
      <p className="translation-review-page__summary">
        Compare cached Shopify.dev source text with the current Chinese
        revision, then publish a block-level or reusable global manual
        correction.
      </p>

      {items.length === 0 ? (
        <p className="operations-empty">No translatable blocks cached yet.</p>
      ) : (
        <ol className="translation-review-list">
          {items.map((item) => (
            <ReviewCard key={item.blockId} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}
