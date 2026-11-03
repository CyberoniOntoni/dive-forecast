import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({ addReportAction: async () => ({ success: true, error: null }) }));

const { ReportForm } = await import("@/components/ReportForm");

const hour = { time: "2026-11-04T10:00", direction: "incoming" as const, strength: "too_strong" as const };

describe("report form", () => {
  it("offers a one-tap report of the forecast for the chosen hour", () => {
    const html = renderToStaticMarkup(
      <ReportForm siteId="s" forecastRoute="channel" nickname="Diver" defaultTime="2026-11-04T10:00" forecast={[hour]} />,
    );
    expect(html).toContain("As forecast: incoming, very strong");
  });

  it("names the compass way on a wall", () => {
    const html = renderToStaticMarkup(
      <ReportForm
        siteId="s"
        forecastRoute="along-reef"
        alongHeadingDeg={45}
        nickname="Diver"
        defaultTime="2026-11-04T10:00"
        forecast={[{ ...hour, direction: "outgoing", strength: "mild" }]}
      />,
    );
    expect(html).toContain("As forecast: running SW, mild");
  });

  it("leaves it out when the chosen hour has no forecast", () => {
    const html = renderToStaticMarkup(
      <ReportForm siteId="s" forecastRoute="channel" nickname="Diver" defaultTime="2026-11-04T11:00" forecast={[hour]} />,
    );
    expect(html).not.toContain("As forecast");
    expect(html).toContain("Add report");
  });
});
