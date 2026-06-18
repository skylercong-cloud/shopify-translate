import { sql } from "drizzle-orm";

type WriteHealthTransaction = {
  execute(query: unknown): Promise<unknown>;
};

type WriteHealthDatabase = {
  transaction(
    callback: (transaction: WriteHealthTransaction) => unknown,
  ): Promise<unknown>;
};

export type DatabaseWriteHealth =
  | {
      checkedAt: Date;
      writable: true;
    }
  | {
      checkedAt: Date;
      code: "database_write_unavailable";
      message: string;
      writable: false;
    };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function checkDatabaseWriteHealth(
  db: WriteHealthDatabase,
  now: () => Date = () => new Date(),
): Promise<DatabaseWriteHealth> {
  const checkedAt = now();

  try {
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`
        create temporary table if not exists translation_write_health_check (
          value integer
        ) on commit drop
      `);
      await transaction.execute(sql`
        insert into translation_write_health_check(value) values (1)
      `);
    });

    return {
      checkedAt,
      writable: true,
    };
  } catch (error) {
    return {
      checkedAt,
      code: "database_write_unavailable",
      message: errorMessage(error),
      writable: false,
    };
  }
}
