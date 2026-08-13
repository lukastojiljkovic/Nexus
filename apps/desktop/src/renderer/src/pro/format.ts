/**
 * How „Stručne alatke" writes a number.
 *
 * **One formatter for the whole drawer, and it is not a convenience.** Eighteen
 * toolkits written independently produce eighteen answers to „is it 4.35 or
 * 4,35", and half of those are wrong for a Serbian reader: `toFixed` emits a
 * decimal POINT and no group separator, so a quantity take-off ends up reading
 * „1234567.89" in an app whose every other figure reads „1 234 567,89". Worse,
 * a number formatted one way on screen and another way in the clipboard is a
 * number that changes when it is pasted into the invoice.
 *
 * **Fraction digits are fixed, never „up to".** These are engineering figures:
 * a riser of 167.647 mm and one of 167.600 mm are the same measurement written
 * to the same precision, and dropping the trailing zero makes a column of
 * numbers stop lining up — which is exactly when somebody misreads one. Each
 * call site passes the precision its own catalogue entry specifies.
 *
 * The locale is the app's own `sr-Latn`. `Intl.NumberFormat` is cached per
 * precision because a professional surface formats every visible figure on every
 * keystroke.
 */

const LOCALE = "sr-Latn";

const formatters = new Map<number, Intl.NumberFormat>();

function formatterFor(digits: number): Intl.NumberFormat {
  const cached = formatters.get(digits);
  if (cached !== undefined) return cached;
  const created = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  });
  formatters.set(digits, created);
  return created;
}

/**
 * A quantity, to exactly `digits` decimal places.
 *
 * Non-finite input answers an em dash rather than „NaN" or „∞": a surface that
 * reaches this with a division by zero has a hole in it, and „NaN" on screen
 * looks like a computed value while „—" reads as „not this one" — which is what
 * it is. The tools refuse before they divide, so this is a floor and not a
 * strategy.
 */
export function proNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return formatterFor(digits).format(value);
}

/**
 * A ratio of a computed value to the user's own limit, as a plain number.
 *
 * Three decimals, and deliberately NOT a percentage: „1,043" is a quotient the
 * reader interprets, while „104,3 %" of a limit reads as an overrun that has
 * already been judged. Same numbers, and only one of them is silent.
 */
export function proRatio(value: number | undefined): string | undefined {
  return value === undefined ? undefined : proNum(value, 3);
}

/**
 * A value with its unit, spaced the way SI spaces it — „4,35 m", never „4,35m".
 *
 * A non-breaking space, so a wrapped line can never leave the unit stranded on
 * the next row of a results column — and written as an ESCAPE rather than as the
 * character itself, because a literal U+00A0 in source is indistinguishable from
 * a plain space in every editor and every diff. This repository has already lost
 * a file to a byte no text tool would show (DC-36).
 */
export function proUnit(value: string, unit: string): string {
  return `${value}\u00a0${unit}`;
}
