import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredOverviewOpen,
  OVERVIEW_MODULES,
  persistOverviewOpen,
  readStoredOverviewOpen,
} from "./overviewPrefs.js";
import { MODULE_SETTINGS_PANELS } from "./moduleSettingsPanels.js";
import { memoryStorage } from "./testStorage.js";

/**
 * The one preference with four subjects, and the direction of its fallback is
 * the whole fix.
 *
 * Four module landings put a chart between the page header and the thing the
 * module is FOR, and at both swept window sizes the list started below the
 * fold. The chart now folds — but a disclosure that defaults open reproduces
 * the defect for everyone who never touches it, so „closed unless this machine
 * says otherwise" is not a taste call and is pinned here from three
 * directions: unset, unrecognised, and each module read independently.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("OVERVIEW_MODULES", () => {
  it("is the four landings that open with a chart, without duplicates", () => {
    expect(OVERVIEW_MODULES).toEqual(["notes", "tasks", "habits", "study"]);
    expect(new Set(OVERVIEW_MODULES).size).toBe(OVERVIEW_MODULES.length);
  });

  /**
   * FOKUS is absent on purpose. Its landing already reads start card, then
   * figures, then chart — it is the surface that was right, and the proof that
   * the rule the other four now follow is the app's own.
   */
  it("leaves out the landing that was already ordered correctly", () => {
    expect(OVERVIEW_MODULES).not.toContain("focus");
  });
});

describe("readStoredOverviewOpen", () => {
  it("is closed when this machine has never been asked", () => {
    stubStorage();
    for (const module of OVERVIEW_MODULES) expect(readStoredOverviewOpen(module)).toBe(false);
  });

  /**
   * Only the exact opt-in string opens it. A truthy-looking value, a
   * hand-edited one and a value from some future shape of this key all mean
   * closed — a fallback that guessed OPEN would put the defect back for
   * precisely the machines whose storage is in an unknown state.
   */
  it.each(["closed", "true", "1", "OPEN", " open", "", "{}"])(
    "reads %o as closed",
    (stored) => {
      stubStorage({ "nexus.notes.overview": stored });
      expect(readStoredOverviewOpen("notes")).toBe(false);
    },
  );

  it("opens on the value it writes itself", () => {
    stubStorage({ "nexus.notes.overview": "open" });
    expect(readStoredOverviewOpen("notes")).toBe(true);
  });
});

describe("persistOverviewOpen", () => {
  it("writes the module's own key under the `nexus.` namespace", () => {
    const storage = stubStorage();
    persistOverviewOpen("study", true);
    expect(storage.getItem("nexus.study.overview")).toBe("open");
    persistOverviewOpen("study", false);
    expect(storage.getItem("nexus.study.overview")).toBe("closed");
  });

  /**
   * Closing writes „closed" rather than removing the key. The two are the same
   * to the reader TODAY, and the distinction is what stops a later default
   * from overruling a person who deliberately closed it.
   */
  it("records a deliberate close instead of forgetting the choice", () => {
    const storage = stubStorage();
    persistOverviewOpen("tasks", false);
    expect(storage.getItem("nexus.tasks.overview")).toBe("closed");
  });

  it("keeps the four subjects apart", () => {
    const storage = stubStorage();
    persistOverviewOpen("notes", true);
    expect(readStoredOverviewOpen("notes")).toBe(true);
    for (const module of OVERVIEW_MODULES) {
      if (module !== "notes") expect(readStoredOverviewOpen(module)).toBe(false);
    }
    expect(storage.length).toBe(1);
  });
});

describe("clearStoredOverviewOpen", () => {
  it("returns the module to closed", () => {
    stubStorage({ "nexus.habits.overview": "open" });
    clearStoredOverviewOpen("habits");
    expect(readStoredOverviewOpen("habits")).toBe(false);
  });

  /**
   * „Vrati na podrazumevano" belongs to ONE module's card. A reset that swept
   * the shared prefix would close three charts the person never asked about,
   * from a card that named only the fourth.
   */
  it("forgets its own subject and no other", () => {
    const storage = stubStorage(
      Object.fromEntries(OVERVIEW_MODULES.map((m) => [`nexus.${m}.overview`, "open"])),
    );
    clearStoredOverviewOpen("tasks");
    expect(storage.getItem("nexus.tasks.overview")).toBeNull();
    expect(storage.length).toBe(OVERVIEW_MODULES.length - 1);
  });

  it("is silent on a machine that never stored the key", () => {
    const storage = stubStorage();
    expect(() => {
      clearStoredOverviewOpen("study");
    }).not.toThrow();
    expect(storage.length).toBe(0);
  });
});


// --- the reset each module's own card performs --------------------------------

/**
 * SET §5's „Vrati na podrazumevano" is per-CARD, and a card that resets a
 * module while leaving one of its device preferences standing is lying in the
 * one place a user goes to be told the truth about this machine. The fold is a
 * device preference like any other, so each module's `clearStored…Preferences`
 * has to take its own key with it.
 *
 * Asserted by CALLING the reset rather than by checking that one exists. The
 * shape this replaces — `expect(panel.resetDevice).toBeTypeOf("function")` —
 * passes on a reset that forgets everything EXCEPT the fold, which is exactly
 * the mistake available here.
 */
describe("each module's „Vrati na podrazumevano“", () => {
  const withReset = OVERVIEW_MODULES.filter(
    (module) => MODULE_SETTINGS_PANELS[module]?.resetDevice !== undefined,
  );

  /**
   * UČENJE is the one that has none, and the absence is its PANEL's: all three
   * of its controls are profile values, so the card is not device-only and
   * never offers the link. Pinned so that „study is missing from this list" is
   * a decision on the record rather than something noticed later.
   */
  it("is offered by three of the four landings, and UČENJE is the fourth", () => {
    expect(withReset).toEqual(["notes", "tasks", "habits"]);
  });

  it.each(withReset)("forgets %s's fold and no other module's", (module) => {
    const storage = memoryStorage(
      Object.fromEntries(OVERVIEW_MODULES.map((m) => [`nexus.${m}.overview`, "open"])),
    );
    vi.stubGlobal("localStorage", storage);
    // NOTE's reset rewrites the editor measure onto the document root; nothing
    // else here touches the DOM, and a recording stub is enough for all of it.
    vi.stubGlobal("document", { documentElement: { setAttribute: () => undefined } });

    MODULE_SETTINGS_PANELS[module]?.resetDevice?.();

    expect(readStoredOverviewOpen(module)).toBe(false);
    for (const other of OVERVIEW_MODULES) {
      if (other !== module) expect(readStoredOverviewOpen(other), other).toBe(true);
    }
  });
});
