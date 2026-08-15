import { describe, expect, it } from "vitest";

import {
  averageToTarget,
  childAge,
  combinatorics,
  decimalToFraction,
  fractionArithmetic,
  gradeScalePoints,
  gradeStatistics,
  guessingCorrection,
  itemAnalysis,
  lessonCountPeriod,
  lessonTimeline,
  parseValueList,
  splitIntoGroups,
  standardScore,
  testPrinting,
  topicHourAllocation,
  weightedGrade,
} from "./prosveta.js";

/**
 * Every expectation here was worked by hand from the inputs before the code
 * existed, and the arithmetic is written into the comments so a reader can
 * check it without running anything. A test whose expected value was copied out
 * of a first run pins the bug as firmly as the behaviour.
 */

describe("averageToTarget", () => {
  it("finds the smallest count of better marks that reaches the target", () => {
    // 3, 4, 3, 5 → n = 4, S = 15, average 15/4 = 3.75.
    // D = T·n − S = 4·4 − 15 = 1; E = v − T = 5 − 4 = 1 → j = ceil(1/1) = 1.
    const result = averageToTarget({
      tally: { kind: "grades", grades: [3, 4, 3, 5] },
      target: 4,
      extraGrade: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(4);
    expect(result.currentAverage).toBeCloseTo(3.75, 10);
    expect(result.outcome).toBe("needed");
    expect(result.extraGrades).toBe(1);
    // (15 + 5)/(4 + 1) = 20/5 = 4.00, and j = 0 would have left 3.75 < 4.
    expect(result.resultingAverage).toBeCloseTo(4, 10);
  });

  it("rounds the count up, never down — 1.67 marks is two marks", () => {
    // 2, 3, 3 → n = 3, S = 8. D = 3.5·3 − 8 = 2.5; E = 5 − 3.5 = 1.5.
    // j = ceil(2.5/1.5) = ceil(1.6667) = 2; one mark gives 13/4 = 3.25 < 3.50.
    const result = averageToTarget({
      tally: { kind: "grades", grades: [2, 3, 3] },
      target: 3.5,
      extraGrade: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentAverage).toBeCloseTo(2.666667, 6); // 8/3
    expect(result.extraGrades).toBe(2);
    expect(result.resultingAverage).toBeCloseTo(3.6, 10); // 18/5
  });

  it("turns the question round when the mark is below the target", () => {
    // 5, 5, 5, 4 → n = 4, S = 19, average 4.75. D = 4.5·4 − 19 = −1 ≤ 0,
    // E = 3 − 4.5 = −1.5 < 0 → j = floor(1/1.5) = 0: even one 3 gives
    // 22/5 = 4.40, already under 4.50.
    const result = averageToTarget({
      tally: { kind: "grades", grades: [5, 5, 5, 4] },
      target: 4.5,
      extraGrade: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("tolerated");
    expect(result.extraGrades).toBe(0);
    expect(result.resultingAverage).toBeCloseTo(4.75, 10);
  });

  it("counts how many weaker marks the average can still take", () => {
    // 5, 5, 5, 5 → n = 4, S = 20. T = 4.00, v = 3.00: D = 16 − 20 = −4,
    // E = −1 → j = floor(4/1) = 4, and (20 + 12)/8 = 32/8 = 4.00 exactly.
    const result = averageToTarget({
      tally: { kind: "grades", grades: [5, 5, 5, 5] },
      target: 4,
      extraGrade: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("tolerated");
    expect(result.extraGrades).toBe(4);
    expect(result.resultingAverage).toBeCloseTo(4, 10);
  });

  it("separates a target already met from one no such mark can reach", () => {
    // 4, 4, 4 → S = 12. With T = 4.00 and v = 4: D = 0, E = 0 — the average is
    // at the target and marks of exactly its value never move it off.
    const met = averageToTarget({
      tally: { kind: "grades", grades: [4, 4, 4] },
      target: 4,
      extraGrade: 4,
    });
    expect(met.ok).toBe(true);
    if (!met.ok) return;
    expect(met.outcome).toBe("anyCount");
    expect(met.extraGrades).toBe(0);
    expect(met.resultingAverage).toBeCloseTo(4, 10);

    // Same marks, T = 4.20, v = 4.20: D = 12.6 − 12 = 0.6 > 0, E = 0 — no
    // number of marks worth exactly the target ever lifts an average to it.
    const stuck = averageToTarget({
      tally: { kind: "grades", grades: [4, 4, 4] },
      target: 4.2,
      extraGrade: 4.2,
    });
    expect(stuck.ok).toBe(true);
    if (!stuck.ok) return;
    expect(stuck.outcome).toBe("unreachable");
    expect(stuck.extraGrades).toBeUndefined();
    expect(stuck.resultingAverage).toBeUndefined();
  });

  it("says the average is already under the target rather than inventing a count", () => {
    // 4, 4, 4 with T = 4.20 and v = 4: D = 0.6 > 0 and E = −0.2 < 0 — the
    // average (4.00) is under the target and fours only hold it there.
    const result = averageToTarget({
      tally: { kind: "grades", grades: [4, 4, 4] },
      target: 4.2,
      extraGrade: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("alreadyBelow");
    expect(result.extraGrades).toBeUndefined();
  });

  it("accepts a count and a sum in place of the marks themselves", () => {
    const listed = averageToTarget({
      tally: { kind: "grades", grades: [3, 4, 3, 5] },
      target: 4,
      extraGrade: 5,
    });
    const counted = averageToTarget({
      tally: { kind: "tally", count: 4, sum: 15 },
      target: 4,
      extraGrade: 5,
    });
    expect(counted).toEqual(listed);
  });

  it("refuses rather than repairs", () => {
    expect(
      averageToTarget({ tally: { kind: "grades", grades: [] }, target: 4, extraGrade: 5 }),
    ).toEqual({ ok: false, reason: "grades" });
    // Three decimals are not a school mark, and rounding one away would move a
    // boundary the user did not ask to move.
    expect(
      averageToTarget({ tally: { kind: "grades", grades: [3.001] }, target: 4, extraGrade: 5 }),
    ).toEqual({ ok: false, reason: "grades" });
    expect(
      averageToTarget({ tally: { kind: "tally", count: 0, sum: 15 }, target: 4, extraGrade: 5 }),
    ).toEqual({ ok: false, reason: "count" });
    expect(
      averageToTarget({
        tally: { kind: "tally", count: 4, sum: Number.NaN },
        target: 4,
        extraGrade: 5,
      }),
    ).toEqual({ ok: false, reason: "sum" });
    expect(
      averageToTarget({
        tally: { kind: "grades", grades: [4] },
        target: Number.POSITIVE_INFINITY,
        extraGrade: 5,
      }),
    ).toEqual({ ok: false, reason: "target" });
    expect(
      averageToTarget({
        tally: { kind: "grades", grades: [4] },
        target: 4,
        extraGrade: Number.NaN,
      }),
    ).toEqual({ ok: false, reason: "extraGrade" });
  });
});

describe("childAge", () => {
  it("borrows from the month before the reference month, and says which", () => {
    // Born 29.02.2020, measured 13.08.2026. d = 13 − 29 = −16 < 0 → borrow July
    // 2026 (31 days) → d = 15; m = (8 − 2) − 1 = 5; g = 6. Months = 6·12 + 5 = 77.
    const result = childAge({
      birth: { year: 2020, month: 2, day: 29 },
      on: { year: 2026, month: 8, day: 13 },
      milestoneYears: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.years).toBe(6);
    expect(result.months).toBe(5);
    expect(result.days).toBe(15);
    expect(result.totalMonths).toBe(77);
    expect(result.borrow).toEqual({ fromMonth: 7, fromMonthDays: 31, clamped: false });
    // 306 days left of 2020 after 29.02 (366 − 60) + 1826 for 2021..2025
    // (365+365+365+366+365) + 225 days into 2026 (31+28+31+30+31+30+31+13).
    expect(result.totalDays).toBe(2357);
    // The sixth birthday: 29.02.2026 does not exist, so it lands on 1 March.
    expect(result.milestone).toEqual({ date: { year: 2026, month: 3, day: 1 }, shifted: true });
    // Next anniversary: 2026 is not leap, so 2026's turn is already 1 March —
    // which is BEFORE 13 August, so the next one is 1 March 2027 (also not
    // leap). Day numbers: 01.09.2026 = 20697 (Hinnant, worked in the
    // lesson-count-period vectors), so 13.08.2026 = 20697 − 19 = 20678
    // (19 days from 13 Aug to 1 Sep). From 01.09.2026 to 01.03.2027 is
    // Sep(30)+Oct(31)+Nov(30)+Dec(31)+Jan(31)+Feb(28, 2027 not leap) = 181
    // days, so 01.03.2027 = 20697 + 181 = 20878. 20878 − 20678 = 200.
    expect(result.daysUntilNextBirthday).toBe(200);
  });

  it("carries the month borrow into the year when the month is behind too", () => {
    // Born 01.09.2019, measured 13.08.2026. d = 12 ≥ 0; m = 8 − 9 = −1 → m = 11,
    // g = 7 − 1 = 6. Months = 6·12 + 11 = 83.
    const result = childAge({
      birth: { year: 2019, month: 9, day: 1 },
      on: { year: 2026, month: 8, day: 13 },
      milestoneYears: 7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.years).toBe(6);
    expect(result.months).toBe(11);
    expect(result.days).toBe(12);
    expect(result.totalMonths).toBe(83);
    // 121 days left of 2019 after 01.09 (365 − 244) + 2192 for 2020..2025 + 225.
    expect(result.totalDays).toBe(2538);
    expect(result.borrow).toBeUndefined();
    expect(result.milestone).toEqual({ date: { year: 2026, month: 9, day: 1 }, shifted: false });
    // 01.09.2026 (the birthday this year) hasn't happened yet on 13.08.2026:
    // dayNumber(01.09.2026) = 20697, dayNumber(13.08.2026) = 20678 (see the
    // sibling test) → 20697 − 20678 = 19 days, which is also just Aug13→Aug31
    // (18 days) + 1.
    expect(result.daysUntilNextBirthday).toBe(19);
  });

  it("clamps the borrow when the birth day does not exist in the month that pays", () => {
    // Born 31.01.2020, measured 01.03.2020. The plain rule borrows February's
    // 29 days onto d = 1 − 31 = −30 and lands on −1, which is not a day count.
    // The anchor clamps to 29 February, giving 1 month and 1 day.
    const result = childAge({
      birth: { year: 2020, month: 1, day: 31 },
      on: { year: 2020, month: 3, day: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.years).toBe(0);
    expect(result.months).toBe(1);
    expect(result.days).toBe(1);
    expect(result.borrow).toEqual({ fromMonth: 2, fromMonthDays: 29, clamped: true });
    // 31.01 + 29 days = 29.02, + 1 day = 01.03 → 30 elapsed days.
    expect(result.totalDays).toBe(30);
  });

  it("keeps the birthday on 29 February in a leap year", () => {
    const result = childAge({
      birth: { year: 2020, month: 2, day: 29 },
      on: { year: 2026, month: 8, day: 13 },
      milestoneYears: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.milestone).toEqual({ date: { year: 2024, month: 2, day: 29 }, shifted: false });
  });

  it("reports zero days to the next birthday when `on` IS the birthday", () => {
    const result = childAge({
      birth: { year: 2015, month: 6, day: 10 },
      on: { year: 2026, month: 6, day: 10 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.daysUntilNextBirthday).toBe(0);
  });

  it("refuses a reference day before the birth rather than returning a minus sign", () => {
    expect(
      childAge({ birth: { year: 2020, month: 2, day: 29 }, on: { year: 2019, month: 1, day: 1 } }),
    ).toEqual({ ok: false, reason: "on" });
  });

  it("refuses a date the calendar does not have", () => {
    // 2021 is not a leap year, so there is no 29 February in it.
    expect(
      childAge({ birth: { year: 2021, month: 2, day: 29 }, on: { year: 2026, month: 8, day: 13 } }),
    ).toEqual({ ok: false, reason: "birth" });
    expect(
      childAge({ birth: { year: 2020, month: 1, day: 1 }, on: { year: 2026, month: 13, day: 1 } }),
    ).toEqual({ ok: false, reason: "on" });
    expect(
      childAge({
        birth: { year: 2020, month: 1, day: 1 },
        on: { year: 2026, month: 8, day: 13 },
        milestoneYears: 6.5,
      }),
    ).toEqual({ ok: false, reason: "milestoneYears" });
  });
});

describe("combinatorics", () => {
  it("counts the five standard quantities for n = 28 and k = 4", () => {
    const result = combinatorics({ n: 28, k: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 28·27 = 756; ·26 = 19656; ·25 = 491400.
    expect(result.variations).toBe(491400n);
    // 491400/24 = 20475.
    expect(result.combinations).toBe(20475n);
    // 28² = 784; 784² = 614656.
    expect(result.variationsWithRepetition).toBe(614656n);
    // C(31,4) = 31·30·29·28/24 = 755160/24 = 31465.
    expect(result.combinationsWithRepetition).toBe(31465n);
    expect(result.permutationsWithRepetition).toBeUndefined();
    // 28! is a 30-digit number (28! = 304888344611713860501504000000).
    expect(result.factorial.toString().length).toBe(30);
    expect(result.factorialDigits).toBe(30);
  });

  it("keeps a factorial past 2^53 exact, which a double cannot", () => {
    const result = combinatorics({ n: 21, k: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 20! = 2432902008176640000, and ×21 = 51090942171709440000 — already past
    // 2^53, so the last digits are exactly what a floating-point answer loses.
    expect(result.factorial).toBe(51090942171709440000n);
    // "51090942171709440000" is 20 characters long.
    expect(result.factorialDigits).toBe(20);
  });

  it("divides by the letter multiplicities for permutations with repetition", () => {
    // MATEMATIKA: 10 letters, M = 2, A = 3, T = 2, E = 1, I = 1, K = 1 (sum 10).
    // 10!/(2!·3!·2!) = 3628800/(2·6·2) = 3628800/24 = 151200.
    const result = combinatorics({ n: 10, k: 3, repeats: [2, 3, 2, 1, 1, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permutationsWithRepetition).toBe(151200n);
    expect(result.factorial).toBe(3628800n);
  });

  it("holds the empty-product edges", () => {
    const zero = combinatorics({ n: 0, k: 0 });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.factorial).toBe(1n); // 0! = 1
    expect(zero.factorialDigits).toBe(1); // "1" is one digit
    expect(zero.variationsWithRepetition).toBe(1n); // 0^0 = 1
    expect(zero.combinationsWithRepetition).toBe(1n); // one empty multiset

    const empty = combinatorics({ n: 0, k: 3 });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    // No multiset of size 3 exists over an empty set — C(k−1,k) would say 0 too
    // here, but only because n = 0 is taken out by hand.
    expect(empty.combinationsWithRepetition).toBe(0n);

    const none = combinatorics({ n: 5, k: 0 });
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    expect(none.variations).toBe(1n); // V(5,0), the empty product
    expect(none.combinations).toBe(1n); // C(5,0)
    expect(none.variationsWithRepetition).toBe(1n); // 5^0

    const all = combinatorics({ n: 5, k: 5 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.combinations).toBe(1n); // C(5,5)

    const over = combinatorics({ n: 5, k: 6 });
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    expect(over.combinations).toBe(0n); // C(5,6)
    expect(over.variations).toBe(0n); // V(5,6)
  });

  it("refuses rather than repairs", () => {
    expect(combinatorics({ n: -1, k: 2 })).toEqual({ ok: false, reason: "n" });
    expect(combinatorics({ n: 5.5, k: 2 })).toEqual({ ok: false, reason: "n" });
    expect(combinatorics({ n: 5, k: -2 })).toEqual({ ok: false, reason: "k" });
    // Multiplicities that outnumber the elements describe no word at all.
    expect(combinatorics({ n: 5, k: 2, repeats: [3, 3] })).toEqual({
      ok: false,
      reason: "repeats",
    });
    expect(combinatorics({ n: 5, k: 2, repeats: [0, 2] })).toEqual({
      ok: false,
      reason: "repeats",
    });
    expect(combinatorics({ n: 5, k: 2, repeats: [] })).toEqual({ ok: false, reason: "repeats" });
  });
});

describe("fractionArithmetic", () => {
  it("adds two fractions exactly and marks the period of the decimal", () => {
    // 3/4 + 5/6 = (18 + 20)/24 = 38/24; gcd 2 → 19/12 = 1 7/12 = 1.58(3).
    const result = fractionArithmetic({ a: 3, b: 4, operation: "+", c: 5, d: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(19n);
    expect(result.denominator).toBe(12n);
    expect(result.mixedWhole).toBe(1n);
    expect(result.mixedNumerator).toBe(7n); // 19 = 1·12 + 7
    expect(result.decimal?.integerDigits).toBe("1");
    expect(result.decimal?.nonRepeatingDigits).toBe("58");
    expect(result.decimal?.repeatingDigits).toBe("3");
    expect(result.decimal?.nonRepeatingLength).toBe(2);
    expect(result.decimal?.repeatingLength).toBe(1);
    // 100·19/12 = 158.3333…
    expect(result.percent).toBeCloseTo(158.333333, 6);
    // The underlying decimal repeats, so six decimals of a percent is a
    // truncation of it, not the exact value — flagged rather than left silent.
    expect(result.percentIsApproximate).toBe(true);
  });

  it("divides by inverting the right-hand fraction", () => {
    // 7/8 ÷ 3/4 = (7·4)/(8·3) = 28/24; gcd 4 → 7/6 = 1 1/6 = 1.1(6).
    const result = fractionArithmetic({ a: 7, b: 8, operation: "/", c: 3, d: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(7n);
    expect(result.denominator).toBe(6n);
    expect(result.mixedWhole).toBe(1n);
    expect(result.mixedNumerator).toBe(1n);
    expect(result.decimal?.nonRepeatingDigits).toBe("1");
    expect(result.decimal?.repeatingDigits).toBe("6");
    expect(result.percent).toBeCloseTo(116.666666, 6); // 700/6 = 116.6667
  });

  it("terminates when the denominator holds only twos and fives", () => {
    // 1/4 × 1/2 = 1/8 = 0.125 exactly: no period at all.
    const result = fractionArithmetic({ a: 1, b: 4, operation: "*", c: 1, d: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.denominator).toBe(8n);
    expect(result.decimal?.nonRepeatingDigits).toBe("125");
    expect(result.decimal?.repeatingDigits).toBe("");
    expect(result.decimal?.repeatingLength).toBe(0);
    expect(result.percent).toBeCloseTo(12.5, 10);
    // A terminating decimal makes `percent` exact, not a truncation.
    expect(result.percentIsApproximate).toBe(false);
  });

  it("marks a TERMINATING percent approximate when it needs a ninth digit", () => {
    // 1/512 = 1/2^9 terminates at nine digits: 0.001953125 exactly. Six
    // decimals of a percent is only eight decimals of the fraction, one short
    // of that ninth digit — so percentOf's own division truncates:
    // 100·1·10^6 = 100,000,000; 100,000,000 / 512 = 195312.5, and bigint
    // division truncates to 195312 (512·195312 = 99,999,744, remainder 256).
    // percent = 195312/10^6 = 0.195312, while the exact value is 0.1953125 —
    // a real truncation with a nonzero remainder, even though the decimal
    // expansion never repeats. `repeatingLength > 0` alone would miss this.
    const result = fractionArithmetic({ a: 1, b: 512, operation: "*", c: 1, d: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.denominator).toBe(512n);
    expect(result.decimal?.repeatingLength).toBe(0); // terminates, does not repeat
    expect(result.percent).toBeCloseTo(0.195312, 6);
    expect(result.percentIsApproximate).toBe(true);
  });

  it("keeps the sign in the numerator and the whole part truncated toward zero", () => {
    // 3/4 − 5/6 · nothing: (3·6 − 5·4)/24 = (18 − 20)/24 = −2/24 → −1/12.
    const small = fractionArithmetic({ a: 3, b: 4, operation: "-", c: 5, d: 6 });
    expect(small.ok).toBe(true);
    if (!small.ok) return;
    expect(small.numerator).toBe(-1n);
    expect(small.denominator).toBe(12n);
    expect(small.mixedWhole).toBe(0n);
    expect(small.decimal?.negative).toBe(true);

    // A negative denominator moves its sign up: 1/(−3) is −1/3, never 1/−3.
    const flipped = fractionArithmetic({ a: 1, b: -3, operation: "*", c: 1, d: 1 });
    expect(flipped.ok).toBe(true);
    if (!flipped.ok) return;
    expect(flipped.numerator).toBe(-1n);
    expect(flipped.denominator).toBe(3n);
    // −19/12 would be −1 and 7/12, never −2 and 5/12.
    const mixed = fractionArithmetic({ a: -19, b: 12, operation: "*", c: 1, d: 1 });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.mixedWhole).toBe(-1n);
    expect(mixed.mixedNumerator).toBe(7n);
  });

  it("reduces a zero to 0/1", () => {
    const result = fractionArithmetic({ a: 0, b: 7, operation: "*", c: 5, d: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(0n);
    expect(result.denominator).toBe(1n);
    expect(result.decimal?.integerDigits).toBe("0");
    expect(result.decimal?.nonRepeatingDigits).toBe("");
    expect(result.percent).toBe(0);
  });

  it("refuses rather than repairs", () => {
    expect(fractionArithmetic({ a: 1, b: 0, operation: "+", c: 1, d: 2 })).toEqual({
      ok: false,
      reason: "b",
    });
    expect(fractionArithmetic({ a: 1, b: 2, operation: "+", c: 1, d: 0 })).toEqual({
      ok: false,
      reason: "d",
    });
    // Dividing by 0/4 puts a zero in the denominator of the answer.
    expect(fractionArithmetic({ a: 1, b: 2, operation: "/", c: 0, d: 4 })).toEqual({
      ok: false,
      reason: "c",
    });
    expect(fractionArithmetic({ a: 1.5, b: 2, operation: "+", c: 1, d: 2 })).toEqual({
      ok: false,
      reason: "a",
    });
  });
});

describe("decimalToFraction", () => {
  it("turns a periodic decimal back into the fraction it came from", () => {
    // 0,1(6): I = 0, N = 1 (n = 1), R = 6 (r = 1).
    // numerator = 0·100 + 1·10 + 6 − (0·10 + 1) = 16 − 1 = 15;
    // denominator = 100 − 10 = 90.
    // 15/90, gcd 15 → 1/6, which reads back as 0,1(6).
    const result = decimalToFraction({
      negative: false,
      integerDigits: "0",
      nonRepeatingDigits: "1",
      repeatingDigits: "6",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(1n);
    expect(result.denominator).toBe(6n);
    expect(result.decimal?.nonRepeatingDigits).toBe("1");
    expect(result.decimal?.repeatingDigits).toBe("6");
    expect(result.percent).toBeCloseTo(16.666666, 6); // 100/6 = 16.6667
  });

  it("carries leading zeros of the non-repeating part through its LENGTH", () => {
    // 0,0(3): n = 2 even though N reads as 0.
    // numerator = 0·1000 + 0·10 + 3 − (0·100 + 0) = 3; denominator = 1000 − 100 = 900.
    // 3/900 → 1/300, not the 1/3 a parser that dropped the length would give.
    const result = decimalToFraction({
      negative: false,
      integerDigits: "0",
      nonRepeatingDigits: "00",
      repeatingDigits: "3",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(1n);
    expect(result.denominator).toBe(300n);
  });

  it("gives 0,(9) the value the arithmetic gives it", () => {
    // I = 0, n = 0, R = 9, r = 1 → numerator = 9 − 0 = 9, denominator = 10 − 1 = 9 → 1/1.
    const result = decimalToFraction({
      negative: false,
      integerDigits: "0",
      nonRepeatingDigits: "",
      repeatingDigits: "9",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(1n);
    expect(result.denominator).toBe(1n);
    expect(result.percent).toBe(100);
  });

  it("handles a terminating decimal and a sign", () => {
    // −2,75: r = 0 → (2·100 + 75)/100 = 275/100; gcd 25 → 11/4, negated.
    const result = decimalToFraction({
      negative: true,
      integerDigits: "2",
      nonRepeatingDigits: "75",
      repeatingDigits: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(-11n);
    expect(result.denominator).toBe(4n);
    expect(result.mixedWhole).toBe(-2n);
    expect(result.mixedNumerator).toBe(3n);
    expect(result.percent).toBe(-275);
  });

  it("withholds `percent` rather than printing Infinity when it overflows a double", () => {
    // A 300-digit integer times 100 is about 1e302 — large, but still under
    // Number.MAX_VALUE (~1.8e308) — so percent is still a finite number.
    const large = decimalToFraction({
      negative: false,
      integerDigits: "9".repeat(300),
      nonRepeatingDigits: "",
      repeatingDigits: "",
    });
    expect(large.ok).toBe(true);
    if (!large.ok) return;
    if (large.percent === undefined) throw new Error("expected a finite percent");
    expect(Number.isFinite(large.percent)).toBe(true);

    // A 310-digit integer times 100 is about 1e312, past Number.MAX_VALUE:
    // `Number(bigint)` overflows silently to Infinity, and this result used to
    // come back as `{ ok: true, percent: Infinity }` — a refusal hiding inside
    // a success. It is withheld instead, and the exact fraction still stands.
    const huge = decimalToFraction({
      negative: false,
      integerDigits: "9".repeat(310),
      nonRepeatingDigits: "",
      repeatingDigits: "",
    });
    expect(huge.ok).toBe(true);
    if (!huge.ok) return;
    expect(huge.percent).toBeUndefined();
    expect(huge.percentIsApproximate).toBe(true);
    expect(huge.numerator).toBe(BigInt("9".repeat(310)));
  });

  it("refuses rather than repairs", () => {
    expect(
      decimalToFraction({
        negative: false,
        integerDigits: "1a",
        nonRepeatingDigits: "",
        repeatingDigits: "",
      }),
    ).toEqual({ ok: false, reason: "integerDigits" });
    expect(
      decimalToFraction({
        negative: false,
        integerDigits: "0",
        nonRepeatingDigits: "-1",
        repeatingDigits: "",
      }),
    ).toEqual({ ok: false, reason: "nonRepeatingDigits" });
    expect(
      decimalToFraction({
        negative: false,
        integerDigits: "0",
        nonRepeatingDigits: "",
        repeatingDigits: "6x",
      }),
    ).toEqual({ ok: false, reason: "repeatingDigits" });
    // Nothing typed at all is not a zero.
    expect(
      decimalToFraction({
        negative: false,
        integerDigits: "",
        nonRepeatingDigits: "",
        repeatingDigits: "",
      }),
    ).toEqual({ ok: false, reason: "digits" });
  });
});

describe("gradeScalePoints", () => {
  it("converts five percent thresholds on a 47-point paper, rounding minima UP", () => {
    // Bc = 4700, kc = 100, perStep = 1,000,000.
    // 91%: 9100·4700 = 42,770,000 → ceil(42.77) = 43 → 43.00 pts,
    //   100·43/47 = 91.489… → 91.49%.
    // 81%: 8100·4700 = 38,070,000 → ceil(38.07) = 39 → 39.00 pts,
    //   39/47 = 82.9787… → 82.98%.
    // 66%: 6600·4700 = 31,020,000 → ceil(31.02) = 32 → 32.00 pts,
    //   32/47 = 68.0851… → 68.09%.
    // 51%: 5100·4700 = 23,970,000 → ceil(23.97) = 24 → 24.00 pts,
    //   24/47 = 51.0638… → 51.06%.
    //  0%: 0 pts.
    const result = gradeScalePoints({
      maxPoints: 47,
      step: 1,
      thresholds: [91, 81, 66, 51, 0],
      scoredPoints: 38,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(5);
    const byIndex = (i: number) => result.rows.find((r) => r.index === i);
    expect(byIndex(0)?.minPoints).toBeCloseTo(43, 10);
    expect(byIndex(0)?.minPercent).toBeCloseTo(91.489362, 6);
    expect(byIndex(0)?.band?.from).toBeCloseTo(43, 10);
    expect(byIndex(0)?.band?.to).toBeCloseTo(47, 10); // top row runs to B
    expect(byIndex(1)?.minPoints).toBeCloseTo(39, 10);
    expect(byIndex(1)?.band?.from).toBeCloseTo(39, 10);
    expect(byIndex(1)?.band?.to).toBeCloseTo(42, 10); // 43 − step(1)
    expect(byIndex(2)?.minPoints).toBeCloseTo(32, 10);
    expect(byIndex(2)?.band?.to).toBeCloseTo(38, 10);
    expect(byIndex(3)?.minPoints).toBeCloseTo(24, 10);
    expect(byIndex(3)?.band?.to).toBeCloseTo(31, 10);
    expect(byIndex(4)?.minPoints).toBeCloseTo(0, 10);
    expect(byIndex(4)?.band?.from).toBeCloseTo(0, 10);
    expect(byIndex(4)?.band?.to).toBeCloseTo(23, 10);
    expect(result.unlabelled).toBeUndefined(); // lowest threshold IS 0%
    // 38 scored: 10000·3800 = 38,000,000, which is BELOW the 81% product
    // (38,070,000) even though 38/47 = 80.85% "looks" nearly 81 — the
    // comparison is over the integer products, never the rounded percent.
    expect(result.scored?.index).toBe(2);
    expect(result.scored?.percent).toBeCloseTo(80.851064, 6);
  });

  it("handles a half-point step and an unlabelled band below the lowest row", () => {
    // Bc = 1500, kc = 50, perStep = 500,000.
    // A 85%: 8500·1500 = 12,750,000 → ceil(25.5) = 26 → 26·0.5 = 13.0 pts, 13/15 = 86.67%.
    // B 70%: 7000·1500 = 10,500,000 → ceil(21.0) = 21 → 10.5 pts, 10.5/15 = 70.00%.
    // C 55%: 5500·1500 = 8,250,000 → ceil(16.5) = 17 → 8.5 pts, 8.5/15 = 56.67%.
    const result = gradeScalePoints({ maxPoints: 15, step: 0.5, thresholds: [85, 70, 55] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byIndex = (i: number) => result.rows.find((r) => r.index === i);
    expect(byIndex(0)?.minPoints).toBeCloseTo(13, 10);
    expect(byIndex(0)?.minPercent).toBeCloseTo(86.666667, 6);
    expect(byIndex(0)?.band?.from).toBeCloseTo(13, 10);
    expect(byIndex(0)?.band?.to).toBeCloseTo(15, 10);
    expect(byIndex(1)?.minPoints).toBeCloseTo(10.5, 10);
    expect(byIndex(1)?.band?.to).toBeCloseTo(12.5, 10); // 13.0 − step(0.5)
    expect(byIndex(2)?.minPoints).toBeCloseTo(8.5, 10);
    expect(byIndex(2)?.band?.to).toBeCloseTo(10, 10); // 10.5 − 0.5
    // Below 8.5 (0–8.0) carries no label — no row's minimum is 0.
    expect(result.unlabelled?.from).toBeCloseTo(0, 10);
    expect(result.unlabelled?.to).toBeCloseTo(8, 10); // 8.5 − step(0.5)
  });

  it("refuses rather than repairs", () => {
    expect(gradeScalePoints({ maxPoints: 0, step: 1, thresholds: [50] })).toEqual({
      ok: false,
      reason: "maxPoints",
    });
    expect(gradeScalePoints({ maxPoints: 10, step: 0, thresholds: [50] })).toEqual({
      ok: false,
      reason: "step",
    });
    // A step larger than the maximum can never reach a threshold at all.
    expect(gradeScalePoints({ maxPoints: 10, step: 20, thresholds: [50] })).toEqual({
      ok: false,
      reason: "step",
    });
    expect(gradeScalePoints({ maxPoints: 10, step: 1, thresholds: [] })).toEqual({
      ok: false,
      reason: "thresholds",
    });
    // Two rows on the same threshold leave no band between them.
    expect(gradeScalePoints({ maxPoints: 10, step: 1, thresholds: [50, 50] })).toEqual({
      ok: false,
      reason: "duplicateThreshold",
    });
    // Scored points outside [0, B] are refused, not clamped into range.
    expect(
      gradeScalePoints({ maxPoints: 10, step: 1, thresholds: [50], scoredPoints: 11 }),
    ).toEqual({ ok: false, reason: "scoredPoints" });
  });

  it("never awards scored.index to a row its own minimum could not reach", () => {
    // Bc = 1000, kc = 300, perStep = 10000·300 = 3,000,000.
    // 100%: 10000·1000 = 10,000,000 → ceil(10,000,000/3,000,000) = ceil(3.333) = 4
    //   steps → minC = 4·300 = 1200 > Bc(1000) → UNREACHABLE, no band at all.
    // 50%: 5000·1000 = 5,000,000 → ceil(1.667) = 2 steps → minC = 600 ≤ 1000 →
    //   reachable, spans 6.00..10.00 (nothing reachable sits above it).
    // scoredPoints = 10 → scoredC = 1000: against the 100% row,
    //   10000·1000 = 10,000,000 ≥ 10000·1000 = 10,000,000 holds — the raw
    //   product says "reached" even though the row it names took no band.
    //   Skipping unreachable rows falls through to 50%, whose own product
    //   10,000,000 ≥ 5000·1000 = 5,000,000 also holds — so scored.index must
    //   name the 50% row (thresholds index 1), never the unreachable 100% one
    //   (index 0).
    const result = gradeScalePoints({
      maxPoints: 10,
      step: 3,
      thresholds: [100, 50],
      scoredPoints: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byIndex = (i: number) => result.rows.find((r) => r.index === i);
    expect(byIndex(0)?.band).toBeUndefined(); // an unreachable row takes NO band at all
    expect(byIndex(1)?.band).toBeDefined();
    expect(byIndex(1)?.band?.from).toBeCloseTo(6, 10);
    expect(result.scored?.percent).toBeCloseTo(100, 10);
    expect(result.scored?.index).toBe(1);
  });
});

describe("parseValueList", () => {
  it("reads the Serbian comma as a decimal mark and never as a separator", () => {
    // "3,5" is ONE value (3.5), not a 3 and a separate 5.
    const result = parseValueList("3,5 2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toEqual([3.5, 2]);
  });

  it("splits on whitespace, semicolons and newlines interchangeably", () => {
    const result = parseValueList("5 4;4\n3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toEqual([5, 4, 4, 3]);
  });

  it("names the offending token by its 1-based position", () => {
    expect(parseValueList("5 4 abc 3")).toEqual({ ok: false, reason: "token:3" });
  });

  it("refuses an empty list rather than an empty result", () => {
    expect(parseValueList("   ")).toEqual({ ok: false, reason: "values" });
  });
});

describe("gradeStatistics", () => {
  it("summarises ten marks with a threshold, matching the moment-by-moment hand count", () => {
    // Sorted: 1,2,3,3,4,4,4,5,5,5. Sum = 36, mean = 3.60.
    // Median: (x[4]+x[5])/2 = (4+4)/2 = 4.00.
    // Q1 = median of {1,2,3,3,4} = 3; Q3 = median of {4,4,5,5,5} = 5; IQR = 2.
    // Deviations²: 6.76 + 2.56 + 2·0.36 + 3·0.16 + 3·1.96 = 16.40.
    // σ² = 16.40/10 = 1.64, σ = √1.64 = 1.2806…; s² = 16.40/9 = 1.8222…, s = 1.3499….
    const result = gradeStatistics({
      values: [5, 4, 4, 3, 5, 2, 4, 3, 5, 1],
      passThreshold: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(10);
    expect(result.sum).toBe(36);
    expect(result.mean).toBeCloseTo(3.6, 10);
    expect(result.min).toBe(1);
    expect(result.max).toBe(5);
    expect(result.range).toBe(4);
    expect(result.median).toBeCloseTo(4, 10);
    expect(result.quartiles).toEqual({ q1: 3, q3: 5, iqr: 2, degenerate: false }); // n = 10 ≥ 4
    expect(result.populationVariance).toBeCloseTo(1.64, 10);
    expect(result.populationDeviation).toBeCloseTo(1.280625, 6);
    expect(result.sample?.variance).toBeCloseTo(1.822222, 6);
    expect(result.sample?.deviation).toBeCloseTo(1.349897, 6);
    expect(result.modes).toEqual([4, 5]); // both tied at frequency 3
    expect(result.frequencies).toEqual([
      { value: 1, count: 1, share: 10 },
      { value: 2, count: 1, share: 10 },
      { value: 3, count: 2, share: 20 },
      { value: 4, count: 3, share: 30 },
      { value: 5, count: 3, share: 30 },
    ]);
    expect(result.quartileMethod).toBe("moore-mccabe-exclusive");
    // Values ≥ 2: everything except the single 1 → 9 of 10.
    expect(result.atOrAbove?.count).toBe(9);
    expect(result.atOrAbove?.percent).toBeCloseTo(90, 10);
  });

  it("computes an odd-count sample with no threshold given", () => {
    // Sorted: 7,12,15,20,20. Sum = 74, mean = 14.80. Median = x[2] = 15.
    // Q1 = median{7,12} = 9.50; Q3 = median{20,20} = 20.00; IQR = 10.50.
    // Deviations²: 60.84 + 7.84 + 0.04 + 2·27.04 = 122.80.
    // σ² = 122.80/5 = 24.56, σ = 4.9558…; s² = 122.80/4 = 30.70, s = 5.5408….
    const result = gradeStatistics({ values: [12, 20, 20, 7, 15] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mean).toBeCloseTo(14.8, 10);
    expect(result.median).toBe(15);
    expect(result.quartiles?.q1).toBeCloseTo(9.5, 10);
    expect(result.quartiles?.q3).toBeCloseTo(20, 10);
    expect(result.quartiles?.iqr).toBeCloseTo(10.5, 10);
    expect(result.quartiles?.degenerate).toBe(false); // n = 5 ≥ 4
    expect(result.modes).toEqual([20]);
    expect(result.populationVariance).toBeCloseTo(24.56, 10);
    // sqrt(24.56) = sqrt(614)/5 = 24.7790234…/5 = 4.9558047…
    expect(result.populationDeviation).toBeCloseTo(4.955805, 5);
    expect(result.sample?.variance).toBeCloseTo(30.7, 10);
    expect(result.sample?.deviation).toBeCloseTo(5.540758, 6);
    expect(result.atOrAbove).toBeUndefined();
  });

  it("lists EVERY value tied for the highest frequency — the reviewer's own case", () => {
    // {1,1,2,2}: both values occur twice, which IS the highest frequency (2),
    // so "no mode" (reserved for a highest frequency of 1) must not apply —
    // the old rule ("all distinct values share a frequency ⇒ no mode") would
    // wrongly return [] here.
    const tied = gradeStatistics({ values: [1, 1, 2, 2] });
    expect(tied.ok).toBe(true);
    if (!tied.ok) return;
    expect(tied.modes).toEqual([1, 2]);

    // Every value distinct (highest frequency 1) IS the "no mode" case.
    const none = gradeStatistics({ values: [1, 2, 3] });
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    expect(none.modes).toEqual([]);
  });

  it("leaves Q1/Q3/IQR undefined for a single value — both halves are empty", () => {
    const result = gradeStatistics({ values: [7] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.median).toBe(7);
    // n = 1 has neither half, so there is no quartile group to be degenerate
    // ABOUT — the absence is the stronger statement the flag used to make.
    expect(result.quartiles).toBeUndefined();
    expect(result.sample).toBeUndefined(); // n − 1 = 0
    expect(result.populationVariance).toBe(0);
  });

  it("marks n = 2 and n = 3 as degenerate though the method still returns a number", () => {
    // n = 2: donja polovina {10}, gornja polovina {30} — Q1 and Q3 are each a
    // single raw value, not a real median of anything.
    const two = gradeStatistics({ values: [30, 10] });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.quartiles).toEqual({ q1: 10, q3: 30, iqr: 20, degenerate: true });

    // n = 3: donja polovina {4}, gornja polovina {12} — the middle value (8)
    // belongs to neither half, by the exclusive method's own rule.
    const three = gradeStatistics({ values: [4, 8, 12] });
    expect(three.ok).toBe(true);
    if (!three.ok) return;
    expect(three.quartiles).toEqual({ q1: 4, q3: 12, iqr: 8, degenerate: true });

    // n = 4 is the first count where the exclusive split gives each half two
    // values of its own — no longer degenerate.
    expect(gradeStatistics({ values: [1, 2, 3, 4] })).toMatchObject({
      quartiles: { degenerate: false },
    });
  });

  it("refuses rather than repairs", () => {
    expect(gradeStatistics({ values: [] })).toEqual({ ok: false, reason: "values" });
    expect(gradeStatistics({ values: [1, Number.NaN] })).toEqual({ ok: false, reason: "values" });
    expect(gradeStatistics({ values: [1, 2], passThreshold: Number.POSITIVE_INFINITY })).toEqual({
      ok: false,
      reason: "passThreshold",
    });
  });
});

describe("guessingCorrection", () => {
  it("corrects 26 right / 12 wrong out of 40 four-option questions", () => {
    // S = 26 − 12/(4−1) = 26 − 4 = 22.00; ·1 point = 22.00; 100·22/40 = 55.00%.
    // Pure guessing: 40/4 = 10 expected right BEFORE correction.
    const result = guessingCorrection({
      questions: 40,
      right: 26,
      wrong: 12,
      unanswered: 2,
      options: 4,
      pointsPerQuestion: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.corrected).toBeCloseTo(22, 10);
    expect(result.points).toBeCloseTo(22, 10);
    expect(result.percentOfMax).toBeCloseTo(55, 10);
    expect(result.expectedCorrectBeforeCorrection).toBeCloseTo(10, 10);
    // What that same pure guessing is worth AFTER the correction — not 10, 0.
    expect(result.expectedAfterCorrection).toBe(0);
    expect(result.answeredMismatch).toBe(0); // 26+12+2 = 40
  });

  it("scales by points per question and allows a fractional correction", () => {
    // S = 14 − 6/(5−1) = 14 − 1.5 = 12.50; ·2 points = 25.00; 100·12.5/20 = 62.50%.
    const result = guessingCorrection({
      questions: 20,
      right: 14,
      wrong: 6,
      unanswered: 0,
      options: 5,
      pointsPerQuestion: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.corrected).toBeCloseTo(12.5, 10);
    expect(result.points).toBeCloseTo(25, 10);
    expect(result.percentOfMax).toBeCloseTo(62.5, 10);
    expect(result.expectedCorrectBeforeCorrection).toBeCloseTo(4, 10);
  });

  it("shows a negative correction without clamping it to zero", () => {
    // S = 3 − 7/(2−1) = 3 − 7 = −4.00; 100·(−4)/10 = −40.00%.
    const result = guessingCorrection({
      questions: 10,
      right: 3,
      wrong: 7,
      unanswered: 0,
      options: 2,
      pointsPerQuestion: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.corrected).toBeCloseTo(-4, 10);
    expect(result.percentOfMax).toBeCloseTo(-40, 10);
    expect(result.expectedCorrectBeforeCorrection).toBeCloseTo(5, 10);
  });

  it("reports the mismatch rather than refusing when the counts do not add up", () => {
    // 26 + 12 + 1 = 39 ≠ 40 → mismatch = 39 − 40 = −1, and the answer still stands.
    const result = guessingCorrection({
      questions: 40,
      right: 26,
      wrong: 12,
      unanswered: 1,
      options: 4,
      pointsPerQuestion: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answeredMismatch).toBe(-1);
    expect(result.corrected).toBeCloseTo(22, 10);
  });

  it("refuses rather than repairs", () => {
    expect(
      guessingCorrection({
        questions: 40,
        right: 26,
        wrong: 12,
        unanswered: 2,
        options: 1,
        pointsPerQuestion: 1,
      }),
    ).toEqual({ ok: false, reason: "options" }); // k = 1 divides by zero
    expect(
      guessingCorrection({
        questions: 0,
        right: 0,
        wrong: 0,
        unanswered: 0,
        options: 4,
        pointsPerQuestion: 1,
      }),
    ).toEqual({ ok: false, reason: "questions" });
    expect(
      guessingCorrection({
        questions: 40,
        right: 26,
        wrong: 12,
        unanswered: 2,
        options: 4,
        pointsPerQuestion: 0,
      }),
    ).toEqual({ ok: false, reason: "pointsPerQuestion" });
  });
});

describe("itemAnalysis", () => {
  it("computes facility and discrimination for a 30-student class", () => {
    // p = 18/30 = 0.60 → 60.00%. Upper 7/8 = 0.875, lower 3/8 = 0.375.
    // D = 0.875 − 0.375 = 0.50. Coverage = 100·(8+8)/30 = 53.3333…%.
    const result = itemAnalysis({
      correct: 18,
      students: 30,
      upper: { correct: 7, size: 8 },
      lower: { correct: 3, size: 8 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facility).toBeCloseTo(0.6, 10);
    expect(result.facilityPercent).toBeCloseTo(60, 10);
    expect(result.n).toBe(30);
    expect(result.upperRate).toBeCloseTo(0.875, 10);
    expect(result.lowerRate).toBeCloseTo(0.375, 10);
    expect(result.discrimination).toBeCloseTo(0.5, 10);
    expect(result.groupCoveragePercent).toBeCloseTo(53.333333, 6);
  });

  it("shows a zero discrimination when every student gets the item right", () => {
    // p = 25/25 = 1.00; both groups 7/7 = 1.000; D = 0.
    const result = itemAnalysis({
      correct: 25,
      students: 25,
      upper: { correct: 7, size: 7 },
      lower: { correct: 7, size: 7 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facilityPercent).toBeCloseTo(100, 10);
    expect(result.discrimination).toBeCloseTo(0, 10);
    expect(result.groupCoveragePercent).toBeCloseTo(56, 10); // 100·14/25
  });

  it("prints a negative discrimination without clamping it", () => {
    // p = 4/20 = 0.20; upper 1/5 = 0.200, lower 3/5 = 0.600; D = −0.40.
    const result = itemAnalysis({
      correct: 4,
      students: 20,
      upper: { correct: 1, size: 5 },
      lower: { correct: 3, size: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facilityPercent).toBeCloseTo(20, 10);
    expect(result.discrimination).toBeCloseTo(-0.4, 10);
  });

  it("widens N by the unanswered count only when told to treat them as wrong", () => {
    const excluded = itemAnalysis({
      correct: 10,
      students: 18,
      unanswered: 5,
      unansweredTreatment: "excluded",
    });
    expect(excluded.ok).toBe(true);
    if (!excluded.ok) return;
    expect(excluded.n).toBe(18);
    expect(excluded.facility).toBeCloseTo(10 / 18, 10);

    const asIncorrect = itemAnalysis({
      correct: 10,
      students: 18,
      unanswered: 5,
      unansweredTreatment: "asIncorrect",
    });
    expect(asIncorrect.ok).toBe(true);
    if (!asIncorrect.ok) return;
    expect(asIncorrect.n).toBe(23); // 18 + 5
    expect(asIncorrect.facility).toBeCloseTo(10 / 23, 10);
  });

  it("refuses rather than repairs", () => {
    expect(itemAnalysis({ correct: 5, students: 4 })).toEqual({ ok: false, reason: "correct" });
    expect(itemAnalysis({ correct: 5, students: 10, unanswered: 2 })).toEqual({
      ok: false,
      reason: "unansweredTreatment",
    });
    expect(
      itemAnalysis({ correct: 5, students: 10, unansweredTreatment: "excluded" }),
    ).toEqual({ ok: false, reason: "unansweredTreatment" });
    // The groups together claim more students than the whole item had.
    expect(
      itemAnalysis({
        correct: 5,
        students: 10,
        upper: { correct: 4, size: 8 },
        lower: { correct: 1, size: 5 },
      }),
    ).toEqual({ ok: false, reason: "groups" });
    // The groups together claim more CORRECT answers than the item had.
    expect(
      itemAnalysis({
        correct: 5,
        students: 10,
        upper: { correct: 4, size: 4 },
        lower: { correct: 4, size: 4 },
      }),
    ).toEqual({ ok: false, reason: "groups" });
    // A SINGLE group, with no second group to trip the combined check, still
    // cannot claim more students (20) than the item had (n = 10).
    expect(itemAnalysis({ correct: 5, students: 10, upper: { correct: 4, size: 20 } })).toEqual({
      ok: false,
      reason: "upper",
    });
    // Nor more correct answers (6) than the item had (correct = 5), alone.
    expect(itemAnalysis({ correct: 5, students: 10, lower: { correct: 6, size: 8 } })).toEqual({
      ok: false,
      reason: "lower",
    });
  });
});

describe("lessonCountPeriod", () => {
  it("counts a full term's Tuesdays and Thursdays, one exclusion applied and one ignored", () => {
    // Day numbers (Hinnant): 01.09.2026 = 20697 (ISO 2, Tuesday), 31.12.2026 = 20818 (ISO 4).
    // Tuesdays: first = 20697, count = floor((20818−20697)/7)+1 = 17+1 = 18.
    // Thursdays: first = 20699, count = floor((20818−20699)/7)+1 = 17+1 = 18.
    // 15.10.2026 = day 20741 (Thursday) is IN period and chosen → excluded, 18→17.
    // 11.11.2026 = day 20768 (Wednesday) is IN period but NOT a chosen weekday → ignored.
    // Total sessions = 18+17 = 35; ·45 min = 1575 min = 26 h 15 min.
    const result = lessonCountPeriod({
      start: { year: 2026, month: 9, day: 1 },
      end: { year: 2026, month: 12, day: 31 },
      weekdays: [
        { weekday: 2, lessons: 1 },
        { weekday: 4, lessons: 1 },
      ],
      excludedDates: [
        { year: 2026, month: 10, day: 15 },
        { year: 2026, month: 11, day: 11 },
      ],
      lessonMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tuesday = result.days.find((d) => d.weekday === 2);
    const thursday = result.days.find((d) => d.weekday === 4);
    expect(tuesday?.occurrences).toBe(18);
    expect(tuesday?.excluded).toBe(0);
    expect(tuesday?.sessions).toBe(18);
    expect(thursday?.occurrences).toBe(18);
    expect(thursday?.excluded).toBe(1);
    expect(thursday?.sessions).toBe(17);
    expect(result.totalSessions).toBe(35);
    expect(result.totalLessons).toBe(35);
    expect(result.totalMinutes).toBe(1575);
    expect(result.hours).toBe(26);
    expect(result.minutes).toBe(15);
    expect(result.lessonMinutes).toBe(45);
    expect(result.ignoredOffPeriod).toBe(0);
    expect(result.ignoredOffWeekday).toBe(1); // the Wednesday
    expect(result.appliedExclusions).toEqual([
      { date: { year: 2026, month: 10, day: 15 }, weekday: 4 },
    ]);
    expect(result.ignoredExclusions).toEqual([
      { date: { year: 2026, month: 11, day: 11 }, reason: "offWeekday" },
    ]);
    expect(result.prescribed).toBeUndefined();
  });

  it("tells apart the three reasons an excluded date can change nothing", () => {
    // Same term as above. 15.10.2026 (Thursday) is chosen and applies; a
    // second copy of it is a duplicate; 11.11.2026 (Wednesday) is not a chosen
    // weekday; 31.08.2026 is the day before the period starts.
    const result = lessonCountPeriod({
      start: { year: 2026, month: 9, day: 1 },
      end: { year: 2026, month: 12, day: 31 },
      weekdays: [
        { weekday: 2, lessons: 1 },
        { weekday: 4, lessons: 1 },
      ],
      excludedDates: [
        { year: 2026, month: 10, day: 15 },
        { year: 2026, month: 10, day: 15 },
        { year: 2026, month: 11, day: 11 },
        { year: 2026, month: 8, day: 31 },
      ],
      lessonMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedExclusions).toEqual([
      { date: { year: 2026, month: 10, day: 15 }, weekday: 4 },
    ]);
    expect(result.ignoredExclusions).toEqual([
      { date: { year: 2026, month: 10, day: 15 }, reason: "duplicate" },
      { date: { year: 2026, month: 11, day: 11 }, reason: "offWeekday" },
      { date: { year: 2026, month: 8, day: 31 }, reason: "offPeriod" },
    ]);
    expect(result.ignoredOffPeriod).toBe(2); // the duplicate and the out-of-period date
    expect(result.ignoredOffWeekday).toBe(1);
  });

  it("counts four Mondays across a January stretch, no exclusions", () => {
    // 04.01.2027 = day 20822 (ISO 1, Monday); 31.01.2027 = day 20849.
    // count = floor((20849−20822)/7)+1 = 3+1 = 4 → 04, 11, 18, 25 January.
    // Hours = 4·2 = 8; ·45 min = 360 min = 6 h 0 min.
    const result = lessonCountPeriod({
      start: { year: 2027, month: 1, day: 4 },
      end: { year: 2027, month: 1, day: 31 },
      weekdays: [{ weekday: 1, lessons: 2 }],
      excludedDates: [],
      lessonMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]?.occurrences).toBe(4);
    expect(result.totalLessons).toBe(8);
    expect(result.totalMinutes).toBe(360);
    expect(result.hours).toBe(6);
    expect(result.minutes).toBe(0);
    expect(result.ignoredOffPeriod).toBe(0);
    expect(result.ignoredOffWeekday).toBe(0);
  });

  it("compares the computed total against a prescribed syllabus figure, with no verdict", () => {
    const result = lessonCountPeriod({
      start: { year: 2026, month: 9, day: 1 },
      end: { year: 2026, month: 12, day: 31 },
      weekdays: [
        { weekday: 2, lessons: 1 },
        { weekday: 4, lessons: 1 },
      ],
      excludedDates: [
        { year: 2026, month: 10, day: 15 },
        { year: 2026, month: 11, day: 11 },
      ],
      lessonMinutes: 45,
      prescribedHours: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalLessons).toBe(35);
    expect(result.prescribed?.hours).toBe(40);
    expect(result.prescribed?.difference).toBe(-5);
    expect(result.prescribed?.ratio).toBeCloseTo(0.875, 10); // 35/40
  });

  it("moves one date's session onto a different weekday's timetable", () => {
    // 01.09.2026 = day 20697 (Tuesday). Period is just 01–02 September.
    // Tuesday occurrence: {20697}. Wednesday occurrence: {20698} (03.09 is out
    // of range, so only 02.09 counts). The makeup day takes 01.09 (a Tuesday)
    // OFF Tuesday's timetable and puts it ON Wednesday's — Tuesday loses its
    // only session (1 → 0), Wednesday gains a second one (1 → 2).
    const result = lessonCountPeriod({
      start: { year: 2026, month: 9, day: 1 },
      end: { year: 2026, month: 9, day: 2 },
      weekdays: [
        { weekday: 2, lessons: 1 },
        { weekday: 3, lessons: 1 },
      ],
      excludedDates: [],
      makeupDays: [{ date: { year: 2026, month: 9, day: 1 }, followsWeekday: 3 }],
      lessonMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tuesday = result.days.find((d) => d.weekday === 2);
    const wednesday = result.days.find((d) => d.weekday === 3);
    expect(tuesday?.occurrences).toBe(1);
    expect(tuesday?.makeupAway).toBe(1);
    expect(tuesday?.sessions).toBe(0);
    expect(wednesday?.occurrences).toBe(1);
    expect(wednesday?.makeupInto).toBe(1);
    expect(wednesday?.sessions).toBe(2);
    expect(result.totalSessions).toBe(2);
    expect(result.totalLessons).toBe(2);
    expect(result.totalMinutes).toBe(90);
  });

  it("refuses rather than repairs", () => {
    const base = {
      start: { year: 2026, month: 9, day: 1 },
      end: { year: 2026, month: 9, day: 2 },
      weekdays: [{ weekday: 2, lessons: 1 }],
      lessonMinutes: 45,
    };
    expect(
      lessonCountPeriod({ ...base, end: { year: 2026, month: 8, day: 31 }, excludedDates: [] }),
    ).toEqual({ ok: false, reason: "end" });
    // A date that does not exist on the calendar (31.11) is refused, not
    // silently normalised into a neighbouring day.
    expect(
      lessonCountPeriod({
        ...base,
        excludedDates: [{ year: 2026, month: 11, day: 31 }],
      }),
    ).toEqual({ ok: false, reason: "excludedDates" });
    // Excluding AND making up the same date says opposite things about it.
    expect(
      lessonCountPeriod({
        ...base,
        excludedDates: [{ year: 2026, month: 9, day: 1 }],
        makeupDays: [{ date: { year: 2026, month: 9, day: 1 }, followsWeekday: 3 }],
      }),
    ).toEqual({ ok: false, reason: "makeupDays" });
    // A makeup date outside the period is refused, not silently dropped.
    expect(
      lessonCountPeriod({
        ...base,
        excludedDates: [],
        makeupDays: [{ date: { year: 2026, month: 9, day: 10 }, followsWeekday: 3 }],
      }),
    ).toEqual({ ok: false, reason: "makeupDays" });
    // The same date given twice as a makeup is ambiguous about which schedule wins.
    expect(
      lessonCountPeriod({
        ...base,
        excludedDates: [],
        makeupDays: [
          { date: { year: 2026, month: 9, day: 1 }, followsWeekday: 3 },
          { date: { year: 2026, month: 9, day: 1 }, followsWeekday: 2 },
        ],
      }),
    ).toEqual({ ok: false, reason: "makeupDays" });
  });
});

describe("lessonTimeline", () => {
  it("lays out four activities inside a 45-minute lesson with nothing left over", () => {
    // t0 = 480. Cumulative 5, 25, 40, 45 →
    //   08:00–08:05, 08:05–08:25, 08:25–08:40, 08:40–08:45.
    // Shares: 100·5/45 = 11.11%, 100·20/45 = 44.44%, 100·15/45 = 33.33%, 11.11%.
    const result = lessonTimeline({
      startHour: 8,
      startMinute: 0,
      durations: [5, 20, 15, 5],
      lessonMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.start)).toEqual([
      { hour: 8, minute: 0, dayOffset: 0 },
      { hour: 8, minute: 5, dayOffset: 0 },
      { hour: 8, minute: 25, dayOffset: 0 },
      { hour: 8, minute: 40, dayOffset: 0 },
    ]);
    expect(result.rows.map((r) => r.end)).toEqual([
      { hour: 8, minute: 5, dayOffset: 0 },
      { hour: 8, minute: 25, dayOffset: 0 },
      { hour: 8, minute: 40, dayOffset: 0 },
      { hour: 8, minute: 45, dayOffset: 0 },
    ]);
    // 100·5/45 = 11.1111…, 100·20/45 = 44.4444…, 100·15/45 = 33.3333…, 11.1111….
    expect(result.rows[0]?.share).toBeCloseTo(11.111111, 6);
    expect(result.rows[1]?.share).toBeCloseTo(44.444444, 6);
    expect(result.rows[2]?.share).toBeCloseTo(33.333333, 6);
    expect(result.rows[3]?.share).toBeCloseTo(11.111111, 6);
    expect(result.totalMinutes).toBe(45);
    expect(result.end).toEqual({ hour: 8, minute: 45, dayOffset: 0 });
    expect(result.slack).toBe(0);
  });

  it("reports an overrun as a negative slack", () => {
    // t0 = 800. Cumulative 10, 35, 50 → 13:20–13:30, 13:30–13:55, 13:55–14:10.
    // Shares 20.00%, 50.00%, 30.00% (sum exactly 100).
    const result = lessonTimeline({
      startHour: 13,
      startMinute: 20,
      durations: [10, 25, 15],
      lessonMinutes: 45,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.share)).toEqual([20, 50, 30]);
    expect(result.totalMinutes).toBe(50);
    expect(result.end).toEqual({ hour: 14, minute: 10, dayOffset: 0 });
    expect(result.slack).toBe(-5); // 45 − 50
  });

  it("crosses midnight and marks the second day", () => {
    // t0 = 1430. Cumulative 20, 50 → 23:50–00:10 (+1), 00:10–00:40 (+1).
    // end = 1430 + 50 = 1480; 1480 mod 1440 = 40 → 00:40, floor(1480/1440) = 1.
    const result = lessonTimeline({ startHour: 23, startMinute: 50, durations: [20, 30] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.start).toEqual({ hour: 23, minute: 50, dayOffset: 0 });
    expect(result.rows[0]?.end).toEqual({ hour: 0, minute: 10, dayOffset: 1 });
    expect(result.rows[1]?.end).toEqual({ hour: 0, minute: 40, dayOffset: 1 });
    expect(result.rows.map((r) => r.share)).toEqual([40, 60]);
    expect(result.end).toEqual({ hour: 0, minute: 40, dayOffset: 1 });
    expect(result.slack).toBeUndefined(); // no lesson length was given
  });

  it("refuses rather than repairs", () => {
    expect(lessonTimeline({ startHour: 24, startMinute: 0, durations: [5] })).toEqual({
      ok: false,
      reason: "startHour",
    });
    expect(lessonTimeline({ startHour: 8, startMinute: 0, durations: [] })).toEqual({
      ok: false,
      reason: "durations",
    });
    // Every activity at zero minutes divides by zero in its own share column.
    expect(lessonTimeline({ startHour: 8, startMinute: 0, durations: [0, 0] })).toEqual({
      ok: false,
      reason: "durations",
    });
    expect(
      lessonTimeline({ startHour: 8, startMinute: 0, durations: [5], lessonMinutes: 0 }),
    ).toEqual({ ok: false, reason: "lessonMinutes" });
  });
});

describe("splitIntoGroups", () => {
  it("splits 28 students into 5 groups, evening 3 up and 2 down", () => {
    // q = floor(28/5) = 5, r = 28 mod 5 = 3 → 3 groups of 6, 2 of 5. Check: 18+10 = 28.
    const result = splitIntoGroups({ students: 28, split: { kind: "byGroups", groups: 5 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toBe(5);
    expect(result.tally).toEqual([
      { size: 6, count: 3 },
      { size: 5, count: 2 },
    ]);
    expect(result.checkSum).toBe(28);
    expect(result.emptyGroups).toBe(0);
    expect(result.groupsWithMembers).toBe(5);
    expect(result.bySize).toBeUndefined(); // split BY GROUPS has no by-size view
  });

  it("splits 23 students into groups of 4, with both the evened-out and the plain view", () => {
    // k = ceil(23/4) = 6; q = floor(23/6) = 3, r = 23 mod 6 = 5 →
    //   5 groups of 4, 1 of 3. Check 23.
    // Plain view: full = floor(23/4) = 5 groups of 4, remainder = 23 mod 4 = 3. Check 5·4+3 = 23.
    const result = splitIntoGroups({ students: 23, split: { kind: "bySize", size: 4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toBe(6);
    expect(result.tally).toEqual([
      { size: 4, count: 5 },
      { size: 3, count: 1 },
    ]);
    expect(result.checkSum).toBe(23);
    // ceil(N/g) as the group count guarantees no evened-out group exceeds g.
    expect(result.bySize).toEqual({
      fullGroups: 5,
      remainder: 3,
      fullCheckSum: 23,
      largestGroupWithinSize: true,
    });
    expect(result.groupsWithMembers).toBe(6);
  });

  it("answers more groups than students with empty groups named explicitly", () => {
    // q = 0, r = 3 → 3 groups of 1, 2 groups of 0. Check 3·1 + 2·0 = 3.
    const result = splitIntoGroups({ students: 3, split: { kind: "byGroups", groups: 5 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tally).toEqual([
      { size: 1, count: 3 },
      { size: 0, count: 2 },
    ]);
    expect(result.checkSum).toBe(3);
    expect(result.emptyGroups).toBe(2);
    expect(result.groupsWithMembers).toBe(3);
  });

  it("refuses a split whose smallest group falls below the caller's floor", () => {
    // Same 3-into-5 request as above: the smallest actual group is 0, which
    // fails any positive floor.
    expect(
      splitIntoGroups({ students: 3, split: { kind: "byGroups", groups: 5 }, minGroupSize: 1 }),
    ).toEqual({ ok: false, reason: "minGroupSize" });
    // 28-into-5 has a smallest group of 5 (three groups of 6, two of 5) — a
    // floor of 5 passes, a floor of 6 does not.
    expect(
      splitIntoGroups({
        students: 28,
        split: { kind: "byGroups", groups: 5 },
        minGroupSize: 5,
      }).ok,
    ).toBe(true);
    expect(
      splitIntoGroups({ students: 28, split: { kind: "byGroups", groups: 5 }, minGroupSize: 6 }),
    ).toEqual({ ok: false, reason: "minGroupSize" });
  });

  it("refuses rather than repairs", () => {
    expect(splitIntoGroups({ students: 0, split: { kind: "byGroups", groups: 5 } })).toEqual({
      ok: false,
      reason: "students",
    });
    expect(splitIntoGroups({ students: 10, split: { kind: "byGroups", groups: 0 } })).toEqual({
      ok: false,
      reason: "groups",
    });
    expect(splitIntoGroups({ students: 10, split: { kind: "bySize", size: 0 } })).toEqual({
      ok: false,
      reason: "size",
    });
  });
});

describe("standardScore", () => {
  it("converts a raw score to z, T and a target scale, and reverses from all three", () => {
    // z = (68−55)/8 = 13/8 = 1.6250. T = 50 + 10·1.625 = 66.25.
    // Target M=100, S=15: y = 100 + 15·1.625 = 124.375.
    const result = standardScore({
      raw: 68,
      mean: 55,
      deviation: 8,
      deviationKind: "population",
      target: { mean: 100, deviation: 15 },
      tScoreForRaw: 66.25,
      targetScoreForRaw: 124.375,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.z).toBeCloseTo(1.625, 10);
    expect(result.tScore).toBeCloseTo(66.25, 10);
    expect(result.targetScore).toBeCloseTo(124.375, 10);
    expect(result.deviationKind).toBe("population");
    expect(result.mean).toBe(55);
    expect(result.deviation).toBe(8);
    // z from T = (66.25 − 50)/10 = 1.625 → raw = 55 + 1.625·8 = 68.00 — round-trips.
    expect(result.rawFromTScore).toBeCloseTo(68, 10);
    // z from target = (124.375 − 100)/15 = 1.625 → raw = 55 + 1.625·8 = 68.00.
    expect(result.rawFromTargetScore).toBeCloseTo(68, 10);
  });

  it("converts a below-average score and reverses a bare z back to a raw score", () => {
    // z = (40−55)/8 = −15/8 = −1.8750. T = 50 − 18.75 = 31.25.
    // z = 1 → raw = 55 + 8 = 63.00. z = −1.875 → raw = 55 − 15 = 40.00 (round-trip).
    const first = standardScore({
      raw: 40,
      mean: 55,
      deviation: 8,
      deviationKind: "sample",
      zForRaw: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.z).toBeCloseTo(-1.875, 10);
    expect(first.tScore).toBeCloseTo(31.25, 10);
    expect(first.rawFromZ).toBeCloseTo(63, 10);
    expect(first.deviationKind).toBe("sample");

    const roundTrip = standardScore({
      raw: 40,
      mean: 55,
      deviation: 8,
      deviationKind: "sample",
      zForRaw: -1.875,
    });
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(roundTrip.rawFromZ).toBeCloseTo(40, 10);
  });

  it("refuses rather than repairs", () => {
    expect(
      standardScore({ raw: 68, mean: 55, deviation: 0, deviationKind: "population" }),
    ).toEqual({ ok: false, reason: "deviation" });
    // A target-scale reversal with no target scale supplied is unanswerable.
    expect(
      standardScore({
        raw: 68,
        mean: 55,
        deviation: 8,
        deviationKind: "population",
        targetScoreForRaw: 100,
      }),
    ).toEqual({ ok: false, reason: "targetScoreForRaw" });
    expect(
      standardScore({
        raw: 68,
        mean: 55,
        deviation: 8,
        deviationKind: "population",
        target: { mean: 100, deviation: 0 },
      }),
    ).toEqual({ ok: false, reason: "targetDeviation" });
  });
});

describe("testPrinting", () => {
  it("rounds sheets-per-copy BEFORE multiplying by the run — 28 copies, duplex", () => {
    // listovaPoPrimerku = ceil(3/2) = 2; ukupnoListova = 2·28 = 56; ukupnoStrana = 84.
    // praznePoledjine = 2·56 − 84 = 28. pakovanja = ceil(56/500) = 1, ostatak = 444.
    // iznos = 56 · 2.50 = 140.00. Rounding the TOTAL instead (ceil(84/2) = 42) would
    // be 14 sheets short — the wrong path this test also rules out.
    const result = testPrinting({
      pages: 3,
      copies: 28,
      duplex: true,
      sheetsPerPack: 500,
      pricePerSheet: 2.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheetsPerCopy).toBe(2);
    expect(result.totalSheets).toBe(56);
    expect(result.totalSheets).not.toBe(42); // the wrong, sum-first path
    expect(result.totalPages).toBe(84);
    expect(result.blankBacks).toBe(28);
    expect(result.packs).toBe(1);
    expect(result.leftInLastPack).toBe(444);
    expect(result.amountMinor).toBe(14000);
    expect(result.amount).toBeCloseTo(140, 10);
    expect(result.pagesPerSheetSide).toBe(1);
  });

  it("compares simplex and duplex for the same run, with no price given", () => {
    // Simplex: listovaPoPrimerku = 2; ukupnoListova = 240; praznePoledjine = 0;
    // pakovanja = ceil(240/250) = 1, ostatak = 10.
    const simplex = testPrinting({ pages: 2, copies: 120, duplex: false, sheetsPerPack: 250 });
    expect(simplex.ok).toBe(true);
    if (!simplex.ok) return;
    expect(simplex.sheetsPerCopy).toBe(2);
    expect(simplex.totalSheets).toBe(240);
    expect(simplex.blankBacks).toBe(0);
    expect(simplex.leftInLastPack).toBe(10);
    expect(simplex.amountMinor).toBeUndefined();

    // Duplex: listovaPoPrimerku = ceil(2/2) = 1; ukupnoListova = 120;
    // praznePoledjine = 2·120 − 240 = 0; pakovanja = 1, ostatak = 130.
    const duplex = testPrinting({ pages: 2, copies: 120, duplex: true, sheetsPerPack: 250 });
    expect(duplex.ok).toBe(true);
    if (!duplex.ok) return;
    expect(duplex.sheetsPerCopy).toBe(1);
    expect(duplex.totalSheets).toBe(120);
    expect(duplex.blankBacks).toBe(0);
    expect(duplex.leftInLastPack).toBe(130);
  });

  it("refuses rather than repairs", () => {
    expect(testPrinting({ pages: 0, copies: 1, duplex: false, sheetsPerPack: 100 })).toEqual({
      ok: false,
      reason: "pages",
    });
    expect(testPrinting({ pages: 1, copies: 0, duplex: false, sheetsPerPack: 100 })).toEqual({
      ok: false,
      reason: "copies",
    });
    expect(testPrinting({ pages: 1, copies: 1, duplex: false, sheetsPerPack: 0 })).toEqual({
      ok: false,
      reason: "sheetsPerPack",
    });
    expect(
      testPrinting({ pages: 1, copies: 1, duplex: false, sheetsPerPack: 100, pricePerSheet: -1 }),
    ).toEqual({ ok: false, reason: "pricePerSheet" });
  });
});

describe("topicHourAllocation", () => {
  it("allocates 72 hours over four topics by the largest-remainder rule", () => {
    // Quotas: 72·30/100 = 21.60, 72·25/100 = 18.00, 18.00, 72·20/100 = 14.40.
    // Floors: 21+18+18+14 = 71 → R = 1. Fractions: 0.60, 0.00, 0.00, 0.40 →
    // largest is the FIRST row (0.60) → it takes the extra hour: 22, 18, 18, 14.
    const result = topicHourAllocation({ totalHours: 72, weights: [30, 25, 25, 20] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.hours)).toEqual([22, 18, 18, 14]);
    expect(result.rows.map((r) => r.extraHour)).toEqual([true, false, false, false]);
    expect(result.rows[0]?.quota).toBeCloseTo(21.6, 10);
    // 100·22/72 = 30.5556…, 100·18/72 = 25.00, 25.00, 100·14/72 = 19.4444….
    expect(result.rows[0]?.share).toBeCloseTo(30.555556, 6);
    expect(result.rows[3]?.share).toBeCloseTo(19.444444, 6);
    expect(result.checkSum).toBe(72);
    expect(result.extraHourCount).toBe(1);
    expect(result.method).toBe("largest-remainder-hamilton");
  });

  it("breaks a three-way tie by the lower row index — quotas of exactly 10/3", () => {
    // Quotas 10/3 = 3.3333… each; floors 3+3+3 = 9 → R = 1. All three
    // fractional parts and weights are equal, so the FIRST row wins: 4, 3, 3.
    const result = topicHourAllocation({ totalHours: 10, weights: [1, 1, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.hours)).toEqual([4, 3, 3]);
    expect(result.rows.map((r) => r.share)).toEqual([40, 30, 30]);
    expect(result.checkSum).toBe(10);
    expect(result.extraHourCount).toBe(1);
  });

  it("keeps a zero-weight row in the output at zero hours, never taking an extra hour", () => {
    // Weights 1, 0, 1 over 2 hours: quotas 1, 0, 1 exactly — no remainder at all.
    const result = topicHourAllocation({ totalHours: 2, weights: [1, 0, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.hours)).toEqual([1, 0, 1]);
    expect(result.rows[1]?.extraHour).toBe(false);
    expect(result.checkSum).toBe(2);
    expect(result.extraHourCount).toBe(0);
  });

  it("refuses rather than repairs", () => {
    expect(topicHourAllocation({ totalHours: 0, weights: [1] })).toEqual({
      ok: false,
      reason: "totalHours",
    });
    expect(topicHourAllocation({ totalHours: 10, weights: [] })).toEqual({
      ok: false,
      reason: "weights",
    });
    expect(topicHourAllocation({ totalHours: 10, weights: [0, 0] })).toEqual({
      ok: false,
      reason: "weights",
    });
    expect(topicHourAllocation({ totalHours: 10, weights: [1, -1] })).toEqual({
      ok: false,
      reason: "weights",
    });
  });
});

describe("weightedGrade", () => {
  it("folds four components of different maxima and weights into one percent", () => {
    // Ratios: 18/25=0.72, 22/25=0.88, 41/50=0.82, 10/10=1.00 → 72/88/82/100%.
    // Σw = 20+20+50+10 = 100 → normalized weights 20/20/50/10%.
    // Σ w·r = 14.40+17.60+41.00+10.00 = 83.00 → total = 100·83/100 = 83.00%.
    // Mapped onto 100 points → 83.00.
    const result = weightedGrade({
      components: [
        { scored: 18, max: 25, weight: 20 },
        { scored: 22, max: 25, weight: 20 },
        { scored: 41, max: 50, weight: 50 },
        { scored: 10, max: 10, weight: 10 },
      ],
      totalPoints: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.percent)).toEqual([72, 88, 82, 100]);
    expect(result.rows.map((r) => r.normalizedWeight)).toEqual([20, 20, 50, 10]);
    expect(result.totalPercent).toBeCloseTo(83, 10);
    expect(result.mappedPoints).toBeCloseTo(83, 10);
  });

  it("maps a two-component result onto a 50-point scale", () => {
    // Ratios 12/20=0.60, 4/5=0.80 → 60%, 80%. Σw = 4 → weights 75%, 25%.
    // Σ w·r = 3·0.60 + 1·0.80 = 2.60 → total = 100·2.60/4 = 65.00%.
    // Mapped onto 50 points → 50·0.65 = 32.50.
    const result = weightedGrade({
      components: [
        { scored: 12, max: 20, weight: 3 },
        { scored: 4, max: 5, weight: 1 },
      ],
      totalPoints: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.percent)).toEqual([60, 80]);
    expect(result.rows.map((r) => r.normalizedWeight)).toEqual([75, 25]);
    expect(result.totalPercent).toBeCloseTo(65, 10);
    expect(result.mappedPoints).toBeCloseTo(32.5, 10);
    // No pending component was entered, so there is nothing for a target to be
    // ABOUT — and the target cannot be reached past a `pending` that is absent.
    expect(result.pending).toBeUndefined();
  });

  it("weighs a pending component with no target: a share of the total, and nothing to reach", () => {
    // Σ_{i≠t} w·r = 20·0.72 + 20·0.88 = 32.00; Σw = 100 INCLUDING the pending 60.
    const result = weightedGrade({
      components: [
        { scored: 18, max: 25, weight: 20 },
        { scored: 22, max: 25, weight: 20 },
      ],
      pending: { max: 50, weight: 60 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pending?.weightPercent).toBeCloseTo(60, 10); // 100·60/100
    // Asking „how many points do I need" needs a target; without one the
    // question was never put, and the answer is its ABSENCE, not a zero.
    expect(result.pending?.target).toBeUndefined();
    expect(result.totalPercent).toBeCloseTo(32, 10); // the floor, pending at r = 0
  });

  it("computes the points a pending component needs for an 85% target", () => {
    // Σ_{i≠t} w·r = 20·0.72 + 20·0.88 + 10·1.00 = 42.00; Σw = 100.
    // a_t = (0.85·100 − 42.00)·50/50 = 43.00 of 50 (86.00% of the pending component).
    const result = weightedGrade({
      components: [
        { scored: 18, max: 25, weight: 20 },
        { scored: 22, max: 25, weight: 20 },
        { scored: 10, max: 10, weight: 10 },
      ],
      pending: { max: 50, weight: 50 },
      targetPercent: 85,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pending?.weightPercent).toBeCloseTo(50, 10);
    expect(result.pending?.target?.requiredPoints).toBeCloseTo(43, 10);
    expect(result.pending?.target?.outcome).toBe("reachable");
    // The running total counts the pending component at r = 0, so it is a
    // FLOOR (42.00%), not the 85% being targeted.
    expect(result.totalPercent).toBeCloseTo(42, 10);
  });

  it("names a target already met and one beyond the pending component's maximum", () => {
    const same = {
      components: [
        { scored: 18, max: 25, weight: 20 },
        { scored: 22, max: 25, weight: 20 },
        { scored: 10, max: 10, weight: 10 },
      ],
      pending: { max: 50, weight: 50 },
    };
    // Required = (0.30·100 − 42.00)·1 = −12.00 < 0 → already met.
    const met = weightedGrade({ ...same, targetPercent: 30 });
    expect(met.ok).toBe(true);
    if (!met.ok) return;
    expect(met.pending?.target?.requiredPoints).toBeCloseTo(-12, 10);
    expect(met.pending?.target?.outcome).toBe("alreadyMet");

    // Required = (1.00·100 − 42.00)·1 = 58.00 > 50 (the component's max) → unreachable.
    const stuck = weightedGrade({ ...same, targetPercent: 100 });
    expect(stuck.ok).toBe(true);
    if (!stuck.ok) return;
    expect(stuck.pending?.target?.requiredPoints).toBeCloseTo(58, 10);
    expect(stuck.pending?.target?.outcome).toBe("unreachable");
  });

  it("refuses rather than repairs", () => {
    expect(weightedGrade({ components: [] })).toEqual({ ok: false, reason: "components" });
    expect(weightedGrade({ components: [{ scored: 5, max: 0, weight: 1 }] })).toEqual({
      ok: false,
      reason: "componentMax",
    });
    expect(weightedGrade({ components: [{ scored: 5, max: 4, weight: 1 }] })).toEqual({
      ok: false,
      reason: "componentScored",
    });
    expect(weightedGrade({ components: [{ scored: 1, max: 4, weight: -1 }] })).toEqual({
      ok: false,
      reason: "componentWeight",
    });
    // Every weight zero — Σw = 0 divides the whole percentage by zero.
    expect(weightedGrade({ components: [{ scored: 5, max: 10, weight: 0 }] })).toEqual({
      ok: false,
      reason: "weights",
    });
    // A pending component with weight zero divides ITS OWN required-points formula by zero.
    expect(
      weightedGrade({
        components: [{ scored: 5, max: 10, weight: 1 }],
        pending: { max: 10, weight: 0 },
        targetPercent: 50,
      }),
    ).toEqual({ ok: false, reason: "pendingWeight" });
  });
});
