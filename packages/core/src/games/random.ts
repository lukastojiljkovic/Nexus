/**
 * The random source the two arcade games draw from — mulberry32, spelled out
 * here rather than depended on, exactly as `study/interleave.ts` spells it out
 * for a practice order.
 *
 * **Both games have to be REPLAYABLE, and that is what decides this file.**
 * Minesweeper places its mines from this stream on the first click, and Blocks
 * fills its piece bag from it, so a seed plus an input log is a whole game: a
 * test can name an exact board or an exact final score, and a report that carries
 * its seed is a reproduction rather than a description. `Math.random` can do none
 * of that, so nothing under `games/` may call it — both engines take a source in,
 * which is also the only way either of them can be pure.
 *
 * **That is why this is not `devtools/random.ts`'s `RandomPort`.** That port is a
 * CSPRNG handing out BYTES for secrets — tokens, passwords, salts — where the
 * requirement is unguessability and the test asserts a rejection rule. Nothing
 * here is a secret and nothing here has to be unguessable; what it has to be is
 * the same on every machine and every run, which the platform CSPRNG does not
 * promise and an explicitly seeded generator does.
 *
 * **Why the 32-bit position is readable.** `BlocksState` carries it, because a
 * `step` that has to be a pure function of the state it is handed cannot also
 * hold a generator the caller keeps. Reading the position into a fresh stream
 * resumes the sequence exactly — pointer and all — and the engine never hands one
 * stream to two holders, so there is no aliasing to reason about.
 */

/**
 * One mulberry32 stream: thirty-two bits of state, one multiply-xor round, a
 * uniform `[0, 1)`.
 *
 * `state` is the generator's position and is plain data on purpose — it is what a
 * game carries when it has to remember where in the stream it stopped.
 */
export interface SeededRandom {
  state: number;
  /** The next uniform float in `[0, 1)`. */
  next(): number;
}

/**
 * A fresh stream at `seed`. The object closes over itself rather than reading
 * `this`, so `const { next } = stream` keeps working — a generator is passed
 * around as a value here, and a method that lost its receiver on the way would be
 * a game that quietly stopped being random.
 */
export function createSeededRandom(seed: number): SeededRandom {
  const stream: SeededRandom = {
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

/** A uniform integer in `[0, bound)`. A bound that is not a positive whole number is a caller's bug, not a value to repair. */
export function randomBelow(random: SeededRandom, bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`randomBelow: bound must be a positive whole number, got ${bound}`);
  }
  return Math.floor(random.next() * bound);
}

/**
 * Fisher–Yates, descending, out of place — the standard unbiased shuffle, and the
 * one move both games borrow: a bag of seven pieces and a list of candidate cells
 * are the same problem. The input array is never reordered (`interleave`'s
 * contract), because a caller here is often a frozen constant.
 */
export function shuffled<T>(items: readonly T[], random: SeededRandom): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomBelow(random, i + 1);
    const at = out[i] as T;
    out[i] = out[j] as T;
    out[j] = at;
  }
  return out;
}
