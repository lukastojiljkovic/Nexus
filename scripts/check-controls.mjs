// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-controls.mjs`) and an import target
// for its own tests.
//
// WHY THIS GATE EXISTS.
//
// `packages/ui/src/styles.css` replaces the operating system's radio and
// checkbox with `.nx-radio` and `.nx-checkbox`: a 15px box painted in the
// theme's tokens, behind a 24x24 transparent `::before` that carries the
// pointer target up to the floor the rest of the product holds. A bare
// `<input type="radio">` gets none of that. It renders at 13x13 in the OS
// widget — grey, square-cornered, and the same in Dan as in Noć, because the
// OS does not know the app has themes — and its hit area is eleven pixels
// under the minimum.
//
// The interesting part is not that it looks wrong. It is that it is INVISIBLE
// TO EVERY OTHER CHECK IN THE TREE. It uses no colour, so `check:colours` and
// `check:contrast` have nothing to read; it declares no custom property, so
// `check:tokens` sees nothing missing; it type-checks, because a native input
// is the most ordinary JSX there is; and it is what a developer writes when
// they reach for a radio and the design system's answer is a CLASS rather than
// a component, so there is no import to forget and no lint rule to trip.
//
// It has now been written three times. `priv.css` carries a comment about the
// first, fixed by hand. The Elektronika chassis dialog was the second, found by
// the screenshot sweep's `small-target` audit. The third had been sitting in
// `FitRoutines.tsx` unnoticed, and is the one that made this a gate rather than
// a third patch: it is inside a form the sweep cannot reach, because reaching
// it means creating a routine, opening it, and adding an exercise — three modal
// steps deep, which is exactly [DC-57]'s shape. A rule enforced by photography
// is a rule that holds only where the camera goes.
//
// So the rule is enforced structurally instead: in the JSX this product ships,
// a native radio or checkbox must carry the shared class. `ALLOWED` holds the
// one file where it legitimately does not — the `<Checkbox>` component itself,
// which paints the class onto the wrapping `<label>`.
//
// WHAT IT CANNOT SEE, stated so nobody mistakes green for proof: a `type` or a
// `className` computed at runtime (`<input {...props} />`, `type={kind}`) is
// beyond a lexer, and the rule then rests on review. Both forms are absent from
// this tree, and the gate refuses the shape that has actually been written
// three times.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The same lexer `check:egress` and `check:elec` use. It matters here for one
// specific reason: `FitRoutines.tsx` now explains, in the JSX comment above the
// control it fixed, that an unstyled `input type="checkbox"` renders at 13x13.
// A gate that fires on the sentence describing it teaches people to delete the
// sentence.
import { stripComments } from "./strip-comments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

// Whole `apps` and `packages`, not the three source trees `check:elec` names.
// That gate is scoped to a colour rule about one workbench; this one is about
// every control the product renders, and the gallery is exactly where somebody
// would hand-roll a demo radio to show what one looks like.
const SCAN_ROOTS = ["apps", "packages"];
const IGNORED_DIRS = new Set(["node_modules", "dist", "out", ".turbo", "shots", "coverage"]);
// JSX only. A `.ts` file cannot spell an element without `createElement`, and
// nothing in this repository does.
const SCANNED_EXTENSIONS = new Set([".tsx"]);

/**
 * The two natives the design system replaced, and the class that replaces each.
 *
 * Paired rather than pooled: a radio wearing `.nx-checkbox` would draw a square
 * where the control means „one of these", which is a different bug with the
 * same cause, and a gate that accepted either class would pass it.
 */
const REPLACED = new Map([
  ["radio", "nx-radio"],
  ["checkbox", "nx-checkbox"],
]);

const NATIVE_TYPE = /\btype\s*=\s*\{?\s*["'](radio|checkbox)["']/;

/**
 * The `<Checkbox>` component, and nothing else.
 *
 * One entry rather than a directory. `packages/ui` is where the shared controls
 * live, so „anything under `packages/ui`" reads like the obvious rule — and it
 * would admit the next component that reaches for a native input by pattern
 * instead of by decision, in the one package whose whole job is that they do
 * not. The class is on this file's `<label>`; the gate reads the element's own
 * attributes and therefore cannot see it.
 */
export const ALLOWED = new Set(["packages/ui/src/components/Checkbox.tsx"]);

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
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCANNED_EXTENSIONS.has(extname(full))) yield full;
  }
}

/**
 * Every `<input …>` in the source, as the text between `<input` and the `>`
 * that closes THAT element.
 *
 * A regex cannot do this, and the reason is worth keeping: the tag's closing
 * `>` is not the first `>` after it. Every control in this codebase carries an
 * `onChange={(event) => …}`, and the arrow is a `>` inside a JSX expression
 * container. So the scan tracks brace depth and string state — the closing `>`
 * is the one at depth zero outside a quote — which also makes the attribute
 * order irrelevant: `className` may sit before or after `type`, and the props
 * may be spread over nine lines, as they are in every real instance.
 */
function* inputElements(source) {
  for (const match of source.matchAll(/<input\b/g)) {
    const start = match.index;
    let i = start + match[0].length;
    let depth = 0;
    let quote = null;
    while (i < source.length) {
      const ch = source[i];
      if (quote !== null) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        i += 1;
        break;
      }
      i += 1;
    }
    yield { start, text: source.slice(start, i) };
  }
}

export function scanSource(relPath, source) {
  if (ALLOWED.has(relPath.split(sep).join("/"))) return [];
  const stripped = stripComments(source);
  const findings = [];
  for (const element of inputElements(stripped)) {
    const type = NATIVE_TYPE.exec(element.text)?.[1];
    if (type === undefined) continue;
    const expected = REPLACED.get(type);
    if (new RegExp(`\\b${expected}\\b`).test(element.text)) continue;
    const line = stripped.slice(0, element.start).split("\n").length;
    findings.push({ file: relPath, line, type, expected });
  }
  return findings;
}

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file).split(sep).join("/");
      findings.push(...scanSource(rel, readFileSync(file, "utf8")));
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `CONTROLS audit FAILED — ${findings.length} native control(s) the design system replaces:\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  <input type="${f.type}"> without .${f.expected}`);
    }
    console.error(
      "\nA bare radio or checkbox renders as the OS widget: 13x13, grey in both\n" +
        "themes, and its pointer target is under the 24px floor. packages/ui paints\n" +
        'these itself — add className="nx-radio" to the input, or use the <Checkbox>\n' +
        "component, which carries .nx-checkbox on its label. Nothing else in the\n" +
        "tree can see this: it uses no colour, declares no token, type-checks, and\n" +
        "lives in forms the screenshot sweep cannot reach.",
    );
    process.exit(1);
  }
  console.log("CONTROLS audit OK");
}
