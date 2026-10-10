// No shebang, for the reason the other gates in `scripts/` have none: this
// module is both imported by `build.mjs` and driven by its own test.
//
// Project Gutenberg, converted: one plain-text ebook in, one article per tale
// out. Nothing here touches the network — `build.mjs` fetches, this module
// reads a string — so the splitter is testable on a slice of the real file.
//
// WHAT IS STRIPPED AND WHAT IS KEPT. A Gutenberg ebook is two things bound
// together: the book, and the licence-and-trademark wrapper around it. The
// licence itself says which half is which and what may be done with either —
// „If you strip the Project Gutenberg license and all references to Project
// Gutenberg from the text, you are left with a text unrestricted by U.S.
// intellectual property law", and, for anyone who keeps the name, „you may only
// distribute verbatim copies of the ebooks. No changes are allowed to the ebook
// contents. (Though reformatting the ebook to a different file format is
// considered okay)." This converter takes the first road: the wrapper is cut at
// the `*** START/END OF THE PROJECT GUTENBERG EBOOK … ***` markers, the text is
// reformatted into CommonMark — which those terms call okay — and the pack's
// provenance (`sources.json`, `docs/packs/tales.md`, the manifest's attribution)
// records the ebook number, the URL and the licence, which is where a credit
// belongs. The one thing this module refuses to do is guess: a file without the
// markers is an error, not a book whose wrapper was trimmed some other way.

import { assertFidelity, escapeText } from "./markdown.mjs";

/** The two markers that bracket a Gutenberg ebook's text. */
export const START_MARKER = /^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b.*\*\*\*\s*$/i;
export const END_MARKER = /^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b.*\*\*\*\s*$/i;

/** The contents heading, in the three shapes the five books use. */
const CONTENTS = /^\s*CONTENTS[:.]?\s*$/i;

/**
 * A heading line: the shapes a tale's title takes at the head of its text.
 *
 * Two shapes cover all five books and, just as importantly, do not cover the
 * lines *inside* a tale that would otherwise split it in two: 5314 divides
 * tales with `FIRST STORY` and 27200 with `AN OLD STORY TOLD ANEW`, and both
 * are caught here only by accident — which is the point of matching titles
 * against the contents list instead of trusting this predicate alone.
 */
function isHeadingLine(line) {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  // `1 The Frog-King` and 5314's `Legend 1 St. Joseph in the Forest`.
  if (/^(?:legend\s+)?\d{1,3}\s*[.)*]?\s+\S/i.test(trimmed)) return true;
  // All capitals, with at least three letters: `THE GOLDEN BIRD`, `A STORY`.
  return !/[a-z]/.test(trimmed) && (trimmed.match(/\p{Lu}/gu) ?? []).length >= 3;
}

/**
 * The comparison key of a line: what has to be equal for a contents entry and
 * the heading it names to be the same title.
 *
 * Case, punctuation, the edition's own numbering and the German title 5314
 * prints in brackets after each English one all go, and nothing else does. The
 * bracket-stripping is what lets „The Frog King, or Iron Henry (Der Froschkönig
 * oder der eiserne Heinrich)" match the heading „1 The Frog-King, or Iron
 * Henry", which differs in a hyphen as well — hence the punctuation fold.
 */
export function titleKey(line) {
  return line
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*(?:legend\s+)?\d{1,3}\s*[.)]?\s*/i, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The underscore pairs Gutenberg wraps round an emphasised word.
 *
 * The ebooks are not markup-free: Aesop writes `_much_ bigger`, and that pair
 * is a *typing convention of the file*, not a letter of the tale. It is a
 * bounded window (200 characters, one line) rather than a non-greedy scan to
 * the next underscore anywhere, so that one stray underscore in a 40 000-line
 * book cannot italicise four thousand words.
 */
const GUTENBERG_ITALIC = /(?<![\p{L}\p{N}_])_([^_\n]{1,200}?)_(?![\p{L}\p{N}_])/gu;

/**
 * The two private sentinels the emphasis fold writes.
 *
 * Emphasis cannot be folded to `*…*` directly, because 5314 and 27200 divide
 * their tales with a centred row of asterisks (`* * * * * * *`) and Aesop's
 * notes carry `151*`: those are the book's own characters, and a converter that
 * could not tell them from the markup it added would either italicise a
 * divider or delete one. `\u0001`/`\u0002` appear in no ebook, so the fold is
 * unambiguous, and {@link toMarkdown} turns them into `*…*` while escaping
 * every asterisk the book really printed.
 */
const ITALIC_OPEN = "\u0001";
const ITALIC_CLOSE = "\u0002";

/**
 * Gutenberg's emphasis, marked for the converter — the article's side.
 */
export function foldGutenbergMarkup(text) {
  return text.replace(GUTENBERG_ITALIC, `${ITALIC_OPEN}$1${ITALIC_CLOSE}`);
}

/**
 * The same fold with the emphasis removed — the source's side of the fidelity
 * comparison. The two must come from one pattern, or the test would compare a
 * conversion against a different reading of the same file and pass when one of
 * them was wrong.
 */
export function gutenbergSourceText(text) {
  return text.replace(GUTENBERG_ITALIC, "$1");
}

/**
 * A Gutenberg ebook without its wrapper.
 *
 * Three of the five files bracket their text with the markers and nothing
 * outside them; two (5314, 27200) also carry the 2004-era licence block, whose
 * position is *after* the end marker — which is why the cut is `slice(start +
 * 1, end)` and not a search for the word „licence". A file with no start marker
 * is refused: silently taking the whole file would put a licence block, a
 * transcriber's note and a list of illustrations into somebody's article.
 */
export function stripGutenbergWrapper(text) {
  const lines = normaliseLineEndings(text).split("\n");
  const start = lines.findIndex((line) => START_MARKER.test(line));
  const end = lines.findIndex((line) => END_MARKER.test(line));
  if (start === -1) throw new Error("tales: the file has no Gutenberg start marker.");
  if (end === -1) throw new Error("tales: the file has no Gutenberg end marker.");
  if (end <= start) throw new Error("tales: the Gutenberg end marker comes before the start marker.");
  return lines.slice(start + 1, end).join("\n");
}

/** CRLF and a byte-order mark out; nothing else. */
function normaliseLineEndings(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * The contents list, and the line each entry names in the body.
 *
 * Entries are read from the first non-blank line after `CONTENTS`, in order,
 * and each one is matched against the body by its {@link titleKey} — searching
 * forward from the heading the previous entry used, so the entries come out in
 * the order the book prints them and two entries can never claim the same
 * heading.
 *
 * WHERE THE LIST ENDS is the one thing the five books disagree about, and the
 * measured answer is two rules rather than one. Four of them indent every
 * entry, and there the block is simply the run of indented lines: the first
 * unindented line is the first tale's heading, which is also the first line
 * that *looks* like an entry. Aesop's list is not indented, and there the block
 * ends at the first two consecutive lines that match nothing in the body —
 * which on that book is the plate list's `LIST OF ILLUSTRATIONS` and `=IN
 * COLOUR=`, two lines that are neither fables nor headings of one.
 *
 * An entry that matches nothing is reported, not fatal: the alternative is a
 * build that stops on somebody else's typo — 27200's list prints „The Dumb
 * Cook" where the tale is titled „THE DUMB BOOK". What is fatal is a book whose
 * contents list is not followed by its own headings at all: then the body has
 * been misread rather than mistyped, and `splitBook` refuses it.
 */
export function readContents(lines, contentsIndex) {
  const firstLine = lines.slice(contentsIndex + 1).find((line) => line.trim() !== "");
  const indentedList = firstLine !== undefined && /^[ \t]/.test(firstLine);
  // A numbered list is matched by its numbers, which is the only key that
  // survives 5314: the list says „The Wolf and the Seven Young Kids" where the
  // heading over the tale says „The Wolf and the Seven Little Kids",
  // „Hansel and Gretel" against „Hansel and Grethel", and thirty-five more like
  // them. The numbers are the edition's own, and they agree.
  const numberedList = indentedList && headingNumber(firstLine.trim()) !== null;
  const headings = collectHeadings(lines, contentsIndex + 1);
  const headingPosition = new Map(headings.map((heading, position) => [heading.index, position]));

  // Pass one: the entries, in the order the book prints them, each one matched
  // to the first heading after the previous match. An indented list ends at the
  // first unindented line; an unindented one at the first two consecutive lines
  // that are nobody's heading.
  const candidates = [];
  const claimed = new Map();
  let searchFrom = -1;
  let failures = 0;
  for (let index = contentsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const indented = /^[ \t]/.test(line);
    if (indentedList && !indented) break;
    const candidate = {
      text: line.trim(),
      key: titleKey(line),
      number: numberedList ? headingNumber(line.trim()) : null,
    };
    // `Math.max(searchFrom, own)` and not `searchFrom`: a line the loop meets
    // in the body must not match itself, or Aesop's unindented list — whose
    // entries and whose headings are the same forty words — never ends.
    const after = Math.max(searchFrom, headingPosition.get(index) ?? -1);
    const position = headingFor(headings, candidate, after);
    if (position === -1) {
      failures += 1;
      if (!indentedList && failures >= 2) break;
      if (indentedList) candidates.push(candidate);
      continue;
    }
    failures = 0;
    claimed.set(candidates.length, position);
    candidates.push(candidate);
    searchFrom = position;
  }

  realign(candidates, headings, claimed);

  const entries = [];
  const unmatched = [];
  const duplicates = [];
  const matched = new Set();
  let ordered = true;
  for (const [index, candidate] of candidates.entries()) {
    const position = claimed.get(index);
    if (position === undefined) {
      // A contents list can print one tale twice — 2591's prints
      // „THE JUNIPER-TREE" and, lower-cased, „the juniper-tree." on the next
      // line — and the second line is not a tale the body is missing. It is
      // reported, and it is not run through the guard below, which would
      // otherwise refuse a book that splits perfectly well.
      if (matched.has(candidate.key)) duplicates.push(candidate.text);
      else unmatched.push(candidate.text);
      continue;
    }
    if (position <= (entries.at(-1)?.position ?? -1)) ordered = false;
    matched.add(candidate.key);
    entries.push({ title: headings[position].text, heading: headings[position].index, position });
  }
  if (!ordered) throw new Error("tales: the contents list does not run in the same order as the book.");
  return { entries, unmatched, duplicates };
}

/** The first unclaimed heading after `after` that this candidate could be. */
function headingFor(headings, candidate, after) {
  if (candidate.number !== null) {
    const byNumber = findHeading(headings, after, (heading) => heading.number === candidate.number);
    if (byNumber !== -1) return byNumber;
  }
  return findHeading(headings, after, (heading) => heading.key === candidate.key);
}

/**
 * Pairs an entry that matched nothing with the heading nobody claimed that
 * shares the most words with it, inside the same gap between two matched
 * neighbours.
 *
 * This is how 27200's own typo is repaired: its list prints „The Dumb Cook"
 * where the book's heading says „THE DUMB BOOK", and the two share „the" and
 * „dumb" where „AN OLD STORY TOLD ANEW" — the section title inside „Jack the
 * Dullard", which is free for the same reason — shares nothing.
 *
 * The rule is narrow on purpose. The gap bounding means an entry can only ever
 * take a heading printed between its two nearest matched neighbours; the
 * strict-best condition means a tie repairs nothing; and the two-word floor
 * means an entry cannot be matched on the word „the" alone. Without all three,
 * a typo would pull a story's *internal* title ("FIRST STORY", "AN OLD STORY
 * TOLD ANEW") out of the tale that contains it and file it as a tale of its own.
 */
function realign(candidates, headings, claimed) {
  const taken = new Set(claimed.values());
  let index = 0;
  while (index < candidates.length) {
    if (claimed.has(index)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < candidates.length && !claimed.has(end)) end += 1;
    const before = claimed.get(index - 1);
    const after = claimed.get(end);
    if (before !== undefined && after !== undefined) {
      const free = [];
      for (let position = before + 1; position < after; position += 1) {
        if (!taken.has(position)) free.push(position);
      }
      for (let candidate = index; candidate < end; candidate += 1) {
        const position = bestMatch(candidates[candidate].key, free, headings);
        if (position !== -1) {
          claimed.set(candidate, position);
          taken.add(position);
          free.splice(free.indexOf(position), 1);
        }
      }
    }
    index = end;
  }
}

/** The free heading that shares the most words with `key`, or -1. */
function bestMatch(key, free, headings) {
  const words = new Set(key.split(" ").filter((word) => word !== ""));
  let best = -1;
  let bestScore = 0;
  let tied = false;
  for (const position of free) {
    let score = 0;
    for (const word of new Set(headings[position].key.split(" "))) {
      if (words.has(word)) score += 1;
    }
    if (score > bestScore) {
      best = position;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return bestScore >= 2 && !tied ? best : -1;
}

/**
 * Every line after the contents list that could be a tale's heading: at the
 * left margin, and shaped like a title rather than like a sentence.
 *
 * A position in this list — not a line number — is what „after the previous
 * heading" compares, so two entries can never claim one heading.
 */
function collectHeadings(lines, from) {
  const headings = [];
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || /^[ \t]/.test(line)) continue;
    if (!isHeadingLine(line)) continue;
    headings.push({ index, text: line.trim(), key: titleKey(line), number: headingNumber(line.trim()) });
  }
  return headings;
}

/** The edition's own number in front of a title, or `null` when there is none. */
function headingNumber(line) {
  const match = /^(?:legend\s+)?(\d{1,3})\s*[.)*]?\s/i.exec(`${line} `);
  return match === null ? null : Number(match[1]);
}

/** The position in `headings` of the first heading after `after` that matches. */
function findHeading(headings, after, matches) {
  for (const [position, heading] of headings.entries()) {
    if (position <= after) continue;
    if (matches(heading)) return position;
  }
  return -1;
}

/**
 * One ebook, split into tales.
 *
 * `stopAt` is a list of patterns that end the *last* tale, searched forward
 * from the last heading: 2591 closes with a row of asterisks and a note on the
 * brothers, and 11339 with a list of the plates Rackham drew. A pattern rather
 * than a rule about trailing sections because the four books disagree about
 * what a trailing section is called, and an inferred cut that guessed wrong
 * would put a publisher's advertisement into a fairy tale.
 */
export function splitBook(body, { stopAt = [] } = {}) {
  const lines = body.split("\n");
  const contentsIndex = lines.findIndex((line) => CONTENTS.test(line));
  if (contentsIndex === -1) throw new Error("tales: the book has no contents list to split by.");
  const { entries, unmatched } = readContents(lines, contentsIndex);
  if (entries.length === 0) throw new Error("tales: no contents entry matched a heading in the body.");

  const boundary = (from) => {
    for (let index = from; index < lines.length; index += 1) {
      if (stopAt.some((pattern) => pattern.test(lines[index]))) return index;
    }
    return lines.length;
  };

  const articles = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const next = entries[index + 1]?.heading ?? boundary(entry.heading + 1);
    const text = lines.slice(entry.heading, next).join("\n").trim();
    if (text === "") throw new Error(`tales: the tale "${entry.title}" came out empty.`);
    articles.push({ title: entry.title, text });
  }
  assertNothingRanTogether(articles, unmatched);
  return { articles, unmatched };
}

/**
 * A split is wrong when a tale's slice swallows the *title* of a tale that
 * matched nothing.
 *
 * This is the guard that turns the failure mode this splitter actually has into
 * an error instead of a pack. It happened while this builder was written: one
 * contents entry failed to match, the next one failed too, the list was
 * declared ended, and the last article became the rest of the book — 1.3 MB of
 * Grimms filed under „Rapunzel". The fidelity test cannot see that (the text
 * really is the source's text, all of it), and no count check can be honest
 * about it, but „a heading for X is inside the article for Y" cannot be true of
 * a correct split.
 */
function assertNothingRanTogether(articles, unmatched) {
  for (const missed of unmatched) {
    const key = titleKey(missed);
    if (key === "") continue;
    for (const article of articles) {
      const swallowed = article.text.split("\n").some((line) => isHeadingLine(line) && titleKey(line) === key);
      if (swallowed) {
        throw new Error(
          `tales: "${missed}" matched no heading of its own, but a heading for it sits inside "${article.title}" — the split is wrong.`,
        );
      }
    }
  }
}

/**
 * A tale's text as CommonMark: one heading, then paragraphs.
 *
 * The blank lines between paragraphs are the only structure the plain-text
 * files carry, and the hard wrap at 72 columns is dropped — a wrapped line is
 * the file's typography, not the tale's, and CommonMark would join the lines
 * back up anyway on the way to the reader. Whitespace normalisation makes the
 * two forms compare equal in the fidelity test, so this is a readability
 * decision and not a fidelity one.
 */
export function toMarkdown(article) {
  const lines = article.text.split("\n");
  const title = lines[0].trim();
  const body = lines.slice(1).join("\n");
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) throw new Error(`tales: the tale "${article.title}" has no text.`);
  const markdown = [
    `# ${escapeText(title)}`,
    "",
    ...paragraphs.flatMap((paragraph) => [`${markdownParagraph(paragraph)}`, ""]),
  ].join("\n").trimEnd().concat("\n");
  if (markdown.includes(ITALIC_OPEN) || markdown.includes(ITALIC_CLOSE)) {
    throw new Error(`tales: the tale "${article.title}" left an emphasis sentinel in its markdown.`);
  }
  return markdown;
}

/**
 * One paragraph: the folded emphasis turned into markdown emphasis, everything
 * else escaped so that a `*` the book really printed stays a `*`.
 */
function markdownParagraph(paragraph) {
  const folded = foldGutenbergMarkup(paragraph);
  const pattern = new RegExp(`${ITALIC_OPEN}([\\s\\S]*?)${ITALIC_CLOSE}`, "g");
  let out = "";
  let cursor = 0;
  for (const match of folded.matchAll(pattern)) {
    out += escapeText(folded.slice(cursor, match.index));
    out += `*${escapeText(match[1])}*`;
    cursor = match.index + match[0].length;
  }
  return out + escapeText(folded.slice(cursor));
}

/**
 * The fidelity assertion for one article, made against the source slice.
 *
 * The heading is part of the comparison, because for these books the tale's
 * title line is a line of the source: the article's `# …` reproduces it, and an
 * article that renamed a tale would fail here.
 */
export function assertArticleFidelity(markdown, sourceText, label) {
  assertFidelity(markdown, gutenbergSourceText(sourceText), label);
}

/** A whole book, from its file's bytes to its articles' markdown. */
export function parseBook(text, { id, stopAt = [] } = {}) {
  const body = stripGutenbergWrapper(text);
  const { articles, unmatched } = splitBook(body, { stopAt });
  const converted = articles.map((article) => ({ title: article.title, markdown: toMarkdown(article) }));
  for (const article of converted) {
    const source = articles.find((candidate) => candidate.title === article.title);
    assertArticleFidelity(article.markdown, source.text, `${id ?? "book"}: ${article.title}`);
  }
  return { articles: converted, unmatched };
}
