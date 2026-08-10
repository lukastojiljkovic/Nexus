/**
 * The two languages the floating-point tool reads, and the four it writes.
 *
 * **Why this is not `parseToolNumber`.** The tool drawer's existing grammar
 * ({@link ../tools/numberInput}) deliberately refuses exponent notation and caps
 * at ten decimals, because it serves converters where „1.234" is dangerously
 * ambiguous and where more decimals than that mean a slip of the finger. Neither
 * is true here. The whole subject of this tool is the far end of the number
 * line: `1e-45` is the smallest `fp32` subnormal, `3,4028235e38` is its maximum,
 * and the exact value of an `fp64` subnormal has 750 decimal places. A grammar
 * that could not say those could not describe the thing it exists to describe.
 *
 * What it keeps from the house grammar is the refusal discipline: no digit
 * grouping, one decimal separator (comma or dot, both meaning the point), and
 * text that is not a number comes back as `null` rather than as a guess.
 *
 * **Two fields, two parsers.** A hex string is ambiguous in a tool like this —
 * `0x3F800000` is a bit pattern to one reader and a hexadecimal integer to
 * another — so the ambiguity is resolved by which field the text was typed
 * into rather than by a heuristic. {@link parseFloatValue} reads the value
 * field, {@link parseBitPattern} reads the bit field, and neither tries to be
 * the other. The one concession is C99 hex-float literals (`0x1.8p3`), which the
 * value field does accept, because a `.` or a `p` makes the reading unambiguous
 * and because that notation is the only exact way to type a value by hand.
 */

import {
  type DecodedFloat,
  type DyadicValue,
  type EncodedFloat,
  type FloatFormat,
  type FloatInput,
  type RoundingMode,
  decodeFloat,
  encodeFloat,
  exactDecimal,
  floatBitWidth,
} from "./floatFormats.js";

/** Decimal: an optional sign, digits on at least one side of the point, and an optional exponent. */
const DECIMAL = /^([+-]?)(\d*)(?:[.,](\d*))?(?:[eE]([+-]?\d+))?$/;

/** C99 hex float. The `p` exponent is optional here; a bare `0x1.8` is unambiguous because of the point. */
const HEX_FLOAT = /^([+-]?)0[xX]([0-9a-fA-F]*)(?:[.,]([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/;

const INFINITY = /^([+-]?)(?:inf|infinity|∞)$/i;
const NOT_A_NUMBER = /^[+-]?nan$/i;

/**
 * A value the user typed, exactly, or `null` when the text is not one this
 * grammar admits. Nothing here rounds — the result is a rational, and the
 * rounding happens once, later, against a specific format.
 */
export function parseFloatValue(text: string): FloatInput | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  if (NOT_A_NUMBER.test(trimmed)) return { kind: "nan" };
  const infinite = INFINITY.exec(trimmed);
  if (infinite !== null) return { kind: "infinity", negative: infinite[1] === "-" };

  const hex = HEX_FLOAT.exec(trimmed);
  if (hex !== null) {
    const [, sign = "", whole = "", fraction = "", exponent] = hex;
    if (whole === "" && fraction === "") return null;
    // Each hex digit after the point is four binary places.
    return dyadic(sign === "-", BigInt(`0x0${whole}${fraction}`), Number(exponent ?? 0) - 4 * fraction.length);
  }

  const decimal = DECIMAL.exec(trimmed);
  if (decimal === null) return null;
  const [, sign = "", whole = "", fraction = "", exponent] = decimal;
  if (whole === "" && fraction === "") return null;

  const digits = BigInt(`${whole}${fraction}` === "" ? "0" : `${whole}${fraction}`);
  const power = Number(exponent ?? 0) - fraction.length;
  // A caller can type 1e100000000; the shift below would then allocate a bigint
  // with that many digits. Refuse rather than hang — no format here reaches
  // beyond 1e309, and the extra room is generous.
  if (!Number.isFinite(power) || Math.abs(power) > 5000) return null;

  const scale = 10n ** BigInt(Math.abs(power));
  return power >= 0
    ? { kind: "finite", negative: sign === "-", numerator: digits * scale, denominator: 1n }
    : { kind: "finite", negative: sign === "-", numerator: digits, denominator: scale };
}

/**
 * `significand × 2^exponent` as a `FloatInput`, or `null` for an exponent so
 * large the shift below would be the whole cost of the program. No format here
 * reaches past `2^1024`, so the ceiling is generous by a factor of twenty.
 */
function dyadic(negative: boolean, significand: bigint, exponent: number): FloatInput | null {
  if (!Number.isFinite(exponent) || Math.abs(exponent) > 20000) return null;
  return exponent >= 0
    ? { kind: "finite", negative, numerator: significand << BigInt(exponent), denominator: 1n }
    : { kind: "finite", negative, numerator: significand, denominator: 1n << BigInt(-exponent) };
}

/**
 * A bit pattern typed into the bit field: hex with or without `0x`, binary with
 * `0b` or as a bare run of the format's exact width, with `_` and spaces free
 * to appear anywhere as grouping.
 *
 * Refuses a value wider than the format rather than truncating it, because a
 * truncated bit pattern is a different number and the tool would then be
 * answering a question nobody asked.
 */
export function parseBitPattern(fmt: FloatFormat, text: string): bigint | null {
  const cleaned = text.trim().replace(/[\s_]/g, "");
  if (cleaned === "") return null;

  const width = floatBitWidth(fmt);
  const read = (digits: string, radix: 2 | 16): bigint | null => {
    const valid = radix === 2 ? /^[01]+$/ : /^[0-9a-fA-F]+$/;
    if (!valid.test(digits)) return null;
    const value = BigInt(`${radix === 2 ? "0b" : "0x"}${digits}`);
    return value >> BigInt(width) === 0n ? value : null;
  };

  if (/^0[bB]/.test(cleaned)) return read(cleaned.slice(2), 2);
  if (/^0[xX]/.test(cleaned)) return read(cleaned.slice(2), 16);
  // A bare run of exactly the format's width in ones and zeros is the bit grid
  // read back; anything else unprefixed is hex, which is how these are written.
  if (cleaned.length === width && /^[01]+$/.test(cleaned)) return read(cleaned, 2);
  return read(cleaned, 16);
}

/** A bit pattern written out, as the three fields and as whole words. */
export interface BitPatternText {
  /** Uppercase, `0x`-prefixed, padded to the format's nibble count. */
  readonly hex: string;
  /** Every bit, padded to the format's width, no prefix. */
  readonly binary: string;
  /** The sign bit, or `""` for a format that has none. */
  readonly signBits: string;
  readonly exponentBits: string;
  readonly mantissaBits: string;
}

/** The bit pattern as text, split at the field boundaries the format defines. */
export function formatBitPattern(fmt: FloatFormat, bits: bigint): BitPatternText {
  const width = floatBitWidth(fmt);
  const binary = (bits & ((1n << BigInt(width)) - 1n)).toString(2).padStart(width, "0");
  return {
    hex: `0x${bits.toString(16).toUpperCase().padStart(Math.ceil(width / 4), "0")}`,
    binary,
    signBits: binary.slice(0, fmt.signBits),
    exponentBits: binary.slice(fmt.signBits, fmt.signBits + fmt.exponentBits),
    mantissaBits: binary.slice(fmt.signBits + fmt.exponentBits),
  };
}

/**
 * The shortest decimal that reads back as the same `double` — what `String`
 * prints, and what most tools show as "the value".
 *
 * It is shown next to {@link exactDecimal}, never instead of it. The pair is the
 * point: for the `fp32` nearest to 0,1 this says „0.10000000149011612" and the
 * exact expansion says „0.100000001490116119384765625", and a reader who has
 * only ever seen the first has been told the number is something it is not.
 */
export function shortestDecimal(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  return Object.is(value, -0) ? "-0" : String(value);
}

/** Swaps the decimal point for the Serbian comma. Display only — never feed the result back to a parser. */
export function localizeDecimal(text: string): string {
  return text.replace(".", ",");
}

/** One format's answer for one value: what it stored, and what that costs. */
export interface FloatConversion {
  readonly format: FloatFormat;
  readonly encoded: EncodedFloat;
  readonly decoded: DecodedFloat;
  /** The exact decimal the format actually holds, or a special value's name. */
  readonly stored: string;
  /**
   * `(stored − requested) / requested`, as a `double`, or `null` when the input
   * was zero or a special value and a relative error would be meaningless.
   */
  readonly relativeError: number | null;
}

/**
 * The same value in every format at once — the view the tool is actually opened
 * for, since the question is almost never „what is this in fp16" but „which of
 * these can hold it".
 */
export function convertAcross(
  input: FloatInput,
  formats: readonly FloatFormat[],
  mode: RoundingMode = "nearest-even",
): readonly FloatConversion[] {
  return formats.map((fmt) => {
    const encoded = encodeFloat(fmt, input, mode);
    const decoded = decodeFloat(fmt, encoded.bits);
    return {
      format: fmt,
      encoded,
      decoded,
      stored: decoded.exact === null ? shortestDecimal(decoded.value) : exactDecimal(decoded.exact),
      relativeError: relativeError(input, decoded.exact),
    };
  });
}

/**
 * How far the stored value fell from the requested one, as a fraction.
 *
 * Computed on the exact rationals and only then narrowed to a `double`, so the
 * figure is the error in the conversion rather than the error in measuring it.
 */
function relativeError(input: FloatInput, stored: DyadicValue | null): number | null {
  if (input.kind !== "finite" || input.numerator === 0n || stored === null) return null;

  // stored = s × 2^e, requested = n / d → (stored − requested) / requested
  // = (s × 2^e × d − n) / n, with the 2^e folded into whichever side keeps
  // everything integral.
  const shift = BigInt(Math.abs(stored.exponent));
  const scaled = stored.exponent >= 0 ? stored.significand << shift : stored.significand;
  const denominator = stored.exponent >= 0 ? 1n : 1n << shift;

  const storedSign = stored.negative ? -1n : 1n;
  const requestedSign = input.negative ? -1n : 1n;
  const difference = storedSign * scaled * input.denominator - requestedSign * input.numerator * denominator;
  const reference = requestedSign * input.numerator * denominator;

  return ratioToNumber(difference, reference);
}

/** `a / b` as a `double`, keeping enough digits that the quotient is not itself the error. */
function ratioToNumber(a: bigint, b: bigint): number {
  if (b === 0n) return Number.NaN;
  if (a === 0n) return 0;
  // Scale by 2^64 before dividing so a tiny ratio does not floor to zero, then
  // scale back — the same trick a fixed-point divide uses, and enough precision
  // that the `double` at the end is the limiting factor.
  const scaled = (a << 64n) / b;
  return Number(scaled) / 2 ** 64;
}
