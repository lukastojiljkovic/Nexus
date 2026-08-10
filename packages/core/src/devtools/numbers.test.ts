import { describe, expect, it } from "vitest";

import { convertUnit, findUnit } from "../tools/units.js";
import {
  BASE_INPUT_MAX_LENGTH,
  BASE_MAX,
  BASE_MIN,
  BASE_PRESETS,
  BITWISE_OPS,
  DATA_UNITS,
  INTEGER_TYPES,
  INT_WIDTHS,
  type IntWidth,
  type IntegerView,
  baseViews,
  bestDataUnit,
  bitwiseBinary,
  bitwiseNot,
  byteOrder,
  convertData,
  convertIntegerBase,
  countLeadingZeros,
  countTrailingZeros,
  dataLadder,
  describeBits,
  findDataUnit,
  fitsAtWidth,
  formatBytes,
  formatIntegerInBase,
  groupDigits,
  hasOddParity,
  inspectInteger,
  isSupportedBase,
  maskToWidth,
  parseIntegerInBase,
  popcount,
  shiftBits,
  signedFromBits,
  smallestIntegerType,
} from "./numbers.js";

// ---------------------------------------------------------------------------
// number-base
// ---------------------------------------------------------------------------

describe("parseIntegerInBase", () => {
  it("reads the ordinary spellings of a byte, in each base a programmer uses", () => {
    // 0xFF = 15·16 + 15 = 255. 0o377 = 3·64 + 7·8 + 7 = 192 + 56 + 7 = 255.
    expect(parseIntegerInBase("255", 10)).toBe(255n);
    expect(parseIntegerInBase("ff", 16)).toBe(255n);
    expect(parseIntegerInBase("FF", 16)).toBe(255n);
    expect(parseIntegerInBase("11111111", 2)).toBe(255n);
    expect(parseIntegerInBase("377", 8)).toBe(255n);
  });

  it("accepts the literal prefix when it names the base that was asked for", () => {
    expect(parseIntegerInBase("0xFF", 16)).toBe(255n);
    expect(parseIntegerInBase("0xF_F", 16)).toBe(255n);
    expect(parseIntegerInBase("0b11111111", 2)).toBe(255n);
    expect(parseIntegerInBase("0o377", 8)).toBe(255n);
  });

  it("refuses a prefix that names a DIFFERENT base rather than picking one of the two readings", () => {
    // In base 16 „0b101" is 0xB101 = 45313 if the prefix is ignored and 5 if it
    // is honoured — the „1.234" fork, answered the same way: refuse. It costs
    // nothing, because a prefix always begins with 0 and a leading zero never
    // changes a value: 0xB101 is reachable as „b101".
    expect(parseIntegerInBase("0b101", 16)).toBeNull();
    expect(parseIntegerInBase("b101", 16)).toBe(45313n);
    expect(parseIntegerInBase("0x1F", 10)).toBeNull();
    expect(parseIntegerInBase("0o7", 16)).toBeNull();
  });

  it("takes a sign, before the prefix", () => {
    // 0x2A = 2·16 + 10 = 42.
    expect(parseIntegerInBase("-2a", 16)).toBe(-42n);
    expect(parseIntegerInBase("-0x2A", 16)).toBe(-42n);
    expect(parseIntegerInBase("+7", 10)).toBe(7n);
    expect(parseIntegerInBase("-0", 10)).toBe(0n);
  });

  it("ignores `_` and a space BETWEEN digits, and refuses one anywhere else", () => {
    expect(parseIntegerInBase("1111_1111", 2)).toBe(255n);
    expect(parseIntegerInBase("1111 1111", 2)).toBe(255n);
    // U+00A0 and U+202F render identically to a plain space; a user who pasted
    // one cannot see which they got, so refusing them would be a puzzle.
    expect(parseIntegerInBase("1\u00A0000", 10)).toBe(1000n);
    expect(parseIntegerInBase("1\u202F000", 10)).toBe(1000n);
    expect(parseIntegerInBase("_1", 10)).toBeNull();
    expect(parseIntegerInBase("1_", 10)).toBeNull();
    expect(parseIntegerInBase("1__2", 10)).toBeNull();
    expect(parseIntegerInBase("1_ 2", 10)).toBeNull();
    // A separator directly after the prefix is refused too, exactly as
    // JavaScript's own numeric separators refuse `0x_FF`.
    expect(parseIntegerInBase("0x_FF", 16)).toBeNull();
  });

  it("refuses a digit the base does not have, at the exact edge of the alphabet", () => {
    expect(parseIntegerInBase("12", 2)).toBeNull();
    expect(parseIntegerInBase("8", 8)).toBeNull();
    expect(parseIntegerInBase("g", 16)).toBeNull();
    // In base 35 the digits run 0..y; „z" is 35 and therefore one too far.
    expect(parseIntegerInBase("y", 35)).toBe(34n);
    expect(parseIntegerInBase("z", 35)).toBeNull();
    expect(parseIntegerInBase("zz", 36)).toBe(1295n); // 35·36 + 35
  });

  it("refuses text with no digits at all", () => {
    expect(parseIntegerInBase("", 10)).toBeNull();
    expect(parseIntegerInBase("   ", 10)).toBeNull();
    expect(parseIntegerInBase("0x", 16)).toBeNull();
    expect(parseIntegerInBase("-", 10)).toBeNull();
    expect(parseIntegerInBase("1.5", 10)).toBeNull();
    expect(parseIntegerInBase("1e3", 10)).toBeNull();
  });

  it("refuses input past the length cap rather than spending minutes on it", () => {
    expect(parseIntegerInBase("f".repeat(BASE_INPUT_MAX_LENGTH), 16)).not.toBeNull();
    expect(parseIntegerInBase("f".repeat(BASE_INPUT_MAX_LENGTH + 1), 16)).toBeNull();
  });

  it("keeps all 64 bits, which is the reason this module is bigint and not number", () => {
    // 2^64 − 1 = 18446744073709551615. A double has 53 mantissa bits, so
    // Number("0xFFFFFFFFFFFFFFFF") rounds to 2^64 exactly — the low eleven bits
    // are gone and the answer still looks like an answer.
    const parsed = parseIntegerInBase("FFFFFFFFFFFFFFFF", 16);
    expect(parsed).toBe(18446744073709551615n);
    expect(BigInt(Number("0xFFFFFFFFFFFFFFFF"))).toBe(18446744073709551616n);
    expect(parsed).not.toBe(BigInt(Number("0xFFFFFFFFFFFFFFFF")));
  });

  it("throws for a base outside 2..36, because that is a caller bug and never a keystroke", () => {
    expect(() => parseIntegerInBase("1", 1)).toThrow(RangeError);
    expect(() => parseIntegerInBase("1", 37)).toThrow(RangeError);
    expect(() => parseIntegerInBase("1", 10.5)).toThrow(RangeError);
    expect(isSupportedBase(BASE_MIN)).toBe(true);
    expect(isSupportedBase(BASE_MAX)).toBe(true);
    expect(isSupportedBase(1)).toBe(false);
    expect(isSupportedBase(37)).toBe(false);
    expect(isSupportedBase(16.5)).toBe(false);
    expect(isSupportedBase(Number.NaN)).toBe(false);
  });
});

describe("formatIntegerInBase", () => {
  it("writes the digits of the base, lower case unless asked otherwise", () => {
    expect(formatIntegerInBase(255n, 16)).toBe("ff");
    expect(formatIntegerInBase(255n, 16, { uppercase: true })).toBe("FF");
    expect(formatIntegerInBase(255n, 2)).toBe("11111111");
    expect(formatIntegerInBase(255n, 8)).toBe("377");
    expect(formatIntegerInBase(1295n, 36, { uppercase: true })).toBe("ZZ");
  });

  it("keeps the sign outside the digits", () => {
    expect(formatIntegerInBase(-42n, 16, { uppercase: true })).toBe("-2A");
    expect(formatIntegerInBase(0n, 2)).toBe("0");
  });

  it("groups four at a time in the bases that map onto bits, three in decimal, and not at all elsewhere", () => {
    expect(formatIntegerInBase(255n, 2, { group: true })).toBe("1111 1111");
    expect(formatIntegerInBase(57005n, 16, { uppercase: true, group: true })).toBe("DEAD");
    expect(formatIntegerInBase(1048575n, 16, { uppercase: true, group: true })).toBe("F FFFF");
    expect(formatIntegerInBase(1000000n, 10, { group: true })).toBe("1 000 000");
    // Octal has no convention worth inventing, so it is left alone.
    expect(formatIntegerInBase(255n, 8, { group: true })).toBe("377");
  });

  it("throws for an unsupported base", () => {
    expect(() => formatIntegerInBase(1n, 0)).toThrow(RangeError);
  });
});

describe("groupDigits", () => {
  it("counts from the RIGHT, so a group's place value is fixed", () => {
    expect(groupDigits("10000", 4)).toBe("1 0000");
    expect(groupDigits("100000", 4)).toBe("10 0000");
    expect(groupDigits("12345678", 4)).toBe("1234 5678");
  });

  it("leaves anything shorter than a group, and any non-size, untouched", () => {
    expect(groupDigits("1", 4)).toBe("1");
    expect(groupDigits("1111", 4)).toBe("1111");
    expect(groupDigits("abc", 0)).toBe("abc");
    expect(groupDigits("abc", -1)).toBe("abc");
    expect(groupDigits("abc", 1.5)).toBe("abc");
  });
});

describe("the base round trip", () => {
  it("reads back everything it writes, grouped and upper-cased, in every base it offers", () => {
    const values = [
      0n,
      1n,
      -1n,
      255n,
      4294967295n,
      -2147483648n,
      18446744073709551615n,
      -9223372036854775808n,
    ];
    for (let base = BASE_MIN; base <= BASE_MAX; base += 1) {
      for (const value of values) {
        const text = formatIntegerInBase(value, base, { uppercase: true, group: true });
        expect(parseIntegerInBase(text, base), `${value} @ base ${base}`).toBe(value);
      }
    }
  });
});

describe("convertIntegerBase and baseViews", () => {
  it("moves an integer between two bases without going through a double", () => {
    // 0xDEAD = 13·4096 + 14·256 + 10·16 + 13 = 53248 + 3584 + 160 + 13 = 57005.
    const converted = convertIntegerBase("0xDEAD", 16, 2);
    expect(converted?.value).toBe(57005n);
    expect(converted?.text).toBe("1101111010101101");
    expect(converted?.grouped).toBe("1101 1110 1010 1101");
    expect(converted?.base).toBe(2);
  });

  it("refuses when the text is not an integer in the base it was read as", () => {
    expect(convertIntegerBase("nope", 16, 10)).toBeNull();
    expect(convertIntegerBase("", 10, 16)).toBeNull();
  });

  it("shows the four bases a programmer wants side by side", () => {
    expect(BASE_PRESETS).toEqual([2, 8, 10, 16]);
    expect(baseViews(255n).map((view) => view.text)).toEqual(["11111111", "377", "255", "FF"]);
    expect(baseViews(-42n).map((view) => view.text)).toEqual(["-101010", "-52", "-42", "-2A"]);
  });
});

// ---------------------------------------------------------------------------
// integer-inspector
// ---------------------------------------------------------------------------

function rowFor(value: bigint, id: string): IntegerView {
  const row = inspectInteger(value).find((view) => view.type.id === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
}

function fittingRow(value: bigint, id: string) {
  const row = rowFor(value, id);
  if (!row.fits) throw new Error(`${id} unexpectedly does not hold ${value}`);
  return row;
}

describe("the machine integer types", () => {
  it("lists the eight, signed ladder first", () => {
    expect(INTEGER_TYPES.map((type) => type.id)).toEqual([
      "int8",
      "int16",
      "int32",
      "int64",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
    ]);
    expect(INT_WIDTHS).toEqual([8, 16, 32, 64]);
  });

  it("carries the ranges the C standard publishes, to the last digit", () => {
    const ranges = new Map<string, readonly [bigint, bigint]>([
      ["int8", [-128n, 127n]],
      ["int16", [-32768n, 32767n]],
      ["int32", [-2147483648n, 2147483647n]],
      ["int64", [-9223372036854775808n, 9223372036854775807n]],
      ["uint8", [0n, 255n]],
      ["uint16", [0n, 65535n]],
      ["uint32", [0n, 4294967295n]],
      ["uint64", [0n, 18446744073709551615n]],
    ]);
    for (const type of INTEGER_TYPES) {
      const range = ranges.get(type.id);
      expect(range, type.id).toBeDefined();
      expect([type.min, type.max], type.id).toEqual(range);
      // And the range is exactly 2^width wide, which is the arithmetic the
      // published numbers above are a check ON rather than a restatement of.
      expect(type.max - type.min + 1n, type.id).toBe(1n << BigInt(type.width));
    }
  });
});

describe("inspectInteger", () => {
  it("shows a value that fits as two's complement at the width, zero-padded", () => {
    // 200 = 0xC8 = 1100 1000.
    const uint8 = fittingRow(200n, "uint8");
    expect(uint8.decimal).toBe("200");
    expect(uint8.hex).toBe("C8");
    expect(uint8.binary).toBe("11001000");
    expect(fittingRow(200n, "int16").hex).toBe("00C8");
    expect(fittingRow(200n, "int16").binary).toBe("0000000011001000");
  });

  it("says a value does NOT fit rather than showing what it would wrap to", () => {
    // The whole reason the tool exists: 200 as an int8 is not −56, it is a
    // question with no answer at that width.
    expect(rowFor(200n, "int8").fits).toBe(false);
    expect(rowFor(-1n, "uint8").fits).toBe(false);
    expect(rowFor(256n, "uint8").fits).toBe(false);
    expect(rowFor(-129n, "int8").fits).toBe(false);
    // …and the neighbours of those edges do fit.
    expect(rowFor(255n, "uint8").fits).toBe(true);
    expect(rowFor(-128n, "int8").fits).toBe(true);
    expect(fittingRow(-128n, "int8").hex).toBe("80");
  });

  it("puts the two readings of 0xFFFFFFFF on opposite sides of the same table", () => {
    // 0xFFFFFFFF is 4294967295 unsigned; as a VALUE it is past int32's maximum,
    // so int32 refuses it…
    expect(fittingRow(4294967295n, "uint32").hex).toBe("FFFFFFFF");
    expect(rowFor(4294967295n, "int32").fits).toBe(false);
    expect(fittingRow(4294967295n, "int64").hex).toBe("00000000FFFFFFFF");
    // …while −1, which is what that bit pattern MEANS as an int32, fits it and
    // produces exactly those bits.
    expect(fittingRow(-1n, "int32").hex).toBe("FFFFFFFF");
    expect(fittingRow(-1n, "int8").binary).toBe("11111111");
    expect(fittingRow(-1n, "int64").hex).toBe("FFFFFFFFFFFFFFFF");
  });

  it("returns a row for every type, always", () => {
    for (const value of [0n, -1n, 200n, 1n << 100n]) {
      expect(inspectInteger(value)).toHaveLength(INTEGER_TYPES.length);
    }
    // Nothing here holds 2^100, and eight refusals is the correct answer.
    expect(inspectInteger(1n << 100n).every((view) => !view.fits)).toBe(true);
  });
});

describe("smallestIntegerType", () => {
  it("names the narrowest type that holds the value, preferring the signed one at a tie", () => {
    expect(smallestIntegerType(0n)?.id).toBe("int8");
    expect(smallestIntegerType(127n)?.id).toBe("int8");
    expect(smallestIntegerType(128n)?.id).toBe("uint8");
    expect(smallestIntegerType(200n)?.id).toBe("uint8");
    expect(smallestIntegerType(256n)?.id).toBe("int16");
    expect(smallestIntegerType(-1n)?.id).toBe("int8");
    expect(smallestIntegerType(-129n)?.id).toBe("int16");
    expect(smallestIntegerType(4294967295n)?.id).toBe("uint32");
    expect(smallestIntegerType(-9223372036854775808n)?.id).toBe("int64");
    expect(smallestIntegerType(18446744073709551615n)?.id).toBe("uint64");
  });

  it("refuses when nothing here is wide enough", () => {
    expect(smallestIntegerType(18446744073709551616n)).toBeNull();
    expect(smallestIntegerType(-9223372036854775809n)).toBeNull();
  });
});

describe("byteOrder", () => {
  it("splits a value both ways round", () => {
    const word = byteOrder(0x1234n, 16);
    expect(word?.bigEndian).toEqual([0x12, 0x34]);
    expect(word?.littleEndian).toEqual([0x34, 0x12]);
    expect(formatBytes(word?.bigEndian ?? [])).toBe("12 34");
    expect(formatBytes(word?.littleEndian ?? [])).toBe("34 12");

    const dword = byteOrder(0xdeadbeefn, 32);
    expect(dword?.bigEndian).toEqual([222, 173, 190, 239]);
    expect(dword?.littleEndian).toEqual([239, 190, 173, 222]);
    expect(formatBytes(dword?.bigEndian ?? [])).toBe("DE AD BE EF");
    expect(formatBytes(dword?.littleEndian ?? [])).toBe("EF BE AD DE");
  });

  it("splits a negative value by its two's complement bits", () => {
    // −2 at width 16 is 0xFFFE.
    expect(byteOrder(-2n, 16)?.bigEndian).toEqual([255, 254]);
    expect(byteOrder(-1n, 8)?.bigEndian).toEqual([255]);
  });

  it("gives one byte per eight bits, and puts the low byte first in little-endian", () => {
    const quad = byteOrder(1n, 64);
    expect(quad?.bigEndian).toHaveLength(8);
    expect(quad?.bigEndian.at(-1)).toBe(1);
    expect(quad?.littleEndian[0]).toBe(1);
  });

  it("refuses a value that has no bit pattern at that width", () => {
    expect(byteOrder(70000n, 16)).toBeNull();
    expect(byteOrder(-32769n, 16)).toBeNull();
    expect(byteOrder(65535n, 16)).not.toBeNull();
  });

  it("pads every byte to two hex digits, so columns line up", () => {
    expect(formatBytes([0, 1, 15, 255])).toBe("00 01 0F FF");
    expect(formatBytes([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// width arithmetic
// ---------------------------------------------------------------------------

describe("maskToWidth and signedFromBits", () => {
  it("reads a negative value as the bits a register would hold", () => {
    expect(maskToWidth(-1n, 8)).toBe(255n);
    expect(maskToWidth(-1n, 64)).toBe(18446744073709551615n);
    expect(maskToWidth(256n, 8)).toBe(0n);
    expect(signedFromBits(255n, 8)).toBe(-1n);
    expect(signedFromBits(128n, 8)).toBe(-128n);
    expect(signedFromBits(127n, 8)).toBe(127n);
    expect(signedFromBits(0xffffffffn, 32)).toBe(-1n);
  });

  it("round-trips every value an int8 can hold", () => {
    for (let value = -128n; value <= 127n; value += 1n) {
      expect(signedFromBits(maskToWidth(value, 8), 8)).toBe(value);
    }
  });

  it("knows which values have a pattern at a width and which do not", () => {
    expect(fitsAtWidth(255n, 8)).toBe(true);
    expect(fitsAtWidth(-128n, 8)).toBe(true);
    expect(fitsAtWidth(256n, 8)).toBe(false);
    expect(fitsAtWidth(-129n, 8)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bitwise
// ---------------------------------------------------------------------------

describe("bitwiseBinary", () => {
  // 0xF0 = 1111 0000, 0x3C = 0011 1100.
  it("computes the six gates by hand at width 8", () => {
    expect(bitwiseBinary("and", 0xf0n, 0x3cn, 8)).toBe(0x30n); // 0011 0000
    expect(bitwiseBinary("or", 0xf0n, 0x3cn, 8)).toBe(0xfcn); // 1111 1100
    expect(bitwiseBinary("xor", 0xf0n, 0x3cn, 8)).toBe(0xccn); // 1100 1100
    expect(bitwiseBinary("nand", 0xf0n, 0x3cn, 8)).toBe(0xcfn); // 1100 1111
    expect(bitwiseBinary("nor", 0xf0n, 0x3cn, 8)).toBe(0x03n); // 0000 0011
    expect(bitwiseBinary("xnor", 0xf0n, 0x3cn, 8)).toBe(0x33n); // 0011 0011
  });

  it("keeps the negated gates inside the width instead of leaking an infinite sign", () => {
    for (const op of ["nand", "nor", "xnor"] as const) {
      for (const width of INT_WIDTHS) {
        const result = bitwiseBinary(op, 0n, 0n, width);
        expect(result >= 0n, `${op} @ ${width}`).toBe(true);
        expect(result < 1n << BigInt(width), `${op} @ ${width}`).toBe(true);
      }
    }
    expect(bitwiseBinary("nand", 0n, 0n, 8)).toBe(255n);
    expect(bitwiseBinary("nand", 0n, 0n, 64)).toBe(18446744073709551615n);
  });

  it("takes a negative operand as its two's complement", () => {
    expect(bitwiseBinary("and", -1n, 0x3cn, 8)).toBe(0x3cn);
    expect(bitwiseBinary("xor", -1n, 0x0fn, 8)).toBe(0xf0n);
  });

  it("obeys the identities a reader would check it against", () => {
    for (const width of INT_WIDTHS) {
      const all = maskToWidth(-1n, width);
      expect(bitwiseBinary("and", 0x5an, all, width)).toBe(0x5an);
      expect(bitwiseBinary("or", 0x5an, 0n, width)).toBe(0x5an);
      expect(bitwiseBinary("xor", 0x5an, 0x5an, width)).toBe(0n);
      expect(bitwiseBinary("xnor", 0x5an, 0x5an, width)).toBe(all);
    }
  });
});

describe("bitwiseNot", () => {
  it("is width-dependent in the way AND is not", () => {
    expect(bitwiseNot(0x0fn, 8)).toBe(0xf0n);
    expect(bitwiseNot(0n, 8)).toBe(255n);
    expect(bitwiseNot(0n, 16)).toBe(65535n);
    expect(bitwiseNot(0n, 32)).toBe(4294967295n);
    expect(bitwiseNot(0n, 64)).toBe(18446744073709551615n);
  });

  it("is its own inverse", () => {
    for (const width of INT_WIDTHS) {
      expect(bitwiseNot(bitwiseNot(0x5an, width), width)).toBe(0x5an);
    }
  });
});

describe("shiftBits", () => {
  it("shifts left inside the width, dropping what leaves the top", () => {
    expect(shiftBits("shl", 1n, 7, 8)).toBe(0x80n);
    expect(shiftBits("shl", 0x81n, 1, 8)).toBe(0x02n); // 1000 0001 → 0000 0010
    expect(shiftBits("shl", 1n, 63, 64)).toBe(9223372036854775808n); // 2^63
  });

  it("separates the LOGICAL right shift from the ARITHMETIC one — the reason the tool exists", () => {
    // −1 at width 8 is 1111 1111. Feed zeros in and it becomes 0111 1111 = 127;
    // feed the sign bit in and it stays 1111 1111, which is still −1: division
    // by two, rounded towards negative infinity.
    expect(shiftBits("shr", -1n, 1, 8)).toBe(0x7fn);
    expect(shiftBits("sar", -1n, 1, 8)).toBe(0xffn);
    expect(signedFromBits(shiftBits("sar", -1n, 1, 8) ?? 0n, 8)).toBe(-1n);
    // −128 → −64.
    expect(shiftBits("sar", 0x80n, 1, 8)).toBe(0xc0n);
    expect(signedFromBits(shiftBits("sar", 0x80n, 1, 8) ?? 0n, 8)).toBe(-64n);
    // 2^63 read as int64 is the most negative value; arithmetic-shifting it 63
    // places leaves all ones.
    expect(shiftBits("sar", 1n << 63n, 63, 64)).toBe(18446744073709551615n);
  });

  it("makes the two right shifts agree on every NON-negative value, which is why the bug hides", () => {
    for (const value of [0n, 1n, 0x40n, 0x7fn]) {
      for (let amount = 0; amount < 8; amount += 1) {
        expect(shiftBits("shr", value, amount, 8), `${value} >> ${amount}`).toBe(
          shiftBits("sar", value, amount, 8),
        );
      }
    }
  });

  it("answers a count at or past the width mathematically, not the way x86 masks it", () => {
    // The hardware would take 8 mod 8 = 0 and hand back the input unchanged.
    expect(shiftBits("shl", 0x81n, 8, 8)).toBe(0n);
    expect(shiftBits("shr", 0x81n, 8, 8)).toBe(0n);
    expect(shiftBits("sar", 0x40n, 8, 8)).toBe(0n);
    expect(shiftBits("sar", -1n, 8, 8)).toBe(0xffn);
    expect(shiftBits("sar", -1n, 99, 8)).toBe(0xffn);
  });

  it("rotates without losing a bit, and is periodic in the width", () => {
    // 1000 0001 rotated left one place is 0000 0011; rotated right one place it
    // is 1100 0000.
    expect(shiftBits("rol", 0x81n, 1, 8)).toBe(0x03n);
    expect(shiftBits("ror", 0x81n, 1, 8)).toBe(0xc0n);
    expect(shiftBits("rol", 0x81n, 0, 8)).toBe(0x81n);
    expect(shiftBits("rol", 0x81n, 8, 8)).toBe(0x81n);
    expect(shiftBits("rol", 0x81n, 9, 8)).toBe(0x03n);
    expect(shiftBits("ror", 0x81n, 0, 8)).toBe(0x81n);
    expect(shiftBits("rol", 0x0123456789abcdefn, 64, 64)).toBe(0x0123456789abcdefn);
  });

  it("undoes a rotation with the opposite one, at every count and width", () => {
    for (const width of INT_WIDTHS) {
      const value = maskToWidth(0x0123456789abcdefn, width);
      for (let amount = 0; amount <= width; amount += 1) {
        const there = shiftBits("rol", value, amount, width) ?? -1n;
        expect(shiftBits("ror", there, amount, width), `${width} @ ${amount}`).toBe(value);
      }
    }
  });

  it("keeps every rotation's popcount, and never lets a shift raise one", () => {
    for (const amount of [1, 3, 7]) {
      expect(popcount(shiftBits("rol", 0xf0f0n, amount, 16) ?? 0n, 16)).toBe(8);
      expect(popcount(shiftBits("ror", 0xf0f0n, amount, 16) ?? 0n, 16)).toBe(8);
      expect(popcount(shiftBits("shl", 0xf0f0n, amount, 16) ?? 0n, 16)).toBeLessThanOrEqual(8);
    }
  });

  it("refuses a count that is negative or not whole — user input, so null and not a throw", () => {
    for (const op of ["shl", "shr", "sar", "rol", "ror"] as const) {
      expect(shiftBits(op, 1n, -1, 8), op).toBeNull();
      expect(shiftBits(op, 1n, 1.5, 8), op).toBeNull();
      expect(shiftBits(op, 1n, Number.NaN, 8), op).toBeNull();
      expect(shiftBits(op, 1n, Number.POSITIVE_INFINITY, 8), op).toBeNull();
    }
  });
});

describe("bit counting", () => {
  it("counts set bits", () => {
    // 0xF0F0 = 1111 0000 1111 0000 → eight ones.
    expect(popcount(0xf0f0n, 16)).toBe(8);
    expect(popcount(0n, 8)).toBe(0);
    expect(popcount(0x80n, 8)).toBe(1);
    expect(popcount(-1n, 8)).toBe(8);
    expect(popcount(-1n, 64)).toBe(64);
    // The width is a mask, not a hint: the high half of a 16-bit value is not
    // counted when the question is asked at width 8.
    expect(popcount(0xf0f0n, 8)).toBe(4);
  });

  it("counts the zeros above the highest set bit, and calls zero a full width", () => {
    expect(countLeadingZeros(1n, 8)).toBe(7);
    expect(countLeadingZeros(0x80n, 8)).toBe(0);
    expect(countLeadingZeros(0x0f0fn, 16)).toBe(4);
    expect(countLeadingZeros(0xf0f0n, 16)).toBe(0);
    expect(countLeadingZeros(1n, 64)).toBe(63);
    expect(countLeadingZeros(0n, 32)).toBe(32);
  });

  it("counts the zeros below the lowest set bit, and calls zero a full width", () => {
    expect(countTrailingZeros(1n, 8)).toBe(0);
    expect(countTrailingZeros(8n, 8)).toBe(3);
    expect(countTrailingZeros(0xf0n, 8)).toBe(4);
    expect(countTrailingZeros(0x8000n, 16)).toBe(15);
    expect(countTrailingZeros(0n, 16)).toBe(16);
  });

  it("keeps the three counts consistent for every single-bit value", () => {
    for (const width of INT_WIDTHS) {
      for (let bit = 0; bit < width; bit += 1) {
        const value = 1n << BigInt(bit);
        expect(popcount(value, width)).toBe(1);
        expect(countTrailingZeros(value, width)).toBe(bit);
        expect(countLeadingZeros(value, width)).toBe(width - 1 - bit);
      }
    }
  });

  it("reports parity as the oddness of the set-bit count", () => {
    expect(hasOddParity(0xf0f0n, 16)).toBe(false); // eight ones
    expect(hasOddParity(0x07n, 8)).toBe(true); // three ones
    expect(hasOddParity(0n, 8)).toBe(false);
    expect(hasOddParity(-1n, 8)).toBe(false); // eight ones
    expect(hasOddParity(-1n, 32)).toBe(false);
  });
});

describe("describeBits", () => {
  it("gives both readings of one pattern at once", () => {
    const all = describeBits(-1n, 16);
    expect(all.bits).toBe(65535n);
    expect(all.signed).toBe(-1n);
    expect(all.hex).toBe("FFFF");
    expect(all.binary).toBe("1111111111111111");
    expect(all.popcount).toBe(16);
    expect(all.leadingZeros).toBe(0);
    expect(all.trailingZeros).toBe(0);
    expect(all.oddParity).toBe(false);
  });

  it("pads a small value to the full width so two rows line up", () => {
    const zero = describeBits(0n, 8);
    expect(zero.hex).toBe("00");
    expect(zero.binary).toBe("00000000");
    expect(zero.leadingZeros).toBe(8);
    expect(zero.trailingZeros).toBe(8);
    expect(describeBits(0x2an, 32).hex).toBe("0000002A");
    expect(describeBits(0x2an, 32).binary).toHaveLength(32);
  });

  it("hands the binary out ungrouped, so grouping stays the surface's explicit step", () => {
    expect(groupDigits(describeBits(0xf0n, 8).binary, 4)).toBe("1111 0000");
  });
});

describe("the operation table", () => {
  it("names every operation once and says how many operands it takes", () => {
    const ids = BITWISE_OPS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "and",
      "or",
      "xor",
      "nand",
      "nor",
      "xnor",
      "not",
      "shl",
      "shr",
      "sar",
      "rol",
      "ror",
    ]);
    expect(BITWISE_OPS.filter((op) => op.arity === "shift").map((op) => op.id)).toEqual([
      "shl",
      "shr",
      "sar",
      "rol",
      "ror",
    ]);
    expect(BITWISE_OPS.filter((op) => op.arity === "unary").map((op) => op.id)).toEqual(["not"]);
  });
});

// ---------------------------------------------------------------------------
// data-unit
// ---------------------------------------------------------------------------

describe("the data ladder", () => {
  it("keeps every id unique and key-shaped, as `units.ts` does", () => {
    const ids = DATA_UNITS.map((unit) => unit.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9-]+$/);
  });

  it("takes the shared rungs FROM `units.ts` rather than restating them", () => {
    // The general converter already settles kB…TB and KiB…TiB. A second table
    // repeating those factors is a second answer waiting to drift, so the ones
    // that exist there are read from there — and this asserts the two agree.
    const shared = DATA_UNITS.filter((unit) => findUnit(unit.id) !== undefined).map(
      (unit) => unit.id,
    );
    expect(shared).toEqual([
      "byte",
      "kb-dec",
      "mb-dec",
      "gb-dec",
      "tb-dec",
      "kib",
      "mib",
      "gib",
      "tib",
      "bit",
    ]);
    for (const id of shared) {
      expect(convertData(1, id, "byte"), id).toBe(convertUnit(1, id, "byte"));
    }
  });

  it("declares the rungs `units.ts` does not have, at the sizes their standards give", () => {
    // 2^50 = 1 125 899 906 842 624; 10^15 = 1 000 000 000 000 000.
    expect(findDataUnit("pib")?.bytes).toBe(1125899906842624);
    expect(findDataUnit("pb-dec")?.bytes).toBe(1000000000000000);
    // A kilobit is 1000 bits, and 1000 bits is 125 bytes.
    expect(findDataUnit("kbit")?.bytes).toBe(125);
    expect(findDataUnit("mbit")?.bytes).toBe(125000);
    expect(findDataUnit("gbit")?.bytes).toBe(125000000);
  });

  it("labels which kilobyte each rung means, and leaves the unambiguous two unlabelled", () => {
    expect(findDataUnit("byte")?.convention).toBeNull();
    expect(findDataUnit("bit")?.convention).toBeNull();
    expect(
      DATA_UNITS.filter((unit) => unit.convention === "binary").map((unit) => unit.id),
    ).toEqual(["kib", "mib", "gib", "tib", "pib"]);
    expect(DATA_UNITS.filter((unit) => unit.counts === "bits").map((unit) => unit.id)).toEqual([
      "bit",
      "kbit",
      "mbit",
      "gbit",
    ]);
  });
});

describe("convertData", () => {
  it("keeps the decimal and the binary ladders apart — the defect this tool exists to settle", () => {
    expect(convertData(1, "kib", "byte")).toBe(1024);
    expect(convertData(1, "kb-dec", "byte")).toBe(1000);
    expect(convertData(1, "gib", "byte")).toBe(1073741824); // 2^30
    expect(convertData(1, "gb-dec", "byte")).toBe(1000000000);
    expect(convertData(1, "pib", "byte")).toBe(1125899906842624); // 2^50
    expect(convertData(1, "pb-dec", "byte")).toBe(1000000000000000);
    // The gap a user meets on a disk label: a „1 TB" drive shows as ~0,909 TiB.
    expect(convertData(1, "tb-dec", "tib") ?? Number.NaN).toBeCloseTo(0.909494701772928, 12);
  });

  it("climbs its own ladder by exactly one factor a rung", () => {
    expect(convertData(1, "mib", "kib")).toBe(1024);
    expect(convertData(1, "pib", "tib")).toBe(1024);
    expect(convertData(1, "mb-dec", "kb-dec")).toBe(1000);
    expect(convertData(1024, "kib", "mib")).toBe(1);
    expect(convertData(1.5, "gib", "mib")).toBe(1536);
  });

  it("carries the eight-to-one relation between bits and bytes", () => {
    expect(convertData(1, "byte", "bit")).toBe(8);
    expect(convertData(8, "bit", "byte")).toBe(1);
    expect(convertData(1, "kb-dec", "kbit")).toBe(8);
    expect(convertData(1, "mb-dec", "mbit")).toBe(8);
    expect(convertData(1, "gb-dec", "gbit")).toBe(8);
    // The line on every internet bill: 100 Mb/s is 12,5 MB/s.
    expect(convertData(100, "mbit", "mb-dec")).toBe(12.5);
  });

  it("returns the value unchanged when the two units are the same one", () => {
    expect(convertData(7.5, "gib", "gib")).toBe(7.5);
  });

  it("refuses an unknown unit and a value that is not finite", () => {
    expect(convertData(1, "kib", "kilo")).toBeNull();
    expect(convertData(1, "kilo", "kib")).toBeNull();
    expect(convertData(Number.NaN, "kib", "byte")).toBeNull();
    expect(convertData(Number.POSITIVE_INFINITY, "kib", "byte")).toBeNull();
  });

  it("round-trips through every rung of the ladder", () => {
    for (const unit of DATA_UNITS) {
      const there = convertData(3, "byte", unit.id) ?? Number.NaN;
      expect(convertData(there, unit.id, "byte"), unit.id).toBeCloseTo(3, 9);
    }
  });
});

describe("dataLadder and bestDataUnit", () => {
  it("puts one quantity on every rung at once", () => {
    const rows = dataLadder(1, "gib");
    expect(rows).not.toBeNull();
    const byId = new Map((rows ?? []).map((row) => [row.unitId, row.value] as const));
    expect(byId.get("byte")).toBe(1073741824);
    expect(byId.get("kib")).toBe(1048576); // 2^20
    expect(byId.get("mib")).toBe(1024);
    expect(byId.get("gib")).toBe(1);
    expect(byId.get("bit")).toBe(8589934592); // 2^33
    expect(rows).toHaveLength(DATA_UNITS.length);
  });

  it("refuses a ladder for an unknown unit or a value that is not finite", () => {
    expect(dataLadder(1, "kilo")).toBeNull();
    expect(dataLadder(Number.NaN, "gib")).toBeNull();
  });

  it("picks the rung of the convention it was ASKED for, never the one that reads nicer", () => {
    // 1536 bytes is 1,5 KiB and 1,536 kB, and both are correct answers to
    // different questions.
    expect(bestDataUnit(1536, "binary")).toEqual({ unitId: "kib", value: 1.5 });
    expect(bestDataUnit(1536, "decimal")).toEqual({ unitId: "kb-dec", value: 1.536 });
    expect(bestDataUnit(1073741824, "binary")).toEqual({ unitId: "gib", value: 1 });
    expect(bestDataUnit(1000000000, "decimal")).toEqual({ unitId: "gb-dec", value: 1 });
  });

  it("changes rung exactly at the rung's own size", () => {
    expect(bestDataUnit(1023, "binary")?.unitId).toBe("byte");
    expect(bestDataUnit(1024, "binary")?.unitId).toBe("kib");
    expect(bestDataUnit(999, "decimal")?.unitId).toBe("byte");
    expect(bestDataUnit(1000, "decimal")?.unitId).toBe("kb-dec");
    expect(bestDataUnit(0, "binary")).toEqual({ unitId: "byte", value: 0 });
  });

  it("keeps the sign of a difference and sizes it by its magnitude", () => {
    expect(bestDataUnit(-2048, "binary")).toEqual({ unitId: "kib", value: -2 });
  });

  it("never answers in bits, since a size is a byte count", () => {
    for (const bytes of [0, 1, 999, 1024, 1e12, 1e18]) {
      for (const convention of ["decimal", "binary"] as const) {
        const best = bestDataUnit(bytes, convention);
        expect(findDataUnit(best?.unitId ?? "")?.counts, `${bytes} ${convention}`).toBe("bytes");
      }
    }
  });

  it("refuses a byte count that is not finite", () => {
    expect(bestDataUnit(Number.NaN, "binary")).toBeNull();
    expect(bestDataUnit(Number.POSITIVE_INFINITY, "decimal")).toBeNull();
  });
});

// A width is a type here, so a caller cannot pass 24 by accident; this keeps the
// type referenced from the test file as well as the module.
const WIDTHS: readonly IntWidth[] = INT_WIDTHS;

describe("the widths themselves", () => {
  it("are all whole bytes, which is what makes `byteOrder` total", () => {
    for (const width of WIDTHS) expect(width % 8, String(width)).toBe(0);
  });
});

describe("the finiteness promise is about the ANSWER, not the input", () => {
  // The defect this pins: `convertData` documented a `null` return for a value
  // that is not finite, and checked it on the way IN. Both overflow sites below
  // start from a finite input, and they overflow in different operations — so a
  // guard on either one alone would still have let `Infinity` out.
  it("refuses a conversion whose product overflows", () => {
    expect(convertData(1e300, "pib", "byte")).toBeNull();
  });

  it("refuses a conversion whose division overflows, where the product did not", () => {
    // 1e300 × 125e6 is 1.25e308, still finite; dividing by the bit rung's ⅛ is
    // what tips it over.
    expect(convertData(1e300, "gbit", "bit")).toBeNull();
  });

  it("has no signed zero, because a quantity of data has no sign", () => {
    expect(Object.is(convertData(-0, "kib", "byte"), 0)).toBe(true);
    // And underflow must not MANUFACTURE one: this is a genuinely negative
    // quantity whose magnitude vanishes on the way down the ladder.
    expect(Object.is(convertData(-1e-320, "bit", "pib"), 0)).toBe(true);
  });

  it("carries a rung it cannot express through the ladder as null", () => {
    const rows = dataLadder(1e300, "pib");
    expect(rows).not.toBeNull();
    // Never `Infinity`, never `NaN` — a row that cannot say the number says so.
    expect((rows ?? []).filter((row) => row.value !== null && !Number.isFinite(row.value))).toEqual(
      [],
    );
    expect((rows ?? []).find((row) => row.unitId === "byte")?.value).toBeNull();
    // The rung the value was given in still holds it exactly.
    expect((rows ?? []).find((row) => row.unitId === "pib")?.value).toBe(1e300);
  });

  it("is exact WITHIN a ladder and admits it is not across them", () => {
    // Binary to binary is a power-of-two shift, exact at any size in range.
    expect(convertData(convertData(1023, "byte", "kib") ?? 0, "kib", "byte")).toBe(1023);
    // Decimal is not dyadic, and 1023 is a whole byte count nowhere near 2^53.
    // The docstring used to claim exactness here; this is what it actually does.
    expect(convertData(convertData(1023, "byte", "kb-dec") ?? 0, "kb-dec", "byte")).not.toBe(1023);
  });
});

describe("formatBytes keeps its own column", () => {
  it("writes exactly two characters per value whatever it is handed", () => {
    // `padStart` only pads. Before this, 256 came out „100", -1 came out „-1"
    // and 1.5 came out „1.8" — three widths in one row of a table whose entire
    // job is alignment.
    for (const field of formatBytes([256, -1, 4096, 1.5, 0, 255]).split(" ")) {
      expect(field, field).toHaveLength(2);
    }
  });

  it("still writes the real byte for everything `byteOrder` can produce", () => {
    const bytes = byteOrder(0xdeadbeefn, 32)?.bigEndian ?? [];
    expect(formatBytes(bytes)).toBe("DE AD BE EF");
  });
});
