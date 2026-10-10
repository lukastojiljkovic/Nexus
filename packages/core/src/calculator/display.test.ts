import { describe, expect, it } from "vitest";

import {
  CALCULATOR_DISPLAY_PRECISION,
  DEFAULT_CALCULATOR_FORMAT,
  formatCalculatorDisplay,
} from "./display.js";

/**
 * The formatter is deliberately separate from the engine (`display.ts` says
 * why), and these are its four decisions written down as cases: the locale's
 * two separators, grouping on and off, the 15-significant-digit display
 * rounding, and the point where the notation changes from fixed to scientific.
 *
 * Expected strings are hand-derived from the rule the implementation states,
 * the way a reader with a calculator in hand would derive them: `0.30000000000000004`
 * to fifteen significant digits is `0.300000000000000`, and a decimal's trailing
 * zeros are not shown, so the answer is `0.3`.
 */

describe("formatCalculatorDisplay", () => {
  it("writes the separators the locale actually uses", () => {
    expect(formatCalculatorDisplay("1234.5", { locale: "sr" })).toBe("1.234,5");
    expect(formatCalculatorDisplay("1234.5", { locale: "en" })).toBe("1,234.5");
  });

  it("groups nothing when the caller asks for no grouping, and still uses the locale's decimal point", () => {
    expect(formatCalculatorDisplay("1234567.891", { locale: "sr", grouping: false })).toBe(
      "1234567,891",
    );
    expect(formatCalculatorDisplay("1234567.891", { locale: "en", grouping: false })).toBe(
      "1234567.891",
    );
  });

  it("groups the integer part in threes, from the decimal point outwards", () => {
    // Hand-checked: 1 234 567 -> "1.234.567" sr, "1,234,567" en.
    expect(formatCalculatorDisplay("1234567.891", { locale: "sr" })).toBe("1.234.567,891");
    expect(formatCalculatorDisplay("1234567.891", { locale: "en" })).toBe("1,234,567.891");
    expect(formatCalculatorDisplay("1000", { locale: "sr" })).toBe("1.000");
  });

  it("rounds to fifteen significant digits, which is what makes 0.1 + 0.2 read as 0.3", () => {
    expect(CALCULATOR_DISPLAY_PRECISION).toBe(15);
    expect(formatCalculatorDisplay("0.30000000000000004", { locale: "sr" })).toBe("0,3");
    expect(formatCalculatorDisplay("0.30000000000000004", { locale: "en" })).toBe("0.3");
    // Fifteen significant digits of 1/3, and of the square root of two.
    expect(formatCalculatorDisplay("0.3333333333333333", { locale: "en" })).toBe(
      "0.333333333333333",
    );
    expect(formatCalculatorDisplay("1.4142135623730951", { locale: "en" })).toBe("1.4142135623731");
    expect(formatCalculatorDisplay("0.49999999999999994", { locale: "en" })).toBe("0.5");
  });

  it("shows every digit the value carries when the caller asks for no rounding", () => {
    // The bignumber mode's answer: twenty of the sixty-four digits of 1/3, the
    // same string it was handed, with only the decimal point localized.
    const twenty = "0." + "3".repeat(20);
    expect(formatCalculatorDisplay(twenty, { locale: "sr", precision: null })).toBe(
      "0," + "3".repeat(20),
    );
    // One digit past the display precision still rounds; `null` does not.
    expect(formatCalculatorDisplay(twenty, { locale: "en", precision: 4 })).toBe("0.3333");
  });

  it("carries a rounding overflow into the next decade rather than printing a leading ten", () => {
    // 9.99 to two significant digits is 10, not "10.0" and not "9.9".
    expect(formatCalculatorDisplay("9.99", { locale: "en", precision: 2 })).toBe("10");
    expect(formatCalculatorDisplay("0.96", { locale: "en", precision: 1 })).toBe("1");
    expect(formatCalculatorDisplay("999.5", { locale: "en", precision: 3 })).toBe("1,000");
  });

  it("keeps fixed notation across the window a calculator can read, and turns scientific outside it", () => {
    // Fixed: 1e-6 (the smallest the window holds), 1e15 (the largest).
    expect(formatCalculatorDisplay("0.000001", { locale: "sr" })).toBe("0,000001");
    expect(formatCalculatorDisplay("1e+15", { locale: "en" })).toBe("1,000,000,000,000,000");
    // Scientific: one decade further out on each side.
    expect(formatCalculatorDisplay("1e-7", { locale: "sr" })).toBe("1e-7");
    expect(formatCalculatorDisplay("1e+16", { locale: "en" })).toBe("1e+16");
    expect(formatCalculatorDisplay("1.5e-7", { locale: "sr" })).toBe("1,5e-7");
    expect(formatCalculatorDisplay("1e+100", { locale: "en" })).toBe("1e+100");
  });

  it("names the two values that are not numbers with symbols rather than words", () => {
    expect(formatCalculatorDisplay("Infinity", { locale: "sr" })).toBe("∞");
    expect(formatCalculatorDisplay("-Infinity", { locale: "en" })).toBe("-∞");
    expect(formatCalculatorDisplay("NaN", { locale: "en" })).toBe("NaN");
  });

  it("formats every number inside a unit, a complex result and a matrix, and leaves the rest of the text alone", () => {
    expect(formatCalculatorDisplay("3.1068559611866697 mi", { locale: "sr" })).toBe(
      "3,10685596118667 mi",
    );
    expect(formatCalculatorDisplay("1 + 1.7320508075688772i", { locale: "en" })).toBe(
      "1 + 1.73205080756888i",
    );
    expect(formatCalculatorDisplay("[[1, 2], [3, 4]]", { locale: "sr" })).toBe("[[1, 2], [3, 4]]");
    expect(formatCalculatorDisplay("[[1234567.891, 2]]", { locale: "sr" })).toBe(
      "[[1.234.567,891, 2]]",
    );
    // A unit's own exponent is not a number to group, and 20 degC keeps its name.
    expect(formatCalculatorDisplay("20 degC", { locale: "sr" })).toBe("20 degC");
    expect(formatCalculatorDisplay("1 m^0.5", { locale: "sr", grouping: false })).toBe("1 m^0,5");
  });

  it("leaves digits inside a string value exactly as they were written", () => {
    // A variable can hold a string, and `"1234"` is the text the user typed:
    // grouping it would change the value the display claims to show.
    expect(formatCalculatorDisplay('"1234"', { locale: "sr" })).toBe('"1234"');
  });

  it("answers in Serbian by default, which is the product's default locale", () => {
    expect(DEFAULT_CALCULATOR_FORMAT).toEqual({ locale: "sr", grouping: true, precision: 15 });
    expect(formatCalculatorDisplay("1234.5")).toBe("1.234,5");
  });
});
