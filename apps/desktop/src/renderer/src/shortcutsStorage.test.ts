import { findChordConflict, formatChord, isBindableChord, parseChord, type Chord } from "@nexus/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readStoredShortcutOverrides,
  resolveShortcuts,
  shortcutActionLabel,
  SHORTCUT_ACTION_IDS,
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
  writeStoredShortcutOverrides,
} from "./shortcuts.js";
import { strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-040's storage half: what `nexus.shortcuts` may contain, and what the app
 * makes of it. All chord SEMANTICS live in `@nexus/core` and are tested there —
 * what is pinned here is the layering (defaults under overrides) and the
 * refusal rules a hand-edited key has to survive, which is the only way an
 * unbindable or reserved chord can reach this module at all.
 *
 * `localStorage` is the shared in-memory stub, as in `rendererPrefs.test.ts`;
 * no DOM library is involved.
 */

const STORAGE_KEY = "nexus.shortcuts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Installs a fresh in-memory `localStorage`, optionally pre-seeded, and hands it back. */
function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

/** Seeds the shortcuts key with a raw JSON string — the shape a hand edit would leave behind. */
function seedRaw(raw: string): Storage {
  return stubStorage({ [STORAGE_KEY]: raw });
}

/** Every action's chord in its canonical serialization — the readable form for an assertion. */
function serialized(bindings: Readonly<Record<ShortcutActionId, Chord>>): Record<string, string> {
  return Object.fromEntries(
    SHORTCUT_ACTION_IDS.map((id) => [id, formatChord(bindings[id])] as const),
  );
}

/** An override for EVERY action — function keys, so each is bindable and none is reserved. */
function overrideEveryAction(modifier: "alt" | "ctrlShift"): ShortcutOverrides {
  const overrides: Partial<Record<ShortcutActionId, Chord>> = {};
  SHORTCUT_ACTION_IDS.forEach((id, index) => {
    overrides[id] = {
      ctrl: modifier === "ctrlShift",
      alt: modifier === "alt",
      shift: modifier === "ctrlShift",
      key: `F${index + 2}`,
    };
  });
  return overrides;
}

const DEFAULTS = resolveShortcuts({});

// --- the action registry ------------------------------------------------------

describe("SHORTCUT_ACTIONS", () => {
  it("is the five declared ids, in order and without duplicates", () => {
    expect(SHORTCUT_ACTIONS.map((action) => action.id)).toEqual([...SHORTCUT_ACTION_IDS]);
    expect(new Set(SHORTCUT_ACTION_IDS).size).toBe(SHORTCUT_ACTION_IDS.length);
  });

  it("labels every action with non-empty Serbian copy from strings.ts", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.label, action.id).toBe(strings.shortcuts.actions[action.id]);
      expect(action.label.length, action.id).toBeGreaterThan(0);
    }
  });

  it("gives every action a chord core would let the user bind", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(isBindableChord(action.defaultChord), action.id).toBe(true);
    }
  });

  it("hands out defaults that clash with neither each other nor the reserved family", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(findChordConflict(action.id, action.defaultChord, DEFAULTS), action.id).toBeNull();
    }
  });

  it("survives its own serialization — every default parses back identically", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(parseChord(formatChord(action.defaultChord)), action.id).toEqual(action.defaultChord);
    }
  });

  it("pins the shipped defaults", () => {
    expect(serialized(DEFAULTS)).toEqual({
      palette: "Ctrl+K",
      quickCreate: "Ctrl+N",
      lock: "Ctrl+L",
      settings: "Ctrl+,",
      // F1 rather than Ctrl+/: „/" is Shift+7 on the Serbian QWERTZ layout.
      shortcutsHelp: "F1",
    });
  });
});

describe("shortcutActionLabel", () => {
  it("names a known action", () => {
    expect(shortcutActionLabel("lock")).toBe(strings.shortcuts.actions.lock);
  });

  it("hands an unknown id back unchanged, so a refusal is never blank", () => {
    expect(shortcutActionLabel("moduleNav")).toBe("moduleNav");
    expect(shortcutActionLabel("")).toBe("");
  });
});

// --- resolveShortcuts ---------------------------------------------------------

describe("resolveShortcuts", () => {
  it("is exactly the defaults when nothing is overridden", () => {
    expect(SHORTCUT_ACTIONS.map((action) => DEFAULTS[action.id])).toEqual(
      SHORTCUT_ACTIONS.map((action) => action.defaultChord),
    );
  });

  it("replaces only the overridden action, leaving the rest on their defaults", () => {
    const override: Chord = { ctrl: false, alt: true, shift: false, key: "p" };
    const resolved = resolveShortcuts({ palette: override });
    expect(resolved.palette).toEqual(override);
    expect(serialized(resolved)).toEqual({ ...serialized(DEFAULTS), palette: "Alt+P" });
  });

  it("can replace every action at once", () => {
    const resolved = resolveShortcuts(overrideEveryAction("alt"));
    expect(Object.values(serialized(resolved))).toEqual([
      "Alt+F2",
      "Alt+F3",
      "Alt+F4",
      "Alt+F5",
      "Alt+F6",
    ]);
  });

  it("returns a fresh map each time — one caller's copy is never another's", () => {
    const first = resolveShortcuts({});
    const second = resolveShortcuts({});
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

// --- readStoredShortcutOverrides ---------------------------------------------

describe("readStoredShortcutOverrides", () => {
  it("is empty when nothing has ever been stored", () => {
    stubStorage();
    expect(readStoredShortcutOverrides()).toEqual({});
  });

  it("is empty for text that is not JSON at all", () => {
    seedRaw("{not json");
    expect(readStoredShortcutOverrides()).toEqual({});
  });

  it("is empty for JSON that is not an object of overrides", () => {
    for (const raw of ["null", "[]", '["Ctrl+K"]', '"Ctrl+K"', "42", "true"]) {
      seedRaw(raw);
      expect(readStoredShortcutOverrides(), raw).toEqual({});
    }
  });

  it("reads a well-formed override back, canonicalizing how it was spelled", () => {
    seedRaw(JSON.stringify({ palette: "alt+shift+f5" }));
    expect(readStoredShortcutOverrides()).toEqual({
      palette: { ctrl: false, alt: true, shift: true, key: "F5" },
    });
  });

  it("drops a key that is not one of the five actions", () => {
    seedRaw(JSON.stringify({ paleta: "Ctrl+P", moduleNav: "Ctrl+M", palette: "Ctrl+P" }));
    expect(Object.keys(readStoredShortcutOverrides())).toEqual(["palette"]);
  });

  it("drops a value that is not a string", () => {
    seedRaw(JSON.stringify({ palette: 5, lock: null, quickCreate: { key: "k" } }));
    expect(readStoredShortcutOverrides()).toEqual({});
  });

  it("drops a chord that does not parse", () => {
    for (const raw of ["Ctrl+", "Hyper+K", "Ctrl+Ctrl+K", "Ctrl+Enter", "", "Ctrl+F13"]) {
      expect(parseChord(raw), raw).toBeNull();
      seedRaw(JSON.stringify({ palette: raw }));
      expect(readStoredShortcutOverrides(), raw).toEqual({});
    }
  });

  it("drops a chord typing could produce — nothing bare or merely shifted is bindable", () => {
    for (const raw of ["k", "Shift+K", "+"]) {
      const chord = parseChord(raw);
      expect(chord, raw).not.toBeNull();
      expect(chord === null || isBindableChord(chord), raw).toBe(false);
      seedRaw(JSON.stringify({ palette: raw }));
      expect(readStoredShortcutOverrides(), raw).toEqual({});
    }
  });

  it("drops a chord inside the reserved Ctrl+digit family", () => {
    for (const raw of ["Ctrl+1", "Ctrl+5", "Ctrl+9"]) {
      seedRaw(JSON.stringify({ palette: raw }));
      expect(readStoredShortcutOverrides(), raw).toEqual({});
    }
  });

  it("keeps a digit chord the reserved family does not claim", () => {
    seedRaw(JSON.stringify({ palette: "Ctrl+Shift+1" }));
    expect(readStoredShortcutOverrides()).toEqual({
      palette: { ctrl: true, alt: false, shift: true, key: "1" },
    });
  });

  it("drops only the unusable entries, never the whole file", () => {
    seedRaw(JSON.stringify({ palette: "Ctrl+1", lock: "Alt+L", nonsense: "Ctrl+X" }));
    expect(readStoredShortcutOverrides()).toEqual({
      lock: { ctrl: false, alt: true, shift: false, key: "l" },
    });
  });

  // A hand-edited file is the only way a taken chord reaches the reader — the
  // Settings capture surface refuses one — and two actions on a single chord
  // would leave the global handler firing whichever the shell checks first.
  it("drops a stored chord that collides with another action's binding", () => {
    seedRaw(JSON.stringify({ palette: "Ctrl+L" }));
    expect(readStoredShortcutOverrides()).toEqual({});

    const resolved = resolveShortcuts(readStoredShortcutOverrides());
    expect(formatChord(resolved.palette)).toBe("Ctrl+K"); // back on its default
    expect(formatChord(resolved.lock)).toBe("Ctrl+L"); // still the only Ctrl+L
  });

  it("keeps the FIRST of two overrides claiming one chord, in registry order", () => {
    // `palette` is laid out before `lock`, so it wins — whichever order the
    // file happens to list them in.
    for (const raw of [
      { palette: "Ctrl+J", lock: "Ctrl+J" },
      { lock: "Ctrl+J", palette: "Ctrl+J" },
    ]) {
      seedRaw(JSON.stringify(raw));
      const overrides = readStoredShortcutOverrides();
      expect(Object.keys(overrides), JSON.stringify(raw)).toEqual(["palette"]);
      expect(formatChord(resolveShortcuts(overrides).lock)).toBe("Ctrl+L");
    }
  });

  it("accepts an override claiming a default the override before it just freed", () => {
    // palette moves off Ctrl+K, so Ctrl+K is genuinely free by the time
    // quickCreate asks for it — the effective map, not the raw defaults.
    seedRaw(JSON.stringify({ palette: "Alt+P", quickCreate: "Ctrl+K" }));
    expect(serialized(resolveShortcuts(readStoredShortcutOverrides()))).toEqual({
      ...serialized(DEFAULTS),
      palette: "Alt+P",
      quickCreate: "Ctrl+K",
    });
  });

  it("judges a candidate against the defaults of actions not yet reached", () => {
    // quickCreate is still on Ctrl+N when palette asks for it, so palette is
    // dropped even though quickCreate later vacates that chord. Conservative,
    // but fixed by the registry order rather than by the file's key order.
    seedRaw(JSON.stringify({ palette: "Ctrl+N", quickCreate: "Alt+Q" }));
    expect(readStoredShortcutOverrides()).toEqual({
      quickCreate: { ctrl: false, alt: true, shift: false, key: "q" },
    });
  });
});

// --- writeStoredShortcutOverrides --------------------------------------------

describe("writeStoredShortcutOverrides", () => {
  it("writes only the actions that were actually remapped", () => {
    const storage = stubStorage();
    writeStoredShortcutOverrides({ lock: { ctrl: false, alt: true, shift: false, key: "l" } });
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ lock: "Alt+L" }));
  });

  it("writes the overrides in the registry's own order, whatever order they came in", () => {
    const storage = stubStorage();
    writeStoredShortcutOverrides({
      lock: { ctrl: false, alt: true, shift: false, key: "l" },
      palette: { ctrl: false, alt: true, shift: false, key: "p" },
    });
    expect(storage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ palette: "Alt+P", lock: "Alt+L" }),
    );
  });

  it("REMOVES the key for an empty set rather than storing an empty object", () => {
    const storage = stubStorage({ [STORAGE_KEY]: JSON.stringify({ lock: "Alt+L" }) });
    writeStoredShortcutOverrides({});
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", "nexus.accent": "bordo" });
    writeStoredShortcutOverrides({ lock: { ctrl: true, alt: true, shift: false, key: "l" } });
    writeStoredShortcutOverrides({});
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem("nexus.accent")).toBe("bordo");
  });

  it("round-trips every action through storage and back into a resolved map", () => {
    const storage = stubStorage();
    const overrides = overrideEveryAction("ctrlShift");
    writeStoredShortcutOverrides(overrides);
    expect(readStoredShortcutOverrides()).toEqual(overrides);
    expect(resolveShortcuts(readStoredShortcutOverrides())).toEqual(overrides);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("round-trips a chord whose key is the separator character itself", () => {
    stubStorage();
    const plus: Chord = { ctrl: true, alt: false, shift: false, key: "+" };
    writeStoredShortcutOverrides({ palette: plus });
    expect(readStoredShortcutOverrides()).toEqual({ palette: plus });
  });

  it("clearing after a write leaves a later read empty", () => {
    stubStorage();
    writeStoredShortcutOverrides({ palette: { ctrl: false, alt: true, shift: false, key: "p" } });
    writeStoredShortcutOverrides({});
    expect(readStoredShortcutOverrides()).toEqual({});
    expect(resolveShortcuts(readStoredShortcutOverrides())).toEqual(DEFAULTS);
  });
});
