/**
 * How the sheltered-water layer's felt-height field travels from server to map, one byte per 500 m cell. Shared by
 * lib/shelter-grid.ts (server) and lib/shelter-layer.ts (browser), so it holds no server code.
 */

/** Felt-height quantum, metres: 0 to FIELD_MAX is 0 to 5 m. */
export const FIELD_STEP_M = 0.02;
export const FIELD_MAX = 250;
/** No water cell here (land, or outside the outline): the map fills it from its neighbours, then cuts it off. */
export const FIELD_NONE = 254;
/** A water cell whose sea state the rules leave out this hour (an upwind sample or the wind is missing). */
export const FIELD_UNKNOWN = 255;
