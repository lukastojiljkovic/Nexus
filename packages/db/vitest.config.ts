import { defineConfig } from "vitest/config";

/**
 * The only Vitest config in this repository, and it exists to make one gate
 * deterministic rather than to configure anything.
 *
 * **The failure it fixes.** `pnpm test` intermittently exited 1 with
 * `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` while reporting
 * every one of this package's tests as passed. Nothing was wrong with a test:
 * the message is a worker's RPC to the main process timing out, so the run is
 * marked failed by the reporter rather than by an assertion.
 *
 * **Why it happens here and nowhere else.** Turbo runs the four packages' test
 * tasks CONCURRENTLY, and Vitest's default pool is one fork per core minus one
 * — so a full `pnpm test` on a sixteen-core machine asks for roughly sixty
 * forks. This package is the one that cannot absorb that: its suites open real
 * encrypted SQLite files and run Argon2id at 128 MiB per derivation (ADR-022),
 * so its workers are memory-bound rather than CPU-bound, and the pressure
 * starves the process that is supposed to be answering their RPC. Isolated,
 * the same suite is green; under a concurrent full run it failed about half the
 * time. That is a gate nobody can read.
 *
 * **Bounded rather than retried, and bounded rather than silenced.** Every test
 * still runs, and nothing about the reporting is relaxed — the pool is simply
 * small enough that the main process stays responsive. Eight is half the cores
 * of the machine this was measured on and leaves room for the three suites
 * running beside it; the suite's wall-clock cost is a few seconds, which is
 * worth paying for a result that means what it says.
 */
export default defineConfig({
  test: {
    poolOptions: {
      forks: { maxForks: 8 },
    },
  },
});
