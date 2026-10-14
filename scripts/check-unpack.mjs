// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-unpack.mjs`) and an import target for
// its own tests.
//
// WHY THIS GATE EXISTS.
//
// The assistant's worker imports `node-llama-cpp` by its path inside
// `app.asar.unpacked` — an ESM package cannot be loaded from the asar at all
// (`llama.ts` says why). From there, every `import` the package makes resolves
// against the unpacked tree, never against the asar, so every package it reaches
// at runtime has to be unpacked as well. 2.0.0 to 2.0.2 shipped with only
// `node-llama-cpp` and its binaries in `asarUnpack`: the first import of
// `lifecycle-utils` failed, and no packaged build could ever load a model. Every
// dev run and every test passed, because outside the asar there is nothing to
// get wrong.
//
// So the closure is computed here from the installed tree, the way Node
// resolves it, and each package in it must be covered by an `asarUnpack` entry
// for itself or for its scope. A dependency bump that adds a package fails this
// gate with the line to add, instead of failing on somebody's machine.
//
// Only the top-level name is needed. electron-builder nests a second version of
// a package under the package that needs it, and that parent is in the closure
// too, so its own entry carries the nested copy.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..", "apps", "desktop");

/** Packages the app loads by their path inside `app.asar.unpacked` rather than through the asar. */
export const UNPACKED_ROOTS = ["node-llama-cpp"];

/** The package names and scopes `asarUnpack` covers whole, read from electron-builder.yml. */
export function unpackedNames(yml) {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^asarUnpack:\s*$/.test(line));
  if (start < 0) throw new Error("electron-builder.yml has no asarUnpack list");
  const names = new Set();
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const entry = /^\s+-\s+"?node_modules\/((?:@[^/]+\/)?[^/*"]+)\/\*\*\/\*"?\s*$/.exec(line);
    if (entry) names.add(entry[1]);
  }
  return names;
}

/** Every package `roots` reach through `dependencies` and `optionalDependencies`, resolved from `from`. */
export function closure(roots, from) {
  const seen = new Set();
  const names = new Set();
  const visit = (name, dir) => {
    const found = resolvePackage(name, dir);
    // An optional dependency for another platform is not installed, and not shipped either.
    if (found === null) return;
    const real = realpathSync(found);
    if (seen.has(real)) return;
    seen.add(real);
    names.add(name);
    const manifest = JSON.parse(readFileSync(join(real, "package.json"), "utf8"));
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) visit(dep, real);
  };
  for (const root of roots) visit(root, from);
  return names;
}

function resolvePackage(name, dir) {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, "node_modules", name);
    if (basename(at) !== "node_modules" && existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(at) === at) return null;
  }
}

/** The names in `needed` that no `asarUnpack` entry covers, sorted. */
export function findMissing(yml, needed) {
  const unpacked = unpackedNames(yml);
  const covered = (name) => unpacked.has(name) || (name.startsWith("@") && unpacked.has(name.split("/")[0]));
  return [...needed].filter((name) => !covered(name)).sort();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const needed = closure(UNPACKED_ROOTS, DESKTOP);
  const missing = findMissing(readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8"), needed);
  if (missing.length > 0) {
    console.error(`Unpack audit FAILED — ${missing.length} package(s) the unpacked tree imports stay inside the asar:\n`);
    for (const name of missing) console.error(`  - node_modules/${name}/**/*`);
    console.error(
      `\nAdd these lines to asarUnpack in apps/desktop/electron-builder.yml. ${UNPACKED_ROOTS.join(", ")}\n` +
        "is loaded from app.asar.unpacked, so everything it imports must be there too.",
    );
    process.exit(1);
  }
  console.log(`Unpack audit OK — ${needed.size} packages`);
}
