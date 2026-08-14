/**
 * „Tekst i prevod" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, the same rule the rest of `pro/`
 * follows: a maintainer asks „where does the subtitle timing live", and
 * `pro/tekst.ts` answers it where `pro/strings.ts` would not.
 *
 * **These are pure functions and they refuse rather than repair.** No dates, no
 * randomness, no ambient locale, no I/O. Every tool here reads a paste and
 * returns numbers, positions and rewritten text; not one of them returns a word
 * of Serbian. A refusal names the input that made an answer impossible.
 *
 * **Nothing here decides anything.** Where a limit appears — characters per
 * line, characters per second, a minimum gap, a price per page — it is the
 * user's own input with NO default, and what comes back is the measured value
 * beside their number and the plain ratio of the two. „42 characters" is a
 * broadcaster's house rule, not a fact about text, and an embedded default would
 * be this app asserting whose rule applies to a job it has never seen.
 *
 * **Where rounding lives.** A value the catalogue defines as rounded (characters
 * per second „na 2 decimale", the word average, a share of the total) is rounded
 * HERE, because the rounded number is the quantity. A value the catalogue says
 * is rounded only for display (an invoice amount, a page count) is returned
 * exact, because multiplying an already-rounded page count by a price yields
 * different money — 1000 x 2.4006 = 2400.60 where the answer is 2400.56.
 *
 * **Positions are 1-indexed and count CODE POINTS.** A UTF-16 index is off by
 * one per astral character and the user would be looking at the wrong column.
 * CRLF and CR are normalised to LF before anything counts a line, so the same
 * text pasted from two sources cannot produce two answers.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isPositive,
  ratioAgainst,
  roundHalfUp,
  type ProResult,
} from "./result.js";

// ---------------------------------------------------------------------------
// Shared kit — the pieces more than one tool in this pack needs.
// ---------------------------------------------------------------------------

/** The paste ceiling every text field in this pack shares, in code points. */
const MAX_TEXT_CODE_POINTS = 500000;

/** A letter, a combining mark or a decimal digit — one „word character". */
const WORD_CHAR = /[\p{L}\p{M}\p{Nd}]/u;
const LETTER = /\p{L}/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
const DIGIT = /\p{Nd}/u;
const SPACE_CHAR = /\p{White_Space}/u;

/** CRLF and CR both become LF before anything counts a line or a code point. */
function toLf(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

/**
 * Code points, not UTF-16 units.
 *
 * Written as a scan rather than `[...text].length` because the ceiling is half a
 * million characters and the spread allocates an array that size to count it.
 */
function codePointCount(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

/** The one length guard every pasted field uses. */
function textFits(text: string): boolean {
  return codePointCount(text) <= MAX_TEXT_CODE_POINTS;
}

/** A line with no non-white-space code point on it: the paragraph separator. */
function isBlankLine(line: string): boolean {
  return !/[^\p{White_Space}]/u.test(line);
}

/** Blocks of consecutive non-blank lines. Blank runs separate; empty blocks drop. */
function paragraphsOf(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of toLf(text).split("\n")) {
    if (isBlankLine(line)) {
      if (current.length > 0) out.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) out.push(current.join("\n"));
  return out;
}

/**
 * The lexical word token shared by the frequency, sentence and volume tools:
 * letters, marks and digits, with a hyphen or an apostrophe allowed only BETWEEN
 * them — so „crno-beli" and „Đorđe" stay one word and punctuation falls away,
 * while a trailing dash does not glue two words together.
 *
 * **Both apostrophes count, on purpose.** A straight U+0027 and a typographic
 * U+2019 have to split the same text into the same words, or a paste tokenizes
 * one way before Tipografsko čišćenje runs and another way after — the same
 * document would then report two different word counts depending only on when
 * the count was taken.
 */
function lexicalTokens(text: string): string[] {
  return text.match(/[\p{L}\p{M}\p{Nd}]+(?:[-'’][\p{L}\p{M}\p{Nd}]+)*/gu) ?? [];
}

/** The billing convention: maximal runs of anything that is not white space. */
function spacedWordCount(text: string): number {
  let count = 0;
  let inWord = false;
  for (const ch of text) {
    if (SPACE_CHAR.test(ch)) {
      inWord = false;
      continue;
    }
    if (!inWord) count += 1;
    inWord = true;
  }
  return count;
}

/** The code point ending at `index` (UTF-16), as a string. Surrogate-aware. */
function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const unit = text.charCodeAt(index - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) {
    const lead = text.charCodeAt(index - 2);
    if (lead >= 0xd800 && lead <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1];
}

/** The code point starting at `index` (UTF-16), as a string. Surrogate-aware. */
function codePointAtIndex(text: string, index: number): string | undefined {
  if (index < 0 || index >= text.length) return undefined;
  const cp = text.codePointAt(index);
  return cp === undefined ? undefined : String.fromCodePoint(cp);
}

/**
 * Non-overlapping occurrences of `needle`, left to right.
 *
 * Continuing from the END of a match rather than from its start + 1 is the whole
 * definition: „aa" in „aaa" is one occurrence, not two, and the overlapping
 * count is the one that turns a consistent translation into a false alarm.
 * `wholeWord` additionally requires that the code points either side are not
 * word characters; the start and end of the text count as a boundary.
 */
function countOccurrences(needle: string, haystack: string, wholeWord: boolean): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    const before = codePointBefore(haystack, at);
    const after = codePointAtIndex(haystack, at + needle.length);
    const bounded =
      !wholeWord ||
      ((before === undefined || !WORD_CHAR.test(before)) &&
        (after === undefined || !WORD_CHAR.test(after)));
    if (bounded) {
      count += 1;
      from = at + needle.length;
    } else {
      // A rejected match is not a match, so the scan resumes one unit along
      // instead of skipping the whole needle — otherwise „rok" inside „brokat"
      // would hide a real „rok" that started one character later.
      from = at + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// bracket-balance — Zagrade i navodnici
// ---------------------------------------------------------------------------

/**
 * The four bracket pairs are Unicode 16.0 (2024) Code Charts' Bidi_Paired_Bracket
 * property; the four quote pairs are NOT — Bidi_Paired_Bracket covers only
 * `( ) [ ] { }`, and „ " « » ‚ ' ' are the Pi/Pf general categories, a
 * typographic convention rather than a paired-bracket assignment. Both are still
 * Code Charts entries, just not the same property.
 *
 * U+201C and U+2018 appear on BOTH sides on purpose: U+201C closes the Serbian
 * pair that U+201E opened and opens the English pair that U+201D closes.
 */
const BRACKET_PAIRS: readonly (readonly [string, string])[] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["«", "»"],
  ["„", "“"],
  ["“", "”"],
  ["‚", "‘"],
  ["‘", "’"],
];

const OPENER_TO_CLOSER = new Map<string, string>(BRACKET_PAIRS);
const CLOSER_TO_OPENER = new Map<string, string>(
  BRACKET_PAIRS.map(([open, close]) => [close, open] as const),
);

/** A bracket or quote with the place it was written, 1-indexed in code points. */
export interface BracketPosition {
  readonly char: string;
  readonly line: number;
  readonly column: number;
}

export interface UnmatchedCloser extends BracketPosition {
  /** The opener that was on top of the stack, or undefined when it was empty. */
  readonly openOnTop: string | undefined;
}

/** Straight-quote parity for one paragraph. Both counts, so either can be odd. */
export interface QuoteParity {
  /** 1-indexed paragraph number, counting only non-blank blocks. */
  readonly paragraph: number;
  /** 1-indexed line on which the paragraph starts. */
  readonly startLine: number;
  /** U+0022 occurrences. */
  readonly doubleQuotes: number;
  /** U+0027 occurrences, apostrophes inside a word excluded. */
  readonly singleQuotes: number;
}

export interface BracketBalanceInput {
  readonly text: string;
}

export interface BracketBalance {
  /** Openers still on the stack at the end, in the order they were opened. */
  readonly unclosed: readonly BracketPosition[];
  readonly unmatched: readonly UnmatchedCloser[];
  /** Greatest stack height reached; 0 for a text with no bracket at all. */
  readonly maxDepth: number;
  readonly oddQuoteParagraphs: readonly QuoteParity[];
}

/**
 * Which bracket or quote was left open, and where.
 *
 * **An unmatched closer does not pop the stack.** Popping it would eat a
 * perfectly good opener and shift every later report by one, turning a single
 * typo into a page of false findings — so the closer is reported together with
 * whatever was on top, and the stack is left exactly as it was.
 *
 * The two ambiguous quotes resolve off that same stack and need no input from
 * the user: U+201C closes when U+201E is on top and opens otherwise, and U+2018
 * closes when U+201A is on top. That falls out of testing „is this a closer
 * whose opener is on top" BEFORE „is this an opener", which is the order below.
 *
 * Straight U+0022 and U+0027 cannot be stacked at all — their opener and closer
 * are the same character — so they are counted per paragraph instead, and an
 * apostrophe between two letters („ne'š") is not counted, or every paragraph of
 * ordinary speech would be reported.
 */
export function bracketBalance(input: BracketBalanceInput): ProResult<BracketBalance> {
  if (!textFits(input.text)) return fail("text");
  const text = toLf(input.text);
  const chars = [...text];

  const lines = text.split("\n");
  const paragraphOfLine: number[] = [];
  const paragraphStartLine: number[] = [];
  let paragraph = 0;
  for (const [index, line] of lines.entries()) {
    if (isBlankLine(line)) {
      paragraphOfLine.push(0);
      continue;
    }
    if (index === 0 || isBlankLine(lines[index - 1] ?? "")) {
      paragraph += 1;
      paragraphStartLine.push(index + 1);
    }
    paragraphOfLine.push(paragraph);
  }
  const doubles = new Array<number>(paragraph + 1).fill(0);
  const singles = new Array<number>(paragraph + 1).fill(0);

  const stack: BracketPosition[] = [];
  const unmatched: UnmatchedCloser[] = [];
  let maxDepth = 0;
  let line = 1;
  let column = 1;

  for (const [index, char] of chars.entries()) {
    if (char === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    const top = stack[stack.length - 1];
    const opener = CLOSER_TO_OPENER.get(char);
    if (opener !== undefined && top !== undefined && top.char === opener) {
      stack.pop();
    } else if (OPENER_TO_CLOSER.has(char)) {
      stack.push({ char, line, column });
      if (stack.length > maxDepth) maxDepth = stack.length;
    } else if (opener !== undefined) {
      unmatched.push({ char, line, column, openOnTop: top?.char });
    } else if (char === '"' || char === "'") {
      const inParagraph = paragraphOfLine[line - 1] ?? 0;
      const before = chars[index - 1];
      const after = chars[index + 1];
      const inWord =
        char === "'" &&
        before !== undefined &&
        after !== undefined &&
        LETTER.test(before) &&
        LETTER.test(after);
      if (inParagraph > 0 && !inWord) {
        const bucket = char === '"' ? doubles : singles;
        bucket[inParagraph] = (bucket[inParagraph] ?? 0) + 1;
      }
    }
    column += 1;
  }

  const oddQuoteParagraphs: QuoteParity[] = [];
  for (let p = 1; p <= paragraph; p += 1) {
    const doubleQuotes = doubles[p] ?? 0;
    const singleQuotes = singles[p] ?? 0;
    if (doubleQuotes % 2 === 0 && singleQuotes % 2 === 0) continue;
    oddQuoteParagraphs.push({
      paragraph: p,
      startLine: paragraphStartLine[p - 1] ?? 1,
      doubleQuotes,
      singleQuotes,
    });
  }

  return { ok: true, unclosed: stack, unmatched, maxDepth, oddQuoteParagraphs };
}

// ---------------------------------------------------------------------------
// glossary-check — Provera terminologije
// ---------------------------------------------------------------------------

/**
 * What the two occurrence counts are, and nothing more. The tool knows no
 * morphology: it answers „did this exact string appear, and how often".
 */
export type GlossaryStatus = "match" | "differs" | "missing" | "extra" | "absent";

export interface GlossaryRow {
  readonly source: string;
  readonly target: string;
  /** Occurrences of `source` in the original. */
  readonly inOriginal: number;
  /** Occurrences of `target` in the translation. */
  readonly inTranslation: number;
  readonly status: GlossaryStatus;
}

export interface GlossaryCheckInput {
  readonly original: string;
  readonly translation: string;
  /** One pair per line, source and target split by a tab or by `|`. */
  readonly glossary: string;
  readonly caseSensitive: boolean;
  /**
   * Off means substring matching, which is what catches Serbian case endings
   * through the stem — „ugovor" inside „ugovoru". On requires a word boundary.
   */
  readonly wholeWord: boolean;
}

export interface GlossaryCheck {
  readonly rows: readonly GlossaryRow[];
  /** 1-indexed physical line numbers of glossary lines that could not be read. */
  readonly invalidRows: readonly number[];
}

const MAX_GLOSSARY_ROWS = 2000;

/**
 * Every glossary term, counted on both sides.
 *
 * **A row splits on the FIRST tab, and only then on the first `|`** — a target
 * that itself contains a pipe („obveznica | menica") survives, where splitting
 * on every separator would silently truncate it.
 *
 * Case folding is `toLowerCase()` without a locale, which is correct for Serbian
 * and deliberately not `toLocaleLowerCase` — an ambient locale would make the
 * same paste count differently on two machines. Folding can change a string's
 * length in other scripts, which is why this tool reports counts and never
 * positions.
 */
export function glossaryCheck(input: GlossaryCheckInput): ProResult<GlossaryCheck> {
  if (!textFits(input.original)) return fail("original");
  if (!textFits(input.translation)) return fail("translation");
  if (!textFits(input.glossary)) return fail("glossary");

  const lines = toLf(input.glossary).split("\n");
  const meaningful = lines.filter((line) => !isBlankLine(line));
  if (meaningful.length === 0 || meaningful.length > MAX_GLOSSARY_ROWS) return fail("glossary");

  const fold = (value: string): string => (input.caseSensitive ? value : value.toLowerCase());
  const original = fold(toLf(input.original));
  const translation = fold(toLf(input.translation));

  const rows: GlossaryRow[] = [];
  const invalidRows: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (isBlankLine(line)) continue;
    const at = line.includes("\t") ? line.indexOf("\t") : line.indexOf("|");
    if (at < 0) {
      invalidRows.push(index + 1);
      continue;
    }
    const source = line.slice(0, at).replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
    const target = line.slice(at + 1).replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
    if (source.length === 0 || target.length === 0) {
      invalidRows.push(index + 1);
      continue;
    }
    const inOriginal = countOccurrences(fold(source), original, input.wholeWord);
    const inTranslation = countOccurrences(fold(target), translation, input.wholeWord);
    rows.push({ source, target, inOriginal, inTranslation, status: status(inOriginal, inTranslation) });
  }

  return { ok: true, rows, invalidRows };
}

function status(inOriginal: number, inTranslation: number): GlossaryStatus {
  if (inOriginal === 0 && inTranslation === 0) return "absent";
  if (inTranslation === 0) return "missing";
  if (inOriginal === 0) return "extra";
  return inOriginal === inTranslation ? "match" : "differs";
}

// ---------------------------------------------------------------------------
// hidden-characters — Skriveni znakovi
// ---------------------------------------------------------------------------

/** The five families a hidden character can belong to. */
export type HiddenKind = "control" | "space" | "zeroWidth" | "softHyphen" | "bidi";

/**
 * Unicode Standard 16.0 (2024) — Code Charts, general categories Cc/Cf/Zs, and
 * the control-character name aliases from NameAliases.txt. The names are written
 * out because no platform API exposes them; the Stability Policies guarantee
 * that neither a code point's assignment nor its name will ever change, so this
 * table cannot go stale — it can only be extended.
 *
 * U+0009, U+000A and U+000D are deliberately absent: a tab and a line break are
 * ordinary text, not a hidden character.
 */
const HIDDEN_TABLE: readonly (readonly [number, HiddenKind, string])[] = [
  [0x0000, "control", "NULL"],
  [0x0001, "control", "START OF HEADING"],
  [0x0002, "control", "START OF TEXT"],
  [0x0003, "control", "END OF TEXT"],
  [0x0004, "control", "END OF TRANSMISSION"],
  [0x0005, "control", "ENQUIRY"],
  [0x0006, "control", "ACKNOWLEDGE"],
  [0x0007, "control", "ALERT"],
  [0x0008, "control", "BACKSPACE"],
  [0x000b, "control", "LINE TABULATION"],
  [0x000c, "control", "FORM FEED"],
  [0x000e, "control", "SHIFT OUT"],
  [0x000f, "control", "SHIFT IN"],
  [0x0010, "control", "DATA LINK ESCAPE"],
  [0x0011, "control", "DEVICE CONTROL ONE"],
  [0x0012, "control", "DEVICE CONTROL TWO"],
  [0x0013, "control", "DEVICE CONTROL THREE"],
  [0x0014, "control", "DEVICE CONTROL FOUR"],
  [0x0015, "control", "NEGATIVE ACKNOWLEDGE"],
  [0x0016, "control", "SYNCHRONOUS IDLE"],
  [0x0017, "control", "END OF TRANSMISSION BLOCK"],
  [0x0018, "control", "CANCEL"],
  [0x0019, "control", "END OF MEDIUM"],
  [0x001a, "control", "SUBSTITUTE"],
  [0x001b, "control", "ESCAPE"],
  [0x001c, "control", "INFORMATION SEPARATOR FOUR"],
  [0x001d, "control", "INFORMATION SEPARATOR THREE"],
  [0x001e, "control", "INFORMATION SEPARATOR TWO"],
  [0x001f, "control", "INFORMATION SEPARATOR ONE"],
  [0x007f, "control", "DELETE"],
  [0x00a0, "space", "NO-BREAK SPACE"],
  [0x1680, "space", "OGHAM SPACE MARK"],
  [0x2000, "space", "EN QUAD"],
  [0x2001, "space", "EM QUAD"],
  [0x2002, "space", "EN SPACE"],
  [0x2003, "space", "EM SPACE"],
  [0x2004, "space", "THREE-PER-EM SPACE"],
  [0x2005, "space", "FOUR-PER-EM SPACE"],
  [0x2006, "space", "SIX-PER-EM SPACE"],
  [0x2007, "space", "FIGURE SPACE"],
  [0x2008, "space", "PUNCTUATION SPACE"],
  [0x2009, "space", "THIN SPACE"],
  [0x200a, "space", "HAIR SPACE"],
  [0x202f, "space", "NARROW NO-BREAK SPACE"],
  [0x205f, "space", "MEDIUM MATHEMATICAL SPACE"],
  [0x3000, "space", "IDEOGRAPHIC SPACE"],
  [0x200b, "zeroWidth", "ZERO WIDTH SPACE"],
  [0x200c, "zeroWidth", "ZERO WIDTH NON-JOINER"],
  [0x200d, "zeroWidth", "ZERO WIDTH JOINER"],
  [0x2060, "zeroWidth", "WORD JOINER"],
  [0xfeff, "zeroWidth", "ZERO WIDTH NO-BREAK SPACE"],
  [0x00ad, "softHyphen", "SOFT HYPHEN"],
  [0x200e, "bidi", "LEFT-TO-RIGHT MARK"],
  [0x200f, "bidi", "RIGHT-TO-LEFT MARK"],
  [0x202a, "bidi", "LEFT-TO-RIGHT EMBEDDING"],
  [0x202b, "bidi", "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "bidi", "POP DIRECTIONAL FORMATTING"],
  [0x202d, "bidi", "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "bidi", "RIGHT-TO-LEFT OVERRIDE"],
  [0x2066, "bidi", "LEFT-TO-RIGHT ISOLATE"],
  [0x2067, "bidi", "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "bidi", "FIRST STRONG ISOLATE"],
  [0x2069, "bidi", "POP DIRECTIONAL ISOLATE"],
];

const HIDDEN_BY_CODE = new Map<number, { readonly kind: HiddenKind; readonly name: string }>(
  HIDDEN_TABLE.map(([code, kind, name]) => [code, { kind, name }]),
);

const SOFT_HYPHEN = "\u00ad";

/** The scripts the tool distinguishes; everything else is reported as „other". */
export type ScriptName = "Latin" | "Cyrillic" | "Greek" | "Arabic" | "Hebrew" | "Han" | "other";

/**
 * Read from the platform's Unicode tables rather than copied into this file —
 * the Script property is thousands of ranges, and a hand-copied subset would be
 * wrong the day a range is extended.
 */
const SCRIPT_TESTS: readonly (readonly [ScriptName, RegExp])[] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
  ["Han", /\p{Script=Han}/u],
];

const SCRIPT_NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}]/u;

export interface HiddenFinding {
  readonly kind: HiddenKind;
  readonly codePoint: number;
  /** `U+00A0` — the code point written the way the Code Charts write it. */
  readonly label: string;
  readonly name: string;
  readonly line: number;
  readonly column: number;
}

export interface MixedScriptWord {
  readonly word: string;
  readonly scripts: readonly ScriptName[];
  readonly line: number;
  readonly column: number;
}

export interface HiddenCharactersInput {
  readonly text: string;
  /** Delete control, zero-width and bidi code points. See the note on scope. */
  readonly removeInvisible: boolean;
  /**
   * Every code point of kind `space` — NBSP, EM SPACE, IDEOGRAPHIC SPACE and the
   * rest of the table's `space` row — becomes U+0020, one for one.
   */
  readonly normalizeSpaces: boolean;
  readonly removeSoftHyphen: boolean;
}

export interface HiddenCharacters {
  readonly findings: readonly HiddenFinding[];
  readonly countByKind: Readonly<Record<HiddenKind, number>>;
  readonly mixedScriptWords: readonly MixedScriptWord[];
  readonly cleaned: string;
  readonly codePointsBefore: number;
  readonly codePointsAfter: number;
}

/**
 * Every invisible code point with its Unicode name and position, and every word
 * that mixes two scripts.
 *
 * **A mixed-script word is never repaired.** „Сrno" with a Cyrillic С looks
 * exactly like „Crno" and breaks every search and every sort in the document —
 * but which letter the author meant is a guess, and a guess applied silently to
 * someone's text is worse than the defect. The tool reports the place.
 *
 * **What „remove invisible" removes, and why it stops where it does.** It
 * deletes the code points that occupy no width at all: controls, zero-width
 * characters and the bidi overrides. It does NOT delete the unusual spaces —
 * deleting an EM SPACE glues two words into one, which is a new defect rather
 * than a cleanup, so every code point of kind `space` (NBSP included) answers
 * instead to `normalizeSpaces`, which replaces it with U+0020 rather than
 * deleting it. The soft hyphen answers only to `removeSoftHyphen`; both switches
 * are independent of `removeInvisible`, and every hidden code point is still
 * reported exactly once, under its own kind, whether or not it is cleaned.
 */
export function hiddenCharacters(input: HiddenCharactersInput): ProResult<HiddenCharacters> {
  if (!textFits(input.text)) return fail("text");
  const text = toLf(input.text);

  const findings: HiddenFinding[] = [];
  const countByKind: Record<HiddenKind, number> = {
    control: 0,
    space: 0,
    zeroWidth: 0,
    softHyphen: 0,
    bidi: 0,
  };
  const mixedScriptWords: MixedScriptWord[] = [];
  const cleaned: string[] = [];

  let line = 1;
  let column = 1;
  let word = "";
  let wordLine = 1;
  let wordColumn = 1;
  let wordScripts = new Set<ScriptName>();

  const flushWord = (): void => {
    if (word.length > 0 && wordScripts.size >= 2) {
      mixedScriptWords.push({
        word,
        scripts: [...wordScripts],
        line: wordLine,
        column: wordColumn,
      });
    }
    word = "";
    wordScripts = new Set<ScriptName>();
  };

  for (const char of text) {
    if (char === "\n") {
      flushWord();
      cleaned.push(char);
      line += 1;
      column = 1;
      continue;
    }

    const code = char.codePointAt(0) ?? 0;
    const hidden = HIDDEN_BY_CODE.get(code);
    if (hidden !== undefined) {
      findings.push({
        kind: hidden.kind,
        codePoint: code,
        label: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
        name: hidden.name,
        line,
        column,
      });
      countByKind[hidden.kind] += 1;
    }

    if (WORD_CHAR.test(char)) {
      if (word.length === 0) {
        wordLine = line;
        wordColumn = column;
      }
      word += char;
      if (!SCRIPT_NEUTRAL.test(char)) {
        const match = SCRIPT_TESTS.find(([, test]) => test.test(char));
        wordScripts.add(match?.[0] ?? "other");
      }
    } else {
      flushWord();
    }

    if (hidden !== undefined && hidden.kind === "space") {
      cleaned.push(input.normalizeSpaces ? " " : char);
    } else if (char === SOFT_HYPHEN) {
      if (!input.removeSoftHyphen) cleaned.push(char);
    } else if (
      input.removeInvisible &&
      hidden !== undefined &&
      (hidden.kind === "control" || hidden.kind === "zeroWidth" || hidden.kind === "bidi")
    ) {
      // Removed: no replacement, because none of these occupied any width.
    } else {
      cleaned.push(char);
    }

    column += 1;
  }
  flushWord();

  const result = cleaned.join("");
  return {
    ok: true,
    findings,
    countByKind,
    mixedScriptWords,
    cleaned: result,
    codePointsBefore: codePointCount(text),
    codePointsAfter: codePointCount(result),
  };
}

// ---------------------------------------------------------------------------
// isbn-issn-check — ISBN i ISSN
// ---------------------------------------------------------------------------

/**
 * The number families this tool knows. `auto` asks it to decide from the length
 * and the prefix; anything else forces the reading and refuses when it does not
 * fit, rather than quietly checking a different arithmetic.
 *
 * `issn13` is a 13-digit number prefixed `977` — an ISSN reprinted as an EAN-13
 * barcode with two extra digits (issue or price) before its own GS1 check digit.
 * It is named separately from `ean13` because it recovers an `issn8`.
 *
 * There is no `ean8`. An 8-digit number is always read as an ISSN; a genuine
 * EAN-8 uses a different check-digit weighting (3,1,3,1… mod 10) and would need
 * its own kind rather than silently sharing this one's arithmetic.
 */
export type IsbnKind = "isbn10" | "isbn13" | "issn" | "issn13" | "ismn" | "ean13";

export interface IsbnCheckInput {
  /** As typed: hyphens, spaces and a trailing X or x are all accepted. */
  readonly number: string;
  readonly kind: IsbnKind | "auto";
}

export interface IsbnCheck {
  readonly kind: IsbnKind;
  /** The cleaned digits, X uppercased. */
  readonly digits: string;
  readonly checkDigit: string;
  readonly expectedCheckDigit: string;
  /** Whether the written check digit equals the computed one. Arithmetic only:
   *  it says nothing about whether the number was ever assigned to a book. */
  readonly checkDigitMatches: boolean;
  /** ISBN-13 form of an ISBN-10, or undefined when there is no conversion. */
  readonly isbn13: string | undefined;
  /** ISBN-10 form of a 978-prefixed ISBN-13; 979 has no ISBN-10 at all. */
  readonly isbn10: string | undefined;
  /**
   * The 8-digit ISSN recovered from a `977`-prefixed 13-digit number: digits
   * 4–10 plus a freshly computed ISSN check digit. Digits 11–12 of the 13-digit
   * number are an issue or price code, never part of the ISSN, so they are
   * dropped rather than carried into this field.
   */
  readonly issn8: string | undefined;
}

/**
 * The check digit of an ISBN, ISSN, ISMN or EAN-13, and the conversion between
 * the two ISBN lengths.
 *
 * ISO 2108:2017 (ISBN), ISO 3297:2022 (ISSN) and ISO 10957:2009 (ISMN) — no
 * edition of the GS1 General Specifications is cited here, because none was
 * ever named, and the modulo-10 arithmetic those three already define is the
 * same arithmetic GS1 barcodes use. The arithmetic is frozen by construction:
 * revising it would invalidate every number ever printed.
 *
 * **No hyphens are inserted, on purpose.** Where the hyphens fall depends on the
 * registration-group ranges the International ISBN Agency assigns and changes —
 * a table somebody would have to maintain, and a stale copy would print a wrong
 * hyphenation with total confidence. The check digit does not depend on them.
 *
 * The conversion is offered even when the check digit disagrees, because it is a
 * restatement of the digits that were typed and the disagreement is reported in
 * the same answer. The same holds for `issn8`, recovered from a 977-prefixed
 * `issn13`.
 */
export function isbnCheck(input: IsbnCheckInput): ProResult<IsbnCheck> {
  if (!textFits(input.number)) return fail("number");
  const cleaned = [...input.number].filter((ch) => /[0-9Xx]/u.test(ch)).join("").toUpperCase();
  if (cleaned.length === 0) return fail("number");

  const xAt = cleaned.indexOf("X");
  if (xAt >= 0 && xAt !== cleaned.length - 1) return fail("number");

  // A forced `kind` is checked against its OWN required length before the
  // general detector ever runs. `detectIsbnKind` only recognises lengths 8, 10
  // and 13 and refuses everything else as "number" — which is the right
  // refusal for `auto`, where no reading was named, but the wrong one for a
  // forced kind: an 11-digit number forced to isbn13 is a length that does not
  // fit the CHOSEN kind, not a number the tool cannot read at all, and the two
  // refusals must not both blame "number" depending on whether some other
  // kind's length happens to match.
  let kind: IsbnKind;
  if (input.kind === "auto") {
    const detected = detectIsbnKind(cleaned);
    if (detected === undefined) return fail("number");
    kind = detected;
  } else {
    if (!lengthFits(input.kind, cleaned)) return fail("kind");
    kind = input.kind;
  }
  if (xAt >= 0 && kind !== "isbn10" && kind !== "issn") return fail("number");

  const values = [...cleaned].map((ch) => (ch === "X" ? 10 : Number(ch)));
  const checkDigit = cleaned.slice(-1);
  const expected = kind === "isbn10" ? isbn10Check(values) : kind === "issn" ? issnCheck(values) : gs1Check(values);
  const expectedCheckDigit = expected === 10 ? "X" : String(expected);

  const body = kind === "isbn10" ? cleaned.slice(0, 9) : undefined;
  const isbn13 = body === undefined ? undefined : `978${body}${gs1Check([...`978${body}`].map(Number))}`;
  const isbn10Body = kind === "isbn13" && cleaned.startsWith("978") ? cleaned.slice(3, 12) : undefined;
  const isbn10 =
    isbn10Body === undefined
      ? undefined
      : `${isbn10Body}${isbn10CheckDigit([...isbn10Body].map(Number))}`;
  // Digits 4..10 (1-indexed) of the 13-digit number, i.e. slice(3, 10): the
  // ISSN's own seven digits, stripped of the 977 prefix and of the two-digit
  // issue/price code that follows them.
  const issn8Body = kind === "issn13" ? cleaned.slice(3, 10) : undefined;
  const issn8 =
    issn8Body === undefined
      ? undefined
      : `${issn8Body}${issnCheckDigit([...issn8Body].map(Number))}`;

  return {
    ok: true,
    kind,
    digits: cleaned,
    checkDigit,
    expectedCheckDigit,
    checkDigitMatches: checkDigit === expectedCheckDigit,
    isbn13,
    isbn10,
    issn8,
  };
}

/** Length and prefix decide, in that order; every other length is refused. */
function detectIsbnKind(digits: string): IsbnKind | undefined {
  if (digits.length === 8) return "issn";
  if (digits.length === 10) return "isbn10";
  if (digits.length !== 13) return undefined;
  if (digits.startsWith("9790")) return "ismn";
  if (digits.startsWith("978") || digits.startsWith("979")) return "isbn13";
  if (digits.startsWith("977")) return "issn13";
  return "ean13";
}

function lengthFits(kind: IsbnKind, digits: string): boolean {
  if (kind === "issn") return digits.length === 8;
  if (kind === "isbn10") return digits.length === 10;
  return digits.length === 13;
}

/** Sum of d_i x (11 - i) over all ten digits; the number checks when it is 0 mod 11. */
function isbn10Sum(values: readonly number[]): number {
  return values.reduce((sum, value, index) => sum + value * (11 - (index + 1)), 0);
}

function isbn10Check(values: readonly number[]): number {
  return isbn10Sum(values) % 11 === 0 ? (values[9] ?? 0) : isbn10CheckValue(values.slice(0, 9));
}

/** The check digit implied by the first nine digits, as a value (10 means X). */
function isbn10CheckValue(body: readonly number[]): number {
  const sum = body.reduce((total, value, index) => total + value * (10 - index), 0);
  return (11 - (sum % 11)) % 11;
}

function isbn10CheckDigit(body: readonly number[]): string {
  const value = isbn10CheckValue(body);
  return value === 10 ? "X" : String(value);
}

/** GS1 modulo 10: weights 1 and 3 alternating over the first twelve digits. */
function gs1Check(values: readonly number[]): number {
  const sum = values
    .slice(0, 12)
    .reduce((total, value, index) => total + value * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/** ISSN: weights 8..2 over the first seven digits, modulo 11, 10 written as X. */
function issnCheck(values: readonly number[]): number {
  const sum = values.slice(0, 7).reduce((total, value, index) => total + value * (8 - index), 0);
  return (11 - (sum % 11)) % 11;
}

/** `issnCheck`, written as the digit — X for 10 — rather than as a value. */
function issnCheckDigit(values: readonly number[]): string {
  const value = issnCheck(values);
  return value === 10 ? "X" : String(value);
}

// ---------------------------------------------------------------------------
// mojibake-repair — Popravka kodiranja
// ---------------------------------------------------------------------------

/**
 * The five labels the tool offers. `iso-8859-1` is here because people choose it
 * by name; the WHATWG Encoding Standard resolves that label to `windows-1252`,
 * and the result says so rather than pretending the two are different.
 */
export type MojibakeEncoding =
  | "utf-8"
  | "windows-1250"
  | "windows-1252"
  | "iso-8859-1"
  | "iso-8859-2";

interface ByteMaps {
  readonly byteToChar: readonly (string | undefined)[];
  readonly charToByte: ReadonlyMap<string, number>;
  /** Bytes dropped from the inverse map because a smaller byte held the char. */
  readonly collisions: readonly number[];
  readonly encoding: string;
}

/**
 * Built from the platform at first use, never written out as data: 256 single-
 * byte decodes per encoding produce the byte to character map and its inverse.
 * A hand-copied index table is four hundred lines that can disagree with the
 * decoder the same program uses one function later.
 *
 * The cache is memoisation of a deterministic computation, not state: the same
 * label always yields the same table.
 */
const SINGLE_BYTE_CACHE = new Map<string, ByteMaps>();

function singleByteMaps(label: string): ByteMaps | undefined {
  const cached = SINGLE_BYTE_CACHE.get(label);
  if (cached !== undefined) return cached;
  // `TextDecoder` is a global VALUE here (no `lib.dom` and no `@types/node`
  // type-only export at this scope), so the type position needs the instance
  // type rather than the bare name — `tsc` reads the bare name as the value
  // and refuses it as a type.
  let decoder: InstanceType<typeof TextDecoder>;
  try {
    decoder = new TextDecoder(label, { fatal: true });
  } catch {
    return undefined;
  }
  const byteToChar: (string | undefined)[] = [];
  const charToByte = new Map<string, number>();
  const collisions: number[] = [];
  for (let byte = 0; byte <= 0xff; byte += 1) {
    let char: string | undefined;
    try {
      char = decoder.decode(Uint8Array.of(byte));
    } catch {
      char = undefined;
    }
    byteToChar[byte] = char;
    if (char === undefined) continue;
    if (charToByte.has(char)) {
      collisions.push(byte);
      continue;
    }
    charToByte.set(char, byte);
  }
  const maps: ByteMaps = { byteToChar, charToByte, collisions, encoding: decoder.encoding };
  SINGLE_BYTE_CACHE.set(label, maps);
  return maps;
}

/** RFC 3629: 1 to 4 bytes, leads 0xC2..0xF4, continuations 0x80..0xBF. */
function utf8Encode(codePoint: number, out: number[]): void {
  if (codePoint <= 0x7f) {
    out.push(codePoint);
  } else if (codePoint <= 0x7ff) {
    out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
  } else if (codePoint <= 0xffff) {
    out.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  } else {
    out.push(
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
}

/**
 * A UTF-8 decode that reports WHERE it failed.
 *
 * `TextDecoder(…, { fatal: true })` throws on the first bad byte and names no
 * position, and the non-fatal decoder replaces silently — neither can answer
 * „which bytes are wrong". On a failure the scan records the byte and advances
 * one, so a truncated three-byte sequence is reported as the three bytes it is.
 */
function utf8Decode(bytes: readonly number[]): {
  readonly text: string;
  readonly invalid: readonly { readonly index: number; readonly byte: number }[];
} {
  const parts: string[] = [];
  const invalid: { index: number; byte: number }[] = [];
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i] ?? 0;
    if (lead <= 0x7f) {
      parts.push(String.fromCharCode(lead));
      i += 1;
      continue;
    }
    // No initialisers: every branch below either assigns all three or
    // `continue`s, and a zero default would silently mean „1-byte sequence,
    // minimum 0" for any lead byte a future branch forgot to handle.
    let need: number;
    let min: number;
    let value: number;
    if (lead >= 0xc2 && lead <= 0xdf) {
      need = 1;
      min = 0x80;
      value = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      need = 2;
      min = 0x800;
      value = lead & 0x0f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      need = 3;
      min = 0x10000;
      value = lead & 0x07;
    } else {
      invalid.push({ index: i, byte: lead });
      i += 1;
      continue;
    }
    let broken = false;
    for (let k = 1; k <= need; k += 1) {
      const next = bytes[i + k];
      if (next === undefined || next < 0x80 || next > 0xbf) {
        broken = true;
        break;
      }
      value = (value << 6) | (next & 0x3f);
    }
    if (broken || value < min || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
      invalid.push({ index: i, byte: lead });
      i += 1;
      continue;
    }
    parts.push(String.fromCodePoint(value));
    i += need + 1;
  }
  return { text: parts.join(""), invalid };
}

/** How many failures the result carries as examples; the counts stay exact. */
const MOJIBAKE_SAMPLES = 20;

export interface MojibakeInput {
  readonly text: string;
  /** The encoding the bytes were WRITTEN in — the answer decodes with this. */
  readonly writtenAs: MojibakeEncoding;
  /** The encoding they were READ with — the damage; the answer undoes this. */
  readonly readAs: MojibakeEncoding;
}

export interface MojibakeRepair {
  /** The repaired text, or undefined when a step failed — never a half result. */
  readonly repaired: string | undefined;
  readonly unmappableCount: number;
  readonly unmappable: readonly { readonly index: number; readonly char: string }[];
  readonly invalidByteCount: number;
  readonly invalidBytes: readonly { readonly index: number; readonly byte: number }[];
  /** What the labels actually resolved to — `iso-8859-1` becomes windows-1252. */
  readonly resolvedWrittenAs: string;
  readonly resolvedReadAs: string;
  /** Bytes whose character was already claimed by a smaller byte. Normally empty. */
  readonly collisions: readonly number[];
}

/**
 * Undo the damage of writing bytes in one encoding and reading them in another.
 *
 * The path is exactly the reverse of the damage: every character on screen goes
 * back to the byte the READING encoding would have produced for it, and that
 * byte string is decoded again with the WRITING encoding.
 *
 * **Both steps can fail, and neither failure is repaired.** A character with no
 * byte in the reading encoding means the reading encoding is not the one that
 * did the damage — the tool reports which characters and changes nothing rather
 * than dropping them. Bytes that do not form a valid sequence in the writing
 * encoding mean the same about the other choice.
 *
 * **U+FFFD in the input is refused before any arithmetic.** Text written in a
 * single-byte encoding and read as UTF-8 has already lost the bytes: the
 * platform replaced each invalid one with U+FFFD, and no computation brings
 * them back. Saying so immediately is the honest answer.
 */
export function mojibakeRepair(input: MojibakeInput): ProResult<MojibakeRepair> {
  if (!textFits(input.text)) return fail("text");
  if (input.text.includes("�")) return fail("replacementCharacter");

  const readMaps = input.readAs === "utf-8" ? undefined : singleByteMaps(input.readAs);
  if (input.readAs !== "utf-8" && readMaps === undefined) return fail("readAs");
  const writeMaps = input.writtenAs === "utf-8" ? undefined : singleByteMaps(input.writtenAs);
  if (input.writtenAs !== "utf-8" && writeMaps === undefined) return fail("writtenAs");

  const bytes: number[] = [];
  const unmappable: { index: number; char: string }[] = [];
  let index = 0;
  for (const char of input.text) {
    const code = char.codePointAt(0) ?? 0;
    if (readMaps === undefined) {
      // Y is UTF-8, where every scalar value has an encoding; only an unpaired
      // surrogate has none, and substituting one silently is what corrupts text.
      if (code >= 0xd800 && code <= 0xdfff) unmappable.push({ index, char });
      else utf8Encode(code, bytes);
    } else {
      const byte = readMaps.charToByte.get(char);
      if (byte === undefined) unmappable.push({ index, char });
      else bytes.push(byte);
    }
    index += 1;
  }

  const resolvedReadAs = readMaps?.encoding ?? "utf-8";
  const resolvedWrittenAs = writeMaps?.encoding ?? "utf-8";
  const collisions = [...(readMaps?.collisions ?? []), ...(writeMaps?.collisions ?? [])];

  if (unmappable.length > 0) {
    return {
      ok: true,
      repaired: undefined,
      unmappableCount: unmappable.length,
      unmappable: unmappable.slice(0, MOJIBAKE_SAMPLES),
      invalidByteCount: 0,
      invalidBytes: [],
      resolvedWrittenAs,
      resolvedReadAs,
      collisions,
    };
  }

  let text: string;
  let invalid: readonly { readonly index: number; readonly byte: number }[];
  if (writeMaps === undefined) {
    const decoded = utf8Decode(bytes);
    text = decoded.text;
    invalid = decoded.invalid;
  } else {
    const parts: string[] = [];
    const bad: { index: number; byte: number }[] = [];
    for (const [at, byte] of bytes.entries()) {
      const char = writeMaps.byteToChar[byte];
      if (char === undefined) bad.push({ index: at, byte });
      else parts.push(char);
    }
    text = parts.join("");
    invalid = bad;
  }

  return {
    ok: true,
    repaired: invalid.length > 0 ? undefined : text,
    unmappableCount: 0,
    unmappable: [],
    invalidByteCount: invalid.length,
    invalidBytes: invalid.slice(0, MOJIBAKE_SAMPLES),
    resolvedWrittenAs,
    resolvedReadAs,
    collisions,
  };
}

// ---------------------------------------------------------------------------
// number-check — Provera brojeva
// ---------------------------------------------------------------------------

export interface NumberRow {
  /** Every \d of the token in order, separators dropped — the comparison key. */
  readonly digits: string;
  /** Distinct raw forms met on that side, in order of first appearance. */
  readonly formsInOriginal: readonly string[];
  readonly formsInTranslation: readonly string[];
  readonly count: number;
}

export interface NumberCheckInput {
  readonly original: string;
  readonly translation: string;
}

export interface NumberCheck {
  readonly paired: readonly NumberRow[];
  readonly onlyInOriginal: readonly NumberRow[];
  readonly onlyInTranslation: readonly NumberRow[];
  /**
   * Rows from `paired` whose raw forms are not all the same length on both
   * sides — „1,5" against „15" both reduce to the digit string „15" and pair,
   * but one is three code points and the other two, which is the trace a
   * dropped decimal separator leaves. A typographic difference such as
   * „1.500,00" against „1,500.00" does NOT appear here: both are nine code
   * points, because a thousands separator is one mark either way.
   */
  readonly differentLength: readonly NumberRow[];
  /** Occurrences, not rows: three counts that add up to every number met. */
  readonly pairedCount: number;
  readonly onlyInOriginalCount: number;
  readonly onlyInTranslationCount: number;
}

/**
 * Every number in the original against every number in the translation.
 *
 * **Comparison is on the digit string alone.** „1.500,00" and „1,500.00" reduce
 * to 150000 and pair, so a difference of typographic convention raises nothing —
 * while 12.345 against 12.354 does not pair, which is the transposition the tool
 * exists to catch. Guessing which separator is decimal would turn „1,000" into
 * either 1000 or 1.0 and invent an answer either way.
 *
 * **The digit string alone is not quite enough, and `differentLength` is the
 * correction.** „1,5" and „15" reduce to the same digits and would otherwise
 * report as a clean match, which is exactly how a translation that silently
 * dropped a decimal comma passes the check. The raw forms are already carried
 * on every row; this view is the same rows filtered to where their lengths
 * disagree, not a second pass over the text.
 *
 * Leading zeros are kept: 007 is not 7 in a case number or an account.
 */
export function numberCheck(input: NumberCheckInput): ProResult<NumberCheck> {
  if (!textFits(input.original)) return fail("original");
  if (!textFits(input.translation)) return fail("translation");

  const left = numberTokens(toLf(input.original));
  const right = numberTokens(toLf(input.translation));

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const token of [...left, ...right]) {
    if (seen.has(token.digits)) continue;
    seen.add(token.digits);
    keys.push(token.digits);
  }

  const paired: NumberRow[] = [];
  const differentLength: NumberRow[] = [];
  const onlyInOriginal: NumberRow[] = [];
  const onlyInTranslation: NumberRow[] = [];
  let pairedCount = 0;
  let onlyInOriginalCount = 0;
  let onlyInTranslationCount = 0;

  for (const digits of keys) {
    const leftForms = distinctForms(left, digits);
    const rightForms = distinctForms(right, digits);
    const leftCount = left.filter((token) => token.digits === digits).length;
    const rightCount = right.filter((token) => token.digits === digits).length;
    const shared = Math.min(leftCount, rightCount);
    if (shared > 0) {
      const row = { digits, formsInOriginal: leftForms, formsInTranslation: rightForms, count: shared };
      paired.push(row);
      pairedCount += shared;
      // A separator that changes the raw length (a dropped or added comma) is
      // exactly the case the digit-only key cannot see on its own; a separator
      // that merely looks different (comma vs dot as the thousands mark) does
      // not change the length and stays silent here.
      const leftLengths = new Set(leftForms.map((form) => form.length));
      const rightLengths = new Set(rightForms.map((form) => form.length));
      const noCommonLength = [...leftLengths].every((len) => !rightLengths.has(len));
      if (noCommonLength) differentLength.push(row);
    }
    if (leftCount > rightCount) {
      const count = leftCount - rightCount;
      onlyInOriginal.push({ digits, formsInOriginal: leftForms, formsInTranslation: rightForms, count });
      onlyInOriginalCount += count;
    }
    if (rightCount > leftCount) {
      const count = rightCount - leftCount;
      onlyInTranslation.push({ digits, formsInOriginal: leftForms, formsInTranslation: rightForms, count });
      onlyInTranslationCount += count;
    }
  }

  return {
    ok: true,
    paired,
    differentLength,
    onlyInOriginal,
    onlyInTranslation,
    pairedCount,
    onlyInOriginalCount,
    onlyInTranslationCount,
  };
}

interface NumberToken {
  readonly raw: string;
  readonly digits: string;
}

/** A run of digits that may continue through one separator at a time. */
function numberTokens(text: string): NumberToken[] {
  const raw = text.match(/\d+(?:[.,\u00a0\u202f ']\d+)*/gu) ?? [];
  return raw.map((token) => ({ raw: token, digits: [...token].filter((ch) => /\d/u.test(ch)).join("") }));
}

function distinctForms(tokens: readonly NumberToken[], digits: string): string[] {
  const forms: string[] = [];
  for (const token of tokens) {
    if (token.digits !== digits || forms.includes(token.raw)) continue;
    forms.push(token.raw);
  }
  return forms;
}

// ---------------------------------------------------------------------------
// number-to-serbian-words — Broj slovima
// ---------------------------------------------------------------------------

/**
 * Pravopis srpskoga jezika, Matica srpska (izmenjeno i dopunjeno izdanje, 2010)
 * — the numeral words and their agreement with the powers of a thousand.
 */
const UNITS_MASCULINE = [
  "nula",
  "jedan",
  "dva",
  "tri",
  "četiri",
  "pet",
  "šest",
  "sedam",
  "osam",
  "devet",
];
const UNITS_FEMININE = [
  "nula",
  "jedna",
  "dve",
  "tri",
  "četiri",
  "pet",
  "šest",
  "sedam",
  "osam",
  "devet",
];
const TEN_TO_NINETEEN = [
  "deset",
  "jedanaest",
  "dvanaest",
  "trinaest",
  "četrnaest",
  "petnaest",
  "šesnaest",
  "sedamnaest",
  "osamnaest",
  "devetnaest",
];
const TENS = [
  "",
  "",
  "dvadeset",
  "trideset",
  "četrdeset",
  "pedeset",
  "šezdeset",
  "sedamdeset",
  "osamdeset",
  "devedeset",
];
const HUNDREDS = [
  "",
  "sto",
  "dvesta",
  "trista",
  "četiristo",
  "petsto",
  "šeststo",
  "sedamsto",
  "osamsto",
  "devetsto",
];

interface Scale {
  /** g mod 10 = 1 (and not 11): „jedna hiljada", „jedan milion". */
  readonly singular: string;
  /** g mod 10 in 2..4 (and not 12..14): „dve hiljade", „dva miliona". */
  readonly paucal: string;
  /** Everything else, including 11..14: „pet hiljada", „dvanaest hiljada". */
  readonly plural: string;
  /** Serbian uses the long scale, and the gender of the power drives „jedan/jedna". */
  readonly feminine: boolean;
}

/** Index 0 is 10^3; the eighteen-digit ceiling on the whole part is what makes
 *  index 4 (bilijarda, 10^15) reachable at all. */
const SCALES: readonly Scale[] = [
  { singular: "hiljada", paucal: "hiljade", plural: "hiljada", feminine: true },
  { singular: "milion", paucal: "miliona", plural: "miliona", feminine: false },
  { singular: "milijarda", paucal: "milijarde", plural: "milijardi", feminine: true },
  { singular: "bilion", paucal: "biliona", plural: "biliona", feminine: false },
  { singular: "bilijarda", paucal: "bilijarde", plural: "bilijardi", feminine: true },
];

/** Both are correct Serbian in a contract, so the tool asks instead of choosing. */
export type ThousandForm = "hiljadu" | "jednaHiljada";

/** What to do with the digits after the separator. */
export type DecimalsMode = "fraction" | "words" | "none";

export interface NumberWordsInput {
  /**
   * The number AS TYPED, e.g. „-1234,56". A string and not a number because the
   * fraction rule quotes the digits the user wrote — a double cannot tell „1,50"
   * from „1,5", and the denominator 10^d depends on exactly that; a double could
   * also not hold 18 digits of an integer part exactly (2^53 ≈ 9.007e15).
   *
   * **The decimal separator is the comma alone.** A period, a plain space, a
   * NBSP or a NNBSP inside the whole part is refused rather than read as a
   * thousands mark — „1.500" means one thousand five hundred in Serbian, not
   * 1,5, and guessing which reading the user meant would answer a different
   * number than the one they typed.
   */
  readonly value: string;
  readonly script: "latin" | "cyrillic";
  readonly thousandForm: ThousandForm;
  readonly decimals: DecimalsMode;
}

export interface NumberWords {
  readonly text: string;
  /** True when „none" dropped a non-empty fraction — cut off, never rounded. */
  readonly decimalsTruncated: boolean;
}

/**
 * A number written out in Serbian words.
 *
 * **The agreement rule that breaks naive implementations is 112000.** The group
 * is 112, and 112 mod 100 = 12 falls in 11..14, so the power takes the second
 * plural („sto dvanaest hiljada"). Reading only the last digit would produce the
 * paucal „hiljade" and be wrong.
 *
 * Exactly one thousand with nothing above it is the other trap: „hiljadu" and
 * „jedna hiljada" are both correct, so the caller says which, and the tool never
 * picks. A group of zero is skipped entirely — 2 000 000 is „dva miliona", not
 * „dva miliona nula hiljada nula".
 */
export function numberToSerbianWords(input: NumberWordsInput): ProResult<NumberWords> {
  const trimmed = input.value.trim();
  // Comma only: a period, a space or any non-breaking space in the whole part
  // fails this match rather than being read as a thousands separator, because
  // "." means the decimal point in some locales and a thousands mark in
  // Serbian, and a tool that guessed would sometimes guess wrong silently.
  const match = /^([+-]?)(\d{1,18})(?:,(\d{1,6}))?$/u.exec(trimmed);
  if (match === null) return fail("value");
  const sign = match[1] ?? "";
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";

  const groups: number[] = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groups.push(Number(whole.slice(Math.max(0, end - 3), end)));
  }
  let highest = -1;
  for (const [index, group] of groups.entries()) if (group !== 0) highest = index;
  if (highest >= SCALES.length + 1) return fail("value");

  const words: string[] = [];
  for (let index = highest; index >= 0; index -= 1) {
    const group = groups[index] ?? 0;
    if (group === 0) continue;
    if (index === 0) {
      words.push(...groupWords(group, false));
      continue;
    }
    const scale = SCALES[index - 1];
    if (scale === undefined) return fail("value");
    if (index === 1 && index === highest && group === 1) {
      words.push(...(input.thousandForm === "hiljadu" ? ["hiljadu"] : ["jedna", "hiljada"]));
      continue;
    }
    words.push(...groupWords(group, scale.feminine), scaleWord(group, scale));
  }
  if (words.length === 0) words.push("nula");

  const fractionSpoken = input.decimals !== "none" && /[1-9]/u.test(fraction);
  const wholeSpoken = highest >= 0;
  // „minus nula" is not a number anyone writes: the sign is spoken only when
  // something non-zero is actually said after it.
  if (sign === "-" && (wholeSpoken || fractionSpoken)) words.unshift("minus");

  if (fraction.length > 0 && input.decimals === "fraction") {
    words.push("i", `${fraction}/${10 ** fraction.length}`);
  }
  if (fraction.length > 0 && input.decimals === "words") {
    words.push("zapeta", ...[...fraction].map((digit) => UNITS_MASCULINE[Number(digit)] ?? ""));
  }

  const latin = words.join(" ");
  return {
    ok: true,
    text: input.script === "cyrillic" ? latinToCyrillic(latin).text : latin,
    decimalsTruncated: input.decimals === "none" && fraction.length > 0,
  };
}

/** Hundreds, then tens, then units — with 11..19 read from the table as a whole. */
function groupWords(group: number, feminine: boolean): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(group / 100);
  const rest = group % 100;
  if (hundreds > 0) words.push(HUNDREDS[hundreds] ?? "");
  if (rest >= 10 && rest <= 19) {
    words.push(TEN_TO_NINETEEN[rest - 10] ?? "");
    return words;
  }
  const tens = Math.floor(rest / 10);
  if (tens >= 2) words.push(TENS[tens] ?? "");
  const units = rest % 10;
  if (units > 0) words.push((feminine ? UNITS_FEMININE : UNITS_MASCULINE)[units] ?? "");
  return words;
}

function scaleWord(group: number, scale: Scale): string {
  const mod100 = group % 100;
  if (mod100 >= 11 && mod100 <= 14) return scale.plural;
  const mod10 = group % 10;
  if (mod10 === 1) return scale.singular;
  if (mod10 >= 2 && mod10 <= 4) return scale.paucal;
  return scale.plural;
}

// ---------------------------------------------------------------------------
// reading-time — Trajanje čitanja
// ---------------------------------------------------------------------------

/** Sexagesimal time: 60 seconds in a minute, 60 minutes in an hour. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

export interface ReadingParagraph {
  readonly index: number;
  readonly words: number;
  /** Exact, unrounded seconds — the number the running total is built from. */
  readonly seconds: number;
  /** Rounded half up: what the duration column shows. */
  readonly displaySeconds: number;
  readonly clock: string;
  readonly entrySeconds: number;
  /** Floored: the moment reading STARTS must be earlier, never later. */
  readonly entryDisplaySeconds: number;
  readonly entryClock: string;
}

export interface ReadingTimeInput {
  readonly text: string;
  /** Words per minute. The speaker's own measurement — nothing is assumed. */
  readonly pace: number;
  /** Seconds between paragraphs. */
  readonly pause: number;
}

export interface ReadingTime {
  readonly paragraphs: readonly ReadingParagraph[];
  readonly words: number;
  readonly totalSeconds: number;
  readonly totalDisplaySeconds: number;
  readonly totalClock: string;
  /** Sum of the SHOWN durations; may differ from the shown total by a second. */
  readonly displayedSumSeconds: number;
}

/**
 * How long a text takes to read aloud at a pace the user measured.
 *
 * **No pace is built in.** „150 words per minute" is somebody else's estimate of
 * somebody else's speaker; the field stays empty until this speaker is measured,
 * and a pace of zero is refused rather than divided by.
 *
 * **Entry times floor, durations round.** The entry is the instant a paragraph
 * starts being read and must land early rather than late; a duration is a
 * measurement and rounds to nearest. The two rules together mean the shown
 * durations need not sum to the shown total — both numbers are returned so the
 * surface can say so instead of hiding the difference.
 */
export function readingTime(input: ReadingTimeInput): ProResult<ReadingTime> {
  if (!textFits(input.text)) return fail("text");
  if (!isPositive(input.pace) || input.pace > 1000) return fail("pace");
  if (!isInRange(input.pause, 0, 600)) return fail("pause");

  const blocks = paragraphsOf(input.text);
  const paragraphs: ReadingParagraph[] = [];
  let entrySeconds = 0;
  let words = 0;
  let totalSeconds = 0;
  let displayedSumSeconds = 0;

  for (const [index, block] of blocks.entries()) {
    const count = spacedWordCount(block);
    const seconds = (count / input.pace) * SECONDS_PER_MINUTE;
    const displaySeconds = Math.round(seconds);
    const entryDisplaySeconds = Math.floor(entrySeconds);
    paragraphs.push({
      index: index + 1,
      words: count,
      seconds,
      displaySeconds,
      clock: formatClock(displaySeconds),
      entrySeconds,
      entryDisplaySeconds,
      entryClock: formatClock(entryDisplaySeconds),
    });
    words += count;
    totalSeconds += seconds;
    displayedSumSeconds += displaySeconds;
    entrySeconds += seconds + input.pause;
  }

  // The pause falls BETWEEN paragraphs, so there are n-1 of them — and none at
  // all when the text is empty, where n-1 would otherwise be a negative total.
  const total = totalSeconds + input.pause * Math.max(0, blocks.length - 1);
  const totalDisplaySeconds = Math.round(total);
  return {
    ok: true,
    paragraphs,
    words,
    totalSeconds: total,
    totalDisplaySeconds,
    totalClock: formatClock(totalDisplaySeconds),
    displayedSumSeconds,
  };
}

/** MM:SS, or HH:MM:SS from one hour on. Zero-padded, language-free. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const ss = String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  const mm = String(Math.floor(whole / SECONDS_PER_MINUTE) % SECONDS_PER_MINUTE).padStart(2, "0");
  if (whole < SECONDS_PER_HOUR) return `${mm}:${ss}`;
  return `${String(Math.floor(whole / SECONDS_PER_HOUR)).padStart(2, "0")}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// sentence-length — Dužina rečenica
// ---------------------------------------------------------------------------

/** Unicode 16.0 Code Charts. There is no abbreviation list — see the note below. */
const TERMINATORS = new Set([".", "!", "?", "…"]);

/** Quotes and closing brackets that belong to the terminator that precedes them. */
const TRAILING_MARKS = new Set([
  '"',
  "'",
  ")",
  "]",
  "}",
  "»",
  "“",
  "”",
  "‘",
  "’",
]);

export interface SentenceRow {
  readonly index: number;
  readonly words: number;
  readonly text: string;
  /** Above the threshold the USER typed. The threshold is not the tool's. */
  readonly overThreshold: boolean;
}

export interface SentenceLengthInput {
  readonly text: string;
  /** Words; a sentence longer than this is marked. */
  readonly threshold: number;
}

export interface SentenceLength {
  readonly sentences: readonly SentenceRow[];
  readonly count: number;
  readonly totalWords: number;
  /** Rounded to 2 decimals; undefined for an empty text rather than 0. */
  readonly averageWords: number | undefined;
  readonly longestIndex: number | undefined;
  readonly longestWords: number | undefined;
}

/**
 * Sentences, their lengths, and which of them are longer than the user's own
 * threshold.
 *
 * **The whole segmentation rule is in this function and nowhere else**, because
 * a segmentation the reader cannot see is an answer they cannot trust. A
 * terminator ends a sentence when white space or the end of the text follows it
 * and the next visible code point is NOT lowercase — which catches „npr. ovako"
 * and „tj. tako" without carrying an abbreviation list anyone would have to
 * maintain. A period additionally does not end a sentence between two digits
 * („12. 5. 2020") or after a lone letter („J. Jovanović").
 *
 * **What it gets wrong, openly:** an abbreviation followed by a capital („God.
 * Prvi put…") is cut in the wrong place. That is why every sentence is returned
 * whole — the mistake is visible and correctable by eye.
 */
export function sentenceLength(input: SentenceLengthInput): ProResult<SentenceLength> {
  if (!textFits(input.text)) return fail("text");
  if (!isIntegerIn(input.threshold, 1, 200)) return fail("threshold");

  const sentences: SentenceRow[] = [];
  let totalWords = 0;
  let longestIndex: number | undefined;
  let longestWords: number | undefined;

  const push = (raw: string): void => {
    const text = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
    if (text.length === 0) return;
    const words = lexicalTokens(text).length;
    sentences.push({
      index: sentences.length + 1,
      words,
      text,
      overThreshold: words > input.threshold,
    });
    totalWords += words;
    if (longestWords === undefined || words > longestWords) {
      longestWords = words;
      longestIndex = sentences.length;
    }
  };

  // A blank line ends a sentence whatever its punctuation, so each block between
  // blank lines is segmented on its own.
  for (const block of paragraphsOf(input.text)) {
    const chars = [...block];
    let start = 0;
    let i = 0;
    while (i < chars.length) {
      const char = chars[i];
      if (char === undefined || !TERMINATORS.has(char)) {
        i += 1;
        continue;
      }
      let run = i;
      while (run < chars.length && TERMINATORS.has(chars[run] ?? "")) run += 1;
      let end = run;
      while (end < chars.length && TRAILING_MARKS.has(chars[end] ?? "")) end += 1;

      const following = chars[end];
      if (following !== undefined && !SPACE_CHAR.test(following)) {
        i = run;
        continue;
      }
      let visible: string | undefined;
      for (let k = end; k < chars.length; k += 1) {
        const candidate = chars[k];
        if (candidate === undefined || SPACE_CHAR.test(candidate)) continue;
        visible = candidate;
        break;
      }
      if (visible !== undefined && LOWER.test(visible)) {
        i = run;
        continue;
      }
      if (char === "." && run === i + 1 && !periodEndsSentence(chars, i, visible)) {
        i = run;
        continue;
      }
      push(chars.slice(start, end).join(""));
      start = end;
      i = end;
    }
    push(chars.slice(start).join(""));
  }

  const count = sentences.length;
  return {
    ok: true,
    sentences,
    count,
    totalWords,
    averageWords: count === 0 ? undefined : roundHalfUp(totalWords / count, 2),
    longestIndex,
    longestWords,
  };
}

/** The two places a single period is not the end: inside a date, after an initial. */
function periodEndsSentence(
  chars: readonly string[],
  at: number,
  visible: string | undefined,
): boolean {
  const before = chars[at - 1];
  if (before === undefined) return true;
  if (DIGIT.test(before) && visible !== undefined && DIGIT.test(visible)) return false;
  const beforeThat = chars[at - 2];
  if (LETTER.test(before) && (beforeThat === undefined || !LETTER.test(beforeThat))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// serbian-transliteration — Preslovljavanje
// ---------------------------------------------------------------------------

/**
 * NOT ISO 9:1995 — that strict transliteration standard writes the three
 * digraph letters with a combining circumflex (l̂, n̂, d̂) in some of its own
 * modes, which is not what a Serbian reader writes or expects. What this table
 * is, is vukovica ↔ gajica: the one correspondence that has made Vuk
 * Karadžić's Cyrillic azbuka and Ljudevit Gaj's Latin abeceda two scripts for
 * one language since both were fixed. Thirty pairs, a fact about the language
 * rather than a table a standards body maintains, so it does not go stale.
 */
const CYRILLIC_TO_LATIN: readonly (readonly [string, string])[] = [
  ["а", "a"],
  ["б", "b"],
  ["в", "v"],
  ["г", "g"],
  ["д", "d"],
  ["ђ", "đ"],
  ["е", "e"],
  ["ж", "ž"],
  ["з", "z"],
  ["и", "i"],
  ["ј", "j"],
  ["к", "k"],
  ["л", "l"],
  ["љ", "lj"],
  ["м", "m"],
  ["н", "n"],
  ["њ", "nj"],
  ["о", "o"],
  ["п", "p"],
  ["р", "r"],
  ["с", "s"],
  ["т", "t"],
  ["ћ", "ć"],
  ["у", "u"],
  ["ф", "f"],
  ["х", "h"],
  ["ц", "c"],
  ["ч", "č"],
  ["џ", "dž"],
  ["ш", "š"],
];

const CYRILLIC_MAP = new Map<string, string>();
for (const [cyrillic, latin] of CYRILLIC_TO_LATIN) {
  CYRILLIC_MAP.set(cyrillic, latin);
  CYRILLIC_MAP.set(cyrillic.toUpperCase(), latin.toUpperCase());
}

/** Single letters only; the three digraphs are matched before this map is read. */
const LATIN_MAP = new Map<string, string>();
for (const [cyrillic, latin] of CYRILLIC_TO_LATIN) {
  if ([...latin].length > 1) continue;
  LATIN_MAP.set(latin, cyrillic);
  LATIN_MAP.set(latin.toUpperCase(), cyrillic.toUpperCase());
}

const DIGRAPHS: readonly (readonly [string, string])[] = [
  ["lj", "љ"],
  ["nj", "њ"],
  ["dž", "џ"],
];

/**
 * The nine precomposed Latin digraph letters (U+01C4–U+01CC) — legacy single
 * code points for DŽ/Dž/dž, LJ/Lj/lj and NJ/Nj/nj. Unlike the two-letter
 * spellings these are never ambiguous: a single code point has no second
 * reading the way "n" followed by "j" might be two letters or one, so these
 * map straight across and never enter the ambiguity table.
 */
const PRECOMPOSED_LATIN_DIGRAPHS: ReadonlyMap<string, string> = new Map([
  ["Ǆ", "Џ"],
  ["ǅ", "Џ"], // Title case has no Cyrillic counterpart — see the note below.
  ["ǆ", "џ"],
  ["Ǉ", "Љ"],
  ["ǈ", "Љ"],
  ["ǉ", "љ"],
  ["Ǌ", "Њ"],
  ["ǋ", "Њ"],
  ["ǌ", "њ"],
]);

/** Why a place in the Latin text has more than one correct Cyrillic reading. */
export type AmbiguityReason = "digraph" | "dj";

export interface TransliterationAmbiguity {
  /** The two Latin letters as written, e.g. „dž". */
  readonly sequence: string;
  /** 0-indexed code point position in the whole text. */
  readonly index: number;
  readonly line: number;
  readonly column: number;
  readonly word: string;
  readonly reason: AmbiguityReason;
}

export interface TransliterationInput {
  readonly text: string;
  readonly direction: "cyrillicToLatin" | "latinToCyrillic";
}

export interface Transliteration {
  readonly text: string;
  /** Always empty going Cyrillic to Latin: that direction is unambiguous. */
  readonly ambiguities: readonly TransliterationAmbiguity[];
}

/**
 * Serbian text from one script into the other, with every ambiguous place named.
 *
 * **Cyrillic to Latin is a substitution and cannot be wrong.** The only decision
 * is the case of a digraph: Њ before another capital is NJ, Њ before a lowercase
 * letter is Nj, and Њ at the end of a run of capitals („КОЊ") is NJ again —
 * which is why the letter after it is not enough on its own.
 *
 * **Latin to Cyrillic is a guess, and the tool refuses to make it silently.**
 * „nadživeti" contains the letters d and ž that are not the digraph џ, and
 * „injekcija" contains n and j that are not њ. Every digraph match is reported
 * with its position, and „dj" is never turned into ђ at all — only reported.
 * A list of exception words would be a table somebody has to maintain; a list of
 * places is the same information with nothing to maintain.
 *
 * The one exception is the nine precomposed digraph letters (U+01C4–U+01CC,
 * e.g. „ǆ"): a single code point has no second reading, so those map straight
 * through and never reach the ambiguity table. A letter outside the 30-pair
 * table and outside those nine — q, w, x, y, a foreign diacritic — is copied
 * through unchanged in both directions, which is the correct answer and not a
 * gap: this tool transliterates the Serbian alphabet, not a spellchecker.
 */
export function transliterate(input: TransliterationInput): ProResult<Transliteration> {
  if (!textFits(input.text)) return fail("text");
  const text = toLf(input.text);
  return {
    ok: true,
    ...(input.direction === "cyrillicToLatin"
      ? { text: cyrillicToLatin(text), ambiguities: [] }
      : latinToCyrillic(text)),
  };
}

function cyrillicToLatin(text: string): string {
  const chars = [...text];
  const out: string[] = [];
  for (const [index, char] of chars.entries()) {
    const mapped = CYRILLIC_MAP.get(char);
    if (mapped === undefined) {
      out.push(char);
      continue;
    }
    if ([...mapped].length !== 2 || !UPPER.test(char)) {
      out.push(mapped);
      continue;
    }
    const next = chars[index + 1];
    const previous = chars[index - 1];
    const allCaps =
      (next !== undefined && UPPER.test(next)) ||
      ((next === undefined || !LETTER.test(next)) && previous !== undefined && UPPER.test(previous));
    out.push(allCaps ? mapped : `${mapped.slice(0, 1)}${mapped.slice(1).toLowerCase()}`);
  }
  return out.join("");
}

function latinToCyrillic(text: string): Transliteration {
  const chars = [...text];
  const out: string[] = [];
  const ambiguities: TransliterationAmbiguity[] = [];
  let line = 1;
  let column = 1;
  let index = 0;

  const record = (sequence: string, reason: AmbiguityReason): void => {
    ambiguities.push({ sequence, index, line, column, word: wordAt(chars, index), reason });
  };

  while (index < chars.length) {
    const char = chars[index] ?? "";
    if (char === "\n") {
      out.push(char);
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    const precomposed = PRECOMPOSED_LATIN_DIGRAPHS.get(char);
    if (precomposed !== undefined) {
      // One code point, one reading — not reported, unlike the two-letter form.
      out.push(precomposed);
      index += 1;
      column += 1;
      continue;
    }
    const next = chars[index + 1];
    const pair = next === undefined ? "" : `${char}${next}`.toLowerCase();
    const digraph = DIGRAPHS.find(([latin]) => latin === pair);
    if (digraph !== undefined) {
      record(`${char}${next ?? ""}`, "digraph");
      // Cyrillic has no half-capital letter, so „Lj" and „LJ" both give Љ.
      out.push(UPPER.test(char) ? digraph[1].toUpperCase() : digraph[1]);
      index += 2;
      column += 2;
      continue;
    }
    if (pair === "dj") {
      // Never ђ: „nadjačati" is not *„nađačati". Reported, then written letter
      // by letter like any other pair.
      record(`${char}${next ?? ""}`, "dj");
    }
    out.push(LATIN_MAP.get(char) ?? char);
    index += 1;
    column += 1;
  }

  return { text: out.join(""), ambiguities };
}

/** The maximal word containing the code point at `index`, for the report. */
function wordAt(chars: readonly string[], index: number): string {
  let from = index;
  while (from > 0 && WORD_CHAR.test(chars[from - 1] ?? "")) from -= 1;
  let to = index;
  while (to < chars.length && WORD_CHAR.test(chars[to] ?? "")) to += 1;
  return chars.slice(from, to).join("");
}

// ---------------------------------------------------------------------------
// Subtitles — the parser both subtitle tools read with
// ---------------------------------------------------------------------------

/**
 * SRT and WebVTT differ only in the separator before the milliseconds, so one
 * pattern reads both. Milliseconds must be exactly three digits: „,5" is 5 ms to
 * a parser and 500 ms to the person who typed it, and guessing which would move
 * every later cue.
 *
 * **The hours group is bounded, and it used to be `(\d+)`.** Every other group
 * here already carries a width, so the one unbounded run was the only way a cue
 * could parse into a number that is not one: `Number("9".repeat(400))` is
 * `Infinity`, and a cue whose hour field is a long digit run gave a duration of
 * `Infinity` on an `ok: true` audit. That is not a hypothetical input — it is
 * what a truncated or mis-encoded paste looks like. Six digits is 114 years of
 * hours, and 999999 × 3 600 000 stays well inside the range a double represents
 * exactly, so the bound cannot cost a real subtitle anything.
 */
const TIME_PATTERN = "(?:(\\d{1,6}):)?(\\d{1,2}):(\\d{2})([.,])(\\d{3})";
const CUE_LINE = new RegExp(`^([ \\t]*)${TIME_PATTERN}([ \\t]*-->[ \\t]*)${TIME_PATTERN}(.*)$`, "u");

const MAX_SUBTITLE_BLOCKS = 20000;

interface CueTimes {
  readonly startMs: number;
  readonly endMs: number;
}

function cueTimes(match: RegExpExecArray): CueTimes {
  const ms = (h: string | undefined, m: string | undefined, s: string | undefined, f: string | undefined): number =>
    ((Number(h ?? "0") * 60 + Number(m ?? "0")) * 60 + Number(s ?? "0")) * 1000 + Number(f ?? "0");
  return {
    startMs: ms(match[2], match[3], match[4], match[6]),
    endMs: ms(match[8], match[9], match[10], match[12]),
  };
}

/** HH:MM:SS,mmm — hours are not capped at 24, because a reel is not a clock. */
function formatTimecode(totalMs: number, separator: string): string {
  const ms = Math.max(0, Math.round(totalMs));
  const hh = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const mm = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

export interface TimecodeInput {
  /** „+00:00:02,500" or a plain count of milliseconds, with an optional sign. */
  readonly text: string;
}

export interface Timecode {
  readonly ms: number;
}

/**
 * The offset field, read into whole milliseconds.
 *
 * Exported because both subtitle tools and their surfaces need the same reading
 * of the same field, and a second copy in the renderer is a second answer.
 */
export function parseTimecode(input: TimecodeInput): ProResult<Timecode> {
  const trimmed = input.text.trim();
  // Both digit runs are bounded for the same reason as `TIME_PATTERN`: an
  // unbounded `(\d+)` accepts four hundred nines, and `Number` of that is
  // `Infinity`, which this function used to return directly as an offset in
  // milliseconds on an `ok: true` result. Six digits of hours is 114 years;
  // twelve digits of milliseconds is thirty-one. Both stay exact in a double.
  const match = /^([+-]?)(?:(\d{1,6}):(\d{1,2}):(\d{1,2})[.,](\d{3})|(\d{1,12}))$/u.exec(trimmed);
  if (match === null) return fail("text");
  const sign = match[1] === "-" ? -1 : 1;
  if (match[6] !== undefined) return { ok: true, ms: sign * Number(match[6]) };
  const ms =
    ((Number(match[2] ?? "0") * 60 + Number(match[3] ?? "0")) * 60 + Number(match[4] ?? "0")) * 1000 +
    Number(match[5] ?? "0");
  return { ok: true, ms: sign * ms };
}

// ---------------------------------------------------------------------------
// subtitle-audit — Provera titlova
// ---------------------------------------------------------------------------

export interface SubtitleBlockAudit {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  /** Code points of the block's text, line breaks excluded, spaces included. */
  readonly characters: number;
  /** Rounded to 2 decimals; undefined when the duration is zero. */
  readonly charactersPerSecond: number | undefined;
  readonly longestLine: number;
  readonly lines: number;
  /** Milliseconds to the next block; undefined for the last one, never 0. */
  readonly gapMs: number | undefined;
  readonly longestLineRatio: number | undefined;
  readonly linesRatio: number | undefined;
  readonly charactersPerSecondRatio: number | undefined;
  /** Limit divided by measurement, so a larger number always means „further". */
  readonly minDurationRatio: number | undefined;
  readonly maxDurationRatio: number | undefined;
  readonly gapRatio: number | undefined;
}

export interface SubtitleAuditInput {
  readonly subtitle: string;
  /** Every limit is the user's, has no default, and may be left out entirely. */
  readonly maxLineChars?: number | undefined;
  readonly maxLines?: number | undefined;
  readonly minDurationMs?: number | undefined;
  readonly maxDurationMs?: number | undefined;
  readonly maxCharsPerSecond?: number | undefined;
  readonly minGapMs?: number | undefined;
  /** On counts `<i>` and ASS overrides as characters; off strips them first. */
  readonly countTags: boolean;
}

export interface SubtitleAudit {
  readonly blocks: readonly SubtitleBlockAudit[];
  /** Blocks whose end is at or before its start — measured, not compared. */
  readonly nonPositiveDuration: readonly number[];
  /** Blocks that start before the block in front of them. */
  readonly outOfOrder: readonly number[];
  /** Blocks that overlap the next one: a negative gap. */
  readonly overlapping: readonly number[];
}

/**
 * Every measurement a subtitle can be judged by, beside the number the user
 * typed, and the ratio of the two.
 *
 * **The word „correct" does not appear in this answer and cannot be derived from
 * it.** 42 characters, 2 lines and 17 characters per second are house rules of
 * particular broadcasters that change from job to job; the tool holds none of
 * them, defaults none of them, and cites no standard. A ratio above 1 says the
 * measurement is larger than the number typed — that is the whole statement.
 *
 * The minimum duration is the one ratio computed the other way round, limit over
 * measurement, so that „further from the limit" reads as a larger number in
 * every column rather than in some of them.
 */
export function subtitleAudit(input: SubtitleAuditInput): ProResult<SubtitleAudit> {
  if (!textFits(input.subtitle)) return fail("subtitle");
  if (input.maxLineChars !== undefined && !isIntegerIn(input.maxLineChars, 1, 200)) {
    return fail("maxLineChars");
  }
  if (input.maxLines !== undefined && !isIntegerIn(input.maxLines, 1, 10)) return fail("maxLines");
  if (input.minDurationMs !== undefined && !isIntegerIn(input.minDurationMs, 0, 60000)) {
    return fail("minDurationMs");
  }
  if (input.maxDurationMs !== undefined && !isIntegerIn(input.maxDurationMs, 0, 600000)) {
    return fail("maxDurationMs");
  }
  if (input.maxCharsPerSecond !== undefined && !isInRange(input.maxCharsPerSecond, 0, 100)) {
    return fail("maxCharsPerSecond");
  }
  if (input.minGapMs !== undefined && !isIntegerIn(input.minGapMs, 0, 10000)) return fail("minGapMs");

  const parsed = parseCues(input.subtitle);
  if (parsed === undefined) return fail("subtitle");
  if (parsed.length === 0 || parsed.length > MAX_SUBTITLE_BLOCKS) return fail("subtitle");

  const blocks: SubtitleBlockAudit[] = [];
  const nonPositiveDuration: number[] = [];
  const outOfOrder: number[] = [];
  const overlapping: number[] = [];

  for (const [index, cue] of parsed.entries()) {
    const number = index + 1;
    const lines = cue.lines.map((line) => (input.countTags ? line : stripTags(line)));
    const durationMs = cue.endMs - cue.startMs;
    const characters = lines.reduce((total, line) => total + codePointCount(line), 0);
    const longestLine = lines.reduce((longest, line) => Math.max(longest, codePointCount(line)), 0);
    const charactersPerSecond =
      durationMs > 0 ? roundHalfUp(characters / (durationMs / 1000), 2) : undefined;
    const next = parsed[index + 1];
    const gapMs = next === undefined ? undefined : next.startMs - cue.endMs;

    if (durationMs <= 0) nonPositiveDuration.push(number);
    const previous = parsed[index - 1];
    if (previous !== undefined && cue.startMs < previous.startMs) outOfOrder.push(number);
    if (gapMs !== undefined && gapMs < 0) overlapping.push(number);

    blocks.push({
      index: number,
      startMs: cue.startMs,
      endMs: cue.endMs,
      durationMs,
      characters,
      charactersPerSecond,
      longestLine,
      lines: lines.length,
      gapMs,
      longestLineRatio: ratioAgainst(longestLine, input.maxLineChars),
      linesRatio: ratioAgainst(lines.length, input.maxLines),
      charactersPerSecondRatio:
        charactersPerSecond === undefined
          ? undefined
          : ratioAgainst(charactersPerSecond, input.maxCharsPerSecond),
      minDurationRatio:
        input.minDurationMs === undefined ? undefined : ratioAgainst(input.minDurationMs, durationMs),
      maxDurationRatio: ratioAgainst(durationMs, input.maxDurationMs),
      gapRatio: gapMs === undefined ? undefined : ratioAgainst(gapMs, input.minGapMs),
    });
  }

  return { ok: true, blocks, nonPositiveDuration, outOfOrder, overlapping };
}

/** Markup and ASS overrides, removed before the characters are counted. */
function stripTags(line: string): string {
  return line.replace(/<[^>]*>/gu, "").replace(/\{\\[^}]*\}/gu, "");
}

interface ParsedCue extends CueTimes {
  readonly lines: readonly string[];
}

/**
 * Cues, in file order. A chunk with no timing line is a header, a NOTE or a
 * STYLE block and is skipped — unless it contains an arrow, in which case the
 * timing line is malformed and the whole read is refused rather than silently
 * measuring a file with a cue missing from it.
 */
function parseCues(subtitle: string): ParsedCue[] | undefined {
  const cues: ParsedCue[] = [];
  for (const chunk of toLf(subtitle).split(/\n[ \t]*\n/u)) {
    const lines = chunk.split("\n");
    const at = lines.findIndex((line) => CUE_LINE.test(line));
    if (at < 0) {
      if (chunk.includes("-->")) return undefined;
      continue;
    }
    const match = CUE_LINE.exec(lines[at] ?? "");
    if (match === null) return undefined;
    cues.push({ ...cueTimes(match), lines: lines.slice(at + 1).filter((line) => !isBlankLine(line)) });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// subtitle-retime — Pomeranje titlova
// ---------------------------------------------------------------------------

/**
 * A frame rate as the ratio of whole numbers it is defined to be.
 *
 * SMPTE ST 12-1:2014 defines the NTSC rates as 24000/1001, 30000/1001 and
 * 60000/1001. Typed as „23.976" they are simply a different, wrong rate, which
 * over a feature length drifts by seconds — so the choice is a pair of integers
 * and never a decimal.
 */
export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

/** The eight rates the picker offers, exact. */
export const FRAME_RATES: Readonly<Record<string, FrameRate>> = {
  "24": { numerator: 24, denominator: 1 },
  "25": { numerator: 25, denominator: 1 },
  "30": { numerator: 30, denominator: 1 },
  "50": { numerator: 50, denominator: 1 },
  "60": { numerator: 60, denominator: 1 },
  "24000/1001": { numerator: 24000, denominator: 1001 },
  "30000/1001": { numerator: 30000, denominator: 1001 },
  "60000/1001": { numerator: 60000, denominator: 1001 },
};

export interface SubtitleRetimeInput {
  readonly subtitle: string;
  /** Whole milliseconds, positive or negative. */
  readonly offsetMs: number;
  /** Both rates or neither: one alone is not a conversion. */
  readonly fromFps?: FrameRate | undefined;
  readonly toFps?: FrameRate | undefined;
  readonly renumber: boolean;
}

export interface SubtitleRetime {
  /** The whole file, in the format it arrived in, with the text untouched. */
  readonly text: string;
  readonly blocks: number;
  /** How many times max(0, …) had to cut a time back to the start of the file. */
  readonly clamped: number;
  readonly endBeforeStart: readonly number[];
}

const MAX_OFFSET_MS = 86400000;

/**
 * Shift every cue, and convert between frame rates, in whole milliseconds.
 *
 * **Convert first, then shift.** The frame rate scales both the start and the
 * gaps; the offset is a fixed delay applied to the result. In the other order
 * the offset would itself be scaled, which is not what a delay is.
 *
 * **Nothing is computed in floating-point seconds.** Over two hours a rounding
 * error accumulated per cue becomes a visible lag, so the arithmetic stays in
 * integers: the ratio is reduced by its greatest common divisor first, then the
 * multiplication is split so no intermediate product can leave the exact range
 * of a double.
 *
 * Everything that is not a timing line is copied through character for
 * character — the WEBVTT header, cue settings, NOTE blocks, `<i>` and the text.
 */
export function subtitleRetime(input: SubtitleRetimeInput): ProResult<SubtitleRetime> {
  if (!textFits(input.subtitle)) return fail("subtitle");
  if (!Number.isInteger(input.offsetMs) || Math.abs(input.offsetMs) > MAX_OFFSET_MS) {
    return fail("offsetMs");
  }
  if ((input.fromFps === undefined) !== (input.toFps === undefined)) {
    return fail(input.fromFps === undefined ? "fromFps" : "toFps");
  }
  if (input.fromFps !== undefined && !isFrameRate(input.fromFps)) return fail("fromFps");
  if (input.toFps !== undefined && !isFrameRate(input.toFps)) return fail("toFps");

  const scale =
    input.fromFps === undefined || input.toFps === undefined
      ? undefined
      : reduce(
          input.fromFps.numerator * input.toFps.denominator,
          input.fromFps.denominator * input.toFps.numerator,
        );

  const lines = toLf(input.subtitle).split("\n");
  const out: string[] = [];
  const endBeforeStart: number[] = [];
  let blocks = 0;
  let clamped = 0;

  for (const [index, line] of lines.entries()) {
    const match = CUE_LINE.exec(line);
    if (match === null) {
      const isIndexLine = /^[ \t]*\d+[ \t]*$/u.test(line) && CUE_LINE.test(lines[index + 1] ?? "");
      out.push(input.renumber && isIndexLine ? String(blocks + 1) : line);
      continue;
    }
    blocks += 1;
    const { startMs, endMs } = cueTimes(match);
    const start = shift(startMs, scale, input.offsetMs);
    const end = shift(endMs, scale, input.offsetMs);
    if (start.clamped) clamped += 1;
    if (end.clamped) clamped += 1;
    if (end.ms < start.ms) endBeforeStart.push(blocks);
    out.push(
      `${match[1] ?? ""}${formatTimecode(start.ms, match[5] ?? ",")}${match[7] ?? " --> "}` +
        `${formatTimecode(end.ms, match[11] ?? ",")}${match[13] ?? ""}`,
    );
  }

  if (blocks === 0 || blocks > MAX_SUBTITLE_BLOCKS) return fail("subtitle");
  return { ok: true, text: out.join("\n"), blocks, clamped, endBeforeStart };
}

function isFrameRate(rate: FrameRate): boolean {
  return (
    Number.isInteger(rate.numerator) &&
    Number.isInteger(rate.denominator) &&
    rate.numerator > 0 &&
    rate.denominator > 0
  );
}

function reduce(numerator: number, denominator: number): FrameRate {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const common = gcd(numerator, denominator);
  return { numerator: numerator / common, denominator: denominator / common };
}

/** round(ms x n / d) half up, then the offset, then the floor at zero. */
function shift(
  ms: number,
  scale: FrameRate | undefined,
  offsetMs: number,
): { readonly ms: number; readonly clamped: boolean } {
  let converted = ms;
  if (scale !== undefined) {
    const whole = Math.floor(ms / scale.denominator);
    const rest = ms - whole * scale.denominator;
    converted =
      whole * scale.numerator +
      Math.floor((rest * scale.numerator * 2 + scale.denominator) / (2 * scale.denominator));
  }
  const shifted = converted + offsetMs;
  return { ms: Math.max(0, shifted), clamped: shifted < 0 };
}

// ---------------------------------------------------------------------------
// translation-volume — Obim prevoda
// ---------------------------------------------------------------------------

/** What the price is per. The page size itself is the client's, hence an input. */
export type ChargeUnit = "page" | "word" | "character";

export interface TranslationVolumeInput {
  readonly text: string;
  /**
   * Characters per translated page. 1800 and 1500 are both in use and neither is
   * a fact — the agency or the association sets it, and it changes per job.
   */
  readonly charsPerPage: number;
  /** Left out means the amounts are not shown at all, which is not zero. */
  readonly price?: number | undefined;
  readonly unit: ChargeUnit;
}

export interface TranslationVolume {
  /**
   * The billing figure — code points with spaces but WITHOUT paragraph marks.
   * This is deliberately what MS Word's own character count shows, because
   * that is the number a client compares an invoice against; see
   * `charactersWithLineBreaks` for the plain length of the paste.
   */
  readonly charactersWithSpaces: number;
  /** The literal code-point count of the paste, LF included. Differs from
   *  `charactersWithSpaces` by exactly one per line break in the text. */
  readonly charactersWithLineBreaks: number;
  readonly charactersWithoutSpaces: number;
  /** The billing convention: runs of non-white-space. */
  readonly wordsBySpaces: number;
  /** The lexical convention: runs of letters. Shown beside the first. */
  readonly wordsByLetters: number;
  /** Exact, unrounded — the display rounds to 4 decimals, the money does not. */
  readonly pagesExact: number;
  readonly pagesRoundedUp: number;
  /** price x the exact quantity, or undefined when no price was given. */
  readonly amountExact: number | undefined;
  /** price x the rounded-up page count; equal to the above for other units. */
  readonly amountRoundedUp: number | undefined;
}

/**
 * The size of a job in every unit anybody bills in, and the money at the price
 * the user typed.
 *
 * **Both amounts come from the UNROUNDED quantity.** Multiplying a page count
 * that has already been rounded for display is how 4321 characters at 1000 per
 * page becomes 2400.60 instead of 2400.56 — the rounding is a property of the
 * printed line, not of the arithmetic.
 *
 * The two word counts are both returned because a client means one of them and
 * never says which: runs of non-white-space is what „broj reči" means on an
 * invoice, runs of letters is what a linguist means.
 *
 * **The billing count excludes the line break, and says so by returning both
 * numbers.** MS Word's own character count does not count a paragraph mark, so
 * a tool that did would disagree with the one document a client is actually
 * going to open and compare against — silently, on every multi-paragraph text,
 * by exactly the number of paragraphs. `charactersWithLineBreaks` is kept
 * alongside it so the gap between the two is a number on screen, not a surprise
 * on an invoice.
 */
export function translationVolume(input: TranslationVolumeInput): ProResult<TranslationVolume> {
  if (!textFits(input.text)) return fail("text");
  if (!isIntegerIn(input.charsPerPage, 100, 20000)) return fail("charsPerPage");
  if (input.price !== undefined && !isInRange(input.price, 0, 100000000)) return fail("price");

  const text = toLf(input.text);
  const charactersWithLineBreaks = codePointCount(text);
  let lineBreaks = 0;
  let charactersWithoutSpaces = 0;
  for (const char of text) {
    if (char === "\n") lineBreaks += 1;
    if (!SPACE_CHAR.test(char)) charactersWithoutSpaces += 1;
  }
  const charactersWithSpaces = charactersWithLineBreaks - lineBreaks;

  const wordsBySpaces = spacedWordCount(text);
  const wordsByLetters = lexicalTokens(text).length;
  const pagesExact = charactersWithSpaces / input.charsPerPage;
  const pagesRoundedUp = Math.ceil(pagesExact);

  const quantity =
    input.unit === "page" ? pagesExact : input.unit === "word" ? wordsBySpaces : charactersWithSpaces;
  const roundedQuantity = input.unit === "page" ? pagesRoundedUp : quantity;

  return {
    ok: true,
    charactersWithSpaces,
    charactersWithLineBreaks,
    charactersWithoutSpaces,
    wordsBySpaces,
    wordsByLetters,
    pagesExact,
    pagesRoundedUp,
    amountExact: input.price === undefined ? undefined : input.price * quantity,
    amountRoundedUp: input.price === undefined ? undefined : input.price * roundedQuantity,
  };
}

// ---------------------------------------------------------------------------
// typography-cleanup — Tipografsko čišćenje
// ---------------------------------------------------------------------------

/** Which pair of double quotes the user wants. „Straight" leaves them alone. */
export type QuoteStyle = "curly" | "guillemets" | "straight";

const QUOTE_PAIRS: Readonly<Record<QuoteStyle, readonly [string, string] | undefined>> = {
  curly: ["„", "“"],
  guillemets: ["«", "»"],
  straight: undefined,
};

/** After one of these, a straight quote is opening; after anything else, closing. */
const OPENS_AFTER = new Set([" ", "(", "[", "{", "–", "—"]);

export interface TypographyInput {
  readonly text: string;
  readonly style: QuoteStyle;
  readonly quotes: boolean;
  readonly ellipses: boolean;
  readonly dashes: boolean;
  readonly spaces: boolean;
  readonly nbsp: boolean;
}

export interface TypographyCleanup {
  readonly text: string;
  /** One count per rule: the number of replacements that rule performed. */
  readonly quotes: number;
  readonly ellipses: number;
  readonly dashes: number;
  readonly spaces: number;
  readonly nbsp: number;
  readonly total: number;
  readonly codePointsBefore: number;
  readonly codePointsAfter: number;
}

/**
 * Straight quotes, triple dots, hyphens and stray spaces, each rule counted.
 *
 * **The order is fixed and the rules do not commute.** Quotes are decided by
 * what precedes them, so collapsing spaces first would change which quotes open;
 * dashes are decided by what surrounds them, so the same applies. Hence quotes,
 * then ellipses, then dashes, then spaces, then NBSP.
 *
 * **A hyphen is only ever changed as a whole run.** Runs of three become an em
 * dash, of two an en dash, and a single hyphen only between two spaces or
 * between two digits — which is what leaves „COVID-19" and „crno-beli" alone. A
 * run of four or more is a rule somebody drew, not a dash, and is left as it is.
 *
 * **Known sharp edge:** the space-insertion rule only ever looks at a letter or
 * a digit immediately touching the mark, never at a whole word — so „www.
 * example.com" still becomes „www. example. com": the period is followed by a
 * letter and is not preceded by a digit, so nothing here tells it apart from
 * an ordinary sentence end. A rule that recognised a domain would need to know
 * what one looks like, which is a second, unrelated judgement this tool does
 * not make.
 */
export function typographyCleanup(input: TypographyInput): ProResult<TypographyCleanup> {
  if (!textFits(input.text)) return fail("text");
  let text = toLf(input.text);
  const before = codePointCount(text);

  let quotes = 0;
  if (input.quotes) {
    const applied = applyQuotes(text, input.style);
    text = applied.text;
    quotes = applied.count;
  }

  let ellipses = 0;
  if (input.ellipses) {
    text = text.replace(/\.{3,}/gu, () => {
      ellipses += 1;
      return "…";
    });
  }

  let dashes = 0;
  if (input.dashes) {
    const applied = applyDashes(text);
    text = applied.text;
    dashes = applied.count;
  }

  let spaces = 0;
  if (input.spaces) {
    const applied = applySpaces(text);
    text = applied.text;
    spaces = applied.count;
  }

  let nbsp = 0;
  if (input.nbsp) {
    text = text.replace(/\u00a0/gu, () => {
      nbsp += 1;
      return " ";
    });
  }

  return {
    ok: true,
    text,
    quotes,
    ellipses,
    dashes,
    spaces,
    nbsp,
    total: quotes + ellipses + dashes + spaces + nbsp,
    codePointsBefore: before,
    codePointsAfter: codePointCount(text),
  };
}

function applyQuotes(text: string, style: QuoteStyle): { text: string; count: number } {
  const pair = QUOTE_PAIRS[style];
  const chars = [...text];
  const out: string[] = [];
  let count = 0;
  for (const [index, char] of chars.entries()) {
    const previous = chars[index - 1];
    const opening = previous === undefined || SPACE_CHAR.test(previous) || OPENS_AFTER.has(previous);
    if (char === '"' && pair !== undefined) {
      out.push(opening ? pair[0] : pair[1]);
      count += 1;
      continue;
    }
    if (char === "'") {
      const next = chars[index + 1];
      if (previous !== undefined && next !== undefined && LETTER.test(previous) && LETTER.test(next)) {
        // An apostrophe, not a quotation mark: „ne'š" is one word.
        out.push("’");
        count += 1;
        continue;
      }
      if (pair !== undefined) {
        out.push(opening ? "‚" : "‘");
        count += 1;
        continue;
      }
    }
    out.push(char);
  }
  return { text: out.join(""), count };
}

function applyDashes(text: string): { text: string; count: number } {
  let count = 0;
  const result = text.replace(/-+/gu, (run, at: number) => {
    if (run.length === 3) {
      count += 1;
      return "—";
    }
    if (run.length === 2) {
      count += 1;
      return "–";
    }
    if (run.length !== 1) return run;
    const before = codePointBefore(text, at);
    const after = codePointAtIndex(text, at + 1);
    const spaced =
      before !== undefined && after !== undefined && SPACE_CHAR.test(before) && SPACE_CHAR.test(after);
    const numeric =
      before !== undefined && after !== undefined && DIGIT.test(before) && DIGIT.test(after);
    if (!spaced && !numeric) return run;
    count += 1;
    return "–";
  });
  return { text: result, count };
}

function applySpaces(text: string): { text: string; count: number } {
  let count = 0;
  // Line breaks survive every step: the deletions are written against the
  // horizontal white space only, or a full stop at the end of a line would pull
  // the next line up into it.
  let result = text.replace(/ {2,}/gu, () => {
    count += 1;
    return " ";
  });
  // Only the plain space and the tab are eligible here — not every code point
  // `\p{White_Space}` matches. NBSP and the other unusual spaces are their own
  // rule's business, and a blanket class would also eat the line break this
  // very deletion is written to leave alone.
  result = result.replace(/[ \t]+(?=[,.;:!?)\]}])/gu, () => {
    count += 1;
    return "";
  });
  // A digit never triggers this rule, for EITHER side: with it in the trigger,
  // "1.500,00" becomes "1. 500, 00" and "3.14" becomes "3. 14" — a comma or a
  // period between two figures is a thousands mark or a decimal point, not an
  // end of clause. A period additionally refuses when the digit is only on its
  // LEFT ("12.avgust", an ordinal date): the digit-on-the-right case is already
  // excluded by requiring a letter to follow, but a date's month name is a
  // letter, so the period needs its own guard against what precedes it.
  result = result.replace(/([,;:!?])(?=\p{L})/gu, (mark: string) => {
    count += 1;
    return `${mark} `;
  });
  result = result.replace(/(?<!\p{Nd})\.(?=\p{L})/gu, () => {
    count += 1;
    return ". ";
  });
  result = result.replace(/[^\S\n]+$/gmu, () => {
    count += 1;
    return "";
  });
  return { text: result, count };
}

// ---------------------------------------------------------------------------
// unwrap-paragraphs — Spajanje prelomljenih redova (not „Sređivanje preloma":
// „prelom" means page layout in Serbian publishing, and this tool joins broken
// LINES rather than laying out pages.
// ---------------------------------------------------------------------------

/** The five markers a list item can start with, visible to the user as a list. */
const LIST_ITEM = /^[ \t]*(?:[-–•*]|\p{Nd}+[.)])\p{White_Space}/u;

/** A sentence end at the end of a line: terminator plus at most one closing mark. */
const LINE_ENDS_SENTENCE = /[.!?…]["'“”‘’)\]}]?$/u;

export interface UnwrapInput {
  readonly text: string;
  /** Join „Neophod-" + „no" into one word, dropping the hyphen. */
  readonly joinHyphenated: boolean;
  /** A line starting with a list marker stays its own line. */
  readonly respectListItems: boolean;
  /** For texts whose blank lines were lost: end a paragraph at a full stop. */
  readonly splitOnSentenceEnd: boolean;
}

export interface Unwrap {
  readonly text: string;
  readonly joinedLines: number;
  readonly joinedWords: number;
  /** Paragraphs in the RESULT, so a paragraph rule 3 created is counted once. */
  readonly paragraphs: number;
}

/**
 * Lines broken by a PDF copy, put back into paragraphs.
 *
 * The four rules are tried in order and the FIRST that matches decides, so the
 * two counters can never both claim the same join. A hyphen at the end of a line
 * followed by a lowercase letter is a word split by the typesetter; a line
 * beginning with a list marker is a list item; a line ending in a full stop is a
 * paragraph boundary only if the user asked for that reading.
 *
 * **The rejected rule is worth naming:** „a line shorter than 60% of the longest
 * is probably the end of a paragraph" is a guess with an invented threshold that
 * would rewrite every document differently. Rule 3 is the same intent as an
 * explicit choice.
 */
export function unwrapParagraphs(input: UnwrapInput): ProResult<Unwrap> {
  if (!textFits(input.text)) return fail("text");

  let joinedLines = 0;
  let joinedWords = 0;
  const out: string[] = [];

  for (const block of paragraphsOf(input.text)) {
    const lines = block.split("\n");
    const built: string[] = [];
    let current = lines[0] ?? "";
    for (let index = 1; index < lines.length; index += 1) {
      const next = lines[index] ?? "";
      const head = next.replace(/^[ \t]+/u, "");
      const tail = current.slice(-1);
      if (input.joinHyphenated && (tail === "-" || tail === SOFT_HYPHEN) && LOWER.test(head.slice(0, 1))) {
        current = `${current.slice(0, -1)}${head}`;
        joinedWords += 1;
        continue;
      }
      if (input.respectListItems && LIST_ITEM.test(next)) {
        built.push(current);
        current = next;
        continue;
      }
      if (input.splitOnSentenceEnd && LINE_ENDS_SENTENCE.test(current)) {
        built.push(current);
        built.push("");
        current = next;
        continue;
      }
      current = `${current} ${head}`;
      joinedLines += 1;
    }
    built.push(current);
    out.push(built.join("\n"));
  }

  const text = out
    .join("\n\n")
    .replace(/ {2,}/gu, " ")
    .replace(/[^\S\n]+$/gmu, "");
  return {
    ok: true,
    text,
    joinedLines,
    joinedWords,
    paragraphs: paragraphsOf(text).length,
  };
}

// ---------------------------------------------------------------------------
// word-frequency — Učestalost reči
// ---------------------------------------------------------------------------

export interface FrequencyRow {
  /** The first form met in the text, so the table reads as the text is written. */
  readonly phrase: string;
  readonly count: number;
  /** Percent of all n-grams, rounded to 2 decimals. */
  readonly share: number;
}

export interface WordFrequencyInput {
  readonly text: string;
  /** Phrase length in words, 1..10. */
  readonly n: number;
  /** Filters the TABLE only; the denominator keeps every n-gram. */
  readonly minCount: number;
  /** Code points; applies only when n is 1. Filters the TABLE only, exactly
   *  like `minCount` — see the note on `wordFrequency`. */
  readonly minWordLength: number;
  readonly caseSensitive: boolean;
}

export interface WordFrequency {
  readonly rows: readonly FrequencyRow[];
  readonly totalWords: number;
  readonly totalNgrams: number;
  /** Distinct phrases in the text, before either threshold hides any of them. */
  readonly distinctPhrases: number;
}

/**
 * How often each word or phrase of n words occurs, and what share of the text it
 * is.
 *
 * **Both thresholds filter the table and never the denominator.** `minCount`
 * hiding a phrase, or `minWordLength` hiding a short one, must not change
 * `totalNgrams`: computing the denominator from only what a filter left visible
 * would make the shown shares add up to 100% of a sample the user never asked
 * for, which is a lie told in percentages regardless of which filter did it. So
 * every n-gram is counted first, over the FULL token list, and only the rows
 * built for display are filtered afterwards.
 *
 * **Phrases do not cross a paragraph boundary** — sentences would be the natural
 * unit, but sentence segmentation is a judgement call and a blank line is not.
 * Ties sort by `Intl.Collator(["sr-Latn","sr"])`, with the script named
 * explicitly: plain „sr" mis-tailors the Latin š, č and ć.
 *
 * There is no stop-word list. Such a list is a table somebody has to maintain
 * and it silently changes the answer; the length threshold does the same job in
 * a number the user can see.
 */
export function wordFrequency(input: WordFrequencyInput): ProResult<WordFrequency> {
  if (!textFits(input.text)) return fail("text");
  if (!isIntegerIn(input.n, 1, 10)) return fail("n");
  if (!isIntegerIn(input.minCount, 1, 1000)) return fail("minCount");
  if (!isIntegerIn(input.minWordLength, 1, 50)) return fail("minWordLength");

  const counts = new Map<string, { display: string; count: number }>();
  let totalWords = 0;
  let totalNgrams = 0;

  for (const paragraph of paragraphsOf(input.text)) {
    // Neither threshold is applied here: the full token list is what the
    // denominator is built from, and a word too short to show is still a word
    // that was read.
    const tokens = lexicalTokens(paragraph);
    totalWords += tokens.length;
    const ngrams = Math.max(0, tokens.length - input.n + 1);
    totalNgrams += ngrams;
    for (let index = 0; index < ngrams; index += 1) {
      const phrase = tokens.slice(index, index + input.n).join(" ");
      const key = input.caseSensitive ? phrase : phrase.toLowerCase();
      const entry = counts.get(key);
      if (entry === undefined) counts.set(key, { display: phrase, count: 1 });
      else entry.count += 1;
    }
  }

  const collator = new Intl.Collator(["sr-Latn", "sr"]);
  const rows = [...counts.values()]
    .filter((entry) => entry.count >= input.minCount)
    // The length threshold is spec'd to matter only for single words (n = 1);
    // for a phrase, dropping the words inside it would show n-grams the text
    // never actually contains.
    .filter((entry) => input.n !== 1 || codePointCount(entry.display) >= input.minWordLength)
    .map((entry) => ({
      phrase: entry.display,
      count: entry.count,
      share: totalNgrams === 0 ? 0 : roundHalfUp((entry.count / totalNgrams) * 100, 2),
    }))
    .sort((a, b) => (b.count - a.count) || collator.compare(a.phrase, b.phrase));

  return { ok: true, rows, totalWords, totalNgrams, distinctPhrases: counts.size };
}
