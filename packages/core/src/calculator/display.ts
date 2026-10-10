/**
 * The calculator's DISPLAY layer — one pure function, no mathjs, no state.
 *
 * **Why this is not `math.format`.** The engine already renders every result in
 * mathjs's own lexical form (`engine.ts` says why that form is the STORED one),
 * and that form is deliberately not what a calculator shows. `math.format`
 * switches to exponential notation at an exponent of six — `1234567.891` comes
 * back as `1.234567891e+6` — which is correct for a library and unreadable for a
 * person who typed a price. It also writes `.` and `,` in exactly one way, and
 * the product's default locale is Serbian.
 *
 * So the split is: the engine answers WHAT the value is, this answers how it
 * reads. It takes mathjs's canonical text rather than a value, which is the
 * quieter half of the same decision — a display that took a `number` would have
 * to re-render complex numbers, units and matrices itself, and would then be a
 * second, worse copy of mathjs's own printing.
 *
 * **The four rules, and each is a decision rather than a default.**
 *
 *  - **Separators come from the locale**: Serbian groups with `.` and points
 *    with `,` (`1.234,5`), English the other way round (`1,234.5`).
 *  - **GROWING groups of three**, always, and grouping can be switched off
 *    entirely — the option exists because a copy-paste of `1234567.891` into
 *    another programme is a real thing to want.
 *  - **{@link CALCULATOR_DISPLAY_PRECISION} significant digits, then trailing
 *    zeros are dropped.** Fifteen is not a round number picked for looks: it is
 *    the largest count for which a binary double's own reprising round-trips
 *    through decimal text, and it is what makes `0.1 + 0.2` read as `0.3`
 *    instead of `0.30000000000000004` while `1/3` still shows fifteen digits
 *    rather than three. A caller may pass `null` to see every digit the value
 *    carries, which is what the bignumber mode wants.
 *  - **Fixed notation inside `[1e-6, 1e16)` and scientific outside it.** That
 *    window is the one a person can still read a magnitude out of; past either
 *    end the number is a scale, not a quantity, and `1e+100` says so in six
 *    characters where the fixed form would say it in a hundred and one. The
 *    upper end is inclusive of 15 and exclusive of 16 because 1e15 is the last
 *    power of ten a 16-digit grouping reads comfortably.
 */

export const CALCULATOR_LOCALES = ["sr", "en"] as const;
export type CalculatorLocale = (typeof CALCULATOR_LOCALES)[number];

/**
 * How many significant digits the display keeps when the caller does not say.
 * See the file header for why fifteen and not ten or seventeen.
 */
export const CALCULATOR_DISPLAY_PRECISION = 15;

export interface CalculatorFormatOptions {
  locale: CalculatorLocale;
  /** Group the integer digits in threes. */
  grouping: boolean;
  /** Significant digits to round to, or `null` to show the value's own digits. */
  precision: number | null;
}

/** Serbian and grouped, matching the product's default locale. */
export const DEFAULT_CALCULATOR_FORMAT: CalculatorFormatOptions = {
  locale: "sr",
  grouping: true,
  precision: CALCULATOR_DISPLAY_PRECISION,
};

/** The two separators each locale writes with, in the order the page shows them. */
const SEPARATORS: Record<CalculatorLocale, { decimal: string; group: string }> = {
  sr: { decimal: ",", group: "." },
  en: { decimal: ".", group: "," },
};

/**
 * A decimal number as mathjs writes one: an optional sign, digits with an
 * optional fraction, and an optional exponent. Matched inside the canonical
 * text rather than over the whole of it, because a unit, a complex result and a
 * matrix all carry numbers surrounded by their own punctuation.
 */
const NUMBER = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g;

/** Outside this exponent the display is scientific; see the file header. */
const FIXED_MIN_EXPONENT = -6;
const FIXED_MAX_EXPONENT = 15;

/**
 * Renders one canonical value for the reader: every number in the text gets the
 * locale's separators and the requested rounding, and everything between the
 * numbers — a unit's name, the `i` of a complex, a matrix's brackets — is left
 * exactly as mathjs wrote it.
 *
 * Digits inside a QUOTED run are left alone: a variable can hold a string, and
 * the text of `"1234"` is the value the user typed rather than a quantity to
 * group.
 */
export function formatCalculatorDisplay(
  value: string,
  options?: Partial<CalculatorFormatOptions>,
): string {
  const format: CalculatorFormatOptions = { ...DEFAULT_CALCULATOR_FORMAT, ...options };
  const separators = SEPARATORS[format.locale];

  // The two values that are not numbers are named by a symbol a Serbian and an
  // English reader both recognise, and neither carries a digit to group.
  const symbols = value
    .replaceAll("-Infinity", "-\u221e")
    .replaceAll("Infinity", "\u221e");

  let out = "";
  let index = 0;
  for (const token of symbols.matchAll(NUMBER)) {
    const start = token.index;
    const quoted = countQuotes(symbols.slice(index, start)) % 2 === 1;
    out += symbols.slice(index, start);
    out += quoted ? token[0] : formatNumber(token[0], separators, format);
    index = start + token[0].length;
  }
  out += symbols.slice(index);
  return out;
}

/** How many `"` characters a run of text holds — the parity says whether a number sits inside a string literal. */
function countQuotes(text: string): number {
  let count = 0;
  for (const character of text) if (character === '"') count += 1;
  return count;
}

function formatNumber(
  token: string,
  separators: { decimal: string; group: string },
  format: CalculatorFormatOptions,
): string {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(token);
  if (parts === null) return token;
  const sign = parts[1] ?? "";
  const integer = parts[2] ?? "0";
  const fraction = parts[3] ?? "";
  const exponent = Number(parts[4] ?? "0");

  const all = integer + fraction;
  const firstSignificant = all.search(/[1-9]/);
  if (firstSignificant === -1) return `${sign}0`;

  // The power of ten of the leading digit; `integer.length - 1` is where the
  // decimal point sits in `all`, and the leading zeros of a value below one
  // pull it down from there.
  let decimalExponent = integer.length - 1 - firstSignificant + exponent;
  let digits = all.slice(firstSignificant);

  if (format.precision !== null && digits.length > format.precision) {
    const rounded = roundDigits(digits, format.precision);
    digits = rounded.digits;
    decimalExponent += rounded.exponentShift;
  }
  digits = digits.replace(/0+$/, "");
  if (digits.length === 0) return `${sign}0`;

  if (decimalExponent < FIXED_MIN_EXPONENT || decimalExponent > FIXED_MAX_EXPONENT) {
    const mantissa =
      digits.length === 1
        ? digits
        : `${digits.slice(0, 1)}${separators.decimal}${digits.slice(1)}`;
    const power = decimalExponent < 0 ? `-${Math.abs(decimalExponent)}` : `+${decimalExponent}`;
    return `${sign}${mantissa}e${power}`;
  }

  return `${sign}${withGroups(integerAndFraction(digits, decimalExponent), separators, format.grouping)}`;
}

/**
 * Rounds a run of significant digits to `count` of them, half away from zero,
 * and reports how far the decimal exponent moved when the rounding carried
 * (`9.99` to two digits is `10`, which is one decade higher).
 */
function roundDigits(digits: string, count: number): { digits: string; exponentShift: number } {
  const kept = digits.slice(0, count);
  const roundUp = (digits.charCodeAt(count) ?? 48) >= 53;
  if (!roundUp) return { digits: kept, exponentShift: 0 };

  const incremented = (BigInt(kept) + 1n).toString();
  if (incremented.length > count) {
    // 99…9 carried into a new decade: the leading 1 and zeros, one exponent up.
    return { digits: incremented.slice(0, count), exponentShift: 1 };
  }
  return { digits: incremented.padStart(count, "0"), exponentShift: 0 };
}

/** Places the digits either side of the decimal point, padding the fraction with the zeros a scale below one needs. */
function integerAndFraction(digits: string, decimalExponent: number): { integer: string; fraction: string } {
  if (decimalExponent >= 0) {
    const integer = digits.slice(0, decimalExponent + 1).padEnd(decimalExponent + 1, "0");
    return { integer, fraction: digits.slice(decimalExponent + 1) };
  }
  return { integer: "0", fraction: "0".repeat(-decimalExponent - 1) + digits };
}

function withGroups(
  value: { integer: string; fraction: string },
  separators: { decimal: string; group: string },
  grouping: boolean,
): string {
  const integer = grouping
    ? value.integer.replace(/\B(?=(\d{3})+$)/g, separators.group)
    : value.integer;
  return value.fraction.length === 0 ? integer : `${integer}${separators.decimal}${value.fraction}`;
}
