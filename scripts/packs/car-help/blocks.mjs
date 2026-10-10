// The pack's CommonMark writer, and the reader that walks the Markdown back.
//
// A source is converted into `Block`s, never directly into text: every block
// carries the source's own words, and `toMarkdown` may only add markup around
// them. `stripMarkup` is the inverse, written independently of `toMarkdown`, and
// the two meet in the fidelity test —
//
//     stripMarkup(toMarkdown(blocks)) === plainText(blocks)
//
// — which is the property the safety rules ask for on every article: the
// conversion changes markup only.
//
// The block kinds are the ones these sources actually print. Headings, prose
// paragraphs and bullet lists are all four sources. There is deliberately no
// table and no figure: no span this pack ships prints one, and the NHTSA images
// are left out for their rights (see `docs/packs/car-help.md`).

/** `#` for the article's own title, `##` for the source's own heading, `###` below it. */
export const HEADING_PREFIX = ["", "# ", "## ", "### "];

export function heading(level, text) {
  return { kind: "heading", level, text };
}

export function paragraph(text) {
  return { kind: "paragraph", text };
}

export function list(items) {
  return { kind: "list", items };
}

/** The Markdown of one article body. */
export function toMarkdown(blocks) {
  const out = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        out.push(`${HEADING_PREFIX[block.level] ?? "### "}${block.text}`);
        break;
      case "paragraph":
        out.push(block.text);
        break;
      case "list":
        out.push(block.items.map((item) => `- ${item}`).join("\n"));
        break;
      default:
        throw new Error(`blocks: unknown block kind ${JSON.stringify(block.kind)}`);
    }
  }
  return `${out.join("\n\n")}\n`;
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
 * is not hidden by the other sharing a helper.
 */
export function stripMarkup(markdown) {
  const words = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const withoutLeading = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, "");
    words.push(stripInline(withoutLeading));
  }
  return words.filter((word) => word !== "").join(" ");
}

/** Emphasis keeps its text, links and images keep their label. */
function stripInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)([^*_]+)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([\\`*_[\]()#+\-.!|>])/g, "$1");
}

/** Where two texts start to differ, with a little of each side. */
export function firstDifference(one, other) {
  let index = 0;
  while (index < one.length && index < other.length && one[index] === other[index]) index += 1;
  return `differ at ${String(index)}: ${JSON.stringify(one.slice(index, index + 140))}`;
}
