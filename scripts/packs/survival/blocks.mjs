// The pack's CommonMark writer, and the reader that walks the Markdown back.
//
// A source is converted into `Block`s, never directly into text: every block
// carries the source's own words, and `toMarkdown` may only add markup around
// them. `stripMarkup` is the inverse written independently of `toMarkdown`, and
// the two meet in the fidelity test â€”
//
//     stripMarkup(toMarkdown(blocks)) === plainText(blocks)
//
// â€” which is the property the brief asks for on every article: the conversion
// changes markup only. A block kind exists only if one of the sources needs it:
// paragraphs, headings, bullet lists (the Army manuals' `z` bullets), tables
// (the safe-temperature chart), and figures (an image plus the caption the
// source prints, if it prints one).

/** `#` for the article's own heading, `##` for the source's, `###` below it. */
export const HEADING_PREFIX = ["", "# ", "## ", "### "];

export function heading(level, text) {
  return { kind: "heading", level, text };
}

export function paragraph(text) {
  return { kind: "paragraph", text };
}

export function list(items, ordered = false) {
  return { kind: "list", items, ordered };
}

export function table(rows) {
  return { kind: "table", rows };
}

/**
 * A figure keeps the caption and figure number the source prints for it. A
 * source that prints none (FM 21-76's 1992 reprint numbers no figures) keeps
 * none: the alternative â€” writing a caption of our own â€” would be this pack
 * authoring text, which the safety rules forbid.
 */
export function figure(file, caption) {
  return { kind: "figure", file, caption };
}

/** The Markdown of one article body. */
export function toMarkdown(blocks) {
  const out = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        out.push(`${HEADING_PREFIX[block.level] ?? "### "}${escapeText(block.text)}`);
        break;
      case "paragraph":
        out.push(escapeOpening(escapeText(block.text)));
        break;
      case "list":
        out.push(
          block.items
            .map((item, index) => `${block.ordered === true ? `${String(index + 1)}.` : "-"} ${escapeText(item)}`)
            .join("\n"),
        );
        break;
      case "table":
        out.push(tableToMarkdown(block.rows));
        break;
      case "figure":
        out.push(`![${escapeText(block.caption).replace(/([[\]])/g, "\\$1")}](images/${block.file})`);
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
  if (rows.length < 2) return rows.map((row) => row.join(" ")).join("\n\n");
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row) =>
    `| ${Array.from({ length: width }, (_, index) => escapeText(row[index] ?? "")).join(" | ")} |`;
  const head = rows[0];
  return [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join(
    "\n",
  );
}

/** The source's own words, in order, with no markup at all. */
/**
 * A paragraph CommonMark would read as a list or a quote gets the escape the
 * format allows, on the punctuation character the reader would otherwise take
 * as markup.
 *
 * Measured: ATP 3-50.21's navigation chapter prints a direction-finding list
 * whose items begin with a hyphen, and a paragraph that opens `- day depends on
 * the latitude` is a bullet to a Markdown reader — the fidelity test caught it
 * as a word the article had lost, because reading that Markdown back gives the
 * list marker and not the source's hyphen. The escape goes on the `-` and on
 * the `.` of a leading `1.` because a backslash before a DIGIT is not an escape
 * at all (CommonMark escapes ASCII punctuation), which is how `\1. Tundra`
 * shipped a literal backslash into the text of FM 21-76's appendix H.
 */
export function escapeOpening(text) {
  const ordered = /^(\s*\d+)\.(\s)/.exec(text);
  if (ordered !== null) return `${ordered[1]}\\.${ordered[2]}${text.slice(ordered[0].length)}`;
  const marker = /^(\s*)([-+*#>])(\s)/.exec(text);
  if (marker !== null) return `${marker[1]}\\${marker[2]}${marker[3]}${text.slice(marker[0].length)}`;
  return text;
}

/**
 * The characters CommonMark would read as markup where the source means them
 * literally.
 *
 * Measured, twice: FEMA's guide has an OCR'd web address whose underscores
 * (`..._570_,00.html`) a Markdown reader takes for emphasis, which DELETES them
 * from the rendered page â€” the fidelity test saw that as words the article had
 * lost â€” and the same guide prints angle brackets around addresses, which a
 * renderer takes for a tag and hides. Escaping them is the format's own answer,
 * and the backslashes never reach the reader.
 */
export function escapeText(text) {
  return text.replace(/([\\`*_<>|])/g, "\\$1");
}

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
 * small â€” it understands exactly the Markdown that writer emits, so a bug in
 * one is not hidden by the other sharing a helper. A line that is only a table
 * separator carries no words and is skipped whole; a figure contributes its
 * caption and not its file name.
 */
export function stripMarkup(markdown) {
  const words = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    if (line.startsWith("|")) {
      for (const cell of line.replace(/^\|/, "").replace(/\|$/, "").split("|")) {
        if (cell.trim() !== "") words.push(cell.trim());
      }
      continue;
    }
    const withoutLeadingMarkup = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/, "");
    words.push(stripInline(withoutLeadingMarkup));
  }
  return words.filter((word) => word !== "").join(" ");
}

/**
 * Images keep their alt text, links keep their text, and every escape the
 * writer added comes back off.
 *
 * There is deliberately no emphasis pass. The writer never emits emphasis, and
 * the source's own underscores and asterisks are escaped â€” a pass that removed
 * `_text_` ran BEFORE the unescape in the first version of this function and
 * ate the escaped underscores of FEMA's guide (`\_570\_` came back as `\ 570\`),
 * which the fidelity test reported as words the article had lost.
 */
function stripInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_[\]()#+\-.!|<>])/g, "$1");
}
