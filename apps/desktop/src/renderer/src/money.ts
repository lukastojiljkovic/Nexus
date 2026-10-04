/**
 * The FIN module's DISPLAY EDGE (FIN slice b) — the one and only place in this
 * app where money becomes a decimal, and the one place a decimal becomes money.
 *
 * Everywhere else — the schema (migration 051's `typeof(x) = 'integer'`
 * CHECKs), the three stores, the IPC contract, this page's own state — an
 * amount is an INTEGER of minor units. 1234 in an RSD account is 12,34 RSD; in
 * a JPY account it is 1234 JPY. How many minor units make a major one is a
 * DISPLAY fact and lives here, which is why there is no scale column anywhere
 * and no `toFixed` anywhere either.
 *
 * **`Intl` does the formatting, all of it, in the ACTIVE interface locale.**
 * Every formatter here is asked for at use time through `intl.ts` (the language
 * switches at runtime), so the group separator, the decimal mark, the space
 * before the code and — the one worth naming — the MINUS SIGN and where it goes
 * are the locale's, never this file's. Nothing here formats an absolute value
 * and prefixes a "-" to it.
 *
 * **The number reaches `Intl` as an exact decimal STRING, not as a division.**
 * `minorUnits / 100` is a double, and at the store's own upper bound it is
 * already wrong: `Number.MAX_SAFE_INTEGER / 100` formats as
 * „90.071.992.547.409,90" — one minor unit short of the truth. Splitting the
 * integer with integer arithmetic and handing `Intl` the digits keeps every
 * amount the ledger can hold exact. `Intl.NumberFormat.prototype.format` takes
 * such a string by contract (Intl.NumberFormat v3); TypeScript models that
 * input as the LITERAL type `${number}`, which no string built at runtime can
 * ever be statically, so `decimalLiteral` asserts its own total, tested output
 * into it — see the note there.
 *
 * **Currencies are named by their ISO CODE, not by a symbol.** This module
 * never converts between two currencies (there is no honest offline exchange
 * rate), so several of them are read side by side on the same screen, and a
 * symbol two of them share — "$" — would make two different totals look like
 * the same money.
 */

import { currencyMinorDigits } from "@nexus/core";
import { decimalSeparator, decimalSeparators, numberFormat } from "./intl.js";

/**
 * The currency formatter for a currency, from `intl.ts`'s per-locale memo.
 *
 * The fraction digits are STATED, from the same table `decimalLiteral` splits
 * the integer with, rather than left to the formatter's own CLDR default. Left
 * to itself, `Intl` writes a currency the way the LOCALE writes it, and for RSD
 * under Chromium's ICU that is zero decimals — Serbia stopped writing para long
 * ago. This module stores 100 minor units to the dinar (migration 051, and this
 * file's own header), so a formatter rounding to zero decimals would silently
 * drop the para off every amount. Passing the digits in is what makes the split
 * and the rendering the same decision instead of two that happen to agree.
 */
function formatterFor(currency: string): Intl.NumberFormat {
  const digits = currencyMinorDigits(currency);
  return numberFormat({
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * How many minor units make one major unit of `currency` — ONE definition, in
 * `@nexus/core` (`csvFinance.ts`), re-exported here because this is the module
 * every screen asks. Reading a bank statement (FIN slice e) is this edge's exact
 * INVERSE — text in major units becoming the integer minor units everything else
 * in FIN speaks — so it needs the identical fact, and two spellings of "how many
 * decimals does RSD have" would be a drift with money on the other side of it.
 */
export { currencyMinorDigits };

/**
 * The exact decimal `Intl` is handed. Total by construction: `minorUnits` is an
 * integer, `digits` is a non-negative integer, so the output always matches
 * `-?\d+(\.\d+)?` — which IS the `${number}` grammar the assertion claims. The
 * assertion is what TypeScript's modelling of Intl's string input costs; there
 * is no runtime-built string that could satisfy that literal type statically.
 *
 * The split is integer arithmetic on purpose: `abs - (abs % scale)` is exact
 * for every safe integer, and dividing that by `scale` yields an exact integer
 * quotient — no float ever holds the amount.
 */
function decimalLiteral(minorUnits: number, digits: number): `${number}` {
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
 * An amount of minor units as the active locale's currency text — „12,34 RSD"
 * in Serbian, „RSD 12.34" in English. The only function in the app that
 * produces a decimal point.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  return formatterFor(currency).format(decimalLiteral(minorUnits, currencyMinorDigits(currency)));
}

/** The code-free formatter for a currency — the currency still decides the fraction digits. */
function plainFormatterFor(currency: string): Intl.NumberFormat {
  const digits = currencyMinorDigits(currency);
  return numberFormat({
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * The same amount WITHOUT its currency code — „1.234.567,89", „-12,34". For a
 * column that already names the money it is in exactly once, at its head: the
 * month report's per-currency sections, where repeating „RSD" down eight rows
 * would be noise rather than information.
 *
 * Everything else is identical to `formatMoney` — the same grouping, the same
 * decimal comma, the same locale-placed minus sign, and the same exact integer
 * split — so the two can never disagree about an amount. The currency argument
 * stays REQUIRED, and that is the point: this module has no way to render an
 * amount without being told which money it is, so a figure summed across two
 * currencies could only be drawn by naming one of them for money that is not
 * all in it.
 */
export function formatMoneyPlain(minorUnits: number, currency: string): string {
  return plainFormatterFor(currency).format(
    decimalLiteral(minorUnits, currencyMinorDigits(currency)),
  );
}

/**
 * The amount as the amount FIELD holds it: the active locale's decimal mark, no
 * grouping and no currency — „12,34" in Serbian, „12.34" in English. Exactly
 * `parseMoneyInput`'s input language, so opening a row for editing and saving it
 * back unchanged is a no-op.
 */
export function moneyInputValue(minorUnits: number, currency: string): string {
  return decimalLiteral(minorUnits, currencyMinorDigits(currency)).replace(".", decimalSeparator());
}

/**
 * A typed amount, in whole and fractional MAJOR units, as minor units — or
 * `null` when the text is not an amount this currency can hold. The inverse of
 * `moneyInputValue`, and the only path by which a number the user typed becomes
 * money.
 *
 * The grammar is deliberately narrow: an optional sign, digits, and at most one
 * separator — the shipped locales' decimal marks, DERIVED from `Intl` through
 * `decimalSeparators()` rather than spelled here, so „12,34" and „12.34" are
 * both read as a decimal point. Grouping is still refused, and that is what
 * makes „1.234" a refusal rather than a guess: with grouping allowed it would
 * mean 1234 to one reader and 1,234 to another, and a ledger that guesses wrong
 * about which is a ledger that quietly holds the wrong number.
 *
 * A fraction longer than the currency's own minor-unit count is refused too,
 * never rounded: „12,345 RSD" is not 12,34 and not 12,35 — it is something the
 * user has to say again.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const match = new RegExp(`^([+-]?)(\\d+)(?:[${decimalClass()}](\\d+))?$`).exec(text.trim());
  if (match === null) return null;
  const [, sign = "", whole = "", fraction] = match;

  const digits = currencyMinorDigits(currency);
  if (fraction !== undefined && fraction.length > digits) return null;

  const scale = 10 ** digits;
  const minorUnits =
    Number(whole) * scale + (fraction === undefined ? 0 : Number(fraction.padEnd(digits, "0")));
  // The store's own bound (`isMinorUnits`), checked here so the field can say
  // so rather than letting a value that cannot survive SQLite reach the wire.
  if (!Number.isSafeInteger(minorUnits)) return null;
  return sign === "-" ? -minorUnits : minorUnits;
}

/**
 * The decimal marks a typed amount may use, as a regex character class body.
 *
 * The union of the shipped locales' marks, because text in a field could have
 * been written by the formatter under either language — the parser has no way to
 * tell, and accepting both is what makes a round trip safe in Serbian AND
 * English. Every character is escaped for a class, so a locale whose mark is a
 * regex metacharacter still works.
 */
function decimalClass(): string {
  return decimalSeparators()
    .map((separator) => separator.replace(/[\\\]^-]/g, "\\$&"))
    .join("");
}
