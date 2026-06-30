export type NavigationEntry = {
  path: string;
  title: string | null;
};

export type NavigationNode = {
  path: string;
  label: string;
  isPage: boolean;
  hasChildren: boolean;
};

const SEGMENT_LABELS: Record<string, string> = {
  api: "API",
  cli: "CLI",
  graphql: "GraphQL",
  pos: "POS",
  ui: "UI",
};

const CURATED_ROOT = [
  { path: "/docs/apps", label: "Apps", isPage: true },
  { path: "/docs/storefronts", label: "Storefronts", isPage: true },
  { path: "/docs/agents", label: "Agents", isPage: true },
  { path: "/docs/api", label: "References", isPage: false },
] as const;

function labelForSegment(segment: string): string {
  return segment
    .split("-")
    .map((part) =>
      SEGMENT_LABELS[part.toLowerCase()] ??
      `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

export function parseNavigationParent(value: string | null): string | null {
  if (!value || value.length > 500) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const normalized = decoded.length > 5
    ? decoded.replace(/\/+$/, "")
    : decoded;
  if (!/^\/docs(?:\/[A-Za-z0-9._~-]+)*$/.test(normalized)) {
    return null;
  }
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return normalized;
}

export function buildNavigationChildren(
  entries: NavigationEntry[],
  parent: string,
): NavigationNode[] {
  const normalizedParent = parseNavigationParent(parent);
  if (!normalizedParent) return [];

  const prefix = `${normalizedParent}/`;
  const grouped = new Map<
    string,
    { exact: NavigationEntry | null; hasChildren: boolean }
  >();

  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const remainder = entry.path.slice(prefix.length);
    if (!remainder) continue;
    const [segment, ...rest] = remainder.split("/");
    const path = `${normalizedParent}/${segment}`;
    const current = grouped.get(path) ?? {
      exact: null,
      hasChildren: false,
    };
    if (rest.length === 0) current.exact = entry;
    else current.hasChildren = true;
    grouped.set(path, current);
  }

  if (normalizedParent === "/docs") {
    return CURATED_ROOT.map((node) => ({
      ...node,
      hasChildren: grouped.get(node.path)?.hasChildren ?? false,
    }));
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([path, value]) => ({
      path,
      label: value.exact?.title?.trim() ||
        labelForSegment(path.slice(path.lastIndexOf("/") + 1)),
      isPage: value.exact !== null,
      hasChildren: value.hasChildren,
    }));
}
