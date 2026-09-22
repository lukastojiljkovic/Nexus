import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The package root in `build.mjs`'s own terms: the directory the script derives
 * from its own location, holding `build.mjs`, the `tokens/` it reads and the two
 * artifacts it writes. Every path below is relative to it, for the real tree and
 * for the scratch copies alike, which is what lets one helper drive both. That
 * property is not decoration — it is what the rejecting arm is built on.
 */
const PACKAGE = join(REPO_ROOT, "packages", "tokens");
const CSS = "dist/css/tokens.css";
const TS = "gen/index.ts";

/**
 * `packages/tokens/build.mjs --check` is the only thing in this repository that
 * asks whether the two artifacts that build writes are what `tokens/*.json` —
 * the sources that ARE committed — still produce, and nothing tested it.
 *
 * Neither artifact is committed: `.gitignore` lists `packages/tokens/gen/` and
 * `packages/tokens/dist/`, and eslint mirrors both. So they cannot go stale in a
 * commit, which is the defect `check:licences` exists for; what they can do is
 * sit stale in a WORKING TREE. Edit a token and run neither `pnpm build` nor
 * `pnpm typecheck`, and the electron-vite dev server, `pnpm --filter
 * @nexus/desktop shots` and a bare `vitest` run all read the artifact — the OLD
 * tokens — while `check:contrast` and `check:tokens` read the JSON, the new
 * ones. Two answers to one question, and the one the user meets is the wrong
 * one: `gen/index.ts` is what tsc compiles into the declarations the whole
 * monorepo typechecks against, and `dist/css/tokens.css` is what the desktop,
 * web and gallery apps import as `@nexus/tokens/css`.
 *
 * The two arms need different things from a test. The ACCEPTING arm is easy to
 * write and easy to write uselessly: `exit 0` is what a gate that read nothing
 * returns, and what a gate that died before it read anything returns as soon as
 * a loose assertion forgives the crash. So this arm asserts the SENTENCE, which
 * names both files compared and three counts derived from the sources that were
 * parsed — nothing that did not do the work can print it. The REJECTING arm is
 * the one that needed a mechanism, and the block below explains the one used.
 */

/**
 * THE SCRATCH TREE, and it is a far smaller one than `check-licences.test.mjs`
 * needs. `build.mjs` is zero-dependency by deliberate deviation (DEV-001) and
 * reads nothing but `tokens/*.json` beside it, so a copy is the script plus that
 * one directory — no node_modules, no workspace manifests, no junctions, and
 * about eleven kilobytes of source between them.
 *
 * WHAT MAKES THE COPY FAITHFUL is the first case in the scratch describe: a copy
 * that builds its own artifacts has to produce the bytes the real tree already
 * has. While that holds, the only difference between it and the two rejections
 * below is the mutation each of them applies — and that case is also a second,
 * independent proof that the real artifacts are current, by BYTES, where the
 * accepting arm's proof is the gate's own verdict.
 *
 * WHY NO ARM CAN REACH THE REAL ARTIFACTS. Three reasons, and the last describe
 * in this file asserts the outcome rather than trusting any of them.
 *   1. `--check` has no write path at all: both `mkdirSync`/`writeFileSync`
 *      pairs sit after the `--check` branch, and every branch of that branch
 *      ends in `process.exit`. The second scratch case below asserts that from
 *      the outside, by running the check in a tree with nothing in it and then
 *      looking for the files it would have written.
 *   2. The copy of the script resolves both artifact paths inside its own
 *      directory, so the only files it can read or write are the ones written
 *      here.
 *   3. The links run one way. The scratch trees live under `os.tmpdir()` and
 *      nothing in the repository refers to them.
 */

/** Every scratch tree this run made, removed together at the end. */
const made = [];

/**
 * A copy of the package's own tree — `build.mjs` beside the `tokens/` it reads
 * — with nothing built in it yet.
 */
function scratchPackage() {
  const dir = mkdtempSync(join(tmpdir(), "nexus-tokens-build-"));
  copyFileSync(join(PACKAGE, "build.mjs"), join(dir, "build.mjs"));
  cpSync(join(PACKAGE, "tokens"), join(dir, "tokens"), { recursive: true });
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Runs the copy of the build in `dir` with `args`, exactly as the CLI does. */
function build(dir, ...args) {
  return spawnSync(process.execPath, [join(dir, "build.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

/**
 * The gate's own definition of "current": line endings compared out. Both
 * artifacts are written with LF and nothing checks them out, so this can only
 * ever matter the day one of them is promoted to a committed file, where
 * `* text=auto` hands a Windows checkout CRLF — the case
 * `generate-licences.mjs` already paid for. Kept here so that this suite and
 * the gate agree on what they are asserting; see the `--check` block in
 * `build.mjs` for the full argument.
 */
const text = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

/**
 * The line of an artifact that `matches`, as `{ number, line }`. Fails loudly
 * when nothing matches: a helper returning `undefined` would turn a changed
 * shape into a silently skipped assertion, and the assertions below are the
 * whole point of the mutation.
 */
function lineMatching(lines, matches, artifact) {
  const index = lines.findIndex(matches);
  expect(index, `${artifact}: no line the mutation should have moved`).toBeGreaterThanOrEqual(0);
  return { number: index + 1, line: lines[index] };
}

const ARTIFACTS = new Map(
  [CSS, TS].map((artifact) => {
    const path = join(PACKAGE, artifact);
    return [artifact, existsSync(path) ? readFileSync(path) : null];
  }),
);

describe("the generated tokens, in this tree", () => {
  it("are what the sources produce, and the gate says so by file and by count", () => {
    // Under `pnpm test` this suite runs after `turbo run test`, which builds
    // every package's dependencies — `@nexus/tokens` among them. A tree that has
    // never been built is the one case this arm cannot speak for, and it says so
    // rather than passing over it.
    for (const artifact of [CSS, TS]) {
      expect(
        existsSync(join(PACKAGE, artifact)),
        `${artifact} has not been generated in this tree — ` +
          "run `pnpm --filter @nexus/tokens build` and try again",
      ).toBe(true);
    }

    const result = build(PACKAGE, "--check");

    expect(result.status, result.stderr).toBe(0);
    // The sentence, not the exit code alone: a gate that compared nothing and
    // returned would satisfy `toBe(0)` while proving nothing, and this is the
    // assertion that says the comparison happened.
    expect(result.stdout).toContain(`${CSS} and ${TS} are what tokens/*.json produces`);

    const counts = /\((\d+) primitives, (\d+) themes, (\d+) accents\)/.exec(result.stdout);
    expect(counts, `the acceptance sentence carried no counts: ${result.stdout}`).not.toBeNull();
    // FLOORS, not the counts themselves. What they separate is "the gate parsed
    // the sources" from "the gate parsed nothing" — pinning 65, 2 and 8 here
    // would make this file fail on the next token added, which is the gate's
    // business to notice and not this suite's to duplicate.
    expect(Number(counts[1])).toBeGreaterThan(20);
    expect(Number(counts[2])).toBeGreaterThanOrEqual(2);
    expect(Number(counts[3])).toBeGreaterThan(4);
  });
});

describe("a scratch copy of the package", () => {
  /**
   * THE CONTROL, and the reason the two rejections below mean anything. A copy
   * of the sources, built in another directory, must produce the bytes the real
   * tree already holds — which it can only do if the copy reproduces the real
   * package exactly. So this case fails the moment the scaffolding stops being
   * faithful, and while it passes, the only difference between it and the
   * rejections is the mutation each of them applies.
   */
  it("builds exactly the artifacts the real tree already has", () => {
    const dir = scratchPackage();

    const built = build(dir);
    expect(built.status, built.stderr).toBe(0);

    for (const artifact of [CSS, TS]) {
      expect(
        text(join(dir, artifact)),
        `${artifact} in this tree is not what its own build produces`,
      ).toBe(text(join(PACKAGE, artifact)));
    }

    const checked = build(dir, "--check");
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain(`${CSS} and ${TS} are what tokens/*.json produces`);
  });

  /**
   * The defect this gate was written for, reproduced: the artifact is a correct
   * build of the sources as they WERE, and a source has moved on without it.
   */
  it("is rejected when a source moves past the artifacts, and the gate names the line", () => {
    const dir = scratchPackage();
    expect(build(dir).status, "the control build failed").toBe(0);

    // One primitive, bumped. Read out of the tree and modified rather than
    // pinned: a value typed into this file would go stale the way the artifacts
    // themselves can, and would then be measuring the next edit to global.json
    // instead of the gate.
    const source = join(dir, "tokens", "global.json");
    const global = JSON.parse(readFileSync(source, "utf8"));
    const [name, value] = Object.entries(global.space)[0];
    const bumped = value.replace(/\d+/, (digits) => String(Number(digits) + 1));
    global.space[name] = bumped;
    writeFileSync(source, `${JSON.stringify(global, null, 2)}\n`, "utf8");

    // Where the change has to surface: the primitive in the CSS, and the same
    // primitive inside the token tree the TypeScript embeds.
    const cssLine = lineMatching(
      text(join(dir, CSS)).split("\n"),
      (line) => line.startsWith("  --nx-space-") && line.endsWith(`: ${value};`),
      CSS,
    );
    const tsLine = lineMatching(
      text(join(dir, TS)).split("\n"),
      (line) => line.trim() === `"${name}": "${value}",`,
      TS,
    );

    const result = build(dir, "--check");

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("does not match what tokens/*.json produces");
    // The arithmetic, not merely the verdict: the gate has to name the file, the
    // line, and both values, or its reader is left diffing two generated files
    // by eye.
    expect(result.stderr).toContain(
      `  line ${cssLine.number}: expected \`${cssLine.line.replace(value, bumped)}\`, ` +
        `found \`${cssLine.line}\``,
    );
    // BOTH artifacts, and this is the half a single-file comparison would miss:
    // the CSS emits the primitive and the TypeScript embeds the whole primitive
    // tree, so one edited value reaches both — and a gate that watched only one
    // of them would go on passing the other.
    expect(result.stderr).toContain(
      `  line ${tsLine.number}: expected \`${tsLine.line.replace(value, bumped)}\`, ` +
        `found \`${tsLine.line}\``,
    );
    // One line per artifact, because one value moved. More than that would mean
    // the gate is reporting something other than the difference it was asked
    // about.
    expect(result.stderr.match(/^ {2}line \d+:/gm) ?? []).toHaveLength(2);
    expect(result.stderr).toContain("pnpm --filter @nexus/tokens build");
  });

  /**
   * The other state of the tree, and the one an accepting arm cannot tell apart
   * from success on its own. A fresh clone is exactly this: the sources are
   * there, the artifacts have never been built.
   */
  it("say nothing was compared when nothing has been built, and write nothing", () => {
    const dir = scratchPackage();

    const result = build(dir, "--check");

    // Not a failure: nothing was built, so nothing can be behind — which is the
    // half that lets this gate be run before a build, where every static gate in
    // this repository sits in CI.
    expect(result.status, result.stderr).toBe(0);
    for (const artifact of [CSS, TS]) {
      expect(result.stdout).toContain(`${artifact} has not been generated in this tree`);
    }
    // The reason the accepting arm above cannot be vacuous: a run that compared
    // nothing never claims the artifacts are current, and this is the assertion
    // that keeps "compared two files and agreed" apart from "compared nothing".
    expect(result.stdout).not.toContain("what tokens/*.json produces");
    // The outcome rather than the reading of the code: `--check` is a question,
    // so the two files it asked about must be exactly as absent afterwards as
    // they were before it.
    for (const artifact of [CSS, TS]) {
      expect(existsSync(join(dir, artifact)), `--check wrote ${artifact}`).toBe(false);
    }
  });

  it("still compares the artifact that is there when the other one is missing", () => {
    const dir = scratchPackage();
    expect(build(dir).status, "the control build failed").toBe(0);
    rmSync(join(dir, TS));

    const result = build(dir, "--check");

    expect(result.status, result.stderr).toBe(0);
    // Singular, and that is the assertion: the claim names the one file that was
    // read. A gate that gave up at the first missing artifact would either print
    // nothing at all or claim both.
    expect(result.stdout).toContain(`${CSS} is what tokens/*.json produces`);
    expect(result.stdout).toContain(`${TS} has not been generated in this tree`);
  });
});

describe("what this suite cannot do", () => {
  it("is rewrite or generate an artifact of the real tree", () => {
    for (const [artifact, loaded] of ARTIFACTS) {
      const path = join(PACKAGE, artifact);
      if (loaded === null) {
        // Absent when this file loaded, and it must stay that way: the
        // assertion is that nothing here built it on the real tree's behalf.
        expect(existsSync(path), `the suite generated ${artifact}`).toBe(false);
      } else {
        expect(readFileSync(path).equals(loaded), `the suite rewrote ${artifact}`).toBe(true);
      }
    }
  });
});
