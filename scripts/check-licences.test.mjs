import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Both paths are relative to WHICHEVER TREE the gate is being run in, because
 * the gate derives them from its own location and never from the working
 * directory. That is the property the scratch tree below is built on.
 */
const GATE = "apps/desktop/scripts/generate-licences.mjs";
const NOTICES = "apps/desktop/src/renderer/src/data/licences.json";
const REPO_NOTICES = join(REPO_ROOT, NOTICES);

/**
 * The committed notices as this file loaded them — the state every test here is
 * measured against.
 */
const COMMITTED = readFileSync(REPO_NOTICES);

/**
 * `check:licences` is the only thing in this repository that asks whether the
 * committed third-party notices still DESCRIBE the tree, and nothing tested it.
 *
 * The notices are generated and then committed, which is the combination that
 * rots in silence, because no checkout regenerates them. The suite beside them
 * (`apps/desktop/src/renderer/src/licences.test.ts`) asks the other half of the
 * question — whether the file is fit to SHIP: every entry carries a notice,
 * nothing is UNKNOWN, every font family is present. All of that is read out of
 * the file itself, which is exactly why it cannot also ask whether the file
 * still describes the node_modules this checkout has. `--check` can, and its
 * history is the argument for testing it: on 2026-08-15 the file credited
 * dompurify 3.4.12, js-yaml 4.3.0, mermaid 11.16.0 and nanoid 3.3.16 while the
 * installer shipped 3.4.13, 4.3.1, 11.16.1 and 3.3.18 — three of them moved by
 * the security overrides in `pnpm-workspace.yaml`, so the Licence screen was
 * naming the older, vulnerable release of a dependency the product had already
 * fixed.
 *
 * The two arms need different things from a test. The ACCEPTING arm is easy to
 * write and easy to write uselessly: `exit 0` is what a gate that read nothing
 * returns, and what a gate that died before it read anything returns as soon as
 * a loose assertion forgives the crash. So this arm asserts the sentence, which
 * carries the path that was compared and the two counts derived from the tree —
 * nothing that did not do the work can print it. The REJECTING arm is the one
 * that needed a mechanism, and the block below explains the one this file uses.
 */

/**
 * THE SCRATCH TREE.
 *
 * `--check` compares the file at the path the gate derives from its own
 * location against what the tree it sits in produces, so a test can turn it
 * loose on a mutated copy by exactly one route: give it a different location.
 * Copy the gate into a directory laid out the way its arithmetic expects — its
 * `SCRIPTS_DIR`, `APP_ROOT`, `REPO_ROOT` and `OUTPUT` are each one hop from the
 * last — and all four resolve INSIDE that directory, while the dependency graph
 * it reads is reached back through junctions to the real one.
 *
 * WHAT IS COPIED is the files pnpm resolves a workspace from and the gate
 * reads by name: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
 * `apps/desktop/package.json` (what `--filter @nexus/desktop...` matches), the
 * `package.json` of every workspace package (the members its trailing `...`
 * follows, whose own dependencies ship in the installer too),
 * `apps/desktop/electron.vite.config.ts` (what scopes the font notices to the
 * families the build actually copies) and the gate itself — plus the notices
 * under test. WHAT IS NOT is `node_modules`, at any level: each one is a
 * junction, so `pnpm licenses list --filter @nexus/desktop...` answers out of
 * the real virtual store and the gate reads the real Electron manifest and the
 * real Excalidraw font files. Not one package notice is simulated, which is what
 * keeps a rejection from being a statement about the copy. The first case in
 * the describe below — the same notices, untouched — is what proves it: if the
 * scratch tree produced anything other than the real `rendered`, that copy
 * would be rejected too, and the suite would say so rather than pass.
 *
 * WHY THIS CANNOT REACH THE COMMITTED FILE. Three reasons, and the last test in
 * this file asserts the outcome rather than trusting any of them.
 *   1. `--check` has no write path at all. The `writeFileSync` at the foot of
 *      `generate-licences.mjs` is reached only when `--check` is absent, and
 *      every `--check` branch ends in `process.exit`.
 *   2. The copy of the gate resolves `OUTPUT` inside the copy's own tree, so
 *      the only notices it can read or write are the ones written here.
 *   3. The links run one way. The scratch tree holds links INTO the repository;
 *      nothing in the repository refers to the scratch tree, and the scratch
 *      root is made by `mkdtempSync` under the OS temp directory, never inside
 *      the checkout.
 *
 * The three cases below SHARE one scratch tree and each rewrites the copy
 * before running the gate, so their declared order is part of the fixture.
 * They are deliberately not `concurrent`, and the sentence is here because the
 * editor who makes them so will otherwise get three tests racing over one file
 * and a failure that points at the mutation rather than at the sharing.
 */
const PACKAGES = readdirSync(join(REPO_ROOT, "packages"))
  .map((name) => `packages/${name}`)
  .filter((dir) => existsSync(join(REPO_ROOT, dir, "package.json")));

const SKELETON = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "apps/desktop/package.json",
  ...PACKAGES.map((dir) => `${dir}/package.json`),
  "apps/desktop/electron.vite.config.ts",
  GATE,
];

/** Every `node_modules` of the real tree that the scratch tree links back to. */
const LINKED = [".", "apps/desktop", ...PACKAGES]
  .map((dir) => join(dir, "node_modules"))
  .filter((rel) => existsSync(join(REPO_ROOT, rel)));

/**
 * A package this tree has never contained, in the shape the generator writes
 * one. Only `name` and `version` are read out of an entry by the gate's diff,
 * so the notice here is a placeholder rather than a licence text this file has
 * no business inventing. Any name would do; `left-pad` is chosen because no
 * reader has ever wondered whether it might be a dependency of theirs.
 */
const PHANTOM = {
  id: "npm:left-pad@1.3.0",
  name: "left-pad",
  version: "1.3.0",
  licence: "MIT",
  notice: "(a notice for a package the tree no longer ships)",
  status: "file",
  source: "LICENSE",
};

let scratch;
let scratchNotices;

/**
 * Runs the gate with the argv `package.json` gives `check:licences`, from
 * whichever tree is under test. `env` overrides the environment the gate
 * inherits, which is the whole mechanism of the arm below that hands it
 * somebody else's package manager.
 */
function check(script, cwd, env) {
  return spawnSync(process.execPath, [script, "--check"], {
    cwd,
    encoding: "utf8",
    ...(env === undefined ? {} : { env }),
  });
}

/** Replaces the scratch tree's notices with `payload`, serialised as the generator writes them. */
function writeScratch(payload) {
  writeFileSync(scratchNotices, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * The first package whose NAME appears exactly once in the payload — not a
 * flourish. A name that stands for more than one installed package („commander"
 * is three of them here) is collapsed by the gate's diff into a single line,
 * and for those the line printed is the LAST entry's version rather than the
 * version this test would have computed for the entry it changed. Choosing a
 * name that occurs once is what makes the assertion below an exact statement
 * instead of a lucky one.
 */
function uniqueName(packages) {
  const counts = new Map();
  for (const entry of packages) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  return packages.find((entry) => counts.get(entry.name) === 1);
}

/**
 * An earlier release of the same package, derived rather than invented: the
 * last version component that can be decremented, decremented. It reproduces
 * the shape of the defect this gate was written for — the gate's own output on
 * 2026-08-15 read „dompurify: 3.4.12 -> 3.4.13" — and it hard-codes no version,
 * because a version pinned in this file would go stale the way the notices went
 * stale in theirs, and would then be measuring a dependency bump instead of the
 * gate.
 */
function earlierRelease(version) {
  const parts = version.split(".");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const component = Number(parts[index]);
    if (Number.isInteger(component) && component > 0) {
      parts[index] = String(component - 1);
      return parts.join(".");
    }
  }
  throw new Error(`nothing in ${version} can be decremented`);
}

describe("the committed notices", () => {
  it("are what this tree produces, and the gate says so by path and by count", () => {
    const result = check(GATE, REPO_ROOT);

    expect(result.status, result.stderr).toBe(0);
    // The sentence, not the exit code alone: a gate that compared nothing and
    // returned would satisfy `toBe(0)` while proving nothing, and this is the
    // assertion that says the comparison happened.
    expect(result.stdout).toContain(`check-licences: ${NOTICES} is what this tree produces`);

    const counts = /\((\d+) packages, (\d+) font families\)/.exec(result.stdout);
    expect(counts, `the acceptance sentence carried no counts: ${result.stdout}`).not.toBeNull();
    // FLOORS, not the counts themselves. What they separate is „the gate walked
    // the dependency graph" from „the gate walked nothing" — pinning 286 and 7
    // here would make this file fail on the next dependency bump, which is the
    // gate's business to notice and not this suite's to duplicate.
    expect(Number(counts[1])).toBeGreaterThan(100);
    expect(Number(counts[2])).toBeGreaterThan(3);
  });

  /**
   * `npm_execpath` names the package manager that LAUNCHED the process, and it
   * is not a synonym for pnpm: run this suite under `npx vitest` and it is npm's
   * own `cli.js`. The gate used to take it at face value, so it ran `npm
   * licenses list --prod --json --filter @nexus/desktop` — npm has no
   * `--filter`, so it exited 1 and the message accused pnpm of a failure npm
   * caused. Measured before the repair: this suite was red under `npx vitest`
   * and green under `pnpm test`, from that one branch.
   *
   * The value injected here is `node.exe`, which is not npm and does not need to
   * be: the contract is „a non-pnpm launcher is ignored“, and `node.exe` is the
   * one path that exists on every machine this suite can run on. What makes the
   * arm falsifiable is the comparison — the same gate, on the same tree, has to
   * behave IDENTICALLY whichever value it is handed, and under the old code it
   * did not: the injected run executed `node.exe` as a script and died.
   *
   * The npm signature is asserted by name rather than by exit code, because a
   * missing `pnpm` on `PATH` also exits non-zero and would otherwise let this
   * arm pass while proving the opposite of what it claims.
   */
  it("ignores a launcher that is not pnpm, rather than running it", () => {
    const inherited = check(GATE, REPO_ROOT);
    const injected = check(GATE, REPO_ROOT, { ...process.env, npm_execpath: process.execPath });

    expect(injected.stderr).not.toContain("Expanding --prod");
    expect(injected.status, injected.stderr).toBe(inherited.status);
    expect(injected.stdout).toBe(inherited.stdout);
  });
});

describe("the same notices, in a scratch tree", () => {
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "nexus-licences-check-"));
    for (const file of SKELETON) {
      mkdirSync(dirname(join(scratch, file)), { recursive: true });
      copyFileSync(join(REPO_ROOT, file), join(scratch, file));
    }
    scratchNotices = join(scratch, NOTICES);
    mkdirSync(dirname(scratchNotices), { recursive: true });
    copyFileSync(REPO_NOTICES, scratchNotices);
    for (const rel of LINKED) symlinkSync(join(REPO_ROOT, rel), join(scratch, rel), "junction");
  });

  afterAll(() => {
    if (scratch === undefined) return;
    // The junctions come out FIRST, so that nothing here rests on how `rmSync`
    // treats a reparse point. It does not follow them — measured on this
    // repository, not assumed — but a safety argument that leans on somebody
    // else's implementation detail holds until the day it does not.
    for (const rel of LINKED) {
      const link = join(scratch, rel);
      if (existsSync(link)) unlinkSync(link);
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * THE CONTROL, and the reason the two rejections below mean anything. A copy
   * of a file, moved to another directory and serialised again, must be
   * accepted — which it can only be if the scratch tree's `rendered` is the
   * real one to the byte. So this case fails the moment the scaffolding stops
   * being faithful, and while it passes, the only difference between it and the
   * rejection cases is the mutation each of them applies.
   */
  it("are accepted untouched, which is what makes this tree faithful", () => {
    writeScratch(JSON.parse(COMMITTED.toString("utf8")));

    const result = check(GATE, scratch);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`check-licences: ${NOTICES} is what this tree produces`);
    expect(result.stdout).toMatch(/\(\d+ packages, \d+ font families\)/);
  });

  it("are rejected when they credit a version the tree has moved past", () => {
    const payload = JSON.parse(COMMITTED.toString("utf8"));
    const entry = uniqueName(payload.packages);
    const shipped = entry.version;
    const stale = earlierRelease(shipped);
    entry.version = stale;
    entry.id = `npm:${entry.name}@${stale}`;
    writeScratch(payload);

    const result = check(GATE, scratch);

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`${NOTICES} does not describe this tree`);
    // The arithmetic, not merely the verdict: the gate has to name WHICH entry
    // is wrong and WHICH WAY, or the message sends its reader to diff a
    // hundred-and-thirty-thousand-line file by hand.
    expect(result.stderr).toContain(`  ${entry.name}: ${stale} -> ${shipped}`);
  });

  /**
   * The other direction, and it is a separate case rather than a second helping
   * of the first. The two rejections are two different loops over two different
   * maps — one asking „is this version still what the tree resolves", the other
   * „is this name still in the tree at all" — so a comparison that had gone
   * deaf in one direction would pass a suite that only tested the other.
   */
  it("are rejected when they credit a package the tree does not ship", () => {
    const payload = JSON.parse(COMMITTED.toString("utf8"));
    payload.packages.push(PHANTOM);
    writeScratch(payload);

    const result = check(GATE, scratch);

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`${NOTICES} does not describe this tree`);
    expect(result.stderr).toContain(`  ${PHANTOM.name}: removed`);
  });
});

describe("what this suite cannot do", () => {
  it("is rewrite the committed notices", () => {
    const after = readFileSync(REPO_NOTICES);
    expect(after.equals(COMMITTED), "check:licences rewrote the committed notices").toBe(true);
  });
});
