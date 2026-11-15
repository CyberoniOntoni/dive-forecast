import type { PickerSite } from "./dive-plan";
import { routeFor } from "./load-site";
import { atollNamesById } from "./site-labels";
import { listMergedSites, readCatalog } from "./store";

/**
 * Every site for the plan editor's picker, by name. `channel` is the route loadSite gives the site (routeFor), so a wall
 * the model reads across the rim offers a wanted direction just as the plan page warns on it. Server only; after ready().
 */
export function pickerSites(): PickerSite[] {
  const catalog = readCatalog();
  const atolls = atollNamesById(catalog.atolls);
  const atollById = new Map(catalog.atolls.map((atoll) => [atoll.id, atoll]));
  return listMergedSites()
    .map((site) => ({
      id: site.id,
      name: site.name,
      atoll: atolls[site.atollId] ?? null,
      channel: routeFor(site, catalog.sites, atollById.get(site.atollId))?.route === "channel",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
