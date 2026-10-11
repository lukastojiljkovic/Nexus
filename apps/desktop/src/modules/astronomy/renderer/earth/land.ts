/**
 * The reader for the shipped coastline: `coastline.ts` holds the rings as
 * deltas in tenths of a degree, and this turns them back into latitudes and
 * longitudes, once per process.
 *
 * The decoding is one accumulation and nothing else, which is the point of the
 * format: a ring's first pair is its absolute position and every pair after it
 * is where the next point is relative to the one before, so 4 994 points fit in
 * 26 kB without a geometry library and without a binary blob nobody can read in
 * a diff. A pair that does not split into two numbers is skipped rather than
 * throwing: a map that loses one vertex of one ring is still a map, and this
 * runs inside a render pass.
 */
import type { LatLon } from "@nexus/core";
import { COASTLINE } from "./coastline.js";

/** Tenths of a degree, the unit the table is written in. */
const TENTHS_PER_DEGREE = 10;

let parsed: readonly (readonly LatLon[])[] | null = null;

/** Every ring of the 1:110m land data, holes included, as latitudes and longitudes. */
export function landRings(): readonly (readonly LatLon[])[] {
  if (parsed !== null) return parsed;
  const rings: LatLon[][] = [];
  for (const line of COASTLINE.split("\n")) {
    const ring: LatLon[] = [];
    let lonTenths = 0;
    let latTenths = 0;
    for (const pair of line.split(" ")) {
      const [deltaLon, deltaLat] = pair.split(",");
      if (deltaLon === undefined || deltaLat === undefined) continue;
      lonTenths += Number(deltaLon);
      latTenths += Number(deltaLat);
      ring.push({ latDeg: latTenths / TENTHS_PER_DEGREE, lonDeg: lonTenths / TENTHS_PER_DEGREE });
    }
    if (ring.length >= 3) rings.push(ring);
  }
  parsed = rings;
  return rings;
}
