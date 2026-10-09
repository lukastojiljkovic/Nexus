/**
 * The seeded random source every board game in `games/` draws from.
 *
 * No engine here may read `Math.random`: dice rolls, shuffles and the tie-break
 * inside a search all come from the caller's `Rng`, so a saved game replays its
 * dice and a search is deterministic for a seed. `createRng` is mulberry32
 * spelled out rather than depended on, for the reason `study/interleave.ts`
 * gives for its own unexported copy: thirty-two bits of state, one multiply-xor
 * round, a uniform `[0, 1)` â€” reproducible on every platform, which
 * `Math.random` is not. The maintainer consolidates the two copies at merge;
 * this one is exported because the games and their tests must share it.
 */

/** A uniform source: each call returns a number in `[0, 1)`. */
export type Rng = () => number;

/**
 * mulberry32 â€” the whole of it. Passed a seed, returns the generator.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One die, `1..sides` inclusive. The floor of a `[0, 1)` draw, so every face is
 * equally likely and no face is ever skipped or doubled.
 */
export function rollDie(random: Rng, sides: number): number {
  return Math.floor(random() * sides) + 1;
}

/** `count` dice rolled together, in order. Backgammon and ludo both need two. */
export function rollDice(random: Rng, count: number, sides: number): number[] {
  const dice: number[] = [];
  for (let index = 0; index < count; index += 1) dice.push(rollDie(random, sides));
  return dice;
}

/**
 * Fisherâ€“Yates over a COPY, descending â€” the standard unbiased shuffle. The
 * input is never touched; engines here are pure and a caller's array is the
 * caller's.
 */
export function shuffled<T>(random: Rng, items: readonly T[]): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const at = copy[index] as T;
    copy[index] = copy[other] as T;
    copy[other] = at;
  }
  return copy;
}

