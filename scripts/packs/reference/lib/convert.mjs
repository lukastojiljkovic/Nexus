// Document text into a pack article, and the proof that nothing was lost.
//
// THE ONE RULE THIS FILE EXISTS FOR. A pack's text is the source's own text,
// verbatim; conversion changes markup and nothing else. So every step here is
// split in two: a *selector* decides which part of a fetched page is the
// document (and which part is the site around it), and a *converter* turns that
// part's structure into CommonMark. The fidelity check at the bottom of this
// file compares the two halves of one article back to back — the CommonMark with
// its markup stripped, against the same region's text — and it is run over every
// article by the build and over the fixtures by `fidelity.test.mjs`.
//
// WHY THE CHECK CAN FAIL AT ALL. A converter that emitted everything would
// trivially pass; a converter that dropped a paragraph, reordered two clauses or
// "improved" a sentence would not. That is the whole value: the difference
// between the two strings is exactly the difference between the source and what
// the pack ships.

import { classList, findAll, findFirst, parseHtml, prune, textContent } from "./html.mjs";

/** The characters a Markdown reader would treat as markup, so text escapes them. */
const MARKDOWN_SPECIAL = /[\\`*_[\]<>|]/g;

/**
 * The block shapes a conversion produces.
 *
 * `heading`, `para`, `list` and `table` are the four the brief names (headings,
 * lists, tables, figures); nothing else is emitted, because everything else
 * would be a decision about the text rather than about its markup.
 */

/** Whitespace, soft hyphens and thin spaces, as one canonical form. */
export function normalizeText(value) {
  return value
    .replace(/\u00ad/g, "")
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/[\t\r\n\f\v]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function isContainerTag(tag) {
  return [
    "div", "section", "article", "main", "header", "footer", "aside", "figure",
    "figcaption", "dl", "form", "fieldset", "nav", "details", "summary", "html",
    "body", "tbody", "thead", "tfoot", "tr", "td", "th", "caption", "colgroup",
    "blockquote", "noscript", "center", "font",
  ].includes(tag);
}

function isInlineTag(tag) {
  return [
    "span", "a", "em", "strong", "b", "i", "u", "s", "small", "sub", "sup",
    "code", "kbd", "abbr", "cite", "q", "time", "mark", "time", "dfn", "big",
    "tt", "ins", "del", "ruby", "rt", "rp", "wbr", "img",
  ].includes(tag);
}

/**
 * Blocks from an element's children, in document order.
 *
 * `headingClasses` maps a class name to a heading level, which is how a source
 * that marks its structure with CSS rather than with `<h*>` is read: the EU
 * publication office prints `PART ONE` in `<p class="ti-section-1">`, the
 * Constitutional Court of Serbia prints `Члан 1.` in `<div class="text-center">`,
 * and neither is a heading to any parser but this one.
 */
export function blocksFromElement(root, options = {}) {
  const headingClasses = options.headingClasses ?? {};
  const blocks = [];
  // The class that produced a heading level is kept on the block: a document
  // split at `ti-section-1` must not also split at `ti-tbl`, which maps to the
  // same level and is the table of contents.
  const levelFor = (node) => {
    if (/^h[1-6]$/.test(node.tag)) return { level: Number.parseInt(node.tag.slice(1), 10), marker: null };
    for (const name of classList(node)) {
      if (Object.hasOwn(headingClasses, name)) return { level: headingClasses[name], marker: name };
    }
    return { level: 0, marker: null };
  };

  const emit = (block) => {
    if ((block.kind === "para" || block.kind === "heading") && normalizeText(block.text).length === 0) return;
    blocks.push(block);
  };

  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.type === "text") {
        emit({ kind: "para", text: child.value });
        continue;
      }
      if (child.type !== "element") continue;
      const { level, marker } = levelFor(child);
      if (level > 0) {
        emit({
          kind: "heading",
          level: Math.min(level, 6),
          text: normalizeText(textContent(child)),
          marker,
        });
        continue;
      }
      if (child.tag === "p" || child.tag === "pre" || child.tag === "address" || child.tag === "dt" || child.tag === "dd" || child.tag === "figcaption" || child.tag === "summary") {
        emit({ kind: "para", text: normalizeText(textContent(child)) });
        continue;
      }
      if (child.tag === "ul" || child.tag === "ol") {
        const items = [];
        for (const item of findAll(child, { tag: "li" })) {
          items.push({ text: normalizeText(textContent(item)), depth: 0 });
        }
        if (items.length > 0) blocks.push({ kind: "list", ordered: child.tag === "ol", items });
        continue;
      }
      if (child.tag === "table") {
        const rows = [];
        for (const row of findAll(child, { tag: "tr" })) {
          const cells = (row.children ?? [])
            .filter((cell) => cell.type === "element" && (cell.tag === "td" || cell.tag === "th"))
            .map((cell) => normalizeText(textContent(cell)));
          if (cells.some((cell) => cell.length > 0)) rows.push(cells);
        }
        if (rows.length > 0) blocks.push({ kind: "table", rows });
        continue;
      }
      if (child.tag === "br" || child.tag === "hr" || child.tag === "col" || child.tag === "colgroup") continue;
      if (isContainerTag(child)) {
        walk(child);
        continue;
      }
      if (isInlineTag(child)) {
        emit({ kind: "para", text: normalizeText(textContent(child)) });
        continue;
      }
      walk(child);
    }
  };

  walk(root);
  return blocks;
}

/**
 * Blocks from hard-wrapped plain text, which is what a text-layer PDF gives.
 *
 * PDF text arrives line by line as the page laid it out, so the paragraph is not
 * in the bytes and has to be recovered. Two joins matter and both are about the
 * source, not about taste: a line that ends in a soft hyphen was broken inside a
 * word when the page was set, so the halves are joined with nothing between
 * them, and every other break becomes a space. A "Члан 7." line is the law's own
 * article marker and becomes a heading; so does an all-capitals line, which is
 * how these acts print a section name.
 */
export function blocksFromLines(lines) {
  const blocks = [];
  let buffer = "";
  const flush = () => {
    const text = normalizeText(buffer);
    if (text.length > 0) blocks.push({ kind: "para", text });
    buffer = "";
  };
  const articleMarker = /^(Član|Clan|Члан|ČLAN|ЧЛАН)\s+[0-9]+[a-z\u0430-\u045f]?\.$/;
  const isAllCaps = (line) => {
    const letters = line.replace(/[^\p{L}]/gu, "");
    return letters.length > 3 && letters.length < 70 && letters === letters.toUpperCase();
  };
  // A section title in these acts is a short standalone line that ends without a
  // full stop and is followed by an article marker, a blank line or a heading in
  // capitals ("Социјална заштита" / "Члан 2."). The lookahead is what keeps the
  // rule from firing on an ordinary short line: a paragraph's own line breaks
  // land mid-sentence and are followed by more of the sentence.
  const isSectionTitle = (line, next) =>
    line.length <= 60 &&
    !/[.,;:!?]$/.test(line) &&
    (articleMarker.test(next) || next.length === 0 || isAllCaps(next));

  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    const next = (lines[index + 1] ?? "").trim();
    if (trimmed.length === 0) {
      flush();
      continue;
    }
    if (articleMarker.test(trimmed)) {
      flush();
      blocks.push({ kind: "heading", level: 4, text: trimmed });
      continue;
    }
    if (isAllCaps(trimmed) || isSectionTitle(trimmed, next)) {
      flush();
      blocks.push({ kind: "heading", level: 3, text: trimmed });
      continue;
    }
    if (buffer.length === 0) {
      buffer = line;
      continue;
    }
    buffer += buffer.endsWith("\u00ad") ? line : ` ${line}`;
  }
  flush();
  return blocks;
}

/** One block's text, for the fidelity comparison and for a title. */
export function blockText(block) {
  if (block.kind === "heading" || block.kind === "para") return normalizeText(block.text);
  if (block.kind === "list") return block.items.map((item) => normalizeText(item.text)).join(" ");
  if (block.kind === "table") return block.rows.map((row) => row.join(" ")).join(" ");
  return "";
}

/** The blocks' text as one string: what the fidelity check compares against. */
export function blocksToText(blocks) {
  return blocks.map((block) => blockText(block)).filter((text) => text.length > 0).join(" ");
}

/**
 * Escapes the characters a Markdown reader would otherwise read as markup.
 *
 * This is what makes the fidelity check meaningful rather than circular: the
 * converter escapes rather than deletes, so `*` in a law's text survives as
 * `\*`, and the strip below removes exactly the escapes and markers this file
 * wrote.
 */
export function escapeText(value) {
  return value
    .replace(MARKDOWN_SPECIAL, (character) => `\\${character}`)
    .replace(/^(\s*)([#>+\-=])/, (_whole, indent, character) => `${indent}\\${character}`)
    .replace(/^(\s*)(\d+)\./, (_whole, indent, digits) => `${indent}${digits}\\.`);
}

/** Escapes a table cell: pipes separate cells, and a cell's own pipe is text. */
function escapeCell(value) {
  return escapeText(value).replace(/\|/g, "\\|");
}

/**
 * Blocks as CommonMark: the only writer in this builder.
 *
 * ADJACENT TABLES OF ONE WIDTH ARE ONE TABLE. The Official Journal prints a
 * table of contents as one `<table>` per row, so a faithful block walker sees
 * forty tables where a reader sees one. Joining them changes no text and no
 * cells; it removes thirty-nine separator rows and one has to look at the result
 * to believe how much of a legal text was separator rows. Two tables of
 * different widths stay two tables, because that is the source saying they are
 * different.
 */
export function toMarkdown(blocks) {
  const merged = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (
      block.kind === "table" &&
      previous?.kind === "table" &&
      previous.rows[0].length === block.rows[0].length
    ) {
      previous.rows = [...previous.rows, ...block.rows];
      continue;
    }
    merged.push(block.kind === "table" ? { kind: "table", rows: [...block.rows] } : block);
  }
  const parts = [];
  for (const block of merged) {
    if (block.kind === "heading") {
      parts.push(`${"#".repeat(block.level)} ${escapeText(block.text)}`);
      continue;
    }
    if (block.kind === "para") {
      parts.push(escapeText(block.text));
      continue;
    }
    if (block.kind === "list") {
      parts.push(block.items
        .map((item, index) => {
          const marker = block.ordered ? `${index + 1}.` : "-";
          return `${"  ".repeat(item.depth)}${marker} ${escapeText(item.text)}`;
        })
        .join("\n"));
      continue;
    }
    if (block.kind === "table") {
      const width = Math.max(...block.rows.map((row) => row.length));
      const lines = block.rows.map((row) => {
        const cells = [...row];
        while (cells.length < width) cells.push("");
        return `| ${cells.map(escapeCell).join(" | ")} |`;
      });
      lines.splice(1, 0, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
      parts.push(lines.join("\n"));
    }
  }
  return parts.join("\n\n");
}

/**
 * The inverse of {@link toMarkdown} for the shapes it writes, and nothing else.
 *
 * It removes: heading markers, list markers, blockquote markers, table pipes and
 * the separator row, and the backslash this file puts in front of a character
 * that would otherwise be markup. What is left is the source's text, which is
 * the point — a converter that dropped a word has no way to put it back here.
 */
export function stripMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (/^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line)) continue;
    kept.push(line
      .replace(/^\s*#+\s+/, "")
      .replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1")
      .replace(/^\s*>\s?/, ""));
  }
  // An ESCAPED PIPE IS A CHARACTER AND A BARE ONE IS A CELL BORDER, so the
  // escaped ones are lifted out before the borders are turned into spaces and
  // put back afterwards. Without this a sentence that contains `|` would be one
  // character shorter in the article than in the source, and the fidelity check
  // would report a diff at a place where the text looks identical.
  const PIPE = "\u0000";
  return kept
    .join(" ")
    .replace(/\\\|/g, PIPE)
    .replace(/\|/g, " ")
    .replace(/\\([\\`*_[\]<>|#+=.-])/g, "$1")
    .replace(new RegExp(PIPE, "g"), "|")
    .replace(/ {2,}/g, " ");
}

/**
 * The Markdown readers of one document, from fetched bytes.
 *
 * `document` is one entry of a pack's source table. Two shapes are read: HTML
 * (and XHTML, which is HTML with a stricter author) and plain text from a PDF's
 * text layer. A source whose bytes are its own document — the EU publication
 * office's OJ files, a Wikisource parse — names the container to start from;
 * a source whose document is one element of a page around it says so too.
 */
export function convertDocument(document, bytes, { linesOfPdf }) {
  if (document.kind === "pdf" || document.kind === "text") {
    // A PDF's text layer and a text file are the same input once the bytes are
    // decoded: hard-wrapped lines with no markup. The gazette fixture is the
    // text a PDF gave, so the test drives the same path the builder does without
    // putting a scanned act in the repository.
    const lines = document.kind === "text"
      ? new TextDecoder("utf-8").decode(bytes).split(/\r?\n/)
      : linesOfPdf(bytes);
    if (lines.every((line) => normalizeText(line).length === 0)) {
      // No text layer: a scan. Shipping it would mean shipping an empty act.
      throw new Error(`${document.id}: the PDF has no text layer (a scan is not a source this builder can take)`);
    }
    return { sections: splitBlocks(blocksFromLines(lines), document), container: null, lines };
  }
  const raw = new TextDecoder("utf-8").decode(bytes);
  const source = document.kind === "wikisource-parse" ? JSON.parse(raw).parse.text : raw;
  const tree = parseHtml(source);
  const container = document.container === undefined || document.container === null
    ? tree
    : findFirst(tree, document.container);
  if (container === null) {
    throw new Error(`${document.id}: container not found in ${document.url}`);
  }
  // Two removals, and they are different questions. `NEVER_CONTENT` is what no
  // document contains in any page: script, style, the page's `<head>`. The
  // document's own `prune` list is the site around THIS document — a "Print This
  // Page" link, a licence box, an OJ page header — and it is checked for having
  // matched something, because a selector that quietly matches nothing is how a
  // redesigned page gets its navigation into a pack.
  prune(container, NEVER_CONTENT);
  const selectors = document.prune ?? [];
  if (selectors.length > 0 && prune(container, selectors) === 0) {
    throw new Error(`${document.id}: none of the ${selectors.length} prune selectors matched`);
  }
  if (document.startAt !== undefined || document.endAt !== undefined) {
    trimDocument(container, document);
  }
  const sections = splitBlocks(blocksFromElement(container, { headingClasses: document.headingClasses }), document);
  return { sections, container, lines: null };
}

/**
 * Elements that are never a document, on any page, in any CMS.
 *
 * This list is short on purpose and holds only things a browser would not show:
 * a `script`'s source, a stylesheet, a `<head>`. Everything else a page carries
 * that is not the document — a navigation bar, a licence box — is named per
 * source, because "the converter decided not to bother with this element" and
 * "this element is the site" are different statements and only one of them is
 * true at a time.
 */
const NEVER_CONTENT = [
  { tag: "script" },
  { tag: "style" },
  { tag: "link" },
  { tag: "head" },
  { tag: "meta" },
  { tag: "title" },
  { tag: "base" },
  { tag: "noscript" },
  { tag: "template" },
  { tag: "svg" },
  { tag: "iframe" },
  // Wikisource's own "[edit]" link beside every heading, which is the wiki, not
  // the work the wiki transcribed.
  { class: "mw-editsection" },
];

/**
 * Cuts a page's furniture off the top and the bottom by the text it prints.
 *
 * WHY BY TEXT. Some sources have no element to point at: the UN's page about the
 * Universal Declaration opens with the UN's own introduction in the same
 * `div.article-body` as the Declaration, and its Charter page closes with a note
 * on amendments that the UN wrote and the Charter did not. A class would be a
 * guess about somebody else's markup; the first words of the document are not.
 *
 * `startAt` keeps the element that begins with the marker and drops what came
 * before it; `endAt` drops the element that begins with it and everything after.
 * Both are checked for having found something, for the reason the prune list is.
 */
export function trimDocument(container, document) {
  const flat = [];
  const parents = new Map();
  const depth = new Map();
  const collect = (node, level) => {
    for (const child of node.children ?? []) {
      if (child.type !== "element") continue;
      flat.push(child);
      parents.set(child, node);
      depth.set(child, level);
      collect(child, level + 1);
    }
  };
  collect(container, 0);

  const deepestMatch = (marker) => {
    const candidates = flat.filter((element) => normalizeText(textContent(element)).startsWith(marker));
    if (candidates.length === 0) return null;
    return candidates.reduce((best, candidate) => (depth.get(candidate) > depth.get(best) ? candidate : best));
  };
  const lastMatch = (marker) => {
    const candidates = flat.filter((element) => normalizeText(textContent(element)).startsWith(marker));
    return candidates.length === 0 ? null : candidates[candidates.length - 1];
  };

  let keepFrom = 0;
  let keepTo = flat.length - 1;
  if (document.startAt !== undefined) {
    const marker = deepestMatch(document.startAt);
    if (marker === null) throw new Error(`${document.id}: startAt "${document.startAt}" not found`);
    keepFrom = flat.indexOf(marker);
  }
  if (document.endAt !== undefined) {
    const marker = lastMatch(document.endAt);
    if (marker === null) throw new Error(`${document.id}: endAt "${document.endAt}" not found`);
    keepTo = flat.indexOf(marker) - 1;
  }

  const kept = new Set();
  for (const element of flat.slice(keepFrom, keepTo + 1)) kept.add(element);
  // The element a `startAt` marker names is content and so is everything that
  // contains it; the element an `endAt` marker names is not, and neither is
  // anything after it. That difference is why the second chain starts at the
  // marker's parent.
  for (const marker of [flat[keepFrom], parents.get(flat[keepTo + 1])]) {
    for (let node = marker; node !== undefined && node !== container; node = parents.get(node)) kept.add(node);
  }
  for (const element of flat) {
    if (kept.has(element)) continue;
    const parent = parents.get(element);
    parent.children = parent.children.filter((child) => child !== element);
  }
  return container;
}

/**
 * One document's blocks, split into sections when the source says where.
 *
 * `splitOn` names a class whose elements begin a new section — the EU's
 * `ti-section-1`, which is how one OJ file becomes "PART ONE", "TITLE I", … as
 * a table of contents rather than one four-hundred-kilobyte page. Everything
 * before the first such element is the document's front matter, and keeps its
 * own section so the table of contents the OJ prints is still in the pack.
 *
 * The title of a section is the section marker plus, when the source prints one,
 * the name beside it (`PART ONE` + `PRINCIPLES`), which is what the OJ's own
 * table of contents does.
 */
export function splitBlocks(blocks, document) {
  if (document.splitOn === undefined) {
    return [{ title: document.section ?? document.title, blocks }];
  }
  const sections = [];
  // The front matter is not a named section: the OJ prints the document's title
  // and its table of contents before the first PART, and neither is the name of
  // a section, so the heading that opens the document must not be folded into a
  // title.
  let current = { title: document.frontMatterTitle ?? "Table of contents", blocks: [], named: true };
  for (const block of blocks) {
    if (block.kind === "heading" && block.marker === document.splitOn) {
      if (current.blocks.length > 0) sections.push(current);
      current = { title: block.text, blocks: [], named: false };
      continue;
    }
    // A section marker's name is the heading that immediately follows it — and
    // the heading stays in the section, because the title is the pack's
    // navigation and the body is the document: a piece of the source that only
    // ever appeared in a table of contents would be a piece the fidelity check
    // could not find in the article.
    if (current.named === false && current.blocks.length === 0 && block.kind === "heading") {
      current.title = `${current.title} ${block.text}`;
      current.named = true;
    }
    current.named = true;
    current.blocks.push(block);
  }
  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

/**
 * Every paragraph-sized element of the selected region still has to be in the
 * article.
 *
 * {@link assertFidelity} compares an article against the blocks it was written
 * from, which proves the writer loses nothing and says nothing about the walker
 * that produced those blocks. This is the other direction, and it is deliberately
 * the crudest thing in the file: the text of each `<p>`, heading, list item and
 * table cell of the region, read by a flat walker rather than by the block
 * walker, must appear in the finished article. A paragraph dropped by a
 * selector, a heading skipped by a class map, a cell list that stopped short —
 * each of those is a chunk that exists in the region and not in the article.
 *
 * Chunks shorter than {@link MINIMUM_CHUNK} characters are skipped: a page
 * number in a cell or a running header is not evidence of anything, and
 * requiring every three-letter fragment to appear would make a legal text's
 * layout the master of the check.
 */
const MINIMUM_CHUNK = 32;

export function missingChunks(root, articleText) {
  const haystack = normalizeText(articleText);
  const missing = [];
  for (const selector of [{ tag: "p" }, { tag: "h1" }, { tag: "h2" }, { tag: "h3" }, { tag: "h4" }, { tag: "h5" }, { tag: "h6" }, { tag: "li" }, { tag: "td" }, { tag: "th" }]) {
    for (const element of findAll(root, selector)) {
      const chunk = normalizeText(textContent(element));
      if (chunk.length < MINIMUM_CHUNK) continue;
      if (!haystack.includes(chunk)) missing.push(chunk);
    }
  }
  return missing;
}

/**
 * The check the whole builder rests on.
 *
 * The CommonMark an article carries, with its markup stripped and its whitespace
 * normalised, must equal the text of the source section the article came from,
 * normalised the same way. Any difference is a failure and the build stops: the
 * message names the first character that differs, because "a paragraph is
 * missing" is not something a maintainer can act on and "the text differs at
 * character 4120" is.
 */
export function fidelityDifference(sourceText, markdown) {
  const fromMarkdown = normalizeText(stripMarkdown(markdown));
  const fromSource = normalizeText(sourceText);
  if (fromMarkdown === fromSource) return null;
  let at = 0;
  while (at < fromMarkdown.length && at < fromSource.length && fromMarkdown[at] === fromSource[at]) at += 1;
  return {
    at,
    markdown: fromMarkdown.slice(Math.max(0, at - 60), at + 60),
    source: fromSource.slice(Math.max(0, at - 60), at + 60),
    markdownLength: fromMarkdown.length,
    sourceLength: fromSource.length,
  };
}

export function assertFidelity(name, sourceText, markdown) {
  const difference = fidelityDifference(sourceText, markdown);
  if (difference === null) return;
  throw new Error(
    `${name}: the converted text differs from the source at character ${difference.at} ` +
    `(article ${difference.markdownLength} chars, source ${difference.sourceLength} chars)\n` +
    `  article: …${difference.markdown}…\n  source:  …${difference.source}…`,
  );
}

/** Deterministic ids: kebab-case, ASCII, and a transliteration for Serbian. */
const TRANSLITERATION = new Map(Object.entries({
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i",
  ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r",
  с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
  ѕ: "dz", ѐ: "e", ѝ: "i",
}));

export function slug(value) {
  const folded = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đ]/g, "dj")
    .replace(/[\u0430-\u045f]/g, (character) => TRANSLITERATION.get(character) ?? "");
  return folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
