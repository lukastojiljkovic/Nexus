import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../../renderer/src/strings.js";
import {
  COMMON_TIME_CONTROLS,
  clockWords,
  customTimeControl,
  flaggedSide,
  formatRemaining,
  parseTimeControl,
  passClock,
  startClock,
  stopClock,
  tickClock,
  timeControlWords,
  type ClockState,
} from "./clock.js";

/**
 * The clocks, pinned with hand arithmetic.
 *
 * A clock's numbers are the whole of what it says, so every expected value below
 * is worked out by hand in the test rather than read off the implementation: ten
 * minutes is 600 000 ms, a half-second tick is 500 ms off one side, and the
 * increment lands on the side that moved. The two unit strings are the ones
 * `Intl` produces for this build, which is the source a formatted string has.
 */

afterEach(() => {
  applyLocale("sr");
});

describe("parseTimeControl", () => {
  it("reads a base+increment clock, and the common controls are all readable", () => {
    expect(parseTimeControl("600+5")).toEqual({ baseSeconds: 600, incrementSeconds: 5 });
    expect(parseTimeControl("60+0")).toEqual({ baseSeconds: 60, incrementSeconds: 0 });
    expect(parseTimeControl("7200+300")).toEqual({ baseSeconds: 7200, incrementSeconds: 300 });
    for (const control of COMMON_TIME_CONTROLS) {
      expect(parseTimeControl(control), control).not.toBeNull();
    }
  });

  it("refuses anything that is not a clock the store would hold", () => {
    // The store's own bounds: up to two hours a side, up to five minutes a move.
    expect(parseTimeControl("7201+0")).toBeNull();
    expect(parseTimeControl("600+301")).toBeNull();
    // ...and the shape, which is stricter than „two numbers with a plus".
    expect(parseTimeControl("600")).toBeNull();
    expect(parseTimeControl("0+5")).toBeNull();
    expect(parseTimeControl("600+")).toBeNull();
    expect(parseTimeControl("600 + 5")).toBeNull();
    expect(parseTimeControl("600+5 ")).toBeNull();
    expect(parseTimeControl("")).toBeNull();
  });
});

describe("customTimeControl", () => {
  it("spells the control the two custom fields describe", () => {
    expect(customTimeControl(600, 5)).toBe("600+5");
    expect(customTimeControl(60, 0)).toBe("60+0");
  });

  it("answers null for a pair the store would refuse, so the form can say so", () => {
    expect(customTimeControl(0, 5)).toBeNull();
    expect(customTimeControl(600, 400)).toBeNull();
    expect(customTimeControl(7500, 0)).toBeNull();
  });
});

describe("clockWords", () => {
  it("speaks whole minutes as minutes, through Intl in the active language", () => {
    expect(clockWords(600)).toBe("10 min");
    expect(clockWords(60)).toBe("1 min");
    expect(clockWords(1800)).toBe("30 min");
  });

  it("speaks the odd spans as minutes and seconds, and under a minute as seconds", () => {
    expect(clockWords(90)).toBe("1 min 30 sek");
    expect(clockWords(45)).toBe("45 sek");
    expect(clockWords(125)).toBe("2 min 5 sek");
  });

  it("follows the interface language, because it formats through Intl", () => {
    applyLocale("en");
    // Measured with this runtime's ICU, whose English is `en-GB` and whose short
    // units are therefore pluralised: „10 mins", „30 secs". The point of these
    // three lines is not the spelling but that the SAME call answers differently
    // after a language switch, which a hand-written string could not.
    expect(clockWords(600)).toBe("10 mins");
    expect(clockWords(90)).toBe("1 min 30 secs");
    expect(clockWords(45)).toBe("45 secs");
    expect(clockWords(60)).toBe("1 min");
  });
});

describe("timeControlWords", () => {
  it("reads a control the way a player says it", () => {
    expect(timeControlWords("600+0")).toBe("10 min");
    expect(timeControlWords("600+5")).toBe("10 min + 5 sek");
    expect(timeControlWords("60+0")).toBe("1 min");
  });

  it("shows an unreadable control as it stands rather than hiding the row", () => {
    expect(timeControlWords("nepoznato")).toBe("nepoznato");
  });
});

describe("formatRemaining", () => {
  it("reads as mm:ss, and as h:mm:ss once there is an hour to show", () => {
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(600_000)).toBe("10:00");
    expect(formatRemaining(60_000)).toBe("01:00");
    expect(formatRemaining(3_600_000)).toBe("1:00:00");
    expect(formatRemaining(3_661_000)).toBe("1:01:01");
  });

  it("rounds a part-second UP, so a running clock never shows zero before its end", () => {
    expect(formatRemaining(500)).toBe("00:01");
    expect(formatRemaining(1)).toBe("00:01");
    // ...and never shows a negative clock, whatever it is handed.
    expect(formatRemaining(-5)).toBe("00:00");
  });
});

describe("the two clocks", () => {
  const control = { baseSeconds: 600, incrementSeconds: 5 };

  it("winds both sides to the control's base time and starts stopped", () => {
    expect(startClock(control)).toEqual({ whiteMs: 600_000, blackMs: 600_000, measuredAt: null });
    expect(startClock(control, 1_000).measuredAt).toBe(1_000);
  });

  it("takes a tick off the side to move, and never below zero", () => {
    const running: ClockState = { whiteMs: 600_000, blackMs: 600_000, measuredAt: 1_000 };
    expect(tickClock(running, "w", 1_500)).toEqual({
      whiteMs: 599_500,
      blackMs: 600_000,
      measuredAt: 1_500,
    });
    // A tick past the end flags the side at zero rather than owing time.
    expect(tickClock(running, "b", 700_000)).toEqual({
      whiteMs: 600_000,
      blackMs: 0,
      measuredAt: 700_000,
    });
  });

  it("measures nothing while the clock is stopped or the reading has not moved", () => {
    const stopped: ClockState = { whiteMs: 600_000, blackMs: 600_000, measuredAt: null };
    expect(tickClock(stopped, "w", 5_000)).toBe(stopped);
    const running: ClockState = { whiteMs: 600_000, blackMs: 600_000, measuredAt: 1_000 };
    expect(tickClock(running, "w", 1_000)).toBe(running);
  });

  it("hands the mover its increment and starts measuring for the other side", () => {
    const running: ClockState = { whiteMs: 600_000, blackMs: 595_000, measuredAt: 1_000 };
    // White spent 2 000 ms and gains the 5 s increment; Black's clock now runs.
    expect(passClock(running, "w", control, 3_000)).toEqual({
      whiteMs: 605_000,
      blackMs: 595_000,
      measuredAt: 3_000,
    });
  });

  it("names the side whose clock has run out", () => {
    expect(flaggedSide({ whiteMs: 600_000, blackMs: 600_000, measuredAt: null })).toBeNull();
    expect(flaggedSide({ whiteMs: 0, blackMs: 600_000, measuredAt: null })).toBe("w");
    expect(flaggedSide({ whiteMs: 600_000, blackMs: 0, measuredAt: null })).toBe("b");
  });

  it("stops both clocks where they stand, keeping the readings", () => {
    const running: ClockState = { whiteMs: 12_000, blackMs: 600_000, measuredAt: 9_000 };
    expect(stopClock(running)).toEqual({ whiteMs: 12_000, blackMs: 600_000, measuredAt: null });
    // Stopping what is already stopped is the same object, so a page that
    // re-renders does not ping-pong between two states.
    const stopped = stopClock(running);
    expect(stopClock(stopped)).toBe(stopped);
  });
});
