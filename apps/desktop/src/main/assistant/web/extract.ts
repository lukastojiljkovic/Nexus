/**
 * HTML TO TEXT, WRITTEN HERE RATHER THAN BROUGHT IN (ADR-097).
 *
 * `web.read` has to turn a page into something a model can read, and the two
 * dependencies that do that well - `@mozilla/readability` (0.6.0, Apache-2.0)
 * plus a DOM parser to give it a document (`linkedom` 0.18.13, ISC, or `jsdom`
 * 30.1.2, MIT; versions read from the npm registry on 2026-10-10) - are a real
 * cost for the two things this feature actually needs: the visible prose, and
 * the page's title. Readability's value is deciding WHICH part of a page is the
 * article, and that decision needs a DOM, a scoring pass and a second dependency
 * to be correct; what is below is a single pass over the source that drops what
 * nobody reads and keeps what everybody does. The trade is stated rather than
 * hidden: a page whose article is buried among a sidebar, a comment thread and a
 * newsletter overlay comes out with all three, and the model is told that
 * everything it was handed is DATA from the web rather than a paragraph of the
 * answer.
 *
 * THE RULES, and each is a decision rather than a default:
 *
 *   - DROPPED ENTIRELY: `script`, `style`, `noscript`, `template`, `svg`,
 *     `head` (after the title has been read), `iframe` (it has no text of its
 *     own), `object`, `embed`, and HTML comments. A script body is not prose,
 *     and a page that ships its payload as JSON inside one should not have that
 *     JSON read into the assistant's context.
 *   - A BLOCK ELEMENT ENDS A LINE: paragraphs, headings, list items, table rows
 *     and the rest of `BLOCK_TAGS`, plus `<br>`. Inline elements (`a`, `span`,
 *     `strong`, `em`, `code`) do NOT, because their text belongs to the
 *     sentence around it.
 *   - A LIST ITEM STARTS WITH `- `, so a list survives as a list instead of
 *     becoming a run-on paragraph.
 *   - WHITESPACE IS COLLAPSED: runs of spaces, tabs and newlines become one
 *     space, each line is trimmed, and empty lines are dropped. This is what
 *     makes the output stable enough to assert exactly on a fixture, and it is
 *     why a `<pre>` block loses its own indentation.
 *   - ENTITIES ARE DECODED: the named ones in the table below, plus decimal
 *     (`&#269;`) and hexadecimal (`&#x10D;`) numeric ones, which is how
 *     Serbian letters arrive on a page written by hand. An entity this file
 *     does not know is left exactly as it was written - inventing a character
 *     for `&hellip;` is one thing, and inventing one for `&fjord;` would be a
 *     different kind of mistake.
 */

/**
 * Elements whose entire content is dropped, contents and all.
 *
 * `head` is here although `<title>` is read: the title is taken from the raw
 * source before this pass, and everything else in a `<head>` (`<meta>`,
 * `<link>`, an inline `<style>`) is either invisible or already dropped by name.
 */
const DROPPED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "iframe",
  "object",
  "embed",
  "canvas",
]);

/** Elements that end a line, whether they open or close. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "html",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "section",
  "select",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** The named character references this file decodes. Anything else is left as written. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  sbquo: "‚",
  laquo: "«",
  raquo: "»",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  middot: "·",
  bull: "•",
  sect: "§",
  para: "¶",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  minus: "−",
  ne: "\u2260",
  le: "≤",
  ge: "≥",
  larr: "\u2190",
  rarr: "→",
  harr: "↔",
};

/** `&amp;` and its kind, `&#269;` and `&#x10D;` and their kind, and nothing else. */
const ENTITY_PATTERN = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

/** One code point, or an empty string when it is not one a page may carry (a surrogate half). */
function fromCodePoint(value: number): string {
  if (value <= 0 || value > 0x10ffff) return "";
  if (value >= 0xd800 && value <= 0xdfff) return "";
  return String.fromCodePoint(value);
}

/** The named references and the numeric ones, and every unknown one left alone. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (whole, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (decimal !== undefined) {
      const decoded = fromCodePoint(Number(decimal));
      return decoded === "" ? whole : decoded;
    }
    if (hex !== undefined) {
      const decoded = fromCodePoint(Number.parseInt(hex, 16));
      return decoded === "" ? whole : decoded;
    }
    const key = (named ?? "").toLowerCase();
    const replacement = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : undefined;
    return replacement === undefined ? whole : replacement;
  });
}

/** Runs of whitespace inside a line become one space; the ends are trimmed away. */
function collapse(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

/**
 * Tags, comments and CDATA, as one token stream - the scanner this module and
 * `inlineText` share.
 *
 * A `<` that does not begin a tag (`a < b`, or an unclosed `<` at the end of a
 * truncated page) is TEXT here, not a tag, which is the forgiving direction: a
 * page that is truncated mid-tag loses the rest of the document rather than
 * losing its prose to a stripper that ate everything after the `<`.
 */
const TOKEN_PATTERN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[a-zA-Z/!][^>]*>|<|[^<]+/g;

/** The element name a tag token opens or closes, lower-cased, or `null` when it names none. */
function tagName(token: string): { readonly name: string; readonly closing: boolean } | null {
  const match = /^<(\/)?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(token);
  if (match === null) return null;
  return { name: (match[2] ?? "").toLowerCase(), closing: match[1] === "/" };
}

/**
 * The page's visible prose.
 *
 * The returned string has no leading or trailing whitespace, no empty lines and
 * no markup. The caller caps its length (`limits.ts`) and fences it as
 * untrusted data; this function neither truncates nor labels.
 */
export function extractReadable(html: string): { readonly title: string; readonly text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  // `inlineText`, not a bare decode: a title may carry markup (`<b>`, a `<span>`
  // around a matched word), and a heading is one line wherever it is read from.
  const title = titleMatch === null ? "" : inlineText(titleMatch[1] ?? "");

  const lines: string[] = [];
  let current = "";
  // The stack of dropped elements that are still open. A stack rather than a
  // flag, because `<style>` inside a dropped `<noscript>` is still inside a
  // dropped element after the inner one closes, and a flag would resume reading
  // the `<noscript>` body one tag too early.
  const droppedStack: string[] = [];

  const flush = (): void => {
    // Decode first, collapse second: `&nbsp;` and any character reference that
    // means whitespace has to count as whitespace, or a page padded with them
    // produces lines that look blank and are not.
    const line = collapse(decodeEntities(current));
    current = "";
    if (line !== "") lines.push(line);
  };

  for (const token of html.match(TOKEN_PATTERN) ?? []) {
    if (token.startsWith("<!--") || token.startsWith("<![CDATA[")) continue;
    // A lone `<` is text (`a < b`), not a truncated tag: the token stream falls
    // through to it only when no tag alternative matched.
    if (token === "<") {
      if (droppedStack.length === 0) current += token;
      continue;
    }
    if (token.startsWith("<")) {
      const tag = tagName(token);
      if (tag === null) continue;
      if (tag.closing) {
        const openIndex = droppedStack.lastIndexOf(tag.name);
        if (openIndex !== -1) {
          droppedStack.length = openIndex;
          continue;
        }
        if (BLOCK_TAGS.has(tag.name)) flush();
        continue;
      }
      if (droppedStack.length > 0) {
        if (DROPPED_TAGS.has(tag.name)) droppedStack.push(tag.name);
        continue;
      }
      if (DROPPED_TAGS.has(tag.name)) {
        flush();
        droppedStack.push(tag.name);
        continue;
      }
      if (tag.name === "li") {
        flush();
        current = "- ";
        continue;
      }
      if (tag.name === "br" || tag.name === "hr") {
        flush();
        continue;
      }
      if (BLOCK_TAGS.has(tag.name)) flush();
      continue;
    }
    if (droppedStack.length > 0) continue;
    current += token;
  }
  flush();

  return { title, text: lines.join("\n") };
}

/**
 * One line of a snippet or of a heading: tags dropped, entities decoded,
 * whitespace collapsed.
 *
 * Wikipedia's search API is why this exists: its `snippet` is HTML with the
 * matched words wrapped in `<span class="searchmatch">`, and a model reading
 * that markup would see the span and not the word.
 */
export function inlineText(html: string): string {
  let out = "";
  for (const token of html.match(TOKEN_PATTERN) ?? []) {
    if (token.startsWith("<!--") || token.startsWith("<![CDATA[")) continue;
    if (token.startsWith("<") && token !== "<") continue;
    out += token;
  }
  return collapse(decodeEntities(out));
}
