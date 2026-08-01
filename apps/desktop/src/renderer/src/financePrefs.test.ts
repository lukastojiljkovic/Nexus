import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredFinancePreferences,
  DEFAULT_PRIMARY_CURRENCY,
  isCurrencyCode,
  normalizeCurrencyInput,
  persistPrimaryCurrency,
  readStoredPrimaryCurrency,
} from "./financePrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * FIN's one device preference. The desktop package's Vitest runs under node, so
 * `localStorage` is stubbed per file exactly as `notePrefs`/`taskPrefs`' own
 * suites do.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function withStorage(seed: Record<string, string> = {}): void {
  vi.stubGlobal("localStorage", memoryStorage(seed));
}

describe("isCurrencyCode", () => {
  it("accepts exactly the schema's own rule — three upper-case ASCII letters", () => {
    expect(isCurrencyCode("RSD")).toBe(true);
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("rsd")).toBe(false);
    expect(isCurrencyCode("RS")).toBe(false);
    expect(isCurrencyCode("RSDX")).toBe(false);
    expect(isCurrencyCode("R5D")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
  });
});

describe("normalizeCurrencyInput", () => {
  it("trims and up-cases what a person typed, because a FIELD may and the store may not", () => {
    expect(normalizeCurrencyInput(" rsd ")).toBe("RSD");
    expect(normalizeCurrencyInput("eur")).toBe("EUR");
    expect(normalizeCurrencyInput("USD")).toBe("USD");
  });

  it("answers null for anything that is not a code, rather than sending it on", () => {
    expect(normalizeCurrencyInput("")).toBeNull();
    expect(normalizeCurrencyInput("   ")).toBeNull();
    expect(normalizeCurrencyInput("dinar")).toBeNull();
    expect(normalizeCurrencyInput("12")).toBeNull();
  });
});

describe("the stored primary currency", () => {
  it("falls back to RSD when nothing is stored", () => {
    withStorage();
    expect(readStoredPrimaryCurrency()).toBe(DEFAULT_PRIMARY_CURRENCY);
    expect(DEFAULT_PRIMARY_CURRENCY).toBe("RSD");
  });

  it("reads back what was persisted", () => {
    withStorage();
    persistPrimaryCurrency("EUR");
    expect(readStoredPrimaryCurrency()).toBe("EUR");
  });

  it("ignores a stored value that is not a code — a hand-edited key cannot break the form", () => {
    withStorage({ "nexus.finance.primaryCurrency": "dinar" });
    expect(readStoredPrimaryCurrency()).toBe(DEFAULT_PRIMARY_CURRENCY);
  });

  it("forgets the key on a reset, so the next read opens on the default again", () => {
    withStorage();
    persistPrimaryCurrency("CHF");
    clearStoredFinancePreferences();
    expect(readStoredPrimaryCurrency()).toBe(DEFAULT_PRIMARY_CURRENCY);
  });
});
