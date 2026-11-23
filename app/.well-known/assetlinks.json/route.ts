import { ASSET_LINKS } from "@/lib/asset-links";

/**
 * GET /.well-known/assetlinks.json (lib/asset-links.ts). A route rather than a file in public/, so the content type is
 * set here on Node and on Cloudflare alike, and no static-asset upload can drop the dot folder.
 */
export function GET() {
  return new Response(JSON.stringify(ASSET_LINKS, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
