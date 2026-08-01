import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS_CONFIG,
  FOCUS_OUTCOMES,
  FOCUS_PHASE_KINDS,
  nextPhase,
  phaseProgress,
  validateFocusConfig,
  type FocusConfig,
  type FocusPhaseTiming,
} from "./focusSession.js";

const START = "2026-08-01T09:00:00.000Z";

/** A running phase, defaults spelled out so each test varies exactly one thing. */
function timing(overrides: Partial<FocusPhaseTiming> = {}): FocusPhaseTiming {
  return {
    startedAt: START,
    plannedMinutes: 25,
    pausedAt: null,
    pausedSeconds: 0,
    ...overrides,
  };
}

/** `START` plus a whole number of seconds, as an ISO instant. */
function at(seconds: number): string {
  return new Date(Date.parse(START) + seconds * 1000).toISOString();
}

describe("the closed vocabularies", () => {
  it("has exactly three phase kinds and exactly two outcomes", () => {
    expect(FOCUS_PHASE_KINDS).toEqual(["work", "short_break", "long_break"]);
    expect(FOCUS_OUTCOMES).toEqual(["completed", "stopped"]);
  });
});

describe("DEFAULT_FOCUS_CONFIG", () => {
  it("is the classic 25/5/15 with a long break every fourth work phase", () => {
    expect(DEFAULT_FOCUS_CONFIG).toEqual({
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLongBreak: 4,
    });
  });

  it("is itself valid — the default can never be a config the validator refuses", () => {
    expect(validateFocusConfig(DEFAULT_FOCUS_CONFIG)).toEqual({
      ok: true,
      config: DEFAULT_FOCUS_CONFIG,
    });
  });
});

describe("validateFocusConfig", () => {
  it("accepts a config at every lower bound and at every upper bound", () => {
    const low: FocusConfig = {
      workMinutes: 1,
      shortBreakMinutes: 1,
      longBreakMinutes: 1,
      cyclesBeforeLongBreak: 1,
    };
    const high: FocusConfig = {
      workMinutes: 180,
      shortBreakMinutes: 60,
      longBreakMinutes: 120,
      cyclesBeforeLongBreak: 12,
    };
    expect(validateFocusConfig(low)).toEqual({ ok: true, config: low });
    expect(validateFocusConfig(high)).toEqual({ ok: true, config: high });
  });

  it("names the field that is out of range rather than throwing", () => {
    const cases: Array<[Partial<Record<keyof FocusConfig, number>>, keyof FocusConfig]> = [
      [{ workMinutes: 0 }, "workMinutes"],
      [{ workMinutes: 181 }, "workMinutes"],
      [{ shortBreakMinutes: 0 }, "shortBreakMinutes"],
      [{ shortBreakMinutes: 61 }, "shortBreakMinutes"],
      [{ longBreakMinutes: 0 }, "longBreakMinutes"],
      [{ longBreakMinutes: 121 }, "longBreakMinutes"],
      [{ cyclesBeforeLongBreak: 0 }, "cyclesBeforeLongBreak"],
      [{ cyclesBeforeLongBreak: 13 }, "cyclesBeforeLongBreak"],
    ];
    for (const [patch, field] of cases) {
      expect(validateFocusConfig({ ...DEFAULT_FOCUS_CONFIG, ...patch })).toEqual({
        ok: false,
        field,
      });
    }
  });

  it("refuses a fractional minute — a timer is set in whole minutes", () => {
    expect(validateFocusConfig({ ...DEFAULT_FOCUS_CONFIG, workMinutes: 25.5 })).toEqual({
      ok: false,
      field: "workMinutes",
    });
  });

  it("refuses a non-record, a missing field, and an unknown extra key", () => {
    for (const value of [null, undefined, 42, "25", [], new Date()]) {
      expect(validateFocusConfig(value)).toEqual({ ok: false, field: null });
    }
    const { workMinutes: _dropped, ...missing } = DEFAULT_FOCUS_CONFIG;
    expect(validateFocusConfig(missing)).toEqual({ ok: false, field: null });
    expect(validateFocusConfig({ ...DEFAULT_FOCUS_CONFIG, extra: 1 })).toEqual({
      ok: false,
      field: null,
    });
  });

  it("returns a fresh object rather than the caller's own", () => {
    const input = { ...DEFAULT_FOCUS_CONFIG };
    const result = validateFocusConfig(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).not.toBe(input);
  });
});

describe("nextPhase", () => {
  it("opens with work — nothing finished yet is not a break anybody earned", () => {
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 0)).toBe("work");
  });

  it("puts a short break after every work phase but the Nth", () => {
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 1)).toBe("short_break");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 2)).toBe("short_break");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 3)).toBe("short_break");
  });

  it("puts the long break on the Nth work phase, and on every Nth after it", () => {
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 4)).toBe("long_break");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 8)).toBe("long_break");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 12)).toBe("long_break");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 5)).toBe("short_break");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 9)).toBe("short_break");
  });

  it("follows the config's own cycle length, not the default's", () => {
    const config: FocusConfig = { ...DEFAULT_FOCUS_CONFIG, cyclesBeforeLongBreak: 2 };
    expect(nextPhase(config, 1)).toBe("short_break");
    expect(nextPhase(config, 2)).toBe("long_break");
    expect(nextPhase(config, 3)).toBe("short_break");
    expect(nextPhase(config, 4)).toBe("long_break");
  });

  it("takes a long break every single time when the cycle is one work phase long", () => {
    const config: FocusConfig = { ...DEFAULT_FOCUS_CONFIG, cyclesBeforeLongBreak: 1 };
    expect(nextPhase(config, 1)).toBe("long_break");
    expect(nextPhase(config, 2)).toBe("long_break");
  });

  it("reads a negative or fractional count as no completed phase at all", () => {
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, -3)).toBe("work");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, 2.5)).toBe("work");
    expect(nextPhase(DEFAULT_FOCUS_CONFIG, Number.NaN)).toBe("work");
  });
});

describe("phaseProgress", () => {
  it("counts wall-clock seconds from the start", () => {
    expect(phaseProgress(timing(), at(0))).toEqual({
      elapsedSeconds: 0,
      remainingSeconds: 1500,
      overrunSeconds: 0,
      isPaused: false,
    });
    expect(phaseProgress(timing(), at(600))).toEqual({
      elapsedSeconds: 600,
      remainingSeconds: 900,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("lands exactly on zero at the planned end, with no overrun yet", () => {
    expect(phaseProgress(timing(), at(1500))).toEqual({
      elapsedSeconds: 1500,
      remainingSeconds: 0,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("grows the overrun past the planned end and never lets remaining go negative", () => {
    expect(phaseProgress(timing(), at(1560))).toEqual({
      elapsedSeconds: 1560,
      remainingSeconds: 0,
      overrunSeconds: 60,
      isPaused: false,
    });
    expect(phaseProgress(timing(), at(9000))).toEqual({
      elapsedSeconds: 9000,
      remainingSeconds: 0,
      overrunSeconds: 7500,
      isPaused: false,
    });
  });

  it("subtracts the accumulated paused time from the elapsed clock", () => {
    expect(phaseProgress(timing({ pausedSeconds: 300 }), at(900))).toEqual({
      elapsedSeconds: 600,
      remainingSeconds: 900,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("freezes the clock at the moment of pausing, however long ago that was", () => {
    const paused = timing({ pausedAt: at(600) });
    const frozen = {
      elapsedSeconds: 600,
      remainingSeconds: 900,
      overrunSeconds: 0,
      isPaused: true,
    };
    expect(phaseProgress(paused, at(600))).toEqual(frozen);
    expect(phaseProgress(paused, at(4000))).toEqual(frozen);
  });

  it("excludes earlier pauses as well as the one currently running", () => {
    expect(phaseProgress(timing({ pausedAt: at(900), pausedSeconds: 120 }), at(5000))).toEqual({
      elapsedSeconds: 780,
      remainingSeconds: 720,
      overrunSeconds: 0,
      isPaused: true,
    });
  });

  it("can overrun while paused — pausing after the end does not erase the overrun", () => {
    expect(phaseProgress(timing({ pausedAt: at(1800) }), at(9000))).toEqual({
      elapsedSeconds: 1800,
      remainingSeconds: 0,
      overrunSeconds: 300,
      isPaused: true,
    });
  });

  it("has neither a remainder nor an overrun when there is no plan to measure against", () => {
    expect(phaseProgress(timing({ plannedMinutes: null }), at(9000))).toEqual({
      elapsedSeconds: 9000,
      remainingSeconds: 0,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("never reports negative elapsed time for a now before the start", () => {
    expect(phaseProgress(timing(), at(-600))).toEqual({
      elapsedSeconds: 0,
      remainingSeconds: 1500,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("never reports negative elapsed time for an accumulator larger than the clock", () => {
    expect(phaseProgress(timing({ pausedSeconds: 9000 }), at(600))).toEqual({
      elapsedSeconds: 0,
      remainingSeconds: 1500,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("truncates rather than rounds, so a second is only counted once it has passed", () => {
    const now = new Date(Date.parse(START) + 1900).toISOString();
    expect(phaseProgress(timing(), now).elapsedSeconds).toBe(1);
  });

  it("reads an unparseable instant as zero elapsed rather than as NaN", () => {
    expect(phaseProgress(timing({ startedAt: "not-an-instant" }), at(600))).toEqual({
      elapsedSeconds: 0,
      remainingSeconds: 1500,
      overrunSeconds: 0,
      isPaused: false,
    });
    expect(phaseProgress(timing(), "not-an-instant")).toEqual({
      elapsedSeconds: 0,
      remainingSeconds: 1500,
      overrunSeconds: 0,
      isPaused: false,
    });
  });

  it("reads the clock only through `now` — the same input always gives the same answer", () => {
    const first = phaseProgress(timing(), at(750));
    const second = phaseProgress(timing(), at(750));
    expect(first).toEqual(second);
  });
});
