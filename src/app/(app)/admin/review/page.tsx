import { db } from "@/db/client";
import { createTranslationReviewRepository } from "@/db/repositories/translation-review-repository";

import { TranslationReviewPanel } from "./translation-review";

export default async function TranslationReviewPage() {
  const items = await createTranslationReviewRepository(db).loadReviewItems();

  return <TranslationReviewPanel items={items} />;
}
