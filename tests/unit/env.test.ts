import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";
import { MAXIMUM_SESSION_DAYS } from "@/modules/auth/constants";

import { validEnv } from "../fixtures/env";

describe("parseEnv", () => {
  it("parses the required application settings", () => {
    expect(parseEnv(validEnv)).toMatchObject({
      DATABASE_URL: validEnv.DATABASE_URL,
      APP_ORIGIN: validEnv.APP_ORIGIN,
      SESSION_DAYS: 30,
    });
  });

  it("rejects an invalid application origin", () => {
    expect(() =>
      parseEnv({ ...validEnv, APP_ORIGIN: "not-a-url" }),
    ).toThrow("APP_ORIGIN");
  });

  it.each([
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com?preview=1",
    "https://example.com#section",
  ])("rejects a URL that is not an HTTP application origin: %s", (origin) => {
    expect(() => parseEnv({ ...validEnv, APP_ORIGIN: origin })).toThrow(
      "APP_ORIGIN",
    );
  });

  it("rejects a non-positive session duration", () => {
    expect(() =>
      parseEnv({ ...validEnv, SESSION_DAYS: "0" }),
    ).toThrow("SESSION_DAYS");
  });

  it("rejects a session duration above the supported maximum", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        SESSION_DAYS: String(MAXIMUM_SESSION_DAYS + 1),
      }),
    ).toThrow("SESSION_DAYS");
  });
});
