/**
 * How much longer `run` takes when its input grows from a sixteenth of `size`
 * to all of it: about sixteen times for a pass that reads its input once,
 * about 256 for one that re-reads what it has already read.
 *
 * The linear-time tests used to hold each pass to a wall-clock bar, and a bar
 * measures the machine as much as the code. CI runs every package's suite at
 * once on a four-core runner, where a strip that takes 31 ms on a desktop took
 * 340 ms and failed its 200 ms bar. Growth does not depend on the machine, and
 * growth is what made the old patterns a fault, so growth is what these tests
 * hold, against `LINEAR_GROWTH`.
 *
 * The step is sixteenfold because CI's load is not steady either: a strip that
 * grew 2.2 times across a fourfold step on a desktop grew 8.5 times there,
 * which leaves a fourfold step no room between one pass (4) and a re-read (16).
 *
 * One untimed run warms the JIT. The small input is then probed to work out how
 * many repetitions make a sample long enough for the timer, capped so the full
 * input cannot turn the suite into a benchmark. Each size runs those repetitions
 * three times, alternating so that a busy stretch of the machine falls on both,
 * and the fastest total of each is kept: a collector pause or a neighbouring
 * suite only ever adds time.
 */
export function growthToFull<T>(
  build: (size: number) => T,
  run: (input: T) => unknown,
  size: number,
): number {
  const small = build(Math.floor(size / 16));
  const full = build(size);
  run(small);
  run(full);
  const probeMs = timed(run, small);
  const repetitions = Math.max(
    1,
    Math.min(MAX_REPETITIONS, Math.ceil(TARGET_SAMPLE_MS / Math.max(probeMs, 0.1))),
  );
  let smallMs = Number.POSITIVE_INFINITY;
  let fullMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 3; round += 1) {
    smallMs = Math.min(smallMs, timed(run, small, repetitions));
    fullMs = Math.min(fullMs, timed(run, full, repetitions));
  }
  return fullMs / Math.max(smallMs, 0.1);
}

/** Four times the growth of one pass, a quarter of the growth of a re-read. */
export const LINEAR_GROWTH = 64;

const TARGET_SAMPLE_MS = 10;
const MAX_REPETITIONS = 32;

function timed<T>(run: (input: T) => unknown, input: T, repetitions = 1): number {
  const started = performance.now();
  for (let round = 0; round < repetitions; round += 1) run(input);
  return performance.now() - started;
}
