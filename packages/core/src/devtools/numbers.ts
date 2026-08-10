/**
 * Integers as a machine actually holds them — base conversion, fixed-width
 * two's complement, bit operations, and the kilobyte question. Four tools with
 * one subject: a number has a WIDTH and a BASE, and a program can get either
 * wrong without ever looking wrong.
 *
 * **Everything is `bigint`, and that is not a preference.** `Number("0xFFFFFFFFFFFFFFFF")`
 * is 18446744073709552000 — a double has 53 bits of mantissa, so the low eleven
 * bits of a 64-bit value are simply gone, and the answer still reads like an
 * answer. That is the exact failure mode a converter exists to prevent, so no
 * value here ever passes through `number`. The one place `number` survives is
 * `data-unit`, where the quantity is genuinely fractional („1,5 GiB") and the
 * limits are stated in the section itself.
 *
 * **Refuse, do not repair.** Every parser returns `null` for text it does not
 * admit — a digit outside the base, a prefix that names a different base, a
 * separator where no separator belongs. Nothing is coerced into the nearest
 * legal thing, because a value the user has to say again is better than a value
 * quietly changed under them (the rule `numberInput.ts` states and this module
 * inherits).
 *
 * **A value that does not fit its width says so; it never wraps.** That is the
 * whole point of the inspector: 200 is not an `int8`, and the useful answer is
 * „ne staje", not −56. Wrapping is offered only by the bit operations, where it
 * is the subject rather than an accident.
 *
 * **Throws are for caller bugs only.** A base outside 2..36 is a programming
 * error — `isSupportedBase` exists so a surface can check user-typed input
 * before calling — and it throws. No user keystroke can reach a throw.
 */

import { findUnit, type DataConvention } from "../tools/units.js";

// ---------------------------------------------------------------------------
// number-base — an integer moved between bases 2..36
// ---------------------------------------------------------------------------

/** The narrowest base with more than one digit. Base 1 is tally marks, not positional notation. */
export const BASE_MIN = 2;

/** The widest base the digit alphabet 0-9a-z reaches, and the limit `BigInt.prototype.toString` accepts. */
export const BASE_MAX = 36;

/** The bases a converter shows side by side without being asked. */
export const BASE_PRESETS: readonly number[] = [2, 8, 10, 16];

/**
 * Longest input accepted, in characters. A devtool inspects numbers a person is
 * reading, and the digit-accumulate loop below is quadratic in the digit count:
 * without a cap, one pasted megabyte freezes the renderer for minutes. Refusing
 * is honest; hanging is not. Four thousand digits is a 13000-bit number — far
 * past anything anyone inspects by eye.
 */
export const BASE_INPUT_MAX_LENGTH = 4096;

/** Whether `base` is one this module can read and write. A surface validates a user-typed base with this BEFORE calling anything else. */
export function isSupportedBase(base: number): boolean {
  return Number.isInteger(base) && base >= BASE_MIN && base <= BASE_MAX;
}

function assertBase(base: number): void {
  if (!isSupportedBase(base)) {
    throw new RangeError(`base ${base} is outside ${BASE_MIN}..${BASE_MAX}`);
  }
}

/** The base each literal prefix names. Keyed by the letter, lower-cased by the caller. */
const PREFIX_BASES: ReadonlyMap<string, number> = new Map([
  ["b", 2],
  ["o", 8],
  ["x", 16],
]);

/**
 * Characters accepted between digits as grouping. `_` is the numeric separator
 * every modern language spells this way; the three spaces are here because they
 * render IDENTICALLY and a user who pasted a figure from a spreadsheet cannot
 * see which one they got. Refusing an invisible difference is a puzzle, not a
 * safeguard — unlike `.` and `,`, which mean different things to different
 * readers and are refused throughout this codebase.
 */
const GROUP_INPUT: ReadonlySet<string> = new Set(["_", " ", "\u00A0", "\u202F"]);

/** What `formatIntegerInBase` puts between groups. A space: `.` and `,` are the ambiguous pair this codebase refuses everywhere. */
const GROUP_SEPARATOR = " ";

/** How many digits a group holds, per base. Four for the bases that map onto bits (a hex digit is a nibble); three for decimal. Every other base is left ungrouped rather than given an invented convention. */
const GROUP_SIZES: ReadonlyMap<number, number> = new Map([
  [2, 4],
  [16, 4],
  [10, 3],
]);

/** The value of one digit character, 0..35, or −1 for anything that is not a digit. Case-insensitive, since „FF" and „ff" are the same hex byte. */
function digitValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 97 && code <= 122) return code - 87; // a-z → 10..35
  if (code >= 65 && code <= 90) return code - 55; // A-Z → 10..35
  return -1;
}

/**
 * The integer `text` spells in `base`, or `null` when the text is not one this
 * grammar admits. Throws `RangeError` for a base outside 2..36 — a caller bug,
 * never a keystroke (see `isSupportedBase`).
 *
 * Accepts a leading `+`/`-`, the literal prefixes `0b`/`0o`/`0x`, and `_` or a
 * space between digits. Rejects a digit the base does not have, a separator
 * that is leading, trailing, doubled or sitting directly after the prefix
 * („0x_FF", which JavaScript's own numeric literals reject too), and an empty
 * digit body.
 *
 * **A prefix that names a different base than the one asked for is refused, not
 * ignored.** In base 16 the text „0b101" is 0xB101 to a parser that drops the
 * prefix and 5 to one that honours it — the same fork as the „1.234" grouping
 * separator, so it gets the same answer: refuse and let the user say it again.
 * The refusal costs nothing, because every prefix starts with `0` and a leading
 * zero never changes an integer's value: whoever meant 0xB101 types „b101" and
 * is understood immediately.
 */
export function parseIntegerInBase(text: string, base: number): bigint | null {
  assertBase(base);
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > BASE_INPUT_MAX_LENGTH) return null;

  let index = 0;
  const sign = trimmed[0];
  const negative = sign === "-";
  if (negative || sign === "+") index = 1;

  if (trimmed[index] === "0") {
    const prefixBase = PREFIX_BASES.get((trimmed[index + 1] ?? "").toLowerCase());
    if (prefixBase !== undefined) {
      if (prefixBase !== base) return null;
      index += 2;
    }
  }

  const radix = BigInt(base);
  let value = 0n;
  let afterDigit = false;
  for (const ch of trimmed.slice(index)) {
    if (GROUP_INPUT.has(ch)) {
      // A separator is only ever BETWEEN digits: „_1", „1_" and „1__2" are all
      // typos, and a parser that swallows them teaches the user nothing.
      if (!afterDigit) return null;
      afterDigit = false;
      continue;
    }
    const digit = digitValue(ch);
    if (digit < 0 || digit >= base) return null;
    value = value * radix + BigInt(digit);
    afterDigit = true;
  }
  if (!afterDigit) return null;

  return negative ? -value : value;
}

/** How `formatIntegerInBase` writes its digits. Both default to off, so the plain call gives the canonical machine spelling. */
export interface BaseFormatOptions {
  /** Upper-case the letter digits — the convention for hex, and never wrong for the rest. */
  readonly uppercase?: boolean;
  /** Insert grouping separators, four digits at a time in base 2/16 and three in base 10. */
  readonly group?: boolean;
}

/** `value` written in `base`, with a leading `-` when negative. Throws `RangeError` for an unsupported base. */
export function formatIntegerInBase(
  value: bigint,
  base: number,
  options: BaseFormatOptions = {},
): string {
  assertBase(base);
  const magnitude = value < 0n ? -value : value;
  const digits = magnitude.toString(base);
  const cased = options.uppercase === true ? digits.toUpperCase() : digits;
  const body = options.group === true ? groupDigits(cased, GROUP_SIZES.get(base) ?? 0) : cased;
  return value < 0n ? `-${body}` : body;
}

/**
 * `digits` split into groups of `size`, counted FROM THE RIGHT — the only
 * direction that keeps a group's place value fixed, so „1 0000" and „10 0000"
 * differ where the eye expects. A size of zero or less means „do not group",
 * which is how a base with no convention gets left alone.
 */
export function groupDigits(digits: string, size: number): string {
  if (!Number.isInteger(size) || size <= 0 || digits.length <= size) return digits;
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= size) {
    groups.unshift(digits.slice(Math.max(0, end - size), end));
  }
  return groups.join(GROUP_SEPARATOR);
}

/** One base's spelling of a value — plain and grouped, so a surface can show either without re-deriving the other. */
export interface BaseView {
  readonly base: number;
  /** The digits, upper-cased, ungrouped: the form that reads back through `parseIntegerInBase`. */
  readonly text: string;
  /** The same digits with grouping separators, for display only. */
  readonly grouped: string;
}

/** The value written in each of `bases`, in the order given. Throws `RangeError` if any base is unsupported. */
export function baseViews(
  value: bigint,
  bases: readonly number[] = BASE_PRESETS,
): readonly BaseView[] {
  return bases.map((base) => ({
    base,
    text: formatIntegerInBase(value, base, { uppercase: true }),
    grouped: formatIntegerInBase(value, base, { uppercase: true, group: true }),
  }));
}

/** A parsed-and-rewritten integer: the exact value, and the target base's two spellings. */
export interface BaseConversion extends BaseView {
  readonly value: bigint;
}

/** `text`, read in `fromBase` and written in `toBase`, or `null` when the text is not an integer in `fromBase`. */
export function convertIntegerBase(
  text: string,
  fromBase: number,
  toBase: number,
): BaseConversion | null {
  const value = parseIntegerInBase(text, fromBase);
  if (value === null) return null;
  const [view] = baseViews(value, [toBase]);
  // `baseViews` returns exactly one row for a one-element list; the guard is
  // here because `noUncheckedIndexedAccess` cannot know that, not because the
  // row can be missing.
  return view === undefined ? null : { ...view, value };
}

// ---------------------------------------------------------------------------
// Fixed widths and two's complement — shared by the inspector and the bit tools
// ---------------------------------------------------------------------------

/** The widths a machine integer comes in here. Not 128: no target of this app has a 128-bit integer type worth inspecting. */
export const INT_WIDTHS = [8, 16, 32, 64] as const;

export type IntWidth = (typeof INT_WIDTHS)[number];

/**
 * The low `width` bits of `bits`, as an unsigned value.
 *
 * **This WRAPS, deliberately.** JavaScript's `BigInt` bitwise operators are
 * defined on an infinite two's-complement representation, so `-1n & 0xFFn` is
 * 255n with no special case — which is exactly the semantics of a register.
 * Callers that must not wrap (the inspector) check `fitsAtWidth` first; callers
 * for which wrapping is the subject (the bit operations) use it directly.
 */
export function maskToWidth(bits: bigint, width: IntWidth): bigint {
  return bits & ((1n << BigInt(width)) - 1n);
}

/** The same bit pattern read as a signed two's-complement integer: at width 8, 0xFF is −1. */
export function signedFromBits(bits: bigint, width: IntWidth): bigint {
  const masked = maskToWidth(bits, width);
  return masked >= 1n << BigInt(width - 1) ? masked - (1n << BigInt(width)) : masked;
}

/**
 * Whether `value` is representable at `width` under EITHER signedness — the
 * range `[-2^(w-1), 2^w - 1]`. Used to decide whether a bit pattern exists at
 * all for this value; whether it fits a particular *type* is `IntegerType`'s
 * narrower question.
 */
export function fitsAtWidth(value: bigint, width: IntWidth): boolean {
  return value >= -(1n << BigInt(width - 1)) && value <= (1n << BigInt(width)) - 1n;
}

/** The width's worth of hex digits, upper-cased and zero-padded: a byte is always two characters, a word always four. */
function hexAtWidth(bits: bigint, width: IntWidth): string {
  return maskToWidth(bits, width)
    .toString(16)
    .toUpperCase()
    .padStart(width / 4, "0");
}

/** The width's worth of bits, zero-padded. Ungrouped — `groupDigits(…, 4)` is the surface's separate, explicit step. */
function binaryAtWidth(bits: bigint, width: IntWidth): string {
  return maskToWidth(bits, width).toString(2).padStart(width, "0");
}

// ---------------------------------------------------------------------------
// integer-inspector — one value against all eight machine types
// ---------------------------------------------------------------------------

/** One machine integer type: its width, its signedness, and the closed range it can hold. */
export interface IntegerType {
  /** Stable ASCII id, the C99 spelling: „int8", „uint64". A strings key, never a label. */
  readonly id: string;
  readonly width: IntWidth;
  readonly signed: boolean;
  readonly min: bigint;
  readonly max: bigint;
}

function integerType(width: IntWidth, signed: boolean): IntegerType {
  const span = 1n << BigInt(width);
  return signed
    ? { id: `int${width}`, width, signed, min: -(span / 2n), max: span / 2n - 1n }
    : { id: `uint${width}`, width, signed, min: 0n, max: span - 1n };
}

/** The eight types, signed ladder first then unsigned — the order the inspector's table reads in. */
export const INTEGER_TYPES: readonly IntegerType[] = [
  ...INT_WIDTHS.map((width) => integerType(width, true)),
  ...INT_WIDTHS.map((width) => integerType(width, false)),
];

/**
 * One row of the inspector.
 *
 * A row that does not fit carries NO representation, and that is the design:
 * the tempting field is „what 200 looks like as an int8", but there is no such
 * thing — there is only what 200 becomes after a wrap the user did not ask for,
 * and printing it is how a converter teaches a falsehood. `fits: false` is the
 * complete answer, and `type.min`/`type.max` say why.
 */
export type IntegerView =
  | {
      readonly type: IntegerType;
      readonly fits: true;
      /** The value in base 10. Identical across every fitting row — a row is self-describing so a table cell needs no outside lookup. */
      readonly decimal: string;
      /** Two's complement, upper-case, zero-padded to the width. */
      readonly hex: string;
      /** Two's complement, zero-padded to the width, ungrouped. */
      readonly binary: string;
    }
  | { readonly type: IntegerType; readonly fits: false };

/** `value` against all eight machine types, in `INTEGER_TYPES` order. Total: every value produces eight rows, some of them refusals. */
export function inspectInteger(value: bigint): readonly IntegerView[] {
  return INTEGER_TYPES.map((type) => {
    if (value < type.min || value > type.max) return { type, fits: false };
    return {
      type,
      fits: true,
      decimal: value.toString(10),
      hex: hexAtWidth(value, type.width),
      binary: binaryAtWidth(value, type.width),
    };
  });
}

/** The narrowest type that holds `value`, or `null` when nothing here does (beyond 64 bits either way). */
export function smallestIntegerType(value: bigint): IntegerType | null {
  const fitting = INTEGER_TYPES.filter((type) => value >= type.min && value <= type.max);
  // Narrowest first; among equals, the signed one, since `INTEGER_TYPES` lists it first.
  return fitting.reduce<IntegerType | null>(
    (best, type) => (best === null || type.width < best.width ? type : best),
    null,
  );
}

/** The same bytes in both orders. Byte values, 0..255 — `formatBytes` is the display step. */
export interface ByteOrderView {
  readonly width: IntWidth;
  /** Most significant byte first — how the value is written, and how it goes on a network. */
  readonly bigEndian: readonly number[];
  /** Least significant byte first — how x86 and ARM store it, and the reason a file written on one machine reads as nonsense on another. */
  readonly littleEndian: readonly number[];
}

/** `value`'s bytes at `width`, both ways round, or `null` when the value has no bit pattern at that width. */
export function byteOrder(value: bigint, width: IntWidth): ByteOrderView | null {
  if (!fitsAtWidth(value, width)) return null;
  const bits = maskToWidth(value, width);
  const bigEndian: number[] = [];
  for (let shift = width - 8; shift >= 0; shift -= 8) {
    bigEndian.push(Number((bits >> BigInt(shift)) & 0xffn));
  }
  return { width, bigEndian, littleEndian: [...bigEndian].reverse() };
}

/**
 * Bytes as „DE AD BE EF" — two upper-case hex digits each, space separated.
 *
 * Its domain is byte values, and it enforces that rather than trusting it:
 * `padStart` only ever pads, so a number outside 0..255 — or a fractional one —
 * used to come out three, four or five characters wide and break the very column
 * alignment this function exists to produce. Masking is not repairing a value
 * here; it is the definition of „the byte", and it is what makes the return type
 * `string` honest. `byteOrder`, the only caller today, cannot reach it.
 */
export function formatBytes(bytes: readonly number[]): string {
  return bytes
    .map((byte) => ((byte | 0) & 0xff).toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

// ---------------------------------------------------------------------------
// bitwise — the operations, at a width, with the right shift said properly
// ---------------------------------------------------------------------------

/** The operations taking two operands of the same width. NAND/NOR/XNOR are here because a tool that makes you compose them is a tool that makes you guess. */
export type BinaryBitwiseOp = "and" | "or" | "xor" | "nand" | "nor" | "xnor";

/** The operations taking a value and a COUNT. `shr` is logical, `sar` is arithmetic, and the difference is the reason this tool exists. */
export type ShiftBitwiseOp = "shl" | "shr" | "sar" | "rol" | "ror";

export type BitwiseOpId = BinaryBitwiseOp | ShiftBitwiseOp | "not";

/** An operation and how many operands it takes — a surface needs the arity to decide which fields to show. */
export interface BitwiseOpDef {
  readonly id: BitwiseOpId;
  /** `binary` takes A and B; `shift` takes A and a count; `unary` takes A alone. */
  readonly arity: "unary" | "binary" | "shift";
}

/** Every operation, in the order a picker offers them: the logic gates, the negation, then the movements. */
export const BITWISE_OPS: readonly BitwiseOpDef[] = [
  { id: "and", arity: "binary" },
  { id: "or", arity: "binary" },
  { id: "xor", arity: "binary" },
  { id: "nand", arity: "binary" },
  { id: "nor", arity: "binary" },
  { id: "xnor", arity: "binary" },
  { id: "not", arity: "unary" },
  { id: "shl", arity: "shift" },
  { id: "shr", arity: "shift" },
  { id: "sar", arity: "shift" },
  { id: "rol", arity: "shift" },
  { id: "ror", arity: "shift" },
];

/**
 * `a op b` at `width`, as the unsigned bit pattern.
 *
 * Both operands are masked to the width first, so a negative operand enters as
 * its two's complement (−1 at width 8 is 0xFF) and the result is always in
 * `[0, 2^width)`. `signedFromBits` reads it back the other way; `describeBits`
 * gives both at once.
 */
export function bitwiseBinary(
  op: BinaryBitwiseOp,
  a: bigint,
  b: bigint,
  width: IntWidth,
): bigint {
  const x = maskToWidth(a, width);
  const y = maskToWidth(b, width);
  switch (op) {
    case "and":
      return x & y;
    case "or":
      return x | y;
    case "xor":
      return x ^ y;
    case "nand":
      return maskToWidth(~(x & y), width);
    case "nor":
      return maskToWidth(~(x | y), width);
    case "xnor":
      return maskToWidth(~(x ^ y), width);
  }
}

/** Every bit of `value` flipped, at `width`. NOT is width-dependent in a way AND is not: `~0` is 0xFF at width 8 and 0xFFFF at 16. */
export function bitwiseNot(value: bigint, width: IntWidth): bigint {
  return maskToWidth(~maskToWidth(value, width), width);
}

/**
 * `value` shifted or rotated by `amount` places at `width`, as the unsigned bit
 * pattern — or `null` when `amount` is negative or not a whole number, which is
 * user input rather than a caller bug.
 *
 * **`shr` and `sar` genuinely differ, and that is the point of the tool.** A
 * logical right shift feeds zeros in at the top, so −1 at width 8 becomes 0x7F
 * (127). An arithmetic one feeds the sign bit in, so −1 stays 0xFF (−1) —
 * division by two, rounded towards negative infinity. Choosing the wrong one is
 * a bug that shows up only on negative values, which is why the two are named
 * separately here and never behind a single „>>".
 *
 * **A count at or past the width is answered mathematically, not the way x86
 * answers it.** A shift of 32 at width 32 gives 0 here (or all-ones for `sar`
 * on a negative value); the hardware would mask the count to 0 and return the
 * input unchanged. A tool that exists to explain shifting must not reproduce one
 * instruction set's quirk as if it were arithmetic. Rotation is different: it
 * really is periodic in the width, so a rotate count is reduced modulo it.
 */
export function shiftBits(
  op: ShiftBitwiseOp,
  value: bigint,
  amount: number,
  width: IntWidth,
): bigint | null {
  if (!Number.isInteger(amount) || amount < 0) return null;
  const bits = maskToWidth(value, width);
  switch (op) {
    case "shl":
      return amount >= width ? 0n : maskToWidth(bits << BigInt(amount), width);
    case "shr":
      return amount >= width ? 0n : bits >> BigInt(amount);
    case "sar": {
      const signed = signedFromBits(bits, width);
      const shifted = amount >= width ? (signed < 0n ? -1n : 0n) : signed >> BigInt(amount);
      return maskToWidth(shifted, width);
    }
    case "rol":
    case "ror": {
      const reduced = amount % width;
      const left = BigInt(op === "rol" ? reduced : (width - reduced) % width);
      // With `left` at zero the right half shifts by the full width, which on a
      // non-negative bigint is 0 — so the identity rotation needs no special case.
      return maskToWidth((bits << left) | (bits >> (BigInt(width) - left)), width);
    }
  }
}

/** How many bits are set, at `width`. Kernighan's loop: clearing the lowest set bit runs once per set bit rather than once per bit. */
export function popcount(value: bigint, width: IntWidth): number {
  let bits = maskToWidth(value, width);
  let count = 0;
  while (bits > 0n) {
    bits &= bits - 1n;
    count += 1;
  }
  return count;
}

/** Zeros above the highest set bit. Zero has no set bit, so the answer is the full width — the total definition, where several instruction sets leave it undefined. */
export function countLeadingZeros(value: bigint, width: IntWidth): number {
  const bits = maskToWidth(value, width);
  return bits === 0n ? width : width - bits.toString(2).length;
}

/** Zeros below the lowest set bit; `width` for zero, for the same reason as `countLeadingZeros`. `bits & -bits` isolates that lowest bit. */
export function countTrailingZeros(value: bigint, width: IntWidth): number {
  const bits = maskToWidth(value, width);
  return bits === 0n ? width : (bits & -bits).toString(2).length - 1;
}

/** Whether an odd number of bits is set — the parity bit a serial line or a memory word carries. */
export function hasOddParity(value: bigint, width: IntWidth): boolean {
  return popcount(value, width) % 2 === 1;
}

/** Everything a surface shows about one bit pattern at one width. */
export interface BitsView {
  readonly width: IntWidth;
  /** The pattern read as unsigned — always in `[0, 2^width)`. */
  readonly bits: bigint;
  /** The same pattern read as two's complement. */
  readonly signed: bigint;
  /** Upper-case, zero-padded to `width / 4` digits. */
  readonly hex: string;
  /** Zero-padded to `width` digits, ungrouped — `groupDigits(binary, 4)` for display. */
  readonly binary: string;
  readonly popcount: number;
  readonly leadingZeros: number;
  readonly trailingZeros: number;
  readonly oddParity: boolean;
}

/** `value` as a width's worth of bits, described every way at once. The operand rows and the result row of the bit tool are all this. */
export function describeBits(value: bigint, width: IntWidth): BitsView {
  const bits = maskToWidth(value, width);
  return {
    width,
    bits,
    signed: signedFromBits(bits, width),
    hex: hexAtWidth(bits, width),
    binary: binaryAtWidth(bits, width),
    popcount: popcount(bits, width),
    leadingZeros: countLeadingZeros(bits, width),
    trailingZeros: countTrailingZeros(bits, width),
    oddParity: hasOddParity(bits, width),
  };
}

// ---------------------------------------------------------------------------
// data-unit — kB is not KiB, and this is where the app says so
// ---------------------------------------------------------------------------

/**
 * Whether a unit counts bytes or bits. The distinction a home internet bill
 * turns on: „100 Mb/s" is 12,5 MB/s, and the factor of eight is where most of
 * the disappointment about download speeds comes from.
 */
export type DataCounts = "bytes" | "bits";

/** One rung of the data ladder. `bytes` is the size of one of this unit, in bytes — fractional only for the bit units. */
export interface DataUnitDef {
  /** Stable ASCII id, sharing `units.ts`'s scheme so a shared rung has ONE id in the codebase. */
  readonly id: string;
  readonly bytes: number;
  readonly counts: DataCounts;
  /** Which kilobyte this rung means; `null` for the two units that are not ambiguous — a bit is a bit and a byte is a byte. */
  readonly convention: DataConvention | null;
}

/**
 * The size of one `id`, taken from `units.ts` when that table already publishes
 * the rung and from `fallback` only when it does not.
 *
 * The general converter (`packages/core/src/tools/units.ts`) already settles the
 * decimal/binary question for kB…TB and KiB…TiB, and a second table repeating
 * those factors is a second answer waiting to drift from the first. So the
 * shared rungs are READ from it, and this module extends the ladder only where
 * `units.ts` is silent: the petabyte pair, which a converter aimed at file sizes
 * should reach, and the bit multiples, which belong to link rates rather than to
 * physical quantities. The fallbacks are the correct values regardless, and a
 * test asserts every shared rung agrees with `convertUnit`, so a divergence
 * cannot arrive quietly.
 */
function bytesOf(id: string, fallback: number): number {
  return findUnit(id)?.toBase(1) ?? fallback;
}

const KI = 1024;

/**
 * Every unit the tool offers, in the order a picker lists them: bytes plain,
 * then the two byte ladders side by side, then bits.
 *
 * **Bit multiples are decimal only.** IEC does define a kibibit, but no link
 * rate, no bus and no standard is ever quoted in one, and offering a unit nobody
 * means is how a converter invents ambiguity instead of settling it.
 */
export const DATA_UNITS: readonly DataUnitDef[] = [
  { id: "byte", bytes: bytesOf("byte", 1), counts: "bytes", convention: null },
  { id: "kb-dec", bytes: bytesOf("kb-dec", 1000), counts: "bytes", convention: "decimal" },
  { id: "mb-dec", bytes: bytesOf("mb-dec", 1000 ** 2), counts: "bytes", convention: "decimal" },
  { id: "gb-dec", bytes: bytesOf("gb-dec", 1000 ** 3), counts: "bytes", convention: "decimal" },
  { id: "tb-dec", bytes: bytesOf("tb-dec", 1000 ** 4), counts: "bytes", convention: "decimal" },
  // Not in `units.ts`: its ladder stops at the terabyte, which is right for a
  // general converter and one rung short for one aimed at disks.
  { id: "pb-dec", bytes: bytesOf("pb-dec", 1000 ** 5), counts: "bytes", convention: "decimal" },
  { id: "kib", bytes: bytesOf("kib", KI), counts: "bytes", convention: "binary" },
  { id: "mib", bytes: bytesOf("mib", KI ** 2), counts: "bytes", convention: "binary" },
  { id: "gib", bytes: bytesOf("gib", KI ** 3), counts: "bytes", convention: "binary" },
  { id: "tib", bytes: bytesOf("tib", KI ** 4), counts: "bytes", convention: "binary" },
  { id: "pib", bytes: bytesOf("pib", KI ** 5), counts: "bytes", convention: "binary" },
  { id: "bit", bytes: bytesOf("bit", 1 / 8), counts: "bits", convention: null },
  { id: "kbit", bytes: bytesOf("kbit", 1000 / 8), counts: "bits", convention: "decimal" },
  { id: "mbit", bytes: bytesOf("mbit", 1000 ** 2 / 8), counts: "bits", convention: "decimal" },
  { id: "gbit", bytes: bytesOf("gbit", 1000 ** 3 / 8), counts: "bits", convention: "decimal" },
];

const DATA_BY_ID: ReadonlyMap<string, DataUnitDef> = new Map(
  DATA_UNITS.map((unit) => [unit.id, unit] as const),
);

/** The rung an id names, or `undefined`. */
export function findDataUnit(id: string): DataUnitDef | undefined {
  return DATA_BY_ID.get(id);
}

/** A quantity in one named unit — the shape of every row this tool produces. */
export interface DataQuantity {
  readonly unitId: string;
  readonly value: number;
}

/**
 * One rung of `dataLadder`, where `value` is `null` for a rung that cannot
 * express the quantity at all.
 *
 * That rung exists: 10^300 PiB is a size a user may legitimately type, and it is
 * more bytes than a double can count. A row reading „—" is the truth; a row
 * reading „∞" is a claim about the quantity, and a row reading „NaN" is a claim
 * about nothing.
 */
export interface DataLadderRow {
  readonly unitId: string;
  readonly value: number | null;
}

/**
 * `value` of `fromId` expressed in `toId`, or `null` for an unknown id, an input
 * that is not finite, or a RESULT that is not finite.
 *
 * `number` rather than `bigint`, alone in this module, because the quantity is
 * genuinely fractional: „1,5 GiB" is the thing a user types. The exactness that
 * buys is narrower than it looks and is worth stating precisely: every
 * conversion WITHIN one ladder — binary to binary, decimal to decimal — is a
 * multiply and divide by powers of the same radix and is exact for whole byte
 * counts up to 2^53 (8 PiB). Crossing the ladders is not, because the decimal
 * rungs are not dyadic: 1023 B is exactly 1,023 kB in arithmetic and
 * `1022.9999999999999` B when that answer is converted back, and 1023 is a whole
 * byte count nowhere near 2^53. `roundForDisplay` is what hides it at the
 * surface; nothing is rounded here.
 */
export function convertData(value: number, fromId: string, toId: string): number | null {
  const from = DATA_BY_ID.get(fromId);
  const to = DATA_BY_ID.get(toId);
  if (!Number.isFinite(value) || from === undefined || to === undefined) return null;
  const converted = from === to ? value : (value * from.bytes) / to.bytes;
  // The promise this function makes is about its ANSWER, so it is checked on the
  // answer. Checking the input was the whole defect: `1e300` PiB is a perfectly
  // finite input whose PRODUCT overflows, and `1e300` Gbit is one whose product
  // is finite and whose DIVISION overflows — so a guard on either operation
  // alone would still have let `Infinity` out of a function documented to return
  // `null` instead.
  if (!Number.isFinite(converted)) return null;
  // A quantity of data has no signed zero. A sign means something only on a
  // DIFFERENCE, and a difference of zero is zero; `-0` here is either somebody
  // typing „-0" or a negative value that underflowed on the way down the ladder,
  // and „−0 B" reads as a rendering fault in both cases.
  return converted === 0 ? 0 : converted;
}

/** The same quantity on every rung of the ladder, in `DATA_UNITS` order, or `null` when the INPUT is refused. */
export function dataLadder(value: number, unitId: string): readonly DataLadderRow[] | null {
  if (!Number.isFinite(value) || !DATA_BY_ID.has(unitId)) return null;
  // Recomputed per rung so there is one code path for the arithmetic rather than
  // two — and a rung `convertData` refuses carries that refusal through as
  // `null` rather than being papered over.
  return DATA_UNITS.map((unit) => ({ unitId: unit.id, value: convertData(value, unitId, unit.id) }));
}

/**
 * A byte count on the largest rung of `convention` it reaches — 1536 bytes is
 * „1,5 KiB" in binary and „1,536 kB" in decimal, and the caller says which
 * question it is asking rather than being given one silently.
 *
 * The magnitude decides the rung, so a negative count (a size difference) keeps
 * its sign and lands on the rung its size deserves.
 */
export function bestDataUnit(bytes: number, convention: DataConvention): DataQuantity | null {
  if (!Number.isFinite(bytes)) return null;
  const magnitude = Math.abs(bytes);
  const rungs = DATA_UNITS.filter(
    (unit) =>
      unit.counts === "bytes" && (unit.convention === null || unit.convention === convention),
  );
  const chosen = rungs.reduce<DataUnitDef | undefined>(
    (best, unit) =>
      magnitude >= unit.bytes && (best === undefined || unit.bytes > best.bytes) ? unit : best,
    undefined,
  );
  const unit = chosen ?? rungs[0];
  return unit === undefined ? null : { unitId: unit.id, value: bytes / unit.bytes };
}
