import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryStorage } from "../../../renderer/src/testStorage.js";
import {
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
  clearRecent,
  clearStoredTranslatorPreferences,
  parseRecentLimit,
  persistDirection,
  persistRecent,
  persistRecentLimit,
  readRecent,
  readStoredDirection,
  readStoredRecentLimit,
  withLookup,
} from "./prefs.js";

/**
 * The module's device preferences: the limit parser, the recent list's rule, and
 * the storage round trips.
 *
 * The interesting one is `withLookup`, because it is the module's only piece of
 * state that grows: it moves a word that was already there instead of adding a
 * second copy of it, and deduplication runs on the dictionary's own folded key —
 * so `Kafa` after `kafa`, and the Cyrillic spelling after the Latin one, are one
 * entry rather than three.
 */

describe("parseRecentLimit", () => {
  it("reads a whole number in the panel's range", () => {
    expect(parseRecentLimit("0")).toBe(0);
    expect(parseRecentLimit("12")).toBe(12);
    expect(parseRecentLimit(" 20 ")).toBe(20);
  });

  it("refuses everything else, rather than rounding it to something storable", () => {
    for (const text of ["", "  ", "abc", "-1", "7.5", "21", "100", "+3", "1e2", "１２"]) {
      expect(parseRecentLimit(text), text).toBeNull();
    }
  });
});

describe("withLookup", () => {
  it("puts the newest word first and keeps no duplicates", () => {
    expect(withLookup(["kafa", "hvala"], "zdravo", 8)).toEqual(["zdravo", "kafa", "hvala"]);
    expect(withLookup(["kafa", "hvala"], "kafa", 8)).toEqual(["kafa", "hvala"]);
  });

  it("deduplicates on the dictionary's folded key, not on the raw text", () => {
    // The same word typed with a capital and in the other script is one entry.
    expect(withLookup(["kafa"], "Kafa", 8)).toEqual(["Kafa"]);
    expect(withLookup(["kuća"], "КУЦА", 8)).toEqual(["КУЦА"]);
    expect(withLookup(["ćevapčići"], "cevapcici", 8)).toEqual(["cevapcici"]);
  });

  it("keeps the list at its limit, and keeps nothing at all at zero", () => {
    expect(withLookup(["a", "b", "c"], "d", 2)).toEqual(["d", "a"]);
    expect(withLookup(["a", "b"], "c", 0)).toEqual([]);
  });

  it("does not record an empty query", () => {
    expect(withLookup(["kafa"], "   ", 8)).toEqual(["kafa"]);
  });
});

describe("the device preferences in storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers the defaults on a machine that has never set them", () => {
    expect(readStoredDirection()).toBe("auto");
    expect(readStoredRecentLimit()).toBe(DEFAULT_RECENT_LIMIT);
    expect(readRecent("profile-1")).toEqual([]);
  });

  it("round-trips a direction and a limit", () => {
    persistDirection("sr-en");
    persistRecentLimit(MAX_RECENT_LIMIT);
    expect(readStoredDirection()).toBe("sr-en");
    expect(readStoredRecentLimit()).toBe(MAX_RECENT_LIMIT);
  });

  it("reads a value it did not write as the default rather than as a phase", () => {
    localStorage.setItem("nexus.translator.direction", "upwards");
    localStorage.setItem("nexus.translator.recent-limit", "many");
    expect(readStoredDirection()).toBe("auto");
    expect(readStoredRecentLimit()).toBe(DEFAULT_RECENT_LIMIT);
  });

  it("keeps one profile's recent list apart from another's, and clears one at a time", () => {
    persistRecent("profile-1", ["kafa", "hvala"]);
    persistRecent("profile-2", ["zdravo"]);
    expect(readRecent("profile-1")).toEqual(["kafa", "hvala"]);
    expect(readRecent("profile-2")).toEqual(["zdravo"]);

    clearRecent("profile-1");
    expect(readRecent("profile-1")).toEqual([]);
    expect(readRecent("profile-2")).toEqual(["zdravo"]);
  });

  it("forgets the two preference keys and leaves the recent lists alone", () => {
    persistDirection("en-sr");
    persistRecentLimit(3);
    persistRecent("profile-1", ["kafa"]);

    clearStoredTranslatorPreferences();

    expect(readStoredDirection()).toBe("auto");
    expect(readStoredRecentLimit()).toBe(DEFAULT_RECENT_LIMIT);
    expect(readRecent("profile-1")).toEqual(["kafa"]);
  });

  it("ignores a recent list that is not a list of words", () => {
    localStorage.setItem("nexus.translator.recent.profile-1", "not json");
    expect(readRecent("profile-1")).toEqual([]);
    localStorage.setItem("nexus.translator.recent.profile-1", JSON.stringify(["kafa", 7, "", null]));
    expect(readRecent("profile-1")).toEqual(["kafa"]);
  });
});
