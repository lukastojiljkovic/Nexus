import type { KnowledgeHit } from "@nexus/core";

/**
 * Reciprocal rank fusion: turning the several rankings retrieval produces into
 * one list.
 *
 * **Why ranks and not scores.** A full-text search returns bm25 (negative, and
 * only comparable within the query that produced it), a vector search returns a
 * cosine (-1..1), and a wiki reader returns its own title-match order - three
 * numbers with three meanings and no common scale, which is exactly the case
 * score normalisation gets wrong: it invents a scale, and the invention is
 * invisible. Reciprocal rank fusion ignores the scores entirely and uses the one
 * thing the three agree on, the order of their results:
 *
 *     score(d) = SUM over lists  1 / (k + rank(d, list))
 *
 * with rank counted from 1. A document that several lists place highly rises; a
 * document no list contains has no score at all, so a source that matched
 * nothing simply contributes nothing. The method and the value k = 60 are
 * Cormack, Clarke and Buettcher, "Reciprocal rank fusion outperforms Condorcet
 * and individual rank learning methods", SIGIR 2009,
 * https://doi.org/10.1145/1571941.1572114 - the paper introduced the method and
 * found 60 to work well across its collections, so the number is quoted rather
 * than tuned.
 *
 * **Ties break by key, never by list order.** Two passages that appear at the
 * same rank in different lists score identically, and the order they are then
 * returned in has to be a property of the data rather than of which list was
 * concatenated first: a result list whose order changed with the number of
 * sources that happened to be available would make every retrieval test a
 * coincidence.
 */

/** The rank-smoothing constant, from the paper cited above. */
export const RRF_K = 60;

/** One ranked list's entry: a stable identity, the hit itself, and where it ranked. */
export interface RankedHit {
  /** Stable across lists: a chunk's row id, or a wiki article's path. */
  readonly key: string;
  readonly citation: KnowledgeHit["citation"];
  readonly text: string;
}

/**
 * The best `limit` hits across every list, best first.
 *
 * A hit that appears in more than one list is ONE result carrying the sum of its
 * contributions: the same passage found by text and by vector is the strongest
 * evidence retrieval can offer, and returning it twice would make it two
 * mediocre answers instead.
 */
export function fuseRanked(
  lists: readonly (readonly RankedHit[])[],
  options: { readonly limit: number; readonly k?: number },
): KnowledgeHit[] {
  const k = options.k ?? RRF_K;
  const scores = new Map<string, number>();
  const hits = new Map<string, RankedHit>();

  for (const list of lists) {
    for (let index = 0; index < list.length; index += 1) {
      const ranked = list[index];
      if (ranked === undefined) continue;
      const contribution = 1 / (k + index + 1);
      scores.set(ranked.key, (scores.get(ranked.key) ?? 0) + contribution);
      if (!hits.has(ranked.key)) hits.set(ranked.key, ranked);
    }
  }

  return [...hits.entries()]
    .map(([key, ranked]) => ({
      key,
      score: scores.get(key) ?? 0,
      citation: ranked.citation,
      text: ranked.text,
    }))
    .sort((left, right) => right.score - left.score || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .slice(0, Math.max(0, options.limit))
    .map((entry) => ({ citation: entry.citation, text: entry.text, score: entry.score }));
}
