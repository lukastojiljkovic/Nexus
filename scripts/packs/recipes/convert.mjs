// No shebang — this module is both the recipes builder's converter and its
// test's import target, like `scripts/pack-sign.mjs`.
//
// THREE SOURCES, TWO SHAPES, ONE LAYOUT.
//
//   * the Wikibooks Cookbook, whose pages are wikitext with an
//     `{{recipe summary}}` infobox, an `== Ingredients ==` bullet list and a
//     `== Procedure ==` numbered list, plus `[[Category:…]]` links;
//   * two Project Gutenberg cookbooks — Mrs Beeton's *Book of Household
//     Management* (#10136, recipes are numbered paragraphs beginning
//     `INGREDIENTS.--`) and Fannie Farmer's *Boston Cooking-School Cook Book*
//     (#65061, recipes are centred headings above an indented ingredient list);
//   * the handful of Serbian Wikibooks `Kuvar:` pages, which are wikitext again
//     and go in with `language: "sr"`.
//
// CONVERSION CHANGES MARKUP AND NOTHING ELSE. A sentence is never rewritten,
// summarised or translated; a hard-wrapped paragraph becomes one line, a
// wikitext link becomes its display text, `;`-separated ingredient groups
// become separate ingredient strings, and that is the whole of it. What this
// module can NOT do is keep a number or a word the source does not have, and it
// never adds one.
//
// WHAT IS DROPPED, AND WHY IT IS COUNTED. A record with no ingredients or no
// steps is not a recipe and is dropped — the brief asks for the count and the
// build prints it with a reason per source. Templates this converter does not
// understand are dropped too, because inventing text for `{{convert|…}}` would
// be inventing content; the build prints how many that was so the loss is
// visible rather than quiet.

/** The only layout this converter writes. A change here is a deliberate one. */
export const LAYOUT = 1;

/**
 * The two Project Gutenberg texts, named by the credit line the pack gives
 * them. Project Gutenberg's licence asks that its name and licence be stripped
 * from the text, which `stripBoilerplate` does; the credit is allowed and is
 * kept in `source.attribution`.
 */
export const GUTENBERG_BOOKS = {
  beeton: {
    title: "The Book of Household Management (Mrs Beeton)",
    url: "https://www.gutenberg.org/ebooks/10136",
  },
  farmer: {
    title: "The Boston Cooking-School Cook Book (Fannie Merritt Farmer)",
    url: "https://www.gutenberg.org/ebooks/65061",
  },
};

export const WIKIBOOKS_LICENCE = "CC BY-SA 4.0";
export const PUBLIC_DOMAIN_LICENCE = "Public domain";

/**
 * The attribution Wikibooks asks for, quoted. The Wikimedia Terms of Use give a
 * reuser a choice of ways to attribute a text page and this is the one a pack
 * can honour offline: the URL of the page, „since each article has a history
 * page that lists all contributors, authors and editors". The modification
 * notice is required too — section 3(a)(1)(B) of CC BY-SA 4.0 — and is part of
 * the same sentence.
 */
export const WIKIBOOKS_ATTRIBUTION =
  "Wikibooks. Attribution as the Wikimedia Terms of Use ask for it: \"Through hyperlink (where possible) "
  + "or URL to the article to which you contributed (since each article has a history page that lists all "
  + "contributors, authors and editors)\". Modified by Nexus: wikitext parsed into plain text, nothing rewritten.";

/** The credit line for a public-domain Gutenberg text, with its boilerplate gone. */
export function gutenbergAttribution(book) {
  return `Public-domain text. Source: Project Gutenberg, ${book.url} — the Project Gutenberg licence and `
    + "every reference to Project Gutenberg were removed from the text, as its licence requires. "
    + "Modified by Nexus: parsed into one record per recipe, nothing rewritten.";
}

/** HTML entities that appear in the two sources, and what each means. */
const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
  "&minus;": "\u2212",
  "&deg;": "\u00b0",
  "&times;": "\u00d7",
  "&frac12;": "1/2",
  "&frac14;": "1/4",
  "&frac34;": "3/4",
};

const ENTITY_PATTERN = new RegExp(Object.keys(ENTITIES).join("|"), "g");

const decodeEntities = (text) =>
  text
    .replace(ENTITY_PATTERN, (entity) => ENTITIES[entity])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

/** One run of whitespace, including the no-break spaces both sources contain. */
const collapse = (text) => text.replace(/[ \t\u00a0\u2009\u202f]+/g, " ").replace(/ *\n */g, "\n").trim();

/**
 * A balanced `{{…}}` call, from its opening braces to the matching close.
 * Returns `null` when the text has no template at the given index.
 */
function templateAt(text, index) {
  if (!text.startsWith("{{", index)) return null;
  let depth = 0;
  for (let at = index; at < text.length - 1; at += 1) {
    if (text.startsWith("{{", at)) {
      depth += 1;
      at += 1;
      continue;
    }
    if (text.startsWith("}}", at)) {
      depth -= 1;
      if (depth === 0) return { body: text.slice(index + 2, at), end: at + 2 };
      at += 1;
    }
  }
  return null;
}

/** `name|arg|arg` split at the top level, so a nested `{{…}}` stays in one piece. */
function templateParts(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at += 1) {
    if (body.startsWith("{{", at) || body.startsWith("[[", at)) {
      depth += 1;
      at += 1;
      continue;
    }
    if (body.startsWith("}}", at) || body.startsWith("]]", at)) {
      depth -= 1;
      at += 1;
      continue;
    }
    if (body[at] === "|" && depth === 0) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** `[[target]]` or `[[target|display]]` as `{ target, display }`. */
function linkParts(body) {
  const bar = body.indexOf("|");
  if (bar < 0) return { target: body, display: body };
  return { target: body.slice(0, bar), display: body.slice(bar + 1) };
}

/**
 * One wikitext link's visible text: the display half if there is one, otherwise
 * the target without its namespace (`Cookbook:Cup` shows as „Cup").
 */
function linkText(body) {
  const { target, display } = linkParts(body);
  if (display !== target) return display;
  const colon = target.indexOf(":");
  return colon < 0 ? target : target.slice(colon + 1);
}

/**
 * Wikitext to the text a reader would see, for one line or one bullet.
 *
 * `stats` counts what was thrown away, so the build can report the loss instead
 * of hiding it: `templates` for a `{{…}}` this converter does not understand,
 * `files` for an embedded image.
 */
export function toPlain(wikitext, stats = {}) {
  let text = wikitext.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref\b[^>]*\/>/g, "").replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "");

  // Media and category links carry no readable text, and their captions may
  // nest one link deep, so they are removed before the general link pass. The
  // namespace names include the Serbian and Croatian ones — a `Kuvar:` page
  // ends with `[[Категорија:…]]` and `{{DEFAULTSORT:…}}`, and a converter that
  // only knew „Category" would leave both in the last step.
  text = text.replace(
    /\[\[(?:File|Image|Category|Datoteka|Kategorija|Датотека|Категорија)\s*:[^[\]]*(?:\[\[[^\]]*\]\][^[\]]*)*\]\]/gi,
    () => {
      stats.files = (stats.files ?? 0) + 1;
      return "";
    },
  );

  text = text.replace(/\[\[([^[\]]*)\]\]/g, (_, body) => linkText(body));

  // `'''''` is both bold and italic, and has to be tried before either.
  text = text.replace(/'''''|'''|''/g, "");

  for (let guard = 0; guard < 100; guard += 1) {
    const at = text.indexOf("{{");
    if (at < 0) break;
    const call = templateAt(text, at);
    if (call === null) {
      text = text.slice(0, at) + text.slice(at + 2);
      continue;
    }
    const [name, ...args] = templateParts(call.body);
    const key = name.trim().toLowerCase();
    if (key === "frac" || key === "fraction") {
      text = text.slice(0, at) + args.map((part) => part.trim()).join("/") + text.slice(call.end);
      continue;
    }
    if (key === "nbsp" || key === "sp") {
      text = text.slice(0, at) + " " + text.slice(call.end);
      continue;
    }
    stats.templates = (stats.templates ?? 0) + 1;
    text = text.slice(0, at) + text.slice(call.end);
  }

  text = text.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1").replace(/\[https?:\/\/\S+\]/g, "");
  text = text.replace(/<[^>]+>/g, "");
  return collapse(decodeEntities(text));
}

/**
 * The `== … ==` sections of a page, the lead included under the empty heading.
 *
 * Only a LEVEL-2 heading splits. Many Cookbook pages put `=== Batter ===`,
 * `=== Filling ===` and `=== Garnish ===` under `== Ingredients ==`, and
 * splitting on those too would leave each sub-heading holding the ingredients
 * of one component and no section holding the word „Ingredients" — which is
 * exactly how four of the twenty sampled pages lost their ingredient list
 * before this was written.
 */
export function extractSections(wikitext) {
  const sections = [];
  let current = { heading: "", lines: [] };
  for (const line of wikitext.split(/\r?\n/)) {
    // The two lookarounds are what keep `=== Batter ===` from matching: a lazy
    // `(.+?)` between two `==` will happily swallow the extra `=`.
    const heading = line.match(/^==(?!=)(.*?)(?<!=)==\s*$/);
    if (heading) {
      sections.push(current);
      current = { heading: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

/**
 * The headings the two Wikibooks wikis use for the two halves of a recipe, in
 * English and in Serbian. `Kuvar:` pages write „== Potrebni sastojci ==" and
 * „== Priprema ==", and a regex that only knew the English words would drop
 * every one of them.
 */
const INGREDIENT_HEADING = /^(ingredients?|potrebni sastojci|sastojci)\b/i;
const PROCEDURE_HEADING = /^(procedure|method|directions|instructions|preparation|steps?|priprema|postupak)\b/i;

/** A yield written as a line of its own, which the Serbian pages do. */
const SERVINGS_LINE = /^\s*(?:sastojci|porcije|serves|yield|makes)\s*:\s*(.+)$/i;

/**
 * The first section whose heading matches, or `undefined`.
 *
 * „Ingredients" is matched on the word rather than the whole heading, because
 * pages add to it („Ingredients and equipment") and the word is what makes the
 * section the ingredients section.
 */
const findSection = (sections, pattern) => sections.find((section) => pattern.test(section.heading));

/** Every `*` bullet (or `#` item) in a block, as plain text. */
function listItems(lines, marker, stats) {
  const items = [];
  for (const line of lines) {
    if (!line.startsWith(marker)) continue;
    const match = line.match(/^[#*]+\s*(.*)$/);
    if (match === null) continue;
    const text = toPlain(match[1], stats);
    if (text !== "") items.push(text);
  }
  return items;
}

/**
 * Ingredient rows out of a wikitable, for the roughly 96 pages that put their
 * ingredients in one instead of a bullet list.
 *
 * Only the cell text is kept: a table's own markup (captions, header rows,
 * styling) is structure, not an ingredient.
 */
function tableCells(lines, stats) {
  const cells = [];
  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) continue;
    if (/^\s*\|[-}+]/.test(line)) continue;
    for (const cell of line.replace(/^\s*\|/, "").split("||")) {
      const text = toPlain(cell.replace(/^[!|]\s*/, ""), stats);
      if (text !== "") cells.push(text);
    }
  }
  return cells;
}

/** The `{{recipe summary}}` / `{{recipesummary}}` parameters, lower-cased keys. */
export function infoboxParams(wikitext, stats) {
  const params = new Map();
  const at = wikitext.search(/\{\{\s*recipe\s*summary|\{\{\s*recipesummary/i);
  if (at < 0) return params;
  const call = templateAt(wikitext, at);
  if (call === null) return params;
  for (const part of templateParts(call.body).slice(1)) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    params.set(part.slice(0, equals).trim().toLowerCase(), toPlain(part.slice(equals + 1), stats));
  }
  return params;
}

/** Every `[[Category:…]]` on a page, as `Category:…` titles, deduplicated. */
export function categoriesOf(wikitext) {
  const found = new Set();
  for (const match of wikitext.matchAll(/\[\[\s*Category\s*:([^|\]]+)(?:\|[^\]]*)?\]\]/gi)) {
    found.add(`Category:${match[1].trim()}`);
  }
  return [...found];
}

/**
 * `cuisine:french`, `course:dessert`, `diet:vegetarian` — the only tag kinds
 * kept, deduplicated and sorted.
 *
 * `kinds` is built by the builder from the wiki's OWN category tree (the
 * subcategories of `Category:Recipes by origin`, `… by meal or course` and
 * `… by diet`), so which category means what is the wiki's answer and not this
 * file's. A category the tree does not place is not tagged: a guess would be a
 * tag nobody can check.
 */
export function tagsFor(categories, kinds, extraCuisine = []) {
  const tags = new Set();
  const value = (title) =>
    title
      .replace(/^Category:/i, "")
      .replace(/^Recipes? (?:for|using|with)\s+/i, "")
      .replace(/\s+recipes?$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  for (const category of categories) {
    const kind = kinds.get(category);
    const text = value(category);
    if (kind !== undefined && text !== "") tags.add(`${kind}:${text}`);
  }
  for (const cuisine of extraCuisine) {
    const text = value(cuisine);
    if (text !== "") tags.add(`cuisine:${text}`);
  }
  return [...tags].sort();
}

/**
 * Letters NFKD does not decompose, because they are letters and not a base
 * letter with a mark: „ø" is not „o" plus something, „đ" is not „d" plus
 * something, and the combining-mark strip below would answer „bl-tkake" for
 * „Bløtkake". One table, written from the letters the two sources actually use.
 */
const TRANSLITERATE = new Map(Object.entries({
  ø: "o", Ø: "o", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", ß: "ss",
  đ: "d", Đ: "d", ð: "d", Ð: "d", þ: "th", Þ: "th", ł: "l", Ł: "l", ı: "i",
}));

/**
 * A stable ASCII slug for an id.
 *
 * NFKD plus the combining-mark strip turns „Bløtkake" into „blotkake" and
 * „Šopska" into „sopska", which keeps every id inside the kebab-case alphabet
 * the pack format uses; the letters themselves are still in the title, which is
 * what a reader sees.
 */
export function slugify(title) {
  return title
    .replace(/[^\p{ASCII}]/gu, (letter) => TRANSLITERATE.get(letter) ?? letter)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** The page URL for a Wikibooks title, with the spaces turned into underscores. */
export const wikibooksUrl = (host, title) => `https://${host}/wiki/${title.replace(/ /g, "_")}`;

/**
 * One Wikibooks Cookbook page into a record, or a reason it is not one.
 *
 * The record keeps the page's own title, its ingredient lines and its steps.
 * The infobox's `Yield` becomes `servings` verbatim when the page states one;
 * nothing is derived from it.
 */
export function parseWikibooksPage({ title, wikitext, host, language, kinds, stats = {} }) {
  const sections = extractSections(wikitext);
  const ingredientsSection = findSection(sections, INGREDIENT_HEADING);
  const procedureSection = findSection(sections, PROCEDURE_HEADING);
  if (ingredientsSection === undefined) return { drop: "no-ingredients-heading" };
  if (procedureSection === undefined) return { drop: "no-procedure-heading" };

  let ingredients = listItems(ingredientsSection.lines, "*", stats);
  if (ingredients.length === 0 && ingredientsSection.lines.some((line) => line.includes("{|"))) {
    ingredients = tableCells(ingredientsSection.lines, stats);
    stats.tables = (stats.tables ?? 0) + 1;
  }
    let steps = listItems(procedureSection.lines, "#", stats);
    // A few pages write their method as bullets rather than numbered steps,
    // and the Serbian ones write it as plain paragraphs, one per step.
    if (steps.length === 0) steps = listItems(procedureSection.lines, "*", stats);
    if (steps.length === 0) {
      steps = collapse(procedureSection.lines.join("\n"))
        .split(/\n\s*\n/)
        .map((paragraph) => toPlain(paragraph, stats))
        .filter((paragraph) => paragraph !== "");
    }
  if (ingredients.length === 0) return { drop: "no-ingredients" };
  if (steps.length === 0) return { drop: "no-steps" };

  const infobox = infoboxParams(wikitext, stats);
  const categories = categoriesOf(wikitext);
  const cuisine = infobox.get("cuisine");
  // The infobox's `Yield` is the yield; the Serbian pages write it as a line of
  // their own inside the ingredients section instead.
  let servings = infobox.get("yield");
  if (servings === undefined || servings === "") {
    for (const line of ingredientsSection.lines) {
      const stated = line.match(SERVINGS_LINE);
      if (stated !== null) {
        servings = toPlain(stated[1], stats).replace(/\.$/, "");
        break;
      }
    }
  }
  const recipe = {
    title: title.replace(/^[^:]+:/, ""),
    language,
    ...(servings === undefined || servings === "" ? {} : { servings }),
    ingredients,
    steps,
    tags: tagsFor(categories, kinds, cuisine === undefined || cuisine === "" ? [] : [cuisine]),
    source: {
      title,
      url: wikibooksUrl(host, title),
      licence: WIKIBOOKS_LICENCE,
      attribution: WIKIBOOKS_ATTRIBUTION,
    },
  };
  return { recipe };
}

/**
 * The Project Gutenberg plain-text wrapper removed: everything up to and
 * including the `*** START OF … ***` line, everything from `*** END OF … ***`
 * onward, and every remaining line that so much as names Project Gutenberg
 * (which is what its licence asks for, and which in both files removes nothing
 * but the wrapper — the count is printed either way).
 */
export function stripBoilerplate(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG/.test(line));
  const end = lines.findIndex((line) => /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG/.test(line));
  const body = lines.slice(start < 0 ? 0 : start + 1, end < 0 ? lines.length : end);
  const kept = body.filter((line) => !/project gutenberg/i.test(line));
  return {
    text: kept.join("\n"),
    removedLines: body.length - kept.length,
    headerLines: start + 1,
    footerLines: lines.length - end - 1,
  };
}

const BEETON_MARKER = /^\s*(\d{1,4})\.\s*INGREDIENTS\.?\s*--/;
const BEETON_MODE = /^\s*_Mode_\.?\s*(?:--)?\s*/;
const BEETON_STOP = /^\s*(?:_Time_|_Seasonable_|_Sufficient_|_Average cost_|_Note_)/;
/** Lines that annotate the recipe above them rather than name it. */
const BEETON_ANNOTATION = /^(?:\[.*\]|_?\(.*\)\.?|[IVX]{1,4}\.)$/;

/**
 * The recipes of Mrs Beeton's book.
 *
 * A recipe is a numbered paragraph that begins `INGREDIENTS.--`; its title is
 * the nearest line above it that is not an annotation (`_(A White Soup.)_`), an
 * illustration caption (`[Illustration: …]`) or a variant numeral (`I.`).
 * Ingredients run to the `_Mode_.--` marker and are split on `;`, which is how
 * the book itself groups them; the mode runs to `_Time_`/`_Seasonable_`/
 * `_Sufficient_` and each of its paragraphs is one step.
 */
export function parseBeeton(text, { title, url, licence, attribution }) {
  const lines = text.split(/\r?\n/);
  const markers = [];
  for (let at = 0; at < lines.length; at += 1) {
    const match = lines[at].match(BEETON_MARKER);
    if (match !== null) markers.push({ at, number: match[1], rest: lines[at].slice(match[0].length) });
  }

  const recipes = [];
  const dropped = new Map();
  const drop = (reason) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const limit = markers[index + 1]?.at ?? lines.length;

    let titleLine = "";
    for (let at = marker.at - 1; at >= 0 && at > marker.at - 8; at -= 1) {
      const candidate = lines[at].trim();
      if (candidate === "" || BEETON_ANNOTATION.test(candidate)) continue;
      titleLine = candidate;
      break;
    }

    // Ingredients: from the marker to the mode, or to whatever comes first.
    // The run stops at the blank line that ends the paragraph, and the mode
    // starts after it — so the blanks are stepped over before the mode is
    // looked for, which is the difference between 1 298 recipes and 2.
    let cursor = marker.at + 1;
    const ingredientLines = [marker.rest];
    while (
      cursor < limit
      && !BEETON_MODE.test(lines[cursor])
      && !BEETON_STOP.test(lines[cursor])
      && lines[cursor].trim() !== ""
    ) {
      ingredientLines.push(lines[cursor]);
      cursor += 1;
    }
    // An illustration caption may sit between the ingredients and the mode
    // (`[Illustration: LEG OF LAMB.]`), and it is neither.
    while (cursor < limit && (lines[cursor].trim() === "" || /^\s*\[.*\]\s*$/.test(lines[cursor]))) {
      cursor += 1;
    }
    // The run is hard-wrapped in the source, so its lines are joined — the
    // conversion unwraps a paragraph, which is markup, and rewrites nothing.
    const ingredientRun = collapse(ingredientLines.join(" ")).replace(/\.$/, "");
    const ingredients = ingredientRun
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "");

    // The mode: everything from `_Mode_.--` to the first `_Time_`-family line.
    let steps = [];
    let servings;
    if (cursor < limit && BEETON_MODE.test(lines[cursor])) {
      const stepLines = [lines[cursor].replace(BEETON_MODE, "")];
      cursor += 1;
      while (cursor < limit && !BEETON_STOP.test(lines[cursor])) {
        stepLines.push(lines[cursor]);
        cursor += 1;
      }
      steps = collapse(stepLines.join("\n"))
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
        .filter((paragraph) => paragraph !== "");
    }
    for (let at = cursor; at < limit; at += 1) {
      const sufficient = lines[at].match(/^\s*_Sufficient_\.?\s*--?\s*(.*)$/);
      if (sufficient !== null) {
        servings = toPlain(sufficient[1]).replace(/\.$/, "");
        break;
      }
    }

    if (titleLine === "") {
      drop("no-title");
      continue;
    }
    if (ingredients.length === 0) {
      drop("no-ingredients");
      continue;
    }
    if (steps.length === 0) {
      drop("no-steps");
      continue;
    }
    const recipe = {
      id: `beeton-${marker.number}`,
      title: toPlain(titleLine).replace(/\.$/, ""),
      language: "en",
      ...(servings === undefined || servings === "" ? {} : { servings }),
      ingredients,
      steps,
      tags: [],
      source: { title, url, licence, attribution },
    };
    recipes.push(recipe);
  }
  return { recipes, dropped };
}

/** A line the book centred: the heading of a recipe, and nothing else, is indented. */
const FARMER_CENTRE = /^ {15,}\S/;
/** An ingredient line: centred, and beginning with a quantity. */
const FARMER_QUANTITY = /^ {15,}(?:\d|[\u00bd\u00bc\u00be\u2153\u2154\u215b\u215c\u215d\u215e])\S*/;
/** A line that could not be a recipe's name — a caption, a rule, an index entry. */
const FARMER_NOT_TEXT = /^\s*(?:\[|\*|_|--|\d+$)/;
/** An ingredient list written as a numbered list rather than as bare quantities. */
const FARMER_LIST_ITEM = /^\s*\d+\.\s/;
/** The ingredient list's own indent, which is shallower than the heading's. */
const FARMER_INGREDIENT = /^ {10,}\S/;
/**
 * Where the book's recipes start and stop. Everything before Chapter I is the
 * title page, the contents and the prefaces, and everything from Chapter
 * XXXVIII on is the menus, the glossary and the index — all of them indented
 * prose that the heading test matches and none of them recipes. Both bounds are
 * the book's own headings, so they move only if the edition does.
 */
const FARMER_START = /^\s*CHAPTER\s+I\s*$/;
const FARMER_END = /^\s*CHAPTER\s+XXXVIII\b|^\s*GLOSSARY\s*$|^\s*INDEX\s*$/;

/**
 * The recipes of Fannie Farmer's book.
 *
 * The book sets a recipe as a centred heading, a blank line, an indented
 * ingredient list, a blank line, and a paragraph of method, so a heading is
 * recognised by what follows it rather than by what it says. The test on the
 * heading is the one the research run measured 1 550 recipes with: centred,
 * not a rule or a caption, not an ingredient line, not a sentence fragment
 * (it may not end in `.` or `,`), three to eight words, not all capitals (that
 * is a chapter), and followed within the next eight lines by a line that starts
 * with a quantity. The ingredients are the indented lines that follow; the
 * method is the unindented paragraphs after them, up to the next heading.
 */
export function parseFarmer(text, { title, url, licence, attribution }) {
  const whole = text.split(/\r?\n/);
  const from = whole.findIndex((line) => FARMER_START.test(line));
  const to = whole.findIndex((line) => FARMER_END.test(line));
  const lines = whole.slice(from < 0 ? 0 : from, to < 0 ? whole.length : to);
  const blank = (at) => at >= lines.length || lines[at].trim() === "";
  const isHeading = (at) => {
    const line = lines[at];
    if (!FARMER_CENTRE.test(line) || FARMER_NOT_TEXT.test(line)) return false;
    const name = line.trim();
    if (FARMER_QUANTITY.test(line) || FARMER_LIST_ITEM.test(line)) return false;
    if (name.endsWith(".") || name.endsWith(",")) return false;
    if (name.length < 3 || name.split(/\s+/).length > 8) return false;
    // `toUpperCase` alone would call a line of punctuation capitals.
    if (/[a-z]/i.test(name) && name === name.toUpperCase()) return false;
    return lines.slice(at + 1, at + 9).some((candidate) => FARMER_QUANTITY.test(candidate));
  };

  const recipes = [];
  const dropped = new Map();
  const drop = (reason) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
  let at = 0;
  while (at < lines.length) {
    if (!isHeading(at)) {
      at += 1;
      continue;
    }
    // The ingredient list: the indented lines that follow the heading, found
    // inside the same eight-line window the heading test looked at.
    let cursor = at + 1;
    while (cursor < lines.length && blank(cursor)) cursor += 1;
    const ingredientStart = cursor;
    // Deliberately NOT stopped at a line that also passes the heading test:
    // „Sugar", „Ice" and „A few grains salt" all pass it and are ingredients.
    // The blank line that ends the list is what ends it.
    while (cursor < lines.length && FARMER_INGREDIENT.test(lines[cursor])) cursor += 1;
    const ingredients = lines
      .slice(ingredientStart, cursor)
      .map((line) => toPlain(line.trim()))
      .filter((line) => line !== "");

    // The method: unindented paragraphs until the next heading.
    const steps = [];
    let scan = cursor;
    while (scan < lines.length) {
      while (blank(scan) && scan < lines.length) scan += 1;
      const paragraphStart = scan;
      while (scan < lines.length && lines[scan].trim() !== "" && !FARMER_INGREDIENT.test(lines[scan])) scan += 1;
      const paragraph = lines.slice(paragraphStart, scan).join(" ");
      if (paragraph.trim() === "") break;
      const step = toPlain(paragraph);
      if (step === "") break;
      // A short, unindented, title-shaped line is the next recipe, not a step.
      if (steps.length > 0 && step.length < 60 && !step.endsWith(".")) break;
      steps.push(step);
      if (steps.length >= 12 || scan >= lines.length) break;
      if (FARMER_INGREDIENT.test(lines[scan])) break;
    }

    const heading = toPlain(lines[at].trim());
    if (ingredients.length === 0) drop("no-ingredients");
    else if (steps.length === 0) drop("no-steps");
    else {
      recipes.push({
        title: heading,
        language: "en",
        ingredients,
        steps,
        tags: [],
        source: { title, url, licence, attribution },
      });
    }
    at = Math.max(cursor, at + 1);
  }
  return { recipes, dropped };
}
