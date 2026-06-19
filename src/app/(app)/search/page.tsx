import { db } from "@/db/client";
import { createSearchRepository } from "@/db/repositories/search-repository";
import { normalizeSearchQuery } from "@/modules/search/query";

import { SearchResults } from "./search-results";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string | string[];
  }>;
};

function queryFromParam(value: string | string[] | undefined): string {
  return normalizeSearchQuery(Array.isArray(value) ? value[0] ?? "" : value ?? "");
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = queryFromParam(params.q);
  const results = query
    ? await createSearchRepository(db).searchReaderPages({ query })
    : [];

  return <SearchResults query={query} results={results} />;
}
