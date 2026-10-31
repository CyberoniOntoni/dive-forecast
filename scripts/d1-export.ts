/**
 * Writes the worker's D1 store (reports, ratings, added pins, accounts, sign-in codes) as a store.json, for
 * `npm run verify`, `npm run replay -- --store` or a Docker host. Needs wrangler signed in to the account.
 *
 *   npm run d1:export                 writes data/store.json
 *   npm run d1:export -- some.json    writes another file
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { STORE_TABLES, storeFromRows } from "../lib/store-d1";

const out = path.resolve(process.argv[2] ?? path.join("data", "store.json"));
const sql = STORE_TABLES.map((table) => `SELECT '${table}' AS list, rowid AS n, data FROM ${table}`).join(" UNION ALL ");
const raw = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "dive-forecast", "--remote", "--json", "--command", `${sql} ORDER BY list, n`],
  { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
);
const rows = (JSON.parse(raw) as { results: { list: string; data: string }[] }[]).flatMap((part) => part.results);
const store = storeFromRows(rows);
fs.writeFileSync(out, `${JSON.stringify(store, null, 2)}\n`);
console.log(`${out}: ${STORE_TABLES.map((table) => `${store[table].length} ${table}`).join(", ")}`);
