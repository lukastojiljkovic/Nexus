// The text normaliser the three converters share: whitespace, the compositor's
// hyphen, and the two keys a pack's structure is addressed by.
//
// These are the helpers that must NOT differ between the converters, because a
// difference here is exactly the half-word the fidelity test cannot see: if one
// side collapses a no-break space and the other does not, both sides are
// "correct" and the article a person reads is not the source's.

/**
 * One space between words, no leading or trailing space.
 *
 * Every comparison in this builder — the fidelity test, the heading keys, a
 * source's own licence sentence — is made on this form, so a line break in a
 * PDF's text layer or a run of spaces in a scan's OCR cannot be mistaken for a
 * difference in what the source says.
 */
export function collapse(text) {
  return text.replace(/[\s\u00a0\u2007\u202f]+/g, " ").trim();
}

/**
 * The named character references the pack's sources actually use, plus every
 * numeric one.
 *
 * Shared by the HTML and the wikitext converters because it is a statement about
 * character ENCODING rather than about either format: an entity is one character
 * however it was written, and a table of them that disagreed between the two
 * would be a difference in the text a person reads. An entity the table does not
 * know is left exactly as it was written, in the converter and in the oracle
 * alike: inventing a character would be this builder editing the source.
 */
export const ENTITIES = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"],
  ["nbsp", "\u00a0"], ["mdash", "\u2014"], ["ndash", "\u2013"], ["hellip", "\u2026"],
  ["lsquo", "\u2018"], ["rsquo", "\u2019"], ["ldquo", "\u201c"], ["rdquo", "\u201d"],
  ["copy", "\u00a9"], ["times", "\u00d7"], ["deg", "\u00b0"], ["frac12", "\u00bd"],
  ["frac14", "\u00bc"], ["frac34", "\u00be"], ["eacute", "\u00e9"], ["egrave", "\u00e8"],
  ["agrave", "\u00e0"], ["ccedil", "\u00e7"], ["uuml", "\u00fc"], ["ouml", "\u00f6"],
  ["auml", "\u00e4"], ["szlig", "\u00df"], ["oelig", "\u0153"], ["aelig", "\u00e6"],
  ["pound", "\u00a3"], ["shy", ""],
]);

/** `&mdash;` and `&#8212;` as the characters they stand for. */
export function decodeEntities(text) {
  return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body.startsWith("#")) {
      const code =
        body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES.get(body.toLowerCase()) ?? whole;
  });
}

/**
 * A word the compositor broke across a line, put back together.
 *
 * A hyphen at the end of a line followed by a lower-case word is a hyphenation,
 * not a compound: `mend-` + `ing` is `mending`, while `well-` + `Done` is a
 * proper noun the compositor split at an existing hyphen and keeps it. Only the
 * OCR text of the scanned bulletins needs this — a Project Gutenberg text
 * edition keeps its words whole — but the rule is the same everywhere it is
 * applied.
 */
export function joinHyphenated(text) {
  return text.replace(/(\p{Ll})-\s+(\p{Ll})/gu, "$1$2");
}

/** A path segment an id can be made of: kebab-case, ASCII, no runs of dashes. */
export function slugify(text) {
  return collapse(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // An apostrophe is not a word boundary: `ABC's of Mending` is one word and
    // `abcs-of-mending`, not `abc-s-of-mending`.
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * A heading's identity: its letters and digits, upper-cased.
 *
 * The sources print their headings in ways that defeat a text comparison — an
 * OCR layer reads `TOOLS AND THEIR USES` as `TOOLS AND THEIR USES` but splits
 * the words with the column layout's own spacing, Project Gutenberg's editions
 * wrap a heading over two lines, and the bulletins set theirs in capitals with
 * the punctuation dropped. Comparing what a reader would agree the heading SAYS
 * is what lets a plan name a heading once and survive all three.
 */
export function headingKey(text) {
  return collapse(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Whether a line is a heading the source SET, rather than a sentence.
 *
 * The OCR text of a scanned bulletin has no markup at all, so the only signal
 * is typography: a line that stands alone in its own paragraph, carries no
 * sentence punctuation, and is either set in capitals or is short enough to be a
 * heading and not a wrapped sentence. A wrong answer here costs nothing but a
 * heading's size — the words are the same words either way — which is why the
 * rule may be this crude.
 */
export function looksLikeHeading(line) {
  const text = collapse(line);
  if (text.length === 0 || text.length > 80) return false;
  if (/[.,;:!?]$/.test(text)) return false;
  if (text !== text.toUpperCase() && text.split(" ").length > 8) return false;
  return /^[A-Z0-9]/.test(text);
}

/** KiB with one decimal, which is the unit every size in the report is printed in. */
export function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
