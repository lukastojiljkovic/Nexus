// The text repairs this pack's two source families need, and nothing else.
//
// WHY THIS FILE IS SO NARROW. The pack ships the source's own words, and the
// fidelity test proves it: the converter's Markdown, with its markup stripped
// and whitespace collapsed, is the source span with whitespace collapsed. Every
// rule here therefore moves BOTH sides of that test, which is what makes a rule
// safe to write down — and also why each one is a fact about the EXTRACTION and
// never about what the source says. A rule that reworded anything would be a
// correction, and corrections are the one thing this pack may not make quietly:
// they live in `corrections.mjs`, one page at a time, listed in
// `docs/packs/car-help.md` so a human can check each against the scan.
//
//   R1  ligature glyphs   the extraction hands over the glyph, not the letters.
//   R2  letter spacing    a heading the compositor tracked comes back as
//                         `T I R E   S A F E T Y`.
//   R3  running heads     and printed page numbers: the same furniture at the
//                         head or the foot of every page (see `ocr.mjs`, which
//                         needs the page to apply it).
//   R4  line-end hyphen   `contamina-\ntion` is one word the compositor broke.
//   R5  bullet glyph      the scans' list bullet, which the OCR reads as a
//                         letter (`e`, `©`, `@`) rather than as a marker.
//
// Nothing here rewrites a word, fixes an OCR slip, or "cleans up" grammar.

/**
 * Ligature glyphs, and the non-breaking space, which is whitespace.
 *
 * Nothing else is in this table on purpose. Typographic punctuation (`’`, `—`)
 * is what the source PRINTS, so it stays exactly as it is; folding it to ASCII
 * would be the pack editing the source rather than undoing an extraction.
 */
export const LIGATURES = new Map([
  ["\uFB00", "ff"],
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
  ["\uFB05", "st"],
  ["\uFB06", "st"],
  ["\u00A0", " "],
]);

/** R1. Every ligature glyph becomes the letters it draws; a no-break space becomes a space. */
export function foldLigatures(text) {
  let folded = "";
  for (const character of text) folded += LIGATURES.get(character) ?? character;
  return folded;
}

/** A line that is nothing but single characters separated by single spaces. */
const SPACED_OUT = /^(?:[A-Za-z0-9&.,:'"()-] )+[A-Za-z0-9&.,:'"()-]$/;

/**
 * R2. A tracked heading comes back with a space between every letter. The
 * repair is a property of the SHAPE of the line (single characters, single
 * spaces, at least three of them), never of a word list: `T I R E` collapses,
 * an ordinary sentence with a stray double space does not.
 */
export function foldLetterSpacing(text) {
  const trimmed = text.trim();
  if (!SPACED_OUT.test(trimmed)) return text;
  const letters = trimmed.split(" ").filter((part) => part !== "");
  // Two-letter runs are ordinary words a compositor spaced out to justify a
  // line; three is the shortest heading this repair is for.
  if (letters.length < 3) return text;
  return letters.join("").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * R5. The bullet glyph, as this OCR hands it over.
 *
 * Measured on FM 21-305 pages 11-5, 13-3, 17-4 and 21-4: every printed bullet
 * (a filled disc, set at the left margin of a list item) comes back as a lone
 * `e`, one of them as `©`, two as `@`. The glyph is a MARKER the reader sees,
 * not a letter, so it has to leave the TEXT rather than the Markdown — the
 * fidelity test's source side is this normaliser, and a converter that deleted
 * a character the normaliser kept would be a difference in words, not in markup.
 *
 * The set is small on purpose and the guard is what keeps it safe: a glyph is
 * taken as a bullet only when what follows it is a capital letter, a digit or a
 * quotation mark, so `e.g. the tyre` is a sentence and `e Position the jump
 * starting vehicle` is a list item.
 */
const BULLET_GLYPH = /^(?:e@|e|@|\u00A9|\u2022|\u00B7|\u25AA|\u25CF)\s+(?=[A-Z0-9"“'‘(])/;

export function foldBulletGlyph(text) {
  const match = BULLET_GLYPH.exec(text);
  if (match === null) return { text, bullet: false };
  return { text: text.slice(match[0].length), bullet: true };
}

/**
 * R4. A line that ends in a hyphen and is followed by a lower-case word is one
 * word the compositor broke. Applied to the joined text of a block, so the
 * repair is visible in one place and the same on both sides of the fidelity
 * test: `injur-\ning or killing` is the source's `injuring or killing`.
 */
export function joinHyphenated(text) {
  return text.replace(/([A-Za-z])-\s+([a-z])/g, "$1$2");
}

/** Whitespace collapsed the one way both sides of the fidelity test use it. */
export function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

