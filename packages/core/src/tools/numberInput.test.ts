import { describe, expect, it } from "vitest";

import { TOOL_MAX_DECIMALS, parseToolNumber, toolNumberInputValue } from "./numberInput.js";

describe("parseToolNumber", () => {
  it("reads a plain whole number", () => {
    expect(parseToolNumber("42")).toBe(42);
    expect(parseToolNumber("0")).toBe(0);
    expect(parseToolNumber("  7  ")).toBe(7);
  });

  it("reads BOTH separators as the decimal point — the comma Serbian writes and the dot a keypad gives", () => {
    expect(parseToolNumber("12,5")).toBe(12.5);
    expect(parseToolNumber("12.5")).toBe(12.5);
  });

  /**
   * The reason this parser exists rather than `parseAmountInput` being reused:
   * that one caps at two decimals, which is right for grams and wrong for a
   * converter — 0,001 km is a metre, and refusing it would make the length tool
   * unable to express its own smallest unit.
   */
  it("accepts far more decimals than a money or gram field would", () => {
    expect(parseToolNumber("0,001")).toBe(0.001);
    expect(parseToolNumber("1,2345678")).toBe(1.2345678);
    expect(TOOL_MAX_DECIMALS).toBeGreaterThan(2);
  });

  it("reads a negative, because temperature has them and a converter must not refuse −40", () => {
    expect(parseToolNumber("-40")).toBe(-40);
    expect(parseToolNumber("-273,15")).toBe(-273.15);
    expect(parseToolNumber("+5")).toBe(5);
  });

  /**
   * The refusal discipline `parseMoneyInput` and `parseAmountInput` share, kept
   * here for their reason: „1.234" means 1234 to one reader and 1,234 to
   * another, and a converter that picks one is silently wrong by a factor of a
   * thousand for the other.
   */
  it("REFUSES grouping separators rather than guessing which reading was meant", () => {
    expect(parseToolNumber("1.234,5")).toBeNull();
    expect(parseToolNumber("1,234.5")).toBeNull();
    expect(parseToolNumber("1 234")).toBeNull();
    expect(parseToolNumber("1'234")).toBeNull();
  });

  it("REFUSES more decimals than allowed rather than rounding them away", () => {
    expect(parseToolNumber("1,5", 1)).toBe(1.5);
    expect(parseToolNumber("1,55", 1)).toBeNull();
    expect(parseToolNumber(`0,${"1".repeat(TOOL_MAX_DECIMALS)}`)).not.toBeNull();
    expect(parseToolNumber(`0,${"1".repeat(TOOL_MAX_DECIMALS + 1)}`)).toBeNull();
  });

  it("refuses everything that is not a number", () => {
    for (const text of ["", "   ", "abc", "12abc", "1,2,3", "1,", ",5", "-", "1e5", "∞", "NaN"]) {
      expect(parseToolNumber(text), text).toBeNull();
    }
  });

  it("refuses a magnitude a double cannot hold, rather than answering Infinity", () => {
    expect(parseToolNumber("9".repeat(400))).toBeNull();
  });

  it("round-trips against toolNumberInputValue, so opening a value for editing changes nothing", () => {
    for (const value of [0, 42, -40, 12.5, 0.001, -273.15]) {
      expect(parseToolNumber(toolNumberInputValue(value)), String(value)).toBe(value);
    }
  });
});

describe("toolNumberInputValue", () => {
  it("writes the Serbian decimal comma and no grouping — exactly the parser's own language", () => {
    expect(toolNumberInputValue(12.5)).toBe("12,5");
    expect(toolNumberInputValue(1234)).toBe("1234");
    expect(toolNumberInputValue(-273.15)).toBe("-273,15");
    expect(toolNumberInputValue(0)).toBe("0");
  });

  it("never emits exponent notation, which the parser would refuse", () => {
    // `String(0.0000001)` is "1e-7"; a field that wrote that could not be
    // re-read by the parser that filled it.
    expect(toolNumberInputValue(0.0000001)).toBe("0,0000001");
    expect(toolNumberInputValue(1e21)).toBe("");
  });
});
