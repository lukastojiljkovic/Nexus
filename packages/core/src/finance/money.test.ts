import { describe, expect, it } from "vitest";

import { decimalLiteral, formatMinorUnits, minorUnitsFromText, moneyFormatOptions } from "./money.js";

/**
 * The decimal edge both the ledger page and the assistant's tools use. These pin
 * the grammar and the exactness: a typed amount becomes the integer it names,
 * a fraction the currency cannot hold is refused rather than rounded, and an
 * amount the ledger can hold is printed without a float ever touching it.
 */
describe("minorUnitsFromText", () => {
  it("reads an amount in the currency's own minor units, with either shipped decimal mark", () => {
    expect(minorUnitsFromText("12.5", "RSD", [".", ","])).toBe(1_250);
    expect(minorUnitsFromText("12,50", "RSD", [",", "."])).toBe(1_250);
    expect(minorUnitsFromText("-3", "EUR", ["."])).toBe(-300);
    // Yen has no minor unit: the integer is the whole amount.
    expect(minorUnitsFromText("1234", "JPY", ["."])).toBe(1_234);
  });

  it("refuses grouping, a fraction the currency cannot hold, and an amount past the safe bound", () => {
    expect(minorUnitsFromText("1.234", "RSD", [","])).toBeNull();
    expect(minorUnitsFromText("12.345", "RSD", ["."])).toBeNull();
    expect(minorUnitsFromText("1234.5", "JPY", ["."])).toBeNull();
    expect(minorUnitsFromText("9007199254740993", "RSD", ["."])).toBeNull();
  });
});

describe("decimalLiteral", () => {
  it("splits minor units into the exact decimal, sign and all", () => {
    expect(decimalLiteral(-1_234, 2)).toBe("-12.34");
    expect(decimalLiteral(7, 2)).toBe("0.07");
    expect(decimalLiteral(1_234, 0)).toBe("1234");
  });

  it("stays exact at the top of the safe range, where a division would already be wrong", () => {
    expect(decimalLiteral(Number.MAX_SAFE_INTEGER, 2)).toBe("90071992547409.91");
  });
});

describe("formatMinorUnits", () => {
  it("formats through the caller's formatter, with the currency's own digits", () => {
    const format = new Intl.NumberFormat("sr-Latn", moneyFormatOptions("RSD", false));
    expect(formatMinorUnits(123_456_789, "RSD", format)).toBe("1.234.567,89");
  });
});
