/**
 * The text drawer — six of the seven text tools (the seventh, diff, is its own
 * module because Myers is 250 lines on its own), and one file because they all
 * stand on the same three things and would otherwise carry three copies each:
 * the Serbian transliteration table, counting in CODEPOINTS rather than in
 * UTF-16 units, and the refusal grammar the rest of the tool drawer already
 * uses (`parseToolNumber` returns `null` rather than guessing; nothing here
 * repairs input behind the user's back either).
 *
 * **Codepoints, never `.length`.** Every width, every truncation and every
 * comparison in this file counts codepoints. `"š".length` happens to be 1 and
 * `"👍".length` is 2, so a table column padded by `.length` is visibly crooked
 * the first time an emoji lands in it and a slug truncated by `.length` can cut
 * a surrogate pair in half and produce a string that is not valid text. This is
 * still not display WIDTH — a grapheme cluster can be several codepoints and an
 * East Asian glyph is two columns wide — and nothing here claims it is; the
 * padding is a courtesy to whoever reads the markdown source, and the table
 * renders correctly either way.
 *
 * **Randomness arrives through a port.** `lorem` and `shuffleLines` are the two
 * tools that need it, and both take a `RandomPort` so a test can hand them a
 * scripted byte stream and assert an exact answer. Reaching for `crypto`
 * directly would make both tools untestable except statistically, which is a
 * way of saying untested.
 *
 * **No user-facing prose lives here.** `explainPattern` returns STRUCTURE with
 * stable kind ids and the Serbian text comes from the strings table, because
 * this package is where the app's copy must not be — a Serbian sentence baked
 * into core is a string i18n can never reach.
 */

/** How many bytes to pull from the port at a time; every draw costs four. */
const DRAW_BUFFER = 256;

/** A pull-one-byte-at-a-time view over a `RandomPort`, refilling in blocks. */
function byteStream(random: RandomPort): () => number {
  // Annotated, not inferred: `new Uint8Array(0)` narrows to the ArrayBuffer-backed
  // form and a port is free to hand back a view over any buffer kind.
  let buffer: Uint8Array = new Uint8Array(0);
  let offset = 0;
  return () => {
    if (offset >= buffer.length) {
      buffer = random.bytes(DRAW_BUFFER);
      offset = 0;
      // A port that yields nothing is a broken caller, not bad user input.
      if (buffer.length === 0) throw new Error("RandomPort returned no bytes");
    }
    const byte = buffer[offset];
    offset += 1;
    return byte ?? 0;
  };
}

/** 2³², the size of the draw `pickBelow` rejects from. */
const DRAW_RANGE = 0x1_0000_0000;

/**
 * A uniform integer in `[0, bound)`.
 *
 * Rejection sampling, not `draw % bound`. Plain modulo of a 32-bit draw is
 * biased toward the low indices whenever `bound` does not divide 2³² — with a
 * 60-word vocabulary the first 16 words come up measurably more often — and the
 * bias is invisible in any test that only checks „it produced a word". Draws
 * that fall in the ragged top of the range are thrown away instead.
 */
function pickBelow(next: () => number, bound: number): number {
  if (bound <= 1) return 0;
  const limit = DRAW_RANGE - (DRAW_RANGE % bound);
  for (;;) {
    const draw = next() * 0x100_0000 + next() * 0x1_0000 + next() * 0x100 + next();
    if (draw < limit) return draw % bound;
  }
}

/** An integer in `[min, max]`, both ends included. */
function pickBetween(next: () => number, min: number, max: number): number {
  return min + pickBelow(next, max - min + 1);
}

/** How many CODEPOINTS a string is — see the module note on why never `.length`. */
import { webCryptoRandom, type RandomPort } from "./random.js";

export function codepointLength(text: string): number {
  return [...text].length;
}

/**
 * Text split into lines, with the terminator discarded and the final newline
 * NOT counted as an extra empty line: `"a\nb\n"` and `"a\nb"` both give
 * `["a", "b"]`.
 *
 * That last part is a decision, not an accident. `"a\nb\n".split("\n")` ends in
 * an empty string, and every tool downstream — sort, dedupe, number, wrap —
 * would then operate on a phantom line the user cannot see and cannot delete.
 * The information is not lost, it is relocated: whether a file ends in a newline
 * is a property of the FILE, which is exactly what `endsWithNewline` reports and
 * what the unified-diff writer turns into `\ No newline at end of file`.
 *
 * All three terminators are accepted, so a CRLF file and an LF file with the
 * same content give the same lines.
 */
export function splitLines(text: string): readonly string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\n|\r/u);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Whether the text ends in a line terminator — the half of the split that `splitLines` deliberately drops. */
export function endsWithNewline(text: string): boolean {
  return text.endsWith("\n") || text.endsWith("\r");
}

/** Lines back into text, joined by `delimiter` (a newline unless told otherwise). */
export function joinLines(lines: readonly string[], delimiter = "\n"): string {
  return lines.join(delimiter);
}

/**
 * Text split on an arbitrary delimiter.
 *
 * An EMPTY delimiter yields the whole text as one entry rather than exploding
 * it. `"👍".split("")` returns two lone surrogates — two strings that are not
 * text and that no later step can put back together — so „split on nothing" is
 * refused as the no-op it should have been. A caller that genuinely wants
 * characters wants codepoints, and `[...text]` is the honest spelling of that.
 */
export function splitToLines(text: string, delimiter: string): readonly string[] {
  if (delimiter === "") return [text];
  return text.split(delimiter);
}

// ---------------------------------------------------------------------------
// Serbian transliteration, and the slug built on it
// ---------------------------------------------------------------------------

/** Matches one uppercase letter. Never given the `g` flag: a shared global regex carries `lastIndex` between calls. */
const UPPERCASE = /\p{Lu}/u;

/** Serbian Cyrillic to Serbian Latin, lowercase keys only; case is restored by the caller. */
const CYRILLIC_TO_LATIN: ReadonlyMap<string, string> = new Map([
  ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["ђ", "đ"],
  ["е", "e"], ["ж", "ž"], ["з", "z"], ["и", "i"], ["ј", "j"], ["к", "k"],
  ["л", "l"], ["љ", "lj"], ["м", "m"], ["н", "n"], ["њ", "nj"], ["о", "o"],
  ["п", "p"], ["р", "r"], ["с", "s"], ["т", "t"], ["ћ", "ć"], ["у", "u"],
  ["ф", "f"], ["х", "h"], ["ц", "c"], ["ч", "č"], ["џ", "dž"], ["ш", "š"],
]);

/**
 * Latin letters with no useful NFD decomposition, folded to ASCII by hand.
 *
 * `đ` is the reason this map exists. The one-liner everybody writes —
 * `text.normalize("NFD").replace(/\p{M}/gu, "")` — folds `š č ć ž` correctly
 * because those really are a letter plus a combining mark, and leaves `đ`
 * completely untouched because U+0111 LATIN SMALL LETTER D WITH STROKE has no
 * decomposition at all. The stripping step that follows then deletes it as a
 * non-ASCII character, so `Đorđe` comes out `ore`. That is the bug this table
 * exists to make impossible, and the reason `đ` maps to two letters rather than
 * one: the Serbian convention is `dj`, not `d`.
 */
const LATIN_FOLD: ReadonlyMap<string, string> = new Map([
  ["č", "c"], ["ć", "c"], ["ž", "z"], ["š", "s"], ["đ", "dj"],
  // Not Serbian, but they reach the same trap: none of these decomposes either.
  ["ø", "o"], ["ł", "l"], ["ß", "ss"], ["æ", "ae"], ["œ", "oe"], ["þ", "th"], ["ð", "d"],
]);

/** Whether the character AFTER a digraph is itself uppercase — the test that decides `Lj` from `LJ`. */
function nextIsUpper(next: string | undefined): boolean {
  return next !== undefined && UPPERCASE.test(next);
}

/** First codepoint uppercased, the rest left exactly as they are. */
function upperFirst(text: string): string {
  const chars = [...text];
  const head = chars[0];
  if (head === undefined) return "";
  return head.toUpperCase() + chars.slice(1).join("");
}

/**
 * Replaces every character a map covers, restoring case — and, for the entries
 * that expand to two letters, choosing between title case and full caps by
 * looking at the character that follows.
 *
 * That look-ahead is the whole subtlety. `Љубав` is `Ljubav` and `ЉУБАВ` is
 * `LJUBAV`; a table that stored one uppercase spelling would get one of them
 * wrong every time, and „LJubav" is the kind of output that makes a tool look
 * unfinished.
 */
function mapWithCase(text: string, table: ReadonlyMap<string, string>): string {
  const chars = [...text];
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    const lower = char.toLowerCase();
    const mapped = table.get(lower);
    if (mapped === undefined) {
      out += char;
      continue;
    }
    if (char === lower) {
      out += mapped;
      continue;
    }
    out += [...mapped].length === 1 || nextIsUpper(chars[i + 1])
      ? mapped.toUpperCase()
      : upperFirst(mapped);
  }
  return out;
}

/**
 * Serbian Cyrillic rewritten as Serbian Latin — WITH its diacritics, because
 * that is a lossless script change and folding is a separate, lossy decision
 * the caller may not want. `Ђорђе` becomes `Đorđe`; anything outside the
 * Serbian alphabet passes through untouched.
 */
export function cyrillicToLatin(text: string): string {
  return mapWithCase(text, CYRILLIC_TO_LATIN);
}

/**
 * Diacritics removed: `Đorđe` becomes `Djordje`, `café` becomes `cafe`.
 *
 * Two passes, and both are needed. The hand table first, because the letters it
 * covers have no decomposition (see `LATIN_FOLD`); then NFD plus a strip of
 * combining marks, which covers every accented letter Unicode does decompose
 * without this file having to enumerate them. Running only the second pass is
 * the classic mistake; running only the first would leave `é` alone.
 */
export function foldDiacritics(text: string): string {
  return mapWithCase(text, LATIN_FOLD)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

export interface SlugOptions {
  /** What goes between words. Default `"-"`. May be empty, or several characters. */
  readonly separator?: string;
  /** Lowercase the result. Default `true`. */
  readonly lowercase?: boolean;
  /** A codepoint ceiling; `0` (the default) means none. See the note on how it interacts with words. */
  readonly maxLength?: number;
  /** Fold each run of non-slug characters to ONE separator. Default `true`. */
  readonly collapse?: boolean;
}

/** Everything that is not a slug character; each match is a word boundary. */
const NON_SLUG = /[^A-Za-z0-9]/u;

/**
 * A URL-safe slug, aware that this app's users write in two scripts.
 *
 * `Đorđe Petrović` gives `djordje-petrovic`, and so does `Ђорђе Петровић` —
 * Cyrillic is transliterated first, then folded, so both spellings of a name
 * reach the same slug. That matters more than it looks: the two spellings are
 * the same person, and a slug that told them apart would silently create two
 * records where the user meant one.
 *
 * **`maxLength` never cuts a word in half, and the word wins the tie.** If the
 * first word alone is longer than the limit it is kept WHOLE and the result is
 * over the limit. The alternative — a hard cut — turns `dokumentacija` into
 * `dokum`, which is not a word, reads as a bug, and can collide with a real
 * slug; and the other alternative, returning nothing, is useless. So the limit
 * is a target, the word boundary is the rule, and this comment is where that is
 * written down rather than discovered.
 */
export function slugify(text: string, options: SlugOptions = {}): string {
  const { separator = "-", lowercase = true, maxLength = 0, collapse = true } = options;
  const latin = foldDiacritics(cyrillicToLatin(text));
  const cased = lowercase ? latin.toLowerCase() : latin;

  // `split` is safe with a shared non-global regex: it works on an internal
  // sticky clone and never touches this one's `lastIndex`.
  let parts = cased.split(NON_SLUG);
  if (collapse) parts = parts.filter((part) => part !== "");
  else {
    // Without collapsing, every stripped character is still its own boundary —
    // but a leading or trailing separator is never what anyone wanted.
    while (parts[0] === "") parts.shift();
    while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  }

  if (maxLength > 0) parts = takeWithinLength(parts, separator, maxLength);
  return parts.join(separator);
}

/** As many leading words as fit in `maxLength` codepoints once joined — always at least one. */
function takeWithinLength(
  parts: readonly string[],
  separator: string,
  maxLength: number,
): string[] {
  const separatorLength = codepointLength(separator);
  const kept: string[] = [];
  let length = 0;
  for (const part of parts) {
    const addition = (kept.length === 0 ? 0 : separatorLength) + codepointLength(part);
    if (kept.length > 0 && length + addition > maxLength) break;
    kept.push(part);
    length += addition;
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Identifier tokenising, and the ten case formats built on it
// ---------------------------------------------------------------------------

const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * A combining mark — Unicode category `\p{M}` — the codepoints that decorate
 * the letter before them instead of standing as characters in their own
 * right: an accent, a tone, a cedilla written as its own codepoint rather
 * than folded into a precomposed one. `\p{M}` is neither `\p{L}` nor `\p{N}`,
 * so `ALPHANUMERIC` does not match it and never should — a mark has no
 * identity of its own to classify — but it must not be treated as an ordinary
 * separator either. `tokenizeIdentifier` and `breaksBefore` both special-case
 * it rather than folding it into `ALPHANUMERIC` outright, because a mark can
 * never itself START a token or CAUSE a break; it can only ride along on the
 * token that is already open.
 *
 * **Attaching the mark, not normalising the input to NFC first.** The other
 * shape this fix could have taken is `text.normalize("NFC")` at the top of
 * `tokenizeIdentifier`, which would turn `é` (NFD: `e` + U+0301) back into one
 * codepoint before any of this runs. That looks simpler, and for `café` it
 * would even work — but NFC composition is only defined for the pairs Unicode
 * chose to give a precomposed codepoint, and plenty of legitimate letter+mark
 * sequences have none: `n` + U+0329 COMBINING VERTICAL LINE BELOW (a syllabic
 * consonant marker) normalises to itself, still two codepoints, under NFC.
 * A normalise-first fix would therefore still need this exact
 * attach-to-the-open-token fallback for whatever NFC could not compose, which
 * makes it two mechanisms doing one job instead of one. Attaching the mark
 * during tokenising handles every case — composable or not — with a single
 * rule, and it never rewrites the caller's string into a codepoint sequence
 * they did not type, which matches this module's stance elsewhere (see
 * `foldDiacritics`) that normalisation is a deliberate, visible step taken by
 * a function whose whole job is exactly that — not something the tokeniser
 * does to every string that passes through it.
 */
const MARK = /\p{M}/u;

function isUpper(char: string): boolean {
  return UPPERCASE.test(char);
}

/** A letter that is not uppercase — which includes scripts with no case at all, and is the point. */
function isLowerLetter(char: string): boolean {
  return LETTER.test(char) && !UPPERCASE.test(char);
}

function isDigit(char: string): boolean {
  return DIGIT.test(char);
}

/**
 * The nearest character before `index` that is not itself a combining mark.
 *
 * `café` typed on a system that produces NFD (`e` + U+0301, two codepoints)
 * has to classify exactly like the NFC spelling (`é`, one codepoint) for
 * `breaksBefore`'s rules to agree with each other on where a word starts —
 * `chars[index - 1]` would hand back the mark itself, which has no case and
 * no digit-ness, and silently disable rule 1 and rule 3 for every accented
 * letter that happens to sit right before the boundary. Walking back over a
 * whole run of marks also covers a letter with several stacked accents.
 */
function baseBefore(chars: readonly string[], index: number): string {
  let i = index - 1;
  while (i >= 0 && MARK.test(chars[i] ?? "")) i -= 1;
  return chars[i] ?? "";
}

/**
 * The mirror of `baseBefore`: the character after `index`, skipping any marks
 * that decorate `chars[index]` itself.
 */
function baseAfter(chars: readonly string[], index: number): string | undefined {
  let i = index + 1;
  while (MARK.test(chars[i] ?? "")) i += 1;
  return chars[i];
}

/**
 * Whether a token boundary falls immediately BEFORE `chars[i]`, given that the
 * character before it is also alphanumeric.
 *
 * Three rules, and the second is the one every naive implementation is missing:
 *
 * 1. lower-or-digit → UPPER. `parseURL` breaks after `parse`. This is the rule
 *    people write, and on its own it turns `XMLHttpRequest` into one token.
 * 2. UPPER → UPPER where the NEXT character is lower. An acronym runs up to the
 *    last capital that starts a word, so `XMLHttp` breaks between `L` and `H`,
 *    giving `XML` and `Http` rather than `XMLH` and `ttp`.
 * 3. letter → digit. `From2nd` breaks after `From`. Deliberately NOT symmetric:
 *    digit → lower does not break, which is what keeps `2nd` whole; digit →
 *    UPPER does break, by rule 1.
 *
 * Together these give `parseURLFrom2ndAPI` → `parse URL From 2nd API`, which is
 * the case that decides whether a converter is worth having.
 *
 * `previous` and `next` are read through `baseBefore`/`baseAfter`, never
 * `chars` directly, so a combining mark sitting next to the boundary is
 * invisible to all three rules — `café2` and its NFD spelling (`e` + U+0301,
 * then `2`) both break into the word and the digit, not just one of them.
 */
function breaksBefore(chars: readonly string[], index: number): boolean {
  const previous = baseBefore(chars, index);
  const char = chars[index] ?? "";
  const next = baseAfter(chars, index);
  if (isUpper(char) && (isLowerLetter(previous) || isDigit(previous))) return true;
  if (isUpper(char) && isUpper(previous) && next !== undefined && isLowerLetter(next)) return true;
  if (isDigit(char) && LETTER.test(previous)) return true;
  return false;
}

/**
 * An identifier or phrase split into its words. Every non-alphanumeric
 * character is a boundary and is discarded, so `-`, `_`, `.`, `/` and spaces
 * all behave the same; inside a run of alphanumerics the rules in
 * `breaksBefore` apply.
 *
 * Written and tested on its own because it is where all ten formats live or
 * die: every one of them is a trivial join once the tokens are right, and every
 * one of them is wrong in the same way if they are not.
 */
export function tokenizeIdentifier(text: string): readonly string[] {
  const chars = [...text];
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    if (MARK.test(char)) {
      // A combining mark decorates the letter before it — it is never a
      // boundary and never starts a token on its own, so it rides along on
      // whatever token is already open. This is what keeps `café` one token
      // whether the accent arrived precomposed (NFC, one codepoint) or as a
      // base letter plus a trailing mark (NFD, two codepoints): the mark
      // simply gets appended to `current` instead of falling into the
      // separator branch below, which used to discard it outright. A mark
      // with nothing open — leading input, or one straight after a real
      // separator — has no letter to decorate and is dropped, same as
      // before this fix: that is malformed input, not something to repair.
      if (current !== "") current += char;
      continue;
    }
    if (!ALPHANUMERIC.test(char)) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    if (current !== "" && breaksBefore(chars, i)) {
      tokens.push(current);
      current = "";
    }
    current += char;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/** The ten spellings the converter offers. */
export const CASE_FORMATS = [
  "camel",
  "pascal",
  "snake",
  "screamingSnake",
  "kebab",
  "train",
  "dot",
  "path",
  "sentence",
  "title",
] as const;

export type CaseFormat = (typeof CASE_FORMATS)[number];

/** First codepoint up, the rest down — so `API` becomes `Api` and `2nd` stays `2nd`. */
function capitalize(token: string): string {
  const chars = [...token];
  const head = chars[0];
  if (head === undefined) return "";
  return head.toUpperCase() + chars.slice(1).join("").toLowerCase();
}

/**
 * How each format joins tokens, and what it does to each one.
 *
 * `toUpperCase`/`toLowerCase` without a locale is correct here: no Serbian
 * letter has a locale-specific mapping. Turkish is the language where this
 * matters (`i` uppercases to `İ`), and passing `"sr-Latn"` would not protect
 * against it anyway — it would only be a claim this converter cannot keep, since
 * the text being converted is an identifier of unknown language.
 */
const CASE_RULES: Readonly<Record<CaseFormat, {
  readonly separator: string;
  readonly word: (token: string, index: number) => string;
}>> = {
  camel: { separator: "", word: (t, i) => (i === 0 ? t.toLowerCase() : capitalize(t)) },
  pascal: { separator: "", word: (t) => capitalize(t) },
  snake: { separator: "_", word: (t) => t.toLowerCase() },
  screamingSnake: { separator: "_", word: (t) => t.toUpperCase() },
  kebab: { separator: "-", word: (t) => t.toLowerCase() },
  train: { separator: "-", word: (t) => capitalize(t) },
  dot: { separator: ".", word: (t) => t.toLowerCase() },
  path: { separator: "/", word: (t) => t.toLowerCase() },
  sentence: { separator: " ", word: (t, i) => (i === 0 ? capitalize(t) : t.toLowerCase()) },
  title: { separator: " ", word: (t) => capitalize(t) },
};

/**
 * Tokens rendered in one of the ten formats.
 *
 * Acronym casing is NOT preserved — `XMLHttpRequest` in PascalCase is
 * `XmlHttpRequest`. That is the deliberate answer rather than a shortcut: the
 * tokeniser can tell that `XML` was written in capitals, but it cannot tell
 * whether that was an acronym or shouting, and a converter that kept some
 * tokens' original casing would produce output that is not in the format the
 * user asked for. One rule per format, applied to every token.
 */
export function convertTokens(tokens: readonly string[], format: CaseFormat): string {
  const rule = CASE_RULES[format];
  return tokens.map((token, index) => rule.word(token, index)).join(rule.separator);
}

/** Text tokenised and re-spelled in one go — the whole tool, in one call. */
export function convertCase(text: string, format: CaseFormat): string {
  return convertTokens(tokenizeIdentifier(text), format);
}

// ---------------------------------------------------------------------------
// GitHub-flavoured markdown tables, both directions
// ---------------------------------------------------------------------------

export const COLUMN_ALIGNS = ["none", "left", "center", "right"] as const;

export type ColumnAlign = (typeof COLUMN_ALIGNS)[number];

export interface MarkdownTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** One per column; a column past the end of this list is `"none"`. */
  readonly align: readonly ColumnAlign[];
}

/**
 * What `formatMarkdownTable` gives back. A refusal names the offending cell
 * rather than returning a bare `null`, because „somewhere in your 200-row grid
 * there is a newline" is not something a user can act on.
 *
 * `row` counts the header as row 0, so body row `i` is row `i + 1`.
 */
export type MarkdownTableResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: "line-break-in-cell" | "extra-cells";
      readonly row: number;
      readonly column: number;
    };

/** A cell as it appears in the source: `\` and `|` both escaped, in that order. */
function escapeCell(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}

/**
 * The inverse, in ONE left-to-right pass. Order matters and a second pass would
 * be wrong: an escaped backslash followed by an escaped pipe is four characters
 * in the source, and unescaping pipes first would turn the third of them into a
 * delimiter that was never there.
 */
function unescapeCell(text: string): string {
  return text.replace(/\\([\\|])/gu, "$1");
}

/** Minimum dashes in a delimiter cell — GFM's own floor, and what keeps `:-:` legible. */
const MIN_RULE = 3;

function padCell(text: string, width: number, align: ColumnAlign): string {
  const gap = Math.max(0, width - codepointLength(text));
  if (gap === 0) return text;
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

function ruleCell(width: number, align: ColumnAlign): string {
  const dashes = Math.max(MIN_RULE, width);
  if (align === "left") return `:${"-".repeat(dashes - 1)}`;
  if (align === "right") return `${"-".repeat(dashes - 1)}:`;
  if (align === "center") return `:${"-".repeat(dashes - 2)}:`;
  return "-".repeat(dashes);
}

/**
 * A grid written as a GFM table, cells padded so the source lines up.
 *
 * **A line break inside a cell is refused, a missing cell is supplied, an extra
 * cell is refused.** The three are not arbitrary. GFM has no spelling for a
 * newline inside a cell at all, so writing one would produce a table that stops
 * being a table — nothing is repaired, the cell is named and the caller decides.
 * A row SHORTER than the header is padded with empty cells, because GFM's own
 * reader does exactly that and no data is lost either way. A row LONGER than the
 * header is refused, because the only other option is dropping a cell the user
 * typed, and this drawer does not lose data quietly.
 *
 * Leading and trailing spaces inside a cell do not survive the round trip: GFM
 * strips them on the way back in and there is no escape for them. That is a
 * property of the format, it is asserted in the tests so it stays visible, and
 * it is the one place where `parse(format(grid))` is not the identity.
 */
export function formatMarkdownTable(table: MarkdownTable): MarkdownTableResult {
  const columns = table.header.length;
  if (columns === 0) return { ok: true, text: "" };

  const grid: string[][] = [[...table.header]];
  for (const row of table.rows) {
    if (row.length > columns) {
      return { ok: false, reason: "extra-cells", row: grid.length, column: columns };
    }
    grid.push(Array.from({ length: columns }, (_, index) => row[index] ?? ""));
  }

  for (let row = 0; row < grid.length; row += 1) {
    const cells = grid[row] ?? [];
    for (let column = 0; column < cells.length; column += 1) {
      if (/[\r\n]/u.test(cells[column] ?? "")) {
        return { ok: false, reason: "line-break-in-cell", row, column };
      }
    }
  }

  const escaped = grid.map((row) => row.map(escapeCell));
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(MIN_RULE, ...escaped.map((row) => codepointLength(row[column] ?? ""))));
  const alignOf = (column: number): ColumnAlign => table.align[column] ?? "none";

  const cell = (text: string, column: number): string =>
    padCell(text, widths[column] ?? 0, alignOf(column));
  const lines = escaped.map((row) => `| ${row.map(cell).join(" | ")} |`);
  const rule = `| ${widths.map((w, column) => ruleCell(w, alignOf(column))).join(" | ")} |`;
  lines.splice(1, 0, rule);

  return { ok: true, text: lines.join("\n") };
}

/** Splits one table line into cells, treating `\|` as content and a bare `|` as the delimiter. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  const chars = [...line];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    if (char === "\\" && i + 1 < chars.length) {
      current += char + (chars[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

/** Removes the optional outer pipes, leaving an escaped trailing `\|` in place. */
function stripOuterPipes(line: string): string {
  let inner = line;
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) {
    const backslashes = /\\*$/u.exec(inner.slice(0, -1))?.[0]?.length ?? 0;
    if (backslashes % 2 === 0) inner = inner.slice(0, -1);
  }
  return inner;
}

const RULE_CELL = /^:?-+:?$/u;

function alignOfRule(cell: string): ColumnAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

/**
 * A GFM table read back into a grid, or `null` for text this is not.
 *
 * Refused rather than guessed at: fewer than two lines, a delimiter row whose
 * cells are not `:?-+:?`, a delimiter row with a different cell count than the
 * header, a blank line in the middle, and a body row with MORE cells than the
 * header. That last one mirrors `formatMarkdownTable` — GFM says to ignore the
 * excess, and ignoring it means silently discarding something the user wrote.
 * Short rows are padded, which is GFM's rule and loses nothing.
 *
 * Cells are trimmed and unescaped, so this is the exact inverse of the
 * formatter for any grid whose cells carry no edge whitespace.
 */
export function parseMarkdownTable(text: string): MarkdownTable | null {
  const lines = splitLines(text).map((line) => line.trim());
  while (lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2 || lines.some((line) => line === "")) return null;

  const cellsOf = (line: string): string[] =>
    splitRow(stripOuterPipes(line)).map((cell) => cell.trim());

  const header = cellsOf(lines[0] ?? "");
  const rule = cellsOf(lines[1] ?? "");
  if (rule.length !== header.length) return null;
  if (!rule.every((cell) => RULE_CELL.test(cell))) return null;

  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const cells = cellsOf(line);
    if (cells.length > header.length) return null;
    rows.push(
      Array.from({ length: header.length }, (_, index) => unescapeCell(cells[index] ?? "")),
    );
  }

  return { header: header.map(unescapeCell), rows, align: rule.map(alignOfRule) };
}

// ---------------------------------------------------------------------------
// Placeholder text
// ---------------------------------------------------------------------------

export const LOREM_VOCABULARIES = ["latin", "serbian"] as const;

export type LoremVocabulary = (typeof LOREM_VOCABULARIES)[number];

/** The classic set, in the order the canonical passage uses it. */
const LATIN_WORDS: readonly string[] = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
  "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore",
  "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud",
  "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea", "commodo",
  "consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate",
  "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur", "excepteur",
  "sint", "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui",
  "officia", "deserunt", "mollit", "anim", "id", "est", "laborum",
];

/**
 * A Serbian vocabulary, so a placeholder inside this app looks like the app.
 *
 * Nouns, adjectives and a few conjunctions mixed together on purpose: a
 * placeholder built from nouns alone reads as a word list rather than as text,
 * and the point of lorem is to show what a paragraph will LOOK like. The words
 * are ordinary and carry no meaning in sequence, which is the same contract the
 * Latin set has always had.
 */
const SERBIAN_WORDS: readonly string[] = [
  "vreme", "dan", "noć", "kuća", "grad", "reka", "put", "misao", "reč", "knjiga",
  "prozor", "vrata", "drvo", "nebo", "more", "planina", "polje", "svetlost",
  "senka", "ruka", "srce", "korak", "glas", "pesma", "priča", "pitanje",
  "odgovor", "razlog", "mesto", "trenutak", "godina", "jutro", "veče", "sunce",
  "kiša", "vetar", "sneg", "hleb", "voda", "prijatelj", "porodica", "posao",
  "škola", "ulica", "most", "park", "bašta", "cvet", "ptica", "boja", "oblik",
  "broj", "mera", "tišina", "radost", "nada", "snaga", "mir", "red", "promena",
  "početak", "kraj", "plan", "cilj", "znanje", "veština", "navika", "pravilo",
  "izbor", "prostor", "granica", "mali", "veliki", "tih", "brz", "spor", "nov",
  "star", "topao", "hladan", "jasan", "dubok", "širok", "blizak", "dalek",
  "i", "ali", "kao", "zbog", "preko", "pored", "ispod", "iznad", "između",
];

const VOCABULARIES: Readonly<Record<LoremVocabulary, readonly string[]>> = {
  latin: LATIN_WORDS,
  serbian: SERBIAN_WORDS,
};

/** The words the canonical passage opens with, when `classicOpening` is on. */
const CLASSIC_OPENING: readonly string[] = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
];

const WORDS_PER_SENTENCE_MIN = 4;
const WORDS_PER_SENTENCE_MAX = 12;
const PARAGRAPH_MIN = 3;
const PARAGRAPH_MAX = 6;

export interface LoremOptions {
  readonly vocabulary?: LoremVocabulary;
  /**
   * Start the first sentence with „Lorem ipsum dolor sit amet…".
   *
   * Honoured for `latin` and IGNORED for `serbian`, because Serbian has no
   * canonical placeholder opening and inventing one would be fabricating a
   * convention that does not exist. Defaults to `true`.
   */
  readonly classicOpening?: boolean;
  readonly random?: RandomPort;
}

/** A count the generator will act on: whole, non-negative, finite. Anything else generates nothing. */
function usableCount(count: number): number {
  if (!Number.isFinite(count) || count < 1) return 0;
  return Math.floor(count);
}

function pickWords(next: () => number, words: readonly string[], count: number): string[] {
  return Array.from({ length: count }, () => words[pickBelow(next, words.length)] ?? "");
}

/** `count` words, space-separated and uncapitalised — the raw material, not a sentence. */
export function loremWords(count: number, options: LoremOptions = {}): string {
  const { vocabulary = "latin", random = webCryptoRandom } = options;
  const wanted = usableCount(count);
  if (wanted === 0) return "";
  const words = VOCABULARIES[vocabulary];
  const opening = options.classicOpening !== false && vocabulary === "latin" ? CLASSIC_OPENING : [];
  const head = opening.slice(0, wanted);
  const tail = pickWords(byteStream(random), words, wanted - head.length);
  return [...head, ...tail].join(" ");
}

/**
 * `count` sentences, each capitalised and ended with a full stop, joined by a
 * space. Sentence length is drawn per sentence so the block has the ragged
 * right edge real text has; a fixed length reads as a table.
 */
export function loremSentences(count: number, options: LoremOptions = {}): string {
  const { vocabulary = "latin", random = webCryptoRandom } = options;
  const wanted = usableCount(count);
  if (wanted === 0) return "";
  const words = VOCABULARIES[vocabulary];
  const next = byteStream(random);
  const opening = options.classicOpening !== false && vocabulary === "latin";

  const sentences = Array.from({ length: wanted }, (_, index) => {
    const length = pickBetween(next, WORDS_PER_SENTENCE_MIN, WORDS_PER_SENTENCE_MAX);
    const head = index === 0 && opening ? CLASSIC_OPENING.slice(0, length) : [];
    const tail = pickWords(next, words, Math.max(0, length - head.length));
    return `${upperFirst([...head, ...tail].join(" "))}.`;
  });
  return sentences.join(" ");
}

/** `count` paragraphs, each of three to six sentences, separated by a blank line. */
export function loremParagraphs(count: number, options: LoremOptions = {}): string {
  const { vocabulary = "latin", random = webCryptoRandom } = options;
  const wanted = usableCount(count);
  if (wanted === 0) return "";
  const words = VOCABULARIES[vocabulary];
  const next = byteStream(random);
  const opening = options.classicOpening !== false && vocabulary === "latin";

  const paragraphs = Array.from({ length: wanted }, (_, paragraph) => {
    const sentenceCount = pickBetween(next, PARAGRAPH_MIN, PARAGRAPH_MAX);
    const sentences = Array.from({ length: sentenceCount }, (_, sentence) => {
      const length = pickBetween(next, WORDS_PER_SENTENCE_MIN, WORDS_PER_SENTENCE_MAX);
      const first = paragraph === 0 && sentence === 0 && opening;
      const head = first ? CLASSIC_OPENING.slice(0, length) : [];
      const tail = pickWords(next, words, Math.max(0, length - head.length));
      return `${upperFirst([...head, ...tail].join(" "))}.`;
    });
    return sentences.join(" ");
  });
  return paragraphs.join("\n\n");
}

// ---------------------------------------------------------------------------
// Line tools — each a small pure function over `readonly string[]`
// ---------------------------------------------------------------------------

export const LINE_SORT_MODES = ["lexicographic", "natural", "length", "collated"] as const;

export type LineSortMode = (typeof LINE_SORT_MODES)[number];

/**
 * Serbian sorting. `["sr-Latn", "sr"]` and never plain `"sr"`: the bare tag
 * resolves to the Cyrillic tailoring, which does not order Latin `š č ć ž đ`
 * the way a Serbian reader expects.
 */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);
const COLLATOR_CASELESS = new Intl.Collator(["sr-Latn", "sr"], { sensitivity: "accent" });

/**
 * Codepoint order, which is what `<` on strings only approximates.
 *
 * `"a" < "b"` compares UTF-16 code UNITS, so every astral character (codepoint
 * at or above U+10000, encoded as a surrogate pair starting at U+D800) sorts
 * before the private-use and CJK-compatibility blocks that live in
 * U+E000–U+FFFF, even though its codepoint is far higher. Nobody notices until
 * an emoji is in the list, and then the order is inexplicable.
 */
function compareCodepoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i]?.codePointAt(0) ?? 0;
    const y = right[i]?.codePointAt(0) ?? 0;
    if (x !== y) return x - y;
  }
  return left.length - right.length;
}

/**
 * Two digit runs compared as numbers, without ever becoming numbers.
 *
 * `Number("12345678901234567890123")` is not that integer, so a natural sort
 * that parses its chunks starts giving wrong answers at sixteen digits — on
 * hashes, ids and timestamps, which is exactly the kind of list somebody
 * natural-sorts. Leading zeros are dropped, then the longer run is the larger
 * number and equal lengths compare as text; both steps are exact at any length.
 */
function compareDigitRuns(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/u, "");
  const right = b.replace(/^0+(?=\d)/u, "");
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNatural(a: string, b: string): number {
  // Built per call: a `g` regex shared between calls carries `lastIndex`.
  const chunk = /\d+|\D+/gu;
  const left = a.match(chunk) ?? [];
  const right = b.match(chunk) ?? [];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i] ?? "";
    const y = right[i] ?? "";
    if (x === y) continue;
    const bothNumeric = /^\d/u.test(x) && /^\d/u.test(y);
    const order = bothNumeric ? compareDigitRuns(x, y) : compareCodepoints(x, y);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

export interface SortLinesOptions {
  readonly descending?: boolean;
  /** Off means `a` and `A` sort together. Default `true`. Ignored by `length`. */
  readonly caseSensitive?: boolean;
}

/**
 * Lines sorted one of four ways. The sort is STABLE (ES2019 guarantees it), so
 * lines that compare equal — two lines of the same length, two lines that differ
 * only in case under a caseless comparison — keep the order they were given in.
 * That is what makes sorting by length usable at all.
 */
export function sortLines(
  lines: readonly string[],
  mode: LineSortMode,
  options: SortLinesOptions = {},
): readonly string[] {
  const { descending = false, caseSensitive = true } = options;
  const fold = (line: string): string => (caseSensitive ? line : line.toLowerCase());
  const compare = (a: string, b: string): number => {
    if (mode === "length") return codepointLength(a) - codepointLength(b);
    if (mode === "natural") return compareNatural(fold(a), fold(b));
    if (mode === "collated") return (caseSensitive ? COLLATOR : COLLATOR_CASELESS).compare(a, b);
    return compareCodepoints(fold(a), fold(b));
  };
  const sorted = [...lines].sort(compare);
  return descending ? sorted.reverse() : sorted;
}

/** Lines in the opposite order. */
export function reverseLines(lines: readonly string[]): readonly string[] {
  return [...lines].reverse();
}

export interface DedupeOptions {
  /** Only collapse runs of identical NEIGHBOURS, the way `uniq` does. Default `false`. */
  readonly adjacentOnly?: boolean;
  readonly caseSensitive?: boolean;
}

/** Duplicates removed, first occurrence kept. */
export function dedupeLines(
  lines: readonly string[],
  options: DedupeOptions = {},
): readonly string[] {
  const { adjacentOnly = false, caseSensitive = true } = options;
  const key = (line: string): string => (caseSensitive ? line : line.toLowerCase());
  if (adjacentOnly) {
    return lines.filter((line, index) => index === 0 || key(line) !== key(lines[index - 1] ?? ""));
  }
  const seen = new Set<string>();
  return lines.filter((line) => {
    const value = key(line);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export interface NumberLinesOptions {
  readonly start?: number;
  readonly separator?: string;
  /** Right-align the numbers so the text starts in one column. Default `true`. */
  readonly pad?: boolean;
}

/**
 * Lines with their ordinal in front. The pad width is the widest number that
 * will actually be printed rather than the last one — with a negative start the
 * last number is the shortest, and padding to it would leave the first lines
 * hanging out of the column.
 */
export function numberLines(
  lines: readonly string[],
  options: NumberLinesOptions = {},
): readonly string[] {
  const { start = 1, separator = ". ", pad = true } = options;
  const labels = lines.map((_, index) => String(start + index));
  const width = pad ? Math.max(0, ...labels.map((label) => label.length)) : 0;
  return lines.map(
    (line, index) => `${(labels[index] ?? "").padStart(width, " ")}${separator}${line}`,
  );
}

/**
 * Lines in a random order, drawn through the port so a test can pin the result.
 * Fisher–Yates with an unbiased index: the „sort by a random comparator" trick
 * is not a shuffle at all — it produces a distribution that depends on the sort
 * implementation and leaves the first elements near where they started.
 */
export function shuffleLines(
  lines: readonly string[],
  random: RandomPort = webCryptoRandom,
): readonly string[] {
  const out = [...lines];
  const next = byteStream(random);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pickBelow(next, i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export const TRIM_SIDES = ["both", "start", "end"] as const;

export type TrimSide = (typeof TRIM_SIDES)[number];

/** Whitespace removed from one or both ends of every line. */
export function trimLines(lines: readonly string[], side: TrimSide = "both"): readonly string[] {
  if (side === "start") return lines.map((line) => line.trimStart());
  if (side === "end") return lines.map((line) => line.trimEnd());
  return lines.map((line) => line.trim());
}

/** Lines that are empty or nothing but whitespace, dropped. */
export function removeBlankLines(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.trim() !== "");
}

export interface AffixOptions {
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Text glued to the front and/or back of every line. */
export function affixLines(
  lines: readonly string[],
  options: AffixOptions = {},
): readonly string[] {
  const { prefix = "", suffix = "" } = options;
  return lines.map((line) => `${prefix}${line}${suffix}`);
}

/**
 * Greedy word wrap at `width` codepoints.
 *
 * A word longer than the width is never cut — it sits alone on its line and
 * overhangs, the same rule `slugify` follows and for the same reason: a cut word
 * is a different word. The leading whitespace of a line is carried onto its
 * continuation lines, so wrapping an indented block keeps the block. A width
 * below 1 is nothing to do rather than an error, and the lines come back
 * untouched.
 */
export function wrapLines(lines: readonly string[], width: number): readonly string[] {
  if (!Number.isFinite(width) || width < 1) return [...lines];
  const out: string[] = [];
  for (const line of lines) {
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? "";
    const words = line.slice(indent.length).split(/\s+/u).filter((word) => word !== "");
    if (words.length === 0) {
      out.push(line);
      continue;
    }
    const indentLength = codepointLength(indent);
    let current: string[] = [];
    let length = indentLength;
    for (const word of words) {
      const wordLength = codepointLength(word);
      if (current.length > 0 && length + 1 + wordLength > width) {
        out.push(indent + current.join(" "));
        current = [];
        length = indentLength;
      }
      length += (current.length > 0 ? 1 : 0) + wordLength;
      current.push(word);
    }
    if (current.length > 0) out.push(indent + current.join(" "));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The regex bench
// ---------------------------------------------------------------------------

export interface RegexMatch {
  /** UTF-16 offset, exactly what `RegExp.exec` reports. */
  readonly index: number;
  /** UTF-16 units, so `input.slice(index, index + length) === match` holds. */
  readonly length: number;
  readonly match: string;
  /** Numbered groups, group 1 first. An unmatched optional group is `undefined`, never `""`. */
  readonly groups: readonly (string | undefined)[];
  readonly named: Readonly<Record<string, string | undefined>>;
}

/** Why a run stopped. `"complete"` is the only one that means the answer is the whole answer. */
export const REGEX_STOPS = ["complete", "match-cap", "time-budget"] as const;

export type RegexStop = (typeof REGEX_STOPS)[number];

/** A pattern that will not be run, and the reason a user can act on. */
export type RegexRefusal =
  | { readonly ok: false; readonly reason: "invalid"; readonly message: string }
  | { readonly ok: false; readonly reason: "nested-quantifier"; readonly at: number };

export type RegexRunResult =
  | RegexRefusal
  | { readonly ok: true; readonly matches: readonly RegexMatch[]; readonly stop: RegexStop };

export type RegexReplaceResult =
  | RegexRefusal
  | {
      readonly ok: true;
      readonly text: string;
      readonly count: number;
      readonly stop: RegexStop;
    };

export const REGEX_MAX_MATCHES = 1000;
export const REGEX_TIME_BUDGET_MS = 250;

export interface RegexLimits {
  readonly maxMatches?: number;
  readonly timeBudgetMs?: number;
  /** Run a pattern this module would otherwise refuse. The user has to ask for it, in as many words. */
  readonly allowNestedQuantifier?: boolean;
  /** The clock, injected so the budget is testable without waiting for it. */
  readonly now?: () => number;
}

interface Quantifier {
  /** Characters consumed, lazy marker included. */
  readonly length: number;
  readonly min: number;
  /** Absent means unbounded — `*`, `+` and `{n,}` all leave it off. */
  readonly max?: number;
  readonly lazy: boolean;
}

const BRACED_QUANTIFIER = /^\{(\d+)(,(\d*))?\}/u;

/** The quantifier starting at `index`, or `null` if there is not one there. */
function quantifierAt(pattern: string, index: number): Quantifier | null {
  const char = pattern[index];
  let min: number;
  let max: number | undefined;
  let length: number;
  if (char === "*") {
    min = 0;
    length = 1;
  } else if (char === "+") {
    min = 1;
    length = 1;
  } else if (char === "?") {
    min = 0;
    max = 1;
    length = 1;
  } else if (char === "{") {
    const braced = BRACED_QUANTIFIER.exec(pattern.slice(index));
    if (braced === null) return null;
    min = Number(braced[1]);
    // `{2}` is exactly two; `{2,}` is two or more; `{2,5}` is a range.
    max = braced[2] === undefined ? min : braced[3] === "" ? undefined : Number(braced[3]);
    length = braced[0].length;
  } else {
    return null;
  }
  const lazy = pattern[index + length] === "?";
  return {
    length: length + (lazy ? 1 : 0),
    min,
    ...(max === undefined ? {} : { max }),
    lazy,
  };
}

/** Whether the body of a group contains a quantifier with no upper bound, ignoring character classes. */
function hasUnboundedQuantifier(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "*" || char === "+") return true;
    if (char === "{" && quantifierAt(body, i)?.max === undefined) return true;
  }
  return false;
}

/**
 * The index of an unbounded quantifier applied to a group that already contains
 * one — `(a+)+`, `(\w+\s?)*`, `(?:x*)*` — or `null` if the pattern has no such
 * shape.
 *
 * **This is the only real guard against catastrophic backtracking, and it has to
 * run before the engine does.** JavaScript regular expressions cannot be
 * interrupted: once `exec` starts, nothing in the language can stop it, so a
 * time budget checked between matches — which this module also has — cannot save
 * an app from a single `(a+)+$` against forty non-matching characters. That one
 * takes longer than the age of the universe, in the renderer, with the window
 * frozen. Refusing the SHAPE is the only defence that works.
 *
 * It does not catch everything, and pretending otherwise would be worse than
 * saying so: `(a|a)*` blows up the same way through overlapping alternatives and
 * is not detected here, because deciding that in general is deciding regular-
 * expression ambiguity. The match cap and the time budget are what remain behind
 * this, and they are backstops, not guarantees.
 */
export function findNestedQuantifier(pattern: string): number | null {
  const open: number[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "(") {
      open.push(i);
      continue;
    }
    if (char !== ")") continue;
    const start = open.pop();
    if (start === undefined) continue;
    const applied = quantifierAt(pattern, i + 1);
    if (applied === null || applied.max !== undefined) continue;
    if (hasUnboundedQuantifier(pattern.slice(start + 1, i))) return i + 1;
  }
  return null;
}

/** A compiled pattern, or the refusal that stopped it being one. */
function compileRegex(
  pattern: string,
  flags: string,
  limits: RegexLimits,
): { readonly ok: true; readonly regex: RegExp } | RegexRefusal {
  // `g` is added rather than required: the exec loop needs it, and whether the
  // USER asked for it is a separate question that only `replaceRegex` cares
  // about. Deduplicated because a repeated flag is itself a SyntaxError.
  const wanted = [...new Set([...flags, "g"])].join("");
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, wanted);
  } catch (error) {
    // The engine's own message names the position and the problem far better
    // than anything this module could reconstruct. Never rethrown: a pattern
    // half-typed into a field is user input, not a caller bug.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "invalid", message };
  }
  if (limits.allowNestedQuantifier !== true) {
    const at = findNestedQuantifier(pattern);
    if (at !== null) return { ok: false, reason: "nested-quantifier", at };
  }
  return { ok: true, regex };
}

/** How far past a zero-length match `lastIndex` must move to stay on a codepoint. */
function advanceIndex(input: string, index: number, unicode: boolean): number {
  if (!unicode) return index + 1;
  const point = input.codePointAt(index);
  return index + (point !== undefined && point > 0xffff ? 2 : 1);
}

function toMatch(found: RegExpExecArray): RegexMatch {
  const whole = found[0];
  const named: Record<string, string | undefined> = {};
  if (found.groups !== undefined) {
    for (const [key, value] of Object.entries(found.groups)) named[key] = value;
  }
  return { index: found.index, length: whole.length, match: whole, groups: found.slice(1), named };
}

interface Sweep {
  readonly matches: readonly RegexMatch[];
  readonly stop: RegexStop;
}

/**
 * Every match, up to the caps.
 *
 * The zero-length step is the bug this loop exists to not have. `/a*\/g` matches
 * the empty string at every position, and `exec` does not advance `lastIndex`
 * past an empty match — the loop runs forever unless the caller moves it. Moving
 * it by ONE is the second half of the same bug: under the `u` flag that lands in
 * the middle of a surrogate pair and the engine throws, so the step is a whole
 * codepoint.
 */
function sweep(regex: RegExp, input: string, limits: RegexLimits, single: boolean): Sweep {
  const {
    maxMatches = REGEX_MAX_MATCHES,
    timeBudgetMs = REGEX_TIME_BUDGET_MS,
    now = () => Date.now(),
  } = limits;
  const unicode = regex.flags.includes("u") || regex.flags.includes("v");
  const deadline = now() + timeBudgetMs;
  const matches: RegexMatch[] = [];
  regex.lastIndex = 0;
  for (;;) {
    if (matches.length >= maxMatches) return { matches, stop: "match-cap" };
    if (now() > deadline) return { matches, stop: "time-budget" };
    const found = regex.exec(input);
    if (found === null) return { matches, stop: "complete" };
    matches.push(toMatch(found));
    if (single) return { matches, stop: "complete" };
    if (found[0] === "") regex.lastIndex = advanceIndex(input, regex.lastIndex, unicode);
  }
}

/**
 * A pattern run against text: every match with where it is, what it caught, and
 * what its groups caught. Always every match, regardless of whether the user
 * typed `g` — listing them is the whole point of the bench.
 */
export function runRegex(
  pattern: string,
  flags: string,
  input: string,
  limits: RegexLimits = {},
): RegexRunResult {
  const compiled = compileRegex(pattern, flags, limits);
  if (!compiled.ok) return compiled;
  const { matches, stop } = sweep(compiled.regex, input, limits, false);
  return { ok: true, matches, stop };
}

/**
 * `$…` expanded against one match.
 *
 * Hand-written rather than delegated to `String.replace` so the whole preview
 * runs inside the same caps as the match list, and so the two-digit rule is
 * explicit: `$12` is group 12 when there is one and group 1 followed by a `2`
 * when there is not, which is what the engine does and what nobody guesses
 * right. `$<name>` against a pattern with NO named groups stays literal, again
 * matching the engine — there, `$<` only becomes special once the pattern has
 * named groups at all.
 */
function expandReplacement(template: string, match: RegexMatch): string {
  const hasNamed = Object.keys(match.named).length > 0;
  let out = "";
  for (let i = 0; i < template.length; i += 1) {
    const char = template[i];
    if (char !== "$") {
      out += char ?? "";
      continue;
    }
    const next = template[i + 1];
    if (next === "$") {
      out += "$";
      i += 1;
      continue;
    }
    if (next === "&") {
      out += match.match;
      i += 1;
      continue;
    }
    if (next === "<" && hasNamed) {
      const close = template.indexOf(">", i + 2);
      if (close !== -1) {
        out += match.named[template.slice(i + 2, close)] ?? "";
        i = close;
        continue;
      }
    }
    const two = template.slice(i + 1, i + 3);
    if (/^\d\d$/u.test(two) && Number(two) >= 1 && Number(two) <= match.groups.length) {
      out += match.groups[Number(two) - 1] ?? "";
      i += 2;
      continue;
    }
    const one = next !== undefined && /^\d$/u.test(next) ? Number(next) : 0;
    if (one >= 1 && one <= match.groups.length) {
      out += match.groups[one - 1] ?? "";
      i += 1;
      continue;
    }
    out += "$";
  }
  return out;
}

/**
 * The text as the replacement would leave it, plus how many replacements that
 * was. A PREVIEW: nothing is written anywhere, and the count is what tells the
 * user whether the pattern caught what they meant.
 *
 * Unlike `runRegex` this one honours the `g` flag, because that is the flag's
 * meaning here — without it `String.replace` replaces the first match only, and
 * a preview that quietly replaced all of them would be previewing a different
 * operation than the one the user is about to run.
 */
export function replaceRegex(
  pattern: string,
  flags: string,
  input: string,
  replacement: string,
  limits: RegexLimits = {},
): RegexReplaceResult {
  const compiled = compileRegex(pattern, flags, limits);
  if (!compiled.ok) return compiled;
  const { matches, stop } = sweep(compiled.regex, input, limits, !flags.includes("g"));

  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += input.slice(cursor, match.index);
    out += expandReplacement(replacement, match);
    cursor = match.index + match.length;
  }
  out += input.slice(cursor);
  return { ok: true, text: out, count: matches.length, stop };
}

/** The structural pieces `explainPattern` reports. Ids are stable: the strings table keys Serbian copy off them. */
export const REGEX_PART_KINDS = [
  "anchor-start",
  "anchor-end",
  "word-boundary",
  "not-word-boundary",
  "group-open",
  "named-group-open",
  "non-capturing-group-open",
  "lookahead",
  "negative-lookahead",
  "lookbehind",
  "negative-lookbehind",
  "group-close",
  "alternation",
  "class",
  "negated-class",
  "any",
  "digit",
  "not-digit",
  "word-char",
  "not-word-char",
  "whitespace",
  "not-whitespace",
  "backreference",
  "literal",
  "quantifier",
] as const;

export type RegexPartKind = (typeof REGEX_PART_KINDS)[number];

export interface RegexPart {
  readonly kind: RegexPartKind;
  /** The exact source slice, so a surface can highlight it in the pattern. */
  readonly text: string;
  readonly index: number;
  /** Quantifiers only. */
  readonly min?: number;
  /** Quantifiers only; absent means unbounded. */
  readonly max?: number;
  readonly lazy?: boolean;
  /** Named groups and named backreferences. */
  readonly name?: string;
  /** Capturing groups: which number this one is. */
  readonly group?: number;
}

/** `\x` sequences that name a character class rather than an escaped literal. */
const ESCAPE_KINDS: Readonly<Record<string, RegexPartKind>> = {
  d: "digit",
  D: "not-digit",
  w: "word-char",
  W: "not-word-char",
  s: "whitespace",
  S: "not-whitespace",
  b: "word-boundary",
  B: "not-word-boundary",
};

const GROUP_OPENERS: readonly (readonly [string, RegexPartKind])[] = [
  ["(?<=", "lookbehind"],
  ["(?<!", "negative-lookbehind"],
  ["(?:", "non-capturing-group-open"],
  ["(?=", "lookahead"],
  ["(?!", "negative-lookahead"],
];

/** The index just past the `]` that closes a class opened at `start`, or the end of the pattern. */
function classEnd(pattern: string, start: number): number {
  for (let i = start + 1; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "]") return i + 1;
  }
  return pattern.length;
}

/**
 * A pattern walked into its top-level pieces — anchors, groups, classes,
 * quantifiers, literals — so a surface can print a plain-language reading of it.
 *
 * A token walk and NOT a parser: it does not build a tree, does not validate,
 * and does not try to say what the pattern MEANS. It says what is in it and in
 * what order, which is the thing a person staring at `^(?<id>\d{3,})-\w+$` needs
 * and the thing they can check against their own reading. A real parser would be
 * a second regex engine, and a second regex engine is a second set of bugs.
 *
 * A quantifier that follows a run of plain characters splits the last codepoint
 * off into its own piece, because `ab+` repeats the `b` and not the `ab` — the
 * one place where reporting the run whole would be actively misleading.
 */
export function explainPattern(pattern: string): readonly RegexPart[] {
  const parts: RegexPart[] = [];
  let literal = "";
  let literalAt = 0;
  let groupNumber = 0;

  const flush = (): void => {
    if (literal === "") return;
    parts.push({ kind: "literal", text: literal, index: literalAt });
    literal = "";
  };
  const startLiteral = (index: number): void => {
    if (literal === "") literalAt = index;
  };

  for (let i = 0; i < pattern.length; ) {
    const char = pattern[i] ?? "";
    const quantifier = literal !== "" || parts.length > 0 ? quantifierAt(pattern, i) : null;
    if (quantifier !== null) {
      const chars = [...literal];
      if (chars.length > 1) {
        const last = chars[chars.length - 1] ?? "";
        literal = chars.slice(0, -1).join("");
        flush();
        parts.push({ kind: "literal", text: last, index: i - last.length });
      } else {
        flush();
      }
      parts.push({
        kind: "quantifier",
        text: pattern.slice(i, i + quantifier.length),
        index: i,
        min: quantifier.min,
        ...(quantifier.max === undefined ? {} : { max: quantifier.max }),
        lazy: quantifier.lazy,
      });
      i += quantifier.length;
      continue;
    }

    if (char === "^" || char === "$" || char === "." || char === "|" || char === ")") {
      flush();
      const kind: RegexPartKind =
        char === "^" ? "anchor-start"
        : char === "$" ? "anchor-end"
        : char === "." ? "any"
        : char === "|" ? "alternation"
        : "group-close";
      parts.push({ kind, text: char, index: i });
      i += 1;
      continue;
    }

    if (char === "[") {
      flush();
      const end = classEnd(pattern, i);
      const text = pattern.slice(i, end);
      parts.push({ kind: text.startsWith("[^") ? "negated-class" : "class", text, index: i });
      i = end;
      continue;
    }

    if (char === "(") {
      flush();
      const named = /^\(\?<([A-Za-z_$][\w$]*)>/u.exec(pattern.slice(i));
      if (named !== null) {
        groupNumber += 1;
        parts.push({
          kind: "named-group-open",
          text: named[0] ?? "",
          index: i,
          name: named[1] ?? "",
          group: groupNumber,
        });
        i += (named[0] ?? "").length;
        continue;
      }
      const opener = GROUP_OPENERS.find(([prefix]) => pattern.startsWith(prefix, i));
      if (opener !== undefined) {
        parts.push({ kind: opener[1], text: opener[0], index: i });
        i += opener[0].length;
        continue;
      }
      groupNumber += 1;
      parts.push({ kind: "group-open", text: "(", index: i, group: groupNumber });
      i += 1;
      continue;
    }

    if (char === "\\") {
      const after = pattern[i + 1] ?? "";
      const kind = ESCAPE_KINDS[after];
      if (kind !== undefined) {
        flush();
        parts.push({ kind, text: pattern.slice(i, i + 2), index: i });
        i += 2;
        continue;
      }
      const namedBack = /^\\k<([A-Za-z_$][\w$]*)>/u.exec(pattern.slice(i));
      if (namedBack !== null) {
        flush();
        parts.push({
          kind: "backreference",
          text: namedBack[0] ?? "",
          index: i,
          name: namedBack[1] ?? "",
        });
        i += (namedBack[0] ?? "").length;
        continue;
      }
      const numbered = /^\\([1-9]\d*)/u.exec(pattern.slice(i));
      if (numbered !== null) {
        flush();
        parts.push({
          kind: "backreference",
          text: numbered[0] ?? "",
          index: i,
          group: Number(numbered[1]),
        });
        i += (numbered[0] ?? "").length;
        continue;
      }
      // Anything else after a backslash is that character, taken literally.
      startLiteral(i);
      literal += after;
      i += 2;
      continue;
    }

    startLiteral(i);
    literal += char;
    i += 1;
  }
  flush();
  return parts;
}
