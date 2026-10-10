// One article's worth of a PDF: normalised lines and bound figures become
// `Block`s, and nothing in the text moves.
//
// This is the converter the fidelity test is written against, so its one rule
// is that it may add MARKUP and may join words the compositor wrapped, and it
// may not add, drop or reorder a word. Everything below is a decision about
// where a paragraph, a heading, a bullet or a figure starts â€” never about what
// the text says.

import { figure, heading, list, paragraph } from "./blocks.mjs";
import { collapse, joinHyphenated } from "./normalise.mjs";
import { anchorIndex, captionFor } from "./pdf-source.mjs";

/**
 * The article's body size: the size most of its lines are set at.
 *
 * Headings are then "bigger than the body", which is how a reader sees them,
 * rather than a size written down here that a future edition of the source
 * would falsify. Measured: FM 21-76's plant entries are 7.9 set over 9.8
 * headings, its chapters 13 over 15.8, the ATP's body 10 over 12.
 */
export function bodySize(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line.size, (counts.get(line.size) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && size < best)) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

/** A heading is set at least a seventh larger than the body text. */
export const HEADING_SCALE = 1.15;

export function isHeadingLine(line, body) {
  return line.size >= body * HEADING_SCALE && line.text.length <= 120;
}

/**
 * Per page: the left margin, and the leading. Both are read off the page rather
 * than written down, because the sources print more than one page template â€”
 * FM 21-76's plant appendix sets its entries at a 32-point margin and its
 * chapters at 40, 54 or 82 depending on the entry, and an article can span
 * pages of two of them.
 */
export function pageMetrics(lines) {
  const byPage = new Map();
  for (const line of lines) {
    const entry = byPage.get(line.page) ?? { x: new Map(), gap: new Map(), previous: null, right: 0 };
    entry.x.set(line.x, (entry.x.get(line.x) ?? 0) + 1);
    entry.right = Math.max(entry.right, line.right ?? 0);
    if (entry.previous !== null) {
      const gap = Number((entry.previous.y - line.y).toFixed(1));
      if (gap > 0 && gap <= 60) entry.gap.set(gap, (entry.gap.get(gap) ?? 0) + 1);
    }
    entry.previous = line;
    byPage.set(line.page, entry);
  }
  const margins = new Map();
  const gaps = new Map();
  const widths = new Map();
  for (const [page, entry] of byPage) {
    margins.set(page, mode(entry.x, (value) => value));
    gaps.set(page, mode(entry.gap, (value) => value));
    widths.set(page, entry.right - (margins.get(page) ?? 0));
  }
  return {
    margin: (page) => margins.get(page) ?? mode(byPage.get(page)?.x ?? new Map(), (value) => value),
    gap: (page) => gaps.get(page) ?? 0,
    width: (page) => widths.get(page) ?? 0,
  };
}

/** The most frequent key, smallest first when two are equally frequent. */
function mode(counts, key) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = key(value);
      bestCount = count;
    }
  }
  return best;
}

/** Does this line end a sentence, i.e. would a paragraph end here? */
function endsSentence(text) {
  return /[.:;?!]$/.test(text.replace(/["')\]]+$/, ""));
}

/**
 * Lines and figures in reading order: a figure is spliced in before the first
 * line after its box.
 *
 * A figure whose caption the source prints as a line of its own CONSUMES that
 * line: the caption is the same words, and an article that carried both would
 * show the caption twice â€” once under the image and once as a paragraph. The
 * line is dropped from the sequence here, where both the Markdown and the text
 * the fidelity test compares against are built from the same walk.
 */
export function mergeFigures(lines, figures) {
  const items = lines.map((line, index) => ({ kind: "line", index, line }));
  const anchored = figures
    .map((item) => ({ ...item, at: anchorIndex(item, lines) }))
    .sort((a, b) => a.at - b.at || a.page - b.page || b.box.y - a.box.y);
  let offset = 0;
  const consumed = new Set();
  for (const item of anchored) {
    const anchor = lines[item.at];
    if (item.caption !== undefined && item.caption !== "" && anchor !== undefined && collapse(anchor.text) === collapse(item.caption)) {
      consumed.add(item.at);
    }
    items.splice(item.at + offset, 0, { kind: "figure", figure: item });
    offset += 1;
  }
  // Filtered by the line's OWN index: splicing a figure in shifts the array
  // positions, and a filter that read the array position instead would keep
  // exactly the caption line it meant to drop whenever a figure comes first.
  return items.filter((item) => item.kind === "figure" || !consumed.has(item.index));
}

/** The source's own words, in the order the reader meets them, figures included. */
export function itemsText(items) {
  return items
    .map((item) => (item.kind === "figure" ? (item.figure.caption ?? "") : item.line.text))
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * The article's blocks.
 *
 * `title` is the span's own first heading; a heading that matches it is the
 * article's title line, everything below it is a section heading. A bullet
 * glyph the extraction hands over as a lone `z` (see `foldBulletGlyph`) opens a
 * list item, and consecutive items stay in one list.
 */
export function toBlocks(options) {
  const { lines, figures, title } = options;
  const body = bodySize(lines);
  const metrics = pageMetrics(lines);
  const items = mergeFigures(lines, figures.length === 0 ? [] : figures);
  const blocks = [];
  let current = null;
  let currentKind = null;
  let previous = null;

  const flush = () => {
    if (current === null) return;
    if (currentKind === "list") blocks.push(list(current.items));
    else if (currentKind === "paragraph") blocks.push(paragraph(collapse(current.text)));
    current = null;
    currentKind = null;
  };

  for (const item of items) {
    if (item.kind === "figure") {
      flush();
      blocks.push(figure(item.figure.file, item.figure.caption ?? ""));
      previous = null;
      continue;
    }
    const line = item.line;
    if (isHeadingLine(line, body)) {
      flush();
      const isTitle = title !== undefined && collapse(line.text) === collapse(title);
      blocks.push(heading(isTitle ? 2 : 3, line.text));
      previous = line;
      continue;
    }
    if (line.bullet === true) {
      if (currentKind !== "list") {
        flush();
        currentKind = "list";
        current = { items: [] };
      }
      current.items.push(joinHyphenated(line.text));
      current.itemX = line.x;
      previous = line;
      continue;
    }
    if (currentKind === "list" && continuesItem(previous, line, current, metrics)) {
      // A list item that wrapped: the continuation belongs to the item above
      // it. The test is the ITEM's own indent and not the page's: an item's
      // text is already indented past its bullet, and a continuation line sits
      // at the same x as the text it continues.
      current.items[current.items.length - 1] += ` ${line.text}`;
      previous = line;
      continue;
    }
    if (currentKind === "paragraph" && continuesParagraph(previous, line, metrics)) {
      current.text += ` ${line.text}`;
    } else {
      flush();
      currentKind = "paragraph";
      current = { text: line.text };
    }
    previous = line;
  }
  flush();
  return blocks.map((block) => (block.kind === "paragraph" ? paragraph(joinHyphenated(block.text)) : block));
}

/**
 * Does `line` continue the paragraph `previous` is part of?
 *
 * Three signals, all of them the compositor's own: an indented first line, a
 * wider gap than the page's leading (the blank line between two paragraphs),
 * and a previous line that ended a sentence with no indent to explain. Across a
 * page break only the last of the three applies, because the two pages have no
 * shared y axis.
 */
function continuesParagraph(previous, line, metrics) {
  if (previous === null) return false;
  if (PARAGRAPH_NUMBER.test(line.text)) return false;
  const margin = metrics.margin(line.page);
  const indented = margin !== null && line.x > margin + 8;
  if (previous.page !== line.page) return !endsSentence(previous.text);
  const distance = previous.y - line.y;
  const gap = metrics.gap(line.page);
  if (gap > 0 && distance > gap * 1.35) return false;
  if (indented) return false;
  if (!endsSentence(previous.text)) return true;
  // A sentence that ends at the right margin ends a LINE, not a paragraph: the
  // compositor had no room left. Only a short line that ends a sentence is a
  // paragraph's last line, which is the one signal that separates FM 21-76's
  // unindented paragraphs (measured: a full-width `...North America.` continues
  // into `Europe, and Asia.`, and the ragged `regions.` after it ends one).
  return !isShortLine(previous, metrics);
}

/** Does `line` continue the list item `current` holds? */
function continuesItem(previous, line, current, metrics) {
  if (previous === null) return false;
  const itemX = current.itemX ?? line.x;
  // An item's text is indented past its bullet, and a wrapped line sits at that
  // same indent: to the right of the bullet, and not far enough right to be a
  // nested list.
  if (line.x <= itemX || line.x > itemX + 40) return false;
  if (previous.page !== line.page) return !endsSentence(previous.text);
  const gap = metrics.gap(line.page);
  if (gap > 0 && previous.y - line.y > gap * 1.35) return false;
  return !endsSentence(previous.text);
}

/** `3-14.`, `1-2.` â€” the Army publications number every paragraph. */
export const PARAGRAPH_NUMBER = /^\d{1,2}-\d{1,2}\.\s/;

/** A line that stops well short of the page's text width is a paragraph finish. */
export function isShortLine(line, metrics) {
  const margin = metrics.margin(line.page) ?? 0;
  const width = metrics.width(line.page);
  if (width <= 0) return true;
  return (line.right ?? 0) - margin < width * 0.9;
}

/** The caption a figure keeps, from the lines of its own page. */
export function captionLines(lines, figureItem) {
  return captionFor(figureItem, lines.filter((line) => line.page === figureItem.page));
}
