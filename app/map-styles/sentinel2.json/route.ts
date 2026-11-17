import { imageryStyle } from "@/lib/imagery";

/** The imagery as a MapLibre style, for the app's offline download of a saved atoll (lib/imagery.ts). */
export async function GET(request: Request) {
  return Response.json(imageryStyle(new URL(request.url).origin), { headers: { "Cache-Control": "public, max-age=3600" } });
}
