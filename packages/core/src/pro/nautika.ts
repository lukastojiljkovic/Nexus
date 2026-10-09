/**
 * „Nautika i jedrenje" — the arithmetic behind the sailing toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a maintainer asks „where does the great-circle distance live", and
 * `pro/nautika.ts` answers it where `pro/navigation.ts` would not.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * I/O, no locale, no formatting: the surface owns its state and asks here for
 * every number it prints.
 *
 * **Nothing here is a navigation system, and every tool says so on screen.**
 * The whole pack is `life-safety`-remembering in spirit — a wrong course, a
 * short rode or a misread range puts a boat on a reef — so what comes back is a
 * QUANTITY and never a decision. There is no „safe", no „dozvoljeno" and no
 * boolean verdict in this file, for the reason `toolForbidsVerdict` gives: the
 * choice of which figure to steer by belongs to the person on the water, who is
 * the one looking at the weather, the chart and the tide.
 *
 * **The earth is a SPHERE here, and that is stated rather than hidden.** The
 * mean radius `R1` of the IUGG is what a great-circle sailing calculation uses,
 * and the oblate difference is about 0,3 % — well under the accuracy of any
 * bearing a small craft can hold. `pro/geodezija.ts` is where the ellipsoid
 * lives, and the two are deliberately not merged: a navigator wants the sphere
 * and a surveyor wants the ellipsoid.
 */

import {
  fail,
  isInRange,
  isNonNegative,
  isPositive,
  quotient,
  type ProResult,
} from "./result.js";

/** The international nautical mile, exactly 1852 m (International Hydrographic Conference, Monaco 1929). */
const NM_IN_M = 1852;

/** One knot is one nautical mile per hour — the definition, not a measurement. */
const KN_IN_MS = NM_IN_M / 3600;

/** One kilometre per hour in metres per second, by the two SI prefixes. */
const KMH_IN_MS = 1 / 3.6;

/** Standard gravity, m/s² — fixed by definition (CGPM 1901). */
const G_N = 9.80665;

/** The international foot, m — exact by definition (1959 agreement). */
const FOOT_IN_M = 0.3048;

/** Mean Earth radius R1, km — IUGG (the arithmetic mean of the three ellipsoid semi-axes). */
const MEAN_EARTH_RADIUS_KM = 6371.0088;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/** A position on the sphere, in degrees. North and east are positive. */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Latitude and longitude bounded by their own names, before any trigonometry
 * touches them.
 *
 * A longitude of 400° is not an error anybody makes on purpose; it is what a
 * pasted value from a spreadsheet or a multiplied degree figure produces, and
 * every trigonometric function silently accepts it and answers a real place on
 * the other side of the world. Both bounds are the definition of the
 * coordinate, not a rule of this file.
 */
function isLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/** A folded bearing in degrees, clockwise from north, always in [0, 360). */
function foldDegrees(degrees: number): number {
  const folded = degrees % 360;
  return folded < 0 ? folded + 360 : folded;
}

/** Knots as km/h, through the two exact definitions above rather than a 1,852 literal. */
function knotsToKmh(knots: number): number {
  return (knots * KN_IN_MS) / KMH_IN_MS;
}

/* ---------------------------------------------------------------------------
 * speed-distance-time — „Brzina, vreme i put"
 * ------------------------------------------------------------------------ */

export interface SpeedRunInput {
  /** Exactly two of the three are given; the third is the answer. */
  readonly speedKnots?: number | undefined;
  readonly distanceNm?: number | undefined;
  readonly timeHours?: number | undefined;
}

export interface SpeedRunResult {
  readonly speedKnots: number;
  readonly speedKmh: number;
  readonly speedMs: number;
  readonly distanceNm: number;
  readonly distanceKm: number;
  readonly timeHours: number;
  readonly timeMinutes: number;
}

/**
 * The third of speed, distance and time from the other two.
 *
 * `v = s/t` for uniform motion, in the three units a boat works in: knots and
 * nautical miles at sea, km/h and km on the chart's land side, m/s when the
 * figure is going into a formula. Nothing is average over a passage in the
 * physical sense — the tool answers „at this speed, this distance takes this
 * long", which is the plan and not the log.
 *
 * Two fields is not „one is optional": all three given is a contradiction the
 * tool cannot arbitrate, and one given leaves the other two unconstrained
 * rather than underdetermined-in-a-useful-way. Both are refused by name.
 */
export function speedRun(input: SpeedRunInput): ProResult<SpeedRunResult> {
  const { speedKnots, distanceNm, timeHours } = input;
  const given = [speedKnots !== undefined, distanceNm !== undefined, timeHours !== undefined];
  if (given.filter(Boolean).length !== 2) return fail("pair");

  let speed: number;
  let distance: number;
  let hours: number;
  if (speedKnots !== undefined) {
    if (!isPositive(speedKnots) || speedKnots > 200) return fail("speed");
    speed = speedKnots;
    if (distanceNm !== undefined) {
      if (!isNonNegative(distanceNm) || distanceNm > 1e6) return fail("distance");
      distance = distanceNm;
      const derived = quotient(distance, speed);
      if (derived === undefined) return fail("speed");
      hours = derived;
    } else {
      if (!isPositive(timeHours) || timeHours > 1e6) return fail("time");
      hours = timeHours;
      distance = speed * hours;
    }
  } else {
    if (distanceNm === undefined || !isNonNegative(distanceNm) || distanceNm > 1e6) {
      return fail("distance");
    }
    if (timeHours === undefined || !isPositive(timeHours) || timeHours > 1e6) return fail("time");
    distance = distanceNm;
    hours = timeHours;
    // A distance of zero over a positive time is a zero speed, which is a
    // perfectly good answer rather than a failure.
    speed = distance === 0 ? 0 : distance / hours;
  }

  const speedMs = speed * KN_IN_MS;
  return {
    ok: true,
    speedKnots: speed,
    speedKmh: knotsToKmh(speed),
    speedMs,
    distanceNm: distance,
    distanceKm: (distance * NM_IN_M) / 1000,
    timeHours: hours,
    timeMinutes: hours * 60,
  };
}

/* ---------------------------------------------------------------------------
 * great-circle — „Ortodroma i azimut"
 * ------------------------------------------------------------------------ */

export interface GreatCircleInput {
  readonly from: LatLon;
  readonly to: LatLon;
}

export interface GreatCircleResult {
  /** Along the shorter great circle, in nautical miles. */
  readonly distanceNm: number;
  readonly distanceKm: number;
  /** Bearing at the START of the great circle, degrees true. Undefined for coincident points. */
  readonly initialBearingDeg: number | undefined;
  /** Bearing on ARRIVAL, which is not the initial one on any line but a meridian. */
  readonly finalBearingDeg: number | undefined;
  /** The rhumb line — the constant-course line — and its own distance and bearing. */
  readonly rhumbDistanceNm: number;
  readonly rhumbBearingDeg: number | undefined;
  /** How much longer the constant-course line is than the great circle, as a fraction. */
  readonly rhumbExcess: number;
  readonly centralAngleDeg: number;
}

/** Longitude taken the short way round, in radians, always in (−π, π]. */
function deltaLongitude(lon1: number, lon2: number): number {
  let delta = (lon2 - lon1) * RAD_PER_DEG;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Great-circle distance and bearings, and the rhumb line beside them.
 *
 * **Haversine, not the spherical law of cosines.** `acos` of the law of cosines
 * loses precision catastrophically for short legs — two points 200 m apart on
 * the same parallel can come out as zero or as a hundred metres depending on
 * the last bit of the cosine — and a passage is a chain of short legs between
 * fixes. The haversine form is stable at both ends: `2R·asin(√a)`.
 *
 * **The bearing is the INITIAL one and it is not constant.** On a sphere a
 * great circle crosses every meridian at a different angle, so the course
 * steered at the start does not hold, and the arrival bearing is returned
 * beside it because on a long leg the two differ by tens of degrees. That is
 * exactly why the rhumb line is here: it is the constant course a compass can
 * actually hold, it is longer, and the difference `rhumbExcess` is what the
 * simplicity costs. Both are spherical — see this file's header.
 *
 * Coincident points have no bearing to give and are returned with the two
 * bearings `undefined` rather than with a zero that reads as due north.
 */
export function greatCircle(input: GreatCircleInput): ProResult<GreatCircleResult> {
  const { from, to } = input;
  if (!isLatitude(from.lat) || !isLongitude(from.lon)) return fail("from");
  if (!isLatitude(to.lat) || !isLongitude(to.lon)) return fail("to");

  const phi1 = from.lat * RAD_PER_DEG;
  const phi2 = to.lat * RAD_PER_DEG;
  const dPhi = phi2 - phi1;
  const dLambda = deltaLongitude(from.lon, to.lon);

  const sinHalfPhi = Math.sin(dPhi / 2);
  const sinHalfLambda = Math.sin(dLambda / 2);
  const a = sinHalfPhi * sinHalfPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;
  // `a` can exceed 1 by one ulp on an antipodal pair, and `asin` of >1 is NaN.
  const clamped = a > 1 ? 1 : a;
  const centralAngle = 2 * Math.asin(Math.sqrt(clamped));
  const distanceKm = MEAN_EARTH_RADIUS_KM * centralAngle;

  let initialBearing: number | undefined;
  let finalBearing: number | undefined;
  if (centralAngle > 0) {
    // atan2(sinΔλ·cosφ2, cosφ1·sinφ2 − sinφ1·cosφ2·cosΔλ) — the standard
    // initial course from north, clockwise.
    initialBearing = foldDegrees(
      Math.atan2(
        Math.sin(dLambda) * Math.cos(phi2),
        Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda),
      ) * DEG_PER_RAD,
    );
    // The arrival bearing is the initial one measured BACKWARDS from the
    // destination, which is the convention a charted approach is read in.
    finalBearing = foldDegrees(
      foldDegrees(
        Math.atan2(
          -Math.sin(dLambda) * Math.cos(phi1),
          Math.cos(phi2) * Math.sin(phi1) - Math.sin(phi2) * Math.cos(phi1) * Math.cos(dLambda),
        ) * DEG_PER_RAD,
      ) + 180,
    );
  }

  // Mercator sailing, the standard rhumb-line form: the meridional part
  // Δψ = ln(tan(π/4 + φ/2)) between the two latitudes, and the q factor that
  // makes the parallel arcs commensurable with the meridians („Bowditch",
  // the Mercator-sailing article).
  const psi1 = Math.log(Math.tan(Math.PI / 4 + phi1 / 2));
  const psi2 = Math.log(Math.tan(Math.PI / 4 + phi2 / 2));
  const dPsi = psi2 - psi1;
  const q = dPsi === 0 ? Math.cos(phi1) : dPhi / dPsi;
  const rhumbCentral = Math.sqrt(dPhi * dPhi + q * q * dLambda * dLambda);
  const rhumbDistanceKm = MEAN_EARTH_RADIUS_KM * rhumbCentral;
  const rhumbBearing =
    centralAngle === 0 || rhumbCentral === 0
      ? undefined
      : foldDegrees(Math.atan2(dLambda, dPsi) * DEG_PER_RAD);

  return {
    ok: true,
    distanceNm: (distanceKm * 1000) / NM_IN_M,
    distanceKm,
    initialBearingDeg: initialBearing,
    finalBearingDeg: finalBearing,
    rhumbDistanceNm: (rhumbDistanceKm * 1000) / NM_IN_M,
    rhumbBearingDeg: rhumbBearing,
    rhumbExcess:
      distanceKm === 0 ? 0 : (rhumbDistanceKm - distanceKm) / distanceKm,
    centralAngleDeg: centralAngle * DEG_PER_RAD,
  };
}

/* ---------------------------------------------------------------------------
 * anchor-rode — „Anker i uže"
 * ------------------------------------------------------------------------ */

export interface AnchorRodeInput {
  /** Water depth under the bow, metres. */
  readonly depthM: number;
  /** Height of the bow roller above the waterline, metres. Zero when not given. */
  readonly bowHeightM?: number | undefined;
  /**
   * Riding scope — rode paid out per metre of depth measured at the BOW, the
   * convention every anchoring text uses. The tool does not choose it.
   */
  readonly scope: number;
}

export interface AnchorRodeResult {
  readonly rodeM: number;
  readonly rodeFt: number;
  /** Depth plus bow height — what the scope is measured against. */
  readonly depthUsedM: number;
}

/**
 * How much rode a chosen scope needs.
 *
 * **Scope is measured at the bow, not at the waterline.** A yacht whose bow
 * roller sits 1,5 m up and which is anchored in 5 m of water needs 6,5 × scope,
 * not 5 × scope — and the difference is the whole reason an anchor that held
 * all last summer drags this time. The bow height is therefore an input rather
 * than a correction this file applies silently.
 *
 * The scope itself is the user's: 5:1 is the common all-chain figure and 7:1 is
 * what a rope-and-chain rode is usually given, and both are conventions that
 * depend on the bottom, the weather and the boat rather than on arithmetic.
 * There is no default here on purpose — the same reason a limit is never
 * embedded is the reason a scope is never guessed.
 *
 */
export function anchorRode(input: AnchorRodeInput): ProResult<AnchorRodeResult> {
  const { depthM, bowHeightM, scope } = input;
  if (!isPositive(depthM) || depthM > 200) return fail("depth");
  const bow = bowHeightM ?? 0;
  if (!isNonNegative(bow) || bow > 20) return fail("bowHeight");
  if (!isPositive(scope) || scope > 30) return fail("scope");
  const depthUsed = depthM + bow;
  const rode = scope * depthUsed;
  return {
    ok: true,
    rodeM: rode,
    rodeFt: rode / FOOT_IN_M,
    depthUsedM: depthUsed,
  };
}

/* ---------------------------------------------------------------------------
 * fuel-range — „Autonomija goriva"
 * ------------------------------------------------------------------------ */

export interface FuelRangeInput {
  readonly tankLitres: number;
  /** The part of the tank that is safely burnable, %. The reserve is subtracted separately. */
  readonly usablePercent: number;
  readonly burnLitresPerHour: number;
  readonly speedKnots: number;
  /** Fuel held back for the passage's own reserve, %. */
  readonly reservePercent: number;
}

export interface FuelRangeResult {
  readonly usableLitres: number;
  readonly reserveLitres: number;
  readonly burnableLitres: number;
  readonly hours: number;
  readonly hoursWithoutReserve: number;
  readonly rangeNm: number;
  readonly rangeKm: number;
}

/**
 * Range and endurance from a tank, a burn rate and a speed.
 *
 * `t = V/P` and `s = v·t` — the two defining relations, nothing more. The two
 * percentages are the user's: `usablePercent` is how much of the tank the
 * pick-up actually reaches, and `reservePercent` is the fuel held back, and
 * both are figures of the boat rather than of this file.
 *
 * The model is a CONSTANT burn at a constant speed. A planing boat at
 * displacement speed burns a fraction of what it burns on the plane, so a range
 * computed from one burn rate is an endurance at that rate and not a passage
 * forecast — the surface says so rather than the answer being hedged here.
 */
export function fuelRange(input: FuelRangeInput): ProResult<FuelRangeResult> {
  const { tankLitres, usablePercent, burnLitresPerHour, speedKnots, reservePercent } = input;
  if (!isPositive(tankLitres) || tankLitres > 1e6) return fail("tank");
  if (!isInRange(usablePercent, 0, 100)) return fail("usable");
  if (!isInRange(reservePercent, 0, 100)) return fail("reserve");
  if (!isPositive(burnLitresPerHour) || burnLitresPerHour > 1e5) return fail("burn");
  if (!isPositive(speedKnots) || speedKnots > 200) return fail("speed");

  const usable = (tankLitres * usablePercent) / 100;
  const reserve = (usable * reservePercent) / 100;
  const burnable = usable - reserve;
  const hours = quotient(burnable, burnLitresPerHour);
  if (hours === undefined) return fail("burn");
  const hoursWithout = quotient(usable, burnLitresPerHour);
  if (hoursWithout === undefined) return fail("burn");
  return {
    ok: true,
    usableLitres: usable,
    reserveLitres: reserve,
    burnableLitres: burnable,
    hours,
    hoursWithoutReserve: hoursWithout,
    rangeNm: speedKnots * hours,
    rangeKm: speedKnots * hours * (NM_IN_M / 1000),
  };
}

/* ---------------------------------------------------------------------------
 * hull-speed — „Brzina trupa"
 * ------------------------------------------------------------------------ */

/**
 * The Froude number a displacement hull cannot usefully exceed.
 *
 * The traditional constant is 1,34 knots per √foot of waterline length, and it
 * is not a measured figure: it is `Fr·√g` with `Fr` near 0,40 and `g` in
 * ft/s² — `0,40 × √32,174 = 2,269 ft/s`, which is 1,345 kn per √ft. The value
 * 0,40 is the wave-making limit (the wavelength of the bow wave reaching the
 * hull length), and hulls are quoted from 1,3 to 1,4; it is therefore an input
 * with 0,40 as the conventional value rather than a law.
 */
const FROUDE_HULL_SPEED = 0.4;

export interface HullSpeedInput {
  /** Waterline length, metres — not the length overall. */
  readonly lengthWaterlineM: number;
  /** Froude number to use; the conventional displacement-hull value when omitted. */
  readonly froude?: number | undefined;
}

export interface HullSpeedResult {
  readonly hullSpeedKnots: number;
  readonly hullSpeedKmh: number;
  readonly hullSpeedMs: number;
  readonly lengthWaterlineFt: number;
  readonly froudeUsed: number;
  /** The speed-length ratio `v/√L` in knots per √foot — the traditional form of the same number. */
  readonly speedLengthRatio: number;
}

/**
 * The hull speed of a displacement hull — `v = Fr·√(g·L)`.
 *
 * The Froude number is the ratio of inertial to gravitational force on the
 * wave train a hull drags along, and its value at which the wave becomes as
 * long as the hull is the wall a displacement boat runs into: past it the boat
 * is climbing its own bow wave, and the power needed rises out of all
 * proportion while the speed barely does. It is a LIMIT of the displacement
 * regime and not a speed anybody is entitled to: a light, narrow hull exceeds
 * it by planing and a heavy one never reaches it.
 */
export function hullSpeed(input: HullSpeedInput): ProResult<HullSpeedResult> {
  const { lengthWaterlineM, froude } = input;
  if (!isPositive(lengthWaterlineM) || lengthWaterlineM > 200) return fail("length");
  const fr = froude ?? FROUDE_HULL_SPEED;
  if (!isInRange(fr, 0.1, 1.5)) return fail("froude");
  const speedMs = fr * Math.sqrt(G_N * lengthWaterlineM);
  const speedKnots = speedMs / KN_IN_MS;
  return {
    ok: true,
    hullSpeedKnots: speedKnots,
    hullSpeedKmh: knotsToKmh(speedKnots),
    hullSpeedMs: speedMs,
    lengthWaterlineFt: lengthWaterlineM / FOOT_IN_M,
    froudeUsed: fr,
    speedLengthRatio: speedKnots / Math.sqrt(lengthWaterlineM / FOOT_IN_M),
  };
}

/* ---------------------------------------------------------------------------
 * rule-of-twelfths — „Pravilo dvanaestina"
 * ------------------------------------------------------------------------ */

/** The twelve parts, by hour of the six-hour tide: 1+2+3+3+2+1 = 12. */
const TWELFTHS = [1, 2, 3, 3, 2, 1] as const;

export interface TideHeightRow {
  /** Hours after the turn of the tide, whole hours. */
  readonly hour: number;
  /** Range moved in that hour, as twelfth-parts. */
  readonly twelfths: number;
  /** Range moved since the turn, as a fraction of the whole range. */
  readonly fraction: number;
  /** Height moved since the turn, metres. */
  readonly movedM: number;
}

export interface RuleOfTwelfthsInput {
  /** The tidal range (high water minus low water), metres. */
  readonly rangeM: number;
  /** Time from the turn of the tide, hours. May be fractional; at most the duration. */
  readonly hoursFromTurn: number;
  /** The tide's own interval from high to low water, hours. Six is the usual figure. */
  readonly durationHours: number;
}

export interface RuleOfTwelfthsResult {
  /** Range moved by now, as a fraction of the whole range. */
  readonly fraction: number;
  /** Height moved since the turn, metres. */
  readonly movedM: number;
  /** The level the tide is at now, metres above low water — for a falling tide, high water minus `movedM`. */
  readonly heightAboveLowM: number;
  readonly hoursUsed: number;
  readonly row: TideHeightRow;
  readonly table: readonly TideHeightRow[];
}

/**
 * The height of the tide part-way between the turns, by the rule of twelfths.
 *
 * The rule is a rough model of a sinusoidal tide: the level moves 1/12 of the
 * range in the first hour after the turn, 2/12 in the second, 3/12 in each of
 * the third and fourth, then 2/12 and 1/12 — the twelve parts of the name. It
 * is an approximation of a sine, not a harmonic analysis, so it is at its worst
 * on a tide with a strong diurnal inequality; the surface says so.
 *
 * **The interval is an input because it is not always six hours.** The rule is
 * written for the six-hour tide, but a real interval runs from five to seven
 * hours, and the parts are applied to the interval the user gives rather than
 * to an hour this file assumes. A fractional hour inside a block is
 * interpolated linearly within that block, which is the convention the rule is
 * used with.
 */
export function ruleOfTwelfths(input: RuleOfTwelfthsInput): ProResult<RuleOfTwelfthsResult> {
  const { rangeM, hoursFromTurn, durationHours } = input;
  if (!isPositive(rangeM) || rangeM > 30) return fail("range");
  if (!isPositive(durationHours) || durationHours > 12) return fail("duration");
  if (!isNonNegative(hoursFromTurn) || hoursFromTurn > durationHours) return fail("hours");

  const hourLength = durationHours / TWELFTHS.length;
  const table: TideHeightRow[] = [];
  let cumulative = 0;
  for (const [index, twelfths] of TWELFTHS.entries()) {
    cumulative += twelfths;
    const fraction = cumulative / 12;
    table.push({
      hour: index + 1,
      twelfths,
      fraction,
      movedM: fraction * rangeM,
    });
  }

  // The block the given time falls in, and how far into it. At exactly the
  // duration the index is past the end, so it is pulled back to the last block
  // and the fraction is 1.
  const rawIndex = hoursFromTurn / hourLength;
  const index = Math.min(TWELFTHS.length - 1, Math.floor(rawIndex));
  const into = Math.min(1, rawIndex - index);
  const block = table[index];
  if (block === undefined) return fail("hours");
  // Zero before the first block rather than its own start: the first hour moves
  // the tide from the turn, so there is no fraction behind it.
  let before = 0;
  if (index > 0) {
    const previous = table[index - 1];
    if (previous === undefined) return fail("hours");
    before = previous.fraction;
  }
  const fraction = before + (block.fraction - before) * into;
  return {
    ok: true,
    fraction,
    movedM: fraction * rangeM,
    heightAboveLowM: rangeM * (1 - fraction),
    hoursUsed: hoursFromTurn,
    row: { hour: index + 1, twelfths: block.twelfths, fraction, movedM: fraction * rangeM },
    table,
  };
}

/* ---------------------------------------------------------------------------
 * vmg — „VMG"
 * ------------------------------------------------------------------------ */

export interface VmgInput {
  readonly boatSpeedKnots: number;
  /** True wind angle: 0 is head to wind, 180 dead downwind, degrees. */
  readonly windAngleDeg: number;
}

export interface VmgResult {
  /** Make-good toward the wind, knots: positive upwind, negative downwind. */
  readonly vmgKnots: number;
  readonly vmgKmh: number;
  /** The same figure as a fraction of boat speed — how much of the speed is progress. */
  readonly vmgFraction: number;
  readonly upwind: boolean;
}

/**
 * Velocity made good against the wind — `VMG = V·cos(θ)`.
 *
 * The true wind angle `θ` is between the boat's heading and the direction the
 * wind comes FROM, and the definition is the component of the boat's velocity
 * along that axis. It is the whole basis of sail trim: pinching up costs speed,
 * bearing away gains it, and the best VMG sits where the loss of `V` has
 * stopped being worth the gain in `cos θ` — a trade between two channels that
 * only the boat's own polars can settle, which is why this tool returns the
 * geometry and never the setting.
 */
export function vmg(input: VmgInput): ProResult<VmgResult> {
  const { boatSpeedKnots, windAngleDeg } = input;
  if (!isPositive(boatSpeedKnots) || boatSpeedKnots > 60) return fail("speed");
  if (!isInRange(windAngleDeg, 0, 180)) return fail("angle");
  const angle = windAngleDeg * RAD_PER_DEG;
  const vmgKnots = boatSpeedKnots * Math.cos(angle);
  return {
    ok: true,
    vmgKnots,
    vmgKmh: knotsToKmh(vmgKnots),
    vmgFraction: Math.cos(angle),
    upwind: windAngleDeg < 90,
  };
}

/* ---------------------------------------------------------------------------
 * course-to-steer — „Kurs sa strujom"
 * ------------------------------------------------------------------------ */

export interface CourseToSteerInput {
  /** The course over the ground wanted, degrees true. */
  readonly trackDeg: number;
  /** Speed through the water, knots. */
  readonly boatSpeedKnots: number;
  /** The direction the current sets TOWARDS, degrees true. */
  readonly currentSetDeg: number;
  readonly currentDriftKnots: number;
}

export interface CourseToSteerResult {
  /** The heading to steer, degrees true. */
  readonly headingDeg: number;
  /** The angle between heading and track — how much the current pushes the bow off. */
  readonly driftAngleDeg: number;
  /** Speed over the ground along the track, knots. */
  readonly groundSpeedKnots: number;
  readonly groundSpeedKmh: number;
}

/**
 * The heading that holds a track through a known current — the vector triangle.
 *
 * The boat's velocity through the water and the current's velocity over the
 * ground add to the velocity over the ground, and the wanted track fixes the
 * direction of that sum. Perpendicular to the track the two must cancel, which
 * is the whole solution: `sin θ = −(c/b)·sin(S − T)` for the heading offset
 * `θ`, and then `V = b·cos θ + c·cos(S − T)` along the track.
 *
 * **A current that no heading can hold is refused rather than answered.** When
 * `(c/b)·sin(S − T)` leaves [−1, 1] the current's cross-track component is
 * larger than the boat's whole speed through the water, so the track cannot be
 * held at all — and the arcsine of a number outside that band is `NaN`, which
 * a surface would print as „—“ without saying that the water is simply too
 * strong. The refusal is by name, and it is the answer.
 *
 * „Set" is where the current flows TOWARDS, the convention a chart's current
 * arrow and a pilot's „set and drift" both use; a user who reads it as „from"
 * gets a mirrored answer, so the field's own label says which it is.
 */
export function courseToSteer(input: CourseToSteerInput): ProResult<CourseToSteerResult> {
  const { trackDeg, boatSpeedKnots, currentSetDeg, currentDriftKnots } = input;
  if (!isInRange(trackDeg, 0, 360)) return fail("track");
  if (!isInRange(currentSetDeg, 0, 360)) return fail("set");
  if (!isPositive(boatSpeedKnots) || boatSpeedKnots > 60) return fail("speed");
  if (!isNonNegative(currentDriftKnots) || currentDriftKnots > 20) return fail("drift");

  const track = trackDeg * RAD_PER_DEG;
  const set = currentSetDeg * RAD_PER_DEG;
  const relative = set - track;
  const ratio = quotient(currentDriftKnots, boatSpeedKnots);
  if (ratio === undefined) return fail("speed");
  const sine = -ratio * Math.sin(relative);
  if (sine < -1 || sine > 1) return fail("current");

  const offset = Math.asin(sine);
  const groundSpeed = boatSpeedKnots * Math.cos(offset) + currentDriftKnots * Math.cos(relative);
  return {
    ok: true,
    headingDeg: foldDegrees(offset * DEG_PER_RAD + trackDeg),
    driftAngleDeg: offset * DEG_PER_RAD,
    groundSpeedKnots: groundSpeed,
    groundSpeedKmh: knotsToKmh(groundSpeed),
  };
}

