import { describe, expect, it } from "vitest";

import {
  PDV_RATE_REDUCED,
  PDV_RATE_STANDARD,
  PDV_RATES,
  addVat,
  annuityPlan,
  applyPercentChange,
  compareUnitPrices,
  extractVat,
  percentChange,
  percentOf,
  whatPercent,
} from "./calculators.js";
import { roundForDisplay } from "./units.js";

describe("percentage", () => {
  it("answers „koliko je N% od X“", () => {
    expect(percentOf(20, 250)).toBe(50);
    expect(percentOf(2.5, 1000)).toBe(25);
    expect(percentOf(0, 1000)).toBe(0);
    expect(percentOf(150, 40)).toBe(60);
  });

  it("answers „X je koliko % od Y“", () => {
    expect(whatPercent(50, 250)).toBe(20);
    expect(whatPercent(250, 250)).toBe(100);
    expect(whatPercent(300, 250)).toBe(120);
  });

  it("refuses „koliko % od nule“ instead of dividing by it", () => {
    // Every number is 0% of nothing and none of them is — there is no answer to
    // give, so the tool says it has none rather than rendering Infinity.
    expect(whatPercent(50, 0)).toBeNull();
  });

  it("applies an increase and a decrease", () => {
    expect(applyPercentChange(200, 10)).toBe(220);
    expect(applyPercentChange(200, -10)).toBe(180);
    expect(applyPercentChange(200, 0)).toBe(200);
    // A discount bigger than the price is a negative result, not a clamp: the
    // tool reports the arithmetic and lets the reader see it is nonsense.
    expect(applyPercentChange(200, -150)).toBe(-100);
  });

  it("answers „za koliko % se promenilo od X do Y“, which is not the same question", () => {
    expect(percentChange(200, 220)).toBe(10);
    expect(percentChange(200, 180)).toBe(-10);
    expect(roundForDisplay(percentChange(3, 4) ?? NaN)).toBe(33.3333333333);
    expect(percentChange(200, 200)).toBe(0);
  });

  it("refuses a change measured FROM zero, which has no percentage", () => {
    expect(percentChange(0, 50)).toBeNull();
  });

  it("round-trips an increase against the change it represents", () => {
    const raised = applyPercentChange(1280, 17.5) ?? NaN;
    expect(roundForDisplay(percentChange(1280, raised) ?? NaN)).toBe(17.5);
  });

  it("refuses non-finite input everywhere rather than propagating NaN", () => {
    expect(percentOf(Number.NaN, 10)).toBeNull();
    expect(whatPercent(1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(applyPercentChange(Number.NaN, 10)).toBeNull();
    expect(percentChange(1, Number.NaN)).toBeNull();
  });
});

describe("PDV — the Serbian VAT rates", () => {
  it("ships the two rates the law has, and no invented third", () => {
    expect(PDV_RATE_STANDARD).toBe(20);
    expect(PDV_RATE_REDUCED).toBe(10);
    expect(PDV_RATES).toEqual([20, 10]);
  });

  it("ADDS VAT to a net price", () => {
    expect(addVat(1000, PDV_RATE_STANDARD)).toEqual({ net: 1000, vat: 200, gross: 1200, rate: 20 });
    expect(addVat(1000, PDV_RATE_REDUCED)).toEqual({ net: 1000, vat: 100, gross: 1100, rate: 10 });
  });

  /**
   * The direction a shopkeeper needs more often: the price on the shelf already
   * includes PDV, and the question is how much of it IS the PDV. Dividing by
   * 1,20 — not taking 20% of the gross, which is the everyday mistake and gives
   * 240 rather than 200 on a 1 200 din. label.
   */
  it("EXTRACTS VAT out of a gross price", () => {
    expect(extractVat(1200, PDV_RATE_STANDARD)).toEqual({
      net: 1000,
      vat: 200,
      gross: 1200,
      rate: 20,
    });
    expect(extractVat(1100, PDV_RATE_REDUCED)).toEqual({
      net: 1000,
      vat: 100,
      gross: 1100,
      rate: 10,
    });
  });

  it("is not the same as taking the rate off the gross — the mistake this tool exists to prevent", () => {
    const extracted = extractVat(1200, 20);
    expect(extracted?.vat).toBe(200);
    expect(extracted?.vat).not.toBe(percentOf(20, 1200));
  });

  it("makes the two directions exact inverses of each other", () => {
    for (const rate of PDV_RATES) {
      const up = addVat(4999.99, rate);
      const back = extractVat(up?.gross ?? NaN, rate);
      expect(roundForDisplay(back?.net ?? NaN)).toBe(roundForDisplay(4999.99));
    }
  });

  it("keeps net + vat equal to gross at both rates, for an awkward amount", () => {
    for (const rate of PDV_RATES) {
      for (const breakdown of [addVat(333.33, rate), extractVat(333.33, rate)]) {
        expect(breakdown).not.toBeNull();
        expect(roundForDisplay((breakdown?.net ?? 0) + (breakdown?.vat ?? 0))).toBe(
          roundForDisplay(breakdown?.gross ?? NaN),
        );
      }
    }
  });

  it("accepts a zero rate and refuses a negative or non-finite one", () => {
    expect(addVat(100, 0)).toEqual({ net: 100, vat: 0, gross: 100, rate: 0 });
    expect(addVat(100, -5)).toBeNull();
    expect(extractVat(100, -5)).toBeNull();
    expect(addVat(Number.NaN, 20)).toBeNull();
    expect(extractVat(100, Number.NaN)).toBeNull();
  });

  it("refuses a negative amount — a price is not negative, and a refund is not this tool", () => {
    expect(addVat(-100, 20)).toBeNull();
    expect(extractVat(-100, 20)).toBeNull();
  });
});

describe("annuityPlan — the loan calculator", () => {
  /**
   * A textbook annuity, checked against the closed form by hand:
   * P = 1 000 000, nominal 6 % p.a. → i = 0,005 monthly, n = 60.
   * A = 1 000 000 · 0,005 / (1 − 1,005^-60) = 19 332,80 din.
   */
  it("computes the monthly instalment of an ordinary annuity", () => {
    const plan = annuityPlan({ principal: 1_000_000, annualRatePercent: 6, months: 60 });
    expect(plan?.monthlyPayment ?? NaN).toBeCloseTo(19332.8, 2);
    expect(plan?.totalPaid ?? NaN).toBeCloseTo(1_159_968.09, 2);
    expect(plan?.totalInterest ?? NaN).toBeCloseTo(159_968.09, 2);
  });

  /**
   * The closed form checked against FIRST PRINCIPLES rather than against a
   * number somebody typed into the test: walk the loan month by month — add the
   * month's interest, subtract the instalment — and the balance must land on
   * zero after the last one. That is the definition of an annuity, and it is
   * what makes the formula above verifiable rather than merely repeated.
   */
  it("amortizes to a zero balance over exactly the agreed number of months", () => {
    for (const terms of [
      { principal: 1_000_000, annualRatePercent: 6, months: 60 },
      { principal: 2_400_000, annualRatePercent: 8.25, months: 84 },
      { principal: 350_000, annualRatePercent: 0, months: 24 },
    ]) {
      const plan = annuityPlan(terms);
      expect(plan, JSON.stringify(terms)).not.toBeNull();
      let balance = terms.principal;
      for (let month = 0; month < terms.months; month += 1) {
        balance = balance * (1 + (plan?.monthlyRate ?? 0)) - (plan?.monthlyPayment ?? 0);
      }
      // A rounding crumb on a multi-million-dinar loan, not a residual debt.
      expect(Math.abs(balance), JSON.stringify(terms)).toBeLessThan(0.000001);
    }
  });

  it("keeps totalPaid − principal equal to totalInterest, by construction", () => {
    const plan = annuityPlan({ principal: 2_400_000, annualRatePercent: 8.25, months: 84 });
    expect(roundForDisplay((plan?.totalPaid ?? 0) - 2_400_000)).toBe(
      roundForDisplay(plan?.totalInterest ?? NaN),
    );
  });

  /**
   * The branch the closed form cannot take: at i = 0 the denominator
   * 1 − (1+i)^-n is zero, so an unguarded formula returns NaN or Infinity on
   * the one input a user is most likely to try first — an interest-free loan.
   */
  it("handles a zero-interest loan as a plain division, not as a division by zero", () => {
    const plan = annuityPlan({ principal: 120_000, annualRatePercent: 0, months: 12 });
    expect(plan?.monthlyPayment).toBe(10_000);
    expect(plan?.totalPaid).toBe(120_000);
    expect(plan?.totalInterest).toBe(0);
  });

  it("charges more interest the longer the same loan runs", () => {
    const short = annuityPlan({ principal: 1_000_000, annualRatePercent: 6, months: 36 });
    const long = annuityPlan({ principal: 1_000_000, annualRatePercent: 6, months: 72 });
    expect(short?.monthlyPayment ?? 0).toBeGreaterThan(long?.monthlyPayment ?? 0);
    expect(long?.totalInterest ?? 0).toBeGreaterThan(short?.totalInterest ?? 0);
  });

  it("reports back the convention it assumed, so a figure can be checked", () => {
    const plan = annuityPlan({ principal: 1_000_000, annualRatePercent: 6, months: 60 });
    // The monthly rate is the NOMINAL annual one divided by twelve — the
    // convention Serbian banks quote NKS under. Stated in the result rather than
    // only in a comment, because the surface has to be able to show it.
    expect(plan?.monthlyRate).toBe(0.005);
    expect(plan?.months).toBe(60);
  });

  it("refuses the inputs that are not a loan", () => {
    expect(annuityPlan({ principal: 0, annualRatePercent: 6, months: 60 })).toBeNull();
    expect(annuityPlan({ principal: -1000, annualRatePercent: 6, months: 60 })).toBeNull();
    expect(annuityPlan({ principal: 1000, annualRatePercent: -1, months: 60 })).toBeNull();
    expect(annuityPlan({ principal: 1000, annualRatePercent: 6, months: 0 })).toBeNull();
    // A loan runs a whole number of months; „60,5 rata" is not a plan.
    expect(annuityPlan({ principal: 1000, annualRatePercent: 6, months: 60.5 })).toBeNull();
    expect(annuityPlan({ principal: 1000, annualRatePercent: Number.NaN, months: 60 })).toBeNull();
  });
});

describe("compareUnitPrices — „koje pakovanje je jeftinije“", () => {
  it("ranks packages by price per unit, cheapest first", () => {
    const rows = compareUnitPrices([
      { id: "a", price: 240, quantity: 1000 },
      { id: "b", price: 145, quantity: 500 },
      { id: "c", price: 80, quantity: 250 },
    ]);
    expect(rows?.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows?.map((row) => row.unitPrice)).toEqual([0.24, 0.29, 0.32]);
    expect(rows?.map((row) => row.cheapest)).toEqual([true, false, false]);
  });

  it("says how much dearer each package is than the cheapest one", () => {
    const rows = compareUnitPrices([
      { id: "veliko", price: 200, quantity: 1000 },
      { id: "malo", price: 120, quantity: 500 },
    ]);
    expect(rows?.[0]?.premiumPercent).toBe(0);
    // 0,24 against 0,20 is twenty percent more per unit.
    expect(roundForDisplay(rows?.[1]?.premiumPercent ?? NaN)).toBe(20);
  });

  it("flags EVERY package that ties for cheapest rather than picking one arbitrarily", () => {
    const rows = compareUnitPrices([
      { id: "a", price: 100, quantity: 500 },
      { id: "b", price: 200, quantity: 1000 },
    ]);
    expect(rows?.map((row) => row.cheapest)).toEqual([true, true]);
    expect(rows?.map((row) => row.premiumPercent)).toEqual([0, 0]);
  });

  it("compares a single package with itself without claiming a saving", () => {
    const rows = compareUnitPrices([{ id: "a", price: 100, quantity: 4 }]);
    expect(rows).toEqual([
      { id: "a", price: 100, quantity: 4, unitPrice: 25, cheapest: true, premiumPercent: 0 },
    ]);
  });

  it("refuses a package with no quantity instead of dividing by it", () => {
    expect(compareUnitPrices([{ id: "a", price: 100, quantity: 0 }])).toBeNull();
    expect(compareUnitPrices([{ id: "a", price: 100, quantity: -1 }])).toBeNull();
  });

  it("refuses a free package too — its unit price is zero and every comparison against it is infinite", () => {
    expect(compareUnitPrices([{ id: "a", price: 0, quantity: 500 }])).toBeNull();
    expect(compareUnitPrices([{ id: "a", price: -5, quantity: 500 }])).toBeNull();
  });

  it("refuses an empty comparison — there is nothing to be cheaper than", () => {
    expect(compareUnitPrices([])).toBeNull();
  });
});
