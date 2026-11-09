import fs from "fs/promises";
import path from "path";
import { workerEnv, type R2Bucket } from "./cloudflare";

/**
 * Dive-site photos. The browser shrinks each picked photo to PHOTO_LONG_EDGE_PX and re-encodes it as JPEG before it
 * is sent (components/PhotoPicker.tsx), so the server only ever takes JPEG, at most MAX_PHOTO_BYTES. The bytes go to
 * R2 on a worker (the DATA bucket, under site-photos/) and to data/photos/ on Node; the site record keeps only the
 * photo ids. /site-photos/<site>/<photo>.jpg serves them.
 */
export {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_SITE,
  PHOTO_JPEG_QUALITY,
  PHOTO_LONG_EDGE_PX,
  PHOTO_PICK_MAX_BYTES,
  photoUrl,
} from "./site-photos-limits";

const SITE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPhotoKey(siteId: string, photoId: string): boolean {
  return SITE_ID.test(siteId) && PHOTO_ID.test(photoId);
}

function objectKey(siteId: string, photoId: string): string {
  if (!isPhotoKey(siteId, photoId)) throw new Error("Bad photo key");
  return `site-photos/${siteId}/${photoId}.jpg`;
}

function photoDir(): string {
  return process.env.SITE_PHOTO_DIR || path.join(process.cwd(), "data", "photos");
}

function bucket(): R2Bucket | null {
  return workerEnv()?.DATA ?? null;
}

export async function savePhotoBytes(siteId: string, photoId: string, bytes: Uint8Array): Promise<void> {
  const key = objectKey(siteId, photoId);
  const r2 = bucket();
  if (r2) {
    await r2.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    return;
  }
  const file = path.join(photoDir(), siteId, `${photoId}.jpg`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, file);
}

export async function readPhotoBytes(siteId: string, photoId: string): Promise<Uint8Array | null> {
  const key = objectKey(siteId, photoId);
  const r2 = bucket();
  if (r2) {
    const object = await r2.get(key);
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }
  try {
    return new Uint8Array(await fs.readFile(path.join(photoDir(), siteId, `${photoId}.jpg`)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Best effort: a photo whose record could not be saved should not linger. */
export async function deletePhotoBytes(siteId: string, photoId: string): Promise<void> {
  const key = objectKey(siteId, photoId);
  const r2 = bucket();
  try {
    if (r2) await r2.delete(key);
    else await fs.rm(path.join(photoDir(), siteId, `${photoId}.jpg`), { force: true });
  } catch {
    // Left behind; nothing links to it.
  }
}

/** JPEG markers whose segments carry camera data (EXIF, with GPS, and XMP in APP1; IPTC in APP13) or comments. */
const DROPPED_SEGMENTS = new Set([0xe1, 0xed, 0xfe]);
const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * The JPEG with its EXIF, XMP, IPTC and comment segments removed, or null when the bytes are not a JPEG with a frame,
 * a scan and an end marker. The browser's re-encode already drops them; this covers a photo sent some other way, so a
 * phone's GPS fix and camera serial never reach the public page. Every segment is walked, between the scans of a
 * progressive JPEG too, and the file is cut at its end marker, so nothing appended after the image is kept.
 */
export function cleanJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let sawFrame = false;
  let sawScan = false;
  let index = 2;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) return null;
    let markerAt = index + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1;
    if (markerAt >= bytes.length) return null;
    const marker = bytes[markerAt];
    if (marker === 0xd9) {
      if (!sawScan) return null;
      kept.push(bytes.subarray(index, markerAt + 1));
      return concat(kept);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(index, markerAt + 1));
      index = markerAt + 1;
      continue;
    }
    if (markerAt + 2 >= bytes.length) return null;
    const length = (bytes[markerAt + 1] << 8) | bytes[markerAt + 2];
    const end = markerAt + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (FRAME_MARKERS.has(marker)) sawFrame = true;
    if (marker === 0xda) {
      // Start of scan: compressed data follows the header, up to the next marker that is not a stuffed 0xFF00 or a
      // restart marker (which belong to the scan).
      if (!sawFrame) return null;
      sawScan = true;
      let next = end;
      while (next + 1 < bytes.length) {
        if (bytes[next] === 0xff) {
          const after = bytes[next + 1];
          if (after !== 0x00 && after !== 0xff && !(after >= 0xd0 && after <= 0xd7)) break;
        }
        next += 1;
      }
      if (next + 1 >= bytes.length) return null;
      kept.push(bytes.subarray(index, next));
      index = next;
      continue;
    }
    if (!DROPPED_SEGMENTS.has(marker)) kept.push(bytes.subarray(index, end));
    index = end;
  }
  return null;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
