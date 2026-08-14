/**
 * The drawer's search — the reason „Alatke" is usable at a dozen tools rather
 * than a list somebody scrolls once and never opens again.
 *
 * Pure, and separate from the page, so the matching rules can be tested without
 * rendering anything. `foldSearchText` is `@nexus/core`'s, the same folding the
 * command palette and the settings filter use: „povrsina" finds „Površina" and
 * „PDV" finds it in any case, because a user typing a query is not also typing
 * diacritics.
 *
 * Matching is a PREFIX-or-substring test over the tool's name and its declared
 * keywords, not a fuzzy score. A dozen entries do not need ranking, and a fuzzy
 * matcher over a short list mostly produces surprising near-misses.
 *
 * **The query is split into terms, and every term must land somewhere.** It used
 * to be tested whole, which meant a two-word query could only ever match a
 * keyword that literally contained the space — so „spratna visina" found the
 * stair tool only because somebody had hand-written that exact phrase into its
 * keyword list, and found nothing at all in a toolkit whose keywords were single
 * words. That made findability depend on whether an author had guessed the
 * user's phrasing, which is not a property a search should have at 274 tools.
 * Conjunctive terms is also what `matchCommands` already does for the command
 * palette, so the app now answers „does this text match" one way instead of two.
 */

import { foldSearchText } from "@nexus/core";
import type { ToolCategory } from "@nexus/core";

/** What the search needs to know about a tool: its id, its resolved Serbian name, its group and its extra words. */
export interface SearchableTool {
  id: string;
  /** The tool's display name, already resolved from `titleKey` — this module never touches `strings`. */
  name: string;
  category: ToolCategory;
  keywords?: readonly string[];
}

/** Whether one tool answers a query. An empty query matches everything — a blank field is not a filter. */
export function matchesToolQuery(tool: SearchableTool, query: string): boolean {
  const terms = foldSearchText(query.trim()).split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) return true;
  const name = foldSearchText(tool.name);
  const keywords = (tool.keywords ?? []).map((keyword) => foldSearchText(keyword));
  return terms.every(
    (term) => name.includes(term) || keywords.some((keyword) => keyword.includes(term)),
  );
}

/**
 * The tools a query admits, in the order they were declared.
 *
 * Declaration order rather than relevance order on purpose: the drawer's list
 * is grouped and stable, so a user who has learned where „PDV" sits finds it in
 * the same place while typing, instead of watching rows reorder under the
 * cursor.
 */
export function filterTools<T extends SearchableTool>(tools: readonly T[], query: string): T[] {
  return tools.filter((tool) => matchesToolQuery(tool, query));
}
