import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SearchResults } from "@/app/(app)/search/search-results";
import type { ReaderSearchResult } from "@/modules/search/types";

afterEach(() => {
  cleanup();
});

const result: ReaderSearchResult = {
  pageId: "page-id",
  path: "/docs/apps/build",
  canonicalUrl: "https://shopify.dev/docs/apps/build",
  title: "Build apps",
  snippet: "Use Admin GraphQL to create products.",
  matchKind: "source",
  score: 70,
};

describe("search results", () => {
  it("renders the empty query state", () => {
    render(<SearchResults query="" results={[]} />);

    expect(
      screen.getByRole("heading", { name: "统一搜索 Shopify 文档" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("中文、English 或 productCreate"),
    ).toBeInTheDocument();
  });

  it("renders a no-results state for a submitted query", () => {
    render(<SearchResults query="missing" results={[]} />);

    expect(
      screen.getByRole("heading", { name: "No results found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
  });

  it("renders document links, snippets, and match labels", () => {
    render(<SearchResults query="Admin GraphQL" results={[result]} />);

    expect(screen.getByRole("link", { name: "Build apps" }))
      .toHaveAttribute("href", "/docs/apps/build");
    expect(
      screen.getByText("Use Admin GraphQL to create products."),
    ).toBeInTheDocument();
    expect(screen.getByText("English source")).toBeInTheDocument();
  });
});
