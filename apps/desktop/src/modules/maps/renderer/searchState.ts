import type { MapPlace } from "@nexus/core";

/**
 * What the search box is showing. `count` is how many places the index holds
 * once it is ready.
 *
 * **`results` is `null` until the query is answered.** An empty list means the
 * index was asked and nothing matched, which the page says as "No place
 * matches"; a query still in the worker, or the name a pick wrote into the
 * box, has no answer yet and shows no list at all. With one empty list for
 * both, the hint flashed while every query was read and stayed after a pick.
 */
export interface SearchState {
  readonly status: "loading" | "ready" | "failed";
  readonly count: number;
  readonly query: string;
  readonly results: readonly MapPlace[] | null;
}

export const SEARCH_START: SearchState = { status: "loading", count: 0, query: "", results: null };

/** The box now holds `query`, which nothing has answered yet. */
export function askedFor(search: SearchState, query: string): SearchState {
  return { ...search, query, results: null };
}

/** The worker's answer to the box's current query. */
export function answeredWith(search: SearchState, places: readonly MapPlace[]): SearchState {
  return { ...search, status: "ready", results: places };
}

/** A place was picked from the list: the box holds its name, and the list closes. */
export function pickedPlace(search: SearchState, name: string): SearchState {
  return { ...search, query: name, results: null };
}

/** The list under the box, or `null` when none is drawn. */
export function shownResults(search: SearchState): readonly MapPlace[] | null {
  return search.status === "loading" || search.query.trim() === "" ? null : search.results;
}
