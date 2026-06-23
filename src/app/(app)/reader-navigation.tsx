"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { NavigationNode } from "@/modules/reader/navigation";

type NavigationResponse = {
  parent: string;
  nodes: NavigationNode[];
};

function NavigationBranch({
  parent,
  currentPath,
  onNavigate,
}: {
  parent: string;
  currentPath: string;
  onNavigate(): void;
}) {
  const [nodes, setNodes] = useState<NavigationNode[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/navigation?parent=${encodeURIComponent(parent)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Navigation request failed");
        return response.json() as Promise<NavigationResponse>;
      })
      .then((response) => setNodes(response.nodes))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [parent]);

  if (error) return <p className="document-tree__state">目录加载失败</p>;
  if (!nodes) return <p className="document-tree__state">正在加载目录...</p>;
  if (nodes.length === 0) return null;

  return (
    <ul className="document-tree">
      {nodes.map((node) => (
        <NavigationTreeNode
          currentPath={currentPath}
          key={node.path}
          node={node}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function NavigationTreeNode({
  node,
  currentPath,
  onNavigate,
}: {
  node: NavigationNode;
  currentPath: string;
  onNavigate(): void;
}) {
  const inCurrentBranch =
    currentPath === node.path || currentPath.startsWith(`${node.path}/`);
  const [expanded, setExpanded] = useState(inCurrentBranch);

  return (
    <li>
      <div className="document-tree__row">
        {node.hasChildren ? (
          <button
            aria-label={`${expanded ? "收起" : "展开"} ${node.label}`}
            aria-expanded={expanded}
            className="document-tree__toggle"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? "−" : "+"}
          </button>
        ) : (
          <span className="document-tree__spacer" />
        )}
        {node.isPage ? (
          <Link
            aria-current={currentPath === node.path ? "page" : undefined}
            href={node.path}
            onClick={onNavigate}
          >
            {node.label}
          </Link>
        ) : (
          <button
            className="document-tree__folder"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {node.label}
          </button>
        )}
      </div>
      {expanded && node.hasChildren ? (
        <NavigationBranch
          currentPath={currentPath}
          key={node.path}
          onNavigate={onNavigate}
          parent={node.path}
        />
      ) : null}
    </li>
  );
}

export function ReaderNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="collapsed-nav" aria-label="主导航">
        <Link className="collapsed-nav__brand" href="/" aria-label="阅读首页">
          S
        </Link>
        <button
          aria-expanded={open}
          aria-label="文档目录"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          目
        </button>
        <Link href="/search" aria-label="搜索文档">搜</Link>
        <span className="collapsed-nav__separator" />
        <Link href="/admin" aria-label="运维概览">运</Link>
        <Link href="/admin/review" aria-label="翻译审核">审</Link>
        <Link href="/admin/glossary" aria-label="术语库">术</Link>
      </nav>

      <aside
        aria-label="Shopify 文档目录"
        className={`document-drawer${open ? " document-drawer--open" : ""}`}
      >
        <header>
          <div>
            <p>Shopify.dev</p>
            <h2>文档目录</h2>
          </div>
          <button onClick={() => setOpen(false)} type="button">关闭</button>
        </header>
        <form action="/search" className="document-drawer__search">
          <label className="sr-only" htmlFor="drawer-search">搜索文档</label>
          <input id="drawer-search" name="q" placeholder="搜索中文、English 或 API" type="search" />
        </form>
        {open ? (
          <NavigationBranch
            currentPath={pathname}
            onNavigate={() => setOpen(false)}
            parent="/docs"
          />
        ) : null}
      </aside>
      {open ? (
        <button
          aria-label="关闭文档目录"
          className="document-drawer__backdrop"
          onClick={() => setOpen(false)}
          type="button"
        />
      ) : null}
    </>
  );
}
