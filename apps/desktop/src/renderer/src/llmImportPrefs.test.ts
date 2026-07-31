import { afterEach, describe, expect, it, vi } from "vitest";

import { LLM_IMPORT_KINDS, LLM_PROMPT_LANGUAGES } from "../../shared/ipc.js";
import {
  clearStoredLlmImportPreferences,
  persistLlmImportKind,
  persistLlmPromptLanguage,
  readStoredLlmImportKind,
  readStoredLlmPromptLanguage,
} from "./llmImportPrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * IMEX-005's two device preferences, on the shape `calendarPrefs.test.ts` and
 * its siblings pin: a closed value set, a safe fallback for anything
 * unrecognized, `localStorage` only, and no write on read. Neither touches the
 * document, so there is no DOM stub here at all.
 */

const KIND_KEY = "nexus.llmImport.kind";
const LANGUAGE_KEY = "nexus.llmImport.language";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

// --- the kind ------------------------------------------------------------------

describe("readStoredLlmImportKind", () => {
  it("defaults to tasks — the first kind the picker offers — when nothing is stored", () => {
    stubStorage();
    expect(readStoredLlmImportKind()).toBe("tasks");
  });

  it("reads back every kind", () => {
    for (const kind of LLM_IMPORT_KINDS) {
      stubStorage({ [KIND_KEY]: kind });
      expect(readStoredLlmImportKind()).toBe(kind);
    }
  });

  it("falls back to tasks for anything it cannot name, casing included", () => {
    for (const stored of ["", "  ", "Tasks", "TASKS", "notes", "task", "true"]) {
      stubStorage({ [KIND_KEY]: stored });
      expect(readStoredLlmImportKind(), stored).toBe("tasks");
    }
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredLlmImportKind()).toBe("tasks");
    expect(storage.length).toBe(0);
  });
});

describe("persistLlmImportKind", () => {
  it("writes the key and round-trips every kind", () => {
    const storage = stubStorage();
    for (const kind of LLM_IMPORT_KINDS) {
      persistLlmImportKind(kind);
      expect(storage.getItem(KIND_KEY)).toBe(kind);
      expect(readStoredLlmImportKind()).toBe(kind);
    }
  });

  it("touches neither the language nor any other preference key", () => {
    const storage = stubStorage({ [LANGUAGE_KEY]: "en", "nexus.accent": "bordo" });
    persistLlmImportKind("cards");
    expect(storage.getItem(LANGUAGE_KEY)).toBe("en");
    expect(storage.getItem("nexus.accent")).toBe("bordo");
  });
});

// --- the prompt language -------------------------------------------------------

describe("readStoredLlmPromptLanguage", () => {
  it("defaults to Serbian — the app's own language — when nothing is stored", () => {
    stubStorage();
    expect(readStoredLlmPromptLanguage()).toBe("sr");
  });

  it("reads back both languages", () => {
    for (const language of LLM_PROMPT_LANGUAGES) {
      stubStorage({ [LANGUAGE_KEY]: language });
      expect(readStoredLlmPromptLanguage()).toBe(language);
    }
  });

  it("falls back to Serbian for anything it cannot name, casing included", () => {
    for (const stored of ["", "  ", "SR", "En", "english", "de", "true"]) {
      stubStorage({ [LANGUAGE_KEY]: stored });
      expect(readStoredLlmPromptLanguage(), stored).toBe("sr");
    }
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredLlmPromptLanguage()).toBe("sr");
    expect(storage.length).toBe(0);
  });
});

describe("persistLlmPromptLanguage", () => {
  it("writes the key and round-trips both languages", () => {
    const storage = stubStorage();
    for (const language of LLM_PROMPT_LANGUAGES) {
      persistLlmPromptLanguage(language);
      expect(storage.getItem(LANGUAGE_KEY)).toBe(language);
      expect(readStoredLlmPromptLanguage()).toBe(language);
    }
  });

  it("touches neither the kind nor any other preference key", () => {
    const storage = stubStorage({ [KIND_KEY]: "events", "nexus.theme": "dan" });
    persistLlmPromptLanguage("en");
    expect(storage.getItem(KIND_KEY)).toBe("events");
    expect(storage.getItem("nexus.theme")).toBe("dan");
  });
});

// --- the reset -----------------------------------------------------------------

describe("clearStoredLlmImportPreferences", () => {
  it("forgets both keys, so the next read is the default again", () => {
    const storage = stubStorage({ [KIND_KEY]: "cards", [LANGUAGE_KEY]: "en" });

    clearStoredLlmImportPreferences();

    expect(storage.getItem(KIND_KEY)).toBeNull();
    expect(storage.getItem(LANGUAGE_KEY)).toBeNull();
    expect(readStoredLlmImportKind()).toBe("tasks");
    expect(readStoredLlmPromptLanguage()).toBe("sr");
  });

  it("leaves every other preference key alone", () => {
    const storage = stubStorage({
      [KIND_KEY]: "cards",
      "nexus.calendar.clock": "12h",
      "nexus.weekStart": "sunday",
    });

    clearStoredLlmImportPreferences();

    expect(storage.getItem("nexus.calendar.clock")).toBe("12h");
    expect(storage.getItem("nexus.weekStart")).toBe("sunday");
  });

  it("is safe on a device that never stored either key", () => {
    const storage = stubStorage();
    clearStoredLlmImportPreferences();
    expect(storage.length).toBe(0);
  });
});
