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
      SOURCE_REQUEST_CONCURRENCY: 2,
      SOURCE_REQUEST_INTERVAL_MS: 500,
      SOURCE_TIMEOUT_MS: 20_000,
      SOURCE_MAX_RESPONSE_BYTES: 8_388_608,
      INGESTION_POLL_INTERVAL_MS: 1_000,
      INGESTION_LEASE_MS: 120_000,
    });
  });

  it("parses explicit ingestion worker settings", () => {
    expect(
      parseEnv({
        ...validEnv,
        SOURCE_REQUEST_CONCURRENCY: "4",
        SOURCE_REQUEST_INTERVAL_MS: "250",
        SOURCE_TIMEOUT_MS: "60000",
        SOURCE_MAX_RESPONSE_BYTES: "16777216",
        INGESTION_POLL_INTERVAL_MS: "100",
        INGESTION_LEASE_MS: "120000",
      }),
    ).toMatchObject({
      SOURCE_REQUEST_CONCURRENCY: 4,
      SOURCE_REQUEST_INTERVAL_MS: 250,
      SOURCE_TIMEOUT_MS: 60_000,
      SOURCE_MAX_RESPONSE_BYTES: 16_777_216,
      INGESTION_POLL_INTERVAL_MS: 100,
      INGESTION_LEASE_MS: 120_000,
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

  it.each([
    ["SOURCE_REQUEST_CONCURRENCY", "5"],
    ["SOURCE_REQUEST_INTERVAL_MS", "249"],
    ["SOURCE_TIMEOUT_MS", "999"],
    ["SOURCE_TIMEOUT_MS", "60001"],
    ["SOURCE_MAX_RESPONSE_BYTES", "16777217"],
    ["INGESTION_POLL_INTERVAL_MS", "99"],
  ])("rejects invalid worker setting %s=%s", (key, value) => {
    expect(() => parseEnv({ ...validEnv, [key]: value })).toThrow(key);
  });

  it("requires the ingestion lease to cover at least two source timeouts", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        SOURCE_TIMEOUT_MS: "20000",
        INGESTION_LEASE_MS: "39999",
      }),
    ).toThrow("INGESTION_LEASE_MS");
  });
});
