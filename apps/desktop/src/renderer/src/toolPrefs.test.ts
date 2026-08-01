import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryStorage } from "./testStorage.js";
import {
  DEFAULT_TOOL_VAT_RATE,
  clearStoredToolPreferences,
  isPdvRate,
  persistDefaultVatRate,
  readStoredDefaultVatRate,
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
