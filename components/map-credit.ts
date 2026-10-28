import type { Map as LeafletMapType } from "leaflet";
import { DATA_CREDIT_HTML } from "@/components/Attribution";

/** The map's credits: the tile layers' own plus the data credit, folded to an "i" button. SiteMap calls attachCredits. */

/** Credits styles, folded and open; SiteMap puts them in its map style sheet. */
export const CREDIT_STYLE = `
.dive-map.leaflet-container .leaflet-control-attribution{max-width:min(70%, calc(100% - 4.5rem));white-space:normal;background:color-mix(in srgb, var(--ink) 80%, transparent);backdrop-filter:blur(8px);color:color-mix(in srgb, var(--foam) 85%, transparent);border-bottom-right-radius:10px}
.dive-map.leaflet-container .leaflet-control-attribution a{color:var(--foam)}
.dive-map.leaflet-container .leaflet-control-attribution{cursor:pointer;margin:6px!important;padding:3px 8px;border-radius:12px}
.dive-map.leaflet-container .leaflet-control-attribution:focus-visible{outline:2px solid var(--incoming);outline-offset:2px}
.dive-map.leaflet-container .leaflet-control-attribution:not(.dive-credit-open){font-size:0;width:32px;max-width:none;height:32px;margin:8px 16px 0 0!important;padding:0;border-radius:999px;display:grid;place-items:center}
.dive-map.leaflet-container .leaflet-control-attribution:not(.dive-credit-open)>*{display:none}
.dive-map.leaflet-container .leaflet-control-attribution:not(.dive-credit-open)::before{content:"i";font:600 italic 15px/1 Georgia,serif;color:var(--foam)}
@media (max-width:1023px){
  .dive-map.leaflet-container .leaflet-control-attribution{max-width:calc(100vw - 2rem);font-size:11px;line-height:16px}
}
`;

/**
 * Adds the data credit after the layers' own (so the open credits start with the imagery), moves the button to the
 * right-hand controls on a phone, where the site sheet and the navigate panel cover the bottom, and folds it. Returns
 * the cleanup.
 */
export function attachCredits(map: LeafletMapType): () => void {
  map.attributionControl.addAttribution(DATA_CREDIT_HTML);
  if (window.matchMedia("(max-width: 1023px)").matches) map.attributionControl.setPosition("topright");
  return foldCredit(map.attributionControl.getContainer());
}

/** How long the credits show in full when the map opens, before they fold to the "i" button. */
const CREDIT_SHOWN_MS = 6000;

/**
 * The map and data credits fold to a small "i" button that opens them; they show in full for a few seconds when the
 * map opens, so they are seen once without covering the map all the time. Open, a link works as usual and a tap
 * elsewhere on them folds them again.
 */
function foldCredit(credit: HTMLElement | undefined): () => void {
  if (!credit) return () => {};
  credit.setAttribute("role", "button");
  credit.tabIndex = 0;
  credit.setAttribute("aria-label", "Map and data credits");
  const setOpen = (open: boolean) => {
    credit.classList.toggle("dive-credit-open", open);
    credit.setAttribute("aria-expanded", open ? "true" : "false");
  };
  setOpen(true);
  const fold = window.setTimeout(() => setOpen(false), CREDIT_SHOWN_MS);
  const onClick = (event: MouseEvent) => {
    window.clearTimeout(fold);
    const open = credit.classList.contains("dive-credit-open");
    if (open && event.target instanceof Element && event.target.closest("a")) return;
    event.preventDefault();
    setOpen(!open);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.target !== credit || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    window.clearTimeout(fold);
    setOpen(!credit.classList.contains("dive-credit-open"));
  };
  credit.addEventListener("click", onClick);
  credit.addEventListener("keydown", onKey);
  return () => {
    window.clearTimeout(fold);
    credit.removeEventListener("click", onClick);
    credit.removeEventListener("keydown", onKey);
  };
}
