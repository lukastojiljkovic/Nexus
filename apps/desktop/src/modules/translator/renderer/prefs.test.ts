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
  persistRecentLanguages,
  persistSerbianScript,
  persistTranslateModel,
  persistTranslateSource,
  persistTranslateTarget,
  readRecent,
  readRecentLanguages,
  readStoredDirection,
  readStoredRecentLimit,
  readStoredSerbianScript,
  readStoredTranslateModel,
  readStoredTranslateSource,
  readStoredTranslateTarget,
  withLookup,
  withRecentLanguage,
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

describe("the translate page's preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers the defaults on a machine that has never set them", () => {
    expect(readStoredTranslateSource()).toBe("auto");
    expect(readStoredTranslateTarget("eng_Latn")).toBe("eng_Latn");
    expect(readStoredTranslateModel()).toBeNull();
    expect(readStoredSerbianScript()).toBe("latin");
    expect(readRecentLanguages("source")).toEqual([]);
  });

  it("round-trips the source, the target, the model, the script and the recent languages", () => {
    persistTranslateSource("deu_Latn");
    persistTranslateTarget("srp_Cyrl");
    persistTranslateModel("nllb-1300m");
    persistSerbianScript("cyrillic");
    persistRecentLanguages("target", ["srp_Cyrl", "deu_Latn"]);
    expect(readStoredTranslateSource()).toBe("deu_Latn");
    expect(readStoredTranslateTarget("eng_Latn")).toBe("srp_Cyrl");
    expect(readStoredTranslateModel()).toBe("nllb-1300m");
    expect(readStoredSerbianScript()).toBe("cyrillic");
    expect(readRecentLanguages("target")).toEqual(["srp_Cyrl", "deu_Latn"]);
    expect(readRecentLanguages("source")).toEqual([]);
  });

  it("reads a value it did not write as the default", () => {
    localStorage.setItem("nexus.translator.translate.source", "de");
    localStorage.setItem("nexus.translator.translate.target", "xyz_Latn");
    localStorage.setItem("nexus.translator.translate.model", "nllb-7b");
    localStorage.setItem("nexus.translator.translate.script", "klingon");
    expect(readStoredTranslateSource()).toBe("auto");
    expect(readStoredTranslateTarget("eng_Latn")).toBe("eng_Latn");
    expect(readStoredTranslateModel()).toBeNull();
    expect(readStoredSerbianScript()).toBe("latin");
  });

  it("keeps only the languages the table carries, once each", () => {
    localStorage.setItem("nexus.translator.translate.recent.source", JSON.stringify(["deu_Latn", "nope", 7, "deu_Latn"]));
    expect(readRecentLanguages("source")).toEqual(["deu_Latn"]);
  });

  it("puts the newest language first on each side, keeps four, and never repeats one", () => {
    expect(withRecentLanguage(["a_Latn", "b_Latn", "c_Latn", "d_Latn"], "e_Latn")).toEqual([
      "e_Latn",
      "a_Latn",
      "b_Latn",
      "c_Latn",
    ]);
    expect(withRecentLanguage(["deu_Latn", "eng_Latn"], "deu_Latn")).toEqual(["deu_Latn", "eng_Latn"]);
  });
});
