import { describe, expect, it, vi } from "vitest";

import { checkDatabaseWriteHealth } from "@/modules/operations/database-write-health";

function createDatabase(options: { fail?: boolean } = {}) {
  const transaction = {
    execute: vi.fn(async () => {
      if (options.fail) {
        throw new Error("could not write to file");
      }
    }),
  };
  const db = {
    transaction: vi.fn(async (callback: (tx: typeof transaction) => void) =>
      callback(transaction),
    ),
  };

  return { db, transaction };
}

describe("database write health", () => {
  it("reports writable after a transaction-scoped temporary table write", async () => {
    const checkedAt = new Date("2026-06-18T08:00:00.000Z");
    const { db, transaction } = createDatabase();

    await expect(
      checkDatabaseWriteHealth(db, () => checkedAt),
    ).resolves.toEqual({
      checkedAt,
      writable: true,
    });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(transaction.execute).toHaveBeenCalledTimes(2);
  });

  it("reports database write failure without throwing", async () => {
    const checkedAt = new Date("2026-06-18T08:00:00.000Z");
    const { db } = createDatabase({ fail: true });

    await expect(
      checkDatabaseWriteHealth(db, () => checkedAt),
    ).resolves.toEqual({
      checkedAt,
      code: "database_write_unavailable",
      message: "could not write to file",
      writable: false,
    });
  });
});
