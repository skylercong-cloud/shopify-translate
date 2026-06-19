const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function getShanghaiUsageDate(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function getNextShanghaiReset(now: Date): Date {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate() + 1,
    ) - SHANGHAI_UTC_OFFSET_MS,
  );
}

export function estimateStrictReservation(
  serializedRequest: string,
  maxOutputTokens: number,
): number {
  requirePositiveSafeInteger(maxOutputTokens, "maxOutputTokens");

  const reservedTokens =
    Buffer.byteLength(serializedRequest, "utf8") + maxOutputTokens;
  if (!Number.isSafeInteger(reservedTokens)) {
    throw new Error("Estimated token reservation exceeds the safe integer range");
  }
  return reservedTokens;
}
