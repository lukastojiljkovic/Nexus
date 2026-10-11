import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryStorage } from "./testStorage.js";
import {
  DEFAULT_TOOL_VAT_RATE,
  clearStoredToolPreferences,
  isPdvRate,
  persistDefaultVatRate,
  readFavouriteTools,
  readRecentTools,
  readStoredDefaultVatRate,
  rememberRecentTool,
  toggleFavouriteTool,
} from "./toolPrefs.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the default PDV rate (UTIL slice c)", () => {
  it("opens on the general rate when nothing is stored", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readStoredDefaultVatRate()).toBe(DEFAULT_TOOL_VAT_RATE);
    expect(DEFAULT_TOOL_VAT_RATE).toBe(20);
  });

  it("round-trips the reduced rate", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    persistDefaultVatRate(10);
    expect(readStoredDefaultVatRate()).toBe(10);
  });

  /**
   * The guard that matters: `localStorage` is editable by hand, and a rate the
   * law does not have must never reach a calculation — a „17%" PDV figure would
   * be fabricated tax.
   */
  it("falls back rather than trusting a rate the law does not have", () => {
    for (const stored of ["17", "0", "-20", "abc", "", "20.5"]) {
      vi.stubGlobal("localStorage", memoryStorage({ "nexus.tools.defaultVatRate": stored }));
      expect(readStoredDefaultVatRate(), stored).toBe(DEFAULT_TOOL_VAT_RATE);
    }
  });

  it("accepts exactly the two rates and nothing else", () => {
    expect(isPdvRate(20)).toBe(true);
    expect(isPdvRate(10)).toBe(true);
    expect(isPdvRate(17)).toBe(false);
    expect(isPdvRate(0)).toBe(false);
  });

  it("forgets its one key on „Vrati na podrazumevano“", () => {
    vi.stubGlobal("localStorage", memoryStorage({ "nexus.tools.defaultVatRate": "10" }));
    clearStoredToolPreferences();
    expect(readStoredDefaultVatRate()).toBe(DEFAULT_TOOL_VAT_RATE);
  });
});

/**
 * Favourites and „Nedavno" — the drawer's two per-profile lists, and the only
 * state in it that is not derived from the registry. Every one of these is about
 * what happens when the store holds something this build did not write, or holds
 * what another profile wrote.
 */
describe("the drawer's per-profile lists (C10a)", () => {
  it("stars and unstars a tool, and answers with the new list", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readFavouriteTools("p1")).toEqual([]);
    expect(toggleFavouriteTool("p1", "pdv")).toEqual(["pdv"]);
    expect(toggleFavouriteTool("p1", "kredit")).toEqual(["pdv", "kredit"]);
    expect(readFavouriteTools("p1")).toEqual(["pdv", "kredit"]);
    expect(toggleFavouriteTool("p1", "pdv")).toEqual(["kredit"]);
  });

  /**
   * The reason these are keyed by profile at all: two people share a machine and
   * their drawers are different drawers, so the electrician's stars must not be
   * drawn under the student's name.
   */
  it("keeps each profile's stars and history to itself", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    toggleFavouriteTool("p1", "cable-cross-section");
    rememberRecentTool("p1", "cable-cross-section");
    expect(readFavouriteTools("p2")).toEqual([]);
    expect(readRecentTools("p2")).toEqual([]);
    expect(readFavouriteTools("p1")).toEqual(["cable-cross-section"]);
    expect(readRecentTools("p1")).toEqual(["cable-cross-section"]);
  });

  it("puts the newest first and never lists a tool twice", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    rememberRecentTool("p1", "a");
    rememberRecentTool("p1", "b");
    expect(rememberRecentTool("p1", "a")).toEqual(["a", "b"]);
    expect(readRecentTools("p1")).toEqual(["a", "b"]);
  });

  it("stops the history at eight, dropping the oldest", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      rememberRecentTool("p1", id);
    }
    expect(readRecentTools("p1")).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
  });

  /**
   * A list this build never wrote is not bounded by what this build writes: a
   * hand-edited file feeds a row per entry, and 500 of them would be 500 rows of
   * a finder panel somebody has to scroll past.
   */
  it("bounds a list a hand wrote, and drops what is not an id", () => {
    const many = Array.from({ length: 500 }, (_value, index) => `t${String(index)}`);
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        "nexus.tools.favourites.p1": JSON.stringify(many),
        "nexus.tools.recent.p1": '["a",3,null,{},"b","a"]',
      }),
    );
    expect(readFavouriteTools("p1")).toHaveLength(64);
    expect(readRecentTools("p1")).toEqual(["a", "b"]);
  });

  it("answers with an empty list rather than throwing on anything a hand could store", () => {
    for (const stored of ["", "not json", "null", "[]", "42", '"a"', '{"a":1}', "{}"]) {
      for (const key of ["nexus.tools.favourites.p1", "nexus.tools.recent.p1"]) {
        vi.stubGlobal("localStorage", memoryStorage({ [key]: stored }));
        expect(readFavouriteTools("p1"), `${key}:${stored}`).toEqual([]);
        expect(readRecentTools("p1"), `${key}:${stored}`).toEqual([]);
      }
    }
  });

  /**
   * „Vrati na podrazumevano" is one promise about the whole device, so it covers
   * every profile's stars — not only the one that happens to be open. A key list
   * here would have to grow one entry per profile to be able to say so.
   */
  it("is forgotten by „Vrati na podrazumevano“, for every profile", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    toggleFavouriteTool("p1", "pdv");
    toggleFavouriteTool("p2", "aes");
    rememberRecentTool("p1", "pdv");
    rememberRecentTool("p2", "aes");
    clearStoredToolPreferences();
    for (const profile of ["p1", "p2"]) {
      expect(readFavouriteTools(profile), profile).toEqual([]);
      expect(readRecentTools(profile), profile).toEqual([]);
    }
  });

  /**
   * The device-wide map an earlier build wrote is read by nobody, so the reset is
   * the only thing that can ever remove it, and the prefix walk alone misses it.
   */
  it("forgets the device-wide history an earlier build kept", () => {
    const storage = memoryStorage({ "nexus.tools.recent": JSON.stringify({ utilities: ["pdv"] }) });
    vi.stubGlobal("localStorage", storage);
    expect(readRecentTools("p1")).toEqual([]);
    clearStoredToolPreferences();
    expect(storage.getItem("nexus.tools.recent")).toBeNull();
  });

  /**
   * A `localStorage` that refuses to write — full, or switched off — must not be
   * able to turn „open a tool" into a click that throws. The list this call hands
   * back is still the right one; it is simply not on the disk.
   */
  it("still reports the new list when the device refuses to store it", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", {
      ...storage,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => rememberRecentTool("p1", "aes")).not.toThrow();
    expect(rememberRecentTool("p1", "aes")).toEqual(["aes"]);
    expect(toggleFavouriteTool("p1", "aes")).toEqual(["aes"]);
  });
});
