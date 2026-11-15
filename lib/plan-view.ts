import { forecastSite } from "./actions";
import { currentSession } from "./auth";
import { addDays, canReportDive, capital, dayLabel, isPlanId, wallMs, planDateSpan, stopOutlook, type StopOutlook } from "./dive-plan";
import { toMaldivesWall } from "./forecast";
import { compassWord, passArrowBearing, routeArrowBearing, routeWay } from "./nowcast-glance";
import { routeFor } from "./load-site";
import { ready } from "./ready";
import { DIVER_SITE_TYPE_LABEL } from "./site-details";
import { atollNamesById } from "./site-labels";
import { SITE_TYPE_LABEL } from "./site-type";
import { findPlan, listMergedSites, readCatalog, readStore } from "./store";
import type { Direction, ForecastRoute, HourForecast, Site, SiteForecast } from "./types";

/**
 * A plan as its page shows it: each dive with its site and what the forecast says at the dive time. Server only; the
 * page calls it. Anyone with the link sees the plan; only its owner gets the edit button.
 */

export type PlanStopView = {
  siteId: string;
  name: string;
  lat: number;
  lon: number;
  /** "Pass · South Male · 5–30 m". */
  facts: string;
  /** The diver-added "how to dive it", when the site has one. */
  howToDive: string | null;
  time: string;
  note: string | null;
  want: Direction | null;
  /** Channel or not: only a channel reads incoming and outgoing. */
  route: ForecastRoute;
  outlook: StopOutlook;
  /** "Incoming, toward NE" or "Running SW along the reef" for the dive hour; null without a forecast hour. */
  way: string | null;
  /** The arrow's heading for the dive hour, degrees, or null. */
  arrowDeg: number | null;
  /** Words for a better window's best hour, when there is one. */
  betterWay: string | null;
  /** Set once the dive is over and still recent enough to report: the site page's report form at the dive time. */
  reportHref: string | null;
};

export type PlanDayView = { date: string; label: string; stops: PlanStopView[] };

export type PlanView = {
  id: string;
  title: string;
  notes: string | null;
  boatSpeedKn: number;
  ownerId: string;
  ownerNickname: string | null;
  isOwner: boolean;
  span: string;
  days: PlanDayView[];
  updatedAt: string;
  /** Maldives wall time the page was made, "YYYY-MM-DDTHH:MM". */
  nowWall: string;
};

/** How many days either side of today a dive must be for its site's forecast to be read. */
const FORECAST_DAYS_BACK = 1;
const FORECAST_DAYS_AHEAD = 8;

export async function loadPlanView(id: string): Promise<PlanView | null> {
  await ready();
  if (!isPlanId(id)) return null;
  const plan = findPlan(id);
  if (!plan) return null;
  const session = await currentSession();
  const catalog = readCatalog();
  const atolls = atollNamesById(catalog.atolls);
  const sites = new Map(listMergedSites().map((site) => [site.id, site]));
  const nowWall = toMaldivesWall(new Date().toISOString());
  const today = wallMs(nowWall.slice(0, 10), "00:00");
  const inReach = (date: string) => {
    const days = (wallMs(date, "00:00") - today) / 86_400_000;
    return days >= -FORECAST_DAYS_BACK && days <= FORECAST_DAYS_AHEAD;
  };

  // One forecast per site, and only for sites with a dive near enough to today for the forecast to cover it.
  const wanted = new Set(
    plan.days.filter((day) => inReach(day.date)).flatMap((day) => day.stops.map((stop) => stop.siteId)),
  );
  const forecasts = new Map<string, SiteForecast>();
  await Promise.all(
    [...wanted].map(async (siteId) => {
      try {
        forecasts.set(siteId, await forecastSite(siteId));
      } catch (error) {
        console.error("Plan forecast failed", siteId, error);
      }
    }),
  );

  const days: PlanDayView[] = plan.days.map((day) => ({
    date: day.date,
    label: dayLabel(day.date),
    stops: day.stops.flatMap((stop) => {
      const site = sites.get(stop.siteId);
      if (!site) return [];
      const forecast = forecasts.get(site.id);
      // Without a forecast (too far ahead, or it failed) the route comes from the site's bearing, as loadSite picks it.
      const route =
        forecast?.forecastRoute ??
        routeFor(site, catalog.sites, catalog.atolls.find((atoll) => atoll.id === site.atollId))?.route ??
        "channel";
      const outlook: StopOutlook = !inReach(day.date)
        ? farOutlook(day.date, nowWall.slice(0, 10))
        : forecast
          ? stopOutlook(
              { route, hours: forecast.hours, sea: forecast.seaState, unavailable: forecast.unavailable },
              day.date,
              stop,
              nowWall.slice(0, 10),
            )
          : { status: "unavailable" };
      const hour = outlook.status === "forecast" ? outlook.hour : null;
      const better = outlook.status === "forecast" ? outlook.better?.best ?? null : null;
      const time = `${day.date}T${stop.time}`;
      return [
        {
          siteId: site.id,
          name: site.name,
          lat: site.lat,
          lon: site.lon,
          facts: siteFacts(site, atolls),
          howToDive: site.howToDive ?? null,
          time: stop.time,
          note: stop.note ?? null,
          want: route === "channel" ? (stop.want ?? null) : null,
          route,
          outlook,
          way: hour && forecast ? wayWords(hour, forecast, site) : null,
          arrowDeg: hour && forecast ? arrowHeading(hour, forecast, site) : null,
          betterWay: better && forecast ? wayWords(better, forecast, site) : null,
          reportHref: canReportDive(day.date, stop.time, nowWall)
            ? `/sites/${encodeURIComponent(site.id)}?at=${encodeURIComponent(time)}#report`
            : null,
        },
      ];
    }),
  }));

  const owner = readStore().users.find((user) => user.id === plan.ownerId);
  return {
    id: plan.id,
    title: plan.title,
    notes: plan.notes ?? null,
    boatSpeedKn: plan.boatSpeedKn,
    ownerId: plan.ownerId,
    ownerNickname: owner?.nickname ?? null,
    isOwner: session?.userId === plan.ownerId,
    span: planDateSpan(plan.days),
    days,
    updatedAt: plan.updatedAt,
    nowWall,
  };
}

/** A dive too far from today for the forecast: past, or the date the forecast first reaches it. */
function farOutlook(date: string, today: string): StopOutlook {
  if (date < today) return { status: "past" };
  // The series ends about six and a half days past today (1 past day + 7 forecast days, less the half day the 25 h
  // mean trims off its end), so a day dive shows six days before: the same date stopOutlook gives near the edge.
  return { status: "beyond", opensOn: addDays(date, -6) };
}

/** "Incoming, toward NE" at a channel; "Running SW along the reef" at a wall; "Running SW" in a lagoon. */
function wayWords(hour: HourForecast, forecast: SiteForecast, site: Site): string {
  if (hour.strength === "slack") return "Slack";
  if (forecast.forecastRoute === "channel") {
    if (forecast.inwardBearingDeg == null) return capital(hour.direction);
    const toward = compassWord(passArrowBearing(forecast.inwardBearingDeg, hour.direction, site.outgoingBearingDeg ?? null));
    return `${capital(hour.direction)}, toward ${toward}`;
  }
  return capital(routeWay(forecast.forecastRoute, hour.direction, forecast.alongHeadingDeg).spoken);
}

function arrowHeading(hour: HourForecast, forecast: SiteForecast, site: Site): number | null {
  if (forecast.inwardBearingDeg == null) return null;
  return routeArrowBearing(
    forecast.forecastRoute,
    hour.direction,
    forecast.inwardBearingDeg,
    forecast.alongHeadingDeg,
    site.outgoingBearingDeg ?? null,
  );
}


function siteFacts(site: Site, atolls: Record<string, string>): string {
  const kind = site.siteType
    ? site.sourceUrl === "user"
      ? DIVER_SITE_TYPE_LABEL[site.siteType]
      : SITE_TYPE_LABEL[site.siteType]
    : null;
  const top = typeof site.diveTopM === "number" ? site.diveTopM : null;
  const max = typeof site.diveMaxM === "number" ? site.diveMaxM : null;
  const depth =
    top != null && max != null && top !== max
      ? `${Math.min(top, max)}–${Math.max(top, max)} m`
      : (top ?? max) != null
        ? `${top ?? max} m`
        : null;
  return [kind, atolls[site.atollId] ?? null, depth].filter(Boolean).join(" · ");
}
