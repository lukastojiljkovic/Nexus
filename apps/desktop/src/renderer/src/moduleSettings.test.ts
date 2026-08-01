import { ModuleRegistry, type ModuleManifest, type SettingsPanel } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import {
  isDeviceOnlyPanel,
  moduleSettingsCards,
  moduleSettingsDeclarations,
  settingsEntryId,
} from "./moduleSettings.js";
import { MODULE_SETTINGS_PANELS } from "./moduleSettingsPanels.js";
import { buildSettingsIndex, foldSettingsQuery, matchSettings } from "./settingsSearch.js";
import { strings } from "./strings.js";

/**
 * The per-module settings contract, read the way `SettingsPage` reads it.
 *
 * The point of the suite is the LAST block: a module nobody has heard of gets a
 * card and search entries with no edit to the page and no edit to the index —
 * which is the whole claim the refactor makes, stated as a test rather than as
 * a comment. Everything above it pins the composition rules the page relies on
 * (registry order, the flag gate, which cards may offer a reset).
 */

const s = strings.settings;

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
  category: "Growth & platform",
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
    ).toEqual(["dashboard", "tasks", "calendar", "notes", "priv", "files", "study", "finance"]);
  });

  it("skips a module that publishes none — SET's own page is the surface, not a card in it", () => {
    const ids = moduleSettingsDeclarations(createModuleRegistry()).map(
      (declaration) => declaration.moduleId,
    );
    expect(ids).not.toContain("settings");
  });
});

// --- the cards the page draws -------------------------------------------------

describe("moduleSettingsCards", () => {
  it("draws every enabled module's card in registry order, titled by its declaration", () => {
    const cards = moduleSettingsCards(createModuleRegistry(), {});
    // PRIV ships disabled (ADR-057), so it is absent until the gallery turns it on.
    expect(cards.map((card) => card.moduleId)).toEqual([
      "dashboard",
      "tasks",
      "calendar",
      "notes",
      "files",
      "study",
      "finance",
    ]);
    expect(cards.map((card) => card.title)).toEqual([
      s.sectionTitle.dashboard,
      s.sectionTitle.tasks,
      s.sectionTitle.calendar,
      s.sectionTitle.notes,
      s.sectionTitle.files,
      s.sectionTitle.study,
      s.sectionTitle.finance,
    ]);
  });

  it("draws NOTHING for a module the profile switched off, and draws one it switched on", () => {
    const registry = createModuleRegistry();
    expect(
      moduleSettingsCards(registry, { notes: false }).map((card) => card.moduleId),
    ).not.toContain("notes");
    expect(moduleSettingsCards(registry, { priv: true }).map((card) => card.moduleId)).toContain(
      "priv",
    );
  });

  it("keeps a disabled module's card OUT of the page but IN the filter index", () => {
    const registry = createModuleRegistry();
    const index = buildSettingsIndex(registry);
    expect(moduleSettingsCards(registry, {}).map((card) => card.moduleId)).not.toContain("priv");
    expect(index.sections.map((section) => section.id)).toContain("priv");
    expect(index.entries.some((entry) => entry.section === "priv")).toBe(true);
  });
});

// --- which cards may be reset -------------------------------------------------

describe("isDeviceOnlyPanel", () => {
  it("is true for the four cards whose whole state is this machine's", () => {
    const declarations = new Map(
      moduleSettingsDeclarations(createModuleRegistry()).map((declaration) => [
        declaration.moduleId,
        declaration.panel,
      ]),
    );
    const deviceOnly = [...declarations]
      .filter(([, panel]) => isDeviceOnlyPanel(panel))
      .map(([moduleId]) => moduleId);
    expect(deviceOnly).toEqual(["tasks", "notes", "files", "finance"]);
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
    const cards = moduleSettingsCards(registry, {});
    const fake = cards.at(-1);
    expect(fake?.moduleId).toBe("fake");
    expect(fake?.title).toBe(s.sectionTitle.privacy);
    expect(fake?.panel).toBe(FAKE_PANEL);
  });

  it("obeys the same flag gate as every other module", () => {
    expect(moduleSettingsCards(registry, { fake: false }).map((card) => card.moduleId)).not.toContain(
      "fake",
    );
  });

  it("gets a section of its own in the filter index", () => {
    const index = buildSettingsIndex(registry);
    expect(index.sections.find((section) => section.id === "fake")?.title).toBe(
      s.sectionTitle.privacy,
    );
  });

  it("gets one entry per declared control, labelled and keyworded from the declaration", () => {
    const entries = buildSettingsIndex(registry).entries.filter(
      (entry) => entry.section === "fake",
    );
    expect(entries.map((entry) => entry.id)).toEqual(["fake:mode", "fake:amount"]);
    expect(entries[0]?.label).toBe(s.privacy.storage);
    // The choice's option label rides along as a keyword, unasked.
    expect(entries[0]?.keywords).toEqual(["izmisljeno", s.privacy.offline]);
    // An unresolvable label key falls back to the key, so a typo is visible.
    expect(entries[1]?.label).toBe("settings.nothing.here");
  });

  it("is findable by its keyword, and its card survives the filter", () => {
    const result = matchSettings(buildSettingsIndex(registry), foldSettingsQuery("izmisljeno"));
    expect(result.hits.has("fake:mode")).toBe(true);
    expect(result.sections.has("fake")).toBe(true);
  });

  it("draws nothing rather than failing while no component is registered for it", () => {
    // The page's own guard, stated here: a declaration this build has no
    // renderer for is skipped, exactly as an unknown dashboard placement is.
    expect(MODULE_SETTINGS_PANELS["fake"]).toBeUndefined();
  });
});
