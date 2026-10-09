import type { SettingsSearchResult } from "./settingsSearch.js";
import {
  categoryById,
  categoryCardIds,
  categoryListIds,
  categoryOf,
  SETTINGS_CATEGORIES,
  type CategoryId,
  type SettingsLocation,
} from "../../shared/settingsSections.js";

/**
 * SET-015's other half: what a location — or a search — makes VISIBLE.
 *
 * The table itself (the eight categories, their cards, the two sub-page lists)
 * lives in `shared/settingsSections.ts`; this module re-exports it so the page
 * keeps one import, and owns the one function that could not travel with it.
 * `visibleSections` answers a question about a SEARCH RESULT, and a result is
 * built by `settingsSearch.ts` out of the strings table, which exists in the
 * renderer only.
 */
export * from "../../shared/settingsSections.js";

export interface SettingsVisibility {
  /** Cards to keep visible; every other card stays mounted but gets `set__section--hidden`. */
  readonly cards: ReadonlySet<string>;
  /** Sub-page lists to keep visible. */
  readonly lists: ReadonlySet<string>;
  /** The categories whose headings the page draws, in category order. */
  readonly groups: readonly CategoryId[];
}

/**
 * What a location shows, with or without a search.
 *
 * - No query, a sub-page open: that one card, nothing else.
 * - No query, a category open: its own cards plus its list(s).
 * - No query, no category: nothing but the headings' owner — the narrow root
 *   list is the page's own markup, so `groups` is empty and every card hides.
 * - A query: every card the index kept, across all categories, with no lists
 *   (a list row is navigation, and the results are already in front of the
 *   reader); the groups are the categories that kept at least one card.
 */
export function visibleSections(
  location: SettingsLocation,
  searchResult: SettingsSearchResult | null,
): SettingsVisibility {
  if (searchResult !== null) {
    const cards = new Set(searchResult.sections);
    const groups = SETTINGS_CATEGORIES.filter((category) =>
      [...cards].some((sectionId) => categoryOf(sectionId) === category.id),
    ).map((category) => category.id);
    return { cards, lists: new Set(), groups };
  }

  if (location.sub !== null) {
    return { cards: new Set([location.sub]), lists: new Set(), groups: [categoryOf(location.sub)] };
  }

  if (location.category !== null) {
    const category = categoryById(location.category);
    return {
      cards: new Set(categoryCardIds(category)),
      lists: new Set(categoryListIds(category)),
      groups: [category.id],
    };
  }

  return { cards: new Set(), lists: new Set(), groups: [] };
}
