import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./strip-comments.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A guard over one specific way this repository can report a green test run
 * while a whole package's suite collects nothing.
 *
 * Vitest auto-discovers `vitest.config.*` and `vite.config.*`. A package with
 * no config of its own resolves to the nearest one UP the tree — which, for a
 * monorepo, is the repository root. On 2026-08-06 a root `vitest.config.mjs`
 * was added to scope the `scripts/` suite and exclude the git worktrees;
 * `@nexus/core`, which has no config, inherited its
 * `include: ["scripts/**\/*.test.mjs"]` and stopped collecting a single file.
 * Its 2 556 tests did not fail. They did not run, and `turbo` replayed a cached
 * log from before the change, so `pnpm test` stayed green for a day.
 *
 * The fix is the FILENAME — `vitest.scripts.config.mjs`, reached only through
 * the explicit `--config` in the root `test` script. This test is what keeps it
 * that way, because the next person to add a root-level Vitest config will
 * reach for the obvious name.
 */
describe("the repository root", () => {
  it("carries no auto-discovered Vitest or Vite config", () => {
    const discoverable = readdirSync(root).filter((name) =>
      /^vite(st)?\.config\.(m?[jt]s|mts|cts)$/.test(name),
    );
    expect(discoverable).toEqual([]);
  });

  it("runs its own scripts suite through an explicitly named config", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.test).toContain("--config vitest.scripts.config.mjs");
  });

  it("keeps the worktree exclusion that made a root config necessary at all", async () => {
    const config = await import("../vitest.scripts.config.mjs");
    expect(config.default.test.exclude).toContain(".claude/**");
  });
});

/**
 * The same failure one layer out: a file the whole repository compiles against,
 * that no package's inputs can hash.
 *
 * Turborepo hashes a task's own package. A root-level config is outside every
 * package, so changing it invalidates nothing and every task replays a result
 * computed against the PREVIOUS version. That is the worst shape a cache can
 * fail in, because it is reported as green rather than as stale.
 *
 * `turbo.json` has named `eslint.config.mjs` for this reason since a rule
 * change once replayed instead of re-linting. `tsconfig.base.json` has exactly
 * the same shape and was not named, so on 2026-09-06 adding `"types": []` to
 * the shared compiler options re-ran ONE of thirteen `typecheck` tasks and
 * replayed twelve — thirteen green ticks, twelve of them about a compiler
 * configuration that no longer existed.
 *
 * Naming the second file fixes the instance. This test is what fixes the class,
 * and it DERIVES the list rather than restating it: every `extends` in every
 * package's tsconfig that resolves outside its own package is a root config,
 * and must appear in `globalDependencies`. A future shared `tsconfig.web.json`
 * at the root, or a package that starts extending one, is caught the day it
 * lands rather than the day someone wonders why a cache hit was wrong.
 *
 * What it cannot see: a root config reached by DISCOVERY rather than by
 * reference. `eslint.config.mjs` is found by ESLint walking up from the file it
 * is linting, and nothing in any package names it — which is why it stays
 * listed by hand, and why its own guard is the assertion below that the list
 * never shrinks.
 */
describe("turbo's global dependencies", () => {
  const globalDependencies = () => {
    const turbo = JSON.parse(stripComments(readFileSync(join(root, "turbo.json"), "utf8")));
    return turbo.globalDependencies ?? [];
  };

  /** Every `extends` target that leaves the package declaring it. */
  const rootConfigsReferencedByPackages = () => {
    const found = new Set();
    for (const group of ["apps", "packages"]) {
      const groupDir = join(root, group);
      for (const name of readdirSync(groupDir)) {
        const packageDir = join(groupDir, name);
        if (!statSync(packageDir).isDirectory()) continue;
        for (const file of readdirSync(packageDir)) {
          if (!/^tsconfig.*\.json$/.test(file)) continue;
          const config = JSON.parse(
            stripComments(readFileSync(join(packageDir, file), "utf8")),
          );
          const extended = config.extends;
          const targets = Array.isArray(extended) ? extended : extended ? [extended] : [];
          for (const target of targets) {
            // A bare specifier is a dependency, hashed through the lockfile.
            if (!target.startsWith(".")) continue;
            const resolved = resolve(packageDir, target);
            const inside = relative(packageDir, resolved);
            if (!inside.startsWith("..")) continue;
            found.add(relative(root, resolved).split("\\").join("/"));
          }
        }
      }
    }
    return [...found].sort();
  };

  it("names every root config a package extends", () => {
    const listed = globalDependencies();
    const missing = rootConfigsReferencedByPackages().filter((f) => !listed.includes(f));
    expect(missing).toEqual([]);
  });

  it("keeps the two that are known to need it", () => {
    // `eslint.config.mjs` is reached by discovery, so the derived check above
    // cannot see it; `tsconfig.base.json` is pinned here as well so that
    // deleting the `extends` from all fifteen packages at once — the one edit
    // that would make the derived check pass while the file still matters —
    // still fails.
    expect(globalDependencies()).toEqual(
      expect.arrayContaining(["eslint.config.mjs", "tsconfig.base.json"]),
    );
  });
});
