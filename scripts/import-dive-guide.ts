import fs from "fs";
import path from "path";
import { atollForPin, resolveBearing } from "../lib/bearing";
import { atollForGuideCode, matchGuideSite, parseDepthRange, siteIdFor } from "../lib/dive-guide";
import { seawardPoint } from "../lib/marine";
import { pointInRing, rimForAtoll } from "../lib/rim";
import { deriveSiteType, SITE_TYPE_LABEL } from "../lib/site-type";
import { readCatalog } from "../lib/store";
import type { BearingSource, Site } from "../lib/types";
import { writeSites } from "./sites-file";

/**
 * Proposes the dive-guide sites of one atoll for data/sites.json, and applies the ones a person approved.
 *
 *   npm run import-dive-guide -- --atoll V            write data/sources/import-V.json and import-V.review.md
 *   npm run import-dive-guide -- --atoll V --apply    add the approved sites to data/sites.json
 *   npm run import-dive-guide -- --atoll K --new "Cocoa Corner" --new "Kandooma Caves"
 *                                                     propose those as new sites even though they sit close to a
 *                                                     seeded site under another name (a person has said they differ)
 *
 * Every guide site gets a decision in the JSON file:
 *   "add"          a new site (the proposed record is in "site"; edit it freely before applying)
 *   "match:<id>"   the same as a seeded site; fills that site's dive depths only if it has none
 *   "skip"         leave it out
 *   "review"       a person has to decide; --apply refuses while any remain
 */

type Candidate = {
  guideId: number;
  name: string;
  lat: number;
  lon: number;
  decision: string;
  reason: string;
  site?: Site;
  bearing?: { deg: number; source: BearingSource; sampleInOcean: boolean | null };
};

type ImportFile = { atollCode: string; generatedAt: string; candidates: Candidate[] };

type GuideFile = {
  source: string;
  sourceUrl: string;
  sites: { guideId: number; name: string; atollCode: string; lat: number; lon: number; depth: string | null }[];
};

const SOURCES = path.join(process.cwd(), "data", "sources");

function propose(atollCode: string, separate: ReadonlySet<string>): void {
  const guide = JSON.parse(fs.readFileSync(path.join(SOURCES, "dive-guide-sites.json"), "utf8")) as GuideFile;
  const catalog = readCatalog();
  const taken = new Set(catalog.sites.map((site) => site.id));
  const candidates: Candidate[] = [];

  for (const record of guide.sites.filter((item) => item.atollCode === atollCode)) {
    const base = { guideId: record.guideId, name: record.name, lat: record.lat, lon: record.lon };
    const verdict = separate.has(record.name.toLowerCase()) ? { kind: "new" as const } : matchGuideSite(record, catalog.sites);
    if (verdict.kind === "match") {
      candidates.push({ ...base, decision: `match:${verdict.siteId}`, reason: `same site, ${verdict.km.toFixed(2)} km` });
      continue;
    }
    if (verdict.kind === "review") {
      const other = catalog.sites.find((site) => site.id === verdict.siteId)?.name ?? verdict.siteId;
      candidates.push({ ...base, decision: "review", reason: `${verdict.reason}: ${other}, ${verdict.km.toFixed(2)} km` });
      continue;
    }
    const picked = atollForPin(record.lat, record.lon, catalog.atolls);
    const atoll = picked ? atollForGuideCode(picked, catalog.atolls, record.atollCode) : null;
    if (!atoll) {
      candidates.push({ ...base, decision: "review", reason: "not in or near a seeded atoll outline" });
      continue;
    }
    const id = siteIdFor(record.name, taken);
    taken.add(id);
    const ring = rimForAtoll(atoll);
    const depth = parseDepthRange(record.depth);
    const site: Site = {
      id,
      name: record.name,
      atollId: atoll.id,
      lat: record.lat,
      lon: record.lon,
      sourceUrl: guide.sourceUrl,
      ...depth,
      ...(depth.diveTopM != null || depth.diveMaxM != null ? { depthSourceUrl: guide.sourceUrl } : {}),
    };
    const siteType = deriveSiteType(site, ring);
    if (siteType) Object.assign(site, { siteType, siteTypeSource: "derived" as const });
    candidates.push({ ...base, decision: "add", reason: "new", site });
  }

  // Bearings with the whole batch in place: the fallback heuristic aims at the atoll's other sites.
  const added = candidates.flatMap((item) => (item.site ? [item.site] : []));
  const mates = [...catalog.sites, ...added];
  for (const item of candidates) {
    if (!item.site) continue;
    const atoll = catalog.atolls.find((entry) => entry.id === item.site!.atollId)!;
    const ring = rimForAtoll(atoll);
    const { deg, source } = resolveBearing(item.site, mates, { lat: atoll.oceanLat, lon: atoll.oceanLon }, ring);
    const sample = seawardPoint(item.site.lat, item.site.lon, deg);
    item.bearing = { deg: Math.round(deg), source, sampleInOcean: ring ? !pointInRing(sample.lat, sample.lon, ring) : null };
  }

  const file: ImportFile = { atollCode, generatedAt: new Date().toISOString(), candidates };
  fs.writeFileSync(path.join(SOURCES, `import-${atollCode}.json`), `${JSON.stringify(file, null, 2)}\n`);
  fs.writeFileSync(path.join(SOURCES, `import-${atollCode}.review.md`), reviewMarkdown(file, bearingShifts(catalog, added)));
  const count = (prefix: string) => candidates.filter((item) => item.decision.startsWith(prefix)).length;
  console.log(
    `${candidates.length} guide sites: ${count("add")} new, ${count("match:")} matched, ${count("review")} to review.`,
    `Wrote data/sources/import-${atollCode}.json and .review.md`,
  );
}

/** Seeded sites whose fallback bearing moves once the new sites join their atoll. */
function bearingShifts(catalog: ReturnType<typeof readCatalog>, added: readonly Site[]): string[] {
  const lines: string[] = [];
  for (const site of catalog.sites) {
    if (!added.some((item) => item.atollId === site.atollId)) continue;
    const atoll = catalog.atolls.find((entry) => entry.id === site.atollId)!;
    const outside = { lat: atoll.oceanLat, lon: atoll.oceanLon };
    const before = resolveBearing(site, catalog.sites, outside, rimForAtoll(atoll));
    const after = resolveBearing(site, [...catalog.sites, ...added], outside, rimForAtoll(atoll));
    const turn = Math.abs(((after.deg - before.deg + 540) % 360) - 180);
    if (turn >= 1) lines.push(`| ${site.name} | ${before.source} | ${Math.round(before.deg)}° | ${Math.round(after.deg)}° |`);
  }
  return lines;
}

function reviewMarkdown(file: ImportFile, shifts: string[]): string {
  const rows = file.candidates.map((item) => {
    const type = item.site?.siteType ? SITE_TYPE_LABEL[item.site.siteType] : "";
    const depth = item.site?.diveMaxM != null ? `${item.site.diveTopM ?? "?"}–${item.site.diveMaxM} m` : "";
    const bearing = item.bearing
      ? `${item.bearing.deg}° ${item.bearing.source}${item.bearing.sampleInOcean === false ? ", sample in lagoon" : ""}`
      : "";
    const pin = `[${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}](https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}#map=15/${item.lat}/${item.lon})`;
    return `| ${item.name} | ${item.decision} | ${item.reason} | ${type} | ${depth} | ${bearing} | ${pin} |`;
  });
  return [
    `# Dive-guide import: atoll ${file.atollCode}`,
    "",
    `Generated ${file.generatedAt}. Edit decisions in \`import-${file.atollCode}.json\`, then run`,
    `\`npm run import-dive-guide -- --atoll ${file.atollCode} --apply\`.`,
    "",
    "Check each new site's type and bearing. A fallback bearing is an estimate (outlined arrow); measure it",
    "(ADDING_SITES.md step 3) or accept it. \"sample in lagoon\" is expected for lagoon sites only.",
    "",
    "| Guide name | Decision | Why | Type | Depth | Bearing | Pin |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Seeded sites whose bearing moves",
    "",
    shifts.length === 0
      ? "None: no seeded site in this atoll uses a bearing that depends on its neighbours."
      : ["| Site | Source | Before | After |", "|---|---|---|---|", ...shifts].join("\n"),
    "",
  ].join("\n");
}

function apply(atollCode: string): void {
  const file = JSON.parse(fs.readFileSync(path.join(SOURCES, `import-${atollCode}.json`), "utf8")) as ImportFile;
  const open = file.candidates.filter((item) => item.decision === "review");
  if (open.length > 0) {
    console.error(`Still to review: ${open.map((item) => item.name).join(", ")}`);
    process.exit(1);
  }
  const catalog = readCatalog();
  const sites = [...catalog.sites];
  const guide = JSON.parse(fs.readFileSync(path.join(SOURCES, "dive-guide-sites.json"), "utf8")) as GuideFile;
  let added = 0;
  let filled = 0;
  for (const item of file.candidates) {
    if (item.decision === "add" && item.site) {
      if (sites.some((site) => site.id === item.site!.id)) throw new Error(`Site id already in use: ${item.site.id}`);
      sites.push(item.site);
      added += 1;
    } else if (item.decision.startsWith("match:")) {
      const target = sites.find((site) => site.id === item.decision.slice("match:".length));
      if (!target) throw new Error(`No seeded site for ${item.decision}`);
      if (target.diveTopM != null || target.diveMaxM != null) continue;
      const depth = parseDepthRange(guide.sites.find((record) => record.guideId === item.guideId)?.depth ?? null);
      if (depth.diveMaxM == null) continue;
      Object.assign(target, depth, { depthSourceUrl: guide.sourceUrl });
      filled += 1;
    }
  }
  writeSites(sites);
  console.log(`${added} sites added, ${filled} seeded sites given dive depths. Run npm test before committing.`);
}

/** Every value given after a repeated flag, lower-cased: --new A --new B. */
function argValues(flag: string): Set<string> {
  const values = new Set<string>();
  process.argv.forEach((arg, index) => {
    const value = process.argv[index + 1];
    if (arg === flag && value) values.add(value.toLowerCase());
  });
  return values;
}

function main(): void {
  const at = process.argv.indexOf("--atoll");
  const atollCode = at >= 0 ? process.argv[at + 1] : undefined;
  if (!atollCode) {
    console.error("Usage: npm run import-dive-guide -- --atoll <code> [--apply]");
    process.exit(2);
  }
  if (process.argv.includes("--apply")) apply(atollCode);
  else propose(atollCode, argValues("--new"));
}

main();
