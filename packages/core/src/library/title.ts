/**
 * Title normalisation: the ONE rule that decides whether a curated list's
 * entry and a work a person already logged are the SAME work.
 *
 * **Why a normaliser, and why one function.** A suggested collection arrives
 * with a title in both languages (`{ sr, en }`, because the app's default
 * locale is Serbian and a list carrying one title could only ever be shown in
 * one), a user logs whatever they know the work by, and the two strings are
 * almost never byte-identical: „Rat i mir" against „Rat i Mir", „Čiča Gorio"
 * against „Cica Gorio", „The Great Gatsby" against „Great Gatsby". Matching on
 * the raw column would create a second copy of the same work on every adoption
 * — exactly the duplication the adopt operation exists to avoid — so the fold
 * lives here and nowhere else, and the store's matching pass calls it instead
 * of spelling a `LIKE` pattern SQLite would answer differently.
 *
 * **The steps, and what each one is for.**
 *
 * 1. `Đ`/`đ` fold FIRST, before any decomposition, because they are the two
 *    Serbian letters that carry no combining mark to strip: NFD leaves `đ` as
 *    `đ` (the stroke is part of the letter, not a mark above it), so `Đorđe`
 *    would come through step 2 untouched while `Čačak` lost its mark.
 * 2. NFD plus a strip of `\p{M}` then handles every diacritic that IS a mark:
 *    `č ć š ž` and the rest of Latin (`É`, `Á`, `Ö`). A letter that is a
 *    distinct letter with no decomposition — `ø`, `ß`, `ł` — is deliberately
 *    left alone: it is not a diacritic, and a hand-written equivalence table
 *    only holds for the languages somebody tested.
 * 3. Lowercase, after the marks are gone, so nothing is left for a locale to
 *    disagree about.
 * 4. `&` becomes the word `and` BEFORE punctuation is dropped, because it is
 *    the one punctuation mark that is a word („Tom & Jerry" is „Tom and
 *    Jerry"). Everything else non-alphanumeric becomes a separator: punctuation,
 *    brackets, apostrophes (`L'Étranger` → `l etranger`), and the ellipses a
 *    catalogue likes to print.
 * 5. ONE leading English article — `the`, `a`, `an` — is dropped, and only one.
 *    It is a TOKEN test, which is what keeps „Ana Karenjina" intact (`ana` is a
 *    word, not the article `a`) while „A Clockwork Orange" loses its `a`.
 *    Non-English articles (`die`, `le`, `el`) are deliberately not in the list:
 *    the brief asks for the English three, and a longer list starts removing
 *    words from titles that are not articles in the language they are written
 *    in.
 *
 * **The empty key.** A title of nothing but punctuation normalises to the empty
 * string, and two such titles are not the same work. `titleMatchKey` is where
 * that decision is made once, so no caller has to remember it.
 */

/** The English articles a leading position loses. Tokens, not prefixes. */
const ARTICLE_TOKENS: ReadonlySet<string> = new Set(["the", "a", "an"]);

/** Everything that is not a letter or a digit in any script becomes a separator. */
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

/** Combining marks, which NFD separated from the letter they sit on. */
const COMBINING_MARKS = /\p{M}+/gu;

/**
 * The matching key of one title: lowercased, unaccented, punctuation-free, and
 * without its leading English article. Empty only for a title that held nothing
 * but punctuation — see `titleMatchKey` for that case, which is the one callers
 * must use when the fold is a MATCH KEY rather than a display string.
 */
export function normalizeLibraryTitle(title: string): string {
  const folded = title.replace(/đ/g, "d").replace(/Đ/g, "d");
  const bare = folded.normalize("NFD").replace(COMBINING_MARKS, "");
  const plain = bare.toLowerCase().replace(/&/g, " and ").replace(NOT_WORD, " ");
  const tokens = plain.split(" ").filter((token) => token.length > 0);
  // The article comes off only when something is left behind it: a film called
  // „The" keeps its name, and stripping it would leave every such title sharing
  // one empty key.
  if (tokens.length > 1 && ARTICLE_TOKENS.has(tokens[0] ?? "")) tokens.shift();
  return tokens.join(" ");
}

/**
 * The normalised title as a MATCH KEY, or null when the title holds nothing to
 * match on (nothing but punctuation). Null is „no key", never „the empty key":
 * two works titled „…" and „!!!" are two works, and a caller comparing empty
 * strings would say they are one.
 */
export function titleMatchKey(title: string): string | null {
  const key = normalizeLibraryTitle(title);
  return key.length === 0 ? null : key;
}
