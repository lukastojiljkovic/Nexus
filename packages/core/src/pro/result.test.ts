import { describe, expect, it } from "vitest";

import {
  ceilSnapped,
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  minorUnits,
  quotient,
  ratioAgainst,
  roundHalfUp,
  snap,
} from "./result.js";

/**
 * The shared kit's own tests.
 *
 * Every one of the 274 professional tools depends on these ten functions, so a
 * defect here is a defect in all of them at once — and three of the four newest
 * were added precisely BECAUSE the hand-written copies of them across the
 * seventeen toolkits each carried a different bug. Testing the copies proved
 * only that each copy agreed with itself.
 *
 * The cases below are the failures that were actually found in the field, kept
 * as regressions with the toolkit that produced them named.
 */

describe("the guards", () => {
  it("refuses infinity where `> 0` alone would let it through", () => {
    // The reason `isPositive` exists rather than a bare comparison: a division
    // by an empty field produces Infinity, and `Infinity > 0` is true.
    expect(Number.POSITIVE_INFINITY > 0).toBe(true);
    expect(isPositive(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isPositive(Number.NaN)).toBe(false);
    expect(isPositive(0)).toBe(false);
    expect(isPositive(1e-300)).toBe(true);
  });

  it("separates a quantity that may be nothing from one that may not", () => {
    expect(isNonNegative(0)).toBe(true);
    expect(isNonNegative(-0.0001)).toBe(false);
    expect(isNonNegative(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("closes both ends of a band, and demands a whole number where it says so", () => {
    expect(isInRange(1, 1, 179)).toBe(true);
    expect(isInRange(179, 1, 179)).toBe(true);
    expect(isInRange(179.0001, 1, 179)).toBe(false);
    expect(isIntegerIn(17, 1, 60)).toBe(true);
    expect(isIntegerIn(16.5, 1, 60)).toBe(false);
    expect(isIntegerIn(Number.NaN, 1, 60)).toBe(false);
  });

  it("refuses `undefined` and narrows the value for the line below it", () => {
    // The reason three toolkits had written their own copy of this: an optional
    // input is `number | undefined`, and a guard that returns a bare boolean
    // leaves the caller holding a `number | undefined` it has just proved is a
    // number. The predicate form is what removes the assertion.
    const maybe: number | undefined = 42;
    expect(isPositive(undefined)).toBe(false);
    expect(isNonNegative(undefined)).toBe(false);
    expect(isInRange(undefined, 0, 100)).toBe(false);
    expect(isIntegerIn(undefined, 0, 100)).toBe(false);
    if (!isPositive(maybe)) throw new Error("unreachable");
    // Narrowed: this line does not compile if the predicate is dropped.
    const doubled: number = maybe * 2;
    expect(doubled).toBe(84);
  });

  it("names an input rather than composing a sentence", () => {
    expect(fail("rise")).toEqual({ ok: false, reason: "rise" });
  });
});

describe("ratioAgainst — the only comparison a regulated tool may make", () => {
  it("is a plain quotient when the user typed a limit", () => {
    // 168 / 175 = 0.96 exactly.
    expect(ratioAgainst(168, 175)).toBeCloseTo(0.96, 12);
  });

  it("withholds the ratio rather than inventing a limit", () => {
    expect(ratioAgainst(168, undefined)).toBeUndefined();
    expect(ratioAgainst(168, 0)).toBeUndefined();
    expect(ratioAgainst(168, -5)).toBeUndefined();
    expect(ratioAgainst(168, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  // The limit was guarded from the first line of this file and the value was
  // not, on the assumption that a figure the tool computed itself is sound. A
  // section modulus that underflowed to zero disproved it: `Infinity / 235` is
  // `Infinity`, and the surface printed it as a stress ratio — the shape of a
  // comparison, against the user's own allowable, carrying no arithmetic.
  it("withholds the ratio when the value itself is not a number", () => {
    expect(ratioAgainst(Number.POSITIVE_INFINITY, 235)).toBeUndefined();
    expect(ratioAgainst(Number.NEGATIVE_INFINITY, 235)).toBeUndefined();
    expect(ratioAgainst(Number.NaN, 235)).toBeUndefined();
    // Zero is a number and stays one: a ratio of 0 is a real answer.
    expect(ratioAgainst(0, 235)).toBe(0);
  });
});

describe("quotient — the commonest defect in the drawer, made unrepresentable", () => {
  it("divides when the divisor is a real, non-zero number", () => {
    expect(quotient(10, 4)).toBe(2.5);
    // A negative divisor is arithmetic, not an error: a reaction acting the
    // other way is still a reaction.
    expect(quotient(10, -4)).toBe(-2.5);
  });

  it("withholds instead of returning infinity — the „∞ mm\" on screen", () => {
    expect(quotient(10, 0)).toBeUndefined();
    expect(quotient(10, -0)).toBeUndefined();
    expect(quotient(10, Number.NaN)).toBeUndefined();
    expect(quotient(10, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("checks the RESULT too, since two finite numbers can overflow", () => {
    // 1e308 / 1e-308 = 1e616, which double precision cannot hold.
    expect(1e308 / 1e-308).toBe(Number.POSITIVE_INFINITY);
    expect(quotient(1e308, 1e-308)).toBeUndefined();
  });
});

describe("snap and the two floors — one ULP is one piece too few", () => {
  it("removes the representation error that a floor would otherwise keep", () => {
    // agro's bee syrup, in the smallest form that shows it: 3,3 litres of
    // syrup at 1,1 litres a hive is three hives, and 3.3 / 1.1 is stored as
    // 2.9999999999999996 — floored, that is two hives, and one colony goes
    // without. The same shape drove the honey-jar count and the tank fills.
    const built = 3.3 / 1.1;
    expect(built).toBeLessThan(3);
    expect(Math.floor(built)).toBe(2);
    expect(floorSnapped(built)).toBe(3);
    // And the cost of the same class in money: 4,35 at two decimals.
    expect(Math.round(4.35 * 100) / 100).toBe(4.35);
    expect(Math.floor(4.35 * 100)).toBe(434);
    expect(floorSnapped(4.35 * 100)).toBe(435);
  });

  it("does not move a number anybody typed", () => {
    expect(snap(2850)).toBe(2850);
    expect(snap(167.647059)).toBe(167.647059);
    expect(snap(0.0000001234)).toBeCloseTo(0.0000001234, 20);
  });

  it("DOES move a figure carrying more than nine significant digits", () => {
    // Which is why this belongs in front of a floor and never over an answer:
    // the stair riser 2850/17 is 167.647058823…, and snapping it would print a
    // different number from the one the arithmetic produced.
    expect(snap(167.647058823)).toBe(167.647059);
  });

  it("leaves a genuine fraction alone rather than rounding it away", () => {
    // 2.4 is not within one ULP of 3 and must stay two.
    expect(floorSnapped(2.4)).toBe(2);
    expect(ceilSnapped(2.4)).toBe(3);
    // The mirror case: a ceiling that would otherwise gain a whole piece.
    expect(Math.ceil(3.0000000000000004)).toBe(4);
    expect(ceilSnapped(3.0000000000000004)).toBe(3);
  });

  it("passes zero and the non-numbers through untouched", () => {
    expect(snap(0)).toBe(0);
    expect(snap(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(snap(Number.NaN))).toBe(true);
  });
});

describe("roundHalfUp — money's rounding, with a nudge that scales", () => {
  it("rounds half away from zero in both directions", () => {
    // `Math.round` gives −2 here, and every invoice in this drawer wants −3.
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
    expect(roundHalfUp(2.5, 0)).toBe(3);
  });

  it("recovers the half that binary representation put just under it", () => {
    // 1.005 is stored as 1.00499999999999989…, so the naive round gives 1.00.
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    // 8.615 stored just under, on a VAT base anyone would recognise.
    expect(roundHalfUp(8.615, 2)).toBe(8.62);
  });

  it("scales the nudge, which the absolute `+ 1e-9` copies did not", () => {
    // Small end: an absolute 1e-9 is twenty times this value and would round a
    // quantity of 5e-8 up to a whole unit at nine decimals.
    expect(roundHalfUp(0.00000005, 9)).toBe(0.00000005);
    // Large end: on nine hundred million, 1e-9 is far below one ULP of the
    // scaled value and buys nothing at all.
    expect(roundHalfUp(900000000.005, 2)).toBe(900000000.01);
  });

  it("never returns a negative zero for the formatter to print as „−0,00\"", () => {
    expect(Object.is(roundHalfUp(-0.004, 2), 0)).toBe(true);
    expect(Object.is(roundHalfUp(-0, 2), 0)).toBe(true);
  });

  it("passes the non-numbers through rather than inventing a figure", () => {
    expect(roundHalfUp(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(roundHalfUp(Number.NaN, 2))).toBe(true);
  });

  // An unbounded relative nudge becomes, at the top of the money range, larger
  // than the error it exists to remove. Four ulps of 9e15 is about 8, so this
  // used to return 9_000_000_000_000_008 — eight whole minor units invented on a
  // total `allocateWithoutRemainder` is proven exact at. `racunovodstvo.ts`
  // refused to adopt this function over exactly this, which is why the cap is
  // here: at that magnitude doubles are spaced two apart, there is no fraction
  // left to correct, and the right nudge is none.
  it("caps the nudge, so a total at the top of the range gains nothing", () => {
    expect(roundHalfUp(9_000_000_000_000_000, 0)).toBe(9_000_000_000_000_000);
    expect(roundHalfUp(9_007_199_254_740_991, 0)).toBe(9_007_199_254_740_991);
    // The cap is 2^48, whose four ulps are exactly 0.25 — below the half-unit a
    // nudge must never carry a value across on its own.
    expect(roundHalfUp(2 ** 48, 0)).toBe(2 ** 48);
    // The nudge is four ulps at EVERY magnitude, which is the property that
    // makes it behave the same way across the range; what the cap removes is the
    // absolute growth beyond 2^48, where an ulp is already bigger than the
    // fraction being corrected. So 0.25 is the most it can ever add.
    expect(roundHalfUp(2 ** 48 + 0.7, 0)).toBe(2 ** 48 + 1);
    // And the low end is untouched: this is the case the nudge exists for.
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
  });
});

describe("minorUnits — the money bridge, and the absolute epsilon it replaces", () => {
  it("converts an ordinary amount to whole minor units", () => {
    expect(minorUnits(1234.56, 2)).toBe(123456);
    expect(minorUnits(-1234.56, 2)).toBe(-123456);
    expect(minorUnits(0, 2)).toBe(0);
    // The classic representation error, in both directions: 1,13 lands just
    // under its whole number of minor units and 8,22 just over.
    expect(1.13 * 100).toBeLessThan(113);
    expect(8.22 * 100).toBeGreaterThan(822);
    expect(minorUnits(1.13, 2)).toBe(113);
    expect(minorUnits(8.22, 2)).toBe(822);
    // Other scales, since `digits` is a user field in the trial balance.
    expect(minorUnits(12.3456, 4)).toBe(123456);
    expect(minorUnits(1234, 0)).toBe(1234);
  });

  it("refuses an amount carrying more decimals than the scale allows", () => {
    expect(minorUnits(1.005, 2)).toBeUndefined();
    expect(minorUnits(0.005, 2)).toBeUndefined();
    expect(minorUnits(1234.5678, 2)).toBeUndefined();
    expect(minorUnits(2.5, 0)).toBeUndefined();
    expect(minorUnits(-2.5, 0)).toBeUndefined();
  });

  // The defect this function exists to make unrepresentable. `amount-in-words`
  // and `trial-balance-check` each wrote `Math.abs(x*100 - Math.round(x*100)) >
  // 1e-6`, which is an absolute tolerance on a value whose ulp grows with its
  // magnitude. It is exact up to 2^27 and then starts refusing real money.
  it("accepts a legal two-decimal amount that an absolute 1e-6 refuses", () => {
    const failing = 612068388.17;
    expect(Math.abs(failing * 100 - Math.round(failing * 100))).toBeGreaterThan(1e-6);
    expect(minorUnits(failing, 2)).toBe(61206838817);
    // 2^27 + 0,11 is where the old spelling first goes wrong, measured.
    expect(minorUnits(134217728.11, 2)).toBe(13421772811);
    expect(minorUnits(999999999.99, 2)).toBe(99999999999);
  });

  it("refuses rather than rounding — the „strane su izjednačene\" on an unbalanced book", () => {
    // `Math.round(-0.5)` is `-0`, so a difference of half a unit at zero
    // decimals used to compare equal to zero and print „balanced".
    expect(Object.is(Math.round(-0.5), -0)).toBe(true);
    expect(minorUnits(-0.5, 0)).toBeUndefined();
  });

  it("refuses a scale, an amount or a count it cannot answer for", () => {
    expect(minorUnits(Number.NaN, 2)).toBeUndefined();
    expect(minorUnits(Number.POSITIVE_INFINITY, 2)).toBeUndefined();
    expect(minorUnits(1.5, 2.5)).toBeUndefined();
    expect(minorUnits(1.5, -1)).toBeUndefined();
    expect(minorUnits(1.5, 13)).toBeUndefined();
    // Past 2^53 the minor-unit count is no longer exactly representable, and a
    // figure that cannot be counted must not be reported as if it could.
    expect(minorUnits(1e15, 2)).toBeUndefined();
  });
});
