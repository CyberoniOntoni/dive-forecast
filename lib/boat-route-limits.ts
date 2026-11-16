/**
 * Why getBoatRoute (lib/actions.ts) refuses a request. Kept here, out of the "use server" file, so the JSON API can
 * tell these refusals (400) from a failure (500).
 */
export const ROUTE_BAD_POSITION = "Bad position";
export const ROUTE_OUTSIDE = "Routes start in the Maldives";
export const ROUTE_BAD_DESTINATION = "Bad destination";
