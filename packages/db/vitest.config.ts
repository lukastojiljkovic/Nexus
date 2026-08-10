import { defineConfig } from "vitest/config";

/**
 * Vitest for `@nexus/db`. It exists for one fixed bug, one standing warning and
 * one number that has to be chosen rather than inherited. (This header used to
 * open „the only Vitest config in this repository"; `apps/desktop` and
 * `apps/web` each have one too, and did when that line was written.)
 *
 * **The bug.** `pnpm test` failed roughly half its runs with
 * `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` while reporting every
 * one of this package's 1 900+ tests as PASSED. It was never an assertion: a
 * rejected RPC promise surfaces as an „Unhandled Error" and sets
 * `process.exitCode = 1`, so a green run went red.
 *
 * **The cause, established from vitest's own source rather than guessed.** The
 * 60 s deadline is armed in the WORKER and cleared in exactly one place — the
 * worker's `process.on("message")` handler — so it measures whether the worker
 * DISPATCHED the reply, not whether main sent one. Between tests the runner
 * yields a microtask, which never advances libuv to the poll phase, so a file of
 * back-to-back synchronous native SQLite work never reads its acks and any file
 * over 60 s fails the run. `vitest.setup.ts` carries the full chain with
 * citations; the fix is the awaited `setImmediate` it installs, and it makes
 * file duration stop mattering.
 *
 * Two things measured in both directions, worth keeping so the diagnosis is
 * re-checkable: nine files run sequentially in ONE fork totalled 74 s — over the
 * limit, longest file 20 s — and were CLEAN, which kills „the run is too long";
 * while single files at 84.1 s, 65.1 s and 64.6 s each fired and the same suite
 * minus its one long file was clean twice, which is what leaves „the FILE is too
 * long" standing.
 *
 * **A correction to this file's own previous header.** It claimed these workers
 * „run Argon2id at 128 MiB" and are „memory-bound". That is false and was my
 * error: `@nexus/db` depends on `@nexus/core`, `better-sqlite3-multiple-ciphers`
 * and `ts-fsrs`, `hash-wasm` appears nowhere in its graph, and SQLCipher here is
 * keyed with a RAW 256-bit key and no KDF (`src/database.ts:15`). No key
 * derivation runs in this suite at all, and no single test blocks the loop for
 * more than about 1.4 s.
 *
 * **The standing warning — `pool: "threads"` is not the answer, do not try it
 * again.** The reasoning is tempting (threads put the same RPC on an in-process
 * `MessagePort`) and three consecutive isolated runs came back clean. Run through
 * `pnpm test` it SEGFAULTS: exit `-1073741819`, `0xC0000005`. The encrypted
 * SQLite native module does not survive being loaded across worker threads here,
 * and a crash can report a false PASS where a reporter timeout can only ever
 * report a false failure. The lesson that came with it: three green isolated runs
 * are not evidence about the command the gate actually runs.
 */
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    /**
     * Vitest's default is 5 000 ms, and nobody in this repository ever chose it.
     * These tests open a real encrypted SQLite database per case, so they are
     * legitimately slow: the header above measures the worst at about 1.4 s on
     * a developer machine, and CI run 31367258129 measured the same suite's
     * worst at 4 332 ms — `RestoreStore > T10`, passing, with six more between
     * 3.4 s and 4.2 s. That is 668 ms of headroom under the default, on a gate
     * that runs on a shared runner whose speed is not ours to control, and a
     * red build there says „a different test each time" rather than „something
     * broke". 20 s is four times the slowest observed pass, which still fails a
     * genuinely hung test inside a coffee break.
     */
    testTimeout: 20_000,
    /**
     * Bounded because turbo runs four packages' suites concurrently and vitest
     * defaults to one worker per core — about sixty forks on a sixteen-core
     * machine. This is about thrash, not about the bug above, which the setup
     * file fixes on its own: measured at 80 s unbounded against 64 s at eight.
     */
    poolOptions: {
      forks: { maxForks: 8 },
    },
  },
});
