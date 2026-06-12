import type {
  BlockDiff,
  FingerprintedBlock,
} from "@/modules/ingestion/types";

function sameHeadingPath(
  left: FingerprintedBlock,
  right: FingerprintedBlock,
): boolean {
  return (
    left.headingPath.length === right.headingPath.length &&
    left.headingPath.every(
      (heading, index) => heading === right.headingPath[index],
    )
  );
}

function neighborScore(
  previous: FingerprintedBlock[],
  current: FingerprintedBlock[],
  previousIndex: number,
  currentIndex: number,
): number {
  let score = 0;
  if (
    previousIndex > 0 &&
    currentIndex > 0 &&
    previous[previousIndex - 1].contentFingerprint ===
      current[currentIndex - 1].contentFingerprint
  ) {
    score += 4;
  }
  if (
    previousIndex + 1 < previous.length &&
    currentIndex + 1 < current.length &&
    previous[previousIndex + 1].contentFingerprint ===
      current[currentIndex + 1].contentFingerprint
  ) {
    score += 4;
  }
  return score;
}

export function diffBlocks(
  previous: FingerprintedBlock[],
  current: FingerprintedBlock[],
): BlockDiff {
  const matchedPrevious = new Set<number>();
  const exactMatches = new Map<number, number>();
  const modifiedMatches = new Map<number, number>();

  for (const [currentIndex, currentBlock] of current.entries()) {
    const candidates = previous
      .map((previousBlock, previousIndex) => ({
        previousBlock,
        previousIndex,
      }))
      .filter(
        ({ previousBlock, previousIndex }) =>
          !matchedPrevious.has(previousIndex) &&
          previousBlock.type === currentBlock.type &&
          previousBlock.contentFingerprint ===
            currentBlock.contentFingerprint,
      )
      .sort((left, right) => {
        const leftDistance = Math.abs(
          left.previousBlock.ordinal - currentBlock.ordinal,
        );
        const rightDistance = Math.abs(
          right.previousBlock.ordinal - currentBlock.ordinal,
        );
        return leftDistance - rightDistance ||
          left.previousIndex - right.previousIndex;
      });

    const match = candidates[0];
    if (match) {
      matchedPrevious.add(match.previousIndex);
      exactMatches.set(currentIndex, match.previousIndex);
    }
  }

  for (const [currentIndex, currentBlock] of current.entries()) {
    if (exactMatches.has(currentIndex)) continue;

    const candidates = previous
      .map((previousBlock, previousIndex) => {
        const headingsMatch = sameHeadingPath(previousBlock, currentBlock);
        const contextScore = neighborScore(
          previous,
          current,
          previousIndex,
          currentIndex,
        );
        return {
          previousBlock,
          previousIndex,
          eligible: headingsMatch || contextScore > 0,
          score:
            (headingsMatch ? 10 : 0) +
            contextScore -
            Math.abs(previousBlock.ordinal - currentBlock.ordinal) / 100,
        };
      })
      .filter(
        ({ previousBlock, previousIndex, eligible }) =>
          eligible &&
          !matchedPrevious.has(previousIndex) &&
          previousBlock.type === currentBlock.type,
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.previousIndex - right.previousIndex,
      );

    const match = candidates[0];
    if (match) {
      matchedPrevious.add(match.previousIndex);
      modifiedMatches.set(currentIndex, match.previousIndex);
    }
  }

  const changes: BlockDiff["changes"] = [];
  const translationCandidateIndexes: number[] = [];

  for (const [currentIndex, currentBlock] of current.entries()) {
    const exactPreviousIndex = exactMatches.get(currentIndex);
    if (exactPreviousIndex !== undefined) {
      if (exactPreviousIndex !== currentIndex) {
        changes.push({
          kind: "moved",
          previousIndex: exactPreviousIndex,
          currentIndex,
        });
      }
      continue;
    }

    const modifiedPreviousIndex = modifiedMatches.get(currentIndex);
    if (modifiedPreviousIndex !== undefined) {
      changes.push({
        kind: "modified",
        previousIndex: modifiedPreviousIndex,
        currentIndex,
      });
      if (currentBlock.translatable) {
        translationCandidateIndexes.push(currentIndex);
      }
      continue;
    }

    changes.push({ kind: "added", currentIndex });
    if (currentBlock.translatable) {
      translationCandidateIndexes.push(currentIndex);
    }
  }

  for (const previousIndex of previous.keys()) {
    if (!matchedPrevious.has(previousIndex)) {
      changes.push({ kind: "deleted", previousIndex });
    }
  }

  return { changes, translationCandidateIndexes };
}
