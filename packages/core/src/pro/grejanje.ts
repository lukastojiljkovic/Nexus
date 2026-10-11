/**
 * „Grejanje i vodovod" — the arithmetic behind the toolkit's tools.
 *
 * One file per PACK, as `pro/gradnja.ts` explains: the rail groups by category,
 * the profile filters by pack, and a maintainer asking „where is the radiator
 * calculator" is answered by the file name.
 *
 * **The heat-loss and radiator tools carry published method, not published
 * limits.** EN 12831-1 fixes HOW a design heat load is assembled and EN 442-1
 * fixes how a radiator's output falls away from its nominal rating; neither
 * tells anybody what U-value a wall has to have or how many watts a room needs.
 * So the u-values, the air-change rates and the radiator's own exponent are
 * INPUTS here, echoed back beside the answer, and the tool never says whether
 * the room is warm enough — it prints what the numbers add up to.
 *
 * **Every constant that is not a definition is a citation.** The ventilation
 * coefficient of 0.34 Wh/(m³·K), water's heat capacity, the viscosity of water
 * at 20 °C and the BTU/kcal conversion factors are all named where they are
 * used, because a professional checking the arithmetic has to be able to.
 *
 * **These are pure functions and they refuse rather than repair** — no clock,
 * no locale, no I/O.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isNonNegative,
  isPositive,
  type ProResult,
} from "./result.js";

/**
 * The ventilation heat-loss coefficient, Wh/(m³·K), EN 12831-1:2017.
 *
 * It is `ρ·c` of air rounded by the standard itself, and the whole reason the
 * simplified method uses a single number is that nobody sizes a house on the
 * difference between 0.34 and 0.335.
 */
const VENTILATION_COEFFICIENT = 0.34;

/** Standard gravity, m/s² — 3rd CGPM (1901), fixed by definition. */
const GRAVITY = 9.80665;

/**
 * Specific heat capacity of water, J/(kg·K).
 *
 * The value the heating trade carries for water at 15 °C; over 0–100 °C the
 * true figure moves by a few joules, which no domestic installation can see.
 */
const WATER_HEAT_CAPACITY = 4186;

/** Density of water, kg/m³ — the conventional 1 kg per litre. */
const WATER_DENSITY = 1000;

/** Seconds in an hour; the conversion between a power and a time. */
const SECONDS_PER_HOUR = 3600;

/** Litres in a cubic metre; SI prefix definition. */
const LITRES_PER_M3 = 1000;

/** Millimetres in a metre; SI prefix definition. */
const MM_PER_M = 1000;

/** Joules in a kilowatt-hour, exact by definition (3 600 000 J). */
const JOULES_PER_KWH = 3.6e6;

/**
 * The watt of one BTU per hour and of one kilocalorie per hour, both exact.
 *
 * 1 BTU_IT = 1055,05585262 J exactly (International Steam Table definition) and
 * 1 cal_IT = 4,1868 J exactly, so an hour of either is a division by 3600 and
 * nothing else. The calorie is the one unit in this drawer where the "small" and
 * "large" calorie confusion could hide, so the label says kcal and the constant
 * is byte-for-byte the IT one.
 */
const WATT_PER_BTU_PER_HOUR = 1055.05585262 / SECONDS_PER_HOUR;
const WATT_PER_KCAL_PER_HOUR = 4.1868 * 1000 / SECONDS_PER_HOUR;

/** The four ways a heat flow is written down; all exact factors into W. */
export type PowerUnit = "w" | "kw" | "btuPerHour" | "kcalPerHour";

const WATTS_PER_UNIT: Readonly<Record<PowerUnit, number>> = {
  w: 1,
  kw: 1000,
  btuPerHour: WATT_PER_BTU_PER_HOUR,
  kcalPerHour: WATT_PER_KCAL_PER_HOUR,
};

/* ------------------------------------------------------------------ grejanje */

/** One enclosure surface: its area and the U-value of that assembly. */
export interface EnvelopeSurface {
  readonly area: number;
  readonly uValue: number;
}

export interface RoomHeatLossInput {
  /** Indoor design temperature minus outdoor design temperature, K. */
  readonly temperatureDifference: number;
  /** Wall/roof/floor/window rows. Transmission coefficient is their Σ(U·A). */
  readonly surfaces: readonly EnvelopeSurface[];
  /** Extra transmission coefficient for thermal bridges, W/K. Absent means none. */
  readonly thermalBridgeCoefficient?: number | undefined;
  /** One of the two ventilation bases. Air changes are the usual one for dwellings. */
  readonly airChangesPerHour?: number | undefined;
  /** Ventilation air flow per floor area, m³/(h·m²). */
  readonly airFlowPerArea?: number | undefined;
  /** Heated volume, m³ — with `airChangesPerHour`. */
  readonly volume?: number | undefined;
  /** Floor area, m² — with `airFlowPerArea`. */
  readonly floorArea?: number | undefined;
}

export interface SurfaceLoss {
  readonly area: number;
  readonly uValue: number;
  readonly coefficient: number;
  readonly loss: number;
}

export interface RoomHeatLossResult {
  readonly transmissionCoefficient: number;
  readonly thermalBridgeCoefficient: number;
  readonly ventilationCoefficient: number;
  readonly transmissionLoss: number;
  readonly ventilationLoss: number;
  readonly totalLoss: number;
  readonly lossPerFloorArea: number | undefined;
  readonly surfaces: readonly SurfaceLoss[];
}

/**
 * Design heat loss of one room, by the simplified EN 12831-1 method.
 *
 *     H_T = Σ(U·A) + ΔH_TB          Φ_T = H_T · Δθ
 *     H_V = 0.34 · n · V  (or 0.34 · q · A_floor)   Φ_V = H_V · Δθ
 *     Φ   = Φ_T + Φ_V
 *
 * **The whole toolkit's first tool is deliberately the SIMPLIFIED branch.** The
 * full standard carries a reheat capacity, a temperature-recovery factor and a
 * per-room interruption surcharge; the simplified method is what a small
 * installer can honestly fill in, and the surface states which method ran rather
 * than letting a reader assume the fuller one. Every figure the fuller method
 * would need beyond these is therefore not invented here.
 */
export function roomHeatLoss(input: RoomHeatLossInput): ProResult<RoomHeatLossResult> {
  const { temperatureDifference, surfaces } = input;
  if (!isInRange(temperatureDifference, 1, 80)) return fail("temperatureDifference");
  if (!isIntegerIn(surfaces.length, 1, 200)) return fail("surfaces");

  let transmissionCoefficient = 0;
  const rows: SurfaceLoss[] = [];
  for (const [index, surface] of surfaces.entries()) {
    if (!isPositive(surface.area) || surface.area > 100000) return fail(`surfaces:${index}`);
    if (!isNonNegative(surface.uValue) || surface.uValue > 20) return fail(`surfaces:${index}`);
    const coefficient = surface.uValue * surface.area;
    transmissionCoefficient += coefficient;
    rows.push({ area: surface.area, uValue: surface.uValue, coefficient, loss: 0 });
  }

  const bridge = input.thermalBridgeCoefficient ?? 0;
  if (!isNonNegative(bridge) || bridge > 10000) return fail("thermalBridgeCoefficient");

  const hasAirChanges = input.airChangesPerHour !== undefined;
  const hasPerArea = input.airFlowPerArea !== undefined;
  // Exactly one basis. Two would be two answers to one question; neither would
  // silently report a room with no ventilation at all, which reads as a low
  // number rather than as a missing input.
  if (hasAirChanges === hasPerArea) return fail("ventilation");

  let ventilationCoefficient: number;
  if (hasAirChanges) {
    const n = input.airChangesPerHour;
    if (!isPositive(n) || n > 20) return fail("airChangesPerHour");
    if (input.volume === undefined || !isPositive(input.volume) || input.volume > 1e6) {
      return fail("volume");
    }
    ventilationCoefficient = VENTILATION_COEFFICIENT * n * input.volume;
  } else {
    const q = input.airFlowPerArea;
    if (!isNonNegative(q) || q > 100) return fail("airFlowPerArea");
    if (input.floorArea === undefined || !isPositive(input.floorArea)) return fail("floorArea");
    ventilationCoefficient = VENTILATION_COEFFICIENT * q * input.floorArea;
  }

  const transmissionLoss = (transmissionCoefficient + bridge) * temperatureDifference;
  const ventilationLoss = ventilationCoefficient * temperatureDifference;
  const floorArea = input.floorArea;
  return {
    ok: true,
    transmissionCoefficient,
    thermalBridgeCoefficient: bridge,
    ventilationCoefficient,
    transmissionLoss,
    ventilationLoss,
    totalLoss: transmissionLoss + ventilationLoss,
    lossPerFloorArea:
      floorArea === undefined ? undefined : (transmissionLoss + ventilationLoss) / floorArea,
    surfaces: rows.map((row) => ({ ...row, loss: row.coefficient * temperatureDifference })),
  };
}

export interface RadiatorOutputInput {
  /** The unit's own rated output, W, at its rated temperature spread. */
  readonly nominalOutput: number;
  /** The spread the rating was taken at, K — 50 for EN 442's standard rating. */
  readonly nominalSpread?: number | undefined;
  /** Flow temperature, °C. With `returnTemperature` and `roomTemperature`. */
  readonly flowTemperature?: number | undefined;
  readonly returnTemperature?: number | undefined;
  readonly roomTemperature?: number | undefined;
  /** The spread directly, K — INSTEAD of the three temperatures. */
  readonly spread?: number | undefined;
  /** The EN 442 exponent n of this unit. 1.3 is the usual starting point, never a default. */
  readonly exponent: number;
  /** A different output wanted, W — the spread needed to reach it is returned too. */
  readonly requiredOutput?: number | undefined;
}

export interface RadiatorOutputResult {
  readonly spreadUsed: number;
  readonly nominalSpread: number;
  readonly output: number;
  readonly factor: number;
  readonly requiredSpread: number | undefined;
}

/**
 * A radiator's output away from its rated temperatures, by the EN 442-1
 * exponent method.
 *
 *     Φ = Φ_n · (Δθ / Δθ_n)^n          Δθ = (θ_flow + θ_return)/2 − θ_room
 *
 * **The exponent is an input with no default.** EN 442-1 measures it per
 * appliance; a panel radiator, a column radiator and a towel rail do not share
 * it, and the whole point of the tool is that the drop away from nominal is
 * different for each. Typing 1.3 is the user's choice, and the echo prints it
 * back so the number that produced the answer travels with the answer.
 */
export function radiatorOutput(input: RadiatorOutputInput): ProResult<RadiatorOutputResult> {
  const { nominalOutput, exponent } = input;
  if (!isPositive(nominalOutput) || nominalOutput > 1e7) return fail("nominalOutput");
  const nominalSpread = input.nominalSpread ?? 50;
  if (!isInRange(nominalSpread, 10, 90)) return fail("nominalSpread");
  if (!isInRange(exponent, 1, 2)) return fail("exponent");

  let spreadUsed: number;
  if (input.spread !== undefined) {
    if (
      input.flowTemperature !== undefined ||
      input.returnTemperature !== undefined ||
      input.roomTemperature !== undefined
    ) {
      return fail("spread");
    }
    if (!isInRange(input.spread, 1, 120)) return fail("spread");
    spreadUsed = input.spread;
  } else {
    const { flowTemperature: flow, returnTemperature: back, roomTemperature: room } = input;
    if (flow === undefined || back === undefined || room === undefined) return fail("flowTemperature");
    if (!isInRange(flow, 20, 120)) return fail("flowTemperature");
    if (!isInRange(back, 10, 120)) return fail("returnTemperature");
    if (!isInRange(room, 0, 40)) return fail("roomTemperature");
    spreadUsed = (flow + back) / 2 - room;
  }
  if (spreadUsed <= 0) return fail("spread");

  const factor = (spreadUsed / nominalSpread) ** exponent;
  const output = nominalOutput * factor;

  let requiredSpread: number | undefined;
  if (input.requiredOutput !== undefined) {
    if (!isPositive(input.requiredOutput)) return fail("requiredOutput");
    requiredSpread = nominalSpread * (input.requiredOutput / nominalOutput) ** (1 / exponent);
  }

  return { ok: true, spreadUsed, nominalSpread, output, factor, requiredSpread };
}

export interface WaterHeaterInput {
  /** Volume of water to heat, litres. */
  readonly volume: number;
  /** Starting water temperature, °C. */
  readonly initialTemperature: number;
  /** Wanted water temperature, °C. */
  readonly targetTemperature: number;
  /** Heating power, W. */
  readonly power: number;
  /** Heat capacity of the fluid, J/(kg·K) — water unless the job is not water. */
  readonly heatCapacity?: number | undefined;
  /** Density of the fluid, kg/m³. */
  readonly density?: number | undefined;
  /** Losses and draw-off as a percentage of standing losses, %. */
  readonly lossPercent?: number | undefined;
}

export interface WaterHeaterResult {
  readonly temperatureRise: number;
  readonly mass: number;
  readonly energyJoules: number;
  readonly energyKwh: number;
  readonly energyPerLitreKwh: number;
  readonly timeSeconds: number;
  readonly timeMinutes: number;
  readonly lossPercentUsed: number;
}

/**
 * How long a heater needs to raise a body of water, and how much energy that
 * takes: `Q = m·c·Δθ` and `t = Q/P`.
 *
 * **Standing losses are an input, not a default.** A real cylinder loses heat
 * while it heats, and how much depends on the cylinder, the room and the
 * starting temperature — three things this file has never seen. Zero is the
 * honest answer when the user has not measured them, and the echo makes the
 * zero visible rather than implied.
 */
export function waterHeater(input: WaterHeaterInput): ProResult<WaterHeaterResult> {
  const { volume, power } = input;
  if (!isPositive(volume) || volume > 1e6) return fail("volume");
  if (!isInRange(input.initialTemperature, -20, 150)) return fail("initialTemperature");
  if (!isInRange(input.targetTemperature, 0, 200)) return fail("targetTemperature");
  if (!isPositive(power) || power > 1e9) return fail("power");

  const heatCapacity = input.heatCapacity ?? WATER_HEAT_CAPACITY;
  if (!isPositive(heatCapacity) || heatCapacity > 10000) return fail("heatCapacity");
  const density = input.density ?? WATER_DENSITY;
  if (!isPositive(density) || density > 25000) return fail("density");
  const lossPercent = input.lossPercent ?? 0;
  if (!isNonNegative(lossPercent) || lossPercent > 100) return fail("lossPercent");

  const temperatureRise = input.targetTemperature - input.initialTemperature;
  if (temperatureRise <= 0) return fail("targetTemperature");

  const mass = (volume / LITRES_PER_M3) * density;
  const energyJoules = mass * heatCapacity * temperatureRise * (1 + lossPercent / 100);
  const timeSeconds = energyJoules / power;
  return {
    ok: true,
    temperatureRise,
    mass,
    energyJoules,
    energyKwh: energyJoules / JOULES_PER_KWH,
    energyPerLitreKwh: energyJoules / JOULES_PER_KWH / volume,
    timeSeconds,
    timeMinutes: timeSeconds / 60,
    lossPercentUsed: lossPercent,
  };
}

/** The four ways a flow rate is written down; all exact factors into m³/s. */
export type FlowUnit = "l/s" | "l/min" | "m3/h" | "m3/s";

const FLOW_UNIT_IN_M3S: Readonly<Record<FlowUnit, number>> = {
  "l/s": 0.001,
  "l/min": 1 / 60000,
  "m3/h": 1 / 3600,
  "m3/s": 1,
};

export interface PipePressureDropInput {
  /** INNER diameter, mm. */
  readonly innerDiameterMm: number;
  /** Pipe length, m — the run, before any fitting. */
  readonly lengthM: number;
  readonly flow?: { readonly value: number; readonly unit: FlowUnit } | undefined;
  readonly velocityMs?: number | undefined;
  /** Absolute roughness, mm. New steel 0.05, drawn copper 0.0015, PEX 0.007. */
  readonly roughnessMm: number;
  /** Kinematic viscosity, mm²/s. Water at 20 °C is 1.004. */
  readonly kinematicViscosityMm2S: number;
  /** Density, kg/m³. Water at 20 °C is 998. */
  readonly densityKgM3: number;
  /** Equivalent length of all fittings, m, added to the straight run. */
  readonly fittingsEquivalentLengthM?: number | undefined;
}

export interface PipePressureDropResult {
  readonly velocityMs: number;
  readonly reynolds: number;
  /** The Darcy friction factor. Swamee–Jain above Re 5000, 64/Re below 2300. */
  readonly frictionFactor: number;
  readonly regime: "laminar" | "transitional" | "turbulent";
  readonly totalLengthM: number;
  readonly headLossM: number;
  readonly pressureDropPa: number;
  readonly pressureDropKpa: number;
  readonly pressureDropBar: number;
  readonly velocityHeadM: number;
}

/**
 * Pressure drop along a round pipe, by Darcy–Weisbach with Swamee–Jain.
 *
 *     Δp = f · (L/D) · ρ·v²/2              h_f = f · (L/D) · v²/(2g)
 *     f  = 0.25 / [log10(ε/(3.7D) + 5.74/Re^0.9)]²   (Swamee–Jain, 1976)
 *
 * **Both friction regimes are named rather than blended.** Above Re 5000 the
 * Swamee–Jain approximation is used (it is within 1 % of Colebrook–White over
 * its own stated domain, which is exactly why it is worth having in an offline
 * drawer); below Re 2300 the closed-form `64/Re` is the answer; between them the
 * flow is genuinely unsettled and the result says `transitional` rather than
 * picking a law. The Reynolds number is printed beside it, so the reader can see
 * which branch ran.
 */
export function pipePressureDrop(input: PipePressureDropInput): ProResult<PipePressureDropResult> {
  const { innerDiameterMm, lengthM, roughnessMm, kinematicViscosityMm2S, densityKgM3 } = input;
  if (!isPositive(innerDiameterMm) || innerDiameterMm > 2000) return fail("innerDiameterMm");
  if (!isPositive(lengthM) || lengthM > 100000) return fail("lengthM");
  if (!isNonNegative(roughnessMm) || roughnessMm > 20) return fail("roughnessMm");
  if (!isPositive(kinematicViscosityMm2S) || kinematicViscosityMm2S > 1e6) {
    return fail("kinematicViscosityMm2S");
  }
  if (!isPositive(densityKgM3) || densityKgM3 > 25000) return fail("densityKgM3");
  const fittings = input.fittingsEquivalentLengthM ?? 0;
  if (!isNonNegative(fittings) || fittings > 100000) return fail("fittingsEquivalentLengthM");

  const hasFlow = input.flow !== undefined;
  const hasVelocity = input.velocityMs !== undefined;
  if (hasFlow === hasVelocity) return fail("known");

  const diameterM = innerDiameterMm / MM_PER_M;
  const areaM2 = (Math.PI * diameterM * diameterM) / 4;
  let velocity: number;
  if (input.flow !== undefined) {
    if (!isNonNegative(input.flow.value)) return fail("flow");
    if (!isKeyOf(input.flow.unit, FLOW_UNIT_IN_M3S)) return fail("flowUnit");
    velocity = (input.flow.value * FLOW_UNIT_IN_M3S[input.flow.unit]) / areaM2;
  } else {
    if (input.velocityMs === undefined || !isNonNegative(input.velocityMs)) return fail("velocity");
    velocity = input.velocityMs;
  }

  const reynolds = (velocity * diameterM) / (kinematicViscosityMm2S / 1e6);
  let frictionFactor: number;
  let regime: PipePressureDropResult["regime"];
  if (reynolds < 2300) {
    // Laminar: the closed-form Hagen–Poiseuille factor.
    frictionFactor = reynolds === 0 ? 0 : 64 / reynolds;
    regime = "laminar";
  } else if (reynolds < 5000) {
    // The unsettled band. Colebrook–White's own answer here is a curve between
    // two laws, and a tool that silently picks one would be inventing a
    // transition it cannot see. The factor at the lower end is returned so the
    // head loss is not zero, and the row says which regime this is.
    frictionFactor = 64 / reynolds;
    regime = "transitional";
  } else {
    const relative = roughnessMm / MM_PER_M / diameterM;
    const inner = relative / 3.7 + 5.74 / reynolds ** 0.9;
    frictionFactor = 0.25 / Math.log10(inner) ** 2;
    regime = "turbulent";
  }

  const totalLengthM = lengthM + fittings;
  const velocityHeadM = (velocity * velocity) / (2 * GRAVITY);
  const headLossM = frictionFactor * (totalLengthM / diameterM) * velocityHeadM;
  const pressureDropPa = frictionFactor * (totalLengthM / diameterM) * (densityKgM3 * velocity * velocity) / 2;
  return {
    ok: true,
    velocityMs: velocity,
    reynolds,
    frictionFactor,
    regime,
    totalLengthM,
    headLossM,
    pressureDropPa,
    pressureDropKpa: pressureDropPa / 1000,
    pressureDropBar: pressureDropPa / 1e5,
    velocityHeadM,
  };
}

export interface PowerUnitsInput {
  readonly value: number;
  readonly unit: PowerUnit;
}

export interface PowerUnitsResult {
  readonly watts: number;
  readonly kilowatts: number;
  readonly btuPerHour: number;
  readonly kcalPerHour: number;
}

/**
 * One heat flow in all four units the trades write it in: W, kW, BTU/h, kcal/h.
 *
 * Both non-SI factors are exact by the definition of the table they come from
 * (the IT BTU and the IT calorie), so a radiator quoted in BTU/h and the same
 * radiator quoted in kcal/h convert to the same watt — which is the only
 * property a converter of this size has to have.
 */
export function powerUnits(input: PowerUnitsInput): ProResult<PowerUnitsResult> {
  if (!Number.isFinite(input.value)) return fail("value");
  if (!isKeyOf(input.unit, WATTS_PER_UNIT)) return fail("unit");
  const watts = input.value * WATTS_PER_UNIT[input.unit];
  if (!Number.isFinite(watts)) return fail("value");
  return {
    ok: true,
    watts,
    kilowatts: watts / 1000,
    btuPerHour: watts / WATT_PER_BTU_PER_HOUR,
    kcalPerHour: watts / WATT_PER_KCAL_PER_HOUR,
  };
}

/** One fuel, as the user's own bill describes it. */
export interface FuelRow {
  readonly name: string;
  /** Price of ONE unit of the fuel, in the user's currency. */
  readonly pricePerUnit: number;
  /** Energy in one unit of the fuel, kWh — from the supplier's own calorific value. */
  readonly energyPerUnit: number;
  /** Seasonal efficiency of the appliance that burns it, fraction 0–1. */
  readonly efficiency: number;
}

export interface FuelCost {
  readonly name: string;
  readonly costPerDeliveredKwh: number;
  readonly costPerUsefulKwh: number;
}

export interface HeatingCostInput {
  readonly fuels: readonly FuelRow[];
}

export interface HeatingCostResult {
  readonly fuels: readonly FuelCost[];
  /** Index of the cheapest row, or `undefined` when the list is empty of valid rows. */
  readonly cheapestIndex: number | undefined;
}

/**
 * What a kilowatt-hour of USEFUL heat costs, per fuel.
 *
 *     cost_delivered = price / energyPerUnit
 *     cost_useful    = cost_delivered / efficiency
 *
 * **The calorific value is the user's, and it is per unit of the thing they buy.**
 * Natural gas is priced per m³ and its net calorific value is about 9,97
 * kWh/m³; firewood is priced per ster or per m³; pellets per kilogram; diesel
 * per litre. All of those are supplier data, not data this app can know, so the
 * table is entered row by row and the tool divides. The `power` unit factor
 * above is the only place a published conversion lives.
 *
 * The cheapest row is NAMED and not asserted: a comparison of the user's own
 * figures against each other is arithmetic, and `financial` is the one class
 * where the drawer may print a conclusion about the numbers.
 */
export function heatingCost(input: HeatingCostInput): ProResult<HeatingCostResult> {
  const fuels = input.fuels;
  if (!isIntegerIn(fuels.length, 1, 50)) return fail("fuels");
  const rows: FuelCost[] = [];
  let cheapestIndex = 0;
  for (const [index, fuel] of fuels.entries()) {
    if (!isPositive(fuel.pricePerUnit)) return fail(`fuels:${index}:pricePerUnit`);
    if (!isPositive(fuel.energyPerUnit)) return fail(`fuels:${index}:energyPerUnit`);
    if (!isInRange(fuel.efficiency, 0.01, 1.5)) return fail(`fuels:${index}:efficiency`);
    const costPerDeliveredKwh = fuel.pricePerUnit / fuel.energyPerUnit;
    const costPerUsefulKwh = costPerDeliveredKwh / fuel.efficiency;
    rows.push({ name: fuel.name, costPerDeliveredKwh, costPerUsefulKwh });
    const cheapest = rows[cheapestIndex];
    if (cheapest === undefined || costPerUsefulKwh < cheapest.costPerUsefulKwh) cheapestIndex = index;
  }
  return { ok: true, fuels: rows, cheapestIndex };
}
