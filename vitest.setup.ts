import fs from "fs";
import os from "os";
import path from "path";
import { afterAll } from "vitest";

// Tests must not read or write the developer's live data/marine-cache, and must not reach the network.
// Each test file gets its own empty cache directory and a fetch that fails unless a test replaces it.
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "dive-marine-"));
process.env.MARINE_CACHE_DIR = cacheDir;

globalThis.fetch = (() => Promise.reject(new Error("Network is disabled in tests"))) as typeof fetch;

afterAll(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});
