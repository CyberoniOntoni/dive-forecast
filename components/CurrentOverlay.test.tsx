import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteRow } from "@/components/CurrentOverlay";
import { SPOTLIGHT_ZOOM, spotlightZoom } from "@/lib/map-view";
import { nowcastGlance } from "@/lib/nowcast-glance";

describe("spotlightZoom", () => {
  it("zooms in to show one site, but never out", () => {
    expect(spotlightZoom(7)).toBe(SPOTLIGHT_ZOOM);
    expect(spotlightZoom(SPOTLIGHT_ZOOM)).toBe(SPOTLIGHT_ZOOM);
    expect(spotlightZoom(15)).toBe(15);
    expect(spotlightZoom(Number.NaN)).toBe(SPOTLIGHT_ZOOM);
  });
});

describe("site row", () => {
  const site = { id: "kandooma-thila", name: "Kandooma Thila", atollId: "south-male", lat: 3.9, lon: 73.48, sourceUrl: "x" };
  const glance = nowcastGlance(
    "Kandooma Thila",
    {
      siteId: site.id,
      atollId: site.atollId,
      inwardBearingDeg: 285,
      unavailable: false,
      hour: { time: "2026-10-03T10:00", direction: "incoming", strength: "strong", confidence: "low", levelM: 0.1 },
    },
    true,
  );
  const html = renderToStaticMarkup(
    <ul>
      <SiteRow site={site} glance={glance} age={null} atoll="South Malé" onShowOnMap={() => {}} />
    </ul>,
  );

  it("links the row to the forecast page", () => {
    expect(html).toContain('href="/sites/kandooma-thila"');
  });

  it("has a separate Show on map button beside the link, not inside it", () => {
    expect(html).toContain('aria-label="Show Kandooma Thila on the map"');
    const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
    expect(link).not.toContain("<button");
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("</a>"));
  });
});
