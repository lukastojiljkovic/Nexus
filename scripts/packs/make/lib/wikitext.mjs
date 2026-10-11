// A Wikibooks page's wikitext, as the blocks the Reader draws.
//
// WHY WIKITEXT AND NOT THE RENDERED PAGE. A rendered Wikibooks page is a third
// party's HTML with a template's furniture, a navigation sidebar and a licence
// footer in it, and slicing the article out of that is guesswork. The wikitext
// is what the page SAYS, it is the form the licence covers, and it is what the
// page's own history holds; converting it is a smaller job than un-rendering it.
//
// WHAT IS CONVERTED, and nothing else: headings, paragraphs, bullet and ordered
// lists, definition lists, pipe tables, and the inline forms a page actually uses
// (`'''bold'''`, `''italic''`, `[[link|label]]`, `[url label]`). Templates,
// comments, `<ref>` blocks, category links and file links are markup rather than
// the page's own prose, and each is counted as it is dropped so a build prints
// what it left behind. Two of them are REFUSED rather than dropped, because
// dropping them would lose text a reader would have seen: a `[[File:…]]` link's
// caption, and a parser function (`{{#invoke:…}}`, `{{#expr:…}}`) whose output is
// a value the wikitext does not contain.

import { heading, list, paragraph, table } from "./blocks.mjs";
import { collapse, decodeEntities } from "./text.mjs";

/** A template call, with its parameters: `{{name|a|b}}`, nested to any depth. */
function readTemplate(text, start) {
  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    if (text.startsWith("{{", index)) {
      depth += 1;
      index += 1;
      continue;
    }
    if (text.startsWith("}}", index)) {
      depth -= 1;
      if (depth === 0) return { source: text.slice(start, index + 2), end: index + 2 };
      index += 1;
    }
  }
  throw new Error("wikitext: a template is never closed.");
}

/** A `[[…]]` link, with its nesting handled so `[[a|[[b]]]]` cannot end early. */
function readLink(text, start) {
  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    if (text.startsWith("[[", index)) {
      depth += 1;
      index += 1;
      continue;
    }
    if (text.startsWith("]]", index)) {
      depth -= 1;
      if (depth === 0) return { source: text.slice(start, index + 2), end: index + 2 };
      index += 1;
    }
  }
  throw new Error("wikitext: a link is never closed.");
}

/**
 * The markup taken out of the page's text, and what it was.
 *
 * `dropped` is a census by kind, printed by the build and listed in
 * `docs/packs/make.md`: a template the page transcluded, a category link, a
 * citation. Every one of them is markup rather than the page's own prose, which
 * is why dropping it keeps the article faithful.
 */
export function stripWikitextMarkup(text) {
  const dropped = { templates: [], comments: 0, refs: 0, categories: 0, magicWords: 0 };
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      index = end < 0 ? text.length : end + 3;
      dropped.comments += 1;
      continue;
    }
    if (text.startsWith("{{", index)) {
      const template = readTemplate(text, index);
      const name = template.source.slice(2).split(/[|}]/)[0].trim();
      if (/^#(invoke|expr|if|ifeq|switch|time|tag|formatnum)/i.test(name)) {
        throw new Error(`wikitext: the parser function ${JSON.stringify(template.source.slice(0, 60))} holds text this converter would lose.`);
      }
      dropped.templates.push(name);
      index = template.end;
      continue;
    }
    if (text.startsWith("[[", index)) {
      const link = readLink(text, index);
      const target = link.source.slice(2, -2).split("|")[0].trim();
      if (/^(file|image|media):/i.test(target)) {
        throw new Error(`wikitext: the file link ${JSON.stringify(link.source.slice(0, 60))} carries a caption this converter would lose.`);
      }
      if (/^category:/i.test(target)) {
        dropped.categories += 1;
        index = link.end;
        continue;
      }
      out += linkLabel(link.source);
      index = link.end;
      continue;
    }
    const ref = /^<ref\b[^>]*\/?>/.exec(text.slice(index));
    if (ref !== null) {
      // A self-closing `<ref name="x"/>` has no body: looking for `</ref>` would
      // find one further down the page and swallow everything between them.
      if (ref[0].endsWith("/>")) {
        index += ref[0].length;
      } else {
        const end = text.indexOf("</ref>", index);
        index = end < 0 ? text.length : end + 6;
      }
      dropped.refs += 1;
      continue;
    }
    const magic = /^__[A-Z]+__/.exec(text.slice(index));
    if (magic !== null) {
      index += magic[0].length;
      dropped.magicWords += 1;
      continue;
    }
    if (text.startsWith("<", index)) {
      const tag = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(text.slice(index));
      if (tag !== null && !["br", "b", "i", "em", "strong", "sub", "sup", "small"].includes(tag[1].toLowerCase())) {
        throw new Error(`wikitext: the tag <${tag[1]}> is not part of the subset this converter knows.`);
      }
      if (tag !== null) {
        out += tag[1].toLowerCase() === "br" ? " " : "";
        index += tag[0].length;
        continue;
      }
    }
    out += text[index];
    index += 1;
  }
  return { text: out, dropped };
}

/** The words a `[[…]]` link contributes: its label when it has one, its target otherwise. */
function linkLabel(source) {
  const inner = source.slice(2, -2);
  const pipe = inner.indexOf("|");
  if (pipe >= 0) return inner.slice(pipe + 1);
  // A target with a namespace (`w:Lard`) or a fragment reads as its last part,
  // which is the word a reader sees on the page.
  return inner.replace(/^[a-z-]+:/i, "").replace(/#.*$/, "").replace(/_/g, " ");
}

/** The page's line-level structure: headings, lists, tables and paragraphs. */
function structureOf(text) {
  const blocks = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  let paragraphLines = [];

  const flushParagraph = () => {
    const value = inlineText(paragraphLines.join(" "));
    paragraphLines = [];
    if (value !== "") blocks.push(paragraph(value));
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    const headingMatch = /^(={1,6})\s*(.*?)\s*\1\s*$/.exec(trimmed);
    if (headingMatch !== null) {
      flushParagraph();
      blocks.push(heading(Math.min(6, headingMatch[1].length + 1), inlineText(headingMatch[2])));
      index += 1;
      continue;
    }

    if (trimmed.startsWith("{|")) {
      flushParagraph();
      const parsed = readTable(lines, index);
      blocks.push(table(parsed.rows));
      index = parsed.next;
      continue;
    }

    if (/^[*#]/.test(trimmed)) {
      flushParagraph();
      const parsed = readList(lines, index);
      blocks.push(list(parsed.items, parsed.ordered));
      index = parsed.next;
      continue;
    }

    if (trimmed.startsWith(";")) {
      flushParagraph();
      const parsed = readDefinitions(lines, index);
      blocks.push(paragraph(parsed.text));
      index = parsed.next;
      continue;
    }

    paragraphLines.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

/** A run of lines starting with a marker, as the items of one list. */
function readList(lines, start) {
  const ordered = lines[start].trim().startsWith("#");
  const items = [];
  let index = start;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!/^[*#]/.test(trimmed)) break;
    if (trimmed.startsWith("#") !== ordered) break;
    // The marker is at the top level only: a nested list (`** item`) is the same
    // list to this converter, because the Reader's own grammar would put it in
    // one item and the words are what matter.
    items.push(inlineText(trimmed.replace(/^[*#]+\s*/, "")));
    index += 1;
  }
  return { items, ordered, next: index };
}

/**
 * A definition list: `;Term: definition`, with the term's own line.
 *
 * The Reader's Markdown subset has no definition list, so a term and its
 * definition become one paragraph of the term's and the definition's own words,
 * in that order. Nothing is added between them — the colon the wikitext spells
 * the list with is markup, and a page's `;Tools:` reads as `Tools` to a person
 * just as it does here.
 */
function readDefinitions(lines, start) {
  const parts = [];
  let index = start;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith(";")) {
      const body = trimmed.replace(/^;+\s*/, "");
      const colon = body.indexOf(":");
      if (colon > 0) parts.push(inlineText(body.slice(0, colon)), inlineText(body.slice(colon + 1)));
      else parts.push(inlineText(body));
      index += 1;
      continue;
    }
    if (trimmed.startsWith(":")) {
      parts.push(inlineText(trimmed.replace(/^:+\s*/, "")));
      index += 1;
      continue;
    }
    break;
  }
  return { text: collapse(parts.join(" ")), next: index };
}

/**
 * A pipe table: `!` rows are the head, `|` rows the body, `||` splits one line
 * into cells. Attribute lines (`|- style=…`) and caption lines (`|+ …`) carry no
 * cell text and are dropped; a caption is kept as the table's first row, because
 * a caption is text a reader would otherwise lose.
 */
function readTable(lines, start) {
  const rows = [];
  const captions = [];
  let index = start + 1;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("|}")) {
      index += 1;
      break;
    }
    if (trimmed.startsWith("|+")) {
      captions.push(inlineText(trimmed.replace(/^\|\+[^|]*\|?/, "").replace(/^\|\+\s*/, "")));
      index += 1;
      continue;
    }
    if (trimmed.startsWith("|-")) {
      index += 1;
      continue;
    }
    if (trimmed.startsWith("!")) {
      rows.push(splitCells(trimmed.replace(/^!+\s*/, "")));
      index += 1;
      continue;
    }
    if (trimmed.startsWith("|")) {
      rows.push(splitCells(trimmed.replace(/^\|+\s*/, "")));
      index += 1;
      continue;
    }
    index += 1;
  }
  const head = rows.length > 0 ? rows[0] : [];
  const body = rows.slice(1);
  const withCaption = captions.map((caption) => [caption]);
  return { rows: [...withCaption, head, ...body].filter((row) => row.length > 0), next: index };
}

/**
 * One table line's cells.
 *
 * MediaWiki spells the cell separator `||` in a `|` row and `!!` in a `!` row,
 * and accepts either in both — the Wikibooks table this pack ships writes its
 * header row with `||`, which a converter that only knew `!!` would read as one
 * cell whose text carried two pipe characters the page never showed.
 */
function splitCells(line) {
  return line
    .split(/\|\||!!/)
    .map((cell) => inlineText(cell.replace(/^[^|]*\|(?!\|)/, "")))
    .filter((cell) => cell !== "");
}

/** The page's own words, without the wikitext's markup. */
export function inlineText(text) {
  let out = text;
  out = out.replace(/'''''([^']*)'''''/g, "$1");
  out = out.replace(/'''([^']*)'''/g, "$1");
  out = out.replace(/''([^']*)''/g, "$1");
  out = out.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  out = out.replace(/\[\[([^\]]*)\]\]/g, (whole, inner) => inner.replace(/^[a-z-]+:/i, "").replace(/#.*$/, ""));
  out = out.replace(/\[(https?:\/\/\S+)\s+([^\]]*)\]/g, "$2");
  out = out.replace(/\[(https?:\/\/\S+)\]/g, "$1");
  out = decodeEntities(out);
  out = out.replace(/<[^>]*>/g, " ");
  return collapse(out);
}

/** The page as blocks, and the census of the markup taken out on the way. */
export function wikitextToBlocks(source) {
  const stripped = stripWikitextMarkup(source);
  return { blocks: structureOf(stripped.text), dropped: stripped.dropped };
}

/**
 * The page's own words, in order, with nothing classified — the oracle.
 *
 * Written as a second, cruder pass: it strips the line markers with its own
 * expression rather than walking a structure, so a table row the converter lost
 * or a list item it merged shows up as a difference. It shares `inlineText`
 * with the converter, which is stated rather than hidden: the INLINE level is
 * checked by the other half of the fidelity test (`stripMarkup(toMarkdown(…))`),
 * and this half is what checks that no whole line went missing.
 */
export function wikitextWords(source) {
  const text = stripWikitextMarkup(source).text;
  const out = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^\{\||^\|\}|^\|-/.test(line)) continue;
    const headingMatch = /^(={1,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (headingMatch !== null) {
      out.push(inlineText(headingMatch[2]));
      continue;
    }
    if (line.startsWith("|+")) {
      out.push(inlineText(line.replace(/^\|\+[^|]*\|?/, "").replace(/^\|\+\s*/, "")));
      continue;
    }
    if (line.startsWith("!") || line.startsWith("|")) {
      for (const cell of line.replace(/^[|!]+\s*/, "").split(/\|\||!!/)) out.push(inlineText(cell.replace(/^[^|]*\|(?!\|)/, "")));
      continue;
    }
    if (line.startsWith(";")) {
      out.push(inlineText(line.replace(/^;+\s*/, "").replace(/:/g, " ")));
      continue;
    }
    if (/^[*#:]/.test(line)) {
      out.push(inlineText(line.replace(/^[*#:]+\s*/, "")));
      continue;
    }
    out.push(inlineText(line));
  }
  return collapse(out.join(" "));
}

/**
 * One `== Section ==` of a page, or the whole page when no title is given.
 *
 * A section's text runs to the next heading of the same or a higher level, which
 * is the same rule `html.mjs` uses for a book, so a plan reads the same way
 * whichever kind of source it names.
 */
export function sectionSource(source, title) {
  if (title === undefined) return source;
  const lines = source.split("\n");
  const wanted = title.replace(/\s+/g, " ").toLowerCase();
  let from = -1;
  let level = 0;
  for (const [index, line] of lines.entries()) {
    const match = /^(={1,6})\s*(.*?)\s*\1\s*$/.exec(line.trim());
    if (match === null) continue;
    if (from < 0 && headingText(match[2]).toLowerCase() === wanted) {
      from = index;
      level = match[1].length;
      continue;
    }
    if (from >= 0 && match[1].length <= level) return lines.slice(from, index).join("\n");
  }
  if (from < 0) throw new Error(`wikitext: no section ${JSON.stringify(title)}.`);
  return lines.slice(from).join("\n");
}

/** A heading's text as it is displayed: markup out, spaces collapsed. */
function headingText(text) {
  return collapse(inlineText(text));
}
