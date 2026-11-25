/**
 * The safety words the website shows beside its forecasts and boat routes, in one place so they say the same thing
 * everywhere and agree with /terms § About the forecast. The Android app keeps its own copy (ui/components/SafetyCopy.kt):
 * change both together.
 */

/** Under a site's current forecast. */
export const FORECAST_GUIDANCE =
  "A forecast to plan with, not a guarantee. Check with your dive guide or a local operator, and look at the water before you drop in.";

/** Inside the boat route feature, always shown: a short title and the reason. */
export const ROUTE_LIMITATION_TITLE = "Preview, not for navigation";
export const ROUTE_LIMITATION =
  "Drawn from satellite outlines, not a nautical chart, with forecast current. Keep a lookout and use proper charts.";

/** Beside the sea state, so it is not read as the current. */
export const SEA_SURFACE_NOTE = "Waves and wind at the surface, not the current underwater.";
