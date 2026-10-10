/**
 * SET-015: the settings page's information architecture, as DATA.
 *
 * Podešavanja used to be twenty-seven cards in one column with a chip index
 * above them and an eleven-part „Rezervna kopija" card at the bottom. This
 * module is the whole of the replacement's shape: eight categories, two
 * sub-page lists, and the pure lookups that answer which cards a category shows
 * and where one id lives. The page itself decides nothing about order or
 * membership — it renders what this table says and hides the rest with the
 * class `settingsSearch.sectionClass` already produces.
 *
 * **Why it is here rather than beside the page.** It lived in the renderer
 * (`settingsCategories.ts`) until the shell's own cards turned out to be
 * invisible to the screenshot sweep: the per-module settings scenes are derived
 * from `shared/modules.ts`, which main reads, and the shell's cards were in no
 * list main could read at all, so nothing photographed them. `SETTINGS_SHELL_CARDS`
 * below is that list, and moving the table into `src/shared` is what makes it
 * one list rather than two ([[DC-109]]: a hand-kept copy of a generated list
 * fails by omission, and an omitted card looks exactly like a card that is
 * fine).
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

import { isSettingsCardHeld } from "./syncHold.js";

/**
 * The icon a category's rail row and a sub-page's list row draws.
 *
 * Spelled as a literal rather than as `@nexus/ui`'s `IconName`, and the reason
 * is structural rather than stylistic: `@nexus/ui`'s entry point is raw `.tsx`
 * SOURCE, and this module is read by the MAIN process as well, whose tsconfig
 * has neither `jsx` nor the DOM lib — a type-only import of it from here pulls
 * the whole design system into that program and fails it. The check is not
 * lost, only moved: each of these is handed to `NavItem`/`Icon` in
 * `SettingsPage.tsx`, where it has to be an `IconName` to compile.
 */
export type SettingsIcon =
  | "person"
  | "palette"
  | "keyboard"
  | "grid"
  | "bell"
  | "database"
  | "shield"
  | "info"
  | "import"
  | "export";

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
  readonly icon: SettingsIcon;
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
  readonly icon: SettingsIcon;
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
 * **The order of the entries is the order the page draws its cards in**, and
 * that is a promise rather than a coincidence: `SettingsPage.tsx` writes each
 * card's body by hand and cannot be generated from this table, so
 * `settingsCategories.test.ts` reads the page's own `sectionDomId("…")` call
 * sites back and fails if the two lists disagree about an id or about their
 * order. A card added here without a body would scroll to nothing and the
 * sweep's probe would report a miss; a card drawn there without an entry here
 * would be photographed by nothing at all.
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
      // ADR-091. Last in „Podaci", beside „Sinhronizacija", because the two are
      // the device's two ways of growing content it did not make: sync brings
      // this profile's own data back, and a pack brings in somebody else's
      // library. It is not a module card (a pack is content, not a part of the
      // app) and it is not a privacy card (nothing here reaches the network).
      { kind: "card", id: "content-packs" },
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

/**
 * Where a module page's gear lands (see `moduleSettingsGear.tsx`): that
 * module's CARD, which SET-015 keeps two levels deep — its category, then the
 * card as that category's sub-page. For a module both halves are already known:
 * `categoryOf` files every id this table does not recognise under „Moduli", and
 * a module's card IS its section id, so no module has to be named here and a
 * module added to the registry needs no edit.
 *
 * The card rather than the category alone, deliberately: a module's card is a
 * row of the „Podešavanja modula" list — `visibleSections` shows the cards a
 * category owns at rest and no sub-page — so opening „Moduli" and stopping
 * there would leave the reader one click short of what they pressed the gear
 * for.
 */
export function moduleSettingsLocation(moduleId: string): SettingsLocation {
  return { category: categoryOf(moduleId), sub: moduleId };
}

/** One of the page's own cards, and the route a reader takes to reach it. */
export interface SettingsShellCard {
  /** The card's DOM id: `set-section-<id>`, and the key `strings.settings.sectionTitle` names it by. */
  readonly id: string;
  /** The category the page must be showing for this card to be drawn at all. */
  readonly category: CategoryId;
  /**
   * The sub-page this card IS when a list owns it, `null` when its category
   * draws it directly. A sub-page card is hidden until its list row is clicked,
   * and a `display: none` element is not scrollable — which is the whole reason
   * this field exists rather than a bare id list.
   */
  readonly sub: string | null;
}

/**
 * Every shell card the page draws, in page order.
 *
 * The sweep builds one scene per entry here, the way it builds one per module
 * card from the registry, so a card added to the table above gets a frame in the
 * same commit that adds the card. The shell's two BANNERS — the restore-undo
 * offer and the unsaved-exit notice — are NOT here and cannot be: they are
 * shell state rather than a card, neither has a DOM id of this shape, and
 * reaching either takes a fault the sweep causes on purpose rather than a
 * place to click. `docs/STATUS.md` §4.1 item 9 records that gap.
 */
export const SETTINGS_SHELL_CARDS: readonly SettingsShellCard[] = SETTINGS_CATEGORIES.flatMap(
  (category): readonly SettingsShellCard[] =>
    category.entries.flatMap((entry): readonly SettingsShellCard[] =>
      entry.kind === "card"
        ? [{ id: entry.id, category: category.id, sub: null }]
        : subPageListById(entry.id).subPages.map((subPage) => ({
            id: subPage.id,
            category: category.id,
            sub: subPage.id,
          })),
    ),
);
