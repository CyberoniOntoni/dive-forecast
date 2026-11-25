import { describe, expect, it } from "vitest";
import { GET as getSites } from "@/app/api/v1/sites/route";
import { GET as getSiteById } from "@/app/api/v1/sites/[id]/route";
import { GET as getForecast } from "@/app/api/v1/sites/[id]/forecast/route";
import {
  API_CACHE_CONTROL,
  apiReportWays,
  API_VERSION,
  apiForecast,
  apiGlance,
  apiNowcast,
  apiSite,
  apiSites,
  type ApiSites,
  wikiOf,
} from "@/lib/api-v1";
import { FORECAST_MODEL_VERSION } from "@/lib/forecast";
import type { HourForecast, Site, SiteForecast } from "@/lib/types";

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
  it("sends a catalog site's source only when it is a web page", () => {
    const catalog: Site = { id: "k", name: "K", atollId: "north-male", lat: 4.3, lon: 73.5, sourceUrl: "https://example.com/k" };
    expect(apiSite(catalog).sourceUrl).toBe("https://example.com/k");
    expect(apiSite({ ...catalog, sourceUrl: "" }).sourceUrl).toBeNull();
  });

  it("gives a site its display fields only, with no diver id", () => {
    const site = apiSite(userPin, null, "Reefer");
    expect(site).toEqual({
      id: "my-reef-1a2b3c4d",
      name: "My Reef",
      atollId: "north-male",
      lat: 4.3,
      lon: 73.5,
      siteType: "lagoon",
      siteTypeLabel: "Lagoon",
      atollName: null,
      userAdded: true,
      sourceUrl: null,
      diveTopM: null,
      diveMaxM: 25,
      approximatePin: false,
      pinNote: null,
      description: null,
      howToDive: "Drop on the east side.",
      howToDiveByAdder: true,
      writtenBy: [],
      writtenByLine: null,
      editedFields: [],
      photoUrls: ["/site-photos/my-reef-1a2b3c4d/p1.jpg"],
      adderNickname: "Reefer",
    });
    expect(JSON.stringify(site)).not.toContain("user-123");
  });

  it("credits the divers whose approved edits wrote a site's texts, by nickname only", () => {
    const edit = (id: string, userId: string, changes: Record<string, string>, status: "approved" | "pending" = "approved") => ({
      id,
      siteId: userPin.id,
      userId,
      createdAt: "2026-11-25T00:00:00Z",
      status,
      changes,
      based: {},
      reviewedAt: `2026-11-25T0${id.length}:00:00Z`,
      reviewerId: "mod",
    });
    const store = {
      users: [
        { id: "ann-id", email: "ann@example.com", nickname: "Ann", createdAt: "" },
        { id: "rev-id", email: "rev@example.com", nickname: "Reviewer", createdAt: "", storeReview: true as const },
      ],
      siteEdits: [edit("e1", "ann-id", { howToDive: "Ann's way." }), edit("e22", "rev-id", { description: "Test" }), edit("e333", "bob-id", { description: "x" }, "pending")],
    };
    const wiki = wikiOf(store, () => userPin)(userPin);
    expect(wiki).toEqual({ writtenBy: ["Ann"], howToDiveEdited: true, editedFields: ["description", "howToDive"] });
    const site = apiSite({ ...userPin, howToDive: "Ann's way." }, null, "Reefer", wiki);
    expect(site).toMatchObject({ howToDive: "Ann's way.", howToDiveByAdder: false, writtenBy: ["Ann"], writtenByLine: "Written by Ann." });
    expect(JSON.stringify(site)).not.toContain("ann-id");
    expect(wikiOf(store, () => userPin)({ ...userPin, id: "other" })).toEqual({ writtenBy: [], howToDiveEdited: false, editedFields: [] });
  });

  it("leaves hidden pins out of the list", () => {
    const body = apiSites([userPin, { ...userPin, id: "spam", hidden: true }], [{ id: "north-male", name: "North Malé" } as never], () => null);
    expect(body.sites.map((site) => site.id)).toEqual(["my-reef-1a2b3c4d"]);
    expect(body.sites[0].atollName).toBe("North Malé");
    expect(body.apiVersion).toBe(API_VERSION);
    expect(body.atolls).toEqual([{ id: "north-male", name: "North Malé", bounds: null }]);
  });

  it("gives each atoll the box round its outline, for saving it offline", () => {
    const ring = [
      [4.1, 73.3],
      [4.712345, 73.3],
      [4.712345, 73.712345],
      [4.1, 73.3],
    ] as const;
    const body = apiSites([], [{ id: "north-male", name: "North Malé" } as never], () => ring);
    expect(body.atolls[0].bounds).toEqual({ south: 4.1, west: 73.3, north: 4.7123, east: 73.7123 });
  });

  it("stamps forecasts and nowcasts with the model version", () => {
    const forecast = { hours: [], unavailable: true } as unknown as SiteForecast;
    expect(apiForecast({ ...userPin, id: "x" }, forecast)).toMatchObject({
      siteId: "x",
      modelVersion: FORECAST_MODEL_VERSION,
      unavailable: true,
    });
    expect(apiNowcast([], "2026-11-15T09:00")).toEqual({
      apiVersion: API_VERSION,
      modelVersion: FORECAST_MODEL_VERSION,
      maldivesWall: "2026-11-15T09:00",
      nowcasts: [],
    });
  });
});

const outgoingHour: HourForecast = {
  time: "2026-11-15T09:00",
  direction: "outgoing",
  strength: "too_strong",
  confidence: "medium",
  levelM: -0.2,
};

const channelForecast: SiteForecast = {
  hours: [outgoingHour, { ...outgoingHour, time: "2026-11-15T10:00", direction: "incoming", strength: "mild" }],
  unavailable: false,
  stale: false,
  notice: "",
  inwardBearingDeg: 300,
  bearingSource: "override",
  siteType: "pass",
  forecastRoute: "channel",
  alongHeadingDeg: null,
  siteNote: null,
  fetchedAt: 1,
  seaState: null,
  seaStale: true,
};

describe("API v1 glance", () => {
  it("bends a curved channel's outgoing arrow and words with the forecast's outgoing bearing (HP Reef)", () => {
    const body = apiForecast({ ...userPin, id: "hp" }, { ...channelForecast, outgoingBearingDeg: 150 });
    expect(body.outgoingBearingDeg).toBe(150);
    expect(body.hours[0].glance).toEqual({
      arrowBearing: 150,
      way: "outgoing",
      spokenWay: "outgoing",
      wayToward: "outgoing, toward SE",
      label: "very strong",
      tone: "stop",
      opacity: 0.74,
      rank: 0,
      estimatedHeading: false,
    });
    expect(body.hours[1].glance).toMatchObject({ arrowBearing: 300, wayToward: "incoming, toward NW", tone: "incoming" });
  });

  it("lists forecast fields one by one, so a new SiteForecast field stays off the wire", () => {
    const body = apiForecast(userPin, { ...channelForecast, secret: 1 } as unknown as SiteForecast);
    expect(body).not.toHaveProperty("secret");
    expect(body.seaStale).toBe(true);
  });

  it("reads along a reef as a compass way with no in/out tone, and has no glance without a bearing", () => {
    const along = { inwardBearingDeg: 41, outgoingBearingDeg: null, forecastRoute: "along-reef" as const, alongHeadingDeg: 131 };
    expect(apiGlance({ ...outgoingHour, strength: "mild" }, along)).toMatchObject({
      arrowBearing: 311,
      way: "running NW",
      spokenWay: "running NW along the reef",
      wayToward: "running NW along the reef",
      tone: "along",
      rank: 2,
    });
    expect(apiGlance(outgoingHour, { ...along, inwardBearingDeg: null })).toBeNull();
    expect(apiGlance(null, along)).toBeNull();
  });

  it("puts the glance on each nowcast hour", () => {
    const body = apiNowcast(
      [
        {
          siteId: "hp",
          atollId: "north-male",
          inwardBearingDeg: 300,
          outgoingBearingDeg: 150,
          forecastRoute: "channel",
          hour: outgoingHour,
          unavailable: false,
        },
        { siteId: "none", atollId: "x", inwardBearingDeg: null, outgoingBearingDeg: null, forecastRoute: "channel", hour: null, unavailable: true },
      ],
      "2026-11-15T09:00",
    );
    expect(body.nowcasts[0].hour?.glance?.arrowBearing).toBe(150);
    expect(body.nowcasts[0]).toMatchObject({ stale: false, fetchedAt: null, bearingSource: null, alongHeadingDeg: null });
    expect(body.nowcasts[1].hour).toBeNull();
    const extra = apiNowcast([{ ...body.nowcasts[1], secret: 1 } as never], "2026-11-15T09:00");
    expect(extra.nowcasts[0]).not.toHaveProperty("secret");
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

describe("report words", () => {
  it("says incoming and outgoing at a channel, compass points along an axis", () => {
    expect(apiReportWays("channel", 40)).toEqual({ legend: "Incoming or outgoing", incoming: "Incoming", outgoing: "Outgoing" });
    expect(apiReportWays("along-reef", 45)).toEqual({ legend: "Which way along the reef", incoming: "Running NE", outgoing: "Running SW" });
    expect(apiReportWays("lagoon", 180)).toMatchObject({ legend: "Which way it ran", incoming: "Running S", outgoing: "Running N" });
    expect(apiReportWays("lagoon", null)).toMatchObject({ incoming: "Incoming" });
  });
});
