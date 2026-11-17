import { imageryTile, readImageryTile } from "@/lib/imagery";

/**
 * One Sentinel-2 imagery tile (lib/imagery.ts). Tiles never change under a version, so they are cached for good. Where
 * none was made (open ocean) the answer is 204, which MapLibre takes as an empty tile, so a saved atoll's download
 * does not stop on it.
 */
export async function GET(_request: Request, context: { params: Promise<{ version: string; z: string; x: string; file: string }> }) {
  const { version, z, x, file } = await context.params;
  const tile = imageryTile(version, z, x, file);
  if (!tile) return new Response("Not found", { status: 404 });
  const bytes = await readImageryTile(tile);
  if (!bytes) return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(bytes.length),
    },
  });
}
