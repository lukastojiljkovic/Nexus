import { ACCENT_IDS } from "@nexus/tokens";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStoredAccent, persistAccent, readStoredAccent } from "./accent.js";
import { AUTO_LOCK_MINUTES, persistAutoLock, readStoredAutoLock } from "./autoLock.js";
import { memoryStorage } from "./testStorage.js";
import {
  applyStoredThemePreference,
  persistThemePreference,
  readStoredThemePreference,
  resolveTheme,
  subscribeSystemTheme,
} from "./theme.js";

/**
 * The three `localStorage`-backed preference modules — accent (`nexus.accent`),
 * theme (`nexus.theme`) and idle auto-lock (`nexus.autoLock`) — share one
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

// --- accent -------------------------------------------------------------------

describe("readStoredAccent", () => {
  it("falls back to zlato for nothing stored, an unknown id, or an empty string", () => {
    stubStorage();
    expect(readStoredAccent()).toBe("zlato");

    stubStorage({ "nexus.accent": "chartreuse" });
    expect(readStoredAccent()).toBe("zlato");

    stubStorage({ "nexus.accent": "" });
    expect(readStoredAccent()).toBe("zlato");
  });

  it("reads back every accent the token package defines", () => {
    for (const accent of ACCENT_IDS) {
      stubStorage({ "nexus.accent": accent });
      expect(readStoredAccent()).toBe(accent);
    }
  });
});

describe("persistAccent", () => {
  it("writes the key and mirrors the choice onto the document root", () => {
    const storage = stubStorage();
    const { attributes } = stubDocument();

    persistAccent("bordo");

    expect(storage.getItem("nexus.accent")).toBe("bordo");
    expect(attributes["data-accent"]).toBe("bordo");
  });

  it("round-trips through readStoredAccent", () => {
    stubStorage();
    stubDocument();
    persistAccent("maslina");
    expect(readStoredAccent()).toBe("maslina");
  });
});

describe("applyStoredAccent", () => {
  it("applies and normalizes an unrecognized stored value to the default", () => {
    const storage = stubStorage({ "nexus.accent": "chartreuse" });
    const { attributes } = stubDocument();

    applyStoredAccent();

    expect(attributes["data-accent"]).toBe("zlato");
    expect(storage.getItem("nexus.accent")).toBe("zlato");
  });
});

// --- theme --------------------------------------------------------------------

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

  // CURRENT BEHAVIOUR, pinned rather than endorsed: the value goes through
  // `Number(stored)`, and `Number("")` / `Number(" ")` are 0 — which IS an
  // allowed value, meaning "never lock". A blank stored entry therefore
  // disables auto-lock instead of falling back to 15 minutes, unlike every
  // other unusable value above. Unreachable through `persistAutoLock` (it only
  // ever writes a member of the closed set), so this is pinned and reported,
  // not fixed here.
  it("reads a blank stored value as 0 — never lock — not as the default", () => {
    stubStorage({ "nexus.autoLock": "" });
    expect(readStoredAutoLock()).toBe(0);

    stubStorage({ "nexus.autoLock": "  " });
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
    const storage = stubStorage({ "nexus.accent": "bordo", "nexus.theme": "dan" });
    persistAutoLock(60);
    expect(storage.getItem("nexus.accent")).toBe("bordo");
    expect(storage.getItem("nexus.theme")).toBe("dan");
  });
});
