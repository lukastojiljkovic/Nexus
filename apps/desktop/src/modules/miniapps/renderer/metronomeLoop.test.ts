import { describe, expect, it } from "vitest";
import type { MetronomeSpec } from "@nexus/core";
import {
  LOOKAHEAD_HORIZON_SECONDS,
  clickGain,
  metronomeWindow,
  pulseAt,
  resumeCursor,
} from "./metronomeLoop.js";

/**
 * The metronome's look-ahead loop (mini-apps).
 *
 * The arithmetic the clicks sit on belongs to `@nexus/core`'s `beatSchedule` and
 * is its own suite's subject; what this file pins is the loop around it, which
 * is where a metronome actually goes wrong: a window that leaves a gap or
 * repeats a boundary click, and a cursor that fell behind the clock after a
 * stall and would otherwise schedule a burst of clicks in the past.
 */

/** 120 BPM in 4/4, first beat accented: a beat every 0.5 s, a bar every 2 s. */
const SPEC: MetronomeSpec = {
  startSeconds: 0,
  bpm: 120,
  beatsPerBar: 4,
  noteValue: 4,
  accents: ["strong", "weak", "weak", "weak"],
  subdivisions: 1,
};

describe("metronomeWindow", () => {
  it("asks the engine for the clicks in a window that starts where it was told", () => {
    const window = metronomeWindow(SPEC, 0, 1);

    expect(window.fromSeconds).toBe(0);
    expect(window.toSeconds).toBe(1);
    expect(window.clicks.map((click) => click.timeSeconds)).toEqual([0, 0.5]);
    expect(window.clicks.map((click) => click.beat)).toEqual([1, 2]);
  });

  it("joins two adjacent windows without a gap and without a repeated click", () => {
    const first = metronomeWindow(SPEC, 0, 1);
    const second = metronomeWindow(SPEC, first.toSeconds, 1);

    const times = [...first.clicks, ...second.clicks].map((click) => click.timeSeconds);
    expect(times).toEqual([0, 0.5, 1, 1.5]);
    // Bar and beat numbering carries across the join: 1.0 s is beat 3.
    expect(second.clicks.map((click) => click.beat)).toEqual([3, 4]);
  });

  it("numbers the bar across a window that starts mid-bar", () => {
    const window = metronomeWindow(SPEC, 2.5, 2);

    // The second bar begins at 2 s, so 2.5 s is bar 2's beat 2 - and the window
    // ends at 4.5 s, so it reaches into bar 3, whose first beat is at 4.0 s. The
    // bar rollover inside one window is exactly what a window must get right.
    expect(window.clicks.map((click) => [click.bar, click.beat])).toEqual([
      [2, 2],
      [2, 3],
      [2, 4],
      [3, 1],
    ]);
  });

  it("refuses a cursor or a horizon that is not a real time", () => {
    expect(() => metronomeWindow(SPEC, Number.NaN, 1)).toThrow(RangeError);
    expect(() => metronomeWindow(SPEC, 0, 0)).toThrow(RangeError);
    expect(() => metronomeWindow(SPEC, 0, -1)).toThrow(RangeError);
  });

  it("schedules a quarter of a second ahead by default, which is the loop's own horizon", () => {
    expect(metronomeWindow(SPEC, 10).toSeconds).toBe(10 + LOOKAHEAD_HORIZON_SECONDS);
  });
});

describe("resumeCursor", () => {
  it("stays where it is while the loop is still ahead of the clock", () => {
    expect(resumeCursor(1.25, 1.1)).toBe(1.25);
    expect(resumeCursor(1.25, 1.25)).toBe(1.25);
  });

  it("jumps to the clock when the cursor fell behind it, rather than scheduling the past", () => {
    // A machine that slept for a minute: every instant between the cursor and
    // the clock is gone, and scheduling them would sound them all at once.
    expect(resumeCursor(3.5, 63.5)).toBe(63.5);
  });

  it("refuses a cursor that is not a real time", () => {
    expect(() => resumeCursor(Number.NaN, 1)).toThrow(RangeError);
    expect(() => resumeCursor(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("clickGain", () => {
  it("plays an accent louder than a plain beat, and a subdivision quieter than both", () => {
    const [accent, weak] = metronomeWindow(SPEC, 0, 1).clicks;
    const [, between] = metronomeWindow({ ...SPEC, subdivisions: 2 }, 0, 0.26).clicks;

    expect(clickGain(accent!)).toBe(1);
    expect(clickGain(weak!)).toBe(0.62);
    // 0.25 s is the click between the first two beats: same accent as beat 1,
    // and quieter because it is not on the beat.
    expect(between?.timeSeconds).toBe(0.25);
    expect(between?.subdivision).toBe(1);
    expect(clickGain(between!)).toBeCloseTo(0.45, 10);
  });
});

describe("pulseAt", () => {
  it("answers the click that is sounding, and nothing before the first one", () => {
    const clicks = metronomeWindow(SPEC, 0, 2).clicks;

    expect(pulseAt(clicks, -0.1)).toBeNull();
    expect(pulseAt(clicks, 0)?.beat).toBe(1);
    expect(pulseAt(clicks, 0.49)?.beat).toBe(1);
    expect(pulseAt(clicks, 0.5)?.beat).toBe(2);
    expect(pulseAt(clicks, 1.5)?.bar).toBe(1);
    expect(pulseAt(clicks, 1.5)?.beat).toBe(4);
  });
});
