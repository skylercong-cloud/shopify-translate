export type LocalPreviewPage = {
  canonicalUrl: string;
  markdown: string;
  translations: Record<string, string>;
};

export const LOCAL_PREVIEW_PAGES: LocalPreviewPage[] = [
  {
    canonicalUrl: "https://shopify.dev/docs/apps/build",
    markdown: [
      "# Build apps",
      "",
      "Use Shopify CLI to create, run, and deploy apps.",
      "",
      "Shopify apps extend the Shopify admin, checkout, and storefront experiences.",
      "",
      "- Create an app project with Shopify CLI.",
      "- Run the app locally with a tunnel.",
      "- Deploy the app when it is ready.",
      "",
      "```sh",
      "shopify app dev",
      "```",
    ].join("\n"),
    translations: {
      "Build apps": "构建 apps",
      "Use Shopify CLI to create, run, and deploy apps.":
        "使用 Shopify CLI 创建、运行和部署 apps。",
      "Shopify apps extend the Shopify admin, checkout, and storefront experiences.":
        "Shopify apps 可扩展 Shopify admin、checkout 和 storefront 体验。",
      "Create an app project with Shopify CLI.\nRun the app locally with a tunnel.\nDeploy the app when it is ready.":
        "使用 Shopify CLI 创建 app 项目。\n通过 tunnel 在本地运行 app。\n准备好后部署 app。",
    },
  },
  {
    canonicalUrl: "https://shopify.dev/docs/api/admin-graphql",
    markdown: [
      "# Admin GraphQL API",
      "",
      "The Admin GraphQL API lets apps read and write Shopify store data.",
      "",
      "Use GraphQL mutations such as `productCreate` to automate merchant workflows.",
      "",
      "```graphql",
      "mutation productCreate($input: ProductInput!) {",
      "  productCreate(input: $input) {",
      "    product { id title }",
      "  }",
      "}",
      "```",
    ].join("\n"),
    translations: {
      "Admin GraphQL API": "Admin GraphQL API",
      "The Admin GraphQL API lets apps read and write Shopify store data.":
        "Admin GraphQL API 允许 apps 读取和写入 Shopify 店铺数据。",
      "Use GraphQL mutations such as productCreate to automate merchant workflows.":
        "使用 productCreate 等 GraphQL mutations 自动化 merchant 工作流。",
    },
  },
];
