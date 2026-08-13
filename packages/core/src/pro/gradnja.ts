/**
 * „Gradnja i projektovanje" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category.** The rail groups by category and the
 * profile filters by pack (`TOOL_CATEGORIES`), but neither of those is a file
 * layout: what a maintainer asks is „where does the stair calculator live", and
 * `pro/gradnja.ts` answers it where `pro/geometry.ts` would not. A tool several
 * packs share lives in the file of its FIRST pack in `TOOL_PACKS` order — a rule
 * with no judgement in it, so nobody has to relitigate ownership per tool.
 *
 * **These are pure functions and they refuse rather than repair**, exactly as
 * `@nexus/core/devtools/*` does. A surface owns its own state, formats nothing
 * on its own, and asks here for every number it prints — which is why the test
 * vectors below are the ones a person can check by hand rather than snapshots of
 * whatever the code happened to produce.
 *
 * **Nothing here decides anything.** A tool in this pack computes a quantity;
 * whether that quantity is acceptable is a question for the licensed
 * professional who is answerable for the building, and the contract makes that
 * structural rather than aspirational (`toolForbidsVerdict`). Where a rule has a
 * limit, the limit is an INPUT with no default, and what comes back is the pair
 * of numbers and their ratio — never a word about what the pair means.
 */

import { fail, isIntegerIn, isPositive, ratioAgainst, type ProResult } from "./result.js";

const DEG_PER_RAD = 180 / Math.PI;

/**
 * How a flight meets the landing at the top, which is the only thing that
 * decides whether there are `n` goings or `n − 1`.
 *
 * It is an input rather than an assumption because both are ordinary and the
 * difference is one whole going — the width of the flight's footprint being
 * wrong by 280 mm is exactly the error that is discovered on site.
 */
export type StairTop = "flush" | "landing";

export interface StairInput {
  /** Floor-to-floor height, in millimetres. Finished floor to finished floor. */
  readonly rise: number;
  /** Number of RISERS, not of goings. */
  readonly risers: number;
  /** Going — the horizontal tread depth, in millimetres. */
  readonly going: number;
  readonly top: StairTop;
  /**
   * The user's own limits, from whichever rule they are working to. Absent means
   * they gave none, and then no comparison is drawn at all.
   *
   * These are `regulated`-tier constants (`TOOL_CONSTANT_TIERS`): a maximum
   * riser is a number a rule-maker chose and can change, it differs between a
   * dwelling, a school and a fire escape, and it differs between countries. An
   * embedded default would be this app asserting which rule applies to a
   * building it has never seen.
   */
  readonly riserLimit?: number | undefined;
  readonly goingLimit?: number | undefined;
}

export interface StairFlight {
  /** Rise of one step, in mm. Deliberately NOT rounded — see the note in `stairFlight`. */
  readonly riser: number;
  readonly goings: number;
  /** Total horizontal run of the flight, in mm. */
  readonly run: number;
  /** Pitch above the horizontal, in degrees. */
  readonly pitch: number;
  /** 2r + g, in mm — Blondel's 1675 expression, which is a defined quantity and not a rule. */
  readonly blondel: number;
  /** computed ÷ the user's own limit, or undefined when they supplied none. */
  readonly riserRatio: number | undefined;
  readonly goingRatio: number | undefined;
}

/**
 * A straight flight, from its floor-to-floor height and its riser count.
 *
 * **The riser is not rounded, and that is the whole point of computing it here.**
 * A flight is built to a floor-to-floor height that is fixed, so `H/n` is exact
 * by construction and every riser in the flight is identical. Rounding it to a
 * whole millimetre spreads the remainder somewhere — in practice onto the last
 * step, which is the single most common defect in a built stair and the one a
 * person actually trips on. Three decimals of a millimetre is not false
 * precision here; it is the statement that the division was not fudged.
 *
 * `goings = risers − 1` for a flight that arrives flush with the upper floor:
 * the last riser lands ON the floor, so it has no tread of its own. A flight
 * arriving at a landing in the plane of the last riser has `n` goings.
 */
export function stairFlight(input: StairInput): ProResult<StairFlight> {
  const { rise, risers, going, top } = input;
  if (!isPositive(rise)) return fail("rise");
  if (!isIntegerIn(risers, 1, 60)) return fail("risers");
  if (!isPositive(going)) return fail("going");

  const riser = rise / risers;
  const goings = top === "flush" ? risers - 1 : risers;
  return {
    ok: true,
    riser,
    goings,
    run: goings * going,
    pitch: Math.atan(riser / going) * DEG_PER_RAD,
    blondel: 2 * riser + going,
    riserRatio: ratioAgainst(riser, input.riserLimit),
    goingRatio: ratioAgainst(going, input.goingLimit),
  };
}

/**
 * The riser count a desired riser height implies, with its two neighbours.
 *
 * Returned as three candidates rather than one because the rounded answer is
 * frequently the worse stair: `H/r*` almost never lands on an integer, and the
 * flight one riser longer often has both a kinder pitch and a going that fits
 * the space. Choosing between them is the designer's, so the tool hands over all
 * three and names none of them the answer.
 */
export function stairRiserCandidates(rise: number, desiredRiser: number): ProResult<{
  readonly candidates: readonly { readonly risers: number; readonly riser: number }[];
}> {
  if (!isPositive(rise)) return fail("rise");
  if (!isPositive(desiredRiser)) return fail("desiredRiser");
  const nearest = Math.round(rise / desiredRiser);
  const candidates = [nearest - 1, nearest, nearest + 1]
    .filter((risers) => risers >= 1 && risers <= 60)
    .map((risers) => ({ risers, riser: rise / risers }));
  return candidates.length === 0 ? fail("rise") : { ok: true, candidates };
}
