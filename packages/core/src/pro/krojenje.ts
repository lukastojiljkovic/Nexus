/**
 * „Krojenje" — the arithmetic behind the toolkit's tools.
 *
 * One file per PACK, as `pro/gradnja.ts` explains.
 *
 * **Fabric consumption is NOT in this file.** „Koliko tkanine za krojni plan"
 * is `zanat`'s `fabric-yardage-repeat`, built and tested there, and this pack
 * registers it rather than writing a second one. What is here is the geometry
 * a cutter marks out with a ruler: the radius a circular skirt is drawn from,
 * the seam allowance added to a finished measurement, the length a square of
 * fabric yields as bias strip, how much longer a gathered edge has to be, and
 * where the buttons go.
 *
 * **Every one of these is a definition or a division.** There is no trade rule
 * anywhere in this file — no "a skirt should be…", no "leave at least…" — and
 * the one figure that IS a convention, the gathering ratio, is a measurement of
 * the fabric rather than a standard.
 */

import { fail, isInRange, isIntegerIn, isPositive, type ProResult } from "./result.js";

/** A full circle, as the fraction of the waist circle the panel covers. */
export type SkirtCircle = "full" | "half" | "quarter";

const CIRCLE_FRACTION: Readonly<Record<SkirtCircle, number>> = {
  full: 1,
  half: 0.5,
  quarter: 0.25,
};

export interface CircleSkirtInput {
  /** Waist circumference, cm — the body measurement, before any easing. */
  readonly waistCm: number;
  readonly circle: SkirtCircle;
  /** Skirt length from waist to hem, cm. */
  readonly lengthCm: number;
}

export interface CircleSkirtResult {
  readonly waistRadiusCm: number;
  readonly hemRadiusCm: number;
  /** Waist arc that has to be eased onto the waistband, cm — the fabric's own measure. */
  readonly waistArcCm: number;
  readonly hemCircumferenceCm: number;
  /** Side of the square the flat panel needs, cm — the cutting-out envelope. */
  readonly fabricSquareCm: number;
  readonly circleFraction: number;
}

/**
 * The radius a circular skirt is drawn from, and the hem it produces.
 *
 *     r = C / (2π·k)          hem = 2π·k·(r + L)
 *
 * with `k` the fraction of the circle the panel is — 1 full, ½ half, ¼
 * quarter. **The waist arc is the waist circumference for every `k`**, which is
 * the property that makes the family useful and the reason the four panels hang
 * with different flare from the same measurement. The envelope is the square
 * the flat panel fits in: `2·(r + L)`.
 */
export function circleSkirt(input: CircleSkirtInput): ProResult<CircleSkirtResult> {
  const { waistCm, circle, lengthCm } = input;
  if (!isInRange(waistCm, 30, 200)) return fail("waist");
  if (!isInRange(lengthCm, 5, 200)) return fail("length");
  const fraction = CIRCLE_FRACTION[circle];
  if (fraction === undefined) return fail("circle");

  const waistRadiusCm = waistCm / (2 * Math.PI * fraction);
  const hemRadiusCm = waistRadiusCm + lengthCm;
  return {
    ok: true,
    waistRadiusCm,
    hemRadiusCm,
    waistArcCm: 2 * Math.PI * fraction * waistRadiusCm,
    hemCircumferenceCm: 2 * Math.PI * fraction * hemRadiusCm,
    fabricSquareCm: 2 * hemRadiusCm,
    circleFraction: fraction,
  };
}

export type SeamMode = "toCut" | "toFinished";

export interface SeamAllowanceInput {
  readonly mode: SeamMode;
  /** The dimension measured on the garment, cm — or on the cut piece, with `toFinished`. */
  readonly dimensionCm: number;
  /** How many seams the dimension crosses — one at a side, two at a width. */
  readonly seams: number;
  /** Allowance taken at EACH seam, cm. */
  readonly allowanceCm: number;
}

export interface SeamAllowanceResult {
  readonly cutCm: number;
  readonly finishedCm: number;
  readonly totalAddedCm: number;
}

/**
 * A finished measurement and the cut size it is marked from.
 *
 *     cut = finished + n·a
 *
 * `n` is the number of seams the dimension CROSSES rather than the number the
 * garment has: a sleeve length crosses one, a trouser waist crosses two, a
 * panel in the middle of three crosses none. That count is the whole content of
 * the tool and the commonest mistake it prevents, so it is an input and it is
 * echoed.
 */
export function seamAllowance(input: SeamAllowanceInput): ProResult<SeamAllowanceResult> {
  const { dimensionCm, seams, allowanceCm } = input;
  if (!isPositive(dimensionCm) || dimensionCm > 1000) return fail("dimension");
  if (!isIntegerIn(seams, 0, 20)) return fail("seams");
  if (!isInRange(allowanceCm, 0, 10)) return fail("allowance");
  const totalAddedCm = seams * allowanceCm;
  if (input.mode === "toCut") {
    return {
      ok: true,
      cutCm: dimensionCm + totalAddedCm,
      finishedCm: dimensionCm,
      totalAddedCm,
    };
  }
  if (input.mode === "toFinished") {
    if (dimensionCm - totalAddedCm <= 0) return fail("dimension");
    return {
      ok: true,
      cutCm: dimensionCm,
      finishedCm: dimensionCm - totalAddedCm,
      totalAddedCm,
    };
  }
  return fail("mode");
}

export interface BiasBindingInput {
  /** Side of the square of fabric, cm. */
  readonly squareCm: number;
  /** Width of the finished strip, cm. */
  readonly stripWidthCm: number;
}

export interface BiasBindingResult {
  readonly stripLengthCm: number;
  readonly stripLengthM: number;
  /** Parallel strips of that width the square would cut into, before joining. */
  readonly stripCount: number;
  /** The square's diagonal, cm — the longest single run before a join. */
  readonly diagonalCm: number;
}

/**
 * How much bias strip a square of fabric yields.
 *
 *     L = s² / w
 *
 * This is area preserved, and it is exact for the continuous method (cut the
 * square on the diagonal, offset the two triangles by one strip width, sew them
 * into a tube and spiral-cut): the strip's area is `L·w` and the fabric's is
 * `s²`. The seam that joins the two triangles steals one strip width, and the
 * surface says so rather than applying an allowance rate the user did not set.
 */
export function biasBinding(input: BiasBindingInput): ProResult<BiasBindingResult> {
  const { squareCm, stripWidthCm } = input;
  if (!isInRange(squareCm, 5, 500)) return fail("square");
  if (!isInRange(stripWidthCm, 0.5, 50)) return fail("stripWidth");
  const stripLengthCm = (squareCm * squareCm) / stripWidthCm;
  return {
    ok: true,
    stripLengthCm,
    stripLengthM: stripLengthCm / 100,
    stripCount: Math.floor(squareCm / stripWidthCm),
    diagonalCm: squareCm * Math.SQRT2,
  };
}

export interface GatherRatioInput {
  /** Flat length of the gathered edge, cm — the piece as cut. */
  readonly flatLengthCm: number;
  /** The length it has to end up as, cm — the seam it is set into. */
  readonly setLengthCm: number;
}

export interface GatherRatioResult {
  /** `flat / set` — 2 means the flat piece is twice the seam it joins. */
  readonly ratio: number;
  /** Centimetres of flat fabric per centimetre of seam. */
  readonly easePerCm: number;
  readonly flatLengthCm: number;
  readonly setLengthCm: number;
}

/**
 * The ratio a gathered edge is worked at, from the two lengths.
 *
 *     ratio = L_flat / L_set
 *
 * A ratio is a MEASUREMENT of how much fullness the fabric takes, not a
 * standard: chiffon gathers at 3:1 where a heavy wool will not pull below 1,5:1,
 * and both of those are facts about cloth. Nothing here offers a number, and
 * nothing here says which one is right for a fabric — the user's own two
 * lengths decide it.
 */
export function gatherRatio(input: GatherRatioInput): ProResult<GatherRatioResult> {
  const { flatLengthCm, setLengthCm } = input;
  if (!isInRange(flatLengthCm, 1, 1000)) return fail("flatLength");
  if (!isInRange(setLengthCm, 1, 1000)) return fail("setLength");
  if (flatLengthCm <= setLengthCm) return fail("flatLength");
  const ratio = flatLengthCm / setLengthCm;
  return {
    ok: true,
    ratio,
    easePerCm: ratio - 1,
    flatLengthCm,
    setLengthCm,
  };
}

export interface ButtonSpacingInput {
  /** Distance between the two end buttons' CENTRES, cm. */
  readonly lengthCm: number;
  /** How many buttons, ends included. */
  readonly buttons: number;
}

export interface ButtonSpacingResult {
  /** Centre-to-centre distance, cm. */
  readonly spacingCm: number;
  /** Centre of each button from the first one, cm. */
  readonly positionsCm: readonly number[];
  readonly buttons: number;
}

/**
 * Where evenly spaced buttons go: `spacing = L / (n − 1)`.
 *
 * `n` is the count INCLUDING both ends, which is why the divisor is `n − 1`
 * rather than `n` — the two end buttons are what the run of spacing is measured
 * between, and counting them as gaps is the classic way to end up with a
 * placket one button short. One button is refused: it is a position, not a
 * spacing.
 */
export function buttonSpacing(input: ButtonSpacingInput): ProResult<ButtonSpacingResult> {
  const { lengthCm, buttons } = input;
  if (!isInRange(lengthCm, 1, 200)) return fail("length");
  if (!isIntegerIn(buttons, 2, 60)) return fail("buttons");
  const spacingCm = lengthCm / (buttons - 1);
  return {
    ok: true,
    spacingCm,
    positionsCm: Array.from({ length: buttons }, (_unused, index) => index * spacingCm),
    buttons,
  };
}
