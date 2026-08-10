/**
 * The markup parser behind DEV's XML editor — a tree, a pretty printer, a
 * minifier, a well-formedness check with a position, and an XPath subset.
 *
 * **It parses XML and the HTML people actually paste.** Two concessions are
 * deliberate and neither is a guess. A void element (`<br>`, `<img>`, `<meta>`)
 * is complete without a closing tag, because a `<br>` that is never closed is
 * HTML rather than a defect — while a `<div>` that is never closed still is one,
 * and is reported at the tag that opened it. A raw-text element (`<script>`,
 * `<style>`) holds text and not markup, so a `<` inside one is a less-than sign;
 * treating it as a tag is how a parser „finds" elements that were never there.
 *
 * **A bare `<` in text IS refused.** It is the one place this is stricter than a
 * browser: `a < b` is not well-formed and a browser's recovery rule invents a
 * tag. Refusing at the `<` gives the user the caret; recovering would give them
 * a tree that does not match their file.
 *
 * **The single-root rule is not enforced, and that is a decision.** A
 * well-formed XML DOCUMENT has exactly one root element, but the text pasted
 * into a tool like this is a fragment out of a template at least as often as it
 * is a whole file, and refusing a fragment would make the tool useless exactly
 * where it is most used. So a document here is a list of top-level nodes.
 *
 * **Text keeps its lexeme; only value questions decode.** A text node carries
 * both what was written (`raw`) and what it means (`value`), and printing uses
 * `raw`. That is what lets an unknown entity — `&nbsp;`, which needs an HTML
 * entity table this package does not ship — survive a format/minify round trip
 * untouched, instead of being „fixed" into `&amp;nbsp;` by a re-encoder.
 *
 * **Pretty-printing rewrites whitespace, because that is what it is for.** The
 * places where doing so would change meaning are left alone instead: an element
 * with mixed content (text next to elements) is printed on one line verbatim,
 * and `pre`, `textarea`, `script` and `style` are copied byte for byte.
 */

import {
  catchingAbort,
  structuredAbort,
  type StructuredError,
  type StructuredParseAbort,
  type StructuredResult,
} from "./structured.js";

/** Every code this module can report. Stable keys the surface maps to Serbian copy. */
export const XML_ERROR_CODES = [
  "xml.unexpected-char",
  "xml.bad-name",
  "xml.unclosed-tag",
  "xml.mismatched-close",
  "xml.stray-close",
  "xml.duplicate-attribute",
  "xml.unterminated-comment",
  "xml.unterminated-cdata",
  "xml.unterminated-instruction",
  "xml.unterminated-doctype",
  "xml.unterminated-tag",
  "xml.unterminated-attribute",
  "xpath.expected-absolute",
  "xpath.expected-name",
  "xpath.unexpected-char",
  "xpath.unterminated-quote",
  "xpath.unsupported",
] as const;

export type XmlErrorCode = (typeof XML_ERROR_CODES)[number];

function fail(
  source: string,
  offset: number,
  code: XmlErrorCode,
  expected = "",
  found = "",
): StructuredParseAbort {
  return structuredAbort(source, offset, code, expected, found);
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

/** One attribute, keeping both what it means and how it was written. */
export interface XmlAttribute {
  readonly name: string;
  /** Entity-decoded. What a comparison — an XPath predicate, say — should use. */
  readonly value: string;
  /** Exactly as written between the quotes. What serialization re-emits. */
  readonly raw: string;
  /** The quote character used, or `""` for an unquoted HTML-style value. */
  readonly quote: '"' | "'" | "";
  /** `false` for a bare attribute with no `=` at all, which HTML allows. */
  readonly hasValue: boolean;
}

export interface XmlElement {
  readonly kind: "element";
  readonly name: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
  /** Written `<name/>`. Preserved so printing does not rewrite one form into the other. */
  readonly selfClosing: boolean;
}

export interface XmlText {
  readonly kind: "text";
  /** Exactly as written, entities and all. */
  readonly raw: string;
  /** Entity-decoded; unknown named entities are left standing.  */
  readonly value: string;
}

export interface XmlComment {
  readonly kind: "comment";
  /** The text between `<!--` and `-->`. */
  readonly text: string;
}

export interface XmlCData {
  readonly kind: "cdata";
  /** The text between `<![CDATA[` and `]]>`, which is never markup and never entity-decoded. */
  readonly text: string;
}

export interface XmlInstruction {
  readonly kind: "instruction";
  /** The text between `<?` and `?>`, including the target. */
  readonly text: string;
}

export interface XmlDoctype {
  readonly kind: "doctype";
  /** The whole declaration between `<!` and its matching `>`. */
  readonly text: string;
}

export type XmlNode = XmlElement | XmlText | XmlComment | XmlCData | XmlInstruction | XmlDoctype;

/** A parsed document. A LIST of top-level nodes — see the note on the single-root rule. */
export interface XmlDocument {
  readonly children: readonly XmlNode[];
}

/** HTML's void elements: complete without a closing tag. Compared case-insensitively. */
export const XML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Elements whose content is text rather than markup. A `<` inside one is a less-than sign. */
export const XML_RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style"]);

/** Elements whose inner whitespace is content, so the pretty printer copies them verbatim. */
export const XML_PRESERVE_ELEMENTS: ReadonlySet<string> = new Set([
  "pre",
  "textarea",
  "script",
  "style",
]);

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

const ENTITY = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * The five predefined entities and the numeric ones, decoded. Anything else —
 * `&nbsp;` and the rest of the HTML set — is left exactly as written, because
 * shipping an entity table this tool does not need would be the only way to
 * decode it, and half a table decodes some documents and corrupts others.
 */
export function decodeXmlText(raw: string): string {
  return raw.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const digits = body.slice(1);
      const code =
        digits[0] === "x" || digits[0] === "X"
          ? Number.parseInt(digits.slice(1), 16)
          : Number.parseInt(digits, 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** A literal tab or line break inside an attribute value; a CRLF is one break, not two. */
const ATTRIBUTE_BREAK = /\r\n|[\t\n\r]/g;

/**
 * An attribute's value, normalized as XML 1.0 §3.3.3 requires.
 *
 * A tab or a line break TYPED between the quotes is a single space in the value
 * the application sees — a CRLF being one break (§2.11) and therefore one space
 * — while a character REFERENCE is exempt: §3.3.3 appends the referenced
 * character itself, which is the only way to put a real newline in a value. That
 * exemption is why the replacement runs on the raw lexeme and `decodeXmlText`
 * runs after it, never the other way round. `raw` is untouched, so what is
 * printed back is still byte for byte what was written.
 */
function attributeValue(raw: string): string {
  return decodeXmlText(raw.replace(ATTRIBUTE_BREAK, " "));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const NAME_START = /[A-Za-z_:]/;
const NAME = /^[A-Za-z_:][A-Za-z0-9._:-]*/;

interface Frame {
  readonly name: string;
  readonly attributes: XmlAttribute[];
  readonly children: XmlNode[];
  readonly offset: number;
}

interface Scanner {
  readonly text: string;
  index: number;
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function skipSpace(scanner: Scanner): void {
  while (isSpace(scanner.text[scanner.index])) scanner.index += 1;
}

function scanName(scanner: Scanner): string {
  const match = NAME.exec(scanner.text.slice(scanner.index));
  const name = match?.[0];
  if (name === undefined) {
    throw fail(
      scanner.text,
      scanner.index,
      "xml.bad-name",
      "name",
      scanner.text[scanner.index] ?? "",
    );
  }
  scanner.index += name.length;
  return name;
}

/** Reads the attribute list of an open tag and returns whether the tag closed itself. */
function scanAttributes(scanner: Scanner, into: XmlAttribute[], tagOffset: number): boolean {
  const seen = new Set<string>();
  for (;;) {
    skipSpace(scanner);
    const char = scanner.text[scanner.index];
    if (char === undefined) throw fail(scanner.text, tagOffset, "xml.unterminated-tag", ">");
    if (char === ">") {
      scanner.index += 1;
      return false;
    }
    if (char === "/" && scanner.text[scanner.index + 1] === ">") {
      scanner.index += 2;
      return true;
    }

    const nameOffset = scanner.index;
    if (!NAME_START.test(char)) {
      throw fail(scanner.text, nameOffset, "xml.bad-name", "attribute name", char);
    }
    const name = scanName(scanner);
    // Case-sensitive, as XML defines it: `A` and `a` are two attributes, and
    // folding them would refuse a legal document.
    if (seen.has(name)) {
      throw fail(scanner.text, nameOffset, "xml.duplicate-attribute", "", name);
    }
    seen.add(name);

    skipSpace(scanner);
    if (scanner.text[scanner.index] !== "=") {
      into.push({ name, value: "", raw: "", quote: "", hasValue: false });
      continue;
    }
    scanner.index += 1;
    skipSpace(scanner);

    const opener = scanner.text[scanner.index];
    if (opener === '"' || opener === "'") {
      const start = scanner.index + 1;
      const end = scanner.text.indexOf(opener, start);
      if (end < 0) throw fail(scanner.text, scanner.index, "xml.unterminated-attribute", opener);
      const raw = scanner.text.slice(start, end);
      scanner.index = end + 1;
      into.push({ name, value: attributeValue(raw), raw, quote: opener, hasValue: true });
      continue;
    }
    const start = scanner.index;
    while (scanner.index < scanner.text.length) {
      const inner = scanner.text[scanner.index];
      if (isSpace(inner) || inner === ">" || (inner === "/" && scanner.text[scanner.index + 1] === ">")) break;
      scanner.index += 1;
    }
    if (scanner.index === start) {
      throw fail(scanner.text, start, "xml.unterminated-attribute", "value", opener ?? "");
    }
    // An unquoted value cannot hold whitespace at all — the scan above stops at
    // the first — so the normalization is provably a no-op here; it runs anyway
    // so that one function answers „what does this attribute mean" everywhere.
    const raw = scanner.text.slice(start, scanner.index);
    into.push({ name, value: attributeValue(raw), raw, quote: "", hasValue: true });
  }
}

/** Reads a `<!DOCTYPE …>`, whose internal subset may itself contain `>` inside brackets. */
function scanDoctype(scanner: Scanner): string {
  const start = scanner.index;
  let depth = 0;
  let index = start + 2;
  while (index < scanner.text.length) {
    const char = scanner.text[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (char === ">" && depth <= 0) {
      const text = scanner.text.slice(start + 2, index);
      scanner.index = index + 1;
      return text;
    }
    index += 1;
  }
  throw fail(scanner.text, start, "xml.unterminated-doctype", ">");
}

function scanDelimited(scanner: Scanner, open: string, close: string, code: XmlErrorCode): string {
  const start = scanner.index;
  const end = scanner.text.indexOf(close, start + open.length);
  if (end < 0) throw fail(scanner.text, start, code, close);
  const text = scanner.text.slice(start + open.length, end);
  scanner.index = end + close.length;
  return text;
}

/** Whether what follows a `</name` really ends the raw text, per WHATWG's raw-text end state. */
function closesRawText(char: string | undefined): boolean {
  return isSpace(char) || char === "/" || char === ">";
}

/**
 * Consumes a raw-text element's body up to its closing tag and returns it as one
 * text node's content.
 *
 * A `</script` is only the close when the name ENDS there — the next character
 * has to be whitespace, `/` or `>`. Taking the bare substring instead means
 * `"</scripted>"` inside a script refuses a document that is perfectly
 * well-formed. At the end of the input there is no next character and therefore
 * no close, so the element is reported unclosed at the tag that opened it.
 *
 * The comparison is per candidate rather than over a lower-cased copy of the
 * whole document, because lower-casing can change a string's LENGTH (`İ` becomes
 * two code units) and every offset after it would then point one character wrong.
 */
function scanRawText(scanner: Scanner, name: string, tagOffset: number): string {
  const close = `</${name.toLowerCase()}`;
  const { text } = scanner;
  for (
    let index = text.indexOf("<", scanner.index);
    index >= 0;
    index = text.indexOf("<", index + 1)
  ) {
    if (text.slice(index, index + close.length).toLowerCase() !== close) continue;
    if (!closesRawText(text[index + close.length])) continue;
    const body = text.slice(scanner.index, index);
    scanner.index = index;
    return body;
  }
  throw fail(text, tagOffset, "xml.unclosed-tag", `</${name}>`, name);
}

function scanDocument(text: string): XmlDocument {
  const scanner: Scanner = { text, index: 0 };
  const root: XmlNode[] = [];
  const stack: Frame[] = [];
  const top = (): XmlNode[] => stack[stack.length - 1]?.children ?? root;

  while (scanner.index < text.length) {
    const char = text[scanner.index];
    if (char !== "<") {
      const start = scanner.index;
      while (scanner.index < text.length && text[scanner.index] !== "<") scanner.index += 1;
      const raw = text.slice(start, scanner.index);
      top().push({ kind: "text", raw, value: decodeXmlText(raw) });
      continue;
    }

    if (text.startsWith("<!--", scanner.index)) {
      top().push({
        kind: "comment",
        text: scanDelimited(scanner, "<!--", "-->", "xml.unterminated-comment"),
      });
      continue;
    }
    if (text.startsWith("<![CDATA[", scanner.index)) {
      top().push({
        kind: "cdata",
        text: scanDelimited(scanner, "<![CDATA[", "]]>", "xml.unterminated-cdata"),
      });
      continue;
    }
    if (text.startsWith("<?", scanner.index)) {
      top().push({
        kind: "instruction",
        text: scanDelimited(scanner, "<?", "?>", "xml.unterminated-instruction"),
      });
      continue;
    }
    if (text.startsWith("<!", scanner.index)) {
      top().push({ kind: "doctype", text: scanDoctype(scanner) });
      continue;
    }

    if (text.startsWith("</", scanner.index)) {
      const closeOffset = scanner.index;
      scanner.index += 2;
      const name = scanName(scanner);
      skipSpace(scanner);
      if (text[scanner.index] !== ">") {
        throw fail(text, scanner.index, "xml.unterminated-tag", ">", text[scanner.index] ?? "");
      }
      scanner.index += 1;
      const frame = stack.pop();
      if (frame === undefined) {
        throw fail(text, closeOffset, "xml.stray-close", "", name);
      }
      if (frame.name !== name) {
        throw fail(text, closeOffset, "xml.mismatched-close", frame.name, name);
      }
      const element: XmlElement = {
        kind: "element",
        name: frame.name,
        attributes: frame.attributes,
        children: frame.children,
        selfClosing: false,
      };
      top().push(element);
      continue;
    }

    const tagOffset = scanner.index;
    const next = text[scanner.index + 1];
    if (next === undefined || !NAME_START.test(next)) {
      // A bare `<` in text. Refused rather than recovered from — see the header.
      throw fail(text, tagOffset, "xml.unexpected-char", "tag", next ?? "");
    }
    scanner.index += 1;
    const name = scanName(scanner);
    const attributes: XmlAttribute[] = [];
    const selfClosing = scanAttributes(scanner, attributes, tagOffset);

    if (selfClosing || XML_VOID_ELEMENTS.has(name.toLowerCase())) {
      top().push({ kind: "element", name, attributes, children: [], selfClosing });
      continue;
    }
    if (XML_RAW_TEXT_ELEMENTS.has(name.toLowerCase())) {
      const raw = scanRawText(scanner, name, tagOffset);
      const children: XmlNode[] = raw === "" ? [] : [{ kind: "text", raw, value: raw }];
      // The closing tag is still in the stream; push a frame so the normal
      // close-tag path validates it exactly like any other.
      stack.push({ name, attributes, children, offset: tagOffset });
      continue;
    }
    stack.push({ name, attributes, children: [], offset: tagOffset });
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed !== undefined) {
    throw fail(text, unclosed.offset, "xml.unclosed-tag", `</${unclosed.name}>`, unclosed.name);
  }
  return { children: root };
}

/** The document as a tree, or the first thing that is not well-formed and where it is. */
export function parseXml(text: string): StructuredResult<XmlDocument> {
  return catchingAbort(() => scanDocument(text));
}

/** The first well-formedness fault, or `null`. The single-root rule is deliberately not among them. */
export function validateXml(text: string): StructuredError | null {
  const result = parseXml(text);
  return result.ok ? null : result.error;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function attributeText(attribute: XmlAttribute): string {
  if (!attribute.hasValue) return attribute.name;
  const quote = attribute.quote === "" ? "" : attribute.quote;
  return `${attribute.name}=${quote}${attribute.raw}${quote}`;
}

function openTagText(element: XmlElement, close: string): string {
  const attributes = element.attributes.map((attribute) => ` ${attributeText(attribute)}`).join("");
  return `<${element.name}${attributes}${close}`;
}

/** One node and everything under it, on a single line, with every lexeme intact. */
function inlineText(node: XmlNode): string {
  switch (node.kind) {
    case "text":
      return node.raw;
    case "comment":
      return `<!--${node.text}-->`;
    case "cdata":
      return `<![CDATA[${node.text}]]>`;
    case "instruction":
      return `<?${node.text}?>`;
    case "doctype":
      return `<!${node.text}>`;
    case "element": {
      if (node.selfClosing) return openTagText(node, "/>");
      if (XML_VOID_ELEMENTS.has(node.name.toLowerCase()) && node.children.length === 0) {
        return openTagText(node, ">");
      }
      const inner = node.children.map(inlineText).join("");
      return `${openTagText(node, ">")}${inner}</${node.name}>`;
    }
  }
}

function isWhitespaceText(node: XmlNode): boolean {
  return node.kind === "text" && node.raw.trim() === "";
}

/** Children with the whitespace-only text between markup removed. */
function significantChildren(children: readonly XmlNode[]): readonly XmlNode[] {
  return children.filter((child) => !isWhitespaceText(child));
}

function indentText(indent: number | "tab"): string {
  if (indent === "tab") return "\t";
  return " ".repeat(Math.max(0, Math.min(10, Math.trunc(indent))));
}

function prettyNodes(
  nodes: readonly XmlNode[],
  unit: string,
  depth: number,
  out: string[],
): void {
  for (const node of significantChildren(nodes)) {
    const pad = unit.repeat(depth);
    if (node.kind !== "element") {
      out.push(`${pad}${inlineText(node).trim()}`);
      continue;
    }
    if (XML_PRESERVE_ELEMENTS.has(node.name.toLowerCase())) {
      out.push(`${pad}${inlineText(node)}`);
      continue;
    }
    const children = significantChildren(node.children);
    if (children.length === 0) {
      out.push(`${pad}${inlineText(node)}`);
      continue;
    }
    const onlyText = children.every((child) => child.kind === "text");
    const mixed =
      children.some((child) => child.kind === "text") &&
      children.some((child) => child.kind === "element");
    if (onlyText) {
      const inner = children.map((child) => inlineText(child).trim()).join("");
      out.push(`${pad}${openTagText(node, ">")}${inner}</${node.name}>`);
      continue;
    }
    if (mixed) {
      // Re-indenting text that sits beside an element moves the spaces that
      // separate words. That is a change of content, so this one stays put.
      out.push(`${pad}${inlineText(node)}`);
      continue;
    }
    out.push(`${pad}${openTagText(node, ">")}`);
    prettyNodes(children, unit, depth + 1, out);
    out.push(`${pad}</${node.name}>`);
  }
}

/** How `formatXml` lays a document out. */
export interface XmlFormatOptions {
  readonly indent: number | "tab";
}

/** The same markup, indented. See the header for the two shapes it refuses to reflow. */
export function formatXml(
  text: string,
  options: Partial<XmlFormatOptions> = {},
): StructuredResult<string> {
  const document = parseXml(text);
  if (!document.ok) return document;
  const out: string[] = [];
  prettyNodes(document.value.children, indentText(options.indent ?? 2), 0, out);
  return { ok: true, value: out.join("\n") };
}

function minifyNodes(nodes: readonly XmlNode[]): string {
  return significantChildren(nodes)
    .map((node) => {
      if (node.kind !== "element") return inlineText(node);
      if (XML_PRESERVE_ELEMENTS.has(node.name.toLowerCase())) return inlineText(node);
      if (node.selfClosing) return openTagText(node, "/>");
      if (XML_VOID_ELEMENTS.has(node.name.toLowerCase()) && node.children.length === 0) {
        return openTagText(node, ">");
      }
      const children = significantChildren(node.children);
      const inner = children.some((child) => child.kind === "text")
        ? node.children.map(inlineText).join("")
        : minifyNodes(node.children);
      return `${openTagText(node, ">")}${inner}</${node.name}>`;
    })
    .join("");
}

/**
 * The same markup with the whitespace BETWEEN tags removed — and nothing else.
 * Text is never collapsed and comments are never dropped: both are content, and
 * a minifier that deletes content is a different tool with a friendlier name.
 */
export function minifyXml(text: string): StructuredResult<string> {
  const document = parseXml(text);
  if (!document.ok) return document;
  return { ok: true, value: minifyNodes(document.value.children) };
}

// ---------------------------------------------------------------------------
// XPath — the supported subset
// ---------------------------------------------------------------------------

type Predicate =
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "attribute"; readonly name: string }
  | { readonly kind: "attribute-equals"; readonly name: string; readonly value: string };

interface Step {
  readonly descendant: boolean;
  /** `*` matches any element. */
  readonly name: string;
  readonly predicates: readonly Predicate[];
}

const XPATH_NAME = /^(\*|[A-Za-z_:][A-Za-z0-9._:-]*)/;

function scanXPathQuoted(path: string, cursor: { index: number }): string {
  const quote = path[cursor.index];
  if (quote !== "'" && quote !== '"') {
    throw fail(path, cursor.index, "xpath.unexpected-char", "quote", path[cursor.index] ?? "");
  }
  const end = path.indexOf(quote, cursor.index + 1);
  if (end < 0) throw fail(path, cursor.index, "xpath.unterminated-quote", quote);
  const value = path.slice(cursor.index + 1, end);
  cursor.index = end + 1;
  return value;
}

function scanPredicate(path: string, cursor: { index: number }): Predicate {
  const open = cursor.index;
  cursor.index += 1;
  const char = path[cursor.index];
  if (char === undefined) throw fail(path, open, "xpath.unexpected-char", "]", "");

  let predicate: Predicate;
  if (char === "@") {
    cursor.index += 1;
    const match = XPATH_NAME.exec(path.slice(cursor.index));
    const name = match?.[0];
    if (name === undefined || name === "*") {
      throw fail(path, cursor.index, "xpath.expected-name", "attribute name", name ?? "");
    }
    cursor.index += name.length;
    while (path[cursor.index] === " ") cursor.index += 1;
    if (path[cursor.index] === "=") {
      cursor.index += 1;
      while (path[cursor.index] === " ") cursor.index += 1;
      predicate = { kind: "attribute-equals", name, value: scanXPathQuoted(path, cursor) };
    } else {
      predicate = { kind: "attribute", name };
    }
  } else if (char >= "1" && char <= "9") {
    const start = cursor.index;
    while ((path[cursor.index] ?? "") >= "0" && (path[cursor.index] ?? "") <= "9") cursor.index += 1;
    predicate = { kind: "index", index: Number(path.slice(start, cursor.index)) };
  } else if (char === "0") {
    // XPath positions start at 1; `[0]` is empty by definition, and a user who
    // wrote it meant the first one.
    throw fail(path, cursor.index, "xpath.unsupported", "1", "zero-index");
  } else {
    throw fail(path, cursor.index, "xpath.unsupported", "[n], [@a] or [@a='v']", char);
  }

  while (path[cursor.index] === " ") cursor.index += 1;
  if (path[cursor.index] !== "]") {
    throw fail(path, cursor.index, "xpath.unexpected-char", "]", path[cursor.index] ?? "");
  }
  cursor.index += 1;
  return predicate;
}

function parseXPath(path: string): readonly Step[] {
  if (!path.startsWith("/")) {
    throw fail(path, 0, "xpath.expected-absolute", "/", path[0] ?? "");
  }
  const cursor = { index: 0 };
  const steps: Step[] = [];
  while (cursor.index < path.length) {
    if (path[cursor.index] !== "/") {
      throw fail(path, cursor.index, "xpath.unexpected-char", "/", path[cursor.index] ?? "");
    }
    const descendant = path[cursor.index + 1] === "/";
    cursor.index += descendant ? 2 : 1;
    const match = XPATH_NAME.exec(path.slice(cursor.index));
    const name = match?.[0];
    if (name === undefined) {
      const char = path[cursor.index];
      if (char === "@") throw fail(path, cursor.index, "xpath.unsupported", "", "attribute-step");
      if (char === ".") throw fail(path, cursor.index, "xpath.unsupported", "", "self-or-parent");
      throw fail(path, cursor.index, "xpath.expected-name", "element name", char ?? "");
    }
    cursor.index += name.length;
    const predicates: Predicate[] = [];
    while (path[cursor.index] === "[") predicates.push(scanPredicate(path, cursor));
    steps.push({ descendant, name, predicates });
  }
  if (steps.length === 0) throw fail(path, 0, "xpath.expected-name", "element name", "");
  return steps;
}

function elementChildren(node: XmlNode | XmlDocument): readonly XmlElement[] {
  const children = "children" in node ? node.children : [];
  return children.filter((child): child is XmlElement => child.kind === "element");
}

function descendantOrSelf(nodes: readonly (XmlElement | XmlDocument)[]): (XmlElement | XmlDocument)[] {
  const out: (XmlElement | XmlDocument)[] = [];
  const walk = (node: XmlElement | XmlDocument): void => {
    out.push(node);
    for (const child of elementChildren(node)) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

function matchesPredicate(element: XmlElement, predicate: Predicate, position: number): boolean {
  switch (predicate.kind) {
    case "index":
      return position === predicate.index;
    case "attribute":
      return element.attributes.some((attribute) => attribute.name === predicate.name);
    case "attribute-equals":
      return element.attributes.some(
        (attribute) => attribute.name === predicate.name && attribute.value === predicate.value,
      );
  }
}

/** Walks the tree once so a union of node sets can be put back into document order. */
function documentOrder(document: XmlDocument): Map<XmlElement, number> {
  const order = new Map<XmlElement, number>();
  let counter = 0;
  const walk = (nodes: readonly XmlNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "element") continue;
      order.set(node, counter);
      counter += 1;
      walk(node.children);
    }
  };
  walk(document.children);
  return order;
}

/**
 * Every element `path` selects, in document order.
 *
 * The subset is `/root/child`, `//name`, `[n]`, `[@attr]` and `[@attr='v']`, and
 * a predicate is applied PER PARENT rather than to the flattened result — which
 * is XPath's own rule and the one place a shortcut would give different answers:
 * `//item[1]` is „the first item under each parent", not „the first item in the
 * document". Everything outside the subset is refused by name.
 */
export function queryXPath(
  document: XmlDocument,
  path: string,
): StructuredResult<readonly XmlElement[]> {
  return catchingAbort(() => {
    const steps = parseXPath(path);
    let contexts: (XmlElement | XmlDocument)[] = [document];
    for (const step of steps) {
      const sources = step.descendant ? descendantOrSelf(contexts) : contexts;
      const selected: XmlElement[] = [];
      for (const source of sources) {
        let candidates = elementChildren(source).filter(
          (child) => step.name === "*" || child.name === step.name,
        );
        for (const predicate of step.predicates) {
          candidates = candidates.filter((child, position) =>
            matchesPredicate(child, predicate, position + 1),
          );
        }
        selected.push(...candidates);
      }
      contexts = [...new Set(selected)];
    }
    const order = documentOrder(document);
    return contexts
      .filter((node): node is XmlElement => "kind" in node && node.kind === "element")
      .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  });
}

/** Runs an XPath against text in one step, for a surface that holds only the source. */
export function queryXmlText(text: string, path: string): StructuredResult<readonly XmlElement[]> {
  const document = parseXml(text);
  if (!document.ok) return document;
  return queryXPath(document.value, path);
}

/** The text a subtree holds, with entities decoded and markup removed — what a result panel shows. */
export function xmlTextContent(node: XmlNode): string {
  switch (node.kind) {
    case "text":
      return node.value;
    case "cdata":
      return node.text;
    case "element":
      return node.children.map(xmlTextContent).join("");
    default:
      return "";
  }
}
