const allowedExactReturnPaths = new Set(["/admin/review"]);

function isAllowedReturnPath(pathname: string) {
  return pathname.startsWith("/docs/") || allowedExactReturnPaths.has(pathname);
}

export function normalizeCorrectionReturnTo(value: string): string {
  try {
    const parsed = new URL(value, "http://local.invalid");
    if (
      parsed.origin !== "http://local.invalid" ||
      !isAllowedReturnPath(parsed.pathname)
    ) {
      return "/admin";
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/admin";
  }
}
