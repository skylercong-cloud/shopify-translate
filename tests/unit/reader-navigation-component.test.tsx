import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReaderNavigation } from "@/app/(app)/reader-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("ReaderNavigation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const requestUrl = String(input);
        const response = requestUrl.includes("parent=%2Fdocs%2Fapi")
          ? {
              parent: "/docs/api",
              nodes: [
                {
                  path: "/docs/api/admin-graphql",
                  label: "GraphQL Admin API",
                  isPage: true,
                  hasChildren: true,
                },
              ],
            }
          : {
              parent: "/docs",
              nodes: [
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
              ],
            };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  it("loads the curated root and expands References through the API branch", async () => {
    render(<ReaderNavigation />);

    fireEvent.click(screen.getByRole("button", { name: "文档目录" }));

    expect(await screen.findByText("References")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apps" })).toHaveAttribute(
      "href",
      "/docs/apps",
    );
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/docs/agents",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/navigation?parent=%2Fdocs",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "References" }));

    expect(await screen.findByText("GraphQL Admin API")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/navigation?parent=%2Fdocs%2Fapi",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
