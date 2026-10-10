import { describe, expect, it } from "vitest";

import {
  MIN_INTERVAL_MS,
  MorseKeyer,
  morseConfidence,
  type LevelReading,
} from "./keyer.js";

/**
 * The keyer, driven by readings whose instants the test states.
 *
 * Nothing here is timing-dependent: a reading carries its own `atMs`, so every
 * expected duration below is an arithmetic difference the test can be read to
 * check — which is the whole reason the envelope travels as (level, instant)
 * pairs rather than as a buffer whose length is the duration.
 */

/**
 * The grid the readings arrive on: 5 ms, which is a twelfth of a dit at the
 * default 20 WPM (60 ms) and a quarter of one at the fastest speed this module
 * offers (60 WPM, 20 ms).
 */
const STEP_MS = 5;

/** A run of readings: `level` held from `fromMs` to `toMs`, inclusive, every `stepMs`. */
function hold(
  readings: LevelReading[],
  levelDb: number,
  fromMs: number,
  toMs: number,
  stepMs = STEP_MS,
): LevelReading[] {
  for (let atMs = fromMs; atMs <= toMs; atMs += stepMs) readings.push({ levelDb, atMs });
  return readings;
}

/** The floor a quiet room reads, and the level a key reads. */
const ROOM_DB = -60;
const KEY_DB = -25;

describe("MorseKeyer", () => {
  it("reads the marks and the gaps out of an envelope, in the sender's own durations", () => {
    const keyer = new MorseKeyer();
    const readings: LevelReading[] = [];
    hold(readings, ROOM_DB, 0, 100);
    hold(readings, KEY_DB, 105, 160); // a 60 ms mark
    hold(readings, ROOM_DB, 165, 285); // a 125 ms gap
    hold(readings, KEY_DB, 290, 470); // an 185 ms mark
    hold(readings, ROOM_DB, 475, 600);
    for (const reading of readings) keyer.push(reading);

    // The silence BEFORE the first mark is not emitted: nothing precedes it to be
    // separated from, and the engine's decoder would skip it anyway.
    expect(keyer.intervals()).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 125 },
      { on: true, ms: 185 },
    ]);
    expect(keyer.keying).toBe(false);
  });

  it("keeps one noisy reading from breaking a dash in two", () => {
    const keyer = new MorseKeyer();
    const readings: LevelReading[] = [];
    hold(readings, ROOM_DB, 0, 100);
    hold(readings, KEY_DB, 105, 280);
    // A single reading 20 dB below the other marks, inside the mark: above the
    // CLOSE margin (6 dB) and so not a transition at all.
    readings.push({ levelDb: KEY_DB - 20, atMs: 200 });
    hold(readings, ROOM_DB, 285, 400);
    for (const reading of readings) keyer.push(reading);

    // The mark is one run, because the key never went up.
    expect(keyer.intervals()).toEqual([{ on: true, ms: 180 }]);
  });

  it("lets the key go only when the level falls back into the room", () => {
    const keyer = new MorseKeyer();
    const readings: LevelReading[] = [];
    hold(readings, ROOM_DB, 0, 50);
    hold(readings, KEY_DB, 55, 200);
    // 8 dB above the floor: below the OPEN margin (12), so the key is still down…
    readings.push({ levelDb: ROOM_DB + 8, atMs: 205 });
    // …and at the floor it is up, at the reading that shows the room.
    hold(readings, ROOM_DB, 210, 300);
    for (const reading of readings) keyer.push(reading);

    expect(keyer.intervals()).toEqual([{ on: true, ms: 155 }]);
  });

  it("merges a blip shorter than the minimum into the interval around it, keeping the rhythm", () => {
    const keyer = new MorseKeyer();
    const readings: LevelReading[] = [];
    hold(readings, ROOM_DB, 0, 50);
    hold(readings, KEY_DB, 55, 100);
    // The gap the blip lands in, in the order the readings were TAKEN (the keyer
    // measures between consecutive readings, so a list out of order is not a
    // longer list — it is a shorter one and a lie).
    hold(readings, ROOM_DB, 105, 145);
    // One reading of a click, 5 ms long — shorter than MIN_INTERVAL_MS.
    readings.push({ levelDb: KEY_DB, atMs: 150 });
    hold(readings, ROOM_DB, 155, 200);
    hold(readings, KEY_DB, 205, 300);
    hold(readings, ROOM_DB, 305, 400);
    for (const reading of readings) keyer.push(reading);

    // Two marks, and the gap between them is ONE interval: the click was
    // absorbed, so no fragment of it can be read as a character boundary.
    expect(keyer.intervals()).toEqual([
      { on: true, ms: 50 },
      { on: false, ms: 100 },
      { on: true, ms: 100 },
    ]);
    expect(STEP_MS).toBeLessThan(MIN_INTERVAL_MS);
  });

  it("forgets a message when it is reset", () => {
    const keyer = new MorseKeyer();
    const readings = hold(hold([], ROOM_DB, 0, 50), KEY_DB, 55, 100);
    // The key goes up again, which is when the mark it made is COMPLETE: the
    // keyer reports intervals at a transition, never a run that is still running.
    hold(readings, ROOM_DB, 105, 150);
    for (const reading of readings) keyer.push(reading);
    expect(keyer.intervals()).toEqual([{ on: true, ms: 50 }]);
    keyer.reset();
    expect(keyer.intervals()).toEqual([]);
    expect(keyer.keying).toBe(false);
  });
});

describe("morseConfidence", () => {
  it("is 1 when every mark is exactly a dit or a dash", () => {
    expect(
      morseConfidence(
        [
          { on: true, ms: 60 },
          { on: false, ms: 60 },
          { on: true, ms: 180 },
          { on: false, ms: 180 },
          { on: true, ms: 60 },
        ],
        60,
      ),
    ).toBe(1);
  });

  it("counts only marks, and only those a fifth from one unit or three", () => {
    // 60 and 180 are the scales; 120 is neither (60 ± 12, 180 ± 36).
    expect(
      morseConfidence(
        [
          { on: true, ms: 60 },
          { on: false, ms: 300 },
          { on: true, ms: 120 },
          { on: false, ms: 60 },
          { on: true, ms: 168 },
        ],
        60,
      ),
    ).toBeCloseTo(2 / 3, 10);
  });

  it("answers null when there is nothing to judge", () => {
    expect(morseConfidence([], 60)).toBeNull();
    expect(morseConfidence([{ on: false, ms: 300 }], 60)).toBeNull();
    expect(morseConfidence([{ on: true, ms: 60 }], 0)).toBeNull();
  });
});
