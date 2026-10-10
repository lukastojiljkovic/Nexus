// The USDA guide reader: a PDF text layer in, a structured document out.
//
// WHY A STRUCTURED DOCUMENT AND NOT A STRING. The fidelity of this pack is its
// safety argument: "Pressure canning is the only recommended method…" and a
// process time of 30 minutes must arrive in the article exactly as the guide
// printed them. So the converter never pastes text together blindly. It reads
// positioned glyph runs, groups them into lines, and decides — with the layout
// as the only evidence — which lines are prose, which are list items and which
// are rows of a table. It then hands out that decision together with the glyph
// runs it was made from, so the build can PROVE that every run landed in exactly
// one place. A number that was dropped, duplicated or put in the wrong column
// fails the build rather than shipping.
//
// THE MEASUREMENTS THE RULES ARE BUILT ON. Taken from the eight PDFs by
// reading their text layers (`node scripts/packs/survival-food/build.mjs
// --measure`):
//
//   * Body text is set at 11.5 pt, table cells at 8.7–8.9 pt, headings at 13 pt.
//     The size is therefore the discriminator between prose and a table.
//   * Within a paragraph or a wrapped table cell the baseline step is 10.3 pt;
//     between two rows of a table it is 13.6 pt and up. 11.5 pt sits in the
//     empty part of the histogram between the two (measured over all eight
//     files: 3 gaps in 11.2–11.5 pt against 568 in 9.6–10.6 pt and 823 in
//     12.2–14.2 pt), which is why {@link TABLE_LINE_GAP} is 11.5 and not a rounder
//     number.
//   * A table region's rows are never more than 24 pt apart, so a gap larger
//     than that and a change of type size both end the region.
//
// WHAT IT REFUSES TO DO. Three of the guide's pages place the process tables on
// top of other text (the guide's own author left a note on Guide 1's
// reconstructed pages saying the tables were re-flowed by hand). On those pages
// the layout alone cannot say which words belong to which cell, so the reader
// stops and emits the page's lines verbatim in a fenced block instead of
// inventing a table. §4 of the pack document lists the pages.

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * A baseline step at or below this continues a WRAPPED TABLE CELL; above it, a
 * new row. Measured over the eight guides: table-set lines step 10.3 pt within
 * a cell and 13.6 pt and up between rows, and 11.5 sits in the empty part of
 * that histogram (3 gaps in 11.2–11.5 pt against 568 in 9.6–10.6 and 823 in
 * 12.2–14.2).
 */
export const TABLE_LINE_GAP = 11.5;

/**
 * A baseline step at or below this continues a PARAGRAPH; above it, a new
 * paragraph.
 *
 * The body text's step is a different number from the table's and it had to be
 * measured separately: over the eight guides the body lines step 13.8 pt within
 * a paragraph (2 750 instances) and 27.6 pt between paragraphs (502), with 20 pt
 * sitting in the empty band between the two. Using the table's 11.5 pt for both
 * turned every line of every paragraph into a paragraph of its own — 813 of
 * Guide 1's blocks were single lines of prose.
 */
export const BODY_LINE_GAP = 20;

/** The largest gap between two rows of one table region. */
export const REGION_GAP = 24;

/** Two glyph runs within this many points of each other share a baseline. */
const SAME_BASELINE = 0.5;

/** Two column starts within this many points are the same column. */
const SAME_COLUMN = 4;

/** Two lines belong to the same text column when their left edges differ by less than this. */
const SAME_MARGIN = 12;

/** Open a document from a path. `pdfjs` reads the file itself, so nothing is held here. */
export async function openDocument(filePath) {
  const task = pdfjs.getDocument({ url: filePath, useSystemFonts: true, isEvalSupported: false });
  return task.promise;
}

/**
 * One page as its glyph runs and its figures.
 *
 * A run is `{ text, x, y, width, height, font }` in PDF user space, where `y`
 * grows upward from the foot of the page. `fontName` is not read anywhere —
 * pdfjs reports the subset name (`g_d0_f6`), which is not a semantic property —
 * and the type SIZE is, which is why `height` is.
 */
export async function readPage(page) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = [];
  // A run's identity includes the page it was printed on. Two pages of the same
  // guide put `Procedure:` at the same point of the layout, so position and text
  // alone called them one run and reported two pages' worth of text as doubled.
  let position = 0;
  let recoveredSpaces = 0;
  for (const entry of content.items) {
    if (typeof entry.str !== "string" || entry.str === "") continue;
    const transform = entry.transform;
    position += 1;
    // The guide's table fonts leave their word space without a Unicode mapping,
    // so pdfjs reports U+FFFD where the page prints an ordinary space — measured
    // over all eight guides, 1 824 runs contain it and every single one has it
    // between two word characters (`Style⠆of⠆Pack`, `5⠆min`), never in place of a
    // letter. It is a substitution rather than an invention: which character the
    // page prints is settled by rendering the page, and page 6-15's render reads
    // `Style of Pack`. The count is returned so the build can report it.
    const text = entry.str.includes("\ufffd") ? entry.str.replace(/\ufffd/g, " ") : entry.str;
    if (text !== entry.str) recoveredSpaces += 1;
    items.push({
      id: `${String(page.pageNumber)}:${String(position)}`,
      text,
      x: transform[4],
      y: transform[5],
      // `entry.width` is already the run's width in user space: pdfjs scales it
      // by the text matrix, so multiplying by `a` here (the type size) made a
      // nine-character run 2 800 points wide and left every table unsplittable.
      width: entry.width,
      height: entry.height,
      font: entry.fontName,
      eol: entry.hasEOL === true,
    });
  }
  items.sort((left, right) => right.y - left.y || left.x - right.x);
  return {
    items,
    figures: await readFigures(page),
    pageHeight: viewport.height,
    pageWidth: viewport.width,
    recoveredSpaces,
  };
}

/**
 * The figures on a page, as `{ id, x, y, width, height, data, imageWidth, imageHeight }`.
 *
 * Read from the page's operator list: `OPS.transform` carries the placement of
 * the drawing that follows it, and `page.objs` hands back the decoded RGBA
 * pixels. Nothing is rendered and nothing is rasterised — these are the images
 * the PDF itself embeds, at the size the PDF uses.
 */
async function readFigures(page) {
  const listed = await page.getOperatorList();
  const figures = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const saved = [];
  const seen = new Set();
  for (let index = 0; index < listed.fnArray.length; index += 1) {
    const fn = listed.fnArray[index];
    const args = listed.argsArray[index] ?? [];
    if (fn === pdfjs.OPS.transform) {
      matrix = args;
      continue;
    }
    if (fn === pdfjs.OPS.save) {
      saved.push([...matrix]);
      continue;
    }
    if (fn === pdfjs.OPS.restore) {
      matrix = saved.pop() ?? matrix;
      continue;
    }
    if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintInlineImageXObject) continue;
    const objectId = typeof args[0] === "string" ? args[0] : null;
    if (objectId !== null && seen.has(objectId)) continue;
    if (objectId !== null) seen.add(objectId);
    let image;
    try {
      image = objectId === null ? args[0] : page.objs.get(objectId);
    } catch {
      image = null;
    }
    if (image === null || image === undefined || image.data === undefined) continue;
    figures.push({
      id: objectId ?? `inline-${String(index)}`,
      x: matrix[4],
      y: matrix[5],
      width: Math.abs(image.width * matrix[0]),
      height: Math.abs(image.height * matrix[3]),
      imageWidth: image.width,
      imageHeight: image.height,
      // The channels are DERIVED from the buffer rather than assumed: pdfjs
      // hands back RGB for a JPEG-ish image and RGBA for one with transparency,
      // and assuming four turned every three-channel photograph into a sharp
      // error about a memory area that was too small.
      channels: image.data.length / (image.width * image.height),
      data: image.data,
    });
  }
  return figures;
}

/**
 * The glyph runs of one page, grouped into lines.
 *
 * A line is where the baseline is: two runs on the same baseline are one line,
 * however far apart they sit horizontally, and the columns of a table row are
 * the cells of that line rather than lines of their own.
 *
 * pdfjs's own `hasEOL` flag is deliberately NOT used. In these files each
 * absolutely-positioned run is its own short text object, so the flag is set on
 * almost every run — measured on Guide 6, where honouring it turned the six
 * cells of one table row into six one-cell lines and left the pack with no
 * table at all.
 */
export function toLines(items) {
  const lines = [];
  let current = null;
  for (const item of items) {
    const fits = current !== null && Math.abs(item.y - current.y) <= SAME_BASELINE;
    if (fits) {
      current.items.push(item);
      continue;
    }
    current = { y: item.y, items: [item] };
    lines.push(current);
  }
  return lines;
}

/** Attach the derived text fields each line is read through. */
export function finishLines(lines) {
  for (const line of lines) {
    line.items.sort((left, right) => left.x - right.x);
    line.text = line.items.map((item) => item.text).join("");
    line.height = Math.max(...line.items.map((item) => item.height));
    line.x = line.items[0].x;
  }
  return lines;
}

/**
 * The running heads and page numbers of a document, from the pages themselves.
 *
 * A line is furniture when the same text opens at least half the pages — that
 * is a running head, and no instruction repeats on half the pages of a guide.
 * A page-number stamp (`6-16`) is furniture by shape. Both are dropped from the
 * articles, and dropping them is the one thing this converter does to the
 * source's own text: a stamp is a position in a printed book, not part of the
 * book's instruction, and the reader of a pack holds the article, not the page.
 * The rule is a measurement rather than a hard-coded string, so a guide whose
 * running head changes is still read correctly.
 */
export function findFurniture(pages) {
  const counts = new Map();
  const isStamp = (text) => /^\d{1,3}-\d{1,3}$/.test(text.trim());
  // A running head is ONE glyph run: the guide's page furniture is a single
  // string, while a table's own row (`Style`, `Jar`, `0–`, …) is several runs
  // on one baseline and repeats on every table page just as a head does. That
  // repeats-on-half-the-pages test alone therefore deleted every table header —
  // measured on Guide 6, where `Style` opens 30 of 36 pages. Requiring one run
  // and the page's top or bottom band separates the two.
  // A margin is any of the four: the guide prints its running head at the top of
  // odd pages AND the guide's title as a side tab in the right edge of every
  // page, and the side tab — one run at x = 571 of a 612-point page — was
  // claimed as article text on 26 pages until this looked sideways too.
  const inMargin = (line, page) =>
    line.y > page.pageHeight * 0.9 ||
    line.y < page.pageHeight * 0.1 ||
    line.x < page.pageWidth * 0.08 ||
    line.x > page.pageWidth * 0.92;
  for (const page of pages) {
    const seen = new Set();
    for (const line of page.lines) {
      const key = line.text.replace(/\s+/g, " ").trim();
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      if (line.items.length !== 1) continue;
      if (!inMargin(line, page)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const heads = new Set();
  // Two fifths of the pages rather than half: Guide 6 prints its running head on
  // every other page, so `>= half` missed it by one page out of thirty-six.
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  for (const [text, count] of counts) if (count >= threshold) heads.add(text);
  return {
    heads,
    isStamp,
    isFurniture(line) {
      const key = line.text.replace(/\s+/g, " ").trim();
      if (key === "" || isStamp(key)) return true;
      return line.items.length === 1 && heads.has(key);
    },
  };
}

/** The type size most of a page's characters are set in. */
export function bodyHeight(lines) {
  const weights = new Map();
  for (const line of lines) {
    const key = Math.round(line.height * 2) / 2;
    weights.set(key, (weights.get(key) ?? 0) + line.text.trim().length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [height, weight] of weights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = height;
    }
  }
  return best === 0 ? 11.5 : best;
}

/**
 * The document's body size: the size most of its characters are set in.
 *
 * Taken once per document rather than once per page, because the guide's
 * appendix pages are nothing but tables and a page-local mode would call the
 * table size the body size there — after which every body line on that page
 * looked like a heading.
 */
export function documentBodyHeight(pages) {
  return bodyHeight(pages.flatMap((page) => page.lines));
}

/** The limit below which an item is table-set rather than prose. */
const tableHeight = (body) => body - 1.5;

/**
 * One page as blocks.
 *
 * The page is first split at the boundaries the layout itself declares: a line
 * whose type size differs from the page's body size, or a gap larger than
 * {@link REGION_GAP}, or a jump of the left margin. Each run is then classified
 * — a table region, a list, a heading or prose — and never re-ordered.
 */
export function pageBlocks(page, furniture, body, options = {}) {
  const { prose = false } = options;
  const limits = tableHeight(body);
  // In prose mode the table-set lines are removed BEFORE the page is split into
  // runs, not inside the loop: a dropped line still ends the run it sits in, and
  // a procedure whose second sentence came after a hidden table line was cut in
  // half there — sauerkraut's steps stopped at "Rinse heads".
  // A line of three or more columns is a table row whatever size it is set in:
  // one of the hidden table copies threaded through these pages' prose is set in
  // the body size, and its row arrived inside a sauerkraut instruction
  // ("If juice does not coverHot Pints 10 min 15 15 20 cabbage, add…").
  const isRow = (line) => splitCells(line).length >= 3;
  const content = page.lines.filter(
    (line) => !furniture.isFurniture(line) && !(prose && (line.height <= limits || isRow(line))),
  );
  const blocks = [];
  let index = 0;
  while (index < content.length) {
    const line = content[index];
    const table = isTableLine(line, limits);
    if (table) {
      let end = index;
      while (end < content.length && isTableLine(content[end], limits)) end += 1;
      // The run of table-set lines may still hold a caption and a span header,
      // which are single-item lines. The table itself is the sub-run of lines
      // that share two or more columns.
      blocks.push(...tableRegion(content.slice(index, end)));
      index = end;
      continue;
    }
    const headingLevel = headingOf(line, body);
    if (headingLevel !== 0) {
      blocks.push({
        kind: "heading",
        level: headingLevel,
        text: normalize(line.text),
        lines: [line],
        runs: [...line.items],
      });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < content.length && continuable(content[end - 1], content[end], limits, body)) end += 1;
    blocks.push(...bodyRun(content.slice(index, end)));
    index = end;
  }
  return blocks;
}

/** A line set in the table size. */
function isTableLine(line, limits) {
  return line.height <= limits;
}

/**
 * True when `next` continues the block `line` opened.
 *
 * The three ways a block ends are the three ways the guide's own layout ends
 * one: the type size changes, the gap is a row gap rather than a line gap, or
 * the text jumps to a different left margin (a list item's continuation is
 * indented past its bullet, a new paragraph is not).
 */
function continuable(line, next, limits, body) {
  if (isTableLine(line, limits) !== isTableLine(next, limits)) return false;
  const limit = isTableLine(line, limits) ? TABLE_LINE_GAP : BODY_LINE_GAP;
  if (Math.abs(line.y - next.y) > limit) return false;
  if (headingOf(next, body) !== 0) return false;
  const indented = next.x > line.x + SAME_MARGIN;
  const bulleted = startsBullet(next.text);
  return indented === bulleted || (!indented && !bulleted);
}

/** The heading level a line carries, or 0 for prose. */
function headingOf(line, body) {
  const text = line.text.trim();
  if (text === "" || text.length > 90) return 0;
  if (line.height >= body + 1.2) return line.height >= body + 2.5 ? 2 : 3;
  // A shout set in the body size: the guide's recipe names ("PICKLED CARROTS")
  // are upper case and short, and the guide uses them as headings.
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  const upper = letters.filter((character) => character === character.toUpperCase());
  if (letters.length >= 4 && upper.length === letters.length && !/[.:;,]$/.test(text)) return 3;
  return 0;
}

/** The bullet a line starts with, or null. */
function startsBullet(text) {
  return /^\s*(?:[\u2022\u2023\u25aa\u25cf\-\u2013]\s+|\(?\d{1,2}[.)]\s+)/.exec(text)?.[0] ?? null;
}

/** A run of lines of one kind: list items, or a paragraph. */
function bodyRun(lines) {
  const blocks = [];
  let list = null;
  let paragraph = null;
  let paragraphRuns = [];
  const flushList = () => {
    if (list !== null) blocks.push(list);
    list = null;
  };
  const flushParagraph = () => {
    if (paragraph !== null) {
      // The lines are kept on the block as well as the joined text. A guide's
      // ingredient list is a run of lines with the SAME leading as a wrapped
      // paragraph, so the layout cannot separate them — the recipe extractor
      // reads them apart by what each line says, which needs the lines.
      blocks.push({
        kind: "paragraph",
        text: normalize(paragraph.map((entry) => entry.text).join(" ")),
        lines: paragraph,
        runs: paragraphRuns,
      });
    }
    paragraph = null;
    paragraphRuns = [];
  };
  for (const line of lines) {
    const bullet = startsBullet(line.text);
    const text = normalize(bullet === null ? line.text : line.text.slice(bullet.length));
    if (bullet !== null) {
      flushParagraph();
      if (list === null) list = { kind: "list", ordered: /^\s*\(?\d/.test(bullet), items: [] };
      list.items.push({ text, lines: [line], runs: [...line.items] });
      continue;
    }
    const previous = list === null ? null : list.items[list.items.length - 1];
    if (previous !== null && line.x > previous.lines[0].x + SAME_MARGIN) {
      previous.text = `${previous.text} ${text}`.trim();
      previous.lines.push(line);
      previous.runs.push(...line.items);
      continue;
    }
    flushList();
    paragraph = paragraph === null ? [] : paragraph;
    paragraph.push({ text, x: line.x, y: line.y });
    paragraphRuns.push(...line.items);
  }
  flushList();
  flushParagraph();
  return blocks;
}

/**
 * A run of table-set lines as a table block plus the prose that surrounds it.
 *
 * Rows of the table are the lines that use two or more columns; a line with one
 * item is the table's caption or its spanning header, and it is emitted as prose
 * immediately before the table, because CommonMark has no spanning cell and
 * folding that sentence into a cell would put words where the source did not.
 */
function tableRegion(lines) {
  const rows = lines.map((line) => ({ line, cells: splitCells(line) }));
  const multi = rows.filter((row) => row.cells.length >= 2);
  if (multi.length < 2) {
    // Not a table after all: two columns appear at least twice, or the run is
    // prose that happens to be set small.
    return bodyRun(lines);
  }
  const bands = columns(multi);
  if (bands.length < 2) return bodyRun(lines);
  const blocks = [];
  const table = { kind: "table", header: null, rows: [], cells: [], sourceItems: [] };
  let merged = null;
  for (const row of rows) {
    if (row.cells.length < 2) {
      blocks.push({
        kind: "paragraph",
        text: normalize(row.line.text),
        lines: [row.line],
        runs: [...row.line.items],
      });
      merged = null;
      continue;
    }
    const placed = placeInBands(row.cells, bands);
    if (placed === null) {
      // A row whose cells do not fit the page's columns in a way this reader can
      // justify is prose, and its runs are NOT part of the table's account of
      // itself — otherwise the check would report them lost.
      blocks.push({
        kind: "paragraph",
        text: normalize(row.line.text),
        lines: [row.line],
        runs: [...row.line.items],
      });
      merged = null;
      continue;
    }
    if (
      merged !== null &&
      merged.line.y - row.line.y <= TABLE_LINE_GAP &&
      fitsUnder(merged.placed, placed)
    ) {
      for (const cell of placed) {
        const target = merged.placed[cell.band];
        if (target === undefined) continue;
        target.items.push(...cell.items);
        target.text = `${target.text} ${cell.text}`.trim();
      }
      table.sourceItems.push(...row.line.items);
      continue;
    }
    merged = { line: row.line, placed };
    // The SAME cell objects the merge loop below writes into: pushing copies
    // left the wrapped header's second line in a cell's `items` and out of its
    // `text`, so the check found every header cell short by one line.
    table.cells.push(placed);
    table.sourceItems.push(...row.line.items);
  }
  if (table.cells.length === 0) return bodyRun(lines);
  table.header = table.cells[0];
  table.rows = table.cells.slice(1);
  return [...blocks, table];
}

/** True when every cell of `next` sits in a band `previous` already filled. */
function fitsUnder(previous, next) {
  for (const cell of next) {
    if (previous[cell.band] === undefined) return false;
  }
  return next.length > 0;
}

/**
 * A line's cells, split where the gap between two runs is wider than a space.
 *
 * The gap is measured against the line's own type size: a word space in these
 * tables is about a quarter of the type size, and the narrowest real column gap
 * is more than a type size. That keeps "1,001–" and "3,000 ft" apart while
 * keeping "Pints or" together.
 */
function splitCells(line) {
  const cells = [];
  let current = [];
  for (const item of line.items) {
    const previous = current[current.length - 1];
    const gap = previous === undefined ? 0 : item.x - (previous.x + previous.width);
    if (previous !== undefined && gap > Math.max(line.height, 8)) {
      cells.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) cells.push(current);
  return cells
    .map((items) => ({
      items,
      x: items[0].x,
      text: normalize(items.map((item) => item.text).join(" ")),
    }))
    .filter((cell) => cell.text !== "");
}

/**
 * The column starts a set of rows shares.
 *
 * A start is a column when at least two rows put a cell within
 * {@link SAME_COLUMN} of it: one row using an x is a wide cell, two rows is a
 * column of a table. The bands come back in reading order, left to right.
 */
function columns(rows) {
  const starts = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      const existing = starts.find((start) => Math.abs(start.x - cell.x) <= SAME_COLUMN);
      if (existing === undefined) starts.push({ x: cell.x, count: 1 });
      else existing.count += 1;
    }
  }
  return starts
    .filter((start) => start.count >= 2)
    .sort((left, right) => left.x - right.x)
    .map((start) => start.x);
}

/** The cells of one row, keyed by the band each belongs to; `null` when a cell fits none. */
function placeInBands(cells, bands) {
  const placed = new Array(bands.length);
  for (const cell of cells) {
    let nearest = -1;
    let distance = Infinity;
    for (let index = 0; index < bands.length; index += 1) {
      const here = Math.abs(bands[index] - cell.x);
      if (here < distance) {
        distance = here;
        nearest = index;
      }
    }
    if (nearest === -1 || distance > 12) return null;
    if (placed[nearest] !== undefined) return null;
    placed[nearest] = { band: nearest, text: cell.text, items: cell.items };
  }
  for (let index = 0; index < placed.length; index += 1) {
    placed[index] ??= { band: index, text: "", items: [] };
  }
  return placed;
}

/**
 * A page whose text layer the layout cannot be trusted on.
 *
 * TWO shapes, both of them properties of the file rather than guesses about it:
 *
 *  1. A prose line sitting between two table lines that are within
 *     {@link REGION_GAP} of each other. No honest page has this, because a table
 *     is one region of a page. Guide 1's reconstructed pages have it: the
 *     guide's own author re-flowed those process tables by hand into the same
 *     area as the prose that discusses them, so one table's header shares a
 *     baseline band with another's heading.
 *  2. Two table lines with the SAME text more than {@link REGION_GAP} apart.
 *     Guide 6's page 6-16 has each process table twice in its text layer thirty
 *     points apart — the printed page shows one of them (checked by rendering
 *     the page and reading the pixels) and the other is a leftover of the
 *     guide's own layout. Which copy is the printed one is not recoverable from
 *     the text layer alone, and picking the wrong one would print a duplicated
 *     table, so the page is left unstructured instead.
 *
 * A run shorter than 3 pt is a space, a rule or a stray mark rather than a word,
 * and every page has one: counting those made 33 of Guide 6's 36 pages look like
 * collages before this test looked at type sizes at all.
 */
export function pageIsAmbiguous(page, body) {
  const limits = tableHeight(body);
  const typed = (line) => line.items.filter((item) => item.height >= 3);
  const small = (line) => {
    const items = typed(line);
    return items.length >= 2 && items.every((item) => item.height <= limits);
  };
  const prose = (line) => typed(line).some((item) => item.height >= body);
  for (let index = 1; index < page.lines.length - 1; index += 1) {
    const previous = page.lines[index - 1];
    const line = page.lines[index];
    const next = page.lines[index + 1];
    if (!small(previous) || !prose(line) || !small(next)) continue;
    if (previous.y - line.y <= REGION_GAP && line.y - next.y <= REGION_GAP) return true;
  }
  // A table's caption, joined across the single-item lines it wraps onto: the
  // guide sets "Recommended process time for Asparagus in a" / "dial-gauge
  // pressure canner" as two lines, and a page carries two such tables whose
  // first line is identical — comparing the lines rather than the joined
  // caption called 16 of Guide 4's 22 pages ambiguous for that reason alone.
  // Column headers are not captions and repeat legitimately, on one page with
  // three tables and across a page break when a table runs past the foot.
  const captions = [];
  let caption = null;
  for (const line of page.lines) {
    const isSingle = typed(line).length === 1 && line.height <= limits;
    if (!isSingle) {
      caption = null;
      continue;
    }
    if (caption === null || caption.y - line.y > REGION_GAP) {
      caption = { y: line.y, text: normalize(line.text) };
      captions.push(caption);
    } else {
      caption.text = `${caption.text} ${normalize(line.text)}`;
    }
  }
  const seen = new Set();
  for (const entry of captions) {
    if (entry.text.length < 40) continue;
    if (seen.has(entry.text)) return true;
    seen.add(entry.text);
  }
  return false;
}

/**
 * A whole document as one block list, page by page.
 *
 * A page the layout cannot be trusted on (see {@link isCollage}) becomes a
 * fenced block of its lines, in reading order and untouched. That is the honest
 * rendering: it keeps every character, it claims no structure, and it is
 * visibly different from a table, which is what a reader needs to know.
 */
export function documentBlocks(pages, furniture = findFurniture(pages), options = {}) {
  const { prose = false } = options;
  const blocks = [];
  const body = documentBodyHeight(pages);
  for (const page of pages) {
    const created = [];
    if (!prose && pageIsAmbiguous(page, body)) {
      const content = page.lines.filter((line) => !furniture.isFurniture(line));
      created.push({
        kind: "code",
        lines: content.map((line) => line.text.replace(/\s+$/, "")),
        runs: content.flatMap((line) => line.items),
      });
    } else {
      created.push(...pageBlocks(page, furniture, body, options));
    }
    // Each block remembers the page it came from, which is what lets a figure be
    // placed beside the text it belongs to rather than at the end of the guide.
    for (const block of created) {
      block.page = page.number;
      blocks.push(block);
    }
  }
  return blocks;
}

/**
 * A table block's own account of where every glyph run landed.
 *
 * The build and the tests both call this, and it is the pack's sharpest check:
 * it compares the runs the page printed with the cells the article will show,
 * one run at a time. A run that appears in no cell, in two cells, or in a cell
 * whose text is not the run's own text joined to its neighbours' is a finding —
 * which is the shape a processing time takes when it moves to the neighbouring
 * column, the one error in this pack that could hurt somebody.
 */
export function tableFindings(table) {
  const findings = [];
  const key = (item) => item.id;
  const landed = new Map();
  const order = (items) =>
    [...items].sort((left, right) => left.y === right.y ? left.x - right.x : right.y - left.y);
  for (const row of table.cells) {
    for (let index = 0; index < row.length; index += 1) {
      const cell = row[index];
      const joined = normalize(order(cell.items).map((item) => item.text).join(" "));
      if (joined !== cell.text) {
        findings.push({ rule: "cell-text", text: cell.text, detail: joined });
      }
      for (const item of cell.items) {
        const at = key(item);
        if (landed.has(at)) findings.push({ rule: "duplicate-run", text: item.text });
        landed.set(at, `${String(table.cells.indexOf(row))}.${String(index)}`);
      }
    }
  }
  for (const item of table.sourceItems ?? []) {
    if (!landed.has(key(item))) findings.push({ rule: "lost-run", text: item.text });
  }
  for (const at of landed.keys()) {
    if (!(table.sourceItems ?? []).some((item) => key(item) === at)) {
      findings.push({ rule: "invented-run", text: at });
    }
  }
  return findings;
}

/** Space-collapsed text, the form every block carries. */
export function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** A table block's cells as a rectangular grid of strings, header first. */
export function tableGrid(table) {
  const width = table.cells.reduce((max, row) => Math.max(max, row.length), 0);
  return table.cells.map((row) => {
    const cells = [];
    for (let index = 0; index < width; index += 1) cells.push(row[index]?.text ?? "");
    return cells;
  });
}

/**
 * Whether every glyph run of the document came out of the blocks exactly once.
 *
 * This is the check the whole reader exists for. The blocks it is handed are the
 * reader's own decisions — which line was a heading, which runs were the cells
 * of a table — and a run that no block claims is a sentence the article will
 * not contain, while a run two blocks claim is a sentence the article will
 * contain twice. Both are failures that read perfectly well in a proofread
 * article, which is why they are counted rather than looked at.
 *
 * A run is identified by where it was printed as well as by its text, because a
 * table's own cells repeat the same words (`min`, `Quarts`) and two of those are
 * two runs, not one run double-counted.
 */
export function documentFindings(pages, furniture, blocks) {
  const key = (item) => item.id;
  const printed = new Map();
  for (const page of pages) {
    for (const line of page.lines) {
      if (furniture.isFurniture(line)) continue;
      for (const item of line.items) printed.set(key(item), 0);
    }
  }
  const findings = [];
  const claimed = new Set();
  for (const block of blocks) {
    for (const item of runsOf(block)) {
      const at = key(item);
      if (!printed.has(at)) {
        findings.push({ rule: "run-not-printed", text: item.text });
        continue;
      }
      if (claimed.has(at)) findings.push({ rule: "run-twice", text: item.text });
      claimed.add(at);
      printed.set(at, printed.get(at) + 1);
    }
  }
  for (const [at, count] of printed) {
    if (count === 0) findings.push({ rule: "run-dropped", text: at });
  }
  return findings;
}

/**
 * A block's glyph runs.
 *
 * Three shapes, because three parts of the reader hold them differently: prose,
 * headings and code hold a flat list; a table holds the runs its cells took; a
 * list holds one list per item. Reading only the first shape silently reported
 * every bullet and every numbered step in Guide 1 as dropped text.
 */
function runsOf(block) {
  if (block.runs !== undefined) return block.runs;
  if (block.sourceItems !== undefined) return block.sourceItems;
  if (block.kind === "list") return block.items.flatMap((item) => item.runs ?? []);
  return [];
}

