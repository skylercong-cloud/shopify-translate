import { asc, desc, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import { glossaryTerms, glossaryVersions } from "@/db/schema";
import { compareGlossaryTerms } from "@/modules/glossary/diff";
import type {
  GlossaryBrowserItem,
  GlossaryTerm,
} from "@/modules/glossary/types";

type Database = NodePgDatabase<typeof schema>;

function clampLimit(limit: number) {
  return Math.min(50, Math.max(1, Math.trunc(limit)));
}

export function createGlossaryBrowserRepository(db: Database) {
  return {
    async loadGlossaryVersions(limit = 20): Promise<GlossaryBrowserItem[]> {
      const versions = await db
        .select({
          id: glossaryVersions.id,
          version: glossaryVersions.version,
          active: glossaryVersions.active,
          createdAt: glossaryVersions.createdAt,
        })
        .from(glossaryVersions)
        .orderBy(desc(glossaryVersions.version))
        .limit(clampLimit(limit));

      if (versions.length === 0) {
        return [];
      }

      const versionIds = versions.map((version) => version.id);
      const terms = await db
        .select({
          glossaryVersionId: glossaryTerms.glossaryVersionId,
          sourceTerm: glossaryTerms.sourceTerm,
          normalizedTerm: glossaryTerms.normalizedTerm,
        })
        .from(glossaryTerms)
        .where(inArray(glossaryTerms.glossaryVersionId, versionIds))
        .orderBy(asc(glossaryTerms.normalizedTerm));

      const termsByVersionId = new Map<string, GlossaryTerm[]>();
      for (const term of terms) {
        const versionTerms = termsByVersionId.get(term.glossaryVersionId) ?? [];
        versionTerms.push({
          sourceTerm: term.sourceTerm,
          normalizedTerm: term.normalizedTerm,
        });
        termsByVersionId.set(term.glossaryVersionId, versionTerms);
      }

      const activeVersion = versions.find((version) => version.active);
      const activeTerms = activeVersion
        ? (termsByVersionId.get(activeVersion.id) ?? [])
        : [];

      return versions.map((version) => {
        const versionTerms = termsByVersionId.get(version.id) ?? [];

        return {
          ...version,
          terms: versionTerms,
          diff: compareGlossaryTerms(versionTerms, activeTerms),
        };
      });
    },
  };
}
