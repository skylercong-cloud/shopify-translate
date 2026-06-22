import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createJobRepository } from "@/db/repositories/job-repository";
import {
  fetchAttempts,
  jobs,
  pageVersions,
  robotsPolicies,
  sourcePages,
  sourcePayloads,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { createIngestionService } from "@/modules/ingestion/ingestion-service";
import {
  createRequestGate,
  createSourceClient,
} from "@/modules/ingestion/source-client";
import { createIngestionScheduler } from "@/modules/jobs/scheduler";
import { startFixtureServer } from "../helpers/fixture-server";

const ingestionRepository = createIngestionRepository(db);
const jobRepository = createJobRepository(db);
const createdUrls: string[] = [];
const servers: Array<Awaited<ReturnType<typeof startFixtureServer>>> = [];

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await db.delete(sourcePayloads);
  await db.delete(fetchAttempts);
  await db.delete(jobs).where(eq(jobs.queue, "ingestion"));
  await db.delete(jobs).where(eq(jobs.queue, "translation"));
  for (const url of createdUrls.splice(0)) {
    await db.delete(sourcePages).where(eq(sourcePages.canonicalUrl, url));
  }
  await db
    .delete(robotsPolicies)
    .where(eq(robotsPolicies.origin, "https://shopify.dev"));
});

async function createHarness(
  routes: Parameters<typeof startFixtureServer>[0] = {},
  sitemapMirrorUrl?: string,
) {
  const server = await startFixtureServer(routes);
  servers.push(server);
  const sourceClient = createSourceClient({
    fetchImpl: server.mappedFetch,
    requestGate: createRequestGate({
      concurrency: 2,
      requestIntervalMs: 0,
    }),
    timeoutMs: 1_000,
  });
  let currentTime = new Date("2026-06-12T00:00:00Z");
  const service = createIngestionService({
    ingestionRepository,
    jobRepository,
    sourceClient,
    sitemapMirrorUrl,
    now: () => currentTime,
  });
  return {
    server,
    service,
    setTime(value: string) {
      currentTime = new Date(value);
    },
  };
}

describe("ingestion pipeline", () => {
  it("discovers, fetches, publishes, and incrementally updates a page", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/pipeline-${id}`;
    createdUrls.push(canonicalUrl);
    const sitemap = `<urlset><url><loc>${canonicalUrl}</loc></url></urlset>`;
    const harness = await createHarness({
      "/robots.txt": {
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow:\nSitemap: https://shopify.dev/sitemap.xml",
      },
      "/sitemap.xml": {
        headers: { "content-type": "application/xml" },
        body: sitemap,
      },
      [`/docs/pipeline-${id}.txt`]: {
        headers: { "content-type": "text/plain", etag: '"v1"' },
        body: "# Guide\n\nFirst paragraph.",
      },
    });

    await expect(harness.service.refreshRobotsPolicy()).resolves.toBe(
      "fresh",
    );
    await expect(harness.service.discoverPages()).resolves.toEqual({
      discovered: 1,
      queued: 1,
    });
    const page = await ingestionRepository.findPageByCanonicalUrl(
      canonicalUrl,
    );
    const fetchJob = await db.query.jobs.findFirst({
      where: eq(jobs.dedupeKey, `fetch:${canonicalUrl}`),
    });
    expect(page).toBeDefined();
    expect(fetchJob).toBeDefined();

    await expect(
      harness.service.ingestPage(canonicalUrl, fetchJob!.id),
    ).resolves.toMatchObject({ kind: "published" });
    await db.delete(jobs).where(eq(jobs.queue, "translation"));

    harness.server.setRoute(`/docs/pipeline-${id}.txt`, {
      headers: { "content-type": "text/plain", etag: '"v2"' },
      body: "# Guide\n\nFirst paragraph changed.",
    });
    harness.setTime("2026-06-12T01:00:00Z");
    await expect(
      harness.service.ingestPage(canonicalUrl, fetchJob!.id),
    ).resolves.toMatchObject({ kind: "published", versionNumber: 2 });

    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, page!.id),
    });
    const translationJobs = await db.query.jobs.findMany({
      where: eq(jobs.queue, "translation"),
    });
    expect(versions).toHaveLength(2);
    expect(translationJobs).toHaveLength(1);
  });

  it("uses a cached Robots policy after refresh failure but fails closed without one", async () => {
    const harness = await createHarness({
      "/robots.txt": {
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow:",
      },
    });

    await expect(harness.service.refreshRobotsPolicy()).resolves.toBe(
      "fresh",
    );
    harness.server.setRoute("/robots.txt", {
      status: 500,
      headers: { "content-type": "text/plain" },
      body: "failed",
    });
    await expect(harness.service.refreshRobotsPolicy()).resolves.toBe(
      "cached",
    );

    await db
      .delete(robotsPolicies)
      .where(eq(robotsPolicies.origin, "https://shopify.dev"));
    await expect(harness.service.refreshRobotsPolicy()).rejects.toMatchObject({
      retryable: true,
    });
    await expect(harness.service.discoverPages()).rejects.toThrow(
      /robots policy is unavailable/i,
    );
  });

  it("uses the Sitemap mirror only after official discovery fails", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/mirrored-${id}`;
    const mirrorPath =
      "/skylercong-cloud/shopify-translate/sitemap-cache/shopify-sitemap.xml";
    const mirrorUrl = `https://raw.githubusercontent.com${mirrorPath}`;
    createdUrls.push(canonicalUrl);
    const harness = await createHarness(
      {
        "/robots.txt": {
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nDisallow:\nSitemap: https://shopify.dev/sitemap.xml",
        },
        "/sitemap.xml": {
          status: 500,
          headers: { "content-type": "text/plain" },
          body: "upstream failed",
        },
        [mirrorPath]: {
          headers: { "content-type": "text/plain" },
          body: `<urlset><url><loc>${canonicalUrl}</loc></url></urlset>`,
        },
      },
      mirrorUrl,
    );

    await harness.service.refreshRobotsPolicy();
    await expect(harness.service.discoverPages()).resolves.toEqual({
      discovered: 1,
      queued: 1,
    });
    expect(harness.server.requests.map((request) => request.path)).toEqual([
      "/robots.txt",
      "/sitemap.xml",
      mirrorPath,
    ]);
  });

  it("does not fetch the Sitemap mirror when official discovery succeeds", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/official-${id}`;
    const mirrorPath =
      "/skylercong-cloud/shopify-translate/sitemap-cache/shopify-sitemap.xml";
    createdUrls.push(canonicalUrl);
    const harness = await createHarness(
      {
        "/robots.txt": {
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nDisallow:\nSitemap: https://shopify.dev/sitemap.xml",
        },
        "/sitemap.xml": {
          headers: { "content-type": "application/xml" },
          body: `<urlset><url><loc>${canonicalUrl}</loc></url></urlset>`,
        },
        [mirrorPath]: {
          headers: { "content-type": "text/plain" },
          body: "<urlset />",
        },
      },
      `https://raw.githubusercontent.com${mirrorPath}`,
    );

    await harness.service.refreshRobotsPolicy();
    await expect(harness.service.discoverPages()).resolves.toEqual({
      discovered: 1,
      queued: 1,
    });
    expect(harness.server.requests.map((request) => request.path)).toEqual([
      "/robots.txt",
      "/sitemap.xml",
    ]);
  });

  it("does not hide official discovery failure without a mirror", async () => {
    const harness = await createHarness({
      "/robots.txt": {
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow:\nSitemap: https://shopify.dev/sitemap.xml",
      },
      "/sitemap.xml": {
        status: 500,
        headers: { "content-type": "text/plain" },
        body: "upstream failed",
      },
    });

    await harness.service.refreshRobotsPolicy();
    await expect(harness.service.discoverPages()).rejects.toMatchObject({
      code: "source_server_error",
    });
  });

  it("records a 304 without creating another page version", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/not-modified-${id}`;
    createdUrls.push(canonicalUrl);
    const harness = await createHarness({
      "/robots.txt": {
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow:",
      },
      [`/docs/not-modified-${id}.txt`]: {
        headers: { "content-type": "text/plain", etag: '"v1"' },
        body: "# Guide\n\nReadable.",
      },
    });
    await harness.service.refreshRobotsPolicy();
    const requested = await harness.service.requestPageIngestion(
      canonicalUrl,
      "high",
    );
    await harness.service.ingestPage(canonicalUrl, requested.jobId!);
    const before = await ingestionRepository.findPageByCanonicalUrl(
      canonicalUrl,
    );

    harness.server.setRoute(`/docs/not-modified-${id}.txt`, {
      status: 304,
    });
    harness.setTime("2026-06-12T04:00:00Z");
    await expect(
      harness.service.ingestPage(canonicalUrl, requested.jobId!),
    ).resolves.toEqual({ kind: "not_modified" });

    const after = await ingestionRepository.findPageByCanonicalUrl(
      canonicalUrl,
    );
    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, before!.id),
    });
    expect(versions).toHaveLength(1);
    expect(after).toMatchObject({
      currentVersionId: before!.currentVersionId,
      lastCheckedAt: new Date("2026-06-12T04:00:00Z"),
    });
  });

  it("preserves the published version on gone, blocked, and parse failures", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/preserve-${id}`;
    createdUrls.push(canonicalUrl);
    const harness = await createHarness({
      "/robots.txt": {
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow:",
      },
      [`/docs/preserve-${id}.txt`]: {
        headers: { "content-type": "text/plain" },
        body: "# Guide\n\nReadable.",
      },
    });
    await harness.service.refreshRobotsPolicy();
    const requested = await harness.service.requestPageIngestion(
      canonicalUrl,
      "high",
    );
    await harness.service.ingestPage(canonicalUrl, requested.jobId!);
    const before = await ingestionRepository.findPageByCanonicalUrl(
      canonicalUrl,
    );

    harness.server.setRoute(`/docs/preserve-${id}.txt`, { status: 404 });
    harness.server.setRoute(`/docs/preserve-${id}`, { status: 410 });
    await harness.service.ingestPage(canonicalUrl, requested.jobId!);
    let after = await ingestionRepository.findPageByCanonicalUrl(canonicalUrl);
    expect(after).toMatchObject({
      status: "gone",
      currentVersionId: before!.currentVersionId,
    });

    await ingestionRepository.saveRobotsPolicy({
      origin: "https://shopify.dev",
      body: `User-agent: *\nDisallow: /docs/preserve-${id}`,
      sitemapUrls: ["https://shopify.dev/sitemap.xml"],
      fetchedAt: new Date("2026-06-12T02:00:00Z"),
      expiresAt: new Date("2026-06-13T02:00:00Z"),
    });
    await harness.service.ingestPage(canonicalUrl, requested.jobId!);
    after = await ingestionRepository.findPageByCanonicalUrl(canonicalUrl);
    expect(after).toMatchObject({
      status: "blocked",
      currentVersionId: before!.currentVersionId,
    });

    await ingestionRepository.saveRobotsPolicy({
      origin: "https://shopify.dev",
      body: "User-agent: *\nDisallow:",
      sitemapUrls: ["https://shopify.dev/sitemap.xml"],
      fetchedAt: new Date("2026-06-12T03:00:00Z"),
      expiresAt: new Date("2026-06-13T03:00:00Z"),
    });
    harness.server.setRoute(`/docs/preserve-${id}.txt`, {
      headers: { "content-type": "text/plain" },
      body: "not a structured document",
    });
    harness.server.setRoute(`/docs/preserve-${id}`, {
      headers: { "content-type": "text/html" },
      body: "<html><body><h1>No main root</h1></body></html>",
    });
    await expect(
      harness.service.ingestPage(canonicalUrl, requested.jobId!),
    ).rejects.toThrow(/main content/i);
    after = await ingestionRepository.findPageByCanonicalUrl(canonicalUrl);
    expect(after?.currentVersionId).toBe(before!.currentVersionId);
    await expect(db.query.sourcePayloads.findMany()).resolves.toHaveLength(1);
  });

  it("deletes only expired diagnostic payloads", async () => {
    const id = randomUUID();
    const canonicalUrl = `https://shopify.dev/docs/cleanup-${id}`;
    createdUrls.push(canonicalUrl);
    const page = await ingestionRepository.ensureSourcePage(
      canonicalUrl,
      new Date("2026-06-12T00:00:00Z"),
    );
    const expiredAttempt = await ingestionRepository.recordFetchAttempt({
      pageId: page.id,
      requestedUrl: `${canonicalUrl}.txt`,
      result: "failed",
      responseBytes: 10,
      durationMs: 1,
    });
    const retainedAttempt = await ingestionRepository.recordFetchAttempt({
      pageId: page.id,
      requestedUrl: canonicalUrl,
      result: "failed",
      responseBytes: 10,
      durationMs: 1,
    });
    await ingestionRepository.saveSourcePayload({
      fetchAttemptId: expiredAttempt.id,
      contentType: "text/plain",
      body: "expired",
      expiresAt: new Date("2026-06-11T23:59:59Z"),
    });
    await ingestionRepository.saveSourcePayload({
      fetchAttemptId: retainedAttempt.id,
      contentType: "text/html",
      body: "retained",
      expiresAt: new Date("2026-06-13T00:00:00Z"),
    });

    const harness = await createHarness();
    await expect(harness.service.cleanupExpiredPayloads()).resolves.toBe(1);
    const remaining = await db.query.sourcePayloads.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].body).toBe("retained");
  });

  it("deduplicates daily maintenance and spreads page refresh jobs", async () => {
    const now = new Date("2026-06-12T08:30:00Z");
    const pages = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const canonicalUrl = `https://shopify.dev/docs/scheduled-${randomUUID()}-${index}`;
        createdUrls.push(canonicalUrl);
        return ingestionRepository.ensureSourcePage(canonicalUrl, now);
      }),
    );
    const scheduler = createIngestionScheduler({
      ingestionRepository,
      jobRepository,
    });

    await scheduler.ensureMaintenanceJobs(now);
    await scheduler.ensureMaintenanceJobs(now);
    await scheduler.scheduleDailyPageRefreshes(now);
    await scheduler.scheduleDailyPageRefreshes(now);

    const maintenanceJobs = await db.query.jobs.findMany({
      where: eq(jobs.queue, "ingestion"),
    });
    const scheduledRefreshes = maintenanceJobs.filter((job) =>
      pages.some(
        (page) =>
          job.dedupeKey === `refresh:${page.id}:2026-06-12`,
      ),
    );
    expect(
      maintenanceJobs.filter((job) =>
        job.dedupeKey.startsWith("maintenance:"),
      ),
    ).toHaveLength(2);
    expect(scheduledRefreshes).toHaveLength(pages.length);

    const dayStart = new Date("2026-06-12T00:00:00Z").getTime();
    const nextDay = new Date("2026-06-13T00:00:00Z").getTime();
    expect(
      scheduledRefreshes.every(
        (job) =>
          job.runAt.getTime() >= dayStart &&
          job.runAt.getTime() < nextDay,
      ),
    ).toBe(true);
    expect(
      new Set(scheduledRefreshes.map((job) => job.runAt.getTime())).size,
    ).toBeGreaterThan(1);
  });
});
