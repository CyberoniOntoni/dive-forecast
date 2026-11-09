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
  /** Guard the set of keys too, not only the rows a change touched: a count over the list decides the change. */
  watchMembership?: boolean;
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

/** Membership watched, for the daily limit on added sites per diver (lib/store.ts addUserSite). */
const sites: Table<Site> = {
  name: "sites",
  key: (site) => site.id,
  columns: (site) => ({ added_by: site.addedBy ?? null }),
  schema: { columns: ["added_by TEXT"], indexes: ["added_by"] },
  watchMembership: true,
};

/**
 * Email is unique here too, so two first sign-ins racing cannot make two accounts for one address. The nickname is
 * unique by a separate index (NICKNAME_INDEX), made after the table, so a database that already holds two equal
 * nicknames still starts.
 */
const users: Table<User> = {
  name: "users",
  key: (user) => user.id,
  columns: (user) => ({ email: user.email, nickname_key: user.nickname.toLowerCase() }),
  schema: { columns: ["email TEXT NOT NULL UNIQUE", "nickname_key TEXT NOT NULL"], indexes: ["nickname_key"] },
};

/**
 * The sign-in limits count these rows (lib/accounts.ts), so a change to the list is written only if nobody else
 * added or removed one since it was read (watchMembership).
 */
const logins: Table<PendingLogin> = {
  name: "logins",
  key: (login) => `${login.email}\u0000${login.sentAt}\u0000${login.codeHash}`,
  columns: (login) => ({ email: login.email, sent_at: login.sentAt }),
  schema: { columns: ["email TEXT NOT NULL", "sent_at TEXT NOT NULL"], indexes: ["email", "sent_at"] },
  watchMembership: true,
};

const TABLES = [reports, ratings, sites, users, logins] as Table<unknown>[];

/** The table names, which are also the StoreData list names. */
export const STORE_TABLES = TABLES.map((table) => table.name);
/** meta row set once store.json from R2 has been copied in. */
const IMPORTED_KEY = "imported_r2_store";
/** meta row that every write changes, so a reader can tell whether its copy of the store is still current. */
export const STORE_VERSION_KEY = "store_version";
/**
 * A write's preconditions: each guard inserts 1 here when what it checks still holds and 0 when not, and the CHECK
 * turns a 0 into an error that rolls the whole batch back. The batch empties the table again at its end.
 */
const GUARD_TABLE = "store_guard";
export const GUARD_FAILED = /CHECK constraint failed: store_unchanged/;
const NICKNAME_INDEX = "CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_unique ON users (nickname_key)";
const R2_STORE_KEY = "store.json";

function schemaStatements(db: D1Database): D1PreparedStatement[] {
  return [
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    `CREATE TABLE IF NOT EXISTS ${GUARD_TABLE} (ok INTEGER NOT NULL CONSTRAINT store_unchanged CHECK (ok = 1))`,
    ...TABLES.flatMap((table) => [
      `CREATE TABLE IF NOT EXISTS ${table.name} (key TEXT PRIMARY KEY, data TEXT NOT NULL, ${table.schema.columns.join(", ")})`,
      ...table.schema.indexes.map(
        (column) => `CREATE INDEX IF NOT EXISTS ${table.name}_${column} ON ${table.name} (${column})`,
      ),
    ]),
  ].map((sql) => db.prepare(sql));
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
  // Its own batch: two accounts that already share a nickname must not stop the app. Signing up still checks names.
  await db.batch([db.prepare(NICKNAME_INDEX)]).catch((error: unknown) => {
    console.error("Nicknames are not unique in D1, so the unique index was not made", error);
  });
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
    await db.batch([...inserts, done, versionBump(db)]);
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
  return (await loadD1Rows(db)).store;
}

/** The rows' JSON as stored, by list and key: the guards compare against these exact strings. */
export type StoreRaw = Map<keyof StoreData, Map<string, string>>;

/** Every table and the store version, in one round trip, with each row's JSON as stored. */
export async function loadD1Rows(db: D1Database): Promise<{ store: StoreData; raw: StoreRaw; version: string }> {
  const results = (await db.batch([
    ...TABLES.map((table) => db.prepare(`SELECT '${table.name}' AS list, data FROM ${table.name} ORDER BY rowid`)),
    versionQuery(db),
  ])) as { results: Record<string, unknown>[] }[];
  const rows = results.slice(0, TABLES.length).flatMap((part) => part.results) as StoreRow[];
  const store = storeFromRows(rows);
  const raw: StoreRaw = new Map(TABLES.map((table) => [table.name, new Map<string, string>()]));
  for (const table of TABLES) {
    const list = store[table.name] as unknown[];
    const strings = rows.filter((row) => row.list === table.name).map((row) => row.data);
    list.forEach((item, index) => raw.get(table.name)!.set(table.key(item), strings[index]));
  }
  return { store, raw, version: versionFrom(results[TABLES.length]?.results) };
}

function versionQuery(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT value FROM meta WHERE key = ?").bind(STORE_VERSION_KEY);
}

function versionFrom(rows: Record<string, unknown>[] | undefined): string {
  const value = rows?.[0]?.value;
  return typeof value === "string" ? value : "none";
}

/** The store's version: one row, so a request can keep using its isolate's copy while nothing was written. */
export async function readStoreVersion(db: D1Database): Promise<string> {
  const row = await versionQuery(db).first<{ value?: unknown }>();
  return typeof row?.value === "string" ? row.value : "none";
}

function versionBump(db: D1Database): D1PreparedStatement {
  return db
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(STORE_VERSION_KEY, crypto.randomUUID());
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
 *
 * Every write is guarded: it goes ahead only if its row is still as `before` read it (or still missing, for a new
 * one), and for a list that watches its membership, only if no row was added or removed. Otherwise the whole batch
 * fails with GUARD_FAILED and nothing is written, so a change made from a stale read is never saved over a newer one
 * (lib/store.ts reads again and retries). `raw` is the rows' JSON as read; without it the guard compares `before`'s
 * own JSON. Records the change did not touch are not guarded, so writers of different rows never wait on each other.
 */
export function storeChanges(db: D1Database, before: StoreData, after: StoreData, raw?: StoreRaw): D1PreparedStatement[] {
  const guards: D1PreparedStatement[] = [];
  const writes: D1PreparedStatement[] = [];
  for (const table of TABLES) {
    const read = raw?.get(table.name);
    const old = new Map((before[table.name] as unknown[]).map((item) => [table.key(item), JSON.stringify(item)]));
    const stored = (key: string) => read?.get(key) ?? old.get(key);
    const kept = new Set<string>();
    let touched = false;
    for (const item of after[table.name] as unknown[]) {
      const key = table.key(item);
      kept.add(key);
      if (old.get(key) === JSON.stringify(item)) continue;
      touched = true;
      guards.push(rowGuard(db, table.name, key, old.has(key) ? stored(key)! : null));
      writes.push(upsert(db, table, item, "replace"));
    }
    for (const key of old.keys()) {
      if (kept.has(key)) continue;
      touched = true;
      guards.push(rowGuard(db, table.name, key, stored(key)!));
      writes.push(db.prepare(`DELETE FROM ${table.name} WHERE key = ?`).bind(key));
    }
    if (touched && table.watchMembership) guards.push(membershipGuard(db, table.name, [...old.keys()]));
  }
  if (writes.length === 0) return [];
  return [...guards, ...writes, versionBump(db), db.prepare(`DELETE FROM ${GUARD_TABLE}`)];
}

/** Passes while the row's JSON is still `data`, or while there is still no row when `data` is null. */
function rowGuard(db: D1Database, list: string, key: string, data: string | null): D1PreparedStatement {
  return data == null
    ? db.prepare(`INSERT INTO ${GUARD_TABLE} (ok) SELECT COUNT(*) = 0 FROM ${list} WHERE key = ?`).bind(key)
    : db.prepare(`INSERT INTO ${GUARD_TABLE} (ok) SELECT COUNT(*) FROM ${list} WHERE key = ? AND data = ?`).bind(key, data);
}

/** Passes while the list holds exactly these keys. */
function membershipGuard(db: D1Database, list: string, keys: readonly string[]): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${GUARD_TABLE} (ok) SELECT (SELECT COUNT(*) FROM ${list}) = ? AND NOT EXISTS ` +
        `(SELECT 1 FROM ${list} WHERE key NOT IN (SELECT value FROM json_each(?)))`,
    )
    .bind(keys.length, JSON.stringify(keys));
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
