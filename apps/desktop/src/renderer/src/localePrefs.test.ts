import { afterEach, describe, expect, it, vi } from "vitest";

import { activeLocale, applyLocale, DEFAULT_LOCALE, LOCALES, strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";
import {
  applyStoredLocale,
  availableLocales,
  clearStoredLocale,
  persistLocale,
  readStoredLocale,
  reportLocaleToMain,
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

/**
 * The system language probe. Stubbed explicitly in every first-run test because
 * the answer must not depend on the machine the suite happens to run on: Node
 * 24 exposes a real `navigator.language`, and on a Serbian developer's laptop
 * that is `sr-Latn-RS`.
 */
function stubLanguage(language: string | undefined): void {
  vi.stubGlobal("navigator", language === undefined ? undefined : { language });
}

describe("readStoredLocale", () => {
  it("answers Serbian when nothing is stored and the system reads Serbian", () => {
    stubStorage();
    stubLanguage("sr-Latn-RS");
    expect(readStoredLocale()).toBe("sr");
    expect(readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it("answers English when nothing is stored and the system reads anything else", () => {
    for (const language of ["en-US", "de-DE", "fr", "sr-Cyrl"]) {
      // `sr-Cyrl` is still Serbian to a reader, so it stays Serbian.
      stubStorage();
      stubLanguage(language);
      expect(readStoredLocale(), language).toBe(language.startsWith("sr") ? "sr" : "en");
    }
  });

  it("answers English when the environment reports no language at all", () => {
    // A stripped build has no system language to ask about; "not Serbian" is
    // the same answer as any other non-Serbian code.
    stubStorage();
    stubLanguage(undefined);
    expect(readStoredLocale()).toBe("en");
    stubStorage();
    stubLanguage("");
    expect(readStoredLocale()).toBe("en");
  });

  it("answers the default for a stored code that is not in the build", () => {
    // The case that matters: a language removed from `LOCALES` — or typed into
    // localStorage by hand — must not leave the app reaching for a table that
    // does not exist. It falls back to `DEFAULT_LOCALE` rather than to the
    // system language: the question was answered once, and a stale answer must
    // not flip the interface.
    stubStorage({ [STORAGE_KEY]: "de" });
    stubLanguage("de-DE");
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
  it("forgets the choice, so the next read is a first run again", () => {
    const storage = stubStorage({ [STORAGE_KEY]: "en" });
    stubLanguage("sr-RS");
    clearStoredLocale();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredLocale()).toBe("sr");
  });

  it("hands the question back to the system language", () => {
    stubStorage({ [STORAGE_KEY]: "sr" });
    stubLanguage("de-DE");
    clearStoredLocale();
    expect(readStoredLocale()).toBe("en");
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

describe("reportLocaleToMain", () => {
  it("reports the served language to the bridge", () => {
    const setLocale = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { nexus: { setLocale } });
    reportLocaleToMain("en");
    expect(setLocale).toHaveBeenCalledWith("en");
  });

  it("is silent when there is no bridge to report to", () => {
    vi.stubGlobal("window", undefined);
    expect(() => reportLocaleToMain("en")).not.toThrow();
    vi.stubGlobal("window", {});
    expect(() => reportLocaleToMain("en")).not.toThrow();
  });
});
