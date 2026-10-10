// An HTML reader and a CommonMark writer for the federal pages this pack
// carries.
//
// WHY NOT A LIBRARY. The pack builder may use only Node itself, what the
// repository already has, and `pdfjs-dist`/`sharp`. A DOM library is none of
// those, and what this pack needs is narrow: read a page, keep its own words in
// their own order, and write CommonMark. The narrowness is also the safety
// property — a full HTML engine brings CSS, scripting and error recovery that
// could REORDER or DROP a sentence, and the fidelity test would then be testing
// the wrong thing.
//
// WHAT IT DOES. Tolerant parsing into a small tree (real pages have unclosed
// `<p>` and `<li>`, so a small implicit-close table keeps a paragraph from
// swallowing the rest of the document), then a Markdown emitter that writes only
// markers and never text: a heading's words, a list item's words and a table
// cell's words are the characters the page shipped.
//
// WHAT IT DOES NOT DO. No CSS, no selector engine, no inline-style reading, no
// layout. `selectMain` picks the content region by how much text it holds, which
// is the only signal available without a CSS engine and is stable across the ten
// pages this pack reads.

import { escapeInline, escapeParagraph, escapeText } from "./text.mjs";

/** Elements that never have children and are closed by the tokenizer. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/**
 * Subtrees that are not the page's words and are skipped whole.
 *
 * `script` and `style` are code. `head` is metadata — and a page's `<title>`
 * inside it is never part of an article. `svg` is a drawing, and the pack takes
 * no SVG (it can carry script). `form`, `select`, `option`, `button`, `iframe`,
 * `object`, `canvas` and `noscript` are controls or fallbacks: their text is
 * navigation or a duplicate of what JavaScript would have written, and a pack
 * that shipped nav chrome as article text would be shipping something the page
 * never said.
 */
const SKIP_SUBTREES = new Set([
  "script", "style", "head", "svg", "iframe", "object", "canvas", "noscript",
  "form", "select", "option", "button",
]);

/**
 * What must be closed before an element opens, so tolerance does not become
 * corruption. An unclosed `<p>` in a real page would otherwise make the rest of
 * the document one paragraph, and an unclosed `<td>` would merge two cells'
 * numbers into one — which, in a processing-time table, is the failure this
 * whole pack is built to avoid.
 */
const CLOSES_BEFORE = {
  p: ["p"],
  div: ["p"],
  section: ["p"],
  article: ["p"],
  ul: ["p"],
  ol: ["p"],
  table: ["p"],
  h1: ["p"], h2: ["p"], h3: ["p"], h4: ["p"], h5: ["p"], h6: ["p"],
  li: ["li", "p"],
  td: ["td", "th"],
  th: ["td", "th"],
  tr: ["tr", "td", "th"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
};

/** Named character references this pack's sources actually use, plus the Latin-1 basics. */
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ",
  thinsp: " ", shy: "", ndash: "–", mdash: "—", hellip: "…", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  laquo: "«", raquo: "»", times: "×", divide: "÷", minus: "−", deg: "°",
  frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", sup1: "¹",
  frac13: "⅓", frac23: "⅔", copy: "©", reg: "®", trade: "™", micro: "µ",
  plusmn: "±", frac18: "⅛", frac38: "⅜", frac58: "⅝", frac78: "⅞",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö",
  auml: "ä", szlig: "ß", ntilde: "ñ", iexcl: "¡", iquest: "¿", bull: "•",
  dagger: "†", not: "¬", prime: "′", Prime: "″", oline: "‾", larr: "←",
  rarr: "→", harr: "↔", infin: "∞", ge: "≥", le: "≤", ne: "≠", asymp: "≈",
};

/** Decode the character references an HTML page uses, including the numeric ones. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = ENTITIES[body];
    return named === undefined ? whole : named;
  });
}

/**
 * The page as a tree of `{ tag, attrs, children }` elements and `{ text }` leaves.
 *
 * The tokenizer reads tags by hand rather than with a regular expression,
 * because attribute values legitimately contain `>` (`<a title="a > b">`) and a
 * regex would cut the tag in half there.
 */
export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let index = 0;
  let skipDepth = 0;

  const append = (node) => {
    const parent = stack[stack.length - 1];
    if (skipDepth === 0 && parent !== undefined) parent.children.push(node);
  };

  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) {
      append({ text: decodeEntities(html.slice(index)) });
      break;
    }
    if (lt > index) append({ text: decodeEntities(html.slice(index, lt)) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    const end = html.indexOf(">", lt);
    if (end === -1) {
      append({ text: decodeEntities(html.slice(lt)) });
      break;
    }
    const raw = html.slice(lt + 1, end);
    index = end + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
        if (stack[depth].tag === name) {
          stack.length = depth;
          break;
        }
      }
      if (SKIP_SUBTREES.has(name) && skipDepth > 0) skipDepth -= 1;
      continue;
    }
    const name = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(raw)?.[0]?.toLowerCase();
    if (name === undefined) continue;
    const attrs = parseAttributes(raw.slice(name.length));
    if (SKIP_SUBTREES.has(name)) {
      // A skipped subtree is dropped whole: its own end tag is swallowed here
      // rather than in the generic close branch above.
      const voidish = VOID_ELEMENTS.has(name) || raw.trimEnd().endsWith("/");
      const inner = skipSubtree(html, index, name);
      if (!voidish) {
        skipDepth += 1;
        index = inner;
        skipDepth -= 1;
      }
      continue;
    }
    const element = { tag: name, attrs, children: [] };
    const closes = CLOSES_BEFORE[name];
    if (closes !== undefined) {
      while (stack.length > 1 && closes.includes(stack[stack.length - 1].tag)) stack.pop();
    }
    append(element);
    if (!VOID_ELEMENTS.has(name) && !raw.trimEnd().endsWith("/")) stack.push(element);
  }
  return root;
}

/** The offset just past the matching end tag of a skipped subtree. */
function skipSubtree(html, from, name) {
  const open = new RegExp(`<${name}\\b`, "gi");
  const close = new RegExp(`</${name}\\s*>`, "gi");
  let depth = 1;
  let at = from;
  while (depth > 0) {
    close.lastIndex = at;
    const closing = close.exec(html);
    if (closing === null) return html.length;
    open.lastIndex = at;
    let nested = 0;
    let opening;
    while ((opening = open.exec(html)) !== null && opening.index < closing.index) nested += 1;
    if (nested === 0) return closing.index + closing[0].length;
    depth += nested - 1;
    at = closing.index + closing[0].length;
  }
  return html.length;
}

/** `name="value"` pairs, quoted or bare, with the values decoded. */
function parseAttributes(text) {
  const attrs = {};
  const pattern = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[match[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

/** The element's own classes, as a set. */
export function classesOf(node) {
  const value = node.attrs?.class ?? "";
  return new Set(value.split(/\s+/).filter((name) => name !== ""));
}

/** Depth-first walk over the elements of a tree. */
export function elements(root, visit) {
  for (const child of root.children) {
    if (child.tag === undefined) continue;
    visit(child);
    elements(child, visit);
  }
}

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "tr", "td",
  "th", "figure", "figcaption", "blockquote", "pre", "dl", "dt", "dd", "hr", "br",
]);

/**
 * The class or id hints that name a piece of page chrome.
 *
 * These pages' navigation is a `<nav>` and their footers are `<footer>`s, which
 * the tag rule above already removes; what is left is the furniture a page puts
 * in a plain `<div>` — a menu, a share bar, a cookie notice, a language
 * switcher. Each word here has to name something a page would never call its
 * article.
 */
const CHROME_WORDS =
  /(^|[-_])(nav|menu|footer|header|banner|breadcrumb|share|social|cookie|sidebar|skip|search|subscribe|print|related|promo|alert|translations?|languages?)([-_]|$)/i;

/**
 * How short a named piece of chrome has to be; see {@link pruneChrome}.
 *
 * Measured on both sides of the line: the Ready.gov language switcher that
 * prompted the rule holds 415 characters, and the smallest article this pack
 * converts — the CDC botulism page — holds 3 442. 1 500 sits between them with
 * room to spare on each side, which is the whole requirement: a bound that
 * leaves a language list in is a cosmetic failure, and one that deletes an
 * article is a pack that says nothing.
 */
const CHROME_TEXT_LIMIT = 1500;

/**
 * Every character of text in a subtree, in document order, with a newline at
 * each block boundary so that two block elements never read as one sentence.
 * This is the fidelity test's reference for an HTML source: it is the page's own
 * text, read without any of the emitter's decisions.
 */
export function textContent(node) {
  let out = "";
  for (const child of node.children ?? []) {
    if (child.text !== undefined) {
      out += child.text;
      continue;
    }
    if (child.tag === "br" || child.tag === "hr") {
      out += "\n";
      continue;
    }
    const inner = textContent(child);
    out += BLOCK_TAGS.has(child.tag) ? `\n${inner}\n` : inner;
  }
  return out;
}

/**
 * The content region of a page.
 *
 * The rule is the one thing available without CSS: among the candidates, take
 * the element that holds the most text, where a candidate is `<main>`, an
 * element whose `role` is `main`, or any element that holds other elements.
 * Chrome — `nav`, `aside`, `footer`, and anything whose ARIA role says it is
 * navigation, a banner, a search box or a footer — is removed before scoring,
 * which is what stops a long navigation list from winning.
 *
 * There is deliberately no rule about how deep a candidate sits. One was there
 * and it was wrong in a way only a fixture showed: a cut of a page that begins
 * mid-document has the article's own container as a child of the root, so "at
 * least two levels deep" excluded the article and chose a 485-character card in
 * a section at the foot of it.
 */
export function selectMain(root) {
  const explicit = [];
  elements(root, (node) => {
    if (node.tag === "main" || node.attrs.role === "main" || node.attrs.id === "main-content") {
      explicit.push(node);
    }
  });
  const candidates = [...explicit];
  if (candidates.length === 0) {
    const walk = (node) => {
      for (const child of node.children ?? []) {
        if (child.tag === undefined) continue;
        if ((child.children ?? []).some((entry) => entry.tag !== undefined)) candidates.push(child);
        walk(child);
      }
    };
    walk(root);
  }
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = textContent(pruneChrome(candidate)).replace(/\s+/g, " ").trim().length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best === null ? root : pruneChrome(best);
}

/**
 * The subtree with its chrome removed, as a copy.
 *
 * A copy rather than a filter, because the same page is also read by
 * `textContent` for its one Source line and the two reads must not interfere.
 *
 * `nav`, `aside` and `footer` go whole. A `header` is KEPT when it is the
 * banner at the top of the page only if it is not marked as one: the federal
 * pages carry the article's own `<h1>` inside a `<header>` inside the article,
 * and dropping every header would drop the title.
 *
 * The decision is made on the ELEMENT and its ARIA role, and deliberately not
 * on class names. Matching class names looked obvious and was wrong: these pages
 * are laid out with USWDS's `l-sidebar` pattern, a wrapper class that says the
 * page's grid has a sidebar column and contains the whole article — so dropping
 * "anything whose class says sidebar" reduced the FSIS power-outage page to its
 * whitespace, and a rule that empties a page's content is worse than one that
 * leaves a menu in.
 *
 * The one thing a class name MAY decide is a SMALL container: a menu, a share
 * bar or a language switcher is a few dozen characters, and the layout wrapper
 * that a careless rule deletes is a whole article. So a named chrome hint drops
 * an element only when the element holds less than {@link CHROME_TEXT_LIMIT}
 * characters — measured on the two cases that matter, `l-sidebar` at 10 814 and
 * Ready.gov's `translations-available` at 203.
 */
export function pruneChrome(node) {
  if (node.text !== undefined) return { text: node.text };
  const name = node.tag;
  const role = node.attrs?.role;
  if (
    name === "nav" ||
    name === "aside" ||
    name === "footer" ||
    role === "navigation" ||
    role === "banner" ||
    role === "contentinfo" ||
    role === "search"
  ) {
    return { tag: name, attrs: node.attrs, children: [] };
  }
  const hint = `${node.attrs?.class ?? ""} ${node.attrs?.id ?? ""}`;
  if (hint.trim() !== "" && CHROME_WORDS.test(hint) && textContent(node).length < CHROME_TEXT_LIMIT) {
    return { tag: name, attrs: node.attrs, children: [] };
  }
  return {
    tag: name,
    attrs: node.attrs,
    children: (node.children ?? []).map(pruneChrome),
  };
}

/**
 * A subtree as CommonMark.
 *
 * The rules that matter for fidelity, spelled out, because each one is a place
 * where text could quietly disappear:
 *
 *  - `inline` never drops a text node. An element it does not know (a `<span>`,
 *    a `<sup>`, a `<time>`) contributes its children, which is the source's own
 *    words.
 *  - `img` is emitted only when the image was actually fetched into the pack
 *    (`images` holds the file names by absolute URL); otherwise the element is
 *    dropped, because an alt text is the builder's words and a dead link is
 *    worse than no link.
 *  - `a` keeps its label and absolutises its `href`; a link with no label
 *    contributes nothing, and a `#fragment` is left as a fragment of the page
 *    (the Reader opens the article, not the page).
 *  - A table is written with one row per `<tr>`, first row as the header, with
 *    `colspan` collapsed into the first spanned column — CommonMark has no
 *    spanning cell, and duplicating the text into every spanned column would
 *    put words in the pack that appear once in the source.
 */
export function toMarkdown(node, options = {}) {
  const { url = "", images = new Map() } = options;
  const blocks = [];
  const lines = [];

  const flush = () => {
    // Joined with NOTHING, not with a newline: the entries are the fragments of
    // one paragraph — loose text, a link, the full stop after it — and a real
    // line break in the source is a `<br>`, which contributes its own newline.
    // Joining with `\n` put a space between a link and the punctuation after it,
    // which is exactly how this was found on the CDC botulism page.
    const text = lines.join("").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    lines.length = 0;
    if (text !== "") blocks.push(text);
  };
  const push = (line) => lines.push(line);

  const inline = (parent) => {
    let out = "";
    for (const child of parent.children ?? []) {
      if (child.text !== undefined) {
        // Escaped at the leaf, so the markup the emitter writes around it — a
        // link's brackets, an emphasis marker — is never escaped as if it were
        // the source's own text.
        out += escapeInline(child.text);
        continue;
      }
      switch (child.tag) {
        case "br":
          out += "\n";
          break;
        case "img": {
          const src = absolute(child.attrs.src, url);
          const file = images.get(src);
          if (file !== undefined) out += `![${escapeInline(child.attrs.alt ?? "")}](${file})`;
          break;
        }
        case "a": {
          const label = inline(child).replace(/\s+/g, " ");
          const href = child.attrs.href ?? "";
          if (label.trim() === "") {
            out += label;
            break;
          }
          out += href === "" ? label : surrounded(label, "[", `](${absolute(href, url)})`);
          break;
        }
        case "strong":
        case "b": {
          out += surrounded(inline(child), "**", "**");
          break;
        }
        case "em":
        case "i": {
          out += surrounded(inline(child), "*", "*");
          break;
        }
        case "code":
        case "kbd":
        case "samp": {
          const inner = rawText(child);
          // A code span's content is literal, so it is NOT escaped — and a
          // backtick inside it is handled by widening the delimiter rather than
          // by deleting the character, which is what the first version did.
          out += surrounded(inner, inner.includes("`") ? "``" : "`", inner.includes("`") ? "``" : "`");
          break;
        }
        default:
          // A block-level element inside an inline run — a `<div>` holding a
          // heading and its text, inside an `<li>` — is a break in the source,
          // and the reference text reads it as one. Without the spaces, "Wash"
          // and the sentence after it arrived as one word on the CDC page about
          // keeping food safe.
          out += BLOCK_TAGS.has(child.tag) ? ` ${inline(child)} ` : inline(child);
      }
    }
    return out;
  };

  const block = (parent) => {
    for (const child of parent.children ?? []) {
      if (child.text !== undefined) {
        // Whitespace-only text between two links is source text — it is the
        // space in "Sources Print Share" — so it is pushed like any other. The
        // block's own trailing and leading whitespace still goes at the end.
        push(inline({ children: [child] }));
        continue;
      }
      switch (child.tag) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          const level = Math.min(6, Math.max(2, Number(child.tag[1]) + 1));
          const title = inline(child).replace(/\s+/g, " ").trim();
          if (title !== "") {
            flush();
            blocks.push(`${"#".repeat(level)} ${escapeParagraph(title)}`);
          }
          break;
        }
        case "p": {
          flush();
          const text = inline(child).trim();
          if (text !== "") blocks.push(escapeParagraph(text));
          break;
        }
        case "ul":
        case "ol": {
          flush();
          const ordered = child.tag === "ol";
          let index = 1;
          for (const item of child.children ?? []) {
            if (item.tag !== "li") continue;
            const nested = nestedLists(item);
            const text = inline(shallow(item)).trim();
            if (text !== "") blocks.push(`${ordered ? `${String(index)}.` : "-"} ${escapeParagraph(text)}`);
            index += 1;
            for (const inner of nested) blocks.push(indentBlock(toMarkdown(inner, options)));
          }
          break;
        }
        case "blockquote": {
          flush();
          const inner = toMarkdown(child, options);
          if (inner.trim() !== "") {
            blocks.push(inner.split("\n").filter((line) => line !== "").map((line) => `> ${line}`).join("\n> \n"));
          }
          break;
        }
        case "pre": {
          flush();
          const text = rawText(child).replace(/\s+$/, "");
          if (text.trim() !== "") blocks.push(`\`\`\`\n${text}\n\`\`\``);
          break;
        }
        case "table": {
          flush();
          const table = tableOf(child);
          if (table !== null) {
            blocks.push(table);
            break;
          }
          // A table with no body row cannot be a CommonMark table (it needs a
          // header and a delimiter row and at least one row under them), and
          // dropping it would drop the page's own words.
          const text = rawText(child).replace(/\s+/g, " ").trim();
          if (text !== "") blocks.push(escapeText(text));
          break;
        }
        case "figure": {
          flush();
          const caption = (child.children ?? []).find((entry) => entry.tag === "figcaption");
          const body = (child.children ?? []).filter((entry) => entry.tag !== "figcaption");
          if (body.length > 0) block({ children: body });
          if (caption !== undefined) {
            const text = inline(caption).replace(/\s+/g, " ").trim();
            if (text !== "") blocks.push(escapeParagraph(text));
          }
          break;
        }
        case "hr":
          flush();
          break;
        default: {
          const hasBlocks = (child.children ?? []).some(
            (entry) => entry.tag !== undefined && BLOCK_TAGS.has(entry.tag),
          );
          if (hasBlocks) {
            block(child);
          } else {
            // A BLOCK-level element ends the run before it: the reference text
            // puts a newline at each block boundary, so two adjacent `<div>`s
            // read as two words and not as one. The CDC pages end with a row of
            // them ("Sources", "Print", "Share") and running them together is
            // how this was found.
            if (BLOCK_TAGS.has(child.tag)) flush();
            // The element goes through `inline` AS AN ELEMENT, so a link or an
            // emphasis keeps its markup, and it is APPENDED to the run of text
            // around it rather than being pushed as a paragraph of its own: the
            // first version read `<div><a>Find out more</a>.</div>` as the bare
            // words, an empty block, and a full stop on a line by itself.
            push(inline({ children: [child] }));
          }
        }
      }
    }
  };

  block(node);
  flush();
  return `${blocks.join("\n\n")}\n`;
}

/** An element's own text, without descending into nested lists. */
function shallow(item) {
  return {
    children: (item.children ?? []).filter(
      (child) => child.tag !== "ul" && child.tag !== "ol",
    ),
  };
}

/** The nested lists directly inside a list item. */
function nestedLists(item) {
  return (item.children ?? []).filter((child) => child.tag === "ul" || child.tag === "ol");
}

/** Every line of a Markdown block, indented by two spaces, for a nested list. */
function indentBlock(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => `  ${line}`)
    .join("\n");
}

/** The text of a subtree with no markup interpretation at all. */
function rawText(node) {
  let out = "";
  for (const child of node.children ?? []) {
    out += child.text !== undefined ? child.text : rawText(child);
  }
  return out;
}

/** A `href` resolved against the page it was read from. */
export function absolute(href, base) {
  const value = href.trim();
  if (value === "" || value.startsWith("#")) return value;
  try {
    return new URL(value, base === "" ? undefined : base).href;
  } catch {
    return value;
  }
}

/** A `|` or a newline inside a TABLE CELL would break the row it sits in. */
function escapeCell(text) {
  return escapeInline(text.replace(/\s*\n\s*/g, " "));
}

/**
 * `text` between two markers, with the whitespace it carried left OUTSIDE them.
 *
 * The source's own spaces are text: `<em>Clostridium botulinum </em>and related`
 * is one space short of `Clostridium botulinumand related` without this, and the
 * fidelity check reported the missing space on the CDC botulism page the first
 * time the emitter trimmed an element's inner text to make the Markdown tidy.
 * Empty text contributes nothing at all, so an empty `<strong>` leaves no
 * markers behind.
 */
function surrounded(text, before, after) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const core = match[2];
  if (core === "") return text;
  return `${match[1]}${before}${core}${after}${match[3]}`;
}

/**
 * A `<table>` as a CommonMark table, or `null` when it holds no rows.
 *
 * `colspan` is collapsed into the first spanned column: CommonMark cannot span
 * a cell, and a `|` table written with the text repeated in every spanned
 * column would claim the source said it twice.
 */
function tableOf(table) {
  const rows = [];
  const collect = (node) => {
    for (const child of node.children ?? []) {
      if (child.tag === "tr") rows.push(child);
      else if (child.tag !== undefined) collect(child);
    }
  };
  collect(table);
  if (rows.length === 0) return null;
  const grid = rows.map((row) =>
    (row.children ?? [])
      .filter((cell) => cell.tag === "td" || cell.tag === "th")
      .map((cell) => rawText(cell).replace(/\s+/g, " ").trim()),
  );
  const width = Math.max(...grid.map((cells) => cells.length));
  const header = grid[0];
  const body = grid.slice(1);
  if (header === undefined) return null;
  if (body.length === 0) return null;
  return markdownTableFrom(header, body, width);
}

/** Pad a ragged grid to `width` columns and write it. */
function markdownTableFrom(header, rows, width) {
  const cells = (list) => {
    const out = [];
    for (let index = 0; index < width; index += 1) out.push(list[index] ?? "");
    return out;
  };
  const line = (list) => `| ${cells(list).map(escapeCell).join(" | ")} |`;
  const separator = `| ${new Array(width).fill("---").join(" | ")} |`;
  return [line(header), separator, ...rows.map(line)].join("\n");
}
