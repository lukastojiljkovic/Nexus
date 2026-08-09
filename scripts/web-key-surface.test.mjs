import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE MASTER KEY MUST NEVER ENTER A BROWSER, checked from outside the code that
 * promises it.
 *
 * `packages/sync-crypto/src/kdf.ts` derives two values from the web password:
 * K_auth, which the server is allowed to learn, and K_wrap, which opens the
 * server-held master-key wrap. A signed-in browser can FETCH that wrap — it is a
 * row of its own account — so a browser that can compute K_wrap is one
 * `unwrapKey` call from MK, and MK opens every profile. The rule that follows is
 * stated in that file: **the web bundle must not reference
 * `deriveWebPasswordKeys`, `rewrapMasterKeyForEmailChange` or `unwrapKey`.**
 *
 * `deriveSyncRecoveryKey` is the fourth name and arrives by a different road.
 * `mk_under_src` is deliberately readable WITHOUT a desktop device row — a
 * machine recovering an account has none, and getting one is what it is doing —
 * so the server-side backstop below does not cover that row. The printed code is
 * the only thing between it and MK, which makes „a browser that can derive the
 * opener" the same outcome as „a browser that holds K_wrap", reached by a path
 * the database cannot refuse.
 *
 * WHY THIS IS NOT A GREP OF `apps/web/dist`. That was the obvious shape and it
 * is unsound in both directions: a minified bundle has renamed every local
 * binding, so the names are absent whether or not the code is there; and a
 * bundler that inlined a helper leaves the code with no name at all. A name
 * scan over a build output reports what the minifier felt like doing. The
 * import graph is the thing that is actually true, and it is true before the
 * build runs.
 *
 * Four layers hold the rule, and this file is the fourth because the first
 * three each have a way out:
 *
 *  1. `@nexus/sync-crypto/web` — a barrel that does not export the two KDF
 *     functions. Defeated by importing the package root instead.
 *  2. No module that barrel re-exports reaches `wrap.ts`, so `unwrapKey` is
 *     unreachable rather than merely unexported. Defeated by one new import.
 *  3. `no-restricted-imports` over `apps/web` in `eslint.config.mjs`. Real, and
 *     defeated by one `// eslint-disable-next-line`.
 *  4. This, which reads the source text and the workspace graph and does not
 *     care what ESLint was told.
 *
 * The server carries the same rule independently, because none of the four
 * survives an attacker who is not using our bundle at all: the restrictive
 * policy `key_wraps_desktop_only` refuses to serve an `mk_under_kwrap` to any
 * session a live `devices` row does not call a desktop.
 */

const PACKAGE = "@nexus/sync-crypto";
const WEB_SUBPATH = `${PACKAGE}/web`;
const WEB_BARREL = "packages/sync-crypto/src/web.ts";
const FORBIDDEN_MODULE = "packages/sync-crypto/src/wrap.ts";

/**
 * The four names, spelled once. They appear in this file, which is why the
 * scan below excludes it — a gate that names what it forbids matches its own
 * rule, and `scripts/crypto-import-sites.test.mjs` met the same thing.
 *
 * WHEN `@nexus/web` EVENTUALLY DEPENDS ON `@nexus/sync-crypto` — it must, for
 * row encryption — the closure scan starts walking that package's own sources
 * and finds all four names in the modules that DEFINE them. That failure is
 * correct in direction if wrong in target: it is fail-closed and loud, and the
 * answer is to exclude `packages/sync-crypto` from the NAME scan only, because
 * the module-graph assertion above already proves the web barrel cannot reach
 * `wrap.ts` — a strictly stronger statement about that one package. Do not
 * answer it by deleting the scan; it is the layer that catches a re-export
 * added in some package in the middle.
 */
const DESKTOP_ONLY = [
  "deriveWebPasswordKeys",
  "deriveSyncRecoveryKey",
  "rewrapMasterKeyForEmailChange",
  "unwrapKey",
];

const SELF = "scripts/web-key-surface.test.mjs";

const IGNORED_DIRS = new Set(["node_modules", "dist", "out", "release", "gen", ".turbo", "coverage"]);
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) yield* walk(full);
    else if (SCANNED_EXTENSIONS.has(extname(full))) yield full;
  }
}

const posix = (file) => relative(root, file).split(sep).join("/");

/** Every workspace package, by name → directory. */
function workspace() {
  const byName = new Map();
  for (const area of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, area))) {
      const dir = join(root, area, entry);
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        byName.set(pkg.name, { dir, pkg });
      } catch {
        // Not a workspace package.
      }
    }
  }
  return byName;
}

/**
 * Every workspace package `@nexus/web` pulls in, transitively.
 *
 * The closure and not just the app itself, because „the web app does not import
 * it" is not the claim — the claim is about the BUNDLE, and the bundle contains
 * whatever `@nexus/ui` or `@nexus/core` imported on its behalf. A rule checked
 * one directory deep is a rule that moves to the next directory.
 *
 * Only workspace packages are walked: an external dependency cannot import a
 * private workspace package, so the closure is complete without reading
 * `node_modules`.
 */
function webClosure() {
  const all = workspace();
  const seen = new Set();
  const queue = ["@nexus/web"];
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const entry = all.get(name);
    if (entry === undefined) continue;
    seen.add(name);
    const deps = { ...entry.pkg.dependencies, ...entry.pkg.peerDependencies };
    for (const dep of Object.keys(deps)) {
      if (all.has(dep)) queue.push(dep);
    }
  }
  return [...seen].sort().map((name) => ({ name, dir: all.get(name).dir }));
}

/** A static import, a `require` and a dynamic import of one specifier, in one pass. */
function specifierUse(specifier) {
  const escaped = specifier.replace(/[/@-]/g, "\\$&");
  return new RegExp(`(?:from|require\\s*\\(|import\\s*\\()\\s*["'\`]${escaped}["'\`]`);
}

/**
 * The relative-import graph of one file, resolved inside `packages/sync-crypto`.
 *
 * The package has ZERO runtime dependencies, so every import in it is either
 * relative or absent — there is no `node_modules` resolution to do, and the
 * absence of one is itself asserted below.
 */
function moduleGraph(entry) {
  const seen = new Set();
  const external = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(root, file), "utf8");
    for (const specifier of importsOf(source)) {
      if (!specifier.startsWith(".")) {
        external.add(specifier);
        continue;
      }
      // Sources import each other with the `.js` extension TypeScript's
      // NodeNext resolution requires; on disk they are `.ts`.
      const target = join(dirname(file), specifier.replace(/\.js$/, ".ts"));
      queue.push(target.split(sep).join("/"));
    }
  }
  return { files: [...seen].sort(), external: [...external].sort() };
}

/**
 * Specifiers of every `import`/`export … from` in a source file.
 *
 * ANCHORED AT THE START OF A STATEMENT, which the first version was not: a bare
 * `/from ["']…["']/` also matches inside prose, and this package's comments are
 * long and discuss other modules by name. It reported `"non-empty"` as a
 * third-party dependency of the web barrel, out of an English sentence. Bounding
 * the match with `[^;]` keeps a multi-line `import { … }` in scope while
 * refusing to run past the end of a statement.
 */
function importsOf(source) {
  const found = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/gm)) {
    found.push(match[1]);
  }
  // Side-effect imports carry no `from` and would otherwise be invisible.
  for (const match of source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    found.push(match[1]);
  }
  return found;
}

describe("the browser's cryptographic surface", () => {
  it("has a barrel that omits every desktop-only capability", () => {
    const barrel = readFileSync(join(root, WEB_BARREL), "utf8");
    // Export lists only: the header explains each omission by name, and a rule
    // that read prose would report the explanation as the violation.
    const exported = barrel
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*"))
      .join("\n");
    for (const name of DESKTOP_ONLY) {
      expect(exported).not.toContain(name);
    }
  });

  it("cannot reach the key-wrapping module at all, from any module it re-exports", () => {
    // The strongest of the four layers: `unwrapKey` is not merely unexported,
    // it is not in the graph. `rewrap.ts` exists so this stays true — it was
    // the one edge, inside `kdf.ts`, that pulled `wrap.ts` in behind the
    // function a browser legitimately calls.
    const { files } = moduleGraph(WEB_BARREL);
    expect(files).not.toContain(FORBIDDEN_MODULE);
    // A negative control for the walker itself: the desktop barrel, which
    // differs from the web one mostly by this, must reach it.
    expect(moduleGraph("packages/sync-crypto/src/index.ts").files).toContain(FORBIDDEN_MODULE);
  });

  it("pulls in no third-party module, so the graph above is the whole graph", () => {
    // If `@nexus/sync-crypto` ever grows a runtime dependency, the walker stops
    // seeing the whole picture and its silence stops meaning anything.
    expect(moduleGraph(WEB_BARREL).external).toEqual([]);
  });

  it("has a workspace closure this file can actually see", () => {
    // THE VACUITY GUARD, and the only way the two scans below can lie. Both are
    // „no offender was found", which is exactly what an empty closure, a
    // renamed package or a `walk` that yielded nothing also produces — silently,
    // green, forever. So the inputs are asserted before the absences are.
    const closure = webClosure().map((entry) => entry.name);
    expect(closure).toContain("@nexus/web");
    expect(closure).toContain("@nexus/ui");
    const scanned = webClosure().flatMap(({ dir }) => [...walk(dir)]);
    expect(scanned.length).toBeGreaterThan(50);
  });

  it("is the only entry point the web app's workspace closure imports", () => {
    const offenders = [];
    for (const { name, dir } of webClosure()) {
      for (const file of walk(dir)) {
        const rel = posix(file);
        const source = readFileSync(file, "utf8");
        for (const specifier of [PACKAGE, `${PACKAGE}/testing`]) {
          if (specifierUse(specifier).test(source)) offenders.push(`${name}: ${rel} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names no desktop-only function anywhere in that closure", () => {
    // The import check above is about specifiers; this is about the names, and
    // it catches the shape the specifier check cannot: a re-export added to some
    // package in the middle that hands the capability on under its own name.
    const offenders = [];
    for (const { dir } of webClosure()) {
      for (const file of walk(dir)) {
        const rel = posix(file);
        if (rel === SELF) continue;
        const source = readFileSync(file, "utf8");
        for (const forbidden of DESKTOP_ONLY) {
          if (new RegExp(`\\b${forbidden}\\b`).test(source)) offenders.push(`${rel}: ${forbidden}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still has an ESLint restriction naming every entry point but the web one", () => {
    // Flat config replaces rule options rather than merging them, so a block
    // that sets `no-restricted-imports` for `apps/web` overrides the repo-wide
    // AEAD rule for every file under it. Asserting the group is what stops the
    // web app being silently exempted from the one-import-site rule.
    //
    // The entry points are DERIVED FROM THE `exports` MAP rather than listed
    // here, which is the point of this assertion: a package's importable
    // subpaths are closed by that map, so a new one — `@nexus/sync-crypto/node`,
    // say — is a new way into the desktop-only surface, and it goes red here on
    // the commit that adds it rather than on the commit that imports it.
    const config = readFileSync(join(root, "eslint.config.mjs"), "utf8");
    const block = config.slice(config.indexOf('files: ["apps/web/**'));
    const scoped = block.slice(0, block.indexOf("},\n\n  //"));
    expect(scoped).toContain('group: ["@noble/**"]');

    const pkg = JSON.parse(readFileSync(join(root, "packages/sync-crypto/package.json"), "utf8"));
    for (const subpath of Object.keys(pkg.exports)) {
      if (subpath === "./web") continue;
      const specifier = subpath === "." ? PACKAGE : `${PACKAGE}${subpath.slice(1)}`;
      expect(scoped).toContain(`name: "${specifier}"`);
    }
  });

  it("declares the subpath the rules above point at", () => {
    const pkg = JSON.parse(readFileSync(join(root, "packages/sync-crypto/package.json"), "utf8"));
    expect(pkg.exports["./web"]).toBe(`./${relative("packages/sync-crypto", WEB_BARREL).split(sep).join("/")}`);
    expect(WEB_SUBPATH).toBe(`${pkg.name}/web`);
  });
});
