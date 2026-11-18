import { isPhotoKey, readPhotoBytes } from "@/lib/site-photos";

/** A dive-site photo (lib/site-photos.ts). Photo ids are never reused; a photo is cached for an hour, so one a moderator removes soon stops showing. */
export async function GET(_request: Request, context: { params: Promise<{ siteId: string; file: string }> }) {
  const { siteId, file } = await context.params;
  const photoId = file.endsWith(".jpg") ? file.slice(0, -4) : "";
  if (!isPhotoKey(siteId, photoId)) return new Response("Not found", { status: 404 });
  const bytes = await readPhotoBytes(siteId, photoId);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/jpeg",
      // An hour, not for good: a photo a moderator removes (lib/moderation.ts) must stop showing soon.
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(bytes.length),
    },
  });
}
