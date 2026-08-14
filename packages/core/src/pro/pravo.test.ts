import { describe, expect, it } from "vitest";

import {
  amountInWords,
  annuitySchedule,
  cadastralArea,
  coOwnershipShares,
  contractPenalty,
  deadlineBackward,
  deadlineForward,
  domesticAccount,
  ibanRecord,
  interestAccrual,
  jmbgRecord,
  mod97CheckDigits,
  proportionalCosts,
  rateConversion,
  sentenceTerm,
  sharePart,
  splitAmount,
  sumOfPeriods,
  textPages,
  workingDays,
} from "./pravo.js";

/**
 * Every expectation here was worked by hand from the inputs before the code
 * existed, and the arithmetic is written into the comments so a reader can check
 * it without running anything. A test whose expected value was copied out of a
 * first run pins the bug as firmly as the behaviour.
 *
 * Weekdays are ISO numbers throughout: 1 = Monday … 7 = Sunday.
 */

describe("annuitySchedule", () => {
  it("divides a 12 % nominal rate proportionally and closes the plan on zero", () => {
    const plan = annuitySchedule({
      principal: 1200000,
      annualRatePercent: 12,
      instalments: 24,
      paymentsPerYear: 12,
      conversion: "proportional",
      dueTiming: "end",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // i = 0.12/12 = 0.01. 1.01^12 = 1.126825030, squared = 1.269734649, so
    // 1.01^(−24) = 0.787566127 and the denominator is 0.212433873.
    // A = 12000/0.212433873 = 56488.1667 → 56488.17.
    expect(plan.periodicRate).toBeCloseTo(0.01, 12);
    expect(plan.instalment).toBeCloseTo(56488.17, 2);
    const first = plan.rows[0];
    expect(first?.interest).toBeCloseTo(12000, 2); // 1200000 × 0.01
    expect(first?.principalPart).toBeCloseTo(44488.17, 2); // 56488.17 − 12000.00
    expect(first?.balance).toBeCloseTo(1155511.83, 2); // 1200000 − 44488.17
    expect(plan.rows).toHaveLength(24);
    // The last row repays whatever is left, so the balance lands on 0.00 exactly.
    expect(plan.rows[23]?.balance).toBe(0);
    expect(plan.amortisationNotice).toBeUndefined();
  });

  it("treats a zero rate as its own case — the general formula divides by zero there", () => {
    const plan = annuitySchedule({
      principal: 500000,
      annualRatePercent: 0,
      instalments: 10,
      paymentsPerYear: 12,
      conversion: "proportional",
      dueTiming: "end",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 1 − (1+0)^(−10) = 1 − 1 = 0; the answer is G/n = 500000/10 = 50000.00.
    expect(plan.instalment).toBe(50000);
    expect(plan.rows[0]?.interest).toBe(0);
    expect(plan.rows[0]?.principalPart).toBe(50000);
    expect(plan.rows[9]?.balance).toBe(0);
    expect(plan.totalPaid).toBe(500000);
    expect(plan.totalInterest).toBe(0);
  });

  it("gives a different instalment under the conformal conversion — 343.16 on the same input", () => {
    const conformal = annuitySchedule({
      principal: 1200000,
      annualRatePercent: 12,
      instalments: 24,
      paymentsPerYear: 12,
      conversion: "conformal",
      dueTiming: "end",
    });
    expect(conformal.ok).toBe(true);
    if (!conformal.ok) return;
    // i = 1.12^(1/12) − 1 = 0.0094887929, and (1+i)^24 = 1.12² = 1.2544 exactly,
    // so (1+i)^(−24) = 1/1.2544 = 0.797193878 and the denominator is 0.202806122.
    // A = 11386.5515/0.202806122 = 56145.0088 → 56145.01.
    expect(conformal.periodicRate).toBeCloseTo(0.0094887929, 10);
    expect(conformal.instalment).toBeCloseTo(56145.01, 2);
    expect(conformal.rows[0]?.interest).toBeCloseTo(11386.55, 2);
    expect(conformal.rows[0]?.principalPart).toBeCloseTo(44758.46, 2);
    expect(conformal.rows[0]?.balance).toBeCloseTo(1155241.54, 2);
    // 56488.17 − 56145.01 = 343.16 — the only reason the conversion is an input.
    expect(56488.17 - conformal.instalment).toBeCloseTo(343.16, 2);
  });

  it("collects the whole rounding drift into the last instalment", () => {
    const plan = annuitySchedule({
      principal: 1000,
      annualRatePercent: 12,
      instalments: 3,
      paymentsPerYear: 12,
      conversion: "proportional",
      dueTiming: "end",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 1.01³ = 1.030301, 1/1.030301 = 0.970590148, denominator 0.029409852,
    // A = 10/0.029409852 = 340.0221 → 340.02.
    expect(plan.instalment).toBeCloseTo(340.02, 2);
    expect(plan.rows[0]?.interest).toBeCloseTo(10, 2); // 1000 × 0.01
    expect(plan.rows[0]?.principalPart).toBeCloseTo(330.02, 2);
    expect(plan.rows[0]?.balance).toBeCloseTo(669.98, 2);
    expect(plan.rows[1]?.interest).toBeCloseTo(6.7, 2); // round2(6.6998)
    expect(plan.rows[1]?.principalPart).toBeCloseTo(333.32, 2);
    expect(plan.rows[1]?.balance).toBeCloseTo(336.66, 2);
    expect(plan.rows[2]?.interest).toBeCloseTo(3.37, 2); // round2(3.3666)
    expect(plan.rows[2]?.principalPart).toBeCloseTo(336.66, 2); // the whole balance
    expect(plan.rows[2]?.instalment).toBeCloseTo(340.03, 2); // 336.66 + 3.37
    expect(plan.rows[2]?.balance).toBe(0);
    // 340.02 + 340.02 + 340.03 = 1020.07, of which 20.07 is interest.
    expect(plan.totalPaid).toBeCloseTo(1020.07, 2);
    expect(plan.totalInterest).toBeCloseTo(20.07, 2);
    // The last row's OWN cents (34003) minus the level instalment's (34002) is
    // exactly 0.01 — computed in integer cents, never by subtracting two
    // already-divided doubles, which lands on 0.009999999999990905 instead.
    expect(plan.lastInstalmentAdjustment).toBe(0.01);
  });

  it("reports the exact excess instead of a false claim that the plan never repays", () => {
    // i = 10 per period over 1200 periods: (1+i)^(−n) = 11^(−1200) underflows
    // to exactly 0 in double precision, so A = 1000·10/(1−0) = 10000 exactly —
    // and balance·i = 1000·10 = 10000 too, the SAME double. The annuity
    // identity still guarantees A > balance·i, but the true excess is far
    // below what a double can represent here, so round2(A) cannot clear
    // round2(balance·i): that is a display collision, not proof the debt is
    // unrepayable.
    const plan = annuitySchedule({
      principal: 1000,
      annualRatePercent: 1000,
      instalments: 1200,
      paymentsPerYear: 1,
      conversion: "proportional",
      dueTiming: "end",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.amortisationNotice).toEqual({ row: 1, exactInstalment: 10000, shortfall: 0 });
    // The row shows no visible progress — its principal part is clamped to
    // zero rather than negative — but the plan still closes on exactly zero,
    // because the last row is forced to repay whatever balance is left.
    expect(plan.rows[0]?.principalPart).toBe(0);
    expect(plan.rows[0]?.balance).toBe(1000);
    expect(plan.rows).toHaveLength(1200);
    expect(plan.rows[1199]?.balance).toBe(0);
  });

  it("prices an annuity due — no interest on the first instalment, dated by the period", () => {
    const plan = annuitySchedule({
      principal: 1000,
      annualRatePercent: 12,
      instalments: 3,
      paymentsPerYear: 12,
      conversion: "proportional",
      dueTiming: "start",
      firstInstalmentDate: { year: 2026, month: 1, day: 15 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The ordinary (end-of-period) instalment for this principal/rate/term is
    // 340.022111 (established two cases above); an annuity due divides that by
    // one more factor of (1+i): 340.022111/1.01 = 336.655556 → 336.66.
    expect(plan.dueTiming).toBe("start");
    expect(plan.instalment).toBeCloseTo(336.66, 2);
    // Due immediately, before any period has elapsed — no interest accrued yet.
    expect(plan.rows[0]?.interest).toBe(0);
    expect(plan.rows[0]?.principalPart).toBe(336.66);
    expect(plan.rows[0]?.balance).toBe(663.34);
    expect(plan.rows[0]?.date).toEqual({ year: 2026, month: 1, day: 15 });
    // 663.34 × 0.01 = 6.6334 → 6.63.
    expect(plan.rows[1]?.interest).toBeCloseTo(6.63, 2);
    expect(plan.rows[1]?.date).toEqual({ year: 2026, month: 2, day: 15 });
    expect(plan.rows[2]?.date).toEqual({ year: 2026, month: 3, day: 15 });
    expect(plan.rows[2]?.balance).toBe(0);
  });

  it("refuses rather than repairs", () => {
    const base = {
      principal: 1000,
      annualRatePercent: 12,
      instalments: 12,
      paymentsPerYear: 12,
      conversion: "proportional",
      dueTiming: "end",
    } as const;
    expect(annuitySchedule({ ...base, principal: 0 })).toEqual({ ok: false, reason: "principal" });
    expect(annuitySchedule({ ...base, annualRatePercent: -100 })).toEqual({
      ok: false,
      reason: "annualRatePercent",
    });
    expect(annuitySchedule({ ...base, instalments: 0 })).toEqual({
      ok: false,
      reason: "instalments",
    });
    expect(annuitySchedule({ ...base, instalments: 12.5 })).toEqual({
      ok: false,
      reason: "instalments",
    });
    expect(annuitySchedule({ ...base, paymentsPerYear: 3 as 1 })).toEqual({
      ok: false,
      reason: "paymentsPerYear",
    });
  });
});

describe("amountInWords", () => {
  const dinar = { currency: "dinar", style: "spaced", capitalise: false } as const;

  it("writes the thousands group of exactly one as „hiljadu\"", () => {
    const result = amountInWords({ ...dinar, amountText: "1234.56" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // C = 1234: t = 34, o = 4 → class 2 → „dinara". S = 56: o = 6 → class 3.
    expect(result.words).toBe("hiljadu dvesta trideset četiri dinara i pedeset šest para");
    expect(result.wholeUnits).toBe(1234n);
    expect(result.subUnits).toBe(56);
    expect(result.rounded).toBe(false);
    // 56 para of the 100 a dinar has, unreduced — the way a cheque is written.
    expect(result.subUnitFraction).toEqual({ numerator: 56, denominator: 100 });
  });

  it("puts both nouns in the singular only at class 1, and in their own gender", () => {
    const result = amountInWords({ ...dinar, amountText: "21.01" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 21: o = 1 and t = 21 ≠ 11 → class 1. „jedan" is masculine for dinar,
    // „jedna" feminine for para.
    expect(result.words).toBe("dvadeset jedan dinar i jedna para");
  });

  it("takes the gender from the noun, not from the number", () => {
    const result = amountInWords({ ...dinar, amountText: "22.22" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The same 22 twice: „dva" with the masculine dinar, „dve" with the feminine
    // para; 22 is class 2 in both, hence „dinara" and „pare".
    expect(result.words).toBe("dvadeset dva dinara i dvadeset dve pare");
  });

  it("applies the „hiljadu\" exception only to a group of exactly one", () => {
    const result = amountInWords({ ...dinar, amountText: "21000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The thousands group is 21, not 1 → class 1 form „hiljada" with the
    // feminine „dvadeset jedna". C = 21000 → t = 0 → class 3 → „dinara".
    expect(result.words).toBe("dvadeset jedna hiljada dinara i nula para");
  });

  it("skips a zero group together with its scale", () => {
    const result = amountInWords({ ...dinar, amountText: "1000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Not „jedan milion nula hiljada jedan". C = 1000001 → t = 1, o = 1 → class 1.
    expect(result.words).toBe("jedan milion jedan dinar i nula para");
  });

  it("writes every scale in its own gender and paucal class", () => {
    const million = amountInWords({ ...dinar, amountText: "1234567.89" });
    expect(million.ok).toBe(true);
    if (!million.ok) return;
    // Thousands group 234: t = 34, o = 4 → class 2 → „hiljade". C = 1234567:
    // t = 67 → class 3 → „dinara". S = 89 → class 3 → „para".
    expect(million.words).toBe(
      "jedan milion dvesta trideset četiri hiljade petsto šezdeset sedam dinara i " +
        "osamdeset devet para",
    );

    const milijarda = amountInWords({ ...dinar, amountText: "2500000000" });
    expect(milijarda.ok).toBe(true);
    if (!milijarda.ok) return;
    // Milijarda is feminine → „dve milijarde"; the millions group is 500, whose
    // t = 0 puts it in class 3 → „miliona".
    expect(milijarda.words).toBe("dve milijarde petsto miliona dinara i nula para");
  });

  it("puts 11 in class 3 — the whole reason the rule tests t != 11", () => {
    const eleven = amountInWords({ ...dinar, amountText: "111.11" });
    expect(eleven.ok).toBe(true);
    if (!eleven.ok) return;
    expect(eleven.words).toBe("sto jedanaest dinara i jedanaest para");

    const hundredOne = amountInWords({ ...dinar, amountText: "101" });
    expect(hundredOne.ok).toBe(true);
    if (!hundredOne.ok) return;
    expect(hundredOne.words).toBe("sto jedan dinar i nula para"); // 101 → class 1

    const thousandTwo = amountInWords({ ...dinar, amountText: "1002" });
    expect(thousandTwo.ok).toBe(true);
    if (!thousandTwo.ok) return;
    expect(thousandTwo.words).toBe("hiljadu dva dinara i nula para"); // t = 2 → class 2
  });

  it("writes zero on either side of the point", () => {
    const zero = amountInWords({ ...dinar, amountText: "0" });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.words).toBe("nula dinara i nula para");

    const thousand = amountInWords({ ...dinar, amountText: "1000" });
    expect(thousand.ok).toBe(true);
    if (!thousand.ok) return;
    expect(thousand.words).toBe("hiljadu dinara i nula para");

    const million = amountInWords({ ...dinar, amountText: "1000000" });
    expect(million.ok).toBe(true);
    if (!million.ok) return;
    expect(million.words).toBe("jedan milion dinara i nula para");
  });

  it("rounds a third decimal, carries it, and says that it did", () => {
    const result = amountInWords({ ...dinar, amountText: "1.999" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1.999 → 2.00: the carry crosses the point, so C = 2 and S = 0.
    expect(result.wholeUnits).toBe(2n);
    expect(result.subUnits).toBe(0);
    expect(result.convertedAmount).toBe("2.00");
    expect(result.rounded).toBe(true);
    expect(result.words).toBe("dva dinara i nula para");
  });

  it("joins without spaces and capitalises only the first letter", () => {
    const joined = amountInWords({ ...dinar, amountText: "101", style: "joined" });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.words).toBe("stojedandinarinulapara");

    const capitalised = amountInWords({ ...dinar, amountText: "101", capitalise: true });
    expect(capitalised.ok).toBe(true);
    if (!capitalised.ok) return;
    expect(capitalised.words).toBe("Sto jedan dinar i nula para");
  });

  it("takes user noun forms for any other currency", () => {
    const result = amountInWords({
      amountText: "2.05",
      currency: "custom",
      mainUnit: { one: "evro", few: "evra", many: "evra", gender: "m" },
      subUnit: { one: "cent", few: "centa", many: "centi", gender: "m" },
      subUnitsPerUnit: 100,
      style: "spaced",
      capitalise: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 → class 2 → „evra"; 5 → class 3 → „centi".
    expect(result.words).toBe("dva evra i pet centi");
    expect(result.subUnitFraction).toEqual({ numerator: 5, denominator: 100 });
  });

  it("refuses a negative amount, one at or above 10^15, and missing custom forms", () => {
    expect(amountInWords({ ...dinar, amountText: "-1" })).toEqual({
      ok: false,
      reason: "amountText",
    });
    // 1e15 as a typed string is sixteen digits — one past the fifteen the
    // regex accepts, which is what "at or above 10^15" means for a string.
    expect(amountInWords({ ...dinar, amountText: "1000000000000000" })).toEqual({
      ok: false,
      reason: "amountText",
    });
    expect(
      amountInWords({ amountText: "1", currency: "custom", style: "spaced", capitalise: false }),
    ).toEqual({ ok: false, reason: "mainUnit" });
    expect(
      amountInWords({
        amountText: "1",
        currency: "custom",
        mainUnit: { one: "evro", few: "evra", many: "evra", gender: "m" },
        subUnitsPerUnit: 100,
        style: "spaced",
        capitalise: false,
      }),
    ).toEqual({ ok: false, reason: "subUnit" });
  });
});

describe("jmbgRecord", () => {
  it("computes the check digit from the published weights", () => {
    const record = jmbgRecord({ digits: "1503985800451", mode: "check" });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    // 7·1 + 6·5 + 5·0 + 4·3 + 3·9 + 2·8 + 7·5 + 6·8 + 5·0 + 4·0 + 3·4 + 2·5
    // = 7+30+0+12+27+16+35+48+0+0+12+10 = 197; 197 − 187 = 10; m = 1; K = 1.
    expect(record.weightedSum).toBe(197);
    expect(record.remainder).toBe(10);
    expect(record.m).toBe(1);
    expect(record.checkDigit).toBe(1);
    expect(record.matches).toBe(true);
    // 985 ≥ 800 → 1985. 15 March 1985 was a Friday.
    expect(record.centuryOffset).toBe(1000);
    expect(record.date).toEqual({ year: 1985, month: 3, day: 15 });
    expect(record.dateExists).toBe(true);
    expect(record.weekday).toBe(5);
    expect(record.region).toBe(80);
    expect(record.sequence).toBe(45);
    expect(record.sexRange).toBe("male");
  });

  it("maps m = 11 to a check digit of 0", () => {
    const record = jmbgRecord({ digits: "0101000715000", mode: "check" });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    // 0 + 6 + 0 + 4 + 0 + 0 + 0 + 42 + 5 + 20 + 0 + 0 = 77; 77 mod 11 = 0; m = 11.
    expect(record.weightedSum).toBe(77);
    expect(record.m).toBe(11);
    expect(record.checkDigit).toBe(0);
    expect(record.matches).toBe(true);
    // 000 < 800 → 2000. 1 January 2000 was a Saturday.
    expect(record.centuryOffset).toBe(2000);
    expect(record.date).toEqual({ year: 2000, month: 1, day: 1 });
    expect(record.weekday).toBe(6);
    expect(record.sequence).toBe(500);
    expect(record.sexRange).toBe("female");
  });

  it("maps m = 10 to 0 as well, and returns the raw m so the branch is visible", () => {
    const record = jmbgRecord({ digits: "0711974793150", mode: "check" });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    // 0 + 42 + 5 + 4 + 27 + 14 + 28 + 42 + 45 + 12 + 3 + 10 = 232;
    // 232 − 231 = 1; m = 10; K = 0.
    expect(record.weightedSum).toBe(232);
    expect(record.m).toBe(10);
    expect(record.checkDigit).toBe(0);
    expect(record.matches).toBe(true);
    // 7 November 1974 was a Thursday.
    expect(record.date).toEqual({ year: 1974, month: 11, day: 7 });
    expect(record.weekday).toBe(4);
  });

  it("checks the date independently of the check digit", () => {
    const leap = jmbgRecord({ digits: "2902004721234", mode: "check" });
    expect(leap.ok).toBe(true);
    if (!leap.ok) return;
    // 14+54+0+8+0+0+28+42+10+4+6+6 = 172; 172 − 165 = 7; m = 4.
    expect(leap.weightedSum).toBe(172);
    expect(leap.checkDigit).toBe(4);
    expect(leap.matches).toBe(true);
    // 2004 is a leap year, so 29 February exists; it was a Sunday.
    expect(leap.dateExists).toBe(true);
    expect(leap.weekday).toBe(7);

    const notLeap = jmbgRecord({ digits: "2902003721230", mode: "check" });
    expect(notLeap.ok).toBe(true);
    if (!notLeap.ok) return;
    // 14+54+0+8+0+0+21+42+10+4+6+6 = 165; 165 mod 11 = 0; m = 11; K = 0.
    expect(notLeap.weightedSum).toBe(165);
    expect(notLeap.checkDigit).toBe(0);
    // The checksum agrees AND the date does not exist. Both are reported.
    expect(notLeap.matches).toBe(true);
    expect(notLeap.dateExists).toBe(false);
    expect(notLeap.weekday).toBeUndefined();
  });

  it("computes the thirteenth digit from twelve, and strips separators first", () => {
    const record = jmbgRecord({ digits: "1503 9858-0045", mode: "compute" });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    expect(record.weightedSum).toBe(197);
    expect(record.checkDigit).toBe(1);
    expect(record.digits).toBe("1503985800451");
    expect(record.matches).toBeUndefined();
  });

  it("notices a check digit that does not agree", () => {
    const record = jmbgRecord({ digits: "1503985800452", mode: "check" });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    expect(record.matches).toBe(false);
  });

  it("refuses anything that is not the right count of digits", () => {
    expect(jmbgRecord({ digits: "15039858004", mode: "check" })).toEqual({
      ok: false,
      reason: "digits",
    });
    expect(jmbgRecord({ digits: "15039858004X1", mode: "check" })).toEqual({
      ok: false,
      reason: "digits",
    });
    expect(jmbgRecord({ digits: "1503985800451", mode: "compute" })).toEqual({
      ok: false,
      reason: "digits",
    });
  });
});

describe("cadastralArea", () => {
  it("splits square metres into hectares, ares and a remainder", () => {
    const area = cadastralArea({ direction: "toParts", squareMetres: 21530 });
    expect(area.ok).toBe(true);
    if (!area.ok) return;
    // T = 215300000 ten-thousandths; 215300000/10^8 = 2 ha, remainder 15300000;
    // 15300000/10^6 = 15 a, remainder 300000 → 30 m².
    expect(area.hectares).toBe(2);
    expect(area.ares).toBe(15);
    expect(area.remainderSquareMetres).toBe(30);
    expect(area.totalSquareMetres).toBe(21530);
    expect(area.wasNormalised).toBe(false);
  });

  it("keeps the decimal alive through the split", () => {
    const area = cadastralArea({ direction: "toParts", squareMetres: 4823.75 });
    expect(area.ok).toBe(true);
    if (!area.ok) return;
    // T = 48237500; 48237500/10^6 = 48 a, remainder 237500 → 23.75 m². A floor
    // over a binary double would have produced 23.7499.
    expect(area.hectares).toBe(0);
    expect(area.ares).toBe(48);
    expect(area.remainderSquareMetres).toBe(23.75);
  });

  it("composes a record back into square metres", () => {
    const area = cadastralArea({
      direction: "toSquareMetres",
      hectares: 1,
      ares: 0,
      remainderSquareMetres: 0,
    });
    expect(area.ok).toBe(true);
    if (!area.ok) return;
    expect(area.totalSquareMetres).toBe(10000);
  });

  it("normalises a record with more than 99 ares instead of refusing it", () => {
    const area = cadastralArea({
      direction: "toSquareMetres",
      hectares: 0,
      ares: 120,
      remainderSquareMetres: 0,
    });
    expect(area.ok).toBe(true);
    if (!area.ok) return;
    // 120 a = 1.2·10^8 ten-thousandths = 12000 m² = 1 ha 20 a 0 m².
    expect(area.totalSquareMetres).toBe(12000);
    expect(area.hectares).toBe(1);
    expect(area.ares).toBe(20);
    expect(area.wasNormalised).toBe(true);
  });

  it("holds the boundary just below one are, and crosses it at 100 m²", () => {
    const under = cadastralArea({ direction: "toParts", squareMetres: 99.9999 });
    expect(under.ok).toBe(true);
    if (!under.ok) return;
    expect(under.ares).toBe(0);
    expect(under.remainderSquareMetres).toBe(99.9999);

    const over = cadastralArea({ direction: "toParts", squareMetres: 100 });
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    expect(over.ares).toBe(1);
    expect(over.remainderSquareMetres).toBe(0);
  });

  it("rounds a fifth decimal and says that it did", () => {
    const area = cadastralArea({ direction: "toParts", squareMetres: 10.00005 });
    expect(area.ok).toBe(true);
    if (!area.ok) return;
    expect(area.rounded).toBe(true);
    expect(area.remainderSquareMetres).toBe(10.0001); // half-up on the magnitude
  });

  it("refuses a negative area and a missing part", () => {
    expect(cadastralArea({ direction: "toParts", squareMetres: -1 })).toEqual({
      ok: false,
      reason: "squareMetres",
    });
    expect(cadastralArea({ direction: "toParts" })).toEqual({
      ok: false,
      reason: "squareMetres",
    });
    expect(
      cadastralArea({ direction: "toSquareMetres", ares: 1, remainderSquareMetres: 0 }),
    ).toEqual({ ok: false, reason: "hectares" });
    expect(
      cadastralArea({ direction: "toSquareMetres", hectares: 1, remainderSquareMetres: 0 }),
    ).toEqual({ ok: false, reason: "ares" });
    expect(cadastralArea({ direction: "toSquareMetres", hectares: 1, ares: 0 })).toEqual({
      ok: false,
      reason: "remainderSquareMetres",
    });
  });
});

describe("sentenceTerm", () => {
  const start = { year: 2026, month: 1, day: 15 } as const;

  it("counts a term of years and months and deducts the credited days", () => {
    const term = sentenceTerm({
      startDate: start,
      years: 2,
      months: 6,
      days: 0,
      creditedDays: 45,
      creditRatio: 1,
      countFirstDay: true,
    });
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    // +30 months from 2026-01-15 is 2028-07-15; inclusive counting makes the
    // last day 2028-07-14. 365 + 365 = 730 to 2028-01-15, then
    // 16 + 29 + 31 + 30 + 31 + 30 + 14 = 181 (February 2028 has 29 days) = 911,
    // +1 for the first day = 912.
    expect(term.endDate).toEqual({ year: 2028, month: 7, day: 15 });
    expect(term.lastDay).toEqual({ year: 2028, month: 7, day: 14 });
    expect(term.totalDays).toBe(912);
    expect(term.creditedDaysApplied).toBe(45);
    // 14 July − 13 = 1 July, − 30 = 1 June, − 2 = 30 May: 13 + 30 + 2 = 45.
    expect(term.dateAfterCredit).toEqual({ year: 2028, month: 5, day: 30 });
    expect(term.dateAfterCreditWeekday).toBe(2); // Tuesday
    expect(term.coversWholeTerm).toBe(false);
  });

  it("rounds the fraction up in whole days and keeps the identity that checks it", () => {
    const term = sentenceTerm({
      startDate: start,
      years: 2,
      months: 6,
      days: 0,
      creditedDays: 45,
      creditRatio: 1,
      countFirstDay: true,
      fraction: { numerator: 2, denominator: 3 },
    });
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    // ceil(912·2/3) = 608; 2026-01-15 + 608 − 1 − 45 = 2026-01-15 + 562.
    expect(term.fractionDays).toBe(608);
    expect(term.fractionDate).toEqual({ year: 2027, month: 7, day: 31 });
    // The deducted days cancel on both sides: 912 − 608 = 304.
    expect(term.remainingDays).toBe(304);
    expect(term.remainingDays).toBe(term.totalDays - (term.fractionDays ?? 0));
  });

  it("rounds a half day up, because part of a day is not served", () => {
    const term = sentenceTerm({
      startDate: start,
      years: 0,
      months: 6,
      days: 0,
      creditedDays: 0,
      creditRatio: 1,
      countFirstDay: true,
      fraction: { numerator: 1, denominator: 2 },
    });
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    // 17 + 28 + 31 + 30 + 31 + 30 + 14 = 181 days to 2026-07-14 (a Tuesday).
    expect(term.lastDay).toEqual({ year: 2026, month: 7, day: 14 });
    expect(term.lastDayWeekday).toBe(2);
    expect(term.totalDays).toBe(181);
    // ceil(90.5) = 91, and 2026-01-15 + 90 = 2026-04-15.
    expect(term.fractionDays).toBe(91);
    expect(term.fractionDate).toEqual({ year: 2026, month: 4, day: 15 });
    expect(term.remainingDays).toBe(90);
  });

  it("shows both counting conventions on a one-day term", () => {
    const inclusive = sentenceTerm({
      startDate: start,
      years: 0,
      months: 0,
      days: 1,
      creditedDays: 0,
      creditRatio: 1,
      countFirstDay: true,
    });
    const exclusive = sentenceTerm({
      startDate: start,
      years: 0,
      months: 0,
      days: 1,
      creditedDays: 0,
      creditRatio: 1,
      countFirstDay: false,
    });
    expect(inclusive.ok && exclusive.ok).toBe(true);
    if (!inclusive.ok || !exclusive.ok) return;
    expect(inclusive.lastDay).toEqual({ year: 2026, month: 1, day: 15 });
    expect(exclusive.lastDay).toEqual({ year: 2026, month: 1, day: 16 });
    // One day either way — the convention moves the DATE, not the count.
    expect(inclusive.totalDays).toBe(1);
    expect(exclusive.totalDays).toBe(1);
  });

  it("says the credited days cover the term instead of returning a date before the start", () => {
    const term = sentenceTerm({
      startDate: start,
      years: 0,
      months: 1,
      days: 0,
      creditedDays: 40,
      creditRatio: 1,
      countFirstDay: true,
    });
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    // 2026-01-15 … 2026-02-14 is 31 days, and 40 ≥ 31.
    expect(term.totalDays).toBe(31);
    expect(term.creditedDaysApplied).toBe(40);
    expect(term.coversWholeTerm).toBe(true);
    expect(term.dateAfterCredit).toBeUndefined();
  });

  it("floors a fractional credit ratio and shows the exact product beside it", () => {
    const term = sentenceTerm({
      startDate: start,
      years: 1,
      months: 0,
      days: 0,
      creditedDays: 45,
      creditRatio: 1.5,
      countFirstDay: true,
    });
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    // 45 × 1.5 = 67.5 exactly; part of a day is not deducted, so 67 days are.
    expect(term.exactCredit).toBeCloseTo(67.5, 9);
    expect(term.creditedDaysApplied).toBe(67);
  });

  it("refuses a fraction above one, a non-positive ratio and an impossible date", () => {
    const base = {
      startDate: start,
      years: 1,
      months: 0,
      days: 0,
      creditedDays: 0,
      creditRatio: 1,
      countFirstDay: true,
    } as const;
    expect(sentenceTerm({ ...base, fraction: { numerator: 4, denominator: 3 } })).toEqual({
      ok: false,
      reason: "fraction",
    });
    expect(sentenceTerm({ ...base, fraction: { numerator: 1, denominator: 0 } })).toEqual({
      ok: false,
      reason: "fraction",
    });
    expect(sentenceTerm({ ...base, creditRatio: 0 })).toEqual({ ok: false, reason: "creditRatio" });
    expect(
      sentenceTerm({ ...base, startDate: { year: 2026, month: 2, day: 30 } }),
    ).toEqual({ ok: false, reason: "startDate" });
    expect(sentenceTerm({ ...base, years: 101 })).toEqual({ ok: false, reason: "years" });
  });
});

describe("rateConversion", () => {
  it("compounds a nominal rate into an effective one", () => {
    const result = rateConversion({
      direction: "nominalToEffective",
      ratePercent: 12,
      compoundingsPerYear: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1.01² = 1.0201; 1.01⁴ = 1.04060401; 1.01⁸ = 1.082856706;
    // 1.01¹² = 1.082856706 × 1.04060401 = 1.1268250301.
    expect(result.resultPercent).toBeCloseTo(12.682503, 6);
    expect(result.periodicPercent).toBeCloseTo(1, 9);
    // Converting FROM a nominal rate divides — p/m — never takes a root.
    expect(result.periodicKind).toBe("proportional");
    expect(result.growthFactor).toBeCloseTo(1.1268250301, 10);
  });

  it("inverts itself — the effective rate gives the nominal one back", () => {
    const result = rateConversion({
      direction: "effectiveToNominal",
      ratePercent: 12.68250301,
      compoundingsPerYear: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 12 × (1.1268250301^(1/12) − 1) = 12 × 0.01.
    expect(result.resultPercent).toBeCloseTo(12, 6);
    expect(result.periodicPercent).toBeCloseTo(1, 6);
    // Converting FROM an effective rate takes the conformal m-th root.
    expect(result.periodicKind).toBe("conformal");
    // Holding the EFFECTIVE rate fixed, the m → ∞ bound is ln(1 + e), not
    // e^p − 1: ln(1.1268250301) = 12 × ln(1.01) = 0.11940397 → 11.940397 %.
    expect(result.continuousPercent).toBeCloseTo(11.940397, 6);
  });

  it("gives an exact answer where the arithmetic is exact", () => {
    const result = rateConversion({
      direction: "nominalToEffective",
      ratePercent: 6,
      compoundingsPerYear: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1.03 × 1.03 = 1.0609, so the effective rate is 6.09 % with nothing rounded.
    expect(result.resultPercent).toBeCloseTo(6.09, 9);
    expect(result.periodicPercent).toBeCloseTo(3, 9);
  });

  it("takes the conformal root for the periodic rate of an effective one", () => {
    const result = rateConversion({
      direction: "effectiveToPeriodic",
      ratePercent: 12,
      compoundingsPerYear: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1.12^(1/12) − 1 = 0.0094887929, and (1.0094887929)^12 = 1.12 exactly.
    expect(result.resultPercent).toBeCloseTo(0.948879, 6);
    expect(result.growthFactor).toBeCloseTo(1.12, 12);
    expect(result.periodicKind).toBe("conformal");
  });

  it("converts a nominal rate at m1 to the nominal rate at m2, via the effective rate", () => {
    const result = rateConversion({
      direction: "nominalAtM1ToNominalAtM2",
      ratePercent: 12,
      compoundingsPerYear: 12,
      targetCompoundingsPerYear: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // m1 = 12 gives the same effective rate as the first case above,
    // 12.682503 %. Converting THAT to m2 = 4 takes the conformal 4th root:
    // 1.1268250301^(1/4) = sqrt(sqrt(1.1268250301)) ≈ 1.03030100, so the
    // quarterly periodic rate is 3.0301 % and the nominal at m2 is
    // 4 × 3.0301 % = 12.1204 %.
    expect(result.periodicPercent).toBeCloseTo(3.0301, 4);
    expect(result.periodicKind).toBe("conformal");
    expect(result.resultPercent).toBeCloseTo(12.1204, 4);
    expect(result.effectivePercent).toBeCloseTo(12.682503, 6);
  });

  it("refuses a missing or out-of-range targetCompoundingsPerYear", () => {
    expect(
      rateConversion({
        direction: "nominalAtM1ToNominalAtM2",
        ratePercent: 12,
        compoundingsPerYear: 12,
      }),
    ).toEqual({ ok: false, reason: "targetCompoundingsPerYear" });
    expect(
      rateConversion({
        direction: "nominalAtM1ToNominalAtM2",
        ratePercent: 12,
        compoundingsPerYear: 12,
        targetCompoundingsPerYear: 0,
      }),
    ).toEqual({ ok: false, reason: "targetCompoundingsPerYear" });
  });

  it("passes m = 1 through without a special case", () => {
    const result = rateConversion({
      direction: "nominalToEffective",
      ratePercent: 12,
      compoundingsPerYear: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resultPercent).toBeCloseTo(12, 9);
    // e^0.12 − 1 = 0.127496852 — the bound no finite m reaches.
    expect(result.continuousPercent).toBeCloseTo(12.749685, 6);
  });

  it("refuses a rate below −99 % and a compounding count outside 1…366", () => {
    expect(
      rateConversion({
        direction: "nominalToEffective",
        ratePercent: -100,
        compoundingsPerYear: 12,
      }),
    ).toEqual({ ok: false, reason: "ratePercent" });
    expect(
      rateConversion({
        direction: "nominalToEffective",
        ratePercent: 12,
        compoundingsPerYear: 0,
      }),
    ).toEqual({ ok: false, reason: "compoundingsPerYear" });
    expect(
      rateConversion({
        direction: "nominalToEffective",
        ratePercent: 12,
        compoundingsPerYear: 12.5,
      }),
    ).toEqual({ ok: false, reason: "compoundingsPerYear" });
  });
});

describe("interestAccrual", () => {
  const from = { year: 2026, month: 1, day: 1 } as const;

  it("separates the conformal and the proportional method over 90 days", () => {
    const base = {
      principal: 100000,
      rates: [{ from, annualRatePercent: 12 }],
      from,
      to: { year: 2026, month: 4, day: 1 },
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    } as const;

    const conformal = interestAccrual({ ...base, method: "conformal" });
    expect(conformal.ok).toBe(true);
    if (!conformal.ok) return;
    // 31 + 28 + 31 = 90 days (2026 is not a leap year).
    expect(conformal.totalDays).toBe(90);
    // ln 1.12 = 0.113328685; × 90/365 = 0.027944059; e^… = 1.028338156.
    expect(conformal.totalInterest).toBeCloseTo(2833.82, 2);

    const proportional = interestAccrual({ ...base, method: "proportional" });
    expect(proportional.ok).toBe(true);
    if (!proportional.ok) return;
    // 100000 × 0.12 × 90/365 = 1080000/365 = 2958.904110.
    expect(proportional.totalInterest).toBeCloseTo(2958.9, 2);
  });

  it("makes both methods agree when the segment is exactly one basis year", () => {
    const shared = {
      principal: 250000,
      rates: [{ from, annualRatePercent: 9.5 }],
      from,
      to: { year: 2027, month: 1, day: 1 },
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    } as const;
    const conformal = interestAccrual({ ...shared, method: "conformal" });
    const proportional = interestAccrual({ ...shared, method: "proportional" });
    expect(conformal.ok && proportional.ok).toBe(true);
    if (!conformal.ok || !proportional.ok) return;
    // d = B = 365, so (1+p)^(d/B) − 1 = p and both are 250000 × 0.095.
    expect(conformal.totalDays).toBe(365);
    expect(conformal.totalInterest).toBe(23750);
    expect(proportional.totalInterest).toBe(23750);
  });

  it("cuts the axis at a rate change and applies each rate to its own segment", () => {
    const result = interestAccrual({
      principal: 100000,
      rates: [
        { from, annualRatePercent: 10 },
        { from: { year: 2026, month: 4, day: 11 }, annualRatePercent: 14 },
      ],
      from,
      to: { year: 2026, month: 6, day: 15 },
      method: "conformal",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 31 + 28 + 31 + 10 = 100 days, then 19 + 31 + 15 = 65; 100 + 65 = 165
    // = 31 + 28 + 31 + 30 + 31 + 14.
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.days).toBe(100);
    expect(result.segments[1]?.days).toBe(65);
    expect(result.segments[0]?.interest).toBeCloseTo(2645.629313, 4);
    expect(result.segments[1]?.interest).toBeCloseTo(2360.816309, 4);
    expect(result.totalDays).toBe(165);
    expect(result.totalInterest).toBeCloseTo(5006.45, 2);
  });

  it("cuts at 1 January when the basis is the actual year length", () => {
    const shared = {
      principal: 100000,
      rates: [{ from: { year: 2024, month: 11, day: 1 }, annualRatePercent: 10 }],
      from: { year: 2024, month: 11, day: 1 },
      to: { year: 2025, month: 2, day: 1 },
      dayBasis: "actual",
      capitalisation: "none",
      includeLastDay: false,
    } as const;

    const conformal = interestAccrual({ ...shared, method: "conformal" });
    expect(conformal.ok).toBe(true);
    if (!conformal.ok) return;
    // 30 + 31 = 61 days in 2024, which is a leap year → basis 366, and
    // 61/366 = 1/6 exactly; then 31 days in 2025 → basis 365.
    expect(conformal.segments).toHaveLength(2);
    expect(conformal.segments[0]?.days).toBe(61);
    expect(conformal.segments[0]?.basisDays).toBe(366);
    expect(conformal.segments[1]?.days).toBe(31);
    expect(conformal.segments[1]?.basisDays).toBe(365);
    expect(conformal.segments[0]?.interest).toBeCloseTo(1601.186777, 4);
    expect(conformal.segments[1]?.interest).toBeCloseTo(812.768897, 4);
    expect(conformal.totalInterest).toBeCloseTo(2413.96, 2);

    const proportional = interestAccrual({ ...shared, method: "proportional" });
    expect(proportional.ok).toBe(true);
    if (!proportional.ok) return;
    // 100000 × 0.1 × 61/366 = 1666.666667 and × 31/365 = 849.315068.
    expect(proportional.segments[0]?.interest).toBeCloseTo(1666.666667, 6);
    expect(proportional.segments[1]?.interest).toBeCloseTo(849.315068, 6);
    expect(proportional.totalInterest).toBeCloseTo(2515.98, 2);
  });

  it("needs no special case at a zero rate, and none at a zero-length period", () => {
    const zeroRate = interestAccrual({
      principal: 100000,
      rates: [{ from, annualRatePercent: 0 }],
      from,
      to: { year: 2026, month: 6, day: 1 },
      method: "conformal",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    });
    expect(zeroRate.ok).toBe(true);
    if (!zeroRate.ok) return;
    expect(zeroRate.totalInterest).toBe(0);

    const zeroDays = interestAccrual({
      principal: 100000,
      rates: [{ from, annualRatePercent: 12 }],
      from,
      to: from,
      method: "proportional",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    });
    expect(zeroDays.ok).toBe(true);
    if (!zeroDays.ok) return;
    expect(zeroDays.totalDays).toBe(0);
    expect(zeroDays.segments).toHaveLength(0);
    expect(zeroDays.totalInterest).toBe(0);
  });

  it("adds the last day by moving the end, so one day is one day", () => {
    const result = interestAccrual({
      principal: 100000,
      rates: [{ from, annualRatePercent: 12 }],
      from,
      to: from,
      method: "proportional",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100000 × 0.12 × 1/365 = 32.876712.
    expect(result.totalDays).toBe(1);
    expect(result.totalInterest).toBeCloseTo(32.88, 2);
  });

  it("capitalises yearly on the calendar boundary", () => {
    const result = interestAccrual({
      principal: 100000,
      rates: [{ from: { year: 2026, month: 1, day: 1 }, annualRatePercent: 10 }],
      from,
      to: { year: 2028, month: 1, day: 1 },
      method: "proportional",
      dayBasis: 365,
      capitalisation: "annual",
      capitalisationBoundary: "calendarYear",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2026 and 2027 are both 365 days; the first year earns 10000 on 100000 and
    // the second earns 11000 on 110000.
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.balance).toBe(100000);
    expect(result.segments[1]?.balance).toBeCloseTo(110000, 6);
    expect(result.totalInterest).toBeCloseTo(21000, 2);
  });

  it("refuses a gap before the first rate rather than assuming one", () => {
    expect(
      interestAccrual({
        principal: 100000,
        rates: [{ from: { year: 2026, month: 2, day: 1 }, annualRatePercent: 12 }],
        from,
        to: { year: 2026, month: 6, day: 1 },
        method: "conformal",
        dayBasis: 365,
        capitalisation: "none",
        includeLastDay: false,
      }),
    ).toEqual({ ok: false, reason: "rates" });
  });

  it("counts the rows that start after the end instead of dropping them silently", () => {
    const result = interestAccrual({
      principal: 100000,
      rates: [
        { from, annualRatePercent: 10 },
        { from: { year: 2030, month: 1, day: 1 }, annualRatePercent: 14 },
      ],
      from,
      to: { year: 2026, month: 2, day: 1 },
      method: "proportional",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ignoredRows).toBe(1);
    expect(result.segments).toHaveLength(1);
  });

  it("counts a row exactly on the exclusive end as ignored, not silently dropped", () => {
    // With includeLastDay = false, `end` equals `finish` (2026-04-01), so a
    // row dated exactly there is neither < end (never cut in) nor > finish
    // (the old ignoredRows test) — it used to satisfy neither bucket.
    const result = interestAccrual({
      principal: 100000,
      rates: [
        { from, annualRatePercent: 12 },
        { from: { year: 2026, month: 4, day: 1 }, annualRatePercent: 50 },
      ],
      from,
      to: { year: 2026, month: 4, day: 1 },
      method: "proportional",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.days).toBe(90);
    expect(result.segments[0]?.annualRatePercent).toBe(12);
    expect(result.ignoredRows).toBe(1);

    // With includeLastDay = true the same row falls INSIDE the range and is
    // applied to its own one-day segment instead — the count moves, not the
    // day the tool used it for.
    const included = interestAccrual({
      principal: 100000,
      rates: [
        { from, annualRatePercent: 12 },
        { from: { year: 2026, month: 4, day: 1 }, annualRatePercent: 50 },
      ],
      from,
      to: { year: 2026, month: 4, day: 1 },
      method: "proportional",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: true,
    });
    expect(included.ok).toBe(true);
    if (!included.ok) return;
    expect(included.segments).toHaveLength(2);
    expect(included.segments[0]?.days).toBe(90);
    expect(included.segments[1]?.days).toBe(1);
    expect(included.segments[1]?.annualRatePercent).toBe(50);
    expect(included.ignoredRows).toBe(0);
  });

  it("does NOT cut a fixed-basis, non-capitalising segment at 1 January", () => {
    // Two compounding segments over an UNCHANGED balance yield less interest
    // than one segment over the combined days — so an unconditional cut here
    // would be wrong, not merely a different but equally valid choice.
    const result = interestAccrual({
      principal: 100000,
      rates: [{ from: { year: 2025, month: 12, day: 1 }, annualRatePercent: 10 }],
      from: { year: 2025, month: 12, day: 1 },
      to: { year: 2026, month: 2, day: 1 },
      method: "conformal",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 31 (December) + 31 (January) = 62 days, ONE segment, not cut at 1 Jan.
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.days).toBe(62);
    // 1.1^(31/365) = 1.00812768897 (established below, same rate and basis);
    // 1.1^(62/365) = (1.1^(31/365))² since 62/365 is exactly twice 31/365:
    // 1.00812768897² = 1 + 2×0.00812768897 + 0.00812768897²
    //                = 1 + 0.01625537794 + 0.00006605933 = 1.01632143727.
    // Interest = 100000 × 0.01632143727 = 1632.143727 → 1632.14. The old,
    // unconditionally-cut code gave two SEPARATE 31-day segments instead
    // (1.1^(31/365) applied twice), which is strictly less: 2×812.768897 =
    // 1625.537794 → 1625.54, a 6.60 shortfall the axis cut caused.
    expect(result.segments[0]?.interest).toBeCloseTo(1632.1437, 2);
    expect(result.totalInterest).toBeCloseTo(1632.14, 2);

    // `yearlyBreakdown` still attributes the SAME uncut segment to the two
    // calendar years it crosses, by the cumulative-difference split, not by
    // re-cutting it: A1 over the first 31 days, A2 over the rest.
    expect(result.yearlyBreakdown).toHaveLength(2);
    expect(result.yearlyBreakdown[0]?.year).toBe(2025);
    expect(result.yearlyBreakdown[0]?.days).toBe(31);
    expect(result.yearlyBreakdown[0]?.interest).toBeCloseTo(812.768897, 2);
    expect(result.yearlyBreakdown[1]?.year).toBe(2026);
    expect(result.yearlyBreakdown[1]?.days).toBe(31);
    // 1632.143727 − 812.768897 = 819.374830.
    expect(result.yearlyBreakdown[1]?.interest).toBeCloseTo(819.3748, 2);
    // The two parts still sum to the segment's own (unrounded) total.
    const yearSum = (result.yearlyBreakdown[0]?.interest ?? 0) + (result.yearlyBreakdown[1]?.interest ?? 0);
    expect(yearSum).toBeCloseTo(result.segments[0]?.interest ?? 0, 6);
  });

  it("does not cut at 1 January when capitalisation uses the anniversary of start", () => {
    // capBoundaries here is the ONE anniversary, 2026-12-01 — past `to`, so it
    // never enters the axis at all, and this run is arithmetically identical
    // to capitalisation = "none". A cut at the 1 January that falls inside the
    // period is therefore just as wrong here as in the "none" case above.
    const result = interestAccrual({
      principal: 100000,
      rates: [{ from: { year: 2025, month: 12, day: 1 }, annualRatePercent: 10 }],
      from: { year: 2025, month: 12, day: 1 },
      to: { year: 2026, month: 11, day: 1 },
      method: "conformal",
      dayBasis: 365,
      capitalisation: "annual",
      capitalisationBoundary: "anniversaryOfStart",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 31 (December) + 304 (January…October, none of them leap) = 335 days,
    // ONE segment — not cut at 1 January.
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.days).toBe(335);
    // ln 1.1 = 0.0953101798; × 335/365 = 0.0874764664; e^… = 1.09141658.
    // Interest = 100000 × 0.09141658 = 9141.658 → 9141.66. The old code cut
    // this at 2026-01-01 regardless of the anniversary boundary, giving two
    // separate segments (31 then 304 days) whose product of growth factors is
    // strictly smaller: 1.1^(31/365) = 1.00812769, 1.1^(304/365) = 1.08261747,
    // 100000 × (1.00812769 × 1.08261747 − 1) is the same 9141.66 when carried
    // through as one compounding step — but summing the two segments' own
    // interest INSTEAD (812.77 + 8261.74 = 9074.51) loses 67.15 to the extra
    // compounding boundary the anniversary convention never asked for.
    expect(result.segments[0]?.interest).toBeCloseTo(9141.66, 2);
    expect(result.totalInterest).toBe(9141.66);
  });

  it("books the ROUNDED yearly figure into total, matching what the segment table shows", () => {
    // rate 1 %, one day before the calendar-year boundary, then a 75-day tail:
    // raw booked-year interest = 100000 × 0.01 × 1/365 = 2.739726… → booked
    // 2.74. The tail then earns 1 % on the NEW (post-booking) balance:
    // 100002.74 × 0.01 × 75/365 = 205.485082….
    const result = interestAccrual({
      principal: 100000,
      rates: [{ from: { year: 2026, month: 12, day: 31 }, annualRatePercent: 1 }],
      from: { year: 2026, month: 12, day: 31 },
      to: { year: 2027, month: 3, day: 17 },
      method: "proportional",
      dayBasis: 365,
      capitalisation: "annual",
      capitalisationBoundary: "calendarYear",
      includeLastDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.days).toBe(1);
    expect(result.segments[1]?.days).toBe(75);
    // The tail segment's OWN balance shows the booking used the ROUNDED 2.74,
    // not the raw 2.739726…
    expect(result.segments[1]?.balance).toBe(100002.74);
    // booked (2.74) + tail (205.485082…) = 208.225082… → rounds to 208.23.
    // Summing the two RAW segment interests instead — 2.739726… + 205.485082…
    // = 208.224808… — rounds to 208.22, one cent short: that was the bug.
    expect(result.totalInterest).toBe(208.23);
    expect(result.principalPlusInterest).toBe(100208.23);
  });

  it("refuses an end before the start, a rate under −99 %, and no rows at all", () => {
    const base = {
      principal: 100000,
      rates: [{ from, annualRatePercent: 12 }],
      from,
      to: { year: 2026, month: 6, day: 1 },
      method: "conformal",
      dayBasis: 365,
      capitalisation: "none",
      includeLastDay: false,
    } as const;
    expect(interestAccrual({ ...base, to: { year: 2025, month: 6, day: 1 } })).toEqual({
      ok: false,
      reason: "to",
    });
    expect(
      interestAccrual({ ...base, rates: [{ from, annualRatePercent: -100 }] }),
    ).toEqual({ ok: false, reason: "rate" });
    expect(interestAccrual({ ...base, rates: [] })).toEqual({ ok: false, reason: "rates" });
    expect(interestAccrual({ ...base, principal: 0 })).toEqual({ ok: false, reason: "principal" });
  });
});

describe("splitAmount", () => {
  const equal = (count: number) =>
    Array.from({ length: count }, () => ({ kind: "number", value: 1 }) as const);

  it("breaks a tie on the fractional part by input order", () => {
    const result = splitAmount({
      totalAmount: 100,
      weights: equal(3),
      smallestUnit: 0.01,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // N = 10000, W = 3; floor(10000/3) = 3333 each, sum 9999, remainder 1; all
    // three fractional parts are 1/3, so the first entry takes the unit.
    expect(result.shares.map((share) => share.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(result.remainderUnits).toBe(1);
    expect(result.checksum).toBe(100);
    expect(result.shares[0]?.gotRemainderUnit).toBe(true);
  });

  it("gives the leftover unit to the largest fractional part", () => {
    const result = splitAmount({
      totalAmount: 1000,
      weights: [
        { kind: "number", value: 1 },
        { kind: "number", value: 2 },
        { kind: "number", value: 3 },
      ],
      smallestUnit: 0.01,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // N = 100000, W = 6: 16666 r 4, 33333 r 2, 50000 r 0; sum 99999, R = 1.
    expect(result.shares.map((share) => share.amount)).toEqual([166.67, 333.33, 500]);
    expect(result.checksum).toBe(1000);
  });

  it("spreads two leftover units over the first two of seven equal shares", () => {
    const result = splitAmount({
      totalAmount: 1,
      weights: equal(7),
      smallestUnit: 0.01,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // N = 100, W = 7: floor(100/7) = 14 each, sum 98, R = 2.
    expect(result.shares.map((share) => share.amount)).toEqual([
      0.15, 0.15, 0.14, 0.14, 0.14, 0.14, 0.14,
    ]);
    expect(result.checksum).toBe(1);
  });

  it("moves nothing when the division is exact", () => {
    const result = splitAmount({
      totalAmount: 100,
      weights: [
        { kind: "number", value: 2 },
        { kind: "number", value: 3 },
        { kind: "number", value: 5 },
      ],
      smallestUnit: 0.01,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remainderUnits).toBe(0);
    expect(result.shares.map((share) => share.amount)).toEqual([20, 30, 50]);
    expect(result.shares.every((share) => !share.gotRemainderUnit)).toBe(true);
  });

  it("reduces three notations of weight to one common denominator first", () => {
    const result = splitAmount({
      totalAmount: 100,
      weights: [
        { kind: "fraction", numerator: 1, denominator: 3 },
        { kind: "percent", value: 25 },
        { kind: "number", value: 1 },
      ],
      smallestUnit: 0.01,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1/3, 1/4, 1/1 over lcm 12 → 4 : 3 : 12, W = 19. With N = 10000:
    // 40000/19 = 2105 r 5, 30000/19 = 1578 r 18, 120000/19 = 6315 r 15;
    // sum 9998, R = 2 → the units go to the 18/19 and the 15/19.
    expect(result.shares.map((share) => share.amount)).toEqual([21.05, 15.79, 63.16]);
    expect(result.shares.map((share) => share.gotRemainderUnit)).toEqual([false, true, true]);
    expect(result.checksum).toBe(100);
  });

  it("gives the units to the first entries under the other rule", () => {
    const result = splitAmount({
      totalAmount: 1000,
      weights: [
        { kind: "number", value: 3 },
        { kind: "number", value: 2 },
        { kind: "number", value: 1 },
      ],
      smallestUnit: 0.01,
      remainderRule: "firstFirst",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The same numbers as the 1 : 2 : 3 case, mirrored: 50000, 33333 r 2,
    // 16666 r 4. „Largest remainder" would hand the unit to the third entry;
    // „first first" hands it to the first, and the outputs differ.
    expect(result.shares.map((share) => share.amount)).toEqual([500.01, 333.33, 166.66]);
    expect(result.checksum).toBe(1000);
  });

  it("takes the sign off before dividing, so floor rounds the same way", () => {
    const result = splitAmount({
      totalAmount: -100,
      weights: equal(3),
      smallestUnit: 0.01,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shares.map((share) => share.amount)).toEqual([-33.34, -33.33, -33.33]);
    expect(result.checksum).toBe(-100);
  });

  it("allocates in whole units when the smallest unit is not a hundredth", () => {
    const result = splitAmount({
      totalAmount: 1000,
      weights: equal(3),
      smallestUnit: 1,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // N = 1000 whole units: 333 each, remainder 1 to the first.
    expect(result.shares.map((share) => share.amount)).toEqual([334, 333, 333]);
    expect(result.checksum).toBe(1000);
  });

  it("shows the rounding difference when the smallest unit is coarser than the amount", () => {
    const result = splitAmount({
      totalAmount: 1050,
      weights: [{ kind: "number", value: 1 }],
      smallestUnit: 100,
      remainderRule: "largestRemainder",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // N = round(1050/100) = 11 whole hundreds = 1100 ≠ 1050.
    expect(result.total).toBe(1100);
    expect(result.totalAmountEntered).toBe(1050);
    expect(result.roundingDifference).toBe(50);
  });

  it("refuses weights that are all zero rather than dividing by zero", () => {
    expect(
      splitAmount({
        totalAmount: 100,
        weights: [
          { kind: "number", value: 0 },
          { kind: "number", value: 0 },
        ],
        smallestUnit: 0.01,
        remainderRule: "largestRemainder",
      }),
    ).toEqual({ ok: false, reason: "weights" });
    expect(
      splitAmount({
        totalAmount: 100,
        weights: [{ kind: "fraction", numerator: 1, denominator: 0 }],
        smallestUnit: 0.01,
        remainderRule: "largestRemainder",
      }),
    ).toEqual({ ok: false, reason: "weights" });
    expect(
      splitAmount({
        totalAmount: 100,
        weights: [],
        smallestUnit: 0.01,
        remainderRule: "largestRemainder",
      }),
    ).toEqual({ ok: false, reason: "weights" });
    expect(
      splitAmount({
        totalAmount: Number.NaN,
        weights: equal(2),
        smallestUnit: 0.01,
        remainderRule: "largestRemainder",
      }),
    ).toEqual({ ok: false, reason: "totalAmount" });
    expect(
      splitAmount({
        totalAmount: 100,
        weights: equal(2),
        smallestUnit: 10 as 1,
        remainderRule: "largestRemainder",
      }),
    ).toEqual({ ok: false, reason: "smallestUnit" });
  });
});

describe("domesticAccount", () => {
  it("computes the two-digit control number of a 3 + 13 account", () => {
    const result = domesticAccount({ account: "1600000000000123", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10^15 ≡ 45 and 10^14 ≡ 53 (mod 97), so 1600000000000123
    // ≡ 45 + 6·53 + 3 + 20 + 3 = 389 ≡ 1; appending „00" multiplies by 100 ≡ 3.
    // Control = 98 − 3 = 95.
    expect(result.checkDigits).toBe("95");
    expect(result.digits).toBe("160000000000012395");
    // In `compute`, `remainder` is the PAYLOAD's own figure (3) — the one the
    // control number was built from — not mod 97 of the finished eighteen
    // digits, which is always 1 by construction and would say nothing.
    expect(result.remainder).toBe(3);
    expect(result.grouped).toBe("1600 0000 0000 0123 95");
  });

  it("computes another account's control number, digit by digit", () => {
    const result = domesticAccount({ account: "2651234567890123", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Running r = (r·10 + c) mod 97 over 2651234567890123 gives 84; with „00"
    // appended, 84 × 100 = 8400 ≡ 58, so the control number is 98 − 58 = 40.
    expect(result.checkDigits).toBe("40");
    expect(result.digits).toBe("265123456789012340");
    expect(result.remainder).toBe(58);
  });

  it("checks eighteen digits by the ≡ 1 property, and catches a changed digit", () => {
    const good = domesticAccount({ account: "160-0000000000123-95", mode: "check" });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.remainder).toBe(1);
    expect(good.matches).toBe(true);
    expect(good.bank).toBe("160");
    expect(good.account).toBe("0000000000123");

    const bad = domesticAccount({ account: "160000000000012396", mode: "check" });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    // One more in the last place: 195 + 1 = 196 ≡ 2, not 1.
    expect(bad.remainder).toBe(2);
    expect(bad.matches).toBe(false);
  });

  it("refuses a wrong length or a non-digit", () => {
    expect(domesticAccount({ account: "16000000000001239", mode: "check" })).toEqual({
      ok: false,
      reason: "account",
    });
    expect(domesticAccount({ account: "16000000000001239X", mode: "check" })).toEqual({
      ok: false,
      reason: "account",
    });
  });
});

describe("ibanRecord", () => {
  it("builds RS35 from any account that passed its own check", () => {
    const first = ibanRecord({ bban: "160000000000012395", country: "RS", mode: "compute" });
    const second = ibanRecord({ bban: "265123456789012340", country: "RS", mode: "compute" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // A valid BBAN is ≡ 1 (mod 97); shifting it left six places multiplies by
    // 10^6 ≡ 27, and „272800" ≡ 36, so the remainder is always 27 + 36 = 63 and
    // the check digits are always 98 − 63 = 35.
    expect(first.checkDigits).toBe("35");
    expect(second.checkDigits).toBe("35");
    expect(first.iban).toBe("RS35160000000000012395");
    expect(first.grouped).toBe("RS35 1600 0000 0000 0123 95");
    // In `compute`, `remainder` is mod 97 of BBAN ‖ country ‖ "00" — the
    // figure the check digits were built from (always 63 here, per the
    // comment above), not mod 97 of the finished IBAN, which is always 1.
    expect(first.remainder).toBe(63);
    expect(second.remainder).toBe(63);
  });

  it("validates an IBAN by rearranging it and catches a single changed digit", () => {
    const good = ibanRecord({ iban: "RS35 1600 0000 0000 0123 95", mode: "check" });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.remainder).toBe(1);
    expect(good.matches).toBe(true);
    expect(good.country).toBe("RS");

    const bad = ibanRecord({ iban: "RS35 1600 0000 0000 0123 96", mode: "check" });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    // The 18-digit part is one larger, so ≡ 2: 2·27 + 36 + 35 = 125 ≡ 28.
    expect(bad.remainder).toBe(28);
    expect(bad.matches).toBe(false);
  });

  it("refuses a malformed IBAN and a country code that is not two letters", () => {
    expect(ibanRecord({ iban: "R35160000000000012395", mode: "check" })).toEqual({
      ok: false,
      reason: "iban",
    });
    expect(ibanRecord({ bban: "160000000000012395", country: "R", mode: "compute" })).toEqual({
      ok: false,
      reason: "country",
    });
    expect(ibanRecord({ bban: "", country: "RS", mode: "compute" })).toEqual({
      ok: false,
      reason: "bban",
    });
  });
});

describe("mod97CheckDigits", () => {
  it("computes the two check digits of an arbitrary digit string", () => {
    const result = mod97CheckDigits({ digits: "1234567890", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1234567890 ≡ 2 (mod 97), so with „00" appended it is 2 × 100 ≡ 6, and the
    // check digits are 98 − 6 = 92.
    expect(result.remainder).toBe(6);
    expect(result.checkDigits).toBe("92");
    expect(result.digits).toBe("123456789092");

    const back = mod97CheckDigits({ digits: "123456789092", mode: "check" });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    // 2 × 100 + 92 = 292 ≡ 1.
    expect(back.remainder).toBe(1);
    expect(back.matches).toBe(true);
  });

  it("keeps leading zeros, which are part of the record and not of a number", () => {
    const result = mod97CheckDigits({ digits: "0001", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 000100 mod 97 = 3, so the check digits are 95.
    expect(result.remainder).toBe(3);
    expect(result.digits).toBe("000195");
  });

  it("refuses an empty string and anything that is not a digit", () => {
    expect(mod97CheckDigits({ digits: "", mode: "compute" })).toEqual({
      ok: false,
      reason: "digits",
    });
    expect(mod97CheckDigits({ digits: "12A4", mode: "compute" })).toEqual({
      ok: false,
      reason: "digits",
    });
  });
});

describe("workingDays", () => {
  const weekend = [6, 7] as const;

  it("counts twelve calendar days and the one weekend inside them", () => {
    const result = workingDays({
      from: { year: 2026, month: 8, day: 3 },
      to: { year: 2026, month: 8, day: 14 },
      includeLastDay: true,
      nonWorkingWeekdays: weekend,
      nonWorkingDates: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 14 − 3 + 1 = 12 days; 3 August 2026 is a Monday, so only the 8th and 9th
    // are the weekend inside the range.
    expect(result.calendarDays).toBe(12);
    expect(result.weekdayNonWorkingDays).toBe(2);
    expect(result.workingDays).toBe(10);
    expect(result.fullWeeks).toBe(1);
    expect(result.remainderDays).toBe(5);
    // The identity that makes the output checkable.
    expect(result.workingDays + result.weekdayNonWorkingDays + result.listedNonWorkingDays).toBe(
      result.calendarDays,
    );
  });

  it("counts typed dates only where they had not already fallen on a weekend", () => {
    const result = workingDays({
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 1, day: 31 },
      includeLastDay: true,
      nonWorkingWeekdays: weekend,
      nonWorkingDates: [
        { year: 2026, month: 1, day: 1 },
        { year: 2026, month: 1, day: 2 },
        { year: 2026, month: 1, day: 7 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // January 2026 opens on a Thursday, so its Saturdays and Sundays are
    // 3, 4, 10, 11, 17, 18, 24, 25 and 31 — nine days. 31 − 9 = 22, and the
    // three typed dates (Thu, Fri, Wed) are all working days: 22 − 3 = 19.
    expect(result.calendarDays).toBe(31);
    expect(result.weekdayNonWorkingDays).toBe(9);
    expect(result.listedNonWorkingDays).toBe(3);
    expect(result.workingDays).toBe(19);
    expect(result.fullWeeks).toBe(4);
    expect(result.remainderDays).toBe(3);
  });

  it("counts a date entered twice once, and a Saturday once", () => {
    const result = workingDays({
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 1, day: 31 },
      includeLastDay: true,
      nonWorkingWeekdays: weekend,
      nonWorkingDates: [
        { year: 2026, month: 1, day: 3 },
        { year: 2026, month: 1, day: 3 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 January 2026 is a Saturday: it is already counted by weekday, so it adds
    // nothing, and the duplicate collapses in the set.
    expect(result.listedNonWorkingDays).toBe(0);
    expect(result.listedDatesInRange).toBe(1);
    expect(result.workingDays).toBe(22);
    expect(result.weekdayNonWorkingDays).toBe(9);
  });

  it("separates the two counting conventions on a single day", () => {
    const shared = {
      from: { year: 2026, month: 8, day: 3 },
      to: { year: 2026, month: 8, day: 3 },
      nonWorkingWeekdays: weekend,
      nonWorkingDates: [],
    } as const;
    const exclusive = workingDays({ ...shared, includeLastDay: false });
    const inclusive = workingDays({ ...shared, includeLastDay: true });
    expect(exclusive.ok && inclusive.ok).toBe(true);
    if (!exclusive.ok || !inclusive.ok) return;
    expect(exclusive.calendarDays).toBe(0);
    expect(exclusive.workingDays).toBe(0);
    expect(exclusive.fullWeeks).toBe(0);
    expect(inclusive.calendarDays).toBe(1);
  });

  it("swaps reversed bounds instead of returning a negative count", () => {
    const result = workingDays({
      from: { year: 2026, month: 8, day: 14 },
      to: { year: 2026, month: 8, day: 3 },
      includeLastDay: true,
      nonWorkingWeekdays: weekend,
      nonWorkingDates: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calendarDays).toBe(12); // never −12
    expect(result.reversed).toBe(true);
    // The swap uses the original `from` (14 August) as the range's actual last
    // day — invisible in the day COUNT alone, which is why the date is named.
    expect(result.effectiveLastDate).toEqual({ year: 2026, month: 8, day: 14 });
  });

  it("names the first/last working day and the typed dates that fell outside the range", () => {
    const result = workingDays({
      from: { year: 2026, month: 8, day: 3 },
      to: { year: 2026, month: 8, day: 14 },
      includeLastDay: true,
      nonWorkingWeekdays: weekend,
      nonWorkingDates: [
        { year: 2026, month: 7, day: 31 },
        { year: 2026, month: 8, day: 20 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same range as the first test above: 3 August 2026 opens on a Monday, so
    // both ends of the range are themselves working days.
    expect(result.firstWorkingDay).toEqual({ year: 2026, month: 8, day: 3 });
    expect(result.lastWorkingDay).toEqual({ year: 2026, month: 8, day: 14 });
    expect(result.effectiveLastDate).toEqual({ year: 2026, month: 8, day: 14 });
    // Neither typed date falls inside [3, 14] August, so both are named rather
    // than silently dropped, and neither counts as a listed non-working day.
    expect(result.datesOutOfRange).toEqual([
      { year: 2026, month: 7, day: 31 },
      { year: 2026, month: 8, day: 20 },
    ]);
    expect(result.listedNonWorkingDays).toBe(0);
    expect(result.listedDatesInRange).toBe(0);
  });

  it("refuses an impossible date and a weekday outside 1…7", () => {
    expect(
      workingDays({
        from: { year: 2026, month: 2, day: 29 },
        to: { year: 2026, month: 3, day: 1 },
        includeLastDay: true,
        nonWorkingWeekdays: weekend,
        nonWorkingDates: [],
      }),
    ).toEqual({ ok: false, reason: "from" });
    expect(
      workingDays({
        from: { year: 2026, month: 8, day: 3 },
        to: { year: 2026, month: 8, day: 14 },
        includeLastDay: true,
        nonWorkingWeekdays: [0 as 1],
        nonWorkingDates: [],
      }),
    ).toEqual({ ok: false, reason: "nonWorkingWeekdays" });
    expect(
      workingDays({
        from: { year: 2026, month: 8, day: 3 },
        to: { year: 2026, month: 8, day: 14 },
        includeLastDay: true,
        nonWorkingWeekdays: weekend,
        nonWorkingDates: [{ year: 2026, month: 13, day: 1 }],
      }),
    ).toEqual({ ok: false, reason: "nonWorkingDates" });
  });
});

describe("deadlineForward", () => {
  const weekend = [6, 7] as const;
  const base = {
    startDate: { year: 2026, month: 8, day: 14 },
    length: 8,
    unit: "days",
    countStartDay: false,
    nonWorkingWeekdays: weekend,
    nonWorkingDates: [],
    shift: "forward",
  } as const;

  it("moves a deadline off a Saturday to the Monday", () => {
    const result = deadlineForward(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 14 + 8 = 22 August 2026, which is a Saturday; the 23rd is a Sunday.
    expect(result.rawLastDay).toEqual({ year: 2026, month: 8, day: 22 });
    expect(result.rawWeekday).toBe(6);
    expect(result.lastDay).toEqual({ year: 2026, month: 8, day: 24 });
    expect(result.weekday).toBe(1);
    expect(result.shiftedByDays).toBe(2);
    // Before the shift: 22 − 14 = 8. After it: 24 − 14 = 10. Different
    // questions, and `totalDaysBeforeShift` is the one `totalDays` is not.
    expect(result.totalDaysBeforeShift).toBe(8);
    expect(result.totalDays).toBe(10);
  });

  it("keeps shifting past a date the user typed", () => {
    const result = deadlineForward({
      ...base,
      nonWorkingDates: [{ year: 2026, month: 8, day: 24 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Saturday → Sunday → the typed Monday → Tuesday the 25th.
    expect(result.lastDay).toEqual({ year: 2026, month: 8, day: 25 });
    expect(result.weekday).toBe(2);
    expect(result.shiftedByDays).toBe(3);
  });

  it("leaves the deadline where it fell when no shifting rule was chosen", () => {
    const result = deadlineForward({ ...base, shift: "none" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The same input, a different rule, a different date — which is exactly why
    // the rule is an input and not an assumption.
    expect(result.lastDay).toEqual({ year: 2026, month: 8, day: 22 });
    expect(result.shiftedByDays).toBe(0);
  });

  it("clips the day of the month when the target month is shorter", () => {
    const result = deadlineForward({
      ...base,
      startDate: { year: 2026, month: 1, day: 31 },
      length: 1,
      unit: "months",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // There is no 31 February, so min(31, 28) = 28 — and 2026 is not a leap year
    // because 2026 mod 4 = 2. 28 February 2026 is a Saturday.
    expect(result.rawLastDay).toEqual({ year: 2026, month: 2, day: 28 });
    expect(result.rawWeekday).toBe(6);
    expect(result.lastDay).toEqual({ year: 2026, month: 3, day: 2 });
    expect(result.weekday).toBe(1);
  });

  it("clips a leap day a year later", () => {
    const result = deadlineForward({
      ...base,
      startDate: { year: 2024, month: 2, day: 29 },
      length: 12,
      unit: "months",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min(29, 28) = 28, because 2025 is not a leap year; 28 February 2025 was a
    // Friday, which is a working day, so nothing moves.
    expect(result.lastDay).toEqual({ year: 2025, month: 2, day: 28 });
    expect(result.weekday).toBe(5);
    expect(result.shiftedByDays).toBe(0);
  });

  it("adds six months across a year boundary", () => {
    const result = deadlineForward({ ...base, length: 6, unit: "months" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 14 February 2027 is a Sunday.
    expect(result.rawLastDay).toEqual({ year: 2027, month: 2, day: 14 });
    expect(result.rawWeekday).toBe(7);
    expect(result.lastDay).toEqual({ year: 2027, month: 2, day: 15 });
    expect(result.shiftedByDays).toBe(1);
  });

  it("says a zero-length inclusive term expired before it began, and moves nothing", () => {
    const result = deadlineForward({ ...base, length: 0, countStartDay: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiredBeforeStart).toBe(true);
    expect(result.rawLastDay).toEqual({ year: 2026, month: 8, day: 13 });
    expect(result.shiftedByDays).toBe(0);
    expect(result.totalDays).toBe(0);
  });

  it("counts the start day when asked, which is one day of difference", () => {
    const inclusive = deadlineForward({ ...base, countStartDay: true, shift: "none" });
    expect(inclusive.ok).toBe(true);
    if (!inclusive.ok) return;
    // 14 + 8 − 1 = 21 August; eight days counted inclusively.
    expect(inclusive.rawLastDay).toEqual({ year: 2026, month: 8, day: 21 });
    expect(inclusive.totalDays).toBe(8);
  });

  it("refuses a week with no working day in it rather than looping forever", () => {
    expect(
      deadlineForward({ ...base, nonWorkingWeekdays: [1, 2, 3, 4, 5, 6, 7] }),
    ).toEqual({ ok: false, reason: "nonWorkingWeekdays" });
  });

  it("refuses an out-of-range length and an impossible start date", () => {
    expect(deadlineForward({ ...base, length: -1 })).toEqual({ ok: false, reason: "length" });
    expect(
      deadlineForward({ ...base, startDate: { year: 2026, month: 4, day: 31 } }),
    ).toEqual({ ok: false, reason: "startDate" });
  });
});

describe("deadlineBackward", () => {
  it("returns every start date that reaches the given end, not one of them", () => {
    const result = deadlineBackward({
      endDate: { year: 2026, month: 2, day: 28 },
      length: 3,
      unit: "months",
      countStartDay: false,
      nonWorkingWeekdays: [],
      nonWorkingDates: [],
      shift: "none",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min(30, 28) and min(29, 28) both land on 28 February, so 28, 29 and 30
    // November 2025 all produce the same end date. One of them would be a guess.
    // Each candidate is run back through the forward computation, so its own
    // raw and shifted last day (equal here, since shift is "none") come with it.
    const feb28 = { year: 2026, month: 2, day: 28 };
    expect(result.candidates).toEqual([
      { startDate: { year: 2025, month: 11, day: 28 }, rawLastDay: feb28, lastDay: feb28 },
      { startDate: { year: 2025, month: 11, day: 29 }, rawLastDay: feb28, lastDay: feb28 },
      { startDate: { year: 2025, month: 11, day: 30 }, rawLastDay: feb28, lastDay: feb28 },
    ]);
  });

  it("returns an empty list where no start date reaches the end at all", () => {
    const result = deadlineBackward({
      endDate: { year: 2026, month: 4, day: 30 },
      length: 2,
      unit: "months",
      countStartDay: false,
      nonWorkingWeekdays: [],
      nonWorkingDates: [],
      shift: "none",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The preimage would have to be 30 February. Nothing maps to 30 April, and
    // an empty list is the honest answer rather than the nearest date.
    expect(result.candidates).toEqual([]);
  });

  it("is unambiguous in days", () => {
    const result = deadlineBackward({
      endDate: { year: 2026, month: 8, day: 22 },
      length: 8,
      unit: "days",
      countStartDay: false,
      nonWorkingWeekdays: [],
      nonWorkingDates: [],
      shift: "none",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 22 − 8 = 14 August; a single candidate, run through the same forward
    // computation, whose raw and shifted last day are both 22 August.
    expect(result.candidates).toEqual([
      {
        startDate: { year: 2026, month: 8, day: 14 },
        rawLastDay: { year: 2026, month: 8, day: 22 },
        lastDay: { year: 2026, month: 8, day: 22 },
      },
    ]);
  });

  it("refuses an impossible end date", () => {
    expect(
      deadlineBackward({
        endDate: { year: 2100, month: 2, day: 29 },
        length: 1,
        unit: "months",
        countStartDay: false,
        nonWorkingWeekdays: [],
        nonWorkingDates: [],
        shift: "none",
      }),
    ).toEqual({ ok: false, reason: "endDate" });
  });

  it("refuses a malformed weekday set and an oversized date list even with an empty preimage", () => {
    // The preimage of 30 April at +2 months is empty (it would need 30
    // February), so `deadlineForward` never runs for any candidate — and
    // with it, the only place that used to validate these two fields never
    // ran either. Both are checked up front now, independent of the result.
    const base = {
      endDate: { year: 2026, month: 4, day: 30 },
      length: 2,
      unit: "months",
      countStartDay: false,
      nonWorkingDates: [],
      shift: "forward",
    } as const;
    expect(deadlineBackward({ ...base, nonWorkingWeekdays: [9 as 1, 9 as 1] })).toEqual({
      ok: false,
      reason: "nonWorkingWeekdays",
    });
    expect(
      deadlineBackward({
        ...base,
        nonWorkingWeekdays: [],
        nonWorkingDates: Array.from({ length: 401 }, () => ({
          year: 2026,
          month: 1,
          day: 1,
        })),
      }),
    ).toEqual({ ok: false, reason: "nonWorkingDates" });
  });
});

describe("textPages", () => {
  it("divides an exact multiple into whole pages", () => {
    const result = textPages({
      text: "a".repeat(5400),
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
      pricePerPage: 1200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 5400/1800 = 3 exactly.
    expect(result.exactPages).toBe(3);
    expect(result.pagesRoundedUp).toBe(3);
    expect(result.pagesToHalf).toBe(3);
    expect(result.amount).toBe(3600); // 3 × 1200
  });

  it("turns one extra character into a whole extra page", () => {
    const text = "a".repeat(5401);
    const up = textPages({
      text,
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
      pricePerPage: 1200,
    });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    // 5401/1800 = 3.000556 → 4 pages up, and ceil(6.001111)/2 = 3.5 to the half.
    expect(up.exactPages).toBeCloseTo(3.000556, 6);
    expect(up.pagesRoundedUp).toBe(4);
    expect(up.pagesToHalf).toBe(3.5);
    expect(up.amount).toBe(4800); // 4 × 1200

    const half = textPages({
      text,
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "half",
      pricePerPage: 1200,
    });
    expect(half.ok).toBe(true);
    if (!half.ok) return;
    expect(half.amount).toBe(4200); // 3.5 × 1200

    const exact = textPages({
      text,
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "exact",
      pricePerPage: 1200,
    });
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    // 3.000555… × 1200 = 3600.6667 → 3600.67.
    expect(exact.amount).toBeCloseTo(3600.67, 2);
  });

  it("counts characters, words and lines of a real sentence", () => {
    const result = textPages({
      text: "Ugovorne strane su saglasne da se sporovi rešavaju pred stvarno nadležnim sudom.",
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 8+6+2+8+2+2+7+8+4+7+9+6 = 69 non-space characters in twelve words, plus
    // eleven spaces = 80.
    expect(result.charactersWithSpaces).toBe(80);
    expect(result.charactersWithoutSpaces).toBe(69);
    expect(result.words).toBe(12);
    expect(result.lines).toBe(1);
    expect(result.exactPages).toBeCloseTo(0.044444, 6); // 80/1800
    expect(result.pagesRoundedUp).toBe(1);
    expect(result.pagesToHalf).toBe(0.5);
    expect(result.amount).toBeUndefined();
  });

  it("counts code points and not UTF-16 units", () => {
    const emoji = textPages({
      text: "👍",
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
    });
    expect(emoji.ok).toBe(true);
    if (!emoji.ok) return;
    // "👍".length is 2; the number a person would count is 1.
    expect(emoji.charactersWithSpaces).toBe(1);

    const diacritics = textPages({
      text: "čćšžđ",
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
    });
    expect(diacritics.ok).toBe(true);
    if (!diacritics.ok) return;
    expect(diacritics.charactersWithSpaces).toBe(5);

    // The same letter written as e + combining acute is one character after NFC.
    const composed = textPages({
      text: "é",
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.charactersWithSpaces).toBe(1);
    // The source text here is "e" + combining acute (U+0301) — two code points
    // BEFORE NFC normalisation, one after.
    expect(composed.charactersBeforeNormalization).toBe(2);
  });

  it("gives empty text zero pages, and one line by the formula", () => {
    const result = textPages({
      text: "",
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
      pricePerPage: 1200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charactersWithSpaces).toBe(0);
    expect(result.words).toBe(0);
    expect(result.lines).toBe(1); // breaks + 1, stated rather than special-cased
    expect(result.exactPages).toBe(0);
    expect(result.pagesRoundedUp).toBe(0);
    expect(result.amount).toBe(0);
  });

  it("shows how much the spaces switch is worth", () => {
    const text = `${"a".repeat(900)}${" ".repeat(100)}`;
    const withSpaces = textPages({
      text,
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "half",
      pricePerPage: 1000,
    });
    const withoutSpaces = textPages({
      text,
      charactersPerPage: 1800,
      countSpaces: false,
      rounding: "half",
      pricePerPage: 1000,
    });
    expect(withSpaces.ok && withoutSpaces.ok).toBe(true);
    if (!withSpaces.ok || !withoutSpaces.ok) return;
    // 1000/1800 = 0.555556 → ceil(1.111111)/2 = 1.0; 900/1800 = 0.5 → 0.5.
    expect(withSpaces.pagesToHalf).toBe(1);
    expect(withoutSpaces.pagesToHalf).toBe(0.5);
    expect(withSpaces.amount).toBe(1000);
    expect(withoutSpaces.amount).toBe(500);
    // Both are one page when rounded up — the difference only shows at the half.
    expect(withSpaces.pagesRoundedUp).toBe(1);
    expect(withoutSpaces.pagesRoundedUp).toBe(1);
  });

  it("counts CRLF as one line break", () => {
    const result = textPages({
      text: "a\r\nb\nc",
      charactersPerPage: 1800,
      countSpaces: true,
      rounding: "up",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toBe(3);
    expect(result.words).toBe(3);
  });

  it("refuses a zero page size and a negative price", () => {
    expect(
      textPages({ text: "a", charactersPerPage: 0, countSpaces: true, rounding: "up" }),
    ).toEqual({ ok: false, reason: "charactersPerPage" });
    expect(
      textPages({
        text: "a",
        charactersPerPage: 1800,
        countSpaces: true,
        rounding: "up",
        pricePerPage: -1,
      }),
    ).toEqual({ ok: false, reason: "pricePerPage" });
  });
});

describe("coOwnershipShares", () => {
  it("puts thirds, sixths and halves over one denominator and finds the whole", () => {
    const result = coOwnershipShares({
      shares: [
        { numerator: 1, denominator: 3 },
        { numerator: 1, denominator: 6 },
        { numerator: 1, denominator: 2 },
      ],
      totalArea: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // lcm(3, 6, 2) = 6 → 2/6, 1/6, 3/6; 2 + 1 + 3 = 6 = L.
    expect(result.commonDenominator).toBe(6n);
    expect(result.shares.map((share) => share.commonNumerator)).toEqual([2n, 1n, 3n]);
    expect(result.sumNumerator).toBe(6n);
    expect(result.isWhole).toBe(true);
    expect(result.shares.map((share) => share.percent)).toEqual([
      33.333333, 16.666667, 50,
    ]);
    expect(result.shares.map((share) => share.area)).toEqual([30, 15, 45]);
  });

  it("reduces a share before taking the common denominator", () => {
    const result = coOwnershipShares({
      shares: [
        { numerator: 125, denominator: 1000 },
        { numerator: 3, denominator: 8 },
        { numerator: 1, denominator: 2 },
      ],
      totalArea: 240,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 125/1000 reduces by 125 to 1/8, so lcm(8, 8, 2) = 8 rather than 1000.
    expect(result.shares[0]?.numerator).toBe(1n);
    expect(result.shares[0]?.denominator).toBe(8n);
    expect(result.commonDenominator).toBe(8n);
    expect(result.isWhole).toBe(true);
    expect(result.shares.map((share) => share.area)).toEqual([30, 90, 120]);
  });

  it("reports what is missing as a fraction and a percentage", () => {
    const result = coOwnershipShares({
      shares: [
        { numerator: 1, denominator: 4 },
        { numerator: 1, denominator: 4 },
        { numerator: 1, denominator: 3 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // lcm(4, 4, 3) = 12 → 3, 3, 4; the sum is 10, not 12.
    expect(result.sumNumerator).toBe(10n);
    expect(result.isWhole).toBe(false);
    // (12 − 10)/12 = 2/12 = 1/6 = 16.666667 % missing.
    expect(result.differenceNumerator).toBe(1n);
    expect(result.differenceDenominator).toBe(6n);
    expect(result.differencePercent).toBe(16.666667);
    expect(result.shares[0]?.area).toBeUndefined();
  });

  it("carries the other sign when the shares exceed the whole", () => {
    const result = coOwnershipShares({
      shares: [
        { numerator: 3, denominator: 4 },
        { numerator: 1, denominator: 2 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3/4 + 2/4 = 5/4: (4 − 5)/4 = −1/4 = −25 %.
    expect(result.sumNumerator).toBe(5n);
    expect(result.isWhole).toBe(false);
    expect(result.differenceNumerator).toBe(-1n);
    expect(result.differenceDenominator).toBe(4n);
    expect(result.differencePercent).toBe(-25);
  });

  it("says when a share does not fit the target denominator instead of rounding it", () => {
    const result = coOwnershipShares({
      shares: [
        { numerator: 1, denominator: 3 },
        { numerator: 2, denominator: 3 },
      ],
      targetDenominator: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000 mod 3 ≠ 0, so 1/3 is not representable over 1000 — and the sum is
    // still exactly one.
    expect(result.shares[0]?.fitsTarget).toBe(false);
    expect(result.shares[0]?.targetNumerator).toBeUndefined();
    expect(result.isWhole).toBe(true);

    const fits = coOwnershipShares({
      shares: [
        { numerator: 1, denominator: 4 },
        { numerator: 3, denominator: 4 },
      ],
      targetDenominator: 1000,
    });
    expect(fits.ok).toBe(true);
    if (!fits.ok) return;
    expect(fits.shares[0]?.fitsTarget).toBe(true);
    expect(fits.shares[0]?.targetNumerator).toBe(250n); // 1 × 1000/4
  });

  it("stays exact where a double would not", () => {
    const result = coOwnershipShares({
      shares: [
        { numerator: 1, denominator: 7 },
        { numerator: 1, denominator: 11 },
        { numerator: 1, denominator: 13 },
        { numerator: 1, denominator: 17 },
        { numerator: 1, denominator: 19 },
        { numerator: 1, denominator: 23 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 7 × 11 × 13 × 17 × 19 × 23 = 7436429, and the sum of the six numerators is
    // 1062347 + 676039 + 572033 + 437437 + 391391 + 323323 = 3462570.
    expect(result.commonDenominator).toBe(7436429n);
    expect(result.sumNumerator).toBe(3462570n);
    expect(result.isWhole).toBe(false);
  });

  it("apportions the area so three exact thirds of 100.00 m² sum to 100.0000, not 99.99", () => {
    // Independent per-share rounding is the defect this proves absent: 1/3 of
    // 100.00 m² rounded on its own, three times, is 33.33 × 3 = 99.99. The
    // implementation instead apportions T = 1000000 (ten-thousandths of a m²)
    // over three equal weights: floor(1000000/3) = 333333 each, remainder 1
    // each — an exact three-way tie, broken by input order, so only the FIRST
    // share takes the leftover unit.
    const result = coOwnershipShares({
      shares: [
        { numerator: 1, denominator: 3 },
        { numerator: 1, denominator: 3 },
        { numerator: 1, denominator: 3 },
      ],
      totalArea: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shares.map((share) => share.area)).toEqual([33.3334, 33.3333, 33.3333]);
    const total = result.shares.reduce((sum, share) => sum + (share.area ?? 0), 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("refuses a zero denominator, a negative share and an empty list", () => {
    expect(coOwnershipShares({ shares: [{ numerator: 1, denominator: 0 }] })).toEqual({
      ok: false,
      reason: "shares",
    });
    expect(coOwnershipShares({ shares: [{ numerator: -1, denominator: 2 }] })).toEqual({
      ok: false,
      reason: "shares",
    });
    expect(coOwnershipShares({ shares: [] })).toEqual({ ok: false, reason: "shares" });
    expect(
      coOwnershipShares({ shares: [{ numerator: 1, denominator: 2 }], totalArea: 0 }),
    ).toEqual({ ok: false, reason: "totalArea" });
    expect(
      coOwnershipShares({ shares: [{ numerator: 1, denominator: 2 }], targetDenominator: 0 }),
    ).toEqual({ ok: false, reason: "targetDenominator" });
  });
});

describe("sharePart", () => {
  it("scales by the decimals actually typed, not a fixed two, then reduces by GCD", () => {
    // A fixed ×100 would truncate 58.40 exactly as typed, but the reduced
    // fraction is the same whether the scale is 1 or 2 decimals: 58.4 → 584,
    // 186 → 1860, gcd(584, 1860) = 4 → 146/465; 58.40 → 5840, 186.00 → 18600,
    // gcd = 40 → 146/465 also. Either scale lands on the same lowest terms.
    const result = sharePart({ part: 58.4, whole: 186 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(146n);
    expect(result.denominator).toBe(465n);
    // 146/465 = 0.313978494…
    expect(result.percent).toBeCloseTo(31.3978, 4);
  });

  it("keeps a third decimal a fixed ×100 would have silently cut", () => {
    // 58.405 needs 3 decimals; scaling by a fixed 10² would round it to 58.40
    // (or 58.41) before the fraction is even formed. Scaled by 10³ instead:
    // 58405/186000, gcd(58405, 186000) = 5 → 11681/37200.
    const result = sharePart({ part: 58.405, whole: 186 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.numerator).toBe(11681n);
    expect(result.denominator).toBe(37200n);
  });

  it("reduces a part equal to the whole to 1/1, and a zero part to 0/1", () => {
    const whole = sharePart({ part: 186, whole: 186 });
    expect(whole.ok).toBe(true);
    if (whole.ok) {
      expect(whole.numerator).toBe(1n);
      expect(whole.denominator).toBe(1n);
      expect(whole.percent).toBe(100);
    }

    const zero = sharePart({ part: 0, whole: 186 });
    expect(zero.ok).toBe(true);
    if (zero.ok) {
      expect(zero.numerator).toBe(0n);
      expect(zero.denominator).toBe(1n);
      expect(zero.percent).toBe(0);
    }
  });

  it("refuses a part larger than the whole, a negative part and a non-positive whole", () => {
    expect(sharePart({ part: 200, whole: 186 })).toEqual({ ok: false, reason: "whole" });
    expect(sharePart({ part: -1, whole: 186 })).toEqual({ ok: false, reason: "part" });
    expect(sharePart({ part: 1, whole: 0 })).toEqual({ ok: false, reason: "whole" });
  });
});

describe("proportionalCosts", () => {
  it("splits each party's own costs by the proportion of success", () => {
    const result = proportionalCosts({
      claimed: 1000000,
      awarded: 600000,
      firstPartyCosts: 120000,
      secondPartyCosts: 90000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // u = 0.6: 120000 × 0.6 = 72000 and 90000 × 0.4 = 36000.
    expect(result.successPercent).toBe(60);
    expect(result.complementPercent).toBe(40);
    expect(result.firstPartyShare).toBe(72000);
    expect(result.secondPartyShare).toBe(36000);
    expect(result.differenceAmount).toBe(36000);
    expect(result.side).toBe("first");
  });

  it("names the side rather than putting a minus in front of an amount", () => {
    const result = proportionalCosts({
      claimed: 800000,
      awarded: 200000,
      firstPartyCosts: 100000,
      secondPartyCosts: 100000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // u = 0.25: 25000 against 75000, so 50000 falls on the second party.
    expect(result.successPercent).toBe(25);
    expect(result.firstPartyShare).toBe(25000);
    expect(result.secondPartyShare).toBe(75000);
    expect(result.differenceAmount).toBe(50000);
    expect(result.side).toBe("second");
  });

  it("holds at both ends of the proportion", () => {
    const full = proportionalCosts({
      claimed: 350000,
      awarded: 350000,
      firstPartyCosts: 61200,
      secondPartyCosts: 44000,
    });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.successPercent).toBe(100);
    expect(full.firstPartyShare).toBe(61200);
    expect(full.secondPartyShare).toBe(0);
    expect(full.side).toBe("first");

    const none = proportionalCosts({
      claimed: 350000,
      awarded: 0,
      firstPartyCosts: 61200,
      secondPartyCosts: 44000,
    });
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    expect(none.successPercent).toBe(0);
    expect(none.firstPartyShare).toBe(0);
    expect(none.secondPartyShare).toBe(44000);
    expect(none.side).toBe("second");
  });

  it("multiplies by the exact ratio and not by the rounded percentage", () => {
    const result = proportionalCosts({
      claimed: 300000,
      awarded: 100000,
      firstPartyCosts: 45000,
      secondPartyCosts: 45000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // u = 1/3 shows as 33.3333 %, but 45000 × 0.3333 = 14998.50 while
    // 45000 × 1/3 = 15000 exactly. The displayed percentage never multiplies.
    expect(result.successPercent).toBe(33.3333);
    expect(result.firstPartyShare).toBe(15000);
    expect(result.secondPartyShare).toBe(30000);
    expect(result.differenceAmount).toBe(15000);
    expect(result.side).toBe("second");
  });

  it("takes the success ratio directly when typed, not derived from claimed/awarded", () => {
    const result = proportionalCosts({
      successPercent: 60,
      firstPartyCosts: 120000,
      secondPartyCosts: 90000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same 60 % as the first case above, typed directly rather than derived.
    expect(result.successPercent).toBe(60);
    expect(result.firstPartyShare).toBe(72000);
    expect(result.secondPartyShare).toBe(36000);
    expect(result.side).toBe("first");
  });

  it("refuses successPercent together with claimed or awarded — one source, never both", () => {
    expect(
      proportionalCosts({
        successPercent: 60,
        claimed: 1000,
        firstPartyCosts: 1,
        secondPartyCosts: 1,
      }),
    ).toEqual({ ok: false, reason: "successPercent" });
    expect(
      proportionalCosts({
        successPercent: 60,
        awarded: 600,
        firstPartyCosts: 1,
        secondPartyCosts: 1,
      }),
    ).toEqual({ ok: false, reason: "successPercent" });
  });

  it("refuses a zero claim, an award above it, and negative costs", () => {
    expect(
      proportionalCosts({
        claimed: 0,
        awarded: 0,
        firstPartyCosts: 1,
        secondPartyCosts: 1,
      }),
    ).toEqual({ ok: false, reason: "claimed" });
    expect(
      proportionalCosts({
        claimed: 100,
        awarded: 101,
        firstPartyCosts: 1,
        secondPartyCosts: 1,
      }),
    ).toEqual({ ok: false, reason: "awarded" });
    expect(
      proportionalCosts({
        claimed: 100,
        awarded: -1,
        firstPartyCosts: 1,
        secondPartyCosts: 1,
      }),
    ).toEqual({ ok: false, reason: "awarded" });
    expect(
      proportionalCosts({
        claimed: 100,
        awarded: 50,
        firstPartyCosts: -1,
        secondPartyCosts: 1,
      }),
    ).toEqual({ ok: false, reason: "firstPartyCosts" });
    expect(
      proportionalCosts({
        claimed: 100,
        awarded: 50,
        firstPartyCosts: 1,
        secondPartyCosts: -1,
      }),
    ).toEqual({ ok: false, reason: "secondPartyCosts" });
  });
});

describe("contractPenalty", () => {
  it("applies the typed cap and names the day it is reached", () => {
    const result = contractPenalty({
      base: 2000000,
      dailyRatePercent: 0.2,
      dataSource: "days",
      delayDays: 30,
      capPercent: 5,
      includeCompletionDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2000000 × 0.002 × 30 = 120000; the cap is 2000000 × 0.05 = 100000.
    expect(result.uncappedAmount).toBe(120000);
    expect(result.capAmount).toBe(100000);
    expect(result.amount).toBe(100000);
    // ceil(5/0.2) = 25, and on day 25 the accrual is exactly 100000.
    expect(result.capDay).toBe(25);
  });

  it("shows the cap day even before the cap is reached", () => {
    const result = contractPenalty({
      base: 2000000,
      dailyRatePercent: 0.2,
      dataSource: "days",
      delayDays: 20,
      capPercent: 5,
      includeCompletionDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2000000 × 0.002 × 20 = 80000, which is below the cap.
    expect(result.uncappedAmount).toBe(80000);
    expect(result.amount).toBe(80000);
    expect(result.capDay).toBe(25);
  });

  it("derives the days from a pair of dates and never returns a negative penalty", () => {
    const onTime = contractPenalty({
      base: 850000,
      dailyRatePercent: 0.5,
      dataSource: "dates",
      agreedDate: { year: 2026, month: 3, day: 10 },
      actualDate: { year: 2026, month: 3, day: 10 },
      capPercent: 10,
      includeCompletionDay: false,
    });
    expect(onTime.ok).toBe(true);
    if (!onTime.ok) return;
    expect(onTime.delayDays).toBe(0);
    expect(onTime.amount).toBe(0);
    expect(onTime.capAmount).toBe(85000); // 850000 × 0.10
    expect(onTime.capDay).toBe(20); // ceil(10/0.5)

    const late = contractPenalty({
      base: 850000,
      dailyRatePercent: 0.5,
      dataSource: "dates",
      agreedDate: { year: 2026, month: 3, day: 10 },
      actualDate: { year: 2026, month: 3, day: 25 },
      capPercent: 10,
      includeCompletionDay: true,
    });
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    // 25 − 10 = 15 days, plus the day of completion = 16.
    expect(late.delayDays).toBe(16);
    expect(late.amount).toBe(68000); // 850000 × 0.005 × 16
    expect(late.capAmount).toBe(85000);
  });

  it("moves the cap DATE a day earlier under the inclusive convention, matching delayDays", () => {
    // capDay = ceil(10/0.5) = 20 exactly. Under the inclusive convention,
    // delayDays = actual − agreed + 1, so delayDays reaches 20 one calendar
    // day before agreedDate + 20: on 2026-03-29, actual − agreed = 19, +1 = 20.
    const inclusive = contractPenalty({
      base: 850000,
      dailyRatePercent: 0.5,
      dataSource: "dates",
      agreedDate: { year: 2026, month: 3, day: 10 },
      actualDate: { year: 2026, month: 3, day: 29 },
      capPercent: 10,
      includeCompletionDay: true,
    });
    expect(inclusive.ok).toBe(true);
    if (!inclusive.ok) return;
    expect(inclusive.capDay).toBe(20);
    expect(inclusive.capDate).toEqual({ year: 2026, month: 3, day: 29 });
    // On that exact date the accrual equals the cap: 850000 × 0.005 × 20 =
    // 85000, and the cap is 850000 × 0.10 = 85000.
    expect(inclusive.delayDays).toBe(20);
    expect(inclusive.uncappedAmount).toBe(85000);
    expect(inclusive.amount).toBe(85000);
    expect(inclusive.dailyAmount).toBe(4250); // 850000 × 0.005

    // Under the EXCLUSIVE convention (delayDays = actual − agreed, no + 1),
    // delayDays reaches 20 one day later, on 30 March — the old code's answer,
    // still correct for this convention.
    const exclusive = contractPenalty({
      base: 850000,
      dailyRatePercent: 0.5,
      dataSource: "dates",
      agreedDate: { year: 2026, month: 3, day: 10 },
      actualDate: { year: 2026, month: 3, day: 30 },
      capPercent: 10,
      includeCompletionDay: false,
    });
    expect(exclusive.ok).toBe(true);
    if (!exclusive.ok) return;
    expect(exclusive.capDay).toBe(20);
    expect(exclusive.capDate).toEqual({ year: 2026, month: 3, day: 30 });
    expect(exclusive.delayDays).toBe(20);
  });

  it("has no cap day at a zero daily rate instead of dividing by zero", () => {
    const result = contractPenalty({
      base: 1000000,
      dailyRatePercent: 0,
      dataSource: "days",
      delayDays: 100,
      capPercent: 5,
      includeCompletionDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBe(0);
    expect(result.capAmount).toBe(50000);
    expect(result.capDay).toBeUndefined();
  });

  it("reports no cap at all when none was typed — an absent term is not a limit", () => {
    const result = contractPenalty({
      base: 1000000,
      dailyRatePercent: 0.2,
      dataSource: "days",
      delayDays: 1000,
      includeCompletionDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000000 × 0.002 × 1000 = 2000000, uncapped because nothing was typed.
    expect(result.amount).toBe(2000000);
    expect(result.capAmount).toBeUndefined();
    expect(result.capDay).toBeUndefined();
  });

  it("scales by the decimals actually typed, not a fixed six, before the ceiling division", () => {
    // A fixed 10^6 scale rounds a rate typed finer than that BEFORE dividing:
    // 0.0000015 has 7 decimals, so scaling by 10^6 first rounds it to
    // 0.000002 and 5/0.000002 = 2500000 — wrong by more than a million days.
    // Scaling by 10^7 (the larger of the two operands' own decimal counts)
    // keeps both exact: 5 → 50000000, 0.0000015 → 15, and
    // ceil(50000000/15) = ceil(3333333.33…) = 3333334.
    const first = contractPenalty({
      base: 1000,
      dailyRatePercent: 0.0000015,
      dataSource: "days",
      delayDays: 1,
      capPercent: 5,
      includeCompletionDay: false,
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.capDay).toBe(3333334);

    // 0.00000125 has 8 decimals: 5 → 500000000, 0.00000125 → 125,
    // ceil(500000000/125) = 4000000 exactly.
    const second = contractPenalty({
      base: 1000,
      dailyRatePercent: 0.00000125,
      dataSource: "days",
      delayDays: 1,
      capPercent: 5,
      includeCompletionDay: false,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.capDay).toBe(4000000);

    // 0.0012345678 has 10 decimals: 10 → 100000000000, itself → 12345678.
    // 12345678 × 8100 = 99999991800, leaving a remainder of 8200 — not exact
    // — so the ceiling steps up to 8101, not 8100.
    const third = contractPenalty({
      base: 1000,
      dailyRatePercent: 0.0012345678,
      dataSource: "days",
      delayDays: 1,
      capPercent: 10,
      includeCompletionDay: false,
    });
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.capDay).toBe(8101);

    // A rate this fine used to round to 0 at a fixed six decimals and throw a
    // BigInt division-by-zero instead of answering — deriving the scale from
    // what was typed leaves nothing to round away, so it now answers exactly:
    // 5 → 50000000, 0.0000004 → 4, ceil(50000000/4) = 12500000.
    const tiny = contractPenalty({
      base: 1000,
      dailyRatePercent: 0.0000004,
      dataSource: "days",
      delayDays: 1,
      capPercent: 5,
      includeCompletionDay: false,
    });
    expect(tiny.ok).toBe(true);
    if (tiny.ok) expect(tiny.capDay).toBe(12500000);
  });

  it("reaches a zero cap on day zero", () => {
    const result = contractPenalty({
      base: 1000000,
      dailyRatePercent: 0.2,
      dataSource: "days",
      delayDays: 10,
      capPercent: 0,
      includeCompletionDay: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capAmount).toBe(0);
    expect(result.amount).toBe(0);
    expect(result.capDay).toBe(0);
  });

  it("refuses a non-positive base, a rate outside 0…100 and a missing day count", () => {
    expect(
      contractPenalty({
        base: 0,
        dailyRatePercent: 1,
        dataSource: "days",
        delayDays: 1,
        includeCompletionDay: false,
      }),
    ).toEqual({ ok: false, reason: "base" });
    expect(
      contractPenalty({
        base: 100,
        dailyRatePercent: 101,
        dataSource: "days",
        delayDays: 1,
        includeCompletionDay: false,
      }),
    ).toEqual({ ok: false, reason: "dailyRatePercent" });
    expect(
      contractPenalty({
        base: 100,
        dailyRatePercent: 1,
        dataSource: "days",
        includeCompletionDay: false,
      }),
    ).toEqual({ ok: false, reason: "delayDays" });
    expect(
      contractPenalty({
        base: 100,
        dailyRatePercent: 1,
        dataSource: "days",
        delayDays: 1,
        capPercent: 1001,
        includeCompletionDay: false,
      }),
    ).toEqual({ ok: false, reason: "capPercent" });
    expect(
      contractPenalty({
        base: 100,
        dailyRatePercent: 1,
        dataSource: "dates",
        agreedDate: { year: 2026, month: 2, day: 30 },
        actualDate: { year: 2026, month: 3, day: 1 },
        includeCompletionDay: false,
      }),
    ).toEqual({ ok: false, reason: "agreedDate" });
  });
});

describe("sumOfPeriods", () => {
  it("adds two periods and decomposes the sum by 30/360", () => {
    const result = sumOfPeriods({
      periods: [
        { from: { year: 2019, month: 3, day: 1 }, to: { year: 2021, month: 6, day: 30 } },
        { from: { year: 2022, month: 1, day: 10 }, to: { year: 2023, month: 2, day: 28 } },
      ],
      includeLastDay: true,
      convention: "30/360",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 366 (through the leap February 2020) + 365 + 121 = 852, +1 = 853; and
    // 365 + 31 + 18 = 414, +1 = 415. 853 + 415 = 1268.
    expect(result.rows[0]?.days).toBe(853);
    expect(result.rows[1]?.days).toBe(415);
    expect(result.totalDays).toBe(1268);
    // 1268/360 = 3 remainder 188; 188/30 = 6 remainder 8.
    expect(result.years).toBe(3);
    expect(result.months).toBe(6);
    expect(result.days).toBe(8);
    expect(result.overlaps).toEqual([]);
  });

  it("separates the two counting conventions on a single day", () => {
    const period = {
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 1, day: 1 },
    } as const;
    const inclusive = sumOfPeriods({
      periods: [period],
      includeLastDay: true,
      convention: "30/360",
    });
    const exclusive = sumOfPeriods({
      periods: [period],
      includeLastDay: false,
      convention: "30/360",
    });
    expect(inclusive.ok && exclusive.ok).toBe(true);
    if (!inclusive.ok || !exclusive.ok) return;
    expect(inclusive.totalDays).toBe(1);
    expect(exclusive.totalDays).toBe(0);
  });

  it("reports an overlap with both of its dates", () => {
    const result = sumOfPeriods({
      periods: [
        { from: { year: 2020, month: 1, day: 1 }, to: { year: 2020, month: 12, day: 31 } },
        { from: { year: 2020, month: 6, day: 1 }, to: { year: 2021, month: 5, day: 31 } },
      ],
      includeLastDay: true,
      convention: "30/360",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2020 is a leap year → 366 days; the second period crosses a non-leap
    // February → 365.
    expect(result.rows.map((row) => row.days)).toEqual([366, 365]);
    expect(result.totalDays).toBe(731);
    // The intersection is 1 June to 31 December 2020: 213 + 1 = 214 days.
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0]?.from).toEqual({ year: 2020, month: 6, day: 1 });
    expect(result.overlaps[0]?.to).toEqual({ year: 2020, month: 12, day: 31 });
    expect(result.overlaps[0]?.days).toBe(214);
  });

  it("compares all pairs, not just the neighbours after sorting", () => {
    const result = sumOfPeriods({
      periods: [
        { from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } },
        { from: { year: 2026, month: 1, day: 2 }, to: { year: 2026, month: 1, day: 3 } },
        { from: { year: 2026, month: 6, day: 1 }, to: { year: 2026, month: 6, day: 30 } },
      ],
      includeLastDay: true,
      convention: "30/360",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The first overlaps both of the others; the second and third do not touch.
    // Comparing only neighbours after sorting would have found one of the two.
    expect(result.overlaps).toHaveLength(2);
    expect(result.overlaps[0]?.days).toBe(2); // 2–3 January
    expect(result.overlaps[1]?.days).toBe(30); // the whole of June
  });

  it("flags a reversed period and leaves it out of the sum", () => {
    const result = sumOfPeriods({
      periods: [
        { from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 1, day: 31 } },
        { from: { year: 2026, month: 3, day: 31 }, to: { year: 2026, month: 3, day: 1 } },
      ],
      includeLastDay: true,
      convention: "30/360",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1]?.reversed).toBe(true);
    expect(result.totalDays).toBe(31); // never 31 − 30
  });

  it("decomposes one period by the calendar, which is not the 30/360 answer", () => {
    const period = {
      from: { year: 2026, month: 3, day: 15 },
      to: { year: 2027, month: 5, day: 14 },
    } as const;
    const calendar = sumOfPeriods({
      periods: [period],
      includeLastDay: true,
      convention: "calendar",
    });
    expect(calendar.ok).toBe(true);
    if (!calendar.ok) return;
    // 2027-03-15 ≤ 2027-05-14 so g = 1; 2027-04-15 ≤ 2027-05-14 but
    // 2027-05-15 is not, so m = 1; then 29 days to 14 May, +1 inclusive = 30.
    expect(calendar.totalDays).toBe(426);
    expect(calendar.years).toBe(1);
    expect(calendar.months).toBe(1);
    expect(calendar.days).toBe(30);

    const thirty = sumOfPeriods({
      periods: [period],
      includeLastDay: true,
      convention: "30/360",
    });
    expect(thirty.ok).toBe(true);
    if (!thirty.ok) return;
    // 426/360 = 1 remainder 66; 66/30 = 2 remainder 6. Same days, other answer,
    // which is why the convention is named in the output.
    expect(thirty.years).toBe(1);
    expect(thirty.months).toBe(2);
    expect(thirty.days).toBe(6);
  });

  it("refuses the calendar decomposition for more than one period", () => {
    expect(
      sumOfPeriods({
        periods: [
          { from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 1, day: 31 } },
          { from: { year: 2026, month: 3, day: 1 }, to: { year: 2026, month: 3, day: 31 } },
        ],
        includeLastDay: true,
        convention: "calendar",
      }),
    ).toEqual({ ok: false, reason: "convention" });
  });

  it("refuses an empty list and an impossible date", () => {
    expect(sumOfPeriods({ periods: [], includeLastDay: true, convention: "30/360" })).toEqual({
      ok: false,
      reason: "periods",
    });
    expect(
      sumOfPeriods({
        periods: [
          { from: { year: 2026, month: 2, day: 29 }, to: { year: 2026, month: 3, day: 1 } },
        ],
        includeLastDay: true,
        convention: "30/360",
      }),
    ).toEqual({ ok: false, reason: "periods" });
  });
});
