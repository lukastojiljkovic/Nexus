import { defineConfig } from "vitest/config";

/**
 * The only Vitest config in this repository. It bounds this package's worker
 * pool, and its header exists mostly to stop the next person re-running an
 * experiment that has already been run and has already failed.
 *
 * **The problem.** `pnpm test` exits 1 intermittently — roughly half of all runs
 * — with `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, while
 * reporting every one of this package's 1 900+ tests as PASSED. Nothing is ever
 * wrong with a test: the message is a worker's RPC to the main process timing
 * out, so the run is failed by the reporter rather than by an assertion.
 *
 * **What has been ruled out, by measurement rather than by argument:**
 *
 *  - *Machine load.* It reproduces on an idle machine — two node processes, CPU
 *    at 30 % — so „another lane was building" does not explain it.
 *  - *A leaked database handle.* Every test file in this package closes its
 *    database in `afterEach`; a sweep confirmed no file opens one without.
 *  - *A specific test.* All 1 933 pass in every occurrence, and the error is
 *    raised by a timer inside vitest's own RPC layer, never by an assertion.
 *
 * **`pool: "threads"` LOOKED like the fix and is not — do not try it again.**
 * The reasoning was sound (threads put the same RPC on an in-process
 * `MessagePort` instead of an OS pipe) and three consecutive isolated
 * `npx vitest run --pool=threads` runs came back clean. Run through
 * `pnpm test`, it **segfaults**: exit `-1073741819`, which is `0xC0000005`,
 * an access violation. The encrypted-SQLite native module does not survive
 * being loaded across worker threads here, and a crashing suite is categorically
 * worse than a noisy one — it can report a false pass, where a reporter timeout
 * can only ever report a false failure. Three green isolated runs turned out not
 * to be evidence about the command the gate actually runs; that is the lesson.
 *
 * **What this config does.** Bounds the fork pool to eight. Turbo runs the four
 * packages' test tasks concurrently and Vitest defaults to one worker per core,
 * so a full run asks for roughly sixty forks on a sixteen-core machine; this
 * package is the one that cannot absorb that, because its workers open real
 * encrypted SQLite files and run Argon2id at 128 MiB and are memory-bound rather
 * than CPU-bound. Eight measurably reduces the failure rate and makes the suite
 * FASTER for not thrashing (80 s → 64 s). It does not eliminate it.
 *
 * **So the residual failure is a KNOWN, UNRESOLVED defect**, recorded as one in
 * STATUS rather than papered over here. Every test still runs and nothing about
 * the reporting is relaxed. When it fires, the run is re-run; if a re-run fails
 * for any reason other than this exact reporter timeout with a full green test
 * count, that is a real failure and is treated as one.
 */
export default defineConfig({
  test: {
    poolOptions: {
      forks: { maxForks: 8 },
    },
  },
});
