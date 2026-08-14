import { describe, expect, it } from "vitest";

import {
  billableHours,
  breakEven,
  chainedDiscount,
  depositInstalments,
  hourlyRateTarget,
  ibanCheck,
  ibanCompose,
  marginMarkup,
  maxDiscountForMargin,
  parseDurationMinutes,
  paymentDueDate,
  paymentReferenceCompute,
  paymentReferenceVerify,
  shareAllocation,
  simpleInterestDays,
  simpleInterestSegments,
  taxIdCompute,
  taxIdVerify,
  tieredCommission,
  type CalendarDate,
} from "./biznis.js";

/**
 * Every expectation here was worked by hand from the inputs, and the arithmetic
 * is written above it so a reader can check it without running anything. Sums
 * that must close exactly are asserted on the integer unit counts, because that
 * is where the exactness lives — the money figure is the same fact multiplied by
 * a fraction that binary floating point cannot hold.
 */

describe("parseDurationMinutes", () => {
  it("reads the three notations into whole minutes", () => {
    // 1:45 -> 60 + 45; 1h 45min -> the same; 1,75 h -> round(1.75 x 60) = 105.
    expect(parseDurationMinutes("1:45")).toEqual({ ok: true, minutes: 105 });
    expect(parseDurationMinutes("1h 45min")).toEqual({ ok: true, minutes: 105 });
    expect(parseDurationMinutes("1,75")).toEqual({ ok: true, minutes: 105 });
    expect(parseDurationMinutes("1.75")).toEqual({ ok: true, minutes: 105 });
    expect(parseDurationMinutes("0:35")).toEqual({ ok: true, minutes: 35 });
    // Minutes standing alone must carry their unit; a bare number is hours.
    expect(parseDurationMinutes("45min")).toEqual({ ok: true, minutes: 45 });
    expect(parseDurationMinutes("2")).toEqual({ ok: true, minutes: 120 });
  });

  it("converts a decimal to minutes first, so 1,005 h is 60 minutes and not 60,3", () => {
    // round(1.005 x 60) = round(60.3) = 60 — every later step is integer.
    expect(parseDurationMinutes("1,005")).toEqual({ ok: true, minutes: 60 });
    // round(0.5 x 60) = 30, and half a minute goes up: round(1.0084 x 60) = 61.
    expect(parseDurationMinutes("1,0084")).toEqual({ ok: true, minutes: 61 });
  });

  it("refuses an empty entry, a clock field above 59 and anything it cannot read", () => {
    expect(parseDurationMinutes("")).toEqual({ ok: false, reason: "entry" });
    expect(parseDurationMinutes("   ")).toEqual({ ok: false, reason: "entry" });
    // 1:75 is a typo, not 2:15.
    expect(parseDurationMinutes("1:75")).toEqual({ ok: false, reason: "entry" });
    expect(parseDurationMinutes("pola sata")).toEqual({ ok: false, reason: "entry" });
    expect(parseDurationMinutes("h")).toEqual({ ok: false, reason: "entry" });
  });
});

describe("billableHours", () => {
  const entries = ["1:10", "0:35", "2:05"];

  it("rounds each entry up onto a quarter hour and prices the sum", () => {
    const result = billableHours({
      entries,
      intervalMinutes: 15,
      rule: "up",
      place: "perItem",
      rate: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 70 -> ceil(70/15) = 5 -> 75; 35 -> ceil(35/15) = 3 -> 45;
    // 125 -> ceil(125/15) = 9 -> 135. Sum 255 min.
    expect(result.entryMinutes).toEqual([70, 35, 125]);
    expect(result.entryBilledMinutes).toEqual([75, 45, 135]);
    expect(result.billedMinutes).toBe(255);
    expect(result.billedHhmm).toBe("4:15");
    expect(result.billedHours).toBeCloseTo(4.25, 9);
    // 255/60 x 3000 = 4.25 x 3000
    expect(result.amount).toBeCloseTo(12750, 6);
    // Untouched: 70 + 35 + 125 = 230 min = 3:50; 230/60 x 3000 = 11500.
    expect(result.actualMinutes).toBe(230);
    expect(result.actualHhmm).toBe("3:50");
    expect(result.actualHours).toBeCloseTo(3.8333333333, 8);
    expect(result.actualAmount).toBeCloseTo(11500, 6);
    // The rounding added 25 minutes and 1250.
    expect(result.deltaMinutes).toBe(25);
    expect(result.deltaAmount).toBeCloseTo(1250, 6);
  });

  it("gives a different total when the same rule is applied to the sum instead", () => {
    const result = billableHours({
      entries,
      intervalMinutes: 15,
      rule: "up",
      place: "total",
      rate: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 230 -> ceil(230/15) = 16 -> 240 min = 4:00; 240/60 x 3000 = 12000.
    expect(result.billedMinutes).toBe(240);
    expect(result.billedHhmm).toBe("4:00");
    expect(result.amount).toBeCloseTo(12000, 6);
    // No entry was rounded on its own, so each still contributes what was typed.
    expect(result.entryBilledMinutes).toEqual([70, 35, 125]);
    // 240 - 230 = 10 minutes billed beyond actual, unlike the perItem test's 25:
    // rounding the SUM instead of each entry is a different number of minutes
    // and, separately, a different amount (12000 vs. the perItem test's 12750,
    // 750 apart) — which place is used has to be typed.
    expect(result.deltaMinutes).toBe(10);
  });

  it("rounds to the nearest interval, and a remainder under half stays down", () => {
    const result = billableHours({
      entries: ["0:20"],
      intervalMinutes: 6,
      rule: "nearest",
      place: "perItem",
      rate: 12000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // floor(20/6) = 3 -> 18; remainder 20 mod 6 = 2, and 2 < 6/2, so it stays.
    expect(result.billedMinutes).toBe(18);
    // 18/60 x 12000 = 0.3 x 12000
    expect(result.amount).toBeCloseTo(3600, 6);
    // The rounding took 2 minutes and 400 away.
    expect(result.deltaMinutes).toBe(-2);
    expect(result.deltaAmount).toBeCloseTo(-400, 6);
  });

  it("sends exactly half an interval up, which is a decision and not a consequence", () => {
    const half = billableHours({
      entries: ["0:03"],
      intervalMinutes: 6,
      rule: "nearest",
      place: "perItem",
      rate: 0,
    });
    expect(half.ok).toBe(true);
    if (!half.ok) return;
    // 3 mod 6 = 3, and 3 x 2 >= 6, so the half interval goes up to 6.
    expect(half.billedMinutes).toBe(6);
  });

  it("works on an interval that does not divide 60", () => {
    const result = billableHours({
      entries: ["1:00"],
      intervalMinutes: 7,
      rule: "up",
      place: "perItem",
      rate: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ceil(60/7) = 9 -> 63 minutes; the formulas are integer and hold anyway.
    expect(result.billedMinutes).toBe(63);
    // 63/60 x 100 = 105
    expect(result.amount).toBeCloseTo(105, 6);
  });

  it("leaves the total alone when no interval was given", () => {
    const result = billableHours({
      entries: ["1,75", "0:45"],
      rule: "up",
      place: "perItem",
      rate: 2000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // round(1.75 x 60) = 105 and 45 -> 150 min = 2:30; 150/60 x 2000 = 5000.
    expect(result.entryMinutes).toEqual([105, 45]);
    expect(result.billedMinutes).toBe(150);
    expect(result.billedHhmm).toBe("2:30");
    expect(result.amount).toBeCloseTo(5000, 6);
    expect(result.deltaMinutes).toBe(0);
  });

  it("answers an empty list with zero rather than dividing by nothing", () => {
    const result = billableHours({
      entries: [],
      intervalMinutes: 15,
      rule: "up",
      place: "total",
      rate: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actualMinutes).toBe(0);
    expect(result.billedMinutes).toBe(0);
    expect(result.actualHhmm).toBe("0:00");
    expect(result.amount).toBe(0);
  });

  it("refuses an unreadable entry, an impossible interval and a negative rate", () => {
    const base = { rule: "up", place: "perItem", rate: 1000 } as const;
    expect(billableHours({ ...base, entries: ["1:10", "malo"] })).toEqual({
      ok: false,
      reason: "entries",
    });
    expect(billableHours({ ...base, entries, intervalMinutes: 121 })).toEqual({
      ok: false,
      reason: "intervalMinutes",
    });
    expect(billableHours({ ...base, entries, intervalMinutes: 7.5 })).toEqual({
      ok: false,
      reason: "intervalMinutes",
    });
    expect(billableHours({ entries, rule: "up", place: "perItem", rate: -1 })).toEqual({
      ok: false,
      reason: "rate",
    });
  });
});

describe("breakEven", () => {
  it("gives the unit count, the whole-unit revenue and the margin of safety", () => {
    const result = breakEven({
      fixedCosts: 240000,
      price: 1200,
      variableCost: 700,
      plannedUnits: 600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // km = 1200 - 700 = 500; 500/1200 = 0.4166666… -> 41.6667 %
    expect(result.contributionMargin).toBe(500);
    expect(result.contributionMarginPercent).toBeCloseTo(41.6666666667, 8);
    // 240000/500 = 480 exactly, so rounding up adds nothing here.
    expect(result.exactUnits).toBeCloseTo(480, 9);
    expect(result.units).toBe(480);
    // 480 x 1200 = 576000, at both the exact and the whole-unit count.
    expect(result.breakEvenRevenue).toBeCloseTo(576000, 6);
    expect(result.revenueAtUnits).toBeCloseTo(576000, 6);
    // 480 x 500 - 240000 = 0: an exact break-even leaves no rounding surplus.
    expect(result.surplusAtUnits).toBeCloseTo(0, 6);
    // (600 - 480)/600 = 0.20; in units 600 - 480 = 120; in money 120 x 1200.
    expect(result.marginOfSafetyPercent).toBeCloseTo(20, 9);
    expect(result.marginOfSafetyUnits).toBeCloseTo(120, 9);
    expect(result.marginOfSafetyAmount).toBeCloseTo(144000, 6);
    // No profit goal was typed, so none is invented.
    expect(result.unitsForProfit).toBeUndefined();
    expect(result.exactUnitsForProfit).toBeUndefined();
    expect(result.revenueForProfit).toBeUndefined();
  });

  it("adds the wanted profit to the fixed costs before dividing, and mirrors units-for-profit in revenue", () => {
    const result = breakEven({
      fixedCosts: 90000,
      price: 2500,
      variableCost: 1000,
      targetProfit: 30000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // km = 1500; 1500/2500 = 0.60; 90000/1500 = 60 units; 60 x 2500 = 150000.
    expect(result.contributionMarginPercent).toBeCloseTo(60, 9);
    expect(result.units).toBe(60);
    expect(result.breakEvenRevenue).toBeCloseTo(150000, 6);
    expect(result.revenueAtUnits).toBeCloseTo(150000, 6);
    expect(result.surplusAtUnits).toBeCloseTo(0, 6);
    // (90000 + 30000)/1500 = 80, exactly, so the exact and rounded counts agree.
    expect(result.exactUnitsForProfit).toBeCloseTo(80, 9);
    expect(result.unitsForProfit).toBe(80);
    // 80 x 2500 = 200000
    expect(result.revenueForProfit).toBeCloseTo(200000, 6);
    expect(result.marginOfSafetyPercent).toBeUndefined();
    expect(result.marginOfSafetyUnits).toBeUndefined();
    expect(result.marginOfSafetyAmount).toBeUndefined();
  });

  it("rounds the unit count up, and shows what the whole unit actually bills and buys", () => {
    const result = breakEven({ fixedCosts: 100000, price: 999, variableCost: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // km = 499; 100000/499 = 200.4008016032064…
    expect(result.exactUnits).toBeCloseTo(200.400801603, 8);
    // 200 units cover 200 x 499 = 99800, which is 200 short; 201 cover 100299.
    expect(result.units).toBe(201);
    // 200.4008016 x 999 = 200200.4008016032
    expect(result.breakEvenRevenue).toBeCloseTo(200200.400801603, 6);
    // 201 x 999 = 200799 — nobody sells 200,4 units, this is what is actually billed.
    expect(result.revenueAtUnits).toBeCloseTo(200799, 6);
    // 201 x 499 - 100000 = 100299 - 100000 = 299 — the cushion the extra unit buys.
    expect(result.surplusAtUnits).toBeCloseTo(299, 6);
  });

  it("tells a zero contribution margin apart from a negative one", () => {
    // km = 0: every further unit leaves the loss exactly at fixedCosts, it does
    // not widen it — a different fact from km < 0, so a different reason key.
    expect(breakEven({ fixedCosts: 50000, price: 800, variableCost: 800 })).toEqual({
      ok: false,
      reason: "contributionMarginZero",
    });
    // km = -100: every further unit widens the loss, so no quantity breaks even.
    expect(breakEven({ fixedCosts: 50000, price: 800, variableCost: 900 })).toEqual({
      ok: false,
      reason: "contributionMarginNegative",
    });
  });

  it("refuses each input it cannot use", () => {
    expect(breakEven({ fixedCosts: -1, price: 1200, variableCost: 700 })).toEqual({
      ok: false,
      reason: "fixedCosts",
    });
    expect(breakEven({ fixedCosts: 1000, price: 0, variableCost: 700 })).toEqual({
      ok: false,
      reason: "price",
    });
    expect(breakEven({ fixedCosts: 1000, price: 1200, variableCost: -5 })).toEqual({
      ok: false,
      reason: "variableCost",
    });
    expect(
      breakEven({ fixedCosts: 1000, price: 1200, variableCost: 700, targetProfit: -1 }),
    ).toEqual({ ok: false, reason: "targetProfit" });
    // A non-finite plannedUnits is a broken input and is refused...
    expect(
      breakEven({ fixedCosts: 1000, price: 1200, variableCost: 700, plannedUnits: Number.NaN }),
    ).toEqual({ ok: false, reason: "plannedUnits" });
  });

  it("treats a zero or negative plannedUnits the same as no plan at all", () => {
    // Zero is not a plan to measure a margin of safety against, and it is not
    // a broken input either — the whole computation still answers, it just
    // has no margin-of-safety fields to show.
    const zero = breakEven({ fixedCosts: 1000, price: 1200, variableCost: 700, plannedUnits: 0 });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.marginOfSafetyPercent).toBeUndefined();
    expect(zero.marginOfSafetyUnits).toBeUndefined();
    expect(zero.marginOfSafetyAmount).toBeUndefined();

    const negative = breakEven({
      fixedCosts: 1000,
      price: 1200,
      variableCost: 700,
      plannedUnits: -5,
    });
    expect(negative.ok).toBe(true);
    if (!negative.ok) return;
    expect(negative.marginOfSafetyPercent).toBeUndefined();
  });
});

describe("chainedDiscount", () => {
  it("chains three discounts and reports the one discount equal to them", () => {
    const result = chainedDiscount({ basePrice: 100000, steps: [20, 10, 5] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100000 x 0.8 = 80000; x 0.9 = 72000; x 0.95 = 68400.
    expect(result.stepPrices[0]).toBeCloseTo(80000, 6);
    expect(result.stepPrices[1]).toBeCloseTo(72000, 6);
    expect(result.stepPrices[2]).toBeCloseTo(68400, 6);
    // Deltas: 100000-80000=20000; 80000-72000=8000; 72000-68400=3600. (0.9 and
    // 0.95 are not exact in binary, so the middle two land a few ulps off zero.)
    expect(result.stepDeltas[0]).toBeCloseTo(20000, 6);
    expect(result.stepDeltas[1]).toBeCloseTo(8000, 6);
    expect(result.stepDeltas[2]).toBeCloseTo(3600, 6);
    expect(result.finalPrice).toBeCloseTo(68400, 6);
    // Base price is already a whole number of cents, so round2(68400) = 68400
    // and totalDiscount = 100000 - 68400 = 31600 exactly, same as the naive sum.
    expect(result.totalDiscount).toBeCloseTo(31600, 6);
    // 1 - 0.8 x 0.9 x 0.95 = 1 - 0.684 = 0.316 — and NOT the 35 % that adding gives.
    expect(result.equivalentDiscountPercent).toBeCloseTo(31.6, 9);
  });

  it("subtracts the ROUNDED final price, so the two printed numbers add back to the base price", () => {
    const result = chainedDiscount({ basePrice: 2500, steps: [15, 7.5] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2500 x 0.85 = 2125; 2125 x 0.925 = 1965.625, which prints as 1965.63 but
    // is carried forward whole.
    expect(result.stepPrices[0]).toBeCloseTo(2125, 6);
    expect(result.stepDeltas).toEqual([375, 159.375]);
    expect(result.finalPrice).toBeCloseTo(1965.625, 6);
    // round2(1965.625) = 1965.63 (half up); totalDiscount = 2500 - 1965.63 = 534.37.
    // 1965.63 + 534.37 = 2500.00 exactly — the plain 2500 - 1965.625 = 534.375
    // (which prints as 534.38) would instead sum to 2500.01, a cent that is not there.
    expect(result.totalDiscount).toBeCloseTo(534.37, 6);
    // 1 - 0.85 x 0.925 = 1 - 0.78625 = 0.21375 -> exactly 21.3750 %, not 21.38 %.
    expect(result.equivalentDiscountPercent).toBeCloseTo(21.375, 9);
  });

  it("takes a negative step as a surcharge, which does not undo the same percentage", () => {
    const result = chainedDiscount({ basePrice: 1000, steps: [10, -10] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000 x 0.9 = 900 (delta +100); 900 x 1.1 = 990 (delta -90 — the surcharge ADDED).
    expect(result.stepDeltas[0]).toBeCloseTo(100, 6);
    expect(result.stepDeltas[1]).toBeCloseTo(-90, 6);
    expect(result.finalPrice).toBeCloseTo(990, 6);
    // 1 - 0.99 = 0.01
    expect(result.equivalentDiscountPercent).toBeCloseTo(1, 9);
  });

  it("allows a step of exactly 100 % and refuses one above it", () => {
    const whole = chainedDiscount({ basePrice: 1000, steps: [100] });
    expect(whole.ok).toBe(true);
    if (!whole.ok) return;
    expect(whole.finalPrice).toBe(0);
    expect(whole.equivalentDiscountPercent).toBe(100);
    // 101 % would make the price negative.
    expect(chainedDiscount({ basePrice: 1000, steps: [101] })).toEqual({
      ok: false,
      reason: "steps",
    });
    expect(chainedDiscount({ basePrice: 1000, steps: [10, Number.NaN] })).toEqual({
      ok: false,
      reason: "steps",
    });
  });

  it("returns the base price untouched for an empty chain", () => {
    const result = chainedDiscount({ basePrice: 1250, steps: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factor).toBe(1);
    expect(result.finalPrice).toBe(1250);
    expect(result.equivalentDiscountPercent).toBe(0);
    expect(result.stepPrices).toEqual([]);
    expect(result.stepDeltas).toEqual([]);
    expect(result.totalDiscount).toBeCloseTo(0, 6);
  });

  it("refuses a negative base price", () => {
    expect(chainedDiscount({ basePrice: -1, steps: [10] })).toEqual({
      ok: false,
      reason: "basePrice",
    });
  });
});

describe("depositInstalments", () => {
  const january: CalendarDate = { year: 2026, month: 1, day: 15 };

  it("hands the remainder to the FIRST instalments and closes on the contract value", () => {
    const result = depositInstalments({
      contractValue: 250000,
      depositKind: "percent",
      deposit: 20,
      instalments: 6,
      firstDate: january,
      stepMonths: 1,
      unit: 0.01,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 20 % of 250000 = 50000 -> 5000000 paras; 25000000 - 5000000 = 20000000 left.
    expect(result.depositUnits).toBe(5000000);
    expect(result.depositAmount).toBeCloseTo(50000, 6);
    // floor(20000000/6) = 3333333; 20000000 - 6 x 3333333 = 2 units over.
    expect(result.instalments.map((row) => row.units)).toEqual([
      3333334, 3333334, 3333333, 3333333, 3333333, 3333333,
    ]);
    expect(result.instalments[0]?.amount).toBeCloseTo(33333.34, 6);
    expect(result.instalments[5]?.amount).toBeCloseTo(33333.33, 6);
    // 2 x 3333334 + 4 x 3333333 = 6666668 + 13333332 = 20000000
    const paid = result.instalments.reduce((sum, row) => sum + row.units, 0);
    expect(paid).toBe(20000000);
    expect(paid + result.depositUnits).toBe(result.checkSumUnits);
    expect(result.checkSumUnits).toBe(25000000);
    expect(result.instalments[5]?.remaining).toBe(0);
  });

  it("steps the dates from the FIRST date, so a February never sticks the day on 28", () => {
    const result = depositInstalments({
      contractValue: 100000,
      depositKind: "amount",
      deposit: 0,
      instalments: 3,
      firstDate: { year: 2026, month: 1, day: 31 },
      stepMonths: 1,
      unit: 0.01,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10000000 paras; floor(/3) = 3333333; 10000000 - 9999999 = 1 unit over.
    expect(result.instalments.map((row) => row.units)).toEqual([3333334, 3333333, 3333333]);
    // 31.01 -> February 2026 has no 31st, so 28.02 -> and + 2 months from the
    // FIRST date is 31.03; chaining would have produced 28.03.
    expect(result.instalments.map((row) => row.date)).toEqual([
      { year: 2026, month: 1, day: 31 },
      { year: 2026, month: 2, day: 28 },
      { year: 2026, month: 3, day: 31 },
    ]);
  });

  it("divides evenly when the units divide, and takes a deposit typed as an amount", () => {
    const result = depositInstalments({
      contractValue: 90000,
      depositKind: "amount",
      deposit: 30000,
      instalments: 4,
      firstDate: january,
      stepMonths: 3,
      unit: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 90000 - 30000 = 60000; floor(60000/4) = 15000 and no remainder at all.
    expect(result.instalments.map((row) => row.units)).toEqual([15000, 15000, 15000, 15000]);
    expect(result.checkSumUnits).toBe(90000);
    // Three months apart, measured from 15.01.2026.
    expect(result.instalments.map((row) => row.date.month)).toEqual([1, 4, 7, 10]);
  });

  it("keeps every instalment within one unit of the others", () => {
    const result = depositInstalments({
      contractValue: 1000,
      depositKind: "percent",
      deposit: 0,
      instalments: 7,
      firstDate: january,
      stepMonths: 1,
      unit: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // floor(1000/7) = 142; 1000 - 7 x 142 = 6 -> six of 143 and one of 142.
    // Putting the remainder on the last instalment would have made it 148.
    expect(result.instalments.map((row) => row.units)).toEqual([143, 143, 143, 143, 143, 143, 142]);
    expect(result.instalments.reduce((sum, row) => sum + row.units, 0)).toBe(1000);
  });

  it("accepts a deposit equal to the whole value, and every instalment is then zero", () => {
    const result = depositInstalments({
      contractValue: 5000,
      depositKind: "percent",
      deposit: 100,
      instalments: 3,
      firstDate: january,
      stepMonths: 1,
      unit: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.depositUnits).toBe(5000);
    expect(result.instalments.map((row) => row.units)).toEqual([0, 0, 0]);
    expect(result.checkSumUnits).toBe(5000);
  });

  it("refuses each input it cannot use, and a plan that runs off the calendar", () => {
    const base = {
      contractValue: 1000,
      depositKind: "percent",
      deposit: 0,
      instalments: 2,
      firstDate: january,
      stepMonths: 1,
      unit: 1,
    } as const;
    expect(depositInstalments({ ...base, contractValue: 0 })).toEqual({
      ok: false,
      reason: "contractValue",
    });
    expect(depositInstalments({ ...base, instalments: 0 })).toEqual({
      ok: false,
      reason: "instalments",
    });
    expect(depositInstalments({ ...base, unit: 0 })).toEqual({ ok: false, reason: "unit" });
    // 2026 is not a leap year, so there is no 29 February in it.
    expect(
      depositInstalments({ ...base, firstDate: { year: 2026, month: 2, day: 29 } }),
    ).toEqual({ ok: false, reason: "firstDate" });
    expect(depositInstalments({ ...base, stepMonths: 0 })).toEqual({
      ok: false,
      reason: "stepMonths",
    });
    expect(depositInstalments({ ...base, deposit: 101 })).toEqual({
      ok: false,
      reason: "deposit",
    });
    expect(
      depositInstalments({ ...base, depositKind: "amount", deposit: 1001 }),
    ).toEqual({ ok: false, reason: "deposit" });
    // 600 instalments 120 months apart run past the representable calendar.
    expect(
      depositInstalments({
        ...base,
        instalments: 600,
        stepMonths: 120,
        firstDate: { year: 9999, month: 12, day: 31 },
      }),
    ).toEqual({ ok: false, reason: "schedule" });
  });

  it("refuses a contract value that is not a whole multiple of the unit", () => {
    // Math.round(1050.40 / 1) = 1050, so a plan built on 1050 would silently
    // drop the 0.40 that is left over — refuse rather than lose a para.
    expect(
      depositInstalments({
        contractValue: 1050.4,
        depositKind: "percent",
        deposit: 0,
        instalments: 2,
        firstDate: january,
        stepMonths: 1,
        unit: 1,
      }),
    ).toEqual({ ok: false, reason: "contractValue" });
    // Math.round(1050.50 / 1) = 1051 — the opposite fault, inventing 0.60 that
    // was never in the contract.
    expect(
      depositInstalments({
        contractValue: 1050.5,
        depositKind: "percent",
        deposit: 0,
        instalments: 2,
        firstDate: january,
        stepMonths: 1,
        unit: 1,
      }),
    ).toEqual({ ok: false, reason: "contractValue" });
  });

  it("accepts a large contract value whose exact/rounded gap grows past a fixed absolute band", () => {
    // 10.000.000.000,04 / 0,01 is a legitimate whole number of paras
    // (1.000.000.000.004), but the division is not exact in binary floating
    // point at this magnitude: node measures the gap between the exact
    // quotient and its rounded value at 0.0001220703125 — past a fixed 1e-6
    // tolerance, which would wrongly refuse this contract, and yet far below
    // one para once scaled by the unit count itself (1e-6 x 1e12 = 1e6). The
    // tolerance has to be RELATIVE to the unit count to accept this without
    // also accepting a genuinely broken contract value.
    const result = depositInstalments({
      contractValue: 10000000000.04,
      depositKind: "amount",
      deposit: 0,
      instalments: 2,
      firstDate: january,
      stepMonths: 1,
      unit: 0.01,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkSumUnits).toBe(1000000000004);
  });

  describe("with non-working-day shifting (off by default, opt in)", () => {
    it("leaves every date exactly where it was when the shift is not switched on", () => {
      // 31.01.2026 is a Saturday (the same fact the paymentDueDate tests use
      // for 28.02.2026, twenty-eight days later — an exact number of weeks
      // apart, so the same weekday). With no shift requested it still lands
      // on the milestone date the schedule computed, unmoved.
      const result = depositInstalments({
        contractValue: 1000,
        depositKind: "amount",
        deposit: 0,
        instalments: 1,
        firstDate: { year: 2026, month: 1, day: 31 },
        stepMonths: 1,
        unit: 1,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.instalments[0]?.date).toEqual({ year: 2026, month: 1, day: 31 });
      expect(result.instalments[0]?.dateBeforeShift).toEqual({ year: 2026, month: 1, day: 31 });
      expect(result.instalments[0]?.shiftedDays).toBe(0);
      expect(result.capReached).toBe(false);
    });

    it("moves a Saturday instalment date forward to Monday when the rule is switched on", () => {
      // Same 31.01.2026 Saturday as above; Saturday and Sunday are weekend,
      // so the walk takes two forward steps: Sat 31.01 -> Sun 01.02 (still
      // weekend) -> Mon 02.02.2026 (working).
      const result = depositInstalments({
        contractValue: 1000,
        depositKind: "amount",
        deposit: 0,
        instalments: 1,
        firstDate: { year: 2026, month: 1, day: 31 },
        stepMonths: 1,
        unit: 1,
        shiftOffNonWorkingDays: true,
        weekendDays: [5, 6],
        nonWorkingDays: [],
        shiftDirection: "forward",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = result.instalments[0];
      expect(row?.dateBeforeShift).toEqual({ year: 2026, month: 1, day: 31 });
      expect(row?.date).toEqual({ year: 2026, month: 2, day: 2 });
      expect(row?.shiftedDays).toBe(2);
      // Only the date moved — the amount is untouched by the calendar rule.
      expect(row?.amount).toBe(1000);
      expect(result.capReached).toBe(false);
    });

    it("shifts a milestone row BACKWARD and leaves a working-day row alone, in the same schedule", () => {
      // 26.04.2026 is a Sunday (the same fact paymentDueDate's own backward-
      // shift test uses): Sun 26.04 (weekday 6) -> Sat 25.04 (weekday 5,
      // still weekend) -> Fri 24.04 (weekday 4, working) — two steps back.
      // 01.05.2026 is a Friday (weekday 4, from paymentDueDate's own holiday
      // test) and is not touched at all.
      const fixedDate: CalendarDate = { year: 2026, month: 4, day: 26 };
      const equalDate: CalendarDate = { year: 2026, month: 5, day: 1 };
      const result = depositInstalments({
        schedule: "rows",
        contractValue: 1000,
        depositKind: "amount",
        deposit: 0,
        unit: 1,
        rows: [
          { kind: "fixed", amount: 500, date: fixedDate },
          { kind: "equal", date: equalDate },
        ],
        shiftOffNonWorkingDays: true,
        weekendDays: [5, 6],
        nonWorkingDays: [],
        shiftDirection: "backward",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.instalments[0]?.dateBeforeShift).toEqual(fixedDate);
      expect(result.instalments[0]?.date).toEqual({ year: 2026, month: 4, day: 24 });
      expect(result.instalments[0]?.shiftedDays).toBe(2);
      expect(result.instalments[1]?.dateBeforeShift).toEqual(equalDate);
      expect(result.instalments[1]?.date).toEqual(equalDate);
      expect(result.instalments[1]?.shiftedDays).toBe(0);
      // The remainder rule and the contract total are unaffected by the shift.
      expect(result.instalments[0]?.units).toBe(500);
      expect(result.instalments[1]?.units).toBe(500);
      expect(result.checkSumUnits).toBe(1000);
    });

    it("refuses a weekday code outside 0-6 and an invalid holiday date", () => {
      const base = {
        contractValue: 1000,
        depositKind: "amount" as const,
        deposit: 0,
        instalments: 1,
        firstDate: january,
        stepMonths: 1,
        unit: 1,
        shiftOffNonWorkingDays: true,
      };
      expect(depositInstalments({ ...base, weekendDays: [7] })).toEqual({
        ok: false,
        reason: "weekendDays",
      });
      expect(
        depositInstalments({
          ...base,
          nonWorkingDays: [{ year: 2026, month: 4, day: 31 }],
        }),
      ).toEqual({ ok: false, reason: "nonWorkingDays" });
    });
  });

  describe("with explicit rows (the milestone / mixed-basis schedule)", () => {
    const d1: CalendarDate = { year: 2026, month: 2, day: 1 };
    const d2: CalendarDate = { year: 2026, month: 3, day: 1 };
    const d3: CalendarDate = { year: 2026, month: 4, day: 1 };
    const d4: CalendarDate = { year: 2026, month: 5, day: 1 };

    it("mixes a fixed row, a percent-of-contract row and equal rows, and splits the remainder", () => {
      const result = depositInstalments({
        schedule: "rows",
        contractValue: 1000,
        depositKind: "amount",
        deposit: 0,
        unit: 1,
        rows: [
          { kind: "fixed", amount: 701, date: d1 },
          { kind: "equal", date: d2 },
          { kind: "equal", date: d3 },
          { kind: "equal", date: d4 },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // available = 1000 - 0 = 1000; committed = 701; leftover = 299.
      // floor(299/3) = 99 each -> 297, 2 left over -> the first two equal rows
      // (entered second and third overall) take the extra unit.
      expect(result.instalments.map((row) => row.units)).toEqual([701, 100, 100, 99]);
      expect(result.instalments.map((row) => row.date)).toEqual([d1, d2, d3, d4]);
      expect(result.instalments.reduce((sum, row) => sum + row.units, 0)).toBe(1000);
      expect(result.checkSumUnits).toBe(1000);
    });

    it("reports an overshoot rather than scaling fixed and percent rows to fit", () => {
      // ISPRAVKA(3)'s own example: 100.000 total, a fixed row of 20.000, and
      // percent rows of 30 % + 70 % — each of the total, not of what is left —
      // commit 20.000 + 30.000 + 70.000 = 120.000, more than the contract.
      const result = depositInstalments({
        schedule: "rows",
        contractValue: 100000,
        depositKind: "amount",
        deposit: 0,
        unit: 1,
        rows: [
          { kind: "fixed", amount: 20000, date: d1 },
          { kind: "percent", percent: 30, date: d2 },
          { kind: "percent", percent: 70, date: d3 },
        ],
      });
      expect(result).toEqual({ ok: false, reason: "rowsExceedContract" });
    });

    it("refuses a plan that falls short with nothing to absorb the rest", () => {
      const result = depositInstalments({
        schedule: "rows",
        contractValue: 100000,
        depositKind: "amount",
        deposit: 0,
        unit: 1,
        rows: [{ kind: "fixed", amount: 40000, date: d1 }],
      });
      expect(result).toEqual({ ok: false, reason: "rowsIncomplete" });
    });

    it("refuses an empty row list, a bad percent, a negative fixed amount and a bad date", () => {
      const base = {
        schedule: "rows" as const,
        contractValue: 1000,
        depositKind: "amount" as const,
        deposit: 0,
        unit: 1,
      };
      expect(depositInstalments({ ...base, rows: [] })).toEqual({
        ok: false,
        reason: "rows",
      });
      expect(
        depositInstalments({
          ...base,
          rows: [{ kind: "percent" as const, percent: 101, date: d1 }],
        }),
      ).toEqual({ ok: false, reason: "rows" });
      expect(
        depositInstalments({ ...base, rows: [{ kind: "fixed" as const, amount: -1, date: d1 }] }),
      ).toEqual({ ok: false, reason: "rows" });
      expect(
        depositInstalments({
          ...base,
          rows: [
            { kind: "fixed" as const, amount: 100, date: { year: 2026, month: 2, day: 30 } },
          ],
        }),
      ).toEqual({ ok: false, reason: "rows" });
    });
  });
});

describe("hourlyRateTarget", () => {
  it("divides the year's revenue by the hours actually billed", () => {
    const result = hourlyRateTarget({
      targetEarnings: 24000,
      businessCosts: 4800,
      workWeeks: 44,
      hoursPerWeek: 40,
      billablePercent: 60,
      hoursPerDay: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 44 x 40 x 0.6 = 1056 billable hours; 24000 + 4800 = 28800 to invoice.
    expect(result.billableHoursPerYear).toBeCloseTo(1056, 9);
    expect(result.requiredRevenue).toBe(28800);
    // 28800/1056 = 27.2727272…
    expect(result.hourlyRate).toBeCloseTo(27.2727272727, 8);
    // 27.2727272… x 8 = 218.1818181…
    expect(result.dayRate).toBeCloseTo(218.1818181818, 8);
    expect(result.monthlyRevenue).toBeCloseTo(2400, 6);
  });

  it("builds the day rate from the unrounded hourly rate", () => {
    const result = hourlyRateTarget({
      targetEarnings: 1800000,
      businessCosts: 600000,
      workWeeks: 46,
      hoursPerWeek: 35,
      billablePercent: 50,
      hoursPerDay: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 46 x 35 x 0.5 = 805 hours; 2400000/805 = 2981.3664596…
    expect(result.billableHoursPerYear).toBeCloseTo(805, 9);
    expect(result.hourlyRate).toBeCloseTo(2981.3664596273, 8);
    // 2981.3664596 x 8 = 23850.9316770…, while the printed 2981.37 x 8 would be
    // 23850.96 — three para a day, and that is why the rule exists.
    expect(result.dayRate).toBeCloseTo(23850.9316770186, 8);
    expect(result.monthlyRevenue).toBeCloseTo(200000, 6);
  });

  it("lands on exact figures when the hours divide", () => {
    const result = hourlyRateTarget({
      targetEarnings: 1000000,
      businessCosts: 0,
      workWeeks: 40,
      hoursPerWeek: 40,
      billablePercent: 100,
      hoursPerDay: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 40 x 40 x 1 = 1600; 1000000/1600 = 625 exactly; 625 x 8 = 5000.
    expect(result.billableHoursPerYear).toBe(1600);
    expect(result.hourlyRate).toBe(625);
    expect(result.dayRate).toBe(5000);
    // 1000000/12 = 83333.3333…
    expect(result.monthlyRevenue).toBeCloseTo(83333.3333333333, 8);
  });

  it("refuses each input it cannot use, and a billable year that underflows to nothing", () => {
    const base = {
      targetEarnings: 24000,
      businessCosts: 4800,
      workWeeks: 44,
      hoursPerWeek: 40,
      billablePercent: 60,
      hoursPerDay: 8,
    };
    expect(hourlyRateTarget({ ...base, targetEarnings: -1 })).toEqual({
      ok: false,
      reason: "targetEarnings",
    });
    expect(hourlyRateTarget({ ...base, businessCosts: -1 })).toEqual({
      ok: false,
      reason: "businessCosts",
    });
    expect(hourlyRateTarget({ ...base, workWeeks: 54 })).toEqual({
      ok: false,
      reason: "workWeeks",
    });
    expect(hourlyRateTarget({ ...base, workWeeks: 0 })).toEqual({
      ok: false,
      reason: "workWeeks",
    });
    expect(hourlyRateTarget({ ...base, hoursPerWeek: 0 })).toEqual({
      ok: false,
      reason: "hoursPerWeek",
    });
    expect(hourlyRateTarget({ ...base, billablePercent: 0 })).toEqual({
      ok: false,
      reason: "billablePercent",
    });
    expect(hourlyRateTarget({ ...base, billablePercent: 101 })).toEqual({
      ok: false,
      reason: "billablePercent",
    });
    expect(hourlyRateTarget({ ...base, hoursPerDay: 0 })).toEqual({
      ok: false,
      reason: "hoursPerDay",
    });
    // Each factor is positive and the product is still zero: 5e-324 x 1e-302
    // underflows. Without the guard the rate would print as infinity.
    expect(
      hourlyRateTarget({
        ...base,
        workWeeks: 1,
        hoursPerWeek: Number.MIN_VALUE,
        billablePercent: 1e-300,
      }),
    ).toEqual({ ok: false, reason: "billableHours" });
  });
});

describe("ibanCompose", () => {
  it("derives the check digits and writes the paper format", () => {
    const result = ibanCompose("RS", "160000000012345678");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "160000000012345678" + "2728" (R = 27, S = 28) + "00" leaves 32 mod 97,
    // and 98 - 32 = 66.
    expect(result.checkDigits).toBe("66");
    expect(result.iban).toBe("RS66160000000012345678");
    expect(result.paperFormat).toBe("RS66 1600 0000 0012 3456 78");
    expect(result.length).toBe(22);
  });

  it("pads a single-digit check pair to two characters", () => {
    // A remainder of 96 gives 98 - 96 = 2, which is written "02" and never "2".
    const result = ibanCompose("RS", "00000031");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "00000031" + "2728" + "00" leaves 0, so the pair is 98.
    expect(result.checkDigits).toBe("98");
    expect(result.iban).toBe("RS9800000031");
  });

  it("refuses a country code that is not two letters and a BBAN with anything else in it", () => {
    expect(ibanCompose("R", "160000000012345678")).toEqual({ ok: false, reason: "countryCode" });
    expect(ibanCompose("R1", "160000000012345678")).toEqual({ ok: false, reason: "countryCode" });
    expect(ibanCompose("RS", "")).toEqual({ ok: false, reason: "bban" });
    expect(ibanCompose("RS", "1600/0000")).toEqual({ ok: false, reason: "bban" });
    expect(ibanCompose("RS", "1".repeat(31))).toEqual({ ok: false, reason: "bban" });
  });
});

describe("ibanCheck", () => {
  it("leaves remainder 1 for a correctly written IBAN, and echoes it back as the corrected one", () => {
    const result = ibanCheck("RS66160000000012345678");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The string with "00" leaves 32, and adding 66 to a number whose remainder
    // is 32 gives 98, which is 1 mod 97.
    expect(result.remainder).toBe(1);
    expect(result.remainderIsOne).toBe(true);
    expect(result.expectedCheckDigits).toBe("66");
    expect(result.countryCode).toBe("RS");
    expect(result.bban).toBe("160000000012345678");
    expect(result.length).toBe(22);
    // Already correct, so the corrected IBAN is the same string, grouped.
    expect(result.correctedIban).toBe("RS66160000000012345678");
    expect(result.correctedPaperFormat).toBe("RS66 1600 0000 0012 3456 78");
  });

  it("moves off 1 when a single digit changes, and the correction carries all the way to a whole IBAN", () => {
    const result = ibanCheck("RS66160000000012345679");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The changed digit has six digits behind it ("2728" + "66"), so the value
    // moves by 10^6; 10^2 = 3, 10^4 = 9, 10^6 = 27 (mod 97), so 1 + 27 = 28.
    expect(result.remainder).toBe(28);
    expect(result.remainderIsOne).toBe(false);
    expect(result.expectedCheckDigits).toBe("39");
    // countryCode + expectedCheckDigits + the SAME (unfixed) bban.
    expect(result.correctedIban).toBe("RS39160000000012345679");
    expect(result.correctedPaperFormat).toBe("RS39 1600 0000 0012 3456 79");
  });

  it("normalizes spaces, hyphens, dots and lower case to the same string", () => {
    const result = ibanCheck("rs66 1600-0000 0012 3456 78");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized).toBe("RS66160000000012345678");
    expect(result.remainder).toBe(1);
    expect(result.paperFormat).toBe("RS66 1600 0000 0012 3456 78");

    // Dots are a separator too, alongside spaces and hyphens.
    const dotted = ibanCheck("RS66.1600.0000.0012.3456.78");
    expect(dotted.ok).toBe(true);
    if (!dotted.ok) return;
    expect(dotted.normalized).toBe("RS66160000000012345678");
    expect(dotted.remainder).toBe(1);
  });

  it("separates the two questions: remainder 1 is not the same as the right pair", () => {
    // "00000031" leaves 0 with "00", so ISO 13616 derives 98 - 0 = 98. A written
    // pair of "01" also leaves remainder 1, because 0 + 1 = 1 mod 97 — which is
    // why a tool that reported only the remainder would accept this string.
    const result = ibanCheck("RS0100000031");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remainder).toBe(1);
    expect(result.remainderIsOne).toBe(true);
    expect(result.checkDigits).toBe("01");
    expect(result.expectedCheckDigits).toBe("98");
    expect(result.correctedIban).toBe("RS9800000031");
    expect(result.correctedPaperFormat).toBe("RS98 0000 0031");
  });

  it("reports the length without asserting what it should be", () => {
    // A Serbian IBAN is 22 characters, but nothing here knows that: the string
    // below is 21 characters and the arithmetic still answers.
    const result = ibanCheck("RS6616000000001234567");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.length).toBe(21);
    expect(result.remainderIsOne).toBe(false);
  });

  it("refuses a string too short to hold a check pair, or one shaped otherwise", () => {
    expect(ibanCheck("RS66")).toEqual({ ok: false, reason: "iban" });
    // The first two characters must be letters and the next two digits.
    expect(ibanCheck("6616000000001234")).toEqual({ ok: false, reason: "iban" });
    expect(ibanCheck("RSX6160000000012")).toEqual({ ok: false, reason: "iban" });
    expect(ibanCheck("RS66/60000000012")).toEqual({ ok: false, reason: "iban" });
    expect(ibanCheck("RS66" + "1".repeat(31))).toEqual({ ok: false, reason: "iban" });
  });
});

describe("marginMarkup", () => {
  it("turns a markup on the cost into the margin on the price", () => {
    const result = marginMarkup({ mode: "costMarkup", cost: 1000, markupPercent: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // P = 1000 x 1.25 = 1250; Z = 250; g = 0.25/1.25 = 0.20.
    expect(result.price).toBeCloseTo(1250, 6);
    expect(result.profit).toBeCloseTo(250, 6);
    expect(result.marginPercent).toBeCloseTo(20, 9);
    expect(result.markupPercent).toBe(25);
  });

  it("closes the two formulas back on each other", () => {
    const result = marginMarkup({ mode: "costMargin", cost: 840, marginPercent: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // P = 840/0.7 = 1200; Z = 360; m = 0.3/0.7 = 0.4285714…
    expect(result.price).toBeCloseTo(1200, 6);
    expect(result.profit).toBeCloseTo(360, 6);
    expect(result.markupPercent).toBeCloseTo(42.8571428571, 8);
    // And back: m/(1+m) = 0.4285714/1.4285714 = 0.30.
    const back = marginMarkup({ mode: "costMarkup", cost: 840, markupPercent: 42.857142857142854 });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.marginPercent).toBeCloseTo(30, 8);
  });

  it("reports a price below cost as the negative numbers it produces", () => {
    const result = marginMarkup({ mode: "costPrice", cost: 1200, price: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Z = -200; m = -200/1200 = -0.1666666…; g = -200/1000 = -0.20.
    expect(result.profit).toBeCloseTo(-200, 6);
    expect(result.markupPercent).toBeCloseTo(-16.6666666667, 8);
    expect(result.marginPercent).toBeCloseTo(-20, 9);
  });

  it("works back from the selling price in both directions", () => {
    const fromMargin = marginMarkup({ mode: "priceMargin", price: 1250, marginPercent: 20 });
    expect(fromMargin.ok).toBe(true);
    if (!fromMargin.ok) return;
    // C = 1250 x 0.8 = 1000; m = 0.2/0.8 = 0.25.
    expect(fromMargin.cost).toBeCloseTo(1000, 6);
    expect(fromMargin.markupPercent).toBeCloseTo(25, 9);

    const fromMarkup = marginMarkup({ mode: "priceMarkup", price: 1250, markupPercent: 25 });
    expect(fromMarkup.ok).toBe(true);
    if (!fromMarkup.ok) return;
    // C = 1250/1.25 = 1000; g = 0.25/1.25 = 0.20.
    expect(fromMarkup.cost).toBeCloseTo(1000, 6);
    expect(fromMarkup.marginPercent).toBeCloseTo(20, 9);
  });

  it("refuses the values that would divide by zero or by a negative price", () => {
    expect(marginMarkup({ mode: "costMargin", cost: 1000, marginPercent: 100 })).toEqual({
      ok: false,
      reason: "marginPercent",
    });
    expect(marginMarkup({ mode: "priceMargin", price: 1000, marginPercent: 120 })).toEqual({
      ok: false,
      reason: "marginPercent",
    });
    expect(marginMarkup({ mode: "costMarkup", cost: 1000, markupPercent: -100 })).toEqual({
      ok: false,
      reason: "markupPercent",
    });
    expect(marginMarkup({ mode: "priceMarkup", price: 1000, markupPercent: -150 })).toEqual({
      ok: false,
      reason: "markupPercent",
    });
    expect(marginMarkup({ mode: "costPrice", cost: 0, price: 1000 })).toEqual({
      ok: false,
      reason: "cost",
    });
    expect(marginMarkup({ mode: "costPrice", cost: 1000, price: 0 })).toEqual({
      ok: false,
      reason: "price",
    });
  });
});

describe("maxDiscountForMargin", () => {
  it("floors the discount, because rounding it up breaks the margin it protects", () => {
    const result = maxDiscountForMargin({ cost: 1000, price: 1500, minMarginPercent: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // d = 1 - 1000/(1500 x 0.8) = 1 - 1000/1200 = 0.1666666…
    expect(result.exactDiscountPercent).toBeCloseTo(16.6666666667, 8);
    expect(result.maxDiscountPercent).toBe(16.66);
    // 1500 x 0.8334 = 1250.10
    expect(result.priceAfterDiscount).toBeCloseTo(1250.1, 6);
    // 250.10/1250.10 = 0.2000640 — above the 20 % asked for. At 16.67 % the
    // price would be 1249.95 and the margin 249.95/1249.95 = 0.1999680, below it.
    expect(result.marginAfterDiscountPercent).toBeCloseTo(20.0063994880, 8);
  });

  it("does not print 19,99 % where the answer is exactly 20 %", () => {
    // 1 - 800/1000 is 0.19999999999999996 in binary, and a plain floor would
    // publish a discount a hundredth of a percent smaller than the true maximum.
    const result = maxDiscountForMargin({ cost: 800, price: 1000, minMarginPercent: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maxDiscountPercent).toBe(20);
  });

  it("answers zero when the price is already under the margin, and says by how much", () => {
    // P x (1 - g_min) = 1050 x 0.9 = 945, and C = 1000 > 945, so
    // d = 1 - 1000/945 = 1 - 1.0582010582 is negative: -5.8201 %. The
    // actionable discount is 0,00 %, and the raw figure stays visible rather
    // than being hidden behind the clamp.
    const result = maxDiscountForMargin({ cost: 1000, price: 1050, minMarginPercent: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maxDiscountPercent).toBe(0);
    expect(result.exactDiscountPercent).toBeCloseTo(-5.8201058201, 8);
    expect(result.priceAfterDiscount).toBe(1050);
    // (1050 - 1000)/1050 = 4.7619047619 % — the margin already exceeds 10 %,
    // which is exactly why no discount is available at the requested floor.
    expect(result.marginAfterDiscountPercent).toBeCloseTo(4.7619047619, 8);
  });

  it("leaves the margin undefined once the floored discount reaches exactly 100 %", () => {
    // cost/(price·(1 − 0)) underflows to 0 in double precision once the cost
    // is negligible next to the price, so `exact` rounds to exactly 100 %,
    // the discounted price is exactly 0, and there is nothing left to divide
    // a margin by — this is the one unguarded denominator the file had.
    const result = maxDiscountForMargin({ cost: 1, price: 1e18, minMarginPercent: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maxDiscountPercent).toBe(100);
    expect(result.priceAfterDiscount).toBe(0);
    expect(result.marginAfterDiscountPercent).toBeUndefined();
  });

  it("refuses a margin of 100 % or more and non-positive prices", () => {
    expect(maxDiscountForMargin({ cost: 0, price: 1500, minMarginPercent: 20 })).toEqual({
      ok: false,
      reason: "cost",
    });
    expect(maxDiscountForMargin({ cost: 1000, price: 0, minMarginPercent: 20 })).toEqual({
      ok: false,
      reason: "price",
    });
    expect(maxDiscountForMargin({ cost: 1000, price: 1500, minMarginPercent: 100 })).toEqual({
      ok: false,
      reason: "minMarginPercent",
    });
  });
});

describe("paymentDueDate", () => {
  const reference: CalendarDate = { year: 2026, month: 5, day: 5 };
  // Saturday/Sunday under the file's 0 = Monday … 6 = Sunday numbering.
  const weekend = [5, 6];

  it("counts N days and names the weekday as a number", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 12 + 45 = 57, March has 31 days, 57 - 31 = 26 -> 26.04.2026.
    expect(result.dueDate).toEqual({ year: 2026, month: 4, day: 26 });
    // 26.04 is the 116th day of 2026 and 01.01.2026 was a Thursday:
    // (116 - 1) mod 7 = 3, so Thursday + 3 = Sunday, which is 6 here.
    expect(result.dueWeekday).toBe(6);
    expect(result.totalDays).toBe(45);
    expect(result.shiftedDays).toBe(0);
    // 26.04 -> 30.04 is 4 days, then 5 more to 05.05 = 9.
    expect(result.daysLate).toBe(9);
    expect(result.daysUntilDue).toBe(0);
  });

  it("counting the issue date itself makes the due date ONE DAY EARLIER, not later", () => {
    // Counting from the issue date: if the issue day (10.01) is day ONE of the
    // term, day two is 11.01, day three is 12.01 — day N is issue + (N - 1).
    // Not counting it: the term starts running the day AFTER issue, so day
    // one is 11.01, day two is 12.01, day three is 13.01 = issue + N. The two
    // readings are a day apart, and counting the issue date gives the
    // EARLIER of the two — never a day added on top of the ordinary reading.
    const notCounted = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 10 },
      mode: "daysFromDate",
      term: 3,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: { year: 2026, month: 1, day: 10 },
    });
    const counted = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 10 },
      mode: "daysFromDate",
      term: 3,
      countIssueDate: true,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: { year: 2026, month: 1, day: 10 },
    });
    expect(notCounted.ok && counted.ok).toBe(true);
    if (!notCounted.ok || !counted.ok) return;
    expect(notCounted.dueDate).toEqual({ year: 2026, month: 1, day: 13 });
    expect(counted.dueDate).toEqual({ year: 2026, month: 1, day: 12 });
    expect(counted.totalDays).toBe(notCounted.totalDays - 1);
  });

  it("a 45-day term issued 12.03.2026 falls due 25.04, one day before the ordinary reading", () => {
    // Ordinary reading: 12 + 45 = 57, March has 31 days, 57 - 31 = 26.04.2026
    // (this is the same vector as the very first test in this describe block).
    // Counting the issue date as day one of the term instead makes the 45th
    // day issue + 44 = 25.04.2026 — one day EARLIER, not 27.04. On a
    // legal-procedure tool this single day is the difference between a claim
    // being timely and being late.
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: true,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: { year: 2026, month: 3, day: 12 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dueDate).toEqual({ year: 2026, month: 4, day: 25 });
  });

  it("moves off a Sunday only when the user switched the rule on", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: weekend,
      shiftDirection: "forward",
      nonWorkingDays: [],
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sunday 26.04 + 1 = Monday 27.04.2026; lateness drops from 9 days to 8.
    expect(result.dueDateBeforeShift).toEqual({ year: 2026, month: 4, day: 26 });
    expect(result.dueDate).toEqual({ year: 2026, month: 4, day: 27 });
    expect(result.dueWeekday).toBe(0);
    expect(result.shiftedDays).toBe(1);
    expect(result.totalDays).toBe(46);
    expect(result.daysLate).toBe(8);
  });

  it("with no weekday marked as weekend, a Sunday due date does not move on its own", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: [],
      shiftDirection: "forward",
      nonWorkingDays: [],
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Still Sunday 26.04: an empty weekendDays list closes no weekday at all,
    // only the (empty, here) explicit holiday list would have moved it.
    expect(result.dueDate).toEqual({ year: 2026, month: 4, day: 26 });
    expect(result.shiftedDays).toBe(0);
  });

  it("shifts BACKWARD to the preceding working day when the contract says so", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: weekend,
      shiftDirection: "backward",
      nonWorkingDays: [],
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sunday 26.04 (weekday 6) -> Saturday 25.04 (weekday 5, still weekend) ->
    // Friday 24.04 (weekday 4, working). Two steps backward, not one forward.
    expect(result.dueDate).toEqual({ year: 2026, month: 4, day: 24 });
    expect(result.dueWeekday).toBe(4);
    expect(result.shiftedDays).toBe(2);
  });

  it("counts N days from the end of the month", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 31 },
      mode: "daysFromEndOfMonth",
      term: 30,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // End of January is the 31st; + 28 days of February (2026 is not divisible
    // by 4) reaches 28.02, and 2 more reach 02.03.2026.
    expect(result.dueDate).toEqual({ year: 2026, month: 3, day: 2 });
    // 61st day of the year: (61 - 1) mod 7 = 4, Thursday + 4 = Monday.
    expect(result.dueWeekday).toBe(0);
    expect(result.totalDays).toBe(30);
  });

  it("clamps N months to the last day of the target month", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 31 },
      mode: "monthsFromDate",
      term: 1,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // February 2026 has no 31st, so 28.02 — never 03.03.
    expect(result.dueDate).toEqual({ year: 2026, month: 2, day: 28 });
    // 59th day: (59 - 1) mod 7 = 2, Thursday + 2 = Saturday.
    expect(result.dueWeekday).toBe(5);
    expect(result.totalDays).toBe(28);

    const shifted = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 31 },
      mode: "monthsFromDate",
      term: 1,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    });
    expect(shifted.ok).toBe(true);
    if (!shifted.ok) return;
    // Saturday 28.02 -> Sunday 01.03 -> Monday 02.03.2026, two steps.
    expect(shifted.dueDate).toEqual({ year: 2026, month: 3, day: 2 });
    expect(shifted.shiftedDays).toBe(2);
  });

  it("leaves countIssueDate inert under monthsFromDate, so the month-end clamp is never broken", () => {
    // Same 31.01.2026 + 1 month as the clamp test above: with the flag OFF the
    // clamp gives 28.02.2026. If countIssueDate subtracted a day here as it
    // does for the day-count modes, it would print 27.02; the flag must do
    // nothing at all for a months-based term, so both calls land on 28.02.
    const withFlag = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 31 },
      mode: "monthsFromDate",
      term: 1,
      countIssueDate: true,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    });
    const withoutFlag = paymentDueDate({
      issueDate: { year: 2026, month: 1, day: 31 },
      mode: "monthsFromDate",
      term: 1,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    });
    expect(withFlag.ok && withoutFlag.ok).toBe(true);
    if (!withFlag.ok || !withoutFlag.ok) return;
    expect(withFlag.dueDate).toEqual({ year: 2026, month: 2, day: 28 });
    expect(withFlag.dueDate).toEqual(withoutFlag.dueDate);
    expect(withFlag.totalDays).toBe(withoutFlag.totalDays);
  });

  it("walks over the user's own holidays and the weekend alike, in THREE steps", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 5, day: 1 },
      mode: "daysFromDate",
      term: 0,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: weekend,
      shiftDirection: "forward",
      nonWorkingDays: [
        { year: 2026, month: 5, day: 1 },
        { year: 2026, month: 5, day: 2 },
      ],
      referenceDate: { year: 2026, month: 5, day: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 01.05.2026 is the 121st day: (121 - 1) mod 7 = 1, Thursday + 1 = Friday,
    // and it is on the list; 02.05 is both a Saturday and on the list; 03.05 is
    // a Sunday; 04.05 is a Monday. Three INCREMENTS (01->02, 02->03, 03->04),
    // not four — the walk visits four dates but takes three steps between them.
    expect(result.dueDate).toEqual({ year: 2026, month: 5, day: 4 });
    expect(result.dueWeekday).toBe(0);
    expect(result.shiftedDays).toBe(3);
    expect(result.daysUntilDue).toBe(3);
    expect(result.daysLate).toBe(0);
  });

  it("allows a term of zero, which falls due on the date typed", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 0,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: { year: 2026, month: 3, day: 12 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dueDate).toEqual({ year: 2026, month: 3, day: 12 });
    expect(result.totalDays).toBe(0);
    expect(result.daysLate).toBe(0);
    expect(result.daysUntilDue).toBe(0);
  });

  it("refuses bad dates, a fractional term, a bad weekday, a term off the calendar and an endless walk", () => {
    const base = {
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: false,
      shiftOffNonWorkingDays: false,
      weekendDays: weekend,
      shiftDirection: "forward",
      referenceDate: reference,
    } as const;
    expect(paymentDueDate({ ...base, issueDate: { year: 2026, month: 2, day: 29 } })).toEqual({
      ok: false,
      reason: "issueDate",
    });
    expect(paymentDueDate({ ...base, referenceDate: { year: 2026, month: 13, day: 1 } })).toEqual({
      ok: false,
      reason: "referenceDate",
    });
    expect(paymentDueDate({ ...base, term: 4.5 })).toEqual({ ok: false, reason: "term" });
    expect(paymentDueDate({ ...base, term: -1 })).toEqual({ ok: false, reason: "term" });
    // A weekday code has to be 0-6; a day-of-the-month number is not one.
    expect(paymentDueDate({ ...base, weekendDays: [7] })).toEqual({
      ok: false,
      reason: "weekendDays",
    });
    // 31.12.9999 + 5 days leaves the representable calendar.
    expect(
      paymentDueDate({ ...base, issueDate: { year: 9999, month: 12, day: 31 }, term: 5 }),
    ).toEqual({ ok: false, reason: "term" });
    expect(
      paymentDueDate({
        ...base,
        shiftOffNonWorkingDays: true,
        nonWorkingDays: [{ year: 2026, month: 4, day: 31 }],
      }),
    ).toEqual({ ok: false, reason: "nonWorkingDays" });
  });

  it("caps a walk over thirty-five consecutive closed days instead of looping or refusing", () => {
    // Every day from 01.06 to 05.07 (35 days) is closed. The walk takes at
    // most 30 STEPS (increments, not condition checks): starting at 01.06 it
    // reaches 01.07 after exactly 30 steps and stops there, still closed,
    // rather than continuing to the 06.07 that would actually be open.
    const june = Array.from({ length: 30 }, (_, i) => ({ year: 2026, month: 6, day: i + 1 }));
    const july = Array.from({ length: 5 }, (_, i) => ({ year: 2026, month: 7, day: i + 1 }));
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 6, day: 1 },
      mode: "daysFromDate",
      term: 0,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: weekend,
      shiftDirection: "forward",
      nonWorkingDays: [...june, ...july],
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capReached).toBe(true);
    expect(result.shiftedDays).toBe(30);
    expect(result.dueDateBeforeShift).toEqual({ year: 2026, month: 6, day: 1 });
    // 01.06 + 30 days of June = 01.07 exactly (June has 30 days).
    expect(result.dueDate).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it("does not report a cap when the walk lands on a working day within the limit", () => {
    const result = paymentDueDate({
      issueDate: { year: 2026, month: 3, day: 12 },
      mode: "daysFromDate",
      term: 45,
      countIssueDate: false,
      shiftOffNonWorkingDays: true,
      weekendDays: weekend,
      shiftDirection: "forward",
      nonWorkingDays: [],
      referenceDate: reference,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capReached).toBe(false);
  });
});

describe("paymentReferenceCompute", () => {
  it("derives the check pair for a short reference", () => {
    const result = paymentReferenceCompute("123");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 123 mod 97 = 26; 2600 mod 97 = 2600 - 2522 = 78; 98 - 78 = 20.
    expect(result.checkDigits).toBe(20);
    expect(result.checkDigitsText).toBe("20");
    expect(result.formatted).toBe("20-123");
    expect(result.overTwentyDigits).toBe(false);
  });

  it("derives the check pair for a longer one and keeps the typed separators", () => {
    const result = paymentReferenceCompute("1234567");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1234567 mod 97 = 1234567 - 97 x 12727 = 48; 4800 mod 97 = 4800 - 4753 = 47;
    // 98 - 47 = 51.
    expect(result.checkDigits).toBe(51);
    expect(result.formatted).toBe("51-1234567");

    const spaced = paymentReferenceCompute("123-4567");
    expect(spaced.ok).toBe(true);
    if (!spaced.ok) return;
    expect(spaced.checkDigits).toBe(51);
    expect(spaced.reference).toBe("1234567");
    expect(spaced.formatted).toBe("51-123-4567");
  });

  it("keeps leading zeros and stays exact past 2^53", () => {
    // "007" is not 7: 7 mod 97 = 7, so both give 98 - (700 mod 97) = 98 - 21 = 77,
    // but the reference itself must come back with its zeros intact.
    const zeros = paymentReferenceCompute("007");
    expect(zeros.ok).toBe(true);
    if (!zeros.ok) return;
    expect(zeros.reference).toBe("007");
    expect(zeros.checkDigits).toBe(77);
    // Twenty digits are far past 2^53, where Number() would alter the low ones,
    // and twenty is still the exact NBS field width — not yet past it.
    const long = paymentReferenceCompute("12345678901234567890");
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(long.overTwentyDigits).toBe(false);
    // Verified by the reverse test: the composed call number leaves remainder 1.
    const back = paymentReferenceVerify(`${long.checkDigitsText}12345678901234567890`);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.matches).toBe(true);
    expect(back.remainder).toBe(1);
  });

  it("reports past the 20-digit form field as a fact, and still answers", () => {
    // 21 digits: one past the NBS payment-order field, but MOD 97-10 has no
    // length limit of its own, so the tool still computes rather than refusing.
    const result = paymentReferenceCompute("1".repeat(21));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference.length).toBe(21);
    expect(result.overTwentyDigits).toBe(true);
    // Still a valid pair by construction: prepending it and moving it to the
    // end must leave remainder 1.
    const check = paymentReferenceVerify(`${result.checkDigitsText}${result.reference}`);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.matches).toBe(true);
  });

  it("refuses an empty reference, a letter in it and one past forty digits", () => {
    expect(paymentReferenceCompute("")).toEqual({ ok: false, reason: "reference" });
    expect(paymentReferenceCompute("12a3")).toEqual({ ok: false, reason: "reference" });
    expect(paymentReferenceCompute("1".repeat(41))).toEqual({ ok: false, reason: "reference" });
  });
});

describe("paymentReferenceVerify", () => {
  it("reports both pairs when they differ", () => {
    const result = paymentReferenceVerify("20-124");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 124 mod 97 = 27; 2700 mod 97 = 2700 - 2619 = 81; 98 - 81 = 17.
    expect(result.enteredCheckDigits).toBe(20);
    expect(result.computedCheckDigits).toBe(17);
    expect(result.matches).toBe(false);
    expect(result.overTwentyDigits).toBe(false);
  });

  it("ignores the separator entirely", () => {
    for (const written of ["51-1234567", "51 1234567", "511234567"]) {
      const result = paymentReferenceVerify(written);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.enteredCheckDigits).toBe(51);
      expect(result.computedCheckDigits).toBe(51);
      expect(result.matches).toBe(true);
      expect(result.remainder).toBe(1);
    }
  });

  it("compares the pairs rather than the remainder, which are not the same test", () => {
    // For the reference "97" the procedure gives 98 - ((0 x 100) mod 97) = 98.
    // Written with "01" the whole string still leaves remainder 1 — 9701 = 97 x
    // 100 + 1 — so remainder alone would accept a pair no bank would issue.
    const result = paymentReferenceVerify("0197");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remainder).toBe(1);
    expect(result.enteredCheckDigits).toBe(1);
    expect(result.computedCheckDigits).toBe(98);
    expect(result.matches).toBe(false);
  });

  it("refuses a string too short to hold a pair and a reference, or with a letter in it", () => {
    expect(paymentReferenceVerify("12")).toEqual({ ok: false, reason: "value" });
    expect(paymentReferenceVerify("1a234")).toEqual({ ok: false, reason: "value" });
    expect(paymentReferenceVerify("1".repeat(43))).toEqual({ ok: false, reason: "value" });
  });
});

describe("shareAllocation", () => {
  it("gives the leftover unit to the first row when the remainders are equal", () => {
    const result = shareAllocation({ total: 1000, shares: [1, 1, 1], unit: 0.01 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100000 paras; 100000/3 = 33333.3333 each; floor 33333 x 3 = 99999, so one
    // para is left over and goes to the row entered first.
    expect(result.rows.map((row) => row.units)).toEqual([33334, 33333, 33333]);
    expect(result.rows[0]?.gotExtraUnit).toBe(true);
    expect(result.rows[1]?.gotExtraUnit).toBe(false);
    expect(result.rows[0]?.amount).toBeCloseTo(333.34, 6);
    expect(result.rows[1]?.amount).toBeCloseTo(333.33, 6);
    // Rounding each row on its own would have produced 999.99.
    expect(result.rows.reduce((sum, row) => sum + row.units, 0)).toBe(100000);
    expect(result.checkSumUnits).toBe(100000);
  });

  it("splits by unequal weights that need not add up to 100", () => {
    const result = shareAllocation({ total: 100, shares: [1, 2, 3], unit: 0.01 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // S = 6; 10000 x 1/6 = 1666.6666, x 2/6 = 3333.3333, x 3/6 = 5000 exactly.
    // floor gives 1666 + 3333 + 5000 = 9999, and the largest remainder (0.6666)
    // is the first row.
    expect(result.rows.map((row) => row.units)).toEqual([1667, 3333, 5000]);
    expect(result.rows[0]?.percent).toBeCloseTo(16.6666666667, 8);
    expect(result.rows[2]?.percent).toBe(50);
    expect(result.extraUnits).toBe(1);
    // S = 1 + 2 + 3 = 6, the number every row's percent is normalised by.
    expect(result.shareSum).toBe(6);
  });

  it("hands nothing out when every share divides exactly", () => {
    const result = shareAllocation({ total: 1000000, shares: [45, 30, 25], unit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // S = 100; 450000 / 300000 / 250000, all remainders zero.
    expect(result.rows.map((row) => row.units)).toEqual([450000, 300000, 250000]);
    expect(result.extraUnits).toBe(0);
    expect(result.checkSumUnits).toBe(1000000);
  });

  it("gives one unit each to the first six of seven equal rows", () => {
    const result = shareAllocation({ total: 10, shares: [1, 1, 1, 1, 1, 1, 1], unit: 0.01 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000 paras; 1000/7 = 142.857142…; floor 142 x 7 = 994, leaving 6. No row
    // can take two, because the leftover is always under the number of rows.
    expect(result.rows.map((row) => row.units)).toEqual([143, 143, 143, 143, 143, 143, 142]);
    expect(result.rows.reduce((sum, row) => sum + row.units, 0)).toBe(1000);
    // 6 x 1.43 + 1.42 = 8.58 + 1.42 = 10.00
    expect(result.checkSum).toBeCloseTo(10, 6);
  });

  it("gives a zero-weight row exactly zero, never one of the leftover units", () => {
    // S = 3; N = 10000; row 0 (weight 0) has base 0 and remainder
    // (10000x0 - 0x3) = 0 — no leftover to receive. Rows 1-3 (weight 1 each)
    // have base floor(10000/3) = 3333 and remainder (10000 - 9999) = 1 each,
    // a genuine three-way tie, so bases sum to 0 + 3333x3 = 9999 and ONE unit
    // is left over — the case that actually exercises the guarantee, unlike
    // an all-remainders-zero split where there is no leftover to misplace.
    // Ties keep entry order, so row 1 (the first weight-1 row) takes it.
    const result = shareAllocation({ total: 100, shares: [0, 1, 1, 1], unit: 0.01 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.units).toBe(0);
    expect(result.rows[0]?.gotExtraUnit).toBe(false);
    expect(result.rows.map((row) => row.units)).toEqual([0, 3334, 3333, 3333]);
    expect(result.rows[1]?.gotExtraUnit).toBe(true);
    expect(result.rows.reduce((sum, row) => sum + row.units, 0)).toBe(10000);
  });

  it("splits nothing into nothing rather than refusing a zero total", () => {
    const result = shareAllocation({ total: 0, shares: [1, 2], unit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.units)).toEqual([0, 0]);
    expect(result.checkSumUnits).toBe(0);
  });

  it("refuses a negative total, no rows, a zero unit and shares that sum to nothing", () => {
    expect(shareAllocation({ total: -1, shares: [1], unit: 1 })).toEqual({
      ok: false,
      reason: "total",
    });
    expect(shareAllocation({ total: 100, shares: [], unit: 1 })).toEqual({
      ok: false,
      reason: "shares",
    });
    // The largest remainder method is not defined for a negative quota.
    expect(shareAllocation({ total: 100, shares: [-1, 2], unit: 1 })).toEqual({
      ok: false,
      reason: "shares",
    });
    expect(shareAllocation({ total: 100, shares: [0, 0], unit: 1 })).toEqual({
      ok: false,
      reason: "shares",
    });
    expect(shareAllocation({ total: 100, shares: [1], unit: 0 })).toEqual({
      ok: false,
      reason: "unit",
    });
  });
});

describe("simpleInterestDays", () => {
  const from: CalendarDate = { year: 2026, month: 1, day: 15 };
  const to: CalendarDate = { year: 2026, month: 3, day: 1 };

  it("counts actual days over 365, equal here to the always-shown calendar days", () => {
    const result = simpleInterestDays({
      principal: 120000,
      annualRatePercent: 8,
      from,
      to,
      basis: "act365",
      countBothEnds: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 16 days left in January + 28 in February (2026 is not a leap year) + 1 in
    // March = 45 days.
    expect(result.days).toBe(45);
    expect(result.calendarDays).toBe(45);
    expect(result.divisor).toBe(365);
    // 120000 x 0.08 x 45/365 = 432000/365 = 1183.5616438…
    expect(result.interest).toBeCloseTo(1183.5616438356, 8);
    // 9600/365 = 26.3013698…
    expect(result.dailyInterest).toBeCloseTo(26.3013698630, 8);
    expect(result.total).toBeCloseTo(121183.5616438356, 8);
  });

  it("countBothEnds adds exactly one day to the ACT-basis count, never to the calendar days", () => {
    const result = simpleInterestDays({
      principal: 120000,
      annualRatePercent: 8,
      from,
      to,
      basis: "act365",
      countBothEnds: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toBe(46);
    // The true calendar span between the two dates never changes.
    expect(result.calendarDays).toBe(45);
    // 120000 x 0.08 x 46/365 = 441600/365 = 1209.8630136…
    expect(result.interest).toBeCloseTo(1209.8630136986, 8);
  });

  it("counts the same span as 46 days under 30E/360, next to the 45 actual calendar days", () => {
    const result = simpleInterestDays({
      principal: 120000,
      annualRatePercent: 8,
      from,
      to,
      basis: "e30360",
      countBothEnds: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // D1 = min(15,30) = 15; D2 = min(1,30) = 1;
    // 360 x 0 + 30 x (3 - 1) + (1 - 15) = 60 - 14 = 46.
    expect(result.days).toBe(46);
    // The actual span is still 45 days — the SAME 45 as the ACT/365 vector
    // above, so the extra day here reads as the 30E/360 convention it is.
    expect(result.calendarDays).toBe(45);
    expect(result.divisor).toBe(360);
    // 9600 x 46/360 = 441600/360 = 1226.6666…, which is 43.11 more than ACT/365
    // on the same input — the reason the basis is an input.
    expect(result.interest).toBeCloseTo(1226.6666666667, 8);
  });

  it("shortens a 31st to a 30th under 30E/360, reaching the same day count as ACT/360", () => {
    const actual = simpleInterestDays({
      principal: 1000000,
      annualRatePercent: 12,
      from: { year: 2027, month: 12, day: 31 },
      to: { year: 2028, month: 1, day: 1 },
      basis: "act360",
      countBothEnds: false,
    });
    expect(actual.ok).toBe(true);
    if (!actual.ok) return;
    expect(actual.days).toBe(1);
    expect(actual.calendarDays).toBe(1);
    // 1000000 x 0.12 x 1/360 = 120000/360 = 333.3333…
    expect(actual.interest).toBeCloseTo(333.3333333333, 8);
    expect(actual.dailyInterest).toBeCloseTo(333.3333333333, 8);
    expect(actual.total).toBeCloseTo(1000333.3333333333, 8);

    const european = simpleInterestDays({
      principal: 1000000,
      annualRatePercent: 12,
      from: { year: 2027, month: 12, day: 31 },
      to: { year: 2028, month: 1, day: 1 },
      basis: "e30360",
      countBothEnds: false,
    });
    expect(european.ok).toBe(true);
    if (!european.ok) return;
    // D1 = min(31,30) = 30; 360 x 1 + 30 x (1 - 12) + (1 - 30) = 360 - 330 - 29 = 1.
    expect(european.days).toBe(1);
    expect(european.calendarDays).toBe(1);
    expect(european.interest).toBeCloseTo(333.3333333333, 8);
  });

  it("gives zero days and zero interest for the same date twice", () => {
    const result = simpleInterestDays({
      principal: 120000,
      annualRatePercent: 8,
      from,
      to: from,
      basis: "act365",
      countBothEnds: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toBe(0);
    expect(result.calendarDays).toBe(0);
    expect(result.interest).toBe(0);
    expect(result.total).toBe(120000);
  });

  it("refuses a negative principal or rate, an impossible date and a span running backwards", () => {
    const base = { principal: 1000, annualRatePercent: 8, basis: "act365", countBothEnds: false } as const;
    expect(
      simpleInterestDays({ ...base, principal: -1, from, to }),
    ).toEqual({ ok: false, reason: "principal" });
    expect(
      simpleInterestDays({ ...base, annualRatePercent: -1, from, to }),
    ).toEqual({ ok: false, reason: "annualRatePercent" });
    expect(
      simpleInterestDays({
        ...base,
        from: { year: 2026, month: 2, day: 29 },
        to,
      }),
    ).toEqual({ ok: false, reason: "from" });
    expect(
      simpleInterestDays({
        ...base,
        from,
        to: { year: 2026, month: 4, day: 31 },
      }),
    ).toEqual({ ok: false, reason: "to" });
    expect(
      simpleInterestDays({ ...base, from: to, to: from }),
    ).toEqual({ ok: false, reason: "to" });
  });
});

describe("simpleInterestSegments", () => {
  it("sums a separate calculation per segment, rather than one rate over the whole span", () => {
    // Segment A: 5 % from 01.01 to 11.01 (10 days) = 10000 x 0.05 x 10/365
    //          = 5000/365 = 13.698630136986301.
    // Segment B: 10 % from 11.01 to 21.01 (10 days) = 10000 x 0.10 x 10/365
    //          = 10000/365 = 27.397260273972602.
    // A rate change mid-term is not one calculation over 20 days at either
    // rate — it is these two, summed: 13.698630136986301 + 27.397260273972602
    // = 41.0958904109589.
    const result = simpleInterestSegments({
      principal: 10000,
      segments: [
        {
          annualRatePercent: 5,
          from: { year: 2026, month: 1, day: 1 },
          to: { year: 2026, month: 1, day: 11 },
        },
        {
          annualRatePercent: 10,
          from: { year: 2026, month: 1, day: 11 },
          to: { year: 2026, month: 1, day: 21 },
        },
      ],
      basis: "act365",
      countBothEnds: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.days).toBe(10);
    expect(result.segments[0]?.interest).toBeCloseTo(13.698630136986301, 9);
    expect(result.segments[1]?.days).toBe(10);
    expect(result.segments[1]?.interest).toBeCloseTo(27.397260273972602, 9);
    expect(result.totalDays).toBe(20);
    expect(result.totalInterest).toBeCloseTo(41.0958904109589, 9);
    expect(result.total).toBeCloseTo(10041.09589041096, 6);
  });

  it("refuses an empty segment list and a negative principal, and fails the whole schedule on one bad row", () => {
    expect(
      simpleInterestSegments({
        principal: 1000,
        segments: [],
        basis: "act365",
        countBothEnds: false,
      }),
    ).toEqual({ ok: false, reason: "segments" });
    expect(
      simpleInterestSegments({
        principal: -1,
        segments: [
          {
            annualRatePercent: 5,
            from: { year: 2026, month: 1, day: 1 },
            to: { year: 2026, month: 1, day: 11 },
          },
        ],
        basis: "act365",
        countBothEnds: false,
      }),
    ).toEqual({ ok: false, reason: "principal" });
    // The second segment's span runs backwards — one bad row refuses the
    // whole schedule rather than answering with only the first segment.
    expect(
      simpleInterestSegments({
        principal: 1000,
        segments: [
          {
            annualRatePercent: 5,
            from: { year: 2026, month: 1, day: 1 },
            to: { year: 2026, month: 1, day: 11 },
          },
          {
            annualRatePercent: 10,
            from: { year: 2026, month: 1, day: 21 },
            to: { year: 2026, month: 1, day: 11 },
          },
        ],
        basis: "act365",
        countBothEnds: false,
      }),
    ).toEqual({ ok: false, reason: "segments" });
  });
});

describe("taxIdCompute", () => {
  it("walks the MOD 11,10 chain through the s = 0 branch", () => {
    const result = taxIdCompute(9, "12345678");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // p = 10; 1 -> s=1, p=2; 2 -> s=4, p=8; 3 -> s=1, p=2; 4 -> s=6, p=1;
    // 5 -> s=6, p=1; 6 -> s=7, p=3; 7 -> s=0 which becomes 10, p=9;
    // 8 -> s=7, p=3; check = (11 - 3) mod 10 = 8.
    expect(result.checkDigit).toBe(8);
    expect(result.number).toBe("123456788");
  });

  it("keeps every zero significant: a run of them is not a run of equal steps", () => {
    const result = taxIdCompute(9, "10000000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // p goes 2, 4, 8, 5, 10, 9, 7, 3 — the sixth step is the s = 0 -> 10 branch.
    // check = (11 - 3) mod 10 = 8.
    expect(result.checkDigit).toBe(8);
    expect(result.number).toBe("100000008");
  });

  it("gives a different digit for a shorter prefix of the same digits", () => {
    const result = taxIdCompute(8, "1234567");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The chain stops at p = 9 instead of running on to 3:
    // check = (11 - 9) mod 10 = 2.
    expect(result.checkDigit).toBe(2);
    expect(result.number).toBe("12345672");
  });

  it("refuses a length it was not given, a non-digit and an impossible total", () => {
    expect(taxIdCompute(1, "1")).toEqual({ ok: false, reason: "totalDigits" });
    expect(taxIdCompute(41, "1".repeat(40))).toEqual({ ok: false, reason: "totalDigits" });
    expect(taxIdCompute(9, "1234567a")).toEqual({ ok: false, reason: "prefix" });
    // Eight digits were expected for a nine-digit number; seven is refused
    // rather than answered, or a PIB missing a digit would get a tidy answer.
    expect(taxIdCompute(9, "1234567")).toEqual({ ok: false, reason: "length" });
  });
});

describe("taxIdVerify", () => {
  it("compares the last digit with the one the chain derives, and offers the fixed number", () => {
    const good = taxIdVerify(9, "100000008");
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.checkDigit).toBe(8);
    expect(good.matches).toBe(true);
    expect(good.correctedNumber).toBe("100000008");

    const bad = taxIdVerify(9, "100000007");
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    // Same chain as the computing vector: the derived digit is 8, the typed one 7.
    expect(bad.checkDigit).toBe(8);
    expect(bad.enteredCheckDigit).toBe(7);
    expect(bad.matches).toBe(false);
    expect(bad.prefix).toBe("10000000");
    // The corrected number carries the COMPUTED digit, not the typed one.
    expect(bad.correctedNumber).toBe("100000008");
  });

  it("refuses a number of the wrong length before computing anything", () => {
    expect(taxIdVerify(9, "1234567")).toEqual({ ok: false, reason: "length" });
    expect(taxIdVerify(9, "12345678a")).toEqual({ ok: false, reason: "number" });
    expect(taxIdVerify(0, "12")).toEqual({ ok: false, reason: "totalDigits" });
  });
});

describe("tieredCommission", () => {
  const scale = [
    { from: 0, ratePercent: 2 },
    { from: 500000, ratePercent: 3 },
    { from: 1000000, ratePercent: 5 },
  ];

  it("charges each slice at its own rate", () => {
    const result = tieredCommission({ base: 1250000, tiers: scale, mode: "marginal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 500000 x 2 % = 10000; 500000 x 3 % = 15000; 250000 x 5 % = 12500.
    expect(result.slices.map((slice) => slice.commission)).toEqual([10000, 15000, 12500]);
    expect(result.commission).toBeCloseTo(37500, 6);
    // 37500/1250000 = 0.03
    expect(result.effectiveRatePercent).toBeCloseTo(3, 9);
    expect(result.remainder).toBeCloseTo(1212500, 6);
    expect(result.appliedTierIndex).toBeUndefined();
  });

  it("charges the whole base at one rate in flat mode", () => {
    const result = tieredCommission({ base: 1250000, tiers: scale, mode: "flat" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The last threshold at or below 1250000 is 1000000, so 5 % of the whole:
    // 1250000 x 5 % = 62500 — 25000 more than the marginal answer.
    expect(result.commission).toBeCloseTo(62500, 6);
    expect(result.effectiveRatePercent).toBeCloseTo(5, 9);
    expect(result.appliedTierIndex).toBe(2);
  });

  it("agrees with itself below the first threshold, so the bounds do not leak", () => {
    const marginal = tieredCommission({ base: 400000, tiers: scale, mode: "marginal" });
    const flat = tieredCommission({ base: 400000, tiers: scale, mode: "flat" });
    expect(marginal.ok && flat.ok).toBe(true);
    if (!marginal.ok || !flat.ok) return;
    // 400000 x 2 % = 8000 either way; the slices above contribute max(0, …) = 0.
    expect(marginal.commission).toBeCloseTo(8000, 6);
    expect(flat.commission).toBeCloseTo(8000, 6);
    expect(marginal.slices[1]?.amount).toBe(0);
  });

  it("puts a base sitting exactly on a threshold into the tier above", () => {
    const marginal = tieredCommission({ base: 1000000, tiers: scale, mode: "marginal" });
    const flat = tieredCommission({ base: 1000000, tiers: scale, mode: "flat" });
    expect(marginal.ok && flat.ok).toBe(true);
    if (!marginal.ok || !flat.ok) return;
    // Marginal: 10000 + 15000 + 0 = 25000. Flat: the threshold belongs to its own
    // tier, so 5 % of the whole = 50000. Same base, twice the answer.
    expect(marginal.commission).toBeCloseTo(25000, 6);
    expect(flat.commission).toBeCloseTo(50000, 6);
    expect(flat.appliedTierIndex).toBe(2);
  });

  it("shows what a floor or a cap did to the figure", () => {
    const floored = tieredCommission({
      base: 100000,
      tiers: scale,
      mode: "marginal",
      minCommission: 5000,
    });
    expect(floored.ok).toBe(true);
    if (!floored.ok) return;
    // 100000 x 2 % = 2000, lifted to the 5000 floor.
    expect(floored.commissionBeforeLimits).toBeCloseTo(2000, 6);
    expect(floored.commission).toBe(5000);

    const capped = tieredCommission({
      base: 1250000,
      tiers: scale,
      mode: "marginal",
      maxCommission: 30000,
    });
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.commissionBeforeLimits).toBeCloseTo(37500, 6);
    expect(capped.commission).toBe(30000);
  });

  it("gives no effective rate at a base of zero rather than dividing by it", () => {
    const result = tieredCommission({ base: 0, tiers: scale, mode: "marginal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commission).toBe(0);
    expect(result.effectiveRatePercent).toBeUndefined();

    const withFloor = tieredCommission({
      base: 0,
      tiers: scale,
      mode: "flat",
      minCommission: 1500,
    });
    expect(withFloor.ok).toBe(true);
    if (!withFloor.ok) return;
    expect(withFloor.commission).toBe(1500);
    expect(withFloor.effectiveRatePercent).toBeUndefined();
  });

  it("sorts the scale it is given, whatever order the rows were typed in", () => {
    const shuffled = tieredCommission({
      base: 1250000,
      tiers: [scale[2], scale[0], scale[1]].filter((tier) => tier !== undefined),
      mode: "marginal",
    });
    expect(shuffled.ok).toBe(true);
    if (!shuffled.ok) return;
    expect(shuffled.slices.map((slice) => slice.from)).toEqual([0, 500000, 1000000]);
    expect(shuffled.commission).toBeCloseTo(37500, 6);
  });

  it("refuses a scale that does not start at zero, repeats a bound, or inverts the limits", () => {
    expect(tieredCommission({ base: -1, tiers: scale, mode: "marginal" })).toEqual({
      ok: false,
      reason: "base",
    });
    expect(tieredCommission({ base: 1000, tiers: [], mode: "marginal" })).toEqual({
      ok: false,
      reason: "tiers",
    });
    // A scale starting above zero says nothing about the amounts below it.
    expect(
      tieredCommission({
        base: 1000,
        tiers: [{ from: 100, ratePercent: 2 }],
        mode: "marginal",
      }),
    ).toEqual({ ok: false, reason: "tiers" });
    expect(
      tieredCommission({
        base: 1000,
        tiers: [
          { from: 0, ratePercent: 2 },
          { from: 0, ratePercent: 3 },
        ],
        mode: "marginal",
      }),
    ).toEqual({ ok: false, reason: "tiers" });
    expect(
      tieredCommission({ base: 1000, tiers: scale, mode: "marginal", minCommission: -1 }),
    ).toEqual({ ok: false, reason: "minCommission" });
    expect(
      tieredCommission({ base: 1000, tiers: scale, mode: "marginal", maxCommission: -1 }),
    ).toEqual({ ok: false, reason: "maxCommission" });
    // Applied in the other order the two limits would silently pick the outcome.
    expect(
      tieredCommission({
        base: 1000,
        tiers: scale,
        mode: "marginal",
        minCommission: 5000,
        maxCommission: 1000,
      }),
    ).toEqual({ ok: false, reason: "maxCommission" });
  });
});

/**
 * `intervalMinutes` defaults to 0 — „bill the exact time" — and the surface
 * restated that 0 beside the echo as `intervalText.trim() === "" ? "0"`. See
 * `ShelfSpacingResult.rasterUsed`. This one hid from the `??` grep entirely,
 * because the restatement was a string, and it is the number that decides every
 * rounded entry printed above it.
 */
describe("billableHours returns the interval it applied", () => {
  // 1:10 = 70 min, 0:35 = 35, 2:05 = 125 — the same three the suite above uses.
  const entries = ["1:10", "0:35", "2:05"];

  it("reports 0 when none was given, and bills the exact minutes", () => {
    const result = billableHours({ entries, rule: "up", place: "perItem", rate: 3000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intervalMinutesUsed).toBe(0);
    // No interval means no rounding: 70 + 35 + 125 = 230 minutes, unchanged.
    expect(result.billedMinutes).toBe(230);
    expect(result.actualMinutes).toBe(230);
    expect(result.deltaMinutes).toBe(0);
  });

  it("reports the interval given, and it is the one in the arithmetic", () => {
    const result = billableHours({
      entries,
      intervalMinutes: 15,
      rule: "up",
      place: "perItem",
      rate: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intervalMinutesUsed).toBe(15);
    // 75 + 45 + 135 = 255, the rounding the reported interval produces.
    expect(result.billedMinutes).toBe(255);
  });
});
