import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DashboardPage from "@/app/(app)/page";

describe("DashboardPage", () => {
  it("shows the focused-reader search entry", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", {
        name: "开始阅读 Shopify 开发文档",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("中文与 English 统一搜索")).toBeInTheDocument();
    expect(
      screen.getByText(/搜索已缓存的中文译文、英文原文和 API 标识符/),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("中文、English 或 productCreate"),
    ).toBeInTheDocument();
  });
});
