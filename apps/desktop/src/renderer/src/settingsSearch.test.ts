import { foldSearchText } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import { moduleSettingsDeclarations, settingsEntryId } from "./moduleSettings.js";
import {
  buildSettingsIndex,
  foldSettingsQuery,
  labelClass,
  matchSettings,
  moduleEntryId,
  sectionClass,
  shortcutEntryId,
  type SettingsSearchEntry,
  type SettingsSectionId,
} from "./settingsSearch.js";
import { strings } from "./strings.js";

/**
 * SET-014's filter index. Everything here is pure — no storage, no clock, no
 * IPC — so the only setup is the real module registry, which is what the page
 * itself hands `buildSettingsIndex`.
 *
 * Serbian copy is never re-spelled: every query is derived from `strings.ts`
 * through `foldSettingsQuery`, which is also what pins the folding contract
 * („Noć" must be reachable by typing "noc") without this file owning a second
 * copy of the words. The same discipline now covers the module cards, whose
 * entries are DERIVED from each module's `SettingsPanel` declaration — so what
 * is asserted below is the derivation, never a hand-copied twin of it.
 */

const s = strings.settings;
const INDEX = buildSettingsIndex(createModuleRegistry());
const ENTRIES = INDEX.entries;
const SECTION_IDS = Object.keys(s.sectionTitle) as SettingsSectionId[];

/** The page's own call shape: a raw string in, a result out. */
function search(query: string): ReturnType<typeof matchSettings> {
  return matchSettings(INDEX, foldSettingsQuery(query));
}

function entryById(id: string): SettingsSearchEntry {
  const entry = ENTRIES.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Test setup: no settings entry "${id}".`);
  return entry;
}

// --- foldSettingsQuery --------------------------------------------------------

describe("foldSettingsQuery", () => {
  it("yields no terms for an empty or all-whitespace query", () => {
    expect(foldSettingsQuery("")).toEqual([]);
    expect(foldSettingsQuery("   ")).toEqual([]);
    expect(foldSettingsQuery("\t \n")).toEqual([]);
  });

  it("splits on any run of whitespace and drops the empties", () => {
    expect(foldSettingsQuery("  tema   boja  ")).toEqual(["tema", "boja"]);
  });

  it("folds Serbian orthography down to the plain form the index is matched in", () => {
    expect(foldSettingsQuery(strings.app.themeNoc)).toEqual(["noc"]);
    expect(foldSettingsQuery("Prečice")).toEqual(["precice"]);
    expect(foldSettingsQuery("Đorđe")).toEqual(["djordje"]);
  });
});

// --- matchSettings, empty query ----------------------------------------------

describe("matchSettings with nothing typed", () => {
  it("keeps every section and highlights nothing", () => {
    const result = matchSettings(INDEX, []);
    expect([...result.sections].sort()).toEqual([...SECTION_IDS].sort());
    expect(result.hits.size).toBe(0);
  });

  it("treats an all-whitespace query as nothing typed", () => {
    const result = search("   ");
    expect(result.sections.size).toBe(SECTION_IDS.length);
    expect(result.hits.size).toBe(0);
  });
});

// --- matchSettings, real queries ---------------------------------------------

describe("matchSettings", () => {
  it("highlights the entry whose own label matched, and keeps its section", () => {
    const result = search(s.notes.widthLabel);
    expect(result.hits.has(settingsEntryId("notes", "width"))).toBe(true);
    expect([...result.sections]).toEqual(["notes"]);
  });

  it("highlights an entry reached only through its keywords", () => {
    const result = search("preimenuj");
    expect(result.hits.has("profile-name")).toBe(true);
    expect([...result.sections]).toEqual(["profile"]);
  });

  it("folds BOTH sides — the dark theme is found by typing it without diacritics", () => {
    expect(entryById("appearance-theme").keywords).toContain(strings.app.themeNoc);
    const folded = search("noc");
    expect(folded.hits.has("appearance-theme")).toBe(true);
    expect(folded.sections.has("appearance")).toBe(true);
    // The diacritic spelling folds to the same terms, so it finds the same thing.
    expect([...search(strings.app.themeNoc).hits]).toEqual([...folded.hits]);
  });

  it("keeps a whole card when its TITLE matched, even with no entry hit inside it", () => {
    const result = search(s.sectionTitle.security);
    expect(result.sections.has("security")).toBe(true);
    const securityEntries = ENTRIES.filter((entry) => entry.section === "security");
    expect(securityEntries.length).toBeGreaterThan(0);
    expect(securityEntries.some((entry) => result.hits.has(entry.id))).toBe(false);
  });

  it("keeps a MODULE's card by its declared title, which is that card's own heading", () => {
    // The module cards' titles come from the manifest's `titleKey` now, so this
    // is what pins that the declaration still resolves to the drawn heading.
    const result = search(s.sectionTitle.study);
    expect(result.sections.has("study")).toBe(true);
  });

  it("drops every section that neither matched itself nor holds a match", () => {
    const result = search("preimenuj");
    for (const sectionId of SECTION_IDS) {
      if (sectionId === "profile") continue;
      expect(result.sections.has(sectionId), sectionId).toBe(false);
    }
  });

  it("keeps nothing at all when a term matches nowhere", () => {
    const result = search("qqqqzzzz");
    expect(result.sections.size).toBe(0);
    expect(result.hits.size).toBe(0);
  });

  it("requires EVERY term, so extra words narrow rather than widen", () => {
    const wide = search("beleske");
    const narrow = search("beleske markdown");
    expect(wide.hits.has(settingsEntryId("notes", "width"))).toBe(true);
    expect(wide.hits.has(settingsEntryId("notes", "markdown"))).toBe(true);
    expect(narrow.hits.has(settingsEntryId("notes", "markdown"))).toBe(true);
    expect(narrow.hits.has(settingsEntryId("notes", "width"))).toBe(false);
  });

  it("matches on a plain substring, not on a word prefix", () => {
    // Deliberate divergence from `matchCommands` — see the module's own comment.
    const label = foldSearchText(s.notes.widthLabel);
    const middle = label.slice(2, 6);
    expect(middle.length).toBeGreaterThan(0);
    expect(search(middle).hits.has(settingsEntryId("notes", "width"))).toBe(true);
  });

  it("finds a module gallery row by the name the sidebar prints", () => {
    const result = search(strings.modules.notes ?? "");
    expect(result.hits.has(moduleEntryId("notes"))).toBe(true);
    expect(result.sections.has("modules")).toBe(true);
  });

  it("finds a shortcut row by the action's own Serbian label", () => {
    const result = search(strings.shortcuts.actions.lock);
    expect(result.hits.has(shortcutEntryId("lock"))).toBe(true);
    expect(result.sections.has("shortcuts")).toBe(true);
  });

  it("finds the search-history control (SRCH-009) on the privacy card, by its label and by its words", () => {
    // A hand-composed SHELL entry: search is not a module, so this control can
    // never arrive through `moduleSettingsEntries` — the assertion on its
    // section is what would fail if somebody moved it there.
    const byLabel = search(s.privacy.searchHistory.clear);
    expect(byLabel.hits.has("privacy-search-history")).toBe(true);
    expect(byLabel.sections.has("privacy")).toBe(true);
    expect(entryById("privacy-search-history").section).toBe("privacy");
    expect(search("istorija").hits.has("privacy-search-history")).toBe(true);
    // And it is a real hit on its own, not a side effect of the card's
    // sentences — those live on `privacy-practices`, which has no label to
    // highlight.
    expect(search("istorija").hits.has("privacy-practices")).toBe(false);
  });

  it("finds a declared CHOICE by one of its option labels, which nobody wrote twice", () => {
    // „Široka" is a `SettingsChoiceOption`'s copy, folded into the control's
    // keywords by the builder — the exact duplication this refactor removed.
    const folded = search("siroka");
    expect(folded.hits.has(settingsEntryId("notes", "width"))).toBe(true);
    expect(folded.sections.has("notes")).toBe(true);
    expect(
      search(s.tasks.blockedInTodayOptions.sakrij).hits.has(
        settingsEntryId("tasks", "blocked-today"),
      ),
    ).toBe(true);
  });
});

// --- entry ids ----------------------------------------------------------------

describe("entry id helpers", () => {
  it("prefixes a module id and a shortcut action id into their own namespaces", () => {
    expect(moduleEntryId("notes")).toBe("module-notes");
    expect(moduleEntryId("study")).toBe("module-study");
    expect(shortcutEntryId("palette")).toBe("shortcut-palette");
    expect(shortcutEntryId("shortcutsHelp")).toBe("shortcut-shortcutsHelp");
  });

  it("cannot collide across the three namespaces", () => {
    expect(moduleEntryId("x")).not.toBe(shortcutEntryId("x"));
    expect(settingsEntryId("x", "y")).not.toBe(moduleEntryId("x"));
    expect(settingsEntryId("x", "y")).not.toBe(shortcutEntryId("x"));
  });

  it("qualifies a declared control exactly as a stored widget id is qualified", () => {
    expect(settingsEntryId("notes", "width")).toBe("notes:width");
    expect(settingsEntryId("priv", "auto-lock")).toBe("priv:auto-lock");
  });
});

// --- the hit / visibility class helpers --------------------------------------

describe("labelClass and sectionClass", () => {
  it("marks a matched label typographically and leaves an unmatched one untouched", () => {
    expect(labelClass("set__module-name", true)).toBe("set__module-name set__hit");
    expect(labelClass("set__module-name", false)).toBe("set__module-name");
  });

  it("hides a filtered-out card with a modifier rather than by unmounting it", () => {
    // The folding-but-MOUNTED rule: a hidden section keeps `set__section` and
    // only adds the modifier, so the card is still in the tree with its state —
    // a restore preview, a half-typed passcode, an unsaved edit — intact.
    expect(sectionClass(true)).toBe("set__section");
    expect(sectionClass(false)).toBe("set__section set__section--hidden");
    expect(sectionClass(false).split(" ")).toContain("set__section");
  });
});

// --- buildSettingsIndex -------------------------------------------------------

describe("buildSettingsIndex", () => {
  it("gives every entry a unique id", () => {
    expect(new Set(ENTRIES.map((entry) => entry.id)).size).toBe(ENTRIES.length);
  });

  it("files every entry under a section the page actually renders", () => {
    const sectionIds = new Set(INDEX.sections.map((section) => section.id));
    for (const entry of ENTRIES) {
      expect([...sectionIds], entry.id).toContain(entry.section);
    }
  });

  it("gives every entry a non-empty label — an entry the page cannot draw is not searchable", () => {
    for (const entry of ENTRIES) {
      expect(entry.label.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("lists exactly the cards `sectionTitle` names, each with its drawn title", () => {
    // The shell's cards and the modules' together are the whole page: a module
    // card CLAIMS its shell id rather than adding a seventeenth section.
    const sections = INDEX.sections;
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
    expect([...sections.map((section) => section.id)].sort()).toEqual([...SECTION_IDS].sort());
    for (const section of sections) {
      expect(section.title, section.id).toBe(s.sectionTitle[section.id as keyof typeof s.sectionTitle]);
    }
  });

  it("covers every registered module, in the gallery's own grouping order", () => {
    const registry = createModuleRegistry();
    const expected = [...registry.byCategory()].flatMap(([, members]) =>
      members.map((manifest) => moduleEntryId(manifest.id)),
    );
    const actual = buildSettingsIndex(registry)
      .entries.filter((entry) => entry.section === "modules")
      .map((entry) => entry.id);
    // The „Moduli“ card also holds ADR-065's „ponovo pokreni upitnik“ row,
    // which is a control rather than a module of its own; it is a fixed entry,
    // so it leads, and the per-module rows follow whole and in gallery order.
    expect(actual).toEqual(["modules-onboarding", ...expected]);
  });

  it("labels a module row with the sidebar's name and keywords it with its description", () => {
    const notes = entryById(moduleEntryId("notes"));
    expect(notes.label).toBe(strings.modules.notes);
    expect(notes.keywords).toEqual([s.moduleDescriptions.notes]);
  });

  it("carries one row per remappable action, plus the reference itself", () => {
    const shortcutIds = ENTRIES.filter((entry) => entry.section === "shortcuts").map(
      (entry) => entry.id,
    );
    expect(shortcutIds).toEqual([
      shortcutEntryId("palette"),
      shortcutEntryId("quickCreate"),
      shortcutEntryId("globalCapture"),
      shortcutEntryId("lock"),
      shortcutEntryId("privLock"),
      shortcutEntryId("settings"),
      shortcutEntryId("shortcutsHelp"),
      "shortcuts-reference",
    ]);
    expect(entryById("shortcuts-reference").label).toBe(strings.shortcuts.showAll);
  });

  it("derives one entry per declared control, in registry then declaration order", () => {
    const registry = createModuleRegistry();
    const expected = moduleSettingsDeclarations(registry).flatMap(({ moduleId, panel }) =>
      panel.controls.map((control) => settingsEntryId(moduleId, control.key)),
    );
    const declaredSections = new Set(
      moduleSettingsDeclarations(registry).map((declaration) => declaration.moduleId),
    );
    const actual = ENTRIES.filter((entry) => declaredSections.has(entry.section)).map(
      (entry) => entry.id,
    );
    expect(actual).toEqual(expected);
    // Today's set, spelled out — the controls that used to be hand-written here.
    expect(actual).toEqual([
      "dashboard:background",
      "dashboard:dim",
      "tasks:blocked-today",
      "calendar:semester-dates",
      "notes:width",
      "notes:markdown",
      "priv:auto-lock",
      "priv:lock-minimize",
      "priv:kit-status",
      "files:view",
      "study:retention",
      "study:new-per-day",
      "study:review-cap",
      "finance:primary-currency",
    ]);
  });

  it("labels a derived entry with the control's own drawn label", () => {
    expect(entryById(settingsEntryId("notes", "width")).label).toBe(s.notes.widthLabel);
    expect(entryById(settingsEntryId("study", "review-cap")).label).toBe(s.study.reviewCapLabel);
    expect(entryById(settingsEntryId("dashboard", "background")).label).toBe(s.dashboard.pick);
    expect(entryById(settingsEntryId("dashboard", "dim")).label).toBe(s.dashboard.dimLabel);
    expect(entryById(settingsEntryId("calendar", "semester-dates")).label).toBe(s.calendar.datesLabel);
    expect(entryById(settingsEntryId("priv", "kit-status")).label).toBe(s.priv.caption);
  });

  it("folds a choice's option labels into its keywords, so nobody spells them twice", () => {
    const width = entryById(settingsEntryId("notes", "width"));
    expect(width.keywords).toContain(s.notes.widthNames.siroka);
    expect(width.keywords).toContain(s.notes.widthNames.uska);
    const blocked = entryById(settingsEntryId("tasks", "blocked-today"));
    expect(blocked.keywords).toContain(s.tasks.blockedInTodayOptions.sakrij);
    expect(blocked.keywords).toContain(s.tasks.blockedInTodayOptions.prikazi);
  });

  it("indexes a switched-off module's controls all the same — the flags are the page's question, not the filter's", () => {
    // PRIV ships disabled, and its card is still reachable by search: a hit may
    // steer to a section that is not on the page, exactly as a disabled
    // module's own gallery row already does.
    expect(ENTRIES.some((entry) => entry.section === "priv")).toBe(true);
  });

  it("leaves no section without at least one entry — a card must be reachable by search", () => {
    for (const section of INDEX.sections) {
      expect(
        ENTRIES.some((entry) => entry.section === section.id),
        section.id,
      ).toBe(true);
    }
  });

  it("is rebuilt per call, so the registry it was given is the one it describes", () => {
    const first = buildSettingsIndex(createModuleRegistry());
    const second = buildSettingsIndex(createModuleRegistry());
    expect(first).not.toBe(second);
    expect(first.entries.map((entry) => entry.id)).toEqual(second.entries.map((entry) => entry.id));
    expect(first.sections.map((section) => section.id)).toEqual(
      second.sections.map((section) => section.id),
    );
  });
});
