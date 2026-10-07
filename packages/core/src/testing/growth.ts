/**
 * How much longer `run` takes when its input grows from a quarter of `size` to
 * all of it: about four times for a pass that reads its input once, about
 * sixteen for one that re-reads what it has already read.
 *
 * The linear-time tests used to hold each pass to a wall-clock bar, and a bar
 * measures the machine as much as the code. CI runs every package's suite at
 * once on a four-core runner, where a strip that takes 31 ms on a desktop took
 * 340 ms and failed its 200 ms bar. Growth does not depend on the machine, and
 * growth is what made the old patterns a fault, so growth is what these tests
 * hold, against `LINEAR_GROWTH`.
 *
 * One untimed run warms the JIT. Then the two sizes run three times each,
 * alternating so that a busy stretch of the machine falls on both, and the
 * fastest of each is kept: a collector pause or a neighbouring suite only ever
 * adds time. The quarter is floored at `FLOOR_MS`, because a ratio over a run
 * too short to time is noise.
 */
export function growthToFull<T>(
  build: (size: number) => T,
  run: (input: T) => unknown,
  size: number,
): number {
  const quarter = build(Math.floor(size / 4));
  const full = build(size);
  run(quarter);
  let quarterMs = Number.POSITIVE_INFINITY;
  let fullMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 3; round += 1) {
    quarterMs = Math.min(quarterMs, timed(run, quarter));
    fullMs = Math.min(fullMs, timed(run, full));
  }
  return fullMs / Math.max(quarterMs, FLOOR_MS);
}

/** Twice the growth of one pass, half the growth of a pass that re-reads. */
export const LINEAR_GROWTH = 8;

const FLOOR_MS = 2;

function timed<T>(run: (input: T) => unknown, input: T): number {
  const started = performance.now();
  run(input);
  return performance.now() - started;
}
