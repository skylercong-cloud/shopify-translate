import { describe, expect, it } from "vitest";

import {
  buildNavigationChildren,
  parseNavigationParent,
} from "@/modules/reader/navigation";

const entries = [
  { path: "/docs/apps", title: "Build apps" },
  { path: "/docs/apps/build", title: "App development" },
  { path: "/docs/storefronts", title: "Build storefronts" },
  { path: "/docs/storefronts/themes", title: "Themes" },
  {
    path: "/docs/api/admin-graphql",
    title: "GraphQL Admin API reference",
  },
  {
    path: "/docs/api/admin-graphql/latest",
    title: "Admin GraphQL API",
  },
  {
    path: "/docs/api/admin-graphql/latest/queries/products",
    title: "products",
  },
];

describe("reader navigation", () => {
  it("builds stable immediate children without rendering the full corpus", () => {
    expect(buildNavigationChildren(entries, "/docs")).toEqual([
      {
        path: "/docs/apps",
        label: "Apps",
        isPage: true,
        hasChildren: true,
      },
      {
        path: "/docs/storefronts",
        label: "Storefronts",
        isPage: true,
        hasChildren: true,
      },
      {
        path: "/docs/agents",
        label: "Agents",
        isPage: true,
        hasChildren: false,
      },
      {
        path: "/docs/api",
        label: "References",
        isPage: false,
        hasChildren: true,
      },
    ]);

    expect(buildNavigationChildren(entries, "/docs/api")).toEqual([
      {
        path: "/docs/api/admin-graphql",
        label: "GraphQL Admin API reference",
        isPage: true,
        hasChildren: true,
      },
    ]);
  });

  it("accepts only normalized Shopify docs parents", () => {
    expect(parseNavigationParent("/docs/api/admin-graphql")).toBe(
      "/docs/api/admin-graphql",
    );
    expect(parseNavigationParent("/docs/")).toBe("/docs");
    expect(parseNavigationParent("/admin")).toBeNull();
    expect(parseNavigationParent("/docs/../admin")).toBeNull();
    expect(parseNavigationParent("/docs/%2e%2e/admin")).toBeNull();
  });
});
