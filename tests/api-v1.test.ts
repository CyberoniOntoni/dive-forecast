import { describe, expect, it } from "vitest";
import { GET as getSites } from "@/app/api/v1/sites/route";
import { GET as getSiteById } from "@/app/api/v1/sites/[id]/route";
import { GET as getForecast } from "@/app/api/v1/sites/[id]/forecast/route";
import { API_CACHE_CONTROL, API_VERSION, apiForecast, apiNowcast, apiSite, apiSites, type ApiSites } from "@/lib/api-v1";
import { FORECAST_MODEL_VERSION } from "@/lib/forecast";
import type { Site, SiteForecast } from "@/lib/types";

const userPin: Site = {
  id: "my-reef-1a2b3c4d",
  name: "My Reef",
  atollId: "north-male",
  lat: 4.3,
  lon: 73.5,
  sourceUrl: "user",
  addedBy: "user-123",
  addedAt: "2026-11-01T00:00:00.000Z",
  siteType: "lagoon",
  diveMaxM: 25,
  howToDive: "Drop on the east side.",
  photos: [{ id: "p1", addedBy: "user-123", addedAt: "2026-11-01T00:00:00.000Z" }],
};

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("API v1 shapes", () => {
  it("gives a site its display fields only, with no diver id", () => {
    const site = apiSite(userPin);
    expect(site).toEqual({
      id: "my-reef-1a2b3c4d",
      name: "My Reef",
      atollId: "north-male",
      lat: 4.3,
      lon: 73.5,
      siteType: "lagoon",
      userAdded: true,
      sourceUrl: null,
      diveTopM: null,
      diveMaxM: 25,
      approximatePin: false,
      pinNote: null,
      howToDive: "Drop on the east side.",
      photoUrls: ["/site-photos/my-reef-1a2b3c4d/p1.jpg"],
    });
    expect(JSON.stringify(site)).not.toContain("user-123");
  });

  it("leaves hidden pins out of the list", () => {
    const body = apiSites([userPin, { ...userPin, id: "spam", hidden: true }], []);
    expect(body.sites.map((site) => site.id)).toEqual(["my-reef-1a2b3c4d"]);
    expect(body.apiVersion).toBe(API_VERSION);
  });

  it("stamps forecasts and nowcasts with the model version", () => {
    const forecast = { hours: [], unavailable: true } as unknown as SiteForecast;
    expect(apiForecast("x", forecast)).toMatchObject({ siteId: "x", modelVersion: FORECAST_MODEL_VERSION, unavailable: true });
    expect(apiNowcast([], "2026-11-15T09:00")).toEqual({
      apiVersion: API_VERSION,
      modelVersion: FORECAST_MODEL_VERSION,
      maldivesWall: "2026-11-15T09:00",
      nowcasts: [],
    });
  });
});

describe("API v1 routes", () => {
  it("GET /api/v1/sites lists the catalog with atoll names and a cache header", async () => {
    const response = await getSites();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(API_CACHE_CONTROL);
    const body = (await response.json()) as ApiSites;
    expect(body.sites.length).toBeGreaterThan(200);
    expect(body.sites.find((site) => site.id === "banana-reef")).toMatchObject({ name: expect.any(String), userAdded: false });
    expect(body.atolls.find((atoll) => atoll.id === "north-male")?.name).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("addedBy");
  });

  it("GET /api/v1/sites/{id} returns one site, and a JSON 404 for an unknown one", async () => {
    const found = await getSiteById(new Request("http://test/api/v1/sites/banana-reef"), params("banana-reef"));
    expect(found.status).toBe(200);
    expect(((await found.json()) as { id: string }).id).toBe("banana-reef");

    const missing = await getSiteById(new Request("http://test/api/v1/sites/nope"), params("nope"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    expect(await missing.json()).toEqual({ error: { code: "not_found", message: "Unknown site." } });
  });

  it("GET /api/v1/sites/{id}/forecast is a 404 for an unknown site", async () => {
    const missing = await getForecast(new Request("http://test/api/v1/sites/nope/forecast"), params("nope"));
    expect(missing.status).toBe(404);
  });
});
