import { describe, expect, it } from "vitest";
import { MUSCLE_GROUPS, SET_KINDS, countsTowardVolume } from "@nexus/core";
import type { ProgressSet, SetKind } from "@nexus/core";
import { muscleWeek } from "./FitBodyMap.js";

/**
 * „Mapa tela"'s arithmetic, and only the parts of it that could be silently
 * wrong. The drawing itself is checked by eye; these are the two rules that
 * would still shade a plausible-looking body while counting the wrong sets.
 */

function progressSet(over: Partial<ProgressSet> & { day: string }): ProgressSet {
  return {
    exerciseRef: "catalogue:potisak-sa-klupe",
    label: "Potisak sa klupe",
    kind: "working" as SetKind,
    metric: "weight_reps",
    primaryMuscles: ["grudi"],
    weightKg: 60,
    reps: 8,
    seconds: null,
    ...over,
  };
}

describe("muscleWeek", () => {
  it("counts a muscle's sets inside the window and nothing outside it", () => {
    const week = muscleWeek(
      [
        progressSet({ day: "2026-08-01" }), // before
        progressSet({ day: "2026-08-02" }), // the first day, inclusive
        progressSet({ day: "2026-08-05" }),
        progressSet({ day: "2026-08-08" }), // the last day, inclusive
        progressSet({ day: "2026-08-09" }), // after
      ],
      "2026-08-02",
      "2026-08-08",
    );
    expect(week.get("grudi")?.sets).toBe(3);
  });

  it("does not count a warm-up — the ramp is not the work", () => {
    const week = muscleWeek(
      [
        progressSet({ day: "2026-08-05", kind: "warmup" }),
        progressSet({ day: "2026-08-05", kind: "warmup" }),
        progressSet({ day: "2026-08-05" }),
      ],
      "2026-08-01",
      "2026-08-08",
    );
    expect(week.get("grudi")?.sets).toBe(1);
  });

  it("agrees with @nexus/core about which kinds count, at every kind", () => {
    // The same line `weeklyVolume` draws. Two figures on one screen disagreeing
    // about what a set is would be worse than either being wrong alone.
    for (const kind of SET_KINDS) {
      const week = muscleWeek([progressSet({ day: "2026-08-05", kind })], "2026-08-01", "2026-08-08");
      expect(week.get("grudi")?.sets ?? 0).toBe(countsTowardVolume(kind) ? 1 : 0);
    }
  });

  it("bills PRIMARY muscles only — one bench press is not chest and triceps and shoulders", () => {
    const week = muscleWeek(
      [progressSet({ day: "2026-08-05", primaryMuscles: ["grudi"] })],
      "2026-08-01",
      "2026-08-08",
    );
    expect(week.get("grudi")?.sets).toBe(1);
    expect(week.get("triceps")).toBeUndefined();
    expect(week.get("prednja-ramena")).toBeUndefined();
  });

  it("bills every primary muscle a set actually declares", () => {
    const week = muscleWeek(
      [progressSet({ day: "2026-08-05", primaryMuscles: ["kvadriceps", "gluteusi"] })],
      "2026-08-01",
      "2026-08-08",
    );
    expect(week.get("kvadriceps")?.sets).toBe(1);
    expect(week.get("gluteusi")?.sets).toBe(1);
  });

  it("remembers the LATEST day a muscle was worked, whatever order the sets arrive in", () => {
    const week = muscleWeek(
      [
        progressSet({ day: "2026-08-07" }),
        progressSet({ day: "2026-08-03" }),
        progressSet({ day: "2026-08-05" }),
      ],
      "2026-08-01",
      "2026-08-08",
    );
    expect(week.get("grudi")?.lastDay).toBe("2026-08-07");
  });

  it("leaves an untouched muscle absent rather than present with a zero", () => {
    // The map reads „absent" as level 0 and says so in words beside the
    // picture; a zero ENTRY would be indistinguishable from a measured one.
    const week = muscleWeek([progressSet({ day: "2026-08-05" })], "2026-08-01", "2026-08-08");
    for (const muscle of MUSCLE_GROUPS) {
      if (muscle === "grudi") continue;
      expect(week.has(muscle)).toBe(false);
    }
  });

  it("answers an empty map for an empty window", () => {
    expect(muscleWeek([], "2026-08-01", "2026-08-08").size).toBe(0);
  });
});
