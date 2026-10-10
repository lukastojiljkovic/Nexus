import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY, visibleModuleSet } from "../../shared/moduleVisibility.js";
import {
  SYNC_HELD_SETTINGS_CARD_IDS,
  SYNC_ON_HOLD,
  isSettingsCardHeld,
} from "../../shared/syncHold.js";
import {
  moduleSettingsCardIds,
  moduleSettingsCards,
  moduleSettingsDeclarations,
} from "./moduleSettings.js";
import {
  SETTINGS_SHELL_CARDS,
  SETTINGS_CATEGORIES,
  SETTINGS_SUB_PAGE_LISTS,
  categoryCardIds,
  categoryListIds,
  categoryOf,
  moduleSettingsLocation,
  subPageListById,
  visibleSections,
  type SettingsLocation,
} from "./settingsCategories.js";
import { buildSettingsIndex, foldSettingsQuery, matchSettings } from "./settingsSearch.js";
import { strings } from "./strings.js";

const here = dirname(fileURLToPath(import.meta.url));

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
/** The device's visible set for an arrangement nothing has touched (ADR-101) — the app as it ships. */
const VISIBLE = visibleModuleSet(REGISTRY, DEFAULT_SHELL_VISIBILITY);
const INDEX = buildSettingsIndex(REGISTRY, VISIBLE);
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
    // „Moduli" — except a card the hold hides, which belongs to no category
    // because it is not drawn at all.
    for (const id of Object.keys(s().sectionTitle)) {
      if (isSettingsCardHeld(id)) continue;
      expect(
        explicitCards.includes(id) || SUB_PAGE_IDS.includes(id) || moduleIds.has(id),
        id,
      ).toBe(true);
      expect(SETTINGS_CATEGORIES.map((category) => category.id)).toContain(categoryOf(id));
    }
    // The skip above is the hold's own list and nothing else, so the two cannot
    // drift into hiding a card nobody decided to hide.
    for (const heldId of SYNC_HELD_SETTINGS_CARD_IDS) {
      expect(explicitCards.includes(heldId)).toBe(false);
      expect(Object.keys(s().sectionTitle)).toContain(heldId);
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
    expect(data && categoryCardIds(data)).toEqual(["backup", "content-packs"]);
    expect(data && categoryListIds(data)).toEqual(["import-export"]);
    expect(modules && categoryCardIds(modules)).toEqual(["setup", "modules", "packs", "risk"]);
    expect(modules && categoryListIds(modules)).toEqual(["module-settings"]);
  });

  it("hides every card whose work is ON HOLD, in the categories and in search", () => {
    // The card is real copy in the table (hide, do not delete) …
    expect(SYNC_ON_HOLD).toBe(true);
    expect(SYNC_HELD_SETTINGS_CARD_IDS).not.toEqual([]);
    for (const heldId of SYNC_HELD_SETTINGS_CARD_IDS) {
      expect(s().sectionTitle).toHaveProperty(heldId);
      // … and nothing the page draws claims it.
      for (const category of SETTINGS_CATEGORIES) {
        expect(categoryCardIds(category), `${category.id}/${heldId}`).not.toContain(heldId);
      }
      // Its own title, and the words its search entries carried, find no card.
      const title =
        s().sectionTitle[heldId as keyof typeof strings.settings.sectionTitle];
      expect(search(title).sections.has(heldId)).toBe(false);
      expect(search("sinhronizacija").sections.has(heldId)).toBe(false);
      expect(search("cloud").sections.has(heldId)).toBe(false);
    }
  });

  it("puts the network card FIRST in the privacy category (ADR-089)", () => {
    const privacy = SETTINGS_CATEGORIES.find((category) => category.id === "privacy");
    expect(privacy && categoryCardIds(privacy)).toEqual(["network", "privacy"]);
    expect(categoryOf("network")).toBe("privacy");
  });

  /**
   * The list and the page, read back out of the page's own source.
   *
   * `SETTINGS_SHELL_CARDS` is what the screenshot sweep builds one scene per
   * entry from, so this is the one assertion that keeps the frames honest in
   * both directions: an id in the list that the page does not draw is a probe
   * scrolling to nothing under a card's name (and the harness reports a miss
   * rather than a frame), while a card the page draws that is not in the list is
   * a surface no sweep will ever photograph — which is the state this whole
   * list was added to end.
   *
   * The page cannot be GENERATED from the table (each card's body is written by
   * hand), so the agreement is asserted rather than assumed. The order is part
   * of it: the sweep visits the scenes in this list's order, which is the page's
   * own.
   */
  describe("shell cards and the page", () => {
    const source = readFileSync(join(here, "SettingsPage.tsx"), "utf8");
    // Every place the page gives a card its DOM id. The definition of
    // `sectionDomId` is not a call site and does not wear `id={…}`.
    const drawn = [...source.matchAll(/\bid=\{sectionDomId\(([^)]*)\)\}/g)].map(
      (match) => match[1]?.trim() ?? "",
    );
    const literal = /^"[a-z0-9-]+"$/;

    it("are exactly the cards the page draws, in the page's own order", () => {
      // A vacuous read is the failure this suite exists to make impossible: a
      // regex that matched nothing would agree with an empty list.
      expect(drawn.length).toBeGreaterThan(20);
      // A card the hold hides keeps its call site behind `SYNC_ON_HOLD ? null :`
      // and draws nothing, which is why the table leaves it out too.
      const ids = drawn.filter((argument) => literal.test(argument)).map((a) => a.slice(1, -1));
      expect(ids.filter((id) => !isSettingsCardHeld(id))).toEqual(
        SETTINGS_SHELL_CARDS.map((card) => card.id),
      );
    });

    /**
     * The other direction, and the half that keeps the assertion above from
     * going blind: an id the page COMPUTES cannot be in any list here, and it is
     * exactly a card the sweep cannot name. One call site is like that, the
     * module cards, whose ids the registry owns — and every module card already
     * has a derived scene of its own.
     */
    it("leave no card id to the page to compute, apart from the module cards", () => {
      expect(drawn.filter((argument) => !literal.test(argument))).toEqual(["card.moduleId"]);
    });

    it("gives every shell card a category and, where a list owns it, that list", () => {
      for (const card of SETTINGS_SHELL_CARDS) {
        expect(categoryOf(card.id), card.id).toBe(card.category);
        if (card.sub !== null) {
          expect(
            subPageListById("import-export").subPages.some((subPage) => subPage.id === card.sub),
            card.id,
          ).toBe(true);
        }
      }
      // And no shell card wears a module's id, which the sweep's two derivations
      // would otherwise file under one stem (`settings-card-<id>`).
      const moduleIds = new Set(
        moduleSettingsDeclarations(REGISTRY).map((declaration) => declaration.moduleId),
      );
      for (const card of SETTINGS_SHELL_CARDS) expect(moduleIds.has(card.id), card.id).toBe(false);
    });
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

/**
 * The gear's landing (`moduleSettingsGear.tsx`): a module page's button opens
 * „Podešavanja" at that module's card. Both halves of that sentence are pinned
 * here — the CATEGORY the rail selects, and the CARD the pane draws — because
 * the location is what `visibleSections` is handed, and a gear that opened the
 * right category with nothing in it, or the right card under the wrong heading,
 * would look like a working button.
 */
describe("moduleSettingsLocation", () => {
  it("lands on the module's own card, in „Moduli“, for every module that has one", () => {
    for (const moduleId of moduleSettingsCardIds(REGISTRY)) {
      const location = moduleSettingsLocation(moduleId);
      expect(location, moduleId).toEqual({ category: "modules", sub: moduleId });
      // The pane: exactly that card, nothing else...
      const visibility = visibleSections(location, null);
      expect([...visibility.cards], moduleId).toEqual([moduleId]);
      // ...under the one heading that owns it, which is also what the rail
      // highlights while the press is showing.
      expect(visibility.groups, moduleId).toEqual(["modules"]);
    }
  });

  it("is the same place the „Podešavanja modula“ row opens, so one card has one destination", () => {
    // The list row calls `navigate({ category: "modules", sub: card.moduleId })`;
    // the gear composes the same pair from the module id alone.
    for (const card of moduleSettingsCards(REGISTRY, VISIBLE)) {
      expect(moduleSettingsLocation(card.moduleId)).toEqual({
        category: "modules",
        sub: card.moduleId,
      });
    }
  });

  it("is not the category alone — a module's card is a sub-page of the „Podešavanja modula“ list", () => {
    // The distinction the gear has to get right: at rest the „Moduli" category
    // shows setup/modules/packs/risk and the LIST, never a module's card.
    const categoryAtRest = visibleSections({ category: "modules", sub: null }, null);
    expect(categoryAtRest.cards.has("notes")).toBe(false);
    expect(categoryAtRest.lists.has("module-settings")).toBe(true);
  });
});

describe("visibleSections", () => {
  it("shows a category's own cards and its list, and nothing else", () => {
    const visibility = visibleSections({ category: "profile", sub: null }, null);
    expect([...visibility.cards].sort()).toEqual(["profile", "profiles", "security"]);
    expect(visibility.lists.size).toBe(0);
    expect(visibility.groups).toEqual(["profile"]);

    const data = visibleSections({ category: "data", sub: null }, null);
    expect([...data.cards].sort()).toEqual(["backup", "content-packs"]);
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

  it("takes a HIDDEN module out of the filter as well as off the page (ADR-101)", () => {
    // PRIV ships off, so the shipped arrangement hides it: its card is not
    // drawn, and its section and its controls are not indexed either — a hit
    // that resolved to a card the page does not draw is a filter pointing at
    // nothing. Where the reader goes instead is the „Prikaz" card, which lists
    // every module by name and carries the switch that brings this one back.
    expect(moduleSettingsCards(REGISTRY, VISIBLE).map((card) => card.moduleId)).not.toContain(
      "priv",
    );
    expect(INDEX.sections.map((section) => section.id)).not.toContain("priv");
    expect(INDEX.entries.some((entry) => entry.section === "priv")).toBe(false);
    // The card that CAN reach it: „Prikaz" is a section of this page, and its
    // entry answers to the words somebody hunting for a module switch types.
    expect(INDEX.sections.map((section) => section.id)).toContain("modules");
    expect(INDEX.entries.some((entry) => entry.id === "modules-display")).toBe(true);
    // And `visibleSections` still resolves a section it is HANDED, whatever the
    // index decided: it answers about a location, not about membership.
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
