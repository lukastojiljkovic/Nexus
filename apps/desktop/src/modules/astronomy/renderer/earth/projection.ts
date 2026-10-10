/**
 * The day-and-night map's own geometry: an equirectangular (plate carree) world,
 * longitude across and latitude down.
 *
 * **Why this projection.** The map has to place a latitude and a longitude where
 * a reader expects them, and it has to do it for `DayNight`'s four shapes — the
 * terminator, the three twilight edges, the two overhead points and the
 * observer's pin. An equirectangular world is the only projection whose inverse
 * is one multiplication, which is what lets the day/night blend below be
 * computed per PIXEL rather than per polygon: `pointAt` turns a pixel into the
 * place that pixel is, and the blend asks what the Sun is doing there. It is
 * also the projection every world map in an atlas is drawn in as a reference
 * grid, which is why a reader can find their own country on it without a
 * legend.
 *
 * **The antimeridian is a seam, not a stroke.** A path that steps from +179 to
 * -179 degrees is a path that walks the whole width of the map. {@link
 * unwrapLongitudes} is the one rule against that: it takes the wrap out of the
 * longitudes, so the path leaves the map on one side and comes back on the other
 * with its steps intact. The caller then draws that one path three times, once
 * shifted a whole world left and once a whole world right, and the canvas clips
 * each copy to the box — which fills Antarctica and Chukotka across the seam
 * without a chord, and needs no cutting of rings at all.
 *
 * Everything here is pure and measured in the caller's own pixels: no canvas, no
 * scaling, no state.
 */
import type { LatLon } from "@nexus/core";

/** The box the world is drawn into, in whatever pixels the caller is using. */
export interface MapRect {
  readonly width: number;
  readonly height: number;
}

/** A place in that box. */
export interface MapPixel {
  readonly x: number;
  readonly y: number;
}

/** Degrees of longitude across the map. */
const WORLD_LON_DEGREES = 360;

/** Degrees of latitude down the map, from the north pole to the south. */
const WORLD_LAT_DEGREES = 180;

/** The x of a longitude, measured from the left edge. */
export function mapX(lonDeg: number, width: number): number {
  return ((lonDeg + WORLD_LON_DEGREES / 2) / WORLD_LON_DEGREES) * width;
}

/** The y of a latitude, measured from the top edge. */
export function mapY(latDeg: number, height: number): number {
  return ((WORLD_LAT_DEGREES / 2 - latDeg) / WORLD_LAT_DEGREES) * height;
}

/** Where a place sits in the box. */
export function mapPoint(point: LatLon, rect: MapRect): MapPixel {
  return { x: mapX(point.lonDeg, rect.width), y: mapY(point.latDeg, rect.height) };
}

/** The place a pixel is, the inverse of {@link mapPoint} — pixel centres included, the caller adds the half. */
export function pointAt(x: number, y: number, rect: MapRect): LatLon {
  return {
    latDeg: WORLD_LAT_DEGREES / 2 - (y / rect.height) * WORLD_LAT_DEGREES,
    lonDeg: (x / rect.width) * WORLD_LON_DEGREES - WORLD_LON_DEGREES / 2,
  };
}

/**
 * The same path with the antimeridian wrap taken out of its longitudes.
 *
 * Every step is folded into (-180, 180], so a path that jumps from +179 to -179
 * becomes one that walks on to +181, and the caller can draw it as it is. That
 * is only meaningful because the map repeats every 360 degrees: a longitude
 * outside [-180, 180] is the same meridian as its folded twin, and the caller
 * draws the path three times, a whole world apart, so the part that ran off one
 * edge appears at the other.
 *
 * The first point is kept as it is, so a caller that wants a path where it
 * started still gets one; the step is decided by the two points and not by the
 * width of the box, because nothing drawn here is more than half a world wide.
 */
export function unwrapLongitudes(points: readonly LatLon[]): readonly LatLon[] {
  const unwrapped: LatLon[] = [];
  let previous: number | null = null;
  for (const point of points) {
    let lonDeg = point.lonDeg;
    if (previous !== null) {
      while (lonDeg - previous > WORLD_LON_DEGREES / 2) lonDeg -= WORLD_LON_DEGREES;
      while (previous - lonDeg > WORLD_LON_DEGREES / 2) lonDeg += WORLD_LON_DEGREES;
    }
    unwrapped.push({ latDeg: point.latDeg, lonDeg });
    previous = lonDeg;
  }
  return unwrapped;
}
