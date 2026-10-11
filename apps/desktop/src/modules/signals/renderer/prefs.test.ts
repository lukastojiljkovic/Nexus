import { MAX_A4_HZ, MAX_WPM, MIN_A4_HZ, MIN_WPM } from "@nexus/core";
import { describe, expect, it } from "vitest";

import {
  MORSE_PITCH_MAX_HZ,
  MORSE_PITCH_MIN_HZ,
  SIGNALS_DEFAULTS,
  effectiveWpm,
  parseA4Input,
  parsePitchInput,
  parseSignalsPrefs,
  parseWpmInput,
  signalsPrefKey,
} from "./prefs.js";

/**
 * SIGNALS' device preferences and the four field readers.
 *
 * What is pinned here is the property the whole module rests on: a stored or
 * typed value can only ever become one the ENGINE will accept. `morseSchedule`
 * throws outside `MIN_WPM…MAX_WPM`, `noteForFrequency` answers null outside
 * `MIN_A4_HZ…MAX_A4_HZ`, and this is the one place both are narrowed — so a
 * hand-edited `localStorage` key or a half-typed field cannot reach them.
 */

describe("parseSignalsPrefs", () => {
  it("answers the defaults for nothing stored, an empty document and a malformed one", () => {
    for (const stored of [null, "", "{}", "not json", "[]", "7"]) {
      expect(parseSignalsPrefs(stored), String(stored)).toEqual(SIGNALS_DEFAULTS);
    }
  });

  it("reads a full document back field by field", () => {
    expect(
      parseSignalsPrefs(
        JSON.stringify({ wpm: 25, messageWpm: 12, pitchHz: 800, a4Hz: 415 }),
      ),
    ).toEqual({ wpm: 25, messageWpm: 12, pitchHz: 800, a4Hz: 415 });
  });

  it("refuses an out-of-range value rather than clamping it, and keeps the rest", () => {
    // A clamp would move a number the user can see; the default is at least a
    // number the card can name as its own.
    expect(parseSignalsPrefs(JSON.stringify({ wpm: MAX_WPM + 1, pitchHz: 900 }))).toEqual({
      ...SIGNALS_DEFAULTS,
      pitchHz: 900,
    });
    expect(parseSignalsPrefs(JSON.stringify({ wpm: MIN_WPM - 1 }))).toEqual(SIGNALS_DEFAULTS);
    expect(parseSignalsPrefs(JSON.stringify({ a4Hz: MAX_A4_HZ + 0.1 }))).toEqual(SIGNALS_DEFAULTS);
    expect(parseSignalsPrefs(JSON.stringify({ pitchHz: MORSE_PITCH_MIN_HZ - 1 }))).toEqual(
      SIGNALS_DEFAULTS,
    );
  });

  it("refuses a fractional words-per-minute figure — a speed is whole dits", () => {
    expect(parseSignalsPrefs(JSON.stringify({ wpm: 20.5 }))).toEqual(SIGNALS_DEFAULTS);
  });

  it("holds the message at the character speed when the stored pair is inverted", () => {
    // Farnsworth spacing only slows a message down; the engine throws on the
    // other order, so this is where that order stops existing.
    expect(parseSignalsPrefs(JSON.stringify({ wpm: 15, messageWpm: 30 }))).toEqual({
      ...SIGNALS_DEFAULTS,
      wpm: 15,
      messageWpm: 15,
    });
    // And a message speed with no character speed beside it follows the default
    // character speed only as far as it may.
    expect(parseSignalsPrefs(JSON.stringify({ messageWpm: 30 }))).toEqual({
      ...SIGNALS_DEFAULTS,
      messageWpm: 20,
    });
  });
});

describe("the field readers", () => {
  it("takes a whole speed inside the engine's own range and nothing else", () => {
    expect(parseWpmInput("20")).toBe(20);
    expect(parseWpmInput(" 5 ")).toBe(5);
    expect(parseWpmInput(String(MAX_WPM))).toBe(MAX_WPM);
    expect(parseWpmInput("0")).toBeNull();
    expect(parseWpmInput(String(MAX_WPM + 1))).toBeNull();
    expect(parseWpmInput("20.5")).toBeNull();
    expect(parseWpmInput("")).toBeNull();
    expect(parseWpmInput("x")).toBeNull();
  });

  it("takes a tone pitch only inside the module's own window", () => {
    expect(parsePitchInput("700")).toBe(700);
    expect(parsePitchInput("741.3")).toBe(741.3);
    expect(parsePitchInput(String(MORSE_PITCH_MIN_HZ))).toBe(MORSE_PITCH_MIN_HZ);
    expect(parsePitchInput(String(MORSE_PITCH_MAX_HZ))).toBe(MORSE_PITCH_MAX_HZ);
    expect(parsePitchInput(String(MORSE_PITCH_MIN_HZ - 0.5))).toBeNull();
    expect(parsePitchInput(String(MORSE_PITCH_MAX_HZ + 0.5))).toBeNull();
    expect(parsePitchInput("")).toBeNull();
  });

  it("takes an A4 reference only inside the range the engine names notes in", () => {
    expect(parseA4Input("440")).toBe(440);
    expect(parseA4Input("442.5")).toBe(442.5);
    expect(parseA4Input(String(MIN_A4_HZ))).toBe(MIN_A4_HZ);
    expect(parseA4Input(String(MAX_A4_HZ))).toBe(MAX_A4_HZ);
    expect(parseA4Input("414.9")).toBeNull();
    expect(parseA4Input("466.1")).toBeNull();
    // The comma is not a decimal mark here: the field is filled from a value
    // this app formatted, and reading both marks would accept what the other
    // locale's formatter prints.
    expect(parseA4Input("440,0")).toBeNull();
  });
});

describe("effectiveWpm", () => {
  it("never lets Farnsworth speed a message up", () => {
    expect(effectiveWpm(20, 12)).toBe(12);
    expect(effectiveWpm(20, 20)).toBe(20);
    expect(effectiveWpm(20, 30)).toBe(20);
  });
});

describe("signalsPrefKey", () => {
  it("gives every field of every profile a key of its own", () => {
    const fields = ["wpm", "messageWpm", "pitchHz", "a4Hz"] as const;
    const keys = [
      ...fields.map((field) => signalsPrefKey("profile-a", field)),
      ...fields.map((field) => signalsPrefKey("profile-b", field)),
    ];
    expect(new Set(keys).size).toBe(8);
    // The shape is pinned literally, because a key read from one spelling and
    // written under another is a preference that silently does not stick — and
    // nothing but this assertion looks at the strings.
    expect(signalsPrefKey("profile-a", "wpm")).toBe("nexus.signals.profile-a.wpm");
    // And these are NOT the questionnaire's keys (`nexus.profile.signals.<id>`).
    for (const key of keys) expect(key.startsWith("nexus.profile.")).toBe(false);
  });
});
