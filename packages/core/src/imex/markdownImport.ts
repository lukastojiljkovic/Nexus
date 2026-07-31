import * as Y from "yjs";
import { normalizeCalloutVariant } from "../notes/noteBlocks.js";
import type { CalloutVariant } from "../notes/noteBlocks.js";

/**
 * Reads a `.md` file back into one note (IMEX-007's markdown slice) — the
 * INVERSE of `noteMarkdown.ts`, which this file is meant to be read beside.
 * That module states plainly that "there is no Markdown parser anywhere in
 * IMEX", because an archive carries a lossless `.ydoc` snapshot next to every
 * `.md` mirror and the snapshot is what a restore reads. This importer exists
 * for the OTHER file: the one a user wrote somewhere else and wants inside
 * Nexus. It is not the archive path and never will be.
 *
 * Two halves, deliberately separate:
 *
 * - `parseMarkdownNote` — text in, a plain block TREE out. No Yjs, no editor,
 *   no IO; a data structure a test can compare with `toEqual`.
 * - `buildNoteUpdate` — that tree into one Yjs update, using the TipTap node
 *   and mark names the editor's own schema declares (`NoteEditor.tsx`'s
 *   StarterKit + `Callout`/`Toggle`/`NoteTableOfContents`). Main appends the
 *   result through `notes:append-update`'s own store call, so an imported note
 *   is an ordinary note from its first byte.
 *
 * The mapping table below is the export's, read right to left. Every ROW is a
 * mapping `noteMarkdown.ts` writes and this file reads back; every DIVERGENCE
 * is a place the two are deliberately not symmetric, and says why.
 *
 *   heading 1-3          `# `/`## `/`### `      deeper levels clamp to 3
 *   paragraph            a line run             soft wraps join with a space
 *   hardBreak            trailing `\` or 2 sp   the export writes `\`
 *   bulletList           `- `                   nesting by indentation
 *   orderedList          `1. `                  `start` from the first number
 *   taskList             `- [ ]` / `- [x]`      a kind change starts a new list
 *   blockquote           `> `                   no lazy continuation (below)
 *   codeBlock            ``` ```lang ```        tildes accepted too
 *   horizontalRule       `---`                  `***` and `___` accepted too
 *   callout              `::: <variant>`        unknown variant -> `info`
 *   toggle               `::: toggle <summary>` always imported EXPANDED
 *   tableOfContents      `<!-- toc -->`         the marker carries no content
 *   bold/italic/code     `**`/`*`/`` ` ``       `_` only at a word boundary
 *   link                 `[t](url)`, `<url>`    bare URLs are linked too
 *
 * DIVERGENCES from the export, each one a thing the export writes that cannot
 * come back the way it left:
 *
 * - `attachmentImage`. The export writes `![name](../blobs/<sha256>)`; there is
 *   no blob import in this slice, so an image of ANY origin degrades to plain
 *   text carrying its alt and its URL, and the count comes back in
 *   `imagesAsText` so the caller can say so out loud rather than pretending.
 * - `noteLink`. The export writes `[[Label]]`, but a wiki-link's truth is the
 *   target note's `id` (`noteLink.tsx`), and a label picked out of somebody
 *   else's file names nothing here. It stays literal text: honest, and exactly
 *   what the reader sees in their own editor.
 * - The title. The export has no title line at all — a note's title IS its
 *   first block (`deriveTitle`, NoteEditor.tsx). So a leading `# ` is read as
 *   the title and LEFT STANDING rather than removed: a note whose first block
 *   was cut would rename itself the moment its owner typed into it. A file
 *   with no leading H1 gets one carrying its file name, for the same reason —
 *   a title written only into the `notes.title` column would not survive the
 *   first edit.
 * - Loose vs tight lists, link titles, reference links, HTML, footnotes and
 *   tables have no node in the schema. Nothing is dropped: HTML arrives as
 *   literal text, and a table arrives as one paragraph per row.
 */

// --- The block tree ------------------------------------------------------

/** The four inline marks the editor's schema carries; `link` holds the href itself. */
export interface MarkdownInlineMarks {
  bold?: true;
  italic?: true;
  code?: true;
  link?: string;
}

export type MarkdownInline =
  | { type: "text"; text: string; marks: MarkdownInlineMarks }
  | { type: "hardBreak" };

/** One `- [ ]` entry: its checkbox and its own blocks. */
export interface MarkdownTaskItem {
  checked: boolean;
  content: MarkdownBlock[];
}

export type MarkdownBlock =
  | { type: "paragraph"; content: MarkdownInline[] }
  | { type: "heading"; level: 1 | 2 | 3; content: MarkdownInline[] }
  | { type: "blockquote"; content: MarkdownBlock[] }
  | { type: "codeBlock"; language: string; text: string }
  | { type: "horizontalRule" }
  | { type: "bulletList"; items: MarkdownBlock[][] }
  | { type: "orderedList"; start: number; items: MarkdownBlock[][] }
  | { type: "taskList"; items: MarkdownTaskItem[] }
  | { type: "callout"; variant: CalloutVariant; content: MarkdownBlock[] }
  | { type: "toggle"; summary: MarkdownInline[]; content: MarkdownBlock[] }
  | { type: "tableOfContents" };

export interface ParsedMarkdownNote {
  /** The note's title: a leading H1's text, else the file name handed in. Empty only for an empty document. */
  title: string;
  /** The whole document, title heading included. Empty when the file held nothing. */
  blocks: MarkdownBlock[];
  /** Images that arrived as plain text because this slice imports no blobs — reported, never hidden. */
  imagesAsText: number;
}

/** `notes.title`'s own cap, mirrored from `deriveTitle` so an imported title matches what the editor would derive. */
const MAX_TITLE_LENGTH = 200;

/** Counts what the parse degraded, so one walk can report it without threading a return value through every branch. */
interface ParseState {
  imagesAsText: number;
}

/**
 * Parses one `.md` file's text. `fallbackTitle` is the file name without its
 * extension, used (and materialised as a leading heading — see the divergence
 * note above) when the text carries no leading H1 of its own.
 */
export function parseMarkdownNote(source: string, fallbackTitle: string): ParsedMarkdownNote {
  const state: ParseState = { imagesAsText: 0 };
  // A leading U+FEFF written by a Windows editor is a byte-order mark, not the
  // first character of the note's first heading.
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  // A file that ends with a newline splits to a final "" that is not a line of
  // the document — left in, it becomes a blank line inside an unterminated
  // code block, the one construct that keeps its blanks.
  if (lines.at(-1) === "") lines.pop();
  const parsed = parseBlocks(new LineCursor(lines), null, state);
  const titled = withTitle(parsed, fallbackTitle);
  return { title: titled.title, blocks: titled.blocks, imagesAsText: state.imagesAsText };
}

/**
 * Settles the note's title against the app's own rule that a note's title is
 * its first block. A leading, non-empty H1 IS the title and stays where it is;
 * otherwise the file name becomes one, prepended, so the title survives the
 * first edit. An empty document gets neither — main skips it before it becomes
 * a note at all.
 */
function withTitle(
  blocks: MarkdownBlock[],
  fallbackTitle: string,
): { title: string; blocks: MarkdownBlock[] } {
  const first = blocks[0];
  if (first === undefined) return { title: "", blocks };
  if (first.type === "heading" && first.level === 1) {
    const fromHeading = capTitle(inlineText(first.content));
    if (fromHeading.length > 0) return { title: fromHeading, blocks };
  }
  const title = capTitle(fallbackTitle);
  // No usable file name either (main always passes one; a bare ".md" would
  // not): the title falls back to what the editor itself would derive.
  if (title.length === 0) return { title: capTitle(blockText(first)), blocks };
  return { title, blocks: [{ type: "heading", level: 1, content: [plainText(title)] }, ...blocks] };
}

function capTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH);
}

// --- Block pass ----------------------------------------------------------

/** A read-once cursor over the document's lines; `peek` returns null only past the end (an empty LINE is still a line). */
class LineCursor {
  private index = 0;

  constructor(private readonly lines: readonly string[]) {}

  peek(): string | null {
    return this.lines[this.index] ?? null;
  }

  take(): string {
    const line = this.lines[this.index] ?? "";
    this.index += 1;
    return line;
  }

  skip(): void {
    this.index += 1;
  }
}

/** True when a line ends the block sequence being parsed — a container's closing fence, and nothing else today. */
type StopPredicate = (line: string) => boolean;

const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CONTAINER_OPEN = /^ {0,3}(:{3,})[ \t]*(.*)$/;
const CONTAINER_CLOSE = /^ {0,3}(:{3,})[ \t]*$/;
const TOC_MARKER = /^ {0,3}<!--[ \t]*toc[ \t]*-->[ \t]*$/i;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>/;
const TABLE_ROW = /^ {0,3}\|/;
/** A table's `| --- | :-: |` rule: the one table line that carries no content, so dropping it drops nothing. */
const TABLE_DELIMITER = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+$/;
const TOGGLE_INFO = /^toggle(?:[ \t]+(.*))?$/i;

/** Blocks until the end of input or `stop`; blank lines separate and are never content of their own. */
function parseBlocks(
  cursor: LineCursor,
  stop: StopPredicate | null,
  state: ParseState,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (;;) {
    const line = cursor.peek();
    if (line === null) break;
    if (stop !== null && stop(line)) break;
    if (line.trim().length === 0) {
      cursor.skip();
      continue;
    }
    // Every branch of `parseBlock` consumes at least the line it was given —
    // the invariant that keeps this loop from spinning on an unrecognised one.
    for (const block of parseBlock(cursor, line, stop, state)) blocks.push(block);
  }
  return blocks;
}

/**
 * One block, occasionally several (a table becomes one paragraph per row).
 * Order matters: a fence wins over everything inside it, a thematic break over
 * the bullet it starts with, and a paragraph is what is left when nothing else
 * claims the line.
 */
function parseBlock(
  cursor: LineCursor,
  line: string,
  stop: StopPredicate | null,
  state: ParseState,
): MarkdownBlock[] {
  const fence = CODE_FENCE.exec(line);
  if (fence !== null) return [parseCodeBlock(cursor, fence)];

  const container = CONTAINER_OPEN.exec(line);
  if (container !== null) return [parseContainer(cursor, container, state)];

  if (TOC_MARKER.test(line)) {
    cursor.skip();
    return [{ type: "tableOfContents" }];
  }
  if (THEMATIC_BREAK.test(line)) {
    cursor.skip();
    return [{ type: "horizontalRule" }];
  }

  const atx = ATX_HEADING.exec(line);
  if (atx !== null) {
    cursor.skip();
    return [
      {
        type: "heading",
        level: clampLevel((atx[1] ?? "#").length),
        content: parseInline(atx[2] ?? "", state),
      },
    ];
  }

  if (BLOCKQUOTE.test(line)) return [parseBlockquote(cursor, state)];

  const item = matchItem(line);
  if (item !== null) return [parseList(cursor, item, stop, state)];

  if (TABLE_ROW.test(line)) return parseTable(cursor, state);

  return [parseParagraph(cursor, stop, state)];
}

function clampLevel(level: number): 1 | 2 | 3 {
  if (level <= 1) return 1;
  return level === 2 ? 2 : 3;
}

/**
 * A fenced code block, verbatim: no inline pass, no escapes, dedented by the
 * opening fence's own indentation. An unterminated fence runs to the end of
 * the document rather than losing everything after it.
 */
function parseCodeBlock(cursor: LineCursor, open: RegExpExecArray): MarkdownBlock {
  const indent = indentWidth(cursor.take());
  const fence = open[1] ?? "";
  const info = (open[2] ?? "").trim();
  const language = info.split(/[\s{]/, 1)[0] ?? "";
  const body: string[] = [];
  for (;;) {
    const line = cursor.peek();
    if (line === null) break;
    if (isFenceClose(line, fence)) {
      cursor.skip();
      break;
    }
    body.push(dedent(cursor.take(), indent));
  }
  return { type: "codeBlock", language, text: body.join("\n") };
}

/** A closing fence: at least as many of the SAME character as the opener, and nothing else on the line. */
function isFenceClose(line: string, fence: string): boolean {
  const trimmed = line.trim();
  const character = fence.charAt(0);
  if (trimmed.length < fence.length) return false;
  for (const ch of trimmed) if (ch !== character) return false;
  return true;
}

/**
 * A `:::` container — NOTE-011's callout and toggle share one fence spelling,
 * so they share one parse. The body is parsed with a stop predicate rather
 * than pre-scanned for its closer, which is what makes nesting work for free:
 * an inner container's own opener is claimed by the recursion below before the
 * outer's predicate ever sees its closer.
 *
 * A bare `:::` reached HERE (rather than through a stop predicate) is a
 * neutral callout, exactly as the editor's own `:::` input rule reads it.
 * An unterminated container closes at the end of the document.
 */
function parseContainer(
  cursor: LineCursor,
  open: RegExpExecArray,
  state: ParseState,
): MarkdownBlock {
  cursor.skip();
  const length = (open[1] ?? "").length;
  const info = (open[2] ?? "").trim();
  const stop: StopPredicate = (line) => {
    const close = CONTAINER_CLOSE.exec(line);
    return close !== null && (close[1] ?? "").length >= length;
  };

  const toggle = TOGGLE_INFO.exec(info);
  const content = parseBlocks(cursor, stop, state);
  const closer = cursor.peek();
  if (closer !== null && stop(closer)) cursor.skip();

  if (toggle !== null) {
    return { type: "toggle", summary: parseInline((toggle[1] ?? "").trim(), state), content };
  }
  return { type: "callout", variant: calloutVariantOf(info), content };
}

function calloutVariantOf(info: string): CalloutVariant {
  return normalizeCalloutVariant(info.split(/\s+/, 1)[0] ?? "");
}

/**
 * A blockquote: consecutive `>` lines, stripped of their marker and re-parsed
 * as their own document, so a quote holds real blocks (a list, a code block, a
 * nested quote) rather than one flattened paragraph.
 *
 * Deliberately NO lazy continuation — a non-`>` line ends the quote instead of
 * being absorbed into its last paragraph. The export always marks every line,
 * and the failure mode of guessing wrong here is text silently moving INTO a
 * quote it was never in.
 */
function parseBlockquote(cursor: LineCursor, state: ParseState): MarkdownBlock {
  const inner: string[] = [];
  for (;;) {
    const line = cursor.peek();
    if (line === null || !BLOCKQUOTE.test(line)) break;
    inner.push(cursor.take().replace(/^ {0,3}> ?/, ""));
  }
  return { type: "blockquote", content: parseBlocks(new LineCursor(inner), null, state) };
}

/** One list item's marker line, decomposed: where its content column is, and what kind of list it belongs to. */
interface ItemMatch {
  indent: number;
  kind: "bullet" | "ordered" | "task";
  checked: boolean;
  start: number;
  /** The marker line's text after the marker. */
  rest: string;
  /** The column an item's continuation lines must reach to belong to it. */
  contentIndent: number;
}

const TASK_ITEM = /^( *)([-*+])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
const BULLET_ITEM = /^( *)([-*+])(?:[ \t]+(.*))?$/;
const ORDERED_ITEM = /^( *)(\d{1,9})([.)])(?:[ \t]+(.*))?$/;

function matchItem(line: string): ItemMatch | null {
  const task = TASK_ITEM.exec(line);
  if (task !== null) {
    const rest = task[4] ?? "";
    return {
      indent: (task[1] ?? "").length,
      kind: "task",
      checked: (task[3] ?? " ").toLowerCase() === "x",
      start: 1,
      rest,
      contentIndent: contentColumn(line, rest),
    };
  }
  const ordered = ORDERED_ITEM.exec(line);
  if (ordered !== null) {
    const rest = ordered[4] ?? "";
    return {
      indent: (ordered[1] ?? "").length,
      kind: "ordered",
      checked: false,
      start: Number.parseInt(ordered[2] ?? "1", 10),
      rest,
      contentIndent: contentColumn(line, rest),
    };
  }
  const bullet = BULLET_ITEM.exec(line);
  if (bullet !== null) {
    const rest = bullet[3] ?? "";
    return {
      indent: (bullet[1] ?? "").length,
      kind: "bullet",
      checked: false,
      start: 1,
      rest,
      contentIndent: contentColumn(line, rest),
    };
  }
  return null;
}

/** Where an item's content starts: right after the marker's own text, whether or not the marker line carries any. */
function contentColumn(line: string, rest: string): number {
  return rest.length > 0 ? line.length - rest.length : line.trimEnd().length + 1;
}

/**
 * A run of items of ONE kind at ONE indentation. Each item's own lines — the
 * marker line's remainder plus everything indented past the marker — are
 * re-parsed as their own document, so a nested list, a second paragraph or a
 * code block inside an item all come back as real blocks with no special case
 * per shape.
 *
 * A marker of a different kind (a checkbox after a plain bullet) or at a
 * different indentation ends the list and starts the next one, which is what
 * the export writes and how the editor stores it.
 */
function parseList(
  cursor: LineCursor,
  first: ItemMatch,
  stop: StopPredicate | null,
  state: ParseState,
): MarkdownBlock {
  const items: { checked: boolean; blocks: MarkdownBlock[] }[] = [];
  let current: ItemMatch | null = first;
  while (current !== null) {
    cursor.skip();
    const lines = [current.rest];
    collectItemLines(cursor, current.contentIndent, stop, lines);
    items.push({
      checked: current.checked,
      blocks: parseBlocks(new LineCursor(lines), null, state),
    });

    const next = cursor.peek();
    if (next === null || (stop !== null && stop(next))) break;
    const match = matchItem(next);
    current = match !== null && match.kind === first.kind && match.indent === first.indent ? match : null;
  }

  if (first.kind === "task") {
    return {
      type: "taskList",
      items: items.map((item) => ({ checked: item.checked, content: item.blocks })),
    };
  }
  const blocks = items.map((item) => item.blocks);
  if (first.kind === "ordered") return { type: "orderedList", start: first.start, items: blocks };
  return { type: "bulletList", items: blocks };
}

/**
 * An item's continuation: every following line indented to its content column,
 * dedented by it. Blank lines are held back and flushed only once a further
 * indented line proves the item continues — otherwise a blank line between two
 * items would leave a stray empty line inside the first one.
 */
function collectItemLines(
  cursor: LineCursor,
  contentIndent: number,
  stop: StopPredicate | null,
  out: string[],
): void {
  let blanks = 0;
  for (;;) {
    const line = cursor.peek();
    if (line === null) return;
    if (stop !== null && stop(line)) return;
    if (line.trim().length === 0) {
      blanks += 1;
      cursor.skip();
      continue;
    }
    if (indentWidth(line) < contentIndent) return;
    for (let i = 0; i < blanks; i += 1) out.push("");
    blanks = 0;
    out.push(dedent(cursor.take(), contentIndent));
  }
}

/**
 * A pipe table: one paragraph per row, verbatim pipes and all. There is no
 * table node in the schema (`noteMarkdown.ts` never writes one either), and a
 * row per paragraph is the degradation that keeps a table READABLE — joining
 * the rows into one paragraph, which is what the plain paragraph rule would do
 * to them, does not.
 */
function parseTable(cursor: LineCursor, state: ParseState): MarkdownBlock[] {
  const rows: MarkdownBlock[] = [];
  for (;;) {
    const line = cursor.peek();
    if (line === null || !TABLE_ROW.test(line)) break;
    const row = cursor.take().trim();
    if (TABLE_DELIMITER.test(row)) continue;
    rows.push({ type: "paragraph", content: parseInline(row, state) });
  }
  return rows;
}

/**
 * A paragraph: consecutive lines until a blank one or the start of another
 * block. A setext underline directly beneath turns the run into a heading
 * instead — CommonMark's rule, and the reason a `---` under a line of text is
 * never mistaken for a horizontal rule (the export always leaves a blank line
 * before one of those).
 */
function parseParagraph(
  cursor: LineCursor,
  stop: StopPredicate | null,
  state: ParseState,
): MarkdownBlock {
  const lines: string[] = [cursor.take()];
  for (;;) {
    const line = cursor.peek();
    if (line === null || line.trim().length === 0) break;
    if (stop !== null && stop(line)) break;

    const setext = SETEXT_UNDERLINE.exec(line);
    if (setext !== null) {
      cursor.skip();
      return {
        type: "heading",
        level: (setext[1] ?? "=").startsWith("=") ? 1 : 2,
        content: inlineFromLines(lines, state),
      };
    }
    if (startsBlock(line)) break;
    lines.push(cursor.take());
  }
  return { type: "paragraph", content: inlineFromLines(lines, state) };
}

/** Whether a line would open a block of its own — what a paragraph stops before. */
function startsBlock(line: string): boolean {
  return (
    CODE_FENCE.test(line) ||
    CONTAINER_OPEN.test(line) ||
    TOC_MARKER.test(line) ||
    THEMATIC_BREAK.test(line) ||
    ATX_HEADING.test(line) ||
    BLOCKQUOTE.test(line) ||
    TABLE_ROW.test(line) ||
    matchItem(line) !== null
  );
}

function indentWidth(line: string): number {
  return line.length - line.trimStart().length;
}

function dedent(line: string, columns: number): string {
  return line.slice(Math.min(columns, indentWidth(line)));
}

// --- Inline pass ---------------------------------------------------------

/**
 * The inline content of a paragraph's (or a heading's) line run. A line ending
 * in a backslash or two spaces breaks hard — the two spellings
 * `noteMarkdown.ts` explains, one of which it writes; any other line ending is
 * a soft wrap and joins with a space, as CommonMark says and as the export
 * assumes (it puts every paragraph on one line).
 */
function inlineFromLines(lines: readonly string[], state: ParseState): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  lines.forEach((raw, index) => {
    const last = index === lines.length - 1;
    let content = raw;
    let hard = false;
    if (!last) {
      if (/ {2,}$/.test(content)) {
        hard = true;
      } else if (trailingBackslashes(content) % 2 === 1) {
        hard = true;
        content = content.slice(0, -1);
      }
    }
    parseInlineInto(out, content.trim(), {}, state);
    if (last) return;
    if (hard) out.push({ type: "hardBreak" });
    else pushText(out, " ", {});
  });
  return out;
}

function trailingBackslashes(line: string): number {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line.charAt(i) === "\\"; i -= 1) count += 1;
  return count;
}

function parseInline(source: string, state: ParseState): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  parseInlineInto(out, source, {}, state);
  return out;
}

/** ASCII punctuation — the only characters CommonMark lets a backslash escape, and exactly what `escapeText` escapes on the way out. */
const ASCII_PUNCTUATION = /[\\!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/;
const AUTOLINK = /^<(https?:\/\/[^>\s]+)>/;

/**
 * Walks one inline string, appending runs to `out` under the marks it is
 * already inside. Recursion carries the marks down (`**a *b* c**` nests), and
 * every construct that fails to close falls through to literal text — a
 * half-typed `**` must read as two asterisks, never swallow the rest of the
 * line.
 */
function parseInlineInto(
  out: MarkdownInline[],
  source: string,
  marks: MarkdownInlineMarks,
  state: ParseState,
): void {
  let buffer = "";
  let index = 0;
  const flush = (): void => {
    pushText(out, buffer, marks);
    buffer = "";
  };

  while (index < source.length) {
    const ch = source.charAt(index);

    if (ch === "\\" && index + 1 < source.length && ASCII_PUNCTUATION.test(source.charAt(index + 1))) {
      buffer += source.charAt(index + 1);
      index += 2;
      continue;
    }

    if (ch === "`") {
      const span = readCodeSpan(source, index);
      if (span !== null) {
        flush();
        pushText(out, span.text, { ...marks, code: true });
        index = span.end;
        continue;
      }
    }

    // An image, wherever it sits: alt text and URL as plain text, counted.
    if (ch === "!" && source.charAt(index + 1) === "[") {
      const image = readLink(source, index + 1);
      if (image !== null) {
        state.imagesAsText += 1;
        const alt = image.label.trim();
        buffer += alt.length > 0 ? `${alt} (${image.destination})` : image.destination;
        index = image.end;
        continue;
      }
    }

    // Never inside another link: a nested link mark is not a thing the schema
    // can hold, and the inner brackets read better as the text they are.
    if (ch === "[" && marks.link === undefined) {
      const link = readLink(source, index);
      if (link !== null) {
        flush();
        parseInlineInto(out, link.label, { ...marks, link: link.destination }, state);
        index = link.end;
        continue;
      }
    }

    if (ch === "<" && marks.link === undefined) {
      const autolink = AUTOLINK.exec(source.slice(index));
      if (autolink !== null) {
        const url = autolink[1] ?? "";
        flush();
        pushText(out, url, { ...marks, link: url });
        index += autolink[0].length;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const emphasis = readEmphasis(source, index, marks);
      if (emphasis !== null) {
        flush();
        parseInlineInto(out, emphasis.inner, emphasis.marks, state);
        index = emphasis.end;
        continue;
      }
    }

    buffer += ch;
    index += 1;
  }
  flush();
}

/** A backtick code span: a run of n backticks closed by a run of EXACTLY n, with CommonMark's one-space padding stripped. */
function readCodeSpan(source: string, start: number): { text: string; end: number } | null {
  let open = start;
  while (open < source.length && source.charAt(open) === "`") open += 1;
  const length = open - start;

  let index = open;
  while (index < source.length) {
    if (source.charAt(index) !== "`") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < source.length && source.charAt(end) === "`") end += 1;
    if (end - index === length) {
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

/** `[label](destination)`, with nested brackets/parens balanced, `<…>` destinations unwrapped and a link title dropped. */
function readLink(
  source: string,
  start: number,
): { label: string; destination: string; end: number } | null {
  let depth = 0;
  let index = start;
  for (; index < source.length; index += 1) {
    const ch = source.charAt(index);
    if (ch === "\\") {
      index += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
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
    return { label, destination: source.slice(open + 1, close), end: close + 2 };
  }

  let parens = 1;
  let cursor = open;
  for (; cursor < source.length; cursor += 1) {
    const ch = source.charAt(cursor);
    if (ch === "\\") {
      cursor += 1;
      continue;
    }
    if (ch === "(") parens += 1;
    else if (ch === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  if (parens !== 0) return null;
  const inside = source.slice(open, cursor).trim();
  return { label, destination: inside.split(/\s+/, 1)[0] ?? "", end: cursor + 1 };
}

/**
 * `**`/`__` for bold, `*`/`_` for italic. `_` is honoured only at a word
 * boundary, which is the exact inverse of `escapeText`'s rule — `snake_case`
 * survives a round trip in both directions.
 */
function readEmphasis(
  source: string,
  start: number,
  marks: MarkdownInlineMarks,
): { inner: string; marks: MarkdownInlineMarks; end: number } | null {
  const ch = source.charAt(start);
  if (ch === "_" && !isWordBoundary(source.charAt(start - 1))) return null;
  const double = source.charAt(start + 1) === ch;
  const width = double ? 2 : 1;
  const close = findEmphasisClose(source, start + width, ch, double);
  if (close === -1) return null;
  const inner = source.slice(start + width, close);
  if (inner.length === 0) return null;
  return {
    inner,
    marks: double ? { ...marks, bold: true } : { ...marks, italic: true },
    end: close + width,
  };
}

/** The matching closer: a run of the same character, of 2+ for bold, of exactly 1 for italic (so `**` inside `*…*` is skipped, not matched). */
function findEmphasisClose(source: string, from: number, ch: string, double: boolean): number {
  for (let index = from; index < source.length; index += 1) {
    if (source.charAt(index) === "\\") {
      index += 1;
      continue;
    }
    if (source.charAt(index) !== ch) continue;
    let end = index;
    while (end < source.length && source.charAt(end) === ch) end += 1;
    const run = end - index;
    if (double ? run >= 2 : run === 1) {
      if (ch === "_" && !isWordBoundary(source.charAt(end))) {
        index = end - 1;
        continue;
      }
      return index;
    }
    index = end - 1;
  }
  return -1;
}

function isWordBoundary(ch: string): boolean {
  return !/[A-Za-z0-9]/.test(ch);
}

/** A bare URL in running text, linked as itself. `<>` and whitespace end it; sentence punctuation is trimmed back off. */
const BARE_URL = /https?:\/\/[^\s<>]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»…]+$/;

/**
 * Appends one text run, autolinking bare URLs on the way. Skipped inside code
 * (code is code) and inside a link (a link mark cannot nest), which is also
 * why this lives here rather than in the scanner: every plain run passes
 * through exactly once, wherever it came from.
 */
function pushText(out: MarkdownInline[], value: string, marks: MarkdownInlineMarks): void {
  if (value.length === 0) return;
  if (marks.code === true || marks.link !== undefined) {
    appendRun(out, value, marks);
    return;
  }
  let index = 0;
  for (const match of value.matchAll(BARE_URL)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (url.length === 0 || match.index < index) continue;
    appendRun(out, value.slice(index, match.index), marks);
    appendRun(out, url, { ...marks, link: url });
    index = match.index + url.length;
  }
  appendRun(out, value.slice(index), marks);
}

/** Merges into the previous run when the marks match, so a paragraph is as few runs as it has distinct formatting. */
function appendRun(out: MarkdownInline[], value: string, marks: MarkdownInlineMarks): void {
  if (value.length === 0) return;
  const last = out[out.length - 1];
  if (last !== undefined && last.type === "text" && sameMarks(last.marks, marks)) {
    last.text += value;
    return;
  }
  out.push({ type: "text", text: value, marks });
}

function sameMarks(a: MarkdownInlineMarks, b: MarkdownInlineMarks): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.link === b.link;
}

function plainText(value: string): MarkdownInline {
  return { type: "text", text: value, marks: {} };
}

/** An inline run's plain text — what a title is read from; a hard break reads as a space, exactly as `flattenToLine` writes one. */
function inlineText(content: readonly MarkdownInline[]): string {
  let out = "";
  for (const node of content) out += node.type === "hardBreak" ? " " : node.text;
  return out;
}

/** One block's plain text, for the title fallback of last resort. Mirrors `deriveTitle`'s "first non-empty block" reading. */
function blockText(block: MarkdownBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return inlineText(block.content);
    case "codeBlock":
      return block.text;
    case "blockquote":
    case "callout":
      return block.content.map(blockText).join(" ");
    case "toggle":
      return inlineText(block.summary);
    case "bulletList":
    case "orderedList":
      return block.items.flat().map(blockText).join(" ");
    case "taskList":
      return block.items.flatMap((item) => item.content).map(blockText).join(" ");
    case "horizontalRule":
    case "tableOfContents":
      return "";
  }
}

// --- Yjs document build --------------------------------------------------

/**
 * Encodes a parsed document as ONE Yjs update — the note's whole initial
 * state, which main appends through the same `NoteStore.appendUpdate` the
 * editor's own flush uses.
 *
 * Everything below is built before the fragment is inserted, so every node is
 * still preliminary: a `Y.XmlText`'s own `length` reads 0 until integration,
 * which is why the text offset is tracked by hand in `buildInline` rather than
 * read back off the type.
 */
export function buildNoteUpdate(blocks: readonly MarkdownBlock[]): Uint8Array {
  const doc = new Y.Doc();
  try {
    if (blocks.length > 0) doc.getXmlFragment("default").insert(0, blocks.map(buildBlock));
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * `Y.XmlElement`'s TS generic declares every attribute as `string`, while the
 * editor really stores `level`/`start` as numbers and `checked`/`collapsed` as
 * booleans — the very coercion `noteMarkdown.ts` reads back. The cast is
 * compile-time only; the runtime value is untouched.
 */
function setAttribute(element: Y.XmlElement, name: string, value: number | boolean | string): void {
  element.setAttribute(name, value as unknown as string);
}

function buildElement(
  name: string,
  children: readonly (Y.XmlElement | Y.XmlText)[],
): Y.XmlElement {
  const element = new Y.XmlElement(name);
  if (children.length > 0) element.insert(0, [...children]);
  return element;
}

function buildBlock(block: MarkdownBlock): Y.XmlElement {
  switch (block.type) {
    case "paragraph":
      return buildElement("paragraph", buildInline(block.content));
    case "heading": {
      const element = buildElement("heading", buildInline(block.content));
      setAttribute(element, "level", block.level);
      return element;
    }
    case "blockquote":
      return buildElement("blockquote", buildContainerBlocks(block.content));
    case "codeBlock": {
      const element = new Y.XmlElement("codeBlock");
      if (block.language.length > 0) element.setAttribute("language", block.language);
      if (block.text.length > 0) element.insert(0, [new Y.XmlText(block.text)]);
      return element;
    }
    case "horizontalRule":
      return new Y.XmlElement("horizontalRule");
    case "bulletList":
      return buildElement(
        "bulletList",
        block.items.map((item) => buildElement("listItem", buildItemBlocks(item))),
      );
    case "orderedList": {
      const element = buildElement(
        "orderedList",
        block.items.map((item) => buildElement("listItem", buildItemBlocks(item))),
      );
      if (block.start !== 1) setAttribute(element, "start", block.start);
      return element;
    }
    case "taskList":
      return buildElement(
        "taskList",
        block.items.map((item) => {
          const element = buildElement("taskItem", buildItemBlocks(item.content));
          setAttribute(element, "checked", item.checked);
          return element;
        }),
      );
    case "callout": {
      const element = buildElement("callout", buildContainerBlocks(block.content));
      element.setAttribute("variant", block.variant);
      return element;
    }
    case "toggle": {
      const element = buildElement("toggle", [
        buildElement("toggleSummary", buildInline(block.summary)),
        buildElement("toggleContent", buildContainerBlocks(block.content)),
      ]);
      // An imported toggle always arrives OPEN: a fold state is a reading
      // preference of whoever wrote the file, and the one thing a reader must
      // never have to discover is content that is already hidden.
      setAttribute(element, "collapsed", false);
      return element;
    }
    case "tableOfContents":
      return new Y.XmlElement("tableOfContents");
  }
}

/** `block+` in the schema (blockquote, callout, toggleContent): an empty container still needs one paragraph to be valid. */
function buildContainerBlocks(blocks: readonly MarkdownBlock[]): Y.XmlElement[] {
  if (blocks.length === 0) return [new Y.XmlElement("paragraph")];
  return blocks.map(buildBlock);
}

/** `paragraph block*` in the schema: an item that opens with a nested list gets the empty paragraph the schema requires (the export drops it again). */
function buildItemBlocks(blocks: readonly MarkdownBlock[]): Y.XmlElement[] {
  const built = buildContainerBlocks(blocks);
  if (blocks[0]?.type !== "paragraph") built.unshift(new Y.XmlElement("paragraph"));
  return built;
}

/**
 * A block's inline children as y-prosemirror stores them: consecutive text
 * runs share ONE `Y.XmlText` carrying their marks as formatting, and a
 * `hardBreak` is an element sibling that starts the next run afresh.
 */
function buildInline(content: readonly MarkdownInline[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let text: Y.XmlText | null = null;
  let offset = 0;
  for (const node of content) {
    if (node.type === "hardBreak") {
      out.push(new Y.XmlElement("hardBreak"));
      text = null;
      offset = 0;
      continue;
    }
    if (node.text.length === 0) continue;
    if (text === null) {
      text = new Y.XmlText();
      out.push(text);
      offset = 0;
    }
    text.insert(offset, node.text, markAttributes(node.marks));
    offset += node.text.length;
  }
  return out;
}

/**
 * The delta attributes one run carries — the mark names TipTap's StarterKit
 * registers, with the link's href where `noteMarkdown.ts` reads it.
 *
 * EVERY mark is named on every run, `null` for the ones that are off, and that
 * is load-bearing rather than tidy: `Y.XmlText.insert` inherits the formatting
 * already active at the insertion point for any attribute the call does not
 * mention (and inherits ALL of them when it is given none), so a run inserted
 * after a bold one silently becomes bold too. Naming a mark as null is what
 * closes it.
 */
function markAttributes(marks: MarkdownInlineMarks): Record<string, unknown> {
  return {
    bold: marks.bold === true ? true : null,
    italic: marks.italic === true ? true : null,
    code: marks.code === true ? true : null,
    link: marks.link === undefined ? null : { href: marks.link },
  };
}
