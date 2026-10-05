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
 * The locale is the ACTIVE interface locale, read through `intl.ts` so a runtime
 * language switch is followed; `Intl.NumberFormat` is memoised per locale and
 * precision because a professional surface formats every visible figure on every
 * keystroke.
 */

import { decimalSeparator, groupSeparator, numberFormat } from "../intl.js";

function formatterFor(digits: number): Intl.NumberFormat {
  return numberFormat({
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  });
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

/**
 * A typed field read back as a number \u2014 and, above everything else, the exact
 * INVERSE of `proNum`.
 *
 * **This is here because the drawer could not read what the drawer had just
 * written.** `proNum` formats in the active locale, which in Serbian groups with
 * a full stop and separates decimals with a comma \u2014 1 234 567,89 prints as
 * \u201e1.234.567,89" \u2014 and the other way round in English. The one-line parse every
 * surface was about to copy \u2014 `text.replace(",", ".")` and
 * `Number(...)` \u2014 turns that into \u201e1.234.567.89", which is `NaN`, which the
 * surface reads as \u201ethe field is empty". Copy a result out of one tool, paste it
 * into the next, and the second tool silently shows nothing. Nothing about that
 * looks like a defect: an empty field renders exactly like an untouched one.
 *
 * So the rules are stated as the inverse of the formatter, not as a guess:
 *
 *  - **Both separators present** \u2014 the LAST one is the decimal separator and the
 *    other is grouping. \u201e1.234,56" and \u201e1,234.56" are both 1234,56, which is
 *    what every locale means by them.
 *  - **One separator, repeated** \u2014 it is grouping. \u201e1.234.567" is 1234567.
 *  - **A lone comma** \u2014 the decimal separator. This is what a Serbian keyboard
 *    produces and what the app prints.
 *  - **A lone full stop** \u2014 the decimal point, EXCEPT in the one shape that is
 *    the formatter's own output for a whole number: one to three digits, a stop,
 *    exactly three digits. \u201e1.234" is 1234 and \u201e1.23" is 1,23.
 *
 * That last case is genuinely ambiguous in any locale, and it is decided by
 * asking which misreading is REACHABLE. \u201e1.234" is exactly what `proNum(1234, 0)`
 * prints, so reading it as 1,234 is a thousandfold error a person can produce by
 * copying a tile count out of one tool and pasting it into the next \u2014 inside this
 * app, following its own convention. The opposite misreading needs a person to
 * type a decimal point in a drawer where every number on screen uses a comma.
 * The first is a bug in the product; the second is a habit the product corrects.
 * And `ToolInputEcho`, which every tool renders, is what keeps the residual case
 * harmless: the echo prints the number that was PARSED, so a value read a
 * thousand times too large is visible in the result rather than hidden in the
 * field.
 *
 * Whitespace goes first, including the non-breaking and thin spaces that arrive
 * with a value pasted from a spreadsheet. Anything left that is not a digit, a
 * separator or a leading sign refuses \u2014 no hex, no exponent, no \u201eInfinity",
 * because a professional field receiving one of those is a paste that went
 * wrong, and `Number` would accept all three.
 */
/** A separator as a regex body: the shipped marks are `.` and `,`, but escaping keeps a future one honest. */
function escapeForRegExp(separator: string): string {
  return separator.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function proParse(text: string): number | undefined {
  const compact = text.replace(/[\s\u00a0\u202f\u2009]/g, "");
  if (!/^[-+]?[\d.,]+$/.test(compact) || !/\d/.test(compact)) return undefined;

  const negative = compact.startsWith("-");
  const body = compact.replace(/^[-+]/, "");
  // The reader's own marks, derived from `Intl` rather than spelled: Serbian
  // groups with "." and separates with ",", English the other way round. The
  // decision below therefore follows the ACTIVE language, so a figure the
  // drawer printed is read back the same way in both.
  const decimal = decimalSeparator();
  const group = groupSeparator();
  const lastDecimal = body.lastIndexOf(decimal);
  const lastGroup = body.lastIndexOf(group);
  const decimalCount = body.split(decimal).length - 1;
  const groupCount = body.split(group).length - 1;

  let decimalAt = -1;
  if (lastDecimal >= 0 && lastGroup >= 0) {
    // With both marks present the LAST one is the decimal separator, and it may
    // appear only once; the other one groups, and grouping may repeat.
    // „1.234,56.7" has two dots behind a lone decimal comma, which is not a
    // number anybody meant; reading it as 123456,7 would be an invention.
    decimalAt = Math.max(lastDecimal, lastGroup);
    if ((lastDecimal > lastGroup ? decimalCount : groupCount) !== 1) return undefined;
  } else if (decimalCount + groupCount > 1) {
    // One kind of separator, repeated — grouping in either language.
    decimalAt = -1;
  } else if (decimalCount === 1) {
    // The reader's own decimal mark, alone: a decimal point.
    decimalAt = lastDecimal;
  } else if (groupCount === 1) {
    // The reader's grouping mark, alone. Three digits after it is what the
    // formatter prints for a whole number („1.234" in Serbian, „1,234" in
    // English); anything else is a decimal mark that happened to be the other
    // character („1.23" is 1,23 in Serbian).
    const groups = new RegExp(`^\\d{1,3}(?:${escapeForRegExp(group)}\\d{3})+$`);
    decimalAt = groups.test(body) ? -1 : lastGroup;
  }

  const whole = (decimalAt < 0 ? body : body.slice(0, decimalAt)).replace(/[.,]/g, "");
  const fraction = decimalAt < 0 ? "" : body.slice(decimalAt + 1);
  // The fraction may not carry a separator of its own: \u201e1.234,56.7" is not a
  // number anybody meant, and guessing at it is worse than declining it.
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return undefined;

  const value = Number(`${whole === "" ? "0" : whole}.${fraction === "" ? "0" : fraction}`);
  if (!Number.isFinite(value)) return undefined;
  // Never \u22120: it survives the arithmetic and prints as \u201e\u22120,00".
  return value === 0 ? 0 : negative ? -value : value;
}
