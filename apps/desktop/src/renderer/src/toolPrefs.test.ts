import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryStorage } from "./testStorage.js";
import {
  DEFAULT_TOOL_VAT_RATE,
  clearStoredToolPreferences,
  isPdvRate,
  persistDefaultVatRate,
  readRecentTools,
  readStoredDefaultVatRate,
  rememberRecentTool,
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
 * „Nedavno" — the only list in the drawer that is not derived from the registry,
 * which is why every one of these is about what happens when the stored value is
 * not what this build wrote.
 */
describe("„Nedavno“ (PRO slice a)", () => {
  it("is empty on a device that has opened nothing", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readRecentTools("professional")).toEqual([]);
  });

  it("puts the newest first and never lists a tool twice", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    rememberRecentTool("professional", "a");
    rememberRecentTool("professional", "b");
    expect(rememberRecentTool("professional", "a")).toEqual(["a", "b"]);
    expect(readRecentTools("professional")).toEqual(["a", "b"]);
  });

  it("stops at eight, dropping the oldest", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      rememberRecentTool("professional", id);
    }
    expect(readRecentTools("professional")).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
  });

  /**
   * The two drawers share one key and must never share a list: „Alatke" and
   * „Stručne alatke" have no tool in common, so one drawer's history under the
   * other's name would be a row that opens nothing, every row.
   */
  it("keeps each drawer's history to itself", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    rememberRecentTool("utilities", "kredit");
    rememberRecentTool("professional", "omov-zakon");
    expect(readRecentTools("utilities")).toEqual(["kredit"]);
    expect(readRecentTools("professional")).toEqual(["omov-zakon"]);
  });

  it("answers with an empty list rather than throwing on anything a hand could store", () => {
    for (const stored of ["", "not json", "null", "[]", "42", '"a"', '{"professional":7}']) {
      vi.stubGlobal("localStorage", memoryStorage({ "nexus.tools.recent": stored }));
      expect(readRecentTools("professional"), stored).toEqual([]);
    }
  });

  it("drops entries that are not strings, and keeps the ones that are", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({ "nexus.tools.recent": '{"professional":["a",3,null,{},"b"]}' }),
    );
    expect(readRecentTools("professional")).toEqual(["a", "b"]);
  });

  /**
   * The cap is applied on READ as well as on write. A hand-edited file is not
   * bounded by what this build wrote, and the list feeds a row per entry.
   */
  it("caps a list that was never written by this build", () => {
    const ids = Array.from({ length: 500 }, (_value, index) => `t${String(index)}`);
    vi.stubGlobal(
      "localStorage",
      memoryStorage({ "nexus.tools.recent": JSON.stringify({ professional: ids }) }),
    );
    expect(readRecentTools("professional")).toHaveLength(8);
  });

  it("is forgotten by „Vrati na podrazumevano“, in both drawers", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    rememberRecentTool("utilities", "pdv");
    rememberRecentTool("professional", "aes");
    clearStoredToolPreferences();
    expect(readRecentTools("utilities")).toEqual([]);
    expect(readRecentTools("professional")).toEqual([]);
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
    expect(() => rememberRecentTool("professional", "aes")).not.toThrow();
    expect(rememberRecentTool("professional", "aes")).toEqual(["aes"]);
  });
});
