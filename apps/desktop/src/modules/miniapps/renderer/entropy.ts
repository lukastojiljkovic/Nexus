/**
 * The module's randomness, and the ids it mints.
 *
 * **Why crypto rather than `Math.random`.** A dice roll, a coin and a shuffle
 * are fairness claims: the user is asked to believe the result, and
 * `Math.random` is a fast PRNG whose sequence is recoverable from a few outputs.
 * `crypto.getRandomValues` is the platform's own source, it is available in
 * every renderer this app runs in, and it costs nothing at this scale - a dice
 * roll is a handful of draws.
 *
 * **Why rejection sampling rather than `% bound`.** `value % bound` over
 * `[0, 2^32)` biases the low remainders whenever `bound` does not divide 2^32
 * exactly, which for a d6 is a measurable skew. So values at or above the
 * largest multiple of `bound` below 2^32 are drawn again; the loop is expected
 * to run once, and bound by a retry count so a broken source cannot hang the
 * page.
 *
 * **The engine's contract is honoured exactly.** `@nexus/core`'s
 * `RandomBelow` takes a bound of at least 1 and answers an integer in
 * `[0, bound)`, which is why every draw below goes through the same function
 * whether it is a d20 or a coin.
 */
import type { RandomBelow } from "@nexus/core";

/** How many times a draw may be retried before the source is called broken. */
const MAX_DRAWS = 64;

/** An integer in `[0, bound)`, from the platform's cryptographic source, without modulo bias. */
export const cryptoRandomBelow: RandomBelow = (bound: number): number => {
  if (!Number.isInteger(bound) || bound < 1) {
    throw new RangeError("randomBelow needs a whole bound of at least 1");
  }
  // The largest multiple of `bound` that fits in 32 bits: values below it are
  // uniform over the bound, values at or above it would skew the low
  // remainders.
  const ceiling = Math.floor(0x1_0000_0000 / bound) * bound;
  const buffer = new Uint32Array(1);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? 0;
    if (value < ceiling) return value % bound;
  }
  throw new Error("the platform's random source is not answering");
};

/**
 * An id for a row the user is creating - a counter, a player.
 *
 * Sixteen random bytes as hex: a fixed 32 characters, no whitespace, and well
 * inside the id bound the wire and the store both apply (`MAX_ID_LENGTH`). The
 * engine's own `assertId` only asks for a non-empty, bounded string, so the
 * shape is this module's choice; hex is chosen so an id is readable in a log and
 * never needs quoting.
 */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
