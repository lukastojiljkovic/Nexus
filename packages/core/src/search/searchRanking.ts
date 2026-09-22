import { foldSearchText } from "./searchText.js";
import type { ParsedSearchQuery, SearchKind } from "./searchQuery.js";

/**
 * Ranking for global search results (ADR-021). `bm25` alone is not usable
 * across result sets — SQLite's `bm25()` is corpus-dependent (its magnitude
 * shrinks as the indexed corpus grows), so it is normalized within the
 * passed set before anything else is added to it.
 */

export interface SearchHit {
  readonly kind: SearchKind;
  readonly entityId: string;
  /** Owning entity for deep links (a card's deck, an attachment's note); null when the kind has none. */
  readonly parentId: string | null;
  /** Original, unfolded text for display. */
  readonly title: string;
  /** Original, unfolded body excerpt for display. */
  readonly body: string;
  /** Due / start / expiry / exam date, as stored; null when the kind has none. */
  readonly contextDate: string | null;
  /** ISO-8601 timestamp. */
  readonly updatedAt: string;
  /** SQLite `bm25()` output: negative, and *smaller* means a better match. */
  readonly bm25: number;
}

export interface RankedSearchHit extends SearchHit {
  readonly score: number;
}

/** The baseline: every other weight below is calibrated against a full point of normalized relevance. */
export const RELEVANCE_WEIGHT = 1;
/** Recency's peak contribution (a hit updated right now), worth well under one point of relevance. */
export const RECENCY_WEIGHT = 0.3;
/** Time constant of the recency decay, in days: at this age the boost is down to 1/e of its peak (not a half-life — that would need a ln(2) factor). */
export const RECENCY_DECAY_DAYS = 14;
/**
 * A small nudge distinguishing otherwise-equal hits by kind; strictly
 * decreasing, never enough to outrank real relevance.
 *
 * **The ladder is re-spaced, not re-ordered, and the distinction is load-
 * bearing.** The tenth kind (`circuit`) needed a rung, and the nine existing
 * ones filled 0.01…0.09 with no room between any two. Rather than putting the
 * new kind on the floor at 0.00 — which would have made „last" mean „not on the
 * ladder at all" — every rung moved up by one step to open a gap, so the ORDER
 * between the nine is exactly what it was and a circuit sits between a document
 * and a subject: a saved schematic is a durable thing the user made, like a
 * document, and the study entities below it are parts of one.
 *
 * A uniform shift of the whole table would be a provable no-op on every existing
 * ranking; this one is not uniform — the five rungs below `circuit` did not
 * move — so the only scores that change are those where a circuit or a
 * document/subject comparison was within 0.01. That is the meaning of a prior
 * this small, and the alternative (a tenth value crammed between 0.05 and 0.06)
 * would have been a lie about its own units.
 */
export const KIND_PRIOR: Readonly<Record<SearchKind, number>> = {
  note: 0.1,
  task: 0.09,
  event: 0.08,
  document: 0.07,
  circuit: 0.06,
  subject: 0.05,
  exam: 0.04,
  deck: 0.03,
  card: 0.02,
  attachment: 0.01,
};
/** Title equals the folded query text exactly. */
export const TITLE_EXACT_BOOST = 0.5;
/** Title starts with the folded query text (weaker than an exact match; never both at once). */
export const TITLE_PREFIX_BOOST = 0.2;

const MS_PER_DAY = 86_400_000;

/** Days between `updatedAt` and `now`, clamped to >= 0; null when either timestamp fails to parse. */
function ageDaysOf(updatedAt: string, nowMs: number): number | null {
  if (Number.isNaN(nowMs)) return null;
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return null;
  return Math.max(0, (nowMs - updatedMs) / MS_PER_DAY);
}

export function rankSearchResults(
  hits: readonly SearchHit[],
  options: { readonly now: string; readonly query: ParsedSearchQuery },
): RankedSearchHit[] {
  // Accumulated in one pass rather than through `Math.min(...array)`: the
  // spread form throws on a large enough result set (argument-count limit),
  // and nothing here caps how many hits a caller may pass. A non-finite bm25
  // is treated as zero for the same reason the timestamps are guarded — one
  // broken row must not turn every score in the set into NaN.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const negBm25 = hits.map((hit) => {
    const value = Number.isFinite(hit.bm25) ? -hit.bm25 : 0;
    if (value < min) min = value;
    if (value > max) max = value;
    return value;
  });
  const nowMs = Date.parse(options.now);
  const queryText = options.query.text;

  const scored = hits.map((hit, index): RankedSearchHit => {
    const nb = negBm25[index] ?? 0;
    const relevance = max === min ? 1 : (nb - min) / (max - min);

    const ageDays = ageDaysOf(hit.updatedAt, nowMs);
    const recency = ageDays === null ? 0 : RECENCY_WEIGHT * Math.exp(-ageDays / RECENCY_DECAY_DAYS);

    let titleBoost = 0;
    if (queryText.length > 0) {
      const foldedTitle = foldSearchText(hit.title);
      if (foldedTitle === queryText) titleBoost = TITLE_EXACT_BOOST;
      else if (foldedTitle.startsWith(queryText)) titleBoost = TITLE_PREFIX_BOOST;
    }

    const score = RELEVANCE_WEIGHT * relevance + recency + KIND_PRIOR[hit.kind] + titleBoost;
    return { ...hit, score };
  });

  return scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
  });
}
