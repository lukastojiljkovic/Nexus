// No shebang — same reason as the other gates: this module is a CLI and an
// import target for its own tests, and Vite does not strip a shebang from an
// `.mjs` it transforms.
//
// WHY THIS GATE EXISTS. `pro/format.ts` was written with a NON-BREAKING SPACE
// (U+00A0) inside `` `${value} ${unit}` ``. Nothing showed it. It is a space in
// every editor, a space in `git diff`, a space in review, and the file compiled,
// linted and typechecked — the only way it surfaced was `cat -A`. Had it
// survived, every quantity in the professional drawer would have carried an
// invisible byte into every copied result and every exported file, and the bug
// report would have been „the number does not parse in Excel" about a number
// that looks perfect on screen.
//
// That is DC-36 exactly one step along. There the byte was a NUL and the harm
// was that a whole file became invisible to the secret scan; here the byte is a
// space-alike and the harm is that it becomes invisible to the READER. Both are
// the same class: a character that no text tool renders differently from its
// harmless neighbour, in a repository where „read every changed file in full" is
// the primary defence.
//
// THE RULE. In application and package source, these characters may not appear
// as themselves. Every one of them has an escape (`\u00a0`, `\u200b`), and the
// escape is visible, greppable and diffable — so the rule costs nothing and the
// intent survives review. Serbian letters, the curly quotes and every other
// visible non-ASCII character are untouched: what is banned is invisibility, not
// Unicode.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { relative, sep } from "node:path";

import { REPO_ROOT, findScanFiles } from "./check-colours.mjs";

/**
 * The characters, and what each one costs when it survives.
 *
 * Every entry is something a text editor draws as nothing, or as a character it
 * is not. There is deliberately no entry for anything merely unusual: `→`, `≤`
 * and `š` are all non-ASCII and all perfectly visible, and a gate that fired on
 * them would be a gate somebody switches off.
 */
export const INVISIBLES = [
  { code: 0x0000, id: "NUL", why: "makes the whole file binary to git, and invisible to the secret scan (DC-36)" },
  { code: 0x00a0, id: "NBSP", why: "renders as a space and is not one — breaks parsing wherever the value is pasted" },
  { code: 0x00ad, id: "SOFT HYPHEN", why: "renders as nothing until the line wraps, then as a hyphen nobody typed" },
  { code: 0x200b, id: "ZWSP", why: "renders as nothing and splits an identifier or a keyword in two" },
  { code: 0x200c, id: "ZWNJ", why: "renders as nothing" },
  { code: 0x200d, id: "ZWJ", why: "renders as nothing" },
  { code: 0x2028, id: "LINE SEPARATOR", why: "is a newline to a JS parser and not to a line-based tool" },
  { code: 0x2029, id: "PARAGRAPH SEPARATOR", why: "as above" },
  { code: 0x2060, id: "WORD JOINER", why: "renders as nothing" },
  { code: 0xfeff, id: "BOM / ZWNBSP", why: "renders as nothing, and mid-file it is not a byte-order mark at all" },
];

const BY_CODE = new Map(INVISIBLES.map((entry) => [entry.code, entry]));

const CODES = new Set(INVISIBLES.map((entry) => entry.code));

/**
 * Every offending character in one file's text, as
 * `[{ line, column, id, why }]`.
 *
 * Scans code points rather than running a regex, so the report can name the
 * exact character rather than „something matched" — and so a future entry is one
 * row in the table above rather than an edit to a pattern.
 */
export function scanText(text) {
  const hits = [];
  let line = 1;
  let column = 1;
  for (const char of text) {
    if (char === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    const code = char.codePointAt(0);
    if (code !== undefined && CODES.has(code)) {
      const entry = BY_CODE.get(code);
      hits.push({
        line,
        column,
        id: entry?.id ?? "?",
        why: entry?.why ?? "",
        escape: `\\u${code.toString(16).padStart(4, "0")}`,
      });
    }
    column += 1;
  }
  return hits;
}

export function auditAll(repoRoot = REPO_ROOT) {
  const findings = [];
  for (const file of findScanFiles(repoRoot)) {
    // `latin1` would never fail, but it would also mis-decode every Serbian
    // letter and report nothing useful; these files are UTF-8 by construction.
    for (const hit of scanText(readFileSync(file, "utf8"))) {
      findings.push({ file: relative(repoRoot, file).split(sep).join("/"), ...hit });
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = auditAll();
  if (findings.length === 0) {
    console.log("check-invisibles: no invisible characters in source.");
    process.exit(0);
  }
  console.error(
    `check-invisibles: ${findings.length} invisible character(s) in source.\n` +
      "Each of these renders as nothing, or as a character it is not.\n",
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}:${f.column}  ${f.id} — ${f.why}`);
  }
  console.error("\nWrite the escape instead — \\u00a0, \\u200b — which a reader can see.");
  process.exit(1);
}
