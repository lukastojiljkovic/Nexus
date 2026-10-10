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
//
// ALLOWLIST. The line marker answers "this one value is deliberate". It does
// not answer the case this gate met when the developer-tools drawer arrived: a
// COLOUR CONVERTER, whose entire contract is that `parse("#aabbcc")` works and
// that its serializer emits `rgb(...)`. There the literals are not a styling
// decision at all — they are the subject matter — and there are dozens of them
// in one parser and its test. Hundreds of line markers across such a file is
// exactly how an allowlist becomes wallpaper (`check-egress.mjs`'s word for it),
// and it would also bury the handful of real one-offs the marker exists for.
//
// So this file carries the same mechanism `check-egress.mjs` already proved,
// with the same two properties that make it an allowlist and not a hole: it is
// keyed by EXACT repo-relative path, so a new file never inherits an exemption;
// and each entry names the RULE IDS it exempts, so a file allowed to parse a
// hex literal is still not allowed to hand-write `rgb(12, 34, 56)` as a style.
// Both halves are checked at startup — an id that names no rule, or a path that
// names no file, throws rather than quietly exempting nothing. And an allowed
// hit is still printed, exactly like a marker's, because this script's promise
// is that nothing it passes over is silent.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ESCAPE_MARKER = "nx-colour-allow:";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

/**
 * Every file type that can carry a style value. Exported alongside
 * `sourceRoots` below and for the same reason: `check-tokens.mjs` walks the
 * identical tree looking for a different property, and a second hand-written
 * copy of "which files count" is a second thing to forget.
 */
export const SCANNED_EXTENSIONS = new Set([...TS_EXTENSIONS, ".css", ".html"]);

// --- Colour-form patterns --------------------------------------------------

/**
 * The forms this gate detects, each with an id an allowlist entry can name.
 *
 * TWO IDS, AND THE SPLIT IS THE USEFUL ONE. A colour parser needs `colour-fn`
 * in its serializers — `` `rgb(${r}, ${g}, ${b})` `` is the output format, not a
 * style choice — while `hex` is needed almost only by its tests, because a hex
 * string BUILT from parts (`` `#${digits}` ``) never matches in the first place.
 * So a file can be allowed to emit `rgb(...)` and still be caught hard-coding
 * `#ff0000`, which is the distinction worth being able to draw.
 *
 * `pattern` is a `g` regex and is `exec`ed in a loop, so every use must reset
 * `lastIndex` first; `findColourMatches` is the one place that happens.
 */
export const COLOUR_RULES = [
  {
    id: "hex",
    // Exactly the four valid CSS hex lengths. The lookbehind/lookahead reject a
    // match that is only part of a longer hex-looking run — without them, an
    // invalid 7-digit run would still yield a spurious 6-digit "match".
    pattern:
      /(?<![#0-9a-fA-F])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g,
    what: "a hex colour literal",
  },
  {
    id: "colour-fn",
    // Function-form colours. The leading `\b` is what keeps `recolor(` and
    // `backgroundColor(` — both one contiguous identifier, no boundary before
    // the tail — from matching `color(`.
    pattern: /\b(?:rgba?|hsla?|oklch|lab|lch|color)\(/gi,
    what: "a CSS colour function",
  },
];

/**
 * Files allowed to contain an otherwise-forbidden colour form, each with the
 * reason IN THIS FILE rather than in a comment at the site.
 *
 * Keyed by exact repo-relative POSIX path — never a directory, never a glob —
 * so a new file beside an exempted one inherits nothing. See the ALLOWLIST
 * paragraph in this file's header for why the line marker is the wrong tool at
 * this scale, and `check-egress.mjs`'s equivalent for the shape.
 */
export const COLOUR_ALLOWLIST = new Map([
  [
    // The colour CONVERTER. Every hit is a `case` of `formatColour`, which
    // writes the user's own colour back out in each CSS syntax — the strings
    // `rgb(`, `hsl(`, `lab(`, `lch(`, `oklch(` are this tool's OUTPUT, the way
    // a JSON formatter's output contains braces. The rule this gate enforces is
    // „no styling value is chosen outside the token package", and a converter
    // chooses nothing: it is handed a colour and prints it.
    //
    // It exempts `colour-fn` and NOT `hex`, and the distinction is real rather
    // than tidy. The 148 CSS named colours live in this file as a
    // whitespace-separated `name f0f8ff` table with no `#` in it, so the file
    // genuinely holds zero hex literals today. Leaving `hex` unexempted keeps
    // it that way: the day somebody writes a `#` here it will be a hard-coded
    // colour — a default swatch, a placeholder — which is exactly the thing the
    // gate exists to refuse, and the exemption must not cover it.
    "packages/core/src/devtools/colour.ts",
    ["colour-fn"],
  ],
  [
    // Its tests, where the literals are the FIXTURES: „#3366cc on #ffffff is
    // 4.56:1" cannot be asserted without writing both colours down, and a
    // conversion test that named tokens instead would be testing the token
    // package. Both rules, because the vectors come in both forms.
    "packages/core/src/devtools/colour.test.ts",
    ["colour-fn", "hex"],
  ],
  [
    // The drawing viewer's layer swatch, and the one colour in this app that is
    // not ours to choose: a layer's colour is DATA the user authored in another
    // CAD program, so `layerColourCss` builds one CSS value at runtime from the
    // number the FILE carried. The same argument the electronics workbench makes
    // for its wiring colours, one module over - here it is one function rather
    // than a stylesheet, so the exemption is a file.
    "apps/desktop/src/modules/drawings/renderer/layers.ts",
    ["colour-fn"],
  ],
  [
    // Its test, where the literals are the EXPECTED values: "0x123456 is
    // rgb(18 52 86)" cannot be asserted without writing the colour down, and a
    // test that named a token instead would be testing the token package.
    "apps/desktop/src/modules/drawings/renderer/layers.test.ts",
    ["colour-fn"],
  ],
]);

/**
 * Both halves of every allowlist entry have to be real.
 *
 * `check-egress.mjs` checks the rule ids, and its comment records why: three of
 * its entries once exempted `"absolute-url"`, an id no rule ever carried, so
 * they read as exemptions while exempting nothing — and would have silently
 * become real the day some rule took that name. The same argument applies to the
 * PATH, which that gate does not yet check: an entry naming a file that has been
 * renamed or deleted is equally unreadable, and equally ready to spring back to
 * life under a future file of the same name. Both are checked here, at module
 * load, so a stale entry is a startup failure instead of a sentence that reads
 * true.
 *
 * Exported so its own tests can hand it a bad map; called immediately below with
 * the real one.
 */
export function assertAllowlistIsSound(allowlist, rules = COLOUR_RULES, repoRoot = REPO_ROOT) {
  for (const [path, ids] of allowlist) {
    for (const id of ids) {
      if (!rules.some((rule) => rule.id === id)) {
        throw new Error(
          `check-colours: allowlist entry ${path} exempts "${id}", which is not a rule id. ` +
            `Known ids: ${rules.map((rule) => rule.id).join(", ")}.`,
        );
      }
    }
    if (!existsSync(join(repoRoot, path))) {
      throw new Error(
        `check-colours: allowlist entry ${path} names a file that does not exist. ` +
          "Delete the entry, or fix the path.",
      );
    }
  }
}

assertAllowlistIsSound(COLOUR_ALLOWLIST);

const CSS_BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const CSS_STRING_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Replaces every non-newline character with a space, so every offset AFTER the match still lands on its original line. */
function blank(match) {
  return match.replace(/[^\n]/g, " ");
}

/** Every colour-form match in `text`, as `[offset, matchedText, ruleId]`, in source order. */
function findColourMatches(text) {
  const matches = [];
  for (const rule of COLOUR_RULES) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(text))) matches.push([m.index, m[0], rule.id]);
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
      for (const [offset, matched, rule] of findColourMatches(slice)) {
        hits.push({ line: lineForOffset(lineStarts, start + offset), text: matched, rule });
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
  return findColourMatches(scanText).map(([offset, text, rule]) => ({
    line: lineForOffset(lineStarts, offset),
    text,
    rule,
  }));
}

function scanHtml(rawText, lineStarts) {
  const scanText = rawText.replace(HTML_COMMENT_RE, blank);
  return findColourMatches(scanText).map(([offset, text, rule]) => ({
    line: lineForOffset(lineStarts, offset),
    text,
    rule,
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

/**
 * The allowlist's key form: repo-relative, POSIX separators. One spelling of
 * that conversion, so `main`'s reporting and `scanSource`'s lookup can never
 * disagree about what a file is called. A path that is already relative is
 * returned untouched — that is how a test names a file that does not exist.
 */
export function repoRelative(filePath, repoRoot = REPO_ROOT) {
  return isAbsolute(filePath) ? relative(repoRoot, filePath).split("\\").join("/") : filePath;
}

// --- Per-file entry point (exported for tests) --------------------------

/**
 * Scans one file's already-read text and returns every finding, each tagged
 * `status: "violation" | "invalid-escape" | "allowed"`. Files of a type this
 * script does not cover (see the module header) yield an empty array.
 *
 * `relPath` is what the allowlist is keyed by, and it is a SEPARATE parameter
 * from `filePath` on purpose: `filePath` reaches `ts.createSourceFile`, which
 * uses it only to pick TS vs TSX by extension, and the CLI hands it an absolute
 * path. Keying the allowlist off that would mean an entry that never matches on
 * one developer's machine and matches on another's.
 *
 * It defaults through `repoRelative` rather than to `filePath` itself, and the
 * difference is not cosmetic: the plain default made a single-argument call over
 * an ABSOLUTE path — which is what walking the real tree produces — look up a
 * key the allowlist cannot contain, so every exemption silently evaporated and
 * the whole-tree test read 258 deliberate entries as 258 violations. A default
 * that quietly turns a safety list off is worse than no default.
 */
export function scanSource(
  filePath,
  rawText,
  relPath = repoRelative(filePath),
  allowlist = COLOUR_ALLOWLIST,
) {
  const ext = extname(filePath);
  const lineStarts = buildLineStarts(rawText);

  let rawHits;
  if (TS_EXTENSIONS.has(ext)) rawHits = scanTypeScript(filePath, rawText, lineStarts);
  else if (ext === ".css") rawHits = scanCss(rawText, lineStarts);
  else if (ext === ".html") rawHits = scanHtml(rawText, lineStarts);
  else return [];

  const exemptRules = allowlist.get(relPath) ?? [];
  const rawLines = rawText.split("\n");
  return rawHits.map((hit) => {
    // The allowlist is consulted BEFORE the line marker, so an allowlisted file
    // does not also need markers — but a hit the allowlist does not cover falls
    // straight through to the marker and then to a violation, which is what
    // makes a per-rule exemption mean what it says.
    if (exemptRules.includes(hit.rule)) {
      return { ...hit, file: filePath, status: "allowed", reason: `allowlisted: ${hit.rule}` };
    }
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

/**
 * Every `src/` directory the styling gates cover: one per package across
 * `apps/*` and `packages/*`, discovered from the filesystem, minus
 * `packages/tokens` — the one package allowed to hold real colour values,
 * being the source of truth the rest of the tree points at.
 *
 * Exported because `check-tokens.mjs` walks this same tree for a different
 * property. Its root list used to be four hand-written entries under a comment
 * claiming it "mirrors check-colours.mjs's roots"; `packages/db` was added to
 * the repo after that copy was made and never reached it, so an entire package
 * sat outside a gate whose own comment said it was covered. A comment cannot
 * mirror anything and a literal list cannot notice a new package — only
 * discovery can, and only one importer of it can stay in step.
 */
export function sourceRoots(repoRoot = REPO_ROOT) {
  const roots = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = join(repoRoot, group);
    if (!isDirectory(groupDir)) continue;
    for (const pkgName of readdirSync(groupDir)) {
      if (group === "packages" && pkgName === "tokens") continue;
      const srcDir = join(groupDir, pkgName, "src");
      if (isDirectory(srcDir)) roots.push(srcDir);
    }
  }
  return roots;
}

// Every scanned file under each of those roots.
export function findScanFiles(repoRoot = REPO_ROOT) {
  const files = [];
  for (const srcDir of sourceRoots(repoRoot)) walk(srcDir, files);
  return files.filter((f) => SCANNED_EXTENSIONS.has(extname(f)));
}

// --- CLI ------------------------------------------------------------------

function main() {
  const files = findScanFiles();
  let violationCount = 0;
  let allowedCount = 0;

  for (const file of files) {
    const rawText = readFileSync(file, "utf8");
    const relPath = repoRelative(file);

    let hits;
    try {
      hits = scanSource(file, rawText, relPath);
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
