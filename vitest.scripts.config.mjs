import { defineConfig } from "vitest/config";

/**
 * The repo ROOT's own Vitest project — the tooling under `scripts/`, and
 * nothing else. Every package tests itself through its own config, which
 * `turbo run test` fans out to; this exists because the root's scripts are not
 * a package and turbo's task graph therefore never reaches them.
 *
 * **The FILENAME is load-bearing and this file must never be called
 * `vitest.config.*` or `vite.config.*`.** Vitest auto-discovers those names,
 * and a package with no config of its own then resolves to the nearest one up
 * the tree — which is here. `@nexus/core` has no config, so for one day in
 * August 2026 its ENTIRE suite, 2 556 tests, silently collected zero files
 * while turbo happily replayed a cached log from before the config existed.
 * The run was green and the tests were not running. This name is only ever
 * reached through the explicit `--config` in the root's `test` script, and
 * `scripts/root-config.test.mjs` fails if an auto-discovered config reappears
 * at the root.
 *
 * `exclude` is the load-bearing part. Without it a root-level run globs the
 * entire tree, and this repo routinely contains full checkouts of itself:
 * parallel work happens in git worktrees under `.claude/worktrees/`, each with
 * its own copy of `scripts/`. A run would then collect the same suites twice —
 * once live, once from a checkout at some other commit — and report failures
 * belonging to neither. It cost an afternoon once; it is one line here.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
    exclude: ["**/node_modules/**", ".claude/**", "**/dist/**", "**/out/**"],
    /**
     * Vitest's default is 5 000 ms, which is a UNIT TEST's budget.
     *
     * Nothing here is a unit test. Every gate walks the whole repository and
     * most of them parse what they find, so the cost is I/O and CPU contention
     * rather than anything about the code under test — and thirty-one of them
     * run at once (`find scripts -name "*.test.mjs"`, which is the glob above;
     * this said „twenty-three" for a while and was then bumped to „twenty-four"
     * by an agent adding one file, which is the same copied figure one digit
     * later. Count it). `check:quotes` takes 2.7 s alone on this machine and timed
     * out at 5 s in a full run on 2026-09-03, with a message („Test timed out")
     * that names neither the gate's subject nor the real cause. A CI runner
     * with fewer cores is the same failure with less warning.
     *
     * 30 s is a tenfold margin on the slowest gate measured, and still far
     * shorter than any run in which a gate is genuinely stuck. Raising it costs
     * nothing: a passing gate never spends it.
     */
    testTimeout: 30_000,
  },
});
