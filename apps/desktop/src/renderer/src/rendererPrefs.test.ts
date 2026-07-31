import { ACCENT_IDS } from "@nexus/tokens";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyBootAccent,
  applyProfileAccent,
  clearStoredAccent,
  defaultAccent,
  persistAccent,
  readStoredAccent,
  seedAccent,
} from "./accent.js";
import { AUTO_LOCK_MINUTES, persistAutoLock, readStoredAutoLock } from "./autoLock.js";
import { memoryStorage } from "./testStorage.js";
import {
  applyStoredThemePreference,
  DEFAULT_THEME_PREFERENCE,
  persistThemePreference,
  readStoredThemePreference,
  resolveTheme,
  subscribeSystemTheme,
} from "./theme.js";

/**
 * The three `localStorage`-backed preference modules — accent
 * (`nexus.accent.<profileId>`, per profile since ADR-058 §3), theme
 * (`nexus.theme`) and idle auto-lock (`nexus.autoLock`) — share one
 * shape: a closed set of allowed values, a safe fallback for anything else,
 * and a persist that also touches `document.documentElement`. They are tested
 * together because the fallback rule is the same rule, and any drift between
 * the three should show up side by side.
 *
 * No DOM library is involved: `localStorage`, `document` and `window` are
 * stubbed with `vi.stubGlobal`, and the stubs record exactly the calls these
 * modules make (`setAttribute`, `matchMedia`, `add`/`removeEventListener`).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A recording `document.documentElement.setAttribute` — the only DOM write these modules perform. */
function stubDocument(): { attributes: Record<string, string> } {
  const attributes: Record<string, string> = {};
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute(name: string, value: string): void {
        attributes[name] = value;
      },
    },
  });
  return { attributes };
}

interface MediaStub {
  query: string | null;
  listenerCount: number;
}

/** A `window.matchMedia` whose result reports `prefersDark` and counts its own change listeners. */
function stubMatchMedia(prefersDark: boolean): MediaStub {
  const stub: MediaStub = { query: null, listenerCount: 0 };
  vi.stubGlobal("window", {
    matchMedia(query: string) {
      stub.query = query;
      return {
        matches: prefersDark,
        addEventListener: (): void => {
          stub.listenerCount += 1;
        },
        removeEventListener: (): void => {
          stub.listenerCount -= 1;
        },
      };
    },
  });
  return stub;
}

/** Installs a fresh in-memory `localStorage`, optionally pre-seeded, and hands it back for direct inspection. */
function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

// --- accent (per-profile, AUTH-025 / ADR-058 §3) -----------------------------

describe("defaultAccent", () => {
  it("is zlato for a personal profile and the reserved bordo for a business one (decision #11)", () => {
    expect(defaultAccent("personal")).toBe("zlato");
    expect(defaultAccent("business")).toBe("bordo");
  });
});

describe("readStoredAccent", () => {
  it("falls back to the kind's default for nothing stored, an unknown id, or an empty string", () => {
    stubStorage();
    expect(readStoredAccent("p1", "personal")).toBe("zlato");
    expect(readStoredAccent("p1", "business")).toBe("bordo");

    stubStorage({ "nexus.accent.p1": "chartreuse" });
    expect(readStoredAccent("p1", "personal")).toBe("zlato");

    stubStorage({ "nexus.accent.p1": "" });
    expect(readStoredAccent("p1", "personal")).toBe("zlato");
  });

  it("reads back every accent the token package defines, keyed per profile", () => {
    for (const accent of ACCENT_IDS) {
      stubStorage({ "nexus.accent.p1": accent });
      expect(readStoredAccent("p1", "personal")).toBe(accent);
    }
  });

  it("keeps two profiles' accents apart", () => {
    stubStorage({ "nexus.accent.p1": "maslina", "nexus.accent.p2": "bordo" });
    expect(readStoredAccent("p1", "personal")).toBe("maslina");
    expect(readStoredAccent("p2", "business")).toBe("bordo");
  });

  // The one-time migration: readers only ever ask about the ACTIVE profile, so
  // a pre-ADR-058 device-wide `nexus.accent` value becomes THAT profile's own.
  it("adopts an unprefixed legacy value as this profile's own and removes the old key", () => {
    const storage = stubStorage({ "nexus.accent": "suma" });

    expect(readStoredAccent("p1", "personal")).toBe("suma");

    expect(storage.getItem("nexus.accent.p1")).toBe("suma");
    expect(storage.getItem("nexus.accent")).toBeNull();
  });

  it("discards an unrecognized legacy value instead of migrating it", () => {
    const storage = stubStorage({ "nexus.accent": "chartreuse" });

    expect(readStoredAccent("p1", "business")).toBe("bordo");

    expect(storage.getItem("nexus.accent")).toBeNull();
    expect(storage.getItem("nexus.accent.p1")).toBeNull();
  });

  it("prefers the profile's own value over a lingering legacy key, and still consumes the old key", () => {
    const storage = stubStorage({ "nexus.accent": "suma", "nexus.accent.p1": "ruza" });

    expect(readStoredAccent("p1", "personal")).toBe("ruza");

    // Consumed either way: a stale device-wide value left behind would be
    // adopted by the NEXT fresh profile's first read, which is nobody's choice.
    expect(storage.getItem("nexus.accent")).toBeNull();
    expect(storage.getItem("nexus.accent.p1")).toBe("ruza");
  });
});

describe("persistAccent", () => {
  it("writes the profile's own key and mirrors the choice onto the document root", () => {
    const storage = stubStorage();
    const { attributes } = stubDocument();

    persistAccent("p1", "bordo");

    expect(storage.getItem("nexus.accent.p1")).toBe("bordo");
    expect(attributes["data-accent"]).toBe("bordo");
  });

  it("round-trips through readStoredAccent and leaves other profiles' keys alone", () => {
    const storage = stubStorage({ "nexus.accent.p2": "grafit" });
    stubDocument();

    persistAccent("p1", "maslina");

    expect(readStoredAccent("p1", "personal")).toBe("maslina");
    expect(storage.getItem("nexus.accent.p2")).toBe("grafit");
  });
});

describe("seedAccent", () => {
  // No stubDocument on purpose: seeding a profile that is NOT active (a fresh
  // business profile's bordo, §3) must not repaint the document the active
  // profile is looking at — touching `document` here would throw.
  it("writes the profile's key without touching the document", () => {
    const storage = stubStorage();

    seedAccent("p-new", "bordo");

    expect(storage.getItem("nexus.accent.p-new")).toBe("bordo");
  });
});

describe("applyProfileAccent", () => {
  it("paints the profile's stored accent — where a profile switch lands", () => {
    stubStorage({ "nexus.accent.p2": "grafit" });
    const { attributes } = stubDocument();

    applyProfileAccent("p2", "personal");

    expect(attributes["data-accent"]).toBe("grafit");
  });

  it("paints the kind's default when the profile never chose", () => {
    stubStorage();
    const { attributes } = stubDocument();

    applyProfileAccent("p-biz", "business");

    expect(attributes["data-accent"]).toBe("bordo");
  });

  it("runs the legacy migration, so the adopted value is also what gets painted", () => {
    const storage = stubStorage({ "nexus.accent": "ruza" });
    const { attributes } = stubDocument();

    applyProfileAccent("p1", "personal");

    expect(attributes["data-accent"]).toBe("ruza");
    expect(storage.getItem("nexus.accent.p1")).toBe("ruza");
    expect(storage.getItem("nexus.accent")).toBeNull();
  });
});

describe("applyBootAccent", () => {
  it("paints the remembered profile's accent before first render, writing nothing", () => {
    const storage = stubStorage({ "nexus.accent.p1": "bordo" });
    const { attributes } = stubDocument();

    applyBootAccent("p1");

    expect(attributes["data-accent"]).toBe("bordo");
    expect(storage.getItem("nexus.accent.p1")).toBe("bordo");
    expect(storage.length).toBe(1);
  });

  it("falls back to a not-yet-migrated legacy value, leaving the migration to the real read", () => {
    const storage = stubStorage({ "nexus.accent": "suma" });
    const { attributes } = stubDocument();

    applyBootAccent(null);

    expect(attributes["data-accent"]).toBe("suma");
    // Boot validates nothing, so it writes nothing — the key survives for
    // readStoredAccent to migrate once the live profile list is known.
    expect(storage.getItem("nexus.accent")).toBe("suma");
  });

  it("paints the personal default when it knows nothing better", () => {
    stubStorage();
    const { attributes } = stubDocument();

    applyBootAccent(null);

    expect(attributes["data-accent"]).toBe("zlato");
  });

  it("ignores garbage wherever it finds it", () => {
    stubStorage({ "nexus.accent.p1": "chartreuse", "nexus.accent": "neon" });
    const { attributes } = stubDocument();

    applyBootAccent("p1");

    expect(attributes["data-accent"]).toBe("zlato");
  });
});

describe("clearStoredAccent", () => {
  it("removes the profile's key outright and repaints the document root on its kind's default", () => {
    const storage = stubStorage({ "nexus.accent.p1": "bordo" });
    const { attributes } = stubDocument();

    clearStoredAccent("p1", "personal");

    expect(storage.getItem("nexus.accent.p1")).toBeNull();
    expect(attributes["data-accent"]).toBe("zlato");
    expect(readStoredAccent("p1", "personal")).toBe("zlato");
  });

  it("resets a business profile onto bordo, not onto the personal default", () => {
    stubStorage({ "nexus.accent.p-biz": "grafit" });
    const { attributes } = stubDocument();

    clearStoredAccent("p-biz", "business");

    expect(attributes["data-accent"]).toBe("bordo");
  });

  it("also drops a pre-migration legacy key, so a reset can never resurrect it", () => {
    const storage = stubStorage({ "nexus.accent": "suma", "nexus.accent.p1": "bordo" });
    const { attributes } = stubDocument();

    clearStoredAccent("p1", "personal");

    expect(storage.getItem("nexus.accent")).toBeNull();
    expect(attributes["data-accent"]).toBe("zlato");
  });

  it("touches no other profile's accent and no other preference key — „Izgled“'s reset stops at its own card", () => {
    const storage = stubStorage({
      "nexus.accent.p1": "bordo",
      "nexus.accent.p2": "grafit",
      "nexus.noteWidth": "siroka",
      "nexus.tasks.blockedInToday": "prikazi",
    });
    stubDocument();

    clearStoredAccent("p1", "personal");

    expect(storage.getItem("nexus.accent.p2")).toBe("grafit");
    expect(storage.getItem("nexus.noteWidth")).toBe("siroka");
    expect(storage.getItem("nexus.tasks.blockedInToday")).toBe("prikazi");
  });
});

// --- theme --------------------------------------------------------------------

describe("DEFAULT_THEME_PREFERENCE", () => {
  // SET §5 hands this to App rather than clearing `nexus.theme` itself, so the
  // two readings of "no choice made" have to agree.
  it("is what an unset key reads back as", () => {
    stubStorage();
    expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    expect(DEFAULT_THEME_PREFERENCE).toBe("noc");
  });
});

describe("readStoredThemePreference", () => {
  it("defaults to noc — the product's identity theme — for anything unrecognized", () => {
    stubStorage();
    expect(readStoredThemePreference()).toBe("noc");

    stubStorage({ "nexus.theme": "sepia" });
    expect(readStoredThemePreference()).toBe("noc");

    stubStorage({ "nexus.theme": "" });
    expect(readStoredThemePreference()).toBe("noc");
  });

  it("keeps the two pre-'system' values working unchanged, plus system itself", () => {
    for (const preference of ["dan", "noc", "system"] as const) {
      stubStorage({ "nexus.theme": preference });
      expect(readStoredThemePreference()).toBe(preference);
    }
  });
});

describe("resolveTheme", () => {
  it("passes an explicit preference through without consulting the OS", () => {
    const media = stubMatchMedia(true);
    expect(resolveTheme("dan")).toBe("dan");
    expect(resolveTheme("noc")).toBe("noc");
    expect(media.query).toBeNull();
  });

  it("follows the OS dark-mode query for system", () => {
    const dark = stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("noc");
    expect(dark.query).toBe("(prefers-color-scheme: dark)");

    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("dan");
  });
});

describe("persistThemePreference", () => {
  it("stores the preference but writes the RESOLVED theme to the document root", () => {
    const storage = stubStorage();
    const { attributes } = stubDocument();
    stubMatchMedia(true);

    persistThemePreference("system");

    expect(storage.getItem("nexus.theme")).toBe("system");
    expect(attributes["data-theme"]).toBe("noc");
  });

  it("round-trips an explicit preference", () => {
    stubStorage();
    const { attributes } = stubDocument();
    stubMatchMedia(true);

    persistThemePreference("dan");

    expect(readStoredThemePreference()).toBe("dan");
    expect(attributes["data-theme"]).toBe("dan");
  });
});

describe("applyStoredThemePreference", () => {
  it("normalizes an unrecognized stored value and applies the default's resolved theme", () => {
    const storage = stubStorage({ "nexus.theme": "sepia" });
    const { attributes } = stubDocument();
    stubMatchMedia(false);

    applyStoredThemePreference();

    expect(storage.getItem("nexus.theme")).toBe("noc");
    expect(attributes["data-theme"]).toBe("noc");
  });
});

describe("subscribeSystemTheme", () => {
  it("attaches one change listener and detaches exactly that one on unsubscribe", () => {
    const media = stubMatchMedia(false);

    const unsubscribe = subscribeSystemTheme(() => undefined);
    expect(media.listenerCount).toBe(1);
    expect(media.query).toBe("(prefers-color-scheme: dark)");

    unsubscribe();
    expect(media.listenerCount).toBe(0);
  });
});

// --- auto-lock ----------------------------------------------------------------

describe("readStoredAutoLock", () => {
  it("defaults to 15 minutes when nothing is stored", () => {
    stubStorage();
    expect(readStoredAutoLock()).toBe(15);
  });

  it("reads back every allowed value, including 0 for never", () => {
    for (const minutes of AUTO_LOCK_MINUTES) {
      stubStorage({ "nexus.autoLock": String(minutes) });
      expect(readStoredAutoLock()).toBe(minutes);
    }
  });

  it("falls back to 15 for an out-of-set number or a non-number", () => {
    for (const stored of ["7", "-5", "1440", "abc", "15min", "NaN"]) {
      stubStorage({ "nexus.autoLock": stored });
      expect(readStoredAutoLock(), stored).toBe(15);
    }
  });

  // Blank text is the one unusable value that could disable a security control
  // rather than fall back: `Number("")` / `Number("  ")` are 0, an allowed
  // member meaning "never lock". A corrupted or tampered key must not be able
  // to switch auto-lock off, so it falls back like everything else above.
  it("falls back to 15 for a blank stored value instead of reading it as never", () => {
    stubStorage({ "nexus.autoLock": "" });
    expect(readStoredAutoLock()).toBe(15);

    stubStorage({ "nexus.autoLock": "  " });
    expect(readStoredAutoLock()).toBe(15);
  });

  // The other side of that rule: "never" is a choice the user can persist, and
  // an explicitly stored "0" must survive the blank-text guard untouched.
  it("keeps an explicitly stored 0 as never", () => {
    stubStorage({ "nexus.autoLock": "0" });
    expect(readStoredAutoLock()).toBe(0);
  });

  it("tolerates surrounding whitespace on an otherwise valid value", () => {
    stubStorage({ "nexus.autoLock": " 30 " });
    expect(readStoredAutoLock()).toBe(30);
  });
});

describe("persistAutoLock", () => {
  it("writes the key and round-trips every allowed value", () => {
    const storage = stubStorage();
    for (const minutes of AUTO_LOCK_MINUTES) {
      persistAutoLock(minutes);
      expect(storage.getItem("nexus.autoLock")).toBe(String(minutes));
      expect(readStoredAutoLock()).toBe(minutes);
    }
  });

  it("touches no other key — the three preference modules never collide", () => {
    const storage = stubStorage({ "nexus.accent.p1": "bordo", "nexus.theme": "dan" });
    persistAutoLock(60);
    expect(storage.getItem("nexus.accent.p1")).toBe("bordo");
    expect(storage.getItem("nexus.theme")).toBe("dan");
  });
});
