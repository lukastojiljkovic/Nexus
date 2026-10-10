// No shebang, for the reason the other gates in `scripts/` have none: this
// module is both imported by `build.mjs` and driven by its own test.
//
// Wikisource, converted: the parser's HTML for one page in, one article out.
//
// WHY HTML AND NOT WIKITEXT. `action=parse&prop=text` answers with what the
// reader sees: `<poem>` already expanded, templates already substituted,
// categories already gone. Converting wikitext would mean re-implementing
// MediaWiki — templates, `<poem>`, `''`/`'''`, `[[…]]`, parser functions — and
// every one of those is a place to lose a sentence a reader would have seen.
// It also gives the fidelity test a real oracle: the page's text as the wiki
// itself renders it, with tags taken off, is what the article's text has to be.
//
// WHAT IS CUT, AND WHY IT IS NOT CENSORSHIP. A Wikisource page is a tale
// wrapped in the wiki's apparatus: an `Извор` section naming the printed
// edition, a `Референце` list of the transcriber's notes, `Види још` links, and
// a licence box that states the work's public-domain status. The licence box is
// evidence and lives in `sources.json`; the printed source is evidence and
// lives in the article's Source line; the notes and the see-also links are the
// wiki's furniture around the text and are not part of the tale. Everything
// that is left after those three cuts is the article, verbatim.

import { decodeEntities, escapeText } from "./markdown.mjs";

/**
 * The headings that start the wiki's apparatus rather than the tale.
 *
 * Measured over the 207 pages of `Категорија:Српске народне приповетке`: every
 * one of the headings that appear there is either one of these or a tale's own
 * title, so this list is the whole of the cut and a new one means a page this
 * converter has not seen.
 */
export const APPARATUS_HEADINGS = new Set([
  "Извор",
  "Референце",
  "Види још",
  "Напомене",
  "Напомена уз наслов",
  "Литература",
  "Спољашње везе",
  "Књига",
]);

/** Elements whose text begins a new block, so the oracle needs a boundary too. */
const BLOCK_ELEMENTS = new Set([
  "p", "div", "center", "blockquote", "figure", "figcaption", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "td", "th",
]);

/** Elements that are their own thing, with no closing tag to wait for. */
const VOID_ELEMENTS = new Set(["br", "img", "hr", "meta", "link", "wbr"]);

/**
 * Elements the converter knows what to do with.
 *
 * An element outside this list stops the build. That is the point: the markup
 * of 207 pages is a corpus somebody else chose, a `{{template}}` can start
 * rendering anything tomorrow, and a converter that shrugs at an unknown tag
 * is a converter that silently drops whatever is inside it.
 */
const INLINE_ELEMENTS = new Set([
  "span", "a", "b", "strong", "i", "em", "small", "big", "sup", "sub",
  "code", "tt", "abbr", "cite", "q", "s", "u", "var", "kbd", "samp", "time",
  "ruby", "rb", "rt", "rp", "bdi", "bdo", "mark", "ins", "del", "dfn", "data",
]);

/**
 * A tiny HTML reader, enough for MediaWiki's parser output and no more.
 *
 * The parser output is well-formed XHTML, so a stack is all the reading this
 * needs; there is no error recovery here because there is nothing to recover
 * from. Comments are dropped with their contents — the parser appends a report
 * of its own timing in one, and that is not a sentence of anybody's tale — and
 * a tag whose name the converter does not know is refused by {@link renderNode}
 * rather than skipped.
 */
function parseHtml(html) {
  const root = { name: "#root", children: [] };
  const stack = [root];
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let cursor = 0;
  let match;
  while ((match = tagPattern.exec(withoutComments)) !== null) {
    const text = withoutComments.slice(cursor, match.index);
    if (text !== "") stack[stack.length - 1].children.push({ text: decodeEntities(text) });
    cursor = match.index + match[0].length;
    const name = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      // A stray close tag is not the parser's output; refusing beats guessing.
      const top = stack[stack.length - 1];
      if (stack.length === 1 || top.name !== name) continue;
      stack.pop();
      continue;
    }
    const element = { name, children: [] };
    stack[stack.length - 1].children.push(element);
    if (!VOID_ELEMENTS.has(name) && !match[0].endsWith("/>")) stack.push(element);
  }
  const tail = withoutComments.slice(cursor);
  if (tail !== "") root.children.push({ text: decodeEntities(tail) });
  return root;
}

/** The page's visible text with every tag removed; whitespace as a space. */
export function textOf(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\s+/gu, " ").trim();
}

/**
 * The page's content, with the wiki's apparatus cut off.
 *
 * Three cuts, in the order the wiki prints them: the first apparatus heading
 * (which is `Извор` on this corpus), the first licence box (the
 * `{{ЈВ-аутор}}`-style table, which states the public-domain status), and the
 * first reference list. Whichever comes first wins, so a page with no `Извор`
 * section is still a page whose licence box is not part of anybody's tale.
 */
export function contentRegion(html) {
  const cuts = [];
  // Two levels, because the corpus uses both: an `Извор` section is an `h2` on
  // 174 of the category's pages and an `h3` on 26 of them (the magazine pieces
  // from „Луча" and „Босанска вила"). Cutting only the `h2` form would have
  // carried those sections' furniture into pages the pack does not use, and the
  // report would have said „no Извор section" about a page that has one.
  const headingPattern = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/g;
  for (const match of html.matchAll(headingPattern)) {
    if (APPARATUS_HEADINGS.has(textOf(match[2]))) cuts.push(match.index);
  }
  for (const pattern of [/<table[^>]*class="boilerplate"/, /<div class="reflist"/]) {
    const at = html.search(pattern);
    if (at !== -1) cuts.push(at);
  }
  return cuts.length === 0 ? html : html.slice(0, Math.min(...cuts));
}

/**
 * The `Извор` section's text — the printed edition and page numbers a tale was
 * transcribed from, which becomes the article's Source line and the collection
 * the tale is filed under.
 */
export function sourceSection(html) {
  const at = html.search(/<h[23][^>]*>\s*(?:<span[^>]*><\/span>\s*)?Извор\s*<\/h[23]>/);
  if (at === -1) return "";
  const heading = /<\/h[23]>/.exec(html.slice(at));
  if (heading === null) return "";
  const start = at + heading.index + heading[0].length;
  const rest = html.slice(start);
  const end = rest.search(/<h[23]|<table[^>]*class="boilerplate"|<div class="reflist"/);
  return textOf(end === -1 ? rest : rest.slice(0, end));
}

/**
 * The licence box's text — the verbatim public-domain statement the wiki prints
 * under every one of these pages, which is the licence evidence `sources.json`
 * records.
 */
export function licenceNotice(html) {
  const at = html.search(/<table[^>]*class="boilerplate"/);
  if (at === -1) return "";
  const rest = html.slice(at);
  const end = rest.indexOf("</table>");
  return textOf(end === -1 ? rest : rest.slice(0, end + "</table>".length));
}

/**
 * The oracle: the region's text, as the wiki rendered it, with tags off.
 *
 * Block-level tags become a space and the rest become nothing, which is what
 * makes this comparable with markdown: the converter puts a blank line or a
 * list marker where a block began, and `stripMarkup` removes it again, so both
 * sides of the fidelity test have a space where a block ended. A `<br>` becomes
 * a space for the same reason — the converter writes a hard break there.
 */
export function regionText(regionHtml) {
  const blockTags = [...BLOCK_ELEMENTS].join("|");
  return decodeEntities(
    regionHtml
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(new RegExp(`</?(?:${blockTags})\\b[^>]*>`, "gi"), " ")
      .replace(/<[^>]+>/g, ""),
  );
}

/**
 * The region as CommonMark.
 *
 * `list` carries the markers a nested list needs; `tableRow` collects cells so
 * that a table becomes one paragraph per row with the cells' texts separated by
 * spaces rather than pipes — a pipe would be markup the source never had, and
 * the fidelity test would rightly reject it.
 */
export function regionToMarkdown(regionHtml) {
  const state = { blocks: [], current: "", listStack: [], tableRow: null };
  for (const node of parseHtml(regionHtml).children) renderNode(node, state);
  flushParagraph(state);
  return state.blocks.join("\n\n").trim();
}

function flushParagraph(state) {
  // Only the paragraph's own ends are trimmed: a line ending in two spaces is a
  // `<br />` the converter wrote, and the reader keeps that line where stripping
  // the spaces would have joined two sentences that the wiki broke apart.
  const text = state.current.trim();
  if (text !== "") state.blocks.push(text);
  state.current = "";
}

function renderNode(node, state) {
  if (node.text !== undefined) {
    state.current += escapeText(node.text);
    return;
  }
  const name = node.name;
  if (name === "br") {
    // A hard break, so the reader keeps the `<poem>` line the wiki showed.
    state.current += "  \n";
    return;
  }
  if (name === "hr") {
    flushParagraph(state);
    return;
  }
  // The remaining void elements carry no text at all — an `<img>`, a `<meta>`
  // a template left behind, a `<wbr>` break opportunity — so the article keeps
  // nothing from them and the oracle's tag-strip agrees.
  if (VOID_ELEMENTS.has(name)) return;
  if (INLINE_ELEMENTS.has(name)) {
    if (name === "b" || name === "strong") renderChildren(node, state, "**");
    else if (name === "i" || name === "em") renderChildren(node, state, "*");
    else renderChildren(node, state);
    return;
  }
  if (name === "p" || name === "div" || name === "center" || name === "blockquote"
    || name === "figure" || name === "figcaption" || name === "dl" || name === "dt" || name === "dd") {
    flushParagraph(state);
    renderChildren(node, state);
    flushParagraph(state);
    return;
  }
  const heading = /^h([1-6])$/.exec(name);
  if (heading !== null) {
    flushParagraph(state);
    const inner = inlineText(node);
    state.blocks.push(`${"#".repeat(Number(heading[1]))} ${inner.trim()}`.trimEnd());
    return;
  }
  if (name === "ul" || name === "ol") {
    flushParagraph(state);
    state.listStack.push({ ordered: name === "ol", index: 0 });
    renderChildren(node, state);
    state.listStack.pop();
    return;
  }
  if (name === "li") {
    flushParagraph(state);
    const context = state.listStack[state.listStack.length - 1] ?? { ordered: false, index: 0 };
    context.index += 1;
    const indent = "  ".repeat(Math.max(0, state.listStack.length - 1));
    const marker = context.ordered ? `${String(context.index)}.` : "-";
    state.current = `${indent}${marker} `;
    renderChildren(node, state);
    flushParagraph(state);
    return;
  }
  if (name === "table") {
    flushParagraph(state);
    renderChildren(node, state);
    return;
  }
  if (name === "tr") {
    flushParagraph(state);
    state.tableRow = [];
    renderChildren(node, state);
    const cells = state.tableRow;
    state.tableRow = null;
    if (cells.length > 0) state.blocks.push(cells.join(" "));
    return;
  }
  if (name === "td" || name === "th") {
    const cell = inlineText(node).trim();
    if (state.tableRow !== null) state.tableRow.push(cell);
    else state.blocks.push(cell);
    return;
  }
  if (name === "caption" || name === "thead" || name === "tbody" || name === "tfoot") {
    renderChildren(node, state);
    return;
  }
  throw new Error(`tales: the Wikisource markup contains a <${name}> this converter does not know.`);
}

/**
 * A subtree rendered on its own, so that an element can be wrapped (`<i>` →
 * `*…*`) or measured (a table cell) without disturbing the paragraph being
 * built.
 *
 * The result is NOT trimmed, and that is load-bearing rather than tidy: this
 * corpus has italics that end after a space — „…пита слугу: </i>Јесу ли
 * долазиле?<i> А слуга…" — and trimming inside the wrapper deletes a space the
 * source printed, which is a text change the fidelity test catches and a
 * reader would see as two sentences run together. Trimming belongs at the
 * boundaries: a paragraph's ends, a heading, a table cell.
 */
function inlineText(node) {
  const outer = { blocks: [], current: "", listStack: [], tableRow: null };
  renderChildren(node, outer);
  if (outer.blocks.length > 0) {
    return [...outer.blocks, outer.current].filter((part) => part.trim() !== "").join(" ");
  }
  return outer.current;
}

function renderChildren(node, state, wrap) {
  if (wrap === undefined) {
    for (const child of node.children) renderNode(child, state);
    return;
  }
  const inner = inlineText(node);
  // Empty emphasis would be two markers around nothing, which stripMarkup
  // would leave as nothing at all — the same as the source.
  if (inner.trim() !== "") state.current += `${wrap}${inner}${wrap}`;
}

/**
 * One page: the article's body, the oracle it has to match, and the two pieces
 * of evidence the wiki supplies — the printed source and the licence box.
 *
 * The article's title is not in the region (the parser does not repeat the page
 * title in its output) and is not compared: it comes from the page's own title,
 * which is what the table of contents is built from too.
 */
export function convertPage({ html, title }) {
  const region = contentRegion(html);
  const markdown = regionToMarkdown(region);
  if (markdown === "") throw new Error(`tales: the Wikisource page "${title}" converted to nothing.`);
  return {
    markdown,
    oracle: regionText(region),
    source: sourceSection(html),
    licence: licenceNotice(html),
  };
}
