// A Project Gutenberg HTML edition: the book's own text, its headings, its
// tables and its figures with the captions the edition prints for them.
//
// WHY THE HTML EDITION AND NOT THE PLAIN-TEXT ONE. The plain-text edition of a
// 1914 book carries `[Illustration: …]` markers where the drawings are, and the
// pack would then be a book about sharpening a saw with no saw in it. The HTML
// edition names each drawing (`images/fig20.jpg`) and prints its caption in a
// `span.caption`, which is the source's own caption and not one this pack wrote.
//
// THE PARSER IS SMALL ON PURPOSE. It is not an HTML parser and does not try to
// be: it walks the tag stream and recognises the seven things these editions are
// made of — headings, paragraphs, lists, tables, figures, page numbers and
// everything else (transparent, its text kept). A construct it does not know
// cannot lose text, because unknown tags are dropped while their CONTENT is
// kept; only two things are ever discarded, and both are the digitisation's own
// furniture rather than the book's: the page-number span, and images that are
// not inside a figure (a plate the edition lists but never captions).
//
// `htmlWords` is the other half: an independent, deliberately crude strip of the
// same fragment, used as the oracle the converted article is compared with. It
// shares no code with the parser above it, so a bug in one is not hidden by the
// other doing the same wrong thing.

import { figure, heading, list, paragraph, table } from "./blocks.mjs";
import { collapse, decodeEntities, headingKey } from "./text.mjs";

/** The two markers a Project Gutenberg HTML edition wraps the book itself in. */
const BODY_START = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
const BODY_END = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;

/** The heading elements a Project Gutenberg edition sets its chapters in. */
const HEADING_TAGS = new Map([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

/**
 * The level a heading the edition marked with a CLASS is set at, rather than
 * with an `<h…>` element.
 *
 * Both the classes this parser reads (`p.sub`, `div.sidenote`) are the edition's
 * SMALLER headings, and both sit under the `<h3>` a section is set in — so they
 * must be deeper than one, or a chapter's span would end at its own first
 * sub-heading and every article after it would be cut off at the first paragraph.
 * Level four also places them in the outline where the book prints them.
 */
const SUBHEADING_LEVEL = 4;

/**
 * The book itself, without Project Gutenberg's own header and licence footer.
 *
 * The edition's header and footer are the distributor's envelope around the
 * work, and the pack ships the work: keeping them would put a licence page for
 * one ebook inside an article about darning. What is shipped, and what the
 * source line names, is the book between the two markers.
 */
export function ebookBody(html) {
  const start = BODY_START.exec(html);
  if (start === null) throw new Error("html: no Project Gutenberg start marker.");
  const rest = html.slice(start.index + start[0].length);
  const end = BODY_END.exec(rest);
  if (end === null) throw new Error("html: no Project Gutenberg end marker.");
  return rest.slice(0, end.index);
}

/** A tag's name, its attributes and whether it closes. */
function parseTag(source) {
  const closing = source.startsWith("</");
  const body = source.replace(/^<\/?/, "").replace(/\/?>$/, "");
  const name = (/^[a-zA-Z][a-zA-Z0-9]*/.exec(body)?.[0] ?? "").toLowerCase();
  const attributes = {};
  for (const match of body.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attributes[match[1].toLowerCase()] = match[2];
  for (const match of body.matchAll(/([a-zA-Z-]+)\s*=\s*'([^']*)'/g)) attributes[match[1].toLowerCase()] = match[2];
  return { closing, name, attributes };
}

/** Whether a `div` is the container an edition puts one drawing and its caption in. */
function isFigureDiv(tag) {
  if (tag.name !== "div") return false;
  if (tag.attributes["role"] === "figure") return true;
  return /(^|\s)(figcenter|figleft|figright|figure)(\s|$)/.test(tag.attributes["class"] ?? "");
}

/**
 * Whether a `p` is a sub-heading rather than a paragraph.
 *
 * The Project Gutenberg editions set their smaller headings in a `<p class="sub">`
 * when the book's own typography used a run-in heading — `Materials required.`,
 * `The Button.` — and reading one as a paragraph welds it to the sentence that
 * follows it, which is how an article's structure disappears. The words are the
 * same either way; only the shape a person reads changes.
 */
function isHeadingParagraph(tag) {
  return tag.name === "p" && /(^|\s)sub(\s|$)/.test(tag.attributes["class"] ?? "");
}

/**
 * Whether a `div` is a margin note the edition sets as its own block.
 *
 * `Textiles and Clothing` prints every section's title beside the text it
 * belongs to, and the digitisation lifts each one into a `<div class="sidenote">`
 * of its own; standing alone, it is a heading. A sidenote INSIDE a paragraph is
 * read as the running text it sits in, because that is where the compositor put
 * it and moving it would be this builder rearranging the source.
 */
function isSidenoteDiv(tag) {
  return tag.name === "div" && /(^|\s)sidenote(\s|$)/.test(tag.attributes["class"] ?? "");
}

/**
 * The fragment as the ordered items the converter turns into blocks: headings,
 * paragraphs, lists, tables and figures, plus a census of what was dropped.
 *
 * The stack is the element path, not a tree: text belongs to the innermost open
 * heading, paragraph, list item, table cell or figure caption, and every other
 * element is transparent so that a `<span class="smcap">` inside a heading or an
 * `<em>` inside a list item keeps its words in the place they were printed.
 */
export function parseItems(fragment) {
  const items = [];
  const dropped = { pageNumbers: 0, uncaptionedImages: 0, comments: 0 };
  const stack = [];
  let text = "";
  let pending = null;
  let listFrame = null;
  let row = null;
  // Where in the fragment the open block began, so an article can be the exact
  // bytes of its span rather than a second search for its own heading.
  let blockStart = 0;

  const innermost = () => stack[stack.length - 1] ?? null;
  const flushText = () => {
    const frame = pending;
    const value = collapse(decodeEntities(text));
    text = "";
    if (frame === null || value === "") return;
    if (frame.kind === "heading") items.push({ ...heading(frame.level, value), offset: frame.offset });
    else if (frame.kind === "item") frame.items.push(value);
    else if (frame.kind === "cell") frame.cells.push(value);
    else if (frame.kind === "caption") frame.caption.push(value);
    else items.push({ ...paragraph(value), offset: frame.offset });
  };

  /**
   * Ends whatever block is open, putting its text where that block belongs: a
   * paragraph or a heading into the item list, a list item into its list, a
   * table cell into its row, a figure caption into its figure.
   */
  const closeBlock = () => {
    if (pending === null) return;
    flushText();
    pending = null;
  };

  for (const token of fragment.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)) {
    const raw = token[0];
    blockStart = token.index ?? blockStart;
    // A page number is inside the element that carries it, and the digitisation
    // wraps it in a link (`<span class="pagenum"><a id="Page_85">[Pg 85]</a></span>`),
    // so the check for it has to come before the text is kept rather than after.
    {
      const inside = stack[stack.length - 1];
      if (inside?.kind === "pagenum") {
        if (raw.startsWith("</") && parseTag(raw).name === "span") stack.pop();
        continue;
      }
    }
    if (raw.startsWith("<!--")) {
      dropped.comments += 1;
      continue;
    }
    if (!raw.startsWith("<")) {
      text += raw;
      continue;
    }

    const tag = parseTag(raw);
    const open = !tag.closing && !raw.endsWith("/>");
    const frame = innermost();
    const inFigure = stack.some((entry) => entry.kind === "figure");

    if (tag.name === "br") {
      text += " ";
      continue;
    }
    if (tag.name === "img") {
      if (inFigure) {
        const src = tag.attributes["src"] ?? "";
        const file = src.split("/").pop() ?? "";
        const holder = stack.find((entry) => entry.kind === "figure");
        if (holder !== undefined && file !== "") holder.file = file;
      } else {
        // A plate the edition links to but never sets a caption for: the pack
        // keeps the words and leaves the picture, which `docs/packs/make.md`
        // records per source.
        dropped.uncaptionedImages += 1;
      }
      continue;
    }
    if (open && tag.attributes["class"] === "pagenum") {
      stack.push({ kind: "pagenum" });
      dropped.pageNumbers += 1;
      continue;
    }

    if (open && HEADING_TAGS.has(tag.name)) {
      closeBlock();
      pending = { kind: "heading", level: HEADING_TAGS.get(tag.name), offset: blockStart };
      stack.push({ kind: "heading", level: HEADING_TAGS.get(tag.name) });
      continue;
    }
    if (tag.closing && HEADING_TAGS.has(tag.name)) {
      closeBlock();
      stack.pop();
      continue;
    }

    if (open && (tag.name === "p" || isHeadingParagraph(tag))) {
      closeBlock();
      pending = isHeadingParagraph(tag) ? { kind: "heading", level: SUBHEADING_LEVEL } : { kind: "paragraph" };
      pending.offset = blockStart;
      stack.push({ kind: pending.kind === "heading" ? "heading" : "paragraph", level: pending.level });
      continue;
    }
    if (tag.closing && tag.name === "p") {
      closeBlock();
      stack.pop();
      continue;
    }

    if (open && isFigureDiv(tag)) {
      closeBlock();
      stack.push({ kind: "figure", file: "", caption: [], offset: blockStart });
      continue;
    }
    if (tag.closing && tag.name === "div" && frame?.kind === "figure") {
      stack.pop();
      const file = frame.file;
      const caption = collapse(frame.caption.join(" "));
      // A figure div with no image is a caption a person can still read; a div
      // with an image and no caption is a drawing with nothing to say about it,
      // and both are kept rather than guessed at.
      if (file !== "" || caption !== "") items.push({ ...figure(file, caption), offset: frame.offset });
      continue;
    }
    if (open && isSidenoteDiv(tag) && pending === null) {
      stack.push({ kind: "heading", level: SUBHEADING_LEVEL });
      pending = { kind: "heading", level: SUBHEADING_LEVEL, offset: blockStart };
      continue;
    }
    if (open && tag.name === "div") {
      stack.push({ kind: "div" });
      continue;
    }
    if (tag.closing && tag.name === "div") {
      closeBlock();
      stack.pop();
      continue;
    }

    if (open && tag.name === "span") {
      const className = tag.attributes["class"] ?? "";
      if (/\bcaption\b/.test(className) && inFigure) {
        const holder = stack.findLast((entry) => entry.kind === "figure");
        pending = { kind: "caption", caption: holder.caption };
        stack.push({ kind: "caption" });
        continue;
      }
      stack.push({ kind: "span" });
      continue;
    }
    if (tag.closing && tag.name === "span") {
      if (frame?.kind === "caption") flushText();
      if (frame?.kind === "caption") pending = null;
      stack.pop();
      continue;
    }

    if (open && (tag.name === "ul" || tag.name === "ol")) {
      closeBlock();
      const item = { kind: "list", ordered: tag.name === "ol", items: [], offset: blockStart };
      items.push(item);
      stack.push({ kind: "list", item });
      listFrame = item;
      continue;
    }
    if (tag.closing && (tag.name === "ul" || tag.name === "ol")) {
      closeBlock();
      stack.pop();
      listFrame = null;
      continue;
    }
    if (open && tag.name === "li") {
      closeBlock();
      pending = { kind: "item", items: listFrame?.items ?? [] };
      stack.push({ kind: "item", items: listFrame?.items ?? [] });
      continue;
    }
    if (tag.closing && tag.name === "li") {
      closeBlock();
      stack.pop();
      continue;
    }

    if (open && tag.name === "table") {
      closeBlock();
      const block = { kind: "table", rows: [], offset: blockStart };
      items.push(block);
      stack.push({ kind: "table", block });
      continue;
    }
    if (tag.closing && tag.name === "table") {
      closeBlock();
      stack.pop();
      continue;
    }
    if (open && tag.name === "tr") {
      closeBlock();
      const block = stack.findLast((entry) => entry.kind === "table")?.block;
      row = { cells: [] };
      block?.rows.push(row);
      continue;
    }
    if (tag.closing && tag.name === "tr") {
      closeBlock();
      row = null;
      continue;
    }
    if (open && (tag.name === "td" || tag.name === "th")) {
      closeBlock();
      const target = row ?? { cells: [] };
      row = target;
      pending = { kind: "cell", cells: target.cells };
      stack.push({ kind: "cell", cells: target.cells });
      continue;
    }
    if (tag.closing && (tag.name === "td" || tag.name === "th")) {
      closeBlock();
      stack.pop();
      continue;
    }
    // Any other element — `em`, `i`, `b`, `a`, `hr`, `pre`, `small`, an
    // unknown tag — is transparent: its own text stays in the frame that is
    // open, and its children are read exactly as if it were not there.
  }
  closeBlock();
  // A table whose every row came out empty carries no words and is not a table.
  return {
    items: items.filter((item) => item.kind !== "table" || item.rows.some((line) => line.cells.length > 0)),
    dropped,
  };
}

/** The parser's items as the pack's blocks. */
export function itemsToBlocks(items) {
  return items.map((item) => {
    switch (item.kind) {
      case "heading":
        // The source's own depth, floored at three: the deepest heading an
        // edition sets for a chapter's subject, so a book stays flatter than the
        // article's own title (`##`) but a section and a sub-section are still
        // two different things in the outline a reader sees.
        return heading(Math.max(3, item.level), item.text);
      case "paragraph":
        return paragraph(item.text);
      case "list":
        return list(item.items, item.ordered);
      case "table":
        return table(item.rows.map((line) => line.cells));
      // A caption the edition prints without an image is still the source's own
      // words, so it is kept as a paragraph rather than as a figure pointing at
      // a file that does not exist.
      case "figure":
        return item.file === "" ? paragraph(item.caption) : figure(item.file, item.caption);
      default:
        throw new Error(`html: unknown item kind ${JSON.stringify(item.kind)}`);
    }
  });
}

/** The HTML of one fragment as blocks, with the figure files named as they are. */
export function htmlToBlocks(fragment) {
  return itemsToBlocks(parseItems(fragment).items);
}

/**
 * The fragment's own words, in order, without any of this pack's decisions.
 *
 * Deliberately crude and deliberately separate from `parseItems`: tags become
 * spaces, entities become characters, the page-number span the digitisation
 * added is removed, and what is left is collapsed. A caption comes out with the
 * words around it, which is what `plainText` of a figure block does too.
 *
 * A BLOCK tag becomes a space and an INLINE one becomes nothing, which is the
 * difference the edition's own typography makes: `</i>—Knit` prints as
 * `—Knit`, and an oracle that inserted a space there would report a difference
 * this builder did not make. The list is the elements these editions use to
 * separate one piece of text from the next; everything else is transparent.
 */
const BLOCK_TAGS = new Set([
  "p", "div", "blockquote", "pre", "figure", "figcaption", "section", "header", "footer", "article", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "td", "th",
  "br", "hr",
]);

export function htmlWords(fragment) {
  const withoutComments = fragment.replace(/<!--[\s\S]*?-->/g, " ");
  const withoutPageNumbers = withoutComments.replace(/<span[^>]*class="pagenum"[^>]*>[\s\S]*?<\/span>/g, " ");
  const spaced = withoutPageNumbers.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g,
    (_whole, name) => (BLOCK_TAGS.has(name.toLowerCase()) ? " " : ""),
  );
  return collapse(decodeEntities(spaced));
}

/**
 * One article's items: from the heading whose text says `title` to the next
 * heading at its own level or above.
 *
 * `occurrence` picks which one, because a book really does print two headings
 * with the same words (a contents list and the chapter it names; a chapter and
 * the plate that repeats its title). A title that cannot be found is an error
 * rather than a silent shift, because every article after a missing heading
 * would otherwise move to the wrong text.
 */
export function sectionItems(items, title, options = {}) {
  const occurrence = options.occurrence ?? 1;
  const target = headingKey(title);
  const at = [];
  for (const [index, item] of items.entries()) {
    if (item.kind === "heading" && headingKey(item.text) === target) at.push(index);
  }
  if (at.length === 0) throw new Error(`html: no heading ${JSON.stringify(title)}.`);
  const from = at[Math.min(occurrence, at.length) - 1];
  const level = items[from].level;
  let to = items.length;
  // An `until` names the heading the article stops BEFORE, which is what lets a
  // plan ship a chapter's first three sections as one article without those
  // sections losing their own headings along the way.
  if (options.until !== undefined) {
    const stop = headingKey(options.until);
    const found = items.findIndex((item, index) => index > from && item.kind === "heading" && headingKey(item.text) === stop);
    if (found < 0) throw new Error(`html: no heading ${JSON.stringify(options.until)} after ${JSON.stringify(title)}.`);
    to = found;
  } else {
    for (let index = from + 1; index < items.length; index += 1) {
      const item = items[index];
      if (item.kind === "heading" && item.level <= level) {
        to = index;
        break;
      }
    }
  }
  return { from, to, items: items.slice(from, to) };
}
