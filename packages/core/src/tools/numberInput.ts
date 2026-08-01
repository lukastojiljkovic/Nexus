/**
 * The number grammar UTIL's tool fields read and write.
 *
 * **Why this exists rather than reusing `parseAmountInput`.** The renderer
 * already has two parsers in this family — `parseMoneyInput` (money, capped at
 * the currency's minor digits) and `parseAmountInput` (grams, capped at two
 * decimals) — and both caps are right for their fields and wrong for a
 * converter: 0,001 km is a metre, and a length tool that could not express its
 * own smallest unit would be broken by its own input rule. So the CAP is the
 * only thing that changes here; the refusals are theirs exactly.
 *
 * **The refusal discipline, restated because it is the point.** Grouping
 * separators are not accepted at all — „1.234" means 1234 to one reader and
 * 1,234 to another, and a converter that picks one is silently wrong by a
 * factor of a thousand for the other. Too many decimals are refused rather than
 * rounded: a value the user has to say again is better than a value quietly
 * changed under them. Nothing here rounds, ever.
 *
 * A leading sign IS accepted, which is the one place this grammar is wider than
 * `parseAmountInput`'s: temperature runs below zero, and a converter that
 * refused −40 °C would be refusing the one figure everybody tests it with.
 */

/**
 * How many decimals a tool field accepts. Ten: enough for the smallest step any
 * unit here can express against the largest (a millimetre in kilometres is
 * 0,000001, a byte in gibibytes is finer still), and few enough to stay well
 * inside what a double represents exactly.
 */
export const TOOL_MAX_DECIMALS = 10;

/** Optional sign, digits, and at most ONE separator — either comma or dot, both meaning the decimal point. */
const TOOL_NUMBER = /^([+-]?)(\d+)(?:[.,](\d+))?$/;

/**
 * A number the user typed, or `null` when the text is not one this grammar
 * admits. The single path by which text becomes a quantity in the tool drawer.
 */
export function parseToolNumber(text: string, maxDecimals = TOOL_MAX_DECIMALS): number | null {
  const match = TOOL_NUMBER.exec(text.trim());
  if (match === null) return null;
  const [, sign = "", whole = "", fraction] = match;

  if (fraction !== undefined && fraction.length > maxDecimals) return null;

  const value = Number(`${sign}${whole}${fraction === undefined ? "" : `.${fraction}`}`);
  // A long enough run of digits overflows to Infinity; that is a refusal, not a
  // quantity, and it must not reach a conversion.
  return Number.isFinite(value) ? value : null;
}

/** Above this, JavaScript writes a number in exponent notation and no plain-decimal spelling is available cheaply. */
const EXPONENT_THRESHOLD = 1e21;

/** `1e-7` and friends, which `String` produces below 1e-6, split into digits and zero-run. */
const SMALL_EXPONENT = /^(\d)(?:\.(\d+))?e-(\d+)$/;

/**
 * A number as the tool fields hold it — the Serbian decimal comma, no grouping,
 * and never exponent notation. Exactly `parseToolNumber`'s input language, so
 * opening a value for editing and saving it back unchanged is a no-op.
 *
 * `String(value)` is the basis because it produces the SHORTEST text that reads
 * back as the same double: −273,15 stays „-273,15" rather than becoming the
 * „-273,14999999999997726" that any fixed-decimal expansion would reveal. Its
 * one gap is the exponent form, which `parseToolNumber` refuses — so the small
 * end (below 1e-6, where `String` writes „1e-7") is expanded here by hand.
 *
 * At or above 1e21 there is no plain spelling to expand to and the answer is an
 * empty string: a figure that large is not something a person is editing in a
 * field, and an empty field is an honest „nothing to put here" rather than text
 * the parser that filled it would then reject.
 */
export function toolNumberInputValue(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= EXPONENT_THRESHOLD) return "";

  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(value));
  const small = SMALL_EXPONENT.exec(digits);
  const plain =
    small === null
      ? digits
      : `0.${"0".repeat(Number(small[3]) - 1)}${small[1] ?? ""}${small[2] ?? ""}`;

  return `${sign}${plain}`.replace(".", ",");
}
