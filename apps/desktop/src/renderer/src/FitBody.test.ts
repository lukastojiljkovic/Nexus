import { describe, expect, it } from "vitest";
import { MUSCLE_GROUPS, SET_KINDS, countsTowardVolume } from "@nexus/core";
import type { ProgressSet, SetKind } from "@nexus/core";
import { bandOf, muscleWeek } from "./FitBody.js";
import { DRAWN_REGIONS, FIGURE_HEIGHT, FIGURE_WIDTH } from "./FitBodyFigure.js";

/**
 * „Mapa tela"'s arithmetic and its geometry, and only the parts of each that
 * could be silently wrong. What a shade LOOKS like is checked by eye; these are
 * the rules that would still draw a plausible-looking body while counting the
 * wrong sets or shading two groups with one plate.
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

describe("bandOf", () => {
  it("puts every count in the band its own edges say it belongs to", () => {
    // The caption states these edges as „1–4, 5–9, 10 i više". A ramp that
    // disagreed with the sentence explaining it would be worse than no legend.
    expect(bandOf(0)).toBe(0);
    expect(bandOf(1)).toBe(1);
    expect(bandOf(4)).toBe(1);
    expect(bandOf(5)).toBe(2);
    expect(bandOf(9)).toBe(2);
    expect(bandOf(10)).toBe(3);
    expect(bandOf(40)).toBe(3);
  });
});

/**
 * The drawing, read rather than squinted at.
 *
 * `boundsOf` takes every coordinate pair out of a path — including a quadratic
 * curve's CONTROL point, which may lie outside the curve itself. That makes
 * every box a conservative over-estimate, which is exactly what an overlap test
 * wants: a pair that passes here cannot overlap on screen, and the reverse
 * failure (a false alarm) costs a nudge rather than a wrong drawing.
 */
function boundsOf(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Every box a region actually paints — its own, plus its reflection about the midline when it is paired. */
function boxesOf(region: (typeof DRAWN_REGIONS)[number]) {
  const own = boundsOf(region.d);
  if (!region.mirrored) return [own];
  return [
    own,
    { ...own, minX: FIGURE_WIDTH - own.maxX, maxX: FIGURE_WIDTH - own.minX },
  ];
}

describe("the drawn figure", () => {
  it("draws every muscle group the vocabulary declares, exactly once", () => {
    const drawn = DRAWN_REGIONS.map((region) => region.muscle);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect([...drawn].sort()).toEqual([...MUSCLE_GROUPS].sort());
  });

  it("keeps every plate inside the figure's own space", () => {
    for (const region of DRAWN_REGIONS) {
      for (const box of boxesOf(region)) {
        expect(box.minX, region.muscle).toBeGreaterThanOrEqual(0);
        expect(box.maxX, region.muscle).toBeLessThanOrEqual(FIGURE_WIDTH);
        expect(box.minY, region.muscle).toBeGreaterThanOrEqual(0);
        expect(box.maxY, region.muscle).toBeLessThanOrEqual(FIGURE_HEIGHT);
      }
    }
  });

  it("never lets two plates on the same view share area", () => {
    // A plate that crept under its neighbour would shade two groups with one
    // count — and it is the one defect in this file that a screenshot cannot
    // show, because the one on top simply hides the one underneath.
    const overlaps: string[] = [];
    for (const side of ["front", "back"] as const) {
      const regions = DRAWN_REGIONS.filter((region) => region.side === side);
      for (let i = 0; i < regions.length; i += 1) {
        for (let j = i + 1; j < regions.length; j += 1) {
          const a = regions[i];
          const b = regions[j];
          if (a === undefined || b === undefined) continue;
          for (const boxA of boxesOf(a)) {
            for (const boxB of boxesOf(b)) {
              const width = Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX);
              const height = Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY);
              if (width > 0 && height > 0) overlaps.push(`${a.muscle} × ${b.muscle}`);
            }
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("gives a paired plate a shape that does not cross the midline", () => {
    // A mirrored shape that reached past x = 60 would be reflected on top of
    // itself, drawing the same muscle twice with a seam down the middle.
    for (const region of DRAWN_REGIONS) {
      if (!region.mirrored) continue;
      expect(boundsOf(region.d).maxX, region.muscle).toBeLessThanOrEqual(FIGURE_WIDTH / 2);
    }
  });
});
