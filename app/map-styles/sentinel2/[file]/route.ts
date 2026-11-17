import { IMAGERY_VERSION, imageryStyle } from "@/lib/imagery";

/**
 * The imagery as a MapLibre style, at /map-styles/sentinel2/<version>.json, for the app's offline download of a saved
 * atoll (lib/imagery.ts). The version is in the URL because the app keeps a saved region while its style URL is the
 * same: a new imagery version is a new URL, so saved atolls download it. Only the version the server has is served.
 */
export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (file !== `${IMAGERY_VERSION}.json`) return new Response("Not found", { status: 404 });
  return Response.json(imageryStyle(new URL(request.url).origin), { headers: { "Cache-Control": "public, max-age=3600" } });
}
