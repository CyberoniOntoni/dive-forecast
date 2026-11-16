/** A Maldives wall hour as the sheltered-water layer takes it: `YYYY-MM-DDTHH:00`. */
export const WALL_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;

/**
 * The widest view (degrees, either way) the API serves the layer for: a tablet at the app's lowest shelter zoom. The
 * web map asks only from zoom 8, where a laptop screen shows about 5 degrees across.
 */
export const SHELTER_MAX_VIEW_DEG = 10;
