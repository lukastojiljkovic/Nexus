/**
 * The value model, the positioned error, and the JSON / TOML / CSV codecs behind
 * DEV's structured-data tools.
 *
 * **Why a hand-written JSON parser when the runtime ships one.** `JSON.parse`
 * answers exactly one question — „is this valid" — and it answers it with a
 * message that differs per engine and points nowhere a caret can go. A tool
 * whose whole job is „tell me what is wrong with this file, and where" needs a
 * line, a column and the token that was expected, so the scanner here IS the
 * validator; `JSON.parse` is not called anywhere in this file.
 *
 * **Text operations preserve lexemes; value operations decode them.** This one
 * rule runs through every codec here and it is what keeps the tools honest.
 * Formatting, minifying and key-sorting are text → text: a number is re-emitted
 * as the digits the user wrote, a string as the escape sequence the user wrote,
 * and duplicate keys survive because nothing chose between them. Only the value
 * path — querying, and converting to another format — has to decode, and that is
 * exactly where the losses live, so that is where the refusals are: a duplicate
 * key is refused rather than resolved to the last one, and (on the conversion
 * path) a number whose decimal cannot be recovered from a double is refused
 * rather than silently rounded on the way out.
 *
 * **What „cannot be represented" means for a converter.** Every target format
 * here is narrower than the source in some direction, and the answer is never to
 * flatten quietly. CSV holds a rectangle of text and nothing else, so nesting is
 * refused and a `null` is refused (an empty CSV field reads back as an empty
 * string, and „absent" and „empty" are not the same claim). TOML's document root
 * is a table, so a top-level array is refused. JSON has no `NaN` and no
 * infinity, so a YAML `.nan` on the way to JSON is refused. `conversionLimits`
 * states these up front so a surface can warn before the user presses the
 * button, rather than only after.
 *
 * **A note on the internal `throw`.** The scanners abort by throwing a private
 * `StructuredParseAbort`, caught at each exported boundary and turned into a
 * result. No exception ever crosses an exported function for user input — the
 * public contract is still „a result, never a throw", and there is a test that
 * holds it. Threading a result union through thirty recursive-descent call sites
 * is where parser bugs hide; this keeps the grammar readable.
 *
 * **The import cycle with `structuredYaml.ts` is deliberate and safe.** The
 * converter needs YAML and YAML needs this file's error machinery, so the two
 * modules import each other. The discipline that makes it harmless: NEITHER file
 * may compute a module-level value from the other. Every crossing is a call
 * inside a function body, against a hoisted function declaration and a live
 * binding, so whichever module a bundler enters first finishes initialising
 * before anything is called. Break that rule and the failure is a temporal-dead-
 * zone crash at import time, in whichever entry point happens to load first.
 */

import { parseYaml, serializeYaml } from "./structuredYaml.js";

/** A value any of these formats can hold. The common currency between the codecs. */
export type StructuredValue =
  | null
  | boolean
  | number
  | string
  | readonly StructuredValue[]
  | StructuredObject;

/** A mapping. Readonly by design: every codec builds a fresh tree and nobody edits one in place. */
export interface StructuredObject {
  readonly [key: string]: StructuredValue;
}

/** Whether this is a mapping — `typeof x === "object"` alone is true for `null` and for arrays. */
export function isStructuredObject(value: StructuredValue): value is StructuredObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether this is a sequence. A thin wrapper so call sites read the same way as `isStructuredObject`. */
export function isStructuredArray(value: StructuredValue): value is readonly StructuredValue[] {
  return Array.isArray(value);
}

/**
 * Every error code this module can produce, as a stable dotted key
 * `<format>.<what>`. The surface maps a code to Serbian copy; the code itself is
 * never shown and never translated, so it can be relied on in a test.
 */
export const STRUCTURED_ERROR_CODES = [
  "json.unexpected-end",
  "json.unexpected-char",
  "json.trailing-content",
  "json.leading-zero",
  "json.missing-fraction",
  "json.missing-exponent",
  "json.unterminated-string",
  "json.bad-escape",
  "json.bad-unicode-escape",
  "json.control-char",
  "json.duplicate-key",
  "json.number-not-exact",
  "json.no-nan",
  "path.expected-root",
  "path.expected-segment",
  "path.unexpected-char",
  "path.unterminated-quote",
  "path.unsupported",
  "toml.unexpected-char",
  "toml.expected-equals",
  "toml.bad-key",
  "toml.bad-value",
  "toml.bad-number",
  "toml.number-not-exact",
  "toml.unterminated-string",
  "toml.bad-escape",
  "toml.unterminated-array",
  "toml.unterminated-header",
  "toml.duplicate-key",
  "toml.redefined-table",
  "toml.inline-table-unsupported",
  "toml.datetime-unsupported",
  "toml.trailing-content",
  "csv.unterminated-quote",
  "csv.text-after-quote",
  "csv.ragged-row",
  "csv.duplicate-header",
  "csv.no-rows",
  "convert.csv-needs-rows",
  "convert.csv-nesting",
  "convert.csv-null",
  "convert.csv-ragged-object",
  "convert.toml-root-not-table",
  "convert.toml-null",
  "convert.toml-mixed-array",
  "convert.toml-object-in-array",
  "convert.yaml-multiple-documents",
] as const;

export type StructuredErrorCode = (typeof STRUCTURED_ERROR_CODES)[number];

/** A 1-based line/column and the 0-based offset they were derived from. */
export interface SourcePosition {
  /** 1-based. */
  readonly line: number;
  /** 1-based, counted in UTF-16 code units — the same units an editor's caret moves in. */
  readonly column: number;
  /** 0-based index into the source text. */
  readonly offset: number;
}

/**
 * What went wrong and exactly where.
 *
 * `expected` and `found` are MACHINE tokens (`","`, `"digit"`, `"3"`), never
 * prose: the Serbian sentence is composed by the surface from `code` and these
 * two, so nothing in this package has to know how the message reads. They are
 * required rather than optional and carry `""` when the code alone says
 * everything — a caller that has to check `undefined` on two fields of every
 * error will forget to, and an empty token renders as nothing anyway.
 */
export interface StructuredError extends SourcePosition {
  readonly code: string;
  readonly expected: string;
  readonly found: string;
}

/** Success or a positioned refusal. Every parser here answers in this shape. */
export type StructuredResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StructuredError };

/** Wraps a value as a success. */
export function structuredOk<T>(value: T): StructuredResult<T> {
  return { ok: true, value };
}

/** Wraps a positioned error as a failure. */
export function structuredFail<T>(error: StructuredError): StructuredResult<T> {
  return { ok: false, error };
}

/**
 * The line and column an offset falls on.
 *
 * All three line terminators count as one break — `\n`, `\r\n` and a lone `\r` —
 * because a devtool is pasted into from every platform and a Windows file must
 * not report every position one line short. An offset that lands on the `\n` of
 * a `\r\n` pair is reported on the line the `\r` ends rather than on the next
 * one; the pair is a single break and a caret cannot sit inside it.
 *
 * Computed only when an error is built, never while scanning: the parsers carry
 * offsets, which cost nothing, and pay for the line count once.
 */
export function positionAt(source: string, offset: number): SourcePosition {
  const bounded = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  let index = 0;
  while (index < bounded) {
    const code = source.charCodeAt(index);
    if (code === 10) {
      index += 1;
      line += 1;
      lineStart = index;
      continue;
    }
    if (code === 13) {
      const width = source.charCodeAt(index + 1) === 10 ? 2 : 1;
      if (index + width > bounded) break;
      index += width;
      line += 1;
      lineStart = index;
      continue;
    }
    index += 1;
  }
  return { line, column: bounded - lineStart + 1, offset: bounded };
}

/** Builds a positioned error. Exported so the sibling YAML and XML codecs report in the same shape. */
export function makeStructuredError(
  source: string,
  offset: number,
  code: string,
  expected = "",
  found = "",
): StructuredError {
  return { code, expected, found, ...positionAt(source, offset) };
}

/**
 * The internal abort of every scanner in this family. Caught at each exported
 * boundary; it is never part of any public contract and must not be re-exported
 * from the package barrel.
 */
export class StructuredParseAbort extends Error {
  readonly detail: StructuredError;

  constructor(detail: StructuredError) {
    super(`${detail.code} at ${detail.line}:${detail.column}`);
    this.name = "StructuredParseAbort";
    this.detail = detail;
  }
}

/** Builds the abort a scanner throws. Exported for the sibling codecs, which each narrow `code` to their own union. */
export function structuredAbort(
  source: string,
  offset: number,
  code: string,
  expected = "",
  found = "",
): StructuredParseAbort {
  return new StructuredParseAbort(makeStructuredError(source, offset, code, expected, found));
}

/** Runs a scanner, turning its abort into a result. The single place an exception is allowed to stop. */
export function catchingAbort<T>(run: () => T): StructuredResult<T> {
  try {
    return structuredOk(run());
  } catch (error) {
    if (error instanceof StructuredParseAbort) return structuredFail(error.detail);
    throw error;
  }
}

function fail(
  source: string,
  offset: number,
  code: StructuredErrorCode,
  expected = "",
  found = "",
): StructuredParseAbort {
  return structuredAbort(source, offset, code, expected, found);
}

// ---------------------------------------------------------------------------
// Decimal fidelity
// ---------------------------------------------------------------------------

interface NormalDecimal {
  readonly negative: boolean;
  /** Significant digits with leading and trailing zeros removed; `""` for zero. */
  readonly digits: string;
  /** Power of ten the digit string is multiplied by. */
  readonly exponent: number;
}

const DECIMAL_LEXEME = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** A decimal lexeme reduced to sign, significant digits and a power of ten, or `null` when it is not one. */
function normalizeDecimal(lexeme: string): NormalDecimal | null {
  const match = DECIMAL_LEXEME.exec(lexeme);
  if (match === null) return null;
  const sign = match[1] ?? "";
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";
  const exponentText = match[4];
  if (whole === "" && fraction === "") return null;

  const raw = `${whole}${fraction}`;
  const withoutLeading = raw.replace(/^0+/, "");
  const withoutTrailing = withoutLeading.replace(/0+$/, "");
  const exponent =
    (exponentText === undefined ? 0 : Number(exponentText)) -
    fraction.length +
    (withoutLeading.length - withoutTrailing.length);

  if (withoutTrailing === "") return { negative: false, digits: "", exponent: 0 };
  return { negative: sign === "-", digits: withoutTrailing, exponent };
}

/**
 * Whether the decimal this lexeme spells can be recovered from the double it
 * parses to — i.e. whether writing the number out again would give back the same
 * quantity the user wrote.
 *
 * This is the guard on every conversion that has to re-render a number. It is
 * NOT „is the double exact": 0,1 has no exact binary form and still survives,
 * because `String(0.1)` is „0.1" and the decimal comes back whole. What it
 * catches is the case that actually destroys data — a 19-digit id, a
 * high-precision measurement — where the double is the nearest available value
 * and re-rendering it produces different digits.
 *
 * The one distinction deliberately let through is the sign of zero: „-0" and „0"
 * compare equal here, because no format on the other side of a conversion can
 * express the difference and refusing every „-0.0" would be a refusal with no
 * remedy behind it.
 */
export function decimalSurvivesDouble(lexeme: string): boolean {
  const written = normalizeDecimal(lexeme);
  if (written === null) return false;
  const value = Number(lexeme);
  if (!Number.isFinite(value)) return false;
  const rendered = normalizeDecimal(String(value));
  if (rendered === null) return false;
  return (
    rendered.negative === written.negative &&
    rendered.digits === written.digits &&
    rendered.exponent === written.exponent
  );
}

// ---------------------------------------------------------------------------
// Key ordering
// ---------------------------------------------------------------------------

let keyCollator: Intl.Collator | null = null;

/**
 * The order „sort keys" puts keys in: Serbian Latin collation, digit runs
 * compared as numbers, with a code-unit tiebreak.
 *
 * `sr-Latn` rather than code points because this app's own exports carry Serbian
 * keys, and code points put every „Š" after every „Z" (U+0160 > U+005A) — which
 * is the one thing a Serbian reader would immediately call a bug. The tiebreak
 * matters because a collator may report two DIFFERENT strings as equal (case or
 * accent variants under some ICU builds), and a comparator that returns 0 for
 * them makes the sort depend on input order; ties are broken by code unit so the
 * result is the same everywhere.
 */
export function compareStructuredKeys(left: string, right: string): number {
  keyCollator ??= new Intl.Collator(["sr-Latn", "sr"], { numeric: true, sensitivity: "variant" });
  const ordered = keyCollator.compare(left, right);
  if (ordered !== 0) return ordered;
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// JSON — scanner
// ---------------------------------------------------------------------------

interface Cursor {
  readonly text: string;
  index: number;
}

interface JsonEntry {
  readonly key: string;
  readonly keyRaw: string;
  readonly keyOffset: number;
  readonly value: JsonAst;
}

type JsonAst =
  | { readonly kind: "literal"; readonly raw: string; readonly value: null | boolean }
  | { readonly kind: "number"; readonly raw: string; readonly offset: number }
  | { readonly kind: "string"; readonly raw: string; readonly value: string }
  | { readonly kind: "array"; readonly items: readonly JsonAst[] }
  | { readonly kind: "object"; readonly entries: readonly JsonEntry[] };

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/** RFC 8259 insignificant whitespace — space, tab, LF, CR, and nothing else (no BOM, no form feed). */
function skipJsonWhitespace(cursor: Cursor): void {
  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];
    if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") return;
    cursor.index += 1;
  }
}

const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const FOUR_HEX = /^[0-9a-fA-F]{4}$/;

function scanJsonEscape(cursor: Cursor): string {
  const start = cursor.index;
  const marker = cursor.text[start + 1];
  if (marker === undefined) throw fail(cursor.text, start, "json.unexpected-end", "escape");
  if (marker === "u") {
    const hex = cursor.text.slice(start + 2, start + 6);
    if (!FOUR_HEX.test(hex)) {
      throw fail(cursor.text, start, "json.bad-unicode-escape", "4 hex digits", hex);
    }
    cursor.index = start + 6;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }
  const mapped = JSON_ESCAPES[marker];
  if (mapped === undefined) {
    throw fail(cursor.text, start, "json.bad-escape", "", `\\${marker}`);
  }
  cursor.index = start + 2;
  return mapped;
}

/** Names a control character the way an error message can show it, since the character itself is invisible. */
function controlName(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function scanJsonString(cursor: Cursor): { readonly raw: string; readonly value: string } {
  const start = cursor.index;
  cursor.index += 1;
  let value = "";
  for (;;) {
    const char = cursor.text[cursor.index];
    if (char === undefined) throw fail(cursor.text, start, "json.unterminated-string", '"');
    if (char === '"') {
      cursor.index += 1;
      return { raw: cursor.text.slice(start, cursor.index), value };
    }
    if (char === "\\") {
      value += scanJsonEscape(cursor);
      continue;
    }
    const code = char.charCodeAt(0);
    if (code < 0x20) {
      throw fail(cursor.text, cursor.index, "json.control-char", "escape", controlName(code));
    }
    value += char;
    cursor.index += 1;
  }
}

function scanJsonNumber(cursor: Cursor): JsonAst {
  const { text } = cursor;
  const start = cursor.index;
  if (text[cursor.index] === "-") cursor.index += 1;

  const first = text[cursor.index];
  if (!isDigit(first)) {
    throw fail(text, cursor.index, "json.unexpected-char", "digit", first ?? "");
  }
  if (first === "0") {
    cursor.index += 1;
    if (isDigit(text[cursor.index])) {
      throw fail(text, cursor.index, "json.leading-zero", "", text[cursor.index] ?? "");
    }
  } else {
    while (isDigit(text[cursor.index])) cursor.index += 1;
  }

  if (text[cursor.index] === ".") {
    cursor.index += 1;
    if (!isDigit(text[cursor.index])) {
      throw fail(text, cursor.index, "json.missing-fraction", "digit", text[cursor.index] ?? "");
    }
    while (isDigit(text[cursor.index])) cursor.index += 1;
  }

  const exponent = text[cursor.index];
  if (exponent === "e" || exponent === "E") {
    cursor.index += 1;
    const sign = text[cursor.index];
    if (sign === "+" || sign === "-") cursor.index += 1;
    if (!isDigit(text[cursor.index])) {
      throw fail(text, cursor.index, "json.missing-exponent", "digit", text[cursor.index] ?? "");
    }
    while (isDigit(text[cursor.index])) cursor.index += 1;
  }

  return { kind: "number", raw: text.slice(start, cursor.index), offset: start };
}

function expectJsonChar(cursor: Cursor, char: string): void {
  const found = cursor.text[cursor.index];
  if (found === undefined) throw fail(cursor.text, cursor.index, "json.unexpected-end", char);
  if (found !== char) throw fail(cursor.text, cursor.index, "json.unexpected-char", char, found);
  cursor.index += 1;
}

function scanJsonArray(cursor: Cursor): JsonAst {
  cursor.index += 1;
  const items: JsonAst[] = [];
  skipJsonWhitespace(cursor);
  if (cursor.text[cursor.index] === "]") {
    cursor.index += 1;
    return { kind: "array", items };
  }
  for (;;) {
    items.push(scanJsonValue(cursor));
    skipJsonWhitespace(cursor);
    const char = cursor.text[cursor.index];
    if (char === ",") {
      cursor.index += 1;
      continue;
    }
    if (char === "]") {
      cursor.index += 1;
      return { kind: "array", items };
    }
    if (char === undefined) throw fail(cursor.text, cursor.index, "json.unexpected-end", "]");
    throw fail(cursor.text, cursor.index, "json.unexpected-char", ",", char);
  }
}

function scanJsonObject(cursor: Cursor): JsonAst {
  cursor.index += 1;
  const entries: JsonEntry[] = [];
  skipJsonWhitespace(cursor);
  if (cursor.text[cursor.index] === "}") {
    cursor.index += 1;
    return { kind: "object", entries };
  }
  for (;;) {
    skipJsonWhitespace(cursor);
    const keyOffset = cursor.index;
    const opener = cursor.text[keyOffset];
    if (opener === undefined) throw fail(cursor.text, keyOffset, "json.unexpected-end", '"');
    if (opener !== '"') throw fail(cursor.text, keyOffset, "json.unexpected-char", '"', opener);
    const key = scanJsonString(cursor);
    skipJsonWhitespace(cursor);
    expectJsonChar(cursor, ":");
    const value = scanJsonValue(cursor);
    entries.push({ key: key.value, keyRaw: key.raw, keyOffset, value });

    skipJsonWhitespace(cursor);
    const char = cursor.text[cursor.index];
    if (char === ",") {
      cursor.index += 1;
      continue;
    }
    if (char === "}") {
      cursor.index += 1;
      return { kind: "object", entries };
    }
    if (char === undefined) throw fail(cursor.text, cursor.index, "json.unexpected-end", "}");
    throw fail(cursor.text, cursor.index, "json.unexpected-char", ",", char);
  }
}

const JSON_WORDS = [
  { text: "true", value: true },
  { text: "false", value: false },
  { text: "null", value: null },
] as const;

function scanJsonValue(cursor: Cursor): JsonAst {
  skipJsonWhitespace(cursor);
  const char = cursor.text[cursor.index];
  if (char === undefined) throw fail(cursor.text, cursor.index, "json.unexpected-end", "value");
  if (char === "{") return scanJsonObject(cursor);
  if (char === "[") return scanJsonArray(cursor);
  if (char === '"') {
    const scanned = scanJsonString(cursor);
    return { kind: "string", raw: scanned.raw, value: scanned.value };
  }
  if (char === "-" || isDigit(char)) return scanJsonNumber(cursor);
  for (const word of JSON_WORDS) {
    if (cursor.text.startsWith(word.text, cursor.index)) {
      cursor.index += word.text.length;
      return { kind: "literal", raw: word.text, value: word.value };
    }
  }
  throw fail(cursor.text, cursor.index, "json.unexpected-char", "value", char);
}

function scanJsonDocument(text: string): JsonAst {
  const cursor: Cursor = { text, index: 0 };
  const root = scanJsonValue(cursor);
  skipJsonWhitespace(cursor);
  if (cursor.index < text.length) {
    throw fail(text, cursor.index, "json.trailing-content", "", text[cursor.index] ?? "");
  }
  return root;
}

// ---------------------------------------------------------------------------
// JSON — public surface
// ---------------------------------------------------------------------------

/**
 * The first thing wrong with this JSON, or `null` when nothing is.
 *
 * Duplicate keys are NOT reported here: `{"a":1,"a":2}` is valid JSON by the
 * grammar, and this function answers the grammar's question. It is the value
 * path that has to choose between the two and therefore refuses — see
 * `parseJson`.
 */
export function validateJson(text: string): StructuredError | null {
  const result = catchingAbort(() => scanJsonDocument(text));
  return result.ok ? null : result.error;
}

/** How `formatJson` lays a document out. */
export interface JsonFormatOptions {
  /** Spaces per level, clamped to 0–10, or one tab per level. */
  readonly indent: number | "tab";
  /** Sort every object's keys, at every depth, by `compareStructuredKeys`. */
  readonly sortKeys: boolean;
}

interface RenderStyle {
  readonly unit: string;
  readonly newline: string;
  readonly space: string;
  readonly sortKeys: boolean;
}

function indentUnit(indent: number | "tab"): string {
  if (indent === "tab") return "\t";
  const spaces = Math.max(0, Math.min(10, Math.trunc(indent)));
  return " ".repeat(spaces);
}

function renderJsonAst(node: JsonAst, style: RenderStyle, depth: number): string {
  switch (node.kind) {
    case "literal":
    case "number":
    case "string":
      return node.raw;
    case "array": {
      if (node.items.length === 0) return "[]";
      const inner = style.unit.repeat(depth + 1);
      const outer = style.unit.repeat(depth);
      const parts = node.items.map(
        (item) => `${style.newline === "" ? "" : inner}${renderJsonAst(item, style, depth + 1)}`,
      );
      return `[${style.newline}${parts.join(`,${style.newline}`)}${style.newline}${style.newline === "" ? "" : outer}]`;
    }
    case "object": {
      if (node.entries.length === 0) return "{}";
      const entries = style.sortKeys
        ? [...node.entries].sort((left, right) => compareStructuredKeys(left.key, right.key))
        : node.entries;
      const inner = style.unit.repeat(depth + 1);
      const outer = style.unit.repeat(depth);
      const parts = entries.map((entry) => {
        const value = renderJsonAst(entry.value, style, depth + 1);
        return `${style.newline === "" ? "" : inner}${entry.keyRaw}:${style.space}${value}`;
      });
      return `{${style.newline}${parts.join(`,${style.newline}`)}${style.newline}${style.newline === "" ? "" : outer}}`;
    }
  }
}

/**
 * The same document, laid out.
 *
 * Nothing is re-encoded on the way through: numbers and strings are re-emitted
 * as the exact lexemes the source carried, so `1.50` stays `1.50`, a 30-digit id
 * stays intact, and `é` is not quietly turned into the letter. A formatter
 * that rebuilt values from parsed doubles would round the id and „fix" the
 * escape, and the user would have no way to tell which of the two documents was
 * the one they wrote.
 */
export function formatJson(
  text: string,
  options: Partial<JsonFormatOptions> = {},
): StructuredResult<string> {
  return catchingAbort(() =>
    renderJsonAst(
      scanJsonDocument(text),
      {
        unit: indentUnit(options.indent ?? 2),
        newline: "\n",
        space: " ",
        sortKeys: options.sortKeys ?? false,
      },
      0,
    ),
  );
}

/** The same document with every byte of insignificant whitespace removed. Lexemes preserved, as in `formatJson`. */
export function minifyJson(text: string): StructuredResult<string> {
  return catchingAbort(() =>
    renderJsonAst(
      scanJsonDocument(text),
      { unit: "", newline: "", space: "", sortKeys: false },
      0,
    ),
  );
}

/** `formatJson` with the keys sorted at every depth — the drawer's „sredi ključeve" button. */
export function sortJsonKeys(
  text: string,
  options: Partial<Omit<JsonFormatOptions, "sortKeys">> = {},
): StructuredResult<string> {
  return formatJson(text, { ...options, sortKeys: true });
}

/** What `parseJson` is allowed to lose. */
export interface JsonParseOptions {
  /**
   * Refuse any number whose decimal cannot be recovered from the double it
   * parses to. Off for inspection (the user is looking at their own text and a
   * 19-digit id shown as a double is a nuisance, not a loss); ON for conversion,
   * where the number is about to be written back out and the loss becomes the
   * file.
   */
  readonly exactNumbers: boolean;
}

function jsonAstToValue(node: JsonAst, text: string, exactNumbers: boolean): StructuredValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "string":
      return node.value;
    case "number": {
      if (exactNumbers && !decimalSurvivesDouble(node.raw)) {
        throw fail(text, node.offset, "json.number-not-exact", "", node.raw);
      }
      return Number(node.raw);
    }
    case "array":
      return node.items.map((item) => jsonAstToValue(item, text, exactNumbers));
    case "object": {
      const object: Record<string, StructuredValue> = {};
      const seen = new Set<string>();
      for (const entry of node.entries) {
        if (seen.has(entry.key)) {
          throw fail(text, entry.keyOffset, "json.duplicate-key", "", entry.key);
        }
        seen.add(entry.key);
        object[entry.key] = jsonAstToValue(entry.value, text, exactNumbers);
      }
      return object;
    }
  }
}

/**
 * The document as data.
 *
 * Duplicate keys are refused here even though the grammar allows them, because
 * this is the point at which one of the two would have to win and the standard
 * itself does not say which. „Last one wins" is a repair — the user's file says
 * two things and the tool would show them one — so the answer is the position of
 * the second key and a refusal.
 */
export function parseJson(
  text: string,
  options: Partial<JsonParseOptions> = {},
): StructuredResult<StructuredValue> {
  return catchingAbort(() =>
    jsonAstToValue(scanJsonDocument(text), text, options.exactNumbers ?? false),
  );
}

const JSON_STRING_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/** A JSON string literal for `value`, escaping exactly what RFC 8259 requires and nothing else. */
export function jsonStringLiteral(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = JSON_STRING_ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.charCodeAt(0);
    out += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return `${out}"`;
}

function renderJsonValue(
  value: StructuredValue,
  style: RenderStyle,
  depth: number,
  source: string,
): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fail(source, 0, "json.no-nan", "", String(value));
    return String(value);
  }
  if (typeof value === "string") return jsonStringLiteral(value);
  if (isStructuredArray(value)) {
    if (value.length === 0) return "[]";
    const inner = style.unit.repeat(depth + 1);
    const outer = style.unit.repeat(depth);
    const parts = value.map(
      (item) =>
        `${style.newline === "" ? "" : inner}${renderJsonValue(item, style, depth + 1, source)}`,
    );
    return `[${style.newline}${parts.join(`,${style.newline}`)}${style.newline}${style.newline === "" ? "" : outer}]`;
  }
  const keys = style.sortKeys ? [...Object.keys(value)].sort(compareStructuredKeys) : Object.keys(value);
  if (keys.length === 0) return "{}";
  const inner = style.unit.repeat(depth + 1);
  const outer = style.unit.repeat(depth);
  const parts = keys.map((key) => {
    const child = value[key] ?? null;
    const rendered = renderJsonValue(child, style, depth + 1, source);
    return `${style.newline === "" ? "" : inner}${jsonStringLiteral(key)}:${style.space}${rendered}`;
  });
  return `{${style.newline}${parts.join(`,${style.newline}`)}${style.newline}${style.newline === "" ? "" : outer}}`;
}

/**
 * A value as JSON text.
 *
 * Returns a result rather than a string because one input has no JSON spelling
 * at all: `NaN` and the infinities, which YAML and TOML both have and JSON does
 * not. `JSON.stringify` writes them as `null`, which is a value the source never
 * held — so this refuses instead.
 */
export function stringifyJson(
  value: StructuredValue,
  options: Partial<JsonFormatOptions> = {},
): StructuredResult<string> {
  // `indent: 0` means ONE LINE — the same thing `JSON.stringify(v, null, 0)`
  // means. A newline per member with zero-width indentation is the worst of both
  // readings: neither indented nor compact, and unusable in the one place that
  // asked for it (a JSONPath hit shown on a table row, where the newlines were
  // hidden only by the cell's `white-space: nowrap` and came back the moment
  // anybody copied the text).
  const indent = options.indent ?? 2;
  const oneLine = indent === 0;
  const style: RenderStyle = {
    unit: indentUnit(indent),
    newline: oneLine ? "" : "\n",
    space: oneLine ? "" : " ",
    sortKeys: options.sortKeys ?? false,
  };
  return catchingAbort(() => renderJsonValue(value, style, 0, ""));
}

// ---------------------------------------------------------------------------
// JSONPath — the supported subset
// ---------------------------------------------------------------------------

type PathSegment =
  | { readonly kind: "key"; readonly name: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "wildcard" }
  | { readonly kind: "descend"; readonly name: string };

function scanPathQuoted(cursor: Cursor, quote: string): string {
  const start = cursor.index;
  cursor.index += 1;
  let value = "";
  for (;;) {
    const char = cursor.text[cursor.index];
    if (char === undefined) throw fail(cursor.text, start, "path.unterminated-quote", quote);
    if (char === "\\") {
      const next = cursor.text[cursor.index + 1];
      if (next === undefined) throw fail(cursor.text, start, "path.unterminated-quote", quote);
      value += next;
      cursor.index += 2;
      continue;
    }
    if (char === quote) {
      cursor.index += 1;
      return value;
    }
    value += char;
    cursor.index += 1;
  }
}

const PATH_NAME = /^[^.[\]]+/;

function scanPathName(cursor: Cursor): string {
  const match = PATH_NAME.exec(cursor.text.slice(cursor.index));
  const name = match?.[0];
  if (name === undefined || name === "") {
    throw fail(cursor.text, cursor.index, "path.expected-segment", "name", cursor.text[cursor.index] ?? "");
  }
  cursor.index += name.length;
  return name;
}

function scanPathBracket(cursor: Cursor): PathSegment {
  const open = cursor.index;
  cursor.index += 1;
  const char = cursor.text[cursor.index];
  if (char === undefined) throw fail(cursor.text, open, "path.unexpected-char", "]", "");
  if (char === "?") throw fail(cursor.text, cursor.index, "path.unsupported", "", "filter");
  if (char === ":") throw fail(cursor.text, cursor.index, "path.unsupported", "", "slice");
  if (char === "-") throw fail(cursor.text, cursor.index, "path.unsupported", "", "negative-index");

  let segment: PathSegment;
  if (char === "*") {
    cursor.index += 1;
    segment = { kind: "wildcard" };
  } else if (char === "'" || char === '"') {
    segment = { kind: "key", name: scanPathQuoted(cursor, char) };
  } else if (isDigit(char)) {
    const start = cursor.index;
    while (isDigit(cursor.text[cursor.index])) cursor.index += 1;
    const after = cursor.text[cursor.index];
    if (after === ":") throw fail(cursor.text, cursor.index, "path.unsupported", "", "slice");
    if (after === ",") throw fail(cursor.text, cursor.index, "path.unsupported", "", "union");
    segment = { kind: "index", index: Number(cursor.text.slice(start, cursor.index)) };
  } else {
    throw fail(cursor.text, cursor.index, "path.unexpected-char", "index or 'name'", char);
  }

  const closing = cursor.text[cursor.index];
  if (closing === ",") throw fail(cursor.text, cursor.index, "path.unsupported", "", "union");
  if (closing !== "]") {
    throw fail(cursor.text, cursor.index, "path.unexpected-char", "]", closing ?? "");
  }
  cursor.index += 1;
  return segment;
}

/**
 * The path grammar, parsed. `$`, `.key`, `['key']`, `[n]`, `[*]` and `..key` —
 * and every other JSONPath construct refused BY NAME (`filter`, `slice`,
 * `union`, `negative-index`, `recursive-wildcard`) rather than ignored, so a
 * user who pastes a filter expression is told which piece this tool does not
 * implement instead of getting an empty result set that looks like „no matches".
 */
function parseJsonPath(path: string): readonly PathSegment[] {
  const cursor: Cursor = { text: path, index: 0 };
  if (cursor.text[0] !== "$") {
    throw fail(path, 0, "path.expected-root", "$", cursor.text[0] ?? "");
  }
  cursor.index = 1;
  const segments: PathSegment[] = [];
  while (cursor.index < path.length) {
    const char = cursor.text[cursor.index];
    if (char === "[") {
      segments.push(scanPathBracket(cursor));
      continue;
    }
    if (char !== ".") {
      throw fail(path, cursor.index, "path.unexpected-char", ". or [", char ?? "");
    }
    if (cursor.text[cursor.index + 1] === ".") {
      cursor.index += 2;
      if (cursor.text[cursor.index] === "*") {
        throw fail(path, cursor.index, "path.unsupported", "", "recursive-wildcard");
      }
      segments.push({ kind: "descend", name: scanPathName(cursor) });
      continue;
    }
    cursor.index += 1;
    if (cursor.text[cursor.index] === "*") {
      throw fail(path, cursor.index, "path.unsupported", "[*]", ".*");
    }
    segments.push({ kind: "key", name: scanPathName(cursor) });
  }
  return segments;
}

function descendCollect(value: StructuredValue, name: string, out: StructuredValue[]): void {
  if (isStructuredArray(value)) {
    for (const item of value) descendCollect(item, name, out);
    return;
  }
  if (!isStructuredObject(value)) return;
  const direct = value[name];
  if (direct !== undefined) out.push(direct);
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child !== undefined) descendCollect(child, name, out);
  }
}

function applySegment(current: readonly StructuredValue[], segment: PathSegment): StructuredValue[] {
  const out: StructuredValue[] = [];
  for (const value of current) {
    switch (segment.kind) {
      case "key": {
        if (!isStructuredObject(value)) break;
        const child = value[segment.name];
        if (child !== undefined) out.push(child);
        break;
      }
      case "index": {
        if (!isStructuredArray(value)) break;
        const child = value[segment.index];
        if (child !== undefined) out.push(child);
        break;
      }
      case "wildcard": {
        if (isStructuredArray(value)) {
          out.push(...value);
          break;
        }
        if (!isStructuredObject(value)) break;
        for (const key of Object.keys(value)) {
          const child = value[key];
          if (child !== undefined) out.push(child);
        }
        break;
      }
      case "descend":
        descendCollect(value, segment.name, out);
        break;
    }
  }
  return out;
}

/**
 * Every value `path` selects, in document order. An empty array is „nothing
 * matched"; a failure is „that path is not one this tool speaks", and the two
 * are deliberately different answers.
 *
 * `[*]` walks an array's items and an object's values alike — the object case is
 * what makes `$.users[*].name` work on a keyed map as well as on a list, and
 * JSONPath's own definition of the wildcard covers both.
 */
export function queryJsonPath(
  value: StructuredValue,
  path: string,
): StructuredResult<readonly StructuredValue[]> {
  return catchingAbort(() => {
    const segments = parseJsonPath(path);
    let current: StructuredValue[] = [value];
    for (const segment of segments) current = applySegment(current, segment);
    return current as readonly StructuredValue[];
  });
}

// ---------------------------------------------------------------------------
// CSV — RFC 4180
// ---------------------------------------------------------------------------

/** How a CSV file is read. */
export interface CsvReadOptions {
  /** One character. Comma per RFC 4180; a Serbian spreadsheet export is often `;`. */
  readonly delimiter: string;
  /** Whether the first row names the columns. */
  readonly header: boolean;
}

/** How a CSV file is written. */
export interface CsvWriteOptions extends CsvReadOptions {
  /** RFC 4180 says CRLF, which is also what spreadsheets on this platform expect. */
  readonly newline: "crlf" | "lf";
  /**
   * What to do with a `null`. Refusing is the default because an empty CSV field
   * reads back as an empty string, so writing `null` as one turns „no value" into
   * „the empty string" with nothing to mark the change. A caller that knows its
   * consumer does not care can opt in to the loss.
   */
  readonly nullAs: "refuse" | "empty";
}

const CSV_DEFAULT_READ: CsvReadOptions = { delimiter: ",", header: true };

/**
 * The rows, exactly as text.
 *
 * **Nothing is typed.** Every cell comes back a string, and that is a decision
 * rather than an omission: a CSV column holding `007` is a postal code in one
 * file and an integer in another, and a reader that guesses turns the first into
 * `7` on the way through. The conversion path keeps the strings and says so in
 * `conversionLimits`.
 *
 * Blank lines at the very end of the file are dropped — a file that ends, ends.
 * A blank line in the MIDDLE is a row with one empty field, which a table with
 * three columns will then correctly report as ragged rather than skip.
 */
export function parseCsvRows(
  text: string,
  options: Partial<CsvReadOptions> = {},
): StructuredResult<readonly (readonly string[])[]> {
  const delimiter = options.delimiter ?? CSV_DEFAULT_READ.delimiter;
  return catchingAbort(() => {
    if (text.length === 0) return [] as readonly (readonly string[])[];

    const rows: string[][] = [];
    /** Offset each row starts at, and the offset of its terminator — an error has to point at one of the two. */
    const spans: { start: number; end: number }[] = [];
    let row: string[] = [];
    let rowStart = 0;
    let index = 0;

    for (;;) {
      let value: string;
      if (text[index] === '"') {
        const quoteStart = index;
        index += 1;
        value = "";
        for (;;) {
          const inner = text[index];
          if (inner === undefined) throw fail(text, quoteStart, "csv.unterminated-quote", '"');
          if (inner === '"') {
            if (text[index + 1] === '"') {
              value += '"';
              index += 2;
              continue;
            }
            index += 1;
            break;
          }
          value += inner;
          index += 1;
        }
        const after = text[index];
        if (after !== undefined && after !== delimiter && after !== "\n" && after !== "\r") {
          throw fail(text, index, "csv.text-after-quote", delimiter, after);
        }
      } else {
        const start = index;
        while (index < text.length) {
          const char = text[index];
          if (char === delimiter || char === "\n" || char === "\r") break;
          index += 1;
        }
        value = text.slice(start, index);
      }
      row.push(value);

      const char = text[index];
      if (char === delimiter) {
        index += 1;
        continue;
      }
      rows.push(row);
      spans.push({ start: rowStart, end: index });
      row = [];
      if (char === undefined) break;
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      if (index >= text.length) break;
      rowStart = index;
    }

    // A file that ends with blank lines simply ends; a blank line in the middle
    // stays a row, so a table that says it has three columns still reports it.
    while (rows.length > 0) {
      const last = rows[rows.length - 1];
      if (last === undefined || last.length !== 1 || last[0] !== "") break;
      rows.pop();
      spans.pop();
    }

    const first = rows[0];
    if (first !== undefined) {
      for (let line = 1; line < rows.length; line += 1) {
        const current = rows[line];
        const span = spans[line];
        if (current === undefined || span === undefined) break;
        if (current.length === first.length) continue;
        // Too many fields: point at the row's start, where the count begins to
        // diverge from the header. Too few: point at the row's end, which is
        // where the missing field would have been.
        const at = current.length > first.length ? span.start : span.end;
        throw fail(text, at, "csv.ragged-row", String(first.length), String(current.length));
      }
    }

    return rows as readonly (readonly string[])[];
  });
}

/**
 * The table as data: an array of objects when `header` is on, an array of arrays
 * when it is off. Every cell is a string — see `parseCsvRows`.
 */
export function parseCsvValue(
  text: string,
  options: Partial<CsvReadOptions> = {},
): StructuredResult<StructuredValue> {
  const rows = parseCsvRows(text, options);
  if (!rows.ok) return rows;
  if (!(options.header ?? CSV_DEFAULT_READ.header)) {
    return structuredOk(rows.value.map((row) => [...row]));
  }
  const header = rows.value[0];
  if (header === undefined) return structuredFail(makeStructuredError(text, 0, "csv.no-rows", "header"));

  // The caret for a repeated header name is found by searching the HEADER LINE
  // only — a best-effort position, since a quoted name is not at the offset its
  // text is, and never a search that could wander into the data below it.
  const headerEnd = text.search(/[\r\n]/);
  const headerLine = headerEnd < 0 ? text : text.slice(0, headerEnd);
  const seen = new Set<string>();
  let scan = 0;
  for (const name of header) {
    const at = headerLine.indexOf(name, scan);
    if (seen.has(name)) {
      return structuredFail(
        makeStructuredError(text, at < 0 ? 0 : at, "csv.duplicate-header", "", name),
      );
    }
    seen.add(name);
    scan = at < 0 ? scan : at + name.length;
  }

  const records = rows.value.slice(1).map((row) => {
    const record: Record<string, StructuredValue> = {};
    header.forEach((name, column) => {
      record[name] = row[column] ?? "";
    });
    return record;
  });
  return structuredOk(records);
}

/** A CSV cell, quoted only when RFC 4180 requires it. */
function csvCell(value: string, delimiter: string): string {
  const needsQuoting =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  return needsQuoting ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Rows of text as a CSV document. Every row is terminated, including the last — RFC 4180's own convention. */
export function stringifyCsv(
  rows: ReadonlyArray<readonly string[]>,
  options: Partial<CsvWriteOptions> = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const newline = (options.newline ?? "crlf") === "crlf" ? "\r\n" : "\n";
  return rows.map((row) => `${row.map((cell) => csvCell(cell, delimiter)).join(delimiter)}${newline}`).join("");
}

// ---------------------------------------------------------------------------
// TOML
// ---------------------------------------------------------------------------

type MutableObject = Record<string, StructuredValue>;

/** Joins a key path with a character no TOML key can contain, so `a."b.c"` and `a.b.c` are different paths. */
function pathKey(parts: readonly string[]): string {
  return parts.join("\u0000");
}

interface TomlState {
  readonly text: string;
  readonly root: MutableObject;
  /** Paths a `[table]` or one `[[array]]` element declared outright. Re-declaring one is an error. */
  readonly declared: Set<string>;
  /** Paths that are arrays of tables, so a second `[[a]]` appends rather than collides. */
  readonly tableArrays: Set<string>;
  current: MutableObject;
  currentPath: readonly string[];
}

function skipTomlInline(cursor: Cursor): void {
  while (cursor.text[cursor.index] === " " || cursor.text[cursor.index] === "\t") cursor.index += 1;
}

function skipTomlComment(cursor: Cursor): void {
  if (cursor.text[cursor.index] !== "#") return;
  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];
    if (char === "\n" || char === "\r") return;
    cursor.index += 1;
  }
}

/** Whitespace, newlines and comments — everything between two statements. */
function skipTomlBlank(cursor: Cursor): void {
  for (;;) {
    const char = cursor.text[cursor.index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      cursor.index += 1;
      continue;
    }
    if (char === "#") {
      skipTomlComment(cursor);
      continue;
    }
    return;
  }
}

function expectTomlLineEnd(cursor: Cursor): void {
  skipTomlInline(cursor);
  skipTomlComment(cursor);
  const char = cursor.text[cursor.index];
  if (char === undefined) return;
  if (char === "\n" || char === "\r") return;
  throw fail(cursor.text, cursor.index, "toml.trailing-content", "newline", char);
}

const TOML_BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

function scanTomlEscape(cursor: Cursor, allowLineBreak: boolean): string {
  const start = cursor.index;
  const marker = cursor.text[start + 1];
  if (marker === undefined) throw fail(cursor.text, start, "toml.unterminated-string", "escape");
  if (marker === "u" || marker === "U") {
    const width = marker === "u" ? 4 : 8;
    const hex = cursor.text.slice(start + 2, start + 2 + width);
    if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) {
      throw fail(cursor.text, start, "toml.bad-escape", `${width} hex digits`, hex);
    }
    cursor.index = start + 2 + width;
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }
  if (allowLineBreak && (marker === "\n" || marker === "\r" || marker === " " || marker === "\t")) {
    // A backslash before a line break swallows the break and every space that
    // follows it — the one way a long line is wrapped in a TOML string.
    let index = start + 1;
    while (index < cursor.text.length) {
      const char = cursor.text[index];
      if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") break;
      index += 1;
    }
    cursor.index = index;
    return "";
  }
  const mapped = TOML_BASIC_ESCAPES[marker];
  if (mapped === undefined) throw fail(cursor.text, start, "toml.bad-escape", "", `\\${marker}`);
  cursor.index = start + 2;
  return mapped;
}

function scanTomlBasicString(cursor: Cursor): string {
  const start = cursor.index;
  if (cursor.text.startsWith('"""', start)) {
    cursor.index = start + 3;
    if (cursor.text[cursor.index] === "\r" && cursor.text[cursor.index + 1] === "\n") cursor.index += 2;
    else if (cursor.text[cursor.index] === "\n") cursor.index += 1;
    let value = "";
    for (;;) {
      if (cursor.index >= cursor.text.length) {
        throw fail(cursor.text, start, "toml.unterminated-string", '"""');
      }
      if (cursor.text.startsWith('"""', cursor.index)) {
        cursor.index += 3;
        return value;
      }
      if (cursor.text[cursor.index] === "\\") {
        value += scanTomlEscape(cursor, true);
        continue;
      }
      value += cursor.text[cursor.index] ?? "";
      cursor.index += 1;
    }
  }
  cursor.index = start + 1;
  let value = "";
  for (;;) {
    const char = cursor.text[cursor.index];
    if (char === undefined || char === "\n" || char === "\r") {
      throw fail(cursor.text, start, "toml.unterminated-string", '"');
    }
    if (char === '"') {
      cursor.index += 1;
      return value;
    }
    if (char === "\\") {
      value += scanTomlEscape(cursor, false);
      continue;
    }
    value += char;
    cursor.index += 1;
  }
}

function scanTomlLiteralString(cursor: Cursor): string {
  const start = cursor.index;
  if (cursor.text.startsWith("'''", start)) {
    cursor.index = start + 3;
    if (cursor.text[cursor.index] === "\r" && cursor.text[cursor.index + 1] === "\n") cursor.index += 2;
    else if (cursor.text[cursor.index] === "\n") cursor.index += 1;
    const end = cursor.text.indexOf("'''", cursor.index);
    if (end < 0) throw fail(cursor.text, start, "toml.unterminated-string", "'''");
    const value = cursor.text.slice(cursor.index, end);
    cursor.index = end + 3;
    return value;
  }
  cursor.index = start + 1;
  const end = cursor.text.indexOf("'", cursor.index);
  const lineEnd = cursor.text.slice(cursor.index).search(/[\n\r]/);
  if (end < 0 || (lineEnd >= 0 && cursor.index + lineEnd < end)) {
    throw fail(cursor.text, start, "toml.unterminated-string", "'");
  }
  const value = cursor.text.slice(cursor.index, end);
  cursor.index = end + 1;
  return value;
}

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+/;

function scanTomlKeyPart(cursor: Cursor): string {
  const char = cursor.text[cursor.index];
  if (char === '"') return scanTomlBasicString(cursor);
  if (char === "'") return scanTomlLiteralString(cursor);
  const match = TOML_BARE_KEY.exec(cursor.text.slice(cursor.index));
  const bare = match?.[0];
  if (bare === undefined) {
    throw fail(cursor.text, cursor.index, "toml.bad-key", "key", char ?? "");
  }
  cursor.index += bare.length;
  return bare;
}

function scanTomlKey(cursor: Cursor): readonly string[] {
  const parts = [scanTomlKeyPart(cursor)];
  for (;;) {
    skipTomlInline(cursor);
    if (cursor.text[cursor.index] !== ".") return parts;
    cursor.index += 1;
    skipTomlInline(cursor);
    parts.push(scanTomlKeyPart(cursor));
  }
}

const TOML_DATE_LIKE = /^(\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2})/;
const TOML_RADIX = /^([+-]?)0(x[0-9a-fA-F](_?[0-9a-fA-F])*|o[0-7](_?[0-7])*|b[01](_?[01])*)$/;
const TOML_INTEGER = /^[+-]?(0|[1-9](_?[0-9])*)$/;
const TOML_FLOAT = /^[+-]?(0|[1-9](_?[0-9])*)(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9](_?[0-9])*)?$/;
const TOML_SPECIAL_FLOAT = /^[+-]?(inf|nan)$/;

function scanTomlBareValue(cursor: Cursor): StructuredValue {
  const start = cursor.index;
  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];
    if (char === "," || char === "]" || char === "}" || char === "\n" || char === "\r" || char === "#") break;
    cursor.index += 1;
  }
  const token = cursor.text.slice(start, cursor.index).trimEnd();
  cursor.index = start + token.length;

  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "") throw fail(cursor.text, start, "toml.bad-value", "value", "");

  if (TOML_DATE_LIKE.test(token)) {
    throw fail(cursor.text, start, "toml.datetime-unsupported", "", token);
  }
  if (TOML_SPECIAL_FLOAT.test(token)) {
    const negative = token.startsWith("-");
    if (token.endsWith("nan")) return Number.NaN;
    return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (TOML_RADIX.test(token)) {
    const cleaned = token.replaceAll("_", "");
    const value = Number(cleaned.startsWith("+") ? cleaned.slice(1) : cleaned);
    if (!Number.isSafeInteger(value)) {
      throw fail(cursor.text, start, "toml.number-not-exact", "", token);
    }
    return value;
  }
  if (TOML_INTEGER.test(token) || TOML_FLOAT.test(token)) {
    const cleaned = token.replaceAll("_", "");
    if (!decimalSurvivesDouble(cleaned)) {
      throw fail(cursor.text, start, "toml.number-not-exact", "", token);
    }
    return Number(cleaned);
  }
  throw fail(cursor.text, start, "toml.bad-value", "value", token);
}

function scanTomlValue(cursor: Cursor): StructuredValue {
  const char = cursor.text[cursor.index];
  if (char === undefined) throw fail(cursor.text, cursor.index, "toml.bad-value", "value", "");
  if (char === '"') return scanTomlBasicString(cursor);
  if (char === "'") return scanTomlLiteralString(cursor);
  if (char === "{") throw fail(cursor.text, cursor.index, "toml.inline-table-unsupported", "", "{");
  if (char === "[") {
    const open = cursor.index;
    cursor.index += 1;
    const items: StructuredValue[] = [];
    for (;;) {
      skipTomlBlank(cursor);
      if (cursor.index >= cursor.text.length) {
        throw fail(cursor.text, open, "toml.unterminated-array", "]");
      }
      if (cursor.text[cursor.index] === "]") {
        cursor.index += 1;
        return items;
      }
      items.push(scanTomlValue(cursor));
      skipTomlBlank(cursor);
      const next = cursor.text[cursor.index];
      if (next === ",") {
        cursor.index += 1;
        continue;
      }
      if (next === "]") {
        cursor.index += 1;
        return items;
      }
      if (next === undefined) throw fail(cursor.text, open, "toml.unterminated-array", "]");
      throw fail(cursor.text, cursor.index, "toml.unexpected-char", ",", next);
    }
  }
  return scanTomlBareValue(cursor);
}

/** Walks (creating as it goes) to the table `parts` names, following the last element of any array of tables. */
function tomlDescend(
  state: TomlState,
  from: MutableObject,
  base: readonly string[],
  parts: readonly string[],
  offset: number,
): MutableObject {
  let table = from;
  let walked = [...base];
  for (const part of parts) {
    walked = [...walked, part];
    const existing = table[part];
    if (existing === undefined) {
      const created: MutableObject = {};
      table[part] = created;
      table = created;
      continue;
    }
    if (isStructuredArray(existing)) {
      const last = existing[existing.length - 1];
      if (last === undefined || !isStructuredObject(last)) {
        throw fail(state.text, offset, "toml.duplicate-key", "table", part);
      }
      table = last as MutableObject;
      continue;
    }
    if (!isStructuredObject(existing)) {
      throw fail(state.text, offset, "toml.duplicate-key", "table", part);
    }
    table = existing as MutableObject;
  }
  return table;
}

function openTomlTable(state: TomlState, parts: readonly string[], offset: number): void {
  const parents = parts.slice(0, -1);
  const leaf = parts[parts.length - 1];
  if (leaf === undefined) throw fail(state.text, offset, "toml.bad-key", "key", "");
  const parent = tomlDescend(state, state.root, [], parents, offset);
  const key = pathKey(parts);
  const existing = parent[leaf];
  if (existing !== undefined) {
    if (!isStructuredObject(existing)) throw fail(state.text, offset, "toml.duplicate-key", "table", leaf);
    if (state.declared.has(key)) throw fail(state.text, offset, "toml.redefined-table", "", leaf);
    state.declared.add(key);
    state.current = existing as MutableObject;
    state.currentPath = parts;
    return;
  }
  const created: MutableObject = {};
  parent[leaf] = created;
  state.declared.add(key);
  state.current = created;
  state.currentPath = parts;
}

function openTomlTableArray(state: TomlState, parts: readonly string[], offset: number): void {
  const parents = parts.slice(0, -1);
  const leaf = parts[parts.length - 1];
  if (leaf === undefined) throw fail(state.text, offset, "toml.bad-key", "key", "");
  const parent = tomlDescend(state, state.root, [], parents, offset);
  const key = pathKey(parts);
  const existing = parent[leaf];
  const created: MutableObject = {};
  if (existing === undefined) {
    parent[leaf] = [created];
    state.tableArrays.add(key);
  } else {
    if (!isStructuredArray(existing) || !state.tableArrays.has(key)) {
      throw fail(state.text, offset, "toml.duplicate-key", "array of tables", leaf);
    }
    (existing as StructuredValue[]).push(created);
  }
  state.current = created;
  state.currentPath = parts;
}

function assignTomlKey(
  state: TomlState,
  parts: readonly string[],
  value: StructuredValue,
  offset: number,
): void {
  const parents = parts.slice(0, -1);
  const leaf = parts[parts.length - 1];
  if (leaf === undefined) throw fail(state.text, offset, "toml.bad-key", "key", "");
  const table = tomlDescend(state, state.current, state.currentPath, parents, offset);
  if (table[leaf] !== undefined) throw fail(state.text, offset, "toml.duplicate-key", "", leaf);
  table[leaf] = value;
}

/**
 * TOML as data — tables, arrays of tables, dotted keys, arrays, and the four
 * scalar types.
 *
 * **Two things are refused by name rather than approximated.** An inline table
 * (`{ a = 1 }`) is refused because the block form already expresses everything
 * it can, and half-supporting a second syntax for the same thing is how a parser
 * ends up disagreeing with itself. A date or time is refused because JavaScript
 * has no offset-less date and no local time: TOML's `1979-05-27T07:32:00` is a
 * wall clock with no zone, and turning it into a `Date` invents one — the very
 * thing this codebase refuses to do with money and does not do here either.
 */
export function parseToml(text: string): StructuredResult<StructuredValue> {
  return catchingAbort(() => {
    const root: MutableObject = {};
    const state: TomlState = {
      text,
      root,
      declared: new Set<string>(),
      tableArrays: new Set<string>(),
      current: root,
      currentPath: [],
    };
    const cursor: Cursor = { text, index: 0 };

    for (;;) {
      skipTomlBlank(cursor);
      if (cursor.index >= text.length) break;
      const offset = cursor.index;

      if (text[cursor.index] === "[") {
        const isArray = text[cursor.index + 1] === "[";
        cursor.index += isArray ? 2 : 1;
        skipTomlInline(cursor);
        const parts = scanTomlKey(cursor);
        skipTomlInline(cursor);
        const closing = isArray ? "]]" : "]";
        if (!text.startsWith(closing, cursor.index)) {
          throw fail(text, cursor.index, "toml.unterminated-header", closing, text[cursor.index] ?? "");
        }
        cursor.index += closing.length;
        if (isArray) openTomlTableArray(state, parts, offset);
        else openTomlTable(state, parts, offset);
        expectTomlLineEnd(cursor);
        continue;
      }

      const parts = scanTomlKey(cursor);
      skipTomlInline(cursor);
      if (text[cursor.index] !== "=") {
        throw fail(text, cursor.index, "toml.expected-equals", "=", text[cursor.index] ?? "");
      }
      cursor.index += 1;
      skipTomlInline(cursor);
      const value = scanTomlValue(cursor);
      assignTomlKey(state, parts, value, offset);
      expectTomlLineEnd(cursor);
    }

    return root as StructuredValue;
  });
}

const TOML_STRING_ESCAPES: Readonly<Record<string, string>> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
  '"': '\\"',
  "\\": "\\\\",
};

function tomlString(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = TOML_STRING_ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return `${out}"`;
}

const TOML_WHOLE_BARE_KEY = /^[A-Za-z0-9_-]+$/;

function tomlKeyText(key: string): string {
  return TOML_WHOLE_BARE_KEY.test(key) ? key : tomlString(key);
}

function tomlScalar(value: StructuredValue, source: string): string {
  if (value === null) throw fail(source, 0, "convert.toml-null", "", "null");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (value === Number.POSITIVE_INFINITY) return "inf";
    if (value === Number.NEGATIVE_INFINITY) return "-inf";
    return String(value);
  }
  if (isStructuredArray(value)) {
    return `[${value.map((item) => tomlScalar(item, source)).join(", ")}]`;
  }
  throw fail(source, 0, "convert.toml-object-in-array", "", "table");
}

/** Whether an array is a list of tables (`[[name]]` blocks) rather than a list of values (`name = [...]`). */
function tomlArrayKind(items: readonly StructuredValue[]): "tables" | "values" | "mixed" {
  if (items.length === 0) return "values";
  const objects = items.filter((item) => isStructuredObject(item)).length;
  if (objects === 0) return "values";
  if (objects === items.length) return "tables";
  return "mixed";
}

function writeTomlTable(
  table: StructuredObject,
  path: readonly string[],
  out: string[],
  source: string,
  emitHeader: boolean,
): void {
  const keys = Object.keys(table);
  const scalars = keys.filter((key) => {
    const value = table[key] ?? null;
    return !isStructuredObject(value) && !(isStructuredArray(value) && tomlArrayKind(value) === "tables");
  });
  const tables = keys.filter((key) => isStructuredObject(table[key] ?? null));
  const arrays = keys.filter((key) => {
    const value = table[key] ?? null;
    return isStructuredArray(value) && tomlArrayKind(value) === "tables";
  });

  if (emitHeader && path.length > 0) {
    if (out.length > 0) out.push("");
    out.push(`[${path.map(tomlKeyText).join(".")}]`);
  }
  for (const key of scalars) {
    const value = table[key] ?? null;
    if (isStructuredArray(value) && tomlArrayKind(value) === "mixed") {
      throw fail(source, 0, "convert.toml-mixed-array", "", key);
    }
    out.push(`${tomlKeyText(key)} = ${tomlScalar(value, source)}`);
  }
  for (const key of tables) {
    const value = table[key];
    if (value === undefined || !isStructuredObject(value)) continue;
    writeTomlTable(value, [...path, key], out, source, true);
  }
  for (const key of arrays) {
    const value = table[key];
    if (value === undefined || !isStructuredArray(value)) continue;
    for (const item of value) {
      if (!isStructuredObject(item)) continue;
      if (out.length > 0) out.push("");
      out.push(`[[${[...path, key].map(tomlKeyText).join(".")}]]`);
      // The element's own header is already written, so its body carries on at
      // the same path without a second `[...]` line.
      writeTomlTable(item, [...path, key], out, source, false);
    }
  }
}

/**
 * A value as TOML text.
 *
 * The root must be a table, which is the refusal the format itself forces: a
 * TOML document IS a table, so a top-level array has no spelling at all. Wrapping
 * it in a made-up key („items") would be inventing structure the user never
 * wrote, so this refuses and names what it wanted.
 */
export function stringifyToml(value: StructuredValue): StructuredResult<string> {
  if (!isStructuredObject(value)) {
    return structuredFail(makeStructuredError("", 0, "convert.toml-root-not-table", "table", typeName(value)));
  }
  return catchingAbort(() => {
    const out: string[] = [];
    writeTomlTable(value, [], out, "", true);
    return out.length === 0 ? "" : `${out.join("\n")}\n`;
  });
}

/** Names a value's shape for an error's `found` field. */
function typeName(value: StructuredValue): string {
  if (value === null) return "null";
  if (isStructuredArray(value)) return "array";
  if (isStructuredObject(value)) return "table";
  return typeof value;
}

// ---------------------------------------------------------------------------
// Conversion between the four formats
// ---------------------------------------------------------------------------

/** The formats the converter reads and writes. */
export const DATA_FORMATS = ["json", "yaml", "toml", "csv"] as const;

export type DataFormat = (typeof DATA_FORMATS)[number];

/** How a conversion renders its output. */
export interface ConvertOptions {
  /** Indent for JSON output; YAML and TOML have one conventional shape each and ignore it. */
  readonly indent: number | "tab";
  /** Sort object keys in the output. */
  readonly sortKeys: boolean;
  /** Delimiter, header and null policy for the CSV side of the conversion. */
  readonly csv: Partial<CsvWriteOptions>;
}

/**
 * Every stable limit code a conversion can carry. These are not errors — they
 * are what the surface says BEFORE the button is pressed, so „my comments
 * disappeared" is something the user was told rather than something they
 * discovered afterwards.
 */
export const CONVERSION_LIMIT_CODES = [
  "limit.comments-lost",
  "limit.csv-flat-only",
  "limit.csv-text-only",
  "limit.csv-no-null",
  "limit.toml-root-table",
  "limit.toml-no-null",
  "limit.toml-no-datetime",
  "limit.json-no-nan",
  "limit.yaml-no-anchors",
] as const;

export type ConversionLimit = (typeof CONVERSION_LIMIT_CODES)[number];

/**
 * What this conversion cannot carry across, as stable codes in a fixed order.
 *
 * Deliberately a plain list rather than prose: the Serbian sentence lives in the
 * strings table with everything else, and a test can assert the list without
 * asserting a translation.
 */
export function conversionLimits(from: DataFormat, to: DataFormat): readonly ConversionLimit[] {
  const limits: ConversionLimit[] = [];
  if (from !== to && (from === "yaml" || from === "toml")) limits.push("limit.comments-lost");
  if (from === "yaml") limits.push("limit.yaml-no-anchors");
  if (from === "toml") limits.push("limit.toml-no-datetime");
  if (from === "csv") limits.push("limit.csv-text-only");
  if (to === "csv") limits.push("limit.csv-flat-only", "limit.csv-no-null");
  if (to === "toml") limits.push("limit.toml-root-table", "limit.toml-no-null");
  if (to === "json" && from !== "json") limits.push("limit.json-no-nan");
  return limits;
}

function csvCellText(value: StructuredValue, nullAs: "refuse" | "empty", key: string): string {
  if (value === null) {
    if (nullAs === "empty") return "";
    throw fail("", 0, "convert.csv-null", "", key);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  throw fail("", 0, "convert.csv-nesting", "", key);
}

function valueToCsvRows(
  value: StructuredValue,
  options: Partial<CsvWriteOptions>,
): readonly (readonly string[])[] {
  if (!isStructuredArray(value)) {
    throw fail("", 0, "convert.csv-needs-rows", "array", typeName(value));
  }
  if (value.length === 0) return [];
  const nullAs = options.nullAs ?? "refuse";
  const wantsHeader = options.header ?? true;

  if (value.every((row) => isStructuredArray(row))) {
    return value.map((row) =>
      (row as readonly StructuredValue[]).map((cell, column) =>
        csvCellText(cell, nullAs, String(column)),
      ),
    );
  }
  if (!value.every((row) => isStructuredObject(row))) {
    throw fail("", 0, "convert.csv-needs-rows", "array of objects", "mixed");
  }

  const rows = value as readonly StructuredObject[];
  const first = rows[0];
  if (first === undefined) return [];
  const header = Object.keys(first);
  const expected = new Set(header);
  for (const row of rows) {
    const keys = Object.keys(row);
    // A union header would fill the gaps with empty fields, which read back as
    // the empty string — „this row had no such column" and „this row had an
    // empty one" would become the same claim.
    if (keys.length !== header.length || keys.some((key) => !expected.has(key))) {
      throw fail("", 0, "convert.csv-ragged-object", header.join(","), keys.join(","));
    }
  }

  const body = rows.map((row) => header.map((key) => csvCellText(row[key] ?? null, nullAs, key)));
  return wantsHeader ? [header, ...body] : body;
}

/** Reads a document of `format` into the common value model. */
export function readStructured(text: string, format: DataFormat): StructuredResult<StructuredValue> {
  switch (format) {
    case "json":
      return parseJson(text, { exactNumbers: true });
    case "toml":
      return parseToml(text);
    case "csv":
      return parseCsvValue(text);
    case "yaml": {
      // `exactNumbers` for the same reason the JSON branch above asks for it and
      // `parseToml` enforces it unconditionally: this is the conversion path, so
      // the rounded number is not something the user is looking at, it is what
      // the tool is about to write into their other file. Leaving the option at
      // its default here made YAML the one source that walked past the guard.
      const documents = parseYaml(text, { exactNumbers: true });
      if (!documents.ok) return documents;
      if (documents.value.length > 1) {
        return structuredFail(
          makeStructuredError(text, 0, "convert.yaml-multiple-documents", "1", String(documents.value.length)),
        );
      }
      return structuredOk(documents.value[0] ?? null);
    }
  }
}

/** Writes the common value model out as `format`. */
export function writeStructured(
  value: StructuredValue,
  format: DataFormat,
  options: Partial<ConvertOptions> = {},
): StructuredResult<string> {
  switch (format) {
    case "json": {
      const json: Partial<JsonFormatOptions> = {
        indent: options.indent ?? 2,
        sortKeys: options.sortKeys ?? false,
      };
      return stringifyJson(value, json);
    }
    case "yaml":
      return structuredOk(serializeYaml(value, { sortKeys: options.sortKeys ?? false }));
    case "toml":
      return stringifyToml(value);
    case "csv":
      return catchingAbort(() => stringifyCsv(valueToCsvRows(value, options.csv ?? {}), options.csv ?? {}));
  }
}

/**
 * One document, in another format — or a positioned refusal naming exactly what
 * could not cross.
 *
 * Converting a format to itself is allowed and is not a no-op: it is the
 * normaliser (re-indent, sort keys, drop comments), which is a thing people
 * actually want and would otherwise have to fake by round-tripping through JSON.
 */
export function convertFormat(
  text: string,
  from: DataFormat,
  to: DataFormat,
  options: Partial<ConvertOptions> = {},
): StructuredResult<string> {
  const value = readStructured(text, from);
  if (!value.ok) return value;
  return writeStructured(value.value, to, options);
}
