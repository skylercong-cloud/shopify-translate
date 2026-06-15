import { describe, expect, it, vi } from "vitest";

import {
  createTranslationAdminService,
  type TranslationAdminServiceOptions,
} from "@/modules/translation/translation-admin-service";

const now = new Date("2026-06-15T10:00:00.000Z");

function options(
  overrides: Partial<TranslationAdminServiceOptions> = {},
): TranslationAdminServiceOptions {
  return {
    store: {
      getBlock: vi.fn().mockResolvedValue({
        id: "block-id",
        sourceFingerprint: "current-fingerprint",
        current: true,
        translatable: true,
      }),
      listCurrentBlocks: vi.fn().mockResolvedValue([
        {
          id: "block-id",
          sourceFingerprint: "current-fingerprint",
          current: true,
          translatable: true,
        },
      ]),
      listCorrectionHistory: vi.fn().mockResolvedValue([]),
    },
    translationRepository: {
      recordCorrection: vi.fn().mockResolvedValue({
        kind: "published",
        correction: { id: "correction-id" },
        revision: { id: "revision-id" },
      }),
    },
    configRepository: {
      getActivePrompt: vi.fn().mockResolvedValue({ id: "prompt-id" }),
      getActiveGlossary: vi
        .fn()
        .mockResolvedValue({ id: "glossary-id" }),
    },
    jobRepository: {
      enqueue: vi.fn().mockResolvedValue({
        action: "created",
        job: { id: "job-id" },
      }),
    },
    now: () => now,
    ...overrides,
  };
}

describe("translation admin service", () => {
  it("defaults a global correction to the current source fingerprint", async () => {
    const input = options();
    const service = createTranslationAdminService(input);

    await expect(
      service.recordManualCorrection({
        blockId: "block-id",
        translatedText: "人工译文。",
        scope: "global",
      }),
    ).resolves.toMatchObject({ kind: "published" });

    expect(
      input.translationRepository.recordCorrection,
    ).toHaveBeenCalledWith({
      blockId: "block-id",
      translatedText: "人工译文。",
      scope: "global",
      sourceFingerprint: "current-fingerprint",
      now,
    });
  });

  it("requires a block ID for block-only corrections", async () => {
    const service = createTranslationAdminService(options());

    await expect(
      service.recordManualCorrection({
        translatedText: "人工译文。",
        scope: "block",
      }),
    ).rejects.toThrow("blockId");
  });

  it("rejects a mismatched current fingerprint", async () => {
    const input = options();
    const service = createTranslationAdminService(input);

    await expect(
      service.recordManualCorrection({
        blockId: "block-id",
        translatedText: "人工译文。",
        scope: "global",
        expectedSourceFingerprint: "stale-fingerprint",
      }),
    ).rejects.toThrow("source fingerprint");
    expect(
      input.translationRepository.recordCorrection,
    ).not.toHaveBeenCalled();
  });

  it("requires an explicit fingerprint for a non-current block", async () => {
    const input = options();
    vi.mocked(input.store.getBlock).mockResolvedValue({
      id: "historical-block",
      sourceFingerprint: "historical-fingerprint",
      current: false,
      translatable: true,
    });
    const service = createTranslationAdminService(input);

    await expect(
      service.recordManualCorrection({
        blockId: "historical-block",
        translatedText: "历史人工译文。",
        scope: "block",
      }),
    ).rejects.toThrow("explicit");

    await expect(
      service.recordManualCorrection({
        blockId: "historical-block",
        translatedText: "历史人工译文。",
        scope: "block",
        expectedSourceFingerprint: "historical-fingerprint",
      }),
    ).resolves.toMatchObject({ kind: "published" });
  });

  it.each([
    [{ blockId: "block-id" }, { blockId: "block-id" }],
    [{ pagePath: "/docs/apps" }, { pagePath: "/docs/apps" }],
    [{ all: true }, { all: true }],
  ] as const)(
    "enqueues retranslation for one explicit target",
    async (request, expectedTarget) => {
      const input = options();
      const service = createTranslationAdminService(input);

      await expect(
        service.enqueueRetranslation(request),
      ).resolves.toEqual({
        targeted: 1,
        created: 1,
        deduplicated: 0,
        promoted: 0,
      });

      expect(input.store.listCurrentBlocks).toHaveBeenCalledWith(
        expectedTarget,
      );
      expect(input.jobRepository.enqueue).toHaveBeenCalledWith({
        queue: "translation",
        type: "translate_block",
        dedupeKey:
          "retranslate:block-id:current-fingerprint:prompt-id:glossary-id",
        payload: {
          blockId: "block-id",
          contentFingerprint: "current-fingerprint",
        },
        priority: 0,
        runAt: now,
      });
    },
  );

  it("rejects ambiguous or absent retranslation targets", async () => {
    const service = createTranslationAdminService(options());

    await expect(service.enqueueRetranslation({})).rejects.toThrow(
      "exactly one",
    );
    await expect(
      service.enqueueRetranslation({
        blockId: "block-id",
        all: true,
      }),
    ).rejects.toThrow("exactly one");
  });

  it.each(["prompt", "glossary"] as const)(
    "requires an active %s before selecting or enqueueing blocks",
    async (missing) => {
      const input = options();
      if (missing === "prompt") {
        vi.mocked(
          input.configRepository.getActivePrompt,
        ).mockResolvedValue(null);
      } else {
        vi.mocked(
          input.configRepository.getActiveGlossary,
        ).mockResolvedValue(null);
      }

      await expect(
        createTranslationAdminService(input).enqueueRetranslation({
          all: true,
        }),
      ).rejects.toThrow(missing);
      expect(input.store.listCurrentBlocks).not.toHaveBeenCalled();
      expect(input.jobRepository.enqueue).not.toHaveBeenCalled();
    },
  );

  it("summarizes active-job deduplication actions", async () => {
    const input = options();
    vi.mocked(input.store.listCurrentBlocks).mockResolvedValue([
      {
        id: "one",
        sourceFingerprint: "one-fingerprint",
        current: true,
        translatable: true,
      },
      {
        id: "two",
        sourceFingerprint: "two-fingerprint",
        current: true,
        translatable: true,
      },
      {
        id: "three",
        sourceFingerprint: "three-fingerprint",
        current: true,
        translatable: true,
      },
    ]);
    vi.mocked(input.jobRepository.enqueue)
      .mockResolvedValueOnce({
        action: "created",
        job: { id: "one" },
      })
      .mockResolvedValueOnce({
        action: "deduplicated",
        job: { id: "two" },
      })
      .mockResolvedValueOnce({
        action: "promoted",
        job: { id: "three" },
      });

    await expect(
      createTranslationAdminService(input).enqueueRetranslation({
        all: true,
      }),
    ).resolves.toEqual({
      targeted: 3,
      created: 1,
      deduplicated: 1,
      promoted: 1,
    });
  });
});
