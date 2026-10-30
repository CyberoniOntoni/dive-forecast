/**
 * Second half of `npm run cf:build`, after OpenNext's build: copies the read-only data files into the static assets
 * under /_data/, where lib/data-files.ts fetches them (a worker has no data/ folder). Run `npm run replay` first so
 * data/replay.json is in the build, as CI does.
 */
import fs from "fs";
import path from "path";
import { DATA_FILES } from "../lib/data-files";
import { SECURITY_HEADERS } from "../lib/security-headers";

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, ".open-next", "assets");

const target = path.join(ASSETS_DIR, "_data");
fs.mkdirSync(target, { recursive: true });
for (const name of DATA_FILES) {
  const source = path.join(ROOT, "data", name);
  if (!fs.existsSync(source)) {
    console.warn(`data/${name} is missing; the worker reads it as absent`);
    continue;
  }
  fs.copyFileSync(source, path.join(target, name));
}

// Static assets skip Next's headers() in next.config.ts; give them the same ones.
const headerLines = SECURITY_HEADERS.map(({ key, value }) => `  ${key}: ${value}`);
fs.writeFileSync(path.join(ASSETS_DIR, "_headers"), ["/*", ...headerLines, ""].join("\n"));
console.log(`Copied ${DATA_FILES.length} data files to .open-next/assets/_data`);
