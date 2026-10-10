import { foldSearchText } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry, kitManifest } from "../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY, visibleModuleSet } from "../../shared/moduleVisibility.js";
import {
  SYNC_HELD_SETTINGS_CARD_IDS,
  isSettingsCardHeld,
} from "../../shared/syncHold.js";
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
import { activeLocale, strings } from "./strings.js";

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

// A function, not a module-scope alias, so a language switch is reflected in
// tests reading `s()` too — see check-string-capture.mjs.
function s(): typeof strings.settings {
  return strings.settings;
}
/**
 * The device's visible set for an arrangement nothing has touched (ADR-101) —
 * the app as it ships, which is what this file's expectations describe. A
 * module the user HIDES leaves the index entirely, which its own case below
 * states.
 */
const REGISTRY = createModuleRegistry();
const VISIBLE = visibleModuleSet(REGISTRY, DEFAULT_SHELL_VISIBILITY);
const INDEX = buildSettingsIndex(REGISTRY, VISIBLE);
const ENTRIES = INDEX.entries;
/** The sections a DISCOVERED module claims for its own card (ADR-090): its module id, which is by definition not a key of the shell's `sectionTitle`. */
const KIT_SECTION_IDS = moduleSettingsDeclarations(REGISTRY)
  .filter(({ panel }) => typeof panel.titleKey !== "string")
  .map(({ moduleId }) => moduleId)
  .filter((moduleId) => VISIBLE.has(moduleId));
/** Every module id a card declares — the ids `sectionTitle` carries a title FOR, rather than a shell card of its own. */
const DECLARED_MODULE_IDS = new Set(
  moduleSettingsDeclarations(REGISTRY).map((declaration) => declaration.moduleId),
);
/**
 * Every section the page can show: the shell's own table plus the discovered
 * ones. The union rather than one list, because the two halves are statements
 * about different things — a compiled-in module's card claims a heading the
 * shell already carries, and a kit module brings its own. A key a MODULE claims
 * is that module's card, so it is a section only while the module is shown
 * (ADR-101) — a hidden module's card is not drawn, so it cannot be searched to.
 */
const SECTION_IDS = [
  ...(Object.keys(s().sectionTitle) as SettingsSectionId[]).filter(
    (id) => !DECLARED_MODULE_IDS.has(id) || VISIBLE.has(id),
  ),
  ...KIT_SECTION_IDS,
] as SettingsSectionId[];
/**
 * The sections the index is expected to hold: every section above
 * minus the cards whose work is ON HOLD. The full list is kept beside it so the
 * test below can pin that the difference is exactly the hold's own ids.
 */
const VISIBLE_SECTION_IDS = SECTION_IDS.filter((id) => !isSettingsCardHeld(id));

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
    expect([...result.sections].sort()).toEqual([...VISIBLE_SECTION_IDS].sort());
    expect(result.hits.size).toBe(0);
  });

  it("treats an all-whitespace query as nothing typed", () => {
    const result = search("   ");
    expect(result.sections.size).toBe(VISIBLE_SECTION_IDS.length);
    expect(result.hits.size).toBe(0);
  });
});

// --- matchSettings, real queries ---------------------------------------------

describe("matchSettings", () => {
  it("highlights the entry whose own label matched, and keeps its section", () => {
    const result = search(s().notes.widthLabel);
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
    const result = search(s().sectionTitle.security);
    expect(result.sections.has("security")).toBe(true);
    const securityEntries = ENTRIES.filter((entry) => entry.section === "security");
    expect(securityEntries.length).toBeGreaterThan(0);
    expect(securityEntries.some((entry) => result.hits.has(entry.id))).toBe(false);
  });

  it("keeps a MODULE's card by its declared title, which is that card's own heading", () => {
    // The module cards' titles come from the manifest's `titleKey` now, so this
    // is what pins that the declaration still resolves to the drawn heading.
    const result = search(s().sectionTitle.study);
    expect(result.sections.has("study")).toBe(true);
  });

  it("drops every section that neither matched itself nor holds a match", () => {
    const result = search("preimenuj");
    for (const sectionId of VISIBLE_SECTION_IDS) {
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
    const label = foldSearchText(s().notes.widthLabel);
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
    const byLabel = search(s().privacy.searchHistory.clear);
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
      search(s().tasks.blockedInTodayOptions.sakrij).hits.has(
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
    expect([...sections.map((section) => section.id)].sort()).toEqual(
      [...VISIBLE_SECTION_IDS].sort(),
    );
    for (const section of sections) {
      // A discovered module's card is titled by its own declaration (ADR-090),
      // so the shell's table has nothing to say about it — the expectation is
      // the pair it declared, read in the language being read.
      const kit = kitManifest(section.id);
      if (kit !== undefined) {
        expect(section.title, section.id).toBe(kit.copy?.name[activeLocale()]);
        continue;
      }
      expect(section.title, section.id).toBe(
        s().sectionTitle[section.id as keyof typeof strings.settings.sectionTitle],
      );
    }
  });

  it("drops a card whose work is ON HOLD, and every control filed under it", () => {
    // „Hidden" has to mean absent, not merely unmatched: a section the index
    // still holds would keep the card's title in the query space and could
    // steer a reader to a card the page does not draw.
    expect(SECTION_IDS.length).toBeGreaterThan(VISIBLE_SECTION_IDS.length);
    expect(SECTION_IDS.filter((id) => !VISIBLE_SECTION_IDS.includes(id))).toEqual([
      ...SYNC_HELD_SETTINGS_CARD_IDS,
    ]);
    for (const heldId of SYNC_HELD_SETTINGS_CARD_IDS) {
      expect(INDEX.sections.map((section) => section.id)).not.toContain(heldId);
      expect(ENTRIES.filter((entry) => entry.section === heldId)).toEqual([]);
    }
  });

  it("covers every VISIBLE module, in the gallery's own grouping order", () => {
    const registry = createModuleRegistry();
    const expected = [...registry.byGroup()].flatMap(([, members]) =>
      members
        .filter((manifest) => VISIBLE.has(manifest.id))
        .map((manifest) => moduleEntryId(manifest.id)),
    );
    const actual = buildSettingsIndex(registry, VISIBLE)
      .entries.filter((entry) => entry.section === "modules")
      .map((entry) => entry.id);
    // The „Prikaz" card is nothing but modules: ADR-065's „ponovo pokreni
    // upitnik" row moved to „Kako je Nexus podešen za tebe" when ADR-086 made
    // the questionnaire about more than this gallery.
    // The section also carries the card's OWN entry (ADR-101): its title is
    // „Prikaz" now, and „moduli" — the word the category and the old gallery
    // carried — has to keep finding it.
    expect(actual.filter((id) => id !== "modules-display")).toEqual(expected);
    expect(actual[0]).toBe("modules-display");
    // And a module this device hides is gone from the filter too (ADR-101):
    // the card its entry would steer to is not drawn, so the hit leads
    // nowhere. The switch that brings the module back is the „Prikaz" card,
    // whose own entry names every module the build has, hidden or not.
    expect(actual).not.toContain(moduleEntryId("priv"));
    expect(actual).not.toContain(moduleEntryId("pro"));
  });

  it("labels a module row with the sidebar's name and keywords it with its description", () => {
    const notes = entryById(moduleEntryId("notes"));
    expect(notes.label).toBe(strings.modules.notes);
    expect(notes.keywords).toEqual([s().moduleDescriptions.notes]);
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
    // Only the modules this device SHOWS contribute (ADR-101), so the
    // declaration list is narrowed through the same predicate the page uses.
    const declared = moduleSettingsDeclarations(registry).filter(({ moduleId }) =>
      VISIBLE.has(moduleId),
    );
    const expected = declared.flatMap(({ moduleId, panel }) =>
      panel.controls.map((control) => settingsEntryId(moduleId, control.key)),
    );
    const declaredSections = new Set(declared.map((declaration) => declaration.moduleId));
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
      "files:view",
      "study:retention",
      "study:new-per-day",
      "study:review-cap",
      "finance:primary-currency",
      "habits:default-reminder",
      "fitness:kcal-goal",
      "fitness:protein-goal",
      "fitness:carbs-goal",
      "fitness:fat-goal",
      "focus:work-minutes",
      "focus:short-break-minutes",
      "focus:long-break-minutes",
      "focus:cycles",
      "tools:default-vat-rate",
      // The first DISCOVERED card's one control (ADR-090), last for the same
      // reason its section is: a kit module registers after every compiled-in
      // one. Its label is its own `{ sr, en }` pair, so the assertion above about
      // `strings` paths does not apply to it.
      "timers:sound-on-end",
      // And the second discovered card's one control, for the same reason.
      "culture:prompt-past-plans",
      // The car service book's two thresholds.
      "car:due-soon-days",
      "car:due-soon-distance",
      "pantry:expiry-window",
      // The second DISCOVERED card's one control (ADR-090), last for the same
      // reason its section is.
      "cookbook:unit-system",
      // The second discovered card's control, for the same reason and in the
      // same place: it declares its own `{ sr, en }` pair rather than a
      // `strings` path.
      "recorder:countdown",
      // The second DISCOVERED card's two controls (CALC), last for the same
      // reason its section is.
      "calculator:angle-mode",
      "calculator:number-mode",
      // SIGNALS' three, declared as pairs too: the two Morse preferences and the
      // tuner's reference.
      "signals:morse-speed",
      "signals:morse-pitch",
      "signals:tuner-a4",
      // The second DISCOVERED card's two controls (ADR-090).
      "translator:direction",
      "translator:recent",
      // And the assistant's three (ADR-106), declared as pairs in its own
      // manifest: the default tier, the web-search consent and the knowledge
      // index's statement of fact.
      "assistant:tier",
      "assistant:web-search",
      "assistant:knowledge",
      // The second DISCOVERED card, whose one control is a `fact`: the list of
      // paths this machine opened. It is indexable and has nothing to set.
      "workshop:recent-files",
      // The puzzles' one control, and the board games' one.
      "puzzles:check-while-typing",
      "boards:default-level",
      // And the astronomy corner's, the last discovered card this build
      // registers: the place the sky is drawn for.
      "astronomy:place",
    ]);
  });

  it("labels a derived entry with the control's own drawn label", () => {
    expect(entryById(settingsEntryId("notes", "width")).label).toBe(s().notes.widthLabel);
    expect(entryById(settingsEntryId("study", "review-cap")).label).toBe(s().study.reviewCapLabel);
    expect(entryById(settingsEntryId("dashboard", "background")).label).toBe(s().dashboard.pick);
    expect(entryById(settingsEntryId("dashboard", "dim")).label).toBe(s().dashboard.dimLabel);
    expect(entryById(settingsEntryId("calendar", "semester-dates")).label).toBe(
      s().calendar.datesLabel,
    );
  });

  it("folds a choice's option labels into its keywords, so nobody spells them twice", () => {
    const width = entryById(settingsEntryId("notes", "width"));
    expect(width.keywords).toContain(s().notes.widthNames.siroka);
    expect(width.keywords).toContain(s().notes.widthNames.uska);
    const blocked = entryById(settingsEntryId("tasks", "blocked-today"));
    expect(blocked.keywords).toContain(s().tasks.blockedInTodayOptions.sakrij);
    expect(blocked.keywords).toContain(s().tasks.blockedInTodayOptions.prikazi);
  });

  it("takes a HIDDEN module's controls out of the index (ADR-101)", () => {
    // PRIV ships off, so the shipped arrangement hides it — and its controls go
    // with it: a hit that steered to a card the page does not draw is the one
    // failure a filter can produce that reads as a page bug. What is left
    // answering for a hidden module is the „Prikaz" card's own entry, which
    // names every module the build has.
    expect(ENTRIES.some((entry) => entry.section === "priv")).toBe(false);
    expect(ENTRIES.some((entry) => entry.id === "modules-display")).toBe(true);
  });

  it("leaves no section without at least one entry — a card must be reachable by search", () => {
    for (const section of INDEX.sections) {
      expect(
        ENTRIES.some((entry) => entry.section === section.id),
        section.id,
      ).toBe(true);
    }
  });

  it("files the eight moved import/export entries under their own sub-pages (SET-015)", () => {
    // The flows used to share the „Rezervna kopija“ card and file under
    // `backup`. Their hit ids did not move, so a hit and its highlight still
    // agree; only the section a hit steers the reader to changed.
    const moved: ReadonlyArray<readonly [string, string]> = [
      ["backup-import", "import-archive"],
      ["backup-ics", "import-ics"],
      ["backup-calendar", "export-ics"],
      ["backup-apkg", "import-apkg"],
      ["backup-csv", "import-csv"],
      ["backup-fin-csv", "import-fin-csv"],
      ["backup-llm", "import-llm"],
      ["backup-markdown", "import-markdown"],
    ];
    for (const [id, section] of moved) expect(entryById(id).section, id).toBe(section);
    // The three blocks the backup card keeps still answer with `backup`.
    expect(entryById("backup-export").section).toBe("backup");
    expect(entryById("backup-auto").section).toBe("backup");
    expect(entryById("backup-restore").section).toBe("backup");
  });

  it("is rebuilt per call, so the registry it was given is the one it describes", () => {
    const first = buildSettingsIndex(createModuleRegistry(), VISIBLE);
    const second = buildSettingsIndex(createModuleRegistry(), VISIBLE);
    expect(first).not.toBe(second);
    expect(first.entries.map((entry) => entry.id)).toEqual(second.entries.map((entry) => entry.id));
    expect(first.sections.map((section) => section.id)).toEqual(
      second.sections.map((section) => section.id),
    );
  });
});
