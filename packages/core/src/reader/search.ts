/**
 * The Reader's search: a query answered against the text of a pack's articles,
 * titles first and full text after.
 *
 * **Why the index is text, and why the fold happens once.** The Reader's index
 * lives in the profile's cache (ADR-100), is built once per installed pack
 * version, and is thrown away and rebuilt whenever a pack is updated - so what it
 * holds is each article's plain text, exactly as the article reads, with no
 * derived copy of it on disk: folding is a rule, and a rule baked into a file
 * written last month is a rule that cannot be corrected today. The fold happens
 * ONCE PER LOAD instead (`makeSearchable`), which is what keeps a query a pass
 * over `includes` rather than a re-fold of the whole pack, and what makes the
 * cache a record of the articles rather than of the search that read them.
 *
 * **Matching is `foldSearchText`'s.** That is the app's one Serbian-aware fold -
 * lower case, diacritics stripped, the Serbian letters that do not decompose, the
 * digraphs and the Cyrillic alphabet all mapped to the same Latin letters the
 * index side produces - so
 * „ucenje“ finds „Učenje“ and „Djordje“ finds „Đorđe“, exactly as the module
 * launcher and the palette already behave. A pack in another language folds
 * consistently on both sides, which is all this promises.
 *
 * **Highlighting is `buildSearchSnippet`'s**, deliberately reused rather than
 * re-implemented: it returns an excerpt of the ORIGINAL text plus ranges into
 * that excerpt, which is the only shape a renderer can paint without a second
 * mapping of its own.
 */

import { buildSearchSnippet, foldSearchText, type SearchSnippet } from "../search/searchText.js";

/** One article as the search reads it. */
export interface ReaderIndexedArticle {
  readonly path: string;
  readonly title: string;
  /** The article's plain text, headings and code included. */
  readonly text: string;
}

/** One article as the search reads it: its text and its folded twins, built once when the pack's index loads. */
export interface ReaderSearchableArticle {
  readonly path: string;
  readonly title: string;
  readonly foldedTitle: string;
  readonly text: string;
  readonly foldedText: string;
}

/** One pack as the search reads it, in the order the pack reads. */
export interface ReaderSearchablePack {
  readonly packId: string;
  readonly articles: readonly ReaderSearchableArticle[];
}

/** Folds one article once, when its pack's index is loaded - never per query. */
export function makeSearchable(article: ReaderIndexedArticle): ReaderSearchableArticle {
  return {
    path: article.path,
    title: article.title,
    foldedTitle: foldSearchText(article.title),
    text: article.text,
    foldedText: foldSearchText(article.text),
  };
}

export interface ReaderSearchHit {
  readonly packId: string;
  readonly path: string;
  /** The title, with the matched words' ranges inside it. */
  readonly title: SearchSnippet;
  /** The body's excerpt, or `null` when the title alone carried every term. */
  readonly snippet: SearchSnippet | null;
  /** True when every term appears in the TITLE, which is what puts a hit in the first group. */
  readonly titleMatch: boolean;
}

export interface ReaderSearchOutcome {
  readonly hits: readonly ReaderSearchHit[];
  /** True when the cap cut the answer short, so the page can say so rather than pretending it listed everything. */
  readonly truncated: boolean;
}

/** How far the body excerpt reaches either side of the first match. */
const SNIPPET_RADIUS = 90;

/**
 * The query's terms, folded, in the order they were typed and without repeats.
 *
 * Terms shorter than two characters are dropped: a one-letter term matches
 * nearly every article in a pack, and a search that answers everything is a
 * search that answered nothing.
 */
export function readerQueryTerms(query: string): readonly string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.split(/\s+/)) {
    if (raw.trim().length === 0) continue;
    const folded = foldSearchText(raw);
    if (folded.length < 2 || seen.has(folded)) continue;
    seen.add(folded);
    terms.push(folded);
  }
  return terms;
}

/**
 * The hits for one query, in the order the Reader draws them: title matches
 * first, then body matches, and inside each group the pack's own order - which
 * is the reading order, so a search for a word a whole chapter is about lists
 * that chapter's pages in the sequence somebody would read them.
 *
 * An article hits only when EVERY term is present, in the title or in the text.
 * Requiring all of them is what makes a second word narrow the answer instead of
 * widening it, and it is the same rule the launcher's own filter follows.
 */
export function searchReaderIndex(
  query: string,
  packs: readonly ReaderSearchablePack[],
  limit: number,
): ReaderSearchOutcome {
  const terms = readerQueryTerms(query);
  if (terms.length === 0) return { hits: [], truncated: false };

  const titleHits: ReaderSearchHit[] = [];
  const bodyHits: ReaderSearchHit[] = [];
  for (const pack of packs) {
    for (const article of pack.articles) {
      const inTitle = terms.every((term) => article.foldedTitle.includes(term));
      const inText = inTitle || terms.every((term) => article.foldedText.includes(term));
      if (!inText) continue;
      const title = buildSearchSnippet(article.title, terms, { radius: 120 });
      const hit: ReaderSearchHit = {
        packId: pack.packId,
        path: article.path,
        title,
        snippet: inTitle ? null : buildSearchSnippet(article.text, terms, { radius: SNIPPET_RADIUS }),
        titleMatch: inTitle,
      };
      if (inTitle) titleHits.push(hit);
      else bodyHits.push(hit);
    }
  }

  const ordered = [...titleHits, ...bodyHits];
  return {
    hits: ordered.slice(0, limit),
    // `ordered` is every hit rather than a truncated list, so "there was more" is
    // answered by the count instead of by a walk that stopped early and guessed.
    truncated: ordered.length > limit,
  };
}
