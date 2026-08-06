import { defineConfig } from "vitest/config";

/**
 * The repo ROOT's own Vitest project — the tooling under `scripts/`, and
 * nothing else. Every package tests itself through its own config, which
 * `turbo run test` fans out to; this exists because the root's scripts are not
 * a package and turbo's task graph therefore never reaches them.
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
