import { describe, expect, it } from "vitest";

import {
  addMonths,
  areaShareFraction,
  cashflowNpvIrr,
  costAllocation,
  latePaymentInterest,
  leaseTermDates,
  loanAmortization,
  ownershipShares,
  parcelPolygonArea,
  plotDensityIndex,
  proRataDays,
  rentEscalation,
  rentGrossNet,
  rentalYield,
  roomQuadArea,
  roundHalfUp,
  wallCeilingArea,
  weightedArea,
} from "./nekretnine.js";

/**
 * Every expectation here was worked by hand from the assignment before this file
 * existed, and the arithmetic is written into the comments so a reader can check
 * it without running anything. Where the implementation's corrected algorithm
 * (per the assignment's ISPRAVKE PO RECENZIJI) produces a number that differs
 * from the assignment's own illustrative arithmetic, that is noted explicitly —
 * see `loanAmortization`, where the closed form and the rounded table disagree
 * by a cent, exactly as the correction predicts.
 */

describe("roundHalfUp", () => {
  it("repairs the binary-double shortfall — 41.595 is stored as 41.5949999999999971", () => {
    expect(roundHalfUp(41.595, 2)).toBe(41.6);
    expect(roundHalfUp(46.8 - 5.205, 2)).toBe(41.6); // 41.594999999999999… in a double
  });

  it("repairs the shortfall at a size the old ABSOLUTE 1e-9 nudge could not reach — six- and seven-figure RSD amounts", () => {
    // `roundHalfUp` is now the shared `@nexus/core/pro/result` implementation:
    // its nudge scales with the value (4× machine epsilon of the SCALED
    // magnitude) instead of being a fixed 1e-9. The nearest double to
    // 583941.565 is 583941.5649999999441…; ×100 = 58394156.49999999441, and
    // the relative nudge here (≈5.19e-8) pushes it back over the 58394156.5
    // tie — a fixed 1e-9 nudge, twenty thousand times too small at this scale,
    // did not, and answered 583941,56 instead of 583941,57.
    expect(roundHalfUp(583941.565, 2)).toBe(583941.57);
    // 1.048.576 = 2^20 — same shape, another size the old nudge could not reach.
    expect(roundHalfUp(1048576.005, 2)).toBe(1048576.01);
    // Two orders of magnitude further up again, confirming the fix is scale-free.
    expect(roundHalfUp(35231388.745, 2)).toBe(35231388.75);
  });

  it("rounds the ABSOLUTE value half-up, so a negative tie goes further from zero", () => {
    // Math.round breaks ties toward +infinity, which would give −0.125 -> −0.12.
    expect(roundHalfUp(-0.125, 2)).toBeCloseTo(-0.13, 9);
  });

  it("never leaks a negative zero", () => {
    const result = roundHalfUp(-0.001, 2);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("passes a non-finite VALUE through unchanged — the shared kit's contract, and no decimal-count validation of its own", () => {
    // Every call site of `roundHalfUp` in this file hands it a literal decimal
    // count (2, 4 or 6), so the private range check an earlier copy ran on
    // `decimals` never protected anything real here, and the shared function
    // does not repeat it. A non-finite VALUE passes through as-is rather than
    // becoming NaN — which only changes the answer for Infinity; NaN in is
    // still NaN out.
    expect(Number.isNaN(roundHalfUp(Number.NaN, 2))).toBe(true);
    expect(roundHalfUp(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("addMonths", () => {
  it("clamps into a shorter target month — 31.08.2027 + 6 months lands on 29.02.2028", () => {
    // Month 8 (0-based 7) + 6 = 13 (0-based), i.e. February of the next year;
    // 2028 is divisible by 4 and not by 100, so February has 29 days, and 31 is
    // clamped down to it.
    expect(addMonths({ year: 2027, month: 8, day: 31 }, 6)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it("clamps into a non-leap February — the same addition one year earlier lands on 28", () => {
    // Month 8 + 6 = 14 (0-based 7+6=13) -> February of the FOLLOWING year
    // (2027), which is not divisible by 4, so it has 28 days.
    expect(addMonths({ year: 2026, month: 8, day: 31 }, 6)).toEqual({
      year: 2027,
      month: 2,
      day: 28,
    });
  });

  it("walks backward across a year boundary with a negative count, no clamp needed", () => {
    // January has 31 days, so day 31 survives the subtraction unclamped.
    expect(addMonths({ year: 2027, month: 1, day: 31 }, -1)).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
  });

  it("uses the mathematical modulus, not a truncating one, for a large negative count", () => {
    // month 0 (0-based, i.e. January) minus 13 months: total = 0 − 13 = −13;
    // floor(−13/12) = −2 -> year 2027 − 2 = 2025; ((−13 % 12) + 12) % 12 = 11 ->
    // month 12 (December).
    expect(addMonths({ year: 2027, month: 1, day: 15 }, -13)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });
});

describe("cashflowNpvIrr", () => {
  it("finds the single root of a one-sign-change series and the exact payback points — CF = [−1000, 0, 1210] at 10%", () => {
    const result = cashflowNpvIrr({ cashflows: [-1000, 0, 1210], discountRate: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // CF_0 undiscounted: −1000,00. CF_1 / 1.1 = 0,00. CF_2 / 1.1² = 1210/1.21 = 1000,00.
    expect(result.discounted[0]).toBeCloseTo(-1000, 6);
    expect(result.discounted[1]).toBeCloseTo(0, 6);
    expect(result.discounted[2]).toBeCloseTo(1000, 6);
    // NSV = −1000 + 0 + 1000 = 0,00.
    expect(result.npv).toBeCloseTo(0, 6);
    expect(result.undiscountedTotal).toBeCloseTo(210, 6); // −1000 + 0 + 1210
    // Exactly one sign change among the non-zero flows (−, then +); the zero
    // flow in between must NOT itself count as a change of sign.
    expect(result.signChanges).toBe(1);
    // (1+x)² = 1,21 -> x = 0,10 -> 10,0000%.
    expect(result.irr.outcome).toBe("found");
    if (result.irr.outcome !== "found") return;
    expect(result.irr.percentPerPeriod).toBeCloseTo(10, 4);
    // Undiscounted payback: cumulative is −1000, −1000, 210 — crosses zero at
    // t = 2, carried by a flow of 1210: payback = (2−1) + 1000/1210 = 1,826446…
    expect(result.paybackPlain).toBeCloseTo(1.826446, 6);
    // Discounted payback: cumulative is −1000, −1000, 0,00 exactly — crosses at
    // t = 2, carried by a flow of 1000,00: payback = (2−1) + 1000/1000 = 2,00.
    expect(result.paybackDiscounted).toBeCloseTo(2, 6);
    // Exactly one crossing on each cumulative — `paybackPlain` reports the
    // whole story here, unlike the multi-crossing vector below.
    expect(result.paybackPlainCrossings).toBe(1);
    expect(result.paybackDiscountedCrossings).toBe(1);
  });

  it("closes the form by hand for CF = [−1000, 600, 600] at 10% — 3u² + 3u − 5 = 0", () => {
    const result = cashflowNpvIrr({ cashflows: [-1000, 600, 600], discountRate: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 600/1.1 = 545,454545…; 600/1.21 = 495,867769…
    expect(result.discounted[1]).toBeCloseTo(545.454545, 6);
    expect(result.discounted[2]).toBeCloseTo(495.867769, 6);
    // NSV = −1000 + 545,454545 + 495,867769 = 41,322314.
    expect(result.npv).toBeCloseTo(41.322314, 6);
    // u = 1/(1+x): 3u² + 3u − 5 = 0 -> u = (√69 − 3)/6 = (8,306623863 − 3)/6
    //   = 0,884437310; x = 1/u − 1 = 0,130662386 -> 13,0662%.
    expect(result.irr.outcome).toBe("found");
    if (result.irr.outcome !== "found") return;
    expect(result.irr.percentPerPeriod).toBeCloseTo(13.0662, 3);
    // Undiscounted payback: cumulative −1000, −400, 200 — crosses at t = 2,
    // carried by 600: payback = 1 + 400/600 = 1,666667.
    expect(result.paybackPlain).toBeCloseTo(1.666667, 6);
  });

  it("withholds the IRR as not-unique for a two-sign-change series, and says which two roots exist — CF = [−1000, 2500, −1500]", () => {
    const result = cashflowNpvIrr({ cashflows: [-1000, 2500, -1500], discountRate: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // −, then +, then − again: two sign changes among the non-zero flows.
    expect(result.signChanges).toBe(2);
    // `toEqual` on the whole outcome, not just its name: a withheld IRR must
    // carry NO rate at all, which is now unrepresentable rather than asserted.
    expect(result.irr).toEqual({ outcome: "notUnique" });
    // NSV is still reported: −1000 + 2500/1,1 + (−1500)/1,21
    //   = −1000 + 2272,727273 − 1239,669421 = 33,057851.
    expect(result.npv).toBeCloseTo(33.057851, 6);
    // Verification that two real roots really do exist here (not asserted by
    // the function, just the reason notUnique is the right call): with
    // u = 1/(1+x), −1500u² + 2500u − 1000 = 0, i.e. 3u² − 5u + 2 = 0,
    // u = (5 ± 1)/6 -> u = 1 (x = 0%) and u = 2/3 (x = 50%).
    // NSV(0%) = −1000 + 2500 − 1500 = 0. NSV(50%) = −1000 + 2500/1,5 − 1500/2,25
    //   = −1000 + 1666,667 − 666,667 = 0.
  });

  it("reports the IRR as outside the searched range when both bracket ends share a sign, rather than converging on an endpoint", () => {
    // CF = [−1, 100]: exactly one sign change, so the search runs. The true
    // root is x = 100/1 − 1 = 99 (9900%), far past the +1000% bracket end.
    // NPV(−0,9999) = −1 + 100/0,0001 = 999.999 > 0.
    // NPV(10) = −1 + 100/11 = 8,0909… > 0. Same sign at both ends: the tool
    // must say the root is outside the search range, not print x = 1000%.
    const result = cashflowNpvIrr({ cashflows: [-1, 100], discountRate: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signChanges).toBe(1);
    expect(result.irr).toEqual({ outcome: "outsideSearchRange" });
  });

  it("reports no IRR NOR payback for a series with no sign change at all — every flow the same sign", () => {
    const result = cashflowNpvIrr({ cashflows: [1000, 500, 200], discountRate: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signChanges).toBe(0);
    expect(result.irr).toEqual({ outcome: "noSignChange" });
    // No cumulative ever goes negative: there was no outlay to recover from,
    // so a reported payback of 0 would NAME a quantity — a payback period —
    // that this series does not have. Withheld, not printed as 0.
    expect(result.paybackPlain).toBeUndefined();
    expect(result.paybackDiscounted).toBeUndefined();
    expect(result.paybackPlainCrossings).toBe(0);
  });

  it("counts every crossing of the payback threshold, not only the first — CF = [−1000, 2000, −1500, 3000]", () => {
    // Cumulative walk (rate 0%, so discounted = raw): −1000, 1000, −500, 2500 —
    // up through zero at t = 1, back under at t = 2, up again at t = 3: three
    // crossings, though `paybackPlain` can only ever report the first of them.
    // paybackPlain: shortfall of 1000 at t = 0, carried by CF_1 = 2000:
    //   payback = (1 − 1) + 1000/2000 = 0,5 — silent about the t = 2 dip.
    // Three sign changes among the raw flows too (−,+,−,+), so IRR is
    // withheld as not-unique, consistent with `signChanges`.
    const result = cashflowNpvIrr({ cashflows: [-1000, 2000, -1500, 3000], discountRate: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signChanges).toBe(3);
    expect(result.irr).toEqual({ outcome: "notUnique" });
    expect(result.paybackPlain).toBeCloseTo(0.5, 9);
    expect(result.paybackPlainCrossings).toBe(3);
    expect(result.paybackDiscounted).toBeCloseTo(0.5, 9);
    expect(result.paybackDiscountedCrossings).toBe(3);
  });

  it("reports undefined payback when the cumulative never climbs back to zero", () => {
    const result = cashflowNpvIrr({ cashflows: [-1000, 100, 100], discountRate: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paybackPlain).toBeUndefined();
    expect(result.paybackDiscounted).toBeUndefined();
  });

  it("refuses an empty series, a non-finite flow, and a discount rate at or below −100%", () => {
    expect(cashflowNpvIrr({ cashflows: [], discountRate: 10 })).toEqual({
      ok: false,
      reason: "cashflows",
    });
    expect(cashflowNpvIrr({ cashflows: [-100, Number.NaN], discountRate: 10 })).toEqual({
      ok: false,
      reason: "cashflows",
    });
    expect(cashflowNpvIrr({ cashflows: [-100, 100], discountRate: -100 })).toEqual({
      ok: false,
      reason: "discountRate",
    });
    expect(cashflowNpvIrr({ cashflows: [-100, 100], discountRate: -150 })).toEqual({
      ok: false,
      reason: "discountRate",
    });
  });
});

describe("costAllocation", () => {
  it("splits a three-way tie by entry order — 100,00 over weights (1,1,1) at a 0,01 step", () => {
    // U = 100 / 0,01 = 10000 units. q_i = 10000 × 1/3 = 3333,3333 for each row;
    // baza_i = 3333 (floor), Σ baza = 9999, R = 10000 − 9999 = 1.
    // Every exact remainder is 3333,3333… − 3333 = 1/3, an exact three-way tie —
    // only representable because the remainder is BigInt, not a float — and the
    // earlier-entered row (index 0) wins the stable sort.
    const result = costAllocation({ total: 100, weights: [1, 1, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.units).toBe(3334);
    expect(result.rows[1]?.units).toBe(3333);
    expect(result.rows[2]?.units).toBe(3333);
    expect(result.rows[0]?.amount).toBeCloseTo(33.34, 9);
    expect(result.rows[1]?.amount).toBeCloseTo(33.33, 9);
    expect(result.rows[2]?.amount).toBeCloseTo(33.33, 9);
    expect(result.rows[0]?.gotRemainderUnit).toBe(true);
    expect(result.rows[1]?.gotRemainderUnit).toBe(false);
    expect(result.remainderUnits).toBe(1);
    // 33,34 + 33,33 + 33,33 = 100,00 — exact by construction, never a float sum.
    expect(result.checkSum).toBeCloseTo(100, 9);
    // share = w_i / Σw × 100 = 33,3333…%, and exact = 12500 × w_i/W — informative
    // only, never the source of `amount`.
    expect(result.rows[0]?.share).toBeCloseTo(33.333333, 6);
    expect(result.rows[0]?.exact).toBeCloseTo(33.333333, 6);
  });

  it("gives the largest remainder to the areas that actually have it — 12.500,00 over 45,50 / 62,30 / 78,20 m²", () => {
    // W = 186,00. U = 12500 / 0,01 = 1.250.000 units.
    // q_1 = 1.250.000 × 45,5/186 = 305.779,569892 -> baza 305.779, ostatak 0,569892
    // q_2 = 1.250.000 × 62,3/186 = 418.682,795699 -> baza 418.682, ostatak 0,795699
    // q_3 = 1.250.000 × 78,2/186 = 525.537,634409 -> baza 525.537, ostatak 0,634409
    // Σ baza = 1.249.998, R = 2 — the two LARGEST remainders (row 2, then row 3)
    // each take one unit; row 1's remainder (0,5699) is the smallest of the three.
    const result = costAllocation({ total: 12500, weights: [45.5, 62.3, 78.2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.gotRemainderUnit).toBe(false);
    expect(result.rows[1]?.gotRemainderUnit).toBe(true);
    expect(result.rows[2]?.gotRemainderUnit).toBe(true);
    expect(result.rows[0]?.amount).toBeCloseTo(3057.79, 6);
    expect(result.rows[1]?.amount).toBeCloseTo(4186.83, 6);
    expect(result.rows[2]?.amount).toBeCloseTo(5255.38, 6);
    expect(result.rows[0]?.exact).toBeCloseTo(3057.795699, 6);
    expect(result.checkSum).toBeCloseTo(12500, 6);
    expect(result.remainderUnits).toBe(2);
  });

  it("resolves a 2:1 weight split at a whole-unit step — 10,00 over weights (1, 2)", () => {
    // U = 10 / 1 = 10 units. q_1 = 10/3 = 3,3333, q_2 = 20/3 = 6,6667.
    // baza (3, 6), Σ = 9, R = 1 — the larger remainder (0,6667 > 0,3333) belongs
    // to the second row.
    const result = costAllocation({ total: 10, weights: [1, 2], step: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.units).toBe(3);
    expect(result.rows[1]?.units).toBe(7);
    expect(result.checkSum).toBeCloseTo(10, 9);
  });

  it("splits a refund (negative total) by absolute value and restores the sign at the end", () => {
    const result = costAllocation({ total: -100, weights: [1, 1, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.amount).toBeCloseTo(-33.34, 9);
    expect(result.rows[1]?.amount).toBeCloseTo(-33.33, 9);
    expect(result.checkSum).toBeCloseTo(-100, 9);
  });

  it("gives every row zero when the total to split is zero", () => {
    const result = costAllocation({ total: 0, weights: [1, 2, 3] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const row of result.rows) expect(row.amount).toBe(0);
    expect(result.checkSum).toBe(0);
    expect(result.remainderUnits).toBe(0);
  });

  it("refuses a total that is not an exact multiple of the step, rather than silently rewriting the whole", () => {
    // 100,005 / 0,01 = 10000,5 — not a whole number of units. Rewriting it to
    // 100,01 (as `round(total/step)` would) breaks the promise that the check
    // sum equals the amount the user actually typed.
    expect(costAllocation({ total: 100.005, weights: [1, 1] })).toEqual({
      ok: false,
      reason: "total",
    });
  });

  it("refuses a non-finite total, an empty row list, a non-positive step and a non-positive weight — one case per reason", () => {
    expect(costAllocation({ total: Number.NaN, weights: [1, 1] })).toEqual({
      ok: false,
      reason: "total",
    });
    expect(costAllocation({ total: 100, weights: [] })).toEqual({
      ok: false,
      reason: "weights",
    });
    expect(costAllocation({ total: 100, weights: [1, 1], step: 0 })).toEqual({
      ok: false,
      reason: "step",
    });
    expect(costAllocation({ total: 100, weights: [1, -1] })).toEqual({
      ok: false,
      reason: "weight",
    });
    expect(costAllocation({ total: 100, weights: [0, 1] })).toEqual({
      ok: false,
      reason: "weight",
    });
  });
});

describe("latePaymentInterest", () => {
  it("agrees between methods at exactly one year — 100.000 at 10% for 365 days on a 365 base", () => {
    // f = 365/365 = 1. Proportional K = 100.000 × 0,10 × 1 = 10.000,00.
    // Conformal K = 100.000 × (1,10¹ − 1) = 10.000,00 — the two methods must
    // agree at f = 1, which is the useful cross-check on both.
    const proportional = latePaymentInterest({
      debt: 100000,
      annualRate: 10,
      days: 365,
      basis: "d365",
      method: "proportional",
    });
    const conformal = latePaymentInterest({
      debt: 100000,
      annualRate: 10,
      days: 365,
      basis: "d365",
      method: "conformal",
    });
    expect(proportional.ok && conformal.ok).toBe(true);
    if (!proportional.ok || !conformal.ok) return;
    expect(proportional.interest).toBeCloseTo(10000, 6);
    expect(conformal.interest).toBeCloseTo(10000, 6);
    expect(proportional.total).toBeCloseTo(110000, 6);
    expect(proportional.ratioToDebt).toBeCloseTo(10, 4);
    expect(proportional.compoundsAnnually).toBe(false); // yearFraction is 1, not > 1
    expect(conformal.compoundsAnnually).toBe(false);
  });

  it("gives the conformal method LESS than the proportional one below a year — 180 days at 10% on a 365 base", () => {
    // f = 180/365 = 0,493150685.
    // Proportional K = 100.000 × 0,10 × 0,493150685 = 4.931,50685 -> 4.931,51
    //   (ratio 4,9315%).
    // Conformal: ln(1,1) = 0,095310180, × f = 0,047002281, e^0,047002281 =
    //   1,048124398 -> K = 100.000 × 0,048124398 = 4.812,4398 -> 4.812,44.
    const proportional = latePaymentInterest({
      debt: 100000,
      annualRate: 10,
      days: 180,
      basis: "d365",
      method: "proportional",
    });
    const conformal = latePaymentInterest({
      debt: 100000,
      annualRate: 10,
      days: 180,
      basis: "d365",
      method: "conformal",
    });
    expect(proportional.ok && conformal.ok).toBe(true);
    if (!proportional.ok || !conformal.ok) return;
    expect(proportional.interest).toBeCloseTo(4931.51, 2);
    expect(proportional.ratioToDebt).toBeCloseTo(4.9315, 3);
    expect(conformal.interest).toBeCloseTo(4812.44, 2);
    expect(conformal.interest).toBeLessThan(proportional.interest);
  });

  it("splits the ACT/ACT year at the calendar boundary and reports each segment's own divisor — 01.12.2027 to 31.01.2028", () => {
    // Days in arrears: due date not counted, payment date counted — 61 days
    // total (30 in December 2027 + 31 in January 2028), independently confirmed
    // by whole-day civil counting (Date.UTC(2028,0,31) − Date.UTC(2027,11,1) in
    // days = 61).
    // f = 30/365 + 31/366 = 0,082191781 + 0,084699454 = 0,166891235
    //   (2028 is divisible by 4 and not by 100, so its divisor is 366).
    // K = 50.000 × 0,12 × 0,166891235 = 1.001,347406 -> 1.001,35.
    const result = latePaymentInterest({
      debt: 50000,
      annualRate: 12,
      dueDate: { year: 2027, month: 12, day: 1 },
      paymentDate: { year: 2028, month: 1, day: 31 },
      basis: "actual",
      method: "proportional",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toBe(61);
    expect(result.yearFraction).toBeCloseTo(0.166891235, 6);
    expect(result.interest).toBeCloseTo(1001.35, 2);
    expect(result.segments).toEqual([
      { year: 2027, days: 30, yearLength: 365 },
      { year: 2028, days: 31, yearLength: 366 },
    ]);
  });

  it("reports zero interest, not a refusal, for zero days in arrears", () => {
    const result = latePaymentInterest({
      debt: 10000,
      annualRate: 10,
      days: 0,
      basis: "d365",
      method: "proportional",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interest).toBe(0);
    expect(result.total).toBe(10000);
    // No day to divide by — an average per-day figure has no meaning at zero days.
    expect(result.interestPerDay).toBeUndefined();
  });

  it("cross-checks a day count against an anchor due date with the implied payment date", () => {
    const result = latePaymentInterest({
      debt: 10000,
      annualRate: 10,
      dueDate: { year: 2027, month: 3, day: 1 },
      days: 30,
      basis: "d365",
      method: "proportional",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.impliedPaymentDate).toEqual({ year: 2027, month: 3, day: 31 });
    expect(result.interestPerDay).toBeCloseTo(result.interest / 30, 2);
  });

  it("divides the UNROUNDED interest by days, not the already-rounded `interest` — 108.162 at 1% over 4 days on a 360 base", () => {
    // f = 4/360 = 1/90. rawInterest = 108.162 × 0,01 × 1/90 = 1.081,62/90 =
    //   12,018 exactly. interest = round(12,018, 2) = 12,02 (third decimal 8
    //   rounds the cent up).
    // interestPerDay reads the UNROUNDED numerator: 12,018/4 = 3,0045, which is
    //   BELOW the 3,005 tie and so rounds DOWN to 3,00.
    // The wrong reading — dividing the already-rounded `interest` instead —
    //   gives 12,02/4 = 3,005 EXACTLY, a genuine tie that rounds UP to 3,01.
    //   The two readings disagree by a whole cent, which no earlier vector in
    //   this suite could show (a=b coincidences aside, 30 does not divide
    //   either interest figure into two different cent buckets).
    const result = latePaymentInterest({
      debt: 108162,
      annualRate: 1,
      days: 4,
      basis: "d360",
      method: "proportional",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interest).toBeCloseTo(12.02, 6);
    expect(result.interestPerDay).toBeCloseTo(3.0, 6);
  });

  it("refuses a non-positive debt, an out-of-range rate, a payment before the due date, and a missing date under the actual basis — one case per reason", () => {
    expect(
      latePaymentInterest({ debt: 0, annualRate: 10, days: 10, basis: "d365", method: "proportional" }),
    ).toEqual({ ok: false, reason: "debt" });
    expect(
      latePaymentInterest({
        debt: 1000,
        annualRate: 1200,
        days: 10,
        basis: "d365",
        method: "proportional",
      }),
    ).toEqual({ ok: false, reason: "annualRate" });
    expect(
      latePaymentInterest({
        debt: 1000,
        annualRate: 10,
        dueDate: { year: 2027, month: 5, day: 10 },
        paymentDate: { year: 2027, month: 5, day: 1 },
        basis: "d365",
        method: "proportional",
      }),
    ).toEqual({ ok: false, reason: "paymentDate" });
    expect(
      latePaymentInterest({ debt: 1000, annualRate: 10, basis: "actual", method: "proportional" }),
    ).toEqual({ ok: false, reason: "dueDate" });
  });
});

describe("leaseTermDates", () => {
  it("gives the term, the notice deadline and the instalment list — 15.03.2027, 12 months, 30-day notice, instalments on the 1st", () => {
    // Expiry = addMonths(15.03.2027, 12) = 15.03.2028; last valid day = 14.03.2028.
    // Notice: 14.03.2028 − 30 days. March has a 14-day prefix (to the 1st, minus
    // the day itself: 14 days) then 16 more into February; 2028 is leap, so
    // 14.03 − 14 days = 29.02.2028, then − 16 days = 13.02.2028.
    // Total days = 366 (the period spans the 29th of February 2028).
    // Instalments on day 1: the candidate in the start month (01.03.2027) is
    // BEFORE the start (15.03.2027), so M0 is April; twelve dates follow, one
    // per month, ending 01.03.2028.
    const result = leaseTermDates({
      start: { year: 2027, month: 3, day: 15 },
      months: 12,
      noticeAmount: 30,
      noticeUnit: "days",
      installmentDay: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiry).toEqual({ year: 2028, month: 3, day: 15 });
    expect(result.expiryDayClamped).toBe(false); // 15 exists in every month; nothing was clamped
    expect(result.lastValidDay).toEqual({ year: 2028, month: 3, day: 14 });
    expect(result.noticeDeadline).toEqual({ year: 2028, month: 2, day: 13 });
    expect(result.noticeBeforeStart).toBe(false);
    expect(result.totalDays).toBe(366);
    expect(result.installments).toHaveLength(12);
    expect(result.installments[0]).toEqual({ year: 2027, month: 4, day: 1 });
    expect(result.installments[11]).toEqual({ year: 2028, month: 3, day: 1 });
  });

  it("clamps the expiry day into a shorter February and reports the clamp — 31.08.2027 plus 6 months", () => {
    // Month 8 + 6 = 14 -> February 2028; day min(31, 29) = 29 (2028 is leap) —
    // the day was shortened, and the tool says so.
    // Last valid day = 28.02.2028. Total days: 31 (Aug, the start day counts) +
    // 30 (Sep) + 31 (Oct) + 30 (Nov) + 31 (Dec) + 31 (Jan) + 28 (Feb) = 182.
    // Instalments on day 31: the start-month candidate (31.08.2027) EQUALS the
    // start date, so it is the first instalment; each later one is min(31, that
    // month's length), always computed from the August anchor.
    const result = leaseTermDates({
      start: { year: 2027, month: 8, day: 31 },
      months: 6,
      installmentDay: 31,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiry).toEqual({ year: 2028, month: 2, day: 29 });
    expect(result.expiryDayClamped).toBe(true);
    expect(result.lastValidDay).toEqual({ year: 2028, month: 2, day: 28 });
    expect(result.totalDays).toBe(182);
    expect(result.installments).toEqual([
      { year: 2027, month: 8, day: 31 },
      { year: 2027, month: 9, day: 30 },
      { year: 2027, month: 10, day: 31 },
      { year: 2027, month: 11, day: 30 },
      { year: 2027, month: 12, day: 31 },
      { year: 2028, month: 1, day: 31 },
    ]);
  });

  it("reports a notice deadline before the contract's own start, without hiding or clamping it", () => {
    // Expiry = 01.09.2027; last valid day = 31.08.2027.
    // Notice 4 months back: addMonths(31.08.2027, −4) = 30.04.2027 — a date
    // before the 01.06.2027 start, reported as-is (the granting edge case).
    const result = leaseTermDates({
      start: { year: 2027, month: 6, day: 1 },
      months: 3,
      noticeAmount: 4,
      noticeUnit: "months",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiry).toEqual({ year: 2027, month: 9, day: 1 });
    expect(result.lastValidDay).toEqual({ year: 2027, month: 8, day: 31 });
    expect(result.noticeDeadline).toEqual({ year: 2027, month: 4, day: 30 });
    expect(result.noticeBeforeStart).toBe(true);
  });

  it("gives no installment list at all when no day-of-month was typed", () => {
    const result = leaseTermDates({ start: { year: 2027, month: 1, day: 1 }, months: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.installments).toEqual([]);
    expect(result.noticeDeadline).toBeUndefined();
  });

  it("refuses an impossible start date, an out-of-range term, an out-of-range installment day, and a notice amount without its unit — one case per reason", () => {
    expect(
      leaseTermDates({ start: { year: 2027, month: 2, day: 30 }, months: 6 }),
    ).toEqual({ ok: false, reason: "start" });
    expect(leaseTermDates({ start: { year: 2027, month: 1, day: 1 }, months: 0 })).toEqual({
      ok: false,
      reason: "months",
    });
    expect(
      leaseTermDates({ start: { year: 2027, month: 1, day: 1 }, months: 6, installmentDay: 32 }),
    ).toEqual({ ok: false, reason: "installmentDay" });
    expect(
      leaseTermDates({ start: { year: 2027, month: 1, day: 1 }, months: 6, noticeAmount: 30 }),
    ).toEqual({ ok: false, reason: "noticeUnit" });
  });
});

describe("loanAmortization", () => {
  it("takes the zero-rate branch everywhere the rate would otherwise divide — 100.000 over 10 months at 0%", () => {
    // i = 0 -> A = P/n = 100.000/10 = 10.000,00 exactly, and every row's
    // interest is 0 by the zero-rate branch.
    const result = loanAmortization({ principal: 100000, annualRate: 0, months: 10, balanceMonth: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment).toBe(10000);
    expect(result.totalPaid).toBeCloseTo(100000, 6);
    expect(result.totalInterest).toBeCloseTo(0, 9);
    expect(result.principalSum).toBeCloseTo(100000, 6);
    // Ostatak posle 5. rate = 100.000 − 5 × 10.000 = 50.000,00.
    expect(result.balanceAt).toBeCloseTo(50000, 6);
    expect(result.schedule[0]?.interest).toBe(0);
    expect(result.schedule[9]?.balance).toBe(0);
  });

  it("builds the table from the ROUNDED instalment, so the principal column sums to exactly P — 10.000 at 12% over 12 months", () => {
    // i = 0,01. 1,01^12 = 1,126825030132; 1,01^(−12) = 0,887449225.
    // A = 10.000 × 0,01 / (1 − 0,887449225) = 100/0,112550775 = 888,487887 ->
    // rounded instalment 888,49.
    // Row 1: interest = round(10.000 × 0,01, 2) = 100,00; principal = 888,49 −
    // 100,00 = 788,49; balance = 9.211,51.
    const result = loanAmortization({ principal: 10000, annualRate: 12, months: 12, balanceMonth: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment).toBe(888.49);
    expect(result.schedule[0]).toEqual({
      month: 1,
      payment: 888.49,
      interest: 100,
      principal: 788.49,
      balance: 9211.51,
    });
    // Every row's principal is (rounded payment − rounded interest), so the sum
    // telescopes to exactly the principal — no cent left over to disclose.
    expect(result.principalSum).toBeCloseTo(10000, 9);
    expect(result.totalPaid).toBeCloseTo(10661.86, 2);
    expect(result.totalInterest).toBeCloseTo(661.86, 2);
    // **Read from the rounded table, not the closed form.** The closed form
    // 1,01^6 = 1,061520150601 gives B_6 = 10.615,201506 − 5.465,990860 =
    // 5.149,21 — but that is the balance of a payment stream that never
    // actually happens, because the bank charges the ROUNDED 888,49 every
    // month. Compounding the table's own per-row rounding for six rows lands
    // one cent lower, at 5.149,20 (independently re-derived by running the
    // same six rows of arithmetic by hand): 100,00/92,12/84,15/76,11/67,98/
    // 59,78 interest, leaving principal 788,49/796,37/804,34/812,38/820,51/
    // 828,71 and a running balance of 9.211,51/8.415,14/7.610,80/6.798,42/
    // 5.977,91/5.149,20. This is exactly the ISPRAVKE's own warning that the
    // closed form and the table disagree by a cent once every row rounds.
    expect(result.balanceAt).toBeCloseTo(5149.2, 2);
  });

  it("closes the loan immediately when the prepayment covers the whole balance", () => {
    const result = loanAmortization({
      principal: 1000,
      annualRate: 0,
      months: 4,
      prepayment: 1000,
      prepaymentMonth: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepaymentEffect).toEqual({ kind: "closes", payoff: 1000 });
  });

  it("prices both prepayment options from the table's own post-prepayment balance, INCLUDING the prepayment in totalPaid", () => {
    // From the previous test's table, the balance after the 6th instalment is
    // 5.149,20 (table, not closed form). B' = 5.149,20 − 2.000 = 3.149,20.
    // Variant B (same term, lower payment), remaining = 6 months:
    //   A' = 31,492 × / (1 − 1,01^−6) ≈ 543,39 (the 1-cent difference in B'
    //   from the closed form does not survive rounding to the cent here).
    // Variant A (same payment, shorter term):
    //   B'·i/A = 31,492/888,49 = 0,035445; −ln(1 − 0,035445) = 0,036088;
    //   ln(1,01) = 0,0099503; n' = ceil(3,6268) = 4 instalments.
    // Both totals below were independently re-derived by hand-running the same
    // rounded-row arithmetic the schedule itself uses, six then four (or six)
    // more rows deep — see the report for the full row-by-row figures.
    const result = loanAmortization({
      principal: 10000,
      annualRate: 12,
      months: 12,
      prepayment: 2000,
      prepaymentMonth: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.prepaymentEffect;
    expect(effect?.kind).toBe("options");
    if (effect?.kind !== "options") return;
    expect(effect.balanceBefore).toBeCloseTo(5149.2, 2);
    expect(effect.balanceAfter).toBeCloseTo(3149.2, 2);
    expect(effect.lowerPayment.instalments).toBe(6);
    expect(effect.lowerPayment.payment).toBeCloseTo(543.39, 2);
    expect(effect.lowerPayment.totalInterest).toBeCloseTo(591.27, 2);
    // totalPaid MUST include the 2.000 prepayment itself — without it the two
    // variants are not comparable with the no-prepayment total.
    expect(effect.lowerPayment.totalPaid).toBeCloseTo(10591.27, 2);
    expect(effect.lowerPayment.interestSavings).toBeCloseTo(70.59, 2);
    expect(effect.shorterTerm.instalments).toBe(4);
    expect(effect.shorterTerm.payment).toBe(888.49);
    // Row by row from B' = 3.149,20 at i = 0,01: interest 31,49/22,92/14,27/5,52,
    // principal 857,00/865,57/874,22/552,41 (the last row absorbs the balance),
    // balance 2.292,20/1.426,63/552,41/0,00. The 4th (final) row's payment is
    // balance + interest = 552,41 + 5,52 = 557,93 — the reduced last instalment
    // ISPRAVKA (4) asks for, and this pack's own table, not the assignment's
    // illustrative 557,95 (which is the unrounded closed form, not this table).
    expect(effect.shorterTerm.finalPayment).toBeCloseTo(557.93, 2);
    expect(effect.shorterTerm.totalInterest).toBeCloseTo(554.34, 2);
    expect(effect.shorterTerm.totalPaid).toBeCloseTo(10554.34, 2);
    expect(effect.shorterTerm.interestSavings).toBeCloseTo(107.52, 2);
    // Interest saved is strictly positive under both options — a real
    // prepayment reduces total interest under a level-instalment loan.
    expect(effect.lowerPayment.interestSavings).toBeGreaterThan(0);
    expect(effect.shorterTerm.interestSavings).toBeGreaterThan(0);
  });

  it("refuses a non-positive principal, an out-of-range rate, an out-of-range term count, and a prepayment given without its month — one case per reason", () => {
    expect(loanAmortization({ principal: 0, annualRate: 5, months: 12 })).toEqual({
      ok: false,
      reason: "principal",
    });
    expect(loanAmortization({ principal: 1000, annualRate: 150, months: 12 })).toEqual({
      ok: false,
      reason: "annualRate",
    });
    expect(loanAmortization({ principal: 1000, annualRate: 5, months: 0 })).toEqual({
      ok: false,
      reason: "months",
    });
    expect(
      loanAmortization({ principal: 1000, annualRate: 5, months: 12, prepayment: 100 }),
    ).toEqual({ ok: false, reason: "prepaymentMonth" });
    expect(
      loanAmortization({ principal: 1000, annualRate: 5, months: 12, prepaymentMonth: 3 }),
    ).toEqual({ ok: false, reason: "prepayment" });
  });
});

describe("ownershipShares", () => {
  it("sums thirds and a twelfth to exactly one, over BigInt fractions never decimals — 1/3, 1/4, 5/12 of 240,00 m²", () => {
    // Common denominator 12: 1/3 -> 4/12, 1/4 -> 3/12, 5/12 -> 5/12; sum =
    // 12/12, reduced to 1/1 — tested on the FRACTION, because 1/3 + 1/4 + 5/12
    // never lands on exactly 100% in decimal for any number of digits.
    // Percent: 4/12×100 = 33,3333%; 3/12×100 = 25,0000%; 5/12×100 = 41,6667%
    //   (half-up BigInt division catches this one: truncating gives 41,6666%).
    // Area: 240×1/3 = 80,00; 240×1/4 = 60,00; 240×5/12 = 100,00; Σ = 240,00.
    const result = ownershipShares({
      rows: [
        { numerator: 1, denominator: 3 },
        { numerator: 1, denominator: 4 },
        { numerator: 5, denominator: 12 },
      ],
      totalArea: 240,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.percent).toBeCloseTo(33.3333, 4);
    expect(result.rows[1]?.percent).toBeCloseTo(25, 4);
    expect(result.rows[2]?.percent).toBeCloseTo(41.6667, 4);
    expect(result.rows[0]?.area).toBeCloseTo(80, 6);
    expect(result.rows[1]?.area).toBeCloseTo(60, 6);
    expect(result.rows[2]?.area).toBeCloseTo(100, 6);
    expect(result.commonDenominator).toBe("12");
    expect(result.rows[0]?.numeratorAtCommonDenominator).toBe("4");
    expect(result.rows[1]?.numeratorAtCommonDenominator).toBe("3");
    expect(result.rows[2]?.numeratorAtCommonDenominator).toBe("5");
    expect(result.sum).toEqual({ numerator: "1", denominator: "1", percent: 100 });
    expect(result.comparison).toBe("exact");
    expect(result.areaCheckSum).toBeCloseTo(240, 6);
    expect(result.areaDifference).toBeCloseTo(0, 6);
  });

  it("reproduces the half-up correction on 5/12 — a truncating BigInt division would print 41,6666%, not 41,6667%", () => {
    const result = ownershipShares({ rows: [{ numerator: 5, denominator: 12 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (5×2.000.000 + 12) / (2×12) = 10.000.012 / 24 = 416.667,1666… truncated
    // to 416.667 -> /10.000 = 41,6667.
    expect(result.rows[0]?.percent).toBeCloseTo(41.6667, 4);
  });

  it("reports a shortfall as a fraction, decided on the fraction never the percent — two thirds", () => {
    const result = ownershipShares({
      rows: [
        { numerator: 1, denominator: 3 },
        { numerator: 1, denominator: 3 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sum).toEqual({ numerator: "2", denominator: "3", percent: 66.6667 });
    expect(result.comparison).toBe("short");
    // Missing = 1 − 2/3 = 1/3.
    expect(result.difference).toEqual({ numerator: "1", denominator: "3", percent: 33.3333 });
  });

  it("reports an excess over the whole as a finding, not a refusal", () => {
    const result = ownershipShares({
      rows: [
        { numerator: 1, denominator: 2 },
        { numerator: 2, denominator: 3 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sum = 3/6 + 4/6 = 7/6 > 1.
    expect(result.comparison).toBe("over");
    expect(result.sum).toEqual({ numerator: "7", denominator: "6", percent: 116.6667 });
    // Excess = 7/6 − 1 = 1/6.
    expect(result.difference).toEqual({ numerator: "1", denominator: "6", percent: 16.6667 });
  });

  it("splits 137/1000 and 863/1000 of 512,40 m² exactly to the whole, area rounded per row", () => {
    // 137 × 512,40/1000 = 70,1988 -> 70,20. 863 × 512,40/1000 = 442,2012 ->
    // 442,20. 70,20 + 442,20 = 512,40 exactly — the two remainders here do not
    // even need the largest-remainder rule since 1000/1000 sums exactly.
    const result = ownershipShares({
      rows: [
        { numerator: 137, denominator: 1000 },
        { numerator: 863, denominator: 1000 },
      ],
      totalArea: 512.4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comparison).toBe("exact");
    expect(result.rows[0]?.area).toBeCloseTo(70.2, 6);
    expect(result.rows[1]?.area).toBeCloseTo(442.2, 6);
    expect(result.areaCheckSum).toBeCloseTo(512.4, 6);
  });

  it("refuses an out-of-range numerator, a non-positive denominator, an empty row list, and a non-positive total area — one case per reason", () => {
    expect(ownershipShares({ rows: [{ numerator: -1, denominator: 3 }] })).toEqual({
      ok: false,
      reason: "numerator",
    });
    expect(ownershipShares({ rows: [{ numerator: 1, denominator: 0 }] })).toEqual({
      ok: false,
      reason: "denominator",
    });
    expect(ownershipShares({ rows: [] })).toEqual({ ok: false, reason: "rows" });
    expect(ownershipShares({ rows: [{ numerator: 1, denominator: 3 }], totalArea: 0 })).toEqual({
      ok: false,
      reason: "totalArea",
    });
  });
});

describe("areaShareFraction", () => {
  it("reduces 58,40 m² of 186,00 m² to 146/465 by Euclid, both areas scaled by the SAME factor", () => {
    // 5840/18600; gcd(5840, 18600) = 40 (5840 = 2⁴·5·73, 18600 = 2³·3·5²·31,
    // shared 2³·5 = 40) -> 146/465.
    // percent = 14600/465 = 31,397849… -> 31,3978%.
    const result = areaShareFraction({ partArea: 58.4, wholeArea: 186 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe("146");
    expect(result.denominator).toBe("465");
    expect(result.percent).toBeCloseTo(31.3978, 4);
  });

  it("returns a fraction above 1 when the part exceeds the whole — a finding, not a refusal", () => {
    const result = areaShareFraction({ partArea: 20, wholeArea: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe("2");
    expect(result.denominator).toBe("1");
    expect(result.percent).toBe(200);
  });

  it("refuses a non-positive part area, a non-positive whole area, and more than two decimals in either — one case per reason", () => {
    expect(areaShareFraction({ partArea: 0, wholeArea: 100 })).toEqual({
      ok: false,
      reason: "partArea",
    });
    expect(areaShareFraction({ partArea: 10, wholeArea: 0 })).toEqual({
      ok: false,
      reason: "wholeArea",
    });
    // 58,405 has three decimals — the scaling that defines the fraction would
    // silently drop the third one, so it is refused rather than rounded away.
    expect(areaShareFraction({ partArea: 58.405, wholeArea: 186 })).toEqual({
      ok: false,
      reason: "partArea",
    });
  });
});

describe("parcelPolygonArea", () => {
  it("measures a 40×25 rectangle counter-clockwise — S = 2000, A = 1.000,00 m²", () => {
    // Shoelace terms: (0·0−40·0)=0; (40·25−40·0)=1000; (40·25−0·25)=1000;
    // (0·0−0·25)=0. S = 2000 (positive -> counter-clockwise). A = |S|/2 = 1.000,00.
    // O = 40 + 25 + 40 + 25 = 130,00.
    const result = parcelPolygonArea([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 25 },
      { x: 0, y: 25 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.area).toBeCloseTo(1000, 6);
    expect(result.ares).toBeCloseTo(10, 6); // A/100
    expect(result.hectares).toBeCloseTo(0.1, 6); // A/10000
    expect(result.perimeter).toBeCloseTo(130, 6);
    expect(result.orientation).toBe("ccw");
    expect(result.edges).toHaveLength(4);
    expect(result.edges[0]).toEqual({ from: 1, to: 2, length: 40 });
  });

  it("measures a 30-40-50 right triangle clockwise — S = 1200, but a swapped winding still gives the same area", () => {
    // Terms: 0; (30·40 − 0·0) = 1200; 0. S = 1200. A = 600,00 = 6,0000 ari =
    // 0,060000 ha. O = 30 + sqrt(30²+40²) + 40 = 30 + 50 + 40 = 120,00.
    const result = parcelPolygonArea([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 40 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.area).toBeCloseTo(600, 6);
    expect(result.ares).toBeCloseTo(6, 6);
    expect(result.hectares).toBeCloseTo(0.06, 6);
    expect(result.perimeter).toBeCloseTo(120, 6);
    expect(result.orientation).toBe("ccw");
  });

  it("keeps full precision at a real state-plane coordinate — a 20×20 m square gives exactly 400,00 m², not 399,99", () => {
    // Without translating by the first point, the raw shoelace cross products
    // subtract two seven-digit numbers agreeing in their first six digits and
    // lose the square's own precision to representation error; translating
    // first reduces every term to the size of the parcel itself.
    const anchor = { x: 7459123.456, y: 4876543.21 };
    const result = parcelPolygonArea([
      anchor,
      { x: anchor.x + 20, y: anchor.y },
      { x: anchor.x + 20, y: anchor.y + 20 },
      { x: anchor.x, y: anchor.y + 20 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.area).toBeCloseTo(400, 6);
    expect(result.perimeter).toBeCloseTo(80, 6);
  });

  it("refuses collinear points rather than printing a misleading 0,00 m² — three points on one line", () => {
    // S = 0: every shoelace term is zero for three collinear points.
    expect(
      parcelPolygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toEqual({ ok: false, reason: "collinear" });
  });

  it("refuses fewer than three distinct points", () => {
    expect(
      parcelPolygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual({ ok: false, reason: "points" });
  });

  it("refuses a self-intersecting ring — a bowtie quadrilateral", () => {
    // (0,0)-(10,10) crosses (10,0)-(0,10) strictly in the middle: the
    // Gauss/shoelace sum over a crossed ring is algebraic, not the enclosed
    // area, so this is refused rather than answered with a meaningless number.
    expect(
      parcelPolygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toEqual({ ok: false, reason: "selfIntersecting" });
  });
});

describe("plotDensityIndex", () => {
  it("gives the ratio, the coverage and the free area — 620 m² plot, 1.240 m² BRGP, 248 m² footprint", () => {
    // indeks izgrađenosti = 1240/620 = 2,00. zauzetost = 248/620×100 = 40,00%.
    // slobodno = 620 − 248 = 372,00 m² (60,0000% of the plot).
    // floorAreaToFootprintRatio = 1240/248 = 5,00 — a bare quotient, not a
    // storey count.
    const result = plotDensityIndex({ plotArea: 620, grossFloorArea: 1240, footprint: 248 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(2, 6);
    expect(result.coverage).toBeCloseTo(40, 6);
    expect(result.freeArea).toBeCloseTo(372, 6);
    expect(result.freeAreaPercent).toBeCloseTo(60, 6);
    expect(result.floorAreaToFootprintRatio).toBeCloseTo(5, 6);
  });

  it("gives what a typed plan ratio and coverage permit, plus the signed difference against a typed BRGP — 850 m² plot", () => {
    // BRGP at index = 850 × 1,6 = 1.360,00 m². Footprint at coverage = 850 ×
    // 0,5 = 425,00 m². Difference = 1.360,00 − 1.100,00 = +260,00 m² —
    // reported as arithmetic, not as "how much more is allowed".
    const result = plotDensityIndex({
      plotArea: 850,
      grossFloorArea: 1100,
      planRatio: 1.6,
      planCoverage: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grossFloorAreaAtPlanRatio).toBeCloseTo(1360, 6);
    expect(result.footprintAtPlanCoverage).toBeCloseTo(425, 6);
    expect(result.grossFloorAreaDifference).toBeCloseTo(260, 6);
    // The typed BRGP's own ratio is 1100/850 = 1,294118; against the plan's
    // 1,6 that is a bare quotient of 1,294118/1,6 = 0,808824 — not a verdict.
    expect(result.ratioAgainstPlan).toBeCloseTo(0.808824, 5);
  });

  it("gives the coverage-against-plan quotient and the signed footprint difference — 800 m² plot, 320 m² footprint, 45% plan coverage", () => {
    // zauzetost = 320/800×100 = 40,00%. footprintAtPlanCoverage = 800×0,45 =
    // 360,00 m². coverageAgainstPlan = 40/45 = 0,888889 — a bare quotient, not
    // a verdict. footprintDifference = 360,00 − 320,00 = +40,00 m².
    const result = plotDensityIndex({ plotArea: 800, footprint: 320, planCoverage: 45 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage).toBeCloseTo(40, 6);
    expect(result.footprintAtPlanCoverage).toBeCloseTo(360, 6);
    expect(result.coverageAgainstPlan).toBeCloseTo(0.888889, 5);
    expect(result.footprintDifference).toBeCloseTo(40, 6);
  });

  it("withholds the floor-to-footprint quotient at a zero footprint — not zero, not infinity", () => {
    // indeks izgrađenosti = 900/400 = 2,25. zauzetost = 0,00%. slobodno =
    // 400,00 m² (100% of the plot).
    const result = plotDensityIndex({ plotArea: 400, grossFloorArea: 900, footprint: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(2.25, 6);
    expect(result.coverage).toBe(0);
    expect(result.freeArea).toBe(400);
    expect(result.floorAreaToFootprintRatio).toBeUndefined();
  });

  it("leaves a footprint larger than the plot visible as a negative free area, not a refusal", () => {
    const result = plotDensityIndex({ plotArea: 400, footprint: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.freeArea).toBe(-100);
  });

  it("refuses a non-positive plot area, a negative BRGP, and an out-of-range plan coverage — one case per reason", () => {
    expect(plotDensityIndex({ plotArea: 0 })).toEqual({ ok: false, reason: "plotArea" });
    expect(plotDensityIndex({ plotArea: 100, grossFloorArea: -1 })).toEqual({
      ok: false,
      reason: "grossFloorArea",
    });
    expect(plotDensityIndex({ plotArea: 100, planCoverage: 0 })).toEqual({
      ok: false,
      reason: "planCoverage",
    });
    expect(plotDensityIndex({ plotArea: 100, planCoverage: 150 })).toEqual({
      ok: false,
      reason: "planCoverage",
    });
  });
});

describe("proRataDays", () => {
  it("splits 600,00 over March by the actual day count — N = 31, handover on the 12th", () => {
    // N = 31 (March). n_A = 11 (01.03 to 12.03, handover date not counted for
    // the first occupier). n_B = 31 − 11 = 20.
    // iznos_A = 600 × 11/31 = 6600/31 = 212,903226 -> 212,90.
    // iznos_B = 600 − 212,90 = 387,10 (a remainder, never rounded on its own).
    const result = proRataDays({
      total: 600,
      periodStart: { year: 2027, month: 3, day: 1 },
      periodEnd: { year: 2027, month: 3, day: 31 },
      handover: { year: 2027, month: 3, day: 12 },
      basis: "act",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDays).toBe(31);
    expect(result.daysFirst).toBe(11);
    expect(result.daysSecond).toBe(20);
    expect(result.amountFirst).toBeCloseTo(212.9, 2);
    expect(result.amountSecond).toBeCloseTo(387.1, 2);
    expect(result.checkSum).toBeCloseTo(600, 9);
  });

  it("uses N spanning the WHOLE period on 30E/360, not one calendar month from the start — same March period", () => {
    // The corrected N = dani30E(start, end+1 day) = dani30E(01.03, 01.04) =
    // 30×(0) + 30×(1) + (min(1,30) − min(1,30)) = 30 — which for a period that
    // IS one calendar month coincides with the old (wrong) `addMonths` reading,
    // so this vector alone cannot distinguish the two; the 45-day case below can.
    // n_A = dani30E(01.03, 12.03) = 30×0 + 30×0 + (12 − 1) = 11. n_B = 19.
    // iznos_A = 600 × 11/30 = 220,00. iznos_B = 600 × 19/30 = 380,00.
    const result = proRataDays({
      total: 600,
      periodStart: { year: 2027, month: 3, day: 1 },
      periodEnd: { year: 2027, month: 3, day: 31 },
      handover: { year: 2027, month: 3, day: 12 },
      basis: "e30360",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDays).toBe(30);
    expect(result.daysFirst).toBe(11);
    expect(result.amountFirst).toBeCloseTo(220, 6);
    expect(result.amountSecond).toBeCloseTo(380, 6);
  });

  it("keeps N equal to the true 45-day span under 30E/360, where addMonths(start, 1) would have silently disagreed", () => {
    // Period 01.03.2027 .. 14.04.2027 inclusive (45 calendar days). The
    // CORRECT denominator is dani30E(01.03.2027, 15.04.2027) — end + 1 day —
    // NOT dani30E(01.03.2027, 01.04.2027) = 30, which is what "one month from
    // the start" would wrongly give regardless of how long the period actually
    // runs.
    // dani30E(01.03, 15.04) = 30×0 + 30×1 + (min(15,30) − min(1,30)) = 30 + 14
    //   = 44 — NOT 30. Handover on 01.03 (the very start): n_A = 0, all of the
    //   total goes to the second occupier.
    const result = proRataDays({
      total: 900,
      periodStart: { year: 2027, month: 3, day: 1 },
      periodEnd: { year: 2027, month: 4, day: 14 },
      handover: { year: 2027, month: 3, day: 1 },
      basis: "e30360",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDays).toBe(44);
    expect(result.daysFirst).toBe(0);
    expect(result.amountFirst).toBe(0);
    expect(result.amountSecond).toBeCloseTo(900, 6);
  });

  it("gives the whole amount to the first occupier when handover falls the day after the period ends", () => {
    const result = proRataDays({
      total: 600,
      periodStart: { year: 2028, month: 2, day: 1 },
      periodEnd: { year: 2028, month: 2, day: 29 },
      handover: { year: 2028, month: 3, day: 1 }, // periodEnd + 1 day, 2028 is leap
      basis: "act",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.daysSecond).toBe(0);
    expect(result.amountFirst).toBeCloseTo(600, 6);
    expect(result.amountSecond).toBe(0);
  });

  it("splits a leap-February period correctly, the leap day covered by day counting alone — 01.02.2028 to 29.02.2028", () => {
    // N = 29 (2028 is leap). n_A = 14 (01.02 to 15.02). n_B = 15.
    // iznos_A = 600 × 14/29 = 8400/29 = 289,655172 -> 289,66.
    // iznos_B = 600 − 289,66 = 310,34.
    const result = proRataDays({
      total: 600,
      periodStart: { year: 2028, month: 2, day: 1 },
      periodEnd: { year: 2028, month: 2, day: 29 },
      handover: { year: 2028, month: 2, day: 15 },
      basis: "act",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDays).toBe(29);
    expect(result.amountFirst).toBeCloseTo(289.66, 2);
    expect(result.amountSecond).toBeCloseTo(310.34, 2);
  });

  it("refuses a negative total, an end before the start, and a handover outside the period — one case per reason", () => {
    const start = { year: 2027, month: 3, day: 1 };
    const end = { year: 2027, month: 3, day: 31 };
    expect(
      proRataDays({ total: -1, periodStart: start, periodEnd: end, handover: start }),
    ).toEqual({ ok: false, reason: "total" });
    expect(
      proRataDays({
        total: 100,
        periodStart: end,
        periodEnd: start,
        handover: start,
      }),
    ).toEqual({ ok: false, reason: "periodEnd" });
    expect(
      proRataDays({
        total: 100,
        periodStart: start,
        periodEnd: end,
        handover: { year: 2027, month: 4, day: 2 },
      }),
    ).toEqual({ ok: false, reason: "handover" });
    expect(
      proRataDays({
        total: 100,
        periodStart: start,
        periodEnd: end,
        handover: { year: 2027, month: 2, day: 28 },
      }),
    ).toEqual({ ok: false, reason: "handover" });
  });
});

describe("rentEscalation", () => {
  it("sums term by term at a fixed 3% escalation over 5 periods — never the closed form, only checked by it", () => {
    // R_1 = 1000,00. R_2 = 1000 × 1,03 = 1030,00. R_3 = 1030 × 1,03 = 1060,90.
    // R_4 = 1060,90 × 1,03 = 1092,727 -> stored unrounded, prints 1092,73.
    // R_5 = 1092,727 × 1,03 = 1125,50881 -> prints 1125,51.
    // Total = 1000 + 1030 + 1060,90 + 1092,727 + 1125,50881 = 5309,13581.
    // Closed-form check: 1,03^5 = 1,159274074, (1,159274074−1)/0,03 =
    //   5,309135810, × 1000 = 5.309,135810 — a check value, distinct from the
    //   term-by-term total in its last digit, exactly as the correction warns.
    // Average = 5309,13581/5 = 1061,827162.
    const result = rentEscalation({ baseRent: 1000, periods: 5, index: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rents[0]).toBeCloseTo(1000, 6);
    expect(result.rents[1]).toBeCloseTo(1030, 6);
    expect(result.rents[2]).toBeCloseTo(1060.9, 6);
    expect(result.rents[3]).toBeCloseTo(1092.727, 3);
    expect(result.rents[4]).toBeCloseTo(1125.50881, 3);
    expect(result.total).toBeCloseTo(5309.13581, 3);
    expect(result.average).toBeCloseTo(1061.827162, 3);
    expect(result.closedFormTotal).toBeCloseTo(5309.13581, 2);
  });

  it("applies a per-period index list, whose first entry is ignored because period 1 is never indexed", () => {
    // R_1 = 800,00 (unindexed). R_2 = 800 × (1+0%) = 800,00.
    // R_3 = 800 × 1,045 = 836,00. R_4 = 836 × 1,02 = 852,72.
    // Total = 800 + 800 + 836 + 852,72 = 3288,72. Average = 822,18.
    const result = rentEscalation({
      baseRent: 800,
      periods: 4,
      index: [999, 0, 4.5, 2], // index[0] must be ignored — an implausible value proves it
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rents).toEqual([800, 800, 836, 852.72]);
    expect(result.total).toBeCloseTo(3288.72, 6);
    expect(result.average).toBeCloseTo(822.18, 6);
    // A list has no single fixed growth rate, so no closed-form check applies.
    expect(result.closedFormTotal).toBeUndefined();
  });

  it("takes the term-by-term branch at a zero index, where the closed form would divide by zero, and gives the present value", () => {
    // R_t = 500,00 for all three periods (0% growth). Total = 1.500,00.
    // SV = 500 + 500/1,05 + 500/1,1025 = 500 + 476,190476 + 453,514739 =
    //   1.429,705215.
    const result = rentEscalation({ baseRent: 500, periods: 3, index: 0, discountRate: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBeCloseTo(1500, 6);
    expect(result.closedFormTotal).toBeUndefined(); // p = 0 would divide by zero
    expect(result.presentValue).toBeCloseTo(1429.705215, 4);
  });

  it("lets the rent fall under a negative (deflationary) index", () => {
    const result = rentEscalation({ baseRent: 1000, periods: 3, index: -10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rents[1]).toBeCloseTo(900, 6);
    expect(result.rents[2]).toBeCloseTo(810, 6);
  });

  it("refuses a non-positive base rent, an out-of-range period count, an index list shorter than the term, and a discount rate at −100% — one case per reason", () => {
    expect(rentEscalation({ baseRent: 0, periods: 3, index: 3 })).toEqual({
      ok: false,
      reason: "baseRent",
    });
    expect(rentEscalation({ baseRent: 1000, periods: 0, index: 3 })).toEqual({
      ok: false,
      reason: "periods",
    });
    expect(rentEscalation({ baseRent: 1000, periods: 4, index: [0, 1, 2] })).toEqual({
      ok: false,
      reason: "index",
    });
    expect(
      rentEscalation({ baseRent: 1000, periods: 3, index: 3, discountRate: -100 }),
    ).toEqual({ ok: false, reason: "discountRate" });
  });
});

describe("rentGrossNet", () => {
  it("computes from the gross, multiplying the RATE by the base, never by the gross — 500,00 at 25% costs and 20% rate", () => {
    // osnovica = 500 × (1 − 0,25) = 375,00. iznos po stopi = 375 × 0,20 =
    // 75,00. neto = 500 − 75 = 425,00. e = 0,75 × 0,20 = 0,15 -> 15,0000%.
    const result = rentGrossNet({ gross: 500, costPercent: 25, taxRate: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base).toBeCloseTo(375, 6);
    expect(result.taxAmount).toBeCloseTo(75, 6);
    expect(result.net).toBeCloseTo(425, 6);
    expect(result.gross).toBe(500);
    expect(result.effectiveShare).toBeCloseTo(15, 6);
    expect(result.computedFrom).toBe("gross");
    expect(result.netRoundingResidual).toBeCloseTo(0, 6);
  });

  it("inverts the previous vector exactly from the net — 425,00 at the same costs and rate", () => {
    // e = 0,15; bruto = 425 / (1 − 0,15) = 425/0,85 = 500,00 — the exact
    // inversion of the forward direction above.
    const result = rentGrossNet({ net: 425, costPercent: 25, taxRate: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross).toBeCloseTo(500, 6);
    expect(result.base).toBeCloseTo(375, 6);
    expect(result.taxAmount).toBeCloseTo(75, 6);
    expect(result.computedFrom).toBe("net");
  });

  it("builds the displayed net from the ROUNDED gross and ROUNDED tax, keeping the exact figure and the residual separate — net 1.000,00 at 20% costs, 15% rate", () => {
    // e = 0,8 × 0,15 = 0,12. bruto = 1000/0,88 = 1.136,363636 -> 1.136,36.
    // osnovica = 1136,363636 × 0,8 = 909,090909 -> shown 909,09 (informative).
    // iznos = 909,090909 × 0,15 = 136,363636 -> 136,36.
    // Displayed check: 1.136,36 − 136,36 = 1.000,00 exactly, by construction.
    const result = rentGrossNet({ net: 1000, costPercent: 20, taxRate: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross).toBeCloseTo(1136.363636, 4);
    expect(result.taxAmount).toBeCloseTo(136.363636, 4);
    expect(result.net).toBeCloseTo(1000, 2);
    // exactNet = gross − taxAmount, unrounded, algebraically gross×(1 − e) —
    // which is exactly the typed net back again (1.136,363636… × 0,88 = 1.000).
    expect(result.exactNet).toBeCloseTo(1000, 6);
    expect(result.netRoundingResidual).toBeCloseTo(0, 2);
    expect(result.effectiveShare).toBeCloseTo(12, 6);
  });

  it("reports the typed-amount ratio alongside the algebraic one when BOTH gross and net are given — never choosing silently between them", () => {
    // impliedEffectiveShare = 1 − 425/500 = 0,15 -> 15,0000%, which happens to
    // equal effectiveShare here because the two figures are an exact pair —
    // the comparison is the reason to fill in both boxes at once.
    const result = rentGrossNet({ gross: 500, net: 425, costPercent: 25, taxRate: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computedFrom).toBe("gross"); // gross wins when both are given
    expect(result.impliedEffectiveShare).toBeCloseTo(15, 6);
    expect(result.effectiveShare).toBeCloseTo(15, 6);
  });

  it("tells the two ratios APART when the typed pair does not match the algebra — gross 1.000, net 800, 10% costs, 25% rate", () => {
    // impliedEffectiveShare = 1 − 800/1000 = 0,20 -> 20,0000%, from the RAW
    // typed pair alone. effectiveShare = (1 − 0,10) × 0,25 = 0,225 -> 22,5000%,
    // from the rate and cost percentage algebraically — a DIFFERENT number,
    // because the typed net of 800 is not what this cost/rate pair would have
    // produced from a gross of 1.000 (that would be 1.000 × (1 − 0,225) =
    // 775,00). A test where the two figures coincide cannot tell which formula
    // a given field actually uses; this one can.
    const result = rentGrossNet({ gross: 1000, net: 800, costPercent: 10, taxRate: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.impliedEffectiveShare).toBeCloseTo(20, 6);
    expect(result.effectiveShare).toBeCloseTo(22.5, 6);
    expect(result.net).toBeCloseTo(775, 6); // built from the typed gross, not the typed net
  });

  it("echoes the typed rate and cost percentage back unchanged, so the printed row is self-checking", () => {
    const result = rentGrossNet({ gross: 500, costPercent: 25, taxRate: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.costPercent).toBe(25);
    expect(result.taxRate).toBe(20);
  });

  it("refuses the reverse direction at 100% effective share — n = 0 with s = 100%, where 1 − e would divide by zero", () => {
    // e = (1 − 0)×1 = 1 -> 1 − e = 0.
    expect(rentGrossNet({ net: 100, costPercent: 0, taxRate: 100 })).toEqual({
      ok: false,
      reason: "taxRate",
    });
  });

  it("refuses a cost percentage at or above 100%, an out-of-range tax rate, a non-positive gross, and neither amount given — one case per reason", () => {
    expect(rentGrossNet({ gross: 100, costPercent: 100, taxRate: 10 })).toEqual({
      ok: false,
      reason: "costPercent",
    });
    expect(rentGrossNet({ gross: 100, costPercent: 10, taxRate: -1 })).toEqual({
      ok: false,
      reason: "taxRate",
    });
    expect(rentGrossNet({ gross: 0, costPercent: 10, taxRate: 10 })).toEqual({
      ok: false,
      reason: "gross",
    });
    expect(rentGrossNet({ costPercent: 10, taxRate: 10 })).toEqual({
      ok: false,
      reason: "gross",
    });
  });
});

describe("rentalYield", () => {
  it("gives every figure at full occupancy — price 120.000, rent 550/month, costs 40/month + 300/year", () => {
    // BPP = 550 × 12 = 6.600,00. EGI = 6.600 × 100% = 6.600,00.
    // NOI = 6.600 − 40×12 − 300 = 6.600 − 480 − 300 = 5.820,00.
    // bruto prinos = 6600/120000 × 100 = 5,5000%. neto prinos =
    //   5820/120000 × 100 = 4,8500%. GRM = 120000/6600 = 18,181818 -> 18,18.
    // povraćaj = 120000/5820 = 20,618557 -> 20,62 godina.
    const result = rentalYield({
      price: 120000,
      monthlyRent: 550,
      monthlyCosts: 40,
      annualCosts: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grossPotentialIncome).toBeCloseTo(6600, 6);
    expect(result.effectiveGrossIncome).toBeCloseTo(6600, 6);
    expect(result.netOperatingIncome).toBeCloseTo(5820, 6);
    expect(result.grossYield).toBeCloseTo(5.5, 4);
    expect(result.netYield).toBeCloseTo(4.85, 4);
    expect(result.grossRentMultiplier).toBeCloseTo(18.181818, 4);
    expect(result.paybackYears).toBeCloseTo(20.618557, 4);
  });

  it("does NOT scale costs by occupancy — the same property at 90% occupancy pays the same full costs", () => {
    // EGI = 6.600 × 90% = 5.940,00. NOI = 5.940 − 480 − 300 = 5.160,00 (the
    // costs are unchanged from the full-occupancy case above).
    // neto prinos = 5160/120000 × 100 = 4,3000%. povraćaj = 120000/5160 =
    //   23,255814 -> 23,26 godina. bruto prinos stays 5,5000% — it is computed
    //   from BPP, which never sees occupancy at all.
    const result = rentalYield({
      price: 120000,
      monthlyRent: 550,
      occupancy: 90,
      monthlyCosts: 40,
      annualCosts: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectiveGrossIncome).toBeCloseTo(5940, 6);
    expect(result.netOperatingIncome).toBeCloseTo(5160, 6);
    expect(result.netYield).toBeCloseTo(4.3, 4);
    expect(result.paybackYears).toBeCloseTo(23.255814, 4);
    expect(result.grossYield).toBeCloseTo(5.5, 4);
  });

  it("values a property from its own NOI at a capitalisation rate — the reverse direction, NOI 5.820 at 6,00%", () => {
    // vrednost = 5.820 / 0,06 = 97.000,00 — using the same NOI as the first
    // vector above, now driven through the reverse formula.
    const result = rentalYield({
      price: 120000,
      monthlyRent: 550,
      monthlyCosts: 40,
      annualCosts: 300,
      capRate: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netOperatingIncome).toBeCloseTo(5820, 6);
    expect(result.valueAtCapRate).toBeCloseTo(97000, 2);
  });

  it("withholds payback, GRM and the reverse value when the price is absent, showing only NOI", () => {
    const result = rentalYield({ monthlyRent: 550, monthlyCosts: 40, annualCosts: 300 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netOperatingIncome).toBeCloseTo(5820, 6);
    expect(result.grossYield).toBeUndefined();
    expect(result.netYield).toBeUndefined();
    expect(result.grossRentMultiplier).toBeUndefined();
    expect(result.paybackYears).toBeUndefined();
  });

  it("withholds payback and the reverse value — never a negative number of years — when costs exceed income", () => {
    const result = rentalYield({
      price: 100000,
      monthlyRent: 100,
      monthlyCosts: 200,
      capRate: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netOperatingIncome).toBeLessThan(0);
    expect(result.paybackYears).toBeUndefined();
    expect(result.valueAtCapRate).toBeUndefined();
  });

  it("refuses a non-positive price, a negative rent, an out-of-range occupancy, and a non-positive cap rate — one case per reason", () => {
    expect(rentalYield({ price: 0, monthlyRent: 500 })).toEqual({ ok: false, reason: "price" });
    expect(rentalYield({ monthlyRent: -1 })).toEqual({ ok: false, reason: "monthlyRent" });
    expect(rentalYield({ monthlyRent: 500, occupancy: 150 })).toEqual({
      ok: false,
      reason: "occupancy",
    });
    expect(rentalYield({ monthlyRent: 500, capRate: 0 })).toEqual({
      ok: false,
      reason: "capRate",
    });
  });
});

describe("roomQuadArea", () => {
  it("splits a 4×3 rectangle by its 5 m diagonal into two right triangles — a square corner, 0,00° deviation", () => {
    // Sorted sides for triangle ABC (4, 3, 5): a=5, b=4, c=3.
    // T1 = ¼√((5+7)(3−1)(3+1)(5+1)) = ¼√(12·2·4·6) = ¼√576 = ¼×24 = 6,00 m².
    // Triangle ACD is congruent (4, 3, 5 again): T2 = 6,00 m². P = 12,00 m².
    // γ at B = arccos((16+9−25)/24) = arccos(0) = 90,00°; deviation 0,00°.
    const result = roomQuadArea({ a: 4, b: 3, c: 4, d: 3, e: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.triangleAbc).toBeCloseTo(6, 6);
    expect(result.triangleAcd).toBeCloseTo(6, 6);
    expect(result.area).toBeCloseTo(12, 6);
    expect(result.angleB).toBeCloseTo(90, 6);
    expect(result.deviationFrom90).toBeCloseTo(0, 6);
    // The diagonal also fixes angle D, between sides c and d, congruent here:
    // arccos((16+9−25)/24) = 90,00° too.
    expect(result.angleD).toBeCloseTo(90, 6);
    expect(result.deviationFrom90AtD).toBeCloseTo(0, 6);
  });

  it("measures an out-of-square room — sides 5,4,5,4 with a 6 m diagonal, using the numerically stable ordered Heron form", () => {
    // Sorted (5, 4, 6): a=6, b=5, c=4.
    // T1 = ¼√((6+9)(4−1)(4+1)(6+1)) = ¼√(15·3·5·7) = ¼√1575 = ¼×39,686270 =
    //   9,921567 -> 9,92 m². T2 is the same triangle (5,4,6 again) -> 9,92 m².
    // P = 19,843135 -> 19,84 m².
    // γ at B = arccos((25+16−36)/40) = arccos(0,125) = 82,819244° -> 82,82°;
    //   deviation = −7,18°.
    const result = roomQuadArea({ a: 5, b: 4, c: 5, d: 4, e: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.triangleAbc).toBeCloseTo(9.921567, 5);
    expect(result.triangleAcd).toBeCloseTo(9.921567, 5);
    expect(result.area).toBeCloseTo(19.843135, 5);
    expect(result.angleB).toBeCloseTo(82.819244, 4);
    expect(result.deviationFrom90).toBeCloseTo(-7.180756, 3);
  });

  it("computes angle D from c and d, NOT from a and b — a=5,b=4,c=6,d=3,e=7, where the two triangles differ", () => {
    // Every earlier vector here has c=a and d=b, so triangleAbc, triangleAcd,
    // angleB and angleD are pairwise identical and cannot tell a correct
    // ISPRAVKA (2) implementation from one that never reads c/d for angle D at
    // all. This one cannot be faked that way.
    // Triangle ABC (4,5,7): Heron s=8; T1 = √(8×3×4×1) = √96 = 9,797959.
    // Triangle ACD (3,6,7): Heron s=8; T2 = √(8×2×5×1) = √80 = 8,944272.
    // area = 9,797959 + 8,944272 = 18,742231.
    // angleB = arccos((25+16−49)/40) = arccos(−0,2) = 101,536961°.
    // angleD = arccos((36+9−49)/36) = arccos(−1/9). arcsin(1/9) by series
    //   (x + x³/6 + 3x⁵/40 + …) = 0,111341014 rad = 6,379375°, so
    //   arccos(1/9) = 90 − 6,379375 = 83,620625°, and arccos(−1/9) =
    //   180 − 83,620625 = 96,379375° — from c and d, NOT a repeat of angleB.
    const result = roomQuadArea({ a: 5, b: 4, c: 6, d: 3, e: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.triangleAbc).toBeCloseTo(9.797959, 5);
    expect(result.triangleAcd).toBeCloseTo(8.944272, 5);
    expect(result.area).toBeCloseTo(18.742231, 4);
    expect(result.angleB).toBeCloseTo(101.536961, 3);
    expect(result.angleD).toBeCloseTo(96.379375, 3);
    expect(result.deviationFrom90AtD).toBeCloseTo(6.379375, 3);
  });

  it("names WHICH pair of measurements cannot be true, rather than a generic refusal — a 6 m diagonal against a 2+3 m pair", () => {
    // 6 is not less than a + b = 5: the triangle inequality fails on the AB
    // side of the split, and the tool says exactly that rather than just
    // refusing.
    expect(roomQuadArea({ a: 2, b: 3, c: 4, d: 3, e: 6 })).toEqual({
      ok: false,
      reason: "diagonalTooLongAB",
    });
  });

  it("refuses a non-positive side and a diagonal shorter than the difference of a pair of sides — one case per reason, alongside the triangle-inequality ones above", () => {
    expect(roomQuadArea({ a: 0, b: 3, c: 4, d: 3, e: 5 })).toEqual({ ok: false, reason: "a" });
    // e must exceed |a − b| = |10 − 1| = 9; e = 5 fails that on the AB pair.
    expect(roomQuadArea({ a: 10, b: 1, c: 4, d: 3, e: 5 })).toEqual({
      ok: false,
      reason: "diagonalTooShortAB",
    });
  });
});

describe("wallCeilingArea", () => {
  it("nets the openings from a 5×4×2,6 room, including the ceiling, and states the rounding gap — a door and two windows", () => {
    // obim = 2×(5+4) = 18,00 m. zidovi_bruto = 18×2,6 = 46,80 m².
    // otvori = 0,90×2,05×1 + 1,40×1,20×2 = 1,845 + 3,36 = 5,205 -> 5,21 m².
    // zidovi_neto = 46,8 − 5,205 = 41,594999999999999… in a double -> 41,60 m²
    //   (the whole reason this pack's rounding rule exists).
    // plafon = 5×4 = 20,00 m². ukupno = 41,595 + 20 = 61,595 -> 61,60 m².
    // materijal = 61,595 × 2 / 10 = 12,319 -> 12,32 l.
    // Rounding gap: round(46,80) − round(5,205→5,21) − round(41,595→41,60)
    //   = 46,80 − 5,21 − 41,60 = −0,01 — the displayed subtraction is off by a
    //   cent, disclosed as a number rather than hidden.
    const result = wallCeilingArea({
      length: 5,
      width: 4,
      height: 2.6,
      openings: [
        { width: 0.9, height: 2.05, count: 1 },
        { width: 1.4, height: 1.2, count: 2 },
      ],
      includeCeiling: true,
      coverage: 10,
      coats: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perimeter).toBeCloseTo(18, 6);
    expect(result.wallsGross).toBeCloseTo(46.8, 6);
    expect(result.openingsArea).toBeCloseTo(5.205, 6);
    expect(result.wallsNet).toBeCloseTo(41.595, 6);
    expect(result.wallsNetRoundingGap).toBeCloseTo(-0.01, 6);
    expect(result.ceiling).toBeCloseTo(20, 6);
    expect(result.ceilingIncluded).toBe(true);
    expect(result.total).toBeCloseTo(61.595, 6);
    expect(result.material).toBeCloseTo(12.319, 6);
    expect(result.packageCount).toBeUndefined(); // no packageSize was given
  });

  it("gives no material row at all when no coverage was typed — not a zero row", () => {
    // obim = 2×6,20 = 12,40. zidovi_bruto = 12,40×2,50 = 31,00. plafon = 9,60,
    // shown but not included.
    const result = wallCeilingArea({
      length: 3.2,
      width: 3,
      height: 2.5,
      openings: [],
      includeCeiling: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wallsGross).toBeCloseTo(31, 6);
    expect(result.openingsArea).toBe(0);
    expect(result.wallsNet).toBeCloseTo(31, 6);
    expect(result.ceiling).toBeCloseTo(9.6, 6);
    expect(result.ceilingIncluded).toBe(false);
    expect(result.total).toBeCloseTo(31, 6);
    expect(result.material).toBeUndefined();
  });

  it("sums the jamb area of every opening — Σ 2×(width+height)×depth×count (ISPRAVKA 5)", () => {
    // Opening 1: 2×(1+2)×0,2×1 = 1,20 m². Opening 2: 2×(0,6+1)×0,2×2 = 1,28 m².
    // revealArea = 1,20 + 1,28 = 2,48 m².
    const result = wallCeilingArea({
      length: 4,
      width: 3,
      height: 2.5,
      openings: [
        { width: 1, height: 2, count: 1 },
        { width: 0.6, height: 1, count: 2 },
      ],
      revealDepth: 0.2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revealArea).toBeCloseTo(2.48, 6);
  });

  it("gives no reveal area at all when no reveal depth was typed — not a zero row", () => {
    const result = wallCeilingArea({ length: 4, width: 3, height: 2.5, openings: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revealArea).toBeUndefined();
  });

  it("replaces the computed perimeter for a non-rectangular room, while length and width still fix the ceiling (ISPRAVKA 6)", () => {
    // A room that is not a rectangle (an L-shape) has a true wall run
    // (22,00 m) that 2×(length+width) = 18,00 m cannot give; the override
    // replaces the perimeter everywhere below. zidovi_bruto = 22×2,6 = 57,20
    // m². The ceiling stays length × width = 5×4 = 20,00 m², unaffected.
    const result = wallCeilingArea({
      length: 5,
      width: 4,
      height: 2.6,
      openings: [],
      perimeterOverride: 22,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perimeter).toBe(22);
    expect(result.wallsGross).toBeCloseTo(57.2, 6);
    expect(result.wallsNet).toBeCloseTo(57.2, 6);
    expect(result.ceiling).toBeCloseTo(20, 6);
  });

  it("counts whole packages from the coverage — ceil(material / packageSize)", () => {
    // material = 12,319 l at a 5 l packaging -> ceil(12,319/5) = 3 cans.
    const result = wallCeilingArea({
      length: 5,
      width: 4,
      height: 2.6,
      openings: [
        { width: 0.9, height: 2.05, count: 1 },
        { width: 1.4, height: 1.2, count: 2 },
      ],
      includeCeiling: true,
      coverage: 10,
      coats: 2,
      packageSize: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packageCount).toBe(3);
  });

  it("refuses when the openings AGGREGATE to the whole wall, even though each one individually fits — four 4×2,5 m openings in a 4×3×2,5 room", () => {
    // zidovi_bruto = 2×(4+3)×2,5 = 35,00 m². Each opening is 4 m wide (equal
    // to, not over, the longer wall) and 2,5 m tall (equal to, not over, the
    // room height), so no PER-OPENING check fires — but four of them total
    // 4×2,5×4 = 40,00 m² ≥ 35,00 m², more area than the walls have to give.
    expect(
      wallCeilingArea({
        length: 4,
        width: 3,
        height: 2.5,
        openings: [{ width: 4, height: 2.5, count: 4 }],
      }),
    ).toEqual({ ok: false, reason: "openings" });
  });

  it("checks each opening against ITS OWN room, not only the running total — a 3 m door in a 2,6 m room", () => {
    // A single tall door can pass an aggregate-area check easily while being
    // physically impossible; it must be caught opening-by-opening.
    expect(
      wallCeilingArea({
        length: 5,
        width: 4,
        height: 2.6,
        openings: [{ width: 0.9, height: 3, count: 1 }],
      }),
    ).toEqual({ ok: false, reason: "openingHeight" });
  });

  it("refuses a non-positive room dimension and an out-of-range coat count — one case per reason, alongside the opening ones above", () => {
    expect(wallCeilingArea({ length: 0, width: 4, height: 2.6, openings: [] })).toEqual({
      ok: false,
      reason: "length",
    });
    expect(
      wallCeilingArea({ length: 5, width: 4, height: 2.6, openings: [], coats: 11 }),
    ).toEqual({ ok: false, reason: "coats" });
  });
});

describe("weightedArea", () => {
  it("weights a flat's parts by their contracted coefficients — 58,40 m² k=1, 12,00 m² k=0,5, 4,20 m² k=0,5, priced at 2.200", () => {
    // Doprinosi: 58,40, 12×0,5 = 6,00, 4,20×0,5 = 2,10.
    // neto = 58,40 + 12,00 + 4,20 = 74,60 m².
    // obračunska = 58,40 + 6,00 + 2,10 = 66,50 m².
    // cena = 66,50 × 2200 = 146.300,00 (66,5 × 22 = 1463, × 100).
    const result = weightedArea({
      rows: [
        { area: 58.4, coefficient: 1 },
        { area: 12, coefficient: 0.5 },
        { area: 4.2, coefficient: 0.5 },
      ],
      pricePerSquareMetre: 2200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.contribution).toBeCloseTo(58.4, 6);
    expect(result.rows[1]?.contribution).toBeCloseTo(6, 6);
    expect(result.rows[2]?.contribution).toBeCloseTo(2.1, 6);
    expect(result.netArea).toBeCloseTo(74.6, 6);
    expect(result.weightedArea).toBeCloseTo(66.5, 6);
    expect(result.totalPrice).toBeCloseTo(146300, 6);
    // Price per NET m² (74,60) differs from the contracted price per m² of
    // WEIGHTED area (2.200) whenever any coefficient is not 1 — exactly the
    // reason this tool exists: 146.300/74,60 = 1.961,66… ≠ 2.200.
    expect(result.pricePerNetSquareMetre).toBeCloseTo(146300 / 74.6, 2);
  });

  it("takes a side pair instead of an area, computing the area itself — a 4,35 × 3,20 m room plus a loggia", () => {
    // a_1 = 4,35 × 3,20 = 13,92 m² exactly. Doprinosi 13,92 + 5×0,75 = 13,92 +
    // 3,75. neto = 18,92 m². obračunska = 17,67 m².
    const result = weightedArea({
      rows: [
        { length: 4.35, width: 3.2, coefficient: 1 },
        { area: 5, coefficient: 0.75 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.area).toBeCloseTo(13.92, 6);
    expect(result.netArea).toBeCloseTo(18.92, 6);
    expect(result.weightedArea).toBeCloseTo(17.67, 6);
    expect(result.totalPrice).toBeUndefined(); // no price was typed
  });

  it("allows a zero coefficient without refusing the row — it counts toward net area, contributes nothing to the chargeable one", () => {
    // neto = 100,00 m²; obračunska = 0,00 m²; a basement store treated exactly
    // like this is not a mistake and is not silently dropped from the listing.
    const result = weightedArea({ rows: [{ area: 100, coefficient: 0 }], pricePerSquareMetre: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netArea).toBe(100);
    expect(result.weightedArea).toBe(0);
    expect(result.totalPrice).toBe(0);
  });

  it("refuses an empty row list, an out-of-range coefficient, a non-positive area, and a missing side when no area is given — one case per reason", () => {
    expect(weightedArea({ rows: [] })).toEqual({ ok: false, reason: "rows" });
    expect(weightedArea({ rows: [{ area: 10, coefficient: 6 }] })).toEqual({
      ok: false,
      reason: "coefficient",
    });
    expect(weightedArea({ rows: [{ area: 0, coefficient: 1 }] })).toEqual({
      ok: false,
      reason: "area",
    });
    expect(weightedArea({ rows: [{ width: 3, coefficient: 1 }] })).toEqual({
      ok: false,
      reason: "length",
    });
  });
});

/**
 * `occupancy` defaults to 100 %, and the surface restated that 100 beside the
 * echo. See `ShelfSpacingResult.rasterUsed`: a default is a fact about the
 * calculation, so the calculation reports it — the more so here, where the
 * number IS the difference between the two income figures printed above it.
 */
describe("rentalYield returns the occupancy it applied", () => {
  const base = { price: 120000, monthlyRent: 550, monthlyCosts: 40, annualCosts: 300 } as const;

  it("reports 100 when none was given, and the effective income equals the potential", () => {
    const result = rentalYield(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.occupancyUsed).toBe(100);
    // 550*12 = 6600, and at full occupancy the two incomes are the same number.
    expect(result.grossPotentialIncome).toBeCloseTo(6600, 6);
    expect(result.effectiveGrossIncome).toBeCloseTo(6600, 6);
  });

  it("reports the occupancy given, and it is the one in the arithmetic", () => {
    const result = rentalYield({ ...base, occupancy: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.occupancyUsed).toBe(90);
    expect(result.effectiveGrossIncome).toBeCloseTo(5940, 6);
    // Costs are NOT scaled by occupancy — 40*12 + 300 = 780 at either figure.
    expect(result.netOperatingIncome).toBeCloseTo(5160, 6);
  });
});
