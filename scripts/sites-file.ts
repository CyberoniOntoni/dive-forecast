import fs from "fs";
import path from "path";
import type { Catalog } from "../lib/types";

const SITES_PATH = path.join(process.cwd(), "data", "sites.json");

/** Rewrites only the sites list of data/sites.json, keeping its other keys, two-space layout and line endings. */
export function writeSites(sites: Catalog["sites"]): void {
  const raw = fs.readFileSync(SITES_PATH, "utf8");
  const file = JSON.parse(raw) as Catalog;
  file.sites = sites;
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  fs.writeFileSync(SITES_PATH, `${JSON.stringify(file, null, 2)}\n`.replace(/\n/g, eol));
}
