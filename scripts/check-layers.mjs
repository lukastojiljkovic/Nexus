// No `#!/usr/bin/env node` shebang, for the reason `check-colours.mjs` states
// at length: Vite does not strip one when it transforms an `.mjs`, so the test
// suite would fail to parse this module at its IMPORT line.
//
// Enforces the layer scale: a stacking order is a property of the WHOLE app,
// so no surface may name its own.
//
// WHAT WENT WRONG. The app had seven positive z-index values in use — 1, 2, 3,
// 4, 5, 20, 50, 60, 70 — twenty-two declarations across eleven files, every one
// chosen where it was written. Each is individually defensible; together they
// were a ladder that existed nowhere. `1` meant „a header pinned over its rows"
// in seven places and „the second pinned rank" in one; `2` meant „the ghost
// being dragged" in two files and „a pinned header" in two others. The only
// statement of the order was PROSE: five comments in `notes.css` alone
// re-listed it by hand, one still citing a layer 40 that no rule in the tree
// had carried for months, and one recording a stacking hazard that had never
// been real — it was written the day after the dialogs it named adopted a
// component that portals to `document.body`, from the JSX tree, which is
// exactly what a portal makes disagree with the DOM. A ladder kept in comments
// is maintained by whoever remembers to re-read them, and a comment is the one
// artifact here that nothing can contradict.
//
// THE RULE. Every `z-index` is `auto` or exactly one `var(--nx-layer-*)`.
//
// AND IT NEEDS NO EXEMPTION LIST, which is the property worth having. The
// scale's own two ends cover the cases that are not ladder positions at all:
// `--nx-layer-under` (-1) is „behind my host's children, in front of its
// background" and `--nx-layer-ground` (0) is „behind a sibling, establishing a
// context and lifting nothing". A box that means neither of those and is not
// `auto` IS taking a position in the app-wide order, by the language's own
// definition, and therefore has to name it. There is nothing left over to
// exempt, so there is no list to become wallpaper.
//
// TWO LANGUAGES, because CSS is only one of the two ways to set this. The
// renderer already writes inline styles from JS — `useAnchoredPosition` builds
// a `CSSProperties` object for every portalled panel and assigns
// `panel.style.maxHeight` directly, and those panels are precisely the boxes
// that sit at the top of this ladder. A CSS-only gate would make the class
// unrepresentable in stylesheets and leave it representable one file away.
// So the TS/TSX pass walks the real AST and looks for the three ways a value
// can be WRITTEN — `{ zIndex: … }`, `x.style.zIndex = …`, and
// `setProperty("z-index", …)`. Reading one (`style.zIndex`, which
// `shots/audit.ts` does on purpose) is a different node shape and is
// structurally invisible here, which is why this is an AST pass and not a grep
// for the identifier.
//
// NOT THIS GATE'S JOB: whether a named token exists. `check:tokens` already
// resolves every `var(--nx-*)` in the tree against the generated token set, so
// a misspelling is caught there and stating it twice would be two rules to keep
// in step. This one asks only whether the value is a NAME rather than a number.
//
// THE SCALE ITSELF IS CHECKED TOO, and that is the half a spelling rule would
// miss. If `dialog` were edited to 4 in `global.json`, all twenty-two call
// sites would still pass while dialogs painted under drawers. The declaration
// order in the JSON is the order the app means, so it is asserted to be
// strictly increasing — the file states the ladder and the file is checked
// against itself.

import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { REPO_ROOT, repoRelative, sourceRoots } from "./check-colours.mjs";
import { stripComments } from "./strip-comments.mjs";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
export const SCANNED_EXTENSIONS = new Set([...TS_EXTENSIONS, ".css"]);

/** `auto`, or one `var(--nx-layer-…)` and nothing else. Whitespace and a newline inside the value are fine. */
export const LAYER_VALUE_RE = /^(?:auto|var\(\s*--nx-layer-[a-z][a-z0-9-]*\s*\))$/;

/** Every `z-index` declaration value in already-comment-stripped CSS. */
const CSS_DECLARATION_RE = /(^|[;{}\s])z-index\s*:\s*([^;}]*)/g;

/** 1-indexed line of `offset`. Linear, and that is fine at this hit count. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// --- The scale -------------------------------------------------------------

/**
 * The layer group as the token source declares it, in declaration order.
 *
 * Read from `global.json` rather than from the generated CSS on purpose: the
 * generated file is build output, so a gate reading it would pass on a stale
 * `dist/` and fail on a clean checkout.
 */
export function readLayerScale(repoRoot = REPO_ROOT) {
  const json = JSON.parse(
    readFileSync(join(repoRoot, "packages/tokens/tokens/global.json"), "utf8"),
  );
  const layer = json.layer;
  if (layer == null || typeof layer !== "object") {
    throw new Error("check-layers: packages/tokens/tokens/global.json has no `layer` group.");
  }
  return Object.entries(layer).map(([name, value]) => [name, Number(value)]);
}

/**
 * The ladder, as one sentence: reading the JSON top to bottom must read the
 * layers bottom to top. Returns the failures rather than throwing, so its own
 * tests can hand it a broken scale.
 */
export function scaleFaults(scale) {
  const faults = [];
  for (const [index, [name, value]] of scale.entries()) {
    if (!Number.isInteger(value)) {
      faults.push(`layer.${name} = ${value} is not an integer`);
      continue;
    }
    const previous = scale[index - 1];
    if (previous != null && Number.isInteger(previous[1]) && value <= previous[1]) {
      faults.push(
        `layer.${name} (${value}) does not sit above layer.${previous[0]} (${previous[1]}) — ` +
          "the declaration order in global.json IS the stacking order",
      );
    }
  }
  return faults;
}

// --- CSS -------------------------------------------------------------------

function scanCss(rawText) {
  const stripped = stripComments(rawText);
  const hits = [];
  CSS_DECLARATION_RE.lastIndex = 0;
  let match;
  while ((match = CSS_DECLARATION_RE.exec(stripped))) {
    const value = match[2].trim();
    if (LAYER_VALUE_RE.test(value)) continue;
    hits.push({ line: lineOf(stripped, match.index + match[1].length), value });
  }
  return hits;
}

// --- TypeScript / TSX ------------------------------------------------------

/** The value of a WRITE, as source text, or `null` if this node is not one. */
function writtenValue(node, source) {
  // `{ zIndex: … }` — an object literal's property, which is how a React
  // `style` prop and a `CSSProperties` object both spell it.
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === "zIndex") {
    return node.initializer.getText(source);
  }
  // `{ zIndex }` — the shorthand carries no value here, so it can never name a
  // layer and is always a finding.
  if (ts.isShorthandPropertyAssignment(node) && node.name.getText(source) === "zIndex") {
    return node.name.getText(source);
  }
  // `el.style.zIndex = …`. Only the ASSIGNMENT form; a bare `style.zIndex` in
  // an expression is a read and never reaches here.
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.name.getText(source) === "zIndex"
  ) {
    return node.right.getText(source);
  }
  // `style.setProperty("z-index", …)`, the CSSOM spelling.
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.getText(source) === "setProperty" &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === "z-index"
  ) {
    return node.arguments[1] == null ? "" : node.arguments[1].getText(source);
  }
  return null;
}

/**
 * A written value passes only when it is a string literal holding a layer
 * token (or `auto`). A number never can be — which is the whole point — and a
 * computed expression cannot be read here, so it is reported rather than
 * assumed innocent. There is no legitimate computed z-index in this app; if one
 * ever arrives, it is a design decision that should be argued for, not one a
 * gate should wave through because it could not see inside it.
 */
function tsValuePasses(text) {
  const unquoted = /^(['"`])(.*)\1$/s.exec(text);
  return unquoted != null && LAYER_VALUE_RE.test(unquoted[2].trim());
}

function scanTypeScript(filePath, rawText) {
  const scriptKind = extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, rawText, ts.ScriptTarget.Latest, true, scriptKind);
  const hits = [];
  const visit = (node) => {
    const value = writtenValue(node, source);
    if (value != null && !tsValuePasses(value)) {
      hits.push({ line: lineOf(rawText, node.getStart(source)), value });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

// --- Per-file entry point (exported for tests) -----------------------------

export function scanSource(filePath, rawText) {
  const ext = extname(filePath);
  if (ext === ".css") return scanCss(rawText);
  if (TS_EXTENSIONS.has(ext)) return scanTypeScript(filePath, rawText);
  return [];
}

// --- File discovery --------------------------------------------------------

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The same tree the other styling gates cover, via `check-colours.mjs`'s own
 * discovery — one reading of „which packages count", for the reason its
 * comment records: a hand-written copy of that list did not notice
 * `packages/db` being added and left a whole package outside a gate that
 * claimed to cover it.
 */
export function findScanFiles(repoRoot = REPO_ROOT) {
  const files = [];
  for (const srcDir of sourceRoots(repoRoot)) walk(srcDir, files);
  return files.filter((f) => SCANNED_EXTENSIONS.has(extname(f)));
}

// --- CLI -------------------------------------------------------------------

function main() {
  const scale = readLayerScale();
  const faults = scaleFaults(scale);
  for (const fault of faults) console.log(`packages/tokens/tokens/global.json: ${fault}`);

  const files = findScanFiles();
  let violations = 0;
  for (const file of files) {
    for (const hit of scanSource(file, readFileSync(file, "utf8"))) {
      violations++;
      console.log(`${repoRelative(file)}:${hit.line}: z-index ${hit.value || "(no value)"}`);
    }
  }

  if (violations > 0 || faults.length > 0) {
    console.error(
      `\ncheck-layers: ${violations} stacking value${violations === 1 ? "" : "s"} not named by ` +
        `the layer scale, ${faults.length} fault${faults.length === 1 ? "" : "s"} in the scale itself. ` +
        "Every z-index is `auto` or one `var(--nx-layer-*)`; see the scale in " +
        "packages/tokens/tokens/global.json.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-layers: clean — ${scale.length} layers, ${files.length} files scanned.`,
  );
}

const isMain = process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
