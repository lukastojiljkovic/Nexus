// A structured document in, the pack's article out.
//
// The reader in `pdf.mjs` decides what each line IS; this module writes it. The
// split is what makes the fidelity test possible: the same block list can be
// rendered as CommonMark AND as the plain text the pages printed, and the test
// compares the first, with its markup stripped, against the second. An emitter
// that dropped a paragraph or wrote a cell in the wrong column changes one side
// and not the other, and the build stops.

import { escapeText, markdownTable } from "./text.mjs";

/**
 * The article's Markdown.
 *
 * `figures` maps a block to the files its page carried, so a photograph ends up
 * beside the words that discuss it. Every union of blocks is separated by one
 * blank line, which is what CommonMark needs and nothing more.
 */
export function blocksToMarkdown(blocks, options = {}) {
  const { levelOffset = 1 } = options;
  const parts = [];
  for (const block of blocks) {
    const figures = (block.figures ?? []).map(
      (figure) => `![${escapeAlt(figure.alt ?? "")}](${figure.file})`,
    );
    switch (block.kind) {
      case "heading": {
        const level = Math.min(6, Math.max(2, block.level + levelOffset));
        parts.push(`${"#".repeat(level)} ${escapeText(block.text)}`);
        break;
      }
      case "paragraph":
        if (block.text !== "") parts.push(escapeText(block.text));
        break;
      case "list":
        parts.push(
          block.items
            .filter((item) => item.text !== "")
            .map(
              (item, index) =>
                `${block.ordered ? `${String(index + 1)}.` : "-"} ${escapeText(item.text)}`,
            )
            .join("\n"),
        );
        break;
      case "table":
        parts.push(
          markdownTable(
            block.header.map((cell) => cell.text),
            block.rows.map((row) => row.map((cell) => cell.text)),
          ),
        );
        break;
      case "code":
        parts.push(["```", ...block.lines, "```"].join("\n"));
        break;
      default:
        throw new Error(`blocks: unknown block kind "${String(block.kind)}"`);
    }
    parts.push(...figures);
  }
  return `${parts.filter((part) => part !== "").join("\n\n")}\n`;
}

/**
 * The same block list as the plain text the pages printed, in reading order.
 *
 * A table's cells come in the order the article writes them — header row first —
 * because that is the order the Markdown puts them in, and the comparison is
 * between the two. The stronger check, that each cell holds the runs the page
 * printed there, is `tableFindings` in `pdf.mjs` and the build runs both.
 */
export function blocksToText(blocks) {
  const parts = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        parts.push(block.text);
        break;
      case "list":
        parts.push(...block.items.map((item) => item.text));
        break;
      case "table":
        parts.push(...block.cells.flatMap((row) => row.map((cell) => cell.text)));
        break;
      case "code":
        parts.push(...block.lines);
        break;
      default:
        throw new Error(`blocks: unknown block kind "${String(block.kind)}"`);
    }
  }
  return parts.join("\n");
}

/** An image's alt text is never source text, so it is always empty. */
function escapeAlt(text) {
  return text.replace(/[[\]]/g, "");
}
