/**
 * Floating-point formats, as a table of facts rather than as fifteen functions.
 *
 * **Why a descriptor table.** Every format here is the same idea with different
 * field widths — a sign, a biased exponent, a mantissa with an implied leading
 * bit — and the places they genuinely differ are few enough to name: how many
 * bits each field gets, what the bias is, whether subnormals exist, and which
 * bit patterns are stolen for infinity and NaN. Writing `fp16ToDecimal`,
 * `bf16ToDecimal`, `e4m3ToDecimal` … would be the same arithmetic fifteen times,
 * and the fifteenth copy is where the bug lives. So the arithmetic is written
 * once and the formats are data. Adding one is a row.
 *
 * **The three families of special values, because this is where naive
 * implementations are wrong.** IEEE 754 reserves the all-ones exponent: mantissa
 * zero is ±∞ and anything else is NaN. The 8-bit formats that came out of the
 * machine-learning world could not afford that — an exponent field of four bits
 * has only sixteen values and giving one away costs half the dynamic range — so
 * they redefine it, and they do not all redefine it the same way:
 *
 * - `ieee` — the classic. `fp64`, `fp32`, `fp16`, `bf16`, `tf32`, `fp8-e5m2`.
 * - `fn` — *finite*: no infinities at all. The all-ones exponent is an ordinary
 *   exponent, and only the single pattern with an all-ones mantissa as well is
 *   NaN. This buys `fp8-e4m3` a maximum of 448 where an IEEE reading of the same
 *   bits would stop at 240.
 * - `fnuz` — *finite, unsigned zero*: no infinities, no negative zero, and one
 *   single NaN, the pattern with the sign bit set and everything else clear. The
 *   bias is one larger than the IEEE-shaped sibling to compensate. This is the
 *   AMD/Graphcore reading of the same eight bits, and it is not interchangeable
 *   with `fn`: the same byte means a different number in each.
 * - `none` — no infinity and no NaN whatsoever; every bit pattern is a finite
 *   number. The OCP microscaling element formats (`mxfp4`, `mxfp6`) work this
 *   way, because a four-bit element cannot spare a pattern either.
 *
 * **Everything here is exact.** A conversion tool that rounds twice is a
 * conversion tool that is sometimes wrong in the last bit, which is the only bit
 * anybody consults it about. So decimal text is parsed into an exact rational
 * and rounded straight to the target format with `bigint` arithmetic — never via
 * a `double` intermediate — and a decoded value is reported both as the nearest
 * `double` and as its exact decimal expansion, which for a binary fraction
 * always terminates and is frequently not what `String(value)` prints.
 *
 * Sources for the field widths and biases: IEEE 754-2019 for `fp64`/`fp32`/
 * `fp16`; the Open Compute Project *OCP 8-bit Floating Point Specification
 * (OFP8) v1.0* for `fp8-e4m3`/`fp8-e5m2`; the OCP *Microscaling Formats (MX)
 * Specification v1.0* for `mxfp4`, `mxfp6` and the `e8m0` shared scale; NVIDIA's
 * published TensorFloat-32 definition for `tf32`; Google Brain's `bfloat16`.
 */

/** How a format spends the bit patterns IEEE 754 would reserve. See the header. */
export type FloatSpecials = "ieee" | "fn" | "fnuz" | "none";

/** The formats this module knows, in the order a picker should offer them. */
export const FLOAT_FORMAT_IDS = [
  "fp64",
  "fp32",
  "tf32",
  "bf16",
  "fp16",
  "fp8-e5m2",
  "fp8-e4m3",
  "fp8-e5m2fnuz",
  "fp8-e4m3fnuz",
  "mxfp6-e3m2",
  "mxfp6-e2m3",
  "mxfp4",
  "e8m0",
] as const;

export type FloatFormatId = (typeof FLOAT_FORMAT_IDS)[number];

/**
 * One format, entirely. Everything else in this module is derived from these
 * seven numbers — there is no per-format code anywhere below.
 */
export interface FloatFormat {
  readonly id: FloatFormatId;
  /** The name the specification uses, for the reader of the code. UI copy lives in the strings table. */
  readonly label: string;
  /** One, except for `e8m0`, which is a magnitude-only scale factor and has no sign. */
  readonly signBits: 0 | 1;
  readonly exponentBits: number;
  readonly mantissaBits: number;
  /** Subtracted from the raw exponent field. `fnuz` formats carry a bias one larger than their `fn` sibling. */
  readonly bias: number;
  readonly specials: FloatSpecials;
  /**
   * Whether an exponent field of zero means "gradual underflow" (significand
   * `0.mantissa`, exponent pinned at `1 - bias`) or is simply the smallest
   * ordinary exponent. Only `e8m0` sets this false, and that is why `e8m0`
   * cannot represent zero at all.
   */
  readonly subnormals: boolean;
}

const format = (
  id: FloatFormatId,
  label: string,
  exponentBits: number,
  mantissaBits: number,
  bias: number,
  specials: FloatSpecials,
  overrides: Partial<Pick<FloatFormat, "signBits" | "subnormals">> = {},
): FloatFormat => ({
  id,
  label,
  signBits: overrides.signBits ?? 1,
  exponentBits,
  mantissaBits,
  bias,
  specials,
  subnormals: overrides.subnormals ?? true,
});

/** Every known format, by id. */
export const FLOAT_FORMATS: Readonly<Record<FloatFormatId, FloatFormat>> = {
  fp64: format("fp64", "IEEE 754 binary64", 11, 52, 1023, "ieee"),
  fp32: format("fp32", "IEEE 754 binary32", 8, 23, 127, "ieee"),
  // 19 bits wide, not 32: NVIDIA's TensorFloat-32 keeps binary32's exponent range
  // and binary16's precision, and the "32" in the name is the register it travels
  // in rather than the size of the number.
  tf32: format("tf32", "NVIDIA TensorFloat-32", 8, 10, 127, "ieee"),
  bf16: format("bf16", "bfloat16", 8, 7, 127, "ieee"),
  fp16: format("fp16", "IEEE 754 binary16", 5, 10, 15, "ieee"),
  "fp8-e5m2": format("fp8-e5m2", "OCP FP8 E5M2", 5, 2, 15, "ieee"),
  "fp8-e4m3": format("fp8-e4m3", "OCP FP8 E4M3", 4, 3, 7, "fn"),
  "fp8-e5m2fnuz": format("fp8-e5m2fnuz", "FP8 E5M2FNUZ", 5, 2, 16, "fnuz"),
  "fp8-e4m3fnuz": format("fp8-e4m3fnuz", "FP8 E4M3FNUZ", 4, 3, 8, "fnuz"),
  "mxfp6-e3m2": format("mxfp6-e3m2", "OCP MXFP6 E3M2", 3, 2, 3, "none"),
  "mxfp6-e2m3": format("mxfp6-e2m3", "OCP MXFP6 E2M3", 2, 3, 1, "none"),
  mxfp4: format("mxfp4", "OCP MXFP4 E2M1", 2, 1, 1, "none"),
  // The MX shared scale: a bare power of two, no sign and no mantissa, with the
  // all-ones field reserved for NaN. It has no subnormals and therefore no zero,
  // which is deliberate — a block scale of zero would erase the block.
  e8m0: format("e8m0", "OCP MX scale E8M0", 8, 0, 127, "ieee", {
    signBits: 0,
    subnormals: false,
  }),
};

/** Total width in bits. `tf32` is 19 and `mxfp4` is 4; nothing here assumes a byte multiple. */
export function floatBitWidth(fmt: FloatFormat): number {
  return fmt.signBits + fmt.exponentBits + fmt.mantissaBits;
}

/** The largest exponent field that still denotes a number rather than ∞ or NaN. */
function maxExponentField(fmt: FloatFormat): number {
  return (1 << fmt.exponentBits) - (fmt.specials === "ieee" ? 2 : 1);
}

/**
 * Whether the format has an ∞ at all.
 *
 * IEEE's reserved exponent splits into ∞ and NaN by the mantissa — so a format
 * with no mantissa bits has one reserved pattern rather than two, and the
 * specification spends it on NaN. That is `e8m0`, and it is why this is a test
 * rather than `specials === "ieee"` at each of the four sites that ask.
 */
function hasInfinity(fmt: FloatFormat): boolean {
  return fmt.specials === "ieee" && fmt.mantissaBits > 0;
}

/** The largest mantissa field available at `maxExponentField`. `fn` loses the top one to NaN. */
function maxMantissaAtTop(fmt: FloatFormat): bigint {
  const full = (1n << BigInt(fmt.mantissaBits)) - 1n;
  return fmt.specials === "fn" ? full - 1n : full;
}

/** Unbiased exponent of a value stored with this raw exponent field. */
function exponentOf(fmt: FloatFormat, field: number): number {
  return field === 0 && fmt.subnormals ? 1 - fmt.bias : field - fmt.bias;
}

/**
 * The exponent of the smallest positive step the format can take — the quantum
 * of its subnormal range, or of its smallest normal range when it has none.
 */
function minQuantumExponent(fmt: FloatFormat): number {
  return (fmt.subnormals ? 1 : 0) - fmt.bias - fmt.mantissaBits;
}

/** What a decoded bit pattern turned out to be. */
export type FloatClass = "zero" | "subnormal" | "normal" | "infinity" | "nan";

/** A number as a sign and an exact dyadic rational: `(-1)^negative × significand × 2^exponent`. */
export interface DyadicValue {
  readonly negative: boolean;
  /** Non-negative. Zero only for the value zero. */
  readonly significand: bigint;
  readonly exponent: number;
}

/** Everything a bit pattern says about itself. */
export interface DecodedFloat {
  readonly format: FloatFormat;
  readonly bits: bigint;
  readonly classification: FloatClass;
  readonly negative: boolean;
  /** The exponent field exactly as stored. */
  readonly exponentField: number;
  /** The exponent after the bias is removed. Meaningless for ∞ and NaN. */
  readonly exponent: number;
  /** The mantissa field exactly as stored, without the implied leading bit. */
  readonly mantissaField: bigint;
  /** `1` for a normal number, `0` for a subnormal — the bit the encoding does not store. */
  readonly implicitBit: 0 | 1;
  /** The value as `significand × 2^exponent`, exact. `null` for ∞ and NaN. */
  readonly exact: DyadicValue | null;
  /** The nearest `double`. Every format here except `fp64` is a strict subset of `double`, so this is exact for them. */
  readonly value: number;
}

/** Pulls one field out of a bit pattern. */
function fieldOf(bits: bigint, offset: number, width: number): bigint {
  return (bits >> BigInt(offset)) & ((1n << BigInt(width)) - 1n);
}

/**
 * A bit pattern, read as the format says to read it.
 *
 * `bits` is masked to the format's width rather than rejected when it is wider,
 * because the callers that produce it (a hex field, a bit-toggle grid) are all
 * happier handing over an integer than policing its range.
 */
export function decodeFloat(fmt: FloatFormat, rawBits: bigint): DecodedFloat {
  const width = floatBitWidth(fmt);
  const bits = rawBits & ((1n << BigInt(width)) - 1n);

  const negative = fmt.signBits === 1 && fieldOf(bits, width - 1, 1) === 1n;
  const exponentField = Number(fieldOf(bits, fmt.mantissaBits, fmt.exponentBits));
  const mantissaField = fieldOf(bits, 0, fmt.mantissaBits);

  const classification = classify(fmt, negative, exponentField, mantissaField);
  const subnormal = classification === "subnormal";
  const implicitBit: 0 | 1 = subnormal || classification === "zero" ? 0 : 1;
  const exponent = exponentOf(fmt, exponentField);

  const base = {
    format: fmt,
    bits,
    classification,
    negative,
    exponentField,
    exponent,
    mantissaField,
    implicitBit,
  } as const;

  if (classification === "infinity" || classification === "nan") {
    return { ...base, exact: null, value: classification === "nan" ? Number.NaN : signed(negative, Infinity) };
  }

  const significand = (BigInt(implicitBit) << BigInt(fmt.mantissaBits)) | mantissaField;
  const exact: DyadicValue = { negative, significand, exponent: exponent - fmt.mantissaBits };
  return { ...base, exact, value: dyadicToNumber(exact) };
}

function signed(negative: boolean, magnitude: number): number {
  return negative ? -magnitude : magnitude;
}

function classify(
  fmt: FloatFormat,
  negative: boolean,
  exponentField: number,
  mantissaField: bigint,
): FloatClass {
  const top = (1 << fmt.exponentBits) - 1;

  if (fmt.specials === "ieee" && exponentField === top) {
    return mantissaField === 0n && hasInfinity(fmt) ? "infinity" : "nan";
  }
  if (fmt.specials === "fn" && exponentField === top && mantissaField === (1n << BigInt(fmt.mantissaBits)) - 1n) {
    return "nan";
  }
  // `fnuz` spends exactly one pattern on NaN — sign set, every other bit clear —
  // which is why it has no negative zero to spend it on.
  if (fmt.specials === "fnuz" && negative && exponentField === 0 && mantissaField === 0n) {
    return "nan";
  }

  if (exponentField !== 0 || !fmt.subnormals) return "normal";
  return mantissaField === 0n ? "zero" : "subnormal";
}

/**
 * `significand × 2^exponent` as a `double`.
 *
 * The multiplication is a single correctly-rounded operation, so for every
 * format here it is exact: all of them except `fp64` fit inside a `double` with
 * room to spare, and `fp64`'s own extremes (`2^-1074` at the bottom,
 * `(2^53−1) × 2^971` at the top) are each representable.
 */
function dyadicToNumber(v: DyadicValue): number {
  return signed(v.negative, Number(v.significand) * 2 ** v.exponent);
}

/**
 * The exact decimal expansion of `significand × 2^exponent`. Always finite: a
 * binary fraction is a decimal fraction, because 2 divides 10.
 *
 * This is not `String(value)`, and the difference is the reason the function
 * exists. `String` prints the shortest text that reads back as the same double —
 * for the `fp32` nearest 0,1 that is „0,10000000149011612", which is a true
 * statement about round-tripping and a false statement about the number. The
 * number is 0,100000001490116119384765625, and a tool asked what a bit pattern
 * *is* should answer that.
 */
export function exactDecimal(v: DyadicValue): string {
  const sign = v.negative && v.significand !== 0n ? "-" : "";
  if (v.significand === 0n) return `${v.negative ? "-" : ""}0`;

  if (v.exponent >= 0) return `${sign}${v.significand << BigInt(v.exponent)}`;

  // n / 2^k = (n × 5^k) / 10^k — multiply out and place the point by counting.
  const k = -v.exponent;
  const digits = (v.significand * 5n ** BigInt(k)).toString().padStart(k + 1, "0");
  const whole = digits.slice(0, digits.length - k);
  const fraction = digits.slice(digits.length - k).replace(/0+$/, "");
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/** Rounding modes, named as IEEE 754 names them. */
export type RoundingMode =
  | "nearest-even"
  | "nearest-away"
  | "toward-zero"
  | "toward-positive"
  | "toward-negative";

/**
 * What a format without infinities does when a value is too large for it.
 *
 * There is no single right answer and that is the point: NVIDIA's hardware cast
 * instructions saturate to the largest finite value, while the OCP reference
 * conversion produces NaN. A tool that silently picked one would be telling half
 * its users the wrong thing, so the choice is exposed and the default is only a
 * default.
 */
export type OverflowBehaviour = "saturate" | "nan" | "infinity";

/** A value on its way into a format, before it is rounded. */
export type FloatInput =
  | { readonly kind: "finite"; readonly negative: boolean; readonly numerator: bigint; readonly denominator: bigint }
  | { readonly kind: "infinity"; readonly negative: boolean }
  | { readonly kind: "nan" };

/** The outcome of forcing a value into a format. */
export interface EncodedFloat {
  readonly format: FloatFormat;
  readonly bits: bigint;
  /** True when the format holds the value exactly and nothing was decided by the rounding mode. */
  readonly exact: boolean;
  /** Set when the magnitude exceeded what the format can hold, whatever was then done about it. */
  readonly overflow: boolean;
  /** Set when a non-zero value came out as zero. */
  readonly underflow: boolean;
  /**
   * Set when a signed value lost its sign because the format has no such
   * pattern — only `fnuz` reaching for negative zero, and `e8m0`, which has no
   * sign bit at all.
   */
  readonly signLost: boolean;
}

/** `numerator / denominator`, both positive, as a fraction of the target's quantum. */
function roundQuotient(
  numerator: bigint,
  denominator: bigint,
  quantum: number,
  mode: RoundingMode,
  negative: boolean,
): bigint {
  let n = numerator;
  let d = denominator;
  if (quantum >= 0) d <<= BigInt(quantum);
  else n <<= BigInt(-quantum);

  const q = n / d;
  const remainder = n % d;
  if (remainder === 0n) return q;

  const twice = remainder * 2n;
  switch (mode) {
    case "toward-zero":
      return q;
    case "toward-positive":
      return negative ? q : q + 1n;
    case "toward-negative":
      return negative ? q + 1n : q;
    case "nearest-away":
      return twice >= d ? q + 1n : q;
    case "nearest-even":
      if (twice > d) return q + 1n;
      if (twice < d) return q;
      return (q & 1n) === 0n ? q : q + 1n;
  }
}

const bitLength = (v: bigint): number => v.toString(2).length;

/** `floor(log2(n / d))` for positive `n` and `d`, exactly. */
function floorLog2(n: bigint, d: bigint): number {
  // The bit-length difference is within one of the answer; the two loops each
  // run at most once, and are written as loops so the result does not depend on
  // that being true.
  let e = bitLength(n) - bitLength(d);
  const atLeast = (k: number): boolean => (k >= 0 ? n >= d << BigInt(k) : n << BigInt(-k) >= d);
  while (!atLeast(e)) e -= 1;
  while (atLeast(e + 1)) e += 1;
  return e;
}

/**
 * Round a value into a format and return its bit pattern.
 *
 * The rounding is done once, on the exact input, in integer arithmetic. Nothing
 * here passes through a `double` on the way — that would round twice, and a
 * value that is exactly halfway for the target is precisely the case a person
 * consults this tool about.
 */
export function encodeFloat(
  fmt: FloatFormat,
  input: FloatInput,
  mode: RoundingMode = "nearest-even",
  overflow: OverflowBehaviour = defaultOverflow(fmt),
): EncodedFloat {
  const width = floatBitWidth(fmt);
  const signBit = (negative: boolean): bigint =>
    fmt.signBits === 1 && negative ? 1n << BigInt(width - 1) : 0n;
  const done = (
    bits: bigint,
    flags: Partial<Omit<EncodedFloat, "format" | "bits">> = {},
  ): EncodedFloat => ({
    format: fmt,
    bits,
    exact: flags.exact ?? true,
    overflow: flags.overflow ?? false,
    underflow: flags.underflow ?? false,
    signLost: flags.signLost ?? false,
  });

  if (input.kind === "nan") return done(nanBits(fmt), { exact: canHoldNaN(fmt) });
  if (input.kind === "infinity") {
    if (hasInfinity(fmt)) {
      return done(signBit(input.negative) | (BigInt(maxExponentField(fmt) + 1) << BigInt(fmt.mantissaBits)), {
        signLost: fmt.signBits === 0 && input.negative,
      });
    }
    return overflowResult(fmt, input.negative, overflow, mode, done, signBit);
  }

  const { negative, numerator, denominator } = input;

  // `e8m0` cannot say zero at all, and `fnuz` spent its negative zero on NaN —
  // so writing `signBit(negative)` for a zero would encode NaN there. Both
  // losses are reported rather than left for the caller to notice.
  const zero = (flags: Partial<Omit<EncodedFloat, "format" | "bits">> = {}): EncodedFloat => {
    const signedZero = fmt.signBits === 1 && fmt.specials !== "fnuz";
    return done(negative && signedZero ? signBit(true) : 0n, {
      ...flags,
      signLost: negative && !signedZero,
      ...(fmt.subnormals ? {} : { exact: false, underflow: true }),
    });
  };

  if (numerator === 0n) return zero();

  const minQuantum = minQuantumExponent(fmt);
  let quantum = Math.max(floorLog2(numerator, denominator) - fmt.mantissaBits, minQuantum);
  let significand = roundQuotient(numerator, denominator, quantum, mode, negative);

  // Rounding up can carry into the next binade. The result is then exactly the
  // power of two, so halving it is exact and no second rounding is needed. This
  // only happens when the value was inexact, so `quantum` moving does not
  // disturb the exactness test below.
  if (significand === 2n << BigInt(fmt.mantissaBits)) {
    significand >>= 1n;
    quantum += 1;
  }

  const inexact = !isExactAtQuantum(numerator, denominator, quantum);

  if (significand === 0n) return zero({ exact: false, underflow: true });

  const subnormal = significand < 1n << BigInt(fmt.mantissaBits);
  const exponentField = subnormal ? 0 : quantum + fmt.mantissaBits + fmt.bias;
  const mantissaField = significand & ((1n << BigInt(fmt.mantissaBits)) - 1n);

  const top = maxExponentField(fmt);
  if (exponentField > top || (exponentField === top && mantissaField > maxMantissaAtTop(fmt))) {
    return overflowResult(fmt, negative, overflow, mode, done, signBit);
  }

  const signLost = negative && fmt.signBits === 0;
  return done(
    signBit(negative) | (BigInt(exponentField) << BigInt(fmt.mantissaBits)) | mantissaField,
    { exact: !inexact, signLost },
  );
}

/** Whether `n / d` is a whole number of `2^quantum` steps — the test for a lossless conversion. */
function isExactAtQuantum(n: bigint, d: bigint, quantum: number): boolean {
  const num = quantum >= 0 ? n : n << BigInt(-quantum);
  const den = quantum >= 0 ? d << BigInt(quantum) : d;
  return num % den === 0n;
}

/** IEEE formats go to ∞; the rest have no ∞ to go to, so they saturate by default. See `OverflowBehaviour`. */
function defaultOverflow(fmt: FloatFormat): OverflowBehaviour {
  return hasInfinity(fmt) ? "infinity" : "saturate";
}

function overflowResult(
  fmt: FloatFormat,
  negative: boolean,
  behaviour: OverflowBehaviour,
  mode: RoundingMode,
  done: (bits: bigint, flags?: Partial<Omit<EncodedFloat, "format" | "bits">>) => EncodedFloat,
  signBit: (negative: boolean) => bigint,
): EncodedFloat {
  // A directed rounding mode that points back toward zero never produces an
  // infinity, whatever the format allows — IEEE 754 §4.3.2. The magnitude stops
  // at the largest finite value and the overflow flag still says what happened.
  const towardZero =
    mode === "toward-zero" ||
    (mode === "toward-positive" && negative) ||
    (mode === "toward-negative" && !negative);

  const saturate = (): EncodedFloat =>
    done(signBit(negative) | (BigInt(maxExponentField(fmt)) << BigInt(fmt.mantissaBits)) | maxMantissaAtTop(fmt), {
      exact: false,
      overflow: true,
      signLost: negative && fmt.signBits === 0,
    });

  if (towardZero || behaviour === "saturate") return saturate();
  if (behaviour === "infinity" && hasInfinity(fmt)) {
    return done(signBit(negative) | (BigInt(maxExponentField(fmt) + 1) << BigInt(fmt.mantissaBits)), {
      exact: false,
      overflow: true,
      signLost: negative && fmt.signBits === 0,
    });
  }
  if (!canHoldNaN(fmt)) return saturate();
  return done(nanBits(fmt), { exact: false, overflow: true });
}

/** `mxfp4` and `mxfp6` have no NaN pattern at all; everything else does. */
function canHoldNaN(fmt: FloatFormat): boolean {
  return fmt.specials !== "none";
}

/** The canonical quiet NaN, or zero for the formats that have none. */
export function nanBits(fmt: FloatFormat): bigint {
  const top = BigInt((1 << fmt.exponentBits) - 1) << BigInt(fmt.mantissaBits);
  switch (fmt.specials) {
    case "ieee":
      // Quiet: the leading mantissa bit set. `e8m0` has no mantissa and its
      // all-ones field is NaN on its own.
      return fmt.mantissaBits === 0 ? top : top | (1n << BigInt(fmt.mantissaBits - 1));
    case "fn":
      return top | ((1n << BigInt(fmt.mantissaBits)) - 1n);
    case "fnuz":
      return 1n << BigInt(floatBitWidth(fmt) - 1);
    case "none":
      return 0n;
  }
}

/** The largest finite magnitude the format can hold, exactly. */
export function maxFinite(fmt: FloatFormat): DyadicValue {
  const significand = (1n << BigInt(fmt.mantissaBits)) | maxMantissaAtTop(fmt);
  return { negative: false, significand, exponent: exponentOf(fmt, maxExponentField(fmt)) - fmt.mantissaBits };
}

/** The smallest positive value the format can hold — subnormal where it has them. */
export function minPositive(fmt: FloatFormat): DyadicValue {
  return { negative: false, significand: 1n, exponent: minQuantumExponent(fmt) };
}

/** The exponent of the largest finite value — `emax` in IEEE's vocabulary, and what MX scales against. */
export function maxExponent(fmt: FloatFormat): number {
  return exponentOf(fmt, maxExponentField(fmt));
}

/** `floor(log2(|value|))` — which binade a value sits in. `null` for zero and for the specials. */
export function binade(input: FloatInput): number | null {
  if (input.kind !== "finite" || input.numerator === 0n) return null;
  return floorLog2(input.numerator, input.denominator);
}

/** A value divided by `2^power`, exactly. Used to bring a block element into its shared scale. */
export function scaleByPowerOfTwo(input: FloatInput, power: number): FloatInput {
  if (input.kind !== "finite") return input;
  const shift = BigInt(Math.abs(power));
  return power >= 0
    ? { ...input, denominator: input.denominator << shift }
    : { ...input, numerator: input.numerator << shift };
}

/** The distance to the next representable value above this bit pattern's magnitude. */
export function ulp(fmt: FloatFormat, bits: bigint): DyadicValue | null {
  const decoded = decodeFloat(fmt, bits);
  if (decoded.exact === null) return null;
  const quantum = Math.max(decoded.exponent - fmt.mantissaBits, minQuantumExponent(fmt));
  return { negative: false, significand: 1n, exponent: quantum };
}

/**
 * The neighbouring bit patterns in value order, or `null` where there is none.
 *
 * Walking the magnitude field as an integer is exactly walking the number line,
 * which is the property IEEE 754's biased exponent was designed for and which
 * every format here inherits. The sign is handled separately because the
 * encodings are sign-magnitude, not two's complement: the pattern below +0 is
 * −0, not the largest negative.
 */
export function floatNeighbours(fmt: FloatFormat, bits: bigint): {
  readonly below: bigint | null;
  readonly above: bigint | null;
} {
  const width = floatBitWidth(fmt);
  const magnitudeMask = (1n << BigInt(width - fmt.signBits)) - 1n;
  const decoded = decodeFloat(fmt, bits);
  if (decoded.classification === "nan") return { below: null, above: null };

  const magnitude = bits & magnitudeMask;
  const sign = bits & ~magnitudeMask;
  const highest = finiteCeiling(fmt);

  const step = (outward: boolean): bigint | null => {
    if (outward) {
      if (magnitude >= highest) return null;
      return sign | (magnitude + 1n);
    }
    if (magnitude === 0n) return fmt.signBits === 0 ? null : (sign ^ (1n << BigInt(width - 1))) | 1n;
    return sign | (magnitude - 1n);
  };

  const away = step(true);
  const toward = step(false);
  return decoded.negative ? { below: away, above: toward } : { below: toward, above: away };
}

/** The largest magnitude pattern that is still a number — ∞ where there is one, the largest finite otherwise. */
function finiteCeiling(fmt: FloatFormat): bigint {
  const top = BigInt(maxExponentField(fmt)) << BigInt(fmt.mantissaBits);
  return hasInfinity(fmt) ? top + (1n << BigInt(fmt.mantissaBits)) : top | maxMantissaAtTop(fmt);
}
