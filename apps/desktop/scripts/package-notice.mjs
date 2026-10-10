// Reading ONE npm package's notice off disk, and the handful of questions the
// two callers ask about it.
//
// Extracted from `generate-licences.mjs` when the packaging step needed the
// SAME reading for a different set of packages (`platform-notices.mjs`). The
// generator and the packager must never disagree about what a notice IS: a
// second copy of „which files are the licence" is a second answer to a legal
// question, and the one that drifts is the one nobody re-reads.
//
// Nothing here decides anything about a TARGET, an installer or a platform.
// That is the callers' business: the generator asks for every package an app
// could ship on either machine, and the packager asks for the platform builds
// this tree holds.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The repository root, derived from this file's own location — never from the working directory. */
export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** LF, no BOM, no trailing blank — the shape every notice is stored in. */
export function normalise(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
}

/**
 * A provenance string is always relative to the PACKAGE it names, never to the
 * repository: pnpm's store directory carries a peer-dependency hash that moves
 * between installs, and an entry's own name and version already say which
 * package the path is inside.
 */
export function within(packageDir, absolutePath) {
  return relative(packageDir, absolutePath).split(sep).join("/");
}

// --- the npm packages --------------------------------------------------------

/**
 * pnpm's own entry point, when the process that launched this one is pnpm.
 *
 * `npm_execpath` names the package manager that STARTED this process, and it is
 * not a synonym for pnpm. Under `pnpm test` it is pnpm's `.cjs` entry, which
 * `process.execPath` executes directly — no `.cmd` and no `shell: true`, which
 * is what keeps the call identical on Windows and CI. Under `npx vitest` it is
 * npm's `cli.js`, and the call below then runs `npm licenses list --prod --json
 * --filter @nexus/desktop`: npm has no `--filter`, so it exits 1, and the
 * message that comes out accuses pnpm of a failure npm caused. Measured, not
 * reasoned — the whole scripts suite is red under `npx vitest` and green under
 * `pnpm test`, from this one branch.
 *
 * `dnpm` and `pnpmx` would pass the test below, and that is deliberate: the
 * question is which package manager is running, and a name check that demanded
 * an exact string would be a list to keep. What it must not do is accept npm.
 */
export function pnpmEntry() {
  const execpath = process.env.npm_execpath;
  return execpath !== undefined && /pnpm/i.test(execpath) ? execpath : null;
}

/**
 * `pnpm licenses list --prod --json`, run through Node rather than a shell
 * whenever the launcher is pnpm (see `pnpmEntry` above), and through the `pnpm`
 * binary otherwise.
 */
export function pnpmLicences() {
  const viaNode = pnpmEntry();
  const options = { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };
  const args = ["licenses", "list", "--prod", "--json", "--filter", "@nexus/desktop..."];
  const result = viaNode
    ? spawnSync(process.execPath, [viaNode, ...args], options)
    : spawnSync("pnpm", args, { ...options, shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`pnpm licenses failed (${result.status}):\n${result.stderr ?? ""}`);
  }
  return JSON.parse(normalise(result.stdout));
}

/**
 * A package's own licence files, in name order. Concatenated rather than
 * picked from, because a dual-licensed package ships LICENSE-MIT *and*
 * LICENSE-APACHE and reproducing one of them would be reproducing half a notice.
 */
export const LICENCE_FILE =
  /^(licen[cs]es?|copying|unlicen[cs]e|notice)([-_.][a-z0-9]+)?(\.(md|txt|markdown|rst))?$/i;

export function licenceFiles(packageDir) {
  return readdirSync(packageDir)
    .filter((entry) => LICENCE_FILE.test(entry))
    .filter((entry) => statSync(join(packageDir, entry)).isFile())
    .sort();
}

/** Whether an `os` / `cpu` list (with npm's `!name` exclusions) admits `value`; an absent list admits all. */
export function admits(list, value) {
  if (list === undefined) return true;
  const values = Array.isArray(list) ? list : [list];
  if (values.includes(`!${value}`)) return false;
  return values.includes(value) || values.every((entry) => entry.startsWith("!"));
}

/**
 * Whether the package installs on only SOME of the machines that run this file:
 * the Linux CI that checks it and the Windows desktop that builds the installer,
 * both x64. Such a package is in one tree and not the other, so listing it in
 * the committed file would make the generator disagree with itself across
 * machines.
 */
export function isPlatformBuild(packageDir) {
  const { os, cpu } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return !(admits(os, "linux") && admits(os, "win32") && admits(cpu, "x64"));
}

/** One entry per package: what it is, what it declares, and the text we can prove. */
export function packageEntry(packageDir, declaredLicence) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const files = licenceFiles(packageDir);
  const notice = files
    .map((file) => normalise(readFileSync(join(packageDir, file), "utf8")))
    .filter((text) => text.length > 0)
    .join("\n\n");
  return {
    id: `npm:${manifest.name}@${manifest.version}`,
    name: manifest.name,
    version: manifest.version,
    licence: declaredLicence === "Unknown" ? "UNKNOWN" : declaredLicence,
    notice,
    // `declared-only` is an ADMITTED GAP, never a guess: the package states an
    // id in its own manifest but ships no copy of the licence, so the id is
    // reproduced and the text is not invented.
    status: notice.length > 0 ? "file" : declaredLicence === "Unknown" ? "unknown" : "declared-only",
    source:
      notice.length > 0
        ? files.join(", ")
        : `package.json ("license": ${JSON.stringify(declaredLicence)}) — the package ships no licence file`,
  };
}

/** `packages` sorted by id — the order both callers emit in, so a regeneration cannot reorder the data. */
export function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every production package of `@nexus/desktop` that could reach a user, one
 * entry per package, from pnpm's own list of this tree.
 *
 * `platformBuilds` is the one behaviour the two callers differ on, and it is a
 * parameter rather than a second loop because the difference is a statement
 * about the TARGET: the generator writes ONE committed file that has to read the
 * same on Linux CI and on Windows (`"skip"`), and the packager names the
 * platform builds this tree holds (`"only"`) — see `platform-notices.mjs`.
 *
 * Type-only packages (`@types/*`) are erased by the compiler and reach no
 * artifact — the one exclusion where absence IS provable. Our own packages are
 * ours. Both rules are `generate-licences.mjs`'s; they live here so the two
 * callers cannot hold two versions of them.
 */
export function productionEntries(licences, { platformBuilds }) {
  const wanted = (packageDir) =>
    platformBuilds === "skip" ? !isPlatformBuild(packageDir) : isPlatformBuild(packageDir);
  const byIdentity = new Map();
  for (const [declaredLicence, packages] of Object.entries(licences)) {
    for (const pkg of packages) {
      if (pkg.name.startsWith("@types/") || pkg.name.startsWith("@nexus/")) continue;
      for (const packageDir of pkg.paths) {
        if (!wanted(packageDir)) continue;
        const entry = packageEntry(packageDir, declaredLicence);
        // pnpm lists one path per peer-dependency variant, so the same
        // name@version arrives more than once; the directories are copies.
        if (!byIdentity.has(entry.id)) byIdentity.set(entry.id, entry);
      }
    }
  }
  return [...byIdentity.values()];
}

/** The packages the committed file leaves out on purpose — see `productionEntries`. */
export function platformEntries(licences) {
  return productionEntries(licences, { platformBuilds: "only" }).sort(byId);
}
