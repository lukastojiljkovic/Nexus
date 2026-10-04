/**
 * The component palette's own rules: which parts a query admits, and how the
 * list is grouped.
 *
 * Pure, and separate from the page, so the matching can be tested without
 * rendering anything — `toolSearch.ts`'s shape exactly, and for the same
 * reasons. It never touches `strings`: a module that read the copy table at
 * import time would hold a stale Serbian name forever (see `strings.ts`), and
 * the group HEADINGS are the page's business anyway. What this answers is which
 * components, in what order.
 */

import { COMPONENT_KINDS, foldSearchText } from "@nexus/core";
import type { ComponentDef, ComponentKind } from "@nexus/core";

/**
 * The order the palette's sections appear in.
 *
 * `COMPONENT_KINDS` itself rather than a list of the same eight names, so a
 * kind added to the model appears in the palette instead of being silently
 * dropped from it — the failure the export picker had just shipped one module
 * over (`archiveModules.test.ts`). It is already the order a circuit is built
 * in: the board first, then what hangs off it.
 */
export const PALETTE_KINDS: readonly ComponentKind[] = COMPONENT_KINDS;

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
 * Catalogue order rather than a relevance ranking, on `filterTools`' reasoning:
 * the palette is grouped and stable, so somebody who has learned where the
 * DHT22 sits finds it in the same place while typing instead of watching rows
 * reorder under the cursor.
 */
export function filterComponents(
  components: readonly ComponentDef[],
  query: string,
): ComponentDef[] {
  return components.filter((component) => matchesComponentQuery(component, query));
}

/** One section of the palette. */
export interface ComponentGroup {
  readonly kind: ComponentKind;
  readonly components: readonly ComponentDef[];
}

/**
 * The palette's sections, in `PALETTE_KINDS` order, with the empty ones left
 * out.
 *
 * Empty sections are dropped rather than drawn empty because this list is
 * filtered as the user types: eight headings with two parts under one of them
 * is a screen that reads as „mostly nothing here", when the true answer is „two
 * matches".
 */
export function groupComponentsByKind(components: readonly ComponentDef[]): ComponentGroup[] {
  const groups: ComponentGroup[] = [];
  for (const kind of PALETTE_KINDS) {
    const inKind = components.filter((component) => component.kind === kind);
    if (inKind.length > 0) groups.push({ kind, components: inKind });
  }
  return groups;
}

/**
 * What a placed part is CALLED on the bench.
 *
 * The user's own label wins, then the component's name; a component this build
 * does not ship falls through to the caller's placeholder, because „what to
 * call a part we no longer know" is a copy decision and this module holds no
 * copy. The order is the one `CircuitPart.label` documents: an empty label
 * falls back to the part's, which is what somebody who never renamed anything
 * expects to read.
 *
 * **The name arrives already resolved.** It is the caller's job to pass it
 * through `elecLocale.componentName`, because which language to print is a
 * question about the interface and this module deliberately never reads the
 * copy table (see the header). Taking the `ComponentDef` here instead would
 * make the fallback Serbian in an English session, which is the exact defect
 * this signature exists to prevent.
 */
export function partDisplayName(
  label: string,
  fallbackName: string | undefined,
  unknownName: string,
): string {
  const own = label.trim();
  if (own.length > 0) return own;
  return fallbackName ?? unknownName;
}
