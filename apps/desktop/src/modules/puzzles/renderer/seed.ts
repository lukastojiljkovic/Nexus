/**
 * A fresh seed for a new game.
 *
 * **Why the clock alone is not enough.** Every engine here is a pure function of
 * its seed, so a game's identity is exactly its seed, and two new games started
 * in the same millisecond would otherwise be the SAME game. The rolling counter
 * is what makes „Nova igra" a new game when it is pressed twice in a row, which
 * is the one case a person reaches for it.
 *
 * **Why the seed is folded into 31 bits, by mask rather than by naming the
 * bound.** `games/random.ts` reduces whatever it is handed to a `uint32`, and
 * the store refuses a seed past `2^31 - 1` (`MAX_PUZZLE_SEED`). That constant
 * lives in `@nexus/db`, which no renderer file may import — it is SQLite and
 * therefore Node-only — so the mask is what states the same bound here, and the
 * page can only ever hand main a seed the store will take.
 */
let step = 0;

export function newSeed(nowMs: number = Date.now()): number {
  step = (step + 1) % 1_000;
  // The golden-ratio odd constant spreads the counter across the word, so two
  // readings a millisecond apart are not two neighbouring numbers.
  const mixed = Math.floor(nowMs) ^ (step * 0x9e3779b1);
  return mixed & 0x7fffffff;
}
