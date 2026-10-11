/**
 * „Elektro" — the arithmetic behind the electrician's toolkit.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains.
 * The tools here are the ones an electrician reaches for that
 * `pro/inzenjering.ts` does not already carry: what a load costs to run, how
 * much light a room needs and how far apart the fittings may hang, a
 * transformer's two full-load currents, how full a conduit may be, and what a
 * motor draws while it starts.
 *
 * **Where a tool's answer can hurt somebody, the tool states a QUANTITY and
 * stops.** `transformerCurrent`, `conduitFill` and `motorStartingCurrent` are
 * `life-safety`: they return areas, currents and ratios, and where the user
 * types a limit of their
 * own the answer carries `ratioAgainst` and nothing else — no `passes`, no
 * severity, no word about whether an installation is acceptable. Which number is
 * the rule, and whether it applies to this installation, is the licensed
 * electrician's judgement and is the thing the notice exists to leave with them.
 *
 * **Two of these tools take design coefficients as INPUTS and give them no
 * default.** A luminaire's utilisation factor, a space's maintenance factor and
 * the spacing-to-height ratio are published per fitting and per room index;
 * embedding one would be this app asserting a number for a fitting it has never
 * seen. They are echoed back with the answer so the arithmetic can be checked.
 */

import {
  ceilSnapped,
  fail,
  isInRange,
  isIntegerIn,
  isPositive,
  quotient,
  ratioAgainst,
  type ProResult,
} from "./result.js";

/** sqrt(3), the line-to-phase factor of a balanced three-phase system. */
const SQRT3 = Math.sqrt(3);

/** Watts in a kilowatt — the SI prefix, nothing measured. */
const W_PER_KW = 1000;

/** How many phases a supply has. The same pair `PhaseSystem` names elsewhere. */
export type SupplyPhases = "single" | "three";

/* -------------------------------------------------------------------------- */
/* energy-cost — cena potrošnje                                                 */
/* -------------------------------------------------------------------------- */

export interface EnergyCostInput {
  /** Nameplate or measured power of the load, W. */
  readonly powerW: number;
  /** Hours the load runs per day, h. A duty cycle is applied on top of this. */
  readonly hoursPerDay: number;
  /** Days in the period, a whole number. 365 is a year; 30 a month. */
  readonly days: number;
  /** Price of a kilowatt-hour, in the user's currency. The market's number, not ours. */
  readonly pricePerKwh: number;
  /**
   * Share of those hours the load actually draws full power, %. Absent means
   * 100 and the surface says so; a thermostat, a fridge and a welder all need a
   * number this app cannot know.
   */
  readonly dutyPercent?: number | undefined;
}

export interface EnergyCostResult {
  readonly dutyPercentUsed: number;
  /** The same power the bill is computed from, after the duty cycle, W. */
  readonly effectivePowerW: number;
  readonly hoursTotal: number;
  /** `P·t`, kWh. */
  readonly energyKwh: number;
  readonly energyPerDayKwh: number;
  readonly cost: number;
  readonly costPerDay: number;
}

/**
 * What a load costs to run over a period, from `E = P·t`.
 *
 * The duty cycle is applied to the POWER once and never to the hours as well:
 * a load at 50 % for eight hours has drawn four hours' worth of energy, and
 * multiplying both terms by the duty would square it. The price has no default
 * and is not a rate this file knows — it is the tariff on the user's bill.
 */
export function energyCost(input: EnergyCostInput): ProResult<EnergyCostResult> {
  const { powerW, hoursPerDay, days, pricePerKwh } = input;
  if (!isInRange(powerW, 0.01, 1e8)) return fail("power");
  if (!isInRange(hoursPerDay, 0.01, 24)) return fail("hoursPerDay");
  if (!isIntegerIn(days, 1, 3660)) return fail("days");
  if (!isInRange(pricePerKwh, 0, 1e6)) return fail("price");
  const duty = input.dutyPercent ?? 100;
  if (!isInRange(duty, 0, 100)) return fail("duty");

  const effectivePowerW = (powerW * duty) / 100;
  const energyPerDayKwh = (effectivePowerW * hoursPerDay) / W_PER_KW;
  const energyKwh = energyPerDayKwh * days;
  return {
    ok: true,
    dutyPercentUsed: duty,
    effectivePowerW,
    hoursTotal: hoursPerDay * days,
    energyKwh,
    energyPerDayKwh,
    cost: energyKwh * pricePerKwh,
    costPerDay: energyPerDayKwh * pricePerKwh,
  };
}

/* -------------------------------------------------------------------------- */
/* lighting-count — broj svetiljki                                              */
/* -------------------------------------------------------------------------- */

export interface LightingCountInput {
  /** Floor area served by the fittings, m². */
  readonly areaM2: number;
  /**
   * Illuminance wanted, lx. `regulated` in spirit: the recommended level for a
   * task is fixed by a standard or a rule the user is working to, so it is an
   * input with no default and the surface says whose number it is.
   */
  readonly targetLux: number;
  /** Luminous flux of one fitting, lm — from its datasheet. */
  readonly luminaireLumens: number;
  /** Utilisation factor, 0.1–1: the share of flux that reaches the work plane. */
  readonly utilisationFactor: number;
  /** Maintenance factor, 0.1–1: what dirt and lamp ageing leave of it. */
  readonly maintenanceFactor: number;
}

export interface LightingCountResult {
  /** `E·A/(UF·MF)`, lm — the flux that must reach the room with the losses counted. */
  readonly requiredLumens: number;
  /** Whole fittings, rounded UP: half a fitting lights half a room. */
  readonly luminaireCount: number;
  readonly installedLumens: number;
  /** What those fittings deliver, `N·Φ·UF·MF/A`, lx. */
  readonly achievedLux: number;
  /** Achieved over the target, a ratio of the two numbers and nothing more. */
  readonly luxRatio: number | undefined;
}

/**
 * The lumen method: how many fittings a room needs for an illuminance target.
 *
 * `N = E·A/(Φ·UF·MF)`, the defining relation of the method. It is deliberately
 * the SIMPLEST form: no room index and no per-surface reflectances, because
 * those feed the utilisation factor, and the factor is an input here. The count
 * is rounded up and never down, and the achieved illuminance is reported beside
 * the target as a quantity — whether it is the right level for the task is what
 * the standard the user is working to decides.
 */
export function lightingCount(input: LightingCountInput): ProResult<LightingCountResult> {
  const { areaM2, targetLux, luminaireLumens, utilisationFactor, maintenanceFactor } = input;
  if (!isPositive(areaM2) || areaM2 > 1e6) return fail("area");
  if (!isInRange(targetLux, 1, 100000)) return fail("targetLux");
  if (!isInRange(luminaireLumens, 1, 1e7)) return fail("luminaireLumens");
  if (!isInRange(utilisationFactor, 0.1, 1)) return fail("utilisationFactor");
  if (!isInRange(maintenanceFactor, 0.1, 1)) return fail("maintenanceFactor");

  const divisor = utilisationFactor * maintenanceFactor;
  const requiredLumens = quotient(targetLux * areaM2, divisor);
  if (requiredLumens === undefined) return fail("utilisationFactor");
  const luminaireCount = ceilSnapped(requiredLumens / luminaireLumens);
  if (!Number.isFinite(luminaireCount) || luminaireCount < 1) return fail("luminaireLumens");
  const achievedLux = (luminaireCount * luminaireLumens * divisor) / areaM2;
  return {
    ok: true,
    requiredLumens,
    luminaireCount,
    installedLumens: luminaireCount * luminaireLumens,
    achievedLux,
    luxRatio: ratioAgainst(achievedLux, targetLux),
  };
}

/* -------------------------------------------------------------------------- */
/* luminaire-spacing — razmak svetiljki                                         */
/* -------------------------------------------------------------------------- */

export interface LuminaireSpacingInput {
  /**
   * Spacing-to-height ratio, from the fitting's own photometric data. No
   * default: 0.6 and 1.5 describe different fittings, not a setting.
   */
  readonly spacingToHeightRatio: number;
  /** Mounting height above the floor, m. */
  readonly mountingHeightM: number;
  /** Height of the work plane above the floor, m — 0.85 for a desk is the user's figure. */
  readonly workPlaneHeightM: number;
  /** Room length along the row, m — for the count of fittings along it. */
  readonly roomLengthM: number;
  /** Room width across the rows, m — for the count of rows. */
  readonly roomWidthM: number;
}

export interface LuminaireSpacingResult {
  /** `S = SHR·(h − h_wp)`, the greatest centre-to-centre spacing the fitting allows, m. */
  readonly maxSpacingM: number;
  /** Height above the work plane the ratio was applied to, m. */
  readonly heightAboveWorkPlaneM: number;
  readonly countAlong: number;
  readonly countAcross: number;
  readonly totalCount: number;
}

/**
 * The greatest spacing between fittings, from the spacing-to-height ratio.
 *
 * `S = SHR·h'` with `h'` the height above the WORK PLANE and not above the
 * floor — the ratio is measured from the surface being lit, which is the part
 * most often taken from the ceiling. The counts are `ceil(length/spacing)` on
 * each axis, which is the smallest grid that stays inside the ratio.
 */
export function luminaireSpacing(input: LuminaireSpacingInput): ProResult<LuminaireSpacingResult> {
  const {
    spacingToHeightRatio: shr,
    mountingHeightM,
    workPlaneHeightM,
    roomLengthM,
    roomWidthM,
  } = input;
  if (!isInRange(shr, 0.1, 3)) return fail("spacingToHeightRatio");
  if (!isInRange(mountingHeightM, 0.5, 50)) return fail("mountingHeight");
  if (!isInRange(workPlaneHeightM, 0, 49)) return fail("workPlane");
  if (!isInRange(roomLengthM, 0.1, 1000)) return fail("roomLength");
  if (!isInRange(roomWidthM, 0.1, 1000)) return fail("roomWidth");
  const height = mountingHeightM - workPlaneHeightM;
  if (height <= 0) return fail("workPlane");
  const maxSpacingM = shr * height;
  if (maxSpacingM <= 0) return fail("spacingToHeightRatio");
  return {
    ok: true,
    maxSpacingM,
    heightAboveWorkPlaneM: height,
    countAlong: ceilSnapped(roomLengthM / maxSpacingM),
    countAcross: ceilSnapped(roomWidthM / maxSpacingM),
    totalCount: ceilSnapped(roomLengthM / maxSpacingM) * ceilSnapped(roomWidthM / maxSpacingM),
  };
}

/* -------------------------------------------------------------------------- */
/* transformer-current — struja transformatora                                  */
/* -------------------------------------------------------------------------- */

export interface TransformerCurrentInput {
  /** Rated apparent power, kVA. */
  readonly apparentPowerKva: number;
  /** Line voltage of the primary winding, V. */
  readonly primaryVoltageV: number;
  /** Line voltage of the secondary winding, V. */
  readonly secondaryVoltageV: number;
  readonly phases: SupplyPhases;
}

export interface TransformerCurrentResult {
  /** S in VA — the same power in the unit the formula works in. */
  readonly apparentPowerVa: number;
  readonly phaseFactor: number;
  readonly primaryCurrentA: number;
  readonly secondaryCurrentA: number;
}

/**
 * Full-load currents of a two-winding transformer from its kVA rating.
 *
 * `S = √3·U·I` for a three-phase winding and `S = U·I` for a single-phase one, so
 * `I = S/(√3·U)` and `I = S/U` respectively. `√3` is the line-to-phase factor of
 * a balanced system and is returned so the branch that ran is visible. These are
 * the currents the transformer's own losses and the protection are sized
 * against — the tool states them and says nothing about whether a particular
 * breaker or cable suits them.
 */
export function transformerCurrent(
  input: TransformerCurrentInput,
): ProResult<TransformerCurrentResult> {
  const { apparentPowerKva, primaryVoltageV, secondaryVoltageV, phases } = input;
  if (!isInRange(apparentPowerKva, 0.01, 1e6)) return fail("apparentPower");
  if (!isInRange(primaryVoltageV, 1, 1e6)) return fail("primaryVoltage");
  if (!isInRange(secondaryVoltageV, 1, 1e6)) return fail("secondaryVoltage");
  const factor = phases === "three" ? SQRT3 : 1;
  const apparentPowerVa = apparentPowerKva * 1000;
  const primary = quotient(apparentPowerVa, factor * primaryVoltageV);
  const secondary = quotient(apparentPowerVa, factor * secondaryVoltageV);
  if (primary === undefined) return fail("primaryVoltage");
  if (secondary === undefined) return fail("secondaryVoltage");
  return {
    ok: true,
    apparentPowerVa,
    phaseFactor: factor,
    primaryCurrentA: primary,
    secondaryCurrentA: secondary,
  };
}

/* -------------------------------------------------------------------------- */
/* conduit-fill — ispuna cevi                                                   */
/* -------------------------------------------------------------------------- */

export interface ConduitFillInput {
  /** INTERNAL diameter of the conduit, mm — the bore, not the trade size. */
  readonly conduitInnerDiameterMm: number;
  /** Overall diameter of one conductor as installed, mm. */
  readonly conductorDiameterMm: number;
  /** How many conductors of that diameter are pulled in. */
  readonly conductorCount: number;
  /**
   * The fill limit the user is working to, %. `regulated` in spirit: it is a
   * percentage out of an installation code, so it is an input with no default.
   */
  readonly fillLimitPercent?: number | undefined;
}

export interface ConduitFillResult {
  readonly conduitAreaMm2: number;
  readonly conductorsAreaMm2: number;
  /** `Σa/A`, %. */
  readonly fillPercent: number;
  readonly remainingAreaMm2: number;
  /** Fill over the user's own limit — a ratio, never a verdict. */
  readonly fillRatio: number | undefined;
}

/**
 * How much of a conduit's bore a bundle of round conductors occupies.
 *
 * `fill = Σ(π·d²/4)/(π·D²/4) = Σd²/D²`, the ratio of circle areas — the geometry
 * and nothing else. Real jamming and pulling tension are not visible here, so
 * this is the arithmetic under the code's percentage and not a substitute for
 * it; the limit is the user's and its ratio is reported beside the figure.
 */
export function conduitFill(input: ConduitFillInput): ProResult<ConduitFillResult> {
  const { conduitInnerDiameterMm, conductorDiameterMm, conductorCount } = input;
  if (!isInRange(conduitInnerDiameterMm, 1, 1000)) return fail("conduitDiameter");
  if (!isInRange(conductorDiameterMm, 0.1, 1000)) return fail("conductorDiameter");
  if (!isIntegerIn(conductorCount, 1, 500)) return fail("conductorCount");
  if (input.fillLimitPercent !== undefined && !isInRange(input.fillLimitPercent, 1, 100)) {
    return fail("fillLimit");
  }
  if (conductorDiameterMm >= conduitInnerDiameterMm) return fail("conductorDiameter");

  const conduitAreaMm2 = (Math.PI * conduitInnerDiameterMm * conduitInnerDiameterMm) / 4;
  const conductorsAreaMm2 =
    (conductorCount * Math.PI * conductorDiameterMm * conductorDiameterMm) / 4;
  const fillPercent = quotient(100 * conductorsAreaMm2, conduitAreaMm2);
  if (fillPercent === undefined) return fail("conduitDiameter");
  return {
    ok: true,
    conduitAreaMm2,
    conductorsAreaMm2,
    fillPercent,
    remainingAreaMm2: conduitAreaMm2 - conductorsAreaMm2,
    fillRatio: ratioAgainst(fillPercent, input.fillLimitPercent),
  };
}

/* -------------------------------------------------------------------------- */
/* motor-starting-current — struja pokretanja motora                            */
/* -------------------------------------------------------------------------- */

export const START_METHODS = ["dol", "starDelta", "soft"] as const;

export type StartMethod = (typeof START_METHODS)[number];

export interface MotorStartingInput {
  /** Rated (full-load) line current from the nameplate, A. */
  readonly ratedCurrentA: number;
  /**
   * Locked-rotor current over rated current, `I_LR/I_N` — the `k` on the
   * nameplate or in the motor's data sheet. Never guessed here: 4 and 8 describe
   * different machines.
   */
  readonly startingRatio: number;
  readonly method: StartMethod;
  /**
   * Soft starter's initial voltage, % of line voltage — `soft` only. The current
   * falls roughly with the voltage and the torque with its square.
   */
  readonly softStartPercent?: number | undefined;
}

export interface MotorStartingResult {
  /** `k·I_N` — what the motor draws at standstill on a direct-on-line start, A. */
  readonly lockedRotorCurrentA: number;
  /** What the chosen method actually draws, A. */
  readonly startingCurrentA: number;
  /** Starting current over the rated current, for the repeated reading. */
  readonly startingRatio: number;
  /** The share of the direct-on-line starting torque the method leaves, 0..1. */
  readonly torqueShare: number;
  /** The soft starter's voltage, echoed, or undefined for the two switching methods. */
  readonly softStartPercentUsed: number | undefined;
}

/**
 * Starting current of an induction motor under the three ordinary methods.
 *
 * `I_s = k·I_N` direct on line. **Star–delta divides the line current by three**
 * and the starting torque by the same three, because each winding sees `1/√3` of
 * its voltage and the phase current falls with it while the line current falls
 * again through the star connection — `(1/√3)² = 1/3` is the whole result. A
 * soft starter at `p` % of line voltage draws about `p` % of the current and
 * leaves `(p/100)²` of the torque, the two being the same voltage law.
 *
 * This is an estimate from nameplate figures and not a starting study: the
 * network's impedance, the motor's own locked-rotor characteristics and the
 * load's torque curve all lie outside it, and the surface says so.
 */
export function motorStartingCurrent(input: MotorStartingInput): ProResult<MotorStartingResult> {
  const { ratedCurrentA, startingRatio: k, method } = input;
  if (!isInRange(ratedCurrentA, 0.01, 10000)) return fail("ratedCurrent");
  if (!isInRange(k, 1, 20)) return fail("startingRatio");
  const lockedRotorCurrentA = ratedCurrentA * k;
  if (method === "soft") {
    const p = input.softStartPercent;
    if (!isInRange(p, 10, 100)) return fail("softStart");
    return {
      ok: true,
      lockedRotorCurrentA,
      startingCurrentA: (lockedRotorCurrentA * p) / 100,
      startingRatio: (k * p) / 100,
      torqueShare: (p / 100) * (p / 100),
      softStartPercentUsed: p,
    };
  }
  if (input.softStartPercent !== undefined) return fail("softStart");
  const share = method === "starDelta" ? 1 / 3 : 1;
  return {
    ok: true,
    lockedRotorCurrentA,
    startingCurrentA: lockedRotorCurrentA * share,
    startingRatio: k * share,
    torqueShare: share,
    softStartPercentUsed: undefined,
  };
}

