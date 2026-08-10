/**
 * The YAML subset DEV's editor reads and writes — and, just as deliberately, the
 * part of YAML it says out loud that it does not.
 *
 * **Why a subset at all.** YAML 1.2 is a large specification with several
 * features that exist to let a document refer to itself: anchors, aliases,
 * explicit tags, complex keys. Implementing them badly is worse than not
 * implementing them, because the failure mode is silent — an alias that is
 * dropped rather than expanded produces a document that parses, looks plausible
 * and is missing data. So every one of them is refused BY NAME, with a position:
 * „anchors are not supported" is a correct answer a user can act on, and quietly
 * losing one is not.
 *
 * **What is supported:** block mappings, block sequences (including the
 * same-indent form under a key, which is what most hand-written YAML uses),
 * plain / single-quoted / double-quoted scalars, literal `|` and folded `>`
 * blocks with all three chomping modes and an explicit indentation indicator,
 * comments, multiple documents separated by `---`, one level of flow (`[a, b]`,
 * `{a: 1}`), and YAML 1.2 core type resolution.
 *
 * **The Norway problem is not a problem here, and that is a version decision.**
 * In YAML 1.1 the plain scalars `yes`, `no`, `on`, `off` resolve to booleans,
 * which is how a country code `NO` becomes `false`. YAML 1.2's core schema
 * dropped that: only `true`/`false` (and their capitalised forms) are booleans,
 * and `no` is the string „no". This parser implements 1.2 core, so the trap does
 * not exist — but a file written for a 1.1 reader will resolve differently here,
 * which is worth knowing before blaming the file.
 *
 * **A multi-line plain scalar is refused rather than guessed.** YAML lets a
 * plain scalar continue onto more-indented following lines, folding them into
 * one string. In hand-written configuration that shape is far more often a
 * mis-indented nested block than an intentional multi-line string, and the two
 * are indistinguishable from the text. Refusing it (and naming the quoted or
 * block-scalar alternative in `expected`) turns a silently mangled document into
 * a caret on the offending line.
 *
 * This module and `structured.ts` import each other; the rule that keeps that
 * safe — no module-level value in either may be computed from the other — is
 * documented at the top of `structured.ts`.
 */

import {
  catchingAbort,
  compareStructuredKeys,
  decimalSurvivesDouble,
  isStructuredArray,
  isStructuredObject,
  makeStructuredError,
  structuredAbort,
  type StructuredError,
  type StructuredParseAbort,
  type StructuredResult,
  type StructuredValue,
} from "./structured.js";

/** Every code this module can report. Stable keys the surface maps to Serbian copy. */
export const YAML_ERROR_CODES = [
  "yaml.tab-indent",
  "yaml.directive",
  "yaml.anchor",
  "yaml.alias",
  "yaml.tag",
  "yaml.complex-key",
  "yaml.nested-flow",
  "yaml.unterminated-flow",
  "yaml.bad-indent",
  "yaml.expected-key",
  "yaml.duplicate-key",
  "yaml.unterminated-quote",
  "yaml.bad-escape",
  "yaml.trailing-content",
  "yaml.multiline-plain-scalar",
  "yaml.bad-block-header",
  "yaml.number-not-exact",
] as const;

export type YamlErrorCode = (typeof YAML_ERROR_CODES)[number];

function fail(
  source: string,
  offset: number,
  code: YamlErrorCode,
  expected = "",
  found = "",
): StructuredParseAbort {
  return structuredAbort(source, offset, code, expected, found);
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

interface YamlLine {
  /** Columns of leading spaces. For a blank line this is the whole line and is never compared. */
  readonly indent: number;
  /** The line with its indentation and any trailing comment removed, then right-trimmed. */
  readonly content: string;
  /** Absolute offset of the first non-space character. */
  readonly offset: number;
  /** Absolute offset of the line's first character — the origin `indent` is measured from. */
  readonly lineStart: number;
  /** The line exactly as written. Block scalars read this and nothing else. */
  readonly raw: string;
  readonly blank: boolean;
}

/**
 * Removes a trailing comment, respecting quotes.
 *
 * A `#` only opens a comment at the start of the content or after whitespace —
 * `color: red#dark` is the eight-character string „red#dark", and a naive
 * `indexOf("#")` would truncate it. Quotes are tracked because a `#` inside them
 * is never a comment, whatever precedes it.
 */
function stripComment(line: string): string {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (single) {
      if (char === "'") {
        if (line[index + 1] === "'") index += 1;
        else single = false;
      }
      continue;
    }
    if (double) {
      if (char === "\\") index += 1;
      else if (char === '"') double = false;
      continue;
    }
    if (char === "'") single = true;
    else if (char === '"') double = true;
    else if (char === "#") {
      const before = index === 0 ? " " : line[index - 1];
      if (before === " " || before === "\t") return line.slice(0, index);
    }
  }
  return line;
}

function splitYamlLines(text: string): readonly YamlLine[] {
  const lines: YamlLine[] = [];
  let index = 0;
  for (;;) {
    let end = index;
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
    const raw = text.slice(index, end);
    let indent = 0;
    while (raw[indent] === " ") indent += 1;
    const content = stripComment(raw.slice(indent)).trimEnd();
    lines.push({
      indent,
      content,
      offset: index + indent,
      lineStart: index,
      raw,
      blank: content === "",
    });
    if (end >= text.length) return lines;
    index = end + (text[end] === "\r" && text[end + 1] === "\n" ? 2 : 1);
    if (index >= text.length) return lines;
  }
}

/** YAML forbids a tab anywhere in indentation, and a file that uses them looks correct and nests wrongly. */
function requireNoTab(text: string, line: YamlLine): void {
  const tab = line.raw.indexOf("\t");
  if (tab >= 0 && tab <= line.indent) {
    throw fail(text, line.lineStart + tab, "yaml.tab-indent", "space", "tab");
  }
}

function firstNonBlank(window: readonly YamlLine[], from = 0): number {
  for (let index = from; index < window.length; index += 1) {
    if (window[index]?.blank === false) return index;
  }
  return -1;
}

function isSequenceStart(line: YamlLine): boolean {
  return line.content === "-" || line.content.startsWith("- ");
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

const YAML_NULL = /^(null|Null|NULL|~)$/;
const YAML_TRUE = /^(true|True|TRUE)$/;
const YAML_FALSE = /^(false|False|FALSE)$/;
const YAML_OCTAL = /^0o[0-7]+$/;
const YAML_HEX = /^0x[0-9a-fA-F]+$/;
const YAML_INFINITY = /^([-+]?)\.(inf|Inf|INF)$/;
const YAML_NOT_A_NUMBER = /^\.(nan|NaN|NAN)$/;

/**
 * The core schema's base-10 integer and float, narrowed at exactly one point: a
 * leading zero is not a number here, it is text.
 *
 * YAML 1.2's own resolution table matches `007` with `[-+]? [0-9]+` and calls it
 * the integer 7 — after which the zeros are gone for good, because the value the
 * tool holds IS seven and `serializeYaml` writes `7`. A `zip: 007` is a postal
 * code and a `phone: 0755123` is a phone number, which is the same trap the CSV
 * reader refuses to walk into for the same reason („a CSV column holding 007 is
 * a postal code in one file and an integer in another" — `parseCsvRows` in
 * `structured.ts`). Excluding the leading-zero forms hands them to the LAST row
 * of that same resolution table, `*` → `str`: so `007` is the string „007",
 * which loses nothing, and a user who meant seven writes `7`.
 */
const YAML_INT = /^[-+]?(0|[1-9][0-9]*)$/;
const YAML_FLOAT = /^[-+]?(\.[0-9]+|(0|[1-9][0-9]*)(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

/**
 * The same two patterns as the specification writes them, leading zeros and all.
 * Only serialization asks: the string „007" still has to be QUOTED on the way
 * out, because every conformant YAML 1.2 reader other than this one resolves an
 * unquoted `007` to an integer, and writing it bare would hand the next tool a
 * number where this one held text.
 */
const YAML_SPEC_INT = /^[-+]?[0-9]+$/;
const YAML_SPEC_FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

/** YAML 1.2 escape table, in full. The exotic four (`N`, `_`, `L`, `P`) are the Unicode line/space characters YAML names. */
const DOUBLE_ESCAPES: Readonly<Record<string, string>> = {
  "0": "\u0000",
  a: "\u0007",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\u000b",
  f: "\f",
  r: "\r",
  e: "\u001b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};

const HEX_WIDTHS: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };

/** Reads a double-quoted scalar starting at `raw[start]`; returns its value and the index just past the closing quote. */
function scanDoubleQuoted(
  text: string,
  raw: string,
  start: number,
  base: number,
): { readonly value: string; readonly end: number } {
  let index = start + 1;
  let value = "";
  for (;;) {
    const char = raw[index];
    if (char === undefined) throw fail(text, base + start, "yaml.unterminated-quote", '"');
    if (char === '"') return { value, end: index + 1 };
    if (char === "\\") {
      const marker = raw[index + 1];
      if (marker === undefined) throw fail(text, base + index, "yaml.bad-escape", "", "\\");
      const width = HEX_WIDTHS[marker];
      if (width !== undefined) {
        const hex = raw.slice(index + 2, index + 2 + width);
        if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) {
          throw fail(text, base + index, "yaml.bad-escape", `${width} hex digits`, hex);
        }
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        index += 2 + width;
        continue;
      }
      const mapped = DOUBLE_ESCAPES[marker];
      if (mapped === undefined) {
        throw fail(text, base + index, "yaml.bad-escape", "", `\\${marker}`);
      }
      value += mapped;
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }
}

/** Reads a single-quoted scalar. The only escape is `''`, which is one apostrophe. */
function scanSingleQuoted(
  text: string,
  raw: string,
  start: number,
  base: number,
): { readonly value: string; readonly end: number } {
  let index = start + 1;
  let value = "";
  for (;;) {
    const char = raw[index];
    if (char === undefined) throw fail(text, base + start, "yaml.unterminated-quote", "'");
    if (char === "'") {
      if (raw[index + 1] === "'") {
        value += "'";
        index += 2;
        continue;
      }
      return { value, end: index + 1 };
    }
    value += char;
    index += 1;
  }
}

/** Turns a plain scalar's text into the value YAML 1.2's core schema says it is. */
function resolvePlain(
  text: string,
  token: string,
  offset: number,
  exactNumbers: boolean,
): StructuredValue {
  if (token === "" || YAML_NULL.test(token)) return null;
  if (YAML_TRUE.test(token)) return true;
  if (YAML_FALSE.test(token)) return false;
  if (YAML_OCTAL.test(token)) return Number.parseInt(token.slice(2), 8);
  if (YAML_HEX.test(token)) return Number.parseInt(token.slice(2), 16);
  const infinite = YAML_INFINITY.exec(token);
  if (infinite !== null) {
    return infinite[1] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (YAML_NOT_A_NUMBER.test(token)) return Number.NaN;
  if (YAML_INT.test(token) || YAML_FLOAT.test(token)) {
    if (exactNumbers && !decimalSurvivesDouble(token)) {
      throw fail(text, offset, "yaml.number-not-exact", "", token);
    }
    return Number(token);
  }
  return token;
}

interface FlowCursor {
  readonly raw: string;
  index: number;
}

function skipFlowSpace(cursor: FlowCursor): void {
  while (cursor.raw[cursor.index] === " " || cursor.raw[cursor.index] === "\t") cursor.index += 1;
}

/**
 * One level of flow syntax.
 *
 * `depth` starts at 0 for the outermost `[` or `{`; anything that would open a
 * second level is refused. Flow inside flow is where this subset stops being a
 * line-oriented parser, and half of one is worse than none.
 */
function scanFlow(
  text: string,
  cursor: FlowCursor,
  base: number,
  depth: number,
  exactNumbers: boolean,
): StructuredValue {
  skipFlowSpace(cursor);
  const char = cursor.raw[cursor.index];
  if (char === undefined) throw fail(text, base + cursor.index, "yaml.unterminated-flow", "value");

  if (char === "[" || char === "{") {
    if (depth > 0) {
      throw fail(text, base + cursor.index, "yaml.nested-flow", "", char);
    }
    const closing = char === "[" ? "]" : "}";
    const opened = cursor.index;
    cursor.index += 1;
    const items: StructuredValue[] = [];
    const mapping: Record<string, StructuredValue> = {};
    for (;;) {
      skipFlowSpace(cursor);
      if (cursor.raw[cursor.index] === closing) {
        cursor.index += 1;
        return char === "[" ? items : mapping;
      }
      if (cursor.index >= cursor.raw.length) {
        throw fail(text, base + opened, "yaml.unterminated-flow", closing);
      }
      if (char === "[") {
        items.push(scanFlow(text, cursor, base, depth + 1, exactNumbers));
      } else {
        const keyStart = cursor.index;
        const name = scanFlowKey(text, cursor, base);
        skipFlowSpace(cursor);
        if (cursor.raw[cursor.index] !== ":") {
          throw fail(text, base + cursor.index, "yaml.expected-key", ":", cursor.raw[cursor.index] ?? "");
        }
        cursor.index += 1;
        if (Object.hasOwn(mapping, name)) {
          throw fail(text, base + keyStart, "yaml.duplicate-key", "", name);
        }
        mapping[name] = scanFlow(text, cursor, base, depth + 1, exactNumbers);
      }
      skipFlowSpace(cursor);
      const next = cursor.raw[cursor.index];
      if (next === ",") {
        cursor.index += 1;
        continue;
      }
      if (next === closing) {
        cursor.index += 1;
        return char === "[" ? items : mapping;
      }
      throw fail(text, base + opened, "yaml.unterminated-flow", closing, next ?? "");
    }
  }

  if (char === '"' || char === "'") {
    const scanned =
      char === '"'
        ? scanDoubleQuoted(text, cursor.raw, cursor.index, base)
        : scanSingleQuoted(text, cursor.raw, cursor.index, base);
    cursor.index = scanned.end;
    return scanned.value;
  }

  // A value never stops at a colon, or `{url: https://example.com}` would end
  // its value at „https" and then report a syntax error three characters later,
  // blaming the wrong thing. Only a KEY stops there, and a key never comes
  // through here — `scanFlowKey` reads it, for the reason written on that.
  const start = cursor.index;
  while (cursor.index < cursor.raw.length) {
    const inner = cursor.raw[cursor.index];
    if (inner === "," || inner === "]" || inner === "}") break;
    cursor.index += 1;
  }
  return resolvePlain(text, cursor.raw.slice(start, cursor.index).trim(), base + start, exactNumbers);
}

/**
 * A key inside a flow mapping, read as TEXT and never resolved.
 *
 * `{True: 1}` and a block `True: 1` have to produce the same key, and the only
 * way that holds is if neither side resolves: a block key is the literal token
 * (`parseKeyText`), so a flow key is the same token through the same function.
 * Resolving first and stringifying after is what turned `True` into „true" and
 * `007` into „7" — and, worse, made two keys that differ in the file collide as
 * a duplicate the file does not contain.
 */
function scanFlowKey(text: string, cursor: FlowCursor, base: number): string {
  skipFlowSpace(cursor);
  const char = cursor.raw[cursor.index];
  if (char === undefined) throw fail(text, base + cursor.index, "yaml.unterminated-flow", "key");
  if (char === '"' || char === "'") {
    const scanned =
      char === '"'
        ? scanDoubleQuoted(text, cursor.raw, cursor.index, base)
        : scanSingleQuoted(text, cursor.raw, cursor.index, base);
    cursor.index = scanned.end;
    return scanned.value;
  }
  // A collection as a key is a complex key, which this subset refuses by name
  // wherever it appears rather than only after `? `.
  if (char === "[" || char === "{") {
    throw fail(text, base + cursor.index, "yaml.complex-key", "", char);
  }
  const start = cursor.index;
  while (cursor.index < cursor.raw.length) {
    const inner = cursor.raw[cursor.index];
    if (inner === "," || inner === "]" || inner === "}" || inner === ":") break;
    cursor.index += 1;
  }
  return parseKeyText(text, cursor.raw.slice(start, cursor.index).trim(), base + start);
}

/** Everything that can appear as an inline value after `key:` or `-`, minus the block scalars. */
function parseInlineScalar(
  text: string,
  token: string,
  offset: number,
  exactNumbers: boolean,
): StructuredValue {
  const first = token[0];
  if (first === "&") throw fail(text, offset, "yaml.anchor", "", token);
  if (first === "*") throw fail(text, offset, "yaml.alias", "", token);
  if (first === "!") throw fail(text, offset, "yaml.tag", "", token);
  if (first === "[" || first === "{") {
    const cursor: FlowCursor = { raw: token, index: 0 };
    const value = scanFlow(text, cursor, offset, 0, exactNumbers);
    skipFlowSpace(cursor);
    if (cursor.index !== token.length) {
      throw fail(text, offset + cursor.index, "yaml.trailing-content", "", token.slice(cursor.index));
    }
    return value;
  }
  if (first === '"' || first === "'") {
    const scanned =
      first === '"'
        ? scanDoubleQuoted(text, token, 0, offset)
        : scanSingleQuoted(text, token, 0, offset);
    if (token.slice(scanned.end).trim() !== "") {
      throw fail(text, offset + scanned.end, "yaml.trailing-content", "", token.slice(scanned.end));
    }
    return scanned.value;
  }
  return resolvePlain(text, token, offset, exactNumbers);
}

/** A mapping key. Always a string in this model — `1:` is the key „1", which round-trips unchanged. */
function parseKeyText(text: string, token: string, offset: number): string {
  const first = token[0];
  if (first === "&") throw fail(text, offset, "yaml.anchor", "", token);
  if (first === "*") throw fail(text, offset, "yaml.alias", "", token);
  if (first === "!") throw fail(text, offset, "yaml.tag", "", token);
  if (first === '"') return scanDoubleQuoted(text, token, 0, offset).value;
  if (first === "'") return scanSingleQuoted(text, token, 0, offset).value;
  return token;
}

// ---------------------------------------------------------------------------
// Block scalars
// ---------------------------------------------------------------------------

type Chomping = "clip" | "strip" | "keep";

function parseBlockScalar(
  text: string,
  header: string,
  headerOffset: number,
  body: readonly YamlLine[],
  parentIndent: number,
): string {
  const style = header[0];
  let chomping: Chomping = "clip";
  let explicit = 0;
  for (const char of header.slice(1)) {
    if (char === "-") chomping = "strip";
    else if (char === "+") chomping = "keep";
    else if (char >= "1" && char <= "9") explicit = Number(char);
    else throw fail(text, headerOffset, "yaml.bad-block-header", "|, >, +, - or 1-9", char);
  }

  // Inside a block scalar a `#` is content, so `line.blank` — which is computed
  // from the line with its comment already stripped — asks the wrong question
  // here. Only whitespace makes a line of a block scalar empty.
  const isEmpty = (line: YamlLine): boolean => line.raw.trim() === "";
  const firstContent = body.find((line) => !isEmpty(line));
  const blockIndent = explicit > 0 ? parentIndent + explicit : (firstContent?.indent ?? parentIndent + 1);
  const lines = body.map((line) => {
    const leading = line.raw.length - line.raw.trimStart().length;
    // An empty line is allowed to be shorter than the block's indentation and
    // still belong to it: YAML says it contributes its break and nothing else.
    if (isEmpty(line)) return line.raw.slice(Math.min(blockIndent, leading));
    // A content line that does NOT carry the block's indentation is not part of
    // the block — YAML ends the scalar there, and nothing legal can follow it
    // inside this window, which holds only lines more indented than the parent
    // key. Slicing it by the block indent anyway is how „ world" became „orld":
    // the parser edited the user's text and said nothing.
    if (leading < blockIndent) {
      throw fail(
        text,
        line.lineStart + leading,
        "yaml.bad-indent",
        String(blockIndent),
        String(leading),
      );
    }
    return line.raw.slice(blockIndent);
  });

  let lastContent = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? "") !== "") lastContent = index;
  }
  const content = lines.slice(0, lastContent + 1);
  const trailingBreaks = lastContent < 0 ? lines.length : lines.length - (lastContent + 1);

  const joined = style === "|" ? content.join("\n") : foldLines(content);
  if (lastContent < 0) return chomping === "keep" ? "\n".repeat(trailingBreaks) : "";
  if (chomping === "strip") return joined;
  if (chomping === "keep") return `${joined}\n${"\n".repeat(trailingBreaks)}`;
  return `${joined}\n`;
}

/**
 * The folding rule of `>`, written out because it is the part everyone gets
 * wrong: a single break between two ordinary lines becomes a SPACE, blank lines
 * become that many newlines, and a break next to a MORE-INDENTED line is kept
 * literally — which is how a folded block can still hold a code sample.
 */
function foldLines(lines: readonly string[]): string {
  let out = "";
  let blanks = 0;
  let started = false;
  let previousMoreIndented = false;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks += 1;
      continue;
    }
    const moreIndented = line.startsWith(" ") || line.startsWith("\t");
    if (!started) {
      out = line;
      started = true;
    } else if (blanks > 0) {
      out += "\n".repeat(blanks) + line;
    } else {
      out += (previousMoreIndented || moreIndented ? "\n" : " ") + line;
    }
    previousMoreIndented = moreIndented;
    blanks = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block structure
// ---------------------------------------------------------------------------

/** The index of the `:` that ends this line's key, or -1 when the line is not a mapping entry. */
function keySeparator(content: string): number {
  if (content.startsWith("{") || content.startsWith("[")) return -1;
  let index = 0;
  if (content[0] === '"' || content[0] === "'") {
    const quote = content[0];
    index = 1;
    while (index < content.length) {
      const char = content[index];
      if (quote === '"' && char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && content[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      index += 1;
    }
    while (content[index] === " ") index += 1;
    return content[index] === ":" && (index + 1 === content.length || content[index + 1] === " ")
      ? index
      : -1;
  }
  for (; index < content.length; index += 1) {
    if (content[index] !== ":") continue;
    if (index + 1 === content.length || content[index + 1] === " ") return index;
  }
  return -1;
}

interface BlockOptions {
  readonly exactNumbers: boolean;
}

function parseBlock(text: string, window: readonly YamlLine[], options: BlockOptions): StructuredValue {
  const start = firstNonBlank(window);
  if (start < 0) return null;
  const head = window[start];
  if (head === undefined) return null;
  requireNoTab(text, head);
  if (head.content.startsWith("? ") || head.content === "?") {
    throw fail(text, head.offset, "yaml.complex-key", "", "?");
  }
  if (isSequenceStart(head)) return parseSequence(text, window, start, head.indent, options);
  if (keySeparator(head.content) >= 0) return parseMapping(text, window, start, head.indent, options);
  return parseSingle(text, window, start, options);
}

/** A value with no structure of its own: a scalar, a flow collection, or a block scalar and its body. */
function parseSingle(
  text: string,
  window: readonly YamlLine[],
  start: number,
  options: BlockOptions,
): StructuredValue {
  const head = window[start];
  if (head === undefined) return null;
  if (head.content.startsWith("|") || head.content.startsWith(">")) {
    return parseBlockScalar(text, head.content, head.offset, window.slice(start + 1), head.indent);
  }
  const next = firstNonBlank(window, start + 1);
  if (next >= 0) {
    const line = window[next];
    if (line !== undefined) {
      throw fail(text, line.offset, "yaml.multiline-plain-scalar", "quoted or | block", line.content);
    }
  }
  return parseInlineScalar(text, head.content, head.offset, options.exactNumbers);
}

/** The lines belonging to the entry that starts at `index`, i.e. everything more indented than it. */
function childWindow(
  window: readonly YamlLine[],
  index: number,
  base: number,
  allowSameIndentSequence: boolean,
): { readonly lines: readonly YamlLine[]; readonly next: number } {
  let scan = index + 1;
  while (scan < window.length) {
    const line = window[scan];
    if (line === undefined) break;
    if (line.blank || line.indent > base) {
      scan += 1;
      continue;
    }
    if (allowSameIndentSequence && line.indent === base && isSequenceStart(line)) {
      scan += 1;
      continue;
    }
    break;
  }
  return { lines: window.slice(index + 1, scan), next: scan };
}

function parseSequence(
  text: string,
  window: readonly YamlLine[],
  start: number,
  base: number,
  options: BlockOptions,
): StructuredValue {
  const items: StructuredValue[] = [];
  let index = start;
  while (index < window.length) {
    const line = window[index];
    if (line === undefined) break;
    if (line.blank) {
      index += 1;
      continue;
    }
    requireNoTab(text, line);
    if (line.indent !== base) {
      throw fail(text, line.offset, "yaml.bad-indent", String(base), String(line.indent));
    }
    if (!isSequenceStart(line)) {
      throw fail(text, line.offset, "yaml.bad-indent", "-", line.content.slice(0, 1));
    }

    const after = line.content.slice(1);
    const leading = after.length - after.trimStart().length;
    const remainder = after.trim();
    const child = childWindow(window, index, base, false);

    if (remainder === "") {
      items.push(parseBlock(text, child.lines, options));
    } else {
      const synthetic: YamlLine = {
        indent: line.indent + 1 + leading,
        content: remainder,
        offset: line.offset + 1 + leading,
        lineStart: line.lineStart,
        raw: line.raw,
        blank: false,
      };
      items.push(parseBlock(text, [synthetic, ...child.lines], options));
    }
    index = child.next;
  }
  return items;
}

function parseMapping(
  text: string,
  window: readonly YamlLine[],
  start: number,
  base: number,
  options: BlockOptions,
): StructuredValue {
  const mapping: Record<string, StructuredValue> = {};
  let index = start;
  while (index < window.length) {
    const line = window[index];
    if (line === undefined) break;
    if (line.blank) {
      index += 1;
      continue;
    }
    requireNoTab(text, line);
    if (line.indent !== base) {
      throw fail(text, line.offset, "yaml.bad-indent", String(base), String(line.indent));
    }
    if (line.content.startsWith("? ") || line.content === "?") {
      throw fail(text, line.offset, "yaml.complex-key", "", "?");
    }
    const separator = keySeparator(line.content);
    if (separator < 0) {
      throw fail(text, line.offset, "yaml.expected-key", ":", line.content);
    }
    const key = parseKeyText(text, line.content.slice(0, separator).trimEnd(), line.offset);
    if (Object.hasOwn(mapping, key)) {
      throw fail(text, line.offset, "yaml.duplicate-key", "", key);
    }

    const after = line.content.slice(separator + 1);
    const leading = after.length - after.trimStart().length;
    const token = after.trim();
    const tokenOffset = line.offset + separator + 1 + leading;
    const child = childWindow(window, index, base, token === "");

    if (token.startsWith("|") || token.startsWith(">")) {
      mapping[key] = parseBlockScalar(text, token, tokenOffset, child.lines, base);
    } else if (token === "") {
      mapping[key] = parseBlock(text, child.lines, options);
    } else {
      const nested = firstNonBlank(child.lines);
      if (nested >= 0) {
        const offender = child.lines[nested];
        if (offender !== undefined) {
          throw fail(
            text,
            offender.offset,
            "yaml.multiline-plain-scalar",
            "quoted or | block",
            offender.content,
          );
        }
      }
      mapping[key] = parseInlineScalar(text, token, tokenOffset, options.exactNumbers);
    }
    index = child.next;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function splitDocuments(text: string, lines: readonly YamlLine[]): readonly (readonly YamlLine[])[] {
  const documents: YamlLine[][] = [];
  let current: YamlLine[] = [];
  let opened = false;

  for (const line of lines) {
    if (line.indent === 0 && line.content.startsWith("%")) {
      throw fail(text, line.offset, "yaml.directive", "", line.content.split(" ")[0] ?? "%");
    }
    if (line.indent === 0 && (line.content === "---" || line.content.startsWith("--- "))) {
      if (opened) documents.push(current);
      current = [];
      opened = true;
      const rest = line.content.slice(3);
      const leading = rest.length - rest.trimStart().length;
      const remainder = rest.trim();
      if (remainder !== "") {
        current.push({
          indent: 3 + leading,
          content: remainder,
          offset: line.lineStart + 3 + leading,
          lineStart: line.lineStart,
          raw: line.raw,
          blank: false,
        });
      }
      continue;
    }
    if (line.indent === 0 && line.content === "...") {
      documents.push(current);
      current = [];
      opened = false;
      continue;
    }
    current.push(line);
    opened = true;
  }
  if (opened || documents.length === 0) documents.push(current);
  return documents;
}

/** What `parseYaml` is allowed to lose. */
export interface YamlParseOptions {
  /**
   * Refuse a number whose decimal cannot be recovered from the double it parses
   * to. Off while editing — the user is looking at their own file — and on for
   * conversion, where the number is about to be written back out somewhere else.
   */
  readonly exactNumbers: boolean;
}

/**
 * Every document in the stream, in order. A stream with no `---` is one
 * document; an empty file is one document whose value is `null`, which is what
 * YAML says an empty document is.
 */
export function parseYaml(
  text: string,
  options: Partial<YamlParseOptions> = {},
): StructuredResult<readonly StructuredValue[]> {
  const blockOptions: BlockOptions = { exactNumbers: options.exactNumbers ?? false };
  return catchingAbort(() => {
    const documents = splitDocuments(text, splitYamlLines(text));
    return documents.map((window) => parseBlock(text, window, blockOptions));
  });
}

/** The single document this text holds, refusing a stream that has more than one. */
export function parseYamlValue(
  text: string,
  options: Partial<YamlParseOptions> = {},
): StructuredResult<StructuredValue> {
  const documents = parseYaml(text, options);
  if (!documents.ok) return documents;
  if (documents.value.length > 1) {
    return {
      ok: false,
      error: makeStructuredError(
        text,
        0,
        "convert.yaml-multiple-documents",
        "1",
        String(documents.value.length),
      ),
    };
  }
  return { ok: true, value: documents.value[0] ?? null };
}

/** The first thing wrong with this YAML, or `null` when nothing is. */
export function validateYaml(text: string): StructuredError | null {
  const result = parseYaml(text);
  return result.ok ? null : result.error;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const YAML_INDICATORS = new Set(["-", "?", ":", ",", "[", "]", "{", "}", "#", "&", "*", "!", "|", ">", "'", '"', "%", "@", "`"]);

const YAML_STRING_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

function quoteYamlString(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = YAML_STRING_ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.charCodeAt(0);
    out += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return `${out}"`;
}

/** Any character below U+0020 — a line break, a tab, or anything a plain scalar cannot hold. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * Whether writing this string plain would make it read back as something else.
 *
 * The test is deliberately a resolution table rather than a hand list: any
 * string that WOULD resolve to a null, a boolean or a number has to be quoted,
 * or „true" comes back a boolean and „1.5" comes back a float. It is the
 * SPECIFICATION's table rather than this parser's narrower one, because the
 * reader on the other side of the file may be any YAML 1.2 implementation:
 * „007" is text here and the integer 7 to all of them, so it is quoted. The rest
 * are the syntactic traps — an indicator in first position, a `: ` or ` #`
 * inside, edge whitespace, a line break.
 */
function needsQuoting(value: string): boolean {
  if (value === "") return true;
  if (value !== value.trim()) return true;
  if (value === "---" || value === "...") return true;
  const first = value[0];
  if (first !== undefined && YAML_INDICATORS.has(first)) return true;
  if (value.includes(": ") || value.includes(" #") || value.endsWith(":")) return true;
  if (hasControlCharacter(value)) return true;
  return (
    YAML_NULL.test(value) ||
    YAML_TRUE.test(value) ||
    YAML_FALSE.test(value) ||
    YAML_SPEC_INT.test(value) ||
    YAML_OCTAL.test(value) ||
    YAML_HEX.test(value) ||
    YAML_SPEC_FLOAT.test(value) ||
    YAML_INFINITY.test(value) ||
    YAML_NOT_A_NUMBER.test(value)
  );
}

/** A scalar as YAML text. `.inf` and `.nan` rather than JavaScript's spellings, which YAML does not read. */
function yamlScalarText(value: StructuredValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ".nan";
    if (value === Number.POSITIVE_INFINITY) return ".inf";
    if (value === Number.NEGATIVE_INFINITY) return "-.inf";
    return String(value);
  }
  if (typeof value === "string") return needsQuoting(value) ? quoteYamlString(value) : value;
  return "";
}

/** A value with no structure. Written as a predicate so the container branches narrow. */
function isScalar(value: StructuredValue): value is null | boolean | number | string {
  return !isStructuredArray(value) && !isStructuredObject(value);
}

/** Guards against a value graph that refers to itself, which is a caller bug rather than bad input. */
const MAX_DEPTH = 100;

function yamlLines(value: StructuredValue, sortKeys: boolean, depth: number): readonly string[] {
  if (depth > MAX_DEPTH) {
    throw new TypeError("serializeYaml: value nests past 100 levels, or refers to itself");
  }
  if (!isStructuredObject(value) && !isStructuredArray(value)) return [yamlScalarText(value)];
  if (isStructuredArray(value)) {
    if (value.length === 0) return ["[]"];
    const out: string[] = [];
    for (const item of value) {
      const child = yamlLines(item, sortKeys, depth + 1);
      const [head, ...rest] = child;
      out.push(`- ${head ?? ""}`);
      for (const line of rest) out.push(`  ${line}`);
    }
    return out;
  }
  const keys = sortKeys ? [...Object.keys(value)].sort(compareStructuredKeys) : Object.keys(value);
  if (keys.length === 0) return ["{}"];
  const out: string[] = [];
  for (const key of keys) {
    const child = value[key] ?? null;
    const name = needsQuoting(key) ? quoteYamlString(key) : key;
    if (isScalar(child)) {
      out.push(`${name}: ${yamlScalarText(child)}`);
      continue;
    }
    const lines = yamlLines(child, sortKeys, depth + 1);
    const [head] = lines;
    if (lines.length === 1 && (head === "[]" || head === "{}")) {
      out.push(`${name}: ${head}`);
      continue;
    }
    out.push(`${name}:`);
    for (const line of lines) out.push(`  ${line}`);
  }
  return out;
}

/** How `serializeYaml` orders what it writes. */
export interface YamlSerializeOptions {
  readonly sortKeys: boolean;
}

/**
 * A value as YAML text, ending in a newline.
 *
 * Sequences nested under a key are written INDENTED rather than in the legal
 * same-indent form. Both parse, here and everywhere else; the indented one is
 * the one a reader can scan without counting columns, and it is what the parser
 * above produces the least ambiguity from.
 */
export function serializeYaml(
  value: StructuredValue,
  options: Partial<YamlSerializeOptions> = {},
): string {
  const lines = yamlLines(value, options.sortKeys ?? false, 0);
  return `${lines.join("\n")}\n`;
}

/** Several documents as one stream, each opened by its own `---`. */
export function serializeYamlDocuments(
  values: readonly StructuredValue[],
  options: Partial<YamlSerializeOptions> = {},
): string {
  if (values.length === 0) return "";
  return values.map((value) => `---\n${serializeYaml(value, options)}`).join("");
}
