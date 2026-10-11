/**
 * „Obrada metala" — the arithmetic behind the toolkit's tools.
 *
 * One file per PACK, as `pro/gradnja.ts` explains.
 *
 * **What this file deliberately does NOT contain is anything a `zanat` tool
 * already answers.** The tap-drill diameter, the sheet-metal developed length
 * and the weld-metal consumption are registered to this pack from their own
 * files (`tap-drill-size`, `sheet-metal-bend`, `weld-consumable`) rather than
 * re-derived here — the pack is a lens over the drawer, not a second copy of it.
 * What is left is the arithmetic a machinist needs that nothing else had:
 * spindle speed, table feed, stock mass and fillet-weld geometry.
 *
 * **Every published number is the user's own.** A recommended cutting speed
 * belongs to the tool catalogue and the material certificate, a density to the
 * mill certificate, and the Janka of a fillet to the drawing — so all of them
 * are inputs, echoed back beside the answer. The only embedded figure is the
 * conventional density of steel, and it carries the citation this repository
 * already uses for it.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isOneOf,
  isPositive,
  type ProResult,
} from "./result.js";

/** Millimetres in a metre; SI prefix definition. */
const MM_PER_M = 1000;

/** Millimetres squared in a square metre; SI prefix definition. */
const MM2_PER_M2 = 1e6;

/** Millimetres cubed in a cubic metre; SI prefix definition. */
const MM3_PER_M3 = 1e9;

/** The conventional density of steel, kg/m³ — the `steel-nominal-density` source. */
const STEEL_DENSITY = 7850;

/** One turn of a cutter, as the ratio between surface speed and spindle speed. */
const TAU_OVER_1000 = Math.PI / MM_PER_M;

export type CuttingSpeedMode = "fromSpeed" | "fromRpm";

export interface CuttingSpeedInput {
  /** Tool or workpiece diameter, mm. */
  readonly diameterMm: number;
  readonly mode: CuttingSpeedMode;
  /** Cutting speed v_c, m/min — with `fromSpeed`. */
  readonly cuttingSpeedMPerMin?: number | undefined;
  /** Spindle speed n, rpm — with `fromRpm`. */
  readonly spindleSpeedRpm?: number | undefined;
}

export interface CuttingSpeedResult {
  readonly diameterMm: number;
  readonly cuttingSpeedMPerMin: number;
  readonly spindleSpeedRpm: number;
}

/**
 * Surface speed and spindle speed, one from the other:
 *
 *     v_c = π·D·n / 1000          n = 1000·v_c / (π·D)
 *
 * D in millimetres and v_c in metres per minute, which is the pairing every
 * tool catalogue prints. The 1000 is not a constant of nature but the
 * millimetre-to-metre prefix, and it is the one factor in this relation that
 * gets dropped, which is why the surface prints both answers rather than the
 * one that was asked for: a reader who typed the speed backward sees 250 000 rpm
 * immediately.
 */
export function cuttingSpeed(input: CuttingSpeedInput): ProResult<CuttingSpeedResult> {
  const { diameterMm, mode } = input;
  if (!isPositive(diameterMm) || diameterMm > 10000) return fail("diameterMm");
  if (!isOneOf(mode, ["fromSpeed", "fromRpm"] as const)) return fail("mode");

  if (mode === "fromSpeed") {
    const speed = input.cuttingSpeedMPerMin;
    if (input.spindleSpeedRpm !== undefined) return fail("known");
    if (speed === undefined || !isPositive(speed) || speed > 10000) return fail("cuttingSpeed");
    return {
      ok: true,
      diameterMm,
      cuttingSpeedMPerMin: speed,
      spindleSpeedRpm: speed / (TAU_OVER_1000 * diameterMm),
    };
  }
  const rpm = input.spindleSpeedRpm;
  if (input.cuttingSpeedMPerMin !== undefined) return fail("known");
  if (rpm === undefined || !isPositive(rpm) || rpm > 200000) return fail("spindleSpeed");
  return {
    ok: true,
    diameterMm,
    cuttingSpeedMPerMin: TAU_OVER_1000 * diameterMm * rpm,
    spindleSpeedRpm: rpm,
  };
}

export type FeedMode = "fromPerTooth" | "fromFeedRate";

export interface FeedPerToothInput {
  /** Number of cutting edges — the teeth of the cutter. */
  readonly toothCount: number;
  readonly mode: FeedMode;
  /** Feed per tooth f_z, mm. */
  readonly feedPerToothMm?: number | undefined;
  /** Table feed v_f, mm/min. */
  readonly feedRateMmPerMin?: number | undefined;
  /** Spindle speed n, rpm. */
  readonly spindleSpeedRpm: number;
}

export interface FeedPerToothResult {
  readonly feedPerToothMm: number;
  readonly feedPerRevolutionMm: number;
  readonly feedRateMmPerMin: number;
}

/**
 * Table feed from feed per tooth, and back:
 *
 *     v_f = f_z · z · n          f_z = v_f / (z · n)
 *
 * **The tooth count is a divisor, so it is guarded before it is used.** `z = 0`
 * is reachable — a mill with a single-insert cutter whose count the user has not
 * typed yet — and an unguarded `v_f / (f_z · z)` would answer `Infinity mm/min`,
 * which reads as a display fault rather than as a refusal to do arithmetic.
 */
export function feedPerTooth(input: FeedPerToothInput): ProResult<FeedPerToothResult> {
  const { toothCount, mode, spindleSpeedRpm } = input;
  if (!isIntegerIn(toothCount, 1, 1000)) return fail("toothCount");
  if (!isOneOf(mode, ["fromPerTooth", "fromFeedRate"] as const)) return fail("mode");
  if (!isPositive(spindleSpeedRpm) || spindleSpeedRpm > 200000) return fail("spindleSpeed");

  if (mode === "fromPerTooth") {
    const perTooth = input.feedPerToothMm;
    if (input.feedRateMmPerMin !== undefined) return fail("known");
    if (perTooth === undefined || !isPositive(perTooth) || perTooth > 10) return fail("feedPerTooth");
    const feedPerRevolutionMm = perTooth * toothCount;
    return {
      ok: true,
      feedPerToothMm: perTooth,
      feedPerRevolutionMm,
      feedRateMmPerMin: feedPerRevolutionMm * spindleSpeedRpm,
    };
  }

  const rate = input.feedRateMmPerMin;
  if (input.feedPerToothMm !== undefined) return fail("known");
  if (rate === undefined || !isPositive(rate) || rate > 1e6) return fail("feedRate");
  const feedPerRevolutionMm = rate / spindleSpeedRpm;
  return {
    ok: true,
    feedPerToothMm: feedPerRevolutionMm / toothCount,
    feedPerRevolutionMm,
    feedRateMmPerMin: rate,
  };
}

/**
 * The bar, tube and plate shapes this tool knows, by their cross-section.
 *
 * `hex` is the bar measured ACROSS THE FLATS, which is how hex stock is sold;
 * `tube` and `box` carry a wall thickness rather than an inner dimension,
 * because a wall is what the supplier prints and the bore is what the customer
 * derives.
 */
export type MetalShape = "round" | "square" | "hex" | "roundTube" | "boxTube" | "rect";

export interface MetalWeightInput {
  readonly shape: MetalShape;
  /** Diameter, side or width, mm — the outer dimension. */
  readonly sizeMm: number;
  /** Second dimension, mm — only `rect` uses it, as the height of the section. */
  readonly secondSizeMm?: number | undefined;
  /** Wall thickness, mm — only the two tubes use it. */
  readonly wallMm?: number | undefined;
  /** Length of the piece, m. */
  readonly lengthM: number;
  /** Number of identical pieces. */
  readonly pieces: number;
  /** Density, kg/m³. */
  readonly densityKgM3: number;
}

export interface MetalWeightResult {
  readonly crossSectionMm2: number;
  readonly volumePerPieceM3: number;
  readonly massPerMetre: number;
  readonly massPerPiece: number;
  readonly totalMass: number;
  readonly densityUsed: number;
}

/**
 * Mass of bar, tube, plate or profile stock from its cross-section and the
 * material's density: `m = ρ · A · L`.
 *
 * **The density is an input and the surface names the steel value.** Steel's
 * 7 850 kg/m³ is the one figure this drawer can cite — it is the conventional
 * nominal density of EN 10080:2005 and ISO 6935-2:2019, the same source
 * `rebar-weight` carries — and everything else (aluminium, brass, copper, a
 * particular stainless grade) varies by alloy, so it is read off the mill
 * certificate rather than guessed here. The section itself is exact geometry:
 * a hexagon across the flats `s` has area `(√3/2)·s²`, a round tube of outer
 * diameter `D` and wall `t` has area `π/4·(D² − (D − 2t)²)`.
 */
export function metalWeight(input: MetalWeightInput): ProResult<MetalWeightResult> {
  const { shape, sizeMm, lengthM, densityKgM3 } = input;
  if (!isOneOf(shape, ["round", "square", "hex", "roundTube", "boxTube", "rect"] as const)) {
    return fail("shape");
  }
  if (!isPositive(sizeMm) || sizeMm > 10000) return fail("sizeMm");
  if (!isPositive(lengthM) || lengthM > 10000) return fail("lengthM");
  if (!isIntegerIn(input.pieces, 1, 100000)) return fail("pieces");
  if (!isPositive(densityKgM3) || densityKgM3 > 25000) return fail("density");

  let areaMm2: number;
  if (shape === "round") {
    if (input.secondSizeMm !== undefined || input.wallMm !== undefined) return fail("known");
    areaMm2 = (Math.PI * sizeMm * sizeMm) / 4;
  } else if (shape === "square") {
    if (input.secondSizeMm !== undefined || input.wallMm !== undefined) return fail("known");
    areaMm2 = sizeMm * sizeMm;
  } else if (shape === "hex") {
    if (input.secondSizeMm !== undefined || input.wallMm !== undefined) return fail("known");
    // Regular hexagon measured across the flats: A = (√3/2)·s².
    areaMm2 = (Math.sqrt(3) / 2) * sizeMm * sizeMm;
  } else if (shape === "roundTube") {
    if (input.secondSizeMm !== undefined) return fail("known");
    const wall = input.wallMm;
    if (wall === undefined || !isPositive(wall)) return fail("wall");
    const bore = sizeMm - 2 * wall;
    if (bore <= 0) return fail("wall");
    areaMm2 = (Math.PI / 4) * (sizeMm * sizeMm - bore * bore);
  } else if (shape === "boxTube") {
    if (input.secondSizeMm !== undefined) return fail("known");
    const wall = input.wallMm;
    if (wall === undefined || !isPositive(wall)) return fail("wall");
    const bore = sizeMm - 2 * wall;
    if (bore <= 0) return fail("wall");
    areaMm2 = sizeMm * sizeMm - bore * bore;
  } else {
    if (input.wallMm !== undefined) return fail("known");
    const height = input.secondSizeMm;
    if (height === undefined || !isPositive(height)) return fail("secondSize");
    areaMm2 = sizeMm * height;
  }

  const volumePerPieceM3 = (areaMm2 * lengthM * MM_PER_M) / MM3_PER_M3;
  const massPerMetre = (areaMm2 / MM2_PER_M2) * densityKgM3;
  const massPerPiece = volumePerPieceM3 * densityKgM3;
  return {
    ok: true,
    crossSectionMm2: areaMm2,
    volumePerPieceM3,
    massPerMetre,
    massPerPiece,
    totalMass: massPerPiece * input.pieces,
    densityUsed: densityKgM3,
  };
}

/** Which of the two measures the user has: the Janka leg or the required throat. */
export type WeldMeasure = "leg" | "throat";

export interface WeldThroatLegInput {
  readonly measure: WeldMeasure;
  /** Equal leg length z, mm — with `measure: "leg"`. */
  readonly legMm?: number | undefined;
  /** First leg, mm — an UNEQUAL fillet, with `measure: "leg"` and `leg2Mm`. */
  readonly leg2Mm?: number | undefined;
  /** Required throat a, mm — with `measure: "throat"`. */
  readonly throatMm?: number | undefined;
  readonly densityKgM3?: number | undefined;
}

export interface WeldThroatLegResult {
  readonly legMm: number;
  readonly leg2Mm: number;
  readonly throatMm: number;
  /** Cross-section of the weld metal, mm², per millimetre of seam. */
  readonly areaMm2: number;
  /** Mass of weld metal per metre of seam, kg/m — with a density. */
  readonly massPerMetre: number;
}

/**
 * The geometry of a fillet weld: which leg gives which throat, and back.
 *
 * **A 90° fillet's throat is not `leg · 0,707` for every weld, only for the
 * equal-legged one**, and that shorthand is the whole reason this tool exists as
 * a surface of its own. With two unequal legs `z₁` and `z₂` the throat is
 *
 *     a = z₁·z₂ / √(z₁² + z₂²)          A = z₁·z₂ / 2
 *
 * which returns `z/√2` exactly when `z₁ = z₂ = z` — the shorthand is the special
 * case, not the definition. The area is the right triangle under the two legs,
 * so the same formula carries the weld-metal section that `weld-consumable`
 * multiplies by a length; that tool converts leg and throat too, but only as an
 * intermediate on the way to a consumable mass, and it presumes equal legs.
 */
export function weldThroatLeg(input: WeldThroatLegInput): ProResult<WeldThroatLegResult> {
  const density = input.densityKgM3 ?? STEEL_DENSITY;
  if (!isPositive(density) || density > 25000) return fail("density");

  let leg: number;
  let leg2: number;
  if (input.measure === "leg") {
    if (input.throatMm !== undefined) return fail("known");
    const first = input.legMm;
    if (first === undefined || !isInRange(first, 0.5, 100)) return fail("leg");
    const second = input.leg2Mm ?? first;
    if (!isInRange(second, 0.5, 100)) return fail("leg2");
    leg = first;
    leg2 = second;
  } else if (input.measure === "throat") {
    if (input.legMm !== undefined || input.leg2Mm !== undefined) return fail("known");
    const throat = input.throatMm;
    if (throat === undefined || !isInRange(throat, 0.3, 100)) return fail("throat");
    // The equal-legged inverse: z = a·√2.
    leg = throat * Math.SQRT2;
    leg2 = leg;
  } else {
    return fail("measure");
  }

  const throat = (leg * leg2) / Math.sqrt(leg * leg + leg2 * leg2);
  const area = (leg * leg2) / 2;
  return {
    ok: true,
    legMm: leg,
    leg2Mm: leg2,
    throatMm: throat,
    areaMm2: area,
    massPerMetre: (area / MM2_PER_M2) * density,
  };
}
