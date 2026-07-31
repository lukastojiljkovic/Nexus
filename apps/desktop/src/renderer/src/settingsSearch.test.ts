import { foldSearchText } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./modules.js";
import {
  buildSettingsSearchEntries,
  foldSettingsQuery,
  matchSettings,
  moduleEntryId,
  shortcutEntryId,
  type SettingsSearchEntry,
  type SettingsSectionId,
} from "./settingsSearch.js";
import { strings } from "./strings.js";

/**
 * SET-014's filter index. Everything here is pure — no storage, no clock, no
 * IPC — so the only setup is the real module registry, which is what the page
 * itself hands `buildSettingsSearchEntries`.
 *
 * Serbian copy is never re-spelled: every query is derived from `strings.ts`
 * through `foldSettingsQuery`, which is also what pins the folding contract
 * („Noć" must be reachable by typing "noc") without this file owning a second
 * copy of the words.
 */

const s = strings.settings;
const ENTRIES = buildSettingsSearchEntries(createModuleRegistry());
const SECTION_IDS = Object.keys(s.sectionTitle) as SettingsSectionId[];

/** The page's own call shape: a raw string in, a result out. */
function search(query: string): ReturnType<typeof matchSettings> {
  return matchSettings(ENTRIES, foldSettingsQuery(query));
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
    const result = matchSettings(ENTRIES, []);
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
    expect(result.hits.has("note-width")).toBe(true);
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
    expect(wide.hits.has("note-width")).toBe(true);
    expect(wide.hits.has("note-markdown-shortcuts")).toBe(true);
    expect(narrow.hits.has("note-markdown-shortcuts")).toBe(true);
    expect(narrow.hits.has("note-width")).toBe(false);
  });

  it("matches on a plain substring, not on a word prefix", () => {
    // Deliberate divergence from `matchCommands` — see the module's own comment.
    const label = foldSearchText(s.notes.widthLabel);
    const middle = label.slice(2, 6);
    expect(middle.length).toBeGreaterThan(0);
    expect(search(middle).hits.has("note-width")).toBe(true);
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
});

// --- entry ids ----------------------------------------------------------------

describe("entry id helpers", () => {
  it("prefixes a module id and a shortcut action id into their own namespaces", () => {
    expect(moduleEntryId("notes")).toBe("module-notes");
    expect(moduleEntryId("study")).toBe("module-study");
    expect(shortcutEntryId("palette")).toBe("shortcut-palette");
    expect(shortcutEntryId("shortcutsHelp")).toBe("shortcut-shortcutsHelp");
  });

  it("cannot collide across the two namespaces", () => {
    expect(moduleEntryId("x")).not.toBe(shortcutEntryId("x"));
  });
});

// --- buildSettingsSearchEntries ----------------------------------------------

describe("buildSettingsSearchEntries", () => {
  it("gives every entry a unique id", () => {
    expect(new Set(ENTRIES.map((entry) => entry.id)).size).toBe(ENTRIES.length);
  });

  it("files every entry under a section the page actually renders", () => {
    for (const entry of ENTRIES) {
      expect(SECTION_IDS, entry.id).toContain(entry.section);
    }
  });

  it("gives every entry a non-empty label — an entry the page cannot draw is not searchable", () => {
    for (const entry of ENTRIES) {
      expect(entry.label.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("covers every registered module, in the gallery's own grouping order", () => {
    const registry = createModuleRegistry();
    const expected = [...registry.byCategory()].flatMap(([, members]) =>
      members.map((manifest) => moduleEntryId(manifest.id)),
    );
    const actual = buildSettingsSearchEntries(registry)
      .filter((entry) => entry.section === "modules")
      .map((entry) => entry.id);
    expect(actual).toEqual(expected);
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
      shortcutEntryId("settings"),
      shortcutEntryId("shortcutsHelp"),
      "shortcuts-reference",
    ]);
    expect(entryById("shortcuts-reference").label).toBe(strings.shortcuts.showAll);
  });

  it("carries both dashboard-background controls (SET-006)", () => {
    expect(entryById("dashboard-background").label).toBe(s.dashboard.pick);
    expect(entryById("dashboard-dim").label).toBe(s.dashboard.dimLabel);
    expect(entryById("dashboard-background").section).toBe("dashboard");
    expect(entryById("dashboard-dim").section).toBe("dashboard");
  });

  it("leaves no section without at least one entry — a card must be reachable by search", () => {
    for (const sectionId of SECTION_IDS) {
      expect(
        ENTRIES.some((entry) => entry.section === sectionId),
        sectionId,
      ).toBe(true);
    }
  });

  it("is rebuilt per call, so the registry it was given is the one it describes", () => {
    const first = buildSettingsSearchEntries(createModuleRegistry());
    const second = buildSettingsSearchEntries(createModuleRegistry());
    expect(first).not.toBe(second);
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
  });
});
