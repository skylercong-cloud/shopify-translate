import { describe, expect, it } from "vitest";

import { sessionCookieOptions } from "@/modules/auth/cookies";

describe("sessionCookieOptions", () => {
  it("returns secure production cookie settings", () => {
    expect(sessionCookieOptions(true, new Date("2026-07-11Z"))).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: new Date("2026-07-11Z"),
    });
  });
});
