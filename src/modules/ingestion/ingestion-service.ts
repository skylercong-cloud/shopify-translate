import type { IngestionRepository } from "@/db/repositories/ingestion-repository";
import type { createJobRepository } from "@/db/repositories/job-repository";
import {
  SHOPIFY_DEV_ORIGIN,
  SHOPIFY_ROBOTS_URL,
} from "@/modules/ingestion/constants";
import { diffBlocks } from "@/modules/ingestion/diff";
import { IngestionError } from "@/modules/ingestion/errors";
import {
  fingerprintBlock,
  fingerprintPage,
} from "@/modules/ingestion/fingerprint";
import { parseSourcePage } from "@/modules/ingestion/parser";
import {
  createRobotsPolicy,
  requireRobotsPolicy,
} from "@/modules/ingestion/robots-policy";
import {
  discoverSitemapUrls,
  parseSitemapMirrorUrls,
} from "@/modules/ingestion/sitemap";
import type {
  SourceClient,
  SourceFetchResult,
} from "@/modules/ingestion/source-client";
import type {
  FingerprintedBlock,
  IngestionPriority,
  SourceFormat,
} from "@/modules/ingestion/types";
import { canonicalizeShopifyDocsUrl } from "@/modules/ingestion/url-policy";

type JobRepository = ReturnType<typeof createJobRepository>;

const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1_000;
const PAGE_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const DIAGNOSTIC_PAYLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

type IngestPageResult =
  | {
      kind: "published" | "restored";
      versionId: string;
      versionNumber: number;
    }
  | { kind: "unchanged"; versionId: string }
  | { kind: "not_modified" | "gone" | "blocked" };

function errorDetails(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof IngestionError) {
    return {
      code: error.code,
      message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    };
  }
  if (error instanceof Error) {
    return {
      code: "ingestion_failed",
      message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    };
  }
  return {
    code: "ingestion_failed",
    message: "Ingestion failed",
  };
}

function sourceFormatForUrl(url: string): SourceFormat {
  return new URL(url).pathname.toLowerCase().endsWith(".txt")
    ? "text"
    : "html";
}

function responseStatus(result: SourceFetchResult): number {
  if (result.kind === "not_modified") return 304;
  if (result.kind === "gone") return result.status;
  return 200;
}

export function createIngestionService(deps: {
  ingestionRepository: IngestionRepository;
  jobRepository: JobRepository;
  sourceClient: SourceClient;
  sitemapMirrorUrl?: string;
  now: () => Date;
}) {
  async function loadRobotsPolicy() {
    const stored = await deps.ingestionRepository.getRobotsPolicy(
      SHOPIFY_DEV_ORIGIN,
    );
    return requireRobotsPolicy(
      stored ? createRobotsPolicy(stored.body) : undefined,
    );
  }

  async function ensurePage(canonicalUrl: string) {
    return deps.ingestionRepository.ensureSourcePage(
      canonicalUrl,
      deps.now(),
    );
  }

  async function recordResult(input: {
    jobId: string;
    pageId: string;
    result: SourceFetchResult;
    durationMs: number;
  }) {
    const result = input.result;
    return deps.ingestionRepository.recordFetchAttempt({
      jobId: input.jobId,
      pageId: input.pageId,
      requestedUrl: result.requestedUrl,
      finalUrl: result.finalUrl,
      sourceFormat: sourceFormatForUrl(result.requestedUrl),
      httpStatus: responseStatus(result),
      result:
        result.kind === "content"
          ? "content"
          : result.kind === "not_modified"
            ? "not_modified"
            : "gone",
      responseBytes: result.kind === "content" ? result.bytes : 0,
      durationMs: input.durationMs,
      etag: result.kind === "content" ? result.etag : undefined,
      lastModified:
        result.kind === "content" ? result.lastModified : undefined,
    });
  }

  async function recordFailure(input: {
    jobId: string;
    pageId: string;
    requestedUrl: string;
    finalUrl?: string;
    sourceFormat?: SourceFormat;
    responseBytes?: number;
    durationMs: number;
    error: unknown;
  }) {
    const details = errorDetails(input.error);
    return deps.ingestionRepository.recordFetchAttempt({
      jobId: input.jobId,
      pageId: input.pageId,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      sourceFormat: input.sourceFormat,
      result: "failed",
      responseBytes: input.responseBytes ?? 0,
      durationMs: input.durationMs,
      errorCode: details.code,
      errorMessage: details.message,
    });
  }

  return {
    async refreshRobotsPolicy(): Promise<"fresh" | "cached"> {
      try {
        const fetched = await deps.sourceClient.fetchTextResource(
          SHOPIFY_ROBOTS_URL,
        );
        const policy = createRobotsPolicy(fetched.body);
        const fetchedAt = deps.now();
        await deps.ingestionRepository.saveRobotsPolicy({
          origin: SHOPIFY_DEV_ORIGIN,
          body: policy.body,
          sitemapUrls: policy.sitemapUrls,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + ROBOTS_CACHE_MS),
        });
        return "fresh";
      } catch (error) {
        const cached = await deps.ingestionRepository.getRobotsPolicy(
          SHOPIFY_DEV_ORIGIN,
        );
        if (cached) return "cached";
        throw error;
      }
    },

    async discoverPages(): Promise<{
      discovered: number;
      queued: number;
    }> {
      const robots = await loadRobotsPolicy();
      const discoveryStartedAt = deps.now();
      let pages;
      try {
        pages = await discoverSitemapUrls({
          roots: robots.sitemapUrls,
          fetchResource: deps.sourceClient.fetchTextResource,
          robots,
        });
      } catch (officialError) {
        if (!deps.sitemapMirrorUrl) throw officialError;

        try {
          const mirror = await deps.sourceClient.fetchSitemapMirror(
            deps.sitemapMirrorUrl,
          );
          pages = parseSitemapMirrorUrls({ body: mirror.body, robots });
        } catch (mirrorError) {
          const official = errorDetails(officialError);
          const mirror = errorDetails(mirrorError);
          throw new IngestionError(
            "sitemap_mirror_failed",
            `Official Sitemap discovery failed (${official.code}: ${official.message}); mirror fallback failed (${mirror.code}: ${mirror.message})`,
            (officialError instanceof IngestionError &&
              officialError.retryable) ||
              (mirrorError instanceof IngestionError && mirrorError.retryable),
          );
        }
      }
      await deps.ingestionRepository.upsertDiscoveredPages({
        discoveredAt: discoveryStartedAt,
        pages,
      });

      let queued = 0;
      for (const page of pages) {
        await deps.jobRepository.enqueue({
          queue: "ingestion",
          type: "fetch_page",
          dedupeKey: `fetch:${page.canonicalUrl}`,
          payload: { url: page.canonicalUrl },
          priority: page.lastModifiedAt ? 20 : 10,
          runAt: discoveryStartedAt,
        });
        queued += 1;
      }

      await deps.ingestionRepository.markMissingFromCompletedDiscovery({
        discoveryStartedAt,
        completedAt: deps.now(),
      });
      return { discovered: pages.length, queued };
    },

    async requestPageIngestion(
      url: string,
      priority: IngestionPriority,
    ): Promise<{
      pageId: string;
      jobId: string | null;
      state: "already_current" | "queued" | "promoted";
    }> {
      const canonicalUrl = canonicalizeShopifyDocsUrl(url);
      const currentTime = deps.now();
      const page = await ensurePage(canonicalUrl);
      if (
        page.currentVersionId &&
        page.lastCheckedAt &&
        currentTime.getTime() - page.lastCheckedAt.getTime() <
          PAGE_FRESHNESS_MS
      ) {
        return {
          pageId: page.id,
          jobId: null,
          state: "already_current",
        };
      }

      const enqueued = await deps.jobRepository.enqueue({
        queue: "ingestion",
        type: "fetch_page",
        dedupeKey: `fetch:${canonicalUrl}`,
        payload: { url: canonicalUrl },
        priority: priority === "high" ? 100 : 10,
        runAt: currentTime,
      });
      return {
        pageId: page.id,
        jobId: enqueued.job.id,
        state: enqueued.action === "promoted" ? "promoted" : "queued",
      };
    },

    async ingestPage(
      url: string,
      jobId: string,
      translationPriority = 0,
    ): Promise<IngestPageResult> {
      const canonicalUrl = canonicalizeShopifyDocsUrl(url);
      const page = await ensurePage(canonicalUrl);
      const robots = await loadRobotsPolicy();
      if (!robots.isAllowed(canonicalUrl)) {
        await deps.ingestionRepository.markPageBlocked(page.id, deps.now());
        return { kind: "blocked" };
      }

      const snapshot =
        await deps.ingestionRepository.getCurrentPageSnapshot(page.id);
      const startedAt = Date.now();
      let fetched: SourceFetchResult;
      try {
        fetched = await deps.sourceClient.fetchPage({
          canonicalUrl,
          etag: snapshot?.page.etag ?? undefined,
          lastModified: snapshot?.page.lastModified ?? undefined,
        });
      } catch (error) {
        await recordFailure({
          jobId,
          pageId: page.id,
          requestedUrl: `${canonicalUrl}.txt`,
          durationMs: Date.now() - startedAt,
          error,
        });
        throw error;
      }

      const durationMs = Date.now() - startedAt;
      if (fetched.kind === "not_modified") {
        await recordResult({ jobId, pageId: page.id, result: fetched, durationMs });
        await deps.ingestionRepository.recordNotModified({
          pageId: page.id,
          checkedAt: deps.now(),
        });
        return { kind: "not_modified" };
      }
      if (fetched.kind === "gone") {
        await recordResult({ jobId, pageId: page.id, result: fetched, durationMs });
        await deps.ingestionRepository.markPageGone(page.id, deps.now());
        return { kind: "gone" };
      }

      let parsedPage;
      try {
        parsedPage = parseSourcePage({
          body: fetched.body,
          sourceFormat: fetched.sourceFormat,
        });
      } catch (error) {
        const attempt = await recordFailure({
          jobId,
          pageId: page.id,
          requestedUrl: fetched.requestedUrl,
          finalUrl: fetched.finalUrl,
          sourceFormat: fetched.sourceFormat,
          responseBytes: fetched.bytes,
          durationMs,
          error,
        });
        await deps.ingestionRepository.saveSourcePayload({
          fetchAttemptId: attempt.id,
          contentType: fetched.contentType,
          body: fetched.body,
          expiresAt: new Date(
            deps.now().getTime() + DIAGNOSTIC_PAYLOAD_TTL_MS,
          ),
        });
        throw error;
      }

      await recordResult({
        jobId,
        pageId: page.id,
        result: fetched,
        durationMs,
      });
      const currentBlocks: FingerprintedBlock[] = parsedPage.blocks.map(
        (block) => ({
          ...block,
          contentFingerprint: fingerprintBlock(block),
        }),
      );
      const previousBlocks: FingerprintedBlock[] =
        snapshot?.blocks.map((block) => ({
          type: block.type,
          ordinal: block.ordinal,
          headingPath: block.headingPath,
          sourceText: block.sourceText,
          payload: block.payload,
          translatable: block.translatable,
          contentFingerprint: block.fingerprint,
        })) ?? [];
      const diff = diffBlocks(previousBlocks, currentBlocks);
      return deps.ingestionRepository.publishParsedPage({
        pageId: page.id,
        parsedPage,
        pageFingerprint: fingerprintPage(currentBlocks),
        blockFingerprints: currentBlocks.map(
          (block) => block.contentFingerprint,
        ),
        diff,
        fetchedAt: deps.now(),
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        translationPriority,
      });
    },

    cleanupExpiredPayloads(): Promise<number> {
      return deps.ingestionRepository.deleteExpiredSourcePayloads(
        deps.now(),
      );
    },
  };
}
