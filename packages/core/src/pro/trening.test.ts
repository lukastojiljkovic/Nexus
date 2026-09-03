import { describe, expect, it } from "vitest";

import { estimateOneRepMax } from "../fitness/training.js";
import {
  barbellPlateLoading,
  bodyComposition,
  bodyIndices,
  cadenceStride,
  ergSplitWatts,
  heartRateZones,
  intervalSession,
  jumpHeight,
  limbSymmetry,
  oneRepMaxTable,
  runningPace,
  setTempoTut,
  splitSeries,
  sweatRate,
  trainingVolumeLoad,
  weightClassCut,
  type PlateStock,
} from "./trening.js";

/**
 * Every expectation here was worked by hand from the inputs before the code was
 * trusted, and the arithmetic is written into the comments so a reader can check
 * it without running anything. A test whose expected value was copied out of a
 * first run pins the bug as firmly as the behaviour.
 */

/**
 * A BOUNDED inventory fixture, for exercising the pair-count limit — four
 * pairs of each ordinary plate is this fixture's own choice, not the surface
 * default. The surface pre-fills the mass ladder (25/20/15/10/5/2,5/1,25 kg)
 * with every `pairs` field left EMPTY, i.e. unlimited; see the „treats an
 * absent pair count as unlimited" test below for that behaviour on its own.
 */
const STOCKED_GYM: readonly PlateStock[] = [
  { mass: 25, pairs: 4 },
  { mass: 20, pairs: 4 },
  { mass: 15, pairs: 4 },
  { mass: 10, pairs: 4 },
  { mass: 5, pairs: 4 },
  { mass: 2.5, pairs: 4 },
  { mass: 1.25, pairs: 4 },
];

describe("barbellPlateLoading", () => {
  it("hits an exactly reachable target and breaks the two-plate tie toward the heavier plate", () => {
    const load = barbellPlateLoading({
      target: 100,
      bar: 20,
      collar: 0,
      plates: STOCKED_GYM,
    });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    // R = 10000 − 2000 − 0 = 8000 hundredths, so 4000 per side = 40,00 kg.
    // Two-plate candidates: 25+15 and 20+20. Three-plate ones (25+10+5,
    // 20+15+5) lose on rule (2). Between the two, the descending lists
    // [25,15] and [20,20] differ at the first member and 25 > 20.
    expect(load.perSide).toEqual([
      { mass: 25, count: 1 },
      { mass: 15, count: 1 },
    ]);
    expect(load.perSideMass).toBe(40);
    expect(load.plateCount).toBe(2);
    expect(load.achieved).toBe(100);
    expect(load.difference).toBe(0);
    // Echoed straight from the input: 20 kg is an assumption, not a certainty.
    expect(load.bar).toBe(20);
  });

  it("rounds an unreachable target to the closest sum the inventory can build", () => {
    const load = barbellPlateLoading({ target: 102, bar: 20, collar: 0, plates: STOCKED_GYM });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    // R = 8200. Every plate is a multiple of 1,25 kg, so the reachable sums are
    // multiples of 125 hundredths: 4000 misses by |8200 − 8000| = 200 and 4125
    // misses by |8200 − 8250| = 50, so 4125 wins. 41,25 kg = 25 + 15 + 1,25,
    // and 20 + 20 + 1,25 has the same count, so rule (3) picks the 25 again.
    expect(load.perSide).toEqual([
      { mass: 25, count: 1 },
      { mass: 15, count: 1 },
      { mass: 1.25, count: 1 },
    ]);
    expect(load.perSideMass).toBe(41.25);
    expect(load.plateCount).toBe(3);
    // 20 + 2 × 41,25 = 102,50
    expect(load.achieved).toBe(102.5);
    expect(load.difference).toBe(0.5);
  });

  it("breaks a distance tie toward the LIGHTER bar rather than handing over more than asked", () => {
    const load = barbellPlateLoading({
      target: 101.25,
      bar: 20,
      collar: 0,
      plates: STOCKED_GYM,
    });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    // R = 10125 − 2000 = 8125, exactly between 2 × 4000 = 8000 and 2 × 4125 =
    // 8250 — both miss by 125. Rule (1) keeps the smaller per-side sum.
    expect(load.perSideMass).toBe(40);
    expect(load.achieved).toBe(100);
    expect(load.difference).toBe(-1.25);
  });

  it("counts both collars in what the bar already weighs", () => {
    const load = barbellPlateLoading({ target: 102.5, bar: 20, collar: 2.5, plates: STOCKED_GYM });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    // R = 10250 − 2000 − 2 × 250 = 7750, so 3875 per side = 38,75 kg. In units
    // of 1,25 kg that is 31, and no three plates reach 31 (20+8+2+1 is the
    // shortest at four), so the answer is 25 + 10 + 2,5 + 1,25.
    expect(load.perSide).toEqual([
      { mass: 25, count: 1 },
      { mass: 10, count: 1 },
      { mass: 2.5, count: 1 },
      { mass: 1.25, count: 1 },
    ]);
    expect(load.achieved).toBe(102.5);
    expect(load.difference).toBe(0);
  });

  it("answers with an empty bar when there are no plates at all", () => {
    const load = barbellPlateLoading({ target: 30, bar: 20, collar: 0, plates: [] });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.perSide).toEqual([]);
    expect(load.plateCount).toBe(0);
    expect(load.achieved).toBe(20);
    expect(load.difference).toBe(-10);
  });

  it("treats an absent pair count as unlimited, unlike an explicit zero", () => {
    // Same target as the very first test (100 kg → 40,00 kg/side, 25 + 15), but
    // every stock's `pairs` field is left out instead of set to 4. If an absent
    // count were read as `0` — the only value an empty surface field could
    // otherwise send — every plate would silently drop out of the inventory.
    const unlimited = STOCKED_GYM.map(({ mass }) => ({ mass }));
    const load = barbellPlateLoading({ target: 100, bar: 20, collar: 0, plates: unlimited });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.perSide).toEqual([
      { mass: 25, count: 1 },
      { mass: 15, count: 1 },
    ]);
    expect(load.achieved).toBe(100);

    // `pairs: 0` still means "none of this plate": with every ordinary plate
    // excluded and only 1,25 kg left unlimited, 40,00 kg per side is still
    // exactly reachable (32 × 1,25 kg), just entirely out of the small plate.
    const onlyFractional = barbellPlateLoading({
      target: 100,
      bar: 20,
      collar: 0,
      plates: [
        { mass: 25, pairs: 0 },
        { mass: 20, pairs: 0 },
        { mass: 15, pairs: 0 },
        { mass: 10, pairs: 0 },
        { mass: 5, pairs: 0 },
        { mass: 2.5, pairs: 0 },
        { mass: 1.25 },
      ],
    });
    expect(onlyFractional.ok).toBe(true);
    if (!onlyFractional.ok) return;
    expect(onlyFractional.perSideMass).toBe(40);
    expect(onlyFractional.plateCount).toBe(32);
  });

  it("refuses a target the bar and its collars already exceed", () => {
    // 1500 − 2000 = −500: the request is lighter than the bar, and every answer
    // to it would be a lie.
    expect(barbellPlateLoading({ target: 15, bar: 20, collar: 0, plates: STOCKED_GYM })).toEqual({
      ok: false,
      reason: "belowBar",
    });
  });

  it("refuses an inventory too fine for the target with its own reason, distinct from a bad row", () => {
    // Every plate down to 0,5 kg, unlimited pairs, at a 500 kg target: the DP's
    // state space crosses MAX_PLATE_OPERATIONS well before any row is
    // individually invalid, so the refusal must say "tooManyOperations" and not
    // "plates" — every row here is a perfectly ordinary plate.
    const fineInventory: readonly PlateStock[] = [
      { mass: 25 },
      { mass: 20 },
      { mass: 15 },
      { mass: 10 },
      { mass: 5 },
      { mass: 2.5 },
      { mass: 1.25 },
      { mass: 1 },
      { mass: 0.5 },
    ];
    expect(
      barbellPlateLoading({ target: 500, bar: 20, collar: 0, plates: fineInventory }),
    ).toEqual({ ok: false, reason: "tooManyOperations" });
  });

  it("refuses rather than repairs a bad target, bar, collar or inventory row", () => {
    expect(barbellPlateLoading({ target: 0, bar: 20, collar: 0, plates: STOCKED_GYM })).toEqual({
      ok: false,
      reason: "target",
    });
    expect(barbellPlateLoading({ target: 100, bar: -1, collar: 0, plates: STOCKED_GYM })).toEqual({
      ok: false,
      reason: "bar",
    });
    expect(
      barbellPlateLoading({ target: 100, bar: 20, collar: Number.NaN, plates: STOCKED_GYM }),
    ).toEqual({ ok: false, reason: "collar" });
    expect(
      barbellPlateLoading({ target: 100, bar: 20, collar: 0, plates: [{ mass: 0, pairs: 4 }] }),
    ).toEqual({ ok: false, reason: "plates" });
    expect(
      barbellPlateLoading({ target: 100, bar: 20, collar: 0, plates: [{ mass: 20, pairs: 1.5 }] }),
    ).toEqual({ ok: false, reason: "plates" });
  });
});

describe("bodyComposition", () => {
  it("holds lean mass constant and reports what the body would weigh at the target", () => {
    const result = bodyComposition({ mass: 90, bodyFat: 20, target: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 90 × 0,20 = 18,00 fat; 90 − 18 = 72,00 lean.
    expect(result.fatMass).toBeCloseTo(18, 10);
    expect(result.leanMass).toBeCloseTo(72, 10);
    // 72/0,88 = 81,818181…
    expect(result.targetMass).toBeCloseTo(81.818182, 6);
    // 81,818181… − 90 = −8,181818…
    expect(result.change).toBeCloseTo(-8.181818, 6);
    // 72 × 0,12/0,88 = 8,64/0,88 = 9,818181…
    expect(result.targetFatMass).toBeCloseTo(9.818182, 6);
  });

  it("works the same identity for a smaller cut", () => {
    const result = bodyComposition({ mass: 60, bodyFat: 25, target: 22 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fatMass).toBeCloseTo(15, 10);
    expect(result.leanMass).toBeCloseTo(45, 10);
    // 45/0,78 = 57,692307…
    expect(result.targetMass).toBeCloseTo(57.692308, 6);
    expect(result.change).toBeCloseTo(-2.307692, 6);
    // 57,692307… × 0,22 = 12,692307…
    expect(result.targetFatMass).toBeCloseTo(12.692308, 6);
  });

  it("reports a gain with a positive sign when the target is above the measurement", () => {
    const result = bodyComposition({ mass: 80, bodyFat: 10, target: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // lean 72; 72/0,85 = 84,705882…, so the body gains 4,705882 kg.
    expect(result.targetMass).toBeCloseTo(84.705882, 6);
    expect(result.change).toBeCloseTo(4.705882, 6);
  });

  it("accepts a measured or a target percentage of exactly zero, allowed since neither divides by it", () => {
    // 80 kg at 0 % fat: fat 0,00, lean 80,00; target 20 % → 80/0,80 = 100,00 kg.
    const measured = bodyComposition({ mass: 80, bodyFat: 0, target: 20 });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.fatMass).toBe(0);
    expect(measured.leanMass).toBe(80);
    expect(measured.targetMass).toBeCloseTo(100, 9);
    expect(measured.change).toBeCloseTo(20, 9);

    // 80 kg at 20 % fat: fat 16,00, lean 64,00; target 0 % → 64/1 = 64,00 kg.
    const target = bodyComposition({ mass: 80, bodyFat: 20, target: 0 });
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.targetMass).toBeCloseTo(64, 9);
    expect(target.change).toBeCloseTo(-16, 9);
    expect(target.targetFatMass).toBe(0);
  });

  it("refuses a negative percentage and a percentage of exactly 100 instead of dividing by zero", () => {
    expect(bodyComposition({ mass: 0, bodyFat: 20, target: 12 })).toEqual({
      ok: false,
      reason: "mass",
    });
    expect(bodyComposition({ mass: 90, bodyFat: -1, target: 12 })).toEqual({
      ok: false,
      reason: "bodyFat",
    });
    expect(bodyComposition({ mass: 90, bodyFat: 100, target: 12 })).toEqual({
      ok: false,
      reason: "bodyFat",
    });
    // At a target of 100 % the denominator is zero and the mass is infinite.
    expect(bodyComposition({ mass: 90, bodyFat: 20, target: 100 })).toEqual({
      ok: false,
      reason: "target",
    });
    expect(bodyComposition({ mass: 90, bodyFat: 20, target: -1 })).toEqual({
      ok: false,
      reason: "target",
    });
  });
});

describe("bodyIndices", () => {
  it("computes four numbers and not one category", () => {
    const result = bodyIndices({ mass: 82, height: 178, waist: 88, hip: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1,78² = 3,1684 → 82/3,1684 = 25,88057
    expect(result.bmi).toBeCloseTo(25.880571, 6);
    // 1,78³ = 5,639752 → 82/5,639752 = 14,539646
    expect(result.ponderal).toBeCloseTo(14.539646, 6);
    // 88/178 = 0,494382 — both in centimetres, so the ratio is unit-free.
    expect(result.waistToHeight).toBeCloseTo(0.494382, 6);
    expect(result.waistToHip).toBeCloseTo(0.88, 10);
  });

  it("omits the waist rows entirely when the waist was not measured", () => {
    const result = bodyIndices({ mass: 55, height: 162 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1,62² = 2,6244 → 55/2,6244 = 20,957171
    expect(result.bmi).toBeCloseTo(20.957171, 6);
    // 1,62³ = 4,251528 → 55/4,251528 = 12,936525 (not …526 — the original
    // comment's manual division rounded up one digit early)
    expect(result.ponderal).toBeCloseTo(12.936525, 6);
    expect(result.waistToHeight).toBeUndefined();
    expect(result.waistToHip).toBeUndefined();
  });

  it("gives waist ÷ height without a hip, because that ratio needs only two numbers", () => {
    const result = bodyIndices({ mass: 82, height: 178, waist: 88 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waistToHeight).toBeCloseTo(0.494382, 6);
    expect(result.waistToHip).toBeUndefined();
  });

  it("refuses a non-positive measurement of any of the four", () => {
    expect(bodyIndices({ mass: 0, height: 178 })).toEqual({ ok: false, reason: "mass" });
    expect(bodyIndices({ mass: 82, height: 0 })).toEqual({ ok: false, reason: "height" });
    expect(bodyIndices({ mass: 82, height: 178, waist: 0 })).toEqual({
      ok: false,
      reason: "waist",
    });
    expect(bodyIndices({ mass: 82, height: 178, waist: 88, hip: -1 })).toEqual({
      ok: false,
      reason: "hip",
    });
  });
});

describe("cadenceStride", () => {
  it("derives the speed from cadence and step length", () => {
    const result = cadenceStride({ cadence: 180, stepLength: 1.1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 180 × 1,10/60 = 198/60 = 3,30 m/s
    expect(result.speedMps).toBeCloseTo(3.3, 10);
    // 3,30 × 3,6 = 11,88 km/h
    expect(result.speedKmh).toBeCloseTo(11.88, 10);
    // 1000/3,30 = 303,0303 s/km = 5:03
    expect(result.pacePerKm).toBeCloseTo(303.030303, 6);
    // 1000/1,10 = 909,0909 steps
    expect(result.stepsPerKm).toBeCloseTo(909.090909, 6);
  });

  it("derives the step length from a pace and a cadence", () => {
    const result = cadenceStride({ cadence: 170, speed: { unit: "pacePerKm", value: 240 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 4:00/km = 240 s → 1000/240 = 4,166667 m/s = 15,00 km/h
    expect(result.speedMps).toBeCloseTo(4.166667, 6);
    expect(result.speedKmh).toBeCloseTo(15, 10);
    // 60 × 4,166667/170 = 250/170 = 1,470588 m per SINGLE step
    expect(result.stepLength).toBeCloseTo(1.470588, 6);
    // 1000/(25/17) = 17000/25 = 680 exactly
    expect(result.stepsPerKm).toBeCloseTo(680, 9);
  });

  it("derives the cadence, and reads km/h as the same speed the m/s field would", () => {
    const result = cadenceStride({ stepLength: 1.1, speed: { unit: "kmh", value: 11.88 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 11,88/3,6 = 3,30 m/s → 60 × 3,30/1,10 = 180 steps per minute
    expect(result.speedMps).toBeCloseTo(3.3, 10);
    expect(result.cadence).toBeCloseTo(180, 9);
  });

  it("refuses unless exactly one of the three fields is empty", () => {
    expect(
      cadenceStride({ cadence: 180, stepLength: 1.1, speed: { unit: "mps", value: 3.3 } }),
    ).toEqual({ ok: false, reason: "fields" });
    expect(cadenceStride({ cadence: 180 })).toEqual({ ok: false, reason: "fields" });
    expect(cadenceStride({})).toEqual({ ok: false, reason: "fields" });
  });

  it("refuses a non-positive cadence, step length or speed", () => {
    expect(cadenceStride({ cadence: 0, stepLength: 1.1 })).toEqual({
      ok: false,
      reason: "cadence",
    });
    expect(cadenceStride({ cadence: 180, stepLength: -1 })).toEqual({
      ok: false,
      reason: "stepLength",
    });
    expect(cadenceStride({ cadence: 180, speed: { unit: "mps", value: 0 } })).toEqual({
      ok: false,
      reason: "speed",
    });
  });
});

describe("ergSplitWatts", () => {
  it("turns a 2:00 split into the watts the published relation gives", () => {
    const result = ergSplitWatts({ split: 120, distance: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 120/500 = 0,2400 s/m; 0,24³ = 0,013824; 2,80/0,013824 = 2800000/13824
    expect(result.pace).toBeCloseTo(0.24, 10);
    expect(result.power).toBeCloseTo(202.546296, 6);
    // 2000 × 0,2400 = 480,0 s = 8:00,0
    expect(result.projected).toBeCloseTo(480, 9);
    expect(result.split).toBeCloseTo(120, 9);
    // Echoed constants — the only trace this is a manufacturer's relation.
    expect(result.coefficient).toBe(2.8);
    expect(result.referenceMetres).toBe(500);
  });

  it("inverts the relation on the positive real branch of the cube root", () => {
    const result = ergSplitWatts({ power: 300, distance: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // pace³ = 2,80/300 = 0,00933333; pace = 0,21054532 (0,21054532³ = 0,0093333)
    expect(result.pace).toBeCloseTo(0.2105453, 6);
    // 500 × 0,21054532 = 105,27266 s = 1:45,3
    expect(result.split).toBeCloseTo(105.27266, 4);
    // 2000 × 0,21054532 = 421,0906 s = 7:01,1
    expect(result.projected).toBeCloseTo(421.0906, 3);
    // Round-trip: the forward relation gives back the entered power.
    expect(result.power).toBeCloseTo(300, 9);
  });

  it("refuses unless exactly one of split and power is entered", () => {
    expect(ergSplitWatts({ distance: 2000 })).toEqual({ ok: false, reason: "fields" });
    expect(ergSplitWatts({ split: 120, power: 300, distance: 2000 })).toEqual({
      ok: false,
      reason: "fields",
    });
  });

  it("refuses a non-positive distance, split or power", () => {
    expect(ergSplitWatts({ split: 120, distance: 0 })).toEqual({ ok: false, reason: "distance" });
    expect(ergSplitWatts({ split: 0, distance: 2000 })).toEqual({ ok: false, reason: "split" });
    expect(ergSplitWatts({ power: -5, distance: 2000 })).toEqual({ ok: false, reason: "power" });
  });
});

describe("heartRateZones", () => {
  it("gives both methods in whole beats, and they disagree by construction", () => {
    const result = heartRateZones({ hrMax: 190, hrRest: 55, percents: [70] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reserve).toBe(135); // 190 − 55
    // Karvonen: 55 + 0,70 × 135 = 55 + 94,5 = 149,5 → 150 (half up)
    expect(result.rows[0]?.karvonen).toBe(150);
    // Percentage of maximum: 0,70 × 190 = 133 exactly
    expect(result.rows[0]?.percentOfMax).toBe(133);
  });

  it("keeps the two columns apart for a second athlete", () => {
    const result = heartRateZones({ hrMax: 200, hrRest: 60, percents: [85] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reserve).toBe(140); // 200 − 60
    // 60 + 0,85 × 140 = 60 + 119 = 179
    expect(result.rows[0]?.karvonen).toBe(179);
    // 0,85 × 200 = 170
    expect(result.rows[0]?.percentOfMax).toBe(170);
  });

  it("runs a measured rate backwards through both methods", () => {
    const result = heartRateZones({
      hrMax: 190,
      hrRest: 55,
      percents: [],
      measuredHr: 150,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 × (150 − 55)/135 = 9500/135 = 70,370370… (the surface shows 70,4 %)
    expect(result.measuredPercentOfReserve).toBeCloseTo(70.37037, 5);
    // 100 × 150/190 = 15000/190 = 78,947368… (the surface shows 78,9 %)
    expect(result.measuredPercentOfMax).toBeCloseTo(78.947368, 6);
  });

  it("reports a rate below the resting rate as the negative number it is", () => {
    const result = heartRateZones({ hrMax: 190, hrRest: 55, percents: [], measuredHr: 40 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 × (40 − 55)/135 = −1500/135 = −11,111…: clamping this to zero would
    // hide a mistyped resting rate, which is what a negative usually means.
    expect(result.measuredPercentOfReserve).toBeCloseTo(-11.111111, 6);
  });

  it("draws nothing backwards when no rate was measured", () => {
    const result = heartRateZones({ hrMax: 190, hrRest: 55, percents: [50, 100] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.measuredPercentOfReserve).toBeUndefined();
    expect(result.measuredPercentOfMax).toBeUndefined();
    // 55 + 0,50 × 135 = 55 + 67,5 = 122,5 → 123; 0,50 × 190 = 95
    expect(result.rows[0]?.karvonen).toBe(123);
    expect(result.rows[0]?.percentOfMax).toBe(95);
    // At 100 % both methods meet at the maximum itself.
    expect(result.rows[1]?.karvonen).toBe(190);
    expect(result.rows[1]?.percentOfMax).toBe(190);
  });

  it("tabulates the whole arithmetic list the surface pre-fills", () => {
    const percents = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
    const result = heartRateZones({ hrMax: 190, hrRest: 55, percents });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBe(11);
    expect(result.rows.map((row) => row.percent)).toEqual(percents);
  });

  it("defaults to the full 50–100 % ladder in 5-point steps when percents is omitted entirely", () => {
    // The table must be the default output, not something a caller has to ask
    // for — a single row would make this an everyday percentage-plus-addition.
    const result = heartRateZones({ hrMax: 190, hrRest: 55 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.percent)).toEqual([
      50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
    ]);
    // Same arithmetic as the explicit-array test above: 55 + 0,50×135 = 122,5 → 123.
    expect(result.rows[0]?.karvonen).toBe(123);
  });

  it("refuses a maximum that is not above the resting rate, and never derives one from an age", () => {
    expect(heartRateZones({ hrMax: 190, hrRest: 0, percents: [70] })).toEqual({
      ok: false,
      reason: "hrRest",
    });
    expect(heartRateZones({ hrMax: 55, hrRest: 55, percents: [70] })).toEqual({
      ok: false,
      reason: "hrMax",
    });
    expect(heartRateZones({ hrMax: 190.5, hrRest: 55, percents: [70] })).toEqual({
      ok: false,
      reason: "hrMax",
    });
    expect(heartRateZones({ hrMax: 190, hrRest: 55, percents: [101] })).toEqual({
      ok: false,
      reason: "percents",
    });
    expect(heartRateZones({ hrMax: 190, hrRest: 55, percents: [-1] })).toEqual({
      ok: false,
      reason: "percents",
    });
    expect(heartRateZones({ hrMax: 190, hrRest: 55, percents: [], measuredHr: 0 })).toEqual({
      ok: false,
      reason: "measuredHr",
    });
  });
});

describe("intervalSession", () => {
  it("puts the rest between repetitions and keeps warm-up out of the ratio", () => {
    const result = intervalSession({
      work: { kind: "seconds", seconds: 30 },
      rest: { kind: "ratio", work: 1, rest: 2 },
      reps: 6,
      sets: 3,
      restBetweenSets: 180,
      warmup: 600,
      cooldown: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rest).toBe(60); // 30 × 2/1
    // 6 × 30 + 5 × 60 = 180 + 300 = 480 s
    expect(result.setDuration).toBe(480);
    expect(result.setDurationClock).toBe("08:00");
    // 3 × 6 × 30 = 540 s
    expect(result.totalWork).toBe(540);
    expect(result.totalWorkClock).toBe("09:00");
    // 3 × 5 × 60 + 2 × 180 = 900 + 360 = 1260 s — warm-up and cool-down are out.
    expect(result.totalRest).toBe(1260);
    expect(result.totalRestClock).toBe("21:00");
    // 3 × 480 + 2 × 180 + 600 + 300 = 1440 + 360 + 900 = 2700 s
    expect(result.total).toBe(2700);
    expect(result.totalClock).toBe("0:45:00");
    // A typed ratio of 1:2 is echoed exactly by the per-repetition ratio: 60/30 = 2.
    expect(result.repRestRatio).toBeCloseTo(2, 9);
    // 1260/540 = 2,3333… → the surface prints 1:2,33, a DIFFERENT quantity —
    // it also carries the 360 s of between-set rest the typed ratio never saw.
    expect(result.sessionRestRatio).toBeCloseTo(2.333333, 6);
  });

  it("handles a single set with the rest typed in seconds", () => {
    const result = intervalSession({
      work: { kind: "seconds", seconds: 15 },
      rest: { kind: "seconds", seconds: 45 },
      reps: 8,
      sets: 1,
      restBetweenSets: 0,
      warmup: 0,
      cooldown: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 8 × 15 + 7 × 45 = 120 + 315 = 435 s
    expect(result.setDuration).toBe(435);
    expect(result.setDurationClock).toBe("07:15");
    expect(result.totalWork).toBe(120);
    expect(result.totalWorkClock).toBe("02:00");
    // A single set has no between-sets rest, so 1 × 7 × 45 = 315.
    expect(result.totalRest).toBe(315);
    expect(result.totalRestClock).toBe("05:15");
    expect(result.total).toBe(435);
    expect(result.totalClock).toBe("0:07:15");
    // 45/15 = 3,00 for one repetition.
    expect(result.repRestRatio).toBeCloseTo(3, 9);
    // 315/120 = 2,625 → the surface prints 1:2,63 (half up)
    expect(result.sessionRestRatio).toBeCloseTo(2.625, 10);
  });

  it("gives a one-repetition set exactly the work and no rest at all", () => {
    const result = intervalSession({
      work: { kind: "seconds", seconds: 20 },
      rest: { kind: "seconds", seconds: 60 },
      reps: 1,
      sets: 1,
      restBetweenSets: 0,
      warmup: 0,
      cooldown: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reps − 1 = 0, so the rest never lands anywhere.
    expect(result.setDuration).toBe(20);
    expect(result.totalRest).toBe(0);
    expect(result.sessionRestRatio).toBe(0);
  });

  it("absorbs a four-phase tempo as an input mode, forcing the inter-repetition rest to zero", () => {
    // Same numbers as „Tempo serije"'s own first vector: 3-1-1-0, 8 reps, 4
    // sets, 120 s between sets. perRep = 5 s; setDuration = 8×5 = 40 s;
    // totalWork = 4×8×5 = 160 s; totalRest = 4×7×0 + 3×120 = 360 s;
    // total = 4×40 + 3×120 = 160+360 = 520 s — the same block `setTempoTut`
    // reports for the identical input, because both go through `tempoTimeline`.
    const result = intervalSession({
      work: { kind: "tempo", eccentric: 3, pauseBottom: 1, concentric: 1, pauseTop: 0 },
      reps: 8,
      sets: 4,
      restBetweenSets: 120,
      warmup: 0,
      cooldown: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rest).toBe(0);
    expect(result.setDuration).toBe(40);
    expect(result.totalWork).toBe(160);
    expect(result.totalRest).toBe(360);
    expect(result.total).toBe(520);
    expect(result.totalClock).toBe("0:08:40");
    expect(result.repRestRatio).toBe(0);
    // 360/160 = 2,25
    expect(result.sessionRestRatio).toBeCloseTo(2.25, 9);
  });

  it("refuses rather than repairs each bad field", () => {
    const base = {
      work: { kind: "seconds", seconds: 30 } as const,
      rest: { kind: "seconds", seconds: 60 } as const,
      reps: 6,
      sets: 3,
      restBetweenSets: 180,
      warmup: 600,
      cooldown: 300,
    };
    expect(intervalSession({ ...base, work: { kind: "seconds", seconds: 0 } })).toEqual({
      ok: false,
      reason: "work",
    });
    expect(
      intervalSession({
        work: base.work,
        reps: 6,
        sets: 3,
        restBetweenSets: 0,
        warmup: 0,
        cooldown: 0,
      }),
    ).toEqual({ ok: false, reason: "rest" });
    expect(intervalSession({ ...base, reps: 0 })).toEqual({ ok: false, reason: "reps" });
    expect(intervalSession({ ...base, reps: 2.5 })).toEqual({ ok: false, reason: "reps" });
    expect(intervalSession({ ...base, sets: 0 })).toEqual({ ok: false, reason: "sets" });
    expect(intervalSession({ ...base, restBetweenSets: -1 })).toEqual({
      ok: false,
      reason: "restBetweenSets",
    });
    expect(intervalSession({ ...base, warmup: -1 })).toEqual({ ok: false, reason: "warmup" });
    expect(intervalSession({ ...base, cooldown: -1 })).toEqual({ ok: false, reason: "cooldown" });
    expect(intervalSession({ ...base, rest: { kind: "seconds", seconds: -1 } })).toEqual({
      ok: false,
      reason: "rest",
    });
    // A ratio's left member divides; zero there is a division by zero, not „no rest".
    expect(intervalSession({ ...base, rest: { kind: "ratio", work: 0, rest: 2 } })).toEqual({
      ok: false,
      reason: "restRatio",
    });
    expect(intervalSession({ ...base, rest: { kind: "ratio", work: 1, rest: 0 } })).toEqual({
      ok: false,
      reason: "restRatio",
    });
    // All four tempo phases at zero is a repetition of no duration.
    expect(
      intervalSession({
        ...base,
        work: { kind: "tempo", eccentric: 0, pauseBottom: 0, concentric: 0, pauseTop: 0 },
      }),
    ).toEqual({ ok: false, reason: "tempo" });
    expect(
      intervalSession({
        ...base,
        work: { kind: "tempo", eccentric: 1.5, pauseBottom: 0, concentric: 0, pauseTop: 0 },
      }),
    ).toEqual({ ok: false, reason: "tempo" });
  });
});

describe("jumpHeight", () => {
  it("turns a flight time into a height on the symmetric-flight assumption", () => {
    const result = jumpHeight({ flightTime: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // h = g t²/8 = 9,80665 × 0,25/8 = 2,4516625/8 = 0,3064578 m
    expect(result.heightM).toBeCloseTo(0.30645781, 8);
    expect(result.height).toBeCloseTo(30.645781, 6);
    // v = g t/2 = 9,80665 × 0,5/2 = 2,4516625 m/s
    expect(result.takeoff).toBeCloseTo(2.4516625, 7);
    expect(result.rsi).toBeUndefined();
    // The standard-gravity default, echoed so a changed g always leaves a trace.
    expect(result.gravity).toBe(9.80665);
  });

  it("inverts the same relation and adds the reactive strength index", () => {
    const result = jumpHeight({ height: 40, contactTime: 0.18 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // t = √(8 × 0,400/9,80665) = √0,32630919 = 0,57123479 s
    expect(result.flightTime).toBeCloseTo(0.5712348, 7);
    // Backwards: 9,80665 × 0,57123479²/8 = 9,80665 × 0,32630919/8 = 0,400 m
    expect(result.heightM).toBeCloseTo(0.4, 12);
    // v = √(2gh) = √7,84532 = 2,8009498 m/s
    expect(result.takeoff).toBeCloseTo(2.8009498, 6);
    // RSI by the jump-height definition: 0,400/0,180 = 2,2222 m/s
    expect(result.rsi).toBeCloseTo(2.222222, 6);
  });

  it("uses the gravity that was typed, not the standard one", () => {
    const result = jumpHeight({ flightTime: 0.5, gravity: 1.62 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1,62 × 0,25/8 = 0,405/8 = 0,050625 m = 5,0625 cm
    expect(result.height).toBeCloseTo(5.0625, 8);
    expect(result.gravity).toBe(1.62);
  });

  it("refuses unless exactly one of flight time and height is entered", () => {
    expect(jumpHeight({ flightTime: 0.5, height: 40 })).toEqual({ ok: false, reason: "fields" });
    expect(jumpHeight({})).toEqual({ ok: false, reason: "fields" });
  });

  it("refuses a non-positive time, height, gravity or contact time", () => {
    // flightTime is PRESENT (0 !== undefined), so this passes the one-of-two
    // check and fails on the value itself, not on which fields were given.
    expect(jumpHeight({ flightTime: 0 })).toEqual({ ok: false, reason: "flightTime" });
    expect(jumpHeight({ flightTime: -0.5 })).toEqual({ ok: false, reason: "flightTime" });
    expect(jumpHeight({ height: -40 })).toEqual({ ok: false, reason: "height" });
    expect(jumpHeight({ flightTime: 0.5, gravity: 0 })).toEqual({ ok: false, reason: "gravity" });
    expect(jumpHeight({ flightTime: 0.5, contactTime: 0 })).toEqual({
      ok: false,
      reason: "contactTime",
    });
  });
});

describe("limbSymmetry", () => {
  it("reports the ratio and what the tested side needs for the user's own target", () => {
    const result = limbSymmetry({ involved: 42, reference: 55, target: 90, unit: "kg" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 × 42/55 = 76,363636… %
    expect(result.ratio).toBeCloseTo(76.363636, 6);
    expect(result.shortfall).toBeCloseTo(23.636364, 6);
    // 55 × 0,90 = 49,5 kg, which is 7,5 kg above the 42 that was measured.
    expect(result.needed).toBeCloseTo(49.5, 10);
    expect(result.gap).toBeCloseTo(7.5, 10);
    // Passed straight through, untouched — data, not copy authored here.
    expect(result.unit).toBe("kg");
  });

  it("leaves the unit undefined when none was typed, rather than inventing one", () => {
    const result = limbSymmetry({ involved: 42, reference: 55, target: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unit).toBeUndefined();
  });

  it("treats centimetres exactly as it treats kilograms — the unit is never converted", () => {
    const result = limbSymmetry({ involved: 168, reference: 175, target: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 168/175 = 0,96 exactly
    expect(result.ratio).toBeCloseTo(96, 10);
    expect(result.shortfall).toBeCloseTo(4, 10);
    expect(result.needed).toBeCloseTo(175, 10);
    expect(result.gap).toBeCloseTo(7, 10);
  });

  it("signs the shortfall and the gap when the tested side is the stronger one", () => {
    const result = limbSymmetry({ involved: 60, reference: 55, target: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 × 60/55 = 109,0909 %, so the „shortfall" is −9,0909 and the gap −5.
    expect(result.ratio).toBeCloseTo(109.090909, 6);
    expect(result.shortfall).toBeCloseTo(-9.090909, 6);
    expect(result.gap).toBeCloseTo(-5, 10);
  });

  it("accepts a tested side of zero — an absent effort is a measurement", () => {
    const result = limbSymmetry({ involved: 0, reference: 55, target: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBe(0);
    expect(result.shortfall).toBe(100);
  });

  it("refuses a negative tested side, a non-positive reference and a non-positive target", () => {
    expect(limbSymmetry({ involved: -1, reference: 55, target: 90 })).toEqual({
      ok: false,
      reason: "involved",
    });
    expect(limbSymmetry({ involved: 42, reference: 0, target: 90 })).toEqual({
      ok: false,
      reason: "reference",
    });
    // No threshold is embedded anywhere, so an absent one has nothing to fall back on.
    expect(limbSymmetry({ involved: 42, reference: 55, target: 0 })).toEqual({
      ok: false,
      reason: "target",
    });
  });
});

describe("oneRepMaxTable", () => {
  it("reports both published estimates and builds a uniform 5 % ladder from the unrounded one", () => {
    const result = oneRepMaxTable({ load: 100, reps: 5, formula: "epley", step: 2.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Epley: 100 × (1 + 5/30) = 100 × 35/30 = 116,666…
    expect(result.epley).toBeCloseTo(116.666667, 6);
    // Brzycki: 100 × 36/(37 − 5) = 3600/32 = 112,5 exactly
    expect(result.brzycki).toBeCloseTo(112.5, 10);
    expect(result.base).toBeCloseTo(116.666667, 6);
    expect(result.rows.length).toBe(11);
    expect(result.rows.map((row) => row.percent)).toEqual([
      100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50,
    ]);
    // 90 %: exactly 105,000 → n = ceil(622500000/15000000) = ceil(41,5) = 42
    expect(result.rows[2]?.exact).toBeCloseTo(105, 9);
    expect(result.rows[2]?.loadable).toBeCloseTo(105, 10);
    // 85 %: 99,1667 → ceil(39,1667) = 40 → 100,0 (0,833 away, against 1,667)
    expect(result.rows[3]?.exact).toBeCloseTo(99.166667, 6);
    expect(result.rows[3]?.loadable).toBeCloseTo(100, 10);
    // 80 %: 93,3333 → ceil(36,8333) = 37 → 92,5
    expect(result.rows[4]?.exact).toBeCloseTo(93.333333, 6);
    expect(result.rows[4]?.loadable).toBeCloseTo(92.5, 10);
    // 75 %: 350000 × 750/3000000 = 87,5 exactly → 87,5/2,5 = 35 exactly, no tie.
    expect(result.rows[5]?.exact).toBeCloseTo(87.5, 9);
    expect(result.rows[5]?.loadable).toBeCloseTo(87.5, 10);
    // 70 %: 350000 × 700/3000000 = 81,6667 → nearest of 80/82,5 is 82,5 (0,833 < 1,667)
    expect(result.rows[6]?.exact).toBeCloseTo(81.666667, 6);
    expect(result.rows[6]?.loadable).toBeCloseTo(82.5, 10);
    // 65 %: 75,8333 → nearest of 75/77,5 is 75 (0,833 < 1,667)
    expect(result.rows[7]?.exact).toBeCloseTo(75.833333, 6);
    expect(result.rows[7]?.loadable).toBeCloseTo(75, 10);
    // 60 %: 70,0 exactly, already a multiple of 2,5.
    expect(result.rows[8]?.exact).toBeCloseTo(70, 9);
    expect(result.rows[8]?.loadable).toBeCloseTo(70, 10);
    // 55 %: 64,1667 → nearest of 62,5/65 is 65 (0,833 < 1,667)
    expect(result.rows[9]?.exact).toBeCloseTo(64.166667, 6);
    expect(result.rows[9]?.loadable).toBeCloseTo(65, 10);
    // 50 %: 58,3333 → nearest of 57,5/60 is 57,5 (0,833 < 1,667)
    expect(result.rows[10]?.exact).toBeCloseTo(58.333333, 6);
    expect(result.rows[10]?.loadable).toBeCloseTo(57.5, 10);
  });

  it("inserts a customPercent into the ladder at its sorted position, resolved to the same tenth-percent precision", () => {
    // Reproduces the OLD 77,5 % row exactly, now as a user-chosen extra rather
    // than a built-in step: 350000×775/3000000 = 90,4167 → 90,0 is 0,417 away,
    // 92,5 is 2,083 away, so 90,0 wins — ceil((2×350000×775 − 7500000)/15000000)
    // = ceil(535000000/15000000) = ceil(35,6667) = 36 → 36×2,5 = 90,0.
    const result = oneRepMaxTable({
      load: 100,
      reps: 5,
      formula: "epley",
      step: 2.5,
      customPercent: 77.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBe(12);
    // Sorted in with the rest, descending: 80, then 77,5, then 75.
    expect(result.rows.map((row) => row.percent)).toEqual([
      100, 95, 90, 85, 80, 77.5, 75, 70, 65, 60, 55, 50,
    ]);
    expect(result.rows[5]?.percent).toBe(77.5);
    expect(result.rows[5]?.exact).toBeCloseTo(90.416667, 6);
    expect(result.rows[5]?.loadable).toBeCloseTo(90, 10);
  });

  it("does not duplicate a customPercent that already sits on the uniform ladder", () => {
    const result = oneRepMaxTable({
      load: 100,
      reps: 5,
      formula: "epley",
      step: 2.5,
      customPercent: 80,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBe(11);
  });

  it("meets both formulas at ten repetitions, where 4/3 is the same in each", () => {
    const result = oneRepMaxTable({ load: 60, reps: 10, formula: "epley", step: 2.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 60 × 40/30 = 80 and 60 × 36/27 = 80 — both are 60 × 4/3.
    expect(result.epley).toBeCloseTo(80, 9);
    expect(result.brzycki).toBeCloseTo(80, 9);
    // 90 % = 72,000 exactly → ceil(424500000/15000000) = ceil(28,3) = 29 → 72,5
    expect(result.rows[2]?.exact).toBeCloseTo(72, 9);
    expect(result.rows[2]?.loadable).toBeCloseTo(72.5, 10);
  });

  it("holds a completed single at the entered load instead of Epley's 31/30", () => {
    const result = oneRepMaxTable({ load: 140, reps: 1, formula: "epley", step: 2.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Epley's raw value would be 140 × 31/30 = 144,667, which reports a single
    // as 3,33 % below maximum. Both estimators return the entered load instead.
    expect(result.epley).toBe(140);
    expect(result.brzycki).toBe(140);
    expect(result.base).toBe(140);
    expect(result.rows[0]?.loadable).toBeCloseTo(140, 10);
  });

  it("resolves an exact half-step DOWN to the lighter bar", () => {
    const result = oneRepMaxTable({
      load: 100,
      reps: 5,
      formula: "epley",
      step: 5,
      known1Rm: 110,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Base 110 from the measured maximum, so neither formula feeds the table.
    expect(result.base).toBeCloseTo(110, 10);
    // 75 % of 110 = 82,5, exactly between 80 and 85. n = ceil(82,5/5 − ½) =
    // ceil(16) = 16 → 80,0. Decided on integers: 16000000/1000000 is exactly 16.
    // The uniform 11-row ladder puts 75 % at index 5 (100,95,90,85,80,75,…).
    expect(result.rows[5]?.percent).toBe(75);
    expect(result.rows[5]?.exact).toBeCloseTo(82.5, 10);
    expect(result.rows[5]?.loadable).toBeCloseTo(80, 10);
    // 100 %: ceil(21,5) = 22 → 110,0
    expect(result.rows[0]?.loadable).toBeCloseTo(110, 10);
    // The formulas are still reported beside the measured maximum.
    expect(result.epley).toBeCloseTo(116.666667, 6);
  });

  it("builds the table from Brzycki when Brzycki is chosen", () => {
    const result = oneRepMaxTable({ load: 100, reps: 5, formula: "brzycki", step: 2.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base).toBeCloseTo(112.5, 10);
    // 100 % of 112,5 is a multiple of 2,5, so it lands on itself: ceil(44,5) = 45.
    expect(result.rows[0]?.loadable).toBeCloseTo(112.5, 10);
  });

  it("refuses above ten repetitions rather than extrapolating a fitted formula", () => {
    // At 20 reps Epley says 1,667w and Brzycki 2,118w, and Brzycki's denominator
    // reaches zero at 37 — a number produced there would look as authoritative
    // as one produced at five.
    expect(oneRepMaxTable({ load: 100, reps: 11, formula: "epley", step: 2.5 })).toEqual({
      ok: false,
      reason: "reps",
    });
    expect(oneRepMaxTable({ load: 100, reps: 0, formula: "epley", step: 2.5 })).toEqual({
      ok: false,
      reason: "reps",
    });
    expect(oneRepMaxTable({ load: 100, reps: 2.5, formula: "epley", step: 2.5 })).toEqual({
      ok: false,
      reason: "reps",
    });
  });

  it("refuses a non-positive load, step or measured maximum", () => {
    expect(oneRepMaxTable({ load: 0, reps: 5, formula: "epley", step: 2.5 })).toEqual({
      ok: false,
      reason: "load",
    });
    expect(oneRepMaxTable({ load: 100, reps: 5, formula: "epley", step: 0 })).toEqual({
      ok: false,
      reason: "step",
    });
    expect(
      oneRepMaxTable({ load: 100, reps: 5, formula: "epley", step: 2.5, known1Rm: 0 }),
    ).toEqual({ ok: false, reason: "known1Rm" });
  });

  it("refuses a non-positive customPercent and one far past any real programme", () => {
    expect(
      oneRepMaxTable({ load: 100, reps: 5, formula: "epley", step: 2.5, customPercent: 0 }),
    ).toEqual({ ok: false, reason: "customPercent" });
    // Every other multiplicand in this function is bounded by MAX_KG; customPercent
    // was the one unbounded one. 1e17 used to slip through and land two different
    // nonsense `loadable` figures on the same unrounded `exact` value — neither
    // refused — because 2 × baseNum × tenths stopped being an exact integer.
    expect(
      oneRepMaxTable({ load: 100, reps: 5, formula: "epley", step: 2.5, customPercent: 1e17 }),
    ).toEqual({ ok: false, reason: "customPercent" });
  });

  it("pins the table's exact-rational base to what estimateOneRepMax returns for the same formula", () => {
    // The table's base is the exact fraction 350000/(30×100) = 350000/3000 =
    // 116,66666666666667, and estimateOneRepMax computes the same figure as
    // 100×(1+5/30) — a different expression that IEEE754 double arithmetic
    // happens to round to the identical bit pattern, which is exactly the
    // agreement this test exists to pin so a future edit to either side cannot
    // move one by even 1 ulp without turning this red.
    const epley = oneRepMaxTable({ load: 100, reps: 5, formula: "epley", step: 2.5 });
    expect(epley.ok).toBe(true);
    if (!epley.ok) return;
    expect(epley.base).toBe(estimateOneRepMax(100, 5, "epley")?.kg);

    // Brzycki: 360000/(32×100) = 3600/32 = 112,5 exactly, same as 100×36/32.
    const brzycki = oneRepMaxTable({ load: 100, reps: 5, formula: "brzycki", step: 2.5 });
    expect(brzycki.ok).toBe(true);
    if (!brzycki.ok) return;
    expect(brzycki.base).toBe(estimateOneRepMax(100, 5, "brzycki")?.kg);
  });
});

describe("runningPace", () => {
  it("derives the pace and a split table whose last row is the entered time exactly", () => {
    const result = runningPace({
      distance: { unit: "km", value: 10 },
      time: 2550,
      splitStep: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBe(10000);
    // 1000 × 2550/10000 = 255 s = 4:15/km
    expect(result.pacePerKm).toBeCloseTo(255, 9);
    // 1609,344 × 2550/10000 = 410,38272 s → 6:50/mile at whole seconds
    expect(result.pacePerMile).toBeCloseTo(410.38272, 5);
    // 100 × 2550/10000 = 25,5 s per 100 m
    expect(result.pacePer100m).toBeCloseTo(25.5, 9);
    // 10000/2550 = 3,921569 m/s; × 3,6 = 14,117647 km/h
    expect(result.speedMps).toBeCloseTo(3.921569, 6);
    expect(result.speedKmh).toBeCloseTo(14.117647, 6);
    expect(result.splits.length).toBe(10);
    expect(result.splits.map((split) => split.seconds)).toEqual([
      255, 510, 765, 1020, 1275, 1530, 1785, 2040, 2295, 2550,
    ]);
    expect(result.splits[0]?.clock).toBe("0:04:15");
    // The last row is the entered time itself, not an accumulation of roundings.
    expect(result.splits[9]?.distance).toBe(10000);
    expect(result.splits[9]?.clock).toBe("0:42:30");
  });

  it("splits a 1500 m in hundreds and still ends on the typed time", () => {
    const result = runningPace({
      distance: { unit: "m", value: 1500 },
      time: 1100,
      splitStep: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 × 1100/1500 = 73,3333 s per 100 m; 1000 × 1100/1500 = 733,3333 s/km
    expect(result.pacePer100m).toBeCloseTo(73.333333, 6);
    expect(result.pacePerKm).toBeCloseTo(733.333333, 6);
    // 3,6 × 1500/1100 = 4,909091 km/h; 1500/1100 = 1,363636 m/s
    expect(result.speedKmh).toBeCloseTo(4.909091, 6);
    expect(result.speedMps).toBeCloseTo(1.363636, 6);
    expect(result.splits.length).toBe(15);
    expect(result.splits[14]?.seconds).toBeCloseTo(1100, 9);
    expect(result.splits[14]?.clock).toBe("0:18:20");
  });

  it("keeps the short last row when the step does not divide the distance", () => {
    const result = runningPace({
      distance: { unit: "m", value: 42195 },
      time: 10800,
      splitStep: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ceil(42,195) = 43 rows, the last covering the 195 m fragment.
    expect(result.splits.length).toBe(43);
    expect(result.splits[42]?.distance).toBe(42195);
    expect(result.splits[42]?.seconds).toBeCloseTo(10800, 9);
  });

  it("computes the missing distance, and the missing time, from a pace", () => {
    const fromPace = runningPace({
      time: 2550,
      pace: { unit: "perKm", seconds: 255 },
      splitStep: 1000,
    });
    expect(fromPace.ok).toBe(true);
    if (!fromPace.ok) return;
    // d = 1000 × 2550/255 = 10000 m
    expect(fromPace.distance).toBeCloseTo(10000, 6);
    // This is the one path where `distance` is a float PRODUCT rather than a
    // typed value, so it is the row count — not just the distance — that has
    // to be checked here.
    expect(fromPace.splits.length).toBe(10);

    const fromDistance = runningPace({
      distance: { unit: "km", value: 10 },
      pace: { unit: "perKm", seconds: 255 },
      splitStep: 1000,
    });
    expect(fromDistance.ok).toBe(true);
    if (!fromDistance.ok) return;
    // t = 10000 × 255/1000 = 2550 s
    expect(fromDistance.time).toBeCloseTo(2550, 6);
  });

  it("does not invent an extra split row from a derived distance's ulp overshoot", () => {
    // 229 s/km held for 2290 s is exactly 10000 m by hand: 1000 × 2290/229 = 10000.
    // In floating point, paceSpeedMps (1000/229) × 2290 lands one ulp OVER 10000
    // (10000,000000000002), so Math.ceil(metres/1000) alone gives 11 rows and a
    // final pair that both format as 0:38:10 — one at 10000 m, a ghost one just
    // past it. The fix must snap that back down to the true 10 rows.
    const result = runningPace({
      time: 2290,
      pace: { unit: "perKm", seconds: 229 },
      splitStep: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.splits.length).toBe(10);
    expect(result.splits[9]?.distance).toBeCloseTo(10000, 6);
    expect(result.splits[9]?.clock).toBe("0:38:10");
  });

  it("reads a mile as 1609,344 m exactly, by the 1959 yard definition", () => {
    const result = runningPace({
      distance: { unit: "mile", value: 1 },
      time: 300,
      splitStep: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBeCloseTo(1609.344, 9);
    // A mile in 300 s is a mile pace of exactly 300 s.
    expect(result.pacePerMile).toBeCloseTo(300, 9);
  });

  it("refuses unless exactly one of distance, time and pace is empty", () => {
    expect(
      runningPace({
        distance: { unit: "km", value: 10 },
        time: 2550,
        pace: { unit: "perKm", seconds: 255 },
        splitStep: 1000,
      }),
    ).toEqual({ ok: false, reason: "fields" });
    expect(runningPace({ time: 2550, splitStep: 1000 })).toEqual({ ok: false, reason: "fields" });
  });

  it("refuses a non-positive field and a step that would produce thousands of rows", () => {
    expect(
      runningPace({ distance: { unit: "km", value: 0 }, time: 2550, splitStep: 1000 }),
    ).toEqual({ ok: false, reason: "distance" });
    expect(
      runningPace({ distance: { unit: "km", value: 10 }, time: 0, splitStep: 1000 }),
    ).toEqual({ ok: false, reason: "time" });
    expect(
      runningPace({
        distance: { unit: "km", value: 10 },
        pace: { unit: "perKm", seconds: 0 },
        splitStep: 1000,
      }),
    ).toEqual({ ok: false, reason: "pace" });
    expect(runningPace({ distance: { unit: "km", value: 10 }, time: 2550, splitStep: 0 })).toEqual({
      ok: false,
      reason: "step",
    });
    // 10 km in one-metre steps is 10 000 rows; the tool refuses instead.
    expect(runningPace({ distance: { unit: "km", value: 10 }, time: 2550, splitStep: 1 })).toEqual({
      ok: false,
      reason: "tooManyRows",
    });
  });
});

describe("setTempoTut", () => {
  it("sums the four phases and puts the rest between the sets", () => {
    const result = setTempoTut({
      eccentric: 3,
      pauseBottom: 1,
      concentric: 1,
      pauseTop: 0,
      reps: 8,
      sets: 4,
      restBetweenSets: 120,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perRep).toBe(5); // 3 + 1 + 1 + 0
    expect(result.tutPerSet).toBe(40); // 8 × 5
    expect(result.tutPerSetClock).toBe("00:40");
    expect(result.totalTut).toBe(160); // 4 × 40
    expect(result.totalTutClock).toBe("02:40");
    // 4 × 40 + 3 × 120 = 160 + 360 = 520 s
    expect(result.block).toBe(520);
    // block is h:mm:ss (unlike tutPerSet/totalTut above), so 520 s reads 0:08:40.
    expect(result.blockClock).toBe("0:08:40");
  });

  it("works the same for a slower tempo", () => {
    const result = setTempoTut({
      eccentric: 4,
      pauseBottom: 2,
      concentric: 1,
      pauseTop: 1,
      reps: 6,
      sets: 3,
      restBetweenSets: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perRep).toBe(8);
    expect(result.tutPerSet).toBe(48); // 6 × 8
    expect(result.tutPerSetClock).toBe("00:48");
    expect(result.totalTut).toBe(144); // 3 × 48
    expect(result.totalTutClock).toBe("02:24");
    // 3 × 48 + 2 × 90 = 144 + 180 = 324 s
    expect(result.block).toBe(324);
    expect(result.blockClock).toBe("0:05:24");
  });

  it("gives a single set no trailing rest", () => {
    const result = setTempoTut({
      eccentric: 3,
      pauseBottom: 1,
      concentric: 1,
      pauseTop: 0,
      reps: 8,
      sets: 1,
      restBetweenSets: 120,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).toBe(40);
  });

  it("grows the minute field past sixty rather than inventing an hour", () => {
    const result = setTempoTut({
      eccentric: 3,
      pauseBottom: 1,
      concentric: 1,
      pauseTop: 0,
      reps: 30,
      sets: 30,
      restBetweenSets: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 30 × 5 = 150 s per set; 30 × 150 = 4500 s = 75 minutes.
    expect(result.totalTut).toBe(4500);
    expect(result.totalTutClock).toBe("75:00");
    // restBetweenSets is 0, so block equals totalTut exactly — 4500 s — but the
    // SAME number reads "75:00" under totalTutClock's mm:ss and "1:15:00" under
    // blockClock's h:mm:ss, which is precisely the mismatch this pair guards.
    expect(result.block).toBe(4500);
    expect(result.blockClock).toBe("1:15:00");
  });

  it("refuses a fractional or negative phase, an „X“ that never became a number, and bad counts", () => {
    const base = {
      eccentric: 3,
      pauseBottom: 1,
      concentric: 1,
      pauseTop: 0,
      reps: 8,
      sets: 4,
      restBetweenSets: 120,
    };
    expect(setTempoTut({ ...base, eccentric: -1 })).toEqual({ ok: false, reason: "tempo" });
    expect(setTempoTut({ ...base, concentric: 1.5 })).toEqual({ ok: false, reason: "tempo" });
    // All four at zero is a repetition of no duration and no time under tension.
    expect(
      setTempoTut({ ...base, eccentric: 0, pauseBottom: 0, concentric: 0, pauseTop: 0 }),
    ).toEqual({ ok: false, reason: "tempo" });
    expect(setTempoTut({ ...base, reps: 0 })).toEqual({ ok: false, reason: "reps" });
    expect(setTempoTut({ ...base, sets: 0 })).toEqual({ ok: false, reason: "sets" });
    expect(setTempoTut({ ...base, restBetweenSets: -1 })).toEqual({
      ok: false,
      reason: "restBetweenSets",
    });
  });
});

describe("splitSeries", () => {
  it("summarises six sprints, including both decline measures", () => {
    const result = splitSeries([4.0, 4.05, 4.1, 4.2, 4.25, 4.3]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(6);
    // 4,00 + 4,05 + 4,10 + 4,20 + 4,25 + 4,30 = 24,90
    expect(result.total).toBeCloseTo(24.9, 9);
    expect(result.mean).toBeCloseTo(4.15, 9); // 24,90/6
    expect(result.median).toBeCloseTo(4.15, 9); // (4,10 + 4,20)/2
    expect(result.best).toBe(4.0);
    expect(result.worst).toBe(4.3);
    expect(result.range).toBeCloseTo(0.3, 9);
    // 100 × 0,30/4,00 = 7,50 %
    expect(result.fatigueIndex).toBeCloseTo(7.5, 9);
    // 100 × (24,90/24,00 − 1) = 100 × 0,0375 = 3,75 %
    expect(result.decrement).toBeCloseTo(3.75, 9);
  });

  it("takes the mean of the two middle values for an even count", () => {
    const result = splitSeries([62.5, 63.0, 64.25, 65.25]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBeCloseTo(255, 9);
    expect(result.mean).toBeCloseTo(63.75, 9);
    // (63,00 + 64,25)/2 = 63,625 → the surface shows 63,63 (half up)
    expect(result.median).toBeCloseTo(63.625, 9);
    expect(result.range).toBeCloseTo(2.75, 9);
    // 100 × 2,75/62,50 = 4,40 %
    expect(result.fatigueIndex).toBeCloseTo(4.4, 9);
    // 100 × (255,00/250,00 − 1) = 2,00 %
    expect(result.decrement).toBeCloseTo(2, 9);
  });

  it("sorts only for the median — the sum, best and worst do not depend on order", () => {
    const ordered = splitSeries([4.0, 4.05, 4.1, 4.2, 4.25, 4.3]);
    const shuffled = splitSeries([4.25, 4.0, 4.3, 4.1, 4.2, 4.05]);
    expect(ordered.ok && shuffled.ok).toBe(true);
    if (!ordered.ok || !shuffled.ok) return;
    expect(shuffled.total).toBeCloseTo(ordered.total, 9);
    expect(shuffled.best).toBe(ordered.best);
    expect(shuffled.worst).toBe(ordered.worst);
    expect(shuffled.median).toBeCloseTo(ordered.median, 9);
  });

  it("takes the middle value itself for an odd count", () => {
    const result = splitSeries([9, 4, 5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.median).toBe(5);
    expect(result.best).toBe(4);
    expect(result.worst).toBe(9);
  });

  it("refuses fewer than two efforts and any non-positive time", () => {
    // One time is its own best and worst; the two indices would be a constant
    // zero dressed up as data.
    expect(splitSeries([])).toEqual({ ok: false, reason: "times" });
    expect(splitSeries([4])).toEqual({ ok: false, reason: "times" });
    // A best of zero divides by zero in both indices.
    expect(splitSeries([4, 0])).toEqual({ ok: false, reason: "times" });
    expect(splitSeries([4, -1])).toEqual({ ok: false, reason: "times" });
    expect(splitSeries([4, Number.NaN])).toEqual({ ok: false, reason: "times" });
  });
});

describe("sweatRate", () => {
  it("solves the mass balance for the sweat that left the body", () => {
    const result = sweatRate({
      preMass: 82,
      postMass: 80.6,
      drunk: 750,
      food: 0,
      urine: 0,
      duration: 90,
      replacementPercent: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.massLost).toBeCloseTo(1.4, 9);
    // 100 × 1,4/82 = 1,707317 %
    expect(result.percentBodyMass).toBeCloseTo(1.707317, 6);
    // 1,400 kg × 1000 + 750 + 0 − 0 = 2150 g
    expect(result.sweatGrams).toBeCloseTo(2150, 6);
    // The 1 g = 1 mL convention makes the two figures numerically identical.
    expect(result.sweatMl).toBeCloseTo(2150, 6);
    // 60 × 2150/90 = 129000/90 = 1433,333 mL/h
    expect(result.ratePerHour).toBeCloseTo(1433.333333, 6);
    expect(result.litresPerHour).toBeCloseTo(1.433333, 6);
    expect(result.replacementPerHour).toBeCloseTo(1433.333333, 6);
  });

  it("subtracts a measured urine loss from the balance", () => {
    const result = sweatRate({
      preMass: 70,
      postMass: 69.5,
      drunk: 500,
      food: 0,
      urine: 200,
      duration: 60,
      replacementPercent: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 0,500 × 1000 + 500 + 0 − 200 = 800 g; 60 × 800/60 = 800 g/h
    expect(result.sweatGrams).toBeCloseTo(800, 6);
    expect(result.ratePerHour).toBeCloseTo(800, 6);
    expect(result.litresPerHour).toBeCloseTo(0.8, 9);
    // 100 × 0,5/70 = 0,714286 %
    expect(result.percentBodyMass).toBeCloseTo(0.714286, 6);
  });

  it("counts food eaten during the session as mass gained, exactly like fluid drunk", () => {
    const result = sweatRate({
      preMass: 80,
      postMass: 79,
      drunk: 300,
      food: 200,
      urine: 0,
      duration: 60,
      replacementPercent: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1,000 × 1000 + 300 + 200 − 0 = 1500 g; without the 200 g of food this
    // would read 1300 g, so the field's own effect on the balance is exactly 200.
    expect(result.sweatGrams).toBeCloseTo(1500, 6);
    expect(result.ratePerHour).toBeCloseTo(1500, 6);
  });

  it("scales the rate by the replacement percentage that was typed", () => {
    const result = sweatRate({
      preMass: 70,
      postMass: 69.5,
      drunk: 500,
      food: 0,
      urine: 200,
      duration: 60,
      replacementPercent: 150,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 800 × 1,50 = 1200 mL/h
    expect(result.replacementPerHour).toBeCloseTo(1200, 6);
  });

  it("shows a negative sweat figure rather than hiding a mistyped mass", () => {
    const result = sweatRate({
      preMass: 70,
      postMass: 70.5,
      drunk: 0,
      food: 0,
      urine: 0,
      duration: 60,
      replacementPercent: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The athlete gained 0,5 kg with nothing drunk or eaten, so the balance
    // gives −500 g. Clamping that to zero would hide exactly the typing error
    // it reveals.
    expect(result.sweatGrams).toBeCloseTo(-500, 6);
    expect(result.ratePerHour).toBeCloseTo(-500, 6);
  });

  it("refuses a non-positive mass, duration or replacement, and a negative volume or food mass", () => {
    const base = {
      preMass: 82,
      postMass: 80.6,
      drunk: 750,
      food: 0,
      urine: 0,
      duration: 90,
      replacementPercent: 100,
    };
    expect(sweatRate({ ...base, preMass: 0 })).toEqual({ ok: false, reason: "preMass" });
    expect(sweatRate({ ...base, postMass: 0 })).toEqual({ ok: false, reason: "postMass" });
    expect(sweatRate({ ...base, drunk: -1 })).toEqual({ ok: false, reason: "drunk" });
    expect(sweatRate({ ...base, food: -1 })).toEqual({ ok: false, reason: "food" });
    expect(sweatRate({ ...base, urine: -1 })).toEqual({ ok: false, reason: "urine" });
    expect(sweatRate({ ...base, duration: 0 })).toEqual({ ok: false, reason: "duration" });
    expect(sweatRate({ ...base, replacementPercent: 0 })).toEqual({
      ok: false,
      reason: "replacementPercent",
    });
  });
});

describe("trainingVolumeLoad", () => {
  it("sums the rows and groups a shared 1RM into one tonnage-weighted intensity", () => {
    const result = trainingVolumeLoad({
      rows: [
        { sets: 5, reps: 5, load: 100, oneRm: 130 },
        { sets: 3, reps: 8, load: 80, oneRm: 130 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 5 × 5 = 25 reps at 100 kg = 2500 kg; 3 × 8 = 24 reps at 80 kg = 1920 kg
    // Row intensity: 100 × (2500/25)/130 = 76,923077 %; 100 × (1920/24)/130 = 61,538462 %
    expect(result.rows[0]).toEqual({ reps: 25, tonnage: 2500, intensity: expect.closeTo(76.923077, 6) });
    expect(result.rows[1]).toEqual({ reps: 24, tonnage: 1920, intensity: expect.closeTo(61.538462, 6) });
    expect(result.totalSets).toBe(8);
    expect(result.totalReps).toBe(49);
    expect(result.tonnage).toBe(4420);
    // 4420/49 = 90,204082 kg — the tonnage-weighted mean, nothing else.
    expect(result.meanLoad).toBeCloseTo(90.204082, 6);
    // Both rows share oneRm 130 exactly, so they fall into ONE group:
    // 100 × (4420/49)/130 = 69,387755 %, computed from the UNROUNDED group mean.
    expect(result.intensityGroups.length).toBe(1);
    expect(result.intensityGroups[0]?.oneRm).toBe(130);
    expect(result.intensityGroups[0]?.meanIntensity).toBeCloseTo(69.387755, 6);
  });

  it("keeps rows with different 1RMs in separate groups, one per lift", () => {
    const result = trainingVolumeLoad({
      rows: [
        { sets: 5, reps: 5, load: 100, oneRm: 130 },
        { sets: 3, reps: 8, load: 60, oneRm: 80 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Row 2: 3 × 8 = 24 reps at 60 kg = 1440 kg; mean load 1440/24 = 60 exactly;
    // 100 × 60/80 = 75,0 % exactly.
    expect(result.rows[1]).toEqual({ reps: 24, tonnage: 1440, intensity: 75 });
    expect(result.tonnage).toBe(2500 + 1440);
    expect(result.intensityGroups.length).toBe(2);
    // First-appearance order: the 130 kg lift was typed first.
    expect(result.intensityGroups[0]?.oneRm).toBe(130);
    expect(result.intensityGroups[0]?.meanIntensity).toBeCloseTo(76.923077, 6);
    expect(result.intensityGroups[1]?.oneRm).toBe(80);
    expect(result.intensityGroups[1]?.meanIntensity).toBe(75);
  });

  it("handles a single row and a round intensity", () => {
    const result = trainingVolumeLoad({ rows: [{ sets: 1, reps: 10, load: 60, oneRm: 100 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalReps).toBe(10);
    expect(result.tonnage).toBe(600);
    expect(result.meanLoad).toBeCloseTo(60, 9);
    expect(result.rows[0]?.intensity).toBeCloseTo(60, 9);
    expect(result.intensityGroups).toEqual([{ oneRm: 100, meanIntensity: 60 }]);
  });

  it("omits every intensity figure when no row carries a 1RM", () => {
    const result = trainingVolumeLoad({ rows: [{ sets: 1, reps: 10, load: 60 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meanLoad).toBeCloseTo(60, 9);
    expect(result.rows[0]?.intensity).toBeUndefined();
    expect(result.intensityGroups).toEqual([]);
  });

  it("refuses an empty program instead of printing a 0,0 kg tonnage for it", () => {
    // A program that was never entered is not the same fact as one that was
    // entered and summed to nothing — only the second is a real zero.
    expect(trainingVolumeLoad({ rows: [] })).toEqual({ ok: false, reason: "rows" });
  });

  it("accepts a load of zero, because an empty bar is a real prescription", () => {
    const result = trainingVolumeLoad({ rows: [{ sets: 3, reps: 10, load: 0 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalReps).toBe(30);
    expect(result.tonnage).toBe(0);
    expect(result.meanLoad).toBe(0);
  });

  it("refuses a row with a non-positive or fractional count, and a non-positive row 1RM", () => {
    expect(trainingVolumeLoad({ rows: [{ sets: 0, reps: 5, load: 100 }] })).toEqual({
      ok: false,
      reason: "rows",
    });
    expect(trainingVolumeLoad({ rows: [{ sets: 5, reps: 0, load: 100 }] })).toEqual({
      ok: false,
      reason: "rows",
    });
    expect(trainingVolumeLoad({ rows: [{ sets: 5, reps: 2.5, load: 100 }] })).toEqual({
      ok: false,
      reason: "rows",
    });
    expect(trainingVolumeLoad({ rows: [{ sets: 5, reps: 5, load: -1 }] })).toEqual({
      ok: false,
      reason: "rows",
    });
    // A per-row 1RM is validated the same way as any other row field — a bad
    // one refuses the whole call with the row's own reason, not a top-level one.
    expect(
      trainingVolumeLoad({ rows: [{ sets: 5, reps: 5, load: 100, oneRm: 0 }] }),
    ).toEqual({ ok: false, reason: "rows" });
  });
});

describe("weightClassCut", () => {
  it("spreads the difference evenly, and says so by dividing and nothing more", () => {
    const result = weightClassCut({ mass: 78.4, limit: 73, days: 21 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.difference).toBeCloseTo(5.4, 9);
    // 100 × 5,4/78,4 = 6,887755 %
    expect(result.percentOfMass).toBeCloseTo(6.887755, 6);
    // 5,4/21 = 0,257143 kg per day
    expect(result.perDay).toBeCloseTo(0.257143, 6);
    // 7 × 5,4/21 = 37,8/21 = 1,800 kg per week
    expect(result.perWeek).toBeCloseTo(1.8, 9);
    expect(result.days).toBe(21);
    // 21 days comfortably covers a full week, so the weekly figure is real.
    expect(result.perWeekExtrapolated).toBe(false);
  });

  it("flags the weekly figure as reaching past the horizon when fewer than seven days remain", () => {
    const result = weightClassCut({ mass: 78.4, limit: 73, days: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.difference).toBeCloseTo(5.4, 9);
    // 5,4/3 = 1,800 kg per day
    expect(result.perDay).toBeCloseTo(1.8, 9);
    // 7 × 5,4/3 = 37,8/3 = 12,600 kg per week — a rate that will never actually
    // run for a full week before the weigh-in.
    expect(result.perWeek).toBeCloseTo(12.6, 9);
    expect(result.days).toBe(3);
    expect(result.perWeekExtrapolated).toBe(true);
  });

  it("shows a margin and no rate at all when the athlete is under the limit", () => {
    const result = weightClassCut({ mass: 61.2, limit: 62, days: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 61,200 − 62,000 = −0,800 kg; 100 × (−0,8)/61,2 = −1,307190 %, which the
    // surface prints as 0,800 kg of margin and 1,31 % of body mass.
    expect(result.difference).toBeCloseTo(-0.8, 9);
    expect(result.percentOfMass).toBeCloseTo(-1.30719, 5);
    // There is nothing to spread, so no per-day figure is produced.
    expect(result.perDay).toBeUndefined();
    expect(result.perWeek).toBeUndefined();
    expect(result.days).toBe(5);
    expect(result.perWeekExtrapolated).toBeUndefined();
  });

  it("shows the difference alone on the day of the weigh-in", () => {
    const result = weightClassCut({ mass: 78.4, limit: 73, days: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.difference).toBeCloseTo(5.4, 9);
    // Dividing by zero days has no meaning, so neither rate is produced.
    expect(result.perDay).toBeUndefined();
    expect(result.perWeek).toBeUndefined();
    expect(result.days).toBe(0);
    expect(result.perWeekExtrapolated).toBeUndefined();
  });

  it("reports exactly on the limit as zero, with no rate", () => {
    const result = weightClassCut({ mass: 73, limit: 73, days: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.difference).toBe(0);
    expect(result.percentOfMass).toBe(0);
    expect(result.perDay).toBeUndefined();
    expect(result.days).toBe(7);
    expect(result.perWeekExtrapolated).toBeUndefined();
  });

  it("refuses a non-positive mass or limit and a fractional or negative day count", () => {
    expect(weightClassCut({ mass: 0, limit: 73, days: 21 })).toEqual({ ok: false, reason: "mass" });
    // No category is embedded anywhere, so an absent limit has no fallback.
    expect(weightClassCut({ mass: 78.4, limit: 0, days: 21 })).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(weightClassCut({ mass: 78.4, limit: 73, days: -1 })).toEqual({
      ok: false,
      reason: "days",
    });
    expect(weightClassCut({ mass: 78.4, limit: 73, days: 2.5 })).toEqual({
      ok: false,
      reason: "days",
    });
  });
});
