import type { GlossaryBrowserItem, GlossaryTerm } from "@/modules/glossary/types";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

function TermList({ terms }: { terms: GlossaryTerm[] }) {
  if (terms.length === 0) {
    return <p className="glossary-browser__empty">No terms.</p>;
  }

  return (
    <ul className="glossary-browser__terms">
      {terms.map((term) => (
        <li key={term.normalizedTerm}>{term.sourceTerm}</li>
      ))}
    </ul>
  );
}

function DiffSection({
  title,
  terms,
}: {
  title: string;
  terms: GlossaryTerm[];
}) {
  if (terms.length === 0) return null;

  return (
    <section>
      <h4>{title}</h4>
      <TermList terms={terms} />
    </section>
  );
}

function GlossaryVersionCard({ item }: { item: GlossaryBrowserItem }) {
  const hasDiff =
    item.diff.activeOnlyTerms.length > 0 ||
    item.diff.versionOnlyTerms.length > 0;

  return (
    <li className="glossary-browser-card">
      <article>
        <header className="glossary-browser-card__header">
          <div>
            <h2>Glossary v{item.version}</h2>
            <p>
              {formatNumber(item.terms.length)} terms ·{" "}
              {formatDate(item.createdAt)}
            </p>
          </div>
          {item.active ? (
            <span className="operations-badge operations-badge--ok">
              Active
            </span>
          ) : null}
        </header>

        {item.active ? (
          <p className="glossary-browser-card__note">
            This is the active glossary.
          </p>
        ) : null}

        <section>
          <h3>Terms</h3>
          <TermList terms={item.terms} />
        </section>

        {!item.active ? (
          <div className="glossary-browser-card__diff">
            <DiffSection
              title="Added in active"
              terms={item.diff.activeOnlyTerms}
            />
            <DiffSection
              title="Removed from active"
              terms={item.diff.versionOnlyTerms}
            />
            {!hasDiff ? (
              <p className="glossary-browser-card__note">
                No differences from active glossary.
              </p>
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
  );
}

export function GlossaryBrowser({
  items,
}: {
  items: GlossaryBrowserItem[];
}) {
  return (
    <section className="glossary-browser-page">
      <p className="eyebrow">Terminology audit</p>
      <h1>Glossary versions</h1>
      <p className="glossary-browser-page__summary">
        Review glossary snapshots, inspect complete term lists, and compare old
        snapshots against the active glossary before triggering translation
        work.
      </p>

      {items.length === 0 ? (
        <p className="operations-empty">
          No glossary versions have been activated yet.
        </p>
      ) : (
        <ol className="glossary-browser-list">
          {items.map((item) => (
            <GlossaryVersionCard key={item.id} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}
