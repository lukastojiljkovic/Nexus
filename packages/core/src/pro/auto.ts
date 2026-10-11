/**
 * „Auto" — the arithmetic behind the car mechanic's toolkit.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains.
 * What is here is the engine and chassis arithmetic `pro/transport.ts` does not
 * already carry: swept volume and compression ratio, mean piston speed, the
 * injector a power target needs, air–fuel ratio and lambda, and what a wheel's
 * offset and width do to where its faces sit.
 *
 * **Four tools that would have lived here already exist and are deliberately
 * absent.** `speedometer-tyre-deviation` (`transport`) computes a tyre's outer
 * diameter, rolling circumference and the speedometer error a size change makes;
 * `gear-ratio-road-speed` (`transport`) ties gearbox, final drive and rolling
 * circumference to road speed at an engine speed; `fuel-consumption-cost`
 * (`transport`) converts l/100 km ↔ km/l ↔ mpg US ↔ mpg Imperial; and
 * `torque-speed-power` (`inzenjering`) already reports N·m, kgf·m and lbf·ft
 * beside kW and both horsepowers. Rebuilding any of the four here would be the
 * second copy of one specification — the defect `docs/defect-classes.md` calls
 * out by name.
 *
 * **Two figures here are rated against a limit the user types**, and both are
 * `life-safety` in spirit even where the class is `none`: mean piston speed
 * against a build limit and compression ratio against a fuel's tolerance are
 * quantities this tool states and never judges. The limits have no default.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isPositive,
  quotient,
  ratioAgainst,
  type ProResult,
} from "./result.js";

/** The international inch, mm — exact by the 1959 agreement. */
const MM_PER_INCH = 25.4;
/** The international pound, kg — exact by the same agreement. */
const POUND_IN_KG = 0.45359237;

/* -------------------------------------------------------------------------- */
/* engine-displacement — radna zapremina                                        */
/* -------------------------------------------------------------------------- */

export interface DisplacementInput {
  /** Cylinder bore, mm. */
  readonly boreMm: number;
  /** Piston stroke, mm. */
  readonly strokeMm: number;
  /** Number of cylinders. */
  readonly cylinders: number;
}

export interface DisplacementResult {
  /** `π/4·b²·s` for one cylinder, cm³. */
  readonly perCylinderCc: number;
  /** `V_h·n`, cm³ — what a catalogue calls „1 598 cm³". */
  readonly totalCc: number;
  /** The same volume in litres, which is what the badge says. */
  readonly totalLitres: number;
  /** The bore and stroke diameter-to-stroke ratio, for the oversquare/undersquare read. */
  readonly boreStrokeRatio: number;
}

/**
 * Swept volume from bore, stroke and cylinder count.
 *
 * `V_h = π/4·b²·s` per cylinder and `V = V_h·n` in total — the volume a piston
 * sweeps, which is the volume of a cylinder of the bore's diameter and the
 * stroke's length. Millimetres cubed are cubic centimetres divided by a thousand,
 * so the conversion is written once, in one place, in the same expression.
 */
export function engineDisplacement(input: DisplacementInput): ProResult<DisplacementResult> {
  const { boreMm, strokeMm, cylinders } = input;
  if (!isInRange(boreMm, 10, 400)) return fail("bore");
  if (!isInRange(strokeMm, 10, 400)) return fail("stroke");
  if (!isIntegerIn(cylinders, 1, 16)) return fail("cylinders");
  const perCylinderCc = (Math.PI * boreMm * boreMm * strokeMm) / 4000;
  const totalCc = perCylinderCc * cylinders;
  return {
    ok: true,
    perCylinderCc,
    totalCc,
    totalLitres: totalCc / 1000,
    boreStrokeRatio: boreMm / strokeMm,
  };
}

/* -------------------------------------------------------------------------- */
/* compression-ratio — stepen kompresije                                        */
/* -------------------------------------------------------------------------- */

export interface CompressionRatioInput {
  readonly boreMm: number;
  readonly strokeMm: number;
  /** Combustion chamber volume as measured or quoted, cm³ — with the valves closed. */
  readonly chamberVolumeCc: number;
  /** Head gasket volume at its compressed thickness, cm³. Absent means 0. */
  readonly gasketVolumeCc?: number | undefined;
  /** Piston deck clearance volume, cm³. Absent means 0. */
  readonly deckVolumeCc?: number | undefined;
  /** Piston crown volume, cm³: positive for a dish, negative for a dome. Absent means 0. */
  readonly pistonVolumeCc?: number | undefined;
}

export interface CompressionRatioResult {
  readonly sweptVolumeCc: number;
  /** `V_c = chamber + gasket + deck + piston`, cm³. */
  readonly clearanceVolumeCc: number;
  /** `(V_h + V_c)/V_c`. */
  readonly compressionRatio: number;
}

/**
 * Compression ratio from the swept and clearance volumes.

 * `CR = (V_h + V_c)/V_c`, the defining relation: the cylinder's volume with the
 * piston at bottom dead centre over its volume at top dead centre. `V_c` is the
 * SUM of what is above the piston crown and not one of them — a gasket's
 * thickness and a deck clearance each add volume, and a domed piston subtracts
 * it, which is why the piston term is signed and its hint says so.
 *
 * One cylinder's swept volume is what the ratio is defined on, and it is
 * computed here from the same bore and stroke as `engineDisplacement` rather
 * than taken from it, because a ratio that carried the whole engine's volume
 * would be off by the cylinder count.
 */
export function compressionRatio(
  input: CompressionRatioInput,
): ProResult<CompressionRatioResult> {
  const { boreMm, strokeMm, chamberVolumeCc, gasketVolumeCc, deckVolumeCc, pistonVolumeCc } = input;
  if (!isInRange(boreMm, 10, 400)) return fail("bore");
  if (!isInRange(strokeMm, 10, 400)) return fail("stroke");
  if (!isInRange(chamberVolumeCc, 0.5, 1000)) return fail("chamberVolume");
  for (const [value, reason] of [
    [gasketVolumeCc, "gasketVolume"],
    [deckVolumeCc, "deckVolume"],
    [pistonVolumeCc, "pistonVolume"],
  ] as const) {
    if (value !== undefined && !isInRange(value, -500, 500)) return fail(reason);
  }
  const sweptVolumeCc = (Math.PI * boreMm * boreMm * strokeMm) / 4000;
  const clearanceVolumeCc =
    chamberVolumeCc + (gasketVolumeCc ?? 0) + (deckVolumeCc ?? 0) + (pistonVolumeCc ?? 0);
  if (!isPositive(clearanceVolumeCc)) return fail("clearanceVolume");
  return {
    ok: true,
    sweptVolumeCc,
    clearanceVolumeCc,
    compressionRatio: (sweptVolumeCc + clearanceVolumeCc) / clearanceVolumeCc,
  };
}

/* -------------------------------------------------------------------------- */
/* mean-piston-speed — brzina klipa                                             */
/* -------------------------------------------------------------------------- */

export interface PistonSpeedInput {
  readonly strokeMm: number;
  readonly rpm: number;
  /** The build's own limit, m/s. `regulated` in spirit — it comes from the engine's design. */
  readonly limitMs?: number | undefined;
}

export interface PistonSpeedResult {
  /** `2·s·n/60`, m/s — the stroke travelled twice per revolution. */
  readonly meanPistonSpeedMs: number;
  /** The same figure in feet per minute, the drag-racing unit. */
  readonly meanPistonSpeedFpm: number;
  /** `2·s` over 1000, per 1000 rpm, which is the engine's own constant. */
  readonly speedPer1000RpmMs: number;
  readonly speedRatio: number | undefined;
}

/**
 * Mean piston speed: `v̄ = 2·s·n/60`, in m/s.
 *
 * The piston covers the stroke twice every revolution, so the mean speed is that
 * distance over the time of one revolution. It is the number that describes how
 * fast an engine's internals are working and it is the reason a stroker build
 * hits its limit before a short-stroke one at the same rpm. A limit the user
 * types comes back as a ratio and nothing more.
 */
export function meanPistonSpeed(input: PistonSpeedInput): ProResult<PistonSpeedResult> {
  const { strokeMm, rpm, limitMs } = input;
  if (!isInRange(strokeMm, 10, 400)) return fail("stroke");
  if (!isInRange(rpm, 100, 30000)) return fail("rpm");
  if (limitMs !== undefined && !isInRange(limitMs, 1, 60)) return fail("limit");
  const strokeM = strokeMm / 1000;
  const meanPistonSpeedMs = (2 * strokeM * rpm) / 60;
  return {
    ok: true,
    meanPistonSpeedMs,
    meanPistonSpeedFpm: meanPistonSpeedMs * (1000 / MM_PER_INCH / 12) * 60,
    speedPer1000RpmMs: (2 * strokeM * 1000) / 60,
    speedRatio: ratioAgainst(meanPistonSpeedMs, limitMs),
  };
}

/* -------------------------------------------------------------------------- */
/* injector-flow — protok dizni                                                 */
/* -------------------------------------------------------------------------- */

export interface InjectorFlowInput {
  /** Crankshaft power the engine is built for, kW. */
  readonly targetPowerKw: number;
  /**
   * Brake-specific fuel consumption, g/kWh — the engine family's own figure,
   * from a dyno sheet or a build sheet. 0,50 gasoline and 0,22 diesel are
   * different machines; nothing here guesses which one this is.
   */
  readonly bsfcGKwh: number;
  readonly cylinders: number;
  /** The most of the injector's time the build may use, %. 80 is the usual figure and the user's own. */
  readonly maxDutyPercent: number;
  /** Fuel density at the working temperature, kg/l. Never assumed. */
  readonly fuelDensityKgPerL: number;
}

export interface InjectorFlowResult {
  /** `P·BSFC`, kg/h over the whole engine. */
  readonly fuelMassFlowKgPerH: number;
  readonly fuelVolumeFlowLPerH: number;
  /** Per injector, at the duty cycle asked for: `engine flow/n ÷ duty`. */
  readonly injectorFlowLPerH: number;
  readonly injectorFlowCcPerMin: number;
  /** The same injector in the unit injectors are sold in, lb/h. */
  readonly injectorFlowLbPerH: number;
  readonly dutyPercentUsed: number;
}

/**
 * The injector a power target needs, from the engine's own BSFC.
 *
 * `ṁ = P·BSFC` for the whole engine, then `ṁ/n` per injector and `÷ duty` for
 * what the injector must be able to deliver in the share of the cycle it is open
 * — a 10 ms/100 ms injector must flow ten times the average. The pound is the
 * exact 1959 definition, so lb/h and cc/min never disagree about an injector.
 *
 * This sizes an injector and says nothing about whether the fuel system, the
 * pump or the tune can carry it, which the surface states.
 */
export function injectorFlow(input: InjectorFlowInput): ProResult<InjectorFlowResult> {
  const { targetPowerKw, bsfcGKwh, cylinders, maxDutyPercent, fuelDensityKgPerL } = input;
  if (!isInRange(targetPowerKw, 0.1, 5000)) return fail("targetPower");
  if (!isInRange(bsfcGKwh, 50, 1000)) return fail("bsfc");
  if (!isIntegerIn(cylinders, 1, 16)) return fail("cylinders");
  if (!isInRange(maxDutyPercent, 10, 100)) return fail("duty");
  if (!isInRange(fuelDensityKgPerL, 0.5, 1.5)) return fail("fuelDensity");

  // g/kWh × kW = g/h; ÷ 1000 is kg/h.
  const fuelMassFlowKgPerH = (targetPowerKw * bsfcGKwh) / 1000;
  const fuelVolumeFlowLPerH = quotient(fuelMassFlowKgPerH, fuelDensityKgPerL);
  if (fuelVolumeFlowLPerH === undefined) return fail("fuelDensity");
  const injectorFlowLPerH = fuelVolumeFlowLPerH / cylinders / (maxDutyPercent / 100);
  const injectorFlowCcPerMin = (injectorFlowLPerH * 1000) / 60;
  return {
    ok: true,
    fuelMassFlowKgPerH,
    fuelVolumeFlowLPerH,
    injectorFlowLPerH,
    injectorFlowCcPerMin,
    injectorFlowLbPerH: injectorFlowLPerH * fuelDensityKgPerL / POUND_IN_KG,
    dutyPercentUsed: maxDutyPercent,
  };
}

/* -------------------------------------------------------------------------- */
/* air-fuel-ratio — odnos vazduh-gorivo                                         */
/* -------------------------------------------------------------------------- */

export type AfrMode = "afrFromMasses" | "fuelForTarget";

export interface AfrInput {
  readonly mode: AfrMode;
  /** Air drawn in, g. */
  readonly airMassG: number;
  /** Fuel burnt, g — required in `afrFromMasses`. */
  readonly fuelMassG?: number | undefined;
  /** The ratio wanted, by mass — required in `fuelForTarget`. */
  readonly targetAfr?: number | undefined;
  /** The fuel's stoichiometric ratio, by mass — petrol ≈ 14,7, E85 ≈ 9,8, diesel ≈ 14,5. */
  readonly stoichiometricAfr?: number | undefined;
}

export interface AfrResult {
  readonly airFuelRatio: number;
  /** `AFR/stoich`, the excess-air ratio. Undefined without a stoichiometric figure. */
  readonly lambda: number | undefined;
  readonly fuelMassG: number;
  readonly stoichiometricAfrUsed: number | undefined;
}

/**
 * Air–fuel ratio, and lambda when the fuel's stoichiometric ratio is given.

 * `AFR = m_air/m_fuel` by mass, and `λ = AFR/AFR_stoich` — both defining
 * relations. The stoichiometric ratio is an INPUT because it is a property of the
 * fuel, and the three common ones differ enough that embedding petrol's 14,7
 * would be wrong on an E85 build by a third. In `fuelForTarget` the same relation
 * is solved for the fuel the air needs: `m_fuel = m_air/AFR`.
 */
export function airFuelRatio(input: AfrInput): ProResult<AfrResult> {
  const { airMassG, stoichiometricAfr } = input;
  if (!isInRange(airMassG, 0.0001, 1e6)) return fail("airMass");
  if (stoichiometricAfr !== undefined && !isInRange(stoichiometricAfr, 1, 40)) {
    return fail("stoichiometricAfr");
  }

  let afr: number;
  let fuelMassG: number;
  if (input.mode === "afrFromMasses") {
    const fuel = input.fuelMassG;
    if (!isInRange(fuel, 0.0001, 1e6)) return fail("fuelMass");
    afr = airMassG / fuel;
    fuelMassG = fuel;
  } else {
    const target = input.targetAfr;
    if (!isInRange(target, 1, 40)) return fail("targetAfr");
    const fuel = quotient(airMassG, target);
    if (fuel === undefined) return fail("targetAfr");
    afr = target;
    fuelMassG = fuel;
  }
  return {
    ok: true,
    airFuelRatio: afr,
    lambda: stoichiometricAfr === undefined ? undefined : afr / stoichiometricAfr,
    fuelMassG,
    stoichiometricAfrUsed: stoichiometricAfr,
  };
}

/* -------------------------------------------------------------------------- */
/* wheel-offset — ET i backspace                                                */
/* -------------------------------------------------------------------------- */

export interface WheelOffsetInput {
  /** Rim width between the beads, inches — the width a wheel is sold by. */
  readonly rimWidthIn: number;
  /**
   * Offset (ET), mm: the distance from the mounting face to the rim's centre
   * line, positive when the face is outboard of the centre line.
   */
  readonly offsetMm: number;
  /** A second wheel to compare against. Absent draws no shift rows. */
  readonly referenceWidthIn?: number | undefined;
  readonly referenceOffsetMm?: number | undefined;
}

export interface WheelOffsetResult {
  readonly rimWidthMm: number;
  /** `W/2 + ET`, mm — the distance from the mounting face to the inner rim edge. */
  readonly backspaceMm: number;
  readonly backspaceIn: number;
  /** `W/2 − ET`, mm — the distance from the mounting face to the outer rim edge. */
  readonly frontSpaceMm: number;
  /** How far the outer rim edge sits from the reference's, mm. Positive is further out. */
  readonly outerFaceShiftMm: number | undefined;
  /** How far the inner rim edge sits from the reference's, mm. Positive is further out. */
  readonly innerFaceShiftMm: number | undefined;
}

/**
 * Backspace from offset and width, and where two wheels put their rim edges.
 *
 * `backspace = W/2 + ET` and `front space = W/2 − ET`, the two defining
 * relations. The signs are worth stating once: a larger positive offset moves the
 * mounting face OUTBOARD, which pulls the whole wheel IN toward the suspension —
 * more backspace, less front space.
 *
 * The two shift rows compare against a reference wheel and are measured in ONE
 * direction, outward, so positive always means „further from the car" for both
 * faces. Whether either face then touches a strut or a wing is geometry this tool
 * cannot see, and it says so.
 */
export function wheelOffset(input: WheelOffsetInput): ProResult<WheelOffsetResult> {
  const { rimWidthIn, offsetMm, referenceWidthIn, referenceOffsetMm } = input;
  if (!isInRange(rimWidthIn, 3, 20)) return fail("rimWidth");
  if (!isInRange(offsetMm, -120, 150)) return fail("offset");
  if (referenceWidthIn !== undefined && !isInRange(referenceWidthIn, 3, 20)) {
    return fail("referenceWidth");
  }
  if (referenceOffsetMm !== undefined && !isInRange(referenceOffsetMm, -120, 150)) {
    return fail("referenceOffset");
  }
  const halfWidthMm = (rimWidthIn * MM_PER_INCH) / 2;
  const backspaceMm = halfWidthMm + offsetMm;
  const frontSpaceMm = halfWidthMm - offsetMm;

  const haveReference = referenceWidthIn !== undefined && referenceOffsetMm !== undefined;
  if ((referenceWidthIn === undefined) !== (referenceOffsetMm === undefined)) {
    // Half a reference wheel is refused rather than assumed: an offset with no
    // width (or the reverse) describes no rim.
    return fail("referenceWidth");
  }
  let outerFaceShiftMm: number | undefined;
  let innerFaceShiftMm: number | undefined;
  if (haveReference) {
    const halfReferenceMm = ((referenceWidthIn ?? 0) * MM_PER_INCH) / 2;
    const referenceFront = halfReferenceMm - (referenceOffsetMm ?? 0);
    const referenceBack = halfReferenceMm + (referenceOffsetMm ?? 0);
    // Both faces are measured from the mounting plane OUTWARD, so the comparison
    // is one subtraction each and the sign means the same thing on both rows.
    outerFaceShiftMm = frontSpaceMm - referenceFront;
    innerFaceShiftMm = -backspaceMm + referenceBack;
  }
  return {
    ok: true,
    rimWidthMm: rimWidthIn * MM_PER_INCH,
    backspaceMm,
    backspaceIn: backspaceMm / MM_PER_INCH,
    frontSpaceMm,
    outerFaceShiftMm,
    innerFaceShiftMm,
  };
}
