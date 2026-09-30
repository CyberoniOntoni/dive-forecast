import type { Atoll, Site } from "./types";

/** "North Male Atoll" → "North Male": short enough to sit after a site name. */
export function shortAtollName(name: string): string {
  return name.replace(/\s+Atoll$/i, "");
}

/** Short atoll names by id, for the site list and pages. */
export function atollNamesById(atolls: readonly Pick<Atoll, "id" | "name">[]): Record<string, string> {
  return Object.fromEntries(atolls.map((atoll) => [atoll.id, shortAtollName(atoll.name)]));
}

/**
 * Site names used by more than one site. Guide names are often generic ("Coral Garden", "Maa Thila" is just
 * "big thila"), so the list shows the atoll after these to tell them apart.
 */
export function repeatedNames(sites: readonly Pick<Site, "name">[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { name } of sites) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  return repeated;
}

/** The atoll to show after a site's name in the list, or null when the name is unique. */
export function listAtollLabel(
  site: Pick<Site, "name" | "atollId">,
  repeated: ReadonlySet<string>,
  atollNames: Readonly<Record<string, string>>,
): string | null {
  if (!repeated.has(site.name.trim().toLowerCase())) return null;
  return atollNames[site.atollId] ?? null;
}
