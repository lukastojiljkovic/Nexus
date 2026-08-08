import { readFileSync, readdirSync } from "node:fs";
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

/**
 * Supply-chain pinning, asserted over EVERY workflow rather than the one above.
 *
 * A tag is a mutable pointer, and in March 2025 that stopped being theoretical:
 * an attacker repointed every tag of `tj-actions/changed-files` — years-old
 * ones included — at a single commit that printed CI secrets into the build log
 * (CVE-2025-30066). Everyone who had written `@v35` was running it within
 * minutes, with no change on their side to review.
 *
 * The test is here and not in a `check:actions-pinning` script because the rule
 * is three lines of regex over two files; a gate with its own npm script, its
 * own CLI and its own test file would be more ceremony than rule. It reads
 * every workflow by directory listing, so a third file added later is covered
 * on the day it appears rather than on the day somebody remembers this one.
 */
describe("every workflow pins its actions", () => {
  const dir = join(root, ".github", "workflows");
  const files = readdirSync(dir).filter((name) => name.endsWith(".yml"));

  it("has workflows to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files)("%s uses only 40-hex SHAs", (name) => {
    const uses = readFileSync(join(dir, name), "utf8")
      .split(/\r?\n/)
      .map((line) => /^\s*-?\s*uses:\s*(\S+)/.exec(line)?.[1])
      .filter((ref) => ref !== undefined);

    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) {
      // `owner/repo@<40 hex>`. A tag, a branch or a short SHA all fail.
      expect(ref, `${name}: ${ref} is not pinned to a full commit SHA`).toMatch(
        /^[^@]+@[0-9a-f]{40}$/,
      );
    }
  });

  it.each(files)("%s labels each pin with the tag it came from", (name) => {
    // A bare SHA bump is unreviewable; `# v7` → `# v8` is not. This is the
    // difference between a pin that stays current and one nobody dares touch.
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      if (!/^\s*-?\s*uses:/.test(line)) continue;
      expect(line, `${name}: ${line.trim()} has no version comment`).toMatch(/#\s*v?\d/);
    }
  });
});
