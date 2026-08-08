import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The guard over the failure that made this file necessary: a gate that exists,
 * is wired into `package.json`, carries its own unit tests — and runs on nobody
 * machine but the author's.
 *
 * `.github/workflows/ci.yml` invoked `pnpm check:colours` and nothing else for
 * months. `check:contrast`, `check:css`, `check:strings` and `check:tokens`
 * were all written, all green locally, all absent from every pull request.
 * That is DC-08 in its purest form: a rule applied on one path is present, not
 * applied. Nothing about a green CI run looked different, because a gate's
 * whole job is to be silent.
 *
 * So the enumeration is derived, never listed here. Adding `check:whatever` to
 * `package.json` fails this test until CI runs it — which is the only ordering
 * that cannot be forgotten, since the next gate will be written by someone who
 * has never read this comment.
 */
describe("the CI workflow", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  const gates = Object.keys(pkg.scripts).filter((name) => name.startsWith("check:"));

  it("has static gates to run at all", () => {
    // Guards the guard: if the filter ever matched nothing, every assertion
    // below would pass over an empty list and this file would prove nothing.
    expect(gates.length).toBeGreaterThanOrEqual(5);
  });

  it.each(gates)("runs %s", (gate) => {
    expect(workflow).toContain(`- run: pnpm ${gate}`);
  });

  it("still runs the four expensive checks the gates are cheap in front of", () => {
    for (const step of ["build", "typecheck", "lint", "test"]) {
      expect(workflow).toContain(`- run: pnpm ${step}`);
    }
  });
});
