/**
 * „Stolarija" — the arithmetic behind the toolkit's tools.
 *
 * One file per PACK, as `pro/gradnja.ts` explains.
 *
 * **This is the shortest professional pack in the drawer, and that is a
 * finding rather than an accident.** Woodworking turned out to be the trade
 * `zanat` had already covered: the timber take-off, the stair flight, the mitre
 * and compound mitre, the shelf deflection, the shelf spacing and the moisture
 * movement are all built and tested there, and this pack REGISTERS them (it adds
 * its name to their `packs`) instead of re-implementing one of them. What was
 * genuinely missing was the board foot — the unit the timber trade prices in on
 * every market that is not metric — so that is the one function here.
 *
 * Splitting this file's job from `zanat`'s is a decision about the PACK, never
 * about the arithmetic: a joiner who switches on „Stolarija" sees the six other
 * tools because they were always for him too, and this file adds the seventh.
 */

import { fail, isInRange, isIntegerIn, isPositive, type ProResult } from "./result.js";

/**
 * One board foot, in cubic millimetres.
 *
 * A board foot is DEFINED as one foot square by one inch thick — 144 in³ — and
 * the international inch is exactly 25,4 mm (International yard and pound
 * agreement, 1959), so 144 × 25,4³ = 2 359 737,216 mm³ exactly. The constant is
 * written as the product rather than as its decimal so the definition stays
 * visible at the one place it is used.
 */
const BOARD_FOOT_MM3 = 144 * 25.4 ** 3;

/** Cubic millimetres in a cubic metre; SI prefix definition. */
const MM3_PER_M3 = 1e9;

/** Cubic millimetres in a cubic foot — 12³ cubic inches. */
const MM3_PER_FT3 = 12 ** 3 * 25.4 ** 3;

/** The trade writes a batch of stock as pieces; a single piece is `pieces: 1`. */
export type BoardFootInput =
  | {
      readonly mode: "pieces";
      /** Nominal (rough) thickness, mm. */
      readonly thicknessMm: number;
      readonly widthMm: number;
      readonly lengthMm: number;
      readonly pieces: number;
    }
  | { readonly mode: "volume"; readonly volumeM3: number }
  | { readonly mode: "boardFeet"; readonly boardFeet: number };

export interface BoardFootResult {
  readonly boardFeet: number;
  readonly volumeM3: number;
  readonly volumeFt3: number;
  /** Board feet in ONE piece; equal to `boardFeet` for the two conversion modes. */
  readonly boardFeetPerPiece: number;
}

/**
 * Board feet, cubic metres and cubic feet, from a cutting list or from a volume.
 *
 * **Nominal thickness is what the trade prices**, and this function does not
 * pretend otherwise: it multiplies the three dimensions it is given and never
 * applies a planing allowance, because a 2×4 is bought as 50 × 100 mm and
 * surfaced to something else. The surface says so rather than embedding a
 * deduction rate, which is a mill's own figure.
 */
export function boardFoot(input: BoardFootInput): ProResult<BoardFootResult> {
  if (input.mode === "pieces") {
    const { thicknessMm, widthMm, lengthMm, pieces } = input;
    if (!isInRange(thicknessMm, 1, 1000)) return fail("thickness");
    if (!isInRange(widthMm, 1, 2000)) return fail("width");
    if (!isInRange(lengthMm, 10, 20000)) return fail("length");
    if (!isIntegerIn(pieces, 1, 100000)) return fail("pieces");
    const volumePerPieceMm3 = thicknessMm * widthMm * lengthMm;
    const boardFeetPerPiece = volumePerPieceMm3 / BOARD_FOOT_MM3;
    return {
      ok: true,
      boardFeet: boardFeetPerPiece * pieces,
      volumeM3: (volumePerPieceMm3 * pieces) / MM3_PER_M3,
      volumeFt3: (volumePerPieceMm3 * pieces) / MM3_PER_FT3,
      boardFeetPerPiece,
    };
  }

  if (input.mode === "volume") {
    if (!isPositive(input.volumeM3) || input.volumeM3 > 1e6) return fail("volume");
    const boardFeet = (input.volumeM3 * MM3_PER_M3) / BOARD_FOOT_MM3;
    return {
      ok: true,
      boardFeet,
      volumeM3: input.volumeM3,
      volumeFt3: (input.volumeM3 * MM3_PER_M3) / MM3_PER_FT3,
      boardFeetPerPiece: boardFeet,
    };
  }

  if (input.mode === "boardFeet") {
    if (!isPositive(input.boardFeet) || input.boardFeet > 1e9) return fail("boardFeet");
    const volumeM3 = (input.boardFeet * BOARD_FOOT_MM3) / MM3_PER_M3;
    return {
      ok: true,
      boardFeet: input.boardFeet,
      volumeM3,
      volumeFt3: (volumeM3 * MM3_PER_M3) / MM3_PER_FT3,
      boardFeetPerPiece: input.boardFeet,
    };
  }

  return fail("mode");
}
