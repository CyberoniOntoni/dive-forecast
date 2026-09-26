import fs from "fs";
import path from "path";
import { inwardBearingDeg } from "../lib/bearing";
import { marineHoursFromApi, seawardPoint } from "../lib/marine";
import { replayReports } from "../lib/replay";
import { listMergedSites, readCatalog, readStore } from "../lib/store";
import type { Atoll, MarineHour, Report, Site } from "../lib/types";

const CACHE_DIR = path.join(process.cwd(), "data", "marine-cache");
const OUT_PATH = path.join(process.cwd(), "data", "replay.json");

function main(): void {
  const reports = readStore().reports;
  if (reports.length === 0) {
    writeOk(true);
    process.exit(0);
  }

  const sites = listMergedSites();
  const catalog = readCatalog();
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const atollById = new Map(catalog.atolls.map((atoll) => [atoll.id, atoll]));

  let allOk = true;
  for (const siteReports of groupBySiteId(reports).values()) {
    const site = siteById.get(siteReports[0].siteId);
    if (!site) continue;
    const atoll = atollById.get(site.atollId);
    if (!atoll) continue;
    if (scoreSite(site, catalog.sites, atoll, siteReports) === false) allOk = false;
  }

  writeOk(allOk);
  process.exit(allOk ? 0 : 1);
}

function groupBySiteId(reports: readonly Report[]): Map<string, Report[]> {
  const grouped = new Map<string, Report[]>();
  for (const report of reports) {
    const list = grouped.get(report.siteId);
    if (list) list.push(report);
    else grouped.set(report.siteId, [report]);
  }
  return grouped;
}

/** C10: this pin's seaward cache, then its atoll sample. No file skips the site. */
function scoreSite(
  site: Site,
  mates: readonly Site[],
  atoll: Atoll,
  reports: readonly Report[],
): boolean | null {
  const bearing = inwardBearingDeg(site, mates, { lat: atoll.oceanLat, lon: atoll.oceanLon });
  const seaward = seawardPoint(site.lat, site.lon, bearing);
  const hours = cachedHoursAt(seaward.lat, seaward.lon) ?? cachedHoursAt(atoll.oceanLat, atoll.oceanLon);
  if (!hours) return null;
  return replayReports({ hours, inwardBearingDeg: bearing, reports }).ok;
}

function writeOk(ok: boolean): void {
  const dir = path.dirname(OUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.replay.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify({ ok }, null, 2)}\n`);
    fs.renameSync(tmpPath, OUT_PATH);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

function cachedHoursAt(lat: number, lon: number): MarineHour[] | null {
  const name = `${(lat === 0 ? 0 : lat).toFixed(4)}_${(lon === 0 ? 0 : lon).toFixed(4)}.json`.replace(
    /[^0-9.+_-]/g,
    "",
  );
  try {
    return parseCachedHours(fs.readFileSync(path.join(CACHE_DIR, name), "utf8"))?.hours ?? null;
  } catch {
    return null;
  }
}

function parseCachedHours(raw: string): { hours: MarineHour[]; fetchedAt: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { fetchedAt?: unknown; hours?: unknown; body?: unknown };
  const fetchedAt =
    typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt) ? record.fetchedAt : 0;
  const stored = storedHours(record.hours);
  if (stored) return { hours: stored, fetchedAt };
  const fromBody = "body" in record ? marineHoursFromApi(record.body) : null;
  if (fromBody && fromBody.length > 0) return { hours: fromBody, fetchedAt };
  const direct = marineHoursFromApi(parsed);
  if (direct && direct.length > 0) return { hours: direct, fetchedAt };
  return null;
}

function storedHours(value: unknown): MarineHour[] | null {
  if (!Array.isArray(value)) return null;
  const hours: MarineHour[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const hour = item as Partial<MarineHour>;
    if (typeof hour.time !== "string") return null;
    hours.push({
      time: hour.time,
      seaLevelM: numberOrNull(hour.seaLevelM),
      currentVelocityMs: numberOrNull(hour.currentVelocityMs),
      currentDirectionDeg: numberOrNull(hour.currentDirectionDeg),
    });
  }
  return hours.length > 0 ? hours : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

main();
