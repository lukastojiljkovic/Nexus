import {
  ASCII_CODES,
  codesFromText,
  formatAsciiCode,
  foldSearchText,
  parseAsciiCode,
  textFromCodes,
  textToCodePoints,
  type AsciiChar,
  type AsciiRadix,
} from "@nexus/core";

/**
 * The ASCII tab's pure half: which rows a search leaves, how they are ordered,
 * and the two conversions the engine does not spell out as one call.
 *
 * Everything here is total: a query that matches nothing answers an empty list
 * rather than throwing, a character that is not ASCII answers the code points
 * that are not, and a code that will not read answers the token it could not
 * read. The engine's own refusals are the reason — `parseAsciiCode` answers
 * `null` for `0x41` rather than reading it as `0`, and `codesFromText` answers
 * `null` for `č` rather than garbling it — so this module's job is to keep that
 * refusal visible on screen instead of turning it into a `?`.
 */

/** The ordering the table can be read in. */
export type AsciiOrder = "code" | "name";

/**
 * The bases a CODE is matched in: the three the table has a column for.
 *
 * Octal is deliberately absent, and it is not an oversight — the engine reads it
 * (`ASCII_RADICES`) and the conversion's own picker offers it, but a table whose
 * columns are decimal, hex and binary should not answer a query with a row the
 * query does not explain. Under a four-base rule `41` finds 33 as well, whose
 * octal form is `41`; nothing on screen then says why.
 */
const TABLE_RADICES = [10, 16, 2] as const;

/**
 * The rows a query leaves, in table order.
 *
 * A CODE is matched by EQUALITY against the form the TABLE DRAWS — decimal
 * unpadded, hex and binary zero-padded to the width the column is written in — so
 * a reader who copies `01000001` out of the binary column finds the row it came
 * from, not nothing. It is what makes `65` find the decimal 65 and the hex 65
 * (decimal 101, and both are shown, each with its own code beside it).
 *
 * The NAME is matched from the start of a word, and only from TWO characters up:
 * a one-letter query is a CHARACTER search in a table whose column is a character
 * (`a` finds `A` and `a`, and not the two dozen names that contain the letter),
 * while `tab` finds the two rows whose names begin with those letters — CHARACTER
 * TABULATION and LINE TABULATION — which is what a reader typing three letters
 * into a table of names wants. A substring rule instead would make `5` match
 * every code containing a five, which is a search that answers a page.
 *
 * Folding is `foldSearchText`'s: the same fold the settings filter and the tool
 * drawer use, so a diacritic typed into this field matches the accented spelling
 * rather than refusing it.
 */
export function searchAsciiRows(query: string): readonly AsciiChar[] {
  const needle = foldSearchText(query);
  if (needle === "") return ASCII_CODES;
  return ASCII_CODES.filter((entry) => matches(entry, needle));
}

function matches(entry: AsciiChar, needle: string): boolean {
  for (const radix of TABLE_RADICES) {
    if (formatAsciiCode(entry.code, radix, true) === needle) return true;
  }
  // The character itself, which is what somebody who pasted one into the field
  // is looking for. `foldSearchText` maps the apostrophe's typographic twin to
  // the ASCII one, so both spellings of `'` find the row.
  if (entry.code >= 32 && foldSearchText(entry.char) === needle) return true;
  return needle.length >= 2 && nameMatches(entry.name, needle);
}

/**
 * Whether every word of the query begins a word of the standard's name.
 *
 * A PREFIX rule rather than a substring one, because a name column is read in
 * words: `tab` has to find `CHARACTER TABULATION` and `5` has to find `DEVICE
 * CONTROL FIVE` and nothing else. An `includes` rule answers a one-letter query
 * with most of the table — the letter `a` is inside forty of the names — which
 * is a search that has stopped discriminating at exactly the length where a
 * person is still typing.
 */
function nameMatches(name: string, needle: string): boolean {
  const words = foldSearchText(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  return needle
    .split(" ")
    .filter((token) => token !== "")
    .every((token) => words.some((word) => word.startsWith(token)));
}

/**
 * The same rows in the requested order.
 *
 * `compareNames` is handed in rather than constructed here, so the page supplies
 * the ACTIVE locale's collator (`Intl.Collator(["sr-Latn", "sr"])` through the
 * shell's own factory) and this module stays free of `Intl` construction — and
 * of a decision about which language the table is in. Ties are broken by code, so
 * the order is total and the table does not shuffle between two renders.
 */
export function sortAsciiRows(
  rows: readonly AsciiChar[],
  order: AsciiOrder,
  compareNames: (a: string, b: string) => number,
): readonly AsciiChar[] {
  if (order === "code") return rows;
  return [...rows].sort((a, b) => compareNames(a.name, b.name) || a.code - b.code);
}

/** A character as its ASCII code, or the code points that are not ASCII. */
export type AsciiCodesResult =
  | { readonly ok: true; readonly codes: readonly number[] }
  | { readonly ok: false; readonly codePoints: readonly number[] };

/**
 * Text as codes, or the code points that refused it.
 *
 * The refusal carries the UNICODE code points of the characters that are not
 * ASCII, because that is the answer to the question the refusal raises: „it is
 * not ASCII — what is it?". `č` is U+010D and an emoji is one code point, not
 * two halves of a UTF-16 pair, which is why the points come from
 * `textToCodePoints` rather than from `charCodeAt`.
 */
export function asciiCodesFromText(text: string): AsciiCodesResult {
  const codes = codesFromText(text);
  if (codes !== null) return { ok: true, codes };
  const offending: number[] = [];
  for (let index = 0; index < [...text].length; index += 1) {
    const character = [...text][index] as string;
    if (codesFromText(character) !== null) continue;
    const point = textToCodePoints(character)[0];
    if (point !== undefined && !offending.includes(point)) offending.push(point);
  }
  return { ok: false, codePoints: offending };
}

/** Text as codes written in one base, one space between them, or the code points that refused it. */
export type AsciiWrittenResult =
  | { readonly ok: true; readonly written: string }
  | { readonly ok: false; readonly codePoints: readonly number[] };

export function formattedAsciiCodes(text: string, radix: AsciiRadix): AsciiWrittenResult {
  const result = asciiCodesFromText(text);
  if (!result.ok) return result;
  // Padded, exactly as the table's own columns are: a column of binary codes that
  // lost its leading zeroes and a hex column one digit wide are the same defect,
  // and one reader cannot tell 01000001 from 1000001 without counting.
  const written = result.codes
    .map((code) => formatAsciiCode(code, radix, true) as string)
    .join(" ");
  return { ok: true, written };
}

/** Codes as text, or the token that would not read. */
export type AsciiTextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly token: string };

/**
 * A field full of codes as text.
 *
 * The tokens are separated by whitespace, commas or semicolons, because all
 * three are what a person pastes; each token is read by the engine's per-base
 * parser, which refuses `0x41` in decimal and `9` in octal rather than reading
 * them as `0` and `NaN`-ish truncations. The first token that will not read is
 * answered back by name, so the field can point at it.
 */
export function asciiTextFromCodes(codes: string, radix: AsciiRadix): AsciiTextResult {
  const tokens = codes.split(/[\s,;]+/).filter((token) => token !== "");
  if (tokens.length === 0) return { ok: true, text: "" };
  const values: number[] = [];
  for (const token of tokens) {
    const code = parseAsciiCode(token, radix);
    if (code === null) return { ok: false, token };
    values.push(code);
  }
  const text = textFromCodes(values);
  // `parseAsciiCode` already bounds every value to 0…127, so the engine's own
  // second refusal is unreachable; it is still honoured rather than cast past.
  return text === null ? { ok: false, token: tokens[0] as string } : { ok: true, text };
}
