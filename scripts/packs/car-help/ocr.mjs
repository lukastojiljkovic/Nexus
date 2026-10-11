// The OCR half of the converter: a scan's text layer turned into the same
// `Block`s the HTML half produces.
//
// WHAT THE INPUT IS. Not a PDF and not the typeset page: the Internet Archive's
// DjVu XML for FM 21-305 and TM 9-8000, which is the OCR's own output with each
// word's box. The box is what makes this half possible at all — the words of a
// line are already grouped by the extractor, the position of a line separates a
// paragraph from the line above it, and the page a line sits on is the page the
// corrections table names.
//
// WHAT IT MAY NOT DO. It may add MARKUP (a heading, a list item, a paragraph
// break) and it may join words the compositor wrapped at a line end; it may not
// add, drop or reorder a word. Every repair that touches the words is in
// `text.mjs` and is a fact about the extraction; every correction that changes
// what the page SAYS is in `corrections.mjs` and is listed for a human.
//
// THE FURNITURE RULE IS A MEASURED CLAIM, NOT A GUESS. A running head, a printed
// page number and the accession number the archive stamped on the scan are
// facts about the PAGE, not about the section the pack ships, so they leave the
// text before it is cut into articles — and `assertFurnitureOnly` refuses a
// dropped line that reads like prose, because a margin band that silently eats
// a sentence is the failure this whole check exists for.

import { foldBulletGlyph, foldLetterSpacing, foldLigatures, joinHyphenated, collapse } from "./text.mjs";
import { heading, list, paragraph } from "./blocks.mjs";

/**
 * How far from a page's top and bottom a line is furniture whatever it says,
 * in the scan's own pixels at the item's resolution (measured: FM 21-305 is
 * scanned at 288 dpi, 4 pixels to the point).
 *
 * `top` is where every page of both sources prints its running head — measured,
 * FM 21-305's head sits 39 pixels down and its first body line 234, and the same
 * numbers hold on TM 9-8000 — and `bottom` is where FM prints its page label
 * (103 pixels from the bottom edge) against a body line that comes no closer
 * than 283. A line BETWEEN those bands is dropped only when its own text names
 * it as furniture: the printed page number, or the running head.
 */
export const MARGIN_BAND = { top: 100, bottom: 150 };

/** A printed page label: `17-4`, `11-5`, `A-1`, `Glossary-3`, `43`, `iv`. */
export const PAGE_LABEL = /^(?:[A-Z][a-z]+-\d{1,3}|[A-Z]{1,2}-\d{1,3}|\d{1,3}(?:-\d{1,3})?|[ivxlc]{1,6})$/;

/** `9-1.`, `17-5.` — both Army publications number every paragraph, and the number heads a line. */
export const PARAGRAPH_NUMBER = /^\d{1,2}-\d{1,2}\.\s/;

/**
 * A run-in heading: the number or letter of a paragraph followed by its short
 * title on the same line as its first sentence. Measured on TM 9-8000 page 9-1,
 * where the scan sets `9-1. Need for Cooling.` in bold and runs the text on, and
 * where `a. Liquid.` opens a sub-item the same way.
 */
export const RUN_IN = /^((?:\d{1,2}-\d{1,2}|[a-z])\.\s+(?:[^().]|\([^)]*\)){2,60}\.)\s+(\S.*)$/;

/** The same run-in heading with its text on the next line: `9-2. Cooling Mediums.` alone. */
export const RUN_IN_ALONE = /^(?:\d{1,2}-\d{1,2}|[a-z])\.\s+[^.]{2,60}\.$/;

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES.get(body) ?? whole;
  });
}

/**
 * A DjVu XML text layer as pages of lines.
 *
 * Each `<OBJECT>` is one scanned page; each `<LINE>` is one line the extractor
 * saw, with the words in the order it read them and the box they occupy. The
 * page's width and height are the image's own, which is what the margin band is
 * measured against.
 */
export function parseDjvu(xml) {
  const pages = [];
  const objects = xml.match(/<OBJECT[\s\S]*?<\/OBJECT>/g) ?? [];
  objects.forEach((object, leaf) => {
    const size = /width="(\d+)" height="(\d+)"/.exec(object);
    const lines = [];
    for (const lineMatch of object.match(/<LINE[^>]*>[\s\S]*?<\/LINE>/g) ?? []) {
      const words = [...lineMatch.matchAll(/<WORD[^>]*coords="([^"]*)"[^>]*>([\s\S]*?)<\/WORD>/g)];
      if (words.length === 0) continue;
      let top = Number.POSITIVE_INFINITY;
      let bottom = 0;
      let x = Number.POSITIVE_INFINITY;
      let right = 0;
      const parts = [];
      for (const word of words) {
        const [x1, y1, x2, y2] = word[1].split(",").map(Number);
        top = Math.min(top, y2);
        bottom = Math.max(bottom, y1);
        x = Math.min(x, x1);
        right = Math.max(right, x2);
        parts.push(decodeEntities(word[2]));
      }
      lines.push({ text: parts.join(" "), x, right, top, bottom, height: bottom - top });
    }
    pages.push({
      leaf,
      width: size === null ? 0 : Number(size[1]),
      height: size === null ? 0 : Number(size[2]),
      label: null,
      lines,
    });
  });
  return pages;
}

/**
 * One page: the lines that are the page's text, the lines that were its
 * furniture, and the page's printed label.
 *
 * `vocabulary` is the source's own running-head tokens (`FM 21-305/AFMAN
 * 24-306`, `TM 9-8000`). A line equal to one of them is furniture wherever it
 * sits, which is what catches the running head TM 9-8000 prints again halfway
 * down a page whose text runs across it.
 */
export function normalisePage(page, options = {}) {
  const band = options.band ?? MARGIN_BAND;
  const vocabulary = options.vocabulary ?? [];
  const kept = [];
  const dropped = [];
  for (const raw of page.lines) {
    const text = collapse(foldLetterSpacing(foldLigatures(raw.text)));
    if (text === "") continue;
    const fromTop = raw.top;
    const fromBottom = page.height - raw.bottom;
    const inBand = fromTop <= band.top || fromBottom <= band.bottom;
    const furniture = PAGE_LABEL.test(text) || vocabulary.includes(text);
    if (furniture || inBand) {
      dropped.push({ text, rule: furniture ? "named" : "margin-band", fromTop, fromBottom });
      if (page.label === null && PAGE_LABEL.test(text)) page.label = text;
      continue;
    }
    const folded = foldBulletGlyph(text);
    kept.push({
      text: folded.text,
      bullet: folded.bullet,
      x: raw.x,
      right: raw.right,
      top: raw.top,
      height: raw.height,
      page: page.leaf,
      pageWidth: page.width,
      pageHeight: page.height,
    });
  }
  return { lines: kept, dropped, label: page.label };
}

/**
 * A dropped line that reads like prose is a refusal, not a repair.
 *
 * A line the source's own running-head vocabulary names is furniture even when
 * it reads like prose; anything else long enough to be a sentence means the band
 * is in the wrong place for this source, and the build stops rather than
 * shipping a section with a sentence missing.
 */
export function assertFurnitureOnly(dropped, sourceId, vocabulary = []) {
  for (const line of dropped) {
    if (line.rule === "named" && (vocabulary.includes(line.text) || PAGE_LABEL.test(line.text))) continue;
    const words = line.text.split(/\s+/).filter((word) => word !== "");
    if (line.text.length > 60 || words.length > 8) {
      throw new Error(
        `${sourceId}: the margin band would drop a line that reads like prose: ${JSON.stringify(line.text)} ` +
          `(${String(Math.round(line.fromTop))} from the top, ${String(Math.round(line.fromBottom))} from the bottom)`,
      );
    }
  }
}

/** The most frequent key, smallest first when two are equally frequent. */
function mode(counts) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Two lines are in the same column when their left edges are within this many pixels. */
const COLUMN_WIDTH = 200;

/**
 * Per column: the left margin, the text width and the leading.
 *
 * All three are read off the page rather than written down, because a
 * two-column scan has two of each and the pack's spans cross the fold
 * (measured: FM 21-305 page 17-4 sets its left column at 83 pixels and its right
 * column at 1041, and the leading is 48 pixels in both). The `metric` is
 * carried by a cluster's own geometry, so nothing here has to know how many
 * columns a page has — the alternative, a page-wide margin, reads the right
 * column's indent as a paragraph break and its short lines as paragraph ends.
 */
export function pageMetrics(lines) {
  const clusters = [];
  for (const line of lines) {
    let cluster = clusters.find((candidate) => Math.abs(candidate.x - line.x) < COLUMN_WIDTH);
    if (cluster === undefined) {
      cluster = { x: line.x, gap: new Map(), previous: null, right: 0 };
      clusters.push(cluster);
    }
    cluster.x = Math.min(cluster.x, line.x);
    cluster.right = Math.max(cluster.right, line.right ?? 0);
    if (cluster.previous !== null) {
      // `top` grows downwards on the scan, so the leading is the NEXT line's top
      // minus this one's. Subtracting the other way round makes every gap
      // negative, and a negative gap silently disables the paragraph break
      // below — which is exactly how two paragraphs once shipped as one.
      const gap = Math.round(line.top - cluster.previous.top);
      if (gap > 0 && gap <= 120) cluster.gap.set(gap, (cluster.gap.get(gap) ?? 0) + 1);
    }
    cluster.previous = line;
  }
  const at = (line) =>
    clusters.find((candidate) => Math.abs(candidate.x - line.x) < COLUMN_WIDTH) ?? { x: 0, gap: new Map(), right: 0 };
  return {
    margin: (line) => at(line).x,
    width: (line) => at(line).right - at(line).x,
    gap: (line) => mode(at(line).gap) ?? 0,
  };
}

function endsSentence(text) {
  return /[.:;?!]$/.test(text.replace(/["')\]]+$/, ""));
}

/** A line that stops well short of the page's text width is a paragraph finish. */
export function isShortLine(line, metrics) {
  const width = metrics.width(line);
  if (width <= 0) return true;
  return (line.right ?? 0) - metrics.margin(line) < width * 0.9;
}

/**
 * Does `line` continue the paragraph `previous` is part of?
 *
 * Three signals, all of them the compositor's own: a wider gap than the
 * column's leading is the blank line between two paragraphs; a line in the other
 * column continues the sentence it was broken off; and a sentence that ended on a
 * line that stopped short ended the paragraph. Indentation is deliberately NOT
 * one of them — these manuals indent a paragraph's first line, a sub-item and a
 * wrapped list item by three different amounts on the same page (measured on
 * FM 21-305 page 13-3: 92, 122 and 159 pixels), so "further right than the
 * margin" says nothing about where a paragraph ends.
 */
export function continuesParagraph(previous, line, metrics) {
  if (previous === null) return false;
  if (PARAGRAPH_NUMBER.test(line.text) || RUN_IN.test(line.text) || RUN_IN_ALONE.test(line.text)) return false;
  if (previous.page !== line.page) return !endsSentence(previous.text);
  if (Math.abs(previous.x - line.x) >= COLUMN_WIDTH) return !endsSentence(previous.text);
  const gap = metrics.gap(line);
  if (gap > 0 && line.top - previous.top > gap * 1.35) return false;
  return !(endsSentence(previous.text) && isShortLine(previous, metrics));
}

/** A wrapped list item's continuation: no sentence ended, and no paragraph gap. */
function continuesItem(previous, line, metrics) {
  if (previous === null) return false;
  if (endsSentence(previous.text)) return false;
  if (Math.abs(previous.x - line.x) >= COLUMN_WIDTH) return true;
  const gap = metrics.gap(line);
  return gap === 0 || line.top - previous.top <= gap * 1.35;
}

/** Is this line a heading the source sets, rather than prose? */
export function isHeadingLine(text) {
  if (text.length > 60) return false;
  const letters = [...text].filter((character) => /[A-Za-z]/.test(character));
  if (letters.length < 2) return false;
  return letters.every((character) => character === character.toUpperCase());
}

/**
 * Lines as `Block`s.
 *
 * `declared` is the plan's own list of heading texts, consumed in order: these
 * manuals print some headings in title case (`Using Jumper Cables to Start
 * Engine`, `Highway Warning Kit`) where no text rule can tell a heading from a
 * short sentence, so the pack author names them and the build refuses when one
 * cannot be found or is found out of order.
 */
export function toBlocks(lines, options) {
  const metrics = pageMetrics(lines);
  const declared = [...(options.declared ?? [])];
  const blocks = [];
  let current = null;
  let currentKind = null;
  let previous = null;

  const flush = () => {
    if (current === null) return;
    if (currentKind === "list") blocks.push(list(current.items));
    else blocks.push(paragraph(collapse(current.text)));
    current = null;
    currentKind = null;
  };

  const openParagraph = (text) => {
    flush();
    currentKind = "paragraph";
    current = { text };
  };

  for (const line of lines) {
    const declaredNext = declared[0];
    let consumed = false;
    if (declaredNext !== undefined) {
      if (line.text === declaredNext) {
        flush();
        blocks.push(heading(2, line.text));
        declared.shift();
        consumed = true;
      } else if (line.text.includes(declaredNext)) {
        throw new Error(`ocr: heading ${JSON.stringify(declaredNext)} is not a line of its own: ${JSON.stringify(line.text)}`);
      }
    }
    if (consumed) {
      previous = line;
      continue;
    }
    if (isHeadingLine(line.text)) {
      flush();
      blocks.push(heading(2, line.text));
      previous = line;
      continue;
    }
    if (RUN_IN_ALONE.test(line.text)) {
      flush();
      blocks.push(heading(PARAGRAPH_NUMBER.test(line.text) ? 2 : 3, line.text));
      previous = line;
      continue;
    }
    const runIn = RUN_IN.exec(line.text);
    if (runIn !== null) {
      flush();
      blocks.push(heading(PARAGRAPH_NUMBER.test(line.text) ? 2 : 3, runIn[1]));
      openParagraph(runIn[2]);
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
      previous = line;
      continue;
    }
    if (currentKind === "list" && continuesItem(previous, line, metrics)) {
      current.items[current.items.length - 1] = joinHyphenated(`${current.items[current.items.length - 1]} ${line.text}`);
      previous = line;
      continue;
    }
    if (currentKind === "paragraph" && continuesParagraph(previous, line, metrics)) {
      current.text += ` ${line.text}`;
    } else {
      openParagraph(line.text);
    }
    previous = line;
  }
  flush();
  if (declared.length > 0) {
    throw new Error(`ocr: the plan lists a heading the source does not print: ${JSON.stringify(declared)}`);
  }
  return blocks.map((block) => (block.kind === "paragraph" ? paragraph(joinHyphenated(block.text)) : block));
}

/**
 * The span's text: the one side of the fidelity test that is not Markdown.
 *
 * It is the same repairs the converter applied, in the same order, which is what
 * makes the comparison a statement about MARKUP: if the two disagree, a word was
 * added, dropped or moved, because nothing else can make them differ.
 */
export function spanText(lines) {
  return collapse(joinHyphenated(lines.map((line) => line.text).join(" ")));
}
