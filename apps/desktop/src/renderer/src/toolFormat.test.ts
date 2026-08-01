import { describe, expect, it } from "vitest";

import {
  formatToolAmount,
  formatToolNumber,
  formatToolPercent,
  formatToolUnitPrice,
} from "./toolFormat.js";

/**
 * The separators are the LOCALE's, so these assertions read them back rather
 * than hard-coding „.", which is what `money.test.ts` does for the same reason:
 * a test that pinned the glyph would be testing ICU rather than this module.
 */
const group = new Intl.NumberFormat("sr-Latn").format(1000).replace(/\d/g, "");
const decimal = new Intl.NumberFormat("sr-Latn").format(1.5).replace(/\d/g, "");

describe("formatToolNumber — converted quantities", () => {
  it("groups thousands and writes the decimal comma the locale uses", () => {
    expect(formatToolNumber(1609.344)).toBe(`1${group}609${decimal}344`);
    expect(formatToolNumber(12.5)).toBe(`12${decimal}5`);
  });

  it("keeps a tiny figure rather than rounding it to nothing", () => {
    // A milligram in kilograms. Two decimal places would render this „0,00".
    expect(formatToolNumber(0.000001)).toBe(`0${decimal}000001`);
  });

  it("keeps a very large figure exact — a gibibyte in bytes", () => {
    expect(formatToolNumber(1_073_741_824)).toBe(
      `1${group}073${group}741${group}824`,
    );
  });

  it("clears the float noise the model deliberately left in", () => {
    expect(formatToolNumber(0.1 + 0.2)).toBe(`0${decimal}3`);
  });

  it("draws a negative with the locale's own minus sign, never a hand-prefixed one", () => {
    expect(formatToolNumber(-40)).toBe(new Intl.NumberFormat("sr-Latn").format(-40));
  });
});

describe("formatToolAmount — money-shaped figures", () => {
  it("always shows exactly two decimals, so a column of them lines up", () => {
    expect(formatToolAmount(1000)).toBe(`1${group}000${decimal}00`);
    expect(formatToolAmount(19332.801529)).toBe(`19${group}332${decimal}80`);
  });

  it("names no currency — the drawer never asks which money this is", () => {
    expect(formatToolAmount(200)).not.toMatch(/RSD|din|€|\$/);
  });
});

describe("formatToolUnitPrice", () => {
  it("keeps four decimals where two would collapse a real difference to zero", () => {
    expect(formatToolUnitPrice(0.0024)).toBe(`0${decimal}0024`);
    // Still at least two, so 0,24 and 0,2400 do not sit in one column differently.
    expect(formatToolUnitPrice(0.24)).toBe(`0${decimal}24`);
  });
});

describe("formatToolPercent", () => {
  it("appends the sign and rounds to at most two decimals", () => {
    expect(formatToolPercent(17.5)).toBe(`17${decimal}5%`);
    expect(formatToolPercent(20)).toBe("20%");
  });

  it("clears float noise before rounding, so a clean 20% does not read 20,000000000000018%", () => {
    expect(formatToolPercent((0.24 / 0.2 - 1) * 100)).toBe("20%");
  });
});
