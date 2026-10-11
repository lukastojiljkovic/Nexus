import { describe, expect, it } from "vitest";
import { MOON_PHASE_NAMES, moonPhase, moonPhaseName, nextMoonPhases, type MoonPhaseName } from "./phases.js";
import { USNO_MOON_PHASES_2026 } from "./fixtures/usnoMoonPhases.js";
import { USNO_PHASE_NAMES, utcInstant } from "./fixtures/usnoParse.js";

interface UsnoPhase {
  readonly phase: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly time: string;
}

const PUBLISHED: readonly UsnoPhase[] = (
  JSON.parse(USNO_MOON_PHASES_2026) as { phasedata: readonly UsnoPhase[] }
).phasedata;

function publishedInstant(entry: UsnoPhase): Date {
  const month = String(entry.month).padStart(2, "0");
  const day = String(entry.day).padStart(2, "0");
  return utcInstant(`${entry.year}-${month}-${day}`, entry.time)!;
}

function myNameOf(entry: UsnoPhase): MoonPhaseName {
  return USNO_PHASE_NAMES[entry.phase as keyof typeof USNO_PHASE_NAMES];
}

/** `nextMoonPhases` keys the four phases by name; the fixtures key them by USNO's own. */
const NEXT_KEY: Record<MoonPhaseName, "newMoon" | "firstQuarter" | "fullMoon" | "lastQuarter"> = {
  new: "newMoon",
  "waxing-crescent": "newMoon",
  "first-quarter": "firstQuarter",
  "waxing-gibbous": "firstQuarter",
  full: "fullMoon",
  "waning-gibbous": "fullMoon",
  "last-quarter": "lastQuarter",
  "waning-crescent": "lastQuarter",
};

describe("the closed set of phase names", () => {
  it("is the eight the brief names, in order round the cycle", () => {
    expect(MOON_PHASE_NAMES).toEqual([
      "new",
      "waxing-crescent",
      "first-quarter",
      "waxing-gibbous",
      "full",
      "waning-gibbous",
      "last-quarter",
      "waning-crescent",
    ]);
  });

  it("changes name exactly at the 45-degree octant boundaries", () => {
    // Stated boundaries: [337.5, 22.5) new, [22.5, 67.5) waxing crescent, and
    // so on round the cycle.
    expect(moonPhaseName(0)).toBe("new");
    expect(moonPhaseName(22.4)).toBe("new");
    expect(moonPhaseName(22.5)).toBe("waxing-crescent");
    expect(moonPhaseName(67.5)).toBe("first-quarter");
    expect(moonPhaseName(112.5)).toBe("waxing-gibbous");
    expect(moonPhaseName(157.5)).toBe("full");
    expect(moonPhaseName(180)).toBe("full");
    expect(moonPhaseName(202.5)).toBe("waning-gibbous");
    expect(moonPhaseName(247.5)).toBe("last-quarter");
    expect(moonPhaseName(292.5)).toBe("waning-crescent");
    expect(moonPhaseName(337.5)).toBe("new");
    expect(moonPhaseName(359.9)).toBe("new");
  });
});

describe("nextMoonPhases against USNO's fifty phases of 2026", () => {
  it("names each published instant the way USNO names it", () => {
    expect(PUBLISHED.length).toBe(50);
    for (const entry of PUBLISHED) {
      const instant = publishedInstant(entry);
      expect(moonPhase(instant).phase, `${entry.year}-${entry.month}-${entry.day}`).toBe(myNameOf(entry));
    }
  });

  it("puts every published instant within five minutes, from two days before it", () => {
    let worst = 0;
    let checked = 0;
    for (const entry of PUBLISHED) {
      const instant = publishedInstant(entry);
      const next = nextMoonPhases(new Date(instant.getTime() - 2 * 86_400_000));
      const mine = next[NEXT_KEY[myNameOf(entry)]];
      const apart = Math.abs(mine.getTime() - instant.getTime()) / 1000;
      worst = Math.max(worst, apart);
      checked += 1;
      expect(apart, `${entry.year}-${entry.month}-${entry.day} ${entry.phase}`).toBeLessThanOrEqual(300);
    }
    expect(checked).toBe(50);
    // Measured 2026-10-09: 110 s, the largest of the fifty — a fifth of the
    // brief's five minutes, and the residue of a ΔT expression that is itself
    // an extrapolation several seconds wide (see julian.ts).
    expect(worst).toBeLessThanOrEqual(300);
  });

  it("returns the next four events of the cycle, however they are rotated", () => {
    const instant = Date.parse("2026-06-21T10:40:00Z");
    const next = nextMoonPhases(instant);
    const sorted = (Object.entries(next) as ["newMoon" | "firstQuarter" | "fullMoon" | "lastQuarter", Date][]).sort(
      (left, right) => left[1].getTime() - right[1].getTime(),
    );
    const order: MoonPhaseName[] = ["new", "first-quarter", "full", "last-quarter"];
    const cycleName: Record<string, MoonPhaseName> = {
      newMoon: "new",
      firstQuarter: "first-quarter",
      fullMoon: "full",
      lastQuarter: "last-quarter",
    };
    const names = sorted.map(([key]) => cycleName[key]!);
    const rotation = order.indexOf(names[0]!);
    expect(names).toEqual(
      [0, 1, 2, 3].map((step) => order[(rotation + step) % 4]),
    );
    for (const [, date] of sorted) {
      const ahead = (date.getTime() - instant) / 86_400_000;
      expect(ahead).toBeGreaterThan(0);
      expect(ahead).toBeLessThan(30);
    }
  });
});

describe("moonPhase's age", () => {
  it("is the days since the previous new moon, through each lunation of 2026", () => {
    // Measured at three points INSIDE each lunation rather than at its ends: a
    // published new moon is rounded to the minute, so the engine's own new moon
    // and USNO's can fall either side of that minute, and the age at the minute
    // itself is legitimately 0.0006 days or 29.53. Inside the month there is no
    // such ambiguity — and a quarter, a half and three quarters of the way are
    // answers the two published ends fix exactly.
    const newMoons = PUBLISHED.filter((entry) => entry.phase === "New Moon").map(publishedInstant);
    expect(newMoons.length).toBe(12);
    for (const [index, instant] of newMoons.entries()) {
      const next = newMoons[index + 1];
      if (next === undefined) continue;
      const gapDays = (next.getTime() - instant.getTime()) / 86_400_000;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const at = new Date(instant.getTime() + gapDays * 86_400_000 * fraction);
        expect(moonPhase(at).ageDays, `${at.toISOString()}`).toBeCloseTo(gapDays * fraction, 2);
      }
    }
  });

  it("runs waxing through a lunation: the elongation grows from new to full", () => {
    // 2026's new moons: 18 January and 17 February (USNO).
    const waxing = moonPhase(Date.parse("2026-01-25T00:00:00Z"));
    const full = moonPhase(Date.parse("2026-02-01T00:00:00Z"));
    expect(waxing.elongation).toBeGreaterThan(0);
    expect(waxing.elongation).toBeLessThan(180);
    expect(full.elongation).toBeGreaterThan(157.5);
    expect(full.elongation).toBeLessThan(180);
    expect(full.illuminatedFraction).toBeGreaterThan(waxing.illuminatedFraction);
  });
});
