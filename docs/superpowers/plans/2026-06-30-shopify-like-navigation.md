# Shopify-like Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reader's database-shaped root directory with Shopify.dev's curated Apps, Storefronts, Agents, and References navigation.

**Architecture:** Keep the existing lazy path tree for every parent below `/docs`. Special-case only the `/docs` root in `buildNavigationChildren`, injecting stable landing-page entries and mapping the existing `/docs/api` branch to the References label.

**Tech Stack:** TypeScript, React, Next.js App Router, Vitest, Testing Library

---

### Task 1: Curated root navigation

**Files:**
- Modify: `tests/unit/reader-navigation.test.ts`
- Modify: `src/modules/reader/navigation.ts`

- [x] **Step 1: Write the failing root test**

Change the root assertion so entries that contain only `/docs/api/...` still produce this stable root:

```ts
expect(buildNavigationChildren(entries, "/docs")).toEqual([
  { path: "/docs/apps", label: "Apps", isPage: true, hasChildren: true },
  { path: "/docs/storefronts", label: "Storefronts", isPage: true, hasChildren: true },
  { path: "/docs/agents", label: "Agents", isPage: true, hasChildren: false },
  { path: "/docs/api", label: "References", isPage: false, hasChildren: true },
]);
```

- [x] **Step 2: Run the test and verify RED**

Run: `corepack pnpm test -- tests/unit/reader-navigation.test.ts`

Expected: FAIL because the current root is alphabetically generated and does not inject Agents or rename API.

- [x] **Step 3: Implement the curated root**

Add a root-only helper in `src/modules/reader/navigation.ts` that merges dynamic metadata into four fixed nodes. Landing pages are always links; References uses `/docs/api` as a folder and preserves whether that branch has children.

- [x] **Step 4: Run the test and verify GREEN**

Run: `corepack pnpm test -- tests/unit/reader-navigation.test.ts`

Expected: PASS, including the existing `/docs/api` child-tree assertion.

### Task 2: Drawer interaction and full verification

**Files:**
- Modify: `tests/unit/reader-navigation-component.test.tsx`

- [x] **Step 1: Write the component regression test**

Return the four curated root nodes from the first mocked request, click `References`, and assert the second request uses:

```ts
expect(fetch).toHaveBeenCalledWith(
  "/api/navigation?parent=%2Fdocs%2Fapi",
  expect.objectContaining({ signal: expect.any(AbortSignal) }),
);
```

- [x] **Step 2: Run the component test and verify the interaction**

Run: `corepack pnpm test -- tests/unit/reader-navigation-component.test.tsx`

Expected: PASS because the existing generic tree already supports expanding the curated References node.

- [x] **Step 3: Make the minimal fixture and accessibility adjustments**

Update only the test fixture or root navigation rendering needed for References to remain an expandable folder backed by `/docs/api`.

- [x] **Step 4: Run focused and project verification**

Run:

```bash
corepack pnpm test -- tests/unit/reader-navigation.test.ts tests/unit/reader-navigation-component.test.tsx
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
git diff --check
```

Expected: all commands succeed without warnings introduced by this change.

- [x] **Step 5: Commit and push**

```bash
git add src/modules/reader/navigation.ts tests/unit/reader-navigation.test.ts tests/unit/reader-navigation-component.test.tsx docs/superpowers/plans/2026-06-30-shopify-like-navigation.md
git commit -m "feat: align reader navigation with Shopify docs"
git push origin main
```
