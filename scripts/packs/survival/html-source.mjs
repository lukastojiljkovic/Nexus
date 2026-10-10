// Reading an HTML page: the page's own article element, its text, and the
// Markdown that text is written as.
//
// Three of this pack's sources are web pages (Ready.gov's hazard guidance and
// FoodSafety.gov's safe-temperature chart), and a pack builder may use only
// what the repository already has, so there is no DOM here: this is a small
// tokeniser over the tags those pages actually use. It is deliberately narrow,
// and the fidelity test is what keeps it honest â€” every character inside the
// article element must appear in the Markdown, and the Markdown must contain
// nothing else.
//
// WHAT IS NOT CONVERTED, and why each is a decision rather than an omission:
// images (a federal page mixes public-domain text with photographs licensed
// from stock agencies, and the licence evidence for those is not in the page),
// links (the pack is read offline, so a target that cannot be reached is
// furniture), and attributes of every kind (the page's own text is what ships).

import { heading, list, paragraph, table } from "./blocks.mjs";
import { collapse } from "./normalise.mjs";

/** Elements whose text is not the page's readable text. */
const SKIPPED = new Set(["script", "style", "noscript", "template", "svg"]);

/**
 * Class names that say an element is furniture rather than text: NOAA's pages
 * carry their share line and their section menu INSIDE the article element
 * (measured: the menu appears three times, once per nested navigation rail), so
 * a converter that only knows the element names ships "Share to Twitter" and
 * two copies of a menu as if the agency had written them as guidance.
 */
export const SKIPPED_CLASSES = ["share", "share-line", "menu", "subnav"];

/** Is this opening tag's class one of {@link SKIPPED_CLASSES}? */
function skipsByClass(attributes = "") {
  const match = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  if (match === null) return false;
  const tokens = (match[1] ?? match[2] ?? "").split(/\s+/).filter((token) => token !== "");
  return tokens.some((token) =>
    SKIPPED_CLASSES.some((name) => token === name || token.startsWith(`${name}__`) || token.startsWith(`${name}-`)),
  );
}

const TAG = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/**
 * The page's own article element: its first `<article>`, to the matching close
 * tag. FoodSafety.gov nests an image's `<article>` inside the node's, so the
 * match counts opens and closes rather than taking the first close tag.
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

/** Every character the reader of the article element would see, in order. */
export function articleText(fragment) {
  let text = "";
  let index = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(fragment); match !== null; match = TAG.exec(fragment)) {
    const between = fragment.slice(index, match.index);
    index = match.index + match[0].length;
    if (match[0].startsWith("<!--")) continue;
    const name = (match[1] ?? "").toLowerCase();
    const closing = match[0].startsWith("</");
    if (SKIPPED.has(name)) {
      if (!closing) {
        const end = findClose(fragment, name, index);
        if (end !== null) {
          index = end;
          TAG.lastIndex = end;
        }
      }
      continue;
    }
    if (!closing && skipsByClass(match[2])) {
      const end = findClose(fragment, name, index);
      if (end !== null) {
        index = end;
        TAG.lastIndex = end;
      }
      continue;
    }
    if (closing && name === "br") continue;
    text += between;
    if (isBlockBreak(name)) text += " ";
  }
  text += fragment.slice(index);
  return decodeEntities(text);
}

/** The index just past `</name>`, or null when the element never closes. */
function findClose(fragment, name, from) {
  const pattern = new RegExp(`</${name}\\s*>`, "i");
  const match = pattern.exec(fragment.slice(from));
  return match === null ? null : from + match.index + match[0].length;
}

function isBlockBreak(name) {
  return /^(p|div|li|ul|ol|table|tr|td|th|h[1-6]|br|section|aside|figure|figcaption)$/.test(name);
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
  ["check", "\u2713"],
  ["times", "\u00D7"],
]);

/** The page's own characters: `&amp;` is an `&` before anything else reads it. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES.get(body) ?? whole;
  });
}

/**
 * The article element's text as `Block`s.
 *
 * Every text run inside the element lands in exactly one block, which is what
 * `plainText` then compares with {@link articleText}: a table cell, a list item
 * and a paragraph are all the page's words, and the Markdown between them is
 * the only thing this function adds.
 */
export function htmlToBlocks(fragment) {
  const blocks = [];
  const stack = [];
  let buffer = "";
  let current = null;
  let table = null;
  let row = null;

  const flush = () => {
    const text = collapse(decodeEntities(buffer));
    buffer = "";
    if (current === null) {
      if (text !== "") blocks.push(paragraph(text));
      return;
    }
    if (current.kind === "cell") {
      // The cell is closed here whatever comes next, and its words go
      // somewhere: a flush that left `current` a cell made the NEXT element's
      // text a cell of a table that was already finished, and the first version
      // of this converter dropped the phrase after a table that way, without a
      // word of complaint.
      if (row !== null) row.push(text);
      else if (text !== "") blocks.push(paragraph(text));
      current = null;
      return;
    }
    if (text === "" && current.kind !== "table") return;
    if (current.kind === "heading") blocks.push(heading(current.level, text));
    else if (current.kind === "paragraph") blocks.push(paragraph(text));
    else if (current.kind === "item") {
      const last = blocks[blocks.length - 1];
      const ordered = current.ordered;
      if (last !== undefined && last.kind === "list" && last.ordered === ordered) last.items.push(text);
      else blocks.push(list([text], ordered));
    }
    current = null;
  };

  let index = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(fragment); match !== null; match = TAG.exec(fragment)) {
    const between = fragment.slice(index, match.index);
    index = match.index + match[0].length;
    if (match[0].startsWith("<!--")) continue;
    buffer += between;
    const name = (match[1] ?? "").toLowerCase();
    const closing = match[0].startsWith("</");
    if (process.env.NEXUS_TRACE) {
      console.log("TAG", name, closing, JSON.stringify(buffer.slice(0, 24)), "cur", current === null ? "null" : current.kind, "table", table === null ? "null" : table.length, "row", row === null ? "null" : row.length, "blocks", blocks.length);
    }
    if (SKIPPED.has(name)) {
      if (!closing) {
        const end = findClose(fragment, name, index);
        if (end !== null) {
          index = end;
          TAG.lastIndex = end;
        }
      }
      continue;
    }
    if (!closing && skipsByClass(match[2])) {
      const end = findClose(fragment, name, index);
      if (end !== null) {
        index = end;
        TAG.lastIndex = end;
      }
      continue;
    }
    if (name === "br") {
      buffer += " ";
      continue;
    }
    if (name === "ul" || name === "ol") {
      if (closing) {
        flush();
        stack.pop();
      } else {
        flush();
        stack.push(name === "ol");
      }
      continue;
    }
    if (name === "li") {
      if (closing) flush();
      else {
        flush();
        current = { kind: "item", ordered: stack[stack.length - 1] === true };
      }
      continue;
    }
    if (name === "table") {
      flush();
      if (closing) {
        if (table !== null && table.length > 0) blocks.push(tableBlock(table));
        table = null;
      } else {
        table = [];
      }
      continue;
    }
    if (name === "tr") {
      if (!closing) {
        if (row !== null) table.push(row);
        row = [];
      } else {
        flush();
        if (row !== null) {
          table?.push(row);
          row = null;
        }
      }
      continue;
    }
    if (name === "td" || name === "th") {
      if (closing) flush();
      else {
        flush();
        current = { kind: "cell" };
      }
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      if (closing) flush();
      else {
        flush();
        current = { kind: "heading", level: Math.min(4, Math.max(2, Number(name.slice(1)) + 1)) };
      }
      continue;
    }
    if (name === "p" || name === "figcaption" || name === "div" || name === "section") {
      if (closing) {
        flush();
        continue;
      }
      if (current === null) current = { kind: "paragraph" };
      // A block boundary that falls INSIDE a paragraph is a word boundary:
      // NOAA's figure captions are `(NOAA)` then a `<div>` holding the download
      // link, and without this the two run together as `(NOAA)Download Image`
      // while the text extraction, which breaks blocks the same way, has a
      // space there. The fidelity test caught exactly that.
      else if (buffer !== "" && !/\s$/.test(buffer)) buffer += " ";
      continue;
    }
  }
  flush();
  return blocks;
}

/** A `table` element's rows as a pack table. */
function tableBlock(rows) {
  return table(rows);
}
