/**
 * „Vazduhoplovstvo" — the arithmetic behind the aviation toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a maintainer asks „where does the wind triangle live", and
 * `pro/vazduhoplovstvo.ts` answers it where `pro/navigation.ts` would not.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * I/O, no locale, no formatting: the surface owns its state and asks here for
 * every number it prints.
 *
 * **Nothing here is a flight-planning system, and every tool says so on
 * screen.** The whole pack is `life-safety`: a wrong pressure altitude, a
 * misread wind or a fuel figure without its reserve puts an aircraft somewhere
 * its pilot did not intend. What comes back is a QUANTITY and never a decision
 * — there is no „dozvoljeno", no „bezbedno" and no boolean verdict in this file,
 * for the reason `toolForbidsVerdict` gives. Which figure to fly by belongs to
 * the pilot, who is the one holding the weather, the NOTAMs and the
 * performance tables.
 *
 * **The atmosphere is the ICAO Standard Atmosphere and it is stated rather
 * than hidden** (ICAO Doc 7488, the Manual of the ICAO Standard Atmosphere,
 * third edition 1993). The troposphere is a 6,5 K/km lapse from 15 °C and
 * 1013,25 hPa at mean sea level, and the layer above 11 km (geopotential) is
 * isothermal at 216,65 K. A real day is never the standard day: the surface
 * pressure, the temperature and the wind are the user's own figures, and every
 * tool that leans on the standard atmosphere says so.
 */

import {
  fail,
  isInRange,
  isOneOf,
  isPositive,
  quotient,
  type ProResult,
} from "./result.js";

/* ---------------------------------------------------------------------------
 * the ICAO Standard Atmosphere — the constants, once
 * ------------------------------------------------------------------------ */

/** Mean sea-level temperature, K — ICAO Doc 7488. */
const ISA_SEA_LEVEL_TEMPERATURE_K = 288.15;

/** Mean sea-level pressure, hPa — ICAO Doc 7488. */
const ISA_SEA_LEVEL_PRESSURE_HPA = 1013.25;

/** Mean sea-level density, kg/m³ — ICAO Doc 7488. */
const ISA_SEA_LEVEL_DENSITY = 1.225;

/** Temperature lapse rate in the troposphere, K/m — ICAO Doc 7488. */
const ISA_LAPSE_K_PER_M = 0.0065;

/** Standard gravity, m/s² — fixed by definition (CGPM 1901). */
const G_N = 9.80665;

/**
 * The specific gas constant of dry air, J/(kg·K).
 *
 * It is DERIVED from the two figures the ICAO atmosphere is written in rather
 * than taken from a table: the universal constant 8,31432 J/(mol·K) over the
 * molar mass 0,0289644 kg/mol — Doc 7488's own pair — gives
 * `M = 28,9644 g/mol`, which is Doc 7488's own pair. 8,31432/0,0289644 =
 * 287,052872…, and writing the derivation down is what keeps a later reader
 * from „correcting" it to the CODATA 287,058.
 */
const R_SPECIFIC_DRY_AIR = 8.31432 / 0.0289644;

/** The ratio of specific heats of dry air, dimensionless — ICAO Doc 7488. */
const GAMMA_AIR = 1.4;

/**
 * The troposphere's pressure exponent, `n = g·M/(R*·L)`.
 *
 * Not a fitted constant: with Doc 7488's own figures it is
 * 9,80665 × 0,0289644/(8,31432 × 0,0065) = 5,255876, which is the 5,25588 the
 * standard is quoted with. The density exponent is `n − 1`.
 */
const ISA_PRESSURE_EXPONENT =
  (G_N * 0.0289644) / (8.31432 * ISA_LAPSE_K_PER_M);

/** Top of the troposphere, m geopotential — ICAO Doc 7488. */
const ISA_TROPOPAUSE_M = 11000;

/** Temperature of the isothermal layer above it, K — ICAO Doc 7488. */
const ISA_STRATOSPHERE_TEMPERATURE_K = 216.65;

/** Top of the ISA's isothermal layer, m geopotential (Doc 7488 gives 20 km here). */
const ISA_STRATOSPHERE_TOP_M = 20000;

/** The international foot, m — exact by definition (1959 agreement). */
const FOOT_IN_M = 0.3048;

/** One knot in m/s — one nautical mile (1852 m) per hour. */
const KT_IN_MS = 1852 / 3600;

/**
 * One inch of mercury at 0 °C, Pa.
 *
 * Exact rather than measured: the conventional millimetre of mercury is DEFINED
 * as 133,322387415 Pa (ISO 80000-4, from the conventional density 13 595,1
 * kg/m³ and standard gravity), and an inch is exactly 25,4 mm, so
 * 25,4 × 133,322387415 = 3386,388640341 Pa.
 */
const PASCAL_PER_INHG = 25.4 * 133.322387415;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/** A folded course or bearing in degrees, clockwise from north, in [0, 360). */
function foldDegrees(degrees: number): number {
  const folded = degrees % 360;
  return folded < 0 ? folded + 360 : folded;
}

/** A temperature in kelvin from one in degrees Celsius. */
function kelvin(celsius: number): number {
  return celsius + 273.15;
}

/**
 * Which layer of the standard atmosphere an altitude falls in.
 *
 * A named union rather than a boolean, because the two layers are two different
 * formulae and „isothermal" is the fact the surface has to print: a temperature
 * that stops falling with height is the one thing about the upper layer a
 * reader has to know to trust the rest of the row.
 */
export type IsaLayer = "troposphere" | "isothermal";

export interface IsaAtmosphereInput {
  /** Geopotential altitude above mean sea level, feet. */
  readonly altitudeFt: number;
}

export interface IsaAtmosphereResult {
  readonly altitudeM: number;
  readonly altitudeFt: number;
  readonly layer: IsaLayer;
  readonly temperatureK: number;
  readonly temperatureC: number;
  readonly pressurePa: number;
  readonly pressureHpa: number;
  readonly densityKgM3: number;
  /** The speed of sound, m/s — `a = √(γ·R·T)`. */
  readonly speedOfSoundMs: number;
  readonly speedOfSoundKt: number;
  /** Density and pressure as fractions of their mean sea-level values. */
  readonly densityRatio: number;
  readonly pressureRatio: number;
}

/** The pressure at the tropopause, hPa — computed from the troposphere law once. */
const ISA_TROPOPAUSE_PRESSURE_HPA =
  ISA_SEA_LEVEL_PRESSURE_HPA *
  (ISA_STRATOSPHERE_TEMPERATURE_K / ISA_SEA_LEVEL_TEMPERATURE_K) **
    ISA_PRESSURE_EXPONENT;

/**
 * The ICAO Standard Atmosphere at an altitude.
 *
 * **Doc 7488 in two lines.** Below 11 km geopotential the temperature falls at
 * 6,5 K/km from 288,15 K and the pressure follows `p = p₀·(T/T₀)^5,255876`;
 * above it the temperature holds at 216,65 K and the pressure is the
 * isothermal `p = p₁₁·exp(−g·Δh/(R·T₁₁))`. The density comes out of the ideal
 * gas law in both layers rather than from its own power law, so the two are
 * consistent: `ρ = p/(R·T)` with the same `R`.
 *
 * **Height is GEOPOTENTIAL, which is what the standard is written in.** The
 * difference from geometric height is about 0,3 % at 10 km and matters only to
 * a reader comparing this to a GNSS altitude; the surface says as much instead
 * of the file silently mixing the two.
 *
 * The speed of sound is `a = √(γ·R·T)` and is the reason the temperature is
 * returned in kelvin: it is not a separate measurement, it is that temperature
 * under a different square root.
 */
export function isaAtmosphere(input: IsaAtmosphereInput): ProResult<IsaAtmosphereResult> {
  const { altitudeFt } = input;
  // 65 616 ft is just inside the 20 km top of the isothermal layer, which is as
  // far as this file models: Doc 7488's next layer (20–32 km, +1 K/km) is a
  // different pair of equations and is not needed by anything that flies here.
  if (!isInRange(altitudeFt, -1000, 65616)) return fail("altitude");
  const altitudeM = altitudeFt * FOOT_IN_M;

  let temperatureK: number;
  let pressurePa: number;
  let layer: IsaLayer;
  if (altitudeM <= ISA_TROPOPAUSE_M) {
    layer = "troposphere";
    temperatureK = ISA_SEA_LEVEL_TEMPERATURE_K - ISA_LAPSE_K_PER_M * altitudeM;
    pressurePa =
      ISA_SEA_LEVEL_PRESSURE_HPA *
      100 *
      (temperatureK / ISA_SEA_LEVEL_TEMPERATURE_K) ** ISA_PRESSURE_EXPONENT;
  } else {
    if (altitudeM > ISA_STRATOSPHERE_TOP_M) return fail("altitude");
    layer = "isothermal";
    temperatureK = ISA_STRATOSPHERE_TEMPERATURE_K;
    pressurePa =
      ISA_TROPOPAUSE_PRESSURE_HPA *
      100 *
      Math.exp(
        (-G_N * (altitudeM - ISA_TROPOPAUSE_M)) /
          (R_SPECIFIC_DRY_AIR * ISA_STRATOSPHERE_TEMPERATURE_K),
      );
  }

  const densityKgM3 = pressurePa / (R_SPECIFIC_DRY_AIR * temperatureK);
  const speedOfSoundMs = Math.sqrt(GAMMA_AIR * R_SPECIFIC_DRY_AIR * temperatureK);
  return {
    ok: true,
    altitudeM,
    altitudeFt,
    layer,
    temperatureK,
    temperatureC: temperatureK - 273.15,
    pressurePa,
    pressureHpa: pressurePa / 100,
    densityKgM3,
    speedOfSoundMs,
    speedOfSoundKt: speedOfSoundMs / KT_IN_MS,
    densityRatio: densityKgM3 / ISA_SEA_LEVEL_DENSITY,
    pressureRatio: pressurePa / (ISA_SEA_LEVEL_PRESSURE_HPA * 100),
  };
}

/* ---------------------------------------------------------------------------
 * pressure-altitude — „Visina po pritisku i gustini"
 * ------------------------------------------------------------------------ */

export interface PressureAltitudeInput {
  /** The pressure actually at the aircraft or the field, hPa. */
  readonly pressureHpa: number;
  /** Outside air temperature, °C. */
  readonly temperatureC: number;
}

export interface PressureAltitudeResult {
  readonly pressureAltitudeM: number;
  readonly pressureAltitudeFt: number;
  /** The ISA temperature at that pressure altitude — what the day would be if it were standard. */
  readonly isaTemperatureC: number;
  /** The temperature the day is actually off the standard by, K. */
  readonly isaDeviationK: number;
  readonly densityKgM3: number;
  readonly densityAltitudeM: number;
  readonly densityAltitudeFt: number;
}

/**
 * Pressure altitude and density altitude from the pressure and the temperature.
 *
 * **Both are inverted out of the standard atmosphere, not out of a rule of
 * thumb.** The pressure altitude is the geopotential height at which the
 * standard atmosphere has the pressure typed in: `h = (T₀/L)·(1 − (p/p₀)^(1/n))`.
 * The density altitude is the height at which it has the DENSITY the day
 * actually has, the real density being `ρ = p/(R·T)` with the temperature that
 * was typed. The familiar „120 ft per degree" is an approximation of the second
 * step and is not used here, because the exact inversion is three lines.
 *
 * A pressure altitude of zero is mean sea level in the standard atmosphere and
 * has nothing to do with the QNH a field reports; the surface says so.
 */
export function pressureAltitude(
  input: PressureAltitudeInput,
): ProResult<PressureAltitudeResult> {
  const { pressureHpa, temperatureC } = input;
  if (!isInRange(pressureHpa, 100, 1100)) return fail("pressure");
  if (!isInRange(temperatureC, -80, 60)) return fail("temperature");

  const altitudeM =
    (ISA_SEA_LEVEL_TEMPERATURE_K / ISA_LAPSE_K_PER_M) *
    (1 - (pressureHpa / ISA_SEA_LEVEL_PRESSURE_HPA) ** (1 / ISA_PRESSURE_EXPONENT));
  if (!Number.isFinite(altitudeM)) return fail("pressure");
  const absolute = kelvin(temperatureC);
  const densityKgM3 = (pressureHpa * 100) / (R_SPECIFIC_DRY_AIR * absolute);
  // The density altitude is always in the troposphere's range: the highest
  // density a day can have is a cold high-pressure one, and that is a negative
  // altitude, not an isothermal one.
  const densityAltitudeM =
    (ISA_SEA_LEVEL_TEMPERATURE_K / ISA_LAPSE_K_PER_M) *
    (1 - (densityKgM3 / ISA_SEA_LEVEL_DENSITY) ** (1 / (ISA_PRESSURE_EXPONENT - 1)));
  if (!Number.isFinite(densityAltitudeM)) return fail("temperature");

  return {
    ok: true,
    pressureAltitudeM: altitudeM,
    pressureAltitudeFt: altitudeM / FOOT_IN_M,
    isaTemperatureC: ISA_SEA_LEVEL_TEMPERATURE_K - ISA_LAPSE_K_PER_M * altitudeM - 273.15,
    isaDeviationK: absolute - (ISA_SEA_LEVEL_TEMPERATURE_K - ISA_LAPSE_K_PER_M * altitudeM),
    densityKgM3,
    densityAltitudeM,
    densityAltitudeFt: densityAltitudeM / FOOT_IN_M,
  };
}

/* ---------------------------------------------------------------------------
 * true-airspeed — „Prava brzina iz instrumenta"
 * ------------------------------------------------------------------------ */

export interface TrueAirspeedInput {
  /** Calibrated airspeed, knots — what the instrument reads, corrected for position error. */
  readonly casKt: number;
  /** Pressure altitude, feet. */
  readonly pressureAltitudeFt: number;
  /** Outside air temperature, °C. */
  readonly temperatureC: number;
}

export interface TrueAirspeedResult {
  readonly tasKt: number;
  readonly tasKmh: number;
  readonly tasMs: number;
  /** The density the run used, from the ISA pressure at that altitude and the typed temperature. */
  readonly densityKgM3: number;
  readonly densityRatio: number;
  /** The ISA temperature at that altitude, so the deviation is visible beside it. */
  readonly isaTemperatureC: number;
}

/**
 * True airspeed from calibrated airspeed — `TAS = CAS·√(ρ₀/ρ)`.
 *
 * **This is the low-speed, incompressible relation, and the surface states the
 * approximation.** It treats the air as an ideal fluid whose only effect on the
 * instrument is its density, so it ignores compressibility: at 200 kt and
 * 10 000 ft the error is under two knots, and it grows with speed and altitude
 * until at jet speeds it is a different calculation (the full one goes through
 * the impact-pressure ratio and `a₀`). What the tool buys by being honest about
 * that is exactness in the regime the pack's users fly in, and a printed
 * boundary rather than a silent one.
 *
 * The density is the ideal gas law on the STANDARD pressure at the altitude
 * with the ACTUAL temperature, which is the same substitution the density
 * altitude makes: pressure falls with height in a way the temperature cannot
 * change much, and the temperature is what the day differs by.
 */
export function trueAirspeed(input: TrueAirspeedInput): ProResult<TrueAirspeedResult> {
  const { casKt, pressureAltitudeFt, temperatureC } = input;
  if (!isPositive(casKt) || casKt > 1000) return fail("cas");
  if (!isInRange(pressureAltitudeFt, -1000, 50000)) return fail("altitude");
  if (!isInRange(temperatureC, -80, 60)) return fail("temperature");

  const altitudeM = pressureAltitudeFt * FOOT_IN_M;
  const standard =
    ISA_SEA_LEVEL_TEMPERATURE_K - ISA_LAPSE_K_PER_M * Math.min(altitudeM, ISA_TROPOPAUSE_M);
  const pressurePa =
    altitudeM <= ISA_TROPOPAUSE_M
      ? ISA_SEA_LEVEL_PRESSURE_HPA *
        100 *
        (standard / ISA_SEA_LEVEL_TEMPERATURE_K) ** ISA_PRESSURE_EXPONENT
      : ISA_TROPOPAUSE_PRESSURE_HPA *
        100 *
        Math.exp((-G_N * (altitudeM - ISA_TROPOPAUSE_M)) / (R_SPECIFIC_DRY_AIR * standard));

  const densityKgM3 = pressurePa / (R_SPECIFIC_DRY_AIR * kelvin(temperatureC));
  const densityRatio = densityKgM3 / ISA_SEA_LEVEL_DENSITY;
  if (!isPositive(densityRatio)) return fail("temperature");
  // TAS = CAS·√(ρ₀/ρ): the instrument reads a dynamic pressure and the dynamic
  // pressure of a given CAS is set by the density it happens in.
  const tasKt = casKt * Math.sqrt(1 / densityRatio);
  const tasMs = tasKt * KT_IN_MS;
  return {
    ok: true,
    tasKt,
    tasKmh: tasMs * 3.6,
    tasMs,
    densityKgM3,
    densityRatio,
    isaTemperatureC: standard - 273.15,
  };
}

/* ---------------------------------------------------------------------------
 * wind-triangle — „Trougao vetra"
 * ------------------------------------------------------------------------ */

export interface WindTriangleInput {
  /** The course to be made good, degrees true. */
  readonly courseDeg: number;
  /** True airspeed, knots. */
  readonly tasKt: number;
  /** The direction the wind blows FROM, degrees true. */
  readonly windFromDeg: number;
  readonly windKt: number;
}

export interface WindTriangleResult {
  /** The wind correction angle: positive to the RIGHT of the course, degrees. */
  readonly windCorrectionAngleDeg: number;
  /** Course plus the correction, degrees true. */
  readonly headingDeg: number;
  readonly groundSpeedKt: number;
  readonly groundSpeedKmh: number;
  /** The wind's component ALONG the course: positive is a headwind, knots. */
  readonly headwindKt: number;
  /** The wind's component ACROSS the course: positive is from the right, knots. */
  readonly crosswindKt: number;
}

/**
 * The wind triangle from a course, a TAS and a wind.
 *
 * **The sign convention is the whole tool, so it is written once.**
 * `windFromDeg` is the direction the wind blows FROM — the way a wind is always
 * reported and a METAR always carries — and the air therefore moves TOWARDS
 * `windFromDeg + 180`. With `Δ = windFrom − course`, that air velocity is
 * `−W·cos(Δ)` along the course and `−W·sin(Δ)` across it. Perpendicular to the
 * track the aircraft's velocity and the air's must cancel,
 * `V·sin(WCA) + (−W·sin Δ) = 0`, so `sin(WCA) = (W/V)·sin(Δ)`; along the track
 * `GS = V·cos(WCA) − W·cos(Δ)`.
 *
 * A positive WCA means the wind is from the LEFT and the nose goes right —
 * which is the opposite of what a bare `asin` of a positive number suggests if
 * the reader assumes a „from" wind behaves like a „towards" vector. That is why
 * both the angle and the two components are returned: the components are
 * checkable at a glance, and the angle is not.
 *
 * **A crosswind stronger than the whole airspeed has no solution** and is
 * refused by name rather than answered with `NaN`.
 */
export function windTriangle(input: WindTriangleInput): ProResult<WindTriangleResult> {
  const { courseDeg, tasKt, windFromDeg, windKt } = input;
  if (!isInRange(courseDeg, 0, 360)) return fail("course");
  if (!isInRange(windFromDeg, 0, 360)) return fail("windFrom");
  if (!isPositive(tasKt) || tasKt > 1000) return fail("tas");
  if (!isInRange(windKt, 0, 300)) return fail("wind");

  const delta = (foldDegrees(windFromDeg - courseDeg)) * RAD_PER_DEG;
  const sine = (windKt / tasKt) * Math.sin(delta);
  // A distinct reason from the range refusal above, because the two say
  // different things to the reader: "the wind is not a wind" and "this wind
  // cannot be flown against on this course".
  if (sine < -1 || sine > 1) return fail("noSolution");
  const wca = Math.asin(sine);
  // The two components are the SAME ones `windComponents` returns, by the same
  // two expressions on the same Δ: positive is a headwind, and positive across
  // is from the right. A sign written the other way round here would make the
  // ground speed right and the crosswind backwards, which is the worst of both.
  const headwindKt = windKt * Math.cos(delta);
  const crosswindKt = windKt * Math.sin(delta);
  const groundSpeedKt = tasKt * Math.cos(wca) - headwindKt;
  return {
    ok: true,
    windCorrectionAngleDeg: wca * DEG_PER_RAD,
    headingDeg: foldDegrees(courseDeg + wca * DEG_PER_RAD),
    groundSpeedKt,
    groundSpeedKmh: groundSpeedKt * KT_IN_MS * 3.6,
    headwindKt,
    crosswindKt,
  };
}

/* ---------------------------------------------------------------------------
 * wind-components — „Poprečna i čeona komponenta"
 * ------------------------------------------------------------------------ */

export interface WindComponentsInput {
  /** The direction the wind blows FROM, degrees true. */
  readonly windFromDeg: number;
  readonly windKt: number;
  /** The runway or course the components are wanted for, degrees true. */
  readonly runwayDeg: number;
}

export interface WindComponentsResult {
  /** Angle between the wind's source and the runway, folded to [0, 180]. */
  readonly angleDeg: number;
  /** Positive is a headwind, negative a tailwind, knots. */
  readonly headwindKt: number;
  /** Positive is from the RIGHT, negative from the left, knots. */
  readonly crosswindKt: number;
  /** The same two figures for the reciprocal runway — the runway the other way round. */
  readonly reciprocalHeadwindKt: number;
  readonly reciprocalCrosswindKt: number;
}

/**
 * The wind down the runway: `head = W·cos(Δ)`, `cross = W·sin(Δ)`.
 *
 * This is the wind triangle with the wind correction angle taken out — the same
 * two components the triangle computes and prints, but for a runway rather than
 * for a course to be made good, which is why the reciprocal runway's figures
 * are returned beside them: the take-off run and the landing run are opposite
 * directions on the same strip, and a tailwind on one is a headwind on the
 * other with the sign of both numbers flipped.
 *
 * **No runway is recommended and nothing is compared to a limit.** A maximum
 * demonstrated crosswind is a figure in one aircraft's flight manual, and which
 * limit applies is the pilot's judgement; the components are what this file
 * knows.
 */
export function windComponents(input: WindComponentsInput): ProResult<WindComponentsResult> {
  const { windFromDeg, windKt, runwayDeg } = input;
  if (!isInRange(windFromDeg, 0, 360)) return fail("windFrom");
  if (!isInRange(runwayDeg, 0, 360)) return fail("runway");
  if (!isInRange(windKt, 0, 300)) return fail("wind");
  const delta = foldDegrees(windFromDeg - runwayDeg) * RAD_PER_DEG;
  const headwindKt = windKt * Math.cos(delta);
  const crosswindKt = windKt * Math.sin(delta);
  return {
    ok: true,
    angleDeg: Math.acos(Math.cos(delta)) * DEG_PER_RAD,
    headwindKt,
    crosswindKt,
    reciprocalHeadwindKt: -headwindKt,
    reciprocalCrosswindKt: -crosswindKt,
  };
}

/* ---------------------------------------------------------------------------
 * fuel-reserve — „Gorivo i rezerva"
 * ------------------------------------------------------------------------ */

export interface FuelReserveInput {
  /** Fuel on board, litres. */
  readonly fuelLitres: number;
  readonly burnLitresPerHour: number;
  /** True airspeed or the planned ground speed, knots — the speed the range is quoted at. */
  readonly speedKt: number;
  /**
   * The reserve held back, MINUTES at the burn rate.
   *
   * Minutes rather than a percentage, because that is how a flight's reserve is
   * actually stated — a final reserve is a time at a burn, not a share of the
   * tank — and because the number belongs to the operation the user is flying,
   * not to this file. No default: a reserve is never guessed.
   */
  readonly reserveMinutes: number;
}

export interface FuelReserveResult {
  readonly reserveLitres: number;
  /** Fuel on board minus the reserve — what is actually available. */
  readonly burnableLitres: number;
  readonly enduranceHours: number;
  readonly enduranceMinutes: number;
  /** Still air: speed times endurance, nautical miles. */
  readonly rangeNm: number;
  readonly rangeKm: number;
  /** Endurance and range on the WHOLE fuel load, so the cost of the reserve is visible. */
  readonly hoursWithoutReserve: number;
  readonly rangeWithoutReserveNm: number;
}

/**
 * Endurance and range from a fuel load, a burn and a time-based reserve.
 *
 * `t = V/P` and `s = v·t`, with the reserve taken off the top:
 * `t = (F − P·r/60)/P`. The model is a constant burn at a constant speed —
 * a climb burns more than a cruise and a descent less, so this is the cruise
 * leg's endurance rather than a flight's fuel plan, which is why the surface
 * prints the formula line and the tool carries the pack's „not for flight
 * planning" notice rather than a totalizer.
 */
export function fuelReserve(input: FuelReserveInput): ProResult<FuelReserveResult> {
  const { fuelLitres, burnLitresPerHour, speedKt, reserveMinutes } = input;
  if (!isPositive(fuelLitres) || fuelLitres > 1e6) return fail("fuel");
  if (!isPositive(burnLitresPerHour) || burnLitresPerHour > 1e5) return fail("burn");
  if (!isPositive(speedKt) || speedKt > 1000) return fail("speed");
  if (!isInRange(reserveMinutes, 0, 600)) return fail("reserve");

  const reserveLitres = (burnLitresPerHour * reserveMinutes) / 60;
  const burnableLitres = fuelLitres - reserveLitres;
  if (burnableLitres <= 0) return fail("reserve");
  const enduranceHours = quotient(burnableLitres, burnLitresPerHour);
  if (enduranceHours === undefined) return fail("burn");
  const hoursWithoutReserve = quotient(fuelLitres, burnLitresPerHour);
  if (hoursWithoutReserve === undefined) return fail("burn");
  return {
    ok: true,
    reserveLitres,
    burnableLitres,
    enduranceHours,
    enduranceMinutes: enduranceHours * 60,
    rangeNm: speedKt * enduranceHours,
    rangeKm: speedKt * enduranceHours * 1.852,
    hoursWithoutReserve,
    rangeWithoutReserveNm: speedKt * hoursWithoutReserve,
  };
}

/* ---------------------------------------------------------------------------
 * altimeter-units — „Pritisak u jedinicama visinomera"
 * ------------------------------------------------------------------------ */

/** The three units an altimeter setting is written in. `mb` and `hpa` are the same size. */
export const ALTIMETER_UNITS = ["inhg", "hpa", "mb"] as const;

export type AltimeterUnit = (typeof ALTIMETER_UNITS)[number];

export interface AltimeterUnitsInput {
  readonly value: number;
  readonly unit: AltimeterUnit;
}

export interface AltimeterUnitsResult {
  readonly inHg: number;
  readonly hpa: number;
  readonly mb: number;
  readonly pa: number;
  readonly unit: AltimeterUnit;
}

/**
 * An altimeter setting in inches of mercury, hectopascals and millibars.
 *
 * One exact constant does all of it: 1 inHg = 3386,388640341 Pa (the
 * conventional millimetre of mercury, ISO 80000-4, times exactly 25,4). hPa and
 * mb are the same unit under two names — a millibar IS a hectopascal — and both
 * are offered because both are printed on real instruments, which is not a
 * reason to pretend they differ.
 *
 * The conversion is not a hint that the two settings are interchangeable: 29,92
 * inHg and 1013,25 hPa are the same pressure, and a QNH rounded to the nearest
 * whole hPa is a different one by up to 27 ft of altitude.
 */
export function altimeterUnits(input: AltimeterUnitsInput): ProResult<AltimeterUnitsResult> {
  const { value, unit } = input;
  if (!isOneOf(unit, ALTIMETER_UNITS)) return fail("unit");
  const limit = unit === "inhg" ? 60 : 2000;
  if (!isPositive(value) || value > limit) return fail("value");
  const pascal = unit === "inhg" ? value * PASCAL_PER_INHG : value * 100;
  return {
    ok: true,
    inHg: pascal / PASCAL_PER_INHG,
    hpa: pascal / 100,
    mb: pascal / 100,
    pa: pascal,
    unit,
  };
}
