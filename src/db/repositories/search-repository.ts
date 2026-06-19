import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  blockTranslations,
  contentBlocks,
  pageVersions,
  sourcePages,
  translationRevisions,
} from "@/db/schema";
import {
  buildLikePattern,
  normalizeSearchQuery,
} from "@/modules/search/query";
import type {
  ReaderSearchResult,
  SearchMatchKind,
} from "@/modules/search/types";

type Database = NodePgDatabase<typeof schema>;

type SearchRow = {
  pageId: string;
  path: string;
  canonicalUrl: string;
  title: string | null;
  blockType: (typeof contentBlocks.$inferSelect)["type"];
  sourceText: string;
  translatedText: string | null;
};

type CandidateMatch = {
  kind: SearchMatchKind;
  score: number;
  snippet: string;
};

const SCORE: Record<SearchMatchKind, number> = {
  identifier: 120,
  title: 100,
  path: 90,
  translation: 80,
  source: 70,
};

export function candidateLimitForSearchLimit(limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(1000, Math.max(50, Math.trunc(limit) * 25));
}

function containsFolded(value: string | null, query: string): boolean {
  return value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false;
}

function looksLikeIdentifier(query: string): boolean {
  return (
    /^[A-Za-z_$][\w.$:-]*$/.test(query) &&
    /[A-Z_.$:-]/.test(query)
  );
}

function bestMatch(row: SearchRow, query: string): CandidateMatch {
  if (looksLikeIdentifier(query) && row.sourceText.includes(query)) {
    return {
      kind: "identifier",
      score: SCORE.identifier,
      snippet: row.sourceText,
    };
  }

  if (containsFolded(row.title, query)) {
    return {
      kind: "title",
      score: SCORE.title,
      snippet: row.title ?? row.path,
    };
  }

  if (containsFolded(row.path, query)) {
    return {
      kind: "path",
      score: SCORE.path,
      snippet: row.path,
    };
  }

  if (containsFolded(row.translatedText, query)) {
    return {
      kind: "translation",
      score: SCORE.translation,
      snippet: row.translatedText ?? row.sourceText,
    };
  }

  return {
    kind: "source",
    score: SCORE.source,
    snippet: row.sourceText,
  };
}

export function createSearchRepository(db: Database) {
  return {
    async searchReaderPages(input: {
      query: string;
      limit?: number;
    }): Promise<ReaderSearchResult[]> {
      const query = normalizeSearchQuery(input.query);
      const limit = input.limit ?? 20;

      if (!query || limit <= 0) {
        return [];
      }

      const pattern = buildLikePattern(query);
      const candidateLimit = candidateLimitForSearchLimit(limit);
      const rows = await db
        .select({
          pageId: sourcePages.id,
          path: sourcePages.path,
          canonicalUrl: sourcePages.canonicalUrl,
          title: sourcePages.title,
          blockType: contentBlocks.type,
          sourceText: contentBlocks.sourceText,
          translatedText: translationRevisions.translatedText,
        })
        .from(sourcePages)
        .innerJoin(
          pageVersions,
          eq(pageVersions.id, sourcePages.currentVersionId),
        )
        .innerJoin(
          contentBlocks,
          eq(contentBlocks.pageVersionId, pageVersions.id),
        )
        .leftJoin(
          blockTranslations,
          eq(blockTranslations.blockId, contentBlocks.id),
        )
        .leftJoin(
          translationRevisions,
          eq(translationRevisions.id, blockTranslations.currentRevisionId),
        )
        .where(
          and(
            eq(sourcePages.status, "active"),
            or(
              ilike(sourcePages.title, pattern),
              ilike(sourcePages.path, pattern),
              ilike(contentBlocks.sourceText, pattern),
              ilike(translationRevisions.translatedText, pattern),
            ),
          ),
        )
        .orderBy(
          sql`case
            when ${sourcePages.title} ilike ${pattern} then 0
            when ${sourcePages.path} ilike ${pattern} then 1
            when ${translationRevisions.translatedText} ilike ${pattern} then 2
            else 3
          end`,
          asc(sourcePages.path),
          asc(contentBlocks.ordinal),
        )
        .limit(candidateLimit);

      const byPage = new Map<string, ReaderSearchResult>();
      for (const row of rows) {
        const match = bestMatch(row, query);
        const current = byPage.get(row.pageId);

        if (current && current.score >= match.score) {
          continue;
        }

        byPage.set(row.pageId, {
          pageId: row.pageId,
          path: row.path,
          canonicalUrl: row.canonicalUrl,
          title: row.title,
          snippet: match.snippet,
          matchKind: match.kind,
          score: match.score,
        });
      }

      return [...byPage.values()]
        .sort(
          (left, right) =>
            right.score - left.score ||
            (left.title ?? left.path).localeCompare(
              right.title ?? right.path,
            ),
        )
        .slice(0, limit);
    },
  };
}

export type SearchRepository = ReturnType<typeof createSearchRepository>;
