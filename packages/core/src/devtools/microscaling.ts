/**
 * Microscaling (MX) blocks: thirty-two small numbers sharing one power-of-two
 * scale.
 *
 * **What the format actually is.** An MX block is a single `e8m0` scale `X` and
 * `k` elements `P₀…P_{k−1}` in a narrow format; element `i` means `X × Pᵢ`. That
 * is the whole idea. It works because the values inside one tensor tile are
 * close together in magnitude, so the exponent range each element has to cover
 * on its own is tiny — which is what lets `mxfp4` spend two bits on an exponent
 * and still be useful.
 *
 * **The scale is chosen, not fitted.** OCP MX v1.0 §6.3 picks
 * `X = 2^(⌊log₂(max|v|)⌋ − emax_elem)`, so that the largest element in the block
 * lands in the element format's top binade. Nothing is fitted, searched or
 * averaged: the rule is arithmetic on the largest magnitude, and two
 * implementations that follow it agree bit for bit. This module follows it
 * exactly, and the two places the specification leaves a choice — what a block
 * of all zeros does, and what happens when the scale itself would overflow —
 * are named in the code rather than picked quietly.
 *
 * **On "MXFP16".** The OCP specification defines five element formats and no
 * more: `MXFP4` (E2M1), `MXFP6` (E2M3 and E3M2), and `MXFP8` (E4M3 and E5M2).
 * There is no MXFP16 in it. The block machinery here does not care how wide its
 * element format is, so a 16-bit element works mechanically and is offered — but
 * it is offered as an extension, labelled as one, and never as a spec format,
 * because a tool that invents a standard is worse than a tool that lacks one.
 */

import {
  type DyadicValue,
  FLOAT_FORMATS,
  type FloatFormat,
  type FloatInput,
  type RoundingMode,
  binade,
  decodeFloat,
  encodeFloat,
  maxExponent,
  scaleByPowerOfTwo,
} from "./floatFormats.js";

/** Thirty-two, for every element format the specification defines. */
export const MX_BLOCK_SIZE = 32;

/** The five element formats OCP MX v1.0 defines, in the order the specification lists them. */
export const MX_SPEC_ELEMENTS = ["mxfp4", "mxfp6-e2m3", "mxfp6-e3m2", "fp8-e4m3", "fp8-e5m2"] as const;

/** Wider elements the block machinery accepts. Not in the specification — see the header. */
export const MX_EXTENDED_ELEMENTS = ["fp16", "bf16"] as const;

export type MxElementFormatId = (typeof MX_SPEC_ELEMENTS)[number] | (typeof MX_EXTENDED_ELEMENTS)[number];

/** Whether an element format is one the specification names, or an extension of ours. */
export function isSpecElement(id: MxElementFormatId): boolean {
  return (MX_SPEC_ELEMENTS as readonly string[]).includes(id);
}

/** The `e8m0` scale's own exponent range: it stores `2^(field − 127)` for a field of 0…254. */
const SCALE_MIN_EXPONENT = -127;
const SCALE_MAX_EXPONENT = 127;

/** An encoded block: one scale, and one bit pattern per element. */
export interface MxBlock {
  readonly elementFormat: FloatFormat;
  /** The `e8m0` bit pattern. `0xFF` is its NaN. */
  readonly scaleBits: bigint;
  readonly elementBits: readonly bigint[];
}

/** What choosing the scale cost, so the tool can say it rather than leave it to be noticed. */
export interface MxBlockDiagnostics {
  /** `⌊log₂(max|v|)⌋ − emax_elem` before clamping, or `null` when every input was zero. */
  readonly requestedScaleExponent: number | null;
  /** The exponent actually stored, after the `e8m0` range clamped it. */
  readonly scaleExponent: number;
  /** True when the ideal scale fell outside `e8m0` and the block had to settle. */
  readonly scaleClamped: boolean;
  /** Indices whose value did not survive the element format exactly. */
  readonly inexactIndices: readonly number[];
  /** Indices that saturated at the element format's ceiling. */
  readonly saturatedIndices: readonly number[];
  /** Indices that fell to zero although their value was not zero. */
  readonly underflowedIndices: readonly number[];
}

export interface MxEncodeResult {
  readonly block: MxBlock;
  readonly diagnostics: MxBlockDiagnostics;
}

/**
 * Pack values into one MX block.
 *
 * `values` may be shorter than {@link MX_BLOCK_SIZE}; the missing tail is
 * encoded as zero, which is what a partial tile does in practice. It may not be
 * longer — a block is a fixed thirty-two elements and silently dropping the
 * overflow would corrupt the tensor rather than the tool.
 */
export function encodeMxBlock(
  elementFormat: FloatFormat,
  values: readonly FloatInput[],
  mode: RoundingMode = "nearest-even",
): MxEncodeResult {
  if (values.length > MX_BLOCK_SIZE) {
    throw new RangeError(`an MX block holds ${MX_BLOCK_SIZE} elements, not ${values.length}`);
  }

  const anyNaN = values.some((v) => v.kind === "nan");
  const anyInfinite = values.some((v) => v.kind === "infinity");

  // The specification propagates NaN through the scale, which is the only way
  // to say "this whole block is unusable" in a format whose elements have no
  // NaN of their own. An infinity has no representation either, so it is
  // treated as the same kind of loss rather than quietly clamped to the ceiling.
  if (anyNaN || anyInfinite) {
    return {
      block: {
        elementFormat,
        scaleBits: 0xffn,
        elementBits: padded(values.map(() => 0n), elementFormat),
      },
      diagnostics: {
        requestedScaleExponent: null,
        scaleExponent: SCALE_MAX_EXPONENT,
        scaleClamped: false,
        inexactIndices: values.map((_, index) => index),
        saturatedIndices: [],
        underflowedIndices: [],
      },
    };
  }

  const binades = values.map((v) => binade(v)).filter((b): b is number => b !== null);
  // A block of nothing but zeros has no largest magnitude to scale against. The
  // specification does not say what to do; 2^0 is the choice here, because it
  // makes the block decode back to zeros exactly and makes the scale field
  // readable rather than arbitrary.
  const requestedScaleExponent =
    binades.length === 0 ? null : Math.max(...binades) - maxExponent(elementFormat);

  const scaleExponent = Math.min(
    Math.max(requestedScaleExponent ?? 0, SCALE_MIN_EXPONENT),
    SCALE_MAX_EXPONENT,
  );
  const scaleClamped = requestedScaleExponent !== null && requestedScaleExponent !== scaleExponent;

  const inexactIndices: number[] = [];
  const saturatedIndices: number[] = [];
  const underflowedIndices: number[] = [];

  const elementBits = values.map((input, index) => {
    const encoded = encodeFloat(elementFormat, scaleByPowerOfTwo(input, scaleExponent), mode, "saturate");
    if (!encoded.exact) inexactIndices.push(index);
    if (encoded.overflow) saturatedIndices.push(index);
    if (encoded.underflow) underflowedIndices.push(index);
    return encoded.bits;
  });

  return {
    block: {
      elementFormat,
      scaleBits: BigInt(scaleExponent - SCALE_MIN_EXPONENT),
      elementBits: padded(elementBits, elementFormat),
    },
    diagnostics: {
      requestedScaleExponent,
      scaleExponent,
      scaleClamped,
      inexactIndices,
      saturatedIndices,
      underflowedIndices,
    },
  };
}

/** Zero-fills a short block to its full width. */
function padded(bits: readonly bigint[], elementFormat: FloatFormat): readonly bigint[] {
  const zero = encodeFloat(elementFormat, { kind: "finite", negative: false, numerator: 0n, denominator: 1n }).bits;
  return [...bits, ...Array.from({ length: MX_BLOCK_SIZE - bits.length }, () => zero)];
}

/** One decoded element: the exact value it stands for, and the pieces it was built from. */
export interface MxElement {
  readonly elementBits: bigint;
  /** `scale × element`, exact. `null` when the block's scale is NaN. */
  readonly exact: DyadicValue | null;
  readonly value: number;
}

export interface MxDecodeResult {
  /** `null` when the scale field is `0xFF`, which marks the whole block unusable. */
  readonly scaleExponent: number | null;
  readonly elements: readonly MxElement[];
}

/** Unpack a block back into the values it stands for, exactly. */
export function decodeMxBlock(block: MxBlock): MxDecodeResult {
  const scale = decodeFloat(FLOAT_FORMATS.e8m0, block.scaleBits);
  const scaleExponent = scale.classification === "nan" ? null : scale.exponent;

  const elements = block.elementBits.map((elementBits): MxElement => {
    const element = decodeFloat(block.elementFormat, elementBits);
    if (scaleExponent === null || element.exact === null) {
      return { elementBits, exact: null, value: Number.NaN };
    }
    const exact: DyadicValue = { ...element.exact, exponent: element.exact.exponent + scaleExponent };
    return {
      elementBits,
      exact,
      value: (exact.negative ? -1 : 1) * Number(exact.significand) * 2 ** exact.exponent,
    };
  });

  return { scaleExponent, elements };
}

/**
 * How many bits the block occupies on the wire: one byte of scale plus the
 * elements, packed with no padding. `mxfp4` is the case that makes this worth
 * stating — thirty-two four-bit elements are sixteen bytes, not thirty-two.
 */
export function mxBlockBitSize(elementFormat: FloatFormat): number {
  return 8 + MX_BLOCK_SIZE * (elementFormat.signBits + elementFormat.exponentBits + elementFormat.mantissaBits);
}

/** Bits per stored value, scale included — the figure the format is actually chosen for. */
export function mxBitsPerValue(elementFormat: FloatFormat): number {
  return mxBlockBitSize(elementFormat) / MX_BLOCK_SIZE;
}
