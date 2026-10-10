// Reading an HTML page: the page's own article element, its text, and the
// Markdown that text is written as.
//
// Two of this pack's sources are web pages (NHTSA's TireWise page and Ready.gov's
// Car Safety page), and a pack builder may use only what the repository already
// has, so there is no DOM here: this is a small tokeniser over the tags those
// pages actually use. It is deliberately narrow, and the fidelity test is what
// keeps it honest — every character inside a span the pack ships must appear in
// the Markdown, and the Markdown must contain nothing else.
//
// WHAT IS NOT CONVERTED, and why each is a decision rather than an omission:
//
//   * images — a federal page mixes public-domain text with photographs whose
//     licence is not in the page (the usual third-party exception to 17 U.S.C.
//     105), so no figure from either page ships;
//   * links — the pack is read offline, so a target that cannot be reached is
//     furniture, and the source URL is printed on every article instead;
//   * attributes of every kind — the page's own text is what ships.

import { heading, list, paragraph } from "./blocks.mjs";
import { collapse } from "./text.mjs";

/** Elements whose text is not the page's readable text. */
const SKIPPED = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);

/**
 * Class-name prefixes that say an element is furniture rather than text.
 *
 * Measured on the archived NHTSA page: its share line, its language picker and
 * its "Vehicle Safety" navigation rail all sit INSIDE the `<article>` element
 * (the rail once per topic section), so a converter that only knew element names
 * would ship "Share:" and a menu of other topics as if the agency had written
 * them as tyre advice. The list is per source, and the fidelity test is what
 * proves it drops nothing the pack needs.
 */
export const DEFAULT_SKIP_CLASSES = [
  "share",
  "share-and-language",
  "topic-page-lang",
  "page-topic--menu",
  "menu",
  "carousel",
  "visually-hidden",
];

/** Is this opening tag's class one of `skipClasses`? */
function skipsByClass(attributes, skipClasses) {
  const match = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes ?? "");
  if (match === null) return false;
  const tokens = (match[1] ?? match[2] ?? "").split(/\s+/).filter((token) => token !== "");
  return tokens.some((token) =>
    skipClasses.some(
      (name) =>
        token === name || token.startsWith(`${name}--`) || token.startsWith(`${name}__`) || token.startsWith(`${name}-`),
    ),
  );
}

const TAG = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/**
 * The page's own article element: its first `<article>`, to the matching close
 * tag. Ready.gov nests an image's `<article>` inside the node's, so the match
 * counts opens and closes rather than taking the first close tag.
 */
export function articleHtml(html) {
  const open = /<article\b[^>]*>/i.exec(html);
  if (open === null) return null;
  let depth = 0;
  const pattern = /<\/?article\b[^>]*>/gi;
  pattern.lastIndex = open.index;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open.index, match.index + match[0].length);
  }
  return null;
}

/**
 * The index just past the `name` element that closes the one opened before
 * `from`, or null when it never closes.
 *
 * The nesting is COUNTED rather than taken from the first close tag, because a
 * skipped element that contains another of its own kind — NHTSA's carousel
 * holds four nested `div`s — would otherwise end at the first `</div>` and
 * leave the widget's text inside the article.
 */
function findClose(fragment, name, from) {
  const pattern = new RegExp(`<${name}\\b[^>]*>|</${name}\\s*>`, "gi");
  pattern.lastIndex = from;
  let depth = 1;
  for (let match = pattern.exec(fragment); match !== null; match = pattern.exec(fragment)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return null;
}

/** A tag that separates one run of text from the next: `</p><p>` is not "endStart". */
function isBlockBreak(name) {
  return /^(p|div|li|ul|ol|table|tr|td|th|h[1-6]|br|section|article|aside|figure|figcaption|header|footer)$/.test(name);
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["mdash", "\u2014"],
  ["ndash", "\u2013"],
  ["rsquo", "\u2019"],
  ["lsquo", "\u2018"],
  ["ldquo", "\u201C"],
  ["rdquo", "\u201D"],
  ["hellip", "\u2026"],
  ["deg", "\u00B0"],
  ["frac12", "\u00BD"],
  ["times", "\u00D7"],
]);

/** The page's own characters: `&amp;` is an `&` before anything else reads it. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES.get(body) ?? whole;
  });
}

/** The heading level the source's own tag maps to: the article's title is `#`, so `h1`/`h2` are `##`. */
function headingLevel(name) {
  const size = Number(name.slice(1));
  if (size <= 2) return 2;
  if (size <= 4) return 3;
  return 4;
}

/**
 * The fragment's readable text, and the `Block` each part of it becomes.
 *
 * ONE pass, two answers, and they have to agree: `text` is every character a
 * reader would see, and `entries` is that text cut into blocks, each carrying the
 * offsets it occupies in `text`. The offsets are what make the fidelity test a
 * statement rather than a tautology — an article is a span BETWEEN two headings,
 * so its source text is `text.slice(first.start, last.end)`, read off the page
 * rather than written by the converter that is being checked.
 *
 * Every text run inside the fragment lands in exactly one block, which is what
 * `plainText` then compares with the slice of `text`.
 */
export function htmlParse(fragment, options = {}) {
  const skipClasses = options.skipClasses ?? DEFAULT_SKIP_CLASSES;
  const entries = [];
  const stack = [];
  let text = "";
  let buffer = "";
  let bufferStart = 0;
  let current = null;

  const push = (block, start, end) => {
    entries.push({ block, start, end });
  };

  /**
   * The one place text is appended, and the reason the offsets are exact: a
   * block's slice begins where its buffer BECAME non-empty, not where it was
   * flushed, so a heading's leading whitespace is not mistaken for the start of
   * its words.
   */
  const append = (chunk) => {
    // Entities are decoded HERE, where the text enters, and not once at the
    // end: `&nbsp;` is six characters that become one, so a decode applied
    // after the offsets were computed would shift every later block's slice.
    const piece = decodeEntities(chunk);
    if (buffer === "") bufferStart = text.length;
    buffer += piece;
    text += piece;
  };

  const flush = () => {
    const start = bufferStart;
    const raw = buffer;
    buffer = "";
    const plain = collapse(raw);
    const end = start + raw.length;
    if (plain === "") {
      current = null;
      bufferStart = text.length;
      return;
    }
    if (current === null || current.kind === "paragraph") push(paragraph(plain), start, end);
    else if (current.kind === "heading") push(heading(current.level, plain), start, end);
    else {
      const last = entries[entries.length - 1];
      // Two `<li>`s are one list when nothing but whitespace separates them,
      // so the second item extends the first block's offsets rather than
      // opening a second list beside it.
      if (last !== undefined && last.block.kind === "list" && text.slice(last.end, start).trim() === "") {
        last.block.items.push(plain);
        last.end = end;
      } else {
        push(list([plain]), start, end);
      }
    }
    current = null;
    bufferStart = text.length;
  };

  let index = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(fragment); match !== null; match = TAG.exec(fragment)) {
    const between = fragment.slice(index, match.index);
    index = match.index + match[0].length;
    if (match[0].startsWith("<!--")) continue;
    const name = (match[1] ?? "").toLowerCase();
    const closing = match[0].startsWith("</");
    // A tag that separates blocks separates the two texts too, or `</p><p>`
    // would glue the last word of one paragraph to the first of the next.
    append(between + (isBlockBreak(name) ? " " : ""));
    if (SKIPPED.has(name) || (!closing && skipsByClass(match[2], skipClasses))) {
      if (!closing) {
        const end = findClose(fragment, name, index);
        if (end !== null) {
          index = end;
          TAG.lastIndex = end;
        }
      }
      continue;
    }
    if (name === "ul" || name === "ol") {
      flush();
      if (closing) stack.pop();
      else stack.push(name === "ol");
      continue;
    }
    if (name === "li") {
      if (closing) flush();
      else {
        flush();
        current = { kind: "item" };
      }
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      if (closing) flush();
      else {
        flush();
        current = { kind: "heading", level: headingLevel(name) };
      }
      continue;
    }
    if (name === "p" || name === "figcaption" || name === "div" || name === "section") {
      if (closing) flush();
      else if (current === null) current = { kind: "paragraph" };
      continue;
    }
    if (isBlockBreak(name) && closing) flush();
  }
  flush();
  text += decodeEntities(fragment.slice(index));
  return { text, entries };
}

/** Every character the reader of the fragment would see, in order. */
export function articleText(fragment, options = {}) {
  return htmlParse(fragment, options).text;
}

/**
 * The entries between two headings, as the plan asks for them.
 *
 * `from` is included and `to` is not, and both are matched on the heading's
 * collapsed text. The search for `from` begins at `after`, so two spans that
 * begin at headings with the same words (the NHTSA page prints "Tire Pressure"
 * both as a FAQ panel and inside "Tire Pressure Monitoring System") are read in
 * the order the page prints them rather than resolved by a guess.
 */
export function sliceEntries(entries, span, after = 0) {
  const find = (wanted, from) =>
    entries.findIndex(
      (entry, index) =>
        index >= from && typeof entry.block.text === "string" && collapse(entry.block.text) === collapse(wanted),
    );
  const from = find(span.from, after);
  if (from < 0) throw new Error(`html: no heading ${JSON.stringify(span.from)} to start a span.`);
  if (span.to === undefined) return { entries: entries.slice(from), next: entries.length };
  const to = find(span.to, from + 1);
  if (to < 0) {
    throw new Error(
      `html: no heading ${JSON.stringify(span.to)} to end the span that starts at ${JSON.stringify(span.from)}.`,
    );
  }
  return { entries: entries.slice(from, to), next: to };
}
