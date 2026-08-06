// No `#!/usr/bin/env node` shebang, deliberately. This module is both a CLI
// (`node scripts/check-colours.mjs`, never `./scripts/…`) and an import target
// for its own tests — and Vite does not strip a shebang when it transforms an
// `.mjs`, so the test suite fails to parse the module with a bare
// "SyntaxError: Invalid or unexpected token" that points at the IMPORT rather
// than at the offending line. Nothing needs the shebang; the confusion it buys
// is not worth it.
//
// Enforces the design-token rule stated in CLAUDE.md and README.md's
// "Styling rules": every colour value in application/component source comes
// from `packages/tokens` as a `--nx-*` CSS variable, and nothing outside
// that package may write a raw colour literal. This used to be a grep a
// human had to remember to run by hand — this script is that grep made into
// a real gate: wired into `pnpm check:colours` and CI, with its own unit
// tests (`check-colours.test.mjs`) so a regression in ITS logic is caught
// too, not just a regression in the app.
//
// SCOPE. Every `src/` directory under `apps/*` and `packages/*`, excluding
// `packages/tokens` itself — the one package allowed to hold real colour
// values, being the source of truth the rest of the tree points at. Nothing
// under a `src/` directory is ever build output (`dist/`, `out/`, `gen/`,
// `release/`, `.turbo/` all live BESIDE `src/`, never inside it), so
// generated code can never be in scan range by construction — no `ignores`
// list to keep in sync by hand.
//
// Only file types that can actually carry a style value are walked:
// `.ts`/`.tsx`/`.mts`/`.cts` and `.css`, plus `.html` for the one shell file
// that could carry an inline `style` attribute. JSON data files (the fitness
// catalogues, the generated third-party licence notices) are deliberately
// OUT of scope: the styling rule governs UI code, not data payloads, and —
// unlike every file type actually scanned here — JSON has no comment syntax,
// so a JSON file could never carry the escape hatch below if third-party
// licence text ever coincidentally matched one of the patterns.
//
// DETECTION.
//   - TypeScript/TSX: a colour literal lives inside a string or template
//     literal (`"#fff"`, the STATIC pieces of `` `var(--nx-swatch-${id})` ``,
//     …) — never inside a comment or an identifier. So this walks the real
//     TypeScript AST (the `typescript` package is already a repo
//     devDependency — nothing new is installed for this) and inspects only
//     `StringLiteral` / `NoSubstitutionTemplateLiteral` / template-literal
//     spans. Comments, identifiers and numeric literals are structurally
//     invisible to this pass, which is what keeps a source comment like
//     "decision #11" or "fixes #1234" or a bare git SHA from ever being a
//     candidate — not a regex trained to dodge them, but a scan that never
//     looks at comment text in the first place.
//   - CSS: no AST is available, so this strips `/* … */` comments AND every
//     quoted string's interior before matching. The string strip is the
//     precise fix for `content: "…"` / `font-family: "…"`-style false
//     positives: a CSS colour literal is a BARE token (`#fff`, `rgb(...)`)
//     and is never itself quoted — so by the language's own grammar,
//     anything still inside quotes after the strip categorically is not a
//     colour. Not a guess, not a blanket ignore.
//   - HTML: only comments are stripped. Unlike CSS, a real colour here would
//     be inside a quoted `style="…"` attribute, so quoted text has to stay
//     in scope.
//
// FORMS DETECTED: `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` — the four valid
// CSS hex lengths; 5- and 7-digit runs are invalid CSS and are deliberately
// never matched, and a lookaround on both sides keeps a match from landing on
// part of a longer run (e.g. stopping short inside a 7-digit typo). Also
// `rgb()` / `rgba()`, `hsl()` / `hsla()`, and — for completeness against
// newer CSS colour syntax nothing in this repo happens to use yet —
// `oklch()`, `lab()`, `lch()`, `color()`. Named CSS colour keywords (`red`,
// `papayawhip`, …) are deliberately NOT detected: without full CSS-value
// position parsing they are indistinguishable from ordinary English/Serbian
// prose and identifiers (`red`, `background`, a component prop), so a
// keyword scan would be a constant false-positive generator, not a precise
// gate. `transparent` and `currentColor` are CSS keywords, not colour picks,
// and are out of scope for the same reason the token system does not model
// them.
//
// ESCAPE HATCH. A same-line marker, `nx-colour-allow: <reason>`, inside a
// `//` or `/* */` comment for TS/CSS or `<!-- -->` for HTML, permits the one
// flagged literal on that line. It is deliberately awkward to use: it is
// line-scoped, never file- or repo-scoped, so it cannot quietly blanket a
// whole file; and a marker with nothing after the colon is itself reported
// as a failure rather than silently accepted. Every use — allowed or
// rejected — is printed. Nothing this script skips over is ever quiet about
// it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ESCAPE_MARKER = "nx-colour-allow:";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SCANNED_EXTENSIONS = new Set([...TS_EXTENSIONS, ".css", ".html"]);

// --- Colour-form patterns --------------------------------------------------

// Exactly the four valid CSS hex lengths. The lookbehind/lookahead reject a
// match that is only part of a longer hex-looking run — without them, an
// invalid 7-digit run would still yield a spurious 6-digit "match".
const HEX_RE =
  /(?<![#0-9a-fA-F])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

// Function-form colours. The leading `\b` is what keeps `recolor(` and
// `backgroundColor(` — both one contiguous identifier, no boundary before the
// tail — from matching `color(`.
const FUNC_RE = /\b(?:rgba?|hsla?|oklch|lab|lch|color)\(/gi;

const CSS_BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const CSS_STRING_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Replaces every non-newline character with a space, so every offset AFTER the match still lands on its original line. */
function blank(match) {
  return match.replace(/[^\n]/g, " ");
}

/** Every colour-form match in `text`, as `[offset, matchedText]` pairs, in source order. */
function findColourMatches(text) {
  const matches = [];
  for (const re of [HEX_RE, FUNC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) matches.push([m.index, m[0]]);
  }
  return matches.sort((a, b) => a[0] - b[0]);
}

// --- Line mapping ------------------------------------------------------

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 1-indexed line number of `offset`, via binary search over `lineStarts`. */
function lineForOffset(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// --- TypeScript / TSX: AST-scoped scan --------------------------------

const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

function scanTypeScript(filePath, rawText, lineStarts) {
  const scriptKind = extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, rawText, ts.ScriptTarget.Latest, true, scriptKind);
  const hits = [];

  function visit(node) {
    if (LITERAL_KINDS.has(node.kind)) {
      const start = node.getStart(sourceFile);
      // The raw source slice, quotes/backticks/`${`/`}` and all — never the
      // decoded `.text`, so offsets line up 1:1 with the file for accurate
      // line numbers, and stray delimiter characters can never form a
      // colour pattern themselves.
      const slice = rawText.slice(start, node.end);
      for (const [offset, matched] of findColourMatches(slice)) {
        hits.push({ line: lineForOffset(lineStarts, start + offset), text: matched });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return hits;
}

// --- CSS / HTML: comment-and-context-aware regex scan -------------------

/**
 * Blanks everything OUTSIDE a declaration's value — the span after a `:` and
 * before the `;`/`}` that ends it. A CSS colour literal is only ever a
 * declaration value; it can never be a selector (an id like `#face` is
 * hex-valid but sits before `{`, never after `:`), so this is what keeps a
 * hex-valid id selector from being indistinguishable from a real colour
 * without a full CSS parser. A `:` whose nearest terminator is `{` — a
 * pseudo-class (`:hover`) or an at-rule prelude (`@media (max-width: …)`) —
 * is exactly that, a non-value colon, and is discarded rather than kept.
 */
function restrictToDeclarationValues(text) {
  const spans = [];
  const terminatorRe = /[;{}]/g;
  let pos = 0;
  while (true) {
    const colonIdx = text.indexOf(":", pos);
    if (colonIdx === -1) break;
    terminatorRe.lastIndex = colonIdx + 1;
    const terminator = terminatorRe.exec(text);
    if (!terminator) break;
    if (text[terminator.index] !== "{") spans.push([colonIdx + 1, terminator.index]);
    pos = terminator.index + 1;
  }
  const kept = blank(text).split("");
  for (const [start, end] of spans) {
    for (let i = start; i < end; i++) kept[i] = text[i];
  }
  return kept.join("");
}

function scanCss(rawText, lineStarts) {
  const stripped = rawText.replace(CSS_BLOCK_COMMENT_RE, blank).replace(CSS_STRING_RE, blank);
  const scanText = restrictToDeclarationValues(stripped);
  return findColourMatches(scanText).map(([offset, text]) => ({
    line: lineForOffset(lineStarts, offset),
    text,
  }));
}

function scanHtml(rawText, lineStarts) {
  const scanText = rawText.replace(HTML_COMMENT_RE, blank);
  return findColourMatches(scanText).map(([offset, text]) => ({
    line: lineForOffset(lineStarts, offset),
    text,
  }));
}

// --- Escape hatch -------------------------------------------------------

/**
 * `null` — no marker on this line, the hit stands as a violation.
 * `""`   — the marker is present but carries no reason: invalid, still a
 *          violation, reported distinctly so it cannot be a silent no-op.
 * else   — the trimmed reason: the hit is allowed, but always printed.
 */
function escapeHatchReason(rawLineText) {
  const idx = rawLineText.indexOf(ESCAPE_MARKER);
  if (idx === -1) return null;
  const after = rawLineText.slice(idx + ESCAPE_MARKER.length);
  // The reason ends where its COMMENT ends, not where the LINE ends. A block
  // marker is routinely followed by more source on the same line — the natural
  // CSS spelling is `.a { color: #fff; /* nx-colour-allow: why */ }` — and an
  // end-anchored strip of `*/` never fires there. That failed in both
  // directions: the reason swallowed the trailing `*/ }` as if it were prose,
  // and, far worse, an EMPTY reason came back non-empty and the marker FAILED
  // OPEN, silently permitting the literal it was supposed to reject. A gate
  // whose escape hatch fails open is not a gate.
  const terminators = [after.indexOf("*/"), after.indexOf("-->")].filter((at) => at !== -1);
  const reason = terminators.length > 0 ? after.slice(0, Math.min(...terminators)) : after;
  return reason.trim();
}

// --- Per-file entry point (exported for tests) --------------------------

/**
 * Scans one file's already-read text and returns every finding, each tagged
 * `status: "violation" | "invalid-escape" | "allowed"`. Files of a type this
 * script does not cover (see the module header) yield an empty array.
 */
export function scanSource(filePath, rawText) {
  const ext = extname(filePath);
  const lineStarts = buildLineStarts(rawText);

  let rawHits;
  if (TS_EXTENSIONS.has(ext)) rawHits = scanTypeScript(filePath, rawText, lineStarts);
  else if (ext === ".css") rawHits = scanCss(rawText, lineStarts);
  else if (ext === ".html") rawHits = scanHtml(rawText, lineStarts);
  else return [];

  const rawLines = rawText.split("\n");
  return rawHits.map((hit) => {
    const reason = escapeHatchReason(rawLines[hit.line - 1] ?? "");
    if (reason === null) return { ...hit, file: filePath, status: "violation" };
    if (reason === "") return { ...hit, file: filePath, status: "invalid-escape" };
    return { ...hit, file: filePath, status: "allowed", reason };
  });
}

// --- File discovery -------------------------------------------------------

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Every scanned file under each package's `src/` directory, across `apps/*`
// and `packages/*`, excluding `packages/tokens`.
export function findScanFiles(repoRoot = REPO_ROOT) {
  const files = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = join(repoRoot, group);
    if (!isDirectory(groupDir)) continue;
    for (const pkgName of readdirSync(groupDir)) {
      if (group === "packages" && pkgName === "tokens") continue;
      const srcDir = join(groupDir, pkgName, "src");
      if (isDirectory(srcDir)) walk(srcDir, files);
    }
  }
  return files.filter((f) => SCANNED_EXTENSIONS.has(extname(f)));
}

// --- CLI ------------------------------------------------------------------

function main() {
  const files = findScanFiles();
  let violationCount = 0;
  let allowedCount = 0;

  for (const file of files) {
    const rawText = readFileSync(file, "utf8");
    const relPath = relative(REPO_ROOT, file).split("\\").join("/");

    let hits;
    try {
      hits = scanSource(file, rawText);
    } catch (error) {
      console.log(`${relPath}: ERROR while scanning — ${error instanceof Error ? error.message : String(error)}`);
      violationCount++;
      continue;
    }

    for (const hit of hits) {
      if (hit.status === "allowed") {
        allowedCount++;
        console.log(`${relPath}:${hit.line}: ${hit.text}  [ALLOWED: ${hit.reason}]`);
      } else if (hit.status === "invalid-escape") {
        violationCount++;
        console.log(
          `${relPath}:${hit.line}: ${hit.text}  [ESCAPE HATCH INVALID: "${ESCAPE_MARKER}" needs a reason after the colon]`,
        );
      } else {
        violationCount++;
        console.log(`${relPath}:${hit.line}: ${hit.text}`);
      }
    }
  }

  if (violationCount > 0) {
    console.error(
      `\ncheck-colours: ${violationCount} raw colour literal${violationCount === 1 ? "" : "s"} found outside packages/tokens.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-colours: clean — ${files.length} files scanned` +
      (allowedCount > 0 ? `, ${allowedCount} allowed via escape hatch.` : "."),
  );
}

const isMain = process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
