/**
 * Matching a folded query against a pack's sorted key list — the pure half of
 * the search, so the half that touches files (`main/pack.ts`) has no rule of its
 * own to get wrong.
 *
 * **The order of the two kinds of hit, and it is a decision.** A query has an
 * EXACT hit when a key IS the query (`kafa`), and PREFIX hits when longer keys
 * start with it (`kafana`, `kafanski`). The exact hit is shown first, because it
 * is the word that was typed and the prefix hits are the neighbourhood; the
 * prefix hits follow in key order, which is the order a printed dictionary
 * column has. A query with no exact hit still answers with its neighbourhood,
 * which is what makes search-as-you-type useful one keystroke in.
 *
 * **Everything is bounded.** A query of one letter has thousands of prefix hits
 * in an 80 000-word index, so the walk stops at `limit` and says so
 * (`truncated`), and the caller renders "showing the first N" rather than a
 * list the user cannot read.
 */

import { compareDictionaryKeys, dictionaryKey } from "./keys.js";

/** One key's match against a query, as indices into the sorted key array. */
export interface DictionaryKeyMatch {
  /** The folded query, which is what was actually searched for — never the raw text. */
  readonly key: string;
  /** The index of the key equal to the query, or `-1` when the index has no such key. */
  readonly exact: number;
  /** Indices of keys that START with the query and are longer than it, in key order, capped at `limit`. */
  readonly prefixed: readonly number[];
  /** True when more prefix hits existed than the cap allowed. */
  readonly truncated: boolean;
}

/**
 * The first index whose key is `>= query`, by binary search.
 *
 * This is `Array.prototype.findIndex`'s job done the other way round: the index
 * is sorted, so the lower bound is a logarithm rather than a walk, which is what
 * lets an 80 000-word index answer a keystroke. `keys` must be sorted by
 * {@link compareDictionaryKeys} — the pack's writer guarantees that, and the
 * module's own test pins it against the writer's output.
 */
export function lowerBound(keys: readonly string[], query: string): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const value = keys[middle] ?? "";
    if (compareDictionaryKeys(value, query) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Every hit for one query, in the order they are shown.
 *
 * An empty query is not a search: `""` folds to `""`, and every key starts with
 * the empty string, so answering it would return the whole pack in
 * lexicographic order. The honest answer is no hits at all, and it is stated
 * here rather than in the page because the page is not the only caller.
 */
export function matchDictionaryKeys(
  keys: readonly string[],
  query: string,
  limit: number,
): DictionaryKeyMatch {
  const key = dictionaryKey(query);
  if (key === "" || limit <= 0) return { key, exact: -1, prefixed: [], truncated: false };

  const from = lowerBound(keys, key);
  let exact = -1;
  const prefixed: number[] = [];
  let truncated = false;
  for (let index = from; index < keys.length; index += 1) {
    const candidate = keys[index] ?? "";
    if (!candidate.startsWith(key)) break;
    if (candidate === key) {
      // The exact key is not counted against the cap: a caller that asked for
      // ten results and got the word itself plus nine neighbours has what it
      // asked for, and dropping the exact hit to obey a cap would be a search
      // that does not answer the query.
      exact = index;
      continue;
    }
    if (prefixed.length >= limit) {
      truncated = true;
      break;
    }
    prefixed.push(index);
  }
  return { key, exact, prefixed, truncated };
}
