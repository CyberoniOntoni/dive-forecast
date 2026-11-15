type LeafletLib = typeof import("leaflet");

/** Leaflet's dynamic import is sometimes `{ default }` rather than the namespace. */
export function leafletApi(mod: LeafletLib): LeafletLib {
  if (typeof mod.map === "function") return mod;
  const fallback = (mod as { default?: LeafletLib }).default;
  if (fallback && typeof fallback.map === "function") return fallback;
  return mod;
}

/** Leaflet tooltips, div icons and pin labels are HTML, so text from divers (a site name) is escaped first. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
