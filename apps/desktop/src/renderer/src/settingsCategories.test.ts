import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import { moduleSettingsCards, moduleSettingsDeclarations } from "./moduleSettings.js";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SUB_PAGE_LISTS,
  categoryCardIds,
  categoryListIds,
  categoryOf,
  subPageListById,
  visibleSections,
  type SettingsLocation,
} from "./settingsCategories.js";
import { buildSettingsIndex, foldSettingsQuery, matchSettings } from "./settingsSearch.js";
import { strings } from "./strings.js";

/**
 * SET-015's information architecture, pinned as pure data.
 *
 * The page renders what this table says, so the two things worth failing over
 * are the two the compiler cannot see: a card that no category owns (it would
 * be on the page and unreachable), and a sub-page id that two lists both claim
 * (two rows would open the same card). Both are one `expect` each, and the
 * rest of the file pins `visibleSections`' four states.
 */

// A function, not a module-scope alias, so a language switch is reflected
// here too — see check-string-capture.mjs.
function s(): typeof strings.settings {
  return strings.settings;
}

const REGISTRY = createModuleRegistry();
const INDEX = buildSettingsIndex(REGISTRY);
const SUB_PAGE_IDS = Object.values(SETTINGS_SUB_PAGE_LISTS).flatMap((list) =>
  list.subPages.map((subPage) => subPage.id),
);

function search(query: string): ReturnType<typeof matchSettings> {
  return matchSettings(INDEX, foldSettingsQuery(query));
}

const AT_REST: SettingsLocation = { category: null, sub: null };

// --- the table ----------------------------------------------------------------

describe("the category table", () => {
  it("gives every shell card and every module card exactly one category", () => {
    const explicitCards = SETTINGS_CATEGORIES.flatMap(categoryCardIds);
    // No card is in two categories' `cards` lists.
    expect(new Set(explicitCards).size).toBe(explicitCards.length);

    const moduleIds = new Set(
      moduleSettingsDeclarations(REGISTRY).map((declaration) => declaration.moduleId),
    );
    // Every title in `sectionTitle` is either an explicit card of one category,
    // a sub-page of one list, or a module card, which `categoryOf` files under
    // „Moduli".
    for (const id of Object.keys(s().sectionTitle)) {
      expect(
        explicitCards.includes(id) || SUB_PAGE_IDS.includes(id) || moduleIds.has(id),
        id,
      ).toBe(true);
      expect(SETTINGS_CATEGORIES.map((category) => category.id)).toContain(categoryOf(id));
    }
    // Every module — switched on or off, since the fallback is what handles
    // both — belongs to „Moduli".
    for (const moduleId of moduleIds) expect(categoryOf(moduleId)).toBe("modules");
  });

  it("gives every sub-page id exactly one owning list", () => {
    expect(new Set(SUB_PAGE_IDS).size).toBe(SUB_PAGE_IDS.length);
    expect([...SUB_PAGE_IDS].sort()).toEqual(
      [
        "export-ics",
        "import-apkg",
        "import-archive",
        "import-csv",
        "import-fin-csv",
        "import-ics",
        "import-llm",
        "import-markdown",
      ].sort(),
    );
    for (const id of SUB_PAGE_IDS) expect(categoryOf(id)).toBe("data");
  });

  it("keeps the two lists' rows in the order the brief fixes", () => {
    expect(subPageListById("import-export").subPages.map((subPage) => subPage.id)).toEqual([
      "import-archive",
      "import-ics",
      "export-ics",
      "import-apkg",
      "import-csv",
      "import-fin-csv",
      "import-llm",
      "import-markdown",
    ]);
    // „Podešavanja modula" draws its rows from the registry, so its fixed list
    // is empty by construction.
    expect(subPageListById("module-settings").subPages).toEqual([]);
  });

  it("keeps the categories in the brief's order, with the brief's icons", () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      "profile",
      "appearance",
      "keyboard",
      "modules",
      "notifications",
      "data",
      "privacy",
      "about",
    ]);
    expect(SETTINGS_CATEGORIES.map((category) => category.icon)).toEqual([
      "person",
      "palette",
      "keyboard",
      "grid",
      "bell",
      "database",
      "shield",
      "info",
    ]);
  });

  it("interleaves the two sub-page lists where the brief puts them", () => {
    const data = SETTINGS_CATEGORIES.find((category) => category.id === "data");
    const modules = SETTINGS_CATEGORIES.find((category) => category.id === "modules");
    expect(data && categoryCardIds(data)).toEqual(["backup", "sync", "content-packs"]);
    expect(data && categoryListIds(data)).toEqual(["import-export"]);
    expect(modules && categoryCardIds(modules)).toEqual(["setup", "modules", "packs", "risk"]);
    expect(modules && categoryListIds(modules)).toEqual(["module-settings"]);
  });

  it("puts the network card FIRST in the privacy category (ADR-089)", () => {
    const privacy = SETTINGS_CATEGORIES.find((category) => category.id === "privacy");
    expect(privacy && categoryCardIds(privacy)).toEqual(["network", "privacy"]);
    expect(categoryOf("network")).toBe("privacy");
  });

  it("reaches the network card by its name and by the words people type", () => {
    // The card's own title is matched by `matchSettings`, and the entries above
    // are what make „mreza", „azuriranja" and „github" land on it.
    expect(search(s().sectionTitle.network).sections.has("network")).toBe(true);
    for (const query of ["mreza", "azuriranja", "github", "update"]) {
      expect(search(query).sections.has("network"), query).toBe(true);
    }
  });

  it("reaches the content packs card by its name and by the words people type (ADR-091)", () => {
    // A device card in „Podaci", and one no module owns: the card is the only
    // place a pack can arrive, so a search has to be able to find it.
    expect(categoryOf("content-packs")).toBe("data");
    expect(search(s().sectionTitle["content-packs"]).sections.has("content-packs")).toBe(true);
    for (const query of ["paket", "vikipedija", "offline", "instaliraj"]) {
      expect(search(query).sections.has("content-packs"), query).toBe(true);
    }
  });
});

// --- visibleSections ----------------------------------------------------------

describe("visibleSections", () => {
  it("shows a category's own cards and its list, and nothing else", () => {
    const visibility = visibleSections({ category: "profile", sub: null }, null);
    expect([...visibility.cards].sort()).toEqual(["profile", "profiles", "security"]);
    expect(visibility.lists.size).toBe(0);
    expect(visibility.groups).toEqual(["profile"]);

    const data = visibleSections({ category: "data", sub: null }, null);
    expect([...data.cards].sort()).toEqual(["backup", "content-packs", "sync"]);
    expect([...data.lists]).toEqual(["import-export"]);
    expect(data.groups).toEqual(["data"]);
  });

  it("shows one sub-page card when a sub-page is open, in its parent's group", () => {
    const visibility = visibleSections({ category: "data", sub: "import-llm" }, null);
    expect([...visibility.cards]).toEqual(["import-llm"]);
    expect(visibility.lists.size).toBe(0);
    expect(visibility.groups).toEqual(["data"]);
  });

  it("shows nothing but the root list's owner when no category is chosen", () => {
    const visibility = visibleSections(AT_REST, null);
    expect(visibility.cards.size).toBe(0);
    expect(visibility.lists.size).toBe(0);
    expect(visibility.groups).toEqual([]);
  });

  it("spans categories under a query, in category order, with no lists", () => {
    const visibility = visibleSections(AT_REST, {
      sections: new Set(["profile", "notes", "export-ics"]),
      hits: new Set(),
    });
    expect([...visibility.cards].sort()).toEqual(["export-ics", "notes", "profile"]);
    expect(visibility.lists.size).toBe(0);
    // `notes` is a module card, so its group is „Moduli" — that fallback is
    // what makes a search for any module land under the right heading.
    expect(visibility.groups).toEqual(["profile", "modules", "data"]);
  });

  it("keeps nothing visible when the query matches nothing", () => {
    const visibility = visibleSections(AT_REST, search("qqqqzzzz"));
    expect(visibility.cards.size).toBe(0);
    expect(visibility.lists.size).toBe(0);
    expect(visibility.groups).toEqual([]);
  });

  it("still reaches a switched-off module's card by search — the flag gates the page, not the filter", () => {
    // PRIV ships disabled: its card is not drawn and its row is not in the
    // module list, but the index keeps it and visibility resolves it under
    // „Moduli" all the same.
    expect(moduleSettingsCards(REGISTRY, {}).map((card) => card.moduleId)).not.toContain("priv");
    expect(INDEX.sections.map((section) => section.id)).toContain("priv");
    expect(INDEX.entries.some((entry) => entry.section === "priv")).toBe(true);
    const visibility = visibleSections(AT_REST, { sections: new Set(["priv"]), hits: new Set() });
    expect(visibility.cards.has("priv")).toBe(true);
    expect(visibility.groups).toEqual(["modules"]);
  });

  it("keeps the backup, import and export cards in one category across the split", () => {
    const visibility = visibleSections(AT_REST, search("ics"));
    expect(visibility.cards.has("import-ics")).toBe(true);
    expect(visibility.cards.has("export-ics")).toBe(true);
    expect(visibility.cards.has("backup")).toBe(false);
    expect(visibility.groups).toEqual(["data"]);
  });
});
