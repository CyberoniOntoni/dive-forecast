import Link from "next/link";
import { notFound } from "next/navigation";
import { HourSlider } from "@/components/HourSlider";
import { RatingForm } from "@/components/RatingForm";
import { ReportForm } from "@/components/ReportForm";
import { forecastSite, getRating, getSite } from "@/lib/actions";
import { toMaldivesWall } from "@/lib/forecast";
import { nearestForecastHour } from "@/lib/nowcast";
import type { Site } from "@/lib/types";

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
  const inwardBearingDeg = forecast.inwardBearingDeg;
  const fetchedAt = forecast.fetchedAt;
  const fetchedWall = fetchedAt == null ? null : toMaldivesWall(new Date(fetchedAt).toISOString());
  const fetchedIso = fetchedAt == null ? null : new Date(fetchedAt).toISOString();
  const maldivesWall = toMaldivesWall(new Date().toISOString());
  const nearestHour = nearestForecastHour(forecast.hours, maldivesWall);
  const initialIndex =
    nearestHour == null ? 0 : Math.max(0, forecast.hours.findIndex((hour) => hour.time === nearestHour.time));

  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 px-4 py-5 sm:px-8 sm:py-8">
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
        inwardBearingDeg={inwardBearingDeg}
        notice={forecast.notice}
        fetchedAt={fetchedWall && fetchedIso ? { wall: fetchedWall, iso: fetchedIso } : null}
        maldivesWall={maldivesWall}
        initialIndex={initialIndex}
      />
      <div className="flex min-w-0 flex-col gap-4">
        <RatingForm key={`rating-${site.id}`} siteId={site.id} score={rating ? rating.score : null} />
        <ReportForm key={`report-${site.id}`} siteId={site.id} />
      </div>
    </main>
  );
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
  const depth = positiveMetres(site.channelDepthM);
  const bits: string[] = [];

  if (top != null && max != null && top !== max) {
    bits.push(`${formatMetres(Math.min(top, max))}–${formatMetres(Math.max(top, max))} m`);
  } else if (top != null || max != null) {
    const only = top ?? max;
    if (only != null) bits.push(`${formatMetres(only)} m`);
  }

  const channel: string[] = [];
  if (width != null) channel.push(`${formatMetres(width)} m wide`);
  if (depth != null) channel.push(`${formatMetres(depth)} m deep`);
  if (channel.length > 0) bits.push(`channel ${channel.join(", ")}`);
  if (bits.length === 0) return null;

  const depthHref = top != null || max != null ? httpUrl(site.depthSourceUrl) : null;
  const channelHref = width != null || depth != null ? httpUrl(site.channelSourceUrl) : null;
  const sources: SourceLink[] = [];
  if (depthHref && channelHref && depthHref !== channelHref) {
    sources.push({ href: depthHref, label: "Depth" }, { href: channelHref, label: "Channel" });
  } else if (depthHref || channelHref) {
    sources.push({ href: (depthHref ?? channelHref) as string, label: "Source" });
  }

  const text = bits.join(", ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), sources };
}

function positiveMetres(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function formatMetres(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function httpUrl(value: string | undefined): string | null {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}
