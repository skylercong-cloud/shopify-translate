import Link from "next/link";
import type { ReactNode } from "react";

import { requireCurrentUser } from "@/modules/auth/current-user";

import { ReaderNavigation } from "./reader-navigation";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireCurrentUser();

  return (
    <div className="app-shell">
      <ReaderNavigation />
      <div className="app-main">
        <header className="app-header">
          <Link className="app-header__brand" href="/">
            Shopify 中文文档
          </Link>
          <form action="/search" className="app-header__search">
            <label className="sr-only" htmlFor="header-search">搜索文档</label>
            <input
              id="header-search"
              name="q"
              placeholder="搜索文档或 API identifier"
              type="search"
            />
          </form>
          <div className="app-header__account">
            <span>{user.username}</span>
            <form action="/api/auth/logout" method="post">
              <button type="submit">退出</button>
            </form>
          </div>
        </header>
        <main className="reader">{children}</main>
      </div>
    </div>
  );
}
