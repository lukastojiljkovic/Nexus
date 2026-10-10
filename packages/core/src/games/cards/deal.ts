/**
 * The one derivation every card game with several deals to a game uses to seed
 * each one: the shuffle of deal `index` under a game's `seed`.
 *
 * **A game is played to a target, so one seed has to produce many deals.** Hearts
 * is played to a hundred points, Spades to five hundred and Tablić to a hundred
 * and one, and each of those is several deals of the same deck; a saved game
 * carries one seed and the whole action log, so deal 3's shuffle must be a
 * function of `(seed, 3)` and of nothing else — not of a stream the caller kept,
 * not of the clock. The index is folded into the seed with a 32-bit multiply and
 * the low bits kept, which is enough for the only property that matters here:
 * deal n of seed s and deal n of seed s+1 are different shuffles, and neither is
 * a shift of the other.
 *
 * It lives here rather than in `random.ts` because it is a card-table rule —
 * „this is how a game numbers its deals" — and not a property of a generator.
 */

import { createSeededRandom, type SeededRandom } from "../random.js";

/** The 32-bit odd multiplier the deal index is mixed with (the golden-ratio constant). */
const DEAL_MIX = 0x9e37_79b9;

/** The stream deal `index` of a game seeded with `seed` is shuffled from. */
export function dealRandom(seed: number, index: number): SeededRandom {
  return createSeededRandom((seed + Math.imul(index, DEAL_MIX)) >>> 0);
}
