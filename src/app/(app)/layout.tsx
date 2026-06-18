import type { ReactNode } from "react";
import Link from "next/link";

import { requireCurrentUser } from "@/modules/auth/current-user";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireCurrentUser();

  return (
    <div className="app-shell">
      <nav className="collapsed-nav" aria-label="文档导航">
        <span aria-hidden="true">S</span>
        <Link href="/" aria-label="阅读首页">
          R
        </Link>
        <Link href="/admin" aria-label="运维概览">
          O
        </Link>
        <Link href="/admin/review" aria-label="Translation review">
          V
        </Link>
      </nav>
      <div className="app-main">
        <header className="app-header">
          <strong>Shopify 中文文档</strong>
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
