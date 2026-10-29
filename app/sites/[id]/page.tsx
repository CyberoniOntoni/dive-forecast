import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Attribution } from "@/components/Attribution";
import { HourSlider } from "@/components/HourSlider";
import { RatingForm } from "@/components/RatingForm";
import { RecentReports } from "@/components/RecentReports";
import { ReportForm } from "@/components/ReportForm";
import { NavigateIcon } from "@/components/site-ui";
import { forecastSite, getRating, getRecentReports, getSite } from "@/lib/actions";
import { toMaldivesWall } from "@/lib/forecast";
import { navigateHref } from "@/lib/navigate-tab";
import { nearestForecastHour } from "@/lib/nowcast";
import { atollNamesById } from "@/lib/site-labels";
import { SITE_TYPE_LABEL } from "@/lib/site-type";
import { currentWallHour, timeZoneForSite } from "@/lib/site-time";
import { readCatalog } from "@/lib/store";
import { UNSEEDED_ATOLL_ID, type DepthKind, type HourForecast, type Site } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = await getSite(id);
  return {
    title: site ? `${site.name} · Dive current` : "Site not found · Dive current",
  };
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const site = await getSite(id);
  if (!site) notFound();

  const [forecast, rating] = await Promise.all([forecastSite(site.id), getRating(site.id)]);
  // Wall and lagoon reports read as compass directions, so the list needs to know which route this site takes.
  const recent = await getRecentReports(site.id, forecast.forecastRoute);
  // Reports are entered in the site's own country's time, whatever the diver's clock says.
  const zone = timeZoneForSite(site);
  const maldivesWall = toMaldivesWall(new Date().toISOString());

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      {/* One row on a phone, so the forecast starts higher up the screen. */}
      <nav aria-label="Site" className="flex min-w-0 flex-wrap gap-2">
        <Link
          href="/"
          aria-label="Back to map"
          className="button-quiet gap-1.5 bg-ink pr-4 pl-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Map
        </Link>
        <Link
          href={navigateHref(site.id)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-incoming/60 px-4 text-sm font-medium text-foam hover:bg-foam/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          <NavigateIcon size={18} />
          Navigate here by boat
        </Link>
      </nav>
      <header className="flex min-w-0 flex-col">
        <h1 className="text-2xl font-semibold tracking-tight text-foam sm:text-3xl">{site.name}</h1>
        <SiteFacts site={site} />
      </header>
      <HourSlider
        key={`forecast-${site.id}`}
        hours={forecast.hours}
        unavailable={forecast.unavailable}
        stale={forecast.stale}
        inwardBearingDeg={forecast.inwardBearingDeg}
        outgoingBearingDeg={site.outgoingBearingDeg ?? null}
        forecastRoute={forecast.forecastRoute}
        alongHeadingDeg={forecast.alongHeadingDeg}
        bearingSource={forecast.bearingSource}
        unseeded={site.atollId === UNSEEDED_ATOLL_ID}
        notice={forecast.notice}
        siteNote={forecast.siteNote}
        fetchedAt={fetchedStamp(forecast.fetchedAt)}
        maldivesWall={maldivesWall}
        initialIndex={startingIndex(forecast.hours, maldivesWall)}
        seaState={forecast.seaState}
        seaStale={forecast.seaStale}
      />
      <RecentReports rows={recent} />
      <div className="flex min-w-0 flex-col gap-4">
        <RatingForm key={`rating-${site.id}`} siteId={site.id} score={rating ? rating.score : null} />
        <ReportForm
          key={`report-${site.id}`}
          siteId={site.id}
          forecastRoute={forecast.forecastRoute}
          alongHeadingDeg={forecast.alongHeadingDeg}
          zone={zone}
          defaultTime={currentWallHour(zone)}
        />
      </div>
      <Attribution />
    </main>
  );
}

function startingIndex(hours: readonly HourForecast[], maldivesWall: string): number {
  const nearest = nearestForecastHour(hours, maldivesWall);
  if (nearest == null) return 0;
  return Math.max(0, hours.findIndex((hour) => hour.time === nearest.time));
}

/** An empty wall or ISO is treated as no fetch time. */
function fetchedStamp(fetchedAt: number | null): { wall: string; iso: string } | null {
  if (fetchedAt == null) return null;
  const iso = new Date(fetchedAt).toISOString();
  const wall = toMaldivesWall(iso);
  if (!wall || !iso) return null;
  return { wall, iso };
}
/** "Channel thila · South Male · 16–30 m · Source": the site type, its atoll and the published facts in one line. */
function SiteFacts({ site }: { site: Site }) {
  const atoll = atollNamesById(readCatalog().atolls)[site.atollId];
  const line = publishedLine(site);
  const parts = [site.siteType ? SITE_TYPE_LABEL[site.siteType] : null, atoll ?? null, line ? line.text : null].filter(
    (part): part is string => part != null,
  );
  if (parts.length === 0) return null;

  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-sm leading-6 text-foam/80">
      <span>
        {parts.join(" · ")}
      </span>
      {/* Each source stays a 44 px target on a phone. */}
      {line?.sources.map((source) => (
        <a
          key={source.label}
          href={source.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 min-w-11 items-center whitespace-nowrap font-medium text-foam underline decoration-incoming underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          {source.label}
        </a>
      ))}
    </p>
  );
}

type SourceLink = { href: string; label: string };

function publishedLine(site: Site): { text: string; sources: SourceLink[] } | null {
  const top = positiveMetres(site.diveTopM);
  const max = positiveMetres(site.diveMaxM);
  const width = positiveMetres(site.channelWidthM);
  const channelDepth = positiveMetres(site.channelDepthM);
  const phrases = [depthPhrase(top, max), channelPhrase(width, channelDepth, site.channelDepthKind)].filter(
    (phrase): phrase is string => phrase != null,
  );
  if (phrases.length === 0) return null;
  const text = phrases.join(", ");
  const hasDiveDepth = top != null || max != null;
  const hasChannel = width != null || channelDepth != null;
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    sources: publishedSources(hasDiveDepth, hasChannel, site),
  };
}

function depthPhrase(top: number | null, max: number | null): string | null {
  if (top != null) {
    if (max != null) {
      if (top !== max) {
        return `${formatMetres(Math.min(top, max))}–${formatMetres(Math.max(top, max))} m`;
      }
    }
  }
  const only = top ?? max;
  if (only == null) return null;
  return `${formatMetres(only)} m`;
}

function channelPhrase(width: number | null, depth: number | null, kind: DepthKind | undefined): string | null {
  const parts: string[] = [];
  if (width != null) parts.push(`${formatMetres(width)} m wide`);
  if (depth != null) parts.push(channelDepthWords(formatMetres(depth), kind));
  if (parts.length === 0) return null;
  return `channel ${parts.join(", ")}`;
}

/** The source's own kind of depth, so a maximum never reads as the channel's depth. */
function channelDepthWords(metres: string, kind: DepthKind | undefined): string {
  if (kind === "max" || kind === "range") return `up to ${metres} m deep`;
  if (kind === "least") return `at least ${metres} m deep`;
  return `${metres} m deep`;
}

function publishedSources(hasDiveDepth: boolean, hasChannel: boolean, site: Site): SourceLink[] {
  const depthHref = hasDiveDepth ? httpUrl(site.depthSourceUrl) : null;
  const channelHref = hasChannel ? httpUrl(site.channelSourceUrl) : null;
  if (depthHref == null || channelHref == null || depthHref === channelHref) {
    const href = depthHref ?? channelHref;
    if (!href) return [];
    return [{ href, label: "Source" }];
  }
  return [
    { href: depthHref, label: "Depth" },
    { href: channelHref, label: "Channel" },
  ];
}
function positiveMetres(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function formatMetres(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

function httpUrl(value: string | undefined): string | null {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}
