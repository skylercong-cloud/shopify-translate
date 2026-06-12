import { describe, expect, it } from "vitest";

import { diffBlocks } from "@/modules/ingestion/diff";
import {
  fingerprintBlock,
  fingerprintPage,
} from "@/modules/ingestion/fingerprint";
import type {
  FingerprintedBlock,
  ParsedBlock,
} from "@/modules/ingestion/types";

function block(
  sourceText: string,
  overrides: Partial<ParsedBlock> = {},
): FingerprintedBlock {
  const parsed: ParsedBlock = {
    type: "paragraph",
    ordinal: 0,
    headingPath: ["Guide"],
    sourceText,
    payload: {},
    translatable: true,
    ...overrides,
  };
  return { ...parsed, contentFingerprint: fingerprintBlock(parsed) };
}

describe("content fingerprints", () => {
  it("normalizes prose line endings and repeated whitespace", () => {
    expect(
      fingerprintBlock(block("Build\r\n  Shopify apps.")),
    ).toBe(fingerprintBlock(block("Build Shopify apps.")));
  });

  it("preserves code whitespace", () => {
    expect(
      fingerprintBlock(
        block("if (ready) {\n  run();\n}", {
          type: "code",
          translatable: false,
        }),
      ),
    ).not.toBe(
      fingerprintBlock(
        block("if (ready) {\n    run();\n}", {
          type: "code",
          translatable: false,
        }),
      ),
    );
  });

  it("includes protected values and page order", () => {
    const first = block("Admin API", {
      payload: {
        protectedTokens: [
          {
            kind: "url",
            value: "https://shopify.dev/docs/api/one",
            start: 0,
            end: 9,
          },
        ],
      },
    });
    const changedLink = block("Admin API", {
      payload: {
        protectedTokens: [
          {
            kind: "url",
            value: "https://shopify.dev/docs/api/two",
            start: 0,
            end: 9,
          },
        ],
      },
    });
    const second = block("Second", { ordinal: 1 });

    expect(first.contentFingerprint).not.toBe(
      changedLink.contentFingerprint,
    );
    expect(fingerprintPage([first, second])).not.toBe(
      fingerprintPage([second, first]),
    );
  });

  it("does not invalidate unchanged content when its heading path changes", () => {
    expect(
      block("Same paragraph", { headingPath: ["Old heading"] })
        .contentFingerprint,
    ).toBe(
      block("Same paragraph", { headingPath: ["New heading"] })
        .contentFingerprint,
    );
  });
});

describe("block diff", () => {
  it("marks every translatable block added in the first version", () => {
    const current = [
      block("Heading", { type: "heading" }),
      block("Code", { type: "code", ordinal: 1, translatable: false }),
    ];

    expect(diffBlocks([], current)).toEqual({
      changes: [
        { kind: "added", currentIndex: 0 },
        { kind: "added", currentIndex: 1 },
      ],
      translationCandidateIndexes: [0],
    });
  });

  it("marks only one changed paragraph as modified", () => {
    const previous = [
      block("Heading", { type: "heading" }),
      block("Old paragraph", { ordinal: 1 }),
      block("Unchanged paragraph", { ordinal: 2 }),
    ];
    const current = [
      block("Heading", { type: "heading" }),
      block("New paragraph", { ordinal: 1 }),
      block("Unchanged paragraph", { ordinal: 2 }),
    ];

    expect(diffBlocks(previous, current)).toEqual({
      changes: [
        { kind: "modified", previousIndex: 1, currentIndex: 1 },
      ],
      translationCandidateIndexes: [1],
    });
  });

  it("records pure movement without translation candidates", () => {
    const previous = [
      block("First", { ordinal: 0 }),
      block("Second", { ordinal: 1 }),
    ];
    const current = [
      block("Second", { ordinal: 0 }),
      block("First", { ordinal: 1 }),
    ];

    expect(diffBlocks(previous, current)).toEqual({
      changes: [
        { kind: "moved", previousIndex: 1, currentIndex: 0 },
        { kind: "moved", previousIndex: 0, currentIndex: 1 },
      ],
      translationCandidateIndexes: [],
    });
  });

  it("records deletion without a current block", () => {
    const previous = [
      block("Keep", { ordinal: 0 }),
      block("Delete", { ordinal: 1, headingPath: ["Removed"] }),
    ];
    const current = [block("Keep", { ordinal: 0 })];

    expect(diffBlocks(previous, current)).toEqual({
      changes: [{ kind: "deleted", previousIndex: 1 }],
      translationCandidateIndexes: [],
    });
  });

  it("pairs duplicate exact content by nearest ordinal deterministically", () => {
    const previous = [
      block("Repeat", { ordinal: 0 }),
      block("Middle", { ordinal: 1 }),
      block("Repeat", { ordinal: 2 }),
    ];
    const current = [
      block("Repeat", { ordinal: 0 }),
      block("Inserted", { ordinal: 1, headingPath: ["New"] }),
      block("Middle", { ordinal: 2 }),
      block("Repeat", { ordinal: 3 }),
    ];

    const result = diffBlocks(previous, current);

    expect(result.changes).toEqual([
      { kind: "added", currentIndex: 1 },
      { kind: "moved", previousIndex: 1, currentIndex: 2 },
      { kind: "moved", previousIndex: 2, currentIndex: 3 },
    ]);
    expect(result.translationCandidateIndexes).toEqual([1]);
  });
});
