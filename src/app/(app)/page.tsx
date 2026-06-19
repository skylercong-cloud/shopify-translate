import { SearchForm } from "./search/search-results";

export default function DashboardPage() {
  return (
    <section className="empty-reader">
      <p className="eyebrow">中文与 English 统一搜索</p>
      <h1>开始阅读 Shopify 开发文档</h1>
      <p>
        搜索已缓存的中文译文、英文原文和 API 标识符；未缓存的
        Shopify.dev 文档可直接访问对应 <code>/docs/...</code> 路径排队采集。
      </p>
      <SearchForm />
    </section>
  );
}
