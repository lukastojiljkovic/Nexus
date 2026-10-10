// A small HTML/XHTML reader, and the only parser this pack builder has.
//
// WHY HAND-WRITTEN AND NOT A DEPENDENCY. A pack is built once, offline, by the
// maintainer, and the tooling rule for this directory is "no dependency beyond
// Node itself, what the repository already has, and the two root dev
// dependencies installed for pack builders". Nothing in the repository parses
// HTML: the desktop app does not need to (the Reader shows CommonMark), so a new
// package for it would be a dependency bought for one build script.
//
// WHAT IT IS NOT. It is not a browser and it does not pretend to be one: it
// knows the tags it needs (`html`, `head`, `script`, `style`, `table`, `p`,
// `li`, ...), it closes `<p>`, `<li>`, `<td>`, `<tr>`, `<dt>` and `<dd>`
// implicitly the way a browser does, and it leaves anything it does not
// recognise as a plain element it walks into. It never sanitises: the content
// path that renders a pack is the Reader's, and this module's whole job is to
// answer "which text is inside which element".
//
// A FIXTURE IS THE REASON IT MUST BE TESTABLE. Every article's fidelity check
// runs the converter over the real fetched bytes; this module is the half of
// that pipeline which reads them, so it is exercised by `convert.test.mjs` on
// fixtures cut from the three real sources rather than only by a full build.

/** Elements that never have children and therefore never open a stack frame. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/** Elements whose content is text, not markup, so it is copied out verbatim. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

/**
 * Elements that close an open `<p>` when they start.
 *
 * HTML allows `<p>one<p>two` and `<p>text<ul>...`, and every source here is
 * written by a different CMS or converter, so the implicit close is not an
 * edge case: archives.gov's transcriptions end a paragraph by starting the next
 * element, and a parser that waited for `</p>` would nest the rest of the
 * document inside the first paragraph.
 */
const CLOSES_PARAGRAPH = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "main", "nav", "ol", "p", "pre", "section", "table", "ul",
]);

/** Elements a like-named sibling closes, in the order a browser would. */
const CLOSED_BY_SAME_OR_ANCESTOR = {
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  tr: new Set(["tr", "td", "th"]),
  option: new Set(["option"]),
  thead: new Set(["tbody", "tfoot"]),
};

/**
 * The named entities the sources actually use, plus the ones a document about
 * law and rights reaches for. Numeric references are handled separately and do
 * not need a table.
 *
 * An unknown entity is left as it was written rather than dropped: a wrong `&`
 * in a law is a defect somebody can see, and a silently deleted one is not.
 */
const NAMED_ENTITIES = new Map(Object.entries({
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", middot: "\u00b7",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
  bdquo: "\u201e", sbquo: "\u201a", laquo: "\u00ab", raquo: "\u00bb",
  times: "\u00d7", divide: "\u00f7", minus: "\u2212", plusmn: "\u00b1",
  deg: "\u00b0", sect: "\u00a7", para: "\u00b6", dagger: "\u2020",
  bull: "\u2022", prime: "\u2032", Prime: "\u2033", euro: "\u20ac",
  pound: "\u00a3", cent: "\u00a2", yen: "\u00a5", copy: "\u00a9",
  reg: "\u00ae", trade: "\u2122", shy: "\u00ad", ensp: "\u2002",
  emsp: "\u2003", thinsp: "\u2009", frac12: "\u00bd", frac14: "\u00bc",
  frac34: "\u00be", sup2: "\u00b2", sup3: "\u00b3", ouml: "\u00f6",
  auml: "\u00e4", uuml: "\u00fc", eacute: "\u00e9", egrave: "\u00e8",
  agrave: "\u00e0", ccedil: "\u00e7", szlig: "\u00df",
}));

/** A block-level element, for the implicit-close rules and for block walkers. */
export function isBlockElement(tag) {
  return CLOSES_PARAGRAPH.has(tag) || tag === "li" || tag === "tr" || tag === "td" || tag === "th";
}

/**
 * `{ type: "root" | "element" | "text", ... }`.
 *
 * An element also carries `start` and `end`, the byte offsets of its own markup
 * in the source. Nothing in the conversion needs them; cutting a small fixture
 * out of a four-megabyte official document does, and doing it by offsets the
 * parser produced is the difference between "this fixture is the real bytes" and
 * "this fixture looks like the real bytes".
 */
function element(tag, attrs, start) {
  return { type: "element", tag, attrs, children: [], start, end: start };
}

function text(value) {
  return { type: "text", value };
}

/**
 * The attributes of a start tag, as a plain object.
 *
 * Duplicate names keep the first, which is what a browser does; values are
 * decoded because a query string inside an `href` is not the subject here and
 * `class="a&amp;b"` would otherwise never match a selector.
 */
function parseAttributes(raw) {
  const attrs = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of raw.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (Object.hasOwn(attrs, name)) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

const TAG_PATTERN = /<(\/?)([a-zA-Z][-a-zA-Z0-9:_]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;

/**
 * Removes the things that look like tags but are not, and carry nothing a
 * reader sees: a comment, a processing instruction, a doctype.
 *
 * They reach the parser inside the text between two tags rather than as a tag of
 * their own — `<!--` does not match "a `<` followed by a letter" — so they are
 * taken out of the text runs. A stylesheet's comment or a converter's banner
 * copied through as text is how a build ships a paragraph nobody wrote.
 */
function stripPunctuation(value) {
  if (!value.includes("<!" ) && !value.includes("<?")) return value;
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<![^>]*>/g, "");
}

/**
 * Reads a document into a tree.
 *
 * Comments and `<!doctype>` are dropped: neither carries document text, and a
 * comment that did would be markup the Reader must not show. Everything else
 * that this module does not understand stays in the tree as an element, so an
 * unrecognised wrapper is walked through rather than skipped over — a pack that
 * silently lost a paragraph because its CMS used `<section>` would fail the
 * fidelity check with a diff nobody could explain.
 */
export function parseHtml(source) {
  const root = { type: "root", tag: "root", attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const append = (node) => top().children.push(node);
  let cursor = 0;
  TAG_PATTERN.lastIndex = 0;

  for (;;) {
    const match = TAG_PATTERN.exec(source);
    if (match === null) break;
    const [raw, closing, rawTag, rawAttrs, selfClosing] = match;
    const tag = rawTag.toLowerCase();
    if (match.index > cursor) append(text(decodeEntities(stripPunctuation(source.slice(cursor, match.index)))));
    cursor = match.index + raw.length;

    if (closing === "/") {
      // Pop to the matching open element; an unmatched close is ignored, which
      // is what a browser does with the stray `</p>` Drupal emits.
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack[index].end = cursor;
          stack.length = index;
          break;
        }
      }
      continue;
    }

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      // The content of a `<script>` or a `<style>` is text to whoever reads the
      // file and neither to a browser nor to a pack: the element is created with
      // no children, so nothing inside it can reach a document.
      const end = new RegExp(`</${tag}\\s*>`, "i").exec(source.slice(cursor));
      cursor = end === null ? source.length : cursor + end.index + end[0].length;
      append(element(tag, parseAttributes(rawAttrs), match.index));
      continue;
    }

    if (VOID_ELEMENTS.has(tag) || selfClosing === "/") {
      const node = element(tag, parseAttributes(rawAttrs), match.index);
      node.end = cursor;
      append(node);
      continue;
    }

    if (CLOSES_PARAGRAPH.has(tag)) {
      while (top().tag === "p") {
        top().end = match.index;
        stack.pop();
      }
    }
    const closes = CLOSED_BY_SAME_OR_ANCESTOR[tag];
    if (closes !== undefined) {
      while (closes.has(top().tag)) {
        top().end = match.index;
        stack.pop();
      }
    }
    const node = element(tag, parseAttributes(rawAttrs), match.index);
    append(node);
    stack.push(node);
  }
  if (cursor < source.length) append(text(decodeEntities(stripPunctuation(source.slice(cursor)))));
  while (stack.length > 1) {
    const node = stack.pop();
    if (node.end < cursor) node.end = source.length;
  }
  return root;
}

/** `&amp;` / `&#8212;` / `&#x2014;` as the character they name. */
export function decodeEntities(value) {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES.get(body) ?? whole;
  });
}

/** The `class` attribute as a list, so a selector can ask about one member. */
export function classList(node) {
  const raw = node.attrs?.class;
  return raw === undefined ? [] : raw.split(/\s+/).filter((name) => name.length > 0);
}

/**
 * Does this element match `{ tag?, class?, id? }`?
 *
 * `class` asks whether one of the element's classes is the name given, which is
 * how every selector in `sources.mjs` is written: `field-item even` and
 * `col-md-12 col-sm-12` are the sort of pair a CMS adds on its own.
 */
export function matches(node, selector) {
  if (node.type !== "element") return false;
  if (selector.tag !== undefined && node.tag !== selector.tag) return false;
  if (selector.id !== undefined && node.attrs?.id !== selector.id) return false;
  if (selector.class !== undefined && !classList(node).includes(selector.class)) return false;
  return true;
}

/** The first element matching `selector`, depth first, or `null`. */
export function findFirst(node, selector) {
  if (matches(node, selector)) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, selector);
    if (found !== null) return found;
  }
  return null;
}

/** Every element matching `selector`, depth first, in document order. */
export function findAll(node, selector) {
  const found = [];
  const walk = (current) => {
    if (matches(current, selector)) found.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

/**
 * Removes every element matching one of `selectors`, in place, and answers how
 * many it removed.
 *
 * The removals are the source's own furniture: a CMS's "Print This Page" link,
 * a licensing box, a page's navigation. They are named one selector at a time in
 * `sources.mjs` with the reason beside them, because "the converter dropped a
 * paragraph it did not like" and "the converter dropped the site's sidebar" are
 * the same behaviour and only the second one is wanted.
 */
export function prune(node, selectors) {
  let removed = 0;
  if (node.type === "element" || node.type === "root") {
    node.children = node.children.filter((child) => {
      const hit = selectors.some((selector) => matches(child, selector));
      if (hit) removed += 1;
      return !hit;
    });
    for (const child of node.children) removed += prune(child, selectors);
  }
  return removed;
}

/**
 * Every descendant text node's value, in document order, joined with ``sep``.
 *
 * A `<br>` is a space and a block-level child is wrapped in spaces: two
 * paragraphs are two pieces of text, not one run-together word, and the
 * difference between "…the People" and "…the PeopleIn Order" is the sort of
 * defect that survives every other check in this repository.
 *
 * AN ANCHOR KEEPS ITS TEXT AND LOSES ITS TARGET, and so does everything else
 * that is not a character: the pack has no vetted external-link wrapper yet (one
 * is built after this wave's merge), so a URL inside an article would be a URL a
 * reader has to retype. The one URL an article shows is its Source line, as
 * selectable text.
 */
export function textContent(node, separator = "") {
  const parts = [];
  const walk = (current) => {
    if (current.type === "text") {
      parts.push(current.value);
      return;
    }
    // A root is a container like any other: `textContent(document)` is the
    // question the fidelity check asks before it has chosen a selector.
    if (current.type !== "element" && current.type !== "root") return;
    if (current.tag === "br") {
      parts.push(" ");
      return;
    }
    if (VOID_ELEMENTS.has(current.tag)) return;
    if (current !== node && isBlockElement(current.tag)) parts.push(" ");
    for (const child of current.children ?? []) walk(child);
    if (current !== node && isBlockElement(current.tag)) parts.push(" ");
  };
  walk(node);
  return parts.join(separator);
}
