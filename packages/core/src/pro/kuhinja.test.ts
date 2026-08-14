import { describe, expect, it } from "vitest";

import {
  bakersPercentage,
  backwardsTimeline,
  brineSalt,
  coffeeExtraction,
  doughWaterTemperature,
  frustumVolume,
  iceCreamOverrun,
  laminationLayers,
  levainHydration,
  levainSplit,
  nutritionPerPortion,
  panArea,
  panConversion,
  parseQuantity,
  parseRatio,
  plateCost,
  portionsFromPack,
  ratioSplit,
  recipeScale,
  solutionConcentration,
  usCustomaryUnit,
  yieldTrimCook,
} from "./kuhinja.js";

/**
 * Every expectation here was worked by hand from the assignment's own numbers
 * before this file was written, exactly as `gradnja.test.ts` does — the
 * arithmetic lives in a comment above each assertion so it can be checked
 * without running anything. A `life-safety`/`food-safety` tool additionally
 * gets a pair of tests proving the limit is never assumed: with the user's
 * own limit and without it, asserting the ratio is `undefined` in the second.
 */

/** No verdict field lives on a `life-safety`/`food-safety` result — this is the check, not a slogan. */
function assertNoVerdictFields(result: object): void {
  const forbidden = /^(passes|compliant|safe|withinLimit|status|verdict|ok|severity)$/i;
  for (const key of Object.keys(result)) {
    if (key === "ok") continue; // the ProResult envelope itself, not a verdict about the computation
    expect(forbidden.test(key)).toBe(false);
  }
}

describe("backwardsTimeline", () => {
  it("walks a service backwards through four steps with no buffer — 19:00 minus 14:45 = 04:15", () => {
    // 720 + 45 + 100 + 20 = 885 min = 14:45
    const result = backwardsTimeline({
      serviceTime: "19:00",
      steps: [
        { name: "mariniranje", duration: "12:00" },
        { name: "temperiranje", duration: "0:45" },
        { name: "pečenje", duration: "1:40" },
        { name: "odmaranje", duration: "0:20" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(4);
    // Backwards: odmaranje 18:40-19:00; pečenje 17:00-18:40; temperiranje
    // 16:15-17:00; mariniranje 04:15-16:15.
    expect(result.rows[0]?.start.clock).toBe("04:15");
    expect(result.rows[0]?.end.clock).toBe("16:15");
    expect(result.rows[0]?.minutes).toBe(720);
    expect(result.rows[1]?.start.clock).toBe("16:15");
    expect(result.rows[1]?.end.clock).toBe("17:00");
    expect(result.rows[2]?.start.clock).toBe("17:00");
    expect(result.rows[2]?.end.clock).toBe("18:40");
    expect(result.rows[3]?.start.clock).toBe("18:40");
    expect(result.rows[3]?.end.clock).toBe("19:00");
    expect(result.start.clock).toBe("04:15");
    expect(result.start.dayOffset).toBe(0);
    expect(result.totalMinutes).toBe(885);
    expect(result.totalLabel).toBe("14:45");
  });

  it("crosses midnight backwards by FLOORED division — service 01:00 minus 4:25 lands at 20:35 the day before", () => {
    // 40 + 25 + 200 = 265 min = 4:25; offset = 60 - 265 = -205.
    // Floored: -205 mod 1440 = 1235 min = 20:35; floor(-205/1440) = -1.
    const result = backwardsTimeline({
      serviceTime: "01:00",
      steps: [
        { name: "a", duration: "0:40" },
        { name: "b", duration: "0:25" },
        { name: "c", duration: "3:20" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.start.clock).toBe("20:35");
    expect(result.start.dayOffset).toBe(-1);
    expect(result.totalMinutes).toBe(265);
  });

  it("gives the buffer its own row, ending exactly at service, and the last step ends short of it", () => {
    // Step 30 min, buffer 15 min: the step runs 11:15-11:45 and the 15
    // minutes to 12:00 are the buffer's own row, not an unexplained gap.
    const result = backwardsTimeline({
      serviceTime: "12:00",
      steps: [{ name: "step", duration: "30" }],
      buffer: 15,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.kind).toBe("step");
    expect(result.rows[0]?.start.clock).toBe("11:15");
    expect(result.rows[0]?.end.clock).toBe("11:45");
    expect(result.rows[1]?.kind).toBe("buffer");
    expect(result.rows[1]?.start.clock).toBe("11:45");
    expect(result.rows[1]?.end.clock).toBe("12:00");
    expect(result.rows[1]?.minutes).toBe(15);
    expect(result.totalMinutes).toBe(45);
    expect(result.totalLabel).toBe("0:45");
  });

  it("applies the floored day marker to the END of a row too, not only its start — a step spanning midnight prints both", () => {
    // Service 02:00, one 4:00 step, no buffer: end = offset 0 = 02:00 (day 0);
    // start = offset -240 = 120-240 = -120 -> floor(-120/1440) = -1,
    // minute-of-day = 1440-120 = 1320 = 22:00. „22:00 (-1 dan) – 02:00".
    const result = backwardsTimeline({
      serviceTime: "02:00",
      steps: [{ name: "step", duration: "4:00" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.rows[0];
    expect(row?.start.clock).toBe("22:00");
    expect(row?.start.dayOffset).toBe(-1);
    expect(row?.end.clock).toBe("02:00");
    expect(row?.end.dayOffset).toBe(0);
  });

  it("reads the H:MM/bare-minutes notation rule and echoes back what it recognised", () => {
    // Colon present -> H:MM (720 min); colon absent -> bare minutes (12 min).
    const result = backwardsTimeline({
      serviceTime: "20:00",
      steps: [
        { name: "long", duration: "12:00" },
        { name: "short", duration: "12" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.minutes).toBe(720);
    expect(result.rows[1]?.minutes).toBe(12);
  });

  it("still computes past a week of lead time — the day marker just keeps growing", () => {
    // Service 00:00, one step of 10090 min (bare number, so minutes):
    // offset = -10090; floor(-10090/1440) = -8; -10090 - (-8*1440) = 1430 = 23:50.
    const result = backwardsTimeline({
      serviceTime: "00:00",
      steps: [{ name: "long", duration: "10090" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.start.dayOffset).toBe(-8);
    expect(result.start.clock).toBe("23:50");
  });

  it("carries a service date through so the marker becomes a real date, not just a day count", () => {
    const result = backwardsTimeline({
      serviceTime: "00:30",
      serviceDate: "2026-08-13",
      steps: [{ name: "step", duration: "10" }],
      buffer: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Buffer row: 23:30 the previous day through 00:30.
    expect(result.rows[1]?.kind).toBe("buffer");
    expect(result.rows[1]?.start.clock).toBe("23:30");
    expect(result.rows[1]?.start.dayOffset).toBe(-1);
    expect(result.rows[1]?.start.date).toBe("2026-08-12");
    expect(result.rows[1]?.end.date).toBe("2026-08-13");
  });

  it("refuses a malformed clock, a bad date, an empty step list, a negative buffer and an unreadable duration", () => {
    expect(backwardsTimeline({ serviceTime: "25:00", steps: [{ name: "a", duration: "10" }] })).toEqual(
      { ok: false, reason: "serviceTime" },
    );
    expect(
      backwardsTimeline({
        serviceTime: "10:00",
        serviceDate: "2026-13-40",
        steps: [{ name: "a", duration: "10" }],
      }),
    ).toEqual({ ok: false, reason: "serviceDate" });
    expect(backwardsTimeline({ serviceTime: "10:00", steps: [] })).toEqual({
      ok: false,
      reason: "steps",
    });
    expect(
      backwardsTimeline({ serviceTime: "10:00", steps: [{ name: "a", duration: "10" }], buffer: -5 }),
    ).toEqual({ ok: false, reason: "buffer" });
    expect(
      backwardsTimeline({ serviceTime: "10:00", steps: [{ name: "a", duration: "abc" }] }),
    ).toEqual({ ok: false, reason: "stepDuration:0" });
  });
});

describe("bakersPercentage", () => {
  it("weights -> percentages: 1000 g flour, 720 g water, 20 g salt", () => {
    // hydration = 720/1000*100 = 72.0%; dough = 1000+720+20 = 1740 g;
    // total% = 1740/1000*100 = 174.0%.
    const result = bakersPercentage({
      mode: "weightsToPercent",
      lines: [
        { name: "brašno", role: "flour", value: 1000 },
        { name: "voda", role: "water", value: 720 },
        { name: "so", role: "other", value: 20 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hydration).toBeCloseTo(72.0, 6);
    expect(result.doughMass).toBeCloseTo(1740, 6);
    expect(result.totalPercent).toBeCloseTo(174.0, 6);
    expect(result.rows[1]?.percent).toBeCloseTo(72.0, 6);
    expect(result.rows[1]?.weightRounded).toBeCloseTo(720, 2);
  });

  it("percentages -> weights: 100/65/2/1 formula (168%) to a 1680 g dough — F = 1000.00 g", () => {
    const result = bakersPercentage({
      mode: "percentToWeights",
      lines: [
        { name: "brašno", role: "flour", value: 100 },
        { name: "voda", role: "water", value: 65 },
        { name: "so", role: "other", value: 2 },
        { name: "kvasac", role: "other", value: 1 },
      ],
      doughMass: 1680,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flourWeight).toBeCloseTo(1000, 6);
    expect(result.rows[1]?.weight).toBeCloseTo(650, 6);
    expect(result.rows[2]?.weight).toBeCloseTo(20, 6);
    expect(result.rows[3]?.weight).toBeCloseTo(10, 6);
    expect(result.hydration).toBeCloseTo(65.0, 6);
    expect(result.doughMass).toBe(1680);
  });

  it("pieces mode: 12 pieces of 350 g baked at 12% bake loss -> raw piece 397.727273 g", () => {
    // raw = 350/0.88 = 397.727272727...; dough = 12*raw = 4772.727272727...
    // flourWeight = dough/1.68 = 2840.909090909...
    const result = bakersPercentage({
      mode: "percentToWeights",
      lines: [
        { name: "brašno", role: "flour", value: 100 },
        { name: "voda", role: "water", value: 65 },
        { name: "so", role: "other", value: 2 },
        { name: "kvasac", role: "other", value: 1 },
      ],
      pieces: 12,
      bakedPieceMass: 350,
      bakeLoss: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawPieceMass).toBeCloseTo(397.727273, 5);
    expect(result.doughMass).toBeCloseTo(4772.727273, 4);
    expect(result.flourWeight).toBeCloseTo(2840.909091, 4);
    expect(result.rows[1]?.weight).toBeCloseTo(1846.590909, 3);
  });

  it("a flour-role line at 0% in mode 2 contributes nothing and does not break the 100% check", () => {
    const result = bakersPercentage({
      mode: "percentToWeights",
      lines: [
        { name: "brašno A", role: "flour", value: 100 },
        { name: "brašno B (celozrno)", role: "flour", value: 0 },
        { name: "voda", role: "water", value: 65 },
      ],
      doughMass: 1650,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1]?.weight).toBe(0);
  });

  it("refuses an empty list, a negative value, no flour line, and a mode-2 flour sum that misses 100", () => {
    expect(bakersPercentage({ mode: "weightsToPercent", lines: [] })).toEqual({
      ok: false,
      reason: "lines",
    });
    expect(
      bakersPercentage({
        mode: "weightsToPercent",
        lines: [{ name: "a", role: "flour", value: -1 }],
      }),
    ).toEqual({ ok: false, reason: "lineValue" });
    expect(
      bakersPercentage({
        mode: "weightsToPercent",
        lines: [{ name: "voda", role: "water", value: 500 }],
      }),
    ).toEqual({ ok: false, reason: "flour" });
    // Two flour lines typed as 70% and 40% is a mistyped formula, not "140% flour".
    expect(
      bakersPercentage({
        mode: "percentToWeights",
        lines: [
          { name: "brašno A", role: "flour", value: 70 },
          { name: "brašno B", role: "flour", value: 40 },
          { name: "voda", role: "water", value: 65 },
        ],
        doughMass: 1000,
      }),
    ).toEqual({ ok: false, reason: "flourPercentSum" });
  });

  it("refuses a line marked `preferment` rather than silently mis-splitting it into flour or water", () => {
    const result = bakersPercentage({
      mode: "weightsToPercent",
      lines: [
        { name: "brašno", role: "flour", value: 800 },
        { name: "voda", role: "water", value: 500 },
        { name: "kvasni starter", role: "preferment", value: 200 },
      ],
    });
    expect(result).toEqual({ ok: false, reason: "preferment" });
  });

  it("refuses a broken pieces mode: bad piece count, missing baked mass, and a bake loss at or past 100%", () => {
    const base = {
      mode: "percentToWeights" as const,
      lines: [
        { name: "brašno", role: "flour" as const, value: 100 },
        { name: "voda", role: "water" as const, value: 65 },
      ],
    };
    expect(bakersPercentage({ ...base, pieces: 0, bakedPieceMass: 350, bakeLoss: 12 })).toEqual({
      ok: false,
      reason: "pieces",
    });
    expect(bakersPercentage({ ...base, pieces: 12, bakeLoss: 12 })).toEqual({
      ok: false,
      reason: "bakedPieceMass",
    });
    expect(
      bakersPercentage({ ...base, pieces: 12, bakedPieceMass: 350, bakeLoss: 100 }),
    ).toEqual({ ok: false, reason: "bakeLoss" });
    expect(bakersPercentage({ ...base, doughMass: 0 })).toEqual({ ok: false, reason: "doughMass" });
  });
});

describe("brineSalt (food-safety)", () => {
  it("brine, food+water basis: 3000 g meat + 2000 g water at 2.5% -> 125.00 g salt", () => {
    // S = (3000+2000) * 0.025 = 125.00; on the total-incl-salt basis that
    // same brine reads 125/5125 = 2.439%.
    const result = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      basis: "foodAndWater",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saltMass).toBeCloseTo(125.0, 6);
    expect(result.percentOfTotal).toBeCloseTo(2.439024, 4);
  });

  it("brine, total-incl-salt basis: the SAME 2.5% now reads S = 5000*2.5/97.5 = 128.2051 g", () => {
    const result = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      basis: "totalWithSalt",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saltMass).toBeCloseTo(128.205128, 4);
    // Check: 128.2051/(5000+128.2051) = 0.025000 = 2.500%.
    expect(result.percentOfTotal).toBeCloseTo(2.5, 4);
  });

  it("total-incl-salt basis with BOTH salt and sugar: T = 5208.33, S = 130.21, G = 78.13 (not the naive 128.21/76.14)", () => {
    // combined = 4.0%; T = 5000/0.96 = 5208.333333; S = T*0.025 = 130.208333;
    // G = T*0.015 = 78.125. Applying the single-substance formula to each
    // separately (the review's rejected version) would give 128.21 and 76.14.
    const result = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      sugarPercent: 1.5,
      basis: "totalWithSalt",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saltMass).toBeCloseTo(130.208333, 4);
    expect(result.sugarMass).toBeCloseTo(78.125, 4);
  });

  it("percentOfTotal is over the FULL total including sugar, and reproduces the typed 2.5% exactly — not 130.21/5130.21 = 2.538%", () => {
    // totalMass = 5000 + 130.208333 + 78.125 = 5208.333333, which IS the T the
    // tool solved for above, so saltMass/totalMass must reproduce the typed
    // 2.5% exactly: 130.208333/5208.333333*100 = 2.500000%. Dividing by
    // food+water+salt alone (5130.208333, leaving sugar out) would instead
    // print 130.208333/5130.208333*100 = 2.538071% — a number the tool never
    // asked for and that disagrees with its own saltMass.
    const result = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      sugarPercent: 1.5,
      basis: "totalWithSalt",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalMass).toBeCloseTo(5208.333333, 4);
    expect(result.percentOfTotal).toBeCloseTo(2.5, 6);
    expect(result.percentOfTotal).not.toBeCloseTo(2.538071, 4);
    // The ratio this food-safety tool is allowed to compare against the
    // user's own limit is built from percentOfTotal on this basis, so a
    // 2.6% limit must read as (barely) under 1, not over it.
    const withLimit = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      sugarPercent: 1.5,
      basis: "totalWithSalt",
      percentLimit: 2.6,
    });
    expect(withLimit.ok).toBe(true);
    if (!withLimit.ok) return;
    expect(withLimit.percentRatio).toBeCloseTo(2.5 / 2.6, 6);
  });

  it("concentration mode: 4000 g water with 240 g salt already dissolved", () => {
    // p_water = 240/4000 = 6.000%; p_total = 240/4240 = 5.6603% -> 5.660%.
    const result = brineSalt({
      mode: "concentration",
      waterMass: 4000,
      dissolvedSalt: 240,
      basis: "foodAndWater",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.percentOfBase).toBeCloseTo(6.0, 4);
    expect(result.percentOfTotal).toBeCloseTo(5.660377, 4);
  });

  it("dry cure: 1200 g pork belly at 2.0% salt and 1.0% sugar, computed on the meat alone", () => {
    // On the food-and-water basis, percentOfTotal is over EVERYTHING that ends
    // up on the scale — food + salt + sugar (there is no separate water here):
    // totalMass = 1200+24+12 = 1236; 24/1236*100 = 1.941748%. Leaving sugar
    // out of the denominator (24/1224) would instead print 1.960784%, which
    // disagrees with the 1236 g the tool's own totalMass says is on the scale.
    const result = brineSalt({
      mode: "dryCure",
      foodMass: 1200,
      saltPercent: 2.0,
      sugarPercent: 1.0,
      basis: "foodAndWater",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saltMass).toBeCloseTo(24.0, 6);
    expect(result.sugarMass).toBeCloseTo(12.0, 6);
    expect(result.totalMass).toBeCloseTo(1236.0, 6);
    expect(result.percentOfTotal).toBeCloseTo(1.941748, 4);
    expect(result.percentOfTotal).not.toBeCloseTo(1.960784, 4);
  });

  it("carries the user's own limit as a ratio, and only when one was actually typed", () => {
    // percentOfBase = 125/5000*100 = 2.5%; ratio against a 3% limit = 0.83333.
    const withLimit = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      basis: "foodAndWater",
      percentLimit: 3,
    });
    expect(withLimit.ok).toBe(true);
    if (!withLimit.ok) return;
    expect(withLimit.percentRatio).toBeCloseTo(0.833333, 5);

    const withoutLimit = brineSalt({
      mode: "brine",
      foodMass: 3000,
      waterMass: 2000,
      saltPercent: 2.5,
      basis: "foodAndWater",
    });
    expect(withoutLimit.ok).toBe(true);
    if (!withoutLimit.ok) return;
    expect(withoutLimit.percentRatio).toBeUndefined();
    assertNoVerdictFields(withoutLimit);
  });

  it("refuses a brine with no water, a dry cure percent out of range, a concentration with no water, and 100%+ combined percentages", () => {
    expect(
      brineSalt({ mode: "brine", foodMass: 1000, saltPercent: 2, basis: "foodAndWater" }),
    ).toEqual({ ok: false, reason: "waterMass" });
    expect(
      brineSalt({ mode: "dryCure", foodMass: 1000, saltPercent: 100, basis: "foodAndWater" }),
    ).toEqual({ ok: false, reason: "saltPercent" });
    expect(brineSalt({ mode: "concentration", dissolvedSalt: 10, basis: "foodAndWater" })).toEqual({
      ok: false,
      reason: "waterMass",
    });
    expect(
      brineSalt({
        mode: "brine",
        foodMass: 1000,
        waterMass: 1000,
        saltPercent: 60,
        sugarPercent: 45,
        basis: "totalWithSalt",
      }),
    ).toEqual({ ok: false, reason: "saltPercent" });
  });
});

describe("coffeeExtraction", () => {
  it("filter: dose 60 g, brew water 1000 g, beverage 880 g, TDS 1.35%", () => {
    // water_ratio = 1000/60 = 16.667; beverage_ratio = 880/60 = 14.667;
    // dissolved = 880*0.0135 = 11.88; extraction = 11.88/60*100 = 19.80%;
    // retained = 1000-880 = 120.0.
    const result = coffeeExtraction({ dose: 60, brewWater: 1000, beverageMass: 880, tds: 1.35 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waterRatio).toBeCloseTo(16.666667, 4);
    expect(result.beverageRatio).toBeCloseTo(14.666667, 4);
    expect(result.dissolved).toBeCloseTo(11.88, 6);
    expect(result.extractionYield).toBeCloseTo(19.8, 6);
    expect(result.retained).toBeCloseTo(120.0, 6);
    expect(result.weighingShortfall).toBeUndefined();
  });

  it("espresso, brew water not weighed: dose 18 g, beverage 36 g, TDS 9.2% -> beverage ratio 1:2.0", () => {
    const result = coffeeExtraction({ dose: 18, beverageMass: 36, tds: 9.2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.beverageRatio).toBeCloseTo(2.0, 6);
    expect(result.dissolved).toBeCloseTo(3.312, 6);
    expect(result.extractionYield).toBeCloseTo(18.4, 6);
    expect(result.waterRatio).toBeUndefined();
    expect(result.retained).toBeUndefined();
  });

  it("target water for a 1:15 ratio at a 55 g dose -> 825.0 g", () => {
    const result = coffeeExtraction({ dose: 55, beverageMass: 800, tds: 15, targetRatio: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waterForTarget).toBeCloseTo(825.0, 6);
  });

  it("reports a weighing shortfall, never a negative retention, when the beverage outweighs the brew water", () => {
    const result = coffeeExtraction({ dose: 10, brewWater: 100, beverageMass: 150, tds: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retained).toBeUndefined();
    expect(result.weighingShortfall).toBeCloseTo(50, 6);
  });

  it("refuses a non-positive dose, an out-of-range TDS, a non-positive beverage mass, and a non-positive brew water", () => {
    expect(coffeeExtraction({ dose: 0, beverageMass: 100, tds: 5 })).toEqual({
      ok: false,
      reason: "dose",
    });
    expect(coffeeExtraction({ dose: 10, beverageMass: 100, tds: 0 })).toEqual({
      ok: false,
      reason: "tds",
    });
    expect(coffeeExtraction({ dose: 10, beverageMass: 0, tds: 5 })).toEqual({
      ok: false,
      reason: "beverageMass",
    });
    expect(coffeeExtraction({ dose: 10, beverageMass: 100, tds: 5, brewWater: -1 })).toEqual({
      ok: false,
      reason: "brewWater",
    });
  });
});

describe("doughWaterTemperature", () => {
  it("mode waterTemperature, N=3 (flour + room): water = 3*24 - (21+22+3) = 26.0 °C", () => {
    const result = doughWaterTemperature({
      mode: "waterTemperature",
      flourTemp: 21,
      roomTemp: 22,
      desiredDoughTemp: 24,
      frictionFactor: 3,
      frictionFactorMeasuredAtN: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.multiplier).toBe(3);
    expect(result.waterTemp).toBeCloseTo(26.0, 6);
    expect(result.belowFreezingPoint).toBe(false);
  });

  it("mode waterTemperature, N=4 (flour + room + preferment): water = 4*25 - (20+23+21+2) = 34.0 °C", () => {
    const result = doughWaterTemperature({
      mode: "waterTemperature",
      flourTemp: 20,
      roomTemp: 23,
      prefermentTemp: 21,
      desiredDoughTemp: 25,
      frictionFactor: 2,
      frictionFactorMeasuredAtN: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.multiplier).toBe(4);
    expect(result.waterTemp).toBeCloseTo(34.0, 6);
  });

  it("mode frictionFactor, N=3: friction = 3*26 - (21+22+26) = 9.0 °C", () => {
    const result = doughWaterTemperature({
      mode: "frictionFactor",
      flourTemp: 21,
      roomTemp: 22,
      measuredDoughTemp: 26,
      measuredWaterTemp: 26,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frictionFactor).toBeCloseTo(9.0, 6);
    expect(result.waterTemp).toBeUndefined();
  });

  it("a required water temperature below zero is printed as the number it is, flagged, never clamped", () => {
    // 66 - 67 = -1.0 °C.
    const result = doughWaterTemperature({
      mode: "waterTemperature",
      flourTemp: 26,
      roomTemp: 30,
      desiredDoughTemp: 22,
      frictionFactor: 11,
      frictionFactorMeasuredAtN: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waterTemp).toBeCloseTo(-1.0, 6);
    expect(result.belowFreezingPoint).toBe(true);
  });

  it("refuses a friction factor measured at a different N than this batch's own — degrees are not the same size", () => {
    const result = doughWaterTemperature({
      mode: "waterTemperature",
      flourTemp: 20,
      roomTemp: 23,
      prefermentTemp: 21, // N = 4 for this batch
      desiredDoughTemp: 25,
      frictionFactor: 2,
      frictionFactorMeasuredAtN: 3, // measured at N = 3 — a different size
    });
    expect(result).toEqual({ ok: false, reason: "frictionFactorMeasuredAtN" });
  });

  it("reports the delta against the hottest water actually available, as two numbers, no verdict", () => {
    const result = doughWaterTemperature({
      mode: "waterTemperature",
      flourTemp: 21,
      roomTemp: 22,
      desiredDoughTemp: 24,
      frictionFactor: 3,
      frictionFactorMeasuredAtN: 3,
      availableWaterTemp: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Required 26.0 - available 20 = 6.0.
    expect(result.availableDelta).toBeCloseTo(6.0, 6);
  });

  it("refuses temperatures outside -10..60 °C and a missing friction factor", () => {
    expect(
      doughWaterTemperature({ mode: "waterTemperature", flourTemp: 90, roomTemp: 22 }),
    ).toEqual({ ok: false, reason: "flourTemp" });
    expect(
      doughWaterTemperature({ mode: "waterTemperature", flourTemp: 21, roomTemp: -20 }),
    ).toEqual({ ok: false, reason: "roomTemp" });
    expect(
      doughWaterTemperature({
        mode: "waterTemperature",
        flourTemp: 21,
        roomTemp: 22,
        desiredDoughTemp: 24,
      }),
    ).toEqual({ ok: false, reason: "frictionFactor" });
    expect(
      doughWaterTemperature({ mode: "frictionFactor", flourTemp: 21, roomTemp: 22 }),
    ).toEqual({ ok: false, reason: "measuredDoughTemp" });
  });
});

describe("iceCreamOverrun", () => {
  it("from weighings, tare already subtracted: 500 g mix / 400 g finished -> 25.0%", () => {
    const result = iceCreamOverrun({
      mode: "fromWeighings",
      grossMixMass: 500,
      grossFrozenMass: 400,
      tare: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrun).toBeCloseTo(25.0, 6);
  });

  it("from weighings with a real tare: 780/640 g gross, 280 g tare -> net 500/360 -> 38.9%", () => {
    // net 500 g / 360 g -> (500-360)/360*100 = 38.888...%
    const result = iceCreamOverrun({
      mode: "fromWeighings",
      grossMixMass: 780,
      grossFrozenMass: 640,
      tare: 280,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netMixMass).toBe(500);
    expect(result.netFrozenMass).toBe(360);
    expect(result.overrun).toBeCloseTo(38.888889, 4);
  });

  it("from a target overrun: 10 l of mix at 35% -> 13.500 l finished; density 1.10 kg/l -> 814.8 g/l -> 407.4 g/tub", () => {
    // finishedDensity = 1.10/1.35 = 0.814815 kg/l = 814.815 g/l.
    const result = iceCreamOverrun({
      mode: "fromTarget",
      targetOverrun: 35,
      mixVolume: 10,
      mixDensity: 1.1,
      tubVolume: 0.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frozenVolume).toBeCloseTo(13.5, 6);
    expect(result.finishedMassPerLitre).toBeCloseTo(814.814815, 3);
    expect(result.tubNetWeight).toBeCloseTo(407.407407, 3);
  });

  it("accepts a negative overrun as a genuine answer — a dense mix can lose volume", () => {
    const result = iceCreamOverrun({
      mode: "fromWeighings",
      grossMixMass: 390,
      grossFrozenMass: 400,
      tare: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (390-400)/400*100 = -2.5%
    expect(result.overrun).toBeCloseTo(-2.5, 6);
  });

  it("refuses a MISSING tare rather than defaulting it to 0 — a silent default is always in the flattering direction", () => {
    expect(iceCreamOverrun({ mode: "fromWeighings", grossMixMass: 500, grossFrozenMass: 400 })).toEqual(
      { ok: false, reason: "tare" },
    );
  });

  it("refuses a tare at or past either gross mass, a target at or below -100%, and a tub weight with no known density", () => {
    expect(
      iceCreamOverrun({ mode: "fromWeighings", grossMixMass: 400, grossFrozenMass: 400, tare: 400 }),
    ).toEqual({ ok: false, reason: "tare" });
    expect(iceCreamOverrun({ mode: "fromTarget", targetOverrun: -100 })).toEqual({
      ok: false,
      reason: "targetOverrun",
    });
    expect(
      iceCreamOverrun({ mode: "fromTarget", targetOverrun: 20, tubVolume: 0.5 }),
    ).toEqual({ ok: false, reason: "mixDensity" });
  });
});

describe("laminationLayers", () => {
  it("counts layers by INTEGER arithmetic — three letter folds from one block: 27 butter, 28 dough", () => {
    const result = laminationLayers({
      folds: ["letter", "letter", "letter"],
      fatMass: 100,
      doughMass: 100,
      finalThickness: 3.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fatLayers).toBe(27);
    expect(result.doughLayers).toBe(28);
    // Equal masses -> phi = 0.5. fatLayer = 3.5*0.5/27*1000 = 64.814815 µm;
    // doughLayer = 3.5*0.5/28*1000 = 62.5 µm. Check: 27*64.814815+28*62.5 = 3500 µm = 3.5 mm.
    expect(result.fatLayerMicrons).toBeCloseTo(64.814815, 3);
    expect(result.doughLayerMicrons).toBeCloseTo(62.5, 6);
    expect(27 * result.fatLayerMicrons + 28 * result.doughLayerMicrons).toBeCloseTo(3500, 3);
  });

  it("one book fold then two letter folds: 36 butter, 37 dough", () => {
    const result = laminationLayers({
      folds: ["book", "letter", "letter"],
      fatMass: 100,
      doughMass: 100,
      finalThickness: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fatLayers).toBe(36);
    expect(result.doughLayers).toBe(37);
    // phi = 0.5. fatLayer = 4*0.5/36*1000 = 55.555556 µm; doughLayer = 4*0.5/37*1000 = 54.054054 µm.
    expect(result.fatLayerMicrons).toBeCloseTo(55.555556, 3);
    expect(result.doughLayerMicrons).toBeCloseTo(54.054054, 3);
  });

  it("the layer thickness is NOT finalThickness/count — it uses the fat's own mass share of the cross-section", () => {
    // A 100 g/900 g split (phi = 0.1) at the SAME 27/28 layer counts as above
    // gives an entirely different fat-layer thickness than the equal-mass case.
    // This is also the one asymmetric case (phi != 1-phi) in the suite, so it
    // is the only vector that can tell `doughLayerMicrons` apart from a
    // one-character regression that swapped it for phi*t/D instead of
    // (1-phi)*t/D: doughLayer = 3.5*0.9/28*1000 = 112.5 µm exactly, and the
    // two layer thicknesses reconstruct the full 3.5 mm strip:
    // 27*12.962963 + 28*112.5 = 350.000001 + 3150 = 3500.000001 ~ 3500 µm.
    const result = laminationLayers({
      folds: ["letter", "letter", "letter"],
      fatMass: 100,
      doughMass: 900,
      finalThickness: 3.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // phi = 0.1. fatLayer = 3.5*0.1/27*1000 = 12.962963 µm.
    expect(result.fatLayerMicrons).toBeCloseTo(12.962963, 3);
    expect(result.fatLayerMicrons).not.toBeCloseTo(3.5 / 27, 3);
    expect(result.doughLayerMicrons).toBeCloseTo(112.5, 6);
    expect(27 * result.fatLayerMicrons + 28 * result.doughLayerMicrons).toBeCloseTo(3500, 3);
  });

  it("rolls and folds ALTERNATE — thickness x multiplier on a fold, length / multiplier, then a chosen roll-out", () => {
    // Start 1 mm / 100 cm. One letter fold: thickness 3 mm, length 33.333333 cm
    // (product conserved: 1*100 = 3*33.333333 = 100). Roll to 1.5 mm:
    // length = 33.333333 * (3/1.5) = 66.666667 cm (product still 100).
    const result = laminationLayers({
      folds: ["letter"],
      fatMass: 50,
      doughMass: 50,
      finalThickness: 1.5,
      startThickness: 1,
      startLength: 100,
      rollThicknesses: [1.5],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0]?.foldedThickness).toBeCloseTo(3, 6);
    expect(result.passes[0]?.foldedLength).toBeCloseTo(33.333333, 4);
    expect(result.passes[0]?.rolledThickness).toBeCloseTo(1.5, 6);
    expect(result.passes[0]?.rolledLength).toBeCloseTo(66.666667, 4);
  });

  it("refuses an empty fold list, a non-positive thickness or mass, and a roll target at or above the fold it follows", () => {
    expect(
      laminationLayers({ folds: [], fatMass: 100, doughMass: 100, finalThickness: 3.5 }),
    ).toEqual({ ok: false, reason: "folds" });
    expect(
      laminationLayers({ folds: ["letter"], fatMass: 0, doughMass: 100, finalThickness: 3.5 }),
    ).toEqual({ ok: false, reason: "fatMass" });
    expect(
      laminationLayers({ folds: ["letter"], fatMass: 100, doughMass: 100, finalThickness: 0 }),
    ).toEqual({ ok: false, reason: "finalThickness" });
    expect(
      laminationLayers({
        folds: ["letter"],
        fatMass: 100,
        doughMass: 100,
        finalThickness: 3.5,
        startThickness: 1,
        startLength: 100,
        rollThicknesses: [3], // folded thickness is also 3 -- not a roll-OUT
      }),
    ).toEqual({ ok: false, reason: "rollThickness:0" });
  });

  it("refuses a final thickness above what the chain actually reached, compared to the END of the chain, not the very first input", () => {
    const result = laminationLayers({
      folds: ["letter"],
      fatMass: 50,
      doughMass: 50,
      finalThickness: 5, // 5 mm > the 1.5 mm reached at the end of the chain
      startThickness: 1,
      startLength: 100,
      rollThicknesses: [1.5],
    });
    expect(result).toEqual({ ok: false, reason: "finalThickness" });
  });
});

describe("levainSplit", () => {
  it("splits 200 g at 100% hydration into 100 g flour and 100 g water", () => {
    const result = levainSplit(200, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flour).toBeCloseTo(100, 6);
    expect(result.water).toBeCloseTo(100, 6);
  });

  it("refuses a negative mass and a hydration at or below zero — a flour-only mass has no hydration figure", () => {
    expect(levainSplit(-1, 100)).toEqual({ ok: false, reason: "mass" });
    expect(levainSplit(200, 0)).toEqual({ ok: false, reason: "hydration" });
  });
});

describe("levainHydration", () => {
  it("correctDough: F_total 1000 g, H 75%, levain 200 g at 100% hydration", () => {
    // f_l = 200/2 = 100.00, w_l = 100.00. W = 1000*0.75 = 750.
    // addedFlour = 1000-100 = 900.00; addedWater = 750-100 = 650.00.
    const result = levainHydration({
      mode: "correctDough",
      totalFlour: 1000,
      targetHydration: 75,
      levainMass: 200,
      levainHydration: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levainFlour).toBeCloseTo(100, 6);
    expect(result.levainWater).toBeCloseTo(100, 6);
    expect(result.addedFlour).toBeCloseTo(900, 6);
    expect(result.addedWater).toBeCloseTo(650, 6);
    expect(result.doughMass).toBeCloseTo(1750, 6);
    expect(result.achievedHydration).toBeCloseTo(75.0, 6);
  });

  it("correctDough with a stiff levain: F_total 1200 g, H 70%, levain 300 g at 60%", () => {
    // f_l = 300/1.6 = 187.50, w_l = 112.50. W = 1200*0.70 = 840.
    // addedFlour = 1200-187.50 = 1012.50; addedWater = 840-112.50 = 727.50.
    const result = levainHydration({
      mode: "correctDough",
      totalFlour: 1200,
      targetHydration: 70,
      levainMass: 300,
      levainHydration: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedFlour).toBeCloseTo(1012.5, 6);
    expect(result.addedWater).toBeCloseTo(727.5, 6);
    expect(result.achievedHydration).toBeCloseTo(70.0, 6);
  });

  it("buildLevain: seed 50 g at 100% built up to a 250 g target at 100%", () => {
    // f_s = 25.00, w_s = 25.00; f_t = 125.00, w_t = 125.00.
    // add_flour = 100.00, add_water = 100.00.
    const result = levainHydration({
      mode: "buildLevain",
      seedMass: 50,
      seedHydration: 100,
      targetLevainMass: 250,
      targetLevainHydration: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedFlour).toBeCloseTo(100, 6);
    expect(result.addedWater).toBeCloseTo(100, 6);
    expect(result.achievedHydration).toBeCloseTo(100.0, 6);
  });

  it("refuses (as flourOver) when the levain already carries more flour than the formula has room for", () => {
    // F_total 400, H 80%, levain 600 g at 20% (very stiff): f_l = 600/1.2 = 500 > 400.
    const result = levainHydration({
      mode: "correctDough",
      totalFlour: 400,
      targetHydration: 80,
      levainMass: 600,
      levainHydration: 20,
    });
    expect(result).toEqual({ ok: false, reason: "flourOver" });
  });

  it("refuses (as waterOver, not a negative number) when a wet levain carries more water than the target hydration allows", () => {
    // F_total 1000, H 50%, levain 800 g at 300% (very wet): f_l = 800/4 = 200, w_l = 600.
    // W = 1000*0.5 = 500 < 600.
    const result = levainHydration({
      mode: "correctDough",
      totalFlour: 1000,
      targetHydration: 50,
      levainMass: 800,
      levainHydration: 300,
    });
    expect(result).toEqual({ ok: false, reason: "waterOver" });
  });

  it("refuses a levain heavier than the dough it is supposedly part of", () => {
    const result = levainHydration({
      mode: "correctDough",
      totalFlour: 100,
      targetHydration: 50,
      levainMass: 1000,
      levainHydration: 100,
    });
    expect(result).toEqual({ ok: false, reason: "levainMass" });
  });

  it("refuses a build with nothing to add, and a build whose target hydration undershoots the seed's own water", () => {
    expect(
      levainHydration({
        mode: "buildLevain",
        seedMass: 200,
        seedHydration: 100,
        targetLevainMass: 100,
        targetLevainHydration: 100,
      }),
    ).toEqual({ ok: false, reason: "targetLevainMass" });
    // seed 100 g @ 100% -> f=50,w=50; target 200 g @ 20% -> f_t=166.667,w_t=33.333.
    // addedWater = 33.333 - 50 < 0.
    expect(
      levainHydration({
        mode: "buildLevain",
        seedMass: 100,
        seedHydration: 100,
        targetLevainMass: 200,
        targetLevainHydration: 20,
      }),
    ).toEqual({ ok: false, reason: "waterOver" });
  });
});

describe("nutritionPerPortion", () => {
  it("per-100g -> per-portion: 1450 kJ, 12.3 g fat, 65 g portion", () => {
    // perPortion energy = 1450*0.65 = 942.5 kJ; fat = 12.3*0.65 = 7.995 g.
    // kcal/100g = 1450/4.184 = 346.558317; kcal/portion = 942.5/4.184 = 225.262906.
    const result = nutritionPerPortion({
      direction: "per100ToPortion",
      energy: 1450,
      energyUnit: "kJ",
      nutrients: [{ name: "masti", value: 12.3 }],
      portionMass: 65,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.energy.perPortionKJ).toBeCloseTo(942.5, 6);
    expect(result.energy.per100gKcal).toBeCloseTo(346.558317, 4);
    expect(result.energy.perPortionKcal).toBeCloseTo(225.262906, 4);
    expect(result.rows[0]?.perPortion).toBeCloseTo(7.995, 6);
  });

  it("inverse direction: a 240 g portion carrying 372 kcal -> 155 kcal / 649 kJ per 100 g", () => {
    // per100 = 372*100/240 = 155.0 kcal; in kJ = 155*4.184 = 648.52.
    const result = nutritionPerPortion({
      direction: "portionToPer100",
      energy: 372,
      energyUnit: "kcal",
      nutrients: [],
      portionMass: 240,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.energy.per100gKcal).toBeCloseTo(155.0, 6);
    expect(result.energy.per100gKJ).toBeCloseTo(648.52, 6);
  });

  it("the reference column is the PORTION value over the user's own typed reference — 1.2 g salt against 6 g -> 20.0%", () => {
    const result = nutritionPerPortion({
      direction: "per100ToPortion",
      energy: 0,
      energyUnit: "kJ",
      nutrients: [{ name: "so", value: 1.2, reference: 6 }],
      portionMass: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.perPortion).toBeCloseTo(1.2, 6);
    expect(result.rows[0]?.percentOfReference).toBeCloseTo(20.0, 6);
  });

  it("the reference percentage is computed on the PORTION figure, not the per-100g one — the two diverge once portionMass != 100", () => {
    // per100g stays 1.2 (typed directly, per100ToPortion). perPortion =
    // 1.2*65/100 = 0.78. Against a reference of 6: 0.78/6*100 = 13.0%. A
    // per-100g reading of the same reference would give 1.2/6*100 = 20.0% —
    // the two are different numbers precisely because portionMass != 100 here.
    const result = nutritionPerPortion({
      direction: "per100ToPortion",
      energy: 0,
      energyUnit: "kJ",
      nutrients: [{ name: "so", value: 1.2, reference: 6 }],
      portionMass: 65,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.per100g).toBeCloseTo(1.2, 6);
    expect(result.rows[0]?.perPortion).toBeCloseTo(0.78, 6);
    expect(result.rows[0]?.percentOfReference).toBeCloseTo(13.0, 6);
    expect(result.rows[0]?.percentOfReference).not.toBeCloseTo(20.0, 6);
  });

  it("a reference of exactly zero has no defined percentage — shown as a dash, not as Infinity or 0", () => {
    const result = nutritionPerPortion({
      direction: "per100ToPortion",
      energy: 0,
      energyUnit: "kJ",
      nutrients: [{ name: "so", value: 1.2, reference: 0 }],
      portionMass: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.percentOfReference).toBeUndefined();
  });

  it("refuses a non-positive portion mass, a negative nutrient value, and a package mass that contradicts the portion count", () => {
    expect(
      nutritionPerPortion({
        direction: "per100ToPortion",
        energy: 100,
        energyUnit: "kJ",
        nutrients: [],
        portionMass: 0,
      }),
    ).toEqual({ ok: false, reason: "portionMass" });
    expect(
      nutritionPerPortion({
        direction: "per100ToPortion",
        energy: 100,
        energyUnit: "kJ",
        nutrients: [{ name: "x", value: -1 }],
        portionMass: 50,
      }),
    ).toEqual({ ok: false, reason: "nutrientValue" });
    expect(
      nutritionPerPortion({
        direction: "per100ToPortion",
        energy: 100,
        energyUnit: "kJ",
        nutrients: [],
        portionMass: 50,
        packageMass: 1000,
        portionsPerPackage: 5, // 5*50 = 250, not 1000 — a real contradiction
      }),
    ).toEqual({ ok: false, reason: "package" });
  });
});

describe("panArea / panConversion / frustumVolume", () => {
  it("round Ø24 cm -> A = pi*12^2 = 452.3893 cm²; Ø20 cm -> 314.1593 cm²; swap factor = (20/24)^2 = 0.6944", () => {
    const a = panArea({ kind: "circle", diameter: 24 });
    const b = panArea({ kind: "circle", diameter: 20 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.area).toBeCloseTo(452.389342, 4);
    expect(b.area).toBeCloseTo(314.159265, 4);

    const conversion = panConversion({
      shapeA: { kind: "circle", diameter: 24 },
      shapeB: { kind: "circle", diameter: 20 },
      batterMassA: 1200,
    });
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;
    expect(conversion.swapFactor).toBeCloseTo(0.694444, 5);
    expect(conversion.massB).toBeCloseTo(833.333333, 3);
  });

  it("round Ø24 -> rectangle 30x20: factor = 600/452.38934 = 1.32629, not the earlier draft's 1.3264", () => {
    const conversion = panConversion({
      shapeA: { kind: "circle", diameter: 24 },
      shapeB: { kind: "rect", a: 30, b: 20 },
      batterMassA: 1000,
    });
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;
    expect(conversion.swapFactor).toBeCloseTo(1.326291, 4);
    expect(conversion.massB).toBeCloseTo(1326.291, 1);
  });

  it("a pot Ø32 filled to 18 cm holds 14.476 l; the same pot needs 12.43 cm for 10 l", () => {
    // A = pi*16^2 = 804.247719 cm²; V = 804.247719*18 = 14476.459 cm³ = 14.476 l.
    // h for 10 l: 10000/804.247719 = 12.433922 cm.
    const conversion = panConversion({
      shapeA: { kind: "circle", diameter: 32 },
      fillHeight: 18,
      targetVolume: 10,
    });
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;
    expect(conversion.volumeAtHeight).toBeCloseTo(14.476459, 3);
    expect(conversion.heightForVolume).toBeCloseTo(12.433922, 3);
  });

  it("a ring whose inner diameter is not smaller than its outer is refused, not a zero-area answer", () => {
    expect(panArea({ kind: "ring", outer: 24, inner: 24 })).toEqual({ ok: false, reason: "inner" });
    expect(panArea({ kind: "ring", outer: 20, inner: 24 })).toEqual({ ok: false, reason: "inner" });
    expect(panArea({ kind: "circle", diameter: 0 })).toEqual({ ok: false, reason: "diameter" });
  });

  it("frustumVolume: a genuinely tapered vessel, never area x height", () => {
    // V = pi*h*(R^2+Rr+r^2)/3, R=10 cm, r=5 cm, h=10 cm:
    // pi*10*(100+50+25)/3 = pi*1750/3 = pi*583.333333 = 1832.595715 cm³ = 1.832596 l.
    const result = frustumVolume({ topDiameter: 10, bottomDiameter: 20, height: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volume).toBeCloseTo(1.832596, 4);
  });

  it("refuses a non-positive diameter or height on the frustum", () => {
    expect(frustumVolume({ topDiameter: 0, bottomDiameter: 20, height: 10 })).toEqual({
      ok: false,
      reason: "topDiameter",
    });
    expect(frustumVolume({ topDiameter: 10, bottomDiameter: 20, height: 0 })).toEqual({
      ok: false,
      reason: "height",
    });
  });
});

describe("plateCost", () => {
  it("one portion, three lines, 30% target food cost", () => {
    // meso: 180 g at 1200/kg, 82% yield -> (0.18*1200)/0.82 = 263.414634
    // krompir: 250 g at 90/kg, 80% yield -> (0.25*90)/0.80 = 28.125
    // ulje: 20 ml at 250/l, 100% yield -> (0.02*250)/1 = 5.00
    // total = 296.539634; price = total/0.30 = 988.465447; margin = price - total.
    const result = plateCost({
      lines: [
        { name: "meso", quantity: 180, unit: "g", unitPrice: 1200, yieldPercent: 82 },
        { name: "krompir", quantity: 250, unit: "g", unitPrice: 90, yieldPercent: 80 },
        { name: "ulje", quantity: 20, unit: "ml", unitPrice: 250, yieldPercent: 100 },
      ],
      portions: 1,
      targetFoodCost: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBeCloseTo(296.539634, 4);
    expect(result.costPerPortion).toBeCloseTo(296.539634, 4);
    expect(result.sellingPrice).toBeCloseTo(988.465447, 3);
    expect(result.margin).toBeCloseTo(691.925813, 3);
    // Shares computed on unrounded costs: 88.8%, 9.5%, 1.7% (sum 100.0%).
    expect(result.rows[0]?.share).toBeCloseTo(88.8, 1);
    expect(result.rows[1]?.share).toBeCloseTo(9.5, 1);
    expect(result.rows[2]?.share).toBeCloseTo(1.7, 1);
  });

  it("10 portions, a single 4500 line, no extra cost, 25% target -> 1800.00 selling price", () => {
    const result = plateCost({
      lines: [{ name: "sastojci", quantity: 4500, unit: "g", unitPrice: 1000, yieldPercent: 100 }],
      portions: 10,
      targetFoodCost: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.costPerPortion).toBeCloseTo(450.0, 6);
    expect(result.sellingPrice).toBeCloseTo(1800.0, 6);
    expect(result.margin).toBeCloseTo(1350.0, 6);
  });

  it("adds packaging per portion BEFORE the food-cost division, at 28% target", () => {
    // costPerPortion = 450 + 35 = 485.00; price = 485/0.28 = 1732.142857.
    const result = plateCost({
      lines: [{ name: "sastojci", quantity: 4500, unit: "g", unitPrice: 1000, yieldPercent: 100 }],
      portions: 10,
      targetFoodCost: 28,
      extraPerPortion: 35,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.costPerPortion).toBeCloseTo(485.0, 6);
    expect(result.sellingPrice).toBeCloseTo(1732.142857, 4);
    expect(result.margin).toBeCloseTo(1247.142857, 4);
  });

  it("a recipe that costs nothing has undefined shares, never a false 0.0%", () => {
    const result = plateCost({
      lines: [{ name: "voda", quantity: 0, unit: "g", unitPrice: 100, yieldPercent: 100 }],
      portions: 1,
      targetFoodCost: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(0);
    expect(result.rows[0]?.share).toBeUndefined();
  });

  it("refuses an empty recipe, fewer than one portion, a target food cost outside (0,100], and a yield outside (0,100]", () => {
    expect(plateCost({ lines: [], portions: 1, targetFoodCost: 30 })).toEqual({
      ok: false,
      reason: "lines",
    });
    expect(
      plateCost({
        lines: [{ name: "x", quantity: 1, unit: "g", unitPrice: 1, yieldPercent: 100 }],
        portions: 0,
        targetFoodCost: 30,
      }),
    ).toEqual({ ok: false, reason: "portions" });
    expect(
      plateCost({
        lines: [{ name: "x", quantity: 1, unit: "g", unitPrice: 1, yieldPercent: 100 }],
        portions: 1,
        targetFoodCost: 120,
      }),
    ).toEqual({ ok: false, reason: "targetFoodCost" });
    expect(
      plateCost({
        lines: [{ name: "x", quantity: 1, unit: "g", unitPrice: 1, yieldPercent: 0 }],
        portions: 1,
        targetFoodCost: 30,
      }),
    ).toEqual({ ok: false, reason: "yieldPercent" });
  });
});

describe("portionsFromPack", () => {
  it("pack 0.70 l, portion 0.05 l, no loss -> 14 portions per pack, no leftover", () => {
    const result = portionsFromPack({
      packQuantity: 0.7,
      packUnit: "l",
      portionQuantity: 0.05,
      portionUnit: "l",
      lossPercent: 0,
      portionsNeeded: 200,
      packPrice: 2400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portionsPerPack).toBe(14);
    expect(result.leftover).toBeCloseTo(0, 6);
    // per portion = 2400/14 = 171.4286; per litre = 2400/0.7 = 3428.5714.
    expect(result.pricePerPortion).toBeCloseTo(171.428571, 4);
    expect(result.unitPrice).toBeCloseTo(3428.571429, 3);
    // packs = ceil(200/14) = 15; 15*14 = 210 -> surplus 10; total 15*2400 = 36000.
    expect(result.packsNeeded).toBe(15);
    expect(result.surplusPortions).toBe(10);
    expect(result.totalCost).toBe(36000);
  });

  it("pack 5 kg with 4% loss, portion 180 g -> 26 portions, 0.12 kg leftover IN THE PACK'S OWN UNIT", () => {
    // usable = 5000*0.96 = 4800 g; portions = floor(4800/180) = 26;
    // leftover = 4800-4680 = 120 g — but the pack was declared in kg, and the
    // result is printed "in the pack's own unit" (per the spec's own output
    // line), so 120 g comes back as 0.12 kg, not as a bare 120.
    // packs for 100: ceil(100/26) = 4 -> 104 portions, surplus 4.
    const result = portionsFromPack({
      packQuantity: 5,
      packUnit: "kg",
      portionQuantity: 180,
      portionUnit: "g",
      lossPercent: 4,
      portionsNeeded: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portionsPerPack).toBe(26);
    expect(result.leftover).toBeCloseTo(0.12, 6);
    expect(result.packsNeeded).toBe(4);
    expect(result.surplusPortions).toBe(4);
  });

  it("refuses a portion larger than a whole pack — zero portions is not an answer, it is an unfittable portion", () => {
    const result = portionsFromPack({
      packQuantity: 500,
      packUnit: "g",
      portionQuantity: 750,
      portionUnit: "g",
      lossPercent: 0,
    });
    expect(result).toEqual({ ok: false, reason: "portionLargerThanPack" });
  });

  it("refuses a mass-vs-volume unit mismatch, a non-integer piece count, and a loss at or past 100%", () => {
    expect(
      portionsFromPack({
        packQuantity: 1,
        packUnit: "l",
        portionQuantity: 100,
        portionUnit: "g",
        lossPercent: 0,
      }),
    ).toEqual({ ok: false, reason: "unitMismatch" });
    expect(
      portionsFromPack({
        packQuantity: 10.5,
        packUnit: "piece",
        portionQuantity: 1,
        portionUnit: "piece",
        lossPercent: 0,
      }),
    ).toEqual({ ok: false, reason: "packQuantity" });
    expect(
      portionsFromPack({
        packQuantity: 1,
        packUnit: "kg",
        portionQuantity: 100,
        portionUnit: "g",
        lossPercent: 100,
      }),
    ).toEqual({ ok: false, reason: "lossPercent" });
  });
});

describe("parseRatio", () => {
  it("reads a colon-separated ratio, with a decimal comma accepted", () => {
    expect(parseRatio("3:2:1")).toEqual({ ok: true, parts: [3, 2, 1] });
    expect(parseRatio("1,5:2")).toEqual({ ok: true, parts: [1.5, 2] });
  });

  it("refuses fewer than two members and unreadable text", () => {
    expect(parseRatio("5")).toEqual({ ok: false, reason: "ratio" });
    expect(parseRatio("abc:2")).toEqual({ ok: false, reason: "ratio" });
  });
});

describe("ratioSplit", () => {
  it("900 g in 3:2:1 -> 450.00 / 300.00 / 150.00, shares 50.0% / 33.3% / 16.7%", () => {
    const result = ratioSplit({ total: 900, parts: [3, 2, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.amount).toBeCloseTo(450.0, 6);
    expect(result.rows[1]?.amount).toBeCloseTo(300.0, 6);
    expect(result.rows[2]?.amount).toBeCloseTo(150.0, 6);
    expect(result.total).toBeCloseTo(900, 6);
    expect(result.unallocated).toBeCloseTo(0, 6);
    // Shares, largest-remainder apportioned onto a 0.1 step so they sum to 100.0:
    // exact 50/33.333/16.667 -> floors 500/333/166 (sum 999, residue 1 step),
    // the largest remainder (16.667's 0.667) takes it -> 50.0/33.3/16.7.
    expect(result.rows[0]?.share).toBeCloseTo(50.0, 6);
    expect(result.rows[1]?.share).toBeCloseTo(33.3, 6);
    expect(result.rows[2]?.share).toBeCloseTo(16.7, 6);
  });

  it("1000 g in 1:1:1 at a 1 g step: the tie is broken by typed order — 334/333/333", () => {
    // Exact 333.333 each; floors 333,333,333 (sum 999); residue 1 step;
    // all three fractional remainders tie, so the FIRST part gets the extra gram.
    const result = ratioSplit({ total: 1000, parts: [1, 1, 1], step: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.amount).toBe(334);
    expect(result.rows[1]?.amount).toBe(333);
    expect(result.rows[2]?.amount).toBe(333);
    expect(result.total).toBe(1000);
    // The share column goes through the SAME largest-remainder distributor
    // (ISPRAVKE #3's chosen option), so it is 33.4/33.3/33.3 — summing to
    // exactly 100.0 — and not the naive 33.3 each, which would sum to 99.9.
    expect(result.rows[0]?.share).toBeCloseTo(33.4, 6);
    expect(result.rows[1]?.share).toBeCloseTo(33.3, 6);
    expect(result.rows[2]?.share).toBeCloseTo(33.3, 6);
  });

  it("500 ml in 5:3 at a 10 ml step -> 310/190, the larger remainder taking the extra step", () => {
    // Exact 312.5/187.5; q = 31.25/18.75; floors 31/18 (sum 490, residue 1 step);
    // the SECOND part has the larger remainder (0.75 vs 0.25) and takes it.
    const result = ratioSplit({ total: 500, parts: [5, 3], step: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.amount).toBe(310);
    expect(result.rows[1]?.amount).toBe(190);
    expect(result.rows[0]?.share).toBeCloseTo(62.5, 6);
    expect(result.rows[1]?.share).toBeCloseTo(37.5, 6);
  });

  it("a ratio member of exactly 0 is NEVER bumped by the residue — it stays exactly zero", () => {
    // total 10, parts 0:1:1, step 3: exact 0/5/5; q = 0/1.6667/1.6667;
    // floors 0/1/1 (sum 2); target = floor(10/3) = 3; residue = 1 step.
    // Both non-zero parts tie on the fractional remainder; the zero part is
    // never a candidate at all, so index 1 (lower index among the eligible) wins.
    const result = ratioSplit({ total: 10, parts: [0, 1, 1], step: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.amount).toBe(0);
    expect(result.rows[1]?.amount).toBe(6);
    expect(result.rows[2]?.amount).toBe(3);
    expect(result.total).toBe(9);
    expect(result.unallocated).toBeCloseTo(1, 6);
  });

  it("refuses a non-positive total, fewer than two parts, a negative or all-zero ratio, and a step larger than the total", () => {
    expect(ratioSplit({ total: 0, parts: [1, 1] })).toEqual({ ok: false, reason: "total" });
    expect(ratioSplit({ total: 100, parts: [1] })).toEqual({ ok: false, reason: "ratio" });
    expect(ratioSplit({ total: 100, parts: [1, -1] })).toEqual({ ok: false, reason: "ratio" });
    expect(ratioSplit({ total: 100, parts: [0, 0] })).toEqual({ ok: false, reason: "ratio" });
    expect(ratioSplit({ total: 100, parts: [1, 1], step: 200 })).toEqual({
      ok: false,
      reason: "step",
    });
  });
});

describe("parseQuantity", () => {
  it("reads a mixed number, a bare fraction, and a decimal comma", () => {
    expect(parseQuantity("1 1/2")).toEqual({ ok: true, value: 1.5 });
    expect(parseQuantity("1/2")).toEqual({ ok: true, value: 0.5 });
    expect(parseQuantity("1,5")).toEqual({ ok: true, value: 1.5 });
  });

  it("refuses unreadable text rather than repairing it to zero", () => {
    expect(parseQuantity("abc")).toEqual({ ok: false, reason: "quantity" });
    expect(parseQuantity("1/0")).toEqual({ ok: false, reason: "quantity" });
  });
});

describe("recipeScale", () => {
  it("4 -> 7 portions (k = 1.75), each line rounded to its OWN step", () => {
    // 250 g * 1.75 = 437.5 g (unchanged at a 0.01 g step, already a multiple).
    // 0.5 kašičica * 1.75 = 0.875 -> rounded HALF-UP at a 0.01 step = 0.88
    // (the assignment's own vector calls this "unchanged", but 0.875 sits
    // exactly on the 0.01 rounding boundary and half-up moves it to 0.88 —
    // re-derived here from the rounding rule itself, not copied from the vector).
    // 1.5 dl * 1.75 = 2.625 -> half-up at 0.01 = 2.63, for the same reason.
    const result = recipeScale({
      mode: "portions",
      originalPortions: 4,
      targetPortions: 7,
      lines: [
        { name: "brašno", quantity: 250, unit: "g" },
        { name: "so", quantity: 0.5, unit: "other" },
        { name: "mleko", quantity: 1.5, unit: "other" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factor).toBeCloseTo(1.75, 6);
    expect(result.rows[0]?.rounded).toBeCloseTo(437.5, 6);
    expect(result.rows[1]?.rounded).toBeCloseTo(0.88, 6);
    expect(result.rows[2]?.rounded).toBeCloseTo(2.63, 6);
  });

  it("target-total-mass mode: 300+200+50 g scaled to 2000 g, residue apportioned so the column sums exactly", () => {
    // k = 2000/550 = 3.636364. Scaled: 1090.909091, 727.272727, 181.818182.
    // At a 0.01 g step: floors 109090/72727/18181 (sum 199998, target 200000,
    // residue 2 steps); the two largest fractional remainders (line 1 at
    // .909, line 3 at .818) each take one -> 1090.91 / 727.27 / 181.82,
    // which sums to exactly 2000.00.
    const result = recipeScale({
      mode: "targetMass",
      targetMass: 2000,
      lines: [
        { name: "a", quantity: 300, unit: "g" },
        { name: "b", quantity: 200, unit: "g" },
        { name: "c", quantity: 50, unit: "g" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.rounded).toBeCloseTo(1090.91, 6);
    expect(result.rows[1]?.rounded).toBeCloseTo(727.27, 6);
    expect(result.rows[2]?.rounded).toBeCloseTo(181.82, 6);
    expect(result.totalMass).toBeCloseTo(2000.0, 6);
    // Shares: exact percents 1090.91/2000*100=54.5455, 727.27/2000*100=36.3635,
    // 181.82/2000*100=9.091. Onto a 0.1 step: quotients 545.455/363.635/90.91;
    // floors 545/363/90 (sum 998, target 1000, residue 2 steps); the two
    // largest remainders (line c at .91, line b at .635) each take one step ->
    // 54.5 / 36.4 / 9.1, summing to exactly 100.0.
    expect(result.rows[0]?.share).toBeCloseTo(54.5, 6);
    expect(result.rows[1]?.share).toBeCloseTo(36.4, 6);
    expect(result.rows[2]?.share).toBeCloseTo(9.1, 6);
  });

  it("a portions/factor scale over mass-only lines ALSO prints a share column, not only target-mass mode", () => {
    // factor 3 on 500 g water + 250 g flour -> 1500 g / 750 g, total 2250 g.
    // Shares: 1500/2250*100 = 66.666667% -> 66.7 on the 0.1 step (floor 666,
    // remainder .667 vs flour's 333 floor, remainder .333 -- residue 1 step
    // goes to water, the larger remainder); flour: 33.3.
    const result = recipeScale({
      mode: "factor",
      factor: 3,
      lines: [
        { name: "voda", quantity: 500, unit: "g" },
        { name: "brašno", quantity: 250, unit: "g" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.share).toBeCloseTo(66.7, 6);
    expect(result.rows[1]?.share).toBeCloseTo(33.3, 6);
  });

  it("a recipe with a non-mass line has no total mass and therefore no shares at all", () => {
    const result = recipeScale({
      mode: "factor",
      factor: 2,
      lines: [
        { name: "brašno", quantity: 250, unit: "g" },
        { name: "jaja", quantity: 2, unit: "piece" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalMass).toBeUndefined();
    expect(result.rows[0]?.share).toBeUndefined();
    expect(result.rows[1]?.share).toBeUndefined();
  });

  it("respects a per-line rounding step: 4 -> 6 portions (k = 1.5), one line at a 5 g step and one at 25 g", () => {
    // 350 g * 1.5 = 525 g, already a multiple of 5 -> stays 525.
    // 70 g * 1.5 = 105 g; round(105/25)*25 = round(4.2)*25 = 4*25 = 100.
    const result = recipeScale({
      mode: "portions",
      originalPortions: 4,
      targetPortions: 6,
      lines: [
        { name: "a", quantity: 350, unit: "g", step: 5 },
        { name: "b", quantity: 70, unit: "g", step: 25 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.rounded).toBe(525);
    expect(result.rows[1]?.rounded).toBe(100);
  });

  it("g and ml display in kg and l above 1000, without changing the underlying quantity", () => {
    const result = recipeScale({
      mode: "factor",
      factor: 3,
      lines: [{ name: "voda", quantity: 500, unit: "ml" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.rounded).toBeCloseTo(1500, 6);
    expect(result.rows[0]?.displayUnit).toBe("l");
    expect(result.rows[0]?.displayQuantity).toBeCloseTo(1.5, 6);
  });

  it("refuses an empty list, a negative line quantity, a non-positive factor, and a target mass with a volume or count line in it", () => {
    expect(recipeScale({ mode: "factor", factor: 2, lines: [] })).toEqual({
      ok: false,
      reason: "lines",
    });
    expect(
      recipeScale({
        mode: "factor",
        factor: 2,
        lines: [{ name: "a", quantity: -1, unit: "g" }],
      }),
    ).toEqual({ ok: false, reason: "lineQuantity" });
    expect(
      recipeScale({ mode: "factor", factor: 0, lines: [{ name: "a", quantity: 1, unit: "g" }] }),
    ).toEqual({ ok: false, reason: "factor" });
    expect(
      recipeScale({
        mode: "targetMass",
        targetMass: 1000,
        lines: [
          { name: "a", quantity: 300, unit: "g" },
          { name: "b", quantity: 1, unit: "l" },
        ],
      }),
    ).toEqual({ ok: false, reason: "unitMismatch" });
  });
});

describe("solutionConcentration (life-safety)", () => {
  it("blend two to a target total: 36% cream and 3.5% milk to 20%, total 1000 g", () => {
    // m1 = 1000*(20-3.5)/(36-3.5) = 1000*16.5/32.5 = 507.692308 -> 507.69.
    // m2 = 1000 - 507.6923077 -> 492.3076923 -> 492.31.
    const result = solutionConcentration({
      mode: "blend",
      c1: 36,
      c2: 3.5,
      targetConcentration: 20,
      targetMass: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.componentMass1).toBeCloseTo(507.69, 6);
    expect(result.componentMass2).toBeCloseTo(492.31, 6);
    expect(result.totalMass).toBeCloseTo(1000.0, 6);
    // ISPRAVKE #3: recomputed from the ROUNDED masses actually printed, so
    // this is 19.999925%, not a clean 20.000% — (507.69*36+492.31*3.5)/1000.
    expect(result.achievedConcentration).toBeCloseTo(19.999925, 4);
    expect(result.concentrationSpread).toBeCloseTo(32.5, 6);
  });

  it("blend by adding only as much of the second component as needed: 300 g of 36% cream to 20% with 3.5% milk", () => {
    // m2 = 300*(36-20)/(20-3.5) = 300*16/16.5 = 290.909091 -> 290.91.
    const result = solutionConcentration({
      mode: "blendAddSecond",
      c1: 36,
      c2: 3.5,
      targetConcentration: 20,
      mass: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.componentMass1).toBe(300);
    expect(result.componentMass2).toBeCloseTo(290.91, 6);
    expect(result.totalMass).toBeCloseTo(590.91, 6);
    expect(result.concentrationSpread).toBeCloseTo(16.5, 6);
  });

  it("dilute 500 g of 9% vinegar to 5% with pure water", () => {
    // m_solvent = 500*(9/5-1) = 500*0.8 = 400.00; total = 900.00.
    // Check: 500*0.09 = 45; 45/900 = 5.000%.
    const result = solutionConcentration({ mode: "dilute", c1: 9, targetConcentration: 5, mass: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solventAdded).toBeCloseTo(400.0, 6);
    expect(result.totalMass).toBeCloseTo(900.0, 6);
    expect(result.achievedConcentration).toBeCloseTo(5.0, 6);
    expect(result.concentrationSpread).toBeUndefined();
  });

  it("concentrate 3000 g of 1.2% stock to 2.0% by evaporation", () => {
    // m_removed = 3000*(1-1.2/2.0) = 3000*0.4 = 1200.00; remaining 1800.00.
    const result = solutionConcentration({
      mode: "concentrate",
      c1: 1.2,
      targetConcentration: 2.0,
      mass: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.massRemoved).toBeCloseTo(1200.0, 6);
    expect(result.totalMass).toBeCloseTo(1800.0, 6);
    expect(result.achievedConcentration).toBeCloseTo(2.0, 6);
  });

  it("add pure solute: 1000 g of 12% puree to 20% sugar", () => {
    // m_solute = 1000*(20-12)/(100-20) = 1000*8/80 = 100.00; total = 1100.00.
    const result = solutionConcentration({
      mode: "addSolute",
      c1: 12,
      targetConcentration: 20,
      mass: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soluteAdded).toBeCloseTo(100.0, 6);
    expect(result.achievedConcentration).toBeCloseTo(20.0, 6);
  });

  it("carries the user's own limit as a ratio, and only when one was actually typed — and returns no verdict field ever", () => {
    const withLimit = solutionConcentration({
      mode: "dilute",
      c1: 9,
      targetConcentration: 5,
      mass: 500,
      concentrationLimit: 4,
    });
    expect(withLimit.ok).toBe(true);
    if (!withLimit.ok) return;
    // achieved 5.000% / limit 4 = 1.25.
    expect(withLimit.concentrationRatio).toBeCloseTo(1.25, 6);
    assertNoVerdictFields(withLimit);

    const withoutLimit = solutionConcentration({ mode: "dilute", c1: 9, targetConcentration: 5, mass: 500 });
    expect(withoutLimit.ok).toBe(true);
    if (!withoutLimit.ok) return;
    expect(withoutLimit.concentrationRatio).toBeUndefined();
  });

  it("refuses a target outside what the two components can reach, rather than clamping it", () => {
    // 40% lies outside [3.5, 36].
    const result = solutionConcentration({
      mode: "blend",
      c1: 36,
      c2: 3.5,
      targetConcentration: 40,
      targetMass: 1000,
    });
    expect(result).toEqual({ ok: false, reason: "targetOutOfRange" });
  });

  it("refuses two equal concentrations to blend, an out-of-range c1, and a solute target at or past 100%", () => {
    expect(
      solutionConcentration({ mode: "blend", c1: 10, c2: 10, targetConcentration: 10, targetMass: 100 }),
    ).toEqual({ ok: false, reason: "equalConcentrations" });
    expect(solutionConcentration({ mode: "dilute", c1: 150, targetConcentration: 5, mass: 500 })).toEqual({
      ok: false,
      reason: "c1",
    });
    expect(
      solutionConcentration({ mode: "addSolute", c1: 12, targetConcentration: 100, mass: 1000 }),
    ).toEqual({ ok: false, reason: "targetConcentration" });
  });
});

describe("usCustomaryUnit", () => {
  it("2 US legal cups -> 473.176473 ml (8 fl oz each, fl oz = gallon/128)", () => {
    const result = usCustomaryUnit({ value: 2, from: "usCupLegal", to: "ml" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeCloseTo(473.176473, 6);
  });

  it("350 °F -> 176.7 °C: (350-32)*5/9 = 1590/9 = 176.666667", () => {
    const result = usCustomaryUnit({ value: 350, from: "degF", to: "degC" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeCloseTo(176.666667, 4);
  });

  it("1 lb + 4 oz -> g: 453.59237 + 4*28.349523125 = 566.9904625", () => {
    const pound = usCustomaryUnit({ value: 1, from: "pound", to: "g" });
    const ounces = usCustomaryUnit({ value: 4, from: "ozAvoirdupois", to: "g" });
    expect(pound.ok && ounces.ok).toBe(true);
    if (!pound.ok || !ounces.ok) return;
    expect(pound.value + ounces.value).toBeCloseTo(566.9904625, 6);
  });

  it("a US pint and an imperial pint are DIFFERENT sizes that merely share a name", () => {
    // US pint = gallon/8 = 3.785411784L/8 = 473.176473 ml.
    // Imperial pint = gallon/8 = 4.54609L/8 = 568.26125 ml.
    const us = usCustomaryUnit({ value: 1, from: "usPint", to: "ml" });
    const imp = usCustomaryUnit({ value: 1, from: "impPint", to: "ml" });
    expect(us.ok && imp.ok).toBe(true);
    if (!us.ok || !imp.ok) return;
    expect(us.value).toBeCloseTo(473.176473, 6);
    expect(imp.value).toBeCloseTo(568.26125, 6);
  });

  it("the metric tablespoon carries NO embedded default — it is a convention the caller must type in", () => {
    const withoutSpoon = usCustomaryUnit({ value: 2, from: "metricTbsp", to: "ml" });
    expect(withoutSpoon).toEqual({ ok: false, reason: "tablespoonMl" });
    const withSpoon = usCustomaryUnit({ value: 2, from: "metricTbsp", to: "ml", tablespoonMl: 15 });
    expect(withSpoon.ok).toBe(true);
    if (!withSpoon.ok) return;
    expect(withSpoon.value).toBeCloseTo(30.0, 6);
  });

  it("refuses to turn a volume into a mass — a cup of flour and a cup of honey are not the same weight", () => {
    const result = usCustomaryUnit({ value: 1, from: "usCupLegal", to: "g" });
    expect(result).toEqual({ ok: false, reason: "targetUnit" });
  });

  it("refuses a non-finite value and a negative volume", () => {
    expect(usCustomaryUnit({ value: Number.NaN, from: "usCupLegal", to: "ml" })).toEqual({
      ok: false,
      reason: "value",
    });
    expect(usCustomaryUnit({ value: -1, from: "usCupLegal", to: "ml" })).toEqual({
      ok: false,
      reason: "value",
    });
  });
});

describe("yieldTrimCook", () => {
  it("forward: 5000 g AP, 82% cleaning yield, 75% cooking yield, 180 g portions", () => {
    // cleaned = 5000*0.82 = 4100.00; cooked = 4100*0.75 = 3075.00; y = 0.615.
    // portions = floor(3075/180) = 17; leftover = 3075-3060 = 15.00.
    // at 1200/kg AP: per kg cooked = 1200/0.615 = 1951.219512;
    // per portion = 1200*0.180/0.615 = 216/0.615 = 351.219512.
    const result = yieldTrimCook({
      mode: "forward",
      apMass: 5000,
      cleaningYield: 82,
      cookingYield: 75,
      portionMass: 180,
      pricePerKgAp: 1200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cleanedMass).toBeCloseTo(4100.0, 6);
    expect(result.cookedMass).toBeCloseTo(3075.0, 6);
    expect(result.combinedYield).toBeCloseTo(61.5, 6);
    expect(result.portions).toBe(17);
    expect(result.leftover).toBeCloseTo(15.0, 6);
    expect(result.pricePerKgCooked).toBeCloseTo(1951.219512, 3);
    expect(result.pricePerPortion).toBeCloseTo(351.219512, 3);
  });

  it("inverse: 40 portions of 200 g cooked, 90% cleaning, 70% cooking -> 12.698 kg AP", () => {
    // y = 0.63; AP = (40*200)/0.63 = 12698.412698 g = 12.698413 kg.
    const result = yieldTrimCook({
      mode: "inverse",
      cleaningYield: 90,
      cookingYield: 70,
      portionMass: 200,
      portionsNeeded: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apNeeded).toBeCloseTo(12.698413, 4);
  });

  it("accepts a cooking yield above 100% — absorption genuinely adds mass — and refuses it for cleaning", () => {
    // Dry rice: y1 100%, y2 260%. cleaned = 1000.00; cooked = 2600.00; y = 2.6.
    // portions = floor(2600/220) = 11; leftover = 2600-2420 = 180.00.
    // at 300/kg: per kg cooked = 300/2.6 = 115.384615; per portion = 66/2.6 = 25.384615.
    const result = yieldTrimCook({
      mode: "forward",
      apMass: 1000,
      cleaningYield: 100,
      cookingYield: 260,
      portionMass: 220,
      pricePerKgAp: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.combinedYield).toBeCloseTo(260.0, 6);
    expect(result.portions).toBe(11);
    expect(result.leftover).toBeCloseTo(180.0, 6);
    expect(result.pricePerKgCooked).toBeCloseTo(115.384615, 4);
    expect(result.pricePerPortion).toBeCloseTo(25.384615, 4);

    // Trimming cannot ADD mass — a cleaning yield above 100% is refused.
    expect(
      yieldTrimCook({ mode: "forward", apMass: 1000, cleaningYield: 110, cookingYield: 75, portionMass: 100 }),
    ).toEqual({ ok: false, reason: "cleaningYield" });
  });

  it("a portion larger than the whole cooked mass is zero portions and the whole mass as leftover — not an error", () => {
    const result = yieldTrimCook({
      mode: "forward",
      apMass: 100,
      cleaningYield: 100,
      cookingYield: 100,
      portionMass: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portions).toBe(0);
    expect(result.leftover).toBeCloseTo(100, 6);
  });

  it("refuses a non-positive AP mass, a missing portion count in inverse mode, and a non-positive portion mass", () => {
    expect(
      yieldTrimCook({ mode: "forward", cleaningYield: 80, cookingYield: 75, portionMass: 180 }),
    ).toEqual({ ok: false, reason: "apMass" });
    expect(
      yieldTrimCook({ mode: "inverse", cleaningYield: 80, cookingYield: 75, portionMass: 180 }),
    ).toEqual({ ok: false, reason: "portionsNeeded" });
    expect(
      yieldTrimCook({
        mode: "forward",
        apMass: 1000,
        cleaningYield: 80,
        cookingYield: 75,
        portionMass: 0,
      }),
    ).toEqual({ ok: false, reason: "portionMass" });
  });
});

describe("a union value is a claim, not a fact — the table is asked at runtime", () => {
  type PortionsFromPackInput = Parameters<typeof portionsFromPack>[0];
  type PlateCostInput = Parameters<typeof plateCost>[0];
  type PlateLine = PlateCostInput["lines"][number];
  type UsUnitInput = Parameters<typeof usCustomaryUnit>[0];

  it("portionsFromPack refuses a pack unit outside the table rather than indexing it and throwing", () => {
    const good: PortionsFromPackInput = {
      packQuantity: 5,
      packUnit: "kg",
      portionQuantity: 180,
      portionUnit: "g",
      lossPercent: 4,
    };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: PortionsFromPackInput = {
      ...good,
      packUnit: "grams" as PortionsFromPackInput["packUnit"],
    };
    expect(portionsFromPack(bad)).toEqual({ ok: false, reason: "packUnit" });
    expect(portionsFromPack(good).ok).toBe(true);
  });

  it("portionsFromPack refuses a portion unit outside the table the same way", () => {
    const good: PortionsFromPackInput = {
      packQuantity: 5,
      packUnit: "kg",
      portionQuantity: 180,
      portionUnit: "g",
      lossPercent: 4,
    };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: PortionsFromPackInput = {
      ...good,
      portionUnit: "grams" as PortionsFromPackInput["portionUnit"],
    };
    expect(portionsFromPack(bad)).toEqual({ ok: false, reason: "portionUnit" });
    expect(portionsFromPack(good).ok).toBe(true);
  });

  it("plateCost refuses a line unit outside the table instead of pricing it as NaN", () => {
    const line: PlateLine = {
      name: "sastojci",
      quantity: 4500,
      unit: "g",
      unitPrice: 1000,
      yieldPercent: 100,
    };
    const good: PlateCostInput = { lines: [line], portions: 10, targetFoodCost: 25 };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: PlateCostInput = {
      ...good,
      lines: [{ ...line, unit: "oz" as PlateLine["unit"] }],
    };
    expect(plateCost(bad)).toEqual({ ok: false, reason: "unit" });
    expect(plateCost(good).ok).toBe(true);
  });

  it("usCustomaryUnit refuses a source unit outside the table instead of throwing inside sourceDimension", () => {
    const good: UsUnitInput = { value: 2, from: "usCupLegal", to: "ml" };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: UsUnitInput = { ...good, from: "cup" as UsUnitInput["from"] };
    expect(usCustomaryUnit(bad)).toEqual({ ok: false, reason: "from" });
    expect(usCustomaryUnit(good).ok).toBe(true);
  });

  it("usCustomaryUnit refuses a target unit outside the table rather than reading it as millilitres", () => {
    const good: UsUnitInput = { value: 2, from: "usCupLegal", to: "ml" };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: UsUnitInput = { ...good, to: "floz" as UsUnitInput["to"] };
    expect(usCustomaryUnit(bad)).toEqual({ ok: false, reason: "targetUnit" });
    expect(usCustomaryUnit(good).ok).toBe(true);
  });
});
