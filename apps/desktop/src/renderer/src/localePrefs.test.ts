import { afterEach, describe, expect, it, vi } from "vitest";

import { activeLocale, applyLocale, DEFAULT_LOCALE, LOCALES, strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";
import {
  applyStoredLocale,
  availableLocales,
  clearStoredLocale,
  persistLocale,
  readStoredLocale,
} from "./localePrefs.js";

/**
 * The language preference — `weekStart.ts`'s shape, with one thing that
 * preference does not have: a stored value here names a TABLE, and a table that
 * is not in the build cannot be served. So what is pinned is the validation
 * (anything unrecognised falls back rather than being cast), the round trip,
 * and that the settings row's option list is the build's own truth rather than
 * a second hand-written one.
 */

const STORAGE_KEY = "nexus.locale";

afterEach(() => {
  vi.unstubAllGlobals();
  // Every test in this file may have served a different table; put the process
  // back where the rest of the suite expects it.
  applyLocale(DEFAULT_LOCALE);
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("readStoredLocale", () => {
  it("answers Serbian when nothing is stored", () => {
    stubStorage();
    expect(readStoredLocale()).toBe("sr");
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it("answers Serbian for a code that is not in the build", () => {
    // The case that matters: a language removed from `LOCALES` — or typed into
    // localStorage by hand — must not leave the app reaching for a table that
    // does not exist.
    stubStorage({ [STORAGE_KEY]: "de" });
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it("ignores a value that is not a string key at all", () => {
    stubStorage({ [STORAGE_KEY]: "__proto__" });
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
    stubStorage({ [STORAGE_KEY]: "toString" });
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it("round-trips every locale the build actually ships", () => {
    for (const locale of availableLocales()) {
      const storage = stubStorage();
      persistLocale(locale);
      expect(storage.getItem(STORAGE_KEY)).toBe(locale);
      expect(readStoredLocale()).toBe(locale);
    }
  });
});

describe("clearStoredLocale", () => {
  it("returns the next read to Serbian", () => {
    const storage = stubStorage({ [STORAGE_KEY]: DEFAULT_LOCALE });
    clearStoredLocale();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe("availableLocales", () => {
  it("is the build's own list and never a second hand-written one", () => {
    // The settings row offers exactly this. The gallery's icon list is the
    // cautionary tale: a hand-maintained mirror of a growing set showed 27 of
    // 91 for months, and nothing failed.
    expect(availableLocales()).toEqual(Object.keys(LOCALES));
  });

  it("names a table that the copy layer can actually serve", () => {
    for (const locale of availableLocales()) {
      applyLocale(locale);
      expect(activeLocale()).toBe(locale);
      // Any leaf will do; the point is that a real table was installed rather
      // than the object being left half-written.
      expect(typeof strings.app.brand).toBe("string");
      expect(strings.app.brand.length).toBeGreaterThan(0);
    }
  });
});

describe("applyStoredLocale", () => {
  it("serves the stored language", () => {
    stubStorage({ [STORAGE_KEY]: DEFAULT_LOCALE });
    applyStoredLocale();
    expect(activeLocale()).toBe(DEFAULT_LOCALE);
  });

  it("serves Serbian rather than throwing when the stored code is unknown", () => {
    stubStorage({ [STORAGE_KEY]: "klingon" });
    applyStoredLocale();
    expect(activeLocale()).toBe(DEFAULT_LOCALE);
  });
});
