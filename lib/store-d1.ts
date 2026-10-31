import type { D1Database, D1PreparedStatement, R2Bucket } from "./cloudflare";
import type { PendingLogin, Rating, Report, Site, StoreData, User } from "./types";

/**
 * The store in Cloudflare D1, on a worker. One table per StoreData list: each row holds the record as JSON (`data`)
 * under a key, plus a few columns to search by. Rows come back in the order they were first written (rowid), so the
 * lists read the same as they did from store.json. A change writes only the rows it touched, in one D1 batch, which
 * runs as one transaction.
 */

type Table<T> = {
  name: keyof StoreData;
  key: (item: T) => string;
  /** Extra columns besides key and data, by name. */
  columns: (item: T) => Record<string, string | number | null>;
  /** Column definitions besides key and data, and the indexes. */
  schema: { columns: string[]; indexes: string[] };
};

const reports: Table<Report> = {
  name: "reports",
  key: (report) => report.id,
  columns: (report) => ({
    site_id: report.siteId,
    user_id: report.userId ?? null,
    filed_at: report.filedAt ?? null,
  }),
  schema: {
    columns: ["site_id TEXT NOT NULL", "user_id TEXT", "filed_at TEXT"],
    indexes: ["site_id", "user_id", "filed_at"],
  },
};

/** One per diver per site; the old anonymous rating of a site (no userId) has an empty user_id. */
const ratings: Table<Rating> = {
  name: "ratings",
  key: (rating) => `${rating.siteId}\u0000${rating.userId ?? ""}`,
  columns: (rating) => ({ site_id: rating.siteId, user_id: rating.userId ?? "" }),
  schema: { columns: ["site_id TEXT NOT NULL", "user_id TEXT NOT NULL"], indexes: ["site_id", "user_id"] },
};

const sites: Table<Site> = {
  name: "sites",
  key: (site) => site.id,
  columns: (site) => ({ added_by: site.addedBy ?? null }),
  schema: { columns: ["added_by TEXT"], indexes: ["added_by"] },
};

/** Email is unique here too, so two first sign-ins racing cannot make two accounts for one address. */
const users: Table<User> = {
  name: "users",
  key: (user) => user.id,
  columns: (user) => ({ email: user.email, nickname_key: user.nickname.toLowerCase() }),
  schema: { columns: ["email TEXT NOT NULL UNIQUE", "nickname_key TEXT NOT NULL"], indexes: ["nickname_key"] },
};

const logins: Table<PendingLogin> = {
  name: "logins",
  key: (login) => `${login.email}\u0000${login.sentAt}\u0000${login.codeHash}`,
  columns: (login) => ({ email: login.email, sent_at: login.sentAt }),
  schema: { columns: ["email TEXT NOT NULL", "sent_at TEXT NOT NULL"], indexes: ["email", "sent_at"] },
};

const TABLES = [reports, ratings, sites, users, logins] as Table<unknown>[];

/** Bump with a new step in schemaStatements when the tables change. */
export const D1_SCHEMA_VERSION = "1";
/** meta row set once store.json from R2 has been copied in. */
const IMPORTED_KEY = "imported_r2_store";
const R2_STORE_KEY = "store.json";

function schemaStatements(db: D1Database): D1PreparedStatement[] {
  const statements = [
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ...TABLES.flatMap((table) => [
      `CREATE TABLE IF NOT EXISTS ${table.name} (key TEXT PRIMARY KEY, data TEXT NOT NULL, ${table.schema.columns.join(", ")})`,
      ...table.schema.indexes.map(
        (column) => `CREATE INDEX IF NOT EXISTS ${table.name}_${column} ON ${table.name} (${column})`,
      ),
    ]),
  ].map((sql) => db.prepare(sql));
  statements.push(
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").bind(D1_SCHEMA_VERSION),
  );
  return statements;
}

/** Per isolate. A plain flag, not a promise: a worker request must not wait on another request's I/O. */
let prepared = false;

/**
 * Creates the tables if they are missing and, the first time, copies store.json from R2 into them (one batch, so it
 * is all or nothing, and marked done in the same batch). Records already in D1 win over the R2 copy, so a request
 * that imports late changes nothing. The R2 object is left as it is, as a backup. Once per isolate.
 */
export async function prepareD1(db: D1Database, bucket: R2Bucket): Promise<void> {
  if (prepared) return;
  await db.batch(schemaStatements(db));
  const imported = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(IMPORTED_KEY).first();
  if (!imported) {
    const object = await bucket.get(R2_STORE_KEY);
    const store = object ? parseR2Store(await object.text()) : emptyStore();
    const inserts = TABLES.flatMap((table) =>
      (store[table.name] as unknown[]).map((item) => upsert(db, table, item, "keep")),
    );
    const done = db
      .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)")
      .bind(IMPORTED_KEY, new Date().toISOString());
    await db.batch([...inserts, done]);
  }
  prepared = true;
}

/** store.json from R2. Unreadable JSON stops the import (and the app) rather than starting from nothing. */
function parseR2Store(raw: string): StoreData {
  try {
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    throw new Error(`store.json in R2 is not valid JSON, so it was not copied to D1: ${(error as Error).message}`);
  }
}

export function emptyStore(): StoreData {
  return { reports: [], ratings: [], sites: [], users: [], logins: [] };
}

export function normalizeStore(parsed: unknown): StoreData {
  const record = parsed as Partial<StoreData>;
  return {
    reports: Array.isArray(record.reports) ? record.reports : [],
    ratings: Array.isArray(record.ratings) ? record.ratings : [],
    sites: Array.isArray(record.sites) ? record.sites : [],
    users: Array.isArray(record.users) ? record.users : [],
    logins: Array.isArray(record.logins) ? record.logins : [],
  };
}

/** Every table, in one round trip. */
export async function loadD1Store(db: D1Database): Promise<StoreData> {
  const results = (await db.batch(
    TABLES.map((table) => db.prepare(`SELECT '${table.name}' AS list, data FROM ${table.name} ORDER BY rowid`)),
  )) as { results: StoreRow[] }[];
  return storeFromRows(results.flatMap((part) => part.results));
}

export type StoreRow = { list: string; data: string };

/** Rows of (list name, record JSON), each list's rows in order, as StoreData. Rows of an unknown list are skipped. */
export function storeFromRows(rows: readonly StoreRow[]): StoreData {
  const store = emptyStore();
  for (const row of rows) {
    if (TABLES.some((table) => table.name === row.list)) {
      (store[row.list as keyof StoreData] as unknown[]).push(JSON.parse(row.data));
    }
  }
  return store;
}

/**
 * The writes that turn `before` into `after`: an upsert for each new or changed record, a delete for each one gone.
 * Upserts keep a row's rowid, so a changed record keeps its place in the list.
 */
export function storeChanges(db: D1Database, before: StoreData, after: StoreData): D1PreparedStatement[] {
  return TABLES.flatMap((table) => {
    const old = new Map((before[table.name] as unknown[]).map((item) => [table.key(item), JSON.stringify(item)]));
    const statements: D1PreparedStatement[] = [];
    const kept = new Set<string>();
    for (const item of after[table.name] as unknown[]) {
      const key = table.key(item);
      kept.add(key);
      if (old.get(key) !== JSON.stringify(item)) statements.push(upsert(db, table, item, "replace"));
    }
    for (const key of old.keys()) {
      if (!kept.has(key)) statements.push(db.prepare(`DELETE FROM ${table.name} WHERE key = ?`).bind(key));
    }
    return statements;
  });
}

function upsert<T>(db: D1Database, table: Table<T>, item: T, onConflict: "keep" | "replace"): D1PreparedStatement {
  const extra = table.columns(item);
  const names = ["key", "data", ...Object.keys(extra)];
  const values = [table.key(item), JSON.stringify(item), ...Object.values(extra)];
  const update =
    onConflict === "keep"
      ? "DO NOTHING"
      : `DO UPDATE SET ${names
          .slice(1)
          .map((name) => `${name} = excluded.${name}`)
          .join(", ")}`;
  const sql = `INSERT INTO ${table.name} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT(key) ${update}`;
  return db.prepare(sql).bind(...values);
}
