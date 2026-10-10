import { describe, expect, it } from "vitest";

import { morseSchedule, scheduleDurationMs } from "../signals/morse.js";
import { lampOnAt } from "./lamps.js";

/**
 * The lamp's schedule is the signals engine's own `morseSchedule`, so the
 * expectations below are exact instants rather than approximate ones: at 20 WPM
 * a dit is `1200 / 20 = 60 ms`, a dash is 180 ms, the gap inside a character is
 * 60 ms, between characters 180 ms and between words 420 ms (ITU-R M.1677-1's
 * 1 : 3 : 7 scale, which `signals/morse.ts` derives from the PARIS standard).
 */
describe("lampOnAt", () => {
  const schedule = morseSchedule("E", { charWpm: 20 });
  // `E` is one dit: a single 60 ms mark and nothing after it.
  expect(schedule).toEqual([{ on: true, ms: 60 }]);

  it("is lit inside a mark and dark after it", () => {
    expect(lampOnAt(schedule, 0)).toBe(true);
    expect(lampOnAt(schedule, 59)).toBe(true);
    // The boundary belongs to the interval that starts there: at exactly 60 ms
    // the mark is over.
    expect(lampOnAt(schedule, 60)).toBe(false);
    expect(lampOnAt(schedule, 1_000)).toBe(false);
  });

  it("is dark before the schedule starts and for a nonsense instant", () => {
    expect(lampOnAt(schedule, -1)).toBe(false);
    expect(lampOnAt(schedule, Number.NaN)).toBe(false);
    expect(lampOnAt([], 0)).toBe(false);
  });

  it("follows the marks and gaps of a whole character", () => {
    // `A` is `.-`: 60 ms on, 60 off, 180 on.
    const a = morseSchedule("A", { charWpm: 20 });
    expect(a.map((interval) => [interval.on, interval.ms])).toEqual([
      [true, 60],
      [false, 60],
      [true, 180],
    ]);
    expect(lampOnAt(a, 0)).toBe(true); // the dot
    expect(lampOnAt(a, 60)).toBe(false); // the gap inside the character
    expect(lampOnAt(a, 120)).toBe(true); // the dash
    expect(lampOnAt(a, 299)).toBe(true);
    expect(lampOnAt(a, 300)).toBe(false);
  });

  it("is dark at the exact end of the whole schedule, however long it is", () => {
    for (const text of ["SOS", "Nexus", "PARIS"]) {
      const intervals = morseSchedule(text, { charWpm: 20 });
      const total = scheduleDurationMs(intervals);
      expect(lampOnAt(intervals, total)).toBe(false);
      // …and lit at some point before it, so "off at the end" is not the answer
      // to everything.
      expect(lampOnAt(intervals, 0)).toBe(true);
    }
  });
});
