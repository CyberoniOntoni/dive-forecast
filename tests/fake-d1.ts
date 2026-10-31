import { createRequire } from "module";
import type { D1Database, D1PreparedStatement } from "../lib/cloudflare";

// A D1 binding for tests, on Node's built-in SQLite (in memory). Same SQL dialect as D1; a batch is one transaction.
type SqliteStatement = { all: (...values: unknown[]) => Record<string, unknown>[]; run: (...values: unknown[]) => unknown };
type Sqlite = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStatement };

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

export type FakeD1 = D1Database & { sqlite: Sqlite; failNextBatch?: Error };

type Fake = D1PreparedStatement & { exec: () => Record<string, unknown>[] | { changes: number } };

export function fakeD1(): FakeD1 {
  const sqlite = new DatabaseSync(":memory:");
  const statement = (sql: string, values: unknown[]): Fake => ({
    bind: (...bound) => statement(sql, bound),
    first: async <T,>() => (sqlite.prepare(sql).all(...values)[0] as T) ?? null,
    exec: () => (/^\s*select/i.test(sql) ? sqlite.prepare(sql).all(...values) : (sqlite.prepare(sql).run(...values) as { changes: number })),
  });
  const db: FakeD1 = {
    sqlite,
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      const failure = db.failNextBatch;
      db.failNextBatch = undefined;
      sqlite.exec("BEGIN");
      try {
        if (failure) throw failure;
        const results = statements.map((item) => {
          const out = (item as Fake).exec();
          return Array.isArray(out) ? { results: out.map((row) => ({ ...row })) } : out;
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
}
