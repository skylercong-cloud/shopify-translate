import {
  and,
  asc,
  eq,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  blockChanges,
  contentBlocks,
  fetchAttempts,
  jobs,
  pageVersions,
  robotsPolicies,
  sourcePages,
  sourcePayloads,
} from "@/db/schema";
import { diffBlocks } from "@/modules/ingestion/diff";
import type {
  BlockDiff,
  DiscoveredPage,
  FingerprintedBlock,
  ParsedPage,
} from "@/modules/ingestion/types";

type Database = NodePgDatabase<typeof schema>;
type PublishHooks = {
  afterVersionInserted?: () => Promise<void>;
};
export type FetchAttemptInput = typeof fetchAttempts.$inferInsert;
export type StoredRobotsPolicy = typeof robotsPolicies.$inferSelect;

const INSERT_BATCH_SIZE = 500;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function optionalCacheHeaders(input: {
  etag?: string;
  lastModified?: string;
}) {
  return {
    etag: input.etag ?? null,
    lastModified: input.lastModified ?? null,
  };
}

export function createIngestionRepository(
  db: Database,
  hooks: PublishHooks = {},
) {
  return {
    async upsertDiscoveredPages(input: {
      discoveredAt: Date;
      pages: DiscoveredPage[];
    }): Promise<Array<{ id: string; canonicalUrl: string }>> {
      if (input.pages.length === 0) return [];

      return db.transaction(async (transaction) => {
        const stored: Array<{ id: string; canonicalUrl: string }> = [];
        for (const batch of chunks(input.pages, INSERT_BATCH_SIZE)) {
          const rows = await transaction
            .insert(sourcePages)
            .values(
              batch.map((page) => ({
                canonicalUrl: page.canonicalUrl,
                path: new URL(page.canonicalUrl).pathname,
                lastDiscoveredAt: input.discoveredAt,
              })),
            )
            .onConflictDoUpdate({
              target: sourcePages.canonicalUrl,
              set: {
                path: sql`excluded.path`,
                lastDiscoveredAt: input.discoveredAt,
                missingFromSitemapAt: null,
                updatedAt: input.discoveredAt,
              },
            })
            .returning({
              id: sourcePages.id,
              canonicalUrl: sourcePages.canonicalUrl,
            });
          stored.push(...rows);
        }
        return stored;
      });
    },

    async ensureSourcePage(canonicalUrl: string, createdAt: Date) {
      const [page] = await db
        .insert(sourcePages)
        .values({
          canonicalUrl,
          path: new URL(canonicalUrl).pathname,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoUpdate({
          target: sourcePages.canonicalUrl,
          set: {
            path: new URL(canonicalUrl).pathname,
          },
        })
        .returning();
      return page;
    },

    async markMissingFromCompletedDiscovery(input: {
      discoveryStartedAt: Date;
      completedAt: Date;
    }): Promise<number> {
      const missing = await db
        .update(sourcePages)
        .set({
          missingFromSitemapAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(
          and(
            isNull(sourcePages.missingFromSitemapAt),
            or(
              isNull(sourcePages.lastDiscoveredAt),
              lt(sourcePages.lastDiscoveredAt, input.discoveryStartedAt),
            ),
          ),
        )
        .returning({ id: sourcePages.id });

      return missing.length;
    },

    findPageByCanonicalUrl(canonicalUrl: string) {
      return db.query.sourcePages.findFirst({
        where: eq(sourcePages.canonicalUrl, canonicalUrl),
      });
    },

    getRobotsPolicy(origin: string) {
      return db.query.robotsPolicies.findFirst({
        where: eq(robotsPolicies.origin, origin),
      });
    },

    async saveRobotsPolicy(input: {
      origin: string;
      body: string;
      sitemapUrls: string[];
      fetchedAt: Date;
      expiresAt: Date;
    }): Promise<StoredRobotsPolicy> {
      const [policy] = await db
        .insert(robotsPolicies)
        .values({
          ...input,
          createdAt: input.fetchedAt,
          updatedAt: input.fetchedAt,
        })
        .onConflictDoUpdate({
          target: robotsPolicies.origin,
          set: {
            body: input.body,
            sitemapUrls: input.sitemapUrls,
            fetchedAt: input.fetchedAt,
            expiresAt: input.expiresAt,
            updatedAt: input.fetchedAt,
          },
        })
        .returning();
      return policy;
    },

    async recordFetchAttempt(
      input: FetchAttemptInput,
    ): Promise<{ id: string }> {
      const [attempt] = await db
        .insert(fetchAttempts)
        .values(input)
        .returning({ id: fetchAttempts.id });
      return attempt;
    },

    async saveSourcePayload(input: {
      fetchAttemptId: string;
      contentType: string;
      body: string;
      expiresAt: Date;
    }): Promise<void> {
      await db.insert(sourcePayloads).values(input);
    },

    async deleteExpiredSourcePayloads(now: Date): Promise<number> {
      const deleted = await db
        .delete(sourcePayloads)
        .where(lte(sourcePayloads.expiresAt, now))
        .returning({ id: sourcePayloads.id });
      return deleted.length;
    },

    async listActivePagesForRefresh(): Promise<
      Array<{ id: string; canonicalUrl: string }>
    > {
      return db
        .select({
          id: sourcePages.id,
          canonicalUrl: sourcePages.canonicalUrl,
        })
        .from(sourcePages)
        .where(eq(sourcePages.status, "active"))
        .orderBy(asc(sourcePages.id));
    },

    async getCurrentPageSnapshot(pageId: string) {
      const page = await db.query.sourcePages.findFirst({
        where: eq(sourcePages.id, pageId),
      });
      if (!page) return undefined;
      if (!page.currentVersionId) {
        return { page, version: undefined, blocks: [] };
      }

      const version = await db.query.pageVersions.findFirst({
        where: eq(pageVersions.id, page.currentVersionId),
      });
      const blocks = await db
        .select()
        .from(contentBlocks)
        .where(eq(contentBlocks.pageVersionId, page.currentVersionId))
        .orderBy(asc(contentBlocks.ordinal));
      return { page, version, blocks };
    },

    async recordNotModified(input: {
      pageId: string;
      checkedAt: Date;
      etag?: string;
      lastModified?: string;
    }): Promise<void> {
      await db
        .update(sourcePages)
        .set({
          ...(input.etag !== undefined ? { etag: input.etag } : {}),
          ...(input.lastModified !== undefined
            ? { lastModified: input.lastModified }
            : {}),
          lastCheckedAt: input.checkedAt,
          lastSuccessAt: input.checkedAt,
          updatedAt: input.checkedAt,
        })
        .where(eq(sourcePages.id, input.pageId));
    },

    async markPageGone(pageId: string, checkedAt: Date): Promise<void> {
      await db
        .update(sourcePages)
        .set({
          status: "gone",
          lastCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(sourcePages.id, pageId));
    },

    async markPageBlocked(pageId: string, checkedAt: Date): Promise<void> {
      await db
        .update(sourcePages)
        .set({
          status: "blocked",
          lastCheckedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(sourcePages.id, pageId));
    },

    async publishParsedPage(input: {
      pageId: string;
      parsedPage: ParsedPage;
      pageFingerprint: string;
      blockFingerprints: string[];
      diff: BlockDiff;
      fetchedAt: Date;
      etag?: string;
      lastModified?: string;
    }): Promise<
      | { kind: "published"; versionId: string; versionNumber: number }
      | { kind: "unchanged"; versionId: string }
      | { kind: "restored"; versionId: string; versionNumber: number }
    > {
      return db.transaction(async (transaction) => {
        const [page] = await transaction
          .select()
          .from(sourcePages)
          .where(eq(sourcePages.id, input.pageId))
          .limit(1)
          .for("update");
        if (!page) {
          throw new Error(`Source page ${input.pageId} does not exist`);
        }

        const [currentVersion] = page.currentVersionId
          ? await transaction
              .select()
              .from(pageVersions)
              .where(eq(pageVersions.id, page.currentVersionId))
              .limit(1)
          : [];
        if (
          currentVersion?.contentFingerprint === input.pageFingerprint
        ) {
          await transaction
            .update(sourcePages)
            .set({
              ...optionalCacheHeaders(input),
              status: "active",
              lastCheckedAt: input.fetchedAt,
              lastSuccessAt: input.fetchedAt,
              updatedAt: input.fetchedAt,
            })
            .where(eq(sourcePages.id, input.pageId));
          return { kind: "unchanged", versionId: currentVersion.id };
        }

        const [historicalVersion] = await transaction
          .select()
          .from(pageVersions)
          .where(
            and(
              eq(pageVersions.pageId, input.pageId),
              eq(
                pageVersions.contentFingerprint,
                input.pageFingerprint,
              ),
            ),
          )
          .limit(1);
        if (historicalVersion) {
          await transaction
            .update(sourcePages)
            .set({
              ...optionalCacheHeaders(input),
              title: input.parsedPage.title,
              status: "active",
              currentVersionId: historicalVersion.id,
              lastCheckedAt: input.fetchedAt,
              lastSuccessAt: input.fetchedAt,
              missingFromSitemapAt: null,
              updatedAt: input.fetchedAt,
            })
            .where(eq(sourcePages.id, input.pageId));
          return {
            kind: "restored",
            versionId: historicalVersion.id,
            versionNumber: historicalVersion.versionNumber,
          };
        }

        const previousBlocks = currentVersion
          ? await transaction
              .select()
              .from(contentBlocks)
              .where(
                eq(contentBlocks.pageVersionId, currentVersion.id),
              )
              .orderBy(asc(contentBlocks.ordinal))
          : [];
        const previousFingerprinted: FingerprintedBlock[] =
          previousBlocks.map((block) => ({
            type: block.type,
            ordinal: block.ordinal,
            headingPath: block.headingPath,
            sourceText: block.sourceText,
            payload: block.payload,
            translatable: block.translatable,
            contentFingerprint: block.fingerprint,
          }));
        const currentFingerprinted: FingerprintedBlock[] =
          input.parsedPage.blocks.map((block, index) => ({
            ...block,
            contentFingerprint: input.blockFingerprints[index],
          }));
        const recomputedDiff = diffBlocks(
          previousFingerprinted,
          currentFingerprinted,
        );
        const effectiveDiff =
          JSON.stringify(input.diff) === JSON.stringify(recomputedDiff)
            ? input.diff
            : recomputedDiff;

        const [latest] = await transaction
          .select({ versionNumber: max(pageVersions.versionNumber) })
          .from(pageVersions)
          .where(eq(pageVersions.pageId, input.pageId));
        const versionNumber = (latest.versionNumber ?? 0) + 1;
        const [version] = await transaction
          .insert(pageVersions)
          .values({
            pageId: input.pageId,
            versionNumber,
            sourceFormat: input.parsedPage.sourceFormat,
            contentFingerprint: input.pageFingerprint,
            blockCount: input.parsedPage.blocks.length,
            fetchedAt: input.fetchedAt,
            publishedAt: input.fetchedAt,
          })
          .returning();

        await hooks.afterVersionInserted?.();

        const insertedBlocks =
          input.parsedPage.blocks.length === 0
            ? []
            : await transaction
                .insert(contentBlocks)
                .values(
                  input.parsedPage.blocks.map((block, index) => ({
                    pageVersionId: version.id,
                    ordinal: index,
                    type: block.type,
                    headingPath: block.headingPath,
                    sourceText: block.sourceText,
                    payload: block.payload,
                    fingerprint: input.blockFingerprints[index],
                    translatable: block.translatable,
                  })),
                )
                .returning();
        const currentBlockByOrdinal = new Map(
          insertedBlocks.map((block) => [block.ordinal, block]),
        );

        const changeRows: Array<typeof blockChanges.$inferInsert> =
          effectiveDiff.changes.map((change) => {
            if (change.kind === "added") {
              return {
                pageVersionId: version.id,
                kind: change.kind,
                currentBlockId: currentBlockByOrdinal.get(
                  change.currentIndex,
                )!.id,
              };
            }
            if (change.kind === "deleted") {
              return {
                pageVersionId: version.id,
                kind: change.kind,
                previousBlockId: previousBlocks[change.previousIndex].id,
              };
            }
            return {
              pageVersionId: version.id,
              kind: change.kind,
              previousBlockId: previousBlocks[change.previousIndex].id,
              currentBlockId: currentBlockByOrdinal.get(
                change.currentIndex,
              )!.id,
            };
          });
        if (changeRows.length > 0) {
          await transaction.insert(blockChanges).values(changeRows);
        }

        const translationRows: Array<typeof jobs.$inferInsert> =
          effectiveDiff.translationCandidateIndexes.map((index) => {
            const block = currentBlockByOrdinal.get(index)!;
            return {
              queue: "translation",
              type: "translate_block",
              dedupeKey: `translate:${block.id}:${block.fingerprint}`,
              payload: {
                blockId: block.id,
                contentFingerprint: block.fingerprint,
              },
              priority: 0,
              runAt: input.fetchedAt,
            };
          });
        if (translationRows.length > 0) {
          await transaction.insert(jobs).values(translationRows);
        }

        await transaction
          .update(sourcePages)
          .set({
            ...optionalCacheHeaders(input),
            title: input.parsedPage.title,
            status: "active",
            currentVersionId: version.id,
            lastCheckedAt: input.fetchedAt,
            lastSuccessAt: input.fetchedAt,
            missingFromSitemapAt: null,
            updatedAt: input.fetchedAt,
          })
          .where(eq(sourcePages.id, input.pageId));

        return {
          kind: "published",
          versionId: version.id,
          versionNumber,
        };
      });
    },
  };
}

export type IngestionRepository = ReturnType<
  typeof createIngestionRepository
>;
