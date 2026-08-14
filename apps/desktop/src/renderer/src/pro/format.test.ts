import { describe, expect, it } from "vitest";

import { proNum, proParse, proRatio, proUnit } from "./format.js";

/**
 * The drawer's number, both ways.
 *
 * The reason this file exists is the round trip at the bottom of it. `proNum`
 * and the one-line parse each surface was about to copy were written months
 * apart and never once run against each other, and they are not inverses: the
 * formatter groups Serbian style with a full stop, and the parse turned that
 * into `NaN`, which a surface renders as an empty field. Two hundred and
 * seventy-four tools were about to inherit it, and nothing about the symptom —
 * paste a result, see nothing — looks like arithmetic.
 */

describe("proNum — Serbian, and always to the stated precision", () => {
  it("groups with a full stop and separates decimals with a comma", () => {
    expect(proNum(1234567.89, 2)).toBe("1.234.567,89");
    expect(proNum(0.5, 2)).toBe("0,50");
  });

  it("keeps the trailing zeros that make a column line up", () => {
    expect(proNum(167.6, 3)).toBe("167,600");
    expect(proNum(4, 0)).toBe("4");
  });

  it("answers an em dash rather than „NaN\" or „∞\"", () => {
    expect(proNum(Number.NaN)).toBe("—");
    expect(proNum(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("proRatio and proUnit", () => {
  it("gives a ratio three decimals and no percent sign", () => {
    expect(proRatio(1.0432)).toBe("1,043");
    expect(proRatio(undefined)).toBeUndefined();
  });

  it("joins a unit with a non-breaking space, so a wrap cannot strand it", () => {
    expect(proUnit("4,35", "m")).toBe("4,35\u00a0m");
  });
});

describe("proParse — a lone separator", () => {
  it("reads the comma as the decimal separator, which is what the app prints", () => {
    expect(proParse("167,647")).toBe(167.647);
    expect(proParse("0,5")).toBe(0.5);
  });

  it("reads a full stop as a decimal point when it cannot be grouping", () => {
    expect(proParse("0.5")).toBe(0.5);
    expect(proParse("1.23")).toBe(1.23);
    expect(proParse("12.5")).toBe(12.5);
    // Five fraction digits are not a group of three.
    expect(proParse("167.64706")).toBe(167.64706);
  });

  it("reads a repeated separator as grouping", () => {
    expect(proParse("1.234.567")).toBe(1234567);
    expect(proParse("1,234,567")).toBe(1234567);
  });

  it("resolves the one ambiguous shape towards the app's own output", () => {
    // Three digits after a lone stop, one to three before it, is precisely what
    // `proNum(n, 0)` prints for a whole number — a tile count copied out of one
    // tool and pasted into the next. Reading it as a decimal would be a
    // thousandfold error reachable inside the app; the opposite reading needs a
    // person to type a point where every figure on screen shows a comma.
    expect(proParse("1.234")).toBe(1234);
    expect(proParse("167.647")).toBe(167647);
    expect(proParse("1,234")).toBe(1.234);
    // Four leading digits cannot be a group, so the stop is a decimal point.
    expect(proParse("1234.567")).toBe(1234.567);
  });
});

describe("proParse — both separators, where the last one wins", () => {
  it("reads the Serbian order", () => {
    expect(proParse("1.234.567,89")).toBe(1234567.89);
    expect(proParse("2.850,00")).toBe(2850);
  });

  it("reads the English order pasted from another application", () => {
    expect(proParse("1,234,567.89")).toBe(1234567.89);
  });
});

describe("proParse — what it declines rather than guesses", () => {
  it("declines an empty field, which is not a zero", () => {
    expect(proParse("")).toBeUndefined();
    expect(proParse("   ")).toBeUndefined();
    expect(proParse(",")).toBeUndefined();
  });

  it("declines what `Number` would have accepted and nobody typed", () => {
    expect(proParse("Infinity")).toBeUndefined();
    expect(proParse("0x10")).toBeUndefined();
    expect(proParse("1e3")).toBeUndefined();
    expect(proParse("12 kg")).toBeUndefined();
  });

  it("declines a fraction that carries a separator of its own", () => {
    expect(proParse("1.234,56.7")).toBeUndefined();
  });
});

describe("proParse — the shapes a paste actually arrives in", () => {
  it("strips the spaces a spreadsheet groups with, ordinary and non-breaking", () => {
    expect(proParse(" 1 234,5 ")).toBe(1234.5);
    expect(proParse("1\u00a0234,5")).toBe(1234.5);
    expect(proParse("1\u202f234,5")).toBe(1234.5);
  });

  it("reads a sign, and never answers negative zero", () => {
    expect(proParse("-2.850,00")).toBe(-2850);
    expect(proParse("+12,5")).toBe(12.5);
    expect(Object.is(proParse("-0,00"), 0)).toBe(true);
  });

  it("tolerates the elided digit on either side of the separator", () => {
    expect(proParse(",5")).toBe(0.5);
    expect(proParse("5,")).toBe(5);
  });
});

describe("the round trip — the property the drawer actually depends on", () => {
  // Every value here is one a professional tool really produces: a stair riser,
  // a bar spacing, a quantity take-off, a rate, an invoice total.
  const values = [0, 0.5, 1.234, 4.35, 167.647, 1234, 2850, 12345.67, 1234567.89, -2850, -0.75];

  it.each(values)("reads back exactly what it printed: %s", (value) => {
    for (const digits of [0, 1, 2, 3]) {
      // Through the STRING, deliberately: the property is that a figure survives
      // being displayed and typed back, and `toFixed` is not the comparison —
      // it rounds 4,35 to „4.3" where `Intl` rounds it to „4,4", which would make
      // this test about a disagreement between two rounding rules instead of
      // about the drawer.
      const printed = proNum(value, digits);
      const read = proParse(printed);
      expect(read, `${value} at ${digits} digits printed as ${printed}`).toBeDefined();
      expect(proNum(read ?? Number.NaN, digits), `round trip of ${printed}`).toBe(printed);
    }
  });

  it("reads back a value carrying its unit only once the unit is removed", () => {
    // Not a defect: a field takes a number. This pins that the non-breaking
    // space in `proUnit` is what makes the difference, so nobody „fixes" the
    // parse to swallow units instead.
    expect(proParse(proUnit(proNum(2850, 0), "mm"))).toBeUndefined();
    expect(proParse(proNum(2850, 0))).toBe(2850);
  });
});
