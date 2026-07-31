import { afterEach, describe, expect, it, vi } from "vitest";

import { strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";
import {
  clearStoredWeekStart,
  persistWeekStart,
  readStoredWeekStart,
  toWeekStart,
  type WeekStartPreference,
} from "./weekStart.js";

/**
 * PRD 04 §5's one device preference. It follows `accent.ts`/`theme.ts`'s shape
 * minus the document attribute — nothing in the stylesheet reads it, only the
 * calendar does — so what is pinned is the fallback rule, the round trip, and
 * the one conversion (`toWeekStart`) where the readable stored spelling meets
 * the layout engine's numeric form.
 */

const STORAGE_KEY = "nexus.weekStart";
const PREFERENCES: readonly WeekStartPreference[] = ["monday", "sunday"];

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("readStoredWeekStart", () => {
  it("defaults to monday — the Serbian norm — when nothing is stored", () => {
    stubStorage();
    expect(readStoredWeekStart()).toBe("monday");
  });

  it("reads back both allowed values", () => {
    for (const preference of PREFERENCES) {
      stubStorage({ [STORAGE_KEY]: preference });
      expect(readStoredWeekStart()).toBe(preference);
    }
  });

  it("falls back to monday for anything it cannot name", () => {
    for (const stored of ["", "  ", "Monday", "MONDAY", "ponedeljak", "1", "0", "tuesday"]) {
      stubStorage({ [STORAGE_KEY]: stored });
      expect(readStoredWeekStart(), stored).toBe("monday");
    }
  });
});

describe("persistWeekStart", () => {
  it("writes the readable spelling, not the numeric form the calendar uses", () => {
    const storage = stubStorage();
    persistWeekStart("sunday");
    expect(storage.getItem(STORAGE_KEY)).toBe("sunday");
  });

  it("round-trips both values", () => {
    stubStorage();
    for (const preference of PREFERENCES) {
      persistWeekStart(preference);
      expect(readStoredWeekStart()).toBe(preference);
    }
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", "nexus.accent": "bordo" });
    persistWeekStart("sunday");
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem("nexus.accent")).toBe("bordo");
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredWeekStart()).toBe("monday");
    expect(storage.length).toBe(0);
  });
});

describe("clearStoredWeekStart", () => {
  it("removes the key outright, so the next read is Ponedeljak again", () => {
    const storage = stubStorage({ [STORAGE_KEY]: "sunday" });
    clearStoredWeekStart();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredWeekStart()).toBe("monday");
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ [STORAGE_KEY]: "sunday", "nexus.accent": "bordo" });
    clearStoredWeekStart();
    expect(storage.getItem("nexus.accent")).toBe("bordo");
  });
});

describe("toWeekStart", () => {
  it("maps the two spellings onto getUTCDay() terms", () => {
    expect(toWeekStart("monday")).toBe(1);
    expect(toWeekStart("sunday")).toBe(0);
  });

  it("survives the round trip through storage, so the calendar sees what was picked", () => {
    stubStorage();
    persistWeekStart("sunday");
    expect(toWeekStart(readStoredWeekStart())).toBe(0);
    persistWeekStart("monday");
    expect(toWeekStart(readStoredWeekStart())).toBe(1);
  });
});

describe("the Settings copy", () => {
  it("names both options, one label per stored value", () => {
    for (const preference of PREFERENCES) {
      expect(
        strings.settings.appearance.weekStartOptions[preference].length,
        preference,
      ).toBeGreaterThan(0);
    }
    expect(Object.keys(strings.settings.appearance.weekStartOptions).sort()).toEqual(
      [...PREFERENCES].sort(),
    );
  });
});
