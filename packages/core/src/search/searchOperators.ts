import { shiftDayKey } from "../calendar/calendarGrid.js";
import { foldSearchText } from "./searchText.js";
import type { SearchDueFilter } from "./searchQuery.js";
import type { SearchHit } from "./searchRanking.js";

/**
 * Resolution and post-filtering for the `#oznaka` / `rok:` search operators
 * (SRCH). `parseSearchQuery` reads the grammar; this module turns what it read
 * into an actual decision about a hit, and stays as clock-free and
 * database-free as the rest of this package: "today" arrives as a parameter,
 * and which entities carry a tag is resolved by the caller (the main process,
 * which is the only side that can read the two tag stores) and handed in as
 * plain id sets.
 *
 * Both filters run AFTER the store's candidates come back rather than inside
 * the SQL. The search index is trigger-maintained and deliberately knows
 * nothing about tags (adding a tag column would mean new triggers on two more
 * tables, and a stale index the moment either drifted), so the id sets are the
 * honest join — and the date filter has to reduce a stored instant to a local
 * calendar day, which SQLite cannot do without a timezone it does not have.
 */

/** Inclusive bare-date bounds, `from <= to` — bare day keys compare correctly as strings. */
export interface SearchDayRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The entities matching ONE `#` token, per kind. Only tasks and notes carry
 * tags in this product; a kind absent from this shape is a kind that cannot be
 * tagged at all, which is why `applySearchOperators` excludes the others
 * outright rather than passing them through unfiltered.
 */
export interface SearchTagMatch {
  readonly taskIds: ReadonlySet<string>;
  readonly noteIds: ReadonlySet<string>;
}

export interface SearchOperatorFilters {
  /** One entry per `#` token, ANDed together. Empty or absent means no tag filtering. */
  readonly tagMatches?: readonly SearchTagMatch[];
  /** Inclusive day bounds from `resolveDueRange`. Null or absent means no date filtering. */
  readonly dueRange?: SearchDayRange | null;
}

/** The subset of a hit these filters read — so ranked and unranked hits alike can be filtered. */
type FilterableHit = Pick<SearchHit, "kind" | "entityId" | "contextDate">;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Days a `nedelja`/`week` filter spans, counting today: today plus the next six. */
export const SEARCH_DUE_WEEK_DAYS = 7;

/**
 * A tag NAME reduced to the form a `#` token is typed in: folded (so „Đorđe“,
 * „djordje“ and „Ђорђе“ are one tag) and then space-stripped, because a query
 * token cannot contain a space and a tag name can — „moj posao“ has to stay
 * reachable, as `#mojposao`. Matching is by PREFIX over this form, so `#moj`
 * deliberately reaches „moj posao“ and „mojstari“ alike.
 *
 * Lives here rather than in either caller because BOTH sides run it: the main
 * process to decide what a token matches, and the palette to complete a picked
 * suggestion into a token. Two copies that drifted would mean a suggestion
 * completing into a token that matches nothing.
 */
export function foldSearchTag(name: string): string {
  return foldSearchText(name).replace(/\s+/g, "");
}

/**
 * The inclusive day bounds a parsed date filter means, given the day "today"
 * is. `today` must be a real bare day key — `shiftDayKey` throws on anything
 * else rather than quietly producing an "Invalid Date" range.
 */
export function resolveDueRange(filter: SearchDueFilter, today: string): SearchDayRange {
  if (filter.kind === "date") return { from: filter.date, to: filter.date };
  switch (filter.preset) {
    case "today":
      return { from: today, to: today };
    case "tomorrow": {
      const tomorrow = shiftDayKey(today, 1);
      return { from: tomorrow, to: tomorrow };
    }
    case "week":
      return { from: today, to: shiftDayKey(today, SEARCH_DUE_WEEK_DAYS - 1) };
  }
}

/**
 * The calendar day a hit's `contextDate` falls on, or null when it has none
 * (or is unreadable). The index stores two shapes — a bare `YYYY-MM-DD` (task
 * due, document expiry, exam date) and a full ISO instant (event start, card
 * due) — and an instant reduces to its LOCAL day, deliberately: an event at
 * 23:30 local is shown to the user on that day everywhere else in the app, so
 * `rok:danas` has to agree with what they can see. Reading the local zone is
 * not reading the clock; no "now" is involved.
 */
export function searchContextDay(contextDate: string | null): string | null {
  if (contextDate === null) return null;
  if (DAY_KEY_RE.test(contextDate)) return contextDate;

  const parsed = new Date(contextDate);
  const ms = parsed.getTime();
  if (Number.isNaN(ms)) return null;
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

/**
 * Drops every hit the active operators exclude, preserving the order it was
 * given (so a recency-ordered list stays recency-ordered and a ranked one
 * stays ranked). With no operators active this is a copy, not a filter.
 *
 * The date filter needs no kind allowlist: a kind with no context date has a
 * null one, and null is outside every range.
 */
export function applySearchOperators<T extends FilterableHit>(
  hits: readonly T[],
  filters: SearchOperatorFilters,
): T[] {
  const tagMatches = filters.tagMatches ?? [];
  const dueRange = filters.dueRange ?? null;
  if (tagMatches.length === 0 && dueRange === null) return [...hits];

  return hits.filter((hit) => {
    if (tagMatches.length > 0) {
      const idsOfKind = taggableIdsKey(hit.kind);
      if (idsOfKind === null) return false;
      // AND, not OR: every typed token must match, which is what makes
      // "#posao #hitno" narrower than either token alone.
      for (const match of tagMatches) {
        if (!match[idsOfKind].has(hit.entityId)) return false;
      }
    }

    if (dueRange !== null) {
      const day = searchContextDay(hit.contextDate);
      if (day === null || day < dueRange.from || day > dueRange.to) return false;
    }

    return true;
  });
}

/** Which `SearchTagMatch` set a hit's kind is looked up in, or null when the kind cannot be tagged. */
function taggableIdsKey(kind: FilterableHit["kind"]): keyof SearchTagMatch | null {
  if (kind === "task") return "taskIds";
  if (kind === "note") return "noteIds";
  return null;
}
