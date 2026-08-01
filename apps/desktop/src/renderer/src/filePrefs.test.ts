import { afterEach, describe, expect, it, vi } from "vitest";
import { MIME_FAMILIES } from "@nexus/core";

import { DOC_MIME_FAMILIES } from "../../shared/ipc.js";
import {
  FILE_VIEWS,
  clearStoredFilePreferences,
  persistFileView,
  readStoredFileView,
} from "./filePrefs.js";
import { strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";

/**
 * DOC's one device preference, on `taskPrefs.test.ts`'s shape — closed value
 * set, safe fallback, `localStorage` only, no document attribute.
 */

const KEY = "nexus.files.view";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("FILE_VIEWS", () => {
  it("is the two shapes, the default leading the segmented row", () => {
    expect(FILE_VIEWS).toEqual(["lista", "mreza"]);
    expect(new Set(FILE_VIEWS).size).toBe(FILE_VIEWS.length);
  });

  it("has a Serbian name for every shape the Settings row can offer", () => {
    for (const view of FILE_VIEWS) {
      expect(strings.settings.files.viewNames[view]?.length, view).toBeGreaterThan(0);
    }
  });
});

describe("readStoredFileView", () => {
  it("opens on the list when nothing is stored — the grid is the deliberate choice", () => {
    stubStorage();
    expect(readStoredFileView()).toBe("lista");
  });

  it("reads back both shapes", () => {
    for (const view of FILE_VIEWS) {
      stubStorage({ [KEY]: view });
      expect(readStoredFileView()).toBe(view);
    }
  });

  it("falls back to the list for anything unrecognized, casing included", () => {
    for (const stored of ["", "  ", "Lista", "MREZA", "mreža", "grid", "null"]) {
      stubStorage({ [KEY]: stored });
      expect(readStoredFileView(), stored).toBe("lista");
    }
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredFileView()).toBe("lista");
    expect(storage.length).toBe(0);
  });
});

describe("persistFileView", () => {
  it("writes the key and round-trips both shapes", () => {
    const storage = stubStorage();
    for (const view of FILE_VIEWS) {
      persistFileView(view);
      expect(storage.getItem(KEY)).toBe(view);
      expect(readStoredFileView()).toBe(view);
    }
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", "nexus.noteWidth": "siroka" });
    persistFileView("mreza");
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem("nexus.noteWidth")).toBe("siroka");
  });
});

describe("clearStoredFilePreferences", () => {
  it("removes the key outright, so the next read opens on the list again", () => {
    const storage = stubStorage({ [KEY]: "mreza" });
    clearStoredFilePreferences();
    expect(storage.getItem(KEY)).toBeNull();
    expect(readStoredFileView()).toBe("lista");
  });

  it("touches nothing outside its own card", () => {
    const storage = stubStorage({ [KEY]: "mreza", "nexus.noteWidth": "siroka" });
    clearStoredFilePreferences();
    expect(storage.getItem("nexus.noteWidth")).toBe("siroka");
  });
});

describe("the mime families the page and the wire agree on", () => {
  it("spells the same four, in the same order, as `@nexus/core`'s own definition", () => {
    // `shared/ipc.ts` redeclares string unions rather than importing them (its
    // header's rule). This is what keeps that copy honest: the chips come from
    // core's list, the rows come from a store filtered by core's rule, and the
    // wire's union has to be the same four or one of them would be a family the
    // page can ask for and nothing can answer.
    expect([...DOC_MIME_FAMILIES]).toEqual([...MIME_FAMILIES]);
  });

  it("has a Serbian chip label for every family", () => {
    for (const family of DOC_MIME_FAMILIES) {
      expect(strings.files.families[family]?.length, family).toBeGreaterThan(0);
    }
  });
});
