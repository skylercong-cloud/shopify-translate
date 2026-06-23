import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReaderNavigation } from "@/app/(app)/reader-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs/api/admin-graphql",
}));

describe("ReaderNavigation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            parent: "/docs",
            nodes: [
              {
                path: "/docs/api",
                label: "API",
                isPage: false,
                hasChildren: true,
              },
              {
                path: "/docs/apps",
                label: "Build apps",
                isPage: true,
                hasChildren: true,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  it("opens the focused directory drawer and loads its root branch", async () => {
    render(<ReaderNavigation />);

    fireEvent.click(screen.getByRole("button", { name: "文档目录" }));

    expect(await screen.findByText("API")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build apps" })).toHaveAttribute(
      "href",
      "/docs/apps",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/navigation?parent=%2Fdocs",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
