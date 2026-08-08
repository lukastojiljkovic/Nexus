import { defineConfig } from "vitest/config";

/**
 * Vitest for `apps/web`, NODE environment only — there is no DOM library in
 * this repo and none is being added, so what runs here is exactly what can run
 * without one. Today that is the deployment gates: the ones that read
 * `public/_headers` and `wrangler.jsonc` off disk and assert that the security
 * policy this app ships is the one that was agreed.
 *
 * An include list is a promise about where tests may be written, and it names
 * `test/` alone. A suite written under `src/` would be collected by nothing and
 * report nothing, which is indistinguishable from passing — the trap
 * `apps/desktop`'s config found in its own `src/shared` on 2026-08-07. A new
 * root gets added the day something is written in it, never afterwards.
 *
 * A separate file rather than a `test` block inside `vite.config.ts`: Vitest
 * prefers this one and does not merge the other in, which keeps the React
 * plugin and the `_headers` rewriter out of a run that has no use for either.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
