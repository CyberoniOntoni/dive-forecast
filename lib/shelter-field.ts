/**
 * How the sheltered-water layer's felt-height field travels from server to map, one byte per cell. Shared by
 * lib/shelter-grid.ts (server) and lib/shelter-layer.ts (browser), so it holds no server code.
 *
 * The low seven bits are the value; FIELD_OUTSIDE is set on water outside the atoll outline, which the map draws apart
 * from the lagoon so the reef stays a sharp line between them.
 */

/** Felt-height quantum, metres: 0 to FIELD_MAX is 0 to about 2.5 m, past the top of the map's colour scale. */
export const FIELD_STEP_M = 0.02;
export const FIELD_MAX = 123;
/** Another atoll's water, which that atoll's own field covers: no cell here, but no edge either. */
export const FIELD_OTHER = 124;
/** A water cell whose sea state the rules leave out this hour (an upwind sample or the wind is missing). */
export const FIELD_UNKNOWN = 125;
/** An island: the map fills it from the water round it, then cuts it out along the coast. */
export const FIELD_LAND = 126;
/** Past the edge of what the grid covers. Left clear, and the sea fades out toward it. */
export const FIELD_NONE = 127;
/** Set on water outside the atoll outline. */
export const FIELD_OUTSIDE = 128;

/** A water cell's byte: its felt height (null when unknown), and which side of the outline it lies. */
export function fieldByte(feltM: number | null, outside: boolean): number {
  const value = feltM == null ? FIELD_UNKNOWN : Math.min(FIELD_MAX, Math.round(feltM / FIELD_STEP_M));
  return outside ? value | FIELD_OUTSIDE : value;
}
