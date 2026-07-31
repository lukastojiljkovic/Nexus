import { afterEach, describe, expect, it, vi } from "vitest";

import { strings } from "./strings.js";
import {
  BLOCKED_IN_TODAY_OPTIONS,
  persistBlockedInToday,
  readStoredBlockedInToday,
  toIncludeBlocked,
} from "./taskPrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-049's one TASK device preference, on the same shape as the modules in
 * `rendererPrefs.test.ts` and `notePrefs.test.ts` — closed value set, safe
 * fallback, `localStorage` only. It writes no document attribute, so unlike the
 * note width there is no DOM stub here at all.
 */

const KEY = "nexus.tasks.blockedInToday";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("BLOCKED_IN_TODAY_OPTIONS", () => {
  it("is the two answers, hidden first — the default leads the segmented row", () => {
    expect(BLOCKED_IN_TODAY_OPTIONS).toEqual(["sakrij", "prikazi"]);
    expect(new Set(BLOCKED_IN_TODAY_OPTIONS).size).toBe(BLOCKED_IN_TODAY_OPTIONS.length);
  });

  it("has a Serbian name for every option the Settings row can offer", () => {
    for (const option of BLOCKED_IN_TODAY_OPTIONS) {
      expect(strings.settings.tasks.blockedInTodayOptions[option]?.length, option).toBeGreaterThan(0);
    }
  });
});

describe("readStoredBlockedInToday", () => {
  it("hides blocked tasks when nothing is stored — showing them is the deliberate choice", () => {
    stubStorage();
    expect(readStoredBlockedInToday()).toBe("sakrij");
  });

  it("reads back both options", () => {
    for (const option of BLOCKED_IN_TODAY_OPTIONS) {
      stubStorage({ [KEY]: option });
      expect(readStoredBlockedInToday()).toBe(option);
    }
  });

  it("falls back to sakrij for anything unrecognized, casing included", () => {
    for (const stored of ["", "  ", "Prikazi", "SAKRIJ", "true", "on", "show", "null"]) {
      stubStorage({ [KEY]: stored });
      expect(readStoredBlockedInToday(), stored).toBe("sakrij");
    }
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredBlockedInToday()).toBe("sakrij");
    expect(storage.length).toBe(0);
  });
});

describe("persistBlockedInToday", () => {
  it("writes the key and round-trips both options", () => {
    const storage = stubStorage();
    for (const option of BLOCKED_IN_TODAY_OPTIONS) {
      persistBlockedInToday(option);
      expect(storage.getItem(KEY)).toBe(option);
      expect(readStoredBlockedInToday()).toBe(option);
    }
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", "nexus.noteWidth": "siroka" });
    persistBlockedInToday("prikazi");
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem("nexus.noteWidth")).toBe("siroka");
  });
});

describe("toIncludeBlocked", () => {
  it("maps the two spellings onto the query flag, and nothing else onto true", () => {
    expect(toIncludeBlocked("prikazi")).toBe(true);
    expect(toIncludeBlocked("sakrij")).toBe(false);
  });
});
