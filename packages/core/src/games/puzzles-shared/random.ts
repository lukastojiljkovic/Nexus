/**
 * The seeded random source the puzzle engines draw from — mulberry32, spelled
 * out here rather than depended on, exactly as `study/interleave.ts` spells it
 * out for a practice order.
 *
 * **Reproducibility is what decides this file.** Every puzzle in `games/` is a
 * draw from a stream: sudoku digs its holes from one, 2048 places its spawns,
 * the nonogram generator rejects candidates, mahjong picks pairs, Broj draws its
 * numbers and the snake places its food. A seed plus a move log is therefore a
 * whole game — a test can name an exact grid and a report that carries its seed
 * is a reproduction rather than a description. `Math.random` can do none of
 * that, so nothing under `games/` calls it: every engine takes a source in,
 * which is also the only way any of them can stay pure.
 *
 * **The copy is deliberate.** The same twenty lines already exist in
 * `study/interleave.ts` and in the arcade's `games/random.ts`, and this is a
 * third. A shared module for one generator would couple two areas that share
 * nothing else, and the arithmetic is small enough to read; if the maintainer
 * wants one home for it, folding the three in is a mechanical edit.
 */

/**
 * One mulberry32 stream: thirty-two bits of state, one multiply-xor round, a
 * uniform `[0, 1)`.
 *
 * `state` is the generator's position and is plain data on purpose — it is what
 * a game carries when it has to remember where in the stream it stopped, so a
 * state can round-trip through JSON and resume exactly.
 */
export interface PuzzleRandom {
  state: number;
  next(): number;
}

/**
 * A fresh stream at `seed`. The object closes over itself rather than reading
 * `this`, so `const { next } = stream` keeps working — a generator is passed
 * around as a value here, and a method that lost its receiver would be a puzzle
 * that quietly stopped varying.
 */
export function createPuzzleRandom(seed: number): PuzzleRandom {
  const stream: PuzzleRandom = {
    state: seed >>> 0,
    next(): number {
      stream.state = (stream.state + 0x6d2b79f5) >>> 0;
      let t = stream.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
  return stream;
}

/** A uniform whole number in `[0, bound)`. A bound that is not a positive whole number is a caller's bug, not a value to repair. */
export function randomBelow(random: PuzzleRandom, bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`randomBelow: bound must be a positive whole number, got ${bound}`);
  }
  return Math.floor(random.next() * bound);
}

/**
 * Fisher–Yates, descending, out of place — the standard unbiased shuffle, and the
 * one move every generator in this area borrows: a list of digits to try, a list
 * of cells to dig, a list of tiles to deal. The input array is never reordered,
 * because a caller here is often a frozen constant.
 */
export function shuffled<T>(items: readonly T[], random: PuzzleRandom): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomBelow(random, i + 1);
    const at = out[i] as T;
    out[i] = out[j] as T;
    out[j] = at;
  }
  return out;
}
