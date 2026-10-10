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
 * A UTF-8 LEAD byte followed immediately by a UTF-8 CONTINUATION byte, both
 * decoded as single latin1 characters — the signature of a file that was read
 * with the wrong encoding and written back out.
 *
 * `0xC2-0xF4` is the whole legal lead range, so the LEAD half of the test is
 * the real UTF-8 rule rather than a list of the sequences seen once: an em dash
 * (E2 80 94) and a „č" (C4 8D) corrupt through different leads, and a list
 * written from the first would have missed every Serbian letter in `strings.ts`.
 *
 * The CONTINUATION half is deliberately NARROWER than UTF-8's own `0x80-0xBF`:
 * only `0x80-0x9F`, the C1 controls, which no prose contains. The full range
 * was tried first and produced three findings in this repository that are all
 * correct text — „mañana·" and „bücher·" in a punycode comment, where an
 * accented Latin-1 letter simply precedes a middle dot. A gate that reports
 * shipped copy as broken is a gate somebody switches off (DC-01's inverse).
 *
 * What that costs: a file whose ONLY corrupted character is „š" (C5 A1) or „ž"
 * (C5 BE) is not caught, because their second byte is above 0x9F. In practice
 * corruption is never that selective — it hits every non-ASCII character in the
 * file at once, and this codebase's prose cannot go a paragraph without a dash,
 * a „ quote, an ellipsis, or a č/ć/đ, every one of which lands in 0x80-0x9F.
 *
 * The tool drawer ships a `mojibake-repair` tool, so mojibake also appears
 * legitimately in its fixtures and in the Serbian copy that demonstrates it —
 * all of it built from „Å¡"-shaped sequences, which this range does not match.
 */
const isMojibakeLead = (code) => code >= 0x00c2 && code <= 0x00f4;
const isMojibakeContinuation = (code) => code >= 0x0080 && code <= 0x009f;

/**
 * The same corruption through WINDOWS-1252 instead of latin1, which is what an
 * editor or a patch tool on Windows does: there the bytes 0x80-0x9F decode to
 * printable characters (`—` is E2 80 94 and comes back as „â€”"), so the rule
 * above never sees a control character at all. Those 27 characters are ordinary
 * punctuation and Serbian letters on their own, so this half is strict about the
 * SHAPE instead: a lead followed by exactly the continuations its width needs,
 * where a two-byte lead is one of the capitals whose sequences are Latin, Greek
 * or Cyrillic letters (C2-D3) and its continuation is one of the 27 or a Latin-1
 * sign (U+00A0-U+00BF, which 0xA0-0xBF decode to unchanged).
 * „Ä‡" (ć), „Å¡" (š) and „â€”" (—) are caught; „×“", „é“" and „café…" are not.
 */
const CP1252_HIGH = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);
const isCp1252Continuation = (code) => CP1252_HIGH.has(code) || (code >= 0x00a0 && code <= 0x00bf);

/** Whether `codes[at]` starts a UTF-8 sequence that was read as Windows-1252. */
function isCp1252Mojibake(codes, at) {
  const lead = codes[at];
  if (lead >= 0x00c2 && lead <= 0x00d3) return isCp1252Continuation(codes[at + 1]);
  const width = lead >= 0x00e0 && lead <= 0x00ef ? 3 : lead >= 0x00f0 && lead <= 0x00f4 ? 4 : 0;
  if (width === 0) return false;
  for (let next = 1; next < width; next += 1) {
    if (codes[at + next] === undefined || !isCp1252Continuation(codes[at + next])) return false;
  }
  return true;
}

/**
 * Lines that carry Windows-1252 mojibake ON PURPOSE: the tool drawer's
 * `mojibake-repair` copy, which shows the user the broken form it repairs. One
 * literal at a time, like `check-english`'s allowlist, so the rest of each file
 * is still judged.
 */
export const MOJIBAKE_ALLOWLIST = [
  { file: "apps/desktop/src/renderer/src/strings/pro.ts", contains: "„Å¡“ i „Ä‡“" },
  { file: "apps/desktop/src/renderer/src/strings/pro.tekst.ts", contains: "„Å¡“ ili „Ä‡“" },
  { file: "apps/desktop/src/renderer/src/strings/pro.en.ts", contains: "“Å¡” and “Ä‡”" },
  { file: "apps/desktop/src/renderer/src/strings/pro.tekst.en.ts", contains: "“Å¡” or “Ä‡”" },
  { file: "packages/core/src/pro/tekst.test.ts", contains: "Å¡ -> š, Ä‡ -> ć" },
  { file: "packages/core/src/pro/tekst.test.ts", contains: 'text: "Ä‡"' },
  { file: "packages/core/src/pro/tekst.test.ts", contains: 'text: "Å¡", writtenAs: "utf-8"' },
  { file: "packages/core/src/pro/tekst.test.ts", contains: 'when reading "Å¡" as ISO-8859-2' },
];

const MOJIBAKE_WHY =
  "a UTF-8 byte sequence decoded as latin1 — the file was read with the wrong " +
  "encoding and written back, so every dash, quote and Serbian letter in it is " +
  "now two or three characters that render as gibberish";

/**
 * Every offending character in one file's text, as
 * `[{ line, column, id, why }]`.
 *
 * Scans code points rather than running a regex, so the report can name the
 * exact character rather than „something matched" — and so a future entry is one
 * row in the table above rather than an edit to a pattern.
 */
export function scanText(text, relPath = "") {
  const hits = [];
  text.split("\n").forEach((lineText, index) => {
    if (MOJIBAKE_ALLOWLIST.some((entry) => entry.file === relPath && lineText.includes(entry.contains))) {
      return;
    }
    const codes = Array.from(lineText, (char) => char.codePointAt(0) ?? 0);
    codes.forEach((code, at) => {
      if (!isCp1252Mojibake(codes, at)) return;
      hits.push({
        line: index + 1,
        column: at + 1,
        id: "MOJIBAKE",
        why: MOJIBAKE_WHY,
        escape: `\\u${code.toString(16).padStart(4, "0")}\\u${codes[at + 1].toString(16).padStart(4, "0")}`,
      });
    });
  });
  let line = 1;
  let column = 1;
  let previous;
  for (const char of text) {
    if (char === "\n") {
      line += 1;
      column = 1;
      previous = undefined;
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
    if (
      code !== undefined &&
      previous !== undefined &&
      isMojibakeLead(previous) &&
      isMojibakeContinuation(code)
    ) {
      hits.push({
        line,
        column: column - 1,
        id: "MOJIBAKE",
        why: MOJIBAKE_WHY,
        escape: `\\u${previous.toString(16).padStart(4, "0")}\\u${code.toString(16).padStart(4, "0")}`,
      });
    }
    previous = code;
    column += 1;
  }
  return hits;
}

export function auditAll(repoRoot = REPO_ROOT) {
  const findings = [];
  for (const file of findScanFiles(repoRoot)) {
    // `latin1` would never fail, but it would also mis-decode every Serbian
    // letter and report nothing useful; these files are UTF-8 by construction.
    const relPath = relative(repoRoot, file).split(sep).join("/");
    for (const hit of scanText(readFileSync(file, "utf8"), relPath)) {
      findings.push({ file: relPath, ...hit });
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
    `check-invisibles: ${findings.length} finding(s) in source.\n` +
      "Each of these renders as nothing, or as a character it is not.\n",
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}:${f.column}  ${f.id} — ${f.why}`);
  }
  console.error("\nWrite the escape instead — \\u00a0, \\u200b — which a reader can see.");
  process.exit(1);
}
