// No shebang, for the same reason `check-colours.mjs` has none: this module is
// both a CLI (`node scripts/check-tokens.mjs`) and an import target for its own
// tests, and Vite does not strip a shebang when it transforms an `.mjs`.
//
// WHY THIS GATE EXISTS. On 2026-08-08 the shell's title strip was found setting
// `font-size: var(--nx-font-size-bodySm)`. There is no such token — the emitted
// name is `--nx-font-size-body-sm`, because `build.mjs` kebab-cases every key on
// its way out. CSS does not complain about an undefined custom property: the
// declaration is simply dropped, the element keeps whatever it inherited, and
// the result is a size nobody chose that happens to look plausible. It had been
// shipping since the strip was written, and every gate in the repo was green.
//
// That is the same defect class as the raw-colour grep, one step further along.
// The colour gate proves every colour COMES FROM the tokens. This proves the
// token being asked for EXISTS — otherwise „it uses a token" and „it uses
// nothing at all" are indistinguishable from the source, which is exactly how
// this one survived review.
//
// SCOPE. Every `var(--nx-…)` reference in the app and package sources, checked
// against the names `packages/tokens` actually emits. Only the `--nx-` family:
// a component's own local custom property (`--cal-hour-h`, `--app-titlebar-h`)
// is a private variable declared and read in the same file, and enrolling those
// would mean re-implementing CSS scoping badly.
//
// A reference WITH a fallback (`var(--nx-x, 38px)`) is still a failure. The
// fallback makes it silent rather than making it correct: the value a reader
// sees comes from the fallback while the code claims to follow the token, and
// the two will drift the moment the token changes.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, relative } from "node:path";

import { SCANNED_EXTENSIONS, sourceRoots } from "./check-colours.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TOKENS = join(ROOT, "packages", "tokens", "tokens");

// Where a `var(--nx-…)` may appear: the same roots and the same file types
// `check-colours.mjs` covers, IMPORTED from it rather than restated. This used
// to be four hand-written paths under a comment claiming they mirrored that
// gate's scope. They did not. `packages/db` joined the repo after the copy was
// made and never reached it, so this gate scanned four packages while saying it
// scanned the same five — and the only way to notice was to open two files that
// nobody had a reason to read together. „Mirrors" is a claim an import can keep
// and a copy cannot; `check-colours.test.mjs` proves the derived list really
// does reach every package that has a `src/`.
//
// `packages/tokens` is out, as it is over there: it is where the names are
// DEFINED, and a definition is not a reference.

/** `--nx-font-size-body-sm` — the emitted spelling. */
const REFERENCE = /var\(\s*(--nx-[a-z0-9-]+)/gi;

/**
 * A `--nx-*` custom property DECLARED in source rather than emitted by the
 * token build — `--nx-tone`, `--nx-cell-hue`, `--nx-reveal-duration`.
 *
 * These are a component's own private variables, set on one element and read by
 * its own rules, and they are legitimately in the `--nx-` namespace because
 * they belong to `@nexus/ui`. The rule the gate actually enforces is therefore
 * not „every reference is a token" but „every reference RESOLVES" — to a token,
 * or to a declaration that exists in the same source tree.
 */
const DECLARATION = /(--nx-[a-z0-9-]+)\s*:/gi;

/**
 * A name completed at runtime: `var(--nx-swatch-${accent})`, which is how the
 * eight selectable accents are read out of the cascade.
 *
 * Skipped rather than failed, and skipped rather than half-matched: the regex
 * above would otherwise capture the bare prefix `--nx-swatch-` and report a
 * token nobody wrote. A composed name cannot be checked statically at all, so
 * the honest thing is to say so — silently accepting the prefix would let a
 * genuinely wrong prefix through under the same cover.
 */
const COMPOSED = /var\(\s*--nx-[a-z0-9-]*\$\{/i;

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Flattens a token group exactly the way `build.mjs` does, so the two cannot disagree about a name. */
function flatten(node, prefix, into) {
  for (const [key, value] of Object.entries(node)) {
    const name = `${prefix}-${kebab(key)}`;
    if (typeof value === "object" && value !== null) flatten(value, name, into);
    else into.add(name);
  }
}

/**
 * Every `--nx-*` custom property the build emits.
 *
 * Read from the token JSON rather than from `dist/css/tokens.css`, for the same
 * reason `check-contrast.mjs` reads the JSON: this must fail before anything is
 * generated, and it must not depend on build output existing.
 */
export function emittedTokenNames() {
  const global = JSON.parse(readFileSync(join(TOKENS, "global.json"), "utf8"));
  const names = new Set();
  for (const [group, node] of Object.entries(global)) {
    // `build.mjs` emits the colour PRIMITIVES only as accent swatches, never as
    // `--nx-color-*`; everything else in `global.json` is emitted as-is.
    if (group === "color") continue;
    flatten(node, `--nx-${kebab(group)}`, names);
  }

  // The semantic layer, from either theme — `build.mjs` requires both themes to
  // declare the same keys, so either one is the whole set.
  const dan = JSON.parse(readFileSync(join(TOKENS, "themes", "dan.json"), "utf8"));
  for (const key of Object.keys(dan.semantic)) names.add(`--nx-${kebab(key)}`);
  // One swatch per selectable accent, for the accent picker's own dots.
  for (const id of Object.keys(dan.accents)) names.add(`--nx-swatch-${kebab(id)}`);

  return names;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "out") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Every source file the scan covers, read once and reused for both passes. */
function sourceFiles() {
  const files = [];
  for (const root of sourceRoots(ROOT)) {
    let entries;
    try {
      entries = [...walk(root)];
    } catch {
      continue; // an app that is not checked out is not a failure
    }
    for (const path of entries) {
      if (!SCANNED_EXTENSIONS.has(extname(path))) continue;
      files.push({ path, text: readFileSync(path, "utf8") });
    }
  }
  return files;
}

/**
 * Every `--nx-*` reference that resolves to nothing, as `{ file, line, name }`.
 *
 * Two passes, and the order is the point: every declaration in the tree is
 * collected FIRST, so a component's own private variable is known before any
 * file that reads it is scanned. A single pass would report `--nx-tone` as
 * undefined in every rule above the one that sets it.
 */
export function scanReferences(names, files = sourceFiles()) {
  const declared = new Set(names);
  for (const { text } of files) {
    for (const match of text.matchAll(DECLARATION)) declared.add(match[1].toLowerCase());
  }

  const failures = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(REFERENCE)) {
        // Re-test the composed form against the text from this match onward,
        // so one composed reference on a line does not excuse a broken one
        // beside it.
        if (COMPOSED.test(line.slice(match.index))) continue;
        const name = match[1].toLowerCase();
        // A capture ending in „-" is not a complete property name — it is the
        // prefix of one, and the character that stopped the match was a
        // placeholder: a template hole, or a `*` in a doc comment writing
        // `var(--nx-swatch-*)` to mean „any of them". Reporting the prefix
        // would be reporting a token nobody wrote, and a gate that cries wolf
        // is a gate that gets muted — which is the failure this repo has
        // already paid for once (DC-01).
        if (name.endsWith("-")) continue;
        if (declared.has(name)) continue;
        failures.push({ file: relative(ROOT, path), line: index + 1, name });
      }
    });
  }
  return failures;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = scanReferences(emittedTokenNames());
  if (failures.length === 0) {
    console.log("check-tokens: every --nx-* reference resolves to a real token.");
    process.exit(0);
  }
  console.log(`check-tokens: ${failures.length} reference(s) to a token that does not exist.\n`);
  for (const { file, line, name } of failures) {
    console.log(`  ${file}:${line}  ${name}`);
  }
  console.log("\nCSS drops an undefined custom property silently — the element keeps");
  console.log("whatever it inherited, so this never looks broken. Fix the NAME.");
  process.exit(1);
}
