import { describe, expect, it } from "vitest";

import {
  allocateWithoutRemainder,
  amountInWords,
  benfordDigits,
  breakevenPoint,
  crossRate,
  depreciationSchedule,
  domesticAccountCheck,
  financialRatios,
  fxDifference,
  grossFromNet,
  ibanCheck,
  identifierCheckDigit,
  interestByPeriods,
  inventoryCosting,
  loanSchedule,
  priceMargin,
  rateConversion,
  rebateChain,
  trialBalance,
  trialBalanceDiagnostics,
  tvmSolve,
} from "./racunovodstvo.js";

/**
 * Every expectation here was worked by hand from the inputs, and the arithmetic
 * is written into the comment above it so a reader can check it without running
 * anything. A test whose expected value was copied out of a first run pins the
 * bug as firmly as the behaviour.
 */

describe("allocateWithoutRemainder", () => {
  // Turns bare keys into named items — the row order the assignment's ties resolve on.
  const items = (keys: readonly number[]) =>
    keys.map((key, index) => ({ name: String.fromCharCode(65 + index), key }));

  it("gives the odd para to the first row when every fractional part is the same", () => {
    const result = allocateWithoutRemainder({
      total: 100,
      items: items([1, 1, 1]),
      decimals: 2,
      mode: "equal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // T_u = 10000; e_i = 3333.333…; b_i = 3333 (sum 9999); R = 10000 − 9999 = 1.
    // All three remainders tie at 1, so input order decides and row A takes it.
    expect(result.rows.map((row) => row.allocated)).toEqual([33.34, 33.33, 33.33]);
    expect(result.adjustedCount).toBe(1);
    expect(result.allocatedTotal).toBe(100);
    // 33.34 + 33.33 + 33.33 = 100.00 exactly, which is the whole point.
    expect(result.rows.reduce((sum, row) => sum + row.allocated, 0)).toBeCloseTo(100, 9);
    // The unrounded share is 100/3 = 33.333333…, and the row that got the para
    // is 0.006666… above it.
    expect(result.rows[0]?.exact).toBeCloseTo(33.333333, 6);
    expect(result.rows[0]?.rounding).toBeCloseTo(0.006667, 6);
    expect(result.rows[0]?.bumped).toBe(true);
    expect(result.rows[0]?.remainderRank).toBe(1);
    expect(result.rows[1]?.bumped).toBe(false);
    // allocated/total: 33.34/100 = 33.34%, distinct from the key share 1/3 = 33.333…%.
    expect(result.rows[0]?.allocatedSharePercent).toBeCloseTo(33.34, 6);
  });

  it("adjusts nothing when the key divides the amount exactly", () => {
    const result = allocateWithoutRemainder({
      total: 1000,
      items: items([3, 5, 2]),
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // W = 10; e = 100000·3/10 = 30000, 50000, 20000 minor units, all whole → R = 0.
    expect(result.rows.map((row) => row.allocated)).toEqual([300, 500, 200]);
    expect(result.rows.map((row) => row.keySharePercent)).toEqual([30, 50, 20]);
    expect(result.rows.map((row) => row.name)).toEqual(["A", "B", "C"]);
    expect(result.adjustedCount).toBe(0);
  });

  it("spreads four minor units over six equal parts — 4 × 1.67 + 2 × 1.66 = 10.00", () => {
    const result = allocateWithoutRemainder({
      total: 10,
      items: items([1, 1, 1, 1, 1, 1]),
      decimals: 2,
      mode: "equal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // T_u = 1000; b_i = floor(166.666…) = 166, sum 996; R = 4.
    expect(result.rows.map((row) => row.allocated)).toEqual([1.67, 1.67, 1.67, 1.67, 1.66, 1.66]);
    // 4 × 1.67 + 2 × 1.66 = 6.68 + 3.32 = 10.00
    expect(result.adjustedCount).toBe(4);
    expect(result.allocatedTotal).toBe(10);
  });

  it("beats naive per-row rounding on seven equal shares of 100.00", () => {
    const result = allocateWithoutRemainder({
      total: 100,
      items: items([1, 1, 1, 1, 1, 1, 1]),
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // e_i = 10000/7 = 1428.571…; b_i = 1428 (sum 9996); R = 4 → four rows at
    // 14.29 and three at 14.28. Rounding each row to 14.29 would give 100.03.
    expect(result.rows.map((row) => row.allocated)).toEqual([
      14.29, 14.29, 14.29, 14.29, 14.28, 14.28, 14.28,
    ]);
    // 4 × 14.29 + 3 × 14.28 = 57.16 + 42.84 = 100.00
    expect(result.rows.reduce((sum, row) => sum + row.allocated, 0)).toBeCloseTo(100, 9);
  });

  it("closes a negative total exactly too — the sign is put back after the split", () => {
    const result = allocateWithoutRemainder({
      total: -100,
      items: items([1, 1, 1]),
      decimals: 2,
      mode: "equal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.allocated)).toEqual([-33.34, -33.33, -33.33]);
    expect(result.allocatedTotal).toBe(-100);
  });

  it("gives a zero key nothing and lets it take no part in the remainder", () => {
    const result = allocateWithoutRemainder({
      total: 10,
      items: items([1, 0, 1]),
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // W = 2; e = 500 each for the two live keys, R = 0; the zero key gets 0.00.
    expect(result.rows.map((row) => row.allocated)).toEqual([5, 0, 5]);
    expect(result.rows[1]?.keySharePercent).toBe(0);
    // A zero key never enters the remainder race at all.
    expect(result.rows[1]?.remainderRank).toBeUndefined();
  });

  it("refuses rather than repairs: no rows, keys that sum to nothing, bad decimals", () => {
    expect(
      allocateWithoutRemainder({ total: Number.NaN, items: items([1]), decimals: 2, mode: "byKey" }),
    ).toEqual({ ok: false, reason: "total" });
    expect(
      allocateWithoutRemainder({ total: 100, items: [], decimals: 2, mode: "byKey" }),
    ).toEqual({ ok: false, reason: "items" });
    expect(
      allocateWithoutRemainder({ total: 100, items: items([0, 0]), decimals: 2, mode: "byKey" }),
    ).toEqual({ ok: false, reason: "items" });
    expect(
      allocateWithoutRemainder({ total: 100, items: items([-1, 2]), decimals: 2, mode: "byKey" }),
    ).toEqual({ ok: false, reason: "items" });
    expect(
      allocateWithoutRemainder({ total: 100, items: items([1]), decimals: 5, mode: "byKey" }),
    ).toEqual({ ok: false, reason: "decimals" });
    // 1e15 dinara in para is 1e17, past 2^53, where the integer split stops
    // being exact — so it says so instead of losing a minor unit.
    expect(
      allocateWithoutRemainder({ total: 1e15, items: items([1]), decimals: 2, mode: "byKey" }),
    ).toEqual({ ok: false, reason: "total" });
  });

  it("keeps a huge total exact — the rounding nudge must never overshoot 0.5", () => {
    // 90 000 000 000 000,00 in para is 9 000 000 000 000 000 minor units: an
    // exact integer already, and within Number.MAX_SAFE_INTEGER (≈9.007e15).
    // A nudge proportional to the RAW magnitude (uncapped) would add roughly
    // 9e15 × 4 × Number.EPSILON ≈ 7.94 here — enough to round an
    // already-exact integer up by a whole unit, breaking `allocatedTotal`'s
    // own contract of being exactly the input, rounded. Capped at 2^48 ulps
    // the nudge tops out at 0.25, which can never cross the 0.5 boundary.
    const result = allocateWithoutRemainder({
      total: 90_000_000_000_000,
      items: items([1]),
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.allocatedTotal).toBe(90_000_000_000_000);
    expect(result.rows[0]?.allocated).toBe(90_000_000_000_000);
  });

  it("leaves the allocated share undefined at a zero total — a real 0/0, not a computed zero", () => {
    const result = allocateWithoutRemainder({
      total: 0,
      items: items([1, 2]),
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.every((row) => row.allocated === 0)).toBe(true);
    expect(result.rows[0]?.allocatedSharePercent).toBeUndefined();
    expect(result.rows[1]?.allocatedSharePercent).toBeUndefined();
  });

  it("splits into n equal, unnamed parts when items are omitted", () => {
    const result = allocateWithoutRemainder({ total: 10, decimals: 2, mode: "equal", parts: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same arithmetic as the six-way vector above (T_u = 1000, b_i = 166,
    // R = 4), just without named rows.
    expect(result.rows.map((row) => row.allocated)).toEqual([1.67, 1.67, 1.67, 1.67, 1.66, 1.66]);
    expect(result.rows.every((row) => row.name === "")).toBe(true);
  });

  it("refuses equal mode with neither named items nor a usable part count", () => {
    expect(allocateWithoutRemainder({ total: 10, decimals: 2, mode: "equal" })).toEqual({
      ok: false,
      reason: "parts",
    });
    expect(
      allocateWithoutRemainder({ total: 10, decimals: 2, mode: "equal", parts: 0 }),
    ).toEqual({ ok: false, reason: "parts" });
    expect(
      allocateWithoutRemainder({ total: 10, decimals: 2, mode: "equal", parts: 201 }),
    ).toEqual({ ok: false, reason: "parts" });
  });

  it("still refuses byKey mode with no items, even when parts is given", () => {
    expect(
      allocateWithoutRemainder({ total: 10, decimals: 2, mode: "byKey", parts: 3 }),
    ).toEqual({ ok: false, reason: "items" });
  });

  it("splits by fractional keys instead of refusing every product that isn't a safe integer", () => {
    // Before scaling, `100000 × 33.34` is `3334000.0000000005` in binary64 —
    // not a safe integer — which is why the OLD code refused every fractional
    // key outright. Scaled to integers first (× 100, the two decimals every
    // key here needs): w = [3333, 3333, 3334], W = 10000. T_u = 100000.
    // e_i = T_u·w_i/W = 33330, 33330, 33340 exactly (no remainder at all,
    // since 3333/10000 and 3334/10000 both divide 100000 evenly) — 333,30 +
    // 333,30 + 333,40 = 1000,00.
    const result = allocateWithoutRemainder({
      total: 1000,
      items: [
        { name: "A", key: 33.33 },
        { name: "B", key: 33.33 },
        { name: "C", key: 33.34 },
      ],
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.allocated)).toEqual([333.3, 333.3, 333.4]);
    expect(result.adjustedCount).toBe(0);
    expect(result.allocatedTotal).toBe(1000);
    // The row's own `key` still reports the RAW typed value, unaffected by
    // the internal integer scaling.
    expect(result.rows[2]?.key).toBe(33.34);
  });

  it("ranks the remainder by an exact integer once the keys are scaled, not a float", () => {
    // Keys 0,1 and 0,2 scale (× 10) to w = [1, 2], W = 3. T_u = 100 (1,00 at
    // 2 decimals). e_1 = 100·1/3 → b_1 = 33, remainder 100 − 3·33 = 1.
    // e_2 = 100·2/3 → b_2 = 66, remainder 200 − 3·66 = 2. Both remainders are
    // now EXACT integers (no float residue to rank by), 2 > 1, so the second
    // row takes the one leftover minor unit: 33 and 66+1 = 67 → 0,33 / 0,67.
    const result = allocateWithoutRemainder({
      total: 1,
      items: [
        { name: "A", key: 0.1 },
        { name: "B", key: 0.2 },
      ],
      decimals: 2,
      mode: "byKey",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.allocated)).toEqual([0.33, 0.67]);
    expect(result.rows[0]?.remainderRank).toBe(2);
    expect(result.rows[1]?.remainderRank).toBe(1);
    expect(result.rows[1]?.bumped).toBe(true);
    expect(result.allocatedTotal).toBe(1);
  });
});

describe("amountInWords", () => {
  // „dinar" — masculine; paucal and genitive plural happen to be the same word.
  const DINAR = { singular: "dinar", paucal: "dinara", plural: "dinara" } as const;
  // „para" — feminine; 1 is singular, 2-4 paucal, 0 and 5+ plural.
  const PARA = { singular: "para", paucal: "pare", plural: "para" } as const;
  const withCurrency = {
    mode: "withCurrency",
    currency: DINAR,
    currencyGender: "masculine",
    subunit: PARA,
    subunitGender: "feminine",
  } as const;

  it("agrees the nouns with the number — 1234,56", () => {
    const result = amountInWords({
      ...withCurrency,
      cents: 123456,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // D = 1234: thousands group 1 → „hiljadu"; units group 234 → „dvesta
    // trideset četiri". D mod 100 = 34 → u = 4, l = 34 → paucal → „dinara".
    // P = 56 → u = 6 → plural → „para".
    expect(result.text).toBe("hiljadu dvesta trideset četiri dinara i pedeset šest para");
    expect(result.whole).toBe(1234);
    expect(result.subunits).toBe(56);
    expect(result.negative).toBe(false);
  });

  it("puts the thousands in the feminine — 21000,00 is „dvadeset jedna hiljada", () => {
    const result = amountInWords({
      ...withCurrency,
      cents: 2_100_000,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // g = 21: u = 1 and l = 21 (not 11) → singular → feminine „dvadeset jedna"
    // with the nominative singular „hiljada". Units group 0 is dropped whole.
    // D mod 100 = 0 → plural → „dinara".
    expect(result.text).toBe("dvadeset jedna hiljada dinara i nula para");
  });

  it("keeps the same digit masculine when it counts dinars — 21,00", () => {
    const result = amountInWords({
      ...withCurrency,
      cents: 2100,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The same 21 as above, now masculine: „dvadeset jedan", and u = 1 with
    // l = 21 makes the noun singular „dinar".
    expect(result.text).toBe("dvadeset jedan dinar i nula para");
  });

  it("applies the 11-14 exception — 12000,00 is „dvanaest hiljada\", never „hiljade\"", () => {
    const result = amountInWords({
      ...withCurrency,
      cents: 1_200_000,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // u = 2 would say paucal, but l = 12 is inside 12..14, so it is plural.
    expect(result.text).toBe("dvanaest hiljada dinara i nula para");
  });

  it("writes a lone million without „jedan\" and a single para in the feminine", () => {
    const result = amountInWords({
      ...withCurrency,
      cents: 100_000_001,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Millions group 1 → „milion"; D mod 100 = 0 → „dinara"; P = 1 → feminine
    // „jedna" and the singular „para".
    expect(result.text).toBe("milion dinara i jedna para");
  });

  it("spells zero and the paucal of dinar", () => {
    const zero = amountInWords({
      ...withCurrency,
      cents: 0,
      paraStyle: "words",
      letterCase: "lower",
    });
    const two = amountInWords({
      ...withCurrency,
      cents: 200,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(zero.ok && two.ok).toBe(true);
    if (!zero.ok || !two.ok) return;
    expect(zero.text).toBe("nula dinara i nula para");
    // Paucal and genitive plural of „dinar" are the same word, so 2 reads
    // „dva dinara" just as 5 does.
    expect(two.text).toBe("dva dinara i nula para");
  });

  it("marks a negative amount with a leading „minus\"", () => {
    const result = amountInWords({
      ...withCurrency,
      cents: -2100,
      paraStyle: "words",
      letterCase: "lower",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("minus dvadeset jedan dinar i nula para");
    expect(result.negative).toBe(true);
    // whole/subunits report the magnitude, not the signed value.
    expect(result.whole).toBe(21);
  });

  it("writes the para as a fraction, drops the currency, and changes case on request", () => {
    const fraction = amountInWords({
      ...withCurrency,
      cents: 123456,
      paraStyle: "fraction",
      letterCase: "lower",
    });
    const plain = amountInWords({
      mode: "plain",
      cents: 123456,
      paraStyle: "words",
      letterCase: "lower",
    });
    const sentence = amountInWords({
      ...withCurrency,
      cents: 2100,
      paraStyle: "words",
      letterCase: "sentence",
    });
    const upper = amountInWords({
      ...withCurrency,
      cents: 2100,
      paraStyle: "words",
      letterCase: "upper",
    });
    expect(fraction.ok && plain.ok && sentence.ok && upper.ok).toBe(true);
    if (!fraction.ok || !plain.ok || !sentence.ok || !upper.ok) return;
    expect(fraction.text).toBe("hiljadu dvesta trideset četiri dinara i 56/100");
    // „zarez" and then the digits ONE AT A TIME, which is the review clause and
    // not a change of mind: the earlier „i pedeset šest" spelled the subunits as
    // a number, and a number needs a noun to agree with — which is precisely
    // what plain mode does not have. „pedeset šest" reads as fifty-six of
    // something unnamed; „zarez pet šest" reads the decimal out, which is what a
    // person dictating a bare figure actually says.
    expect(plain.text).toBe("hiljadu dvesta trideset četiri zarez pet šest");
    expect(sentence.text).toBe("Dvadeset jedan dinar i nula para");
    expect(upper.text).toBe("DVADESET JEDAN DINAR I NULA PARA");
  });

  it("lets plain mode's bare whole number agree with a typed gender, not only masculine", () => {
    // cents = 2100 → whole = 21, subunits = 0, so the text is the whole
    // number alone (no „zarez" tail) — isolating exactly the digit that
    // agreement turns on. 21 → groupWords(21, g): „dvadeset" + unitWord(1, g).
    const masculine = amountInWords({
      mode: "plain",
      cents: 2100,
      paraStyle: "words",
      letterCase: "lower",
    });
    const feminine = amountInWords({
      mode: "plain",
      cents: 2100,
      paraStyle: "words",
      letterCase: "lower",
      plainGender: "feminine",
    });
    const neuter = amountInWords({
      mode: "plain",
      cents: 2100,
      paraStyle: "words",
      letterCase: "lower",
      plainGender: "neuter",
    });
    expect(masculine.ok && feminine.ok && neuter.ok).toBe(true);
    if (!masculine.ok || !feminine.ok || !neuter.ok) return;
    // Omitted `plainGender` defaults to masculine, unchanged from before the
    // input existed: unitWord(1, "masculine") is „jedan".
    expect(masculine.text).toBe("dvadeset jedan");
    expect(feminine.text).toBe("dvadeset jedna");
    expect(neuter.text).toBe("dvadeset jedno");
  });

  it("refuses anything that is not a whole number of minor units inside the range", () => {
    const base = { ...withCurrency, paraStyle: "words", letterCase: "lower" } as const;
    expect(amountInWords({ ...base, cents: 1.5 })).toEqual({ ok: false, reason: "cents" });
    // 999.999.999.999,99 is the largest amount `words` covers: one para more
    // needs a scale word above „milijarda" that the table does not have.
    expect(amountInWords({ ...base, cents: 100_000_000_000_000 })).toEqual({
      ok: false,
      reason: "cents",
    });
  });

  it("refuses `withCurrency` mode missing any of the four noun/gender fields", () => {
    expect(
      amountInWords({
        mode: "withCurrency",
        cents: 100,
        paraStyle: "words",
        letterCase: "lower",
      }),
    ).toEqual({ ok: false, reason: "currency" });
    expect(
      amountInWords({
        mode: "withCurrency",
        currency: DINAR,
        cents: 100,
        paraStyle: "words",
        letterCase: "lower",
      }),
    ).toEqual({ ok: false, reason: "currencyGender" });
    expect(
      amountInWords({
        mode: "withCurrency",
        currency: DINAR,
        currencyGender: "masculine",
        cents: 100,
        paraStyle: "words",
        letterCase: "lower",
      }),
    ).toEqual({ ok: false, reason: "subunit" });
    expect(
      amountInWords({
        mode: "withCurrency",
        currency: DINAR,
        currencyGender: "masculine",
        subunit: PARA,
        cents: 100,
        paraStyle: "words",
        letterCase: "lower",
      }),
    ).toEqual({ ok: false, reason: "subunitGender" });
  });
});

describe("domesticAccountCheck", () => {
  it("computes the check digits of 160 + 0000000123456 as 54", () => {
    const result = domesticAccountCheck({
      bank: "160",
      partyNumber: "0000000123456",
      mode: "compute",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // N mod 97, digit by digit: 1, 16, 63, 48, 92, 47, 82, 44, 52, 35, 60, 20,
    // 9, 94, 72, 47. Then (47·100) mod 97 = 4700 − 97·48 = 44, so K = 98 − 44 = 54.
    expect(result.checkDigits).toBe("54");
    expect(result.formatted).toBe("160-0000000123456-54");
    // (4700 + 54) mod 97 = 4754 − 97·49 = 1
    expect(result.remainder).toBe(1);
    expect(result.matches).toBeUndefined();
  });

  it("pads a short party number within its own field, never joined with the bank", () => {
    // "160" + "123456" padded TOGETHER would be "0000000160123456" — wrong.
    // Padded separately it is "160" + "0000000123456", the same base as above.
    const result = domesticAccountCheck({ bank: "160", partyNumber: "123456", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account).toBe("0000000123456");
    expect(result.checkDigits).toBe("54");
  });

  it("verifies a whole account and names the mismatch without repairing it", () => {
    const good = domesticAccountCheck({
      bank: "160",
      partyNumber: "0000000123456",
      checkDigits: "54",
      mode: "verify",
    });
    const bad = domesticAccountCheck({
      bank: "160",
      partyNumber: "0000000123456",
      checkDigits: "55",
      mode: "verify",
    });
    expect(good.ok && bad.ok).toBe(true);
    if (!good.ok || !bad.ok) return;
    expect(good.matches).toBe(true);
    expect(good.remainder).toBe(1);
    expect(good.bank).toBe("160");
    expect(good.account).toBe("0000000123456");
    expect(bad.matches).toBe(false);
    expect(bad.givenCheckDigits).toBe("55");
    expect(bad.checkDigits).toBe("54");
    // Continuing the digit-by-digit remainder from 47 with '5' then '5':
    // (47·10+5)%97 = 475%97 = 87; (87·10+5)%97 = 875%97 = 2.
    expect(bad.remainder).toBe(2);
  });

  it("refuses a malformed bank, party number or check digits rather than padding it", () => {
    expect(
      domesticAccountCheck({ bank: "16", partyNumber: "0000000123456", mode: "compute" }),
    ).toEqual({ ok: false, reason: "bank" });
    expect(
      domesticAccountCheck({ bank: "160", partyNumber: "12345678901234", mode: "compute" }),
    ).toEqual({ ok: false, reason: "partyNumber" });
    expect(
      domesticAccountCheck({ bank: "160", partyNumber: "000000012345X", mode: "compute" }),
    ).toEqual({ ok: false, reason: "partyNumber" });
    expect(
      domesticAccountCheck({ bank: "160", partyNumber: "0000000123456", mode: "verify" }),
    ).toEqual({ ok: false, reason: "checkDigits" });
    expect(
      domesticAccountCheck({
        bank: "160",
        partyNumber: "0000000123456",
        checkDigits: "5X",
        mode: "verify",
      }),
    ).toEqual({ ok: false, reason: "checkDigits" });
  });
});

describe("ibanCheck", () => {
  it("passes the MOD 97-10 test on GB82WEST12345698765432", () => {
    const result = ibanCheck({ value: "GB82 WEST 1234 5698 7654 32", mode: "verify" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rearranged to WEST12345698765432GB82 and mapped (W=32, E=14, S=28, T=29,
    // G=16, B=11) the digit string is 3214282912345698765432161182, whose
    // running remainder ends at 1.
    expect(result.matches).toBe(true);
    expect(result.remainder).toBe(1);
    expect(result.checkDigits).toBe("82");
    expect(result.countryCode).toBe("GB");
    expect(result.formatted).toBe("GB82 WEST 1234 5698 7654 32");
  });

  it("leaves a remainder of 28 when the last digit is a 3 instead of a 2", () => {
    const result = ibanCheck({ value: "gb82west12345698765433", mode: "verify" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // In the rearranged string the changed digit has six digits after it
    // (G=16, B=11, then 8 and 2 → 161182), so the remainder moves by
    // 1·10^6 mod 97. 10^2 ≡ 3, 10^4 ≡ 9, 10^6 ≡ 27 (mod 97), so 1 + 27 = 28.
    expect(result.remainder).toBe(28);
    expect(result.matches).toBe(false);
    // `checkDigits` is recomputed from the BBAN AS GIVEN, typo included — it is
    // NOT the original "82" repeated. The correct check digits for
    // ...765432GB00 have remainder R0 = 98 − 82 = 16; the typo (2 → 3) sits six
    // digits before the end of the mod-97 string (same position as above), so
    // R_new = (16 + 27) mod 97 = 43, and K = 98 − 43 = 55.
    expect(result.checkDigits).toBe("55");
  });

  it("computes the RS check digits from a domestic account as the BBAN", () => {
    const result = ibanCheck({ value: "RS160000000012345654", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The BBAN is itself MOD 97-10 consistent, so after its 18 digits the
    // remainder is 1; then R = 27 → 12, 30; S = 28 → 11, 21; and the two
    // zeroes → 16, 63. K = 98 − 63 = 35.
    expect(result.checkDigits).toBe("35");
    expect(result.remainder).toBe(63);
    expect(result.iban).toBe("RS35160000000012345654");
    expect(result.formatted).toBe("RS35 1600 0000 0012 3456 54");
    // And the computed IBAN passes its own test.
    const verified = ibanCheck({ value: result.iban, mode: "verify" });
    expect(verified.ok && verified.matches).toBe(true);
  });

  it("applies only the 5-34 length of ISO 13616 and refuses a stray character", () => {
    expect(ibanCheck({ value: "GB8", mode: "verify" })).toEqual({ ok: false, reason: "length" });
    expect(ibanCheck({ value: "GB82WEST*2345698765432", mode: "verify" })).toEqual({
      ok: false,
      reason: "iban",
    });
    // Two digits where the country code belongs: the rearrangement is meaningless.
    expect(ibanCheck({ value: "1282WEST12345698765432", mode: "verify" })).toEqual({
      ok: false,
      reason: "iban",
    });
    // 33 characters of BBAN would make a 35-character IBAN, past the standard's own bound.
    expect(
      ibanCheck({ value: `RS${"1".repeat(33)}`, mode: "compute" }),
    ).toEqual({ ok: false, reason: "length" });
  });

  it("names a Cyrillic look-alike instead of refusing it as a generic stray character", () => {
    // Cyrillic „Р" (U+0420) and „С" (U+0421) uppercase to themselves and read
    // identically to Latin „R"/„S" — the exact RS-account mix-up the clause
    // is about.
    expect(ibanCheck({ value: "РС35160000000012345654", mode: "verify" })).toEqual({
      ok: false,
      reason: "confusable",
    });
    // Latin B and Cyrillic В (U+0412) are likewise indistinguishable by eye.
    expect(ibanCheck({ value: "GВ82WEST12345698765432", mode: "compute" })).toEqual({
      ok: false,
      reason: "confusable",
    });
  });

  it("refuses a complete, already-valid IBAN pasted into the compute box", () => {
    // This exact string is the one the „computes the RS check digits" test
    // above builds and then re-verifies successfully (matches: true) — so
    // feeding it BACK into compute mode is exactly the mistake the guard
    // exists for: silently mis-slicing it would move the true BBAN two
    // characters and hand back a DIFFERENT, equally plausible-looking IBAN.
    expect(
      ibanCheck({ value: "RS35160000000012345654", mode: "compute" }),
    ).toEqual({ ok: false, reason: "alreadyIban" });
    // Likewise the GB vector the very first test above verifies successfully.
    expect(
      ibanCheck({ value: "GB82WEST12345698765432", mode: "compute" }),
    ).toEqual({ ok: false, reason: "alreadyIban" });
    // The ORIGINAL compute-mode input (country + pure BBAN, no check digits)
    // must still work exactly as before: interpreted as a probe IBAN its
    // remainder is 67, not 1, so it is not mistaken for an already-complete one.
    const stillWorks = ibanCheck({ value: "RS160000000012345654", mode: "compute" });
    expect(stillWorks.ok).toBe(true);
    if (!stillWorks.ok) return;
    expect(stillWorks.checkDigits).toBe("35");
  });
});

describe("benfordDigits", () => {
  it("computes the expected proportions from log10 and lands the chi-square on 3.615", () => {
    const result = benfordDigits({
      text: "1;2;3;4;5;6;7;8;9",
      test: "first",
      negatives: "absolute",
      separator: "comma",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usable).toBe(9);
    expect(result.skipped).toBe(0);
    expect(result.degreesOfFreedom).toBe(8);
    // p_1 = log10 2 = 0.301030, p_9 = log10(10/9) = 0.045757, and the product of
    // all (1 + 1/d) telescopes to 10, so the nine shares sum to exactly 1.
    expect(result.rows[0]?.expectedShare).toBeCloseTo(0.301030, 6);
    expect(result.rows[8]?.expectedShare).toBeCloseTo(0.045757, 6);
    expect(result.rows.reduce((sum, row) => sum + row.expectedShare, 0)).toBeCloseTo(1, 12);
    // The percent forms are returned rather than multiplied on the surface,
    // which had written `100 * row.observedShare` at four places.
    expect(result.rows[0]?.expectedSharePercent).toBeCloseTo(30.1030, 4);
    expect(result.rows[8]?.expectedSharePercent).toBeCloseTo(4.5757, 4);
    for (const row of result.rows) {
      expect(row.observedSharePercent).toBeCloseTo(row.observedShare * 100, 12);
      expect(row.differencePercent).toBeCloseTo(row.difference * 100, 12);
    }
    // e_1 = 9 × 0.301030 = 2.70927, e_9 = 9 × 0.045757 = 0.41182
    expect(result.rows[0]?.expected).toBeCloseTo(2.70927, 5);
    expect(result.minExpected).toBeCloseTo(0.411817, 6);
    // (1−e)²/e per digit, e_d = 9·p_d: 1.078373 + 0.215807 + 0.013773 +
    // 0.018729 + 0.115882 + 0.262214 + 0.437902 + 0.632526 + 0.840078 =
    // 3.615284, agreeing with the double-precision figure to 5 places.
    expect(result.chiSquare).toBeCloseTo(3.615285, 5);
  });

  it("averages the nine absolute deviations into a MAD of 0.059717", () => {
    const result = benfordDigits({
      text: "1\n2\n3\n4\n5\n6\n7\n8\n9",
      test: "first",
      negatives: "absolute",
      separator: "comma",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // |1/9 − p_d|: 0.189919 + 0.064980 + 0.013828 + 0.014201 + 0.031930 +
    // 0.044164 + 0.053119 + 0.059959 + 0.065354 = 0.537454; / 9 = 0.059717
    expect(result.mad).toBeCloseTo(0.059717, 6);
    // z_1 = (0.189919 − 1/18) / sqrt(0.301030 × 0.698970 / 9)
    //     = 0.134363 / 0.152902 = 0.87876
    expect(result.rows[0]?.z).toBeCloseTo(0.87876, 4);
  });

  it("counts the zeroes and the rows that do not parse instead of dropping them quietly", () => {
    const result = benfordDigits({
      text: "0;-250;abc;19,90",
      test: "first",
      negatives: "absolute",
      separator: "comma",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A zero has no leading non-zero digit and „abc" is not a number: two
    // skipped. |−250| → 2 and 19,90 → 1, so N = 2.
    expect(result.usable).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.rows[0]?.observed).toBe(1);
    expect(result.rows[1]?.observed).toBe(1);
    // The smallest expected frequency is 2 × 0.045757 = 0.09151, and it is
    // reported as such rather than turned into a warning.
    expect(result.minExpected).toBeCloseTo(0.091515, 6);
  });

  it("takes the digits from the text, so 999,9999 leads with a 9 and not a 1", () => {
    const result = benfordDigits({
      text: "999,9999",
      test: "firstTwo",
      negatives: "absolute",
      separator: "comma",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(90);
    expect(result.degreesOfFreedom).toBe(89);
    expect(result.rows[0]?.digit).toBe(10);
    // 999.9999 → first two digits 99, the last row.
    expect(result.rows[89]?.observed).toBe(1);
    // 0.0507 → 5 then 0 → 50; a lone 9 is 9.0 → 90.
    const small = benfordDigits({
      text: "0,0507\n9",
      test: "firstTwo",
      negatives: "absolute",
      separator: "comma",
    });
    expect(small.ok).toBe(true);
    if (!small.ok) return;
    expect(small.rows.find((row) => row.digit === 50)?.observed).toBe(1);
    expect(small.rows.find((row) => row.digit === 90)?.observed).toBe(1);
  });

  it("drops negatives when asked to, and refuses when nothing is left to count", () => {
    const skipped = benfordDigits({
      text: "-250;19,90",
      test: "first",
      negatives: "skip",
      separator: "comma",
    });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.usable).toBe(1);
    expect(skipped.skipped).toBe(1);
    expect(
      benfordDigits({ text: "abc;0", test: "first", negatives: "absolute", separator: "comma" }),
    ).toEqual({ ok: false, reason: "values" });
    expect(
      benfordDigits({
        text: "1\n".repeat(100_001),
        test: "first",
        negatives: "absolute",
        separator: "comma",
      }),
    ).toEqual({ ok: false, reason: "tooManyRows" });
  });

  it("reads a dot as the decimal point when that is what was pasted", () => {
    const result = benfordDigits({
      text: "1,234.56",
      test: "first",
      negatives: "absolute",
      separator: "dot",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // With the dot as the decimal separator the comma is grouping, so this is
    // 1234.56 and its leading digit is 1 — not two unparsable fragments.
    expect(result.usable).toBe(1);
    expect(result.rows[0]?.observed).toBe(1);
  });
});

describe("breakevenPoint", () => {
  it("divides the fixed cost by the contribution — 500.000 / 400 = 1.250 units", () => {
    const result = breakevenPoint({
      fixedCost: 500_000,
      price: 1000,
      variableCost: 600,
      targetProfit: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // MP = 1000 − 600 = 400; mp = 400/1000 = 0.40
    expect(result.contributionMargin).toBe(400);
    expect(result.contributionMarginPercent).toBe(40);
    // Q0 = 500000/400 = 1250; R0 = 500000/0.40 = 1250000 = 1250 × 1000
    expect(result.breakevenUnits).toBe(1250);
    expect(result.breakevenUnitsWhole).toBe(1250);
    expect(result.breakevenRevenue).toBe(1_250_000);
    // 1250 (already whole) × 1000 = 1.250.000, same figure here since Q0 has no fraction.
    expect(result.breakevenRevenueAtWholeUnits).toBe(1_250_000);
    expect(result.marginOfSafetyPercent).toBeUndefined();
    expect(result.operatingLeverage).toBeUndefined();
    // A structural fact about this function (single product, no sales-mix
    // input), not a computed result — present so a surface has a field in the
    // TYPE to hang its own caveat text on. See the function's own doc comment.
    expect(result.assumesSingleProduct).toBe(true);
  });

  it("adds the target profit to the fixed cost before dividing", () => {
    const result = breakevenPoint({
      fixedCost: 500_000,
      price: 1000,
      variableCost: 600,
      targetProfit: 200_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Qd = (500000 + 200000)/400 = 1750; Rd = 700000/0.40 = 1750000
    expect(result.targetUnits).toBe(1750);
    expect(result.targetRevenue).toBe(1_750_000);
  });

  it("shows the whole-unit revenue diverging from the exact one when the volume isn't whole", () => {
    const result = breakevenPoint({
      fixedCost: 100_000,
      price: 1000,
      variableCost: 700,
      targetProfit: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Q0 = 100000/300 = 333.333…, rounded UP to 334 sellable units.
    expect(result.breakevenUnits).toBeCloseTo(333.333333, 6);
    expect(result.breakevenUnitsWhole).toBe(334);
    // Exact revenue at the exact threshold: 100000/(300/1000) = 333333.333…
    expect(result.breakevenRevenue).toBeCloseTo(333333.333333, 3);
    // 334 × 1000 = 334.000 — a different, larger figure than the exact one.
    expect(result.breakevenRevenueAtWholeUnits).toBe(334_000);
  });

  it("computes the margin of safety and the operating leverage at a planned volume", () => {
    const result = breakevenPoint({
      fixedCost: 500_000,
      price: 1000,
      variableCost: 600,
      targetProfit: 0,
      plannedVolume: 2000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // MS = 100 × (2000 − 1250)/2000 = 37.5%
    expect(result.marginOfSafetyPercent).toBe(37.5);
    // DOL = 2000×400 / (800000 − 500000) = 800000/300000 = 2.666667
    expect(result.operatingLeverage).toBeCloseTo(2.666667, 6);
  });

  it("has no break-even at all when the contribution is zero, and says so", () => {
    expect(
      breakevenPoint({ fixedCost: 100_000, price: 500, variableCost: 500, targetProfit: 0 }),
    ).toEqual({ ok: false, reason: "contribution" });
  });

  it("puts the break-even at zero when there is no fixed cost, and the leverage at 1", () => {
    const result = breakevenPoint({
      fixedCost: 0,
      price: 1000,
      variableCost: 600,
      targetProfit: 0,
      plannedVolume: 2000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.breakevenUnits).toBe(0);
    expect(result.breakevenRevenue).toBe(0);
    // DOL = 800000/(800000 − 0) = 1: with no fixed cost profit grows with volume.
    expect(result.operatingLeverage).toBe(1);
  });

  it("refuses each missing or impossible input by name", () => {
    const base = { fixedCost: 1000, price: 100, variableCost: 60, targetProfit: 0 };
    expect(breakevenPoint({ ...base, fixedCost: -1 })).toEqual({ ok: false, reason: "fixedCost" });
    expect(breakevenPoint({ ...base, price: 0 })).toEqual({ ok: false, reason: "price" });
    expect(breakevenPoint({ ...base, variableCost: Number.NaN })).toEqual({
      ok: false,
      reason: "variableCost",
    });
    expect(breakevenPoint({ ...base, targetProfit: -1 })).toEqual({
      ok: false,
      reason: "targetProfit",
    });
    expect(breakevenPoint({ ...base, plannedVolume: 0 })).toEqual({
      ok: false,
      reason: "plannedVolume",
    });
  });
});

describe("identifierCheckDigit", () => {
  it("computes the PIB check digit of 10405213 as 5", () => {
    const result = identifierCheckDigit({ value: "10405213", kind: "pib", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // p = 10; 1 → s=1, p=2; 0 → s=2, p=4; 4 → s=8, p=16 mod 11=5; 0 → s=5,
    // p=10; 5 → s=(10+5) mod 10=5, p=10; 2 → s=2, p=4; 1 → s=5, p=10;
    // 3 → s=3, p=6. k = (11 − 6) mod 10 = 5.
    expect(result.computed).toBe(5);
    expect(result.corrected).toBe("104052135");
    expect(result.matches).toBeUndefined();
  });

  it("computes the matični broj check digit of 1234567 as 2", () => {
    const result = identifierCheckDigit({ value: "1234567", kind: "maticni", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // p=10; 1 → s=1, p=2; 2 → s=4, p=8; 3 → s=1, p=2; 4 → s=6, p=12 mod 11=1;
    // 5 → s=6, p=1; 6 → s=7, p=14 mod 11=3; 7 → s=(3+7) mod 10=0 → 10,
    // p=20 mod 11=9. k = (11 − 9) mod 10 = 2.
    expect(result.computed).toBe(2);
    expect(result.corrected).toBe("12345672");
  });

  it("goes through the s = 0 → s = 10 branch on 10000000", () => {
    const result = identifierCheckDigit({ value: "100000008", kind: "pib", mode: "verify" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // p=10; 1 → s=1, p=2; 0 → s=2, p=4; 0 → s=4, p=8; 0 → s=8, p=16 mod 11=5;
    // 0 → s=5, p=10; 0 → s=0 → 10, p=20 mod 11=9; 0 → s=9, p=18 mod 11=7;
    // 0 → s=7, p=14 mod 11=3. k = (11 − 3) mod 10 = 8.
    expect(result.computed).toBe(8);
    expect(result.given).toBe(8);
    expect(result.matches).toBe(true);
  });

  it("computes a JMBG check digit by the 7,6,5,4,3,2 weights", () => {
    const result = identifierCheckDigit({ value: "010199071001", kind: "jmbg", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 7(0+0)=0; 6(1+7)=48; 5(0+1)=5; 4(1+0)=4; 3(9+0)=27; 2(9+1)=20 → S = 104.
    // 104 mod 11 = 5 (99 = 9·11), so m = 11 − 5 = 6.
    expect(result.computed).toBe(6);
    expect(result.corrected).toBe("0101990710016");
    expect(result.jmbgRawRemainder).toBe(6);
    expect(result.jmbgTenBranch).toBe(false);
  });

  it("turns m > 9 into 0, which is the branch a naive implementation prints as 11", () => {
    const result = identifierCheckDigit({ value: "010199071004", kind: "jmbg", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The last pair is 2(9+4) = 26 instead of 20, so S = 110, 110 mod 11 = 0
    // and m = 11 − 0 = 11 > 9 → 0.
    expect(result.computed).toBe(0);
    expect(result.corrected).toBe("0101990710040");
    // Raw is exposed as 11, not folded, and this is NOT the m == 10 case.
    expect(result.jmbgRawRemainder).toBe(11);
    expect(result.jmbgTenBranch).toBe(false);
  });

  it("distinguishes the m == 10 branch from m == 11 — both fold to 0, but only one is flagged", () => {
    // Same base as above with d10 (weight-3 pair, index 10) changed 0 → 6:
    // 7(0+0)=0; 6(1+7)=48; 5(0+1)=5; 4(1+0)=4; 3(9+6)=45; 2(9+1)=20 → S = 122.
    // 122 mod 11 = 1 (121 = 11·11), so m = 11 − 1 = 10 → folds to 0, but this
    // IS the m == 10 case that jmbgTenBranch exists to distinguish from m == 11.
    const result = identifierCheckDigit({ value: "010199071061", kind: "jmbg", mode: "compute" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.computed).toBe(0);
    expect(result.jmbgRawRemainder).toBe(10);
    expect(result.jmbgTenBranch).toBe(true);
  });

  it("shows both digits on a mismatch instead of correcting the number", () => {
    const result = identifierCheckDigit({ value: "104052136", kind: "pib", mode: "verify" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.given).toBe(6);
    expect(result.computed).toBe(5);
    expect(result.matches).toBe(false);
  });

  it("refuses a wrong length or a non-digit instead of padding or trimming", () => {
    expect(identifierCheckDigit({ value: "10405213", kind: "pib", mode: "verify" })).toEqual({
      ok: false,
      reason: "length",
    });
    expect(identifierCheckDigit({ value: "01019907100", kind: "jmbg", mode: "compute" })).toEqual({
      ok: false,
      reason: "length",
    });
    expect(identifierCheckDigit({ value: "1040521X", kind: "pib", mode: "compute" })).toEqual({
      ok: false,
      reason: "value",
    });
  });
});

describe("depreciationSchedule", () => {
  const straight = {
    cost: 1_200_000,
    residual: 200_000,
    usefulLife: 5,
    proration: "none",
  } as const;

  it("writes off equal amounts on the straight line and closes on the residual", () => {
    const plan = depreciationSchedule({ ...straight, method: "linear" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // (1200000 − 200000)/5 = 200000 a year
    expect(plan.rows.map((row) => row.charge)).toEqual([
      200_000, 200_000, 200_000, 200_000, 200_000,
    ]);
    expect(plan.rows[2]?.accumulated).toBe(600_000);
    expect(plan.rows[2]?.closingBookValue).toBe(600_000);
    expect(plan.rows[4]?.closingBookValue).toBe(200_000);
    expect(plan.writtenOff).toBe(1_000_000);
  });

  it("carries the SYD rounding difference into the last year", () => {
    const plan = depreciationSchedule({ ...straight, method: "syd" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // SYD = 5·6/2 = 15; 1000000 × 5/15 = 333333.33, × 4/15 = 266666.67,
    // × 3/15 = 200000.00, × 2/15 = 133333.33 — sum 933333.33, so the fifth
    // year takes 1000000 − 933333.33 = 66666.67 (nominally 1/15).
    expect(plan.rows.map((row) => row.charge)).toEqual([
      333_333.33, 266_666.67, 200_000, 133_333.33, 66_666.67,
    ]);
    expect(plan.rows.reduce((sum, row) => sum + row.charge, 0)).toBeCloseTo(1_000_000, 6);
    expect(plan.rows[4]?.closingBookValue).toBe(200_000);
  });

  it("caps the declining charge so the book value never falls through the residual", () => {
    const plan = depreciationSchedule({
      ...straight,
      method: "declining",
      decliningFactor: 2,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // rate = 2/5 = 40%. 1200000×0.4 = 480000 (BV 720000); 288000 (BV 432000);
    // 172800 (BV 259200); year 4 would be 103680 but only 259200 − 200000 =
    // 59200 is left (BV 200000); year 5 is 0.
    expect(plan.rows.map((row) => row.charge)).toEqual([480_000, 288_000, 172_800, 59_200, 0]);
    expect(plan.rows[3]?.closingBookValue).toBe(200_000);
    // The basis of a declining row is the opening book value, not C − S.
    expect(plan.rows[1]?.basis).toBe(720_000);
    expect(plan.rows[1]?.openingBookValue).toBe(720_000);
  });

  it("uses displayYears, not usefulLife, to size a declining plan whose cap never binds", () => {
    const plan = depreciationSchedule({
      cost: 1_200_000,
      residual: 0,
      usefulLife: 5,
      method: "declining",
      decliningFactor: 1.5,
      displayYears: 8,
      proration: "none",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // rate = 1.5/5 = 30%; the cap (bookValue − residual) never binds, because
    // the residual is 0 and the rate is under 1, so this is a pure geometric
    // decline for all eight requested years: 1200000×0.3 = 360000 (BV
    // 840000); ×0.3 = 252000 (BV 588000); 176400 (BV 411600); 123480 (BV
    // 288120); 86436 (BV 201684); 60505.20 (BV 141178.80); 42353.64 (BV
    // 98825.16). The eighth year would be 29647.55 by the formula, but the
    // last row is forced to close the plan: 1200000 − (360000 + 252000 +
    // 176400 + 123480 + 86436 + 60505.20 + 42353.64) = 1200000 − 1101174.84 =
    // 98825.16 — which happens to equal the seventh year's own closing book
    // value, so the eighth row writes off exactly what was left.
    expect(plan.rows).toHaveLength(8);
    expect(plan.rows.map((row) => row.charge)).toEqual([
      360_000, 252_000, 176_400, 123_480, 86_436, 60_505.2, 42_353.64, 98_825.16,
    ]);
    // toBeCloseTo, not toBe: roundTo(0, 2) can land on −0 here (bookValue −
    // charge is a subtraction of two nearly-equal floats), and −0 is not
    // `Object.is`-equal to 0 though it is every other way.
    expect(plan.rows[7]?.closingBookValue).toBeCloseTo(0, 9);
    expect(plan.writtenOff).toBe(1_200_000);
  });

  it("refuses a displayYears outside 1..100 for the declining method", () => {
    expect(
      depreciationSchedule({
        cost: 1_200_000,
        residual: 0,
        usefulLife: 5,
        method: "declining",
        decliningFactor: 1.5,
        displayYears: 0,
        proration: "none",
      }),
    ).toEqual({ ok: false, reason: "displayYears" });
  });

  it("leaves the declining charges unforced when displayYears truncates below usefulLife", () => {
    // Same cost/usefulLife/factor as the eight-year vector above (rate = 30%),
    // but displayYears = 3 < usefulLife = 5: years 1-3 are 360.000, 252.000,
    // 176.400 — the pure declining formula, matching the first three years of
    // that same eight-year plan exactly. There are still two real years (4
    // and 5) of depreciation the caller chose not to print, so year 3 may NOT
    // absorb the untaken tail: 360000 + 252000 + 176400 = 788400, leaving
    // 1200000 − 788400 = 411600 of book value still on the books.
    const plan = depreciationSchedule({
      cost: 1_200_000,
      residual: 0,
      usefulLife: 5,
      method: "declining",
      decliningFactor: 1.5,
      displayYears: 3,
      proration: "none",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows.map((row) => row.charge)).toEqual([360_000, 252_000, 176_400]);
    expect(plan.rows[2]?.closingBookValue).toBe(411_600);
    expect(plan.writtenOff).toBe(788_400);
  });

  it("still closes the plan when displayYears reaches usefulLife exactly", () => {
    // Same inputs, displayYears = 5 = usefulLife: year 4 is 123480 (BV
    // 288120) and year 5 would be 86436 by the pure formula (BV 201684), but
    // AT usefulLife the last printed row IS the plan's own last row, so it
    // still absorbs whatever is left: 1200000 − (360000+252000+176400+123480)
    // = 1200000 − 911880 = 288120, not 86436 — and the plan closes to zero.
    const plan = depreciationSchedule({
      cost: 1_200_000,
      residual: 0,
      usefulLife: 5,
      method: "declining",
      decliningFactor: 1.5,
      displayYears: 5,
      proration: "none",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows.map((row) => row.charge)).toEqual([
      360_000, 252_000, 176_400, 123_480, 288_120,
    ]);
    expect(plan.rows[4]?.closingBookValue).toBeCloseTo(0, 9);
    expect(plan.writtenOff).toBe(1_200_000);
  });

  it("shortens the first year by whole months and opens a sixth year for the rest", () => {
    const plan = depreciationSchedule({
      cost: 1_200_000,
      residual: 0,
      usefulLife: 5,
      method: "linear",
      proration: "months",
      activation: { year: 2025, month: 4, day: 15 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Annual charge 240000; the month of activation counts whole, so the
    // factor is (13 − 4)/12 = 9/12 = 0.75 → 180000 for April–December 2025,
    // four full years, and 240000 × 3/12 = 60000 in 2030.
    expect(plan.firstYearFactor).toBe(0.75);
    expect(plan.rows.map((row) => row.charge)).toEqual([
      180_000, 240_000, 240_000, 240_000, 240_000, 60_000,
    ]);
    // 180000 + 960000 + 60000 = 1200000 over six calendar years for a
    // five-year life.
    expect(plan.rows.reduce((sum, row) => sum + row.charge, 0)).toBe(1_200_000);
    expect(plan.rows.map((row) => row.calendarYear)).toEqual([
      2025, 2026, 2027, 2028, 2029, 2030,
    ]);
  });

  it("counts the days to 31 December inclusive when the proportion is by day", () => {
    const plan = depreciationSchedule({
      cost: 1_200_000,
      residual: 0,
      usefulLife: 5,
      method: "linear",
      proration: "days",
      activation: { year: 2025, month: 4, day: 15 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 15 April 2025 is day 31 + 28 + 31 + 15 = 105 of a 365-day year, so
    // 365 − 105 + 1 = 261 days remain: 261/365 = 0.7150685.
    expect(plan.firstYearFactor).toBeCloseTo(0.715068, 6);
    // 240000 × 0.7150685 = 171616.44, and the sixth year takes the rest.
    expect(plan.rows[0]?.charge).toBe(171_616.44);
    expect(plan.rows[5]?.charge).toBe(68_383.56);
    expect(plan.rows.reduce((sum, row) => sum + row.charge, 0)).toBe(1_200_000);
  });

  it("depreciates by output, and leaves an unused capacity unwritten", () => {
    const full = depreciationSchedule({
      cost: 1_000_000,
      residual: 0,
      usefulLife: 3,
      method: "units",
      proration: "none",
      usage: [3000, 5000, 2000],
      capacity: 10_000,
    });
    const partial = depreciationSchedule({
      cost: 1_000_000,
      residual: 0,
      usefulLife: 3,
      method: "units",
      proration: "none",
      usage: [3000, 5000],
      capacity: 10_000,
    });
    expect(full.ok && partial.ok).toBe(true);
    if (!full.ok || !partial.ok) return;
    // 1000000 × 3000/10000 = 300000, × 5000/10000 = 500000, × 2000/10000 = 200000
    expect(full.rows.map((row) => row.charge)).toEqual([300_000, 500_000, 200_000]);
    // Eight thousand units of ten thousand: 800000 written off and 200000 of
    // book value left, because output and not time drives this method.
    expect(partial.writtenOff).toBe(800_000);
    expect(partial.rows[1]?.closingBookValue).toBe(200_000);
  });

  it("refuses each impossible input by name rather than scaling it back", () => {
    const base = {
      cost: 1_000_000,
      residual: 0,
      usefulLife: 5,
      proration: "none",
    } as const;
    expect(depreciationSchedule({ ...base, cost: 0, method: "linear" })).toEqual({
      ok: false,
      reason: "cost",
    });
    expect(depreciationSchedule({ ...base, residual: 1_000_001, method: "linear" })).toEqual({
      ok: false,
      reason: "residual",
    });
    expect(depreciationSchedule({ ...base, usefulLife: 0, method: "linear" })).toEqual({
      ok: false,
      reason: "usefulLife",
    });
    // f must be above 1: at 1 the declining method is the straight line.
    expect(depreciationSchedule({ ...base, method: "declining", decliningFactor: 1 })).toEqual({
      ok: false,
      reason: "decliningFactor",
    });
    expect(depreciationSchedule({ ...base, method: "declining" })).toEqual({
      ok: false,
      reason: "decliningFactor",
    });
    // More output than the asset was ever capable of is a typing error.
    expect(
      depreciationSchedule({
        ...base,
        method: "units",
        usage: [6000, 5000],
        capacity: 10_000,
      }),
    ).toEqual({ ok: false, reason: "usage" });
    expect(
      depreciationSchedule({ ...base, method: "units", usage: [1000], capacity: 0 }),
    ).toEqual({ ok: false, reason: "capacity" });
    expect(
      depreciationSchedule({
        ...base,
        method: "linear",
        proration: "months",
        activation: { year: 2025, month: 13, day: 1 },
      }),
    ).toEqual({ ok: false, reason: "activation" });
    expect(depreciationSchedule({ ...base, method: "linear", proration: "months" })).toEqual({
      ok: false,
      reason: "activation",
    });
    // `activation` also drives `calendarYear` when proration is "none" (it
    // just skips the first-year-factor math), so an invalid date must be
    // refused there too, not only when a proration mode requires the date.
    expect(
      depreciationSchedule({
        ...base,
        method: "linear",
        proration: "none",
        activation: { year: 2025, month: 13, day: 1 },
      }),
    ).toEqual({ ok: false, reason: "activation" });
  });
});

describe("financialRatios", () => {
  it("computes the three liquidity ratios and the working capital", () => {
    const result = financialRatios({
      currentAssets: 3_000_000,
      inventory: 1_200_000,
      cash: 300_000,
      currentLiabilities: 1_500_000,
      days: 365,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3000000/1500000 = 2.0; (3000000 − 1200000)/1500000 = 1.2;
    // 300000/1500000 = 0.2; 3000000 − 1500000 = 1500000
    expect(result.currentRatio).toBe(2);
    expect(result.quickRatio).toBe(1.2);
    expect(result.cashRatio).toBe(0.2);
    expect(result.workingCapital).toBe(1_500_000);
  });

  it("agrees with itself on days of inventory, both ways round", () => {
    const result = financialRatios({ inventory: 1_200_000, cogs: 7_300_000, days: 365 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 7300000/1200000 = 6.083333 and 365 × 1200000/7300000 = 438000000/7300000
    // = 60.0 exactly, which is also 365/6.083333.
    expect(result.inventoryTurnover).toBeCloseTo(6.083333, 6);
    expect(result.dio).toBeCloseTo(60, 10);
  });

  it("adds the cash conversion cycle out of its three days", () => {
    const result = financialRatios({
      inventory: 1_200_000,
      receivables: 1_000_000,
      payables: 900_000,
      revenue: 12_000_000,
      cogs: 7_300_000,
      days: 365,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // DSO = 1000000/12000000 × 365 = 30.4167; DPO = 900000/7300000 × 365 = 45.0
    expect(result.dso).toBeCloseTo(30.416667, 6);
    expect(result.dpo).toBeCloseTo(45, 10);
    // 60.0 + 30.4167 − 45.0 = 45.4167
    expect(result.cashConversionCycle).toBeCloseTo(45.416667, 6);
  });

  it("reproduces the DuPont identity: ROA = net margin × asset turnover", () => {
    const result = financialRatios({
      netProfit: 480_000,
      totalAssets: 6_000_000,
      equity: 2_400_000,
      revenue: 12_000_000,
      days: 365,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 480000/6000000 = 8%; 480000/2400000 = 20%; 480000/12000000 = 4%;
    // 12000000/6000000 = 2.0 — and 4% × 2 = 8%.
    expect(result.roaPercent).toBe(8);
    expect(result.roePercent).toBe(20);
    expect(result.netMarginPercent).toBe(4);
    expect(result.assetTurnover).toBe(2);
  });

  it("leaves a ratio empty when its position is missing or its denominator is zero", () => {
    const result = financialRatios({ ebit: 800_000, interestExpense: 0, days: 365 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No interest expense is not infinite cover — it is a question nobody asked.
    expect(result.interestCoverage).toBeUndefined();
    expect(result.currentRatio).toBeUndefined();
    expect(result.roaPercent).toBeUndefined();
  });

  it("uses the 360-day banking year when it is chosen, and refuses anything else", () => {
    const result = financialRatios({ receivables: 1_000_000, revenue: 12_000_000, days: 360 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000000/12000000 × 360 = 30.0 exactly, against 30.4167 on 365 days.
    expect(result.dso).toBeCloseTo(30, 10);
    expect(financialRatios({ days: 364 as 365 })).toEqual({ ok: false, reason: "days" });
  });
});

describe("fxDifference", () => {
  const origin = { year: 2026, month: 1, day: 15 };
  const settlement = { year: 2026, month: 2, day: 15 };

  it("names a rise on a receivable a gain", () => {
    const result = fxDifference({
      amount: 10_000,
      rateOrigin: 117.25,
      rateSettlement: 117.58,
      rateUnit: 1,
      side: "receivable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // V1 = 10000 × 117.25 = 1172500; V2 = 10000 × 117.58 = 1175800;
    // booked = 1175800 − 1172500 = 3300
    expect(result.valueOrigin).toBe(1_172_500);
    expect(result.valueSettlement).toBe(1_175_800);
    expect(result.bookedDifference).toBe(3300);
    // Both values are already exact to the cent, so the exact figure agrees:
    // 10000 × (117.58 − 117.25) = 10000 × 0.33 = 3300.
    expect(result.exactDifference).toBe(3300);
    expect(result.magnitude).toBe(3300);
    expect(result.effect).toBe("income");
    // 100 × 0.33/117.25 = 0.2814499%
    expect(result.rateChangePercent).toBeCloseTo(0.2814499, 6);
    expect(result.dateOrigin).toEqual(origin);
    expect(result.dateSettlement).toEqual(settlement);
  });

  it("names the identical arithmetic a loss when the item is a liability", () => {
    const result = fxDifference({
      amount: 10_000,
      rateOrigin: 117.25,
      rateSettlement: 117.58,
      rateUnit: 1,
      side: "payable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The same +3300, because a rising rate makes the debt larger.
    expect(result.bookedDifference).toBe(3300);
    expect(result.effect).toBe("expense");
  });

  it("turns the sign round when the rate falls on a receivable", () => {
    const result = fxDifference({
      amount: 5000,
      rateOrigin: 117.58,
      rateSettlement: 117.25,
      rateUnit: 1,
      side: "receivable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // booked = 5000 × (−0.33) = −1650; 100 × (−0.33)/117.58 = −0.28066%
    expect(result.bookedDifference).toBe(-1650);
    expect(result.magnitude).toBe(1650);
    expect(result.effect).toBe("expense");
    expect(result.rateChangePercent).toBeCloseTo(-0.28066, 5);
  });

  it("scales a rate quoted per 100 units of the foreign currency to the same answer", () => {
    // 11725/11758 per 100 units is the identical unit rate as 117.25/117.58 per
    // one — this is the transcription error `rateUnit` exists to prevent.
    const result = fxDifference({
      amount: 10_000,
      rateOrigin: 11725,
      rateSettlement: 11758,
      rateUnit: 100,
      side: "receivable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bookedDifference).toBe(3300);
  });

  it("books a different figure than the exact one under double rounding", () => {
    // V1 = round(3 × 100.0010, 2) = round(300.003, 2) = 300.00
    // V2 = round(3 × 100.0020, 2) = round(300.006, 2) = 300.01
    // booked = 300.01 − 300.00 = 0.01, yet the RAW difference rounds to 0.00:
    // exact = round(3 × 0.0010, 2) = round(0.003, 2) = 0.00 — a different number.
    const result = fxDifference({
      amount: 3,
      rateOrigin: 100.001,
      rateSettlement: 100.002,
      rateUnit: 1,
      side: "receivable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bookedDifference).toBe(0.01);
    expect(result.exactDifference).toBe(0);
    // `exactDifferenceRaw` is genuinely UNROUNDED, unlike `exactDifference`
    // above: 3 × (100.002 − 100.001) = 3 × 0.001 = 0.003, not the 0.00 that
    // rounding it to `amountDecimals` would print.
    expect(result.exactDifferenceRaw).toBeCloseTo(0.003, 9);
  });

  it("gives zeroes for a zero amount instead of dividing by anything", () => {
    const result = fxDifference({
      amount: 0,
      rateOrigin: 117.25,
      rateSettlement: 117.58,
      rateUnit: 1,
      side: "receivable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bookedDifference).toBe(0);
    expect(result.effect).toBe("none");
  });

  it("refuses a bad rate, unit, amount, decimals or date rather than inventing one", () => {
    const base = {
      amount: 100,
      rateOrigin: 117.25,
      rateSettlement: 117.58,
      rateUnit: 1,
      side: "receivable",
      amountDecimals: 2,
      dateOrigin: origin,
      dateSettlement: settlement,
    } as const;
    expect(fxDifference({ ...base, rateOrigin: 0 })).toEqual({ ok: false, reason: "rateOrigin" });
    expect(fxDifference({ ...base, rateSettlement: -1 })).toEqual({
      ok: false,
      reason: "rateSettlement",
    });
    expect(fxDifference({ ...base, rateUnit: 7 as 1 })).toEqual({ ok: false, reason: "rateUnit" });
    expect(fxDifference({ ...base, amount: Number.NaN })).toEqual({ ok: false, reason: "amount" });
    expect(fxDifference({ ...base, amountDecimals: 5 })).toEqual({
      ok: false,
      reason: "amountDecimals",
    });
    expect(fxDifference({ ...base, dateOrigin: { year: 2026, month: 2, day: 30 } })).toEqual({
      ok: false,
      reason: "dateOrigin",
    });
  });
});

describe("crossRate", () => {
  it("divides two quotes that share a base", () => {
    const result = crossRate({
      rateAB: 117.25,
      rateSecond: 108.5,
      direction: "sameBase",
      rateDecimals: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // EUR/RSD 117.25 ÷ USD/RSD 108.50 = 1.0806451…, and 108.50 × 1.0806452 =
    // 117.25 back again.
    expect(result.rate).toBe(1.080645);
  });

  it("multiplies when the second quote is written the other way round", () => {
    const result = crossRate({
      rateAB: 117.25,
      rateSecond: 1 / 108.5,
      direction: "inverse",
      rateDecimals: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (A/B) × (B/C) is the same cross rate through the other door.
    expect(result.rate).toBe(1.080645);
  });

  it("refuses a non-positive rate", () => {
    expect(
      crossRate({ rateAB: 0, rateSecond: 108.5, direction: "sameBase", rateDecimals: 6 }),
    ).toEqual({ ok: false, reason: "rateAB" });
    expect(
      crossRate({ rateAB: 117.25, rateSecond: 0, direction: "sameBase", rateDecimals: 6 }),
    ).toEqual({ ok: false, reason: "rateSecond" });
    expect(
      crossRate({ rateAB: 117.25, rateSecond: 108.5, direction: "sameBase", rateDecimals: 7 }),
    ).toEqual({ ok: false, reason: "rateDecimals" });
  });
});

describe("grossFromNet", () => {
  it("solves model A above the non-taxable amount and returns the net unchanged", () => {
    const result = grossFromNet({
      net: 100_000,
      model: "A",
      taxPercent: 10,
      contributionPercent: 19.9,
      nonTaxable: 25_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (100000 − 0.10 × 25000)/(1 − 0.199 − 0.10) = 97500/0.701 = 139087.0185
    expect(result.gross).toBe(139_087.02);
    // 0.199 × 139087.0185 = 27678.3167; 0.10 × (139087.0185 − 25000) = 11408.7019
    expect(result.contributions).toBe(27_678.32);
    expect(result.tax).toBe(11_408.7);
    expect(result.taxBase).toBe(114_087.02);
    // 139087.0185 − 27678.3167 − 11408.7019 = 100000.00
    expect(result.netCheck).toBe(100_000);
    expect(result.totalCost).toBeUndefined();
  });

  it("takes the other branch when the closed formula lands below the non-taxable amount", () => {
    const result = grossFromNet({
      net: 20_000,
      model: "A",
      taxPercent: 10,
      contributionPercent: 10,
      nonTaxable: 25_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The taxed branch gives (20000 − 2500)/0.80 = 21875, which is under the
    // 25000 threshold — its own forward computation returns 19687.50, not
    // 20000, so it is rejected. The untaxed branch gives 20000/0.90 = 22222.22.
    expect(result.gross).toBe(22_222.22);
    expect(result.tax).toBe(0);
    expect(result.taxBase).toBe(0);
    expect(result.contributions).toBe(2222.22);
    expect(result.netCheck).toBe(20_000);
  });

  it("solves model B on the base net of standardised costs", () => {
    const result = grossFromNet({
      net: 80_000,
      model: "B",
      taxPercent: 10,
      contributionPercent: 10,
      standardCostPercent: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 80000/(1 − 0.20 × 0.80) = 80000/0.84 = 95238.0952
    expect(result.gross).toBe(95_238.1);
    // base = 95238.0952 × 0.80 = 76190.4762; 10% of it is 7619.05 twice over
    expect(result.taxBase).toBe(76_190.48);
    expect(result.tax).toBe(7619.05);
    expect(result.contributions).toBe(7619.05);
    // 95238.0952 − 15238.0952 = 80000.00
    expect(result.netCheck).toBe(80_000);
  });

  it("returns the net itself when every rate is zero", () => {
    const result = grossFromNet({
      net: 50_000,
      model: "A",
      taxPercent: 0,
      contributionPercent: 0,
      nonTaxable: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross).toBe(50_000);
    expect(result.tax).toBe(0);
    expect(result.contributions).toBe(0);
    expect(result.netCheck).toBe(50_000);
  });

  it("adds the payer's own contribution only when its rate was typed", () => {
    const result = grossFromNet({
      net: 100_000,
      model: "A",
      taxPercent: 10,
      contributionPercent: 19.9,
      nonTaxable: 25_000,
      employerPercent: 17.9,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 139087.0185 × 1.179 = 139087.0185 + 24896.5763 = 163983.5949
    expect(result.totalCost).toBe(163_983.59);
  });

  it("refuses when the rates reach 100% instead of printing a negative gross", () => {
    expect(
      grossFromNet({
        net: 100_000,
        model: "A",
        taxPercent: 60,
        contributionPercent: 45,
        nonTaxable: 25_000,
      }),
    ).toEqual({ ok: false, reason: "rates" });
    // Model B: (10 + 90)% of a base that is the whole gross leaves nothing.
    expect(
      grossFromNet({
        net: 100_000,
        model: "B",
        taxPercent: 10,
        contributionPercent: 90,
        standardCostPercent: 0,
      }),
    ).toEqual({ ok: false, reason: "rates" });
  });

  it("refuses each missing input by name", () => {
    const base = { net: 100_000, model: "A", taxPercent: 10, contributionPercent: 10 } as const;
    expect(grossFromNet({ ...base, net: 0, nonTaxable: 0 })).toEqual({ ok: false, reason: "net" });
    expect(grossFromNet({ ...base, taxPercent: 101, nonTaxable: 0 })).toEqual({
      ok: false,
      reason: "taxPercent",
    });
    expect(grossFromNet({ ...base, contributionPercent: -1, nonTaxable: 0 })).toEqual({
      ok: false,
      reason: "contributionPercent",
    });
    expect(grossFromNet({ ...base })).toEqual({ ok: false, reason: "nonTaxable" });
    expect(grossFromNet({ ...base, model: "B" })).toEqual({
      ok: false,
      reason: "standardCostPercent",
    });
    expect(grossFromNet({ ...base, nonTaxable: 0, employerPercent: 101 })).toEqual({
      ok: false,
      reason: "employerPercent",
    });
  });
});

describe("interestByPeriods", () => {
  const basePeriod = {
    from: { year: 2025, month: 1, day: 1 },
    to: { year: 2025, month: 4, day: 1 },
    ratePercent: 10,
  };
  const quarter = [basePeriod];

  it("counts the days from inclusive to exclusive and divides by 365", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: quarter,
      dayCount: "act365",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 31 + 28 + 31 = 90 days (2025 is not a leap year); 90/365 = 0.246575
    expect(result.rows[0]?.days).toBe(90);
    expect(result.rows[0]?.dcf).toBeCloseTo(0.246575, 6);
    // 100000 × 0.10 × 90/365 = 900000/365 = 2465.7534
    expect(result.rows[0]?.interest).toBe(2465.75);
    expect(result.rows[0]?.basis).toBe(100_000);
    expect(result.totalInterestRows).toBe(2465.75);
    expect(result.totalInterestExact).toBe(2465.75);
    expect(result.totalDue).toBe(102_465.75);
    expect(result.earliestFrom).toEqual({ year: 2025, month: 1, day: 1 });
    expect(result.latestTo).toEqual({ year: 2025, month: 4, day: 1 });
    expect(result.overlapDays).toBe(0);
    expect(result.uncoveredDays).toBe(0);
    expect(result.maxPeriods).toBe(200);
  });

  it("gives the same period 2500.00 on ACT/360 — the difference is the whole choice", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: quarter,
      dayCount: "act360",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100000 × 0.10 × 90/360 = 2500.00 exactly, 34.25 above the ACT/365 figure.
    expect(result.totalInterestRows).toBe(2500);
  });

  it("adjusts both day numbers under 30/360 (bond)", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2025, month: 1, day: 31 },
          to: { year: 2025, month: 3, day: 31 },
          ratePercent: 12,
        },
      ],
      dayCount: "bond30360",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // D1 = 31 → 30; D2 = 31 and D1' = 30 → 30; days = 30 × (3 − 1) + 0 = 60
    expect(result.rows[0]?.days).toBe(60);
    // 100000 × 0.12 × 60/360 = 2000.00
    expect(result.totalInterestRows).toBe(2000);
  });

  it("separates 30/360 from 30E/360 by one day of the end month", () => {
    const period = [
      {
        from: { year: 2025, month: 2, day: 28 },
        to: { year: 2025, month: 5, day: 31 },
        ratePercent: 10,
      },
    ];
    const bond = interestByPeriods({
      principal: 100_000,
      periods: period,
      dayCount: "bond30360",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    const european = interestByPeriods({
      principal: 100_000,
      periods: period,
      dayCount: "euro30E360",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(bond.ok && european.ok).toBe(true);
    if (!bond.ok || !european.ok) return;
    // 30/360: D1 = 28 stays, so D2 = 31 stays too → 30 × 3 + (31 − 28) = 93.
    expect(bond.rows[0]?.days).toBe(93);
    // 30E/360: both are capped at 30 → 90 + (30 − 28) = 92.
    expect(european.rows[0]?.days).toBe(92);
  });

  it("splits an ACT/ACT period at 1 January, each part over its own year length", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2023, month: 11, day: 1 },
          to: { year: 2024, month: 2, day: 1 },
          ratePercent: 10,
        },
      ],
      dayCount: "actActIsda",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2023 part: 30 + 31 = 61 days over 365 = 0.167123; 2024 part: 31 days over
    // 366 (leap) = 0.084699; together 0.251823 over 92 actual days.
    expect(result.rows[0]?.days).toBe(92);
    expect(result.rows[0]?.dcf).toBeCloseTo(0.251823, 6);
    // 100000 × 0.10 × 0.2518227 = 2518.23, against 2520.55 on ACT/365.
    expect(result.totalInterestRows).toBe(2518.23);
  });

  it("compounds inside the period when the conformal method is chosen", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2025, month: 1, day: 1 },
          to: { year: 2025, month: 6, day: 30 },
          ratePercent: 10,
        },
      ],
      dayCount: "act360",
      method: "compound",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 31+28+31+30+31+29 = 180 days; 180/360 = 0.5; 100000 × (1.1^0.5 − 1) =
    // 100000 × 0.04880885 = 4880.88, where the simple method gives 5000.00.
    expect(result.rows[0]?.days).toBe(180);
    expect(result.totalInterestRows).toBe(4880.88);
  });

  it("adds several rows on the same principal, with no capitalisation between them", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2025, month: 1, day: 1 },
          to: { year: 2025, month: 4, day: 1 },
          ratePercent: 10,
        },
        {
          from: { year: 2025, month: 4, day: 1 },
          to: { year: 2025, month: 7, day: 1 },
          ratePercent: 12,
        },
      ],
      dayCount: "act365",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Second period: 30 + 31 + 30 = 91 days; 100000 × 0.12 × 91/365 =
    // 1092000/365 = 2991.7808. Total 2465.7534 + 2991.7808 = 5457.5342,
    // summed unrounded and rounded once.
    expect(result.rows[1]?.days).toBe(91);
    expect(result.rows[1]?.interest).toBe(2991.78);
    // capitalize is off, so the second row's basis is still the ORIGINAL principal.
    expect(result.rows[1]?.basis).toBe(100_000);
    expect(result.totalDays).toBe(181);
    expect(result.totalInterestRows).toBe(5457.53);
  });

  it("capitalizes so a year split in two rows lands on the same total as one row", () => {
    // Jan 1 → Jul 2, 2025 is 31+28+31+30+31+30+1 = 182 days; Jul 2 → Jan 1,
    // 2026 is the remaining 365 − 182 = 183. 182 + 183 = 365 days exactly, and
    // (1+r)^(182/365)·(1+r)^(183/365) = (1+r)^1 is an exact identity —
    // splitting the year costs nothing when capitalize is on, which is the
    // property this input exists to control.
    const split = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2025, month: 1, day: 1 },
          to: { year: 2025, month: 7, day: 2 },
          ratePercent: 10,
        },
        {
          from: { year: 2025, month: 7, day: 2 },
          to: { year: 2026, month: 1, day: 1 },
          ratePercent: 10,
        },
      ],
      dayCount: "act365",
      method: "compound",
      capitalize: true,
      decimals: 2,
    });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.totalDays).toBe(365);
    // 100000 × (1.10^1 − 1) = 10000.00 exactly, whichever way the year is cut.
    expect(split.totalInterestRows).toBeCloseTo(10000, 2);
    expect(split.totalDue).toBeCloseTo(110_000, 2);
    // The second row's basis grew past the original principal because the
    // first row's interest capitalised into it.
    expect(split.rows[1]?.basis).toBeGreaterThan(100_000);
    expect(split.rows[0]?.days).toBe(182);
    expect(split.rows[1]?.days).toBe(183);
  });

  it("reports a gap the periods leave uncovered, as a plain quantity", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2025, month: 1, day: 1 },
          to: { year: 2025, month: 2, day: 1 },
          ratePercent: 10,
        },
        {
          from: { year: 2025, month: 3, day: 1 },
          to: { year: 2025, month: 4, day: 1 },
          ratePercent: 10,
        },
      ],
      dayCount: "act365",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Jan1→Apr1 spans 90 days (31+28+31); the two rows cover 31+31 = 62 of
    // them, leaving February's 28 days (Feb1..Mar1) uncovered.
    expect(result.uncoveredDays).toBe(28);
    expect(result.overlapDays).toBe(0);
  });

  it("reports overlapping periods as double-counted real days, without repairing them", () => {
    const result = interestByPeriods({
      principal: 100_000,
      periods: [
        {
          from: { year: 2025, month: 1, day: 1 },
          to: { year: 2025, month: 2, day: 1 },
          ratePercent: 10,
        },
        {
          from: { year: 2025, month: 1, day: 15 },
          to: { year: 2025, month: 2, day: 15 },
          ratePercent: 10,
        },
      ],
      dayCount: "act365",
      method: "simple",
      capitalize: false,
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Each row is 31 real days (62 total); the union Jan1..Feb15 is 45 days,
    // so 62 − 45 = 17 days (Jan15..Feb1) are counted by both rows.
    expect(result.overlapDays).toBe(17);
    expect(result.uncoveredDays).toBe(0);
  });

  it("refuses a period that does not move forwards, and a rate outside the band", () => {
    expect(
      interestByPeriods({
        principal: 100_000,
        periods: [
          {
            from: { year: 2025, month: 4, day: 1 },
            to: { year: 2025, month: 4, day: 1 },
            ratePercent: 10,
          },
        ],
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "period" });
    expect(
      interestByPeriods({
        principal: 100_000,
        periods: [
          {
            from: { year: 2025, month: 2, day: 30 },
            to: { year: 2025, month: 4, day: 1 },
            ratePercent: 10,
          },
        ],
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "period" });
    expect(
      interestByPeriods({
        principal: 100_000,
        periods: [{ ...basePeriod, ratePercent: 1001 }],
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "ratePercent" });
    expect(
      interestByPeriods({
        principal: 100_000,
        periods: [{ ...basePeriod, ratePercent: -100 }],
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "ratePercent" });
    expect(
      interestByPeriods({
        principal: 0,
        periods: quarter,
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "principal" });
    expect(
      interestByPeriods({
        principal: 100_000,
        periods: [],
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "periods" });
    expect(
      interestByPeriods({
        principal: 100_000,
        periods: quarter,
        dayCount: "act365",
        method: "simple",
        capitalize: false,
        decimals: 7,
      }),
    ).toEqual({ ok: false, reason: "decimals" });
  });
});

describe("inventoryCosting", () => {
  it("splits the same purchases differently under FIFO and the moving average", () => {
    const result = inventoryCosting({
      openingQuantity: 0,
      openingUnitCost: 0,
      movements: [
        { type: "in", quantity: 100, unitCost: 100 },
        { type: "in", quantity: 100, unitCost: 120 },
        { type: "out", quantity: 150 },
      ],
      averageMode: "moving",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // FIFO: 100 × 100 + 50 × 120 = 10000 + 6000 = 16000; 50 units at 120 left.
    expect(result.fifo.costOfGoodsSold).toBe(16_000);
    expect(result.fifo.closingValue).toBe(6000);
    expect(result.fifo.closingQuantity).toBe(50);
    // Average: 22000/200 = 110; 150 × 110 = 16500; 50 × 110 = 5500.
    expect(result.average.costOfGoodsSold).toBe(16_500);
    expect(result.average.closingValue).toBe(5500);
    // The two differences are equal and opposite, because the purchases are the same.
    expect(result.costDifference).toBe(-500);
    expect(result.closingDifference).toBe(500);
    expect(result.purchaseValue).toBe(22_000);
  });

  it("re-averages after every receipt in the moving method", () => {
    const result = inventoryCosting({
      openingQuantity: 0,
      openingUnitCost: 0,
      movements: [
        { type: "in", quantity: 10, unitCost: 3 },
        { type: "out", quantity: 5 },
        { type: "in", quantity: 10, unitCost: 5 },
        { type: "out", quantity: 10 },
      ],
      averageMode: "moving",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // FIFO: 5 × 3 = 15, then the remaining 5 at 3 and 5 at 5 = 15 + 25 = 40;
    // total 55, leaving 5 at 5 = 25 (and 80 − 55 = 25 confirms it).
    expect(result.fifo.costOfGoodsSold).toBe(55);
    expect(result.fifo.closingValue).toBe(25);
    // A receipt is valued at what it actually cost, never an average — row 2
    // (the second IN) is valued at its own 5, not a recomputed blend.
    expect(result.average.rows[2]?.unitCost).toBe(5);
    // Moving: after the first issue Q = 5, V = 15; after the receipt Q = 15,
    // V = 65 → 4.333333 each — and it is the NEXT issue (row 3) that is valued
    // at that blended rate: 10 × 4.333333 = 43.3333; 15 + 43.3333 = 58.3333.
    expect(result.average.rows[3]?.unitCost).toBeCloseTo(4.333333, 6);
    expect(result.average.costOfGoodsSold).toBe(58.33);
    // 80 − 58.33 = 21.67, so the stock account closes to the para.
    expect(result.average.closingValue).toBe(21.67);
  });

  it("values every issue at one price in the periodic method", () => {
    const result = inventoryCosting({
      openingQuantity: 0,
      openingUnitCost: 0,
      movements: [
        { type: "in", quantity: 10, unitCost: 3 },
        { type: "out", quantity: 5 },
        { type: "in", quantity: 10, unitCost: 5 },
        { type: "out", quantity: 10 },
      ],
      averageMode: "periodic",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 80/20 = 4.00 for the whole period; (5 + 10) × 4 = 60; 80 − 60 = 20.
    expect(result.average.costOfGoodsSold).toBe(60);
    expect(result.average.closingValue).toBe(20);
    expect(result.average.closingQuantity).toBe(5);
  });

  it("carries an opening balance into both methods", () => {
    const result = inventoryCosting({
      openingQuantity: 100,
      openingUnitCost: 100,
      movements: [
        { type: "in", quantity: 100, unitCost: 120 },
        { type: "out", quantity: 150 },
      ],
      averageMode: "moving",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Identical to the first vector: an opening layer behaves as a first receipt.
    expect(result.fifo.costOfGoodsSold).toBe(16_000);
    expect(result.average.costOfGoodsSold).toBe(16_500);
  });

  it("rounds each issue's cost ONCE per issue, not once for the whole COGS", () => {
    const result = inventoryCosting({
      openingQuantity: 0,
      openingUnitCost: 0,
      movements: [
        { type: "in", quantity: 3, unitCost: 3.335 },
        { type: "out", quantity: 1 },
        { type: "out", quantity: 1 },
        { type: "out", quantity: 1 },
      ],
      averageMode: "moving",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Moving average stays exactly 3.335 for all three issues, because the
    // running balance is carried UNROUNDED between rows: 10.005/3 = 3.335,
    // then 6.67/2 = 3.335, then 3.335/1 = 3.335. Each 1-unit issue costs
    // 3.335, which rounds (half away from zero) to 3.34 — three times.
    // Summing the UNROUNDED issues first and rounding once would give
    // roundTo(3×3.335, 2) = roundTo(10.005, 2) = 10.01, one cent short of
    // what the three displayed rows actually add up to.
    expect(result.average.rows[1]?.value).toBeCloseTo(3.34, 6);
    expect(result.average.rows[2]?.value).toBeCloseTo(3.34, 6);
    expect(result.average.rows[3]?.value).toBeCloseTo(3.34, 6);
    expect(result.average.costOfGoodsSold).toBe(10.02);
    // purchaseValue (10.005) − COGS (10.02) closes the stock account to
    // −0.02: rounding three issues up by a third of a cent each overdraws the
    // account by two para, and the tool reports that honestly rather than
    // hiding it inside a single end-of-run rounding.
    expect(result.average.closingValue).toBeCloseTo(-0.02, 6);
  });

  it("refuses an issue larger than the stock rather than going negative", () => {
    expect(
      inventoryCosting({
        openingQuantity: 0,
        openingUnitCost: 0,
        movements: [
          { type: "in", quantity: 10, unitCost: 3 },
          { type: "out", quantity: 12 },
        ],
        averageMode: "moving",
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "movements" });
    expect(
      inventoryCosting({
        openingQuantity: 0,
        openingUnitCost: 0,
        movements: [{ type: "in", quantity: 0, unitCost: 3 }],
        averageMode: "moving",
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "movements" });
    expect(
      inventoryCosting({
        openingQuantity: 0,
        openingUnitCost: 0,
        movements: [{ type: "in", quantity: 10 }],
        averageMode: "moving",
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "unitCost" });
    expect(
      inventoryCosting({
        openingQuantity: -1,
        openingUnitCost: 0,
        movements: [],
        averageMode: "moving",
        decimals: 2,
      }),
    ).toEqual({ ok: false, reason: "openingQuantity" });
  });
});

describe("loanSchedule", () => {
  const base = {
    principal: 1_000_000,
    annualRatePercent: 12,
    instalments: 12,
    frequency: 12,
    rateMethod: "proportional",
    decimals: 2,
  } as const;

  it("computes the level instalment and splits the first one", () => {
    const result = loanSchedule({ ...base, plan: "annuity" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // i = 12/(100 × 12) = 0.01; 1.01^12 = 1.12682503, so 1.01^(−12) =
    // 0.88744923 and A = 10000/0.11255077 = 88848.7887.
    expect(result.periodicRate).toBeCloseTo(0.01, 12);
    // Returned, not multiplied on the surface — see `BenfordRow`.
    expect(result.periodicRatePercent).toBeCloseTo(1, 12);
    expect(result.annuity).toBe(88_848.79);
    // Row 1: interest 1000000 × 0.01 = 10000.00, principal 78848.79,
    // balance 921151.21.
    expect(result.rows[0]?.interest).toBe(10_000);
    expect(result.rows[0]?.principal).toBe(78_848.79);
    expect(result.rows[0]?.closingBalance).toBe(921_151.21);
    // The last instalment carries the rounding, so the debt closes at zero.
    expect(result.rows[11]?.closingBalance).toBe(0);
  });

  it("gives the last instalment of an equal-principal plan the four para", () => {
    const result = loanSchedule({ ...base, plan: "equalPrincipal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000000/12 = 83333.3333 → 83333.33 eleven times = 916666.63, so the
    // twelfth repays 1000000 − 916666.63 = 83333.37.
    expect(result.rows[0]?.principal).toBe(83_333.33);
    expect(result.rows[11]?.principal).toBe(83_333.37);
    expect(result.rows[11]?.closingBalance).toBe(0);
    // Instalment 1 = 83333.33 + 10000.00; balance 916666.67; instalment 2 =
    // 83333.33 + 9166.67 = 92500.00.
    expect(result.rows[0]?.payment).toBe(93_333.33);
    expect(result.rows[1]?.interest).toBe(9166.67);
    expect(result.rows[1]?.payment).toBe(92_500);
    // On unrounded principal the interest is i·P·(n+1)/2 = 0.01 × 1000000 ×
    // 6.5 = 65000, and the rounded rows still add to it.
    expect(result.totalInterest).toBe(65_000);
    expect(result.annuity).toBeUndefined();
  });

  it("takes the i = 0 branch instead of dividing by zero", () => {
    const result = loanSchedule({
      principal: 120_000,
      annualRatePercent: 0,
      instalments: 12,
      frequency: 12,
      plan: "annuity",
      rateMethod: "proportional",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A = P/n = 10000.00, no interest anywhere, 120000 paid in total.
    expect(result.annuity).toBe(10_000);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBe(120_000);
    expect(result.rows[5]?.closingBalance).toBe(60_000);
  });

  it("separates the conformal periodic rate from the proportional one", () => {
    const result = loanSchedule({ ...base, plan: "annuity", rateMethod: "conformal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // i = 1.12^(1/12) − 1 = 0.0094887929, so (1+i)^12 is exactly 1.12 and
    // (1+i)^(−12) = 1/1.12 = 0.8928571429; A = 9488.7929/0.1071428571 =
    // 88562.07 — 286.72 below the proportional instalment.
    expect(result.periodicRate).toBeCloseTo(0.00948879, 8);
    expect(result.annuity).toBe(88_562.07);
  });

  it("closes exactly to zero even with a small n and an awkward rate", () => {
    // Every other vector in this file uses a round million at 12% or 0% over
    // twelve monthly instalments, where the last-row correction is invisible
    // (the schedule would close cleanly even without it). A small n and a
    // rate that does not divide evenly is where accumulated rounding — and
    // the correction that cancels it — actually shows up.
    const result = loanSchedule({
      principal: 1_000,
      annualRatePercent: 7.3,
      instalments: 5,
      frequency: 12,
      plan: "annuity",
      rateMethod: "proportional",
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The two properties a schedule must have regardless of how awkward the
    // rate is: the printed payment column sums to exactly `totalPaid`, and
    // the debt is fully repaid rather than left a few para short or over.
    const paymentSum = result.rows.reduce((sum, row) => sum + row.payment, 0);
    expect(result.totalPaid).toBeCloseTo(paymentSum, 6);
    expect(result.rows[4]?.closingBalance).toBe(0);
    expect(result.totalPaid).toBeCloseTo(1_000 + result.totalInterest, 6);
  });

  it("refuses each input it cannot work with", () => {
    expect(loanSchedule({ ...base, plan: "annuity", principal: 0 })).toEqual({
      ok: false,
      reason: "principal",
    });
    expect(loanSchedule({ ...base, plan: "annuity", annualRatePercent: -1 })).toEqual({
      ok: false,
      reason: "annualRatePercent",
    });
    expect(loanSchedule({ ...base, plan: "annuity", instalments: 0 })).toEqual({
      ok: false,
      reason: "instalments",
    });
    expect(loanSchedule({ ...base, plan: "annuity", instalments: 601 })).toEqual({
      ok: false,
      reason: "instalments",
    });
    expect(loanSchedule({ ...base, plan: "annuity", frequency: 3 as 4 })).toEqual({
      ok: false,
      reason: "frequency",
    });
    expect(loanSchedule({ ...base, plan: "annuity", decimals: 5 })).toEqual({
      ok: false,
      reason: "decimals",
    });
  });
});

describe("rateConversion", () => {
  it("compounds 12% nominal at twelve times a year into 12.682503% effective", () => {
    const result = rateConversion({
      ratePercent: 12,
      kind: "nominal",
      compoundingsPerYear: 12,
      target: "month",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1.01^12 − 1 = 1.12682503 − 1
    expect(result.effectivePercent).toBeCloseTo(12.682503, 6);
    // r/k = 12/12 = 1.000000% a month
    expect(result.proportionalPeriodicPercent).toBeCloseTo(1, 6);
    // With m = k the conformal rate is the same 1%, which is the sanity check.
    expect(result.conformalPeriodicPercent).toBeCloseTo(1, 6);
    expect(result.nominalPercent).toBeCloseTo(12, 8);
  });

  it("turns 10% effective into 0.797414% a month, not 0.833333%", () => {
    const conformal = rateConversion({
      ratePercent: 10,
      kind: "effective",
      compoundingsPerYear: 12,
      target: "month",
    });
    const proportional = rateConversion({
      ratePercent: 10,
      kind: "nominal",
      compoundingsPerYear: 12,
      target: "month",
    });
    expect(conformal.ok && proportional.ok).toBe(true);
    if (!conformal.ok || !proportional.ok) return;
    // ln 1.1 = 0.09531018, /12 = 0.00794252, e^x = 1.00797414
    expect(conformal.conformalPeriodicPercent).toBeCloseTo(0.797414, 6);
    // 10/12 = 0.833333 — the 0.035919 point difference is the whole tool.
    expect(proportional.proportionalPeriodicPercent).toBeCloseTo(0.833333, 6);
  });

  it("keeps a yearly compounding rate at 12% effective and still gives a monthly rate", () => {
    const result = rateConversion({
      ratePercent: 12,
      kind: "nominal",
      compoundingsPerYear: 1,
      target: "month",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectivePercent).toBeCloseTo(12, 8);
    // ln 1.12 = 0.11332869, /12 = 0.00944406, e^x = 1.00948879
    expect(result.conformalPeriodicPercent).toBeCloseTo(0.948879, 6);
  });

  it("reports the continuous limit the compounding sequence never crosses", () => {
    const daily = rateConversion({
      ratePercent: 12,
      kind: "nominal",
      compoundingsPerYear: 365,
      target: "day",
    });
    const yearly = rateConversion({
      ratePercent: 12,
      kind: "nominal",
      compoundingsPerYear: 1,
      target: "year",
    });
    expect(daily.ok && yearly.ok).toBe(true);
    if (!daily.ok || !yearly.ok) return;
    // e^0.12 − 1 = 0.12749685
    expect(daily.continuousEffectivePercent).toBeCloseTo(12.749685, 6);
    // 12.000000 (m=1) < 12.682503 (m=12) < 12.747462 (m=365) < 12.749685
    expect(yearly.effectivePercent).toBeCloseTo(12, 8);
    expect(daily.effectivePercent).toBeCloseTo(12.747462, 6);
    expect(daily.effectivePercent).toBeLessThan(daily.continuousEffectivePercent);
  });

  it("reads a periodic rate as belonging to the target period", () => {
    const result = rateConversion({
      ratePercent: 1,
      kind: "periodic",
      compoundingsPerYear: 12,
      target: "month",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (1.01)^12 − 1 = 12.682503%, the same round trip as the first vector.
    expect(result.effectivePercent).toBeCloseTo(12.682503, 6);
    expect(result.periodsPerYear).toBe(12);
  });

  it("refuses a rate at or below −100% and a compounding count outside 1..365", () => {
    expect(
      rateConversion({
        ratePercent: -100,
        kind: "nominal",
        compoundingsPerYear: 12,
        target: "month",
      }),
    ).toEqual({ ok: false, reason: "ratePercent" });
    expect(
      rateConversion({ ratePercent: 12, kind: "nominal", compoundingsPerYear: 0, target: "month" }),
    ).toEqual({ ok: false, reason: "compoundingsPerYear" });
    expect(
      rateConversion({
        ratePercent: 12,
        kind: "nominal",
        compoundingsPerYear: 366,
        target: "month",
      }),
    ).toEqual({ ok: false, reason: "compoundingsPerYear" });
  });
});

describe("priceMargin", () => {
  it("turns a 20% margin on the price into a 25% mark-up on the cost", () => {
    const result = priceMargin({
      purchasePrice: 800,
      landedCosts: 0,
      pair: "costAndMarginOnPrice",
      marginOnPricePercent: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // P = 100 × 800/(100 − 20) = 80000/80 = 1000; difference 200;
    // 100 × 200/800 = 25%
    expect(result.sellingPrice).toBe(1000);
    expect(result.difference).toBe(200);
    expect(result.marginOnCostPercent).toBeCloseTo(25, 10);
  });

  it("goes the other way round from a 25% mark-up to a 20% margin", () => {
    const result = priceMargin({
      purchasePrice: 800,
      landedCosts: 0,
      pair: "costAndMarginOnCost",
      marginOnCostPercent: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // P = 800 × 1.25 = 1000; 100 × 25/125 = 20%
    expect(result.sellingPrice).toBe(1000);
    expect(result.marginOnPricePercent).toBeCloseTo(20, 10);
  });

  it("adds the landed costs to the cost before either margin is taken", () => {
    const result = priceMargin({
      purchasePrice: 900,
      landedCosts: 100,
      pair: "costAndPrice",
      sellingPrice: 1250,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // C = 1000; difference 250; 100 × 250/1250 = 20%; 100 × 250/1000 = 25%
    expect(result.cost).toBe(1000);
    expect(result.difference).toBe(250);
    expect(result.marginOnPricePercent).toBe(20);
    expect(result.marginOnCostPercent).toBe(25);
  });

  it("works back to the cost from the price and its margin", () => {
    const result = priceMargin({
      purchasePrice: 0,
      landedCosts: 0,
      pair: "priceAndMarginOnPrice",
      sellingPrice: 1250,
      marginOnPricePercent: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // C = 1250 × 0.80 = 1000; difference 250; 100 × 20/80 = 25%
    expect(result.cost).toBe(1000);
    expect(result.difference).toBe(250);
    expect(result.marginOnCostPercent).toBeCloseTo(25, 10);
  });

  it("works out the cost from the price and a mark-up on the cost", () => {
    const result = priceMargin({
      purchasePrice: 0,
      landedCosts: 0,
      pair: "priceAndMarginOnCost",
      sellingPrice: 1000,
      marginOnCostPercent: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // C = 1000/1.25 = 800; difference 200; 100 × 200/1000 = 20%
    expect(result.cost).toBe(800);
    expect(result.difference).toBe(200);
    expect(result.marginOnPricePercent).toBeCloseTo(20, 10);
    // The mark-up is echoed back exactly as it was typed, being the input pair.
    expect(result.marginOnCostPercent).toBe(25);
  });

  it("leaves the undefined margin empty instead of dividing by a zero price", () => {
    const result = priceMargin({
      purchasePrice: 0,
      landedCosts: 0,
      pair: "costAndPrice",
      sellingPrice: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.marginOnPricePercent).toBeUndefined();
    expect(result.marginOnCostPercent).toBeUndefined();
  });

  it("refuses a margin of 100% of the price, which no finite price satisfies", () => {
    expect(
      priceMargin({
        purchasePrice: 800,
        landedCosts: 0,
        pair: "costAndMarginOnPrice",
        marginOnPricePercent: 100,
      }),
    ).toEqual({ ok: false, reason: "marginOnPricePercent" });
    expect(
      priceMargin({ purchasePrice: 800, landedCosts: 0, pair: "costAndMarginOnPrice" }),
    ).toEqual({ ok: false, reason: "marginOnPricePercent" });
    expect(priceMargin({ purchasePrice: -1, landedCosts: 0, pair: "costAndPrice" })).toEqual({
      ok: false,
      reason: "purchasePrice",
    });
    expect(priceMargin({ purchasePrice: 800, landedCosts: 0, pair: "costAndPrice" })).toEqual({
      ok: false,
      reason: "sellingPrice",
    });
  });
});

describe("rebateChain", () => {
  it("multiplies the rebates instead of adding them — 10% then 5% is 14.5%", () => {
    const result = rebateChain({ listPrice: 1000, rebatePercents: [10, 5] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000 × 0.90 × 0.95 = 855.00, so the effective rebate is
    // 100 × (1 − 0.855) = 14.5% and not 15% — 5.00 a piece.
    expect(result.netPrice).toBeCloseTo(855, 10);
    expect(result.effectiveRebatePercent).toBeCloseTo(14.5, 10);
    // Step 1 is granted on the LIST price: 1000 × 0.10 = 100 off, 900 left.
    expect(result.steps[0]?.basis).toBe(1000);
    expect(result.steps[0]?.rebateAmount).toBeCloseTo(100, 10);
    expect(result.steps[0]?.remaining).toBeCloseTo(900, 10);
    // Step 2 is granted on what step 1 left, 900, not on the original 1000:
    // 900 × 0.05 = 45 off, 855 left.
    expect(result.steps[1]?.basis).toBeCloseTo(900, 10);
    expect(result.steps[1]?.rebateAmount).toBeCloseTo(45, 10);
    expect(result.steps[1]?.remaining).toBeCloseTo(855, 10);
  });

  it("leaves the price alone when there is no rebate at all", () => {
    const result = rebateChain({ listPrice: 1000, rebatePercents: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netPrice).toBe(1000);
    expect(result.effectiveRebatePercent).toBe(0);
    expect(result.steps).toHaveLength(0);
  });

  it("refuses a rebate outside 0..100 and a negative list price", () => {
    expect(rebateChain({ listPrice: 1000, rebatePercents: [101] })).toEqual({
      ok: false,
      reason: "rebatePercents",
    });
    expect(rebateChain({ listPrice: 1000, rebatePercents: [-1] })).toEqual({
      ok: false,
      reason: "rebatePercents",
    });
    expect(rebateChain({ listPrice: -1, rebatePercents: [] })).toEqual({
      ok: false,
      reason: "listPrice",
    });
  });
});

describe("trialBalanceDiagnostics", () => {
  it("lists all three explanations of a 630,00 difference", () => {
    const result = trialBalanceDiagnostics(63_000, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Even, so an item of 315.00 on the wrong side gives exactly 630.00.
    expect(result.reversedItem).toBe(315);
    // 63000 = 7 × 9000 = 7 × (10^4 − 10^3): two digits differing by 7 at
    // positions 3 and 4 — 920,00 typed as 290,00 is 92000 − 29000 = 63000.
    // Every (larger, smaller) pair 7 apart: (7,0), (8,1), (9,2).
    expect(result.transpositions).toEqual([
      {
        lowerPosition: 3,
        upperPosition: 4,
        digitGap: 7,
        step: 90,
        pairs: [
          { larger: 7, smaller: 0 },
          { larger: 8, smaller: 1 },
          { larger: 9, smaller: 2 },
        ],
      },
    ]);
    // 63000/9 = 7000 → 70,00 typed as 700,00.
    expect(result.shiftedByTen).toBe(70);
    // 63000/99 is not whole, so a hundredfold slip is ruled out.
    expect(result.shiftedByHundred).toBeUndefined();
  });

  it("rules out both digit classes when the difference is not divisible by nine", () => {
    const result = trialBalanceDiagnostics(50_000, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Digit sum 5: since 10^j − 10^i is always a multiple of 9, no swap and no
    // decimal slip can produce this. Only the wrong-side item survives.
    expect(result.transpositions).toEqual([]);
    expect(result.shiftedByTen).toBeUndefined();
    expect(result.reversedItem).toBe(250);
  });

  it("finds the non-adjacent positions too, which the adjacent branch would miss", () => {
    const result = trialBalanceDiagnostics(49_500, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 49500 = 5 × 9900 = 5 × (10^4 − 10^2): digits differing by 5 two places
    // apart — 702,00 typed as 207,00 is 70200 − 20700 = 49500.
    // Every pair 5 apart: (5,0), (6,1), (7,2), (8,3), (9,4).
    expect(result.transpositions).toEqual([
      {
        lowerPosition: 2,
        upperPosition: 4,
        digitGap: 5,
        step: 99,
        pairs: [
          { larger: 5, smaller: 0 },
          { larger: 6, smaller: 1 },
          { larger: 7, smaller: 2 },
          { larger: 8, smaller: 3 },
          { larger: 9, smaller: 4 },
        ],
      },
    ]);
    // 49500/9 = 5500 → 55,00 typed as 550,00.
    expect(result.shiftedByTen).toBe(55);
  });

  it("finds the smallest case, 9,00, in all three classes at once", () => {
    const result = trialBalanceDiagnostics(900, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 900 = 1 × 900 = 1 × (10^3 − 10^2): 21,00 typed as 12,00.
    // Every pair 1 apart: (1,0) through (9,8), nine of them.
    expect(result.transpositions).toEqual([
      {
        lowerPosition: 2,
        upperPosition: 3,
        digitGap: 1,
        step: 9,
        pairs: [
          { larger: 1, smaller: 0 },
          { larger: 2, smaller: 1 },
          { larger: 3, smaller: 2 },
          { larger: 4, smaller: 3 },
          { larger: 5, smaller: 4 },
          { larger: 6, smaller: 5 },
          { larger: 7, smaller: 6 },
          { larger: 8, smaller: 7 },
          { larger: 9, smaller: 8 },
        ],
      },
    ]);
    // 900/9 = 100 → 1,00 typed as 10,00; and half of 9,00 is 4,50.
    expect(result.shiftedByTen).toBe(1);
    expect(result.reversedItem).toBe(4.5);
  });

  it("says nothing at all when the sides agree", () => {
    const result = trialBalanceDiagnostics(0, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.magnitude).toBe(0);
    expect(result.transpositions).toEqual([]);
    expect(result.reversedItem).toBeUndefined();
    expect(result.shiftedByTen).toBeUndefined();
    // `balanced` is the field the surface renders „strane su izjednačene" from.
    // It used to compare `magnitude === 0` itself, which is the one decision in
    // this tool with a consequence.
    expect(result.balanced).toBe(true);
  });

  it("is NOT balanced for any difference, however small the minor unit", () => {
    for (const [minor, decimals] of [
      [1, 2],
      [-1, 2],
      [1, 0],
      [-63_000, 2],
    ] as const) {
      const result = trialBalanceDiagnostics(minor, decimals);
      expect(result.ok, `${minor}/${decimals}`).toBe(true);
      if (!result.ok) return;
      expect(result.balanced, `${minor}/${decimals}`).toBe(false);
    }
  });

  it("refuses a difference that is not a whole number of minor units", () => {
    expect(trialBalanceDiagnostics(63_000.5, 2)).toEqual({ ok: false, reason: "difference" });
    expect(trialBalanceDiagnostics(63_000, 5)).toEqual({ ok: false, reason: "decimals" });
  });
});

describe("trialBalance", () => {
  it("adds both sides in whole minor units and finds them equal", () => {
    const result = trialBalance({
      debits: [1234.56, 2000],
      credits: [3234.56],
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 123456 + 200000 = 323456 minor units on each side.
    expect(result.debitTotal).toBe(3234.56);
    expect(result.creditTotal).toBe(3234.56);
    expect(result.debitCount).toBe(2);
    expect(result.creditCount).toBe(1);
    expect(result.diagnostics.difference).toBe(0);
    expect(result.diagnostics.transpositions).toEqual([]);
  });

  it("diagnoses the difference it finds", () => {
    const result = trialBalance({ debits: [920], credits: [290], decimals: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 92000 − 29000 = 63000 minor units = 630.00
    expect(result.diagnostics.difference).toBe(630);
    expect(result.diagnostics.shiftedByTen).toBe(70);
    expect(result.diagnostics.transpositions).toHaveLength(1);
  });

  it("adds a column that floating point would spoil", () => {
    const result = trialBalance({
      debits: [0.1, 0.2],
      credits: [0.3],
      decimals: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10 + 20 − 30 = 0 in minor units; 0.1 + 0.2 − 0.3 as doubles is 5.5e−17.
    expect(result.diagnostics.difference).toBe(0);
    expect(result.debitTotal).toBe(0.3);
  });

  it("refuses more rows than it will add, and a value that is not a number", () => {
    expect(
      trialBalance({ debits: new Array(5001).fill(1), credits: [], decimals: 2 }),
    ).toEqual({ ok: false, reason: "tooManyRows" });
    expect(trialBalance({ debits: [Number.NaN], credits: [], decimals: 2 })).toEqual({
      ok: false,
      reason: "debits",
    });
    expect(trialBalance({ debits: [], credits: [Number.POSITIVE_INFINITY], decimals: 2 })).toEqual({
      ok: false,
      reason: "credits",
    });
    expect(trialBalance({ debits: [], credits: [], decimals: -1 })).toEqual({
      ok: false,
      reason: "decimals",
    });
  });
});

describe("tvmSolve", () => {
  it("solves the instalment, and agrees with the loan schedule to the para", () => {
    const result = tvmSolve({
      pv: -1_000_000,
      fv: 0,
      pmt: 0,
      periods: 12,
      ratePercent: 1,
      timing: "end",
      solveFor: "pmt",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000000 × 0.01/(1 − 1.01^(−12)) = 10000/0.11255077 = 88848.7887
    expect(result.solved).toBeCloseTo(88_848.7887, 4);
    expect(Math.abs(result.residual)).toBeLessThan(1e-6);
    const loan = loanSchedule({
      principal: 1_000_000,
      annualRatePercent: 12,
      instalments: 12,
      frequency: 12,
      plan: "annuity",
      rateMethod: "proportional",
      decimals: 2,
    });
    expect(loan.ok).toBe(true);
    if (!loan.ok) return;
    expect(loan.annuity).toBe(88_848.79);
  });

  it("accumulates a savings plan into its future value", () => {
    const result = tvmSolve({
      pv: 0,
      fv: 0,
      pmt: -10_000,
      periods: 24,
      ratePercent: 0.5,
      timing: "end",
      solveFor: "fv",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1.005^24 = 1.12715978; (1.12715978 − 1)/0.005 = 25.4319555;
    // FV = 10000 × 25.4319555 = 254319.55
    expect(result.solved).toBeCloseTo(254_319.55, 2);
  });

  it("solves a non-integer number of periods", () => {
    const result = tvmSolve({
      pv: -100_000,
      fv: 0,
      pmt: 10_000,
      periods: 0,
      ratePercent: 2,
      timing: "end",
      solveFor: "periods",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // PMT/i = 500000; (500000 − 0)/(500000 − 100000) = 1.25;
    // n = ln 1.25/ln 1.02 = 0.22314355/0.01980263 = 11.268381
    expect(result.solved).toBeCloseTo(11.268381, 6);
    // Check: 1.02^(−11.268381) = 0.8, so 10000 × (1 − 0.8)/0.02 = 100000.
    expect(Math.abs(result.residual)).toBeLessThan(1e-6);
  });

  it("finds the rate by bisection when the flows change sign exactly once", () => {
    const result = tvmSolve({
      pv: -100_000,
      fv: 121_000,
      pmt: 0,
      periods: 2,
      ratePercent: 0,
      timing: "end",
      solveFor: "rate",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (1+i)² = 121000/100000 = 1.21 → 1 + i = 1.1 → i = 10%
    expect(result.solved).toBeCloseTo(10, 6);
    expect(Math.abs(result.residual)).toBeLessThan(1e-6);
  });

  it("refuses a rate search whose flows never change sign", () => {
    expect(
      tvmSolve({
        pv: -1000,
        fv: -1000,
        pmt: -1000,
        periods: 2,
        ratePercent: 0,
        timing: "end",
        solveFor: "rate",
      }),
    ).toEqual({ ok: false, reason: "cashflows" });
  });

  it("takes the i = 0 branch rather than dividing by the rate", () => {
    const result = tvmSolve({
      pv: -120_000,
      fv: 0,
      pmt: 0,
      periods: 12,
      ratePercent: 0,
      timing: "end",
      solveFor: "pmt",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // PV + PMT·n + FV = 0 → PMT = 120000/12 = 10000
    expect(result.solved).toBe(10_000);
  });

  it("moves the payment to the start of the period when asked", () => {
    const end = tvmSolve({
      pv: 0,
      fv: 0,
      pmt: -10_000,
      periods: 24,
      ratePercent: 0.5,
      timing: "end",
      solveFor: "fv",
    });
    const begin = tvmSolve({
      pv: 0,
      fv: 0,
      pmt: -10_000,
      periods: 24,
      ratePercent: 0.5,
      timing: "begin",
      solveFor: "fv",
    });
    expect(end.ok && begin.ok).toBe(true);
    if (!end.ok || !begin.ok) return;
    // Prenumerando multiplies the whole annuity by (1 + i): 254319.55 × 1.005
    // = 255591.15.
    expect(begin.solved).toBeCloseTo(end.solved * 1.005, 6);
  });

  it("refuses a logarithm with no answer and an out-of-range input", () => {
    // PMT/i = 500000 and PV = +100000 make the ratio (500000)/(600000) < 1 with
    // a positive rate — the flows never repay, so there is no n.
    expect(
      tvmSolve({
        pv: 100_000,
        fv: 0,
        pmt: 10_000,
        periods: 0,
        ratePercent: 2,
        timing: "end",
        solveFor: "periods",
      }),
    ).toEqual({ ok: false, reason: "periods" });
    expect(
      tvmSolve({
        pv: -100_000,
        fv: -121_000,
        pmt: 0,
        periods: 2,
        ratePercent: 2,
        timing: "end",
        solveFor: "periods",
      }),
    ).toEqual({ ok: false, reason: "cashflows" });
    expect(
      tvmSolve({
        pv: Number.NaN,
        fv: 0,
        pmt: 0,
        periods: 12,
        ratePercent: 1,
        timing: "end",
        solveFor: "pmt",
      }),
    ).toEqual({ ok: false, reason: "pv" });
    expect(
      tvmSolve({
        pv: -1000,
        fv: 0,
        pmt: 0,
        periods: 1201,
        ratePercent: 1,
        timing: "end",
        solveFor: "pmt",
      }),
    ).toEqual({ ok: false, reason: "periods" });
    expect(
      tvmSolve({
        pv: -1000,
        fv: 0,
        pmt: 0,
        periods: 12,
        ratePercent: -100,
        timing: "end",
        solveFor: "pmt",
      }),
    ).toEqual({ ok: false, reason: "rate" });
  });
});

describe("a union value is a claim, not a fact — the table is asked at runtime", () => {
  type RateConversionInput = Parameters<typeof rateConversion>[0];

  it("rateConversion refuses a target period outside the table instead of NaN rates and a missing periodsPerYear", () => {
    const good: RateConversionInput = {
      ratePercent: 12,
      kind: "nominal",
      compoundingsPerYear: 12,
      target: "month",
    };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: RateConversionInput = {
      ...good,
      target: "week" as RateConversionInput["target"],
    };
    expect(rateConversion(bad)).toEqual({ ok: false, reason: "target" });
    expect(rateConversion(good).ok).toBe(true);
  });
});
