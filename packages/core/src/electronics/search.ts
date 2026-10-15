/**
 * Which catalogue components a search admits — the palette's search and the
 * assistant's `electronics.parts` are the same question, so the answer lives
 * here, and the two cannot disagree about „vlaga" → DHT22.
 *
 * Pure, and free of copy: the palette keeps its grouping and headings in the
 * renderer, and the assistant answers in the user's language from the component's
 * own names.
 */

import { foldSearchText } from "../search/searchText.js";
import type { ComponentDef } from "./component.js";

/**
 * The words one component can be found by.
 *
 * Its name and its summary in BOTH languages, because that is what somebody
 * types („vlaga", „ultrazvuk", "humidity", "ultrasonic"), and a field that
 * understood only the language the UI happens to be in would refuse the other
 * half of the people who know exactly which part they want. Its id, because the
 * slugs are what a person who has read the generated sketch will remember; its
 * protocols, because „i2c" is a real way to ask this list a question; and its
 * library.
 *
 * **Not the pin labels.** Nearly every part has a GND and a VCC, so folding
 * them in would make those two queries return the whole catalogue — a search
 * that matches everything is the same as no search.
 */
function searchableText(component: ComponentDef): string {
  return foldSearchText(
    [
      component.name,
      component.summary,
      component.nameEn ?? "",
      component.summaryEn ?? "",
      component.id,
      component.library ?? "",
      ...component.buses.map((bus) => bus.kind),
    ].join(" "),
  );
}

/** Whether one component answers a query. An empty query matches everything — a blank field is not a filter. */
export function matchesComponentQuery(component: ComponentDef, query: string): boolean {
  const terms = foldSearchText(query.trim())
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return true;
  const text = searchableText(component);
  return terms.every((term) => text.includes(term));
}

/**
 * The components a query admits, in catalogue order.
 *
 * Catalogue order rather than a relevance ranking: the palette is grouped and
 * stable, so somebody who has learned where the DHT22 sits finds it in the same
 * place while typing instead of watching rows reorder under the cursor.
 */
export function filterComponents(
  components: readonly ComponentDef[],
  query: string,
): ComponentDef[] {
  return components.filter((component) => matchesComponentQuery(component, query));
}
