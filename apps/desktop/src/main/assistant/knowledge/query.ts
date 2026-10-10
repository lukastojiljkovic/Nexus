/**
 * How a question becomes an FTS5 expression.
 *
 * **The tokenizer is the app's own** (`parseSearchQuery` folds and splits
 * exactly the way the indexed text was folded, so a query in any spelling meets
 * a passage written in another), and the one thing this file decides is how the
 * terms are JOINED.
 *
 * **`OR`, where the palette uses `AND`.** The app's own search joins terms with a
 * space, which FTS5 reads as "all of them": that is right for a palette query of
 * two or three words the user chose deliberately, and wrong for the assistant.
 * A question is a sentence - `kako iskljuciti modul` - and Serbian inflection
 * alone means `iskljuciti` will not match a page that says `isključuje`; an AND
 * over a sentence therefore returns nothing at all, and an assistant that finds
 * nothing answers from the model's memory, which is exactly the failure this
 * whole feature exists to prevent. With `OR`, a passage that shares one term is a
 * candidate and a passage that shares three still outranks it, because bm25 sums
 * a per-term contribution: recall comes from the expression, precision from the
 * ranking and from the fusion that follows.
 */

/**
 * The expression, or `null` when there is nothing to search for.
 *
 * Every term is quoted and stripped of quotes, on `toFtsMatchExpression`'s
 * terms: terms from the parser cannot contain one, but this function is exported
 * and a bare `AND`/`NEAR`/`*` that reached FTS5 would silently change what the
 * query means.
 */
export function orMatchExpression(terms: readonly string[]): string | null {
  const usable = terms
    .map((term) => term.replace(/"/g, "").trim())
    .filter((term) => term.length > 0);
  if (usable.length === 0) return null;
  return usable.map((term) => `"${term}"`).join(" OR ");
}
