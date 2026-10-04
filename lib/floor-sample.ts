/** Metres, positive down. null is a pixel the source did not observe. */
export type TransectSample = { distanceM: number; depthM: number | null };

export type ChannelSection = { widthM: number; depthM: number };

/** GEBCO elevation at or below this is open ocean for the seaward sample. Shallower includes land. */
export const OPEN_OCEAN_M = -50;

/** Usual sample, then the steps tried when that cell is still on the reef or on land. */
export const SEAWARD_STEPS_KM = [3, 6, 9, 12, 15] as const;

export const DEFAULT_SEAWARD_KM = SEAWARD_STEPS_KM[0];

/**
 * Allen Coral Atlas bathymetry is optical. Past this depth the bottom is not reliably measured,
 * and a missing pixel is not a deep channel.
 */
export const ACA_MAX_DEPTH_M = 15;

const MIN_SECTION_DEPTH_M = 5;
const MAX_SECTION_DEPTH_M = 150;
const MIN_SECTION_WIDTH_M = 20;
const MAX_SECTION_WIDTH_M = 2500;

export type FloorCell = { km: number; elevationM: number };

/**
 * First seaward step that is open ocean. Stays at 3 km when none of the steps is open,
 * so a bank that is shallow all the way out does not move the sample onto another shallow cell.
 */
export function pickSeawardKm(cells: readonly FloorCell[]): { km: number; open: boolean } {
  const byKm = new Map(cells.map((cell) => [cell.km, cell]));
  for (const km of SEAWARD_STEPS_KM) {
    const cell = byKm.get(km);
    if (cell == null || !Number.isFinite(cell.elevationM)) continue;
    if (cell.elevationM <= OPEN_OCEAN_M) return { km, open: true };
  }
  return { km: DEFAULT_SEAWARD_KM, open: false };
}

/**
 * Width and mean depth of the deep gap on a transect.
 * The depth is the mean of the gap, never the shoalest cell.
 * Any unobserved sample rejects the transect. A cap (Allen Coral Atlas) rejects a gap
 * that runs deeper than the source can see. Both shoulders must be shallower than half
 * the deepest sample, so an unbounded slope is not stored as a channel section.
 */
export function sectionFromTransect(
  samples: readonly TransectSample[],
  maxDepthM: number | null,
): ChannelSection | null {
  if (samples.length < 3) return null;
  if (samples.some((sample) => sample.depthM == null)) return null;
  const depths = samples.map((sample) => sample.depthM as number);
  if (depths.some((depth) => !Number.isFinite(depth) || depth <= 0)) return null;
  if (maxDepthM != null && depths.some((depth) => depth > maxDepthM)) return null;

  let deepestAt = 0;
  for (let i = 1; i < depths.length; i += 1) {
    if (depths[i] > depths[deepestAt]) deepestAt = i;
  }
  const deepest = depths[deepestAt];
  if (deepest < MIN_SECTION_DEPTH_M || deepest > MAX_SECTION_DEPTH_M) return null;

  const threshold = deepest / 2;
  let start = deepestAt;
  let end = deepestAt;
  while (start > 0 && depths[start - 1] >= threshold) start -= 1;
  while (end < depths.length - 1 && depths[end + 1] >= threshold) end += 1;
  if (start === 0 || end === depths.length - 1) return null;
  if (depths[start - 1] >= threshold || depths[end + 1] >= threshold) return null;

  const spacing = medianSpacing(samples);
  if (spacing == null) return null;
  const widthM = samples[end].distanceM - samples[start].distanceM + spacing;
  const run = depths.slice(start, end + 1);
  const depthM = run.reduce((sum, depth) => sum + depth, 0) / run.length;
  if (widthM < MIN_SECTION_WIDTH_M || widthM > MAX_SECTION_WIDTH_M) return null;
  if (depthM < MIN_SECTION_DEPTH_M || depthM > MAX_SECTION_DEPTH_M) return null;
  return { widthM, depthM };
}

function medianSpacing(samples: readonly TransectSample[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i += 1) gaps.push(samples[i].distanceM - samples[i - 1].distanceM);
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const spacing = gaps[Math.floor(gaps.length / 2)];
  return Number.isFinite(spacing) && spacing > 0 ? spacing : null;
}
