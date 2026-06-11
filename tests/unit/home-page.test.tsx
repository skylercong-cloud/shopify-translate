import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("introduces the private Chinese documentation reader", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: "Shopify 开发文档中文阅读器",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("仅供个人使用")).toBeInTheDocument();
  });
});
