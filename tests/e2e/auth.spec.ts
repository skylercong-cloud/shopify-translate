import { expect, test } from "@playwright/test";

const password = process.env.E2E_ADMIN_PASSWORD;

if (!password) {
  throw new Error("E2E_ADMIN_PASSWORD is required");
}

test("requires login and supports logout", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", {
      name: "开始阅读 Shopify 开发文档",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "退出" }).click();

  await expect(page).toHaveURL(/\/login$/);
});
