// No shebang — same reason as the other gates: this module is a CLI and an
// import target for its own tests, and Vite does not strip a shebang from an
// `.mjs` it transforms.
//
// WHY THIS GATE EXISTS. Serbian quotes a word as „ovako“ — a low-9 opening mark
// (U+201E) and a high-6 closing one (U+201C). Nothing on a keyboard produces the
// pair, so the copy was written with the opening mark pasted and the closing one
// typed as an ordinary `"`, which inside a double-quoted TypeScript literal has
// to be escaped: „1:45\". The escape makes it look deliberate. It was not.
//
// One hundred and seventy-four of roughly three hundred and seventy-five quoted
// phrases in the shipped copy closed with the wrong glyph — more than a third,
// spread over twenty-nine files, and in several places both forms sat inside one
// sentence. Every one of them typechecks, lints, passes `check:address`, is
// valid Serbian text, and photographs as a quotation mark of some kind, which is
// why nothing in this repository could see it. That is the same shape as DC-97:
// a defect that is well-formed in every language it is written in.
//
// THE RULE, and it is a PAIRING rule rather than a ban. A „ must be closed by a
// “. It may not be closed by a ” or by an ASCII `"`. Nothing is said about a `"`
// or a ” that stands on its own — which is what lets `pro/tekst.ts` keep its
// table of quote pairs, lets `imex/ankiTranslate.ts` keep `rdquo: "”"`, and lets
// an English quotation in a test stay English. A rule that needs no exemption
// list cannot be weakened by editing one.
//
// WHAT IT DELIBERATELY DOES NOT WATCH. An UNCLOSED „ is not a finding. The copy
// is hand-wrapped near 100 columns and interpolated everywhere, so a quotation
// routinely opens in one literal and closes in the next; a rule that fired on
// „open at the end of a literal" would be reporting the line wrapper, not the
// author. What it does instead is carry the open state across the two joins that
// genuinely mean „the same sentence continues" — a `+` concatenation and a
// template interpolation — which is how `` `Polje „${label}" …` `` is caught at
// all, and it is the shape most of the real ones had.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { REPO_ROOT } from "./check-address.mjs";

/** The opening mark, the one correct closer, and the two wrong ones. */
export const OPEN = "„"; // „
export const CLOSE = "“"; // “
const WRONG = new Set(["”", '"']); // ” and a plain double quote

/**
 * Directory names the walk never enters.
 *
 * `migrations` is the one that is a JUDGEMENT rather than housekeeping. A
 * migration's SQL is a template literal, so every `--` comment inside it is
 * literal text to a parser and indistinguishable from copy — and those comments
 * are where twelve of this gate's first findings were. A comment is never
 * displayed to anybody, so the character in it cannot be wrong in the way this
 * gate means; and a shipped migration is a historical record, which is the
 * second reason not to rewrite one for typography.
 */
const SKIP_DIRS = new Set(["node_modules", "out", "dist", "shots", ".turbo", "migrations"]);

/** Every `.ts`/`.tsx` under `apps/` and `packages/`, minus {@link SKIP_DIRS}. */
export function scanFiles(root = REPO_ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(child);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(child);
      }
    }
  };
  for (const group of ["apps", "packages"]) {
    const dir = join(root, group);
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // A checkout without one of the two groups is not this gate's problem.
    }
  }
  return files;
}

/**
 * Every literal's TEXT span — delimiters excluded — in source order.
 *
 * Spans rather than cooked strings, because the finding has to be reported at a
 * line and because the wrong closer is sometimes an ESCAPE (`\"`) that a cooked
 * string has already turned into one character.
 */
function textSpans(relPath, source) {
  const parsed = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true);
  const spans = [];
  const visit = (node) => {
    const start = node.getStart(parsed);
    const end = node.getEnd();
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      spans.push([start + 1, end - 1]);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      spans.push([start + 1, end - 2]); // `…${  or  }…${
    } else if (ts.isTemplateTail(node)) {
      spans.push([start + 1, end - 1]); // }…`
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return spans;
}

/**
 * The two joins across which an open quotation is still the same sentence: a
 * template interpolation, and a `+` concatenation. Anything else — a comma
 * between two array entries, a property name, a function call — ends it.
 */
function joins(gap) {
  const tight = gap.replace(/\s+/g, "");
  // A template's spans stop either side of `${` and `}`, so its gap is the
  // interpolation and nothing else. A concatenation's spans stop INSIDE the two
  // literals, so its gap carries their closing and opening delimiters as well —
  // which is why matching a bare „+" here found no `+` chain at all, and every
  // hand-wrapped sentence stayed invisible until a test built one.
  return /^\$\{[^]*\}$/.test(tight) || /^["'`]\+["'`]$/.test(tight);
}

/** Findings for one file's source, as `[{ line, closer }]`. */
export function scanSource(relPath, source) {
  if (!source.includes(OPEN)) return [];
  let spans;
  try {
    spans = textSpans(relPath, source);
  } catch {
    return [];
  }
  const findings = [];
  let open = false;
  let previousEnd = null;
  for (const [start, end] of spans) {
    if (previousEnd !== null && !joins(source.slice(previousEnd, start))) open = false;
    const slice = source.slice(start, end);
    for (let i = 0; i < slice.length; i += 1) {
      const char = slice[i];
      if (char === "\\") {
        if (slice[i + 1] === '"' && open) {
          findings.push({ line: lineOf(source, start + i), closer: '\\"' });
          open = false;
        }
        i += 1;
        continue;
      }
      if (char === OPEN) open = true;
      else if (char === CLOSE) open = false;
      else if (open && WRONG.has(char)) {
        findings.push({ line: lineOf(source, start + i), closer: char });
        open = false;
      }
    }
    previousEnd = end;
  }
  return findings;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const file of scanFiles(root)) {
    const rel = relative(root, file).split(sep).join("/");
    for (const hit of scanSource(rel, readFileSync(file, "utf8"))) {
      findings.push({ file: rel, ...hit });
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length === 0) {
    console.log("check-quotes: every „ in source copy is closed with “.");
    process.exit(0);
  }
  console.error(
    `check-quotes: ${findings.length} quotation(s) closed with the wrong mark.\n` +
      "Serbian closes „ with “ (U+201C), never with ” or a plain double quote.\n",
  );
  for (const f of findings) console.error(`  ${f.file}:${f.line}  „ … ${f.closer}`);
  console.error("\nWrite the closing mark itself. Inside a double-quoted literal");
  console.error("it also removes the backslash the ASCII quote needed.");
  process.exit(1);
}
