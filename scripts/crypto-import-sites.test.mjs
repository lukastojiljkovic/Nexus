import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ONE IMPORT SITE FOR THE AEAD LIBRARY, asserted from outside ESLint.
 *
 * `@nexus/sync-crypto` takes every primitive through `CryptoPort` and its header
 * states the payoff plainly: „What crypto does sync use?" is answered by reading
 * that interface and its adapters, never by walking a lockfile. XChaCha20-
 * Poly1305 is the one primitive WebCrypto cannot supply, so `@noble/ciphers` is
 * a real dependency of `@nexus/sync-port` — and the sentence stays true only
 * while exactly one file imports it.
 *
 * Three layers hold that, and this file is the third because the first two each
 * have a way out:
 *
 *  1. pnpm's strict layout. Only `@nexus/sync-port` declares the dependency, so
 *     no other package can resolve it — until somebody adds it to a second
 *     `package.json`, which is a one-line diff nobody reads twice.
 *  2. `no-restricted-imports` in `eslint.config.mjs`, exempting the adapter's
 *     exact path. Real, and defeated by one `// eslint-disable-next-line`.
 *  3. This, which reads the source text and does not care what ESLint was told.
 *
 * It also checks that the exemption still POINTS AT A FILE. `check-egress.mjs`
 * carries the same guard for the same reason, and it was written after three
 * allowlist entries were found exempting a rule id that no longer existed: an
 * exemption which silently means nothing today means something the day the name
 * comes back, and nothing in the file distinguishes the two states.
 */

const ADAPTER = "packages/sync-port/src/webCryptoPort.ts";

const SCAN_ROOTS = ["apps", "packages", "scripts", "supabase"];
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  "release",
  "gen",
  ".turbo",
  "shots",
  "coverage",
]);
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

/** A static import, a `require` and a dynamic import of the scoped package, in one pass. */
const NOBLE_IMPORT = /(?:from|require\s*\(|import\s*\()\s*["'`]@noble\//;

/**
 * This file names the constructs it forbids, so it matches its own regex. Every
 * gate in `scripts/` has this shape — `check-egress.mjs` hit it too, and the
 * finding there was that its own rule table read as a violation of itself.
 * Excluding the definition is not an exemption; there is nothing here to run.
 */
const SELF = "scripts/crypto-import-sites.test.mjs";

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

function nobleImportSites() {
  const sites = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file).split(sep).join("/");
      if (rel !== SELF && NOBLE_IMPORT.test(readFileSync(file, "utf8"))) sites.push(rel);
    }
  }
  return sites.sort();
}

/** Every workspace manifest, which `walk` skips: it yields source extensions only. */
function manifests() {
  const found = [];
  for (const area of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, area))) {
      const file = join(root, area, entry, "package.json");
      try {
        if (statSync(file).isFile()) found.push(file);
      } catch {
        // A directory without a manifest is not a workspace package.
      }
    }
  }
  return found;
}

describe("the AEAD library", () => {
  it("is imported by the one adapter and by nothing else", () => {
    expect(nobleImportSites()).toEqual([ADAPTER]);
  });

  it("is declared as a dependency of exactly one package", () => {
    const declaring = [];
    for (const file of manifests()) {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (Object.keys(all).some((name) => name.startsWith("@noble/"))) {
        declaring.push(relative(root, file).split(sep).join("/"));
      }
    }
    expect(declaring).toEqual(["packages/sync-port/package.json"]);
  });

  it("is pinned to an exact version rather than a range", () => {
    // A caret on a cryptographic primitive means a future `pnpm install` can
    // change the bytes this product encrypts with, without a diff anyone
    // reviews. The published vectors in `webCryptoPort.test.ts` would still
    // catch a behavioural change — but only after it was already installed.
    const pkg = JSON.parse(readFileSync(join(root, "packages/sync-port/package.json"), "utf8"));
    expect(pkg.dependencies["@noble/ciphers"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("still has an ESLint restriction whose exemption points at a real file", () => {
    const config = readFileSync(join(root, "eslint.config.mjs"), "utf8");
    expect(config).toContain('group: ["@noble/**"]');
    expect(config).toContain(`ignores: ["${ADAPTER}"]`);
    expect(statSync(join(root, ADAPTER)).isFile()).toBe(true);
  });
});
