/**
 * „Inženjering i elektrotehnika" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category.** The rail groups by category and the
 * profile filters by pack, but neither of those is a file layout: what a
 * maintainer asks is „where does the cable calculator live", and
 * `pro/inzenjering.ts` answers it where `pro/electrical.ts` would not. A tool
 * several packs share lives in the file of its FIRST pack in `TOOL_PACKS` order.
 *
 * **These are pure functions and they refuse rather than repair.** No dates, no
 * randomness, no I/O, no locale, no formatting: a surface owns its own state and
 * asks here for every number it prints. That is why the test vectors are ones a
 * person can check by hand rather than snapshots of whatever the code produced.
 *
 * **Nothing here decides anything.** Most of this pack is `life-safety`: a
 * conductor size, a fastener, a pressure vessel and a belt guard are all things
 * that hurt somebody when a program guesses. So a tool computes a QUANTITY and
 * stops. Where a rule has a limit — a permitted voltage drop, an allowable
 * stress, a property class — the limit is an INPUT with no default, and what
 * comes back is the pair of numbers and their ratio, never a word about what the
 * pair means. There is no `passes`, no `safe`, no severity and no status in this
 * file, and adding one would be a defect rather than a convenience.
 *
 * **Units are SI at the boundary, converted only for display.** Where a tool is
 * itself a converter (pressure, torque) the conversion factors are the defining
 * products — `0.45359237 * 9.80665 * 0.3048` rather than a transcribed decimal —
 * so a typo in a constant cannot survive being read.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isNonNegative,
  isPositive,
  quotient,
  ratioAgainst,
  type ProResult,
} from "./result.js";

const DEG_PER_RAD = 180 / Math.PI;

/**
 * Finite, above zero, and not past a ceiling — the (0, max] band almost every
 * input in this file lives in. Private on purpose: it is one composition of two
 * shared guards, not a seventh guard the rest of the app needs.
 */
const isPositiveUpTo = (value: number, max: number): boolean => isPositive(value) && value <= max;

/** Standard gravity, m/s^2 — fixed by definition (CGPM 1901), not measured. */
const G_N = 9.80665;

/** The international pound, kg — exact by definition (1959 agreement). */
const POUND_IN_KG = 0.45359237;

/** The international inch, m — exact by definition. */
const INCH_IN_M = 0.0254;

/** The international foot, m — exact by definition. */
const FOOT_IN_M = 0.3048;

/**
 * Resistivity at 20 degC in ohm*mm2/m, and the linear temperature coefficient
 * per kelvin referred to the same 20 degC.
 *
 * Copper: IEC 60028:1925 fixes the international annealed copper standard at
 * exactly 1/58 ohm*mm2/m, which is why it is written as a division and not as
 * 0.01724 — the standard is the fraction. Aluminium: IEC 60889:1987, hard-drawn
 * aluminium at 28.264 nohm*m, which is 0.028264 ohm*mm2/m.
 */
const RHO20_COPPER = 1 / 58;
const RHO20_ALUMINIUM = 0.028264;
const ALPHA20_COPPER = 0.00393;
const ALPHA20_ALUMINIUM = 0.00403;

/** Which metal the conductor is, which is the only thing resistivity needs. */
export type ConductorMaterial = "copper" | "aluminium";

const resistivityAt20 = (material: ConductorMaterial): number =>
  material === "aluminium" ? RHO20_ALUMINIUM : RHO20_COPPER;

const temperatureCoefficient = (material: ConductorMaterial): number =>
  material === "aluminium" ? ALPHA20_ALUMINIUM : ALPHA20_COPPER;

/** One phase or three — the factor that separates every formula in this file. */
export type PhaseSystem = "single" | "three";

const SQRT3 = Math.sqrt(3);

/** The line-to-phase factor: sqrt(3) for a balanced three-phase system, 1 otherwise. */
const phaseFactor = (system: PhaseSystem): number => (system === "three" ? SQRT3 : 1);

/* ========================================================================== *
 * AWG i mm2 — the gauge is a formula, not a table
 * ========================================================================== */

/**
 * AWG #36 is exactly 0.005 in, and the inch is exactly 25.4 mm, so this is
 * 0.127 mm by two definitions with no measurement in it.
 */
const AWG_36_DIAMETER_MM = 0.005 * 25.4;

/**
 * ASTM B258-18: the gauge is the geometric series between #36 (0.005 in) and
 * #0000 (0.4600 in), 39 steps apart, so the step ratio is 92^(1/39). The
 * published diameter tables are this law rounded, not the other way round —
 * which is why this file evaluates the law and never carries a table.
 */
const AWG_SPAN = 92;
const LN_AWG_SPAN = Math.log(AWG_SPAN);

/** The negative indices are the zeroes: 0 is 0, 00 is -1, 000 is -2, 0000 is -3. */
const AWG_MIN = -3;
const AWG_MAX = 40;

const awgDiameterMm = (gauge: number): number =>
  AWG_36_DIAMETER_MM * Math.exp(((36 - gauge) / 39) * LN_AWG_SPAN);

const circleAreaMm2 = (diameterMm: number): number => (Math.PI * diameterMm * diameterMm) / 4;

export interface AwgGaugeInput {
  /** AWG designation. 00, 000 and 0000 are entered as -1, -2 and -3. */
  readonly gauge: number;
  /** Only the ohm/km row depends on it; copper when the caller says nothing. */
  readonly material?: ConductorMaterial | undefined;
}

export interface AwgGauge {
  readonly diameterMm: number;
  readonly diameterInch: number;
  readonly areaMm2: number;
  /**
   * Resistance of the SOLID conductor of exactly this geometry at 20 degC. It is
   * not a catalogue figure for a stranded cable, which is longer per metre of
   * run and therefore always a little higher.
   */
  readonly resistanceOhmPerKm: number;
}

/**
 * The diameter, area and DC resistance a gauge number denotes.
 *
 * **This evaluates the defining law, so it will disagree in the fourth decimal
 * with a printed table** — the table is this formula rounded to the number of
 * places its publisher chose, and rounding it twice is how two tables come to
 * disagree with each other. The gauge is a designation and nothing more: the
 * function converts it to a dimension and never suggests a cable, never rounds
 * to a series of nominal areas and never says what a conductor is fit for.
 */
export function awgToMetric(input: AwgGaugeInput): ProResult<AwgGauge> {
  if (!isIntegerIn(input.gauge, AWG_MIN, AWG_MAX)) return fail("gauge");
  const material = input.material ?? "copper";
  const diameterMm = awgDiameterMm(input.gauge);
  const areaMm2 = circleAreaMm2(diameterMm);
  return {
    ok: true,
    diameterMm,
    diameterInch: diameterMm / 25.4,
    areaMm2,
    // rho is ohm*mm2/m, so 1000 m of it over an area in mm2 is ohm/km.
    resistanceOhmPerKm: (resistivityAt20(material) * 1000) / areaMm2,
  };
}

export interface MetricToAwgInput {
  /** Give exactly one of the two; the area is turned into a diameter first. */
  readonly diameterMm?: number | undefined;
  readonly areaMm2?: number | undefined;
  readonly material?: ConductorMaterial | undefined;
}

/**
 * The whole AWG size beside the fractional answer, and what it measures.
 *
 * One field rather than three, because a gauge number outside the series has no
 * diameter and therefore no area: the three used to be separate optionals, so a
 * surface that guarded on the gauge alone still had to write `?? 0` under the
 * other two — a fallback that could not fire and would have printed „0 mm" as a
 * conductor dimension if it ever had.
 */
export interface NearestAwg {
  readonly gauge: number;
  readonly diameterMm: number;
  readonly areaMm2: number;
}

export interface MetricToAwg {
  readonly diameterMm: number;
  readonly areaMm2: number;
  /** The exact inverse of the defining law — deliberately fractional. */
  readonly gauge: number;
  /** Absent when the rounded gauge falls outside the defined #40..#0000 series. */
  readonly nearest: NearestAwg | undefined;
  readonly resistanceOhmPerKm: number;
}

/**
 * The gauge number a measured conductor corresponds to.
 *
 * **The fractional gauge is the answer, and the nearest whole one is shown
 * beside it so the size of the gap is visible.** A metric conductor is almost
 * never an AWG size: 6 mm2 is AWG 9.43, and reporting „AWG 9" alone would hide
 * that the nearest American size is 10 % larger in area. When the rounded gauge
 * falls outside the defined series the neighbour fields are simply absent —
 * extrapolating the table past #0000 would be inventing a designation.
 */
export function metricToAwg(input: MetricToAwgInput): ProResult<MetricToAwg> {
  const { diameterMm, areaMm2 } = input;
  if ((diameterMm === undefined) === (areaMm2 === undefined)) return fail("known");

  let diameter: number;
  if (diameterMm !== undefined) {
    if (!isPositiveUpTo(diameterMm, 20)) return fail("diameter");
    diameter = diameterMm;
  } else {
    if (areaMm2 === undefined || !isPositiveUpTo(areaMm2, 300)) return fail("area");
    // An area is turned into the diameter first, because the gauge law is a law
    // about diameters and squaring it back would lose a digit for nothing.
    diameter = Math.sqrt((4 * areaMm2) / Math.PI);
  }

  const material = input.material ?? "copper";
  const area = circleAreaMm2(diameter);
  const gauge = 36 - (39 * Math.log(diameter / AWG_36_DIAMETER_MM)) / LN_AWG_SPAN;
  const rounded = Math.round(gauge);
  const inSeries = rounded >= AWG_MIN && rounded <= AWG_MAX;
  const nearestDiameter = inSeries ? awgDiameterMm(rounded) : undefined;
  return {
    ok: true,
    diameterMm: diameter,
    areaMm2: area,
    gauge,
    nearest:
      nearestDiameter === undefined
        ? undefined
        : {
            gauge: rounded,
            diameterMm: nearestDiameter,
            areaMm2: circleAreaMm2(nearestDiameter),
          },
    resistanceOhmPerKm: (resistivityAt20(material) * 1000) / area,
  };
}

/* ========================================================================== *
 * Baterija i autonomija
 * ========================================================================== */

/** What the pack is feeding: a constant power, or a constant current at its terminals. */
export type BatteryLoad =
  | { readonly kind: "power"; readonly watts: number }
  | { readonly kind: "current"; readonly amps: number };

export interface BatteryBankInput {
  /** Capacity of ONE cell or battery, Ah — the pack is built from it below. */
  readonly cellCapacityAh: number;
  /** Nominal voltage of ONE cell or battery, V. */
  readonly cellVoltage: number;
  readonly series?: number | undefined;
  readonly parallel?: number | undefined;
  /**
   * Permitted depth of discharge, %. No default: it is a fact about the
   * chemistry and the warranty, and guessing it is guessing how long the pack
   * lives.
   */
  readonly depthOfDischargePct: number;
  readonly load: BatteryLoad;
  /** Converter efficiency, %. 100 is neutral, not an assumption that there is none. */
  readonly converterEfficiencyPct?: number | undefined;
  /** Peukert exponent, 1..2. 1 means no correction, which is neutral. */
  readonly peukertExponent?: number | undefined;
  /** The discharge regime the capacity is rated at, h. Required once k > 1. */
  readonly ratedDischargeHours?: number | undefined;
}

export interface BatteryBankRuntime {
  readonly packVoltage: number;
  readonly packCapacityAh: number;
  readonly energyWh: number;
  /** Energy on the LOAD side of the converter: capacity times DoD times efficiency. */
  readonly usableEnergyWh: number;
  /** Current drawn from the pack terminals — larger than P/U by the converter loss. */
  readonly packCurrentA: number;
  /** The answer: Peukert-corrected when k > 1, otherwise the linear time. */
  readonly hours: number;
  /** The same run without the Peukert correction, so the size of it is visible. */
  readonly hoursWithoutPeukert: number;
  /** Peukert's full-discharge time before the DoD is applied. Absent when k = 1. */
  readonly peukertFullHours?: number | undefined;
  /** `hours` split for display; 59.6 minutes rolls up into the next whole hour. */
  readonly wholeHours: number;
  readonly minutes: number;
  /**
   * The three optional inputs as this run RESOLVED them — see
   * `ShelfSpacingResult.rasterUsed` for why they are returned rather than left
   * for the screen to restate. This tool had all three restated at once, two of
   * them in string clothing (`series.trim() === "" ? "1"`), which is the same
   * defect wearing something the `??` grep does not match.
   */
  readonly seriesUsed: number;
  readonly parallelUsed: number;
  readonly efficiencyPctUsed: number;
}

const splitHours = (hours: number): { readonly wholeHours: number; readonly minutes: number } => {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 60 ? { wholeHours: whole + 1, minutes: 0 } : { wholeHours: whole, minutes };
};

/**
 * How long a battery bank runs a load, and the four numbers that get there.
 *
 * **The efficiency belongs to the power path and not to the current path.** A
 * load entered in watts sits behind the converter, so its loss comes out of the
 * battery and the pack current is `P/(U*eta)`, larger than `P/U`. A load entered
 * in amps is already measured at the terminals, so the converter is not in the
 * picture and the run time is `Ah*DoD/I` with no efficiency in it. Feeding the
 * same physical load in both forms and getting different answers is not a bug in
 * that case; it is two different measurement points.
 *
 * **Peukert is applied to the full discharge and the DoD scales the result
 * linearly**, which is an approximation — the true partial-discharge time under
 * Peukert is not proportional to depth — and the surface says so. The model is a
 * constant load at the rated temperature, with no ageing and no voltage sag.
 *
 * **Peukert's law is defined for a constant-CURRENT discharge.** A power load
 * with `k > 1` is outside the law strictly speaking; this function treats it as
 * the equivalent constant current `packCurrentA` and applies the same formula,
 * which is the „label the result as the constant-current equivalent" reading
 * rather than a silent extension of the law to a load it was not derived for.
 */
export function batteryBankRuntime(input: BatteryBankInput): ProResult<BatteryBankRuntime> {
  const { cellCapacityAh, cellVoltage, depthOfDischargePct, load } = input;
  if (!isPositiveUpTo(cellCapacityAh, 100000)) return fail("capacity");
  if (!isPositiveUpTo(cellVoltage, 1000)) return fail("voltage");
  const series = input.series ?? 1;
  const parallel = input.parallel ?? 1;
  if (!isIntegerIn(series, 1, 1000)) return fail("series");
  if (!isIntegerIn(parallel, 1, 1000)) return fail("parallel");
  if (!isPositiveUpTo(depthOfDischargePct, 100)) return fail("depthOfDischarge");
  const efficiencyPct = input.converterEfficiencyPct ?? 100;
  if (!isPositiveUpTo(efficiencyPct, 100)) return fail("efficiency");
  const peukert = input.peukertExponent ?? 1;
  if (!isInRange(peukert, 1, 2)) return fail("peukert");

  const packVoltage = series * cellVoltage;
  const packCapacityAh = parallel * cellCapacityAh;
  const energyWh = packVoltage * packCapacityAh;
  const depth = depthOfDischargePct / 100;
  const efficiency = efficiencyPct / 100;
  const usableEnergyWh = energyWh * depth * efficiency;

  let packCurrentA: number;
  let hoursWithoutPeukert: number;
  if (load.kind === "power") {
    if (!isPositiveUpTo(load.watts, 1e9)) return fail("load");
    packCurrentA = load.watts / (packVoltage * efficiency);
    hoursWithoutPeukert = usableEnergyWh / load.watts;
  } else {
    if (!isPositiveUpTo(load.amps, 1e6)) return fail("load");
    packCurrentA = load.amps;
    hoursWithoutPeukert = (packCapacityAh * depth) / load.amps;
  }
  if (!isPositive(packCurrentA)) return fail("load");

  if (peukert === 1) {
    return {
      ok: true,
      packVoltage,
      packCapacityAh,
      energyWh,
      usableEnergyWh,
      packCurrentA,
      hours: hoursWithoutPeukert,
      hoursWithoutPeukert,
      peukertFullHours: undefined,
      seriesUsed: series,
      parallelUsed: parallel,
      efficiencyPctUsed: efficiencyPct,
      ...splitHours(hoursWithoutPeukert),
    };
  }

  const ratedHours = input.ratedDischargeHours;
  if (ratedHours === undefined || !isPositiveUpTo(ratedHours, 100)) {
    return fail("ratedHours");
  }
  // Written as H*(C/(H*I))^k rather than (C/I)^k/C^(k-1) so that at the rated
  // current C/H it returns exactly H — the identity the exponent is fitted to.
  const rateRatio = packCapacityAh / (ratedHours * packCurrentA);
  const peukertFullHours = ratedHours * Math.pow(rateRatio, peukert);
  const hours = peukertFullHours * depth;
  return {
    ok: true,
    packVoltage,
    packCapacityAh,
    energyWh,
    usableEnergyWh,
    packCurrentA,
    hours,
    hoursWithoutPeukert,
    peukertFullHours,
    seriesUsed: series,
    parallelUsed: parallel,
    efficiencyPctUsed: efficiencyPct,
    ...splitHours(hours),
  };
}

/* ========================================================================== *
 * Prenos i kaiš
 * ========================================================================== */

export interface BeltDriveInput {
  /**
   * Driving (motor-side) pulley PITCH diameter, mm — not the outer diameter a
   * caliper reads on a V-belt pulley.
   */
  readonly drivingDiameterMm: number;
  /** Driven pulley pitch diameter, mm — same convention as the driving one. */
  readonly drivenDiameterMm: number;
  /** Driving speed, min^-1. Zero is allowed and gives a stationary drive. */
  readonly drivingSpeedRpm: number;
  /** Centre distance, mm. */
  readonly centreDistanceMm: number;
  readonly drivingTorqueNm?: number | undefined;
  /** Transmission efficiency, %. 100 is the neutral value. */
  readonly efficiencyPct?: number | undefined;
}

export interface BeltDrive {
  readonly ratio: number;
  readonly drivenSpeedRpm: number;
  readonly beltSpeedMs: number;
  /** Exact open-belt length, mm — not the two-term approximation. */
  readonly beltLengthMm: number;
  readonly wrapSmallDeg: number;
  readonly wrapLargeDeg: number;
  readonly drivenTorqueNm?: number | undefined;
}

/**
 * An open belt between two pulleys: ratio, speeds, exact length and wrap angles.
 *
 * **The length is the closed form, not the textbook approximation.** The usual
 * `2C + pi(D+d)/2 + (D-d)^2/(4C)` is a series truncation that drifts as the
 * pulleys become unequal, and a belt is bought to a fixed length — so the error
 * is spent on the tensioner. Here the straight run is the tangent length
 * `sqrt(4C^2 - (D-d)^2)` and each pulley contributes its true arc.
 *
 * The two wrap angles sum to exactly 360 degrees by construction, which is the
 * implementation's own check on the sign of gamma. Nothing here selects a belt,
 * a profile, a number of belts or a tension: these are geometry and kinematics.
 */
export function beltDrive(input: BeltDriveInput): ProResult<BeltDrive> {
  const { drivingDiameterMm, drivenDiameterMm, drivingSpeedRpm, centreDistanceMm } = input;
  if (!isPositiveUpTo(drivingDiameterMm, 10000)) return fail("drivingDiameter");
  if (!isPositiveUpTo(drivenDiameterMm, 10000)) return fail("drivenDiameter");
  if (!isInRange(drivingSpeedRpm, 0, 1e6)) return fail("speed");
  if (!isPositiveUpTo(centreDistanceMm, 100000)) return fail("centreDistance");
  const efficiencyPct = input.efficiencyPct ?? 100;
  if (!isPositiveUpTo(efficiencyPct, 100)) return fail("efficiency");

  const large = Math.max(drivingDiameterMm, drivenDiameterMm);
  const small = Math.min(drivingDiameterMm, drivenDiameterMm);
  const gap = large - small;
  // 2C <= D - d means the small pulley lies inside the large one: there is no
  // pair of tangents, and arcsin would be asked for a value above 1.
  if (2 * centreDistanceMm <= gap) return fail("centreDistance");

  const gamma = Math.asin(gap / (2 * centreDistanceMm));
  const straight = Math.sqrt(4 * centreDistanceMm * centreDistanceMm - gap * gap);
  const wrapLarge = Math.PI + 2 * gamma;
  const wrapSmall = Math.PI - 2 * gamma;
  const ratio = drivenDiameterMm / drivingDiameterMm;
  const torque = input.drivingTorqueNm;
  if (torque !== undefined && !isInRange(torque, 0, 1e9)) return fail("torque");
  return {
    ok: true,
    ratio,
    drivenSpeedRpm: drivingSpeedRpm / ratio,
    // 60000 is 60 s times 1000 mm/m, both exact; the belt speed is the same on
    // both pulleys, so it is taken at the driving one.
    beltSpeedMs: (Math.PI * drivingDiameterMm * drivingSpeedRpm) / 60000,
    beltLengthMm: straight + (large / 2) * wrapLarge + (small / 2) * wrapSmall,
    wrapSmallDeg: wrapSmall * DEG_PER_RAD,
    wrapLargeDeg: wrapLarge * DEG_PER_RAD,
    drivenTorqueNm: torque === undefined ? undefined : (torque * ratio * efficiencyPct) / 100,
  };
}

export interface GearPairInput {
  readonly drivingTeeth: number;
  readonly drivenTeeth: number;
  readonly drivingSpeedRpm: number;
  /** Module, mm. Without it the pitch diameters and centre distance are absent. */
  readonly moduleMm?: number | undefined;
  readonly drivingTorqueNm?: number | undefined;
  readonly efficiencyPct?: number | undefined;
}

export interface GearPair {
  readonly ratio: number;
  readonly drivenSpeedRpm: number;
  readonly drivingPitchDiameterMm?: number | undefined;
  readonly drivenPitchDiameterMm?: number | undefined;
  /** Centre distance of a STANDARD pair, mm — no profile shift, no backlash allowance. */
  readonly centreDistanceMm?: number | undefined;
  readonly drivenTorqueNm?: number | undefined;
}

/**
 * A spur-gear pair from its tooth counts, and its geometry once a module is given.
 *
 * `a = m*(z1 + z2)/2` is the centre distance of a standard EXTERNAL pair with no
 * profile shift — the one case the sum-of-teeth formula is correct for. An
 * internal pair (ring and pinion) uses `m*(z2 - z1)/2` instead, and a shifted
 * profile makes this formula simply wrong rather than approximate; the surface
 * has to say which of the three it is showing, because the number alone cannot.
 * A shifted pair sits at a distance this function has no way to know. The tool
 * sizes nothing and rates nothing.
 */
export function gearPair(input: GearPairInput): ProResult<GearPair> {
  const { drivingTeeth, drivenTeeth, drivingSpeedRpm } = input;
  if (!isIntegerIn(drivingTeeth, 1, 10000)) return fail("drivingTeeth");
  if (!isIntegerIn(drivenTeeth, 1, 10000)) return fail("drivenTeeth");
  if (!isInRange(drivingSpeedRpm, 0, 1e6)) return fail("speed");
  const efficiencyPct = input.efficiencyPct ?? 100;
  if (!isPositiveUpTo(efficiencyPct, 100)) return fail("efficiency");
  const moduleMm = input.moduleMm;
  if (moduleMm !== undefined && !isPositiveUpTo(moduleMm, 100)) return fail("module");
  const torque = input.drivingTorqueNm;
  if (torque !== undefined && !isInRange(torque, 0, 1e9)) return fail("torque");

  const ratio = drivenTeeth / drivingTeeth;
  return {
    ok: true,
    ratio,
    drivenSpeedRpm: drivingSpeedRpm / ratio,
    drivingPitchDiameterMm: moduleMm === undefined ? undefined : moduleMm * drivingTeeth,
    drivenPitchDiameterMm: moduleMm === undefined ? undefined : moduleMm * drivenTeeth,
    centreDistanceMm:
      moduleMm === undefined ? undefined : (moduleMm * (drivingTeeth + drivenTeeth)) / 2,
    drivenTorqueNm: torque === undefined ? undefined : (torque * ratio * efficiencyPct) / 100,
  };
}

/* ========================================================================== *
 * Potreban presek
 * ========================================================================== */

/** DC and single-phase both send the current out and back; three-phase does not. */
export type SupplySystem = "dc" | "single" | "three";

const loopFactor = (system: SupplySystem): number => (system === "three" ? SQRT3 : 2);

export interface CableCrossSectionInput {
  readonly system: SupplySystem;
  readonly material: ConductorMaterial;
  /** One-way route length, m — the factor for the return path is applied here. */
  readonly lengthM: number;
  readonly currentA: number;
  readonly voltageV: number;
  /**
   * Permitted voltage drop, %. `regulated`: whoever writes the installation
   * rules where the work is done sets this number and can revise it, so it is an
   * input with NO default and the surface states that the figure is the user's.
   */
  readonly permittedDropPct: number;
  /** Conductor temperature, degC. 20 is the reference the resistivities are given at. */
  readonly conductorTempC?: number | undefined;
  /** A section the user picked themselves, mm2 — for the drop read-out only. */
  readonly chosenAreaMm2?: number | undefined;
}

export interface CableCrossSection {
  /** Resistivity used, ohm*mm2/m, after the linear temperature correction. */
  readonly resistivity: number;
  /** 2 for DC/single-phase (out and back), sqrt(3) for balanced three-phase. */
  readonly loopFactor: number;
  readonly maxDropV: number;
  /**
   * The area at which the drop equals the entered limit, mm2. A quantity of
   * conducting material — not a product, not a nominal size, not a recommendation.
   */
  readonly minimumAreaMm2: number;
  readonly dropAtChosenV?: number | undefined;
  readonly dropAtChosenPct?: number | undefined;
  /** Drop at the chosen section over the user's own limit. Undefined without one. */
  readonly dropRatio?: number | undefined;
  /**
   * The conductor temperature this run corrected the resistivity to — see
   * `ShelfSpacingResult.rasterUsed`. It is the assumption the whole answer
   * rests on, so the screen must echo the one the arithmetic used rather than
   * its own copy of the same 20.
   */
  readonly conductorTempCUsed: number;
}

/**
 * How much copper or aluminium a route needs to stay inside the user's own
 * voltage-drop limit, and the drop a chosen section actually produces.
 *
 * **The answer is an area, and it is deliberately not rounded to any series.**
 * Rounding 1.999 mm2 up to 2.5 would be this app choosing a cable, and the
 * choice depends on current-carrying capacity, installation method, grouping,
 * protective device and short-circuit withstand — none of which this function
 * sees. The ratio against the entered limit is a ratio of two numbers and
 * carries no styling and no verdict: 1.04 is a fact, „fails" would be a claim
 * about which rule applies to an installation this app has never seen.
 *
 * **The model is purely resistive — X = 0, cos phi = 1 — and that is a
 * one-directional error.** At larger sections the inductive reactance becomes
 * comparable with the resistance, the real drop is LARGER than this one, and
 * `minimumAreaMm2` therefore comes out too small; `resistivity` and
 * `loopFactor` are both returned so the figure can be checked by hand and so
 * which branch (single-phase 2, or three-phase sqrt(3)) was used is visible.
 * `conductorTempC` is the temperature of the CONDUCTOR under load, not of the
 * ambient air; its default of 20 degC is the reference point the resistivity
 * tables are defined at and therefore yields the smallest possible answer — at
 * 70 degC, `rho_Cu` is already 1 + 0.00393*50 = 1.1965 times larger and
 * `minimumAreaMm2` grows by the same factor. Above a conductor's ordinary
 * working temperature the linear model is an extrapolation, which is why the
 * domain guard below is written to state that rather than to ever fire inside
 * the input range.
 */
export function cableCrossSection(input: CableCrossSectionInput): ProResult<CableCrossSection> {
  const { lengthM, currentA, voltageV, permittedDropPct } = input;
  if (!isPositiveUpTo(lengthM, 100000)) return fail("length");
  if (!isPositiveUpTo(currentA, 100000)) return fail("current");
  if (!isPositiveUpTo(voltageV, 1e6)) return fail("voltage");
  if (!isPositiveUpTo(permittedDropPct, 100)) return fail("permittedDrop");
  const tempC = input.conductorTempC ?? 20;
  if (!isInRange(tempC, -60, 250)) return fail("temperature");

  const alpha = temperatureCoefficient(input.material);
  // Below 20 - 1/alpha the linear model returns a non-positive resistivity, which
  // is the model leaving its domain rather than a cold conductor conducting
  // perfectly. Unreachable inside the input range, and kept so it stays that way.
  if (tempC <= 20 - 1 / alpha) return fail("temperature");
  const resistivity = resistivityAt20(input.material) * (1 + alpha * (tempC - 20));

  const k = loopFactor(input.system);
  const maxDropV = (voltageV * permittedDropPct) / 100;
  const resistiveTerm = k * resistivity * lengthM * currentA;
  const chosen = input.chosenAreaMm2;
  if (chosen !== undefined && !isPositiveUpTo(chosen, 5000)) return fail("chosenArea");
  const dropAtChosenV = chosen === undefined ? undefined : resistiveTerm / chosen;
  const dropAtChosenPct =
    dropAtChosenV === undefined ? undefined : (100 * dropAtChosenV) / voltageV;
  return {
    ok: true,
    resistivity,
    loopFactor: k,
    maxDropV,
    minimumAreaMm2: resistiveTerm / maxDropV,
    dropAtChosenV,
    dropAtChosenPct,
    dropRatio:
      dropAtChosenPct === undefined ? undefined : ratioAgainst(dropAtChosenPct, permittedDropPct),
    conductorTempCUsed: tempC,
  };
}

/* ========================================================================== *
 * Asinhroni motor
 * ========================================================================== */

/** 120 is 2*60: the identity between min^-1 and the pole-pair rotation of the field. */
const RPM_POLE_FACTOR = 120;

export interface InductionMotorInput {
  /** Shaft power from the nameplate, kW — the mechanical output, not the input. */
  readonly shaftPowerKw: number;
  /** Line voltage for a three-phase machine; simply the supply voltage for single-phase. */
  readonly lineVoltageV: number;
  /** Nameplate power factor. Never guessed: it is printed on the machine. */
  readonly powerFactor: number;
  /** Nameplate efficiency, %. Never guessed either. */
  readonly efficiencyPct: number;
  /** Number of poles — even, and at least 2. */
  readonly poles: number;
  readonly frequencyHz?: number | undefined;
  /** Measured shaft speed, min^-1. Without it there is no slip. */
  readonly measuredSpeedRpm?: number | undefined;
  readonly system?: PhaseSystem | undefined;
}

export interface InductionMotorRating {
  readonly currentA: number;
  readonly inputPowerKw: number;
  readonly synchronousSpeedRpm: number;
  /** Slip in %, negative above synchronism. Absent when no speed was measured. */
  readonly slipPercent?: number | undefined;
  readonly torqueNm: number;
  /** The speed the torque was evaluated at — synchronous when none was measured. */
  readonly torqueSpeedRpm: number;
  /**
   * The supply frequency this run assumed — see `ShelfSpacingResult.rasterUsed`.
   * Synchronous speed is directly proportional to it, so an echo that says 50
   * from its own literal while the arithmetic used something else would misstate
   * every speed on the screen.
   */
  readonly frequencyHzUsed: number;
}

/**
 * The quantities a nameplate implies: current, input power, synchronous speed,
 * slip and torque.
 *
 * **The current is the input current, so the efficiency belongs in it.** The
 * nameplate power is what leaves the shaft; the machine draws
 * `P/(eta*cos(phi))` in apparent terms, and dropping the efficiency understates
 * the current by ten per cent or so — exactly the margin somebody would then
 * spend on a protective device. Which device is not this tool's business: it
 * compares nothing to any rule and selects no protection.
 *
 * A measured speed above synchronism returns a NEGATIVE slip, plainly, because
 * that is what a driven machine does. It is a number, not an error.
 */
export function inductionMotorRating(
  input: InductionMotorInput,
): ProResult<InductionMotorRating> {
  const { shaftPowerKw, lineVoltageV, powerFactor, efficiencyPct, poles } = input;
  if (!isPositiveUpTo(shaftPowerKw, 100000)) return fail("power");
  if (!isPositiveUpTo(lineVoltageV, 1e6)) return fail("voltage");
  if (!isPositiveUpTo(powerFactor, 1)) return fail("powerFactor");
  if (!isPositiveUpTo(efficiencyPct, 100)) return fail("efficiency");
  if (!isIntegerIn(poles, 2, 1000) || poles % 2 !== 0) return fail("poles");
  const frequencyHz = input.frequencyHz ?? 50;
  if (!isPositiveUpTo(frequencyHz, 1000)) return fail("frequency");

  const f3 = phaseFactor(input.system ?? "three");
  const efficiency = efficiencyPct / 100;
  const synchronousSpeedRpm = (RPM_POLE_FACTOR * frequencyHz) / poles;
  const measured = input.measuredSpeedRpm;
  if (measured !== undefined && !isPositiveUpTo(measured, 1e6)) return fail("speed");
  const torqueSpeedRpm = measured ?? synchronousSpeedRpm;
  return {
    ok: true,
    // 1000*P is the shaft power in W; the phase factor is 1 for a single-phase
    // machine, which is why the same line serves both systems.
    currentA: (1000 * shaftPowerKw) / (f3 * lineVoltageV * powerFactor * efficiency),
    inputPowerKw: shaftPowerKw / efficiency,
    synchronousSpeedRpm,
    slipPercent:
      measured === undefined
        ? undefined
        : (100 * (synchronousSpeedRpm - measured)) / synchronousSpeedRpm,
    // P = M*omega with omega = 2*pi*n/60 reduces to 30000*P[kW]/(pi*n).
    torqueNm: (30000 * shaftPowerKw) / (Math.PI * torqueSpeedRpm),
    torqueSpeedRpm,
    frequencyHzUsed: frequencyHz,
  };
}

/* ========================================================================== *
 * Termički otpor
 * ========================================================================== */

export interface ThermalChainInput {
  readonly dissipationW: number;
  readonly ambientC: number;
  /** Junction-to-case, K/W — from the data sheet. */
  readonly junctionToCase: number;
  /** Case-to-sink, K/W — a fact about the mounting, paste and pad. */
  readonly caseToSink: number;
  readonly sinkToAmbient: number;
}

export interface ThermalChain {
  readonly totalResistance: number;
  readonly junctionC: number;
  readonly caseC: number;
  readonly sinkC: number;
}

const validChainLink = (value: number): boolean => isInRange(value, 0, 1000);

/**
 * Junction, case and sink temperature from the dissipation and the resistance chain.
 *
 * A static one-dimensional model: steady state, one heat path, no coupling to
 * neighbouring parts and no transient. That is stated on the surface because the
 * number it produces is often read as if it covered a switching burst, which it
 * does not. The function selects no heatsink and judges no mounting.
 */
export function junctionTemperature(input: ThermalChainInput): ProResult<ThermalChain> {
  const { dissipationW, ambientC, junctionToCase, caseToSink, sinkToAmbient } = input;
  if (!isPositiveUpTo(dissipationW, 1e6)) return fail("dissipation");
  if (!isInRange(ambientC, -60, 200)) return fail("ambient");
  if (!validChainLink(junctionToCase)) return fail("junctionToCase");
  if (!validChainLink(caseToSink)) return fail("caseToSink");
  if (!validChainLink(sinkToAmbient)) return fail("sinkToAmbient");

  const totalResistance = junctionToCase + caseToSink + sinkToAmbient;
  const junctionC = ambientC + dissipationW * totalResistance;
  return {
    ok: true,
    totalResistance,
    junctionC,
    caseC: junctionC - dissipationW * junctionToCase,
    sinkC: junctionC - dissipationW * (junctionToCase + caseToSink),
  };
}

export interface RequiredSinkInput {
  /** Maximum junction temperature, degC — from the data sheet, never assumed. */
  readonly maxJunctionC: number;
  readonly ambientC: number;
  readonly dissipationW: number;
  readonly junctionToCase: number;
  readonly caseToSink: number;
}

export interface RequiredSink {
  /** The temperature budget the chain has to fit into, K. */
  readonly availableRiseK: number;
  readonly requiredSinkResistance: number;
}

/**
 * The heatsink thermal resistance a given dissipation and junction limit leave room for.
 *
 * **A negative answer is refused rather than printed.** `(Tj_max - Ta)/P` minus
 * the junction-to-case and case-to-sink links can come out below zero, and a
 * negative K/W is not a small heatsink — it is the statement that no heatsink at
 * that mounting can do it, and the two data-sheet links alone already exceed the
 * budget. Printing „-0.4 K/W" invites somebody to read it as „almost zero".
 */
export function requiredSinkResistance(input: RequiredSinkInput): ProResult<RequiredSink> {
  const { maxJunctionC, ambientC, dissipationW, junctionToCase, caseToSink } = input;
  if (!isInRange(maxJunctionC, 0, 400)) return fail("maxJunction");
  if (!isInRange(ambientC, -60, 200)) return fail("ambient");
  if (!isPositiveUpTo(dissipationW, 1e6)) return fail("dissipation");
  if (!validChainLink(junctionToCase)) return fail("junctionToCase");
  if (!validChainLink(caseToSink)) return fail("caseToSink");

  const availableRiseK = maxJunctionC - ambientC;
  if (availableRiseK <= 0) return fail("ambientAtOrAboveLimit");
  const requiredSinkResistanceValue = availableRiseK / dissipationW - junctionToCase - caseToSink;
  if (requiredSinkResistanceValue < 0) return fail("chainAlreadyOverBudget");
  return { ok: true, availableRiseK, requiredSinkResistance: requiredSinkResistanceValue };
}

export interface PermissibleDissipationInput {
  readonly maxJunctionC: number;
  readonly ambientC: number;
  readonly junctionToCase: number;
  readonly caseToSink: number;
  readonly sinkToAmbient: number;
}

export interface PermissibleDissipation {
  readonly totalResistance: number;
  readonly maxDissipationW: number;
}

/**
 * The dissipation at which a given chain reaches the junction limit.
 *
 * The inverse of `junctionTemperature`, and the same model: steady state, one
 * path. A chain summing to zero is refused rather than answered with infinity —
 * an ideal heat path is a missing input, not an unlimited device.
 */
export function permissibleDissipation(
  input: PermissibleDissipationInput,
): ProResult<PermissibleDissipation> {
  const { maxJunctionC, ambientC, junctionToCase, caseToSink, sinkToAmbient } = input;
  if (!isInRange(maxJunctionC, 0, 400)) return fail("maxJunction");
  if (!isInRange(ambientC, -60, 200)) return fail("ambient");
  if (!validChainLink(junctionToCase)) return fail("junctionToCase");
  if (!validChainLink(caseToSink)) return fail("caseToSink");
  if (!validChainLink(sinkToAmbient)) return fail("sinkToAmbient");

  const availableRise = maxJunctionC - ambientC;
  if (availableRise <= 0) return fail("ambientAtOrAboveLimit");
  const totalResistance = junctionToCase + caseToSink + sinkToAmbient;
  // `quotient` over `isPositive` + a raw division: a chain that sums to a
  // positive but minuscule resistance (each link is only bounded at zero, not
  // away from it) still overflows the division to Infinity, which `isPositive`
  // alone never saw because it only ever looked at the divisor.
  const maxDissipationW = quotient(availableRise, totalResistance);
  if (maxDissipationW === undefined) return fail("totalResistance");
  return { ok: true, totalResistance, maxDissipationW };
}

/* ========================================================================== *
 * Metrički navoj
 * ========================================================================== */

/**
 * ISO 68-1:1998, the basic profile of the ISO metric screw thread. H is the
 * height of the fundamental 60-degree triangle, so every factor below is the
 * trigonometry of the profile angle the standard fixes, not a measurement:
 * d2 = d - (3/4)H, d3 = d - (17/12)H, D1 = d - (5/4)H.
 */
const ROOT3_OVER_2 = Math.sqrt(3) / 2;
const PITCH_TO_D2 = 0.75 * ROOT3_OVER_2; // 0.649519052838329 per mm of pitch
const PITCH_TO_D3 = (17 / 12) * ROOT3_OVER_2; // 1.226869322027955
const PITCH_TO_D1 = 1.25 * ROOT3_OVER_2; // 1.082531754730548

/**
 * The OTHER engagement convention — the one a tap-drill chart on a workshop
 * wall usually carries. It measures against twice the flank allowance to the
 * pitch diameter (`2 * PITCH_TO_D2`) rather than against the internal thread
 * height H1 = (5/8)H that `engagementPct` uses below. Same profile geometry,
 * a different reference depth, and a materially different number for the same
 * drill: M10x1.5 with an 8.5 mm drill reads 92.376 % against H1 and 76.98 %
 * against this one. Neither is "the" answer, which is why both are returned,
 * each under its own name.
 */
const WORKSHOP_ENGAGEMENT_FACTOR = 2 * PITCH_TO_D2; // 1.299038105676658

export interface MetricThreadInput {
  /** Nominal thread diameter, mm — the 10 of an M10. */
  readonly nominalDiameterMm: number;
  /**
   * Pitch, mm. Coarse or fine is the user's choice, which is exactly why no
   * table of standard pitches is needed anywhere in this file.
   */
  readonly pitchMm: number;
  /**
   * Yield or tensile strength, MPa. `regulated`: it belongs to the property
   * class the fastener was bought to, so it is an input with no default and the
   * force row simply does not exist until it is entered.
   */
  readonly strengthMpa?: number | undefined;
  /** Tapping drill diameter, mm — for the engagement row only. */
  readonly tappingDrillMm?: number | undefined;
}

export interface MetricThread {
  /** Height of the fundamental triangle, mm. */
  readonly fundamentalHeightMm: number;
  readonly pitchDiameterMm: number;
  /** Bolt minor diameter d3 as ISO 898-1 uses it, mm. */
  readonly minorDiameterBoltMm: number;
  /** Nut minor diameter D1, mm — the hole a tap leaves. */
  readonly minorDiameterNutMm: number;
  /** Nominal stress area per ISO 898-1:2013, mm2. */
  readonly stressAreaMm2: number;
  /** A_s times the user's own strength, kN. Absent until a strength is entered. */
  readonly forceKn?: number | undefined;
  /** Both conventions, or neither: one drill measured two ways. */
  readonly engagement: ThreadEngagement | undefined;
}

/**
 * The same tapping drill under both engagement conventions.
 *
 * One field rather than two, because they are the same measurement against two
 * reference depths — a screen that has one of them and not the other has a
 * number nobody can act on. The whole point of returning both is that they
 * disagree by more than a rounding error (92.376 % against 76.98 % for M10x1.5
 * with an 8.5 mm drill), so showing one alone invites „the other tool is wrong"
 * from whoever compares it to a wall chart.
 */
export interface ThreadEngagement {
  /** Against H1 = (5/8)H, %. The ISO 898-1 convention. */
  readonly isoPct: number;
  /** The workshop convention — see the note above `WORKSHOP_ENGAGEMENT_FACTOR`. */
  readonly workshopPct: number;
}

/**
 * The geometry of an ISO metric thread, and the force at which the stress area
 * reaches the strength the user typed.
 *
 * **The force is not a permissible load and the function says so by omission.**
 * It is `A_s * R` and nothing else: no preload, no friction, no eccentricity, no
 * length of engagement, no fatigue, no count of bolts, no joint stiffness. The
 * strength is the user's, taken from the property class they bought — this file
 * contains no class table and will not choose one.
 *
 * **Engagement is returned in both conventions it gets measured by, each named.**
 * `engagement.isoPct` is quoted against the basic internal thread height
 * `H1 = (5/8)H`, under which 100 % means a full-form internal thread.
 * `engagement.workshopPct` is the older shop-floor convention (see
 * `WORKSHOP_ENGAGEMENT_FACTOR`). The two disagree by more than a rounding
 * error for the same drill, and a caller that shows only one invites the
 * reading „the other tool is wrong" from whoever compares it to a wall chart —
 * which is why they are one field and cannot be shown one at a time.
 */
export function metricThread(input: MetricThreadInput): ProResult<MetricThread> {
  const { nominalDiameterMm, pitchMm } = input;
  if (!isPositiveUpTo(nominalDiameterMm, 200)) return fail("diameter");
  if (!isPositive(pitchMm)) return fail("pitch");
  // Past this pitch the bolt has no core left: d3 would be zero or negative.
  if (pitchMm >= nominalDiameterMm / PITCH_TO_D3) return fail("pitch");

  const fundamentalHeightMm = pitchMm * ROOT3_OVER_2;
  const pitchDiameterMm = nominalDiameterMm - PITCH_TO_D2 * pitchMm;
  const minorDiameterBoltMm = nominalDiameterMm - PITCH_TO_D3 * pitchMm;
  const minorDiameterNutMm = nominalDiameterMm - PITCH_TO_D1 * pitchMm;
  const meanDiameter = (pitchDiameterMm + minorDiameterBoltMm) / 2;
  const stressAreaMm2 = (Math.PI / 4) * meanDiameter * meanDiameter;

  const strength = input.strengthMpa;
  if (strength !== undefined && !isPositiveUpTo(strength, 3000)) {
    return fail("strength");
  }
  const drill = input.tappingDrillMm;
  // Outside [D1, d) the percentage stops meaning anything rather than merely
  // being large: below D1 the drill is smaller than the thread root, above d it
  // has removed the thread entirely. D1 itself is INCLUDED — drill = D1 is the
  // canonical full-form 100 % engagement hole, not an edge case to refuse; only
  // the upper end stays strict, since drill = d leaves no thread at all.
  if (drill !== undefined && !(drill >= minorDiameterNutMm && drill < nominalDiameterMm)) {
    return fail("drill");
  }
  return {
    ok: true,
    fundamentalHeightMm,
    pitchDiameterMm,
    minorDiameterBoltMm,
    minorDiameterNutMm,
    stressAreaMm2,
    // A_s in mm2 times R in MPa is newtons; kN is the readable unit for a bolt.
    forceKn: strength === undefined ? undefined : (stressAreaMm2 * strength) / 1000,
    engagement:
      drill === undefined
        ? undefined
        : {
            isoPct: (100 * (nominalDiameterMm - drill)) / (PITCH_TO_D1 * pitchMm),
            workshopPct:
              (100 * (nominalDiameterMm - drill)) / (WORKSHOP_ENGAGEMENT_FACTOR * pitchMm),
          },
  };
}

/* ========================================================================== *
 * Omov zakon i snaga
 * ========================================================================== */

export interface OhmsLawInput {
  readonly voltageV?: number | undefined;
  readonly currentA?: number | undefined;
  readonly resistanceOhm?: number | undefined;
  readonly powerW?: number | undefined;
}

export interface OhmsLaw {
  readonly voltageV: number;
  readonly currentA: number;
  readonly resistanceOhm: number;
  readonly powerW: number;
}

/**
 * The other two of U, I, R and P from any two of them.
 *
 * All four are treated as non-negative magnitudes of a DC or purely resistive AC
 * circuit; a negative entry is refused before anything is computed, because the
 * `sqrt(P*R)` and `sqrt(P/R)` branches would otherwise return NaN and the
 * division branches would quietly propagate a sign the model does not carry.
 *
 * **Every degenerate pair is a named refusal, not an Infinity.** `U` with `I=0`
 * says nothing about the resistance — an open circuit is any resistance at all —
 * so the pair is refused rather than answered with `Infinity` that then formats
 * as a plausible-looking number. `(I,R)` is the one pair that never divides and
 * is defined even at all zeros.
 */
export function ohmsLaw(input: OhmsLawInput): ProResult<OhmsLaw> {
  const { voltageV, currentA, resistanceOhm, powerW } = input;
  const given = [voltageV, currentA, resistanceOhm, powerW].filter((v) => v !== undefined).length;
  if (given !== 2) return fail("pair");
  if (voltageV !== undefined && !isInRange(voltageV, 0, 1e9)) return fail("voltage");
  if (currentA !== undefined && !isInRange(currentA, 0, 1e6)) return fail("current");
  if (resistanceOhm !== undefined && !isInRange(resistanceOhm, 0, 1e12)) return fail("resistance");
  if (powerW !== undefined && !isInRange(powerW, 0, 1e9)) return fail("power");

  if (voltageV !== undefined && currentA !== undefined) {
    if (currentA === 0) return fail("current");
    // Both bands run to 1e9/1e6, so R = U/I can still overflow past the
    // largest finite double for a valid pair at the extremes — `quotient`
    // catches the result, not just the literal-zero divisor.
    const resistance = quotient(voltageV, currentA);
    if (resistance === undefined) return fail("current");
    return { ok: true, voltageV, currentA, resistanceOhm: resistance, powerW: voltageV * currentA };
  }
  if (voltageV !== undefined && resistanceOhm !== undefined) {
    if (resistanceOhm === 0) return fail("resistance");
    const current = quotient(voltageV, resistanceOhm);
    if (current === undefined) return fail("resistance");
    const power = quotient(voltageV * voltageV, resistanceOhm);
    if (power === undefined) return fail("resistance");
    return { ok: true, voltageV, currentA: current, resistanceOhm, powerW: power };
  }
  if (voltageV !== undefined && powerW !== undefined) {
    if (voltageV === 0) return fail("voltage");
    // P = 0 with V != 0 forces I = P/V = 0 too — the same open circuit as
    // (U, I = 0) above, refused rather than answered with R = V^2/0.
    if (powerW === 0) return fail("power");
    const current = quotient(powerW, voltageV);
    if (current === undefined) return fail("voltage");
    const resistance = quotient(voltageV * voltageV, powerW);
    if (resistance === undefined) return fail("power");
    return { ok: true, voltageV, currentA: current, resistanceOhm: resistance, powerW };
  }
  if (currentA !== undefined && resistanceOhm !== undefined) {
    return {
      ok: true,
      voltageV: currentA * resistanceOhm,
      currentA,
      resistanceOhm,
      powerW: currentA * currentA * resistanceOhm,
    };
  }
  if (currentA !== undefined && powerW !== undefined) {
    if (currentA === 0) return fail("current");
    const voltage = quotient(powerW, currentA);
    if (voltage === undefined) return fail("current");
    // I^2 can underflow to exactly 0 while I itself is still a validated
    // positive double — 1e-200 squared is 1e-400, below the smallest positive
    // double (about 4.9e-324) — and `isPositive(currentA)` alone never sees a
    // zero that only appears after the squaring.
    const resistance = quotient(powerW, currentA * currentA);
    if (resistance === undefined) return fail("current");
    return { ok: true, voltageV: voltage, currentA, resistanceOhm: resistance, powerW };
  }
  if (resistanceOhm !== undefined && powerW !== undefined) {
    if (resistanceOhm === 0) return fail("resistance");
    const currentSquared = quotient(powerW, resistanceOhm);
    if (currentSquared === undefined) return fail("resistance");
    return {
      ok: true,
      voltageV: Math.sqrt(powerW * resistanceOhm),
      currentA: Math.sqrt(currentSquared),
      resistanceOhm,
      powerW,
    };
  }
  return fail("pair");
}

/* ========================================================================== *
 * Protok kroz cev
 * ========================================================================== */

/** The four ways a flow rate is written down; all exact factors into m3/s. */
export type FlowUnit = "l/s" | "l/min" | "m3/h" | "m3/s";

const FLOW_UNIT_IN_M3S: Record<FlowUnit, number> = {
  "l/s": 0.001,
  "l/min": 1 / 60000,
  "m3/h": 1 / 3600,
  "m3/s": 1,
};

export interface PipeFlowInput {
  /**
   * INNER diameter of a round pipe, mm. Nothing here applies to a non-circular
   * duct — that needs a hydraulic-diameter branch, which this is not.
   */
  readonly innerDiameterMm: number;
  /** Give exactly one of these two; the other is what the tool computes. */
  readonly flow?: { readonly value: number; readonly unit: FlowUnit } | undefined;
  readonly velocityMs?: number | undefined;
  /** Kinematic viscosity, mm2/s, at the temperature the fluid really is. */
  readonly kinematicViscosityMm2S?: number | undefined;
  readonly densityKgM3?: number | undefined;
}

export interface PipeFlow {
  readonly areaMm2: number;
  readonly areaM2: number;
  /** MEAN velocity over the full bore — not a centreline or local value. */
  readonly velocityMs: number;
  readonly flowLs: number;
  readonly flowLmin: number;
  readonly flowM3h: number;
  readonly flowM3s: number;
  /** Absent without a viscosity: a Reynolds number needs a fluid. */
  readonly reynolds?: number | undefined;
  /** Absent without a density — both figures at once, since they are one number in two units. */
  readonly massFlow: MassFlow | undefined;
}

/** The same mass flow per second and per hour; the ratio between them is 3600 and nothing else. */
export interface MassFlow {
  readonly kgS: number;
  readonly kgH: number;
}

/**
 * Diameter, flow and velocity in a full round pipe, with Reynolds and mass flow
 * when the fluid properties are given.
 *
 * **The Reynolds number is printed and the sentence stops there.** Whether that
 * makes the flow laminar or turbulent is a convention with a transition band
 * different authors place differently, and the number is the fact. Everything is
 * computed in SI and converted only for display, so a flow entered in m3/h and a
 * flow entered in l/s that mean the same thing produce the same double.
 */
export function pipeFlow(input: PipeFlowInput): ProResult<PipeFlow> {
  const { innerDiameterMm, flow, velocityMs } = input;
  if (!isPositiveUpTo(innerDiameterMm, 10000)) return fail("diameter");
  if ((flow === undefined) === (velocityMs === undefined)) return fail("known");

  const diameterM = innerDiameterMm / 1000;
  const areaM2 = (Math.PI * diameterM * diameterM) / 4;
  let flowM3s: number;
  let velocity: number;
  if (flow !== undefined) {
    if (!isNonNegative(flow.value)) return fail("flow");
    // An absent row makes the factor `undefined` and the product `NaN`, which
    // then reaches velocity, Reynolds and both mass-flow figures on an `ok: true`
    // result — a pipe sized from a number that is not one.
    if (!isKeyOf(flow.unit, FLOW_UNIT_IN_M3S)) return fail("flowUnit");
    flowM3s = flow.value * FLOW_UNIT_IN_M3S[flow.unit];
    velocity = flowM3s / areaM2;
  } else {
    if (velocityMs === undefined || !isNonNegative(velocityMs)) return fail("velocity");
    velocity = velocityMs;
    flowM3s = velocity * areaM2;
  }

  const viscosity = input.kinematicViscosityMm2S;
  if (viscosity !== undefined && !isPositiveUpTo(viscosity, 1e6)) {
    return fail("viscosity");
  }
  const density = input.densityKgM3;
  if (density !== undefined && !isPositiveUpTo(density, 25000)) return fail("density");
  return {
    ok: true,
    areaMm2: areaM2 * 1e6,
    areaM2,
    velocityMs: velocity,
    flowLs: flowM3s * 1000,
    flowLmin: flowM3s * 60000,
    flowM3h: flowM3s * 3600,
    flowM3s,
    // nu arrives in mm2/s, which is 1e-6 m2/s — the one unit slip that turns a
    // Reynolds number into a plausible-looking figure a million times out.
    reynolds: viscosity === undefined ? undefined : (velocity * diameterM) / (viscosity * 1e-6),
    massFlow:
      density === undefined
        ? undefined
        : { kgS: density * flowM3s, kgH: density * flowM3s * 3600 },
  };
}

/* ========================================================================== *
 * Kompenzacija reaktivne snage
 * ========================================================================== */

/** tan(phi) from cos(phi) without going through an angle, for 0 < cos <= 1. */
const tanFromCos = (cosPhi: number): number => Math.sqrt(1 - cosPhi * cosPhi) / cosPhi;

/** Where the capacitors sit: line-to-line, or line-to-neutral. */
export type CapacitorConnection = "delta" | "star";

export interface PowerFactorCorrectionInput {
  readonly activePowerKw: number;
  readonly presentPowerFactor: number;
  readonly targetPowerFactor: number;
  readonly lineVoltageV: number;
  /** Network frequency, Hz. 50 is the nominal system value, not a limit. */
  readonly frequencyHz?: number | undefined;
  readonly system?: PhaseSystem | undefined;
  readonly connection?: CapacitorConnection | undefined;
}

export interface PowerFactorCorrection {
  readonly reactiveBeforeKvar: number;
  readonly reactiveAfterKvar: number;
  /**
   * Q1 minus Q2 — always at or above zero, since a worse target is refused
   * rather than answered.
   */
  readonly correctionKvar: number;
  readonly capacitancePerPhaseF: number;
  readonly capacitancePerPhaseUf: number;
  readonly currentBeforeA: number;
  readonly currentAfterA: number;
}

/**
 * The capacitor rating that moves a load from one power factor to another.
 *
 * **Delta and star differ by a factor of three, and getting it backwards buys
 * the wrong bank.** In delta each capacitor sees the full line voltage and there
 * are three of them, so `C = Qc/(3*omega*U^2)`; in star each sees `U/sqrt(3)`,
 * whose square cancels the three, leaving `C = Qc/(omega*U^2)`. The delta bank is
 * a third of the capacitance for the same kvar, which is why it is the usual one.
 *
 * **A target worse than the present factor is refused, not answered.** `Qc`
 * negative is not a smaller bank, it is not compensation at all — a target the
 * load already exceeds is an input mistake, and the function says so by name
 * rather than returning a number whose sign the caller has to notice.
 *
 * This is a fundamental-frequency, balanced-load calculation. Harmonics and the
 * resonance a capacitor bank forms with the supply transformer are outside it,
 * and the surface says so rather than the tool pretending otherwise; nothing here
 * selects a capacitor, a bank, a step or a detuning reactor.
 */
export function powerFactorCorrection(
  input: PowerFactorCorrectionInput,
): ProResult<PowerFactorCorrection> {
  const { activePowerKw, presentPowerFactor, targetPowerFactor, lineVoltageV } = input;
  if (!isPositiveUpTo(activePowerKw, 1e6)) return fail("power");
  if (!isPositiveUpTo(presentPowerFactor, 1)) return fail("presentPowerFactor");
  if (!isPositiveUpTo(targetPowerFactor, 1)) return fail("targetPowerFactor");
  if (targetPowerFactor < presentPowerFactor) return fail("targetPowerFactor");
  if (!isPositiveUpTo(lineVoltageV, 1e6)) return fail("voltage");
  const frequencyHz = input.frequencyHz ?? 50;
  if (!isPositiveUpTo(frequencyHz, 1000)) return fail("frequency");

  const system = input.system ?? "three";
  const connection = input.connection ?? "delta";
  const reactiveBeforeKvar = activePowerKw * tanFromCos(presentPowerFactor);
  const reactiveAfterKvar = activePowerKw * tanFromCos(targetPowerFactor);
  const correctionKvar = reactiveBeforeKvar - reactiveAfterKvar;

  const omega = 2 * Math.PI * frequencyHz;
  const denominator =
    system === "three" && connection === "delta"
      ? 3 * omega * lineVoltageV * lineVoltageV
      : omega * lineVoltageV * lineVoltageV;
  const capacitancePerPhaseF = (correctionKvar * 1000) / denominator;
  const f3 = phaseFactor(system);
  return {
    ok: true,
    reactiveBeforeKvar,
    reactiveAfterKvar,
    correctionKvar,
    capacitancePerPhaseF,
    capacitancePerPhaseUf: capacitancePerPhaseF * 1e6,
    // The active power is unchanged by compensation; only the current moves.
    currentBeforeA: (activePowerKw * 1000) / (f3 * lineVoltageV * presentPowerFactor),
    currentAfterA: (activePowerKw * 1000) / (f3 * lineVoltageV * targetPowerFactor),
  };
}

/* ========================================================================== *
 * Pritisak i sila klipa
 * ========================================================================== */

export type PressureUnit =
  | "Pa"
  | "kPa"
  | "MPa"
  | "bar"
  | "mbar"
  | "psi"
  | "kgf/cm2"
  | "atm"
  | "mmHg"
  | "torr"
  | "inHg"
  | "mH2O"
  | "mmH2O";

/**
 * One exact factor per unit, each written as the product that defines it.
 *
 * The pair worth staring at is `mmHg` and `torr`: a millimetre of mercury is a
 * fluid of exactly 13595.1 kg/m3 under standard gravity, while the torr is
 * 101325/760 Pa. They differ in the seventh digit and are NOT the same unit, so
 * they are kept apart here rather than aliased the way most converters alias them.
 */
const MMHG_IN_PA = (13595.1 * G_N) / 1000;
const PRESSURE_UNIT_IN_PA: Record<PressureUnit, number> = {
  Pa: 1,
  kPa: 1000,
  MPa: 1e6,
  bar: 1e5,
  mbar: 100,
  psi: (POUND_IN_KG * G_N) / (INCH_IN_M * INCH_IN_M),
  "kgf/cm2": G_N * 1e4,
  atm: 101325,
  mmHg: MMHG_IN_PA,
  torr: 101325 / 760,
  inHg: MMHG_IN_PA * 25.4,
  // mH2O and mmH2O are defined at the CONVENTIONAL 1000 kg/m3 of the metre of
  // water column, exactly as mH2O is — not at the density of the user's own
  // water, which varies with temperature.
  mH2O: 1000 * G_N,
  mmH2O: G_N,
};

/** The standard atmosphere, Pa — a definition, which is why it may be a default. */
const STANDARD_ATMOSPHERE_PA = 101325;

/** Whether the number the user typed is measured against vacuum or against the air. */
export type PressureKind = "gauge" | "absolute";

export interface PressureInput {
  readonly value: number;
  readonly unit: PressureUnit;
  readonly kind: PressureKind;
  /** Local atmospheric pressure, Pa. The standard atmosphere unless measured. */
  readonly atmosphericPa?: number | undefined;
}

export type PressureInUnits = Record<PressureUnit, number>;

export interface PressureConversion {
  readonly gaugePa: number;
  readonly absolutePa: number;
  readonly gauge: PressureInUnits;
  readonly absolute: PressureInUnits;
  /**
   * The atmospheric pressure this run used, Pa — see
   * `ShelfSpacingResult.rasterUsed`. It is the ENTIRE difference between the
   * two readings this tool exists to show side by side, so a screen echoing
   * its own copy of the standard atmosphere while the arithmetic used a
   * measured one would contradict the pair of numbers directly above it.
   */
  readonly atmosphericPaUsed: number;
}

const inEveryUnit = (pascals: number): PressureInUnits => ({
  Pa: pascals / PRESSURE_UNIT_IN_PA.Pa,
  kPa: pascals / PRESSURE_UNIT_IN_PA.kPa,
  MPa: pascals / PRESSURE_UNIT_IN_PA.MPa,
  bar: pascals / PRESSURE_UNIT_IN_PA.bar,
  mbar: pascals / PRESSURE_UNIT_IN_PA.mbar,
  psi: pascals / PRESSURE_UNIT_IN_PA.psi,
  "kgf/cm2": pascals / PRESSURE_UNIT_IN_PA["kgf/cm2"],
  atm: pascals / PRESSURE_UNIT_IN_PA.atm,
  mmHg: pascals / PRESSURE_UNIT_IN_PA.mmHg,
  torr: pascals / PRESSURE_UNIT_IN_PA.torr,
  inHg: pascals / PRESSURE_UNIT_IN_PA.inHg,
  mH2O: pascals / PRESSURE_UNIT_IN_PA.mH2O,
  mmH2O: pascals / PRESSURE_UNIT_IN_PA.mmH2O,
});

/**
 * One pressure in every unit, in both the gauge and the absolute reading.
 *
 * **Gauge and absolute are the two answers, and showing both is the point.** A
 * compressor stating 6 bar and a data sheet stating 7 bar can be the same
 * pressure, and the conversion that loses a whole atmosphere is the one that
 * assumed which of the two was meant. A gauge pressure below minus the local
 * atmosphere is refused: it would be a negative absolute pressure.
 */
export function convertPressure(input: PressureInput): ProResult<PressureConversion> {
  const { value, unit, kind } = input;
  if (!Number.isFinite(value)) return fail("value");
  const atmosphericPa = input.atmosphericPa ?? STANDARD_ATMOSPHERE_PA;
  if (!isPositiveUpTo(atmosphericPa, 200000)) return fail("atmospheric");

  const entered = value * PRESSURE_UNIT_IN_PA[unit];
  if (!isInRange(entered, -1e12, 1e12)) return fail("value");
  const gaugePa = kind === "gauge" ? entered : entered - atmosphericPa;
  const absolutePa = gaugePa + atmosphericPa;
  if (absolutePa < 0) return fail("value");
  return {
    ok: true,
    gaugePa,
    absolutePa,
    gauge: inEveryUnit(gaugePa),
    absolute: inEveryUnit(absolutePa),
    atmosphericPaUsed: atmosphericPa,
  };
}

export interface PistonForceInput {
  /** GAUGE pressure, Pa — see the note in `pistonForce` for why not absolute. */
  readonly gaugePressurePa: number;
  readonly boreMm: number;
  /** Rod diameter, mm. Zero is a plunger and is perfectly defined. */
  readonly rodMm?: number | undefined;
  /**
   * Local atmospheric pressure, Pa — the SAME role it plays in `convertPressure`:
   * a gauge pressure below its negative would be a negative absolute pressure,
   * which no fluid reaches. Defaults to the standard atmosphere so this function
   * enforces the invariant itself rather than depending on a caller having routed
   * the value through `convertPressure` first.
   */
  readonly atmosphericPa?: number | undefined;
}

export interface PistonForce {
  readonly boreAreaMm2: number;
  /** Annulus on the rod side, mm2 — equal to the bore area when there is no rod. */
  readonly annulusAreaMm2: number;
  readonly extendForceN: number;
  readonly retractForceN: number;
  /**
   * The rod diameter this run used, mm — 0 for a cylinder with no rod on the
   * return side. See `ShelfSpacingResult.rasterUsed`: the echo restated its own
   * `"0"` for an empty field while the arithmetic applied this one.
   */
  readonly rodMmUsed: number;
}

/**
 * The force a cylinder makes in each direction.
 *
 * **The gauge pressure is the one that makes force, and that is not a
 * simplification.** The atmosphere pushes on the far side of the piston too, so
 * only the pressure above it does work; using the absolute pressure overstates a
 * 63 mm bore by about 300 N. The product is pressure times area and is presented
 * as exactly that: no friction, no back pressure on the opposite port, no
 * selection of a cylinder, hose, valve or working pressure, and no statement
 * about what the assembly is rated for.
 *
 * **A gauge pressure below minus the local atmosphere is refused, the same
 * invariant `convertPressure` enforces on the same tool's other half.** Below
 * that point the absolute pressure would be negative, which no fluid reaches;
 * this function takes its own `atmosphericPa` (defaulting to the standard
 * atmosphere) rather than trusting a caller to have pre-validated the pressure.
 */
export function pistonForce(input: PistonForceInput): ProResult<PistonForce> {
  const { gaugePressurePa, boreMm } = input;
  if (!isInRange(gaugePressurePa, -1e12, 1e12)) return fail("pressure");
  const atmosphericPa = input.atmosphericPa ?? STANDARD_ATMOSPHERE_PA;
  if (!isPositiveUpTo(atmosphericPa, 200000)) return fail("atmospheric");
  if (gaugePressurePa < -atmosphericPa) return fail("pressure");
  if (!isPositiveUpTo(boreMm, 5000)) return fail("bore");
  const rodMm = input.rodMm ?? 0;
  if (!isNonNegative(rodMm) || rodMm >= boreMm) return fail("rod");

  const boreAreaMm2 = circleAreaMm2(boreMm);
  const annulusAreaMm2 = (Math.PI * (boreMm * boreMm - rodMm * rodMm)) / 4;
  return {
    ok: true,
    boreAreaMm2,
    annulusAreaMm2,
    // mm2 to m2 is 1e-6; Pa times m2 is newtons.
    extendForceN: gaugePressurePa * boreAreaMm2 * 1e-6,
    retractForceN: gaugePressurePa * annulusAreaMm2 * 1e-6,
    rodMmUsed: rodMm,
  };
}

/* ========================================================================== *
 * Boje otpornika
 * ========================================================================== */

/**
 * IEC 60062:2016 (+A1:2019). The colour names are ASCII keys, not copy: the
 * Serbian words live in the surface's own table, which is what keeps a
 * translation from breaking a test.
 */
export type BandColour =
  | "black"
  | "brown"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "violet"
  | "grey"
  | "white"
  | "gold"
  | "silver";

/** Position in this array IS the digit, and for a multiplier ring IS the exponent. */
const DIGIT_COLOURS: readonly BandColour[] = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet",
  "grey",
  "white",
];

const digitOf = (colour: BandColour): number => DIGIT_COLOURS.indexOf(colour);

const multiplierExponentOf = (colour: BandColour): number | undefined => {
  if (colour === "gold") return -1;
  if (colour === "silver") return -2;
  const digit = digitOf(colour);
  return digit < 0 ? undefined : digit;
};

const TOLERANCE_RINGS: readonly (readonly [BandColour, number])[] = [
  ["brown", 1],
  ["red", 2],
  ["green", 0.5],
  ["blue", 0.25],
  ["violet", 0.1],
  ["grey", 0.05],
  ["gold", 5],
  ["silver", 10],
];

const TEMPCO_RINGS: readonly (readonly [BandColour, number])[] = [
  ["brown", 100],
  ["red", 50],
  ["orange", 15],
  ["yellow", 25],
  ["blue", 10],
  ["violet", 5],
  ["grey", 1],
];

const lookupByColour = (
  table: readonly (readonly [BandColour, number])[],
  colour: BandColour,
): number | undefined => table.find((row) => row[0] === colour)?.[1];

// A TOLERANCE, not a rounding nudge: it decides whether the caller's own
// tolerancePct/tempCoefficientPpmK equals one of the fixed ring constants
// above, which are never smaller than 0.05 — nine orders above the epsilon —
// so an absolute comparison cannot misclassify a value this table can hold.
// It would only need to be relative if this table's smallest entry sat near
// 1e-9 itself, which it never will: these are ring constants, not a scaled
// physical quantity.
const lookupByValue = (
  table: readonly (readonly [BandColour, number])[],
  value: number,
): BandColour | undefined => table.find((row) => Math.abs(row[1] - value) < 1e-9)?.[0];

/** A resistor with no tolerance ring is +/-20 % by convention, not by measurement. */
const UNMARKED_TOLERANCE_PCT = 20;

/**
 * IEC 60063:2015 E24, as the two-digit mantissas. E12 and E6 are its subsets, so
 * one table of 24 rows carries all three series and they cannot drift apart.
 */
const E24: readonly number[] = [
  10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91,
];
const E12: readonly number[] = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
const E6: readonly number[] = [10, 15, 22, 33, 47, 68];

export type PreferredSeries = "E6" | "E12" | "E24";

const seriesTable = (series: PreferredSeries): readonly number[] =>
  series === "E6" ? E6 : series === "E12" ? E12 : E24;

export interface PreferredValue {
  readonly value: number;
  /** Signed deviation of the series value from the asked-for one, %. */
  readonly deviationPct: number;
}

/**
 * The nearest preferred value in a chosen E series.
 *
 * **Nearest is measured on the ratio, not on the difference.** `|ln(R/c)|` is
 * symmetric — 1000 is as far from 900 as it is from 1111 — whereas an absolute
 * difference always leans towards the larger candidate, and a preferred series
 * is a geometric progression, so the ratio is the metric it was built with.
 */
export function nearestPreferredValue(
  ohms: number,
  series: PreferredSeries,
): ProResult<PreferredValue> {
  if (!isPositive(ohms)) return fail("value");
  const table = seriesTable(series);
  const decade = Math.floor(Math.log10(ohms));
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let step = -1; step <= 1; step += 1) {
    for (const mantissa of table) {
      const candidate = (mantissa / 10) * Math.pow(10, decade + step);
      if (candidate < ohms / 10 || candidate > ohms * 10) continue;
      const distance = Math.abs(Math.log(ohms / candidate));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  if (best === undefined) return fail("value");
  return { ok: true, value: best, deviationPct: (100 * (best - ohms)) / ohms };
}

export interface ResistorBandsInput {
  /** Three to six rings, in the order they are painted. */
  readonly bands: readonly BandColour[];
  readonly series?: PreferredSeries | undefined;
}

export interface ResistorValue {
  readonly ohms: number;
  readonly tolerancePct: number;
  readonly minOhms: number;
  readonly maxOhms: number;
  /** Sixth ring only, ppm/K. */
  readonly tempCoefficientPpmK?: number | undefined;
  readonly preferredValueOhms: number;
  readonly preferredDeviationPct: number;
}

/**
 * The value a painted resistor carries, with its tolerance band and range.
 *
 * The ring count decides everything: 3 and 4 rings put two digits before the
 * multiplier, 5 and 6 put three. A three-ring part has no tolerance ring at all
 * and is +/-20 % by convention — a convention the surface states, since the
 * number is not painted on the part.
 *
 * A colour that has no meaning in the position it occupies is refused by name
 * rather than silently read as something else: gold is a multiplier and a
 * tolerance and is never a digit.
 */
export function resistorFromBands(input: ResistorBandsInput): ProResult<ResistorValue> {
  const { bands } = input;
  const count = bands.length;
  if (!isIntegerIn(count, 3, 6)) return fail("bandCount");
  const digitCount = count <= 4 ? 2 : 3;

  let digits = 0;
  for (let index = 0; index < digitCount; index += 1) {
    const colour = bands[index];
    const digit = colour === undefined ? -1 : digitOf(colour);
    if (digit < 0) return fail("digitBand");
    digits = digits * 10 + digit;
  }

  const multiplierBand = bands[digitCount];
  const exponent = multiplierBand === undefined ? undefined : multiplierExponentOf(multiplierBand);
  if (exponent === undefined) return fail("multiplierBand");
  const ohms = digits * Math.pow(10, exponent);
  if (!isPositive(ohms)) return fail("value");

  let tolerancePct = UNMARKED_TOLERANCE_PCT;
  if (count >= 4) {
    const toleranceBand = bands[digitCount + 1];
    const found =
      toleranceBand === undefined ? undefined : lookupByColour(TOLERANCE_RINGS, toleranceBand);
    if (found === undefined) return fail("toleranceBand");
    tolerancePct = found;
  }

  let tempCoefficientPpmK: number | undefined;
  if (count === 6) {
    const tempcoBand = bands[5];
    tempCoefficientPpmK =
      tempcoBand === undefined ? undefined : lookupByColour(TEMPCO_RINGS, tempcoBand);
    if (tempCoefficientPpmK === undefined) return fail("tempCoefficientBand");
  }

  const preferred = nearestPreferredValue(ohms, input.series ?? "E24");
  if (!preferred.ok) return preferred;
  return {
    ok: true,
    ohms,
    tolerancePct,
    minOhms: ohms * (1 - tolerancePct / 100),
    maxOhms: ohms * (1 + tolerancePct / 100),
    tempCoefficientPpmK,
    preferredValueOhms: preferred.value,
    preferredDeviationPct: preferred.deviationPct,
  };
}

export interface ResistorBandsForValueInput {
  readonly ohms: number;
  /** Required from four rings up; a three-ring part carries no tolerance ring. */
  readonly tolerancePct?: number | undefined;
  readonly bandCount: number;
  /** Required for a six-ring part, ppm/K. */
  readonly tempCoefficientPpmK?: number | undefined;
}

export interface ResistorBands {
  readonly bands: readonly BandColour[];
}

/**
 * The rings that carry a value, which is the direction where a resistor either
 * fits the ring count or does not.
 *
 * **A value that cannot be written at the available number of digits is refused,
 * never rounded quietly.** 4530 ohm on a four-ring part would have to become
 * 4500 or 4700, and a silent round here is a part that reads back as a different
 * resistor. The same applies to the multiplier: outside 10^-2..10^9 there is no
 * ring to paint.
 */
export function resistorBandsForValue(input: ResistorBandsForValueInput): ProResult<ResistorBands> {
  const { ohms, bandCount } = input;
  if (!isIntegerIn(bandCount, 3, 6)) return fail("bandCount");
  if (!isPositive(ohms)) return fail("value");
  const digitCount = bandCount <= 4 ? 2 : 3;

  // Normalise to exactly `digitCount` significant digits. The two corrections
  // below cover the cases where log10 lands on the wrong side of a decade, either
  // through its own rounding or because the mantissa rounds up to a full decade.
  let decade = Math.floor(Math.log10(ohms));
  let mantissa = Math.round(ohms / Math.pow(10, decade - digitCount + 1));
  if (mantissa >= Math.pow(10, digitCount)) {
    decade += 1;
    mantissa = Math.round(ohms / Math.pow(10, decade - digitCount + 1));
  } else if (mantissa < Math.pow(10, digitCount - 1)) {
    decade -= 1;
    mantissa = Math.round(ohms / Math.pow(10, decade - digitCount + 1));
  }

  const multiplierExponent = decade - digitCount + 1;
  if (multiplierExponent < -2 || multiplierExponent > 9) return fail("multiplier");
  const scale = Math.pow(10, multiplierExponent);
  // A relative tolerance, because 47 * 0.1 is not exactly 4.7 in binary and a
  // strict equality here would refuse perfectly paintable values.
  if (Math.abs(mantissa * scale - ohms) > 1e-9 * ohms) return fail("precision");

  const bands: BandColour[] = [];
  for (let index = digitCount - 1; index >= 0; index -= 1) {
    const digit = Math.floor(mantissa / Math.pow(10, index)) % 10;
    const colour = DIGIT_COLOURS[digit];
    if (colour === undefined) return fail("value");
    bands.push(colour);
  }
  const multiplierColour =
    multiplierExponent === -1
      ? "gold"
      : multiplierExponent === -2
        ? "silver"
        : DIGIT_COLOURS[multiplierExponent];
  if (multiplierColour === undefined) return fail("multiplier");
  bands.push(multiplierColour);

  if (bandCount >= 4) {
    const tolerancePct = input.tolerancePct;
    const colour =
      tolerancePct === undefined ? undefined : lookupByValue(TOLERANCE_RINGS, tolerancePct);
    if (colour === undefined) return fail("tolerance");
    bands.push(colour);
  }
  if (bandCount === 6) {
    const tempco = input.tempCoefficientPpmK;
    const colour = tempco === undefined ? undefined : lookupByValue(TEMPCO_RINGS, tempco);
    if (colour === undefined) return fail("tempCoefficient");
    bands.push(colour);
  }
  return { ok: true, bands };
}

/* ========================================================================== *
 * Impedansa i rezonansa
 * ========================================================================== */

export type RlcConnection = "series" | "parallel";

export interface RlcInput {
  readonly frequencyHz: number;
  /** Ohms. Zero is allowed and is an ideal L-C branch. */
  readonly resistanceOhm: number;
  /** Henry. Absent (or zero) means there is no inductor in the circuit. */
  readonly inductanceH?: number | undefined;
  /** Farad. Absent (or zero) means there is no capacitor in the circuit. */
  readonly capacitanceF?: number | undefined;
  readonly connection: RlcConnection;
}

export interface RlcResponse {
  readonly reactanceInductiveOhm?: number | undefined;
  readonly reactanceCapacitiveOhm?: number | undefined;
  /** Series only: X_L - X_C, positive when inductive. */
  readonly netReactanceOhm?: number | undefined;
  /** Parallel only, siemens. */
  readonly conductanceS?: number | undefined;
  readonly susceptanceS?: number | undefined;
  readonly impedanceOhm: number;
  /** Degrees; positive is an inductive load in both connections. */
  readonly phaseDeg: number;
  readonly resonanceHz?: number | undefined;
  readonly qualityFactor?: number | undefined;
  readonly bandwidthHz?: number | undefined;
  /** Needs a capacitor and a resistance above zero; absent as a whole otherwise. */
  readonly rc: FirstOrderCorner | undefined;
  /** Needs an inductor and a resistance above zero; absent as a whole otherwise. */
  readonly rl: FirstOrderCorner | undefined;
}

/**
 * A first-order corner frequency and its time constant.
 *
 * One field, because they are the same fact written twice — `f_c = 1/(2*pi*tau)`
 * holds identically — and neither exists without the other. They used to be two
 * optionals, which is why the surface guarded on the corner and then wrote
 * `?? 0` under the tau it printed in the same breath: „τ = 0 s" beside a real
 * corner frequency is a circuit that responds instantly.
 */
export interface FirstOrderCorner {
  readonly cornerHz: number;
  readonly timeConstantS: number;
}

/**
 * Reactances, impedance, phase, resonance and the RC/RL corner frequencies.
 *
 * **Only what the entered elements define comes back; the rest is absent rather
 * than filled with a plausible zero.** An absent capacitor and a zero capacitor
 * are treated as the same thing — no capacitor in the circuit — because that is
 * what an empty field means on the surface, and because `1/(omega*0)` is not a
 * very large reactance, it is no circuit at all.
 *
 * The sign of the phase is the whole statement about character: positive is
 * inductive. Nothing is labelled „inductive" or „capacitive" beyond that,
 * because the label is a convention and the sign is the number.
 */
export function rlcResponse(input: RlcInput): ProResult<RlcResponse> {
  const { frequencyHz, resistanceOhm, connection } = input;
  if (!isPositiveUpTo(frequencyHz, 1e12)) return fail("frequency");
  if (!isInRange(resistanceOhm, 0, 1e12)) return fail("resistance");
  const inductanceH = input.inductanceH;
  if (inductanceH !== undefined && !isInRange(inductanceH, 0, 1e6)) return fail("inductance");
  const capacitanceF = input.capacitanceF;
  if (capacitanceF !== undefined && !isInRange(capacitanceF, 0, 1)) return fail("capacitance");

  const omega = 2 * Math.PI * frequencyHz;
  // An absent element and a zero one are the same circuit: nothing there. That
  // is what an empty field means, and 1/(omega*0) is not a large reactance.
  const inductance = inductanceH ?? 0;
  const capacitance = capacitanceF ?? 0;
  const hasL = inductance > 0;
  const hasC = capacitance > 0;
  const reactanceInductiveOhm = hasL ? omega * inductance : undefined;
  const reactanceCapacitiveOhm = hasC ? 1 / (omega * capacitance) : undefined;

  const resonanceHz =
    hasL && hasC ? 1 / (2 * Math.PI * Math.sqrt(inductance * capacitance)) : undefined;
  const qualityFactor =
    hasL && hasC && resistanceOhm > 0
      ? connection === "series"
        ? (1 / resistanceOhm) * Math.sqrt(inductance / capacitance)
        : resistanceOhm * Math.sqrt(capacitance / inductance)
      : undefined;
  const bandwidthHz =
    resonanceHz === undefined || qualityFactor === undefined || qualityFactor === 0
      ? undefined
      : resonanceHz / qualityFactor;
  const shared = {
    reactanceInductiveOhm,
    reactanceCapacitiveOhm,
    resonanceHz,
    qualityFactor,
    bandwidthHz,
    rc:
      hasC && resistanceOhm > 0
        ? {
            cornerHz: 1 / (2 * Math.PI * resistanceOhm * capacitance),
            timeConstantS: resistanceOhm * capacitance,
          }
        : undefined,
    rl:
      hasL && resistanceOhm > 0
        ? {
            cornerHz: resistanceOhm / (2 * Math.PI * inductance),
            timeConstantS: inductance / resistanceOhm,
          }
        : undefined,
  };

  if (connection === "series") {
    const netReactanceOhm = (reactanceInductiveOhm ?? 0) - (reactanceCapacitiveOhm ?? 0);
    return {
      ok: true,
      ...shared,
      netReactanceOhm,
      impedanceOhm: Math.hypot(resistanceOhm, netReactanceOhm),
      // atan2 rather than atan so R = 0 gives exactly +/-90 degrees.
      phaseDeg: Math.atan2(netReactanceOhm, resistanceOhm) * DEG_PER_RAD,
    };
  }

  const conductanceS = resistanceOhm > 0 ? 1 / resistanceOhm : Number.POSITIVE_INFINITY;
  const susceptanceS = (hasC ? omega * capacitance : 0) - (hasL ? 1 / (omega * inductance) : 0);
  if (resistanceOhm === 0) {
    // A perfect short across the network: the impedance is zero and the phase
    // with it, which is the one case where no division may be attempted.
    return {
      ok: true,
      ...shared,
      conductanceS: undefined,
      susceptanceS,
      impedanceOhm: 0,
      phaseDeg: 0,
    };
  }
  const admittance = Math.hypot(conductanceS, susceptanceS);
  return {
    ok: true,
    ...shared,
    conductanceS,
    susceptanceS,
    impedanceOhm: 1 / admittance,
    // The impedance angle is the negative of the admittance angle, which is what
    // keeps „positive is inductive" true in both connections.
    phaseDeg: -Math.atan2(susceptanceS, conductanceS) * DEG_PER_RAD,
  };
}

/* ========================================================================== *
 * Karakteristike preseka
 * ========================================================================== */

export type SectionShape =
  | { readonly kind: "rectangle"; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: "circle"; readonly diameterMm: number }
  | { readonly kind: "tube"; readonly outerDiameterMm: number; readonly innerDiameterMm: number }
  | {
      readonly kind: "rectangularTube";
      readonly outerWidthMm: number;
      readonly outerHeightMm: number;
      readonly innerWidthMm: number;
      readonly innerHeightMm: number;
    }
  | {
      readonly kind: "iSection";
      readonly flangeWidthMm: number;
      readonly depthMm: number;
      readonly flangeThicknessMm: number;
      readonly webThicknessMm: number;
    };

export interface SectionInput {
  readonly shape: SectionShape;
  /**
   * Allowable stress, MPa. `regulated`: the material standard and the design
   * code in force choose it and can revise it, so it is an input with no default.
   */
  readonly allowableStressMpa?: number | undefined;
  readonly bendingMomentNm?: number | undefined;
  readonly torsionMomentNm?: number | undefined;
}

export interface SectionProperties {
  readonly areaMm2: number;
  readonly momentOfInertiaXMm4: number;
  readonly momentOfInertiaYMm4: number;
  readonly sectionModulusXMm3: number;
  readonly sectionModulusYMm3: number;
  readonly radiusOfGyrationXMm: number;
  readonly radiusOfGyrationYMm: number;
  /** Circular shapes only — see the note in `sectionProperties`. */
  readonly polar: PolarSection | undefined;
  /** Moment at which the bending stress reaches the user's own allowable, N*m. */
  readonly allowableMomentNm?: number | undefined;
  readonly bendingStressMpa?: number | undefined;
  /** Bending stress over the user's own allowable. Undefined without one. */
  readonly stressRatio?: number | undefined;
  readonly torsionalStressMpa?: number | undefined;
}

/**
 * The polar pair, present only for the shapes St Venant torsion is defined on.
 *
 * One field, because `I_p` and `W_p` come from the same geometry and are never
 * derivable separately — a section either has a circular torsion constant or it
 * has none at all, and half of the pair is not a partial answer.
 */
export interface PolarSection {
  readonly momentMm4: number;
  readonly modulusMm3: number;
}

const RECTANGLE_MAX = 10000;

interface CoreSection {
  readonly areaMm2: number;
  readonly ix: number;
  readonly iy: number;
  readonly wx: number;
  readonly wy: number;
  readonly polar?: PolarSection | undefined;
}

/**
 * A section whose derived properties are all real, positive numbers — or a
 * refusal naming the dimensions that made them not be.
 *
 * **The guard belongs here and not at the five divisions downstream.** Every
 * dimension is checked positive, and every product of positive dimensions is
 * still positive in exact arithmetic — but not in binary: `1e-200 * 1e-200` is
 * `1e-400`, which is below the smallest double and rounds to exactly zero. A
 * rectangle 1e-200 mm square therefore reaches `sectionProperties` with an area,
 * an `I` and a `W` of zero, and `bendingStress = M·1000 / 0` comes back as
 * `Infinity` on an `ok: true` result, while `sqrt(0 / 0)` comes back as `NaN`.
 * Both are printed by a surface as if they were readings, in a structural
 * stress-ratio tool.
 *
 * Refusing once, where the section is constructed, is what makes the five
 * divisions that follow safe by construction rather than safe by five separate
 * checks that the sixth caller will not know to write.
 */
const finiteSection = (section: CoreSection): ProResult<CoreSection> => {
  const derived = [section.areaMm2, section.ix, section.iy, section.wx, section.wy];
  if (section.polar !== undefined) derived.push(section.polar.momentMm4, section.polar.modulusMm3);
  if (!derived.every((value) => isPositive(value))) return fail("dimensions");
  return { ok: true, ...section };
};

const coreSection = (shape: SectionShape): ProResult<CoreSection> => {
  if (shape.kind === "rectangle") {
    const { widthMm: b, heightMm: h } = shape;
    if (!isPositiveUpTo(b, RECTANGLE_MAX)) return fail("width");
    if (!isPositiveUpTo(h, RECTANGLE_MAX)) return fail("height");
    return finiteSection({
      areaMm2: b * h,
      ix: (b * h * h * h) / 12,
      iy: (h * b * b * b) / 12,
      wx: (b * h * h) / 6,
      wy: (h * b * b) / 6,
    });
  }
  if (shape.kind === "circle") {
    const d = shape.diameterMm;
    if (!isPositiveUpTo(d, RECTANGLE_MAX)) return fail("diameter");
    const i = (Math.PI * Math.pow(d, 4)) / 64;
    const w = (Math.PI * d * d * d) / 32;
    return finiteSection({ areaMm2: circleAreaMm2(d), ix: i, iy: i, wx: w, wy: w,
      polar: { momentMm4: 2 * i, modulusMm3: 2 * w } });
  }
  if (shape.kind === "tube") {
    const { outerDiameterMm: D, innerDiameterMm: d } = shape;
    if (!isPositiveUpTo(D, RECTANGLE_MAX)) return fail("outerDiameter");
    if (!isPositiveUpTo(d, RECTANGLE_MAX) || d >= D) return fail("innerDiameter");
    const i = (Math.PI * (Math.pow(D, 4) - Math.pow(d, 4))) / 64;
    const w = (2 * i) / D;
    return finiteSection({
      areaMm2: (Math.PI * (D * D - d * d)) / 4,
      ix: i,
      iy: i,
      wx: w,
      wy: w,
      polar: { momentMm4: 2 * i, modulusMm3: 2 * w },
    });
  }
  if (shape.kind === "rectangularTube") {
    const { outerWidthMm: B, outerHeightMm: H, innerWidthMm: b, innerHeightMm: h } = shape;
    if (!isPositiveUpTo(B, RECTANGLE_MAX)) return fail("outerWidth");
    if (!isPositiveUpTo(H, RECTANGLE_MAX)) return fail("outerHeight");
    if (!isPositiveUpTo(b, RECTANGLE_MAX) || b >= B) return fail("innerWidth");
    if (!isPositiveUpTo(h, RECTANGLE_MAX) || h >= H) return fail("innerHeight");
    const ix = (B * H * H * H - b * h * h * h) / 12;
    const iy = (H * B * B * B - h * b * b * b) / 12;
    return finiteSection({
      areaMm2: B * H - b * h,
      ix,
      iy,
      wx: (2 * ix) / H,
      wy: (2 * iy) / B,
    });
  }
  const { flangeWidthMm: b, depthMm: h, flangeThicknessMm: tf, webThicknessMm: tw } = shape;
  if (!isPositiveUpTo(b, RECTANGLE_MAX)) return fail("flangeWidth");
  if (!isPositiveUpTo(h, RECTANGLE_MAX)) return fail("depth");
  if (!isPositive(tf) || 2 * tf >= h) return fail("flangeThickness");
  if (!isPositive(tw) || tw >= b) return fail("webThickness");
  const web = h - 2 * tf;
  const ix = (b * h * h * h - (b - tw) * web * web * web) / 12;
  const iy = (2 * tf * b * b * b + web * tw * tw * tw) / 12;
  return finiteSection({
    areaMm2: 2 * b * tf + web * tw,
    ix,
    iy,
    wx: (2 * ix) / h,
    wy: (2 * iy) / b,
  });
};

/**
 * Area, second moments, section moduli, radii of gyration and the stresses a
 * user-supplied moment produces.
 *
 * **The polar quantities exist only for the circle and the tube, and that
 * absence is the correct answer rather than a gap.** St Venant torsion of a
 * rectangular or open section needs shape-dependent factors; `I_x + I_y` for an
 * I-beam is a real number that is not the torsion constant, so printing it would
 * be the wrong quantity wearing the right name.
 *
 * The I-section formula assumes square flange-to-web corners with no root
 * fillet, so a rolled profile has slightly more area and slightly more `I` than
 * this — stated on the surface. Buckling, lateral-torsional buckling, local
 * stability and fatigue are outside the model entirely, and the stress ratio is
 * a ratio of two numbers with nothing written next to it: the allowable is the
 * user's, and this file does not know which code they are working to.
 */
export function sectionProperties(input: SectionInput): ProResult<SectionProperties> {
  const core = coreSection(input.shape);
  if (!core.ok) return core;

  const allowable = input.allowableStressMpa;
  if (allowable !== undefined && !isPositiveUpTo(allowable, 3000)) {
    return fail("allowableStress");
  }
  const bending = input.bendingMomentNm;
  if (bending !== undefined && !isInRange(bending, 0, 1e9)) return fail("bendingMoment");
  const torsion = input.torsionMomentNm;
  if (torsion !== undefined && !isInRange(torsion, 0, 1e9)) return fail("torsionMoment");

  // N*m to N*mm is a factor of 1000; W is in mm3 and the stress comes out in MPa.
  const bendingStressMpa = bending === undefined ? undefined : (bending * 1000) / core.wx;
  const polar = core.polar;
  return {
    ok: true,
    areaMm2: core.areaMm2,
    momentOfInertiaXMm4: core.ix,
    momentOfInertiaYMm4: core.iy,
    sectionModulusXMm3: core.wx,
    sectionModulusYMm3: core.wy,
    radiusOfGyrationXMm: Math.sqrt(core.ix / core.areaMm2),
    radiusOfGyrationYMm: Math.sqrt(core.iy / core.areaMm2),
    polar,
    allowableMomentNm: allowable === undefined ? undefined : (core.wx * allowable) / 1000,
    bendingStressMpa,
    stressRatio:
      bendingStressMpa === undefined ? undefined : ratioAgainst(bendingStressMpa, allowable),
    torsionalStressMpa:
      torsion === undefined || polar === undefined
        ? undefined
        : (torsion * 1000) / polar.modulusMm3,
  };
}

/* ========================================================================== *
 * Serija i paralela
 * ========================================================================== */

export type PassiveElement = "resistor" | "inductor" | "capacitor";
export type NetworkConnection = "series" | "parallel";

export interface NetworkInput {
  readonly element: PassiveElement;
  readonly connection: NetworkConnection;
  /** 1 to 32 values, each finite and not negative, in ohm, henry or farad. */
  readonly values: readonly number[];
}

export interface NetworkEquivalent {
  readonly equivalent: number;
  /** `equivalent` in engineering notation: mantissa in [1, 1000) and a multiple-of-3 exponent. */
  readonly mantissa: number;
  readonly exponent: number;
}

const engineering = (value: number): { readonly mantissa: number; readonly exponent: number } => {
  if (value === 0) return { mantissa: 0, exponent: 0 };
  const exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  return { mantissa: value / Math.pow(10, exponent), exponent };
};

/**
 * The equivalent of like elements in series or in parallel.
 *
 * **Capacitors are the dual of the other two, and a zero is where a naive
 * implementation divides by nothing.** Resistors and inductors add in series and
 * add reciprocally in parallel; capacitors do the reverse. In a parallel
 * resistance or inductance a single zero short-circuits the network, and in a
 * series capacitance a single zero blocks it — in both cases the answer is
 * exactly 0 and no reciprocal is evaluated at all. A zero anywhere else simply
 * contributes nothing. An empty list has no answer and says so.
 */
export function networkEquivalent(input: NetworkInput): ProResult<NetworkEquivalent> {
  const { element, connection, values } = input;
  if (values.length === 0) return fail("values");
  if (values.length > 32) return fail("tooManyValues");
  for (const value of values) {
    if (!isNonNegative(value)) return fail("values");
  }

  // The reciprocal connection is parallel for R and L, series for C.
  const reciprocal =
    element === "capacitor" ? connection === "series" : connection === "parallel";
  if (!reciprocal) {
    const sum = values.reduce((total, value) => total + value, 0);
    return { ok: true, equivalent: sum, ...engineering(sum) };
  }
  if (values.some((value) => value === 0)) {
    return { ok: true, equivalent: 0, ...engineering(0) };
  }
  const sumOfReciprocals = values.reduce((total, value) => total + 1 / value, 0);
  const equivalent = 1 / sumOfReciprocals;
  return { ok: true, equivalent, ...engineering(equivalent) };
}

export interface VoltageDividerInput {
  readonly inputVoltageV: number;
  /** Upper (source-side) resistor, ohm. */
  readonly upperOhm: number;
  /** Lower resistor, ohm — the output is taken across it. */
  readonly lowerOhm: number;
}

export interface VoltageDivider {
  readonly outputVoltageV: number;
  readonly currentA: number;
  readonly upperPowerW: number;
  readonly lowerPowerW: number;
  readonly totalPowerW: number;
  /**
   * The divider's Thevenin resistance, R1‖R2 — what a load sees looking back
   * into the two resistors. Present beside `outputVoltageV` on purpose: that
   * voltage is the UNLOADED figure, wrong the moment anything draws current
   * from the output, and this is the one extra number that makes the divider
   * an honest source rather than a figure that quietly stops being true.
   */
  readonly theveninResistanceOhm: number;
}

/**
 * An unloaded two-resistor divider: output, current and the power in each leg.
 *
 * The power per element is a computed quantity and is presented as a number:
 * this function compares it to no rated power, selects no resistor and says
 * nothing about whether a part will survive it. `totalPowerW` is `U*I`, which
 * must equal the two leg powers added — the implementation's own check on the
 * arithmetic. Unloaded: a load across the lower resistor changes everything here,
 * which is exactly why `theveninResistanceOhm` is returned alongside it.
 */
export function voltageDivider(input: VoltageDividerInput): ProResult<VoltageDivider> {
  const { inputVoltageV, upperOhm, lowerOhm } = input;
  if (!isInRange(inputVoltageV, 0, 1e6)) return fail("inputVoltage");
  if (!isNonNegative(upperOhm)) return fail("upper");
  if (!isNonNegative(lowerOhm)) return fail("lower");
  const total = upperOhm + lowerOhm;
  // Neither leg has an upper bound, so `total` can be positive yet small
  // enough that U/total overflows past the largest finite double — `quotient`
  // catches that the same way it catches the literal-zero divisor the old
  // `total === 0` check alone was written for.
  const currentA = quotient(inputVoltageV, total);
  if (currentA === undefined) return fail("total");
  return {
    ok: true,
    outputVoltageV: (inputVoltageV * lowerOhm) / total,
    currentA,
    upperPowerW: currentA * currentA * upperOhm,
    lowerPowerW: currentA * currentA * lowerOhm,
    totalPowerW: inputVoltageV * currentA,
    theveninResistanceOhm: (upperOhm * lowerOhm) / total,
  };
}

/* ========================================================================== *
 * Trofazna snaga
 * ========================================================================== */

/** Star or delta — it changes the phase read-out and nothing else. */
export type WindingConnection = "star" | "delta";

export interface ThreePhaseInput {
  readonly system: PhaseSystem;
  /** Line voltage for a three-phase system; simply the supply voltage for single-phase. */
  readonly lineVoltageV: number;
  readonly powerFactor: number;
  /** Give exactly one of these three. */
  readonly currentA?: number | undefined;
  readonly activePowerKw?: number | undefined;
  readonly apparentPowerKva?: number | undefined;
  readonly connection?: WindingConnection | undefined;
}

export interface ThreePhasePower {
  readonly apparentKva: number;
  readonly activeKw: number;
  readonly reactiveKvar: number;
  readonly currentA: number;
  readonly phaseDeg: number;
  readonly tanPhi: number;
  readonly phaseVoltageV: number;
  readonly phaseCurrentA: number;
}

/**
 * Apparent, active and reactive power and the line current, from any one of them.
 *
 * `sin(phi)` is taken as the non-negative root, so the reactive power comes back
 * as a magnitude: the tool states that it assumes an inductive load rather than
 * inventing a sign it cannot know from a power factor alone. Balanced,
 * symmetrical and sinusoidal throughout — with harmonics present these
 * identities stop holding, and the surface says so.
 *
 * The winding connection moves only the phase read-out: star divides the voltage
 * by sqrt(3) and leaves the current, delta does the opposite. The LINE
 * quantities are the same either way, which is the thing most often mixed up.
 */
export function threePhasePower(input: ThreePhaseInput): ProResult<ThreePhasePower> {
  const { system, lineVoltageV, powerFactor, currentA, activePowerKw, apparentPowerKva } = input;
  if (!isPositiveUpTo(lineVoltageV, 1e6)) return fail("voltage");
  if (!isPositiveUpTo(powerFactor, 1)) return fail("powerFactor");
  const given = [currentA, activePowerKw, apparentPowerKva].filter((v) => v !== undefined).length;
  if (given !== 1) return fail("known");

  const f3 = phaseFactor(system);
  let apparentVa: number;
  if (currentA !== undefined) {
    if (!isInRange(currentA, 0, 1e6)) return fail("current");
    apparentVa = f3 * lineVoltageV * currentA;
  } else if (activePowerKw !== undefined) {
    if (!isInRange(activePowerKw, 0, 1e6)) return fail("activePower");
    apparentVa = (activePowerKw * 1000) / powerFactor;
  } else {
    if (apparentPowerKva === undefined || !isInRange(apparentPowerKva, 0, 1e6)) {
      return fail("apparentPower");
    }
    apparentVa = apparentPowerKva * 1000;
  }

  const sinPhi = Math.sqrt(1 - powerFactor * powerFactor);
  const current = apparentVa / (f3 * lineVoltageV);
  const star = (input.connection ?? "star") === "star";
  return {
    ok: true,
    apparentKva: apparentVa / 1000,
    activeKw: (apparentVa * powerFactor) / 1000,
    reactiveKvar: (apparentVa * sinPhi) / 1000,
    currentA: current,
    phaseDeg: Math.acos(powerFactor) * DEG_PER_RAD,
    tanPhi: sinPhi / powerFactor,
    phaseVoltageV: system === "three" && star ? lineVoltageV / SQRT3 : lineVoltageV,
    phaseCurrentA: system === "three" && !star ? current / SQRT3 : current,
  };
}

/* ========================================================================== *
 * Moment i snaga
 * ========================================================================== */

/** Exact through the defining kilogram-force: 1 kgf*m = 9.80665 N*m. */
const KGF_M_IN_NM = G_N;
/** Exact through lb, ft and g_n; no measurement enters it. 1.3558179483314003 N*m. */
const LBF_FT_IN_NM = POUND_IN_KG * G_N * FOOT_IN_M;
/** Metric horsepower (KS) is defined as 75 kgf*m/s — exactly 735.49875 W. */
const METRIC_HP_IN_W = 75 * G_N;
/** Mechanical horsepower is defined as 550 lbf*ft/s — 745.6998715822702 W. */
const MECHANICAL_HP_IN_W = 550 * LBF_FT_IN_NM;

export interface TorqueSpeedPowerInput {
  /** N*m. Give exactly two of torque, speed and power. */
  readonly torqueNm?: number | undefined;
  /** min^-1. Give this OR the angular velocity, never both. */
  readonly speedRpm?: number | undefined;
  readonly angularVelocityRadS?: number | undefined;
  /** Watts. */
  readonly powerW?: number | undefined;
}

export interface TorqueSpeedPower {
  readonly torqueNm: number;
  readonly torqueKgfM: number;
  readonly torqueLbfFt: number;
  readonly speedRpm: number;
  readonly angularVelocityRadS: number;
  readonly powerW: number;
  readonly powerKw: number;
  readonly powerMetricHp: number;
  readonly powerMechanicalHp: number;
}

/**
 * The third of torque, speed and power from the other two, in every unit.
 *
 * The identity is `P = M*omega` with omega in rad/s, so the familiar
 * `M = 30000*P[kW]/(pi*n)` is not a rule of thumb — the 30/pi is `60/(2*pi)`
 * exactly. Everything is computed in SI and converted only for display, so a
 * round trip through kgf*m or hp returns the same double it started with.
 *
 * Two combinations have no answer and are refused by name rather than returned
 * as infinity: power at zero speed (the torque is unbounded), and power with
 * zero torque (the speed is). Zero torque WITH a speed is fine and gives zero
 * power — a shaft turning against nothing.
 */
export function torqueSpeedPower(input: TorqueSpeedPowerInput): ProResult<TorqueSpeedPower> {
  const { torqueNm, speedRpm, angularVelocityRadS, powerW } = input;
  if (speedRpm !== undefined && angularVelocityRadS !== undefined) return fail("speed");
  if (torqueNm !== undefined && !isInRange(torqueNm, 0, 1e9)) return fail("torque");
  if (powerW !== undefined && !isInRange(powerW, 0, 1e9)) return fail("power");

  // n and omega are ONE quantity in two units, not two of the three fields, so
  // they are folded into one optional and checked against the SAME 0 < n <= 1e6
  // band — by converting an angular velocity to rpm first and reusing the one
  // existing guard, rather than giving omega its own (looser) ceiling. Without
  // this, 1e9 rad/s passed as `isPositive` alone and returned an n nine orders
  // past the declared limit.
  let speed: { readonly rpm: number; readonly omega: number } | undefined;
  if (speedRpm !== undefined) {
    if (!isPositiveUpTo(speedRpm, 1e6)) return fail("speed");
    speed = { rpm: speedRpm, omega: (2 * Math.PI * speedRpm) / 60 };
  } else if (angularVelocityRadS !== undefined) {
    const rpmFromOmega = (30 * angularVelocityRadS) / Math.PI;
    if (!isPositiveUpTo(rpmFromOmega, 1e6)) return fail("speed");
    speed = { rpm: rpmFromOmega, omega: angularVelocityRadS };
  }
  const given = [torqueNm !== undefined, speed !== undefined, powerW !== undefined];
  if (given.filter(Boolean).length !== 2) return fail("pair");

  let torque: number;
  let power: number;
  let rpm: number;
  let omega: number;
  if (speed !== undefined) {
    rpm = speed.rpm;
    omega = speed.omega;
    if (torqueNm !== undefined) {
      torque = torqueNm;
      power = powerW ?? torqueNm * omega;
    } else {
      // Exactly one of torque/power is given alongside a speed (the `given`
      // check above), so powerW is defined here. A valid power over a valid
      // but extremely slow speed can still overflow M = P/omega past any
      // finite double, which a bare division would never have refused.
      const powerValue = powerW ?? 0;
      const derivedTorque = quotient(powerValue, omega);
      if (derivedTorque === undefined) return fail("power");
      torque = derivedTorque;
      power = powerValue;
    }
  } else {
    torque = torqueNm ?? 0;
    power = powerW ?? 0;
    // Power with no torque puts the speed beyond any finite number — whether
    // the torque is exactly zero (the 0/0 a zero power would otherwise sneak
    // through as NaN) or merely too small for the power to reach without an
    // unrepresentable speed.
    const derivedOmega = quotient(power, torque);
    if (derivedOmega === undefined) return fail("torque");
    omega = derivedOmega;
    rpm = (30 * omega) / Math.PI;
  }
  return {
    ok: true,
    torqueNm: torque,
    torqueKgfM: torque / KGF_M_IN_NM,
    torqueLbfFt: torque / LBF_FT_IN_NM,
    speedRpm: rpm,
    angularVelocityRadS: omega,
    powerW: power,
    powerKw: power / 1000,
    powerMetricHp: power / METRIC_HP_IN_W,
    powerMechanicalHp: power / MECHANICAL_HP_IN_W,
  };
}
