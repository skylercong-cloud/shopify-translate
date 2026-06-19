import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "@/db/client";
import { createTokenBudgetRepository } from "@/db/repositories/token-budget-repository";
import {
  tokenReservations,
  translationSettings,
  translationUsageDays,
} from "@/db/schema";
import { getEnv } from "@/lib/env";

const repository = createTokenBudgetRepository(db);
const now = new Date("2026-06-15T08:00:00.000Z");

async function setDailyTokenLimit(dailyTokenLimit: number | null) {
  await db
    .insert(translationSettings)
    .values({ singleton: true, dailyTokenLimit })
    .onConflictDoUpdate({
      target: translationSettings.singleton,
      set: { dailyTokenLimit, updatedAt: now },
    });
}

beforeAll(() => {
  const env = getEnv();
  const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

  if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error("Integration tests require a dedicated *_test database");
  }
});

beforeEach(async () => {
  await setDailyTokenLimit(100);
});

afterEach(async () => {
  await db.delete(tokenReservations);
  await db.delete(translationUsageDays);
  await setDailyTokenLimit(null);
});

describe("translation token budget repository", () => {
  it("atomically prevents concurrent reservations from exceeding the limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.reserve({
          jobId: null,
          blockId: null,
          provider: index % 2 === 0 ? "deepseek" : "qwen",
          tokens: 30,
          now,
        }),
      ),
    );

    expect(results.filter((result) => result.reserved)).toHaveLength(3);
    expect(results.filter((result) => !result.reserved)).toHaveLength(7);
    await expect(repository.getAvailability(now)).resolves.toEqual({
      configured: true,
      exhausted: false,
      remaining: 10,
      resetAt: new Date("2026-06-15T16:00:00.000Z"),
    });
  });

  it("shares one daily budget between DeepSeek and Qwen", async () => {
    await expect(
      repository.reserve({
        jobId: null,
        blockId: null,
        provider: "deepseek",
        tokens: 60,
        now,
      }),
    ).resolves.toMatchObject({ reserved: true });

    await expect(
      repository.reserve({
        jobId: null,
        blockId: null,
        provider: "qwen",
        tokens: 50,
        now,
      }),
    ).resolves.toEqual({
      reserved: false,
      reason: "budget_exhausted",
      resumeAt: new Date("2026-06-15T16:00:00.000Z"),
    });
  });

  it("marks a request once and settles reported usage idempotently", async () => {
    const reserved = await repository.reserve({
      jobId: null,
      blockId: null,
      provider: "deepseek",
      tokens: 80,
      now,
    });
    expect(reserved.reserved).toBe(true);
    if (!reserved.reserved) throw new Error("Expected a reservation");

    const startedAt = new Date("2026-06-15T08:01:00.000Z");
    await repository.markRequestStarted(reserved.reservationId, startedAt);
    await repository.markRequestStarted(
      reserved.reservationId,
      new Date("2026-06-15T08:02:00.000Z"),
    );

    await expect(
      repository.settle({
        reservationId: reserved.reservationId,
        reportedInputTokens: 20,
        reportedOutputTokens: 10,
        now: new Date("2026-06-15T08:03:00.000Z"),
      }),
    ).resolves.toEqual({ chargedTokens: 30 });
    await expect(
      repository.settle({
        reservationId: reserved.reservationId,
        reportedInputTokens: 1,
        reportedOutputTokens: 1,
        now: new Date("2026-06-15T08:04:00.000Z"),
      }),
    ).resolves.toEqual({ chargedTokens: 30 });

    await expect(
      db.query.tokenReservations.findFirst({
        where: eq(tokenReservations.id, reserved.reservationId),
      }),
    ).resolves.toMatchObject({
      status: "settled",
      requestStartedAt: startedAt,
      chargedTokens: 30,
    });
    await expect(db.query.translationUsageDays.findFirst()).resolves.toMatchObject(
      {
        reservedTokens: 0,
        chargedTokens: 30,
      },
    );
  });

  it("charges the full reservation when provider usage is missing", async () => {
    const reserved = await repository.reserve({
      jobId: null,
      blockId: null,
      provider: "qwen",
      tokens: 80,
      now,
    });
    if (!reserved.reserved) throw new Error("Expected a reservation");

    await expect(
      repository.settle({
        reservationId: reserved.reservationId,
        reportedInputTokens: null,
        reportedOutputTokens: null,
        now,
      }),
    ).resolves.toEqual({ chargedTokens: 80 });
  });

  it("releases stale reservations and fully charges started requests", async () => {
    const staleAt = new Date("2026-06-15T07:00:00.000Z");
    const staleReserved = await repository.reserve({
      jobId: null,
      blockId: null,
      provider: "deepseek",
      tokens: 20,
      now: staleAt,
    });
    const staleStarted = await repository.reserve({
      jobId: null,
      blockId: null,
      provider: "qwen",
      tokens: 30,
      now: staleAt,
    });
    const fresh = await repository.reserve({
      jobId: null,
      blockId: null,
      provider: "deepseek",
      tokens: 10,
      now,
    });
    if (
      !staleReserved.reserved ||
      !staleStarted.reserved ||
      !fresh.reserved
    ) {
      throw new Error("Expected reservations");
    }
    await repository.markRequestStarted(staleStarted.reservationId, staleAt);

    await expect(
      repository.reconcileStale({
        reservedBefore: new Date("2026-06-15T07:30:00.000Z"),
        requestStartedBefore: new Date("2026-06-15T07:30:00.000Z"),
        now,
      }),
    ).resolves.toEqual({ released: 1, charged: 1 });
    await expect(
      repository.reconcileStale({
        reservedBefore: new Date("2026-06-15T07:30:00.000Z"),
        requestStartedBefore: new Date("2026-06-15T07:30:00.000Z"),
        now,
      }),
    ).resolves.toEqual({ released: 0, charged: 0 });

    await expect(db.query.translationUsageDays.findFirst()).resolves.toMatchObject(
      {
        reservedTokens: 10,
        chargedTokens: 30,
      },
    );
    await expect(
      db.query.tokenReservations.findFirst({
        where: eq(tokenReservations.id, staleReserved.reservationId),
      }),
    ).resolves.toMatchObject({ status: "released", chargedTokens: 0 });
    await expect(
      db.query.tokenReservations.findFirst({
        where: eq(tokenReservations.id, staleStarted.reservationId),
      }),
    ).resolves.toMatchObject({ status: "settled", chargedTokens: 30 });
  });

  it("reports unconfigured and exhausted availability", async () => {
    await setDailyTokenLimit(null);
    await expect(repository.getAvailability(now)).resolves.toEqual({
      configured: false,
    });

    await setDailyTokenLimit(100);
    await repository.reserve({
      jobId: null,
      blockId: null,
      provider: "deepseek",
      tokens: 100,
      now,
    });
    await expect(repository.getAvailability(now)).resolves.toEqual({
      configured: true,
      exhausted: true,
      remaining: 0,
      resetAt: new Date("2026-06-15T16:00:00.000Z"),
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid reservation tokens: %s",
    async (tokens) => {
      await expect(
        repository.reserve({
          jobId: null,
          blockId: null,
          provider: "deepseek",
          tokens,
          now,
        }),
      ).rejects.toThrow("tokens must be a positive safe integer");
    },
  );
});
