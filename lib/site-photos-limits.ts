/** Photo limits, shared by the browser's photo picker and the server (lib/site-photos.ts). */
export const PHOTO_LONG_EDGE_PX = 1600;
export const PHOTO_JPEG_QUALITY = 0.82;
/** What the server takes per photo, after the browser shrank it. */
export const MAX_PHOTO_BYTES = 1_500_000;
export const MAX_PHOTOS_PER_SITE = 6;
/** What the photo picker takes from the phone: anything the browser can draw on a canvas. */
export const PHOTO_PICK_MAX_BYTES = 30_000_000;

export function photoUrl(siteId: string, photoId: string): string {
  return `/site-photos/${siteId}/${photoId}.jpg`;
}
