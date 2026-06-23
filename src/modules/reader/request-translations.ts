import type { createJobRepository } from "@/db/repositories/job-repository";
import type { ReaderPage } from "@/modules/reader/types";

type JobRepository = Pick<
  ReturnType<typeof createJobRepository>,
  "enqueue"
>;

const ON_DEMAND_TRANSLATION_PRIORITY = 100;

export async function requestReaderTranslations(input: {
  page: ReaderPage;
  jobRepository: JobRepository;
  now: Date;
}): Promise<number> {
  const candidates = input.page.blocks.filter(
    (block) =>
      block.translatable &&
      (block.translationStatus === "pending" ||
        block.translationStatus === "failed"),
  );

  for (const block of candidates) {
    await input.jobRepository.enqueue({
      queue: "translation",
      type: "translate_block",
      dedupeKey: `translate:${block.id}:${block.fingerprint}`,
      payload: {
        blockId: block.id,
        contentFingerprint: block.fingerprint,
      },
      priority: ON_DEMAND_TRANSLATION_PRIORITY,
      runAt: input.now,
    });
  }

  return candidates.length;
}
