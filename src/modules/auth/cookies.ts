export function sessionCookieOptions(secure: boolean, expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires,
  };
}
