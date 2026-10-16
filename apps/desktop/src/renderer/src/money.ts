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

import {
  currencyMinorDigits,
  decimalLiteral,
  formatMinorUnits,
  minorUnitsFromText,
  moneyFormatOptions,
} from "@nexus/core";
import { decimalSeparator, decimalSeparators, numberFormat } from "./intl.js";

/** The currency formatter for a currency, from `intl.ts`'s per-locale memo; the options and the split are `@nexus/core`'s, shared with the assistant's tools. */
function formatterFor(currency: string): Intl.NumberFormat {
  return numberFormat(moneyFormatOptions(currency, true));
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
 * An amount of minor units as the active locale's currency text — „12,34 RSD"
 * in Serbian, „RSD 12.34" in English. The only function in the app that
 * produces a decimal point.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  return formatMinorUnits(minorUnits, currency, formatterFor(currency));
}

/** The code-free formatter for a currency — the currency still decides the fraction digits. */
function plainFormatterFor(currency: string): Intl.NumberFormat {
  return numberFormat(moneyFormatOptions(currency, false));
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
  return formatMinorUnits(minorUnits, currency, plainFormatterFor(currency));
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
  // The union of the shipped locales' marks: text in a field could have been
  // written by the formatter under either language, and accepting both is what
  // makes a round trip safe in Serbian AND English.
  return minorUnitsFromText(text, currency, decimalSeparators());
}
