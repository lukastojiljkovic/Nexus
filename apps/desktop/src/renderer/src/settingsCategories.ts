import type { IconName } from "@nexus/ui";

import { isSettingsCardHeld } from "../../shared/syncHold.js";
import type { SettingsSearchResult } from "./settingsSearch.js";

/**
 * SET-015: the settings page's information architecture.
 *
 * Podešavanja used to be twenty-seven cards in one column with a chip index
 * above them and an eleven-part „Rezervna kopija" card at the bottom. This
 * module is the whole of the replacement's shape: eight categories, two
 * sub-page lists, and one pure function that answers which cards a location
 * (or a search) makes visible. The page itself decides nothing about order or
 * membership — it renders what this table says and hides the rest with the
 * class `settingsSearch.sectionClass` already produces.
 *
 * Everything here is data plus string ids, never copy and never a component.
 * The titles resolve through `strings.ts` at the page's render time, so a
 * language switch relabels the rail and the headings without rebuilding this
 * table — the same rule `settingsSearch.shellEntries` follows.
 *
 * Deliberately no registry: module cards are dynamic (`moduleSettingsCards`
 * gates them by flag), and the one thing this module needs to know about them
 * is that every id it does not recognise is a module card, which is what
 * `categoryOf`'s fallback says.
 */

/** The eight categories, in the order the rail lists them and the page renders them. */
export type CategoryId =
  | "profile"
  | "appearance"
  | "keyboard"
  | "modules"
  | "notifications"
  | "data"
  | "privacy"
  | "about";

/** The two sub-page lists — a card of rows, each row opening one sub-page card. */
export type SettingsSubPageListId = "module-settings" | "import-export";

/** One row of a sub-page list, and the card it opens. */
export interface SettingsSubPage {
  readonly id: string;
  readonly icon: IconName;
}

export interface SettingsSubPageList {
  readonly id: SettingsSubPageListId;
  /**
   * The list's own name, as a key inside `strings.settings`. The page resolves
   * it with `strings.settings[titleKey]`, so the table carries no words.
   */
  readonly titleKey: "moduleSettingsList" | "importExportList";
  /**
   * The fixed rows. „Podešavanja modula" is empty on purpose: its rows are one
   * per module card this build actually draws, which only the registry knows.
   */
  readonly subPages: readonly SettingsSubPage[];
}

/**
 * The import/export list's eight rows, in the order the brief fixes. Seven
 * importers plus the calendar export, which used to be the fourth of eleven
 * blocks inside „Rezervna kopija" and is a different act from a backup.
 */
const IMPORT_EXPORT_SUB_PAGES: readonly SettingsSubPage[] = [
  { id: "import-archive", icon: "import" },
  { id: "import-ics", icon: "import" },
  { id: "export-ics", icon: "export" },
  { id: "import-apkg", icon: "import" },
  { id: "import-csv", icon: "import" },
  { id: "import-fin-csv", icon: "import" },
  { id: "import-llm", icon: "import" },
  { id: "import-markdown", icon: "import" },
];

export const SETTINGS_SUB_PAGE_LISTS: Readonly<Record<SettingsSubPageListId, SettingsSubPageList>> = {
  "module-settings": {
    id: "module-settings",
    titleKey: "moduleSettingsList",
    subPages: [],
  },
  "import-export": {
    id: "import-export",
    titleKey: "importExportList",
    subPages: IMPORT_EXPORT_SUB_PAGES,
  },
};

/** A category is an ordered run of cards with, for modules and data, one list interleaved where it belongs. */
export type SettingsCategoryEntry =
  | { readonly kind: "card"; readonly id: string }
  | { readonly kind: "list"; readonly id: SettingsSubPageListId };

export interface SettingsCategory {
  readonly id: CategoryId;
  readonly icon: IconName;
  /**
   * The cards this category shows at rest, and the list it offers, in render
   * order. Cards that live in a sub-page are deliberately absent: they are
   * reachable only through their list.
   */
  readonly entries: readonly SettingsCategoryEntry[];
}

/**
 * The eight categories, in the order the brief fixes. The module cards this
 * build draws are NOT entries here — they are the sub-pages of the
 * „Podešavanja modula" list, and the page appends them where that list sits.
 *
 * This is the FULL shape, sync card and all, and it is deliberately not what
 * the page renders: {@link SETTINGS_CATEGORIES} below drops the cards whose
 * work is ON HOLD, so the table stays the statement of the information
 * architecture rather than a second version of it.
 */
const CATEGORY_TABLE: readonly SettingsCategory[] = [
  {
    id: "profile",
    icon: "person",
    entries: [
      { kind: "card", id: "profile" },
      { kind: "card", id: "profiles" },
      { kind: "card", id: "security" },
    ],
  },
  {
    id: "appearance",
    icon: "palette",
    entries: [{ kind: "card", id: "appearance" }],
  },
  {
    id: "keyboard",
    icon: "keyboard",
    entries: [{ kind: "card", id: "shortcuts" }],
  },
  {
    id: "modules",
    icon: "grid",
    entries: [
      { kind: "card", id: "setup" },
      { kind: "card", id: "modules" },
      // „Paketi alatki" immediately after „Moduli", because the two answer the
      // same question at two depths: which parts of Nexus this profile has, and
      // which trades' tools the one drawer among them carries.
      { kind: "card", id: "packs" },
      // And right after the toolkits, because it is the long form of what those
      // toolkits' tools say short.
      { kind: "card", id: "risk" },
      { kind: "list", id: "module-settings" },
    ],
  },
  {
    id: "notifications",
    icon: "bell",
    entries: [{ kind: "card", id: "notifications" }],
  },
  {
    id: "data",
    icon: "database",
    entries: [
      { kind: "card", id: "backup" },
      { kind: "list", id: "import-export" },
      // Between the backup/restore card and „Privatnost", because it is the
      // third answer to „where does a copy of my data go" — and the privacy
      // card's own `sync` sentence reads as a summary of the card just above it.
      { kind: "card", id: "sync" },
    ],
  },
  {
    id: "privacy",
    icon: "shield",
    entries: [
      // ADR-089 FIRST in this category, before „Podaci i privatnost": it is the
      // device-level decision about whether Nexus may reach the network at all,
      // and the card below it describes what is stored. A reader who came to
      // „Privatnost" to find out what leaves the machine meets the switch
      // before the prose.
      { kind: "card", id: "network" },
      { kind: "card", id: "privacy" },
    ],
  },
  {
    id: "about",
    icon: "info",
    entries: [
      { kind: "card", id: "about" },
      { kind: "card", id: "licences" },
    ],
  },
];

/**
 * The categories the page renders: {@link CATEGORY_TABLE} with every card whose
 * work is ON HOLD removed (`shared/syncHold.ts`).
 *
 * One filter rather than a second hand-kept table, because two tables would
 * drift: the search index, the rail's counts and the page itself all read this
 * one, so a card the hold hides cannot be found by any of them. Turning sync
 * back on is flipping `SYNC_ON_HOLD`, and this line needs no edit.
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = CATEGORY_TABLE.map((category) => ({
  ...category,
  entries: category.entries.filter(
    (entry) => entry.kind !== "card" || !isSettingsCardHeld(entry.id),
  ),
}));

export function categoryById(id: CategoryId): SettingsCategory {
  const category = SETTINGS_CATEGORIES.find((candidate) => candidate.id === id);
  // Unreachable through the typed ids; a runtime lookup keeps the call sites
  // free of non-null assertions, and a wrong id becomes a visible empty pane.
  return category ?? SETTINGS_CATEGORIES[0]!;
}

export function subPageListById(id: SettingsSubPageListId): SettingsSubPageList {
  return SETTINGS_SUB_PAGE_LISTS[id];
}

/** The card ids a category shows at rest, in render order. */
export function categoryCardIds(category: SettingsCategory): string[] {
  return category.entries.flatMap((entry) => (entry.kind === "card" ? [entry.id] : []));
}

/** The list ids a category offers at rest, in render order. */
export function categoryListIds(category: SettingsCategory): SettingsSubPageListId[] {
  return category.entries.flatMap((entry) => (entry.kind === "list" ? [entry.id] : []));
}

/**
 * Which category a card belongs to. A sub-page belongs to the category that
 * owns its list, and every id this table does not know is a MODULE card —
 * modules are dynamic, `@nexus/core` owns their catalogue, and SET-015 puts
 * all of them under „Moduli". That fallback is why adding a module to
 * `shared/modules.ts` needs no edit here.
 */
export function categoryOf(sectionId: string): CategoryId {
  for (const category of SETTINGS_CATEGORIES) {
    if (categoryCardIds(category).includes(sectionId)) return category.id;
    for (const listId of categoryListIds(category)) {
      if (subPageListById(listId).subPages.some((subPage) => subPage.id === sectionId)) {
        return category.id;
      }
    }
  }
  return "modules";
}

/** Where the page is: a category, a sub-page, or — with both null — the narrow root list. */
export interface SettingsLocation {
  readonly category: CategoryId | null;
  readonly sub: string | null;
}

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
