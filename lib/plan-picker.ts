import type { PickerSite } from "./dive-plan";
import { atollNamesById } from "./site-labels";
import { listMergedSites, readCatalog } from "./store";
import type { SiteType } from "./types";

/** Site types the channel model reads, as in or out across the rim; a wall within reach of a pass may too, unknown here. */
const CHANNEL_TYPES: readonly SiteType[] = ["pass", "channel-thila", "corner"];

/** Every site for the plan editor's picker, by name. Server only; after ready(). */
export function pickerSites(): PickerSite[] {
  const atolls = atollNamesById(readCatalog().atolls);
  return listMergedSites()
    .map((site) => ({
      id: site.id,
      name: site.name,
      atoll: atolls[site.atollId] ?? null,
      channel: site.siteType != null && CHANNEL_TYPES.includes(site.siteType),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
