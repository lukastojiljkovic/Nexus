// A scanned bulletin's OCR text: the Internet Archive's own `_djvu.txt` layer,
// read as the paragraphs the compositor set.
//
// WHY OCR TEXT AND NOT THE SCAN. The bulletins this pack is built from are the
// only federal publications found that say what mending a man's suit or
// sharpening a plow share actually is, and the Internet Archive's text layer is
// what the scan's own words ARE: every word, in order, including the ones the
// OCR read wrongly. That is the point — the pack ships the source verbatim, and
// "verbatim" for a scan means the OCR's words and not a modern editor's guess at
// them. A word the OCR mangled (`Uiendipg` for `mending`) reads as a scan read
// it, and silently repairing it would be this pack editing the source.
//
// THREE THINGS ARE DROPPED, and each is the digitisation's furniture rather than
// the document's own text: the National Agricultural Library's "Historic,
// archived document" banner, the stamp of the library that scanned the copy, and
// a line that is only a page number. Every pattern comes from `sources.json` so
// that what was dropped is evidence a reader can check, and a pattern that
// matches nothing is an error rather than a silent no-op.

import { heading, paragraph } from "./blocks.mjs";
import { collapse, joinHyphenated, looksLikeHeading } from "./text.mjs";

/**
 * The document's lines, with the digitisation's furniture taken out.
 *
 * `furniture` is a list of regular expressions, one per kind of foreign line,
 * matched against the collapsed line. The count per pattern is returned so a
 * build can print what it dropped and refuse a pattern that no longer matches
 * anything — a stale pattern is how a banner quietly becomes body text again.
 */
export function documentLines(text, furniture = []) {
  const patterns = furniture.map((source) => {
    const match = /^\/(.*)\/([a-z]*)$/.exec(source);
    if (match === null) throw new Error(`ocr: furniture ${JSON.stringify(source)} is not /pattern/flags.`);
    return { source, regex: new RegExp(match[1], match[2].replace("g", "")) };
  });
  const kept = [];
  const dropped = new Map(patterns.map((pattern) => [pattern.source, 0]));
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const plain = collapse(line);
    const pattern = patterns.find((candidate) => candidate.regex.test(plain));
    if (pattern !== undefined) {
      dropped.set(pattern.source, (dropped.get(pattern.source) ?? 0) + 1);
      continue;
    }
    if (/^\d{1,4}$/.test(plain)) {
      dropped.set("page-number", (dropped.get("page-number") ?? 0) + 1);
      continue;
    }
    kept.push(line);
  }
  return { lines: kept, dropped };
}

/**
 * The lines grouped into the paragraphs the compositor set.
 *
 * A blank line is the only paragraph break this text layer has, and it is a
 * reliable one: the Internet Archive's OCR keeps the scan's own spacing between
 * paragraphs. Lines inside one group are wrapped lines of one paragraph.
 */
export function paragraphGroups(lines) {
  const groups = [];
  let current = [];
  for (const line of lines) {
    if (collapse(line) === "") {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** One paragraph group as its own words, with the compositor's hyphens undone. */
export function groupText(group) {
  return joinHyphenated(collapse(group.join(" ")));
}

/**
 * The document as blocks: a heading where the source SET a heading, a paragraph
 * everywhere else.
 *
 * A group of one line that reads as a heading is one, and so is a group whose
 * every line is set in capitals — the bulletins set their section titles that
 * way. Anything else is a paragraph. The classification never changes a word:
 * the same text is in the same order whichever block it lands in, which is what
 * keeps the fidelity test a test of the conversion and not of the classifier.
 */
export function ocrToBlocks(text, options = {}) {
  const { lines } = documentLines(text, options.furniture);
  const blocks = [];
  for (const group of paragraphGroups(lines)) {
    const value = groupText(group);
    if (value === "") continue;
    const single = group.length === 1;
    const allCaps = value === value.toUpperCase() && /\p{L}/u.test(value);
    if ((single && looksLikeHeading(value)) || (allCaps && value.length <= 80)) blocks.push(heading(3, value));
    else blocks.push(paragraph(value));
  }
  return blocks;
}

/**
 * The document's own words, in order, with nothing classified — the oracle the
 * converted article is compared with.
 *
 * It shares the line normaliser with `ocrToBlocks` (the same furniture and the
 * same hyphen rule, because those are statements about the source) and nothing
 * else: it has no notion of a heading, so a paragraph the converter mis-sized
 * still shows up as a fidelity difference if a word moved.
 */
export function ocrWords(text, options = {}) {
  const { lines } = documentLines(text, options.furniture);
  return collapse(paragraphGroups(lines).map((group) => groupText(group)).join(" "));
}
