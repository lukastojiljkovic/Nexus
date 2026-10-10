import { decimalSeparators } from "../../../renderer/src/intl.js";
import { parseMoneyInput } from "../../../renderer/src/money.js";

/**
 * The CAR page's two pure helpers: reading a typed number, and reading a typed
 * money pair.
 *
 * Both are here rather than inline in `Page.tsx` because both are rules a form
 * gets subtly wrong, they are the same rules for every field on the page, and
 * neither needs a DOM to be asked about -- which is what lets a test state the
 * exact answers in both locales.
 */

/**
 * A typed decimal, or `null` when the text is not one.
 *
 * **Both decimal marks are accepted and a SECOND separator is refused**, which
 * is `money.ts`'s own grammar for the same reason: the text in a field may have
 * been written under either shipped language -- the parser cannot tell, and the
 * interface language can have been switched since.
 *
 * The one string this cannot disambiguate is `1.234`, which is one thousand two
 * hundred thirty-four written in Serbian and one-and-a-bit written in English.
 * It is read as the DECIMAL, deliberately, and the ambiguity is closed by the
 * field rather than by a guess here: an odometer, a reading and a month count are
 * whole numbers, so the page refuses a fractional one by name, while a quantity
 * and a price really are decimal. `1,234,567` -- two separators -- is a string
 * no single number writes, and is refused.
 *
 * The marks are DERIVED from `Intl` (`decimalSeparators`) rather than spelled
 * here, so a third locale adds itself.
 */
export function parseDecimal(text: string): number | null {
  const marks = decimalSeparators().map((mark) => mark.replace(/[\\\]^-]/g, "\\$&")).join("");
  const match = new RegExp(`^([+-]?)(\\d+)(?:[${marks}](\\d+))?$`).exec(text.trim());
  if (match === null) return null;
  const [, sign = "", whole = "", fraction] = match;
  const value = Number(fraction === undefined ? whole : `${whole}.${fraction}`);
  if (!Number.isFinite(value)) return null;
  return sign === "-" ? -value : value;
}

/**
 * A money pair as the two columns store it: minor units, and the currency code
 * that names them -- or nothing at all when neither field was filled in.
 *
 * Three answers, and the middle one is the point. `null` means the pair is
 * INCOMPLETE -- an amount with no currency, or a currency with no amount -- and
 * the form has to make the user finish it rather than send it. `{ costMinor:
 * null, currency: null }` means nothing was priced at all, which is a
 * legitimate thing for a service entry or a fill to say. A number beside its
 * code is the money itself.
 *
 * The amount is parsed by `parseMoneyInput`, the one function in the app that
 * turns typed text into money, so a fraction longer than the currency's own
 * minor units is refused here exactly as it is in FIN.
 */
export function moneyPair(
  amount: string,
  currency: string,
): { costMinor: number | null; currency: string | null } | null {
  const code = currency.trim().toUpperCase();
  const text = amount.trim();
  if (code === "" && text === "") return { costMinor: null, currency: null };
  if (code === "" || text === "") return null;
  // The ISO-4217 shape the column's own CHECK states, checked here so the
  // refusal is a sentence on screen rather than a rejected wire call.
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const minorUnits = parseMoneyInput(text, code);
  if (minorUnits === null || minorUnits <= 0) return null;
  return { costMinor: minorUnits, currency: code };
}
