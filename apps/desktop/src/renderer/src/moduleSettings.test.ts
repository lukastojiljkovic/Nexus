import { ModuleRegistry, type ModuleManifest, type SettingsPanel } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry, kitManifest } from "../../shared/modules.js";
import {
  DEFAULT_SHELL_VISIBILITY,
  visibleModuleSet,
  type ShellVisibility,
} from "../../shared/moduleVisibility.js";
import {
  isDeviceOnlyPanel,
  moduleSettingsCardIds,
  moduleSettingsCards,
  moduleSettingsDeclarations,
  settingsEntryId,
} from "./moduleSettings.js";
import { MODULE_SETTINGS_PANELS } from "./moduleSettingsPanels.js";
import { buildSettingsIndex, foldSettingsQuery, matchSettings } from "./settingsSearch.js";
import { activeLocale, strings } from "./strings.js";

/**
 * The per-module settings contract, read the way `SettingsPage` reads it.
 *
 * The point of the suite is the LAST block: a module nobody has heard of gets a
 * card and search entries with no edit to the page and no edit to the index —
 * which is the whole claim the refactor makes, stated as a test rather than as
 * a comment. Everything above it pins the composition rules the page relies on
 * (registry order, the visibility gate, which cards may offer a reset).
 */

// A function, not a module-scope alias, so a language switch is reflected in
// tests reading `s()` too — see check-string-capture.mjs.
function s(): typeof strings.settings {
  return strings.settings;
}

/**
 * The device's visible set for an arrangement (ADR-101), built through the ONE
 * predicate. `hidden` and `shown` are the two lists the file holds, so a case
 * states what the user DID - "switched Beleške off", "switched Privatno on" -
 * rather than the derived set, which would make the assertion a second copy of
 * the code under test.
 */
function visible(
  registry: ModuleRegistry,
  hidden: readonly string[] = [],
  shown: readonly string[] = [],
): ReadonlySet<string> {
  const arrangement: ShellVisibility = { ...DEFAULT_SHELL_VISIBILITY, hidden, shown };
  return visibleModuleSet(registry, arrangement);
}

/** A module this build does not have, declared exactly as a real one would be. */
const FAKE_PANEL: SettingsPanel = {
  // A real strings path: `@nexus/core` never holds copy, so a title is a key,
  // and a test module borrows one rather than inventing Serbian of its own.
  titleKey: "settings.sectionTitle.privacy",
  controls: [
    {
      kind: "choice",
      key: "mode",
      labelKey: "settings.privacy.storage",
      storage: "device",
      options: [{ id: "a", labelKey: "settings.privacy.offline" }],
      keywords: ["izmisljeno"],
    },
    {
      kind: "value",
      key: "amount",
      // Names nothing: an unresolvable key falls back to the key itself rather
      // than to an empty label, so a typo shows up instead of disappearing.
      labelKey: "settings.nothing.here",
      storage: "device",
    },
  ],
};

const FAKE_MODULE: ModuleManifest = {
  id: "fake",
  prefix: "FAKE",
  group: "plan",
  defaultEnabled: true,
  settings: FAKE_PANEL,
};

function registryWithFakeModule(): ModuleRegistry {
  const registry = createModuleRegistry();
  registry.register(FAKE_MODULE);
  return registry;
}

// --- settingsEntryId ----------------------------------------------------------

describe("settingsEntryId", () => {
  it("qualifies a control by its module, exactly as a stored widget id is qualified", () => {
    expect(settingsEntryId("study", "review-cap")).toBe("study:review-cap");
  });

  it("cannot collide between two modules that declare the same key", () => {
    expect(settingsEntryId("notes", "width")).not.toBe(settingsEntryId("priv", "width"));
  });
});

// --- the declarations this build carries -------------------------------------

describe("moduleSettingsDeclarations", () => {
  it("answers every module that publishes a card, in REGISTRY order", () => {
    expect(
      moduleSettingsDeclarations(createModuleRegistry()).map(
        (declaration) => declaration.moduleId,
      ),
    ).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "notes",
      "priv",
      "files",
      "study",
      "finance",
      "habits",
      "fitness",
      "focus",
      "tools",
      // The first DISCOVERED card (ADR-090), last because a kit module
      // registers after every compiled-in one.
      "timers",
      "culture",
      "pantry",
      "cookbook",
      "recorder",
      "calculator",
      "signals",
    ]);
  });

  it("skips a module that publishes none — SET's own page is the surface, not a card in it", () => {
    const ids = moduleSettingsDeclarations(createModuleRegistry()).map(
      (declaration) => declaration.moduleId,
    );
    expect(ids).not.toContain("settings");
  });
});

// --- which module pages wear the gear -----------------------------------------

/**
 * The gear a module page's header draws (`moduleSettingsGear.tsx`) is offered
 * exactly for the modules this answers for, so the set is the whole contract:
 * a module whose manifest declares `settings` has a card to open and gets the
 * button, and one that declares none has neither. Two of the absences are
 * decisions rather than gaps — SET is the page the gear opens INTO, and CANV,
 * ELEC and „Stručne alatke" publish no card on purpose (see their manifests).
 */
describe("moduleSettingsCardIds", () => {
  it("names every module that publishes a card, and no other module", () => {
    expect([...moduleSettingsCardIds(createModuleRegistry())]).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "notes",
      "priv",
      "files",
      "study",
      "finance",
      "habits",
      "fitness",
      "focus",
      "tools",
      "timers",
      "culture",
      "pantry",
      "cookbook",
      "recorder",
      "calculator",
      "signals",
    ]);
  });

  it("leaves out the settings page itself and the three modules with no card", () => {
    const ids = moduleSettingsCardIds(createModuleRegistry());
    for (const id of ["settings", "canvas", "electronics", "pro"]) {
      expect(ids.has(id), id).toBe(false);
    }
  });

  it("answers for a module registered later, with no edit to this file or the gear", () => {
    expect(moduleSettingsCardIds(registryWithFakeModule()).has("fake")).toBe(true);
  });

  it("is NOT gated by flags — the gear lives on the module's own page, which a disabled module does not have", () => {
    // PRIV ships disabled, so the page never mounts and the gear is never
    // drawn; but the reason is the missing page, not a filtered set.
    expect(moduleSettingsCardIds(createModuleRegistry()).has("priv")).toBe(true);
  });
});

// --- the cards the page draws -------------------------------------------------

describe("moduleSettingsCards", () => {
  it("draws every enabled module's card in registry order, titled by its declaration", () => {
    const registry = createModuleRegistry();
    const cards = moduleSettingsCards(registry, visible(registry));
    // PRIV ships disabled (ADR-057), so it is absent until the gallery turns it on.
    expect(cards.map((card) => card.moduleId)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "notes",
      "files",
      "study",
      "finance",
      "habits",
      "fitness",
      "focus",
      "tools",
      "timers",
      "culture",
      "pantry",
      "cookbook",
      "recorder",
      "calculator",
      "signals",
    ]);
    expect(cards.map((card) => card.title)).toEqual([
      s().sectionTitle.dashboard,
      s().sectionTitle.tasks,
      s().sectionTitle.calendar,
      s().sectionTitle.notes,
      s().sectionTitle.files,
      s().sectionTitle.study,
      s().sectionTitle.finance,
      s().sectionTitle.habits,
      s().sectionTitle.fitness,
      s().sectionTitle.focus,
      s().sectionTitle.tools,
      // A discovered module declares its own card title (ADR-090), so the
      // expected value is its own pair read in the language being read rather
      // than a path into the shell's table.
      kitManifest("timers")?.copy?.name[activeLocale()] ?? "",
      kitManifest("culture")?.copy?.name[activeLocale()] ?? "",
      kitManifest("pantry")?.copy?.name[activeLocale()] ?? "",
      kitManifest("cookbook")?.copy?.name[activeLocale()] ?? "",
      kitManifest("recorder")?.copy?.name[activeLocale()] ?? "",
      kitManifest("calculator")?.copy?.name[activeLocale()] ?? "",
      kitManifest("signals")?.copy?.name[activeLocale()] ?? "",
    ]);
  });

  it("draws NOTHING for a module this device hides, and draws one it switched on", () => {
    const registry = createModuleRegistry();
    expect(
      moduleSettingsCards(registry, visible(registry, ["notes"])).map((card) => card.moduleId),
    ).not.toContain("notes");
    expect(
      moduleSettingsCards(registry, visible(registry, [], ["priv"])).map((card) => card.moduleId),
    ).toContain("priv");
  });

  it("keeps a hidden module's card out of the page AND out of the filter index", () => {
    const registry = createModuleRegistry();
    const enabled = visible(registry, ["notes"]);
    const index = buildSettingsIndex(registry, enabled);
    expect(moduleSettingsCards(registry, enabled).map((card) => card.moduleId)).not.toContain(
      "notes",
    );
    expect(index.sections.map((section) => section.id)).not.toContain("notes");
    expect(index.entries.some((entry) => entry.section === "notes")).toBe(false);
    // The card that switches it back on is a section of its own, and it is
    // reachable by the words somebody hunting for a module switch types.
    expect(index.sections.map((section) => section.id)).toContain("modules");
    expect(index.entries.some((entry) => entry.id === "modules-display")).toBe(true);
  });
});

// --- which cards may be reset -------------------------------------------------

describe("isDeviceOnlyPanel", () => {
  it("is true for the six cards whose whole state is this machine's", () => {
    const declarations = new Map(
      moduleSettingsDeclarations(createModuleRegistry()).map((declaration) => [
        declaration.moduleId,
        declaration.panel,
      ]),
    );
    const deviceOnly = [...declarations]
      .filter(([, panel]) => isDeviceOnlyPanel(panel))
      .map(([moduleId]) => moduleId);
    expect(deviceOnly).toEqual([
      "tasks",
      "notes",
      "files",
      "finance",
      "habits",
      "focus",
      "tools",
      // SIGNALS has no store at all: its three preferences are the whole of what
      // it keeps, and they are this machine's (`modules/signals/shared/manifest.ts`).
      "signals",
    ]);
  });

  it("is false for a panel holding a profile row — a reset there would be a write about the user's data", () => {
    expect(
      isDeviceOnlyPanel({
        titleKey: "settings.sectionTitle.privacy",
        controls: [
          { kind: "toggle", key: "a", labelKey: "x", storage: "device" },
          { kind: "value", key: "b", labelKey: "y", storage: "profile" },
        ],
      }),
    ).toBe(false);
  });

  it("is false for a panel that stores nothing at all — there is no default to go back to", () => {
    expect(
      isDeviceOnlyPanel({
        titleKey: "settings.sectionTitle.privacy",
        controls: [{ kind: "fact", key: "a", labelKey: "x" }],
      }),
    ).toBe(false);
  });

  it("agrees with the renderer: a panel offers `resetDevice` exactly when it is device-only", () => {
    for (const { moduleId, panel } of moduleSettingsDeclarations(createModuleRegistry())) {
      // A KIT module's card is its own body and the shell offers it no reset at
      // all (`moduleKit/settings.ts`), so the pairing this test states — „the
      // shell's reset link appears exactly for a device-only CARD THE SHELL
      // DRAWS" — is asked of the compiled-in map only. The module's own body
      // brings the reset it wants; `Settings.tsx` of SIGNALS has one.
      if (MODULE_SETTINGS_PANELS[moduleId] === undefined) continue;
      expect(MODULE_SETTINGS_PANELS[moduleId]?.resetDevice !== undefined, moduleId).toBe(
        isDeviceOnlyPanel(panel),
      );
    }
  });
});

// --- the actual claim ---------------------------------------------------------

describe("a module this build has never heard of", () => {
  const registry = registryWithFakeModule();

  /**
   * Not one line of `SettingsPage.tsx` or of `settingsSearch.ts`'s fixed list
   * mentions „fake“. Everything below follows from the manifest alone, which is
   * what „a declaration plus its own component“ has to mean to be worth having.
   */
  it("gets a card, last because it registered last, titled by its own declaration", () => {
    const cards = moduleSettingsCards(registry, visible(registry));
    const fake = cards.at(-1);
    expect(fake?.moduleId).toBe("fake");
    expect(fake?.title).toBe(s().sectionTitle.privacy);
    expect(fake?.panel).toBe(FAKE_PANEL);
  });

  it("obeys the same visibility gate as every other module", () => {
    expect(
      moduleSettingsCards(registry, visible(registry, ["fake"])).map((card) => card.moduleId),
    ).not.toContain("fake");
  });

  it("gets a section of its own in the filter index", () => {
    const index = buildSettingsIndex(registry, visible(registry));
    expect(index.sections.find((section) => section.id === "fake")?.title).toBe(
      s().sectionTitle.privacy,
    );
  });

  it("gets one entry per declared control, labelled and keyworded from the declaration", () => {
    const entries = buildSettingsIndex(registry, visible(registry)).entries.filter(
      (entry) => entry.section === "fake",
    );
    expect(entries.map((entry) => entry.id)).toEqual(["fake:mode", "fake:amount"]);
    expect(entries[0]?.label).toBe(s().privacy.storage);
    // The choice's option label rides along as a keyword, unasked.
    expect(entries[0]?.keywords).toEqual(["izmisljeno", s().privacy.offline]);
    // An unresolvable label key falls back to the key, so a typo is visible.
    expect(entries[1]?.label).toBe("settings.nothing.here");
  });

  it("is findable by its keyword, and its card survives the filter", () => {
    const result = matchSettings(
      buildSettingsIndex(registry, visible(registry)),
      foldSettingsQuery("izmisljeno"),
    );
    expect(result.hits.has("fake:mode")).toBe(true);
    expect(result.sections.has("fake")).toBe(true);
  });

  it("draws nothing rather than failing while no component is registered for it", () => {
    // The page's own guard, stated here: a declaration this build has no
    // renderer for is skipped, exactly as an unknown dashboard placement is.
    expect(MODULE_SETTINGS_PANELS["fake"]).toBeUndefined();
  });
});
