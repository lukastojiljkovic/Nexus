import { describe, expect, it } from "vitest";

import {
  currencyMinorDigits,
  formatMoney,
  formatMoneyPlain,
  moneyInputValue,
  parseMoneyInput,
} from "./money.js";

/**
 * The FIN module's display edge (FIN slice b) — the ONE place a decimal point
 * exists in this app. Everything below is pure: minor units and a currency in, a
 * Serbian string out, and back again.
 *
 * Two properties are worth naming, because both are what a hand-rolled
 * formatter gets wrong:
 *
 * - The separator between the amount and the code is a NON-BREAKING space,
 *   which is what the locale itself produces. It is spelled as the `NBSP`
 *   constant rather than typed, so it is visible in this file: an
 *   implementation that composed the string by hand would use a plain space and
 *   fail here.
 * - The minus sign is the LOCALE's, placed by `Intl` — never a "-" prefixed by
 *   hand around a formatted absolute value.
 */

/** U+00A0 — the separator `Intl` puts between the amount and the currency code in sr-Latn. */
const NBSP = "\u00a0";

describe("currencyMinorDigits", () => {
  it("reads the currency's own minor-unit count rather than assuming two", () => {
    expect(currencyMinorDigits("RSD")).toBe(2);
    expect(currencyMinorDigits("EUR")).toBe(2);
    // Yen has no minor unit at all: 1234 JPY is one thousand two hundred
    // thirty-four yen, not 12,34.
    expect(currencyMinorDigits("JPY")).toBe(0);
    // And the dinar of Kuwait has three, which is what makes "assume 2" a bug
    // rather than a simplification.
    expect(currencyMinorDigits("KWD")).toBe(3);
  });

  it("answers two for a well-formed code it has no data for, rather than throwing", () => {
    expect(currencyMinorDigits("ZZZ")).toBe(2);
  });
});

describe("formatMoney", () => {
  const cases: readonly [number, string, string][] = [
    // Zero is a real amount and prints its fraction digits like any other.
    [0, "RSD", `0,00${NBSP}RSD`],
    [1234, "RSD", `12,34${NBSP}RSD`],
    // The locale's minus sign, in the locale's own position.
    [-1234, "RSD", `-12,34${NBSP}RSD`],
    // Serbian groups with "." and separates the decimal with ",".
    [123456789, "RSD", `1.234.567,89${NBSP}RSD`],
    [1234, "EUR", `12,34${NBSP}EUR`],
    // A currency with NO minor unit: the integer IS the whole amount.
    [1234, "JPY", `1.234${NBSP}JPY`],
    [-1234, "JPY", `-1.234${NBSP}JPY`],
    // …and one with three of them.
    [1234, "KWD", `1,234${NBSP}KWD`],
    [-1234, "KWD", `-1,234${NBSP}KWD`],
    // A sub-unit amount still shows its leading zero, negative or not.
    [5, "USD", `0,05${NBSP}USD`],
    [-5, "USD", `-0,05${NBSP}USD`],
  ];

  for (const [minorUnits, currency, expected] of cases) {
    it(`formats ${minorUnits} ${currency}`, () => {
      expect(formatMoney(minorUnits, currency)).toBe(expected);
    });
  }

  it("is EXACT at the store's own upper bound — the arithmetic never goes through a float", () => {
    // `Number.MAX_SAFE_INTEGER / 100` is 90.071.992.547.409,90 as a double: the
    // last minor unit is gone before the formatter ever sees it. Splitting the
    // integer with integer arithmetic is what keeps the ,91.
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "RSD")).toBe(
      `90.071.992.547.409,91${NBSP}RSD`,
    );
    expect(formatMoney(-Number.MAX_SAFE_INTEGER, "RSD")).toBe(
      `-90.071.992.547.409,91${NBSP}RSD`,
    );
  });

  it("names the currency by its ISO code, never by a symbol two currencies could share", () => {
    // Nothing here converts, so several currencies are read side by side and
    // the unit has to be unmistakable — "US$" and "$" are not.
    expect(formatMoney(100, "USD")).toContain("USD");
    expect(formatMoney(100, "EUR")).toContain("EUR");
  });
});

describe("formatMoneyPlain", () => {
  it("formats exactly as formatMoney does, minus the code", () => {
    expect(formatMoneyPlain(123456789, "RSD")).toBe("1.234.567,89");
    expect(formatMoneyPlain(0, "RSD")).toBe("0,00");
    // The currency still decides the fraction digits — it is only the CODE that
    // is left off, never the currency's own shape.
    expect(formatMoneyPlain(1234, "JPY")).toBe("1.234");
    expect(formatMoneyPlain(1234, "KWD")).toBe("1,234");
  });

  it("keeps the locale's own minus sign, exactly as formatMoney does", () => {
    expect(formatMoneyPlain(-1234, "RSD")).toBe("-12,34");
    // The two agree on everything but the code, which is what makes it safe to
    // use inside a column that names its currency once at the top.
    expect(formatMoney(-1234, "RSD")).toBe(`${formatMoneyPlain(-1234, "RSD")}${NBSP}RSD`);
  });

  it("is exact at the store's own upper bound, for the same reason", () => {
    expect(formatMoneyPlain(Number.MAX_SAFE_INTEGER, "RSD")).toBe("90.071.992.547.409,91");
  });
});

describe("parseMoneyInput", () => {
  it("reads the Serbian decimal comma into minor units", () => {
    expect(parseMoneyInput("12,34", "RSD")).toBe(1234);
    expect(parseMoneyInput("0,05", "RSD")).toBe(5);
    expect(parseMoneyInput("-12,34", "RSD")).toBe(-1234);
    expect(parseMoneyInput("+12,34", "RSD")).toBe(1234);
  });

  it("reads a dot as the same decimal separator — with no grouping allowed it can mean nothing else", () => {
    expect(parseMoneyInput("12.34", "RSD")).toBe(1234);
    expect(parseMoneyInput("12.3", "RSD")).toBe(1230);
  });

  it("takes a bare integer as whole major units", () => {
    expect(parseMoneyInput("1234", "RSD")).toBe(123400);
    expect(parseMoneyInput("0", "RSD")).toBe(0);
    expect(parseMoneyInput("-7", "RSD")).toBe(-700);
  });

  it("pads a short fraction rather than reading it as minor units", () => {
    expect(parseMoneyInput("12,5", "RSD")).toBe(1250);
  });

  it("scales by the CURRENCY's own minor-unit count", () => {
    expect(parseMoneyInput("1234", "JPY")).toBe(1234);
    expect(parseMoneyInput("1,234", "KWD")).toBe(1234);
    expect(parseMoneyInput("1", "KWD")).toBe(1000);
  });

  it("refuses more fraction digits than the currency has — money is never silently rounded", () => {
    expect(parseMoneyInput("12,345", "RSD")).toBeNull();
    // JPY has no minor unit, so any fraction at all is a value it cannot hold.
    expect(parseMoneyInput("1,5", "JPY")).toBeNull();
  });

  it("refuses a grouped number rather than guessing which separator was meant", () => {
    // „1.234" is 1234 to one reader and 1,234 to another; guessing would be a
    // silently wrong amount, which is the one outcome a ledger must not have.
    expect(parseMoneyInput("1.234", "RSD")).toBeNull();
    expect(parseMoneyInput("1.234,56", "RSD")).toBeNull();
  });

  it("trims surrounding whitespace and refuses everything that is not a number", () => {
    expect(parseMoneyInput("  12,3  ", "RSD")).toBe(1230);
    expect(parseMoneyInput("", "RSD")).toBeNull();
    expect(parseMoneyInput("   ", "RSD")).toBeNull();
    expect(parseMoneyInput("abc", "RSD")).toBeNull();
    expect(parseMoneyInput(",", "RSD")).toBeNull();
    expect(parseMoneyInput("12,", "RSD")).toBeNull();
    expect(parseMoneyInput(",5", "RSD")).toBeNull();
    expect(parseMoneyInput("-", "RSD")).toBeNull();
    expect(parseMoneyInput("1e3", "RSD")).toBeNull();
  });

  it("refuses an amount too large to survive the round trip through the database", () => {
    expect(parseMoneyInput("99999999999999999999", "RSD")).toBeNull();
    expect(parseMoneyInput("90071992547409,91", "RSD")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("moneyInputValue", () => {
  it("writes the amount back the way the field accepts it — no grouping, no currency", () => {
    expect(moneyInputValue(1234, "RSD")).toBe("12,34");
    expect(moneyInputValue(-1234, "RSD")).toBe("-12,34");
    expect(moneyInputValue(0, "RSD")).toBe("0,00");
    expect(moneyInputValue(1234, "JPY")).toBe("1234");
    expect(moneyInputValue(1234, "KWD")).toBe("1,234");
  });

  it("round-trips through the parser for every currency shape", () => {
    for (const [minorUnits, currency] of [
      [1234, "RSD"],
      [-1234, "RSD"],
      [0, "RSD"],
      [5, "EUR"],
      [1234, "JPY"],
      [-1234, "KWD"],
      [Number.MAX_SAFE_INTEGER, "RSD"],
    ] as const) {
      expect(parseMoneyInput(moneyInputValue(minorUnits, currency), currency), currency).toBe(
        minorUnits,
      );
    }
  });
});
