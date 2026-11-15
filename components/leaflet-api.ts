type LeafletLib = typeof import("leaflet");

/** Leaflet's dynamic import is sometimes `{ default }` rather than the namespace. */
export function leafletApi(mod: LeafletLib): LeafletLib {
  if (typeof mod.map === "function") return mod;
  const fallback = (mod as { default?: LeafletLib }).default;
  if (fallback && typeof fallback.map === "function") return fallback;
  return mod;
}
