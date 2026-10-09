/**
 * The seeded shuffle, and the port that makes it testable.
 *
 * **The generator is handed in, not read from the platform.** A shuffle tested
 * against `Math.random` can only be asserted on its shape, which is the
 * assertion that passes on a shuffle that does not shuffle; a shuffle given a
 * written-down sequence of draws can be asserted on its ORDER, and its exact
 * order is what a saved game depends on. `devtools/random.ts` makes the same
 * argument for the byte port it owns.
 *
 * **The default source is xorshift32** (Marsaglia, *Xorshift RNGs*, Journal of
 * Statistical Software 8(14), 2003 — the triple (13, 17, 5) is the one that
 * paper gives for 32-bit words). It is not cryptographic and does not need to
 * be: it decides the order of a deck of cards, and what the deal must be is
 * *reproducible*, which is exactly what a game number buys. Its one fixed point
 * is zero, so a seed of zero is folded to a nonzero word rather than left to
 * return 32 zero draws.
 *
 * **`randomBelow` rejects rather than takes a modulus.** `value % bound` is
 * biased towards the low results whenever the bound does not divide 2^32 — by
 * one draw in 2^32 for a bound of 3 and, for a bound near 2^31, by half of them.
 * The rejection is the standard one: draw again while the word lands in the
 * short tail.
 */

/** A source of 32-bit words. Exactly one method, so a test can write its own in three lines. */
export interface RandomSource {
  /** A whole number in 0…2^32 − 1. */
  nextUint32(): number;
}

const RANDOM_RANGE = 0x1_0000_0000;

/** Any nonzero word will do; this one is the golden-ratio constant the splitmix family seeds with. */
const ZERO_SEED_FOLD = 0x9e3779b9;

/**
 * One xorshift32 step. For seed 1 the whole first step is `1 ^ (1 << 13)`:
 * shifting a one-bit word right by 17 bits yields nothing, so the value is
 * 0x2001 and then 0x2001 ^ (0x2001 << 5) = 0x42021 (270 369) — the first value
 * `shuffle.test.ts` asserts. Every value after it is the same three lines.
 */
function stepXorshift(value: number): number {
  let word = value;
  word ^= word << 13;
  word ^= word >>> 17;
  word ^= word << 5;
  return word >>> 0;
}

/** The default source: xorshift32 stepping from `seed`, folded to a 32-bit unsigned word. */
export function createSeededRandom(seed: number): RandomSource {
  let state = (Math.trunc(seed) >>> 0) || ZERO_SEED_FOLD;
  return {
    nextUint32(): number {
      state = stepXorshift(state);
      return state;
    },
  };
}

/**
 * A uniformly distributed whole number in 0…`bound` − 1, rejecting the short
 * tail so that no result is likelier than another. `bound` is at most 2^32, at
 * which point nothing is rejected because every word is already in range.
 */
export function randomBelow(source: RandomSource, bound: number): number {
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > RANDOM_RANGE) {
    throw new Error(
      `randomBelow: bound must be a whole number in 1…${RANDOM_RANGE}, got ${bound}`,
    );
  }
  const limit = RANDOM_RANGE - (RANDOM_RANGE % bound);
  let value = source.nextUint32();
  while (value >= limit) value = source.nextUint32();
  return value % bound;
}

/**
 * Fisher–Yates from the top down: for each position from the end, swap it with a
 * uniformly drawn earlier-or-equal one. The input is not touched — a deal is
 * derived from a deck, never at its expense.
 */
export function shuffle<T>(items: readonly T[], source: RandomSource): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const pick = randomBelow(source, index + 1);
    const held = out[index]!;
    out[index] = out[pick]!;
    out[pick] = held;
  }
  return out;
}
