import type {
  ReaderSearchResult,
  SearchMatchKind,
} from "@/modules/search/types";

const MATCH_LABELS: Record<SearchMatchKind, string> = {
  identifier: "Exact identifier",
  path: "Path",
  source: "English source",
  title: "Title",
  translation: "Chinese translation",
};

export function SearchForm({ query = "" }: { query?: string }) {
  return (
    <form action="/search" className="search-form">
      <label htmlFor="reader-search">Search cached Shopify.dev docs</label>
      <div className="search-form__controls">
        <input
          defaultValue={query}
          id="reader-search"
          name="q"
          placeholder="中文、English 或 productCreate"
          type="search"
        />
        <button type="submit">Search</button>
      </div>
    </form>
  );
}

export function SearchResults({
  query,
  results,
}: {
  query: string;
  results: ReaderSearchResult[];
}) {
  const hasQuery = query.length > 0;

  return (
    <section className="search-page">
      <SearchForm query={query} />

      {!hasQuery ? (
        <div className="search-state">
          <p className="eyebrow">Chinese + English</p>
          <h1>统一搜索 Shopify 文档</h1>
          <p>
            输入中文译文、英文原文，或像 productCreate 这样的 API
            标识符，搜索本地已缓存的 Shopify.dev 文档。
          </p>
        </div>
      ) : null}

      {hasQuery && results.length === 0 ? (
        <div className="search-state">
          <p className="eyebrow">Search</p>
          <h1>No results found</h1>
          <p>
            No cached document matched <strong>{query}</strong>. If this is a
            Shopify.dev docs path, open it directly under <code>/docs/...</code>
            to queue ingestion.
          </p>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="search-results">
          <p className="eyebrow">Search results</p>
          <h1>Results for {query}</h1>
          <ol>
            {results.map((result) => (
              <li className="search-result" key={result.pageId}>
                <a href={result.path}>{result.title ?? result.path}</a>
                <p className="search-result__path">{result.path}</p>
                <p>{result.snippet}</p>
                <span>{MATCH_LABELS[result.matchKind]}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
