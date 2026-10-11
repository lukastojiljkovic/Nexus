import { describe, expect, it } from "vitest";

import {
  MAX_WPM,
  MIN_WPM,
  MORSE_TRANSLITERATIONS,
  PARIS_DIT_MS,
  charForMorse,
  decodeMorse,
  ditMs,
  encodeMorse,
  farnsworthGapUnits,
  farnsworthWordGapUnits,
  morseAlphabet,
  morseForChar,
  morseSchedule,
  scheduleDurationMs,
  type MorseInterval,
} from "./morse.js";
import { MORSE_ALPHABET, MORSE_BY_CODE } from "./morseTable.js";

/** The speed most cases below are sent at; the decoder is never told it. */
const WPM = 20;

/** One keyed interval of `units` dits at {@link WPM}. */
function key(units: number, on: boolean): MorseInterval {
  return { on, ms: units * ditMs(WPM) };
}

/** A run of `count` dots one unit apart, then a letter gap and a `T`, so the run is decodable at all. */
function dotRun(count: number): MorseInterval[] {
  const intervals: MorseInterval[] = [];
  for (let index = 0; index < count; index += 1) {
    intervals.push(key(1, true));
    if (index < count - 1) intervals.push(key(1, false));
  }
  intervals.push(key(3, false), key(3, true));
  return intervals;
}

/**
 * A seeded generator (mulberry32), so a jitter case that fails is the same case
 * on the next run. `Math.random` would make the assertion a different test
 * every time it ran, which is how a flaky decoder test becomes a deleted one.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** `text` sent at `wpm`, every interval multiplied by a factor in [0.8, 1.2]. */
function jittered(text: string, wpm: number, seed: number): MorseInterval[] {
  const random = seeded(seed);
  return morseSchedule(text, { charWpm: wpm }).map((interval) => ({
    on: interval.on,
    ms: interval.ms * (0.8 + 0.4 * random()),
  }));
}

describe("the ITU alphabet", () => {
  it("sends every row of the table and reads the same marks back", () => {
    for (const row of MORSE_ALPHABET) {
      expect(row.code, row.name).toMatch(/^[.-]+$/);
      if (row.char === null) continue; // a procedural signal is not a character
      expect(encodeMorse(row.char).code, `encoding ${row.char}`).toBe(row.code);
      const decoded = decodeMorse(morseSchedule(row.char, { charWpm: WPM }), { expectedWpm: WPM });
      expect(decoded.characters.map((character) => character.code).join(""), `decoding ${row.code}`).toBe(row.code);
    }
  });

  it("names every row's character back, minus the addition sign that shares its code with a signal", () => {
    for (const row of MORSE_ALPHABET) {
      if (row.char === null) continue;
      // The addition sign and „invitation to transmit" are both `.-.-.`; the
      // marks cannot say which was meant, so the decoder answers with the
      // character, and that is asserted below rather than skipped by accident.
      if (row.code === ".-.-.") continue;
      const decoded = decodeMorse(morseSchedule(row.char, { charWpm: WPM }), { expectedWpm: WPM });
      expect(decoded.text, `decoding ${row.code}`).toBe(row.char);
    }
  });

  it("answers with the character where a signal and a character share a code, and never invents one", () => {
    expect(charForMorse("-..-.")).toBe("/");
    expect(charForMorse(".-.-.")).toBe("+");
    expect(MORSE_BY_CODE.get(".-.-.")?.char).toBe("+");
    // `........` is the one code no character has, and it is the error signal.
    expect(charForMorse("........")).toBeNull();
    expect(MORSE_BY_CODE.get("........")?.name).toBe("Error");
    expect(MORSE_BY_CODE.get("........")?.symbol).toBe("HH");
  });

  it("matches a character whatever case and spacing the caller writes it with", () => {
    expect(morseForChar("a")).toBe(".-");
    expect(morseForChar("  A  ")).toBe(".-");
    expect(morseForChar("!")).toBeNull();
    expect(morseForChar("")).toBeNull();
    expect(charForMorse("...")).toBe("S");
    expect(charForMorse(". . .")).toBe("S"); // separators between marks are ignored
    expect(charForMorse("")).toBeNull();
    expect(charForMorse("...-.-")).toBeNull(); // `SK` is a signal, not a character
  });

  it("offers every character of the alphabet, in table order", () => {
    const characters = morseAlphabet();
    expect(characters).toEqual(MORSE_ALPHABET.filter((row) => row.char !== null));
    // 14 signs in §1.1.3, less the multiplication sign, which is sent as X.
    expect(characters.length).toBe(26 + 10 + 13);
    for (const row of characters) expect(morseForChar(row.char as string)).toBe(row.code);
  });
});

describe("the Serbian letters the ITU alphabet does not have", () => {
  it("transliterates each one and reports it", () => {
    expect(MORSE_TRANSLITERATIONS).toEqual({
      č: "c",
      ć: "c",
      š: "s",
      ž: "z",
      đ: "dj",
      "×": "x",
      "%": "0/0",
      "‰": "0/00",
    });
    expect(encodeMorse("čćšžđ")).toEqual({
      code: "-.-. -.-. ... --.. -.. .---",
      transliterated: ["č", "ć", "š", "ž", "đ"],
    });
    expect(encodeMorse("ČĆŠŽĐ").code).toBe("-.-. -.-. ... --.. -.. .---");
    expect(encodeMorse("č").code).toBe(encodeMorse("c").code);
    expect(encodeMorse("đ").code).toBe(encodeMorse("dj").code);
    // Reported once however often it appears, and still without a code of its own.
    expect(encodeMorse("žžž").transliterated).toEqual(["ž"]);
    expect(morseForChar("č")).toBeNull();
    expect(morseForChar("đ")).toBeNull();
  });

  it("sends the three signs ITU-R M.1677-1 spells with other characters", () => {
    // §3.2.1: the multiplication sign is the letter X.
    expect(encodeMorse("2×3")).toEqual({ code: "..--- -..- ...--", transliterated: ["×"] });
    // §3.3.1: % is 0, the fraction bar, 0; ‰ is 0, the fraction bar, 00.
    expect(encodeMorse("5%").code).toBe("..... ----- -..-. -----");
    expect(encodeMorse("‰").code).toBe("----- -..-. ----- -----");
    // `*` is no ITU character, so it is reported and not sent.
    expect(encodeMorse("*")).toEqual({ code: "", transliterated: ["*"] });
  });

  it("reports a character the alphabet has no code for instead of inventing one", () => {
    expect(encodeMorse("a!b")).toEqual({ code: ".- -...", transliterated: ["!"] });
    // A word that encodes to nothing leaves nothing behind, and still says so.
    expect(encodeMorse("!!!")).toEqual({ code: "", transliterated: ["!"] });
    expect(encodeMorse("  ")).toEqual({ code: "", transliterated: [] });
  });
});

describe("timing", () => {
  it("sends PARIS in the standard's own 50 units, which is what a WPM counts", () => {
    // ITU-R M.1677-1 §2: one dit is `1200 / WPM` ms, and a word is fifty of
    // them because that is `PARIS` plus the gap after it — the word every speed
    // in the world is measured by.
    for (const wpm of [5, 12, 20, 25, 60]) expect(ditMs(wpm)).toBeCloseTo(1200 / wpm, 12);
    expect(PARIS_DIT_MS).toBe(1200);

    let units = 0;
    for (const char of "PARIS") {
      const code = morseForChar(char) as string;
      for (const mark of code) units += mark === "-" ? 3 : 1;
      units += code.length - 1; // one unit between the elements of a character
    }
    expect(units).toBe(31); // the marks and the gaps inside the five characters
    units += ("PARIS".length - 1) * 3; // three units between characters
    units += 7; // and seven between words
    expect(units).toBe(50);

    // A schedule stops at the last mark — a message is not followed by silence —
    // so two words and the one gap between them are 2 × 50 − 7 units, which is
    // 60 000 / WPM ms a word.
    const twoWords = scheduleDurationMs(morseSchedule("PARIS PARIS", { charWpm: 20 }));
    expect(twoWords).toBeCloseTo((2 * 50 - 7) * ditMs(20), 9);
    expect(twoWords).toBeCloseTo(2 * (60_000 / 20) - 7 * ditMs(20), 9);
  });

  it("keys and unkeys alternately, starting and ending keyed", () => {
    const schedule = morseSchedule("SOS", { charWpm: WPM });
    schedule.forEach((interval, index) => expect(interval.on, `interval ${index}`).toBe(index % 2 === 0));
    expect(schedule[schedule.length - 1]?.on).toBe(true);
    expect(scheduleDurationMs(schedule)).toBeCloseTo(
      schedule.reduce((total, interval) => total + interval.ms, 0),
      9,
    );
  });

  it("refuses a schedule nobody meant", () => {
    expect(() => morseSchedule("A", { charWpm: MIN_WPM - 1 })).toThrow(RangeError);
    expect(() => morseSchedule("A", { charWpm: MAX_WPM + 1 })).toThrow(RangeError);
    expect(() => morseSchedule("A", { charWpm: Number.NaN })).toThrow(RangeError);
    expect(() => morseSchedule("A", { charWpm: 20, wpm: 21 })).toThrow(RangeError);
    expect(() => morseSchedule("A", { charWpm: 20, wpm: 0 })).toThrow(RangeError);
  });
});

describe("Farnsworth spacing", () => {
  it("is the standard timing when the message is not slowed", () => {
    for (const wpm of [5, 15, 25, 60]) {
      expect(farnsworthGapUnits(wpm, wpm)).toBe(3);
      expect(farnsworthWordGapUnits(wpm, wpm)).toBe(7);
    }
    // Farnsworth only slows a message down, so an effective speed above the
    // character speed is the standard spacing rather than a squeezed one.
    expect(farnsworthGapUnits(10, 20)).toBe(3);
  });

  it("stretches the character gap to hold the effective speed, 1 : 3 : 7 intact", () => {
    // Derived in `farnsworthGapUnits`: the word PARIS is 31 units of marks and
    // gaps inside characters plus four character gaps and one word gap, and at
    // effective speed `w` it has to last `60 000 / w` ms. Keeping the word gap
    // at the standard's 7/3 of the character gap `g` gives
    // `1200/c · (31 + 4g + 7g/3) = 60 000/w`, i.e. `g = (150·c/w − 93) / 19`,
    // which is 3 exactly when the two speeds are equal.
    for (const [charWpm, wpm] of [
      [20, 10],
      [25, 5],
      [15, 12],
      [30, 3],
    ] as const) {
      const gap = (150 * (charWpm / wpm) - 93) / 19;
      expect(farnsworthGapUnits(charWpm, wpm)).toBeCloseTo(gap, 12);
      expect(farnsworthWordGapUnits(charWpm, wpm)).toBeCloseTo((gap / 3) * 7, 12);
      expect(gap).toBeGreaterThan(3);
    }
    expect(farnsworthGapUnits(20, 10)).toBeGreaterThan(farnsworthGapUnits(20, 15));
  });

  it("keeps the marks at the character speed and the message at the effective one", () => {
    const charWpm = 20;
    const wpm = 10;
    const schedule = morseSchedule("PARIS PARIS", { charWpm, wpm });
    for (const interval of schedule) {
      if (!interval.on) continue;
      // One dit or three, at the CHARACTER speed: the stretch is in the gaps.
      const units = interval.ms / ditMs(charWpm);
      const whole = Math.round(units);
      expect([1, 3]).toContain(whole);
      expect(Math.abs(units - whole)).toBeLessThan(1e-9);
    }
    // Two words at `60 000 / w` ms each, less the trailing word gap a schedule
    // does not emit: the effective speed, to the millisecond.
    const wordGapMs = farnsworthWordGapUnits(charWpm, wpm) * ditMs(charWpm);
    expect(scheduleDurationMs(schedule)).toBeCloseTo(2 * (60_000 / wpm) - wordGapMs, 6);
  });
});

describe("decoding", () => {
  const SENTENCE = "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG";

  it("reads its own schedule back at 5, 15 and 25 wpm", () => {
    for (const wpm of [5, 15, 25]) {
      const result = decodeMorse(morseSchedule(SENTENCE, { charWpm: wpm }));
      expect(result.text, `at ${wpm} wpm`).toBe(SENTENCE);
      expect(result.unitMs, `at ${wpm} wpm`).toBeCloseTo(ditMs(wpm), 9);
      expect(result.wpm, `at ${wpm} wpm`).toBeCloseTo(wpm, 9);
      expect(result.ambiguous, `at ${wpm} wpm`).toBe(false);
    }
  });

  it("survives a hand key: every interval within ±20 %, four seeds, three speeds", () => {
    for (const wpm of [5, 15, 25]) {
      for (const seed of [1, 7, 42, 2026]) {
        const result = decodeMorse(jittered(SENTENCE, wpm, seed));
        expect(result.text, `${wpm} wpm, seed ${seed}`).toBe(SENTENCE);
        expect(result.ambiguous, `${wpm} wpm, seed ${seed}`).toBe(false);
      }
    }
  });

  it("reads a message with no dot at all from the gaps inside its characters", () => {
    // Every mark in `TOM` is a dash, so the shortest MARK is three units long
    // and an estimate taken from the marks alone calls it a dit and answers
    // `EEE`. The gap inside `O` and the gap inside `M` are one unit each, and
    // that is what the unit is measured by.
    expect(decodeMorse(morseSchedule("TOM", { charWpm: WPM }))).toMatchObject({
      text: "TOM",
      unitMs: ditMs(WPM),
      ambiguous: false,
    });
    expect(decodeMorse(morseSchedule("MOM", { charWpm: WPM })).text).toBe("MOM");
    // A message that is nearly all dashes still measures one unit in the gaps
    // inside its characters, and the estimate must not be dragged up by the
    // dashes it is mostly made of.
    expect(decodeMorse(morseSchedule("MMMM MMMM", { charWpm: WPM }))).toMatchObject({
      text: "MMMM MMMM",
      unitMs: ditMs(WPM),
      ambiguous: false,
    });
  });

  it("reports a message that measures no one-unit interval as ambiguous, and reads it when told the speed", () => {
    for (const text of ["T", "TTT", "T T"]) {
      const timings = morseSchedule(text, { charWpm: WPM });
      expect(decodeMorse(timings).ambiguous, text).toBe(true);
      const told = decodeMorse(timings, { expectedWpm: WPM });
      expect(told.text, text).toBe(text);
      expect(told.ambiguous, text).toBe(false);
      expect(told.unitMs, text).toBeCloseTo(ditMs(WPM), 9);
      expect(told.wpm, text).toBeCloseTo(WPM, 9);
    }
    // A message of dots measures nothing either: `S` is `T T T` at a third of
    // the speed and `E` is `T` at a third of it, so the reading is a guess.
    expect(decodeMorse(morseSchedule("S", { charWpm: WPM }))).toMatchObject({ text: "S", ambiguous: true });
    expect(decodeMorse(morseSchedule("E", { charWpm: WPM }))).toMatchObject({ text: "E", ambiguous: true });
    // A value that is not a speed is not trusted as one.
    expect(decodeMorse(morseSchedule("TOM", { charWpm: WPM }), { expectedWpm: Number.NaN }).text).toBe("TOM");
    expect(decodeMorse(morseSchedule("TOM", { charWpm: WPM }), { expectedWpm: 0 }).text).toBe("TOM");
  });

  it("keeps the space between two words, on the character it belongs to", () => {
    const result = decodeMorse(morseSchedule("E T", { charWpm: WPM }));
    expect(result.text).toBe("E T");
    expect(result.characters.map((character) => character.wordGap)).toEqual([false, true]);
  });

  it("answers `?` for a run the alphabet has no code for, and keeps the run", () => {
    const unknown = decodeMorse(dotRun(6));
    expect(unknown.text).toBe("?T");
    expect(unknown.characters[0]).toEqual({ char: null, code: "......", wordGap: false });
    expect(unknown.characters[1]).toEqual({ char: "T", code: "-", wordGap: false });
    // `........` is the Recommendation's error signal — a code in the table with
    // no character — so it reads as `?` too rather than as a letter.
    const error = decodeMorse(dotRun(8));
    expect(error.text).toBe("?T");
    expect(error.characters[0]).toEqual({ char: null, code: "........", wordGap: false });
  });
});
