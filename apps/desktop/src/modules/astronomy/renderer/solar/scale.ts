import type { BodyId, BodyState, SolarSystemSnapshot, Vector3 } from "@nexus/core";

/**
 * The two ways this view can lay the solar system out, as pure functions.
 *
 * **`true` is the real thing, and it is barely watchable.** Every body sits
 * where the engine put it and every sphere carries its own radius: one au is
 * `TRUE_UNITS_PER_AU` scene units and a kilometre is that same measure of
 * length. At that scale the Earth's own radius is 1/23 000 of an au, so a screen
 * framed on Neptune draws it as a fraction of a pixel. The module's own surface
 * says so in words (`scale: "true"` is the mode the copy warns about) rather
 * than this file pretending otherwise.
 *
 * **`readable` compresses distance and enlarges radii, and lies in exactly two
 * ways.** Distances go through a logarithm, radii through another one. Both are
 * strictly increasing, so:
 *
 * - **the order survives** — a body farther from the Sun is still farther from
 *   the Sun, and a bigger body is still drawn bigger;
 * - **the direction survives exactly** — a position is multiplied by a factor
 *   that depends on its distance alone, never on its angle, so nothing is ever
 *   turned away from where it really is.
 *
 * The two things it does not do are stated where they happen: the Sun is the
 * origin of both maps (so it cannot be drawn at a compressed distance), and the
 * Moon gets one extra rule (`placeBodies`) because a compressed orbit and an
 * enlarged planet cannot both be honoured by a satellite.
 *
 * **Why this is a module of its own.** It is the half of the view that is
 * arithmetic rather than graphics, so it is the half that can be tested without
 * a canvas, a camera or a renderer — which is the only kind of test this
 * repository can run for a three.js view at all.
 */

/** How the view lays the system into scene units. */
export type SolarScale = "true" | "readable";

/**
 * Kilometres in one astronomical unit. The IAU's 2012 definition fixes the au
 * at exactly 149 597 870 700 m, so this is a definition and not a measurement.
 */
export const KM_PER_AU = 149_597_870.7;

/** True scale: one au is this many scene units. Any number would do; a round one is read. */
export const TRUE_UNITS_PER_AU = 1000;

/** Readable scale: scene units per natural log of distance, and the distance the log is taken around. */
export const READABLE_UNITS_PER_LOG = 20;
export const READABLE_AU_REF = 0.05;

/** Readable scale: the same shape for radii, around a reference radius in kilometres. */
export const READABLE_RADIUS_UNITS_PER_LOG = 1;
export const READABLE_KM_REF = 2000;

/**
 * How far, in readable units, a moon is pushed clear of its planet's surface —
 * the gap between the two spheres, on top of both their drawn radii.
 */
export const SATELLITE_CLEARANCE_UNITS = 0.6;

/** A real distance in au, in true-scale scene units. */
export function trueDistanceUnits(au: number): number {
  return au * TRUE_UNITS_PER_AU;
}

/**
 * A real distance in au, in readable scene units.
 *
 * `log1p` rather than `log` so that zero is zero — the Sun is the origin of this
 * map too — and so that the curve is smooth there instead of falling off a cliff.
 * `READABLE_AU_REF` is the knee: below it the map is nearly linear, above it
 * nearly logarithmic, which is what keeps Mercury off the Sun without pulling
 * Neptune in on top of Jupiter.
 */
export function readableDistanceUnits(au: number): number {
  return READABLE_UNITS_PER_LOG * Math.log1p(au / READABLE_AU_REF);
}

/** A real radius in kilometres, in true-scale scene units. */
export function trueRadiusUnits(radiusKm: number): number {
  return (radiusKm / KM_PER_AU) * TRUE_UNITS_PER_AU;
}

/**
 * A real radius in kilometres, in readable scene units.
 *
 * A logarithm here too, and for a reason the numbers show rather than a taste:
 * linearly enlarged radii would make the Sun (109 Earths across) larger than
 * Mercury's whole orbit. Compressed, the Sun is 5.9 units across against
 * Mercury's 43-unit orbit, and Jupiter is still the largest planet drawn.
 */
export function readableRadiusUnits(radiusKm: number): number {
  return READABLE_RADIUS_UNITS_PER_LOG * Math.log1p(radiusKm / READABLE_KM_REF);
}

/** The pair of maps, as one record so the component never branches on the scale. */
export interface ScaleMapping {
  readonly distanceUnits: (au: number) => number;
  readonly radiusUnits: (radiusKm: number) => number;
}

export const SCALE_MAPPINGS: Readonly<Record<SolarScale, ScaleMapping>> = {
  true: { distanceUnits: trueDistanceUnits, radiusUnits: trueRadiusUnits },
  readable: { distanceUnits: readableDistanceUnits, radiusUnits: readableRadiusUnits },
};

function vectorLength(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * One position in scene units, in the layout's own measure.
 *
 * The direction is exact in both layouts: the point is scaled by a factor that
 * is a function of its length alone. A body at the origin (the Sun) stays there.
 */
export function scenePosition(position: Vector3, scale: SolarScale): Vector3 {
  const au = vectorLength(position);
  if (au === 0) return [0, 0, 0];
  const factor = SCALE_MAPPINGS[scale].distanceUnits(au) / au;
  return [position[0] * factor, position[1] * factor, position[2] * factor];
}

/** How large a body's sphere is drawn, in scene units, in the chosen layout. */
export function bodyRadiusUnits(body: BodyState, scale: SolarScale): number {
  return SCALE_MAPPINGS[scale].radiusUnits(body.radiusKm);
}

/**
 * Every body's position, in scene units — the radial map above, plus the one
 * rule a satellite needs.
 *
 * **Why the Moon needs a rule of its own.** The Moon is 384 400 km from the
 * Earth (NASA Moon fact sheet, `https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html`),
 * which is 0.00257 au. At a compressed distance the slope of the map at 1 au is
 * `READABLE_UNITS_PER_LOG / (READABLE_AU_REF + 1)` ≈ 19 units per au, so that
 * offset maps to 0.05 units — while the Earth drawn at readable scale is 1.43
 * units across. Mapped radially, the Moon would be *inside* the planet, which is
 * not a compressed picture of anything. So a body within
 * `SATELLITE_CLEARANCE_UNITS` of an enlarged parent is pushed straight out along
 * its own offset until it clears both spheres, exactly as if its separation were
 * enlarged the way a radius is.
 *
 * The direction from the Earth stays exact, and only the Moon is affected — it
 * is the one body in the contract whose orbit is another body's, and the offset
 * is what identifies it. True scale needs none of this: there the Moon is where
 * it is, one twenty-thousandth of a unit from the Earth, and honest.
 */
export function placeBodies(
  snapshot: SolarSystemSnapshot,
  scale: SolarScale,
): ReadonlyMap<BodyId, Vector3> {
  const placed = new Map<BodyId, Vector3>();
  for (const body of snapshot.bodies) placed.set(body.id, scenePosition(body.position, scale));
  if (scale === "true") return placed;

  const earth = snapshot.bodies.find((body) => body.id === "earth");
  const moon = snapshot.bodies.find((body) => body.id === "moon");
  if (earth === undefined || moon === undefined) return placed;
  const earthAt = placed.get("earth");
  const moonAt = placed.get("moon");
  if (earthAt === undefined || moonAt === undefined) return placed;

  const offset: Vector3 = [moonAt[0] - earthAt[0], moonAt[1] - earthAt[1], moonAt[2] - earthAt[2]];
  const separation = vectorLength(offset);
  const clearance =
    bodyRadiusUnits(earth, scale) + bodyRadiusUnits(moon, scale) + SATELLITE_CLEARANCE_UNITS;
  // A placeholder that happens to sit exactly on its parent has no direction to
  // be pushed along; leaving it alone is the only answer that does not invent one.
  if (separation === 0 || separation >= clearance) return placed;

  const lift = clearance / separation;
  placed.set("moon", [
    earthAt[0] + offset[0] * lift,
    earthAt[1] + offset[1] * lift,
    earthAt[2] + offset[2] * lift,
  ]);
  return placed;
}
