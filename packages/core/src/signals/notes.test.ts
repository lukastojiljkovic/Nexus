import { describe, expect, it } from "vitest";

import {
  CHROMATIC_PRESET,
  CONCERT_A4_HZ,
  MAX_A4_HZ,
  MIN_A4_HZ,
  NOTE_NAMES,
  SEMITONE_RATIO,
  TUNING_PRESETS,
  centsBetween,
  isValidA4,
  noteForFrequency,
  noteFrequencyHz,
  noteLabel,
  shiftCents,
  targetFor,
} from "./notes.js";

/**
 * The pitch classes again, spelled here rather than read from the module, so
 * the table is checked by a list somebody wrote twice.
 */
const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The frequency 12-TET gives a label, from the label alone and not from the module's arithmetic. */
function twelveTet(label: string, a4Hz = CONCERT_A4_HZ): number {
  const [, letter = "", accidental = "", octave = "4"] = /^([A-G])(#?)(-?\d+)$/.exec(label) as RegExpExecArray;
  const midi = (Number(octave) + 1) * 12 + PITCH_CLASSES.indexOf(`${letter}${accidental}`);
  return a4Hz * 2 ** ((midi - 69) / 12);
}

/** A frequency `cents` above A4, which is how the boundary cases below are built. */
function nearA4(cents: number): number {
  return CONCERT_A4_HZ * 2 ** (cents / 1200);
}

/** Every preset the module offers, so a rule below cannot miss one. */
const ALL_PRESETS = [...TUNING_PRESETS, CHROMATIC_PRESET];

describe("naming a pitch", () => {
  it("puts A4 at 440 Hz and 0 cents", () => {
    const reading = noteForFrequency(440);
    expect(reading).toMatchObject({ name: "A", octave: 4, label: "A4", a4Hz: CONCERT_A4_HZ });
    expect(reading?.frequencyHz).toBe(440);
    expect(reading?.centsOff).toBeCloseTo(0, 9);
    expect(CONCERT_A4_HZ).toBe(440);
    expect(noteFrequencyHz(69)).toBe(440);
    expect(noteLabel(69)).toBe("A4");
  });

  it("moves every name with the reference, inside the baroque window only", () => {
    expect(MIN_A4_HZ).toBe(415);
    expect(MAX_A4_HZ).toBe(466);
    expect(isValidA4(MIN_A4_HZ)).toBe(true);
    expect(isValidA4(MAX_A4_HZ)).toBe(true);
    expect(isValidA4(MIN_A4_HZ - 0.1)).toBe(false);
    expect(isValidA4(MAX_A4_HZ + 0.1)).toBe(false);
    expect(isValidA4(Number.NaN)).toBe(false);
    expect(isValidA4(Number.POSITIVE_INFINITY)).toBe(false);

    // The reference is what A4 IS, so 415 Hz is 0 cents at a4Hz = 415 — and
    // 440 Hz is not A4 at that reference but 440/415 of the way to A#4.
    expect(noteForFrequency(415, 415)?.label).toBe("A4");
    expect(noteForFrequency(415, 415)?.centsOff).toBeCloseTo(0, 9);
    const moved = noteForFrequency(440, 415);
    expect(moved?.label).toBe("A#4");
    expect(moved?.frequencyHz).toBeCloseTo(415 * SEMITONE_RATIO, 9);
    expect(moved?.centsOff).toBeCloseTo(centsBetween(440, moved?.frequencyHz as number) as number, 9);

    expect(noteForFrequency(440, MIN_A4_HZ - 1)).toBeNull();
    expect(noteForFrequency(440, MAX_A4_HZ + 1)).toBeNull();
    expect(noteForFrequency(0)).toBeNull();
    expect(noteForFrequency(-440)).toBeNull();
    expect(noteForFrequency(Number.NaN)).toBeNull();
    expect(noteForFrequency(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("gives the nearest note, octave and cents, including on the ±50 cent fence", () => {
    const justBelow = noteForFrequency(nearA4(49.9));
    expect(justBelow?.label).toBe("A4");
    expect(justBelow?.octave).toBe(4);
    expect(justBelow?.centsOff).toBeCloseTo(49.9, 6);

    const justAbove = noteForFrequency(nearA4(50.1));
    expect(justAbove?.label).toBe("A#4");
    expect(justAbove?.centsOff).toBeCloseTo(-49.9, 6);

    const justFlat = noteForFrequency(nearA4(-49.9));
    expect(justFlat?.label).toBe("A4");
    expect(justFlat?.centsOff).toBeCloseTo(-49.9, 6);

    // Exactly on the fence the rounding takes the upper note, so the reading is
    // 50 cents flat of it — the widest a cents figure ever gets, by construction.
    const fence = noteForFrequency(nearA4(50));
    expect(fence?.label).toBe("A#4");
    expect(fence?.centsOff).toBeCloseTo(-50, 9);

    // The octave changes where the pitch class does.
    expect(noteForFrequency(261.63)?.label).toBe("C4");
    expect(noteForFrequency(246.94)?.label).toBe("B3");
    expect(noteLabel(60)).toBe("C4");
    expect(noteLabel(0)).toBe("C-1");
    expect(noteLabel(127)).toBe("G9");
    for (const reading of [justBelow, justAbove, justFlat, fence]) {
      // ±50 by construction, with the last-bit slack of a logarithm.
      expect(Math.abs(reading?.centsOff as number)).toBeLessThanOrEqual(50 + 1e-9);
    }
  });

  it("refuses a frequency whose nearest note is outside the names it has", () => {
    // C-1 (MIDI 0) is 8.18 Hz at A4 = 440 and G9 (127) is 12.5 kHz; outside them
    // this module has no name to print, so it has no reading either.
    expect(noteForFrequency(noteFrequencyHz(0))?.label).toBe("C-1");
    expect(noteForFrequency(noteFrequencyHz(0) * 0.95)).toBeNull();
    expect(noteForFrequency(noteFrequencyHz(127))?.label).toBe("G9");
    expect(noteForFrequency(20_000)).toBeNull();
  });

  it("writes cents as the logarithm it is, in both directions", () => {
    expect(SEMITONE_RATIO).toBeCloseTo(2 ** (1 / 12), 12);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 9);
    expect(centsBetween(440, 880)).toBeCloseTo(-1200, 9);
    expect(centsBetween(0, 440)).toBeNull();
    expect(centsBetween(440, Number.NaN)).toBeNull();
    expect(shiftCents(440, 1200)).toBeCloseTo(880, 9);
    expect(shiftCents(440, -1200)).toBeCloseTo(220, 9);
    expect(shiftCents(0, 100)).toBeNull();
    // The two are inverses, which is what lets a tuner move a target by cents.
    const moved = shiftCents(440, 37.5) as number;
    expect(centsBetween(moved, 440)).toBeCloseTo(37.5, 9);
  });

  it("spells the pitch classes sharp, and never invents an enharmonic", () => {
    expect([...NOTE_NAMES]).toEqual(PITCH_CLASSES);
  });
});

describe("the presets", () => {
  it("gives every preset's open strings the frequency 12-TET gives them", () => {
    for (const preset of ALL_PRESETS) {
      expect(preset.targets.length, preset.id).toBeGreaterThan(0);
      preset.targets.forEach((target, index) => {
        expect(target.frequencyHz, `${preset.id} ${target.label}`).toBeCloseTo(twelveTet(target.label), 6);
        expect(targetFor(target.label)?.frequencyHz, `${preset.id} ${target.label}`).toBeCloseTo(target.frequencyHz, 9);
        if (preset.id === "chromatic") expect(target.string).toBeUndefined();
        else expect(target.string, `${preset.id} ${target.label}`).toBe(index + 1);
      });
    }
  });

  it("carries the four instruments the tuner is for, by their open strings", () => {
    const labels = (id: string): readonly string[] | undefined =>
      TUNING_PRESETS.find((preset) => preset.id === id)?.targets.map((target) => target.label);
    expect(labels("guitar-standard")).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    expect(labels("bass")).toEqual(["E1", "A1", "D2", "G2"]);
    expect(labels("violin")).toEqual(["G3", "D4", "A4", "E5"]);
    expect(labels("ukulele")).toEqual(["G4", "C4", "E4", "A4"]);
    expect(labels("ukulele-low-g")).toEqual(["G3", "C4", "E4", "A4"]);
  });

  it("says which list is in pitch order, because the ukulele's is not", () => {
    for (const preset of ALL_PRESETS) {
      const ascending = preset.targets.every(
        (target, index) => index === 0 || target.frequencyHz > (preset.targets[index - 1]?.frequencyHz as number),
      );
      expect(ascending, preset.id).toBe(preset.arrangement === "low-to-high");
    }
  });

  it("names the nearest note of the chromatic scale for every entry", () => {
    expect(CHROMATIC_PRESET.arrangement).toBe("low-to-high");
    expect(CHROMATIC_PRESET.targets.length).toBe(49); // C2 … C6
    expect(CHROMATIC_PRESET.targets[0]?.label).toBe("C2");
    expect(CHROMATIC_PRESET.targets[48]?.label).toBe("C6");
    for (const target of CHROMATIC_PRESET.targets) {
      expect(noteForFrequency(target.frequencyHz)?.label, target.label).toBe(target.label);
    }
  });

  it("reads a target from its label, and refuses a label it has no note for", () => {
    expect(targetFor("E2")?.label).toBe("E2");
    expect(targetFor(" e2 ")?.label).toBe("E2");
    expect(targetFor("C-1")?.frequencyHz).toBeCloseTo(noteFrequencyHz(0), 9);
    expect(targetFor("E2", 415)?.frequencyHz).toBeCloseTo(twelveTet("E2", 415), 6);
    expect(targetFor("H2")).toBeNull();
    expect(targetFor("E#2")).toBeNull(); // sharp-spelled or nothing
    expect(targetFor("E")).toBeNull();
    expect(targetFor("E10")).toBeNull();
    expect(targetFor("B9")).toBeNull(); // above G9, which is where the names stop
    expect(targetFor("C9")?.label).toBe("C9");
    expect(targetFor("")).toBeNull();
  });
});
