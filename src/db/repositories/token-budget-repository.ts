import { and, eq, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  tokenReservations,
  translationProviders,
  translationSettings,
  translationUsageDays,
} from "@/db/schema";
import {
  getNextShanghaiReset,
  getShanghaiUsageDate,
} from "@/modules/translation/token-budget";

type Database = NodePgDatabase<typeof schema>;
type TranslationProvider = (typeof translationProviders)[number];

type ReserveInput = {
  jobId: string | null;
  blockId: string | null;
  provider: TranslationProvider;
  tokens: number;
  now: Date;
};

type ReserveResult =
  | { reserved: true; reservationId: string }
  | {
      reserved: false;
      reason: "budget_exhausted";
      resumeAt: Date;
    };

type SettleInput = {
  reservationId: string;
  reportedInputTokens: number | null;
  reportedOutputTokens: number | null;
  now: Date;
};

type ReconcileStaleInput = {
  reservedBefore: Date;
  requestStartedBefore: Date;
  now: Date;
};

type Availability =
  | { configured: false }
  | {
      configured: true;
      exhausted: boolean;
      remaining: number;
      resetAt: Date;
    };

export interface TokenBudgetRepository {
  reserve(input: ReserveInput): Promise<ReserveResult>;
  markRequestStarted(reservationId: string, now: Date): Promise<void>;
  settle(input: SettleInput): Promise<{ chargedTokens: number }>;
  reconcileStale(
    input: ReconcileStaleInput,
  ): Promise<{ released: number; charged: number }>;
  getAvailability(now: Date): Promise<Availability>;
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function requireNonNegativeSafeInteger(
  value: number | null,
  name: string,
): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative safe integer or null`);
  }
}

function missingReservation(): Error {
  return new Error("Token reservation was not found");
}

export function createTokenBudgetRepository(
  db: Database,
): TokenBudgetRepository {
  return {
    async reserve(input) {
      requirePositiveSafeInteger(input.tokens, "tokens");

      return db.transaction(async (transaction) => {
        const [settings] = await transaction
          .select({ dailyTokenLimit: translationSettings.dailyTokenLimit })
          .from(translationSettings)
          .where(eq(translationSettings.singleton, true))
          .limit(1);
        if (settings?.dailyTokenLimit == null) {
          throw new Error("Daily token limit is not configured");
        }

        const usageDate = getShanghaiUsageDate(input.now);
        await transaction
          .insert(translationUsageDays)
          .values({
            usageDate,
            tokenLimit: settings.dailyTokenLimit,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing();
        await transaction
          .select({ usageDate: translationUsageDays.usageDate })
          .from(translationUsageDays)
          .where(eq(translationUsageDays.usageDate, usageDate))
          .for("update");

        const [reservedDay] = await transaction
          .update(translationUsageDays)
          .set({
            reservedTokens: sql`${translationUsageDays.reservedTokens} + ${input.tokens}`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(translationUsageDays.usageDate, usageDate),
              sql`${translationUsageDays.chargedTokens}
                + ${translationUsageDays.reservedTokens}
                + ${input.tokens}
                <= ${translationUsageDays.tokenLimit}`,
            ),
          )
          .returning({ usageDate: translationUsageDays.usageDate });

        if (!reservedDay) {
          return {
            reserved: false,
            reason: "budget_exhausted",
            resumeAt: getNextShanghaiReset(input.now),
          };
        }

        const [reservation] = await transaction
          .insert(tokenReservations)
          .values({
            usageDate,
            jobId: input.jobId,
            blockId: input.blockId,
            provider: input.provider,
            reservedTokens: input.tokens,
            expiresAt: getNextShanghaiReset(input.now),
            createdAt: input.now,
          })
          .returning({ id: tokenReservations.id });

        return {
          reserved: true,
          reservationId: reservation.id,
        };
      });
    },

    markRequestStarted(reservationId, now) {
      return db.transaction(async (transaction) => {
        const [reservation] = await transaction
          .select({
            status: tokenReservations.status,
          })
          .from(tokenReservations)
          .where(eq(tokenReservations.id, reservationId))
          .limit(1)
          .for("update");
        if (!reservation) throw missingReservation();

        if (reservation.status === "reserved") {
          await transaction
            .update(tokenReservations)
            .set({
              status: "request_started",
              requestStartedAt: now,
            })
            .where(eq(tokenReservations.id, reservationId));
          return;
        }

        if (
          reservation.status === "request_started" ||
          reservation.status === "settled"
        ) {
          return;
        }

        throw new Error("Released token reservation cannot start a request");
      });
    },

    settle(input) {
      requireNonNegativeSafeInteger(
        input.reportedInputTokens,
        "reportedInputTokens",
      );
      requireNonNegativeSafeInteger(
        input.reportedOutputTokens,
        "reportedOutputTokens",
      );

      return db.transaction(async (transaction) => {
        const [reservation] = await transaction
          .select()
          .from(tokenReservations)
          .where(eq(tokenReservations.id, input.reservationId))
          .limit(1)
          .for("update");
        if (!reservation) throw missingReservation();

        if (reservation.status === "settled") {
          return { chargedTokens: reservation.chargedTokens };
        }
        if (reservation.status === "released") {
          throw new Error("Released token reservation cannot be settled");
        }

        const reportedTokens =
          input.reportedInputTokens === null ||
          input.reportedOutputTokens === null
            ? reservation.reservedTokens
            : input.reportedInputTokens + input.reportedOutputTokens;
        const chargedTokens = Math.min(
          reservation.reservedTokens,
          reportedTokens,
        );

        await transaction
          .update(translationUsageDays)
          .set({
            reservedTokens: sql`${translationUsageDays.reservedTokens} - ${reservation.reservedTokens}`,
            chargedTokens: sql`${translationUsageDays.chargedTokens} + ${chargedTokens}`,
            updatedAt: input.now,
          })
          .where(
            eq(translationUsageDays.usageDate, reservation.usageDate),
          );
        await transaction
          .update(tokenReservations)
          .set({
            status: "settled",
            chargedTokens,
            settledAt: input.now,
          })
          .where(eq(tokenReservations.id, reservation.id));

        return { chargedTokens };
      });
    },

    reconcileStale(input) {
      return db.transaction(async (transaction) => {
        const staleReservations = await transaction
          .select()
          .from(tokenReservations)
          .where(
            or(
              and(
                eq(tokenReservations.status, "reserved"),
                lte(tokenReservations.createdAt, input.reservedBefore),
              ),
              and(
                eq(tokenReservations.status, "request_started"),
                lte(
                  tokenReservations.requestStartedAt,
                  input.requestStartedBefore,
                ),
              ),
            ),
          )
          .for("update", { skipLocked: true });

        let released = 0;
        let charged = 0;

        for (const reservation of staleReservations) {
          const chargedTokens =
            reservation.status === "request_started"
              ? reservation.reservedTokens
              : 0;

          await transaction
            .update(translationUsageDays)
            .set({
              reservedTokens: sql`${translationUsageDays.reservedTokens} - ${reservation.reservedTokens}`,
              chargedTokens: sql`${translationUsageDays.chargedTokens} + ${chargedTokens}`,
              updatedAt: input.now,
            })
            .where(
              eq(translationUsageDays.usageDate, reservation.usageDate),
            );
          await transaction
            .update(tokenReservations)
            .set({
              status:
                reservation.status === "request_started"
                  ? "settled"
                  : "released",
              chargedTokens,
              settledAt: input.now,
            })
            .where(eq(tokenReservations.id, reservation.id));

          if (reservation.status === "request_started") {
            charged += 1;
          } else {
            released += 1;
          }
        }

        return { released, charged };
      });
    },

    async getAvailability(now) {
      const [settings] = await db
        .select({ dailyTokenLimit: translationSettings.dailyTokenLimit })
        .from(translationSettings)
        .where(eq(translationSettings.singleton, true))
        .limit(1);
      if (settings?.dailyTokenLimit == null) {
        return { configured: false };
      }

      const usageDate = getShanghaiUsageDate(now);
      await db
        .insert(translationUsageDays)
        .values({
          usageDate,
          tokenLimit: settings.dailyTokenLimit,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [usage] = await db
        .select({
          tokenLimit: translationUsageDays.tokenLimit,
          reservedTokens: translationUsageDays.reservedTokens,
          chargedTokens: translationUsageDays.chargedTokens,
        })
        .from(translationUsageDays)
        .where(eq(translationUsageDays.usageDate, usageDate))
        .limit(1);
      if (!usage) {
        throw new Error("Translation usage day could not be created");
      }

      const remaining = Math.max(
        0,
        usage.tokenLimit - usage.reservedTokens - usage.chargedTokens,
      );
      return {
        configured: true,
        exhausted: remaining === 0,
        remaining,
        resetAt: getNextShanghaiReset(now),
      };
    },
  };
}
