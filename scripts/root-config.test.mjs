import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
