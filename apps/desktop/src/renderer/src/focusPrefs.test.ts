import { DEFAULT_FOCUS_CONFIG } from "@nexus/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredFocusPreferences,
  persistFocusConfig,
  readStoredFocusConfig,
} from "./focusPrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * FOKUS's one device preference — the Pomodoro shape. The desktop package's
 * Vitest runs under node, so `localStorage` is stubbed per file exactly as
 * `financePrefs`/`notePrefs`' own suites do.
 *
 * What is pinned here is the ONE property the whole card rests on: an
 * unreadable, half-written or hand-edited key can never produce a config the
 * engine would refuse — because the read runs core's own `validateFocusConfig`
 * and falls back whole rather than field by field.
 */

const KEY = "nexus.focus.config";

afterEach(() => {
  vi.unstubAllGlobals();
});

function withStorage(seed: Record<string, string> = {}): void {
  vi.stubGlobal("localStorage", memoryStorage(seed));
}

describe("the stored focus config", () => {
  it("falls back to the engine's own default when nothing is stored", () => {
    withStorage();
    expect(readStoredFocusConfig()).toEqual(DEFAULT_FOCUS_CONFIG);
  });

  it("reads back what was persisted", () => {
    withStorage();
    const config = {
      workMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 30,
      cyclesBeforeLongBreak: 2,
    };
    persistFocusConfig(config);
    expect(readStoredFocusConfig()).toEqual(config);
  });

  it("never answers the caller's own object, so a config cannot be mutated from under the page", () => {
    withStorage();
    persistFocusConfig(DEFAULT_FOCUS_CONFIG);
    const first = readStoredFocusConfig();
    first.workMinutes = 1;
    expect(readStoredFocusConfig().workMinutes).toBe(DEFAULT_FOCUS_CONFIG.workMinutes);
  });

  it("ignores a stored value that is not JSON at all", () => {
    withStorage({ [KEY]: "{{" });
    expect(readStoredFocusConfig()).toEqual(DEFAULT_FOCUS_CONFIG);
  });

  it("ignores a stored config the ENGINE would refuse — out of bounds, fractional, or short a key", () => {
    // The bounds are `validateFocusConfig`'s, never restated here: whatever the
    // engine calls invalid is what this read refuses, so the settings form and
    // the stored value can never disagree about what is acceptable.
    for (const stored of [
      '{"workMinutes":0,"shortBreakMinutes":5,"longBreakMinutes":15,"cyclesBeforeLongBreak":4}',
      '{"workMinutes":25.5,"shortBreakMinutes":5,"longBreakMinutes":15,"cyclesBeforeLongBreak":4}',
      '{"workMinutes":25,"shortBreakMinutes":5,"longBreakMinutes":15}',
      '{"workMinutes":25,"shortBreakMinutes":5,"longBreakMinutes":15,"cyclesBeforeLongBreak":4,"x":1}',
      "[]",
      "null",
    ]) {
      withStorage({ [KEY]: stored });
      expect(readStoredFocusConfig(), stored).toEqual(DEFAULT_FOCUS_CONFIG);
    }
  });

  it("falls back WHOLE rather than field by field — a broken key is not a config to salvage", () => {
    // Half a stored config plus half a default would be a shape nobody chose:
    // a 50-minute work phase somebody set, beside a 5-minute break they never
    // saw. The pair is the setting, so the pair is what is kept or dropped.
    withStorage({
      [KEY]: '{"workMinutes":50,"shortBreakMinutes":0,"longBreakMinutes":15,"cyclesBeforeLongBreak":4}',
    });
    expect(readStoredFocusConfig()).toEqual(DEFAULT_FOCUS_CONFIG);
  });

  it("forgets the key on a reset, so the next read opens on the default again", () => {
    withStorage();
    persistFocusConfig({
      workMinutes: 45,
      shortBreakMinutes: 8,
      longBreakMinutes: 20,
      cyclesBeforeLongBreak: 3,
    });
    clearStoredFocusPreferences();
    expect(readStoredFocusConfig()).toEqual(DEFAULT_FOCUS_CONFIG);
  });
});
