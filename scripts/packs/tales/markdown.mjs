// No shebang, for the reason the other gates in `scripts/` have none: this
// module is both imported by the pack builders and driven by their tests.
//
// The text half that both converters share: whitespace normalisation, HTML
// entity decoding, the transliteration that turns a Serbian title into a
// kebab-case id, and the strip-markup step the fidelity test compares with.
//
// WHY THE STRIPPER LIVES WITH THE CONVERTERS. The fidelity test asks one
// question — is the article's text, with its markup removed, the source's text
// with its tags removed? — and that question is only answerable if the way
// markup is removed is the exact inverse of the way it was added. A stripper
// written from the CommonMark spec would answer a different question: it would
// accept markup the converter never emits and lose text the converter does. So
// the stripper below removes precisely the constructs `gutenberg.mjs` and
// `wikisource.mjs` emit, and nothing else, and `markdown.test.mjs` pins the
// pairs.

/**
 * Whitespace-normalised text: the one form the fidelity test compares.
 *
 * Newlines, tabs and runs of spaces all become one space, because the two
 * sides legitimately differ in line breaking — Gutenberg's text is hard-wrapped
 * at 72 columns and the article is not, and a wiki `<poem>` block is one
 * paragraph where the source has line breaks. Everything that is not
 * whitespace has to match exactly.
 */
export function normalise(text) {
  return text.replace(/\s+/gu, " ").trim();
}

/** The named HTML entities the Wikisource parser output actually uses. */
const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["hellip", "\u2026"],
  ["laquo", "\u00ab"],
  ["raquo", "\u00bb"],
  ["copy", "\u00a9"],
  ["deg", "\u00b0"],
  ["times", "\u00d7"],
  ["sect", "\u00a7"],
]);

/**
 * Decodes the entities the MediaWiki parser emits, named and numeric.
 *
 * The parser output escapes `&`, `<` and `>` and leaves real characters —
 * Cyrillic, curly quotes, `–` — as themselves, so a full HTML5 table would be
 * dead weight. Anything not in the map and not numeric is left as written,
 * because inventing a replacement for an unknown entity is how a fidelity test
 * starts agreeing with a bug.
 */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES.get(body.toLowerCase());
    return named ?? whole;
  });
}

/**
 * Escapes the characters that would otherwise be read as markup.
 *
 * The unescaped character is not hypothetical: Gutenberg's Aesop writes
 * `_much_ bigger` and `the _MUCH_ bigger`, 5314's notes carry `151*`, and
 * 27200 divides a tale with a centred row of asterisks. Each of those would
 * become emphasis, a footnote-looking token, or a thematic break if it were
 * copied as it stands — and a character that markdown eats is a text change
 * wearing markup's clothes. The line-leading set is separate because `-`, `+`,
 * `#`, `>` and `1.` are ordinary characters anywhere else in a line, and
 * because no fairy tale should have to spell a hyphen in the middle of a word
 * as `\-`.
 */
export function escapeText(text) {
  return text
    // The global set runs FIRST, so the backslashes the two line rules add are
    // not themselves escaped. The other order produces `\\-`, which is a
    // literal backslash and a list marker: the reader sees `\-` and the
    // fidelity test sees a character the source never printed.
    .replace(/([\\*_`[\]|<>])/g, "\\$1")
    .replace(/^([ \t]*)(\d{1,3})([.)])(?=[ \t])/gm, "$1$2\\$3")
    .replace(/^([ \t]*)([-+>#])(?=[ \t]|$)/gm, "$1\\$2");
}

/**
 * The article's text with the markup `gutenberg.mjs` and `wikisource.mjs` add
 * removed — the left side of every fidelity comparison.
 *
 * Escaped characters are parked behind a NUL first, because removing `*` and
 * then unescaping `\*` would leave the backslash behind and delete the
 * asterisk the source actually wrote.
 */
const PARKED_OPEN = "\u0000";

export function stripMarkup(markdown) {
  // Escaped characters are lifted OUT of the text first, because most of them
  // are also the markup characters removed a few lines below. Leaving the
  // escape's character in place — the obvious `\*` → `\u0000*` — does not work,
  // and the way it fails is worth keeping written down: the asterisk is still
  // an asterisk, so `[*_`]` deletes it, and a tale that printed
  // `* * * * * * *` as a divider comes out with the divider gone and the
  // fidelity test blaming the converter.
  const parked = [];
  let text = markdown.replace(/\\([\\*_`[\]|<>#+\-.()])/g, (_whole, character) => {
    parked.push(character);
    return `${PARKED_OPEN}${String(parked.length - 1)}${PARKED_OPEN}`;
  });
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  text = text.replace(/^[ \t]*\d{1,3}\.[ \t]+/gm, "");
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/[ \t]+$/gm, "");
  text = text.replace(/[*_`]/g, "");
  // Built from a constant rather than written as an escape in a regex literal:
  // a NUL in a pattern is a control character to every linter and a puzzle to
  // every reader, and this one is a placeholder, not a character class.
  return text.replace(new RegExp(`${PARKED_OPEN}(\\d+)${PARKED_OPEN}`, "g"), (_whole, index) => parked[Number(index)]);
}

/**
 * The Serbian Cyrillic-to-Latin transliteration used for article ids.
 *
 * The pack's ids are kebab-case and end up as file names, so the letters are
 * transliterated and then folded to ASCII (`Đ`/`Ђ` → `dj`, `Ž`/`Ж` → `z`, …)
 * rather than carried as diacritics: `č` in a file name is legal but invites a
 * Unicode-normalisation bug in whichever filesystem or archive handles the pack
 * next, and the id is not user-visible text — the article carries the title.
 */
const CYRILLIC_TO_LATIN = new Map(Object.entries({
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z",
  и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o",
  п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c",
  ч: "c", џ: "dz", ш: "s", ѕ: "dz", ѡ: "o", ѣ: "e", ѧ: "e",
  ѫ: "u", ѵ: "i", ѳ: "f", ѱ: "ps", ѯ: "ks",
}));

/** Latin letters that carry a diacritic in Serbian, folded for the id. */
const LATIN_FOLD = new Map(Object.entries({
  č: "c", ć: "c", đ: "dj", š: "s", ž: "z",
  á: "a", à: "a", â: "a", ä: "a", å: "a", é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i", ó: "o", ò: "o", ô: "o", ö: "o", ú: "u",
  ù: "u", û: "u", ü: "u", ñ: "n", ç: "c", æ: "ae", ø: "o", ß: "ss",
}));

/** The text folded to the ASCII alphabet an id is built from. */
export function foldToAscii(text) {
  let out = "";
  for (const character of text.normalize("NFC")) {
    const lower = character.toLowerCase();
    out += CYRILLIC_TO_LATIN.get(lower) ?? LATIN_FOLD.get(lower) ?? lower;
  }
  return out.normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}

/**
 * The kebab-case slug of a title: ASCII, lowercase, single hyphens.
 *
 * A title that folds to nothing (`???`) is refused rather than turned into an
 * empty id, because two of those would collide into one article and the pack
 * would silently lose one of them.
 */
export function slug(text) {
  const slugged = foldToAscii(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slugged === "") throw new Error(`tales: "${text}" has no characters an id can be built from.`);
  return slugged;
}

/**
 * `base` if that id is free, otherwise `base-2`, `base-3`, … and the list of
 * taken ids gains the one returned.
 *
 * Two pages can fold to the same id — the corpus holds both „Али је боља памет
 * али јунаштво" and „Али је боља памет али јунаштво?" — and an id that
 * repeats is a pack with one article fewer than it thinks it has.
 */
export function uniqueId(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${String(index)}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * Serbian sorting, in the two scripts the pack's titles arrive in: titles are
 * Cyrillic on `sr.wikisource` and Latin on Gutenberg.
 */
export const SERBIAN_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** A stable order for a list of `{ title }` records, by Serbian collation. */
export function bySerbianTitle(records) {
  return [...records].sort((left, right) => SERBIAN_COLLATOR.compare(left.title, right.title));
}

/**
 * The fidelity assertion itself, in one place so both packs make the same one.
 *
 * The comparison is deliberately exact after normalisation: not "the article
 * contains the source" and not "the lengths are close". A converter that drops
 * one sentence, doubles one paragraph, or reorders two of them fails here.
 */
export function assertFidelity(articleBody, sourceText, label) {
  const produced = normalise(stripMarkup(articleBody));
  const expected = normalise(sourceText);
  if (produced !== expected) {
    throw new Error(
      `tales: fidelity check failed for ${label}: the article's text is not the source's text.` +
        `\n  article (${String(produced.length)} chars): ${firstDifference(produced, expected)}` +
        `\n  source  (${String(expected.length)} chars): ${firstDifference(expected, produced)}`,
    );
  }
}

/**
 * The first place two strings differ, with a little of either side of it.
 *
 * A whole mismatched article is 8 000 characters nobody reads, and the two
 * ends that matter are where the divergence starts and whether it is a change
 * of wording or a paragraph that moved.
 */
export function firstDifference(mine, theirs) {
  let at = 0;
  while (at < mine.length && at < theirs.length && mine[at] === theirs[at]) at += 1;
  const from = Math.max(0, at - 60);
  return `…${mine.slice(from, at)}[${JSON.stringify(mine.slice(at, at + 90))}]`;
}
