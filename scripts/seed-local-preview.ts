import { asc, eq } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import { contentBlocks } from "@/db/schema";
import { seedLocalPreview } from "@/modules/preview/local-preview-seed";

try {
  const result = await seedLocalPreview({
    ingestionRepository: createIngestionRepository(db),
    loadBlocksForVersion(versionId) {
      return db
        .select({
          id: contentBlocks.id,
          ordinal: contentBlocks.ordinal,
          type: contentBlocks.type,
          sourceText: contentBlocks.sourceText,
          fingerprint: contentBlocks.fingerprint,
          translatable: contentBlocks.translatable,
        })
        .from(contentBlocks)
        .where(eq(contentBlocks.pageVersionId, versionId))
        .orderBy(asc(contentBlocks.ordinal));
    },
    now: new Date(),
    translationRepository: createTranslationRepository(db),
  });

  console.log(`Seeded ${result.pages.length} local preview pages.`);
  console.log(`Published ${result.translationCount} demo translations.`);
  for (const page of result.pages) {
    console.log(
      `- ${page.path} (${page.translatedCount}/${page.blockCount} translated blocks)`,
    );
  }
} finally {
  await pool.end();
}
