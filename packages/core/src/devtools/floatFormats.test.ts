import { describe, expect, it } from "vitest";

import {
  FLOAT_FORMATS,
  FLOAT_FORMAT_IDS,
  type DyadicValue,
  type FloatFormat,
  type FloatFormatId,
  type FloatInput,
  decodeFloat,
  encodeFloat,
  exactDecimal,
  floatBitWidth,
  floatNeighbours,
  maxFinite,
  minPositive,
  nanBits,
  ulp,
} from "./floatFormats.js";
import { convertAcross, formatBitPattern, parseBitPattern, parseFloatValue } from "./floatInput.js";

const fmt = (id: FloatFormatId): FloatFormat => FLOAT_FORMATS[id];

/** The value field's parser, for tests that are about the formats rather than the grammar. */
function value(text: string) {
  const parsed = parseFloatValue(text);
  if (parsed === null) throw new Error(`test bug: "${text}" is not a value`);
  return parsed;
}

const valueOf = (id: FloatFormatId, bits: bigint): number => decodeFloat(fmt(id), bits).value;

describe("the format table", () => {
  it("gives every format the width its specification names", () => {
    const widths: Record<FloatFormatId, number> = {
      fp64: 64,
      fp32: 32,
      // Nineteen, not thirty-two: TensorFloat-32 is binary32's exponent with
      // binary16's mantissa, and the "32" is the register it rides in.
      tf32: 19,
      bf16: 16,
      fp16: 16,
      "fp8-e5m2": 8,
      "fp8-e4m3": 8,
      "fp8-e5m2fnuz": 8,
      "fp8-e4m3fnuz": 8,
      "mxfp6-e3m2": 6,
      "mxfp6-e2m3": 6,
      mxfp4: 4,
      e8m0: 8,
    };
    for (const id of FLOAT_FORMAT_IDS) expect([id, floatBitWidth(fmt(id))]).toEqual([id, widths[id]]);
  });

  it("reaches the maximum finite value its specification publishes", () => {
    // Hand-derived from the field widths, and each one is a published figure:
    // OFP8 v1.0 tables 1 and 2 for the FP8 pair, the MX v1.0 spec for MXFP4/6.
    const maxima: Partial<Record<FloatFormatId, number>> = {
      fp32: 3.4028234663852886e38,
      fp16: 65504,
      "fp8-e5m2": 57344,
      "fp8-e4m3": 448,
      "fp8-e5m2fnuz": 57344,
      "fp8-e4m3fnuz": 240,
      "mxfp6-e3m2": 28,
      "mxfp6-e2m3": 7.5,
      mxfp4: 6,
      e8m0: 2 ** 127,
    };
    for (const [id, expected] of Object.entries(maxima)) {
      const { significand, exponent } = maxFinite(fmt(id as FloatFormatId));
      expect([id, Number(significand) * 2 ** exponent]).toEqual([id, expected]);
    }
  });

  it("reaches the smallest positive value its specification publishes", () => {
    const minima: Partial<Record<FloatFormatId, number>> = {
      fp32: 2 ** -149, // the smallest binary32 subnormal
      fp16: 2 ** -24,
      "fp8-e4m3": 2 ** -9,
      "fp8-e5m2": 2 ** -16,
      mxfp4: 0.5,
      e8m0: 2 ** -127, // e8m0 has no subnormals, so this is its smallest normal
    };
    for (const [id, expected] of Object.entries(minima)) {
      const { significand, exponent } = minPositive(fmt(id as FloatFormatId));
      expect([id, Number(significand) * 2 ** exponent]).toEqual([id, expected]);
    }
  });
});

describe("decodeFloat — the canonical bit patterns", () => {
  it("reads one, minus two and a half from binary32", () => {
    expect(valueOf("fp32", 0x3f800000n)).toBe(1);
    expect(valueOf("fp32", 0xc0000000n)).toBe(-2);
    expect(valueOf("fp32", 0x00000000n)).toBe(0);
    expect(Object.is(valueOf("fp32", 0x80000000n), -0)).toBe(true);
  });

  it("reads one from every format that has one", () => {
    // The exponent field of one is always the bias; the mantissa is always zero.
    expect(valueOf("fp64", 0x3ff0000000000000n)).toBe(1);
    expect(valueOf("fp32", 0x3f800000n)).toBe(1);
    expect(valueOf("tf32", BigInt(127) << 10n)).toBe(1);
    expect(valueOf("bf16", 0x3f80n)).toBe(1);
    expect(valueOf("fp16", 0x3c00n)).toBe(1);
    expect(valueOf("fp8-e5m2", 0x3cn)).toBe(1);
    expect(valueOf("fp8-e4m3", 0x38n)).toBe(1);
    expect(valueOf("fp8-e5m2fnuz", 0x40n)).toBe(1);
    expect(valueOf("fp8-e4m3fnuz", 0x40n)).toBe(1);
    expect(valueOf("e8m0", 0x7fn)).toBe(1);
  });

  it("classifies the reserved patterns the way each family defines them", () => {
    const classOf = (id: FloatFormatId, bits: bigint) => decodeFloat(fmt(id), bits).classification;

    // IEEE: the all-ones exponent splits on the mantissa.
    expect(classOf("fp16", 0x7c00n)).toBe("infinity");
    expect(classOf("fp16", 0xfc00n)).toBe("infinity");
    expect(classOf("fp16", 0x7c01n)).toBe("nan");
    expect(classOf("fp8-e5m2", 0x7cn)).toBe("infinity");
    expect(classOf("fp8-e5m2", 0x7dn)).toBe("nan");

    // fn: the all-ones exponent is an ordinary exponent; only S.1111.111 is NaN.
    expect(classOf("fp8-e4m3", 0x7fn)).toBe("nan");
    expect(classOf("fp8-e4m3", 0x7en)).toBe("normal");

    // fnuz: exactly one NaN, and no negative zero to collide with it.
    expect(classOf("fp8-e4m3fnuz", 0x80n)).toBe("nan");
    expect(classOf("fp8-e4m3fnuz", 0x7fn)).toBe("normal");

    // none: every pattern is a number.
    for (let bits = 0n; bits < 16n; bits += 1n) expect(classOf("mxfp4", bits)).not.toBe("nan");

    // e8m0 has no mantissa to distinguish ∞ from NaN, so its one reserved
    // pattern is NaN — and it has no zero either.
    expect(classOf("e8m0", 0xffn)).toBe("nan");
    expect(classOf("e8m0", 0x00n)).toBe("normal");
  });

  it("reads binary16's subnormals, where the implied leading bit is gone", () => {
    const smallest = decodeFloat(fmt("fp16"), 0x0001n);
    expect(smallest.classification).toBe("subnormal");
    expect(smallest.implicitBit).toBe(0);
    expect(smallest.exponent).toBe(-14); // pinned at 1 − bias, not 0 − bias
    expect(smallest.value).toBe(2 ** -24);

    const largestSubnormal = decodeFloat(fmt("fp16"), 0x03ffn);
    expect(largestSubnormal.value).toBe(1023 * 2 ** -24);
    // …and the next pattern up is the smallest normal, one step away. Gradual
    // underflow's whole purpose is that this step is not a cliff.
    expect(valueOf("fp16", 0x0400n)).toBe(1024 * 2 ** -24);
  });

  it("reads the whole MXFP4 table, all sixteen patterns", () => {
    // OCP MX v1.0, table 3: E2M1 represents exactly these values.
    const positives = [0, 0.5, 1, 1.5, 2, 3, 4, 6];
    for (const [index, expected] of positives.entries()) {
      expect(valueOf("mxfp4", BigInt(index))).toBe(expected);
      const negative = valueOf("mxfp4", BigInt(index + 8));
      expect(Object.is(negative, -0) ? 0 : negative).toBe(-expected === 0 ? 0 : -expected);
    }
  });

  it("reads e8m0 as a bare power of two", () => {
    expect(valueOf("e8m0", 0x00n)).toBe(2 ** -127);
    expect(valueOf("e8m0", 0x7en)).toBe(0.5);
    expect(valueOf("e8m0", 0xfen)).toBe(2 ** 127);
  });
});

describe("exactDecimal — the value, not the shortest thing that round-trips", () => {
  it("expands binary32's nearest to one tenth in full", () => {
    const decoded = decodeFloat(fmt("fp32"), 0x3dcccccdn);
    expect(decoded.exact).not.toBeNull();
    // The published exact value of the binary32 nearest 0,1. `String(value)`
    // stops at 0.10000000149011612, which is true about round-tripping and
    // false about the number.
    expect(exactDecimal(decoded.exact!)).toBe("0.100000001490116119384765625");
    expect(String(decoded.value)).toBe("0.10000000149011612");
  });

  it("expands a subnormal, where the exponent is most negative", () => {
    // 2^-24 = 1 / 16777216, worked by hand.
    expect(exactDecimal(decodeFloat(fmt("fp16"), 0x0001n).exact!)).toBe("0.000000059604644775390625");
  });

  it("writes whole numbers without a point, and keeps the sign of zero", () => {
    expect(exactDecimal(decodeFloat(fmt("fp32"), 0x3f800000n).exact!)).toBe("1");
    expect(exactDecimal(decodeFloat(fmt("fp32"), 0xc0000000n).exact!)).toBe("-2");
    expect(exactDecimal(decodeFloat(fmt("fp32"), 0x00000000n).exact!)).toBe("0");
    expect(exactDecimal(decodeFloat(fmt("fp32"), 0x80000000n).exact!)).toBe("-0");
  });
});

describe("encodeFloat — rounding decided once, on the exact value", () => {
  it("round-trips every representable pattern of the narrow formats", () => {
    // Exhaustive where exhaustive is cheap: if decode and encode disagree
    // anywhere in 4, 6 or 8 bits, this finds it rather than a spot check.
    for (const id of ["mxfp4", "mxfp6-e2m3", "mxfp6-e3m2", "fp8-e4m3", "fp8-e5m2", "fp8-e4m3fnuz"] as const) {
      const format = fmt(id);
      for (let bits = 0n; bits < 1n << BigInt(floatBitWidth(format)); bits += 1n) {
        const decoded = decodeFloat(format, bits);
        if (decoded.exact === null) continue;
        const back = encodeFloat(format, exactInput(decoded.exact));
        expect([id, bits, back.bits]).toEqual([id, bits, bits]);
        expect([id, bits, back.exact]).toEqual([id, bits, true]);
      }
    }
  });

  it("breaks a tie the way each rounding mode says to", () => {
    // 2049 sits exactly halfway between binary16's 2048 and 2050 — the ulp up
    // there is 2, and 2048 has the even significand.
    const halfway = value("2049");
    const at = (mode: Parameters<typeof encodeFloat>[2]) => encodeFloat(fmt("fp16"), halfway, mode).bits;
    expect(at("nearest-even")).toBe(0x6800n); // 2048
    expect(at("nearest-away")).toBe(0x6801n); // 2050
    expect(at("toward-zero")).toBe(0x6800n);
    expect(at("toward-positive")).toBe(0x6801n);
    expect(at("toward-negative")).toBe(0x6800n);
    expect(encodeFloat(fmt("fp16"), halfway, "nearest-even").exact).toBe(false);

    // …and the directed modes swap over for a negative value, because they
    // point at a place on the number line rather than at a magnitude.
    const negative = value("-2049");
    expect(encodeFloat(fmt("fp16"), negative, "toward-positive").bits).toBe(0xe800n);
    expect(encodeFloat(fmt("fp16"), negative, "toward-negative").bits).toBe(0xe801n);
  });

  it("carries into the next binade without rounding twice", () => {
    // 2047,5 in binary16: the ulp at 1024..2048 is 1, so this is halfway
    // between 2047 and 2048 and ties to the even 2048 — which is a new binade.
    const encoded = encodeFloat(fmt("fp16"), value("2047.5"));
    expect(encoded.bits).toBe(0x6800n);
    expect(decodeFloat(fmt("fp16"), encoded.bits).value).toBe(2048);
  });

  it("is exact where a double intermediate would not be", () => {
    // Both of these round to the same binary32. Only arithmetic that never
    // passed through a double can tell that the first is the value itself and
    // the second is a hair above it.
    const onTheNose = encodeFloat(fmt("fp32"), value("0.100000001490116119384765625"));
    const aHairAbove = encodeFloat(fmt("fp32"), value("0.1000000014901161193847656251"));
    expect(onTheNose.bits).toBe(0x3dcccccdn);
    expect(aHairAbove.bits).toBe(0x3dcccccdn);
    expect(onTheNose.exact).toBe(true);
    expect(aHairAbove.exact).toBe(false);
  });

  it("takes an IEEE format past its maximum to infinity, and a finite one to its ceiling", () => {
    const big = value("100000");
    const toInfinity = encodeFloat(fmt("fp16"), big);
    expect(toInfinity.bits).toBe(0x7c00n);
    expect(toInfinity.overflow).toBe(true);

    // IEEE 754 §4.3.2: a directed mode pointing back at zero never reaches ∞.
    const clamped = encodeFloat(fmt("fp16"), big, "toward-zero");
    expect(clamped.bits).toBe(0x7bffn); // 65504
    expect(clamped.overflow).toBe(true);

    // E4M3 has no infinity at all, so the behaviour is a choice and both
    // answers are in the field. Saturation is the default; NaN is what the OCP
    // reference conversion produces.
    expect(encodeFloat(fmt("fp8-e4m3"), value("1000")).bits).toBe(0x7en); // 448
    expect(encodeFloat(fmt("fp8-e4m3"), value("1000"), "nearest-even", "nan").bits).toBe(0x7fn);
  });

  it("underflows to zero without ever writing the fnuz NaN pattern", () => {
    // The trap: in e4m3fnuz the sign bit alone IS NaN, so a small negative that
    // rounds to zero must not be written as "negative zero".
    const tiny = encodeFloat(fmt("fp8-e4m3fnuz"), value("-1e-30"));
    expect(tiny.bits).toBe(0n);
    expect(tiny.underflow).toBe(true);
    expect(tiny.signLost).toBe(true);
    expect(decodeFloat(fmt("fp8-e4m3fnuz"), tiny.bits).classification).toBe("zero");

    // The IEEE-shaped sibling keeps the sign, because it has somewhere to put it.
    const signed = encodeFloat(fmt("fp8-e5m2"), value("-1e-30"));
    expect(signed.bits).toBe(0x80n);
    expect(signed.signLost).toBe(false);
  });

  it("refuses to invent an infinity for a format that has none", () => {
    expect(encodeFloat(fmt("fp8-e4m3"), { kind: "infinity", negative: false }).bits).toBe(0x7en);
    expect(encodeFloat(fmt("mxfp4"), { kind: "infinity", negative: false }).bits).toBe(0x7n); // 6, the ceiling
    expect(encodeFloat(fmt("fp16"), { kind: "infinity", negative: true }).bits).toBe(0xfc00n);
  });

  it("has no NaN to write for the microscaling element formats", () => {
    expect(nanBits(fmt("mxfp4"))).toBe(0n);
    expect(encodeFloat(fmt("mxfp4"), { kind: "nan" }).exact).toBe(false);
    expect(nanBits(fmt("fp8-e4m3"))).toBe(0x7fn);
    expect(nanBits(fmt("fp8-e4m3fnuz"))).toBe(0x80n);
    expect(nanBits(fmt("fp16"))).toBe(0x7e00n);
    expect(nanBits(fmt("e8m0"))).toBe(0xffn);
  });
});

describe("ulp and neighbours", () => {
  it("measures the step at one", () => {
    const step = ulp(fmt("fp32"), 0x3f800000n);
    expect(step).not.toBeNull();
    expect(Number(step!.significand) * 2 ** step!.exponent).toBe(2 ** -23);
    expect(Number(ulp(fmt("fp16"), 0x3c00n)!.exponent)).toBe(-10);
  });

  it("walks the number line by walking the magnitude field", () => {
    expect(floatNeighbours(fmt("fp16"), 0x3c00n)).toEqual({ below: 0x3bffn, above: 0x3c01n });
    // Crossing zero flips the sign bit rather than borrowing, because the
    // encodings are sign-magnitude and not two's complement.
    expect(floatNeighbours(fmt("fp16"), 0x0000n)).toEqual({ below: 0x8001n, above: 0x0001n });
    expect(floatNeighbours(fmt("fp16"), 0x8000n)).toEqual({ below: 0x8001n, above: 0x0001n });
    // Above the largest finite there is an infinity, and above that nothing.
    expect(floatNeighbours(fmt("fp16"), 0x7bffn).above).toBe(0x7c00n);
    expect(floatNeighbours(fmt("fp16"), 0x7c00n).above).toBeNull();
    // A negative pattern reads the other way round.
    expect(floatNeighbours(fmt("fp16"), 0xbc00n)).toEqual({ below: 0xbc01n, above: 0xbbffn });
    // E4M3 stops at its largest finite; there is no infinity to step onto.
    expect(floatNeighbours(fmt("fp8-e4m3"), 0x7en).above).toBeNull();
    // NaN has no neighbours in either direction.
    expect(floatNeighbours(fmt("fp16"), 0x7e00n)).toEqual({ below: null, above: null });
  });
});

describe("parseFloatValue — the grammar", () => {
  const asNumber = (text: string): number | null => {
    const parsed = parseFloatValue(text);
    if (parsed === null || parsed.kind !== "finite") return null;
    return (parsed.negative ? -1 : 1) * (Number(parsed.numerator) / Number(parsed.denominator));
  };

  it("reads decimals with either separator, no grouping, and an exponent", () => {
    expect(asNumber("1")).toBe(1);
    expect(asNumber("-273,15")).toBe(-273.15);
    expect(asNumber("-273.15")).toBe(-273.15);
    expect(asNumber(".5")).toBe(0.5);
    expect(asNumber("5.")).toBe(5);
    expect(asNumber("1e3")).toBe(1000);
    expect(asNumber("1,5e-2")).toBe(0.015);
    expect(asNumber("+2E+2")).toBe(200);
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const text of ["", "  ", "1 234", "1.234.5", "abc", "1e", "0x", "--1", "1,2,3", "1e1e1"]) {
      expect([text, parseFloatValue(text)]).toEqual([text, null]);
    }
  });

  it("reads the specials by name", () => {
    expect(parseFloatValue("NaN")).toEqual({ kind: "nan" });
    expect(parseFloatValue("inf")).toEqual({ kind: "infinity", negative: false });
    expect(parseFloatValue("-Infinity")).toEqual({ kind: "infinity", negative: true });
    expect(parseFloatValue("∞")).toEqual({ kind: "infinity", negative: false });
  });

  it("reads a C99 hex float, which is the only exact way to type one by hand", () => {
    expect(asNumber("0x1.8p3")).toBe(12); // 1.5 × 2^3
    expect(asNumber("0x1p-1")).toBe(0.5);
    expect(asNumber("-0x1.921fb6p+1")).toBeCloseTo(-3.14159274101, 10);
  });

  it("refuses an exponent large enough to be a denial of service", () => {
    expect(parseFloatValue("1e100000")).toBeNull();
    expect(parseFloatValue("0x1p99999")).toBeNull();
  });
});

describe("parseBitPattern and formatBitPattern", () => {
  it("reads hex with or without the prefix, and binary at the exact width", () => {
    expect(parseBitPattern(fmt("fp32"), "0x3F800000")).toBe(0x3f800000n);
    expect(parseBitPattern(fmt("fp32"), "3f800000")).toBe(0x3f800000n);
    expect(parseBitPattern(fmt("fp32"), "3F80_0000")).toBe(0x3f800000n);
    expect(parseBitPattern(fmt("fp16"), "0b0011110000000000")).toBe(0x3c00n);
    expect(parseBitPattern(fmt("fp16"), "0011110000000000")).toBe(0x3c00n);
    // Sixteen ones and zeros is binary at width 16; four of them is hex.
    expect(parseBitPattern(fmt("fp16"), "0011")).toBe(0x0011n);
  });

  it("refuses a pattern wider than the format instead of truncating it", () => {
    expect(parseBitPattern(fmt("fp16"), "0x1FFFF")).toBeNull();
    expect(parseBitPattern(fmt("mxfp4"), "0x1F")).toBeNull();
    expect(parseBitPattern(fmt("mxfp4"), "0xF")).toBe(0xfn);
    expect(parseBitPattern(fmt("tf32"), "0x7FFFF")).toBe(0x7ffffn);
    expect(parseBitPattern(fmt("tf32"), "0xFFFFF")).toBeNull();
  });

  it("splits the written pattern at the field boundaries", () => {
    expect(formatBitPattern(fmt("fp32"), 0xc0000000n)).toEqual({
      hex: "0xC0000000",
      binary: "11000000000000000000000000000000",
      signBits: "1",
      exponentBits: "10000000",
      mantissaBits: "00000000000000000000000",
    });
    // e8m0 has no sign field at all, and the split says so.
    expect(formatBitPattern(fmt("e8m0"), 0x7fn)).toEqual({
      hex: "0x7F",
      binary: "01111111",
      signBits: "",
      exponentBits: "01111111",
      mantissaBits: "",
    });
  });
});

describe("convertAcross — the view the tool is opened for", () => {
  it("shows one tenth losing more precision the narrower the format gets", () => {
    const rows = convertAcross(value("0.1"), [fmt("fp32"), fmt("fp16"), fmt("fp8-e4m3"), fmt("mxfp4")]);
    const [binary32, binary16, e4m3, mx] = rows;

    expect(binary32?.encoded.bits).toBe(0x3dcccccdn);
    expect(binary32?.stored).toBe("0.100000001490116119384765625");

    // binary16's nearest is 1638 × 2^-14, worked by hand.
    expect(binary16?.encoded.bits).toBe(0x2e66n);
    expect(binary16?.stored).toBe("0.0999755859375");
    expect(binary16?.relativeError).toBeCloseTo(-0.000244140625, 12);

    expect(e4m3?.encoded.exact).toBe(false);
    // MXFP4 cannot get near one tenth; its smallest positive value is a half.
    expect(mx?.encoded.bits).toBe(0n);
    expect(mx?.encoded.underflow).toBe(true);
  });

  it("reports no relative error for a value that has none to report", () => {
    const [row] = convertAcross(value("0"), [fmt("fp32")]);
    expect(row?.relativeError).toBeNull();
    const [nan] = convertAcross({ kind: "nan" }, [fmt("fp32")]);
    expect(nan?.relativeError).toBeNull();
    expect(nan?.stored).toBe("NaN");
  });

  it("keeps an exactly representable value exact in every format that can hold it", () => {
    for (const row of convertAcross(value("1.5"), FLOAT_FORMAT_IDS.map(fmt))) {
      // e8m0 is a power-of-two scale and cannot say 1,5; everything else can.
      expect([row.format.id, row.encoded.exact]).toEqual([row.format.id, row.format.id !== "e8m0"]);
    }
  });
});

/** A decoded value handed straight back as an exact input, for the round-trip sweep. */
function exactInput({ negative, significand, exponent }: DyadicValue): FloatInput {
  return exponent >= 0
    ? { kind: "finite", negative, numerator: significand << BigInt(exponent), denominator: 1n }
    : { kind: "finite", negative, numerator: significand, denominator: 1n << BigInt(-exponent) };
}
