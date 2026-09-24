import fs from "fs";
import path from "path";
import { marineHoursFromApi } from "../lib/marine";
import { replayReports } from "../lib/replay";
import { readStore } from "../lib/store";
import type { MarineHour } from "../lib/types";

const CACHE_DIR = path.join(process.cwd(), "data", "marine-cache");
const OUT_PATH = path.join(process.cwd(), "data", "replay.json");

function main(): void {
  const reports = readStore().reports;
  const hours = newestCachedHours();
  if (!hours || reports.length === 0) {
    writeOk(true);
    process.exit(0);
  }
  const result = replayReports({ hours, inwardBearingDeg: 0, reports });
  writeOk(result.ok);
  process.exit(result.ok ? 0 : 1);
}

function writeOk(ok: boolean): void {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify({ ok }, null, 2)}\n`);
}

type CachedHours = { hours: MarineHour[]; fetchedAt: number; mtimeMs: number };

function newestCachedHours(): MarineHour[] | null {
  let names: string[];
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch {
    return null;
  }
  let best: CachedHours | null = null;
  for (const name of names) {
    const full = path.join(CACHE_DIR, name);
    let stat: fs.Stats;
    let raw: string;
    try {
      stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const parsed = parseCachedHours(raw);
    if (!parsed) continue;
    const candidate = { hours: parsed.hours, fetchedAt: parsed.fetchedAt, mtimeMs: stat.mtimeMs };
    if (!best || isNewer(candidate, best)) best = candidate;
  }
  return best?.hours ?? null;
}

function isNewer(left: CachedHours, right: CachedHours): boolean {
  if (left.mtimeMs !== right.mtimeMs) return left.mtimeMs > right.mtimeMs;
  return left.fetchedAt > right.fetchedAt;
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
