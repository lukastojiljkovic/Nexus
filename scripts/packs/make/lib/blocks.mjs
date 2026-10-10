// The Make pack's CommonMark writer, and the reader that walks the Markdown
// back.
//
// A source is converted into `Block`s, never directly into text: every block
// carries the source's own words, and `toMarkdown` may only add markup around
// them. `stripMarkup` is the inverse written independently of `toMarkdown`, and
// the two meet in the fidelity test —
//
//     stripMarkup(toMarkdown(blocks)) === plainText(blocks)
//
// — which is the property the brief asks for on every article: the conversion
// changes markup only. A block kind exists only if one of the sources needs it:
// headings, paragraphs, bullet and ordered lists, tables, figures (an image plus
// the caption the source prints for it).
//
// WHY THE WRITER ESCAPES, AND WHY THAT IS NOT COSMETIC. The Reader's Markdown
// subset is parsed, not scanned: a lone `*` in an OCR line can italicise the
// words between two asterisks that are a page apart, a paragraph that opens
// `1942.` becomes an ordered list item and loses its first word, and a `<` that
// starts a tag is refused outright. Every one of those changes the text a person
// reads, so the writer escapes the characters the Reader's grammar would
// otherwise claim, and `stripMarkup` unescapes exactly those escapes again.

/** `#` for a level-one heading, `##` for the article's own title, and below. */
export const HEADING_PREFIX = ["", "# ", "## ", "### ", "#### ", "##### "];

export function heading(level, text) {
  return { kind: "heading", level, text };
}

export function paragraph(text) {
  return { kind: "paragraph", text };
}

export function list(items, ordered = false) {
  return { kind: "list", items, ordered };
}

/** `rows[0]` is the header row: the Reader draws it as the table's head. */
export function table(rows) {
  return { kind: "table", rows };
}

/**
 * A figure keeps the caption the source prints for it, verbatim.
 *
 * A source that prints none keeps none: the alternative — writing a caption of
 * our own — would be this pack authoring text, which the safety rules forbid.
 * `file` is the image's name inside the pack's `images/` folder.
 */
export function figure(file, caption) {
  return { kind: "figure", file, caption };
}

/**
 * The marks that mean something anywhere in a line, escaped with a backslash.
 *
 * `>` and `|` are in the set although they only mean something at the start of a
 * line or inside a table: escaping them everywhere keeps one rule for every
 * position, and a backslash before them is not visible in the rendered text. The
 * marks that only mean something at the START of a line (`#`, `-`, `+`, and the
 * `.` or `)` after a number) are escaped there instead, by
 * {@link escapeBlockStart}. Between the two functions, every escape the writer
 * makes is one `stripInline` takes back.
 */
const INLINE_MARKS = new Set(["\\", "`", "*", "_", "[", "]", "<", ">", "|"]);

/** Escapes the marks that would otherwise change what a reader sees. */
export function escapeInline(text) {
  let out = "";
  for (const char of text) out += INLINE_MARKS.has(char) ? `\\${char}` : char;
  // `![alt](src)` is an image only when the `!` opens a link; escaping the `[`
  // above already stops it, so the `!` needs nothing.
  return out;
}

/**
 * A paragraph's first character, when the Reader would read it as the start of a
 * block rather than as part of the sentence.
 *
 * A heading marker, a bullet marker, or a number followed by `.` or `)` is a
 * list item or a heading to the Reader's parser. Escaping the marker's own
 * character (`\.`) leaves the sentence intact and stops the block from opening.
 */
export function escapeBlockStart(text) {
  if (/^[#>]/.test(text)) return `\\${text}`;
  if (/^[-+*]\s/.test(text)) return `\\${text}`;
  if (/^\d{1,9}[.)]\s/.test(text)) return text.replace(/^(\d{1,9})([.)])/, "$1\\$2");
  return text;
}

/** The Markdown of one article body. */
export function toMarkdown(blocks) {
  const out = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        out.push(`${HEADING_PREFIX[block.level] ?? "### "}${escapeInline(block.text)}`);
        break;
      case "paragraph":
        out.push(escapeBlockStart(escapeInline(block.text)));
        break;
      case "list":
        out.push(
          block.items
            .map((item, index) => `${block.ordered === true ? `${String(index + 1)}.` : "-"} ${escapeInline(item)}`)
            .join("\n"),
        );
        break;
      case "table":
        out.push(tableToMarkdown(block.rows));
        break;
      case "figure":
        out.push(`![${escapeInline(block.caption)}](images/${block.file})`);
        break;
      default:
        throw new Error(`blocks: unknown block kind ${JSON.stringify(block.kind)}`);
    }
  }
  return `${out.join("\n\n")}\n`;
}

/**
 * A GFM table: the first row is the header and gets the separator the format
 * requires. A one-row table is a paragraph in a table's clothing and is written
 * as one, because a table with no rows under its header says nothing.
 */
function tableToMarkdown(rows) {
  if (rows.length < 2) return rows.flat().map((cell) => escapeInline(cell)).join("\n\n");
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row) =>
    `| ${Array.from({ length: width }, (_, index) => escapeInline(row[index] ?? "")).join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

/** The source's own words, in order, with no markup at all. */
export function plainText(blocks) {
  const parts = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        parts.push(block.text);
        break;
      case "list":
        parts.push(...block.items);
        break;
      case "table":
        for (const row of block.rows) parts.push(...row);
        break;
      case "figure":
        parts.push(block.caption);
        break;
      default:
        throw new Error(`blocks: unknown block kind ${JSON.stringify(block.kind)}`);
    }
  }
  return parts.filter((part) => part !== "").join(" ");
}

/**
 * The Markdown read back into plain words: markup out, words kept.
 *
 * Deliberately a different implementation from `toMarkdown` and deliberately
 * small — it understands exactly the Markdown that writer emits, so a bug in one
 * is not hidden by the other sharing a helper. A line that is only a table
 * separator carries no words and is skipped whole; a figure contributes its
 * caption and not its file name; an escaped mark becomes the mark it escaped.
 */
export function stripMarkup(markdown) {
  const words = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    if (line.startsWith("|")) {
      for (const cell of line.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/)) {
        if (cell.trim() !== "") words.push(stripInline(cell.trim()));
      }
      continue;
    }
    const withoutLeadingMarkup = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d{1,9}[.)]\s+|>\s+)/, "");
    words.push(stripInline(withoutLeadingMarkup));
  }
  return words.filter((word) => word !== "").join(" ");
}

/** Images keep their alt text, and every escaped mark becomes its own character. */
function stripInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_[\]<>|#\-+.)])/g, "$1");
}

/**
 * The one shape the Reader refuses outright: a `<` that opens a tag, a comment
 * or a doctype.
 *
 * `toMarkdown` escapes every `<` (`\<`, which the Reader's own scanner reads as
 * a literal `<` before its HTML rule ever runs), so the lookbehind is what keeps
 * this from firing on the writer's own escape. What is left to catch is a bug in
 * the writer, and it fails the build loudly rather than shipping an article the
 * Reader refuses to render at all.
 */
const RAW_HTML = /(?<!\\)<(?:[/!?]|[A-Za-z])/;

export function assertReaderSubset(markdown) {
  const at = markdown.search(RAW_HTML);
  if (at >= 0) {
    throw new Error(`blocks: raw HTML at offset ${String(at)}: ${JSON.stringify(markdown.slice(at, at + 40))}`);
  }
  return markdown;
}
