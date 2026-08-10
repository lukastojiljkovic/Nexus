import { describe, expect, it } from "vitest";

import { FLOAT_FORMATS, type FloatInput } from "./floatFormats.js";
import { parseFloatValue } from "./floatInput.js";
import {
  MX_BLOCK_SIZE,
  MX_SPEC_ELEMENTS,
  decodeMxBlock,
  encodeMxBlock,
  isSpecElement,
  mxBitsPerValue,
  mxBlockBitSize,
} from "./microscaling.js";

const mxfp4 = FLOAT_FORMATS.mxfp4;
const e4m3 = FLOAT_FORMATS["fp8-e4m3"];

function values(...texts: readonly string[]): readonly FloatInput[] {
  return texts.map((text) => {
    const parsed = parseFloatValue(text);
    if (parsed === null) throw new Error(`test bug: "${text}" is not a value`);
    return parsed;
  });
}

/** The elements a block actually stands for, trimmed to the inputs that were given. */
const decodedHead = (block: Parameters<typeof decodeMxBlock>[0], count: number): readonly number[] =>
  decodeMxBlock(block).elements.slice(0, count).map((element) => element.value);

describe("the shared scale", () => {
  it("puts the largest element in the element format's top binade", () => {
    // max = 4, ⌊log₂4⌋ = 2, and MXFP4's emax is 2 — so the scale is 2^0 and the
    // elements are the values themselves.
    const { block, diagnostics } = encodeMxBlock(mxfp4, values("1", "2", "3", "4"));
    expect(diagnostics.requestedScaleExponent).toBe(0);
    expect(block.scaleBits).toBe(127n); // 2^0 in e8m0 is field 127
    expect(block.elementBits.slice(0, 4)).toEqual([0b0010n, 0b0100n, 0b0101n, 0b0110n]);
    expect(diagnostics.inexactIndices).toEqual([]);
    expect(decodedHead(block, 4)).toEqual([1, 2, 3, 4]);
  });

  it("scales a block of small values up into the element range", () => {
    // max = 0,3 → ⌊log₂0,3⌋ = −2, so the scale exponent is −2 − 2 = −4 and each
    // element is the value times sixteen, rounded to MXFP4's eight magnitudes.
    const { block, diagnostics } = encodeMxBlock(mxfp4, values("0.1", "0.2", "0.3"));
    expect(diagnostics.scaleExponent).toBe(-4);
    expect(block.scaleBits).toBe(123n);
    // 1,6 → 1,5 · 3,2 → 3 · 4,8 → 4, each the nearer of the two neighbours.
    expect(block.elementBits.slice(0, 3)).toEqual([0b0011n, 0b0101n, 0b0110n]);
    expect(decodedHead(block, 3)).toEqual([0.09375, 0.1875, 0.25]);
    expect(diagnostics.inexactIndices).toEqual([0, 1, 2]);
  });

  it("holds an 8-bit element block exactly where the values fit", () => {
    // ⌊log₂448⌋ = 8 and E4M3's emax is 8, so the scale is again 2^0.
    const { block, diagnostics } = encodeMxBlock(e4m3, values("448", "224", "1", "0.5"));
    expect(diagnostics.scaleExponent).toBe(0);
    expect(block.elementBits.slice(0, 4)).toEqual([0x7en, 0x76n, 0x38n, 0x30n]);
    expect(diagnostics.inexactIndices).toEqual([]);
    expect(decodedHead(block, 4)).toEqual([448, 224, 1, 0.5]);
  });

  it("clamps a scale the e8m0 field cannot hold, and says that it did", () => {
    // ⌊log₂(10^40)⌋ = 132, so the ideal scale exponent is 130 — three past what
    // e8m0 can store. The block settles at 2^127 and the element saturates.
    const { block, diagnostics } = encodeMxBlock(mxfp4, values("1e40"));
    expect(diagnostics.requestedScaleExponent).toBe(130);
    expect(diagnostics.scaleExponent).toBe(127);
    expect(diagnostics.scaleClamped).toBe(true);
    expect(diagnostics.saturatedIndices).toEqual([0]);
    expect(block.elementBits[0]).toBe(0b0111n); // 6, MXFP4's ceiling
  });

  it("gives a block of zeros a readable scale rather than an arbitrary one", () => {
    const { block, diagnostics } = encodeMxBlock(mxfp4, values("0", "0", "0"));
    expect(diagnostics.requestedScaleExponent).toBeNull();
    expect(diagnostics.scaleExponent).toBe(0);
    expect(block.elementBits.every((bits) => bits === 0n)).toBe(true);
    expect(decodedHead(block, 3)).toEqual([0, 0, 0]);
  });

  it("marks the whole block unusable when any element is NaN or infinite", () => {
    // MXFP4 has no NaN of its own, so the scale is the only place to say it.
    for (const bad of [{ kind: "nan" } as const, { kind: "infinity", negative: false } as const]) {
      const { block } = encodeMxBlock(mxfp4, [...values("1", "2"), bad]);
      expect(block.scaleBits).toBe(0xffn);
      expect(decodeMxBlock(block).scaleExponent).toBeNull();
      expect(decodeMxBlock(block).elements[0]?.value).toBeNaN();
    }
  });
});

describe("block shape", () => {
  it("fills a short block with zeros and refuses a long one", () => {
    const { block } = encodeMxBlock(mxfp4, values("1"));
    expect(block.elementBits).toHaveLength(MX_BLOCK_SIZE);
    expect(block.elementBits.slice(1).every((bits) => bits === 0n)).toBe(true);

    const tooMany = Array.from({ length: MX_BLOCK_SIZE + 1 }, () => values("1")[0]!);
    expect(() => encodeMxBlock(mxfp4, tooMany)).toThrow(RangeError);
  });

  it("reports the bit cost the specification advertises", () => {
    // OCP MX v1.0, table 1: the shared scale is one byte across thirty-two
    // elements, which is where the quarter-bit in every figure comes from.
    expect(mxBlockBitSize(mxfp4)).toBe(136);
    expect(mxBitsPerValue(mxfp4)).toBe(4.25);
    expect(mxBitsPerValue(FLOAT_FORMATS["mxfp6-e2m3"])).toBe(6.25);
    expect(mxBitsPerValue(FLOAT_FORMATS["mxfp6-e3m2"])).toBe(6.25);
    expect(mxBitsPerValue(e4m3)).toBe(8.25);
    expect(mxBitsPerValue(FLOAT_FORMATS["fp8-e5m2"])).toBe(8.25);
  });

  it("separates the five formats the specification defines from our extensions", () => {
    expect([...MX_SPEC_ELEMENTS]).toEqual(["mxfp4", "mxfp6-e2m3", "mxfp6-e3m2", "fp8-e4m3", "fp8-e5m2"]);
    for (const id of MX_SPEC_ELEMENTS) expect([id, isSpecElement(id)]).toEqual([id, true]);
    // There is no MXFP16 in OCP MX v1.0; a 16-bit element works here and is
    // labelled as ours rather than as a standard.
    expect(isSpecElement("fp16")).toBe(false);
    expect(isSpecElement("bf16")).toBe(false);
  });
});

describe("round trip", () => {
  it("returns exactly what it was given when the block can hold it", () => {
    // Every one of these is a power of two times a small odd number, so E4M3
    // holds them all with the scale that the largest picks.
    const exact = values("64", "-32", "12", "0.25", "0", "-0.5");
    const { block, diagnostics } = encodeMxBlock(e4m3, exact);
    expect(diagnostics.inexactIndices).toEqual([]);
    expect(diagnostics.saturatedIndices).toEqual([]);
    expect(diagnostics.underflowedIndices).toEqual([]);
    expect(decodedHead(block, 6)).toEqual([64, -32, 12, 0.25, 0, -0.5]);
  });

  it("loses the elements the scale pushed below the element format's floor", () => {
    // With max = 448 the scale is 2^0, and E4M3's smallest subnormal is 2^-9 —
    // so 2^-20 has nowhere to go and the block says so rather than hiding it.
    const { block, diagnostics } = encodeMxBlock(e4m3, values("448", "0.00000095367431640625"));
    expect(diagnostics.underflowedIndices).toEqual([1]);
    expect(decodedHead(block, 2)).toEqual([448, 0]);
  });
});
