/**
 * The Reader's Markdown parser: exactly the subset a content pack's articles are
 * written in, and a refusal for everything outside it.
 *
 * **Why this is not `imex/markdownImport.ts`.** That parser exists to turn a
 * `.md` file into a NOTE's TipTap document. It degrades deliberately where NOTE
 * has no node: a pipe table becomes one paragraph per row and an image becomes
 * its alt text, because an imported note has nowhere to put either. A content
 * pack read on a page has both, and it is read by a person rather than edited,
 * so this parser keeps headings, lists, quotes, fenced code, tables, emphasis,
 * links and images as the blocks and inlines the page renders. Sharing the note
 * importer would have meant rendering a table as four paragraphs.
 *
 * **Pack text is untrusted, and this is where that is decided.** Two constructs
 * are REFUSED by throwing `ReaderMarkdownError` rather than quietly skipped:
 *
 *  - raw HTML (a comment, a doctype, or a tag), because the page renders React
 *    elements and never `dangerouslySetInnerHTML` - a construct the renderer
 *    cannot honour is one the reader must not be shown as if it had;
 *  - a link or an image whose destination is not `http(s):`, a fragment, or a
 *    path inside the pack. `javascript:`, `data:`, `file:` and a
 *    protocol-relative `//host` are all refused, which is the external-link rule
 *    applied where it can still be enforced: before anything is rendered.
 *
 * A refusal names the line it happened on. The caller decides what to do with
 * it - the Reader's service turns it into a sentence on the article, and the
 * pack's own search index skips that article rather than inventing text for it.
 *
 * The subset, stated once so a pack author can read it here: ATX headings,
 * paragraphs, blockquotes, bullet and ordered lists (nested by indentation),
 * fenced code (``` or ~~~), pipe tables with a delimiter row, thematic breaks,
 * and inline `**bold**`, `*italic*`, `__bold__`, `_italic_`, `` `code` ``,
 * `[text](url)`, `![alt](src)` and `<https://autolink>`. Backslash escapes work
 * on ASCII punctuation. Setext headings are deliberately NOT in the subset: an
 * underline of `---` is a thematic break here, and one line meaning two things
 * is the kind of ambiguity a format read by strangers should not carry.
 */

/** One run of text, or a construct built from runs. */
export type ReaderInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong"; readonly children: readonly ReaderInline[] }
  | { readonly type: "emphasis"; readonly children: readonly ReaderInline[] }
  | { readonly type: "code"; readonly value: string }
  | {
      readonly type: "link";
      readonly href: string;
      /** True for `http(s):`, false for a fragment or a path inside the pack. */
      readonly external: boolean;
      readonly children: readonly ReaderInline[];
    }
  | { readonly type: "image"; readonly src: string; readonly alt: string };

/** One cell of a table: the inline content of the cell, with the delimiting pipes removed. */
export type ReaderTableCell = readonly ReaderInline[];

export type ReaderBlock =
  | { readonly type: "heading"; readonly level: number; readonly children: readonly ReaderInline[] }
  | { readonly type: "paragraph"; readonly children: readonly ReaderInline[] }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      /** The first number of an ordered list; 1 for a bullet list. */
      readonly start: number;
      readonly items: readonly (readonly ReaderBlock[])[];
    }
  | { readonly type: "quote"; readonly children: readonly ReaderBlock[] }
  | { readonly type: "code"; readonly language: string; readonly text: string }
  | {
      readonly type: "table";
      readonly head: readonly ReaderTableCell[];
      readonly rows: readonly (readonly ReaderTableCell[])[];
    }
  | { readonly type: "rule" };

/** Why a pack's text was refused. One code per rule, so each rule has its own test. */
export type ReaderMarkdownRefusal = "raw-html" | "unsafe-target";

export class ReaderMarkdownError extends Error {
  readonly line: number;
  readonly refusal: ReaderMarkdownRefusal;

  constructor(refusal: ReaderMarkdownRefusal, line: number, message: string) {
    super(message);
    this.name = "ReaderMarkdownError";
    this.refusal = refusal;
    this.line = line;
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/;
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const BLOCKQUOTE = /^ {0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const AUTOLINK = /^<(https?:\/\/[^>\s]+)>/;
/** A tag, a comment or a doctype: the three shapes an HTML start looks like. */
const RAW_HTML = /^<(?:[/!?]|[A-Za-z])/;

interface PendingRefusal {
  refusal: ReaderMarkdownRefusal;
  line: number;
  message: string;
}

/**
 * Parses one article. Throws {@link ReaderMarkdownError} on the first refused
 * construct, naming the line, because half an article rendered is a page that
 * lies about what the pack says.
 */
export function parseReaderMarkdown(source: string): ReaderBlock[] {
  const state: PendingRefusal[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = parseBlocks(lines, 0, lines.length, 1, state);
  const refusal = state[0];
  if (refusal !== undefined) {
    throw new ReaderMarkdownError(refusal.refusal, refusal.line, refusal.message);
  }
  return blocks;
}

// --- Blocks ----------------------------------------------------------------

/**
 * The blocks between two line indices. `lineNumber` is the source line the first
 * entry is, carried down so a nested refusal reports the line a person will find
 * in the file rather than a line inside a slice.
 */
function parseBlocks(
  lines: readonly string[],
  start: number,
  end: number,
  lineNumber: number,
  state: PendingRefusal[],
): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  let index = start;
  while (index < end) {
    const line = lines[index] ?? "";
    const at = lineNumber + index - start;
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const parsed = parseFence(lines, index, end, at, fence);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      const text = (heading[2] ?? "").replace(/\s+#+\s*$/, "").trim();
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length,
        children: inlineOf(text, at, state),
      });
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote !== null) {
      const inner: string[] = [];
      while (index < end) {
        const match = BLOCKQUOTE.exec(lines[index] ?? "");
        if (match === null) break;
        inner.push(match[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner, 0, inner.length, at, state) });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      const parsed = parseList(lines, index, end, at, item, state);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    if (isTableStart(lines, index, end)) {
      const parsed = parseTable(lines, index, end, at, state);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < end) {
      const candidate = lines[index] ?? "";
      if (candidate.trim().length === 0 || (paragraph.length > 0 && startsBlock(candidate))) break;
      paragraph.push(candidate.trim());
      index += 1;
    }
    const joined = paragraph.join(" ").trim();
    if (joined.length > 0) {
      blocks.push({ type: "paragraph", children: inlineOf(joined, at, state) });
    }
  }
  return blocks;
}

/** Whether a line opens a block of its own - what a paragraph stops before. */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    ATX_HEADING.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line)
  );
}

/**
 * A fenced block. An unclosed fence runs to the end of the article, which is
 * CommonMark's own answer and the only one that never loses text: refusing it
 * would put an "unreadable article" where a code listing simply had no end.
 */
function parseFence(
  lines: readonly string[],
  start: number,
  end: number,
  lineNumber: number,
  open: RegExpExecArray,
): { block: ReaderBlock; next: number } {
  const marker = (open[1] ?? "```").charAt(0);
  const language = (open[2] ?? "").trim().split(/\s+/)[0] ?? "";
  const body: string[] = [];
  let index = start + 1;
  while (index < end) {
    const line = lines[index] ?? "";
    const close = FENCE.exec(line);
    if (close !== null && (close[1] ?? "").charAt(0) === marker && (close[1] ?? "").length >= (open[1] ?? "").length) {
      index += 1;
      break;
    }
    body.push(line);
    index += 1;
  }
  // An unclosed fence at the very end of a file whose last line is terminated
  // leaves one empty line behind, which is the file's newline rather than a line
  // of the listing.
  if (body.length > 1 && body[body.length - 1] === "" && index >= end) body.pop();
  return {
    block: { type: "code", language, text: body.join("\n") },
    next: index,
  };
}

interface ListEntry {
  readonly marker: string;
  readonly indent: number;
  readonly lines: string[];
}

/**
 * A list: consecutive items at the same indent, each item's content collected at
 * its own indent width so a nested list inside an item stays inside it. Items
 * of one kind run together; a bullet list interrupted by an ordered item is two
 * lists, which is what CommonMark does with a changed marker type.
 */
function parseList(
  lines: readonly string[],
  start: number,
  end: number,
  lineNumber: number,
  first: RegExpExecArray,
  state: PendingRefusal[],
): { block: ReaderBlock; next: number } {
  const ordered = /\d/.test((first[2] ?? "-").charAt(0));
  const baseIndent = (first[1] ?? "").length;
  const items: ListEntry[] = [];
  let index = start;

  while (index < end) {
    const match = LIST_ITEM.exec(lines[index] ?? "");
    if (match === null) break;
    const indent = (match[1] ?? "").length;
    const marker = match[2] ?? "-";
    if (indent !== baseIndent || /\d/.test(marker.charAt(0)) !== ordered) break;

    const contentIndent = indent + marker.length + 1;
    const content: string[] = [match[3] ?? ""];
    index += 1;
    while (index < end) {
      const line = lines[index] ?? "";
      if (line.trim().length === 0) {
        // A blank line ends the item unless the next line is indented into it.
        const next = lines[index + 1] ?? "";
        if (indentWidth(next) < contentIndent) {
          if (next.trim().length === 0) index += 1;
          break;
        }
        content.push("");
        index += 1;
        continue;
      }
      if (indentWidth(line) < contentIndent) break;
      content.push(dedent(line, contentIndent));
      index += 1;
    }
    items.push({ marker, indent, lines: content });
  }

  const startNumber = ordered ? Number.parseInt((first[2] ?? "1").replace(/[.)]$/, ""), 10) : 1;
  return {
    block: {
      type: "list",
      ordered,
      start: Number.isFinite(startNumber) ? startNumber : 1,
      items: items.map((entry) => parseBlocks(entry.lines, 0, entry.lines.length, lineNumber, state)),
    },
    next: index,
  };
}

/** Whether this line and the one below it open a pipe table (a header row and a delimiter row). */
function isTableStart(lines: readonly string[], index: number, end: number): boolean {
  if (index + 1 >= end) return false;
  const head = lines[index] ?? "";
  if (!head.includes("|")) return false;
  return TABLE_DELIMITER.test(lines[index + 1] ?? "");
}

/**
 * A pipe table. The delimiter row is kept only for its cell COUNT: a row with
 * more cells than the header keeps the extra cells (a content pack that has
 * drifted is still readable) rather than dropping text.
 */
function parseTable(
  lines: readonly string[],
  start: number,
  end: number,
  lineNumber: number,
  state: PendingRefusal[],
): { block: ReaderBlock; next: number } {
  const head = splitRow(lines[start] ?? "");
  let index = start + 2;
  const rows: string[][] = [];
  while (index < end) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0 || !line.includes("|")) break;
    rows.push(splitRow(line));
    index += 1;
  }
  return {
    block: {
      type: "table",
      head: head.map((cell) => inlineOf(cell, lineNumber, state)),
      rows: rows.map((row) => row.map((cell) => inlineOf(cell, lineNumber, state))),
    },
    next: index,
  };
}

/** One row's cells, split on unescaped pipes, with the row's own edge pipes dropped. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let buffer = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed.charAt(index);
    if (char === "\\" && index + 1 < trimmed.length) {
      buffer += char + trimmed.charAt(index + 1);
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  cells.push(buffer);
  return cells.map((cell) => cell.trim());
}

function indentWidth(line: string): number {
  return line.length - line.trimStart().length;
}

function dedent(line: string, columns: number): string {
  return line.slice(Math.min(columns, indentWidth(line)));
}

// --- Inline ----------------------------------------------------------------

function inlineOf(source: string, line: number, state: PendingRefusal[]): ReaderInline[] {
  const out: ReaderInline[] = [];
  scanInline(out, source, line, state);
  return out;
}

/**
 * Walks one string, appending runs under the marks already open. Recursion
 * carries the marks down (`**a *b* c**` nests), and a construct that never
 * closes falls through to literal text: a half-typed `**` reads as two
 * asterisks rather than swallowing the rest of the article.
 */
function scanInline(
  out: ReaderInline[],
  source: string,
  line: number,
  state: PendingRefusal[],
): void {
  let buffer = "";
  let index = 0;
  const flush = (): void => {
    if (buffer.length > 0) pushText(out, buffer);
    buffer = "";
  };

  while (index < source.length) {
    const char = source.charAt(index);

    if (char === "\\" && isEscapable(source.charAt(index + 1))) {
      buffer += source.charAt(index + 1);
      index += 2;
      continue;
    }

    if (char === "`") {
      const span = readCodeSpan(source, index);
      if (span !== null) {
        flush();
        out.push({ type: "code", value: span.text });
        index = span.end;
        continue;
      }
    }

    if (char === "!" && source.charAt(index + 1) === "[") {
      const image = readLink(source, index + 1);
      if (image !== null) {
        if (!isAllowedTarget(image.destination)) {
          refuse(
            state,
            "unsafe-target",
            line,
            `Nexus: an image may point at http(s) or a path inside the pack, not at "${image.destination}".`,
          );
          return;
        }
        flush();
        // The alt is scanned as inline content and then flattened, so markup in
        // an alt is read as its text and a refusal inside one is refused too.
        const alt = inlineOf(image.label, line, state).map(textOfInline).join("");
        out.push({ type: "image", src: image.destination, alt });
        index = image.end;
        continue;
      }
    }

    if (char === "[") {
      const link = readLink(source, index);
      if (link !== null) {
        if (!isAllowedTarget(link.destination)) {
          refuse(
            state,
            "unsafe-target",
            line,
            `Nexus: a link may point at http(s), a fragment or a path inside the pack, not at "${link.destination}".`,
          );
          return;
        }
        flush();
        const external = isExternalTarget(link.destination);
        out.push({
          type: "link",
          href: link.destination,
          external,
          children: inlineOf(link.label, line, state),
        });
        index = link.end;
        continue;
      }
    }

    if (char === "<") {
      const autolink = AUTOLINK.exec(source.slice(index));
      if (autolink !== null) {
        const url = autolink[1] ?? "";
        flush();
        out.push({ type: "link", href: url, external: true, children: [{ type: "text", value: url }] });
        index += autolink[0].length;
        continue;
      }
      if (RAW_HTML.test(source.slice(index))) {
        refuse(state, "raw-html", line, "Nexus: raw HTML is not part of the Reader's Markdown subset.");
        return;
      }
    }

    if (char === "*" || char === "_") {
      const emphasis = readEmphasis(source, index);
      if (emphasis !== null) {
        flush();
        const inner: ReaderInline[] = [];
        scanInline(inner, emphasis.inner, line, state);
        out.push(
          emphasis.strong ? { type: "strong", children: inner } : { type: "emphasis", children: inner },
        );
        index = emphasis.end;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }
  flush();
}

function refuse(
  state: PendingRefusal[],
  refusal: ReaderMarkdownRefusal,
  line: number,
  message: string,
): void {
  // The FIRST refusal is the one reported: a page that reported the last of
  // forty would send its reader to the wrong line.
  if (state.length === 0) state.push({ refusal, line, message });
}

/**
 * Appends one run of text, merging it with the run before it.
 *
 * Marks are NOT applied here, deliberately: `scanInline` creates the
 * `strong`/`emphasis` node and recurses into it, so a run's marks are the node it
 * was pushed into. Wrapping a run in a second node for its own marks is how a
 * bold word came back as `****word****`.
 */
function pushText(out: ReaderInline[], value: string): void {
  if (value.length === 0) return;
  const last = out[out.length - 1];
  if (last !== undefined && last.type === "text") {
    out[out.length - 1] = { type: "text", value: last.value + value };
    return;
  }
  out.push({ type: "text", value });
}

/** A backtick code span: a run of n backticks closed by a run of exactly n. */
function readCodeSpan(source: string, start: number): { text: string; end: number } | null {
  let open = start;
  while (open < source.length && source.charAt(open) === "`") open += 1;
  const width = open - start;
  let index = open;
  while (index < source.length) {
    if (source.charAt(index) !== "`") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < source.length && source.charAt(end) === "`") end += 1;
    if (end - index === width) {
      let text = source.slice(open, index);
      if (text.length >= 2 && text.startsWith(" ") && text.endsWith(" ") && text.trim().length > 0) {
        text = text.slice(1, -1);
      }
      return { text, end };
    }
    index = end;
  }
  return null;
}

/**
 * `[label](destination)`. The destination is REFUSED here when it is neither
 * `http(s):`, a `#fragment`, nor a path inside the pack, so no unsafe target ever
 * reaches a block the page renders.
 */
function readLink(
  source: string,
  start: number,
): { label: string; destination: string; end: number } | null {
  let depth = 0;
  let index = start;
  for (; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || index >= source.length || source.charAt(index + 1) !== "(") return null;
  const label = source.slice(start + 1, index);

  const open = index + 2;
  if (source.charAt(open) === "<") {
    const close = source.indexOf(">", open + 1);
    if (close === -1 || source.charAt(close + 1) !== ")") return null;
    return { label, destination: source.slice(open + 1, close).trim(), end: close + 2 };
  }

  let parens = 1;
  let cursor = open;
  for (; cursor < source.length; cursor += 1) {
    const char = source.charAt(cursor);
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  if (parens !== 0) return null;
  // A link title after the destination (`[a](b "c")`) is dropped rather than
  // rendered: nothing in an article's copy has a use for it.
  const inside = source.slice(open, cursor).trim();
  const destination = inside.startsWith("<") ? inside.slice(1, inside.indexOf(">")).trim() : (inside.split(/\s+/, 1)[0] ?? "");
  return { label, destination, end: cursor + 1 };
}

/**
 * The external-link rule as a predicate. Anything that names a scheme other than
 * http/https - including `javascript:`, `data:` and `file:` - answers false, and
 * so does a protocol-relative `//host`, which would leave this document's scheme
 * to decide where it goes.
 */
export function isExternalTarget(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/** Whether a target is one an article may reach at all. Refused targets never reach a block. */
export function isAllowedTarget(target: string): boolean {
  const value = target.trim();
  if (value.length === 0) return false;
  // eslint-disable-next-line no-control-regex -- a control character in a URL is exactly what this refuses.
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("//")) return false;
  if (isExternalTarget(value)) return true;
  if (value.startsWith("#")) return true;
  // A scheme is `word:` before any `/`: that is what `javascript:` and `data:`
  // look like, and a real pack path never does.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  return true;
}

/** `**x**`, `*x*`, `__x__`, `_x_`. `_` is honoured only at a word boundary, so `snake_case` survives. */
function readEmphasis(
  source: string,
  start: number,
): { inner: string; strong: boolean; end: number } | null {
  const char = source.charAt(start);
  if (char === "_" && !isWordBoundary(source.charAt(start - 1))) return null;
  const double = source.charAt(start + 1) === char;
  const width = double ? 2 : 1;
  const close = findEmphasisClose(source, start + width, char, double);
  if (close === -1) return null;
  const inner = source.slice(start + width, close);
  if (inner.length === 0) return null;
  return {
    inner,
    strong: double,
    end: close + width,
  };
}

function findEmphasisClose(source: string, from: number, char: string, double: boolean): number {
  for (let index = from; index < source.length; index += 1) {
    if (source.charAt(index) === "\\") {
      index += 1;
      continue;
    }
    if (source.charAt(index) !== char) continue;
    let end = index;
    while (end < source.length && source.charAt(end) === char) end += 1;
    const run = end - index;
    if (double ? run >= 2 : run === 1) {
      if (char === "_" && !isWordBoundary(source.charAt(end))) {
        index = end - 1;
        continue;
      }
      return index;
    }
    index = end - 1;
  }
  return -1;
}

function isWordBoundary(char: string): boolean {
  return !/[A-Za-z0-9]/.test(char);
}

const ASCII_PUNCTUATION = /[\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/;

function isEscapable(char: string): boolean {
  return char.length > 0 && ASCII_PUNCTUATION.test(char);
}

/** One inline node as plain text: what a search index and a title read. */
export function textOfInline(node: ReaderInline): string {
  switch (node.type) {
    case "text":
    case "code":
      return node.value;
    case "image":
      return node.alt;
    case "link":
    case "strong":
    case "emphasis":
      return node.children.map(textOfInline).join("");
  }
}

/** One block's plain text: every run a reader would read out, headings included. */
export function textOfBlock(block: ReaderBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.children.map(textOfInline).join("");
    case "code":
      return block.text;
    case "quote":
      return block.children.map(textOfBlock).join("\n");
    case "list":
      return block.items.map((item) => item.map(textOfBlock).join("\n")).join("\n");
    case "table":
      return [
        block.head.map((cell) => cell.map(textOfInline).join("")),
        ...block.rows.map((row) => row.map((cell) => cell.map(textOfInline).join(""))),
      ]
        .map((row) => row.join(" "))
        .join("\n");
    case "rule":
      return "";
  }
}

/** The whole article as the text a search index and a printed excerpt read. */
export function readerPlainText(blocks: readonly ReaderBlock[]): string {
  return blocks
    .map(textOfBlock)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** The article's own title: its first heading, or `null` when it opens with prose. */
export function readerTitleOf(blocks: readonly ReaderBlock[]): string | null {
  for (const block of blocks) {
    if (block.type === "heading") {
      const text = block.children.map(textOfInline).join("").trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}
