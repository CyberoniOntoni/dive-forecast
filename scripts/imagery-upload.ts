/**
 * Uploads the Sentinel-2 imagery tiles (scripts/imagery/sentinel2.py tiles <out>) to the worker's R2 bucket under
 * imagery/<version>/, where /imagery/<version>/{z}/{x}/{y}.webp serves them (lib/imagery.ts). Needs wrangler signed in
 * to the account. Safe to run again: tiles already sent are listed in <dir>/.uploaded-<bucket> and skipped.
 *
 *   npm run imagery:upload -- <dir>              to dive-current-data (production)
 *   npm run imagery:upload -- <dir> --preview    to dive-current-data-preview (PR previews)
 *   npm run imagery:upload -- <dir> --local      copies to data/imagery/ for a Node or Docker host
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { IMAGERY_VERSION } from "../lib/imagery";

const run = promisify(execFile);
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Usage: npm run imagery:upload -- <tiles dir> [--preview | --local]");
  process.exit(1);
}
const local = process.argv.includes("--local");
const bucket = process.argv.includes("--preview") ? "dive-current-data-preview" : "dive-current-data";
const PARALLEL = 8;
// Wrangler's own script run with this Node, not `npx`: on Windows npx is a .cmd file, which execFile cannot start.
const WRANGLER = path.join("node_modules", "wrangler", "bin", "wrangler.js");

function tiles(root: string): string[] {
  const out: string[] = [];
  for (const z of fs.readdirSync(root).filter((name) => /^\d+$/.test(name))) {
    for (const x of fs.readdirSync(path.join(root, z)).filter((name) => /^\d+$/.test(name))) {
      for (const file of fs.readdirSync(path.join(root, z, x)).filter((name) => /^\d+\.webp$/.test(name))) {
        out.push(`${z}/${x}/${file}`);
      }
    }
  }
  return out.sort();
}

async function main() {
  const all = tiles(dir);
  if (local) {
    const target = path.join("data", "imagery", IMAGERY_VERSION);
    for (const tile of all) {
      fs.mkdirSync(path.dirname(path.join(target, tile)), { recursive: true });
      fs.copyFileSync(path.join(dir, tile), path.join(target, tile));
    }
    console.log(`${all.length} tiles copied to ${target}`);
    return;
  }
  const doneFile = path.join(dir, `.uploaded-${bucket}`);
  const done = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, "utf8").split("\n").filter(Boolean) : []);
  const todo = all.filter((tile) => !done.has(tile));
  console.log(`${todo.length} of ${all.length} tiles to send to ${bucket}`);
  let sent = 0;
  async function worker() {
    for (let tile = todo.shift(); tile !== undefined; tile = todo.shift()) {
      const key = `${bucket}/imagery/${IMAGERY_VERSION}/${tile}`;
      await run(process.execPath, [WRANGLER, "r2", "object", "put", key, "--file", path.join(dir, tile), "--content-type", "image/webp", "--remote"]);
      fs.appendFileSync(doneFile, `${tile}\n`);
      sent += 1;
      if (sent % 100 === 0) console.log(`${sent} sent`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  console.log(`done: ${sent} sent`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
