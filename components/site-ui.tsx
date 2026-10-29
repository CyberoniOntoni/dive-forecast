/** Small pieces the map list, the Navigate panel, the header and the site page share. */

/** The site search box on the map list and the Navigate panel; each adds its own width and margin. */
export const SEARCH_FIELD_CLASS =
  "field min-w-0 placeholder:text-foam/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming";

/** A site's name in a list row, with its atoll after it when the name needs it. */
export function SiteName({ name, atoll }: { name: string; atoll: string | null | undefined }) {
  return (
    <span className="min-w-0 flex-1 truncate font-medium">
      {name}
      {atoll ? <span className="font-normal text-foam/65"> · {atoll}</span> : null}
    </span>
  );
}

/** The Navigate mark: a compass pointer. */
export function NavigateIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 2l7 19-7-4-7 4z" />
    </svg>
  );
}
