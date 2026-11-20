import { KM_PER_DEG_LAT, KM_PER_DEG_LON, pointInRing, ringBox, type RimRing, type RingBox } from "./rim";

/**
 * How far in from the outline (the reef's outer edge) land counts as closing that stretch of rim. Islands sit on the
 * reef flat a few hundred metres behind the edge; a kilometre reaches the far side of the widest flats without
 * reaching islands well inside the lagoon.
 */
export const LAND_BACK_KM = 1;
/** Spacing of the walk along the outline and of the steps inward, km. */
const STEP_KM = 0.1;

type Point = { lat: number; lon: number };

/**
 * For each point on an atoll's outline, the share of the outline nearest to it that has land behind it: an island
 * within LAND_BACK_KM inward of the edge. The outline is walked every 100 m; each step looks inward along its own
 * segment's normal and is counted toward the point it is nearest. Water crosses the rim over reef flats and through
 * gaps, not through islands, so a stretch of rim backed by island (and the causeways that join islands in places such
 * as Addu, which the land polygons mostly cover) lets no water in or out. A point with no step nearest to it reads 0.
 */
export function landBackedShares(rim: RimRing, points: readonly Point[], islands: readonly RimRing[]): number[] {
  if (points.length === 0 || rim.length < 4) return points.map(() => 0);
  const box = ringBox(rim);
  const padLat = LAND_BACK_KM / KM_PER_DEG_LAT;
  const cosLat = Math.cos((((box.south + box.north) / 2) * Math.PI) / 180);
  const padLon = LAND_BACK_KM / (KM_PER_DEG_LON * cosLat);
  const near: { ring: RimRing; box: RingBox }[] = islands
    .map((ring) => ({ ring, box: ringBox(ring) }))
    .filter(
      (island) =>
        island.box.north >= box.south - padLat &&
        island.box.south <= box.north + padLat &&
        island.box.east >= box.west - padLon &&
        island.box.west <= box.east + padLon,
    );
  const onLand = (lat: number, lon: number) =>
    near.some(
      ({ ring, box: b }) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east && pointInRing(lat, lon, ring),
    );
  const backed = points.map(() => 0);
  const counted = points.map(() => 0);
  for (let index = 0; index + 1 < rim.length; index += 1) {
    const [lat1, lon1] = rim[index];
    const [lat2, lon2] = rim[index + 1];
    const dx = (lon2 - lon1) * KM_PER_DEG_LON * cosLat;
    const dy = (lat2 - lat1) * KM_PER_DEG_LAT;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    // The segment's normal, turned to point into the atoll.
    let nx = -dy / length;
    let ny = dx / length;
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    if (!pointInRing(midLat + (ny * 0.05) / KM_PER_DEG_LAT, midLon + (nx * 0.05) / (KM_PER_DEG_LON * cosLat), rim)) {
      nx = -nx;
      ny = -ny;
    }
    const steps = Math.max(1, Math.round(length / STEP_KM));
    for (let step = 0; step < steps; step += 1) {
      const share = (step + 0.5) / steps;
      const lat = lat1 + share * (lat2 - lat1);
      const lon = lon1 + share * (lon2 - lon1);
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      points.forEach((point, pointIndex) => {
        const distance = Math.hypot((point.lat - lat) * KM_PER_DEG_LAT, (point.lon - lon) * KM_PER_DEG_LON * cosLat);
        if (distance < best) {
          best = distance;
          nearest = pointIndex;
        }
      });
      let land = false;
      for (let km = 0; km <= LAND_BACK_KM + 1e-9 && !land; km += STEP_KM) {
        land = onLand(lat + (ny * km) / KM_PER_DEG_LAT, lon + (nx * km) / (KM_PER_DEG_LON * cosLat));
      }
      counted[nearest] += 1;
      if (land) backed[nearest] += 1;
    }
  }
  return points.map((_, index) => (counted[index] > 0 ? backed[index] / counted[index] : 0));
}
