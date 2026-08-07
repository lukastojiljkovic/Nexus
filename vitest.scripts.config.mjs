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
  },
});
