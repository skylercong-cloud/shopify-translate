import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DashboardPage from "@/app/(app)/page";

describe("DashboardPage", () => {
  it("shows the focused-reader empty state", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", {
        name: "开始阅读 Shopify 开发文档",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("中文与 English 统一搜索")).toBeInTheDocument();
    expect(
      screen.getByText("内容抓取与翻译会在后续阶段接入。"),
    ).toBeInTheDocument();
  });
});
