// No shebang — this module is both a CLI and an import target for its own
// tests, and Vite does not strip a shebang when it transforms an `.mjs`.
//
// WHY THIS GATE EXISTS. On 2026-08-08 an agent editing a module stylesheet
// closed a comment block early — twice — leaving Serbian prose sitting at the
// top level of the file. It caught both itself with an ad-hoc script and said
// so, which is the only reason anyone knows. Nothing in the gate set would have
// found it: `check-colours` strips comments before it looks, `check-tokens`
// scans for one pattern, and the build does not fail on it either.
//
// It does not fail because CSS is defined to recover from errors rather than
// reject. Loose prose is parsed as the beginning of a SELECTOR, which then
// swallows everything up to the next `{` — so the rule that follows the mistake
// silently stops applying, and the only symptom is that some part of the app
// quietly loses its styling. That is the same shape as the undefined custom
// property `check-tokens` was written for: not a crash, a disappearance.
//
// Three checks, each aimed at a way the file can be wrong without being loud:
//   - comment delimiters balance;
//   - braces balance (and never close below depth zero);
//   - text at the top level looks like a SELECTOR and not like a sentence.
//
// The third is the one that catches the real defect, and it is deliberately a
// character-set test rather than a grammar: a real CSS selector cannot contain
// a Serbian diacritic or a „…“ quote, and this codebase's prose always does.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

import { sourceRoots } from "./check-colours.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// The scan roots come from `check-colours.mjs`, which discovers every `apps/*`
// and `packages/*` that has a `src/`, rather than from a list written here.
//
// This file used to hold three hand-written paths — desktop, gallery, ui — the
// three packages that happened to own a stylesheet on the day it was written.
// That is the identical construct that had already failed in `check-tokens.mjs`,
// where a copied root list quietly stopped covering `packages/db` the moment
// that package existed. A literal list cannot notice a new package; it just
// keeps passing, and a gate that passes because it looked nowhere is
// indistinguishable from one that passed because the tree is clean. The
// stylesheets are all still under those three today — which is exactly when the
// list is cheapest to remove and hardest to remember to.

/**
 * Every character a selector, an at-rule prelude or a `@media` query may
 * legally contain. Anything else at depth zero is prose.
 *
 * Generous on purpose — it admits `@supports (display: grid)`, attribute
 * selectors, `:not()`, `>` combinators, percentages in `@keyframes`, and the
 * `\\` of an escaped class. What it refuses is a letter outside ASCII and the
 * typographic quotes this project writes its comments in.
 */
const SELECTOR_CHARS = /^[\sa-zA-Z0-9_\-.#:[\]()>+~*=,"'^$|%/\\&@]*$/;

/** One thing wrong with a stylesheet, as the CLI prints it. */
export function checkCss(text) {
  const problems = [];

  // --- Comments -------------------------------------------------------------
  // Counted before anything else, because an unbalanced comment is what makes
  // the other two checks report nonsense.
  // CSS comments do not nest — `/* /* */` closes at the first `*/` — so there
  // is nothing to track but the open/close pairing itself.
  let depthlessText = "";
  let index = 0;
  let line = 1;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) {
        problems.push({ line, kind: "unclosed-comment" });
        return problems;
      }
      for (let scan = index; scan < end; scan += 1) if (text[scan] === "\n") line += 1;
      index = end + 2;
      continue;
    }
    if (text[index] === "\n") line += 1;
    depthlessText += text[index];
    index += 1;
  }
  if (text.includes("*/") && !text.includes("/*")) problems.push({ line: 1, kind: "stray-comment-end" });

  // --- Braces, and what sits between them ----------------------------------
  let depth = 0;
  let pending = "";
  let pendingLine = 1;
  let currentLine = 1;
  for (const character of depthlessText) {
    if (character === "\n") currentLine += 1;
    if (character === "{") {
      if (depth === 0) {
        const prelude = pending.trim();
        if (prelude.length > 0 && !SELECTOR_CHARS.test(prelude)) {
          problems.push({ line: pendingLine, kind: "prose-at-top-level", text: prelude.slice(0, 70) });
        }
      }
      depth += 1;
      pending = "";
      pendingLine = currentLine;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth < 0) {
        problems.push({ line: currentLine, kind: "unmatched-close-brace" });
        depth = 0;
      }
      pending = "";
      pendingLine = currentLine;
      continue;
    }
    // A `;` at the top level ends a STATEMENT at-rule — `@import "…";`,
    // `@charset`, `@layer a, b;`. Those are the only things allowed to end
    // without a block, so the chunk is checked for exactly that and then
    // cleared. Without this the imports at the head of `app.css` accumulated
    // into the next selector and were reported as prose — which would have made
    // the gate's very first run a false positive, i.e. the DC-01 failure again.
    if (depth === 0 && character === ";") {
      const statement = pending.trim();
      if (statement.length > 0 && !statement.startsWith("@")) {
        problems.push({ line: pendingLine, kind: "statement-outside-a-rule", text: statement.slice(0, 70) });
      }
      pending = "";
      pendingLine = currentLine;
      continue;
    }
    if (depth === 0) {
      if (pending.trim().length === 0) pendingLine = currentLine;
      pending += character;
    }
  }
  if (depth > 0) problems.push({ line: currentLine, kind: "unclosed-brace" });

  // Trailing top-level text with no `{` after it — the tail of the file.
  const tail = pending.trim();
  if (tail.length > 0 && !SELECTOR_CHARS.test(tail)) {
    problems.push({ line: pendingLine, kind: "prose-at-top-level", text: tail.slice(0, 70) });
  }

  return problems;
}

function* walkCss(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "out") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walkCss(path);
    else if (path.endsWith(".css")) yield path;
  }
}

/**
 * The directories this gate walks. Exported so its own test can assert that no
 * stylesheet in the tree falls outside them — asserting against `sourceRoots`
 * instead would only prove that the shared list is right, not that THIS gate
 * uses it, and a revert to a literal list would go unnoticed.
 */
export function scanRoots() {
  return sourceRoots(ROOT);
}

export function scanStylesheets() {
  const failures = [];
  for (const root of scanRoots()) {
    let files;
    try {
      files = [...walkCss(root)];
    } catch {
      continue;
    }
    for (const path of files) {
      for (const problem of checkCss(readFileSync(path, "utf8"))) {
        failures.push({ file: relative(ROOT, path), ...problem });
      }
    }
  }
  return failures;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = scanStylesheets();
  if (failures.length === 0) {
    console.log("check-css: every stylesheet parses as CSS.");
    process.exit(0);
  }
  console.log(`check-css: ${failures.length} problem(s).\n`);
  for (const { file, line, kind, text } of failures) {
    console.log(`  ${file}:${line}  ${kind}${text === undefined ? "" : `  — ${text}`}`);
  }
  console.log("\nCSS recovers from errors rather than rejecting them: loose prose is");
  console.log("parsed as a selector and swallows the rule after it, which then");
  console.log("silently stops applying. Nothing else in the gate set sees this.");
  process.exit(1);
}
