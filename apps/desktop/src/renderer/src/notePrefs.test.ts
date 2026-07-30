import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyStoredNoteWidth,
  NOTE_WIDTHS,
  persistNoteMarkdownShortcuts,
  persistNoteWidth,
  readStoredNoteMarkdownShortcuts,
  readStoredNoteWidth,
} from "./notePrefs.js";
import { strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-036's two NOTE editor preferences. Same shape as the three in
 * `rendererPrefs.test.ts` — closed value set, safe fallback, a persist that
 * also writes the document root — so the stubs are the same ones, and the DOM
 * write asserted here is the single `setAttribute` the module performs.
 *
 * The two readers deliberately differ in their fallback DIRECTION: the width
 * falls back to a member of its set, while the markdown flag reads anything but
 * the exact opt-out string as ON. Both are pinned below.
 */

const WIDTH_KEY = "nexus.noteWidth";
const MARKDOWN_KEY = "nexus.noteMarkdownShortcuts";

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

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

// --- the reading measure ------------------------------------------------------

describe("NOTE_WIDTHS", () => {
  it("is the three measures, narrow to wide, without duplicates", () => {
    expect(NOTE_WIDTHS).toEqual(["uska", "normalna", "siroka"]);
    expect(new Set(NOTE_WIDTHS).size).toBe(NOTE_WIDTHS.length);
  });

  it("has a Serbian name for every measure the Settings row can offer", () => {
    for (const width of NOTE_WIDTHS) {
      expect(strings.settings.notes.widthNames[width]?.length, width).toBeGreaterThan(0);
    }
  });
});

describe("readStoredNoteWidth", () => {
  it("defaults to normalna — today's measure — when nothing is stored", () => {
    stubStorage();
    expect(readStoredNoteWidth()).toBe("normalna");
  });

  it("reads back every measure", () => {
    for (const width of NOTE_WIDTHS) {
      stubStorage({ [WIDTH_KEY]: width });
      expect(readStoredNoteWidth()).toBe(width);
    }
  });

  it("falls back to normalna for anything unrecognized, casing included", () => {
    for (const stored of ["", "  ", "Uska", "SIROKA", "70ch", "wide", "null"]) {
      stubStorage({ [WIDTH_KEY]: stored });
      expect(readStoredNoteWidth(), stored).toBe("normalna");
    }
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredNoteWidth()).toBe("normalna");
    expect(storage.length).toBe(0);
  });
});

describe("persistNoteWidth", () => {
  it("writes the key and mirrors the measure onto the document root", () => {
    const storage = stubStorage();
    const { attributes } = stubDocument();

    persistNoteWidth("siroka");

    expect(storage.getItem(WIDTH_KEY)).toBe("siroka");
    expect(attributes["data-note-width"]).toBe("siroka");
  });

  it("round-trips every measure", () => {
    stubStorage();
    stubDocument();
    for (const width of NOTE_WIDTHS) {
      persistNoteWidth(width);
      expect(readStoredNoteWidth()).toBe(width);
    }
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", [MARKDOWN_KEY]: "off" });
    stubDocument();
    persistNoteWidth("uska");
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem(MARKDOWN_KEY)).toBe("off");
  });
});

describe("applyStoredNoteWidth", () => {
  it("applies the stored measure before the first paint", () => {
    stubStorage({ [WIDTH_KEY]: "uska" });
    const { attributes } = stubDocument();

    applyStoredNoteWidth();

    expect(attributes["data-note-width"]).toBe("uska");
  });

  it("normalizes an unrecognized stored value back to the default, in storage too", () => {
    const storage = stubStorage({ [WIDTH_KEY]: "70ch" });
    const { attributes } = stubDocument();

    applyStoredNoteWidth();

    expect(attributes["data-note-width"]).toBe("normalna");
    expect(storage.getItem(WIDTH_KEY)).toBe("normalna");
  });
});

// --- the markdown input rules -------------------------------------------------

describe("readStoredNoteMarkdownShortcuts", () => {
  it("is ON when nothing is stored — turning it off is the deliberate choice", () => {
    stubStorage();
    expect(readStoredNoteMarkdownShortcuts()).toBe(true);
  });

  it("is OFF only for the exact opt-out string", () => {
    stubStorage({ [MARKDOWN_KEY]: "off" });
    expect(readStoredNoteMarkdownShortcuts()).toBe(false);
  });

  it("is ON for the opt-in string and for anything else at all", () => {
    for (const stored of ["on", "", "  ", "true", "false", "0", "1", "disabled"]) {
      stubStorage({ [MARKDOWN_KEY]: stored });
      expect(readStoredNoteMarkdownShortcuts(), stored).toBe(true);
    }
  });

  // CURRENT BEHAVIOUR, pinned rather than endorsed: the comparison is an exact,
  // case-sensitive `!== "off"`, so a hand-edited "OFF" or " off " silently
  // leaves the input rules ON. Unreachable through `persistNoteMarkdownShortcuts`
  // (it only ever writes "on"/"off"), so it is pinned and reported, not fixed
  // here.
  it("reads a differently-cased or padded opt-out as ON", () => {
    for (const stored of ["OFF", "Off", " off", "off "]) {
      stubStorage({ [MARKDOWN_KEY]: stored });
      expect(readStoredNoteMarkdownShortcuts(), stored).toBe(true);
    }
  });
});

describe("persistNoteMarkdownShortcuts", () => {
  it("writes the two spellings the reader knows", () => {
    const storage = stubStorage();
    persistNoteMarkdownShortcuts(false);
    expect(storage.getItem(MARKDOWN_KEY)).toBe("off");
    persistNoteMarkdownShortcuts(true);
    expect(storage.getItem(MARKDOWN_KEY)).toBe("on");
  });

  it("round-trips both states", () => {
    stubStorage();
    for (const enabled of [true, false, true]) {
      persistNoteMarkdownShortcuts(enabled);
      expect(readStoredNoteMarkdownShortcuts()).toBe(enabled);
    }
  });

  it("touches neither the width key nor any other preference", () => {
    const storage = stubStorage({ [WIDTH_KEY]: "siroka", "nexus.accent": "bordo" });
    persistNoteMarkdownShortcuts(false);
    expect(storage.getItem(WIDTH_KEY)).toBe("siroka");
    expect(storage.getItem("nexus.accent")).toBe("bordo");
  });

  it("needs no document — unlike the width, nothing about it is a CSS attribute", () => {
    stubStorage();
    expect(() => persistNoteMarkdownShortcuts(true)).not.toThrow();
  });
});
