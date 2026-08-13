import { describe, expect, it } from "vitest";

import { stairFlight, stairRiserCandidates } from "./gradnja.js";

/**
 * Every expectation here was worked by hand from the inputs before the code
 * existed, and the arithmetic is written into the test names and comments so a
 * reader can check it without running anything. A test whose expected value was
 * copied out of a first run pins the bug as firmly as the behaviour.
 */

describe("stairFlight", () => {
  it("divides the storey height exactly — 2850/17 = 167.647… mm, never a rounded 168", () => {
    const flight = stairFlight({ rise: 2850, risers: 17, going: 280, top: "flush" });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    // 2850/17 = 167.6470588… — and 17 × that is exactly 2850, which a rounded
    // 168 would miss by 6 mm spread onto whichever step got the remainder.
    expect(flight.riser).toBeCloseTo(167.647059, 6);
    expect(flight.riser * 17).toBeCloseTo(2850, 9);
    // Flush with the upper floor: the last riser lands on it and has no tread.
    expect(flight.goings).toBe(16);
    expect(flight.run).toBe(4480); // 16 × 280
    // atan(167.6470588/280) = atan(0.59873949) = 30.9106°
    expect(flight.pitch).toBeCloseTo(30.9106, 4);
    // 2r + g = 335.294118 + 280
    expect(flight.blondel).toBeCloseTo(615.294118, 6);
  });

  it("counts one more going when the flight arrives at a landing in the plane of the last riser", () => {
    const flush = stairFlight({ rise: 3000, risers: 18, going: 300, top: "flush" });
    const landing = stairFlight({ rise: 3000, risers: 18, going: 300, top: "landing" });
    expect(flush.ok && landing.ok).toBe(true);
    if (!flush.ok || !landing.ok) return;
    // The riser is the same — the top condition changes the FOOTPRINT and
    // nothing else, which is the whole reason it is an input.
    expect(flush.riser).toBeCloseTo(166.666667, 6);
    expect(landing.riser).toBeCloseTo(166.666667, 6);
    expect(flush.goings).toBe(17);
    expect(landing.goings).toBe(18);
    expect(flush.run).toBe(5100); // 17 × 300
    expect(landing.run).toBe(5400); // 18 × 300
    // atan(166.6666667/300) = atan(0.55555556) = 29.0546°
    expect(flush.pitch).toBeCloseTo(29.0546, 4);
    expect(flush.blondel).toBeCloseTo(633.333333, 6);
  });

  it("reports the ratio against the user's own limits, and nothing else about them", () => {
    const flight = stairFlight({
      rise: 2850,
      risers: 17,
      going: 280,
      top: "flush",
      riserLimit: 175,
      goingLimit: 280,
    });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    // 167.6470588 / 175 = 0.95798319
    expect(flight.riserRatio).toBeCloseTo(0.957983, 6);
    // Exactly at the limit is exactly 1 — and the result says 1, not „ok".
    expect(flight.goingRatio).toBe(1);
  });

  it("draws no comparison at all when no limit was typed — an absent rule is not a satisfied one", () => {
    const flight = stairFlight({ rise: 2850, risers: 17, going: 280, top: "flush" });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    expect(flight.riserRatio).toBeUndefined();
    expect(flight.goingRatio).toBeUndefined();
  });

  it("treats a non-positive limit as no limit rather than dividing by it", () => {
    const flight = stairFlight({
      rise: 2850,
      risers: 17,
      going: 280,
      top: "flush",
      riserLimit: 0,
      goingLimit: -1,
    });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    expect(flight.riserRatio).toBeUndefined();
    expect(flight.goingRatio).toBeUndefined();
  });

  it("refuses rather than repairs: a non-positive height, a fractional or out-of-range riser count, a zero going", () => {
    expect(stairFlight({ rise: 0, risers: 17, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "rise",
    });
    expect(stairFlight({ rise: -2850, risers: 17, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "rise",
    });
    expect(stairFlight({ rise: 2850, risers: 16.5, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "risers",
    });
    expect(stairFlight({ rise: 2850, risers: 0, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "risers",
    });
    expect(stairFlight({ rise: 2850, risers: 61, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "risers",
    });
    expect(stairFlight({ rise: 2850, risers: 17, going: 0, top: "flush" })).toEqual({
      ok: false,
      reason: "going",
    });
    expect(stairFlight({ rise: Number.NaN, risers: 17, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "rise",
    });
  });

  it("keeps a single-riser flight representable — one step out of a doorway is a stair", () => {
    const flight = stairFlight({ rise: 180, risers: 1, going: 300, top: "flush" });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    expect(flight.riser).toBe(180);
    // Flush: the one riser lands on the floor above, so there is no tread and
    // no run. A `goings` of 0 is the honest answer, not a defect.
    expect(flight.goings).toBe(0);
    expect(flight.run).toBe(0);
  });
});

describe("stairRiserCandidates", () => {
  it("offers the rounded count and both neighbours, so the choice stays the designer's", () => {
    // 2850/170 = 16.7647 → nearest 17, neighbours 16 and 18.
    const result = stairRiserCandidates(2850, 170);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.map((c) => c.risers)).toEqual([16, 17, 18]);
    expect(result.candidates[0]?.riser).toBeCloseTo(178.125, 6); // 2850/16
    expect(result.candidates[1]?.riser).toBeCloseTo(167.647059, 6); // 2850/17
    expect(result.candidates[2]?.riser).toBeCloseTo(158.333333, 6); // 2850/18
  });

  it("drops a neighbour that falls outside the representable range rather than offering an impossible flight", () => {
    // 2850/2900 = 0.98 → nearest 1, so the lower neighbour would be 0.
    const result = stairRiserCandidates(2850, 2900);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.map((c) => c.risers)).toEqual([1, 2]);
  });

  it("refuses a non-positive height or desired riser", () => {
    expect(stairRiserCandidates(0, 170)).toEqual({ ok: false, reason: "rise" });
    expect(stairRiserCandidates(2850, 0)).toEqual({ ok: false, reason: "desiredRiser" });
  });
});
