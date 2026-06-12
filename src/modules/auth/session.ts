import { createHash, randomBytes, randomUUID } from "node:crypto";

import { MAXIMUM_SESSION_DAYS } from "./constants";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiresAt(now: Date, sessionDays: number) {
  if (
    !Number.isInteger(sessionDays) ||
    sessionDays < 1 ||
    sessionDays > MAXIMUM_SESSION_DAYS
  ) {
    throw new Error(
      `sessionDays must be an integer between 1 and ${MAXIMUM_SESSION_DAYS}`,
    );
  }

  return new Date(now.getTime() + sessionDays * MILLISECONDS_PER_DAY);
}

export function newSessionRecord(
  token: string,
  userId: string,
  now: Date,
  sessionDays: number,
) {
  return {
    id: randomUUID(),
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt: sessionExpiresAt(now, sessionDays),
  };
}
