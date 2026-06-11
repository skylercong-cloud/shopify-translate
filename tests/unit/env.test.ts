import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

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

  it("rejects a non-positive session duration", () => {
    expect(() =>
      parseEnv({ ...validEnv, SESSION_DAYS: "0" }),
    ).toThrow("SESSION_DAYS");
  });
});
