/**
 * The FIN module's DECIMAL EDGE, in `@nexus/core` because both sides of it must
 * reach it: the renderer's ledger page formats and parses typed money with it,
 * and main's assistant tools do the same. A second spelling of "what 12,34 RSD
 * is" in main would let a tool result and a ledger row disagree about one
 * amount, so the split and the parse live once, here.
 *
 * Money is an INTEGER of minor units everywhere else in FIN (see
 * `packages/db/src/finance/money.ts`); this file is the only place an integer
 * becomes a decimal and a typed decimal becomes an integer. How many minor units
 * make a major one is `currencyMinorDigits`, from `imex/csvFinance.ts`.
 */

import { currencyMinorDigits } from "../imex/csvFinance.js";

/**
 * The exact decimal of an amount of minor units, as a string: the one split
 * every display and every typed amount in FIN agrees on.
 *
 * Total by construction: `minorUnits` is an integer and `digits` a non-negative
 * integer, so the output always matches `-?\d+(\.\d+)?`, which is the
 * `${number}` grammar the assertion claims. TypeScript models Intl's string
 * input that way, and no runtime-built string can satisfy the literal statically,
 * so the cast is the cost of that modelling.
 *
 * The split is integer arithmetic on purpose: `abs - (abs % scale)` is exact for
 * every safe integer, and dividing that by `scale` yields an exact integer
 * quotient, so no float ever holds the amount.
 */
export function decimalLiteral(minorUnits: number, digits: number): `${number}` {
  const negative = minorUnits < 0;
  const abs = Math.abs(minorUnits);
  const sign = negative ? "-" : "";
  if (digits === 0) return `${sign}${abs}` as `${number}`;
  const scale = 10 ** digits;
  const fraction = abs % scale;
  const whole = (abs - fraction) / scale;
  return `${sign}${whole}.${String(fraction).padStart(digits, "0")}` as `${number}`;
}

/**
 * The options every display of an amount in `currency` shares. The fraction
 * digits are STATED from the currency's own minor-unit count rather than left to
 * the formatter's locale default: Chromium's ICU writes RSD with no decimals,
 * and FIN stores para, so a formatter that rounded to zero would drop them.
 * `withCode` picks the ISO code over no currency at all, for a column that has
 * already named the money once.
 */
export function moneyFormatOptions(currency: string, withCode: boolean): Intl.NumberFormatOptions {
  const digits = currencyMinorDigits(currency);
  return withCode
    ? {
        style: "currency",
        currency,
        currencyDisplay: "code",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }
    : { minimumFractionDigits: digits, maximumFractionDigits: digits };
}

/**
 * An amount of minor units through a formatter the caller built from
 * `moneyFormatOptions`. The caller owns the locale; this owns the split. The
 * number reaches `Intl` as an exact string, never as a division, so every amount
 * the ledger can hold is printed exactly.
 */
export function formatMinorUnits(
  minorUnits: number,
  currency: string,
  format: Intl.NumberFormat,
): string {
  return format.format(decimalLiteral(minorUnits, currencyMinorDigits(currency)));
}

/**
 * A typed amount as minor units, or `null` when the text is not an amount this
 * currency can hold. The one parser FIN uses for typed money: the page passes the
 * active locale's decimal marks, the assistant passes ".".
 *
 * The grammar is deliberately narrow: an optional sign, digits, and at most one
 * separator from `separators`. Grouping is refused, which is what makes „1.234"
 * a refusal rather than a guess. With grouping allowed it would mean 1234 to one
 * reader and 1,234 to another, and a ledger that guesses wrong quietly holds the
 * wrong number. A fraction longer than the currency's minor-unit count is refused
 * too, never rounded: „12,345 RSD" is not 12,34 and not 12,35.
 */
export function minorUnitsFromText(
  text: string,
  currency: string,
  separators: readonly string[],
): number | null {
  const separator = separators.map(escapeForClass).join("");
  const match = new RegExp(`^([+-]?)(\\d+)(?:[${separator}](\\d+))?$`).exec(text.trim());
  if (match === null) return null;
  const [, sign = "", whole = "", fraction] = match;

  const digits = currencyMinorDigits(currency);
  if (fraction !== undefined && fraction.length > digits) return null;

  const scale = 10 ** digits;
  const minorUnits =
    Number(whole) * scale + (fraction === undefined ? 0 : Number(fraction.padEnd(digits, "0")));
  // The store's own bound (`isMinorUnits` in the db package), checked here so a
  // value that cannot survive SQLite is refused before it reaches a row.
  if (!Number.isSafeInteger(minorUnits)) return null;
  return sign === "-" ? -minorUnits : minorUnits;
}

/** Escapes one separator for a regex character class, so a metacharacter mark still parses. */
function escapeForClass(separator: string): string {
  return separator.replace(/[\\\]^-]/g, "\\$&");
}
