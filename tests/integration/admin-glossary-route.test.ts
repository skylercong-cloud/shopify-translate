import { cookies } from "next/headers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/admin/glossary/route";
import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import {
  glossaryTerms,
  glossaryVersions,
  translationSettings,
  users,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import {
  createSessionToken,
  newSessionRecord,
} from "@/modules/auth/session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const authRepository = createAuthRepository(db);
const mockedCookies = vi.mocked(cookies);

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

async function cleanDatabase() {
  vi.clearAllMocks();
  await db.delete(users);
  await db.delete(glossaryTerms);
  await db.delete(glossaryVersions);
  await db
    .insert(translationSettings)
    .values({ singleton: true })
    .onConflictDoNothing();
}

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

async function authenticate() {
  const user = await authRepository.upsertAdminPassword("hash");
  const token = createSessionToken();
  await authRepository.createSession(
    newSessionRecord(token, user.id, new Date(), 30),
  );
  mockedCookies.mockResolvedValue({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME ? { value: token } : undefined,
  } as Awaited<ReturnType<typeof cookies>>);
}

function glossaryRequest(terms: string) {
  const formData = new FormData();
  formData.set("terms", terms);

  return new Request("http://localhost/api/admin/glossary", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/glossary", () => {
  it("activates a new glossary snapshot for an authenticated administrator", async () => {
    await authenticate();

    const response = await POST(
      glossaryRequest("Shopify CLI\r\nAdmin API\nGraphQL\n"),
    );

    const active = await db.query.glossaryVersions.findFirst({
      where: (table, { eq }) => eq(table.active, true),
    });
    const terms = await db.query.glossaryTerms.findMany({
      where: (table, { eq }) => eq(table.glossaryVersionId, active!.id),
      orderBy: (table, { asc }) => asc(table.normalizedTerm),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?glossary=updated",
    );
    expect(active).toMatchObject({ version: 1, active: true });
    expect(terms.map((term) => term.sourceTerm)).toEqual([
      "Admin API",
      "GraphQL",
      "Shopify CLI",
    ]);
  });

  it("redirects unauthenticated requests to login", async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    } as Awaited<ReturnType<typeof cookies>>);

    const response = await POST(glossaryRequest("Shopify CLI"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/login",
    );
    await expect(db.query.glossaryVersions.findMany()).resolves.toEqual([]);
  });

  it("rejects invalid terms without replacing the active glossary", async () => {
    await authenticate();
    await POST(glossaryRequest("Shopify CLI\nAdmin API"));

    const response = await POST(glossaryRequest("Shopify CLI\nshopify cli"));
    const versions = await db.query.glossaryVersions.findMany();
    const terms = await db.query.glossaryTerms.findMany({
      orderBy: (table, { asc }) => asc(table.normalizedTerm),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/admin?glossary=invalid",
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, active: true });
    expect(terms.map((term) => term.sourceTerm)).toEqual([
      "Admin API",
      "Shopify CLI",
    ]);
  });
});
