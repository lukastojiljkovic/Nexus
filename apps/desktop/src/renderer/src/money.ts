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
 * **`Intl` does the formatting, all of it.** The locale is spelled `"sr-Latn"`,
 * exactly as every other formatter in this renderer spells it (the `Intl
 * .Collator`s use `["sr-Latn", "sr"]`, which is the same choice with a
 * fallback: plain `"sr"` resolves to the Cyrillic tailoring). That means the
 * group separator, the decimal comma, the non-breaking space before the code
 * and — the one worth naming — the MINUS SIGN and where it goes are the
 * locale's, never this file's. Nothing here formats an absolute value and
 * prefixes a "-" to it.
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

/** The locale every formatter in this renderer spells (`Intl.DateTimeFormat("sr-Latn", …)` and friends). */
const MONEY_LOCALE = "sr-Latn";

/**
 * One `Intl.NumberFormat` per currency, built on first use. Constructing one is
 * the expensive part of formatting, and a ledger formats every visible row on
 * every render.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  const existing = formatters.get(currency);
  if (existing !== undefined) return existing;
  const created = new Intl.NumberFormat(MONEY_LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "code",
  });
  formatters.set(currency, created);
  return created;
}

/**
 * How many minor units make one major unit of `currency`, read from the
 * currency's own CLDR data rather than assumed: 2 for RSD and EUR, 0 for JPY,
 * 3 for KWD. A well-formed code the runtime has no data for answers 2, which is
 * the ISO default and is what `Intl` itself would use.
 *
 * `currency` must be a validated ISO-4217 code (three upper-case ASCII
 * letters); every code that reaches this module comes out of `fin_accounts`,
 * whose CHECK constraint is exactly that rule.
 */
export function currencyMinorDigits(currency: string): number {
  // `maximumFractionDigits` is optional in the type and always present for a
  // CURRENCY formatter in practice — `Intl` resolves it from the currency's own
  // data (or ISO's default of 2) before this call returns. The fallback is
  // therefore unreachable and matches what would have been resolved anyway.
  return formatterFor(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

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
 * An amount of minor units as Serbian currency text — „12,34 RSD", „-1.234 JPY".
 * The only function in the app that produces a decimal point.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  return formatterFor(currency).format(decimalLiteral(minorUnits, currencyMinorDigits(currency)));
}

/** The code-free formatters, one per currency — the currency still decides the fraction digits. */
const plainFormatters = new Map<string, Intl.NumberFormat>();

function plainFormatterFor(currency: string): Intl.NumberFormat {
  const existing = plainFormatters.get(currency);
  if (existing !== undefined) return existing;
  const digits = currencyMinorDigits(currency);
  const created = new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  plainFormatters.set(currency, created);
  return created;
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
 * The amount as the amount FIELD holds it: the decimal comma, no grouping and
 * no currency — „12,34", „-1234". Exactly `parseMoneyInput`'s input language,
 * so opening a row for editing and saving it back unchanged is a no-op.
 */
export function moneyInputValue(minorUnits: number, currency: string): string {
  return decimalLiteral(minorUnits, currencyMinorDigits(currency)).replace(".", ",");
}

/**
 * A typed amount, in whole and fractional MAJOR units, as minor units — or
 * `null` when the text is not an amount this currency can hold. The inverse of
 * `moneyInputValue`, and the only path by which a number the user typed becomes
 * money.
 *
 * The grammar is deliberately narrow: an optional sign, digits, and at most one
 * separator — either `,` (Serbian) or `.` (what a numeric keypad gives you),
 * both read as the DECIMAL point because grouping is not accepted at all. That
 * is what makes „1.234" a refusal rather than a guess: with grouping allowed it
 * would mean 1234 to one reader and 1,234 to another, and a ledger that guesses
 * wrong about which is a ledger that quietly holds the wrong number.
 *
 * A fraction longer than the currency's own minor-unit count is refused too,
 * never rounded: „12,345 RSD" is not 12,34 and not 12,35 — it is something the
 * user has to say again.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const match = /^([+-]?)(\d+)(?:[.,](\d+))?$/.exec(text.trim());
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
