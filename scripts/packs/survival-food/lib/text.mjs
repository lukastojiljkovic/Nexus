// Text helpers shared by the converter, the pack writer and the fidelity test.
//
// WHY THIS FILE EXISTS, AND WHY IT IS SHARED. The pack's central promise is that
// every article is the source's own words with the markup changed and nothing
// else, and the promise is kept by a test that compares the emitted Markdown's
// text with the text that was extracted from the source. That comparison is
// only worth anything if BOTH sides mean the same thing by "the text": a
// converter that stripped one set of characters and a test that stripped
// another would agree about the easy cases and disagree about exactly the
// interesting ones. So `stripMarkup` and `normalise` are defined once, here, and
// used by the converter's own verification step and by the test.

/**
 * The text of a Markdown document, with the markup characters removed.
 *
 * Deliberately conservative: it removes only characters the CONVERTER wrote and
 * never the source's own punctuation. A `|` inside a table cell, for instance,
 * arrives here as `\|` (the converter escapes it) and leaves as `|`, because
 * the source said `|` and the backslash is ours.
 *
 * Images are dropped whole, including their alt text. An alt text is written by
 * the builder — a figure's own caption belongs in the surrounding prose, which
 * the converter carries verbatim — so counting it as source text would let the
 * builder put words in the pack that no source contains.
 *
 * A fenced code block is NOT read as Markdown at all. The converter uses one
 * only where a page's own layout is the only faithful rendering of it, so its
 * lines are the page's lines — including a line that begins with `*` — and the
 * bullet rule took two characters off one on Guide 2 before this skipped them.
 */
export function stripMarkup(markdown) {
  const out = [];
  let inFence = false;
  let prose = [];
  const flush = () => {
    if (prose.length > 0) out.push(stripProse(prose.join("\n")));
    prose = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) {
      if (inFence) inFence = false;
      else {
        flush();
        inFence = true;
      }
      continue;
    }
    if (inFence) out.push(line);
    else prose.push(line);
  }
  flush();
  return out.join("\n");
}

/** The rules, over the part of a document that is not a code block. */
function stripProse(markdown) {
  // The converter escapes a character the source really contains (`\*`, `\|`,
  // `\#`), and an escape means "this is text, not markup" — so the escaped
  // characters are lifted out BEFORE the markup rules run and put back at the
  // end. Running the rules first was wrong in a way the fidelity check caught on
  // Guide 2: `\* ... \*` still read as emphasis, so stripping removed two
  // asterisks the guide had printed and reported eight characters of the page
  // missing from the article.
  //
  // Each one is replaced by a numbered placeholder for as long as the rules run,
  // and put back at the end. The alternative, splicing the document into escaped
  // and unescaped stretches, breaks every rule that SPANS an escape:
  // `**Salvaging All-Metal Cans \& Retort Pouches**` stopped being emphasis and
  // its markers survived into the comparison, and a link whose label held an
  // escaped `&` stopped being a link.
  const characters = [];
  const text = markdown.replace(/\\([\s\S])/g, (_whole, character) => {
    characters.push(character);
    return `${OPEN}${String(characters.length - 1)}${CLOSE}`;
  });
  return stripRules(text).replace(PLACEHOLDER, (_whole, index) => characters[Number(index)]);
}

/** The markup rules, over a stretch of text that holds no escapes. */
function stripRules(markdown) {
  let text = markdown;
  // Images, before links, because `![]()` contains a `[]()`.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Links: the label is source text, the target is not. The destination may hold
  // ONE level of balanced parentheses — a URL with `114(a)` in it is a real URL —
  // so the pattern is not the obvious "everything up to the first `)`".
  text = text.replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g, "$1");
  // Table separator rows (`| --- | --- |`) are ours.
  text = text.replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, "");
  // Table pipes: the leading and trailing ones are formatting, the inner ones
  // separate cells and become spaces.
  text = text.replace(/\|/g, " ");
  // Block structure: heading marks, list bullets, blockquote marks. The space
  // after a marker is a SPACE OR A TAB and never a newline: with `\s+` the rule
  // ate a whole paragraph that was nothing but `2.` — which is what several of
  // the Army cook manual's OCR pages are — together with the line break that
  // separated it from the next paragraph.
  text = text.replace(/^ {0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^ {0,3}>[ \t]?/gm, "");
  text = text.replace(/^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+/gm, "$1");
  // Emphasis, in the order that keeps `***` from leaving a stray marker.
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, "$2");
  return text;
}

/**
 * The one notion of "same text" the whole pack is checked against.
 *
 * Whitespace is not information in any of this pack's sources: the USDA PDFs
 * break a sentence at the column edge, the federal pages break it in the HTML,
 * and a Markdown file breaks it differently again. Line breaks, runs of spaces,
 * tabs and form feeds are therefore all collapsed to one space, the string is
 * trimmed, and the comparison is of what is left.
 *
 * Two normalisations come before that and they are both about characters that
 * render as nothing or as a space: NFD-then-NFC folds the PDF's decomposed
 * accents (`e` + combining acute) onto the composed letters the sources print,
 * and the four invisible-ish spaces a PDF text layer uses — no-break space,
 * narrow no-break space, thin space, zero-width space — become ordinary spaces,
 * because `1 000 ft` and `1 000 ft` with a no-break space are the same
 * instruction. Nothing else is touched: a digit is a digit and a hyphen is a
 * hyphen, which is the point, since a wrong processing time is the most
 * dangerous error this pack can carry.
 */
export function normalise(text) {
  return text
    .normalize("NFC")
    .replace(/\u00a0|\u202f|\u2009|\u200b|\ufeff/g, " ")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A kebab-case identifier from a heading, for an article or entry id. */
export function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Escape the characters a CommonMark table cell cannot hold literally.
 *
 * A cell holds one line, so a newline becomes a space; a `|` would end the
 * cell, so it is escaped. Both changes are the converter's, never the source's
 * — `stripMarkup` undoes exactly these two.
 */
export function escapeTableCell(text) {
  return escapeInline(text.replace(/\s*\n\s*/g, " "));
}

/** A CommonMark table from rows of already-plain strings, `header` first. */
export function markdownTable(header, rows) {
  const columns = header.length;
  const line = (cells) => {
    const padded = [];
    for (let index = 0; index < columns; index += 1) padded.push(escapeTableCell(cells[index] ?? ""));
    return `| ${padded.join(" | ")} |`;
  };
  const separator = `| ${new Array(columns).fill("---").join(" | ")} |`;
  return [line(header), separator, ...rows.map(line)].join("\n");
}

/** `n` spaces, for the two-space indent a nested list item takes. */
export const indent = (n) => " ".repeat(n);

/**
 * The sentinels a placeholder for an escaped character is written between.
 *
 * Private Use Area code points, chosen because no source this pack converts can
 * contain them and because they are ordinary characters to a regular expression
 * and to a diff — a control character would be neither.
 */
const OPEN = "\uE000";
const CLOSE = "\uE001";
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

/**
 * A paragraph that CommonMark will not read as something else.
 *
 * The OCR texts this pack carries are plain prose, and a line of theirs that
 * begins `1.` or `#` or `|` would become a list, a heading or a table row when
 * the article is read. The escape is the converter's own character: the build's
 * verifier and the test both strip it again before comparing, so the article's
 * text is the scan's text.
 */
export function escapeParagraph(text) {
  // Only the characters that make a BLOCK of a line, and only at its start: the
  // rest of the line has already been escaped at the leaves it was built from,
  // and escaping the assembled line would put backslashes inside the link and
  // emphasis markup the emitter wrote — which is how every CDC page's
  // `[Español](…)` turned into `\[Español\](…)` and stopped being a link.
  if (/^[#\-+>|]/.test(text)) return `\\${text}`;
  if (/^\d{1,9}[.)]\s/.test(text)) return text.replace(/^(\d{1,9})([.)])/, "$1\\$2");
  return text;
}

/**
 * The characters CommonMark reads as markup, escaped.
 *
 * A guide sentence containing `*` or `_` or a bracket would otherwise be
 * re-read as emphasis or a link when the article is rendered, and — the reason
 * the fidelity check found it — when the markup is stripped for comparison.
 */
export function escapeInline(text) {
  // `<` and `&` are here for the SCANNED manuals rather than for the guide: the
  // OCR of the Army cook manuals contains a bare `<` where a letter was
  // misread (`bring to<a boil`, `<Meat`), and a lenient renderer would read
  // those as an HTML tag or an entity. Escaped, they are the characters the scan
  // has and nothing else.
  return text.replace(/\\/g, "\\\\").replace(/([*_`[\]]|\||<|&)/g, "\\$1");
}

/**
 * A whole piece of plain text — a paragraph, a heading, a list item — read from
 * a PDF or a scan rather than built from HTML.
 *
 * The two halves are needed together and in this order: a lone `**` in the USDA
 * guide's syrup table is the guide's own footnote mark and not emphasis, and the
 * leading-character rule then keeps the first characters of a block from making
 * it a list or a heading.
 */
export function escapeText(text) {
  return escapeParagraph(escapeInline(text));
}

/**
 * A scanned book's text as blocks.
 *
 * Paragraphs are separated by a blank line, which is how the Internet Archive's
 * own text extraction writes them. Nothing else is interpreted: no heading is
 * guessed and no line is joined across the blank, because an OCR scan's idea of
 * a heading is not evidence of one.
 *
 * The head of the file is the scanner's, not the work's: three of the four scans
 * open with Google Books' digitisation notice and address marks. The builder
 * cuts each article at the work's own title page, from the `startAt` anchor the
 * source table declares — a named string, so the cut is a fact about the file
 * rather than a guess about where a notice ends. Everything from there on is
 * kept character for character, and the fidelity check compares the article with
 * exactly what this function returned.
 */
export function textToBlocks(text) {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph !== "");
  return paragraphs.map((paragraph) => ({ kind: "paragraph", text: paragraph }));
}
