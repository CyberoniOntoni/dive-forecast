import type { RecentReportRow, ReportMatch } from "@/lib/recent-reports";

const MATCH: Record<ReportMatch, { mark: string; label: string; tone: string }> = {
  match: { mark: "✓", label: "forecast matched", tone: "text-incoming" },
  close: { mark: "≈", label: "right way, strength off", tone: "text-outgoing" },
  miss: { mark: "✗", label: "forecast had the other way", tone: "text-stop" },
};

function capital(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The site's newest diver reports, each beside what the forecast said for that hour. */
export function RecentReports({ rows }: { rows: readonly RecentReportRow[] }) {
  return (
    <section
      aria-labelledby="recent-reports-heading"
      className="flex min-w-0 flex-col gap-3 surface p-5 sm:p-6"
    >
      <h2 id="recent-reports-heading" className="card-title">
        Recent reports
      </h2>
      {rows.length === 0 ? (
        <p className="copy">No reports yet. Add one below after your dive.</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-foam/10">
          {rows.map((row) => (
            <ReportRow key={row.time + row.way + row.strength} row={row} />
          ))}
        </ul>
      )}
      {rows.some((row) => row.beforeAxis) ? (
        <p className="meta">
          * Filed when this site was still forecast as incoming or outgoing, before it showed a compass direction.
        </p>
      ) : null}
    </section>
  );
}

function ReportRow({ row }: { row: RecentReportRow }) {
  const match = row.forecast ? MATCH[row.forecast.match] : null;
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foam">
          {row.way}
          {row.beforeAxis ? "*" : ""}, {row.strength}
        </p>
        <p className="meta tabular-nums">
          <time dateTime={row.time}>{row.when}</time> · {row.ago}
          {row.by ? <span> · {row.by}</span> : null}
        </p>
      </div>
      <p className="meta shrink-0">
        {row.forecast && match ? (
          <>
            Forecast: {row.forecast.way}, {row.forecast.strength}{" "}
            <span className={match.tone} aria-label={match.label} title={capital(match.label)}>
              {match.mark}
            </span>
          </>
        ) : (
          "No forecast saved"
        )}
      </p>
    </li>
  );
}
