import Link from "next/link";
import { notFound } from "next/navigation";
import { HourSlider } from "@/components/HourSlider";
import { RatingForm } from "@/components/RatingForm";
import { ReportForm } from "@/components/ReportForm";
import { forecastSite, getRating, getSite } from "@/lib/actions";
import { toMaldivesWall } from "@/lib/forecast";
import { nearestForecastHour } from "@/lib/nowcast";
import type { HourForecast, Site } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const site = await getSite(id);
  if (!site) notFound();

  const [forecast, rating] = await Promise.all([forecastSite(site.id), getRating(site.id)]);
  const maldivesWall = toMaldivesWall(new Date().toISOString());

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <Link
        href="/"
        className="inline-flex min-h-11 w-fit items-center self-start rounded-md border border-foam/25 bg-ink px-4 text-sm font-medium text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
      >
        Back to map
      </Link>
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foam sm:text-3xl">{site.name}</h1>
        <PublishedFacts site={site} />
      </header>
      <HourSlider
        key={`forecast-${site.id}`}
        hours={forecast.hours}
        unavailable={forecast.unavailable}
        stale={forecast.stale}
        inwardBearingDeg={forecast.inwardBearingDeg}
        notice={forecast.notice}
        fetchedAt={fetchedStamp(forecast.fetchedAt)}
        maldivesWall={maldivesWall}
        initialIndex={startingIndex(forecast.hours, maldivesWall)}
      />
      <div className="flex min-w-0 flex-col gap-4">
        <RatingForm key={`rating-${site.id}`} siteId={site.id} score={rating ? rating.score : null} />
        <ReportForm key={`report-${site.id}`} siteId={site.id} />
      </div>
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
type SourceLink = { href: string; label: string };

function PublishedFacts({ site }: { site: Site }) {
  const line = publishedLine(site);
  if (!line) return null;

  return (
    <p className="min-w-0 text-sm leading-6 text-foam/90">
      <span className="sr-only">Published. </span>
      {line.text}
      {line.sources.map((source) => (
        <a
          key={source.label}
          href={source.href}
          className="ml-2 whitespace-nowrap font-medium text-foam underline decoration-incoming underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          {source.label}
        </a>
      ))}
    </p>
  );
}

function publishedLine(site: Site): { text: string; sources: SourceLink[] } | null {
  const top = positiveMetres(site.diveTopM);
  const max = positiveMetres(site.diveMaxM);
  const width = positiveMetres(site.channelWidthM);
  const channelDepth = positiveMetres(site.channelDepthM);
  const phrases = [depthPhrase(top, max), channelPhrase(width, channelDepth)].filter(
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

function channelPhrase(width: number | null, depth: number | null): string | null {
  const parts: string[] = [];
  if (width != null) parts.push(`${formatMetres(width)} m wide`);
  if (depth != null) parts.push(`${formatMetres(depth)} m deep`);
  if (parts.length === 0) return null;
  return `channel ${parts.join(", ")}`;
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
