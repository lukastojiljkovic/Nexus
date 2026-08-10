/**
 * A QR symbol, built from ISO/IEC 18004 rather than from a package.
 *
 * **Why this is written out rather than installed.** A QR encoder is a closed,
 * fully published algorithm — Galois-field arithmetic, five fixed tables and a
 * handful of drawing rules — and it never needs to change once it is right.
 * Reading somebody else's transitive dependency tree to be sure it makes no
 * network call and touches no DOM costs more than writing the algorithm, and
 * has to be paid again at every upgrade. This file has no imports at all.
 *
 * **The one repair every QR library performs, which this one refuses.** When a
 * payload does not fit, the common behaviour is to quietly step the error
 * correction down (H → Q → M → L) until it does. That trades away the thing the
 * user chose: level H tolerates roughly 30% of the symbol being damaged, level
 * L about 7%, and a code printed on a box that will be scanned after handling
 * is a different product at the two ends of that range. So `encodeQr` returns
 * `null` when the payload does not fit at the level asked for — the caller can
 * offer the trade, but nothing here makes it silently. Nothing is ever
 * truncated either, for the same reason.
 *
 * **Byte mode is UTF-8 and carries no ECI header.** Strictly, ISO/IEC 18004
 * says byte mode is ISO-8859-1 unless an ECI segment says otherwise, and the
 * strictly-correct encoding of „Đorđe" would open with ECI 26. In practice ECI
 * is the segment old readers are most likely to choke on, while bare UTF-8 in
 * byte mode is what essentially every generator emits and every phone camera
 * decodes. The rule this file follows is therefore the deployed one and not the
 * written one, which is a deviation worth naming rather than discovering.
 *
 * **What is deliberately absent.** Kanji mode (it needs a Shift-JIS table this
 * product has no use for), Structured Append (a payload spanning several
 * symbols), and Micro QR. Their absence is total: there is no half-built seam
 * for any of them.
 *
 * **No colour lives here.** The renderers take their two colours as required
 * parameters with no defaults — a value in this file could only be a raw
 * literal, and every colour in Nexus comes from `packages/tokens`.
 *
 * Section numbers in the comments below refer to ISO/IEC 18004:2015.
 */

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** The four error-correction levels, weakest first. L ≈ 7% recoverable, H ≈ 30%. */
export const QR_EC_LEVELS = ["L", "M", "Q", "H"] as const;

export type QrEcLevel = (typeof QR_EC_LEVELS)[number];

/** The smallest symbol version. Version *v* is a (4v + 17)-module square. */
export const QR_MIN_VERSION = 1;

/** The largest symbol version — 177 modules across. */
export const QR_MAX_VERSION = 40;

/**
 * The quiet zone the spec requires, in modules (§6.3.8). Four on every side,
 * and it is not decoration: a scanner locates the symbol by finding the finder
 * patterns against clear space, so a code rendered flush against other ink is a
 * code that does not scan.
 */
export const QR_QUIET_ZONE = 4;

/**
 * Row-major module grid; `true` is a dark module. No quiet zone is included,
 * and it is always square — every function here reads its width off
 * `modules.length` for that reason.
 */
export type QrModules = readonly (readonly boolean[])[];

/** A finished symbol. Everything a renderer or a verifier needs, and nothing else. */
export interface QrCode {
  /** 1..40. */
  readonly version: number;
  readonly ecLevel: QrEcLevel;
  /** 0..7 — the mask actually applied, whether chosen by penalty or forced. */
  readonly mask: number;
  /** Modules across, `4 * version + 17`. */
  readonly size: number;
  readonly modules: QrModules;
}

export interface QrOptions {
  /** Default `"M"`, the level most readers are tuned for. Never lowered to make a payload fit. */
  readonly ecLevel?: QrEcLevel;
  /** Refuse anything smaller. Useful when a batch of codes must render at one size. */
  readonly minVersion?: number;
  /** Refuse anything larger; the payload is then refused outright rather than grown. */
  readonly maxVersion?: number;
  /** Force a mask pattern instead of choosing the lowest-penalty one. For verification, mostly. */
  readonly mask?: number;
}

/** How one version-and-level's codewords are divided (§7.5.1, Table 9). */
export interface QrBlockLayout {
  /** Data + error correction, for the whole symbol. */
  readonly totalCodewords: number;
  /** How many of those carry the message. */
  readonly dataCodewords: number;
  /** Interleaved blocks the message is split across. */
  readonly blocks: number;
  /** Error-correction codewords generated per block. */
  readonly ecCodewordsPerBlock: number;
}

// ---------------------------------------------------------------------------
// Capacity tables (§7.5.1, Table 9)
// ---------------------------------------------------------------------------

/**
 * Error-correction codewords per block, indexed by `version - 1`.
 *
 * These four rows and the four below them are the only numbers in this file
 * that cannot be derived — everything else about capacity follows from them and
 * from the module count.
 *
 * They are transcribed, so they are checked as a transcription: the test suite
 * holds all 160 published DATA-codeword counts, not a sample. It held eighteen
 * spot checks first, and version 8-H — one block count typed as 5 instead of 6
 * — passed every one of them. What caught it was an invariant rather than a
 * value: level H came out holding MORE data than level Q, which cannot be true
 * of any version. Both are in the suite now, because the invariant found the
 * defect and only the full table proves there is no second one.
 */
const EC_CODEWORDS_PER_BLOCK: Readonly<Record<QrEcLevel, readonly number[]>> = {
  L: [
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30,
    26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30,
    30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

/** Error-correction blocks, indexed by `version - 1`. */
const EC_BLOCKS: Readonly<Record<QrEcLevel, readonly number[]>> = {
  L: [
    1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15,
    16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34,
    35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37,
    40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

/** Reads a per-version table, and is the one place a bad version number is caught. */
function versionEntry(table: readonly number[], version: number): number {
  const value = table[version - 1];
  if (value === undefined) {
    throw new RangeError(`qr: version ${version} is outside ${QR_MIN_VERSION}..${QR_MAX_VERSION}`);
  }
  return value;
}

/**
 * Modules available to data and error correction, before the codeword count is
 * rounded down (§7.4.10). Derived rather than tabulated: a 40-row table of a
 * closed-form expression is 40 more chances to mistype something.
 */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    modules -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) modules -= 36; // the two version-information blocks
  }
  return modules;
}

/** How the codewords of one version-and-level divide into blocks. */
export function qrBlockLayout(version: number, ecLevel: QrEcLevel): QrBlockLayout {
  const ecCodewordsPerBlock = versionEntry(EC_CODEWORDS_PER_BLOCK[ecLevel], version);
  const blocks = versionEntry(EC_BLOCKS[ecLevel], version);
  const totalCodewords = Math.floor(rawDataModules(version) / 8);
  return {
    totalCodewords,
    dataCodewords: totalCodewords - ecCodewordsPerBlock * blocks,
    blocks,
    ecCodewordsPerBlock,
  };
}

/** Bits the message may occupy, headers included, at one version and level. */
export function qrDataCapacityBits(version: number, ecLevel: QrEcLevel): number {
  return qrBlockLayout(version, ecLevel).dataCodewords * 8;
}

/**
 * Centres of the alignment patterns for a version (§6.3.5, Annex E), always
 * including 6 and always ascending. Empty for version 1, which has none.
 *
 * Computed from the spec's rule instead of transcribing Annex E's table, with
 * version 32 as the one exception the rule does not produce: it is the single
 * row where the published spacing (26) is not what „spread them as evenly as
 * possible, in even steps" yields (28). Special-casing it is not a fudge — the
 * table is normative and the formula is a description of it.
 */
export function qrAlignmentPatternPositions(version: number): readonly number[] {
  if (!Number.isInteger(version) || version < QR_MIN_VERSION || version > QR_MAX_VERSION) {
    throw new RangeError(`qr: version ${version} is outside ${QR_MIN_VERSION}..${QR_MAX_VERSION}`);
  }
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = size - 7; positions.length < count; position -= step) {
    positions.splice(1, 0, position);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// GF(256) and Reed-Solomon (§7.5.2, Annex A)
// ---------------------------------------------------------------------------

/** x⁸ + x⁴ + x³ + x² + 1 — the field polynomial QR fixes for GF(256). */
const GF_PRIMITIVE = 0x11d;

/**
 * Multiplication in GF(256), by Russian-peasant doubling with reduction at each
 * step. No log/antilog tables: they would be 512 bytes of state to keep correct
 * for an operation that runs a few hundred thousand times at the very largest
 * symbol, which is nothing.
 */
function gfMultiply(a: number, b: number): number {
  let product = 0;
  for (let bit = 7; bit >= 0; bit--) {
    product = (product << 1) ^ ((product >>> 7) * GF_PRIMITIVE);
    product ^= ((b >>> bit) & 1) * a;
  }
  return product & 0xff;
}

/**
 * The generator polynomial of degree `degree`: ∏(x − α^i) for i = 0..degree−1.
 * Monic, highest-degree coefficient first, so the returned array has
 * `degree + 1` entries — the same shape Annex A's tables are printed in.
 *
 * Exported because it is independently checkable: Annex A publishes these
 * polynomials as lists of α exponents, and the roots are a mathematical fact
 * that pins the result without any table at all.
 */
export function qrGeneratorPolynomial(degree: number): Uint8Array {
  if (!Number.isInteger(degree) || degree < 1) {
    throw new RangeError(`qr: generator degree ${degree} must be a positive integer`);
  }
  let polynomial = Uint8Array.of(1);
  let root = 1;
  for (let step = 0; step < degree; step++) {
    // Multiply by (x + root), where root is α^step. Subtraction is XOR in this
    // field and XOR is addition, so ∏(x − α^i) and ∏(x + α^i) are one polynomial.
    const next = new Uint8Array(polynomial.length + 1);
    for (let i = 0; i < polynomial.length; i++) {
      const coefficient = polynomial[i] ?? 0;
      next[i] = (next[i] ?? 0) ^ coefficient;
      next[i + 1] = (next[i + 1] ?? 0) ^ gfMultiply(coefficient, root);
    }
    polynomial = next;
    root = gfMultiply(root, 2);
  }
  return polynomial;
}

/**
 * The `count` error-correction codewords for one block — the remainder of
 * dividing the data polynomial, shifted up by `count`, by the generator.
 *
 * The loop is synthetic division held in a sliding window rather than a real
 * polynomial division, which is why it never allocates per data byte.
 */
export function qrErrorCorrectionCodewords(data: Uint8Array, count: number): Uint8Array {
  const generator = qrGeneratorPolynomial(count);
  const remainder = new Uint8Array(count);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.copyWithin(0, 1);
    remainder[count - 1] = 0;
    // `generator[i + 1]` skips the leading 1: dividing by a monic polynomial
    // means the quotient term IS the factor, so only the tail contributes.
    for (let i = 0; i < count; i++) {
      remainder[i] = (remainder[i] ?? 0) ^ gfMultiply(generator[i + 1] ?? 0, factor);
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Modes and segmentation (§7.3, §7.4)
// ---------------------------------------------------------------------------

type QrMode = "numeric" | "alphanumeric" | "byte";

/** Mode indicators (§7.4.1, Table 2). Kanji (1000) and ECI (0111) are not emitted. */
const MODE_INDICATOR: Readonly<Record<QrMode, number>> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};

/** §7.4.4, Table 5. Position in this string IS the character's value; lower case is absent on purpose. */
const ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** Character-count indicator widths (§7.4.1, Table 3), by version group. */
const CHAR_COUNT_BITS: Readonly<Record<QrMode, readonly [number, number, number]>> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

type VersionGroup = 0 | 1 | 2;

function versionGroup(version: number): VersionGroup {
  return version < 10 ? 0 : version < 27 ? 1 : 2;
}

function charCountBits(mode: QrMode, version: number): number {
  return CHAR_COUNT_BITS[mode][versionGroup(version)];
}

/** One run of characters in one mode, already turned into bits. */
interface QrSegment {
  readonly mode: QrMode;
  /** What the character-count indicator states — characters, except in byte mode where it is BYTES. */
  readonly count: number;
  readonly bits: readonly number[];
}

/** Appends `width` bits of `value`, most significant first. A value that does not fit is a caller bug. */
function appendBits(target: number[], value: number, width: number): void {
  if (width < 0 || width > 31 || (width < 31 && value >>> width !== 0)) {
    throw new RangeError(`qr: ${value} does not fit in ${width} bits`);
  }
  for (let bit = width - 1; bit >= 0; bit--) target.push((value >>> bit) & 1);
}

function isNumericChar(char: string): boolean {
  return char.length === 1 && char >= "0" && char <= "9";
}

function alphanumericValue(char: string): number {
  return ALPHANUMERIC_CHARSET.indexOf(char);
}

/** UTF-8 length of one code point, matching what `TextEncoder` will actually emit. */
function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  // A lone surrogate lands here too, and `TextEncoder` replaces it with U+FFFD —
  // also three bytes, so the cost model stays exact rather than merely close.
  if (code < 0x10000) return 3;
  return 4;
}

function makeSegment(mode: QrMode, text: string): QrSegment {
  const bits: number[] = [];
  if (mode === "numeric") {
    // Three digits per 10 bits, and the tail is 7 bits for two or 4 for one (§7.4.3).
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      appendBits(bits, Number(group), group.length * 3 + 1);
    }
    return { mode, count: text.length, bits };
  }
  if (mode === "alphanumeric") {
    // Pairs pack into 11 bits base 45; an odd last character takes 6 (§7.4.4).
    for (let i = 0; i < text.length; i += 2) {
      const first = alphanumericValue(text.charAt(i));
      const second = i + 1 < text.length ? alphanumericValue(text.charAt(i + 1)) : -1;
      if (first < 0 || (i + 1 < text.length && second < 0)) {
        throw new RangeError("qr: alphanumeric segment holds a character outside Table 5");
      }
      if (second < 0) appendBits(bits, first, 6);
      else appendBits(bits, first * 45 + second, 11);
    }
    return { mode, count: text.length, bits };
  }
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) appendBits(bits, byte, 8);
  return { mode, count: bytes.length, bits };
}

/**
 * Total bits the segments occupy at `version`, or `null` when one of them
 * overflows its character-count indicator.
 *
 * The overflow is unreachable with the capacities the spec actually defines —
 * at version 9 a byte segment can hold 230 bytes and the indicator holds 255 —
 * but „unreachable" is a property of the tables above, not of this function,
 * and a silently truncated count indicator produces a symbol that scans and
 * decodes to the wrong string.
 */
function totalBits(segments: readonly QrSegment[], version: number): number | null {
  let total = 0;
  for (const segment of segments) {
    const countBits = charCountBits(segment.mode, version);
    if (segment.count >= 1 << countBits) return null;
    total += 4 + countBits + segment.bits.length;
  }
  return total;
}

/** Costs are kept in sixths of a bit, the smallest unit that makes 10/3 and 11/2 both exact. */
const SIXTHS = 6;
const NUMERIC_COST = 20; // 10 bits per 3 characters
const ALPHANUMERIC_COST = 33; // 11 bits per 2 characters
const BYTE_COST_PER_BYTE = 48; // 8 bits

type Triple = [number, number, number];
type ModeIndex = 0 | 1 | 2;

const MODE_BY_INDEX: readonly [QrMode, QrMode, QrMode] = ["numeric", "alphanumeric", "byte"];

function ceilToBit(sixths: number): number {
  return Math.ceil(sixths / SIXTHS) * SIXTHS;
}

/**
 * Splits `text` into the cheapest sequence of segments for one version.
 *
 * **Why a dynamic program and not „pick one mode".** Choosing a single mode for
 * the whole payload is simpler and is wrong in the case this tool exists for: a
 * vCard or a Wi-Fi payload is byte mode with a phone number, a postcode and a
 * password inside it, and those runs cost 10 bits per three characters in
 * numeric mode against 24 in byte mode. Switching costs a header, so a greedy
 * run-splitter can easily come out worse than not splitting at all; the DP
 * cannot, because staying in the current mode is always one of the transitions
 * it considers.
 *
 * **Why sixths of a bit.** Numeric mode costs 10/3 bits per character and
 * alphanumeric 11/2, and a segment's real length is those fractions summed and
 * then rounded UP once, at the end. Carrying whole bits per character would
 * round eleven times for eleven characters and overstate every numeric run.
 * Six is the least common multiple, so every per-character cost is an integer
 * and the rounding happens exactly where the encoding does it — when a segment
 * closes, which is why a mode switch is the only transition that rounds.
 *
 * The version matters because the header width does: what is worth splitting at
 * version 1 (nine bits of alphanumeric count) may not be at version 27
 * (thirteen), so the caller recomputes this once per version group.
 */
function segmentOptimally(text: string, version: number): readonly QrSegment[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];

  const headCost: Triple = [
    (4 + charCountBits("numeric", version)) * SIXTHS,
    (4 + charCountBits("alphanumeric", version)) * SIXTHS,
    (4 + charCountBits("byte", version)) * SIXTHS,
  ];
  const indices: readonly ModeIndex[] = [0, 1, 2];

  // `cost[m]` is the cheapest encoding of the prefix seen so far that leaves an
  // OPEN segment in mode m — closed segments counted in whole bits, the open one
  // still fractional. Starting at the header alone means „a segment of mode m
  // has been opened and holds nothing yet", and since opening a second one can
  // only add a header, an empty segment can never win a transition.
  let cost: Triple = [headCost[0], headCost[1], headCost[2]];
  const cameFrom: ModeIndex[][] = [];

  for (const char of chars) {
    const charCost: Triple = [
      isNumericChar(char) ? NUMERIC_COST : Number.POSITIVE_INFINITY,
      alphanumericValue(char) >= 0 ? ALPHANUMERIC_COST : Number.POSITIVE_INFINITY,
      utf8Length(char) * BYTE_COST_PER_BYTE,
    ];
    const next: Triple = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const back: ModeIndex[] = [0, 1, 2];

    for (const to of indices) {
      if (charCost[to] === Number.POSITIVE_INFINITY) continue;
      let best = Number.POSITIVE_INFINITY;
      let bestFrom: ModeIndex = to;
      for (const from of indices) {
        if (cost[from] === Number.POSITIVE_INFINITY) continue;
        // Staying keeps the fraction; switching closes the open segment on a
        // whole bit and pays the new segment's header.
        const candidate = from === to ? cost[from] : ceilToBit(cost[from]) + headCost[to];
        if (candidate < best) {
          best = candidate;
          bestFrom = from;
        }
      }
      next[to] = best + charCost[to];
      back[to] = bestFrom;
    }

    cost = next;
    cameFrom.push(back);
  }

  let bestMode: ModeIndex = 0;
  for (const mode of indices) {
    if (ceilToBit(cost[mode]) < ceilToBit(cost[bestMode])) bestMode = mode;
  }

  const modes = new Array<ModeIndex>(chars.length);
  let current = bestMode;
  for (let i = chars.length - 1; i >= 0; i--) {
    modes[i] = current;
    // `cameFrom` has exactly one row per character, so this index is in range.
    current = (cameFrom[i] ?? [])[current] ?? current;
  }

  const segments: QrSegment[] = [];
  let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i < chars.length && modes[i] === modes[start]) continue;
    segments.push(makeSegment(MODE_BY_INDEX[modes[start] ?? 2], chars.slice(start, i).join("")));
    start = i;
  }
  return segments;
}

/** The smallest version in `[min, max]` the text fits in, with the segmentation chosen for it. */
function fitSegments(
  text: string,
  ecLevel: QrEcLevel,
  minVersion: number,
  maxVersion: number,
): { readonly version: number; readonly segments: readonly QrSegment[] } | null {
  let segments: readonly QrSegment[] = [];
  let computedFor = -1;
  for (let version = minVersion; version <= maxVersion; version++) {
    const group = versionGroup(version);
    // The cost model only changes at a group boundary, so the DP runs at most
    // three times however wide the version range is.
    if (group !== computedFor) {
      segments = segmentOptimally(text, version);
      computedFor = group;
    }
    const bits = totalBits(segments, version);
    if (bits !== null && bits <= qrDataCapacityBits(version, ecLevel)) return { version, segments };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Codewords (§7.4.9, §7.5, §7.6)
// ---------------------------------------------------------------------------

/** Pad codewords 11101100 / 00010001, alternating (§7.4.10). */
const PAD_A = 0b11101100;
const PAD_B = 0b00010001;

function buildDataCodewords(
  segments: readonly QrSegment[],
  version: number,
  ecLevel: QrEcLevel,
): Uint8Array {
  const capacity = qrDataCapacityBits(version, ecLevel);
  const bits: number[] = [];
  for (const segment of segments) {
    appendBits(bits, MODE_INDICATOR[segment.mode], 4);
    appendBits(bits, segment.count, charCountBits(segment.mode, version));
    for (const bit of segment.bits) bits.push(bit);
  }
  // Terminator: four zero bits, or fewer when the capacity runs out first (§7.4.9).
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let i = 0; bits.length < capacity; i++) appendBits(bits, i % 2 === 0 ? PAD_A : PAD_B, 8);

  const codewords = new Uint8Array(bits.length / 8);
  for (let i = 0; i < codewords.length; i++) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset++) byte = (byte << 1) | (bits[i * 8 + offset] ?? 0);
    codewords[i] = byte;
  }
  return codewords;
}

/**
 * Splits the message into blocks, appends each block's error correction, and
 * interleaves the lot (§7.6).
 *
 * Interleaving is what makes a burst of damage survivable: a coffee ring over
 * one corner destroys a few codewords of every block rather than every codeword
 * of one block, and every block can then be repaired independently. The short
 * blocks come first and are one codeword shorter, so the interleave skips them
 * on its last data pass.
 */
function interleaveBlocks(data: Uint8Array, version: number, ecLevel: QrEcLevel): Uint8Array {
  const layout = qrBlockLayout(version, ecLevel);
  const shortBlocks = layout.blocks - (layout.totalCodewords % layout.blocks);
  const shortLength =
    Math.floor(layout.totalCodewords / layout.blocks) - layout.ecCodewordsPerBlock;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let read = 0;
  for (let block = 0; block < layout.blocks; block++) {
    const length = shortLength + (block < shortBlocks ? 0 : 1);
    const chunk = data.subarray(read, read + length);
    read += length;
    dataBlocks.push(chunk);
    ecBlocks.push(qrErrorCorrectionCodewords(chunk, layout.ecCodewordsPerBlock));
  }

  const result = new Uint8Array(layout.totalCodewords);
  let write = 0;
  for (let i = 0; i <= shortLength; i++) {
    for (const block of dataBlocks) if (i < block.length) result[write++] = block[i] ?? 0;
  }
  for (let i = 0; i < layout.ecCodewordsPerBlock; i++) {
    for (const block of ecBlocks) result[write++] = block[i] ?? 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Format and version information (§7.9, §7.10)
// ---------------------------------------------------------------------------

/** §7.9.1, Table 12 — deliberately not the order the levels are named in. */
const EC_FORMAT_BITS: Readonly<Record<QrEcLevel, number>> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/**
 * The fifteen format-information bits: two bits of level, three of mask, ten of
 * BCH(15,5) remainder, the whole thing XORed with 101010000010010.
 *
 * The XOR mask is not decoration either — without it, level M with mask 0 would
 * be fifteen zero bits, and a blank region is indistinguishable from an unread
 * one. Every one of the 32 valid patterns differs from every other in at least
 * seven bits, so a reader recovers the level and the mask from a copy with
 * three errors in it.
 */
export function qrFormatBits(ecLevel: QrEcLevel, mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError(`qr: mask ${mask} is outside 0..7`);
  }
  const data = (EC_FORMAT_BITS[ecLevel] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** The eighteen version-information bits: six of version and a BCH(18,6) remainder. Versions 7+ only. */
export function qrVersionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

// ---------------------------------------------------------------------------
// The module grid
// ---------------------------------------------------------------------------

interface Canvas {
  readonly size: number;
  /** 1 for dark. */
  readonly dark: Uint8Array;
  /** 1 where a function pattern lives — the masks and the data placement both skip these. */
  readonly reserved: Uint8Array;
}

function inside(canvas: Canvas, row: number, col: number): boolean {
  return row >= 0 && row < canvas.size && col >= 0 && col < canvas.size;
}

function isDark(canvas: Canvas, row: number, col: number): boolean {
  return canvas.dark[row * canvas.size + col] === 1;
}

/** Out-of-range writes are ignored, which is what lets the finder patterns be drawn clipped. */
function paint(canvas: Canvas, row: number, col: number, dark: boolean): void {
  if (!inside(canvas, row, col)) return;
  canvas.dark[row * canvas.size + col] = dark ? 1 : 0;
}

function paintFunction(canvas: Canvas, row: number, col: number, dark: boolean): void {
  if (!inside(canvas, row, col)) return;
  canvas.dark[row * canvas.size + col] = dark ? 1 : 0;
  canvas.reserved[row * canvas.size + col] = 1;
}

function reserve(canvas: Canvas, row: number, col: number): void {
  if (!inside(canvas, row, col)) return;
  canvas.reserved[row * canvas.size + col] = 1;
}

/**
 * A finder pattern and the separator around it, as one 9×9 stamp centred on
 * `(row, col)` and clipped at the symbol's edge.
 *
 * Chebyshev distance from the centre gives the whole figure at once: 0, 1 and 3
 * are dark, 2 is the light ring inside the pattern and 4 is the separator. The
 * alternative — drawing a 7×7 square, then a border, then three edges of a
 * separator — is where an off-by-one hides.
 */
function drawFinder(canvas: Canvas, row: number, col: number): void {
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const distance = Math.max(Math.abs(dr), Math.abs(dc));
      paintFunction(canvas, row + dr, col + dc, distance !== 2 && distance !== 4);
    }
  }
}

/** A 5×5 alignment pattern: dark border, light ring, dark centre (§6.3.5). */
function drawAlignment(canvas: Canvas, row: number, col: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      paintFunction(canvas, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
}

function drawFunctionPatterns(canvas: Canvas, version: number): void {
  const size = canvas.size;

  // Timing patterns run the full width and height; the finders overwrite their ends.
  for (let i = 0; i < size; i++) {
    paintFunction(canvas, 6, i, i % 2 === 0);
    paintFunction(canvas, i, 6, i % 2 === 0);
  }

  drawFinder(canvas, 3, 3);
  drawFinder(canvas, 3, size - 4);
  drawFinder(canvas, size - 4, 3);

  const positions = qrAlignmentPatternPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      // The three centres that would sit under a finder pattern are omitted.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      drawAlignment(canvas, positions[i] ?? 0, positions[j] ?? 0);
    }
  }

  // Reserve both format-information strips before any data is placed. This
  // covers the always-dark module at (size − 8, 8) as well.
  for (let i = 0; i <= 8; i++) {
    reserve(canvas, 8, i);
    reserve(canvas, i, 8);
  }
  for (let i = 0; i < 8; i++) {
    reserve(canvas, 8, size - 1 - i);
    reserve(canvas, size - 1 - i, 8);
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const far = size - 11 + (i % 3);
      const near = Math.floor(i / 3);
      reserve(canvas, near, far);
      reserve(canvas, far, near);
    }
  }
}

function drawVersionBits(canvas: Canvas, version: number): void {
  if (version < 7) return;
  const bits = qrVersionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const far = canvas.size - 11 + (i % 3);
    const near = Math.floor(i / 3);
    paint(canvas, near, far, dark);
    paint(canvas, far, near, dark);
  }
}

/** Both copies of the format information, plus the module that is dark in every symbol (§7.9.1). */
function drawFormatBits(canvas: Canvas, ecLevel: QrEcLevel, mask: number): void {
  const bits = qrFormatBits(ecLevel, mask);
  const size = canvas.size;
  const bit = (index: number): boolean => ((bits >>> index) & 1) === 1;

  for (let i = 0; i <= 5; i++) paint(canvas, i, 8, bit(i));
  paint(canvas, 7, 8, bit(6));
  paint(canvas, 8, 8, bit(7));
  paint(canvas, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) paint(canvas, 8, 14 - i, bit(i));

  for (let i = 0; i < 8; i++) paint(canvas, 8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) paint(canvas, size - 15 + i, 8, bit(i));
  paint(canvas, size - 8, 8, true);
}

/**
 * Walks the symbol the way §7.7.3 does — upward and downward through two-module
 * columns, starting at the bottom right — and drops the codeword bits into
 * every module a function pattern has not claimed.
 *
 * Column 6 carries the vertical timing pattern, so the pair that would contain
 * it collapses to columns 5 and 4. The direction still alternates strictly at
 * every pair boundary, which is why the up/down test reads the column index
 * AFTER that collapse rather than before it.
 *
 * Any modules left over at the end (0, 3 or 7 of them, depending on version)
 * are the spec's remainder bits and stay light.
 */
function placeCodewords(canvas: Canvas, codewords: Uint8Array): void {
  const size = canvas.size;
  const totalBitsToPlace = codewords.length * 8;
  let placed = 0;
  let right = size - 1;
  while (right >= 1) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let offset = 0; offset < 2; offset++) {
        const col = right - offset;
        const row = upward ? size - 1 - vertical : vertical;
        if (canvas.reserved[row * size + col] === 1 || placed >= totalBitsToPlace) continue;
        const byte = codewords[placed >>> 3] ?? 0;
        canvas.dark[row * size + col] = (byte >>> (7 - (placed & 7))) & 1;
        placed++;
      }
    }
    right -= 2;
  }
}

// ---------------------------------------------------------------------------
// Masking and the four penalty rules (§7.8)
// ---------------------------------------------------------------------------

/**
 * Whether mask pattern `mask` inverts the module at `(row, col)` (§7.8.2,
 * Table 10). `row` is i and `col` is j in the spec's own notation — the pair is
 * easy to swap, and masks 1 and 2 are exactly the two that would still produce
 * a plausible-looking symbol if it were swapped.
 */
export function qrMaskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new RangeError(`qr: mask ${mask} is outside 0..7`);
  }
}

/** Applies a mask to every module a function pattern has not claimed. Its own inverse. */
function applyMask(canvas: Canvas, mask: number): void {
  const size = canvas.size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const index = row * size + col;
      if (canvas.reserved[index] === 1) continue;
      if (qrMaskBit(mask, row, col)) canvas.dark[index] = (canvas.dark[index] ?? 0) ^ 1;
    }
  }
}

function moduleAt(modules: QrModules, row: number, col: number): boolean {
  return modules[row]?.[col] ?? false;
}

/** Every row followed by every column, so the two scanning rules are written once. */
function scanLines(modules: QrModules): readonly (readonly boolean[])[] {
  const size = modules.length;
  const lines: boolean[][] = modules.map((row) => [...row]);
  for (let col = 0; col < size; col++) {
    const line: boolean[] = [];
    for (let row = 0; row < size; row++) line.push(moduleAt(modules, row, col));
    lines.push(line);
  }
  return lines;
}

/**
 * Rule 1 (§7.8.3): a run of five or more same-coloured modules in a row or
 * column scores 3, plus 1 for every module past the fifth.
 */
export function qrPenaltyRule1(modules: QrModules): number {
  let penalty = 0;
  for (const line of scanLines(modules)) {
    let colour = line[0] ?? false;
    let run = 0;
    for (const module of line) {
      if (module === colour) {
        run++;
        continue;
      }
      if (run >= 5) penalty += run - 2;
      colour = module;
      run = 1;
    }
    if (run >= 5) penalty += run - 2;
  }
  return penalty;
}

/** Rule 2 (§7.8.3): every 2×2 block of one colour scores 3. Blocks overlap; each is counted. */
export function qrPenaltyRule2(modules: QrModules): number {
  const size = modules.length;
  let penalty = 0;
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const corner = moduleAt(modules, row, col);
      if (
        corner === moduleAt(modules, row, col + 1) &&
        corner === moduleAt(modules, row + 1, col) &&
        corner === moduleAt(modules, row + 1, col + 1)
      ) {
        penalty += 3;
      }
    }
  }
  return penalty;
}

/**
 * How many finder-lookalikes the seven most recent runs contain.
 *
 * `history[0]` is the run that just ended and `history[6]` the oldest. The core
 * is the 1:1:3:1:1 dark-light-dark-light-dark ratio in `history[5..1]`, and it
 * counts once for each side that also carries four modules' worth of light.
 * Both sides can qualify, and then it counts twice — which is right: a scanner
 * hunting for finder patterns sweeps in both directions, so a pattern with
 * clear space on either side deceives it either way.
 */
function finderLookalikes(history: readonly number[]): number {
  const unit = history[1] ?? 0;
  const core =
    unit > 0 &&
    history[2] === unit &&
    history[3] === unit * 3 &&
    history[4] === unit &&
    history[5] === unit;
  if (!core) return 0;
  const after = history[0] ?? 0;
  const before = history[6] ?? 0;
  const trailingSpace = after >= unit * 4 && before >= unit ? 1 : 0;
  const leadingSpace = before >= unit * 4 && after >= unit ? 1 : 0;
  return trailingSpace + leadingSpace;
}

/**
 * Rule 3 (§7.8.3): a 1:1:3:1:1 ratio preceded or followed by four modules of
 * light scores 40 — the shape a scanner mistakes for a finder pattern.
 *
 * **Two readings, and this file takes the 2015 one.** The older, widely-copied
 * implementation searches each line for the literal eleven-module strings
 * 10111010000 and 00001011101 and stops there. That is the ratio at scale 1
 * only, and it treats the symbol's edge as if nothing were beyond it. The
 * current text says „1:1:3:1:1 ratio", which is scale-free, and the quiet zone
 * really is four modules of light — a lookalike touching the left edge deceives
 * a scanner exactly as much as one in the middle. So runs are measured rather
 * than matched, and each line is bracketed by a light run as wide as the
 * symbol. The two readings choose different masks for some payloads; both
 * produce valid symbols, since the spec only asks for the lowest score by
 * whichever rule the encoder applies.
 */
export function qrPenaltyRule3(modules: QrModules): number {
  const size = modules.length;
  let penalty = 0;
  for (const line of scanLines(modules)) {
    const history = [0, 0, 0, 0, 0, 0, 0];
    let pushed = false;
    const push = (length: number): void => {
      history.pop();
      // The first run pushed absorbs the quiet zone in front of the line.
      history.unshift(pushed ? length : length + size);
      pushed = true;
    };

    let colour = false; // what lies before the line is light
    let run = 0;
    for (const module of line) {
      if (module === colour) {
        run++;
        continue;
      }
      push(run);
      // The window only ever holds the pattern once a LIGHT run has closed it.
      if (!colour) penalty += finderLookalikes(history) * 40;
      colour = module;
      run = 1;
    }
    if (colour) {
      push(run);
      run = 0;
    }
    push(run + size); // and the quiet zone after it
    penalty += finderLookalikes(history) * 40;
  }
  return penalty;
}

/**
 * Rule 4 (§7.8.3): 10 points for every full 5% the proportion of dark modules
 * strays from half.
 *
 * The spec bands it — a proportion inside 50 ± 5(k+1) percent scores 10k — so a
 * symbol sitting exactly on a band edge scores the LOWER band. Computed in
 * integers against the module count rather than through a percentage, because a
 * percentage would decide those edges by floating-point noise.
 */
export function qrPenaltyRule4(modules: QrModules): number {
  const size = modules.length;
  const total = size * size;
  if (total === 0) return 0;
  let dark = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (moduleAt(modules, row, col)) dark++;
  }
  const steps = Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
  return steps * 10;
}

/** The four rules summed — the score the mask choice minimises. */
export function qrPenalty(modules: QrModules): number {
  return (
    qrPenaltyRule1(modules) +
    qrPenaltyRule2(modules) +
    qrPenaltyRule3(modules) +
    qrPenaltyRule4(modules)
  );
}

function canvasToModules(canvas: Canvas): boolean[][] {
  const modules: boolean[][] = [];
  for (let row = 0; row < canvas.size; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < canvas.size; col++) line.push(isDark(canvas, row, col));
    modules.push(line);
  }
  return modules;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * The symbol for `text`, or `null` when it does not fit at the requested error
 * correction inside the requested version range.
 *
 * `null` is the answer for empty text as well: a symbol encoding nothing is a
 * valid QR code and a useless one, and returning it would let a UI display a
 * scannable picture of the user having typed nothing.
 *
 * Throws only for a caller bug — a version range or a forced mask outside the
 * spec's own limits. Nothing a user can type reaches a throw.
 */
export function encodeQr(text: string, options: QrOptions = {}): QrCode | null {
  const ecLevel = options.ecLevel ?? "M";
  const minVersion = options.minVersion ?? QR_MIN_VERSION;
  const maxVersion = options.maxVersion ?? QR_MAX_VERSION;
  if (
    !Number.isInteger(minVersion) ||
    !Number.isInteger(maxVersion) ||
    minVersion < QR_MIN_VERSION ||
    maxVersion > QR_MAX_VERSION ||
    minVersion > maxVersion
  ) {
    throw new RangeError(`qr: version range ${minVersion}..${maxVersion} is not inside 1..40`);
  }
  const forcedMask = options.mask;
  if (
    forcedMask !== undefined &&
    (!Number.isInteger(forcedMask) || forcedMask < 0 || forcedMask > 7)
  ) {
    throw new RangeError(`qr: mask ${forcedMask} is outside 0..7`);
  }
  if (text.length === 0) return null;

  const fit = fitSegments(text, ecLevel, minVersion, maxVersion);
  if (fit === null) return null;

  const { version, segments } = fit;
  const size = version * 4 + 17;
  const canvas: Canvas = {
    size,
    dark: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
  drawFunctionPatterns(canvas, version);
  drawVersionBits(canvas, version);
  const message = buildDataCodewords(segments, version, ecLevel);
  placeCodewords(canvas, interleaveBlocks(message, version, ecLevel));

  let mask = forcedMask ?? 0;
  if (forcedMask === undefined) {
    // Masking is its own inverse, so each candidate is applied, scored and
    // undone in place — eight passes over one grid rather than eight grids.
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(canvas, candidate);
      drawFormatBits(canvas, ecLevel, candidate);
      const penalty = qrPenalty(canvasToModules(canvas));
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        mask = candidate;
      }
      applyMask(canvas, candidate);
    }
  }
  applyMask(canvas, mask);
  drawFormatBits(canvas, ecLevel, mask);

  return { version, ecLevel, mask, size, modules: canvasToModules(canvas) };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function checkQuietZone(quietZone: number): void {
  if (!Number.isInteger(quietZone) || quietZone < 0) {
    throw new RangeError(`qr: quiet zone ${quietZone} must be a whole number of modules`);
  }
}

/**
 * The dark modules as an SVG path `d`, in MODULE units with the quiet zone
 * already offset — so the caller's `viewBox` is `0 0 n n` where n is
 * `size + 2 * quietZone`, and scaling is somebody else's problem.
 *
 * Horizontal runs are merged into one rectangle each. That is not a
 * micro-optimisation: a version-40 symbol has around 15 000 dark modules, and
 * one sub-path apiece produces a path string a megabyte long that Chromium is
 * visibly slow to lay out.
 */
export function qrToSvgPath(code: QrCode, quietZone: number = QR_QUIET_ZONE): string {
  checkQuietZone(quietZone);
  const parts: string[] = [];
  for (let row = 0; row < code.size; row++) {
    let col = 0;
    while (col < code.size) {
      if (!moduleAt(code.modules, row, col)) {
        col++;
        continue;
      }
      let width = 1;
      while (col + width < code.size && moduleAt(code.modules, row, col + width)) width++;
      parts.push(`M${col + quietZone} ${row + quietZone}h${width}v1h-${width}z`);
      col += width;
    }
  }
  return parts.join("");
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

export interface QrSvgOptions {
  /** Colour of the dark modules. Required, and with no default — this package holds no colour values. */
  readonly dark: string;
  /** Colour behind the symbol, or `null` to leave it transparent. */
  readonly light: string | null;
  /** Quiet zone in modules; four is the spec's minimum and the default. */
  readonly quietZone?: number;
  /** Becomes the SVG's `<title>`, which is what a screen reader announces. */
  readonly label?: string;
}

/**
 * A standalone SVG document, sized in modules through its `viewBox` so the
 * caller decides the pixel size in CSS.
 *
 * `shape-rendering="crispEdges"` matters more than it looks: at small sizes,
 * antialiased module edges bleed into their neighbours and a phone camera reads
 * a smeared 1:1:3:1:1 ratio as no finder pattern at all.
 */
export function qrToSvg(code: QrCode, options: QrSvgOptions): string {
  const quietZone = options.quietZone ?? QR_QUIET_ZONE;
  checkQuietZone(quietZone);
  const span = code.size + quietZone * 2;
  const title = options.label === undefined ? "" : `<title>${escapeXml(options.label)}</title>`;
  const background =
    options.light === null
      ? ""
      : `<rect width="${span}" height="${span}" fill="${escapeXml(options.light)}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" ` +
    `shape-rendering="crispEdges" role="img">` +
    title +
    background +
    `<path d="${qrToSvgPath(code, quietZone)}" fill="${escapeXml(options.dark)}"/>` +
    `</svg>`
  );
}

/** One colour as canvas wants it: four channels, each a whole number 0..255. */
export interface QrRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface QrBitmapOptions {
  /** Device pixels per module. Whole numbers only — a fractional scale puts module edges between pixels. */
  readonly scale: number;
  readonly dark: QrRgba;
  readonly light: QrRgba;
  readonly quietZone?: number;
}

/** Exactly what `new ImageData(data, width, height)` takes, and nothing that assumes a DOM. */
export interface QrBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function checkChannel(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`qr: colour channel ${name} = ${value} must be a whole number 0..255`);
  }
}

function checkColour(colour: QrRgba, name: string): void {
  checkChannel(colour.r, `${name}.r`);
  checkChannel(colour.g, `${name}.g`);
  checkChannel(colour.b, `${name}.b`);
  checkChannel(colour.a, `${name}.a`);
}

/**
 * An RGBA bitmap the UI can hand straight to a canvas.
 *
 * Channels are validated rather than clamped. `Uint8ClampedArray` would happily
 * take 300 and store 255, and a caller who passed a 0–1 float would get a black
 * square with no complaint from anything — which is exactly the failure that
 * looks like „the QR renderer is broken".
 */
export function qrToBitmap(code: QrCode, options: QrBitmapOptions): QrBitmap {
  const quietZone = options.quietZone ?? QR_QUIET_ZONE;
  checkQuietZone(quietZone);
  if (!Number.isInteger(options.scale) || options.scale < 1) {
    throw new RangeError(`qr: scale ${options.scale} must be a whole number of pixels, at least 1`);
  }
  checkColour(options.dark, "dark");
  checkColour(options.light, "light");

  const span = (code.size + quietZone * 2) * options.scale;
  const data = new Uint8ClampedArray(span * span * 4);
  for (let y = 0; y < span; y++) {
    const row = Math.floor(y / options.scale) - quietZone;
    for (let x = 0; x < span; x++) {
      const col = Math.floor(x / options.scale) - quietZone;
      const colour = moduleAt(code.modules, row, col) ? options.dark : options.light;
      const at = (y * span + x) * 4;
      data[at] = colour.r;
      data[at + 1] = colour.g;
      data[at + 2] = colour.b;
      data[at + 3] = colour.a;
    }
  }
  return { width: span, height: span, data };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/**
 * The builders below all return `null` rather than a best effort, and they all
 * refuse an empty required field. The reason is the same one in every case: a
 * QR code is a picture, so a payload that is subtly wrong produces a picture
 * that is indistinguishable from a right one until somebody scans it — usually
 * on a printed card, after the moment when it could have been fixed.
 */

/**
 * Whether the text holds a control character with no printable meaning.
 *
 * A code-point scan rather than a regular-expression character class, and
 * deliberately: a class spanning the control range is exactly what ESLint's
 * `no-control-regex` exists to stop, and it is right to — such a class reads as
 * noise, so an escape that is off by one is invisible in review.
 *
 * Tab and the two line breaks are excluded. A vCard note and an SMS body may
 * each legitimately carry a break; the formats that cannot take one say so by
 * calling `isSingleLine`, which refuses breaks on top of this.
 */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isSingleLine(value: string): boolean {
  return !hasControlCharacter(value) && !/[\r\n]/.test(value);
}

/**
 * Plain text, refused only when it is empty or nothing but whitespace.
 *
 * It is not trimmed. Whitespace a user typed is content, and a builder that
 * silently changed the payload would be doing the one thing this file's whole
 * refusal discipline exists to prevent.
 */
export function qrPlainText(text: string): string | null {
  return text.trim() === "" ? null : text;
}

/**
 * An http/https URL, passed through verbatim.
 *
 * Nothing is normalised — not the scheme's case, not a missing trailing slash.
 * An encoder is free to uppercase `HTTP://` to reach the cheaper alphanumeric
 * mode, and this one does not: the payload a user is shown must be the payload
 * that was typed, and the saving is a handful of modules.
 */
export function qrUrlPayload(url: string): string | null {
  const value = url.trim();
  if (!/^https?:\/\/\S+$/i.test(value) || !isSingleLine(value)) return null;
  return value;
}

export type QrWifiSecurity = "WPA" | "WEP" | "nopass";

export interface QrWifi {
  readonly ssid: string;
  readonly security: QrWifiSecurity;
  readonly password?: string;
  /** Whether the network suppresses its SSID broadcast. */
  readonly hidden?: boolean;
}

/** `\`, `;`, `,`, `:` and `"` are the field delimiters of the WIFI: grammar and must be escaped inside a value. */
function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/**
 * A `WIFI:` payload, the de-facto format both Android and iOS join networks
 * from. There is no RFC; the grammar below is the one ZXing defined and
 * everything else copied.
 *
 * The SSID is NOT quoted. The format allows a value to be wrapped in double
 * quotes to mean „these are hexadecimal digits, not text", which turns an SSID
 * like `1234ABCD` into a byte string and joins the wrong network. Since a
 * hex-looking SSID is far more often just an SSID, this builder always writes
 * text and escapes rather than quotes.
 */
export function qrWifiPayload(network: QrWifi): string | null {
  const ssid = network.ssid;
  if (ssid === "" || !isSingleLine(ssid)) return null;
  const password = network.password ?? "";
  if (network.security === "nopass") {
    if (password !== "") return null; // a password with no security to use it is a contradiction
  } else if (password === "" || !isSingleLine(password)) {
    return null;
  }
  const fields = [`T:${network.security}`, `S:${escapeWifi(ssid)}`];
  if (network.security !== "nopass") fields.push(`P:${escapeWifi(password)}`);
  if (network.hidden === true) fields.push("H:true");
  return `WIFI:${fields.map((field) => `${field};`).join("")};`;
}

export interface QrMailto {
  readonly to: string;
  readonly subject?: string;
  readonly body?: string;
}

/** An address with no whitespace and no character that would end a field in the URI grammar. */
const EMAIL_ADDRESS = /^[^\s@,;:<>"]+@[^\s@,;:<>"]+$/;

/**
 * Percent-encoding for a `mailto:` header value (RFC 6068 §2).
 *
 * `encodeURIComponent` is exactly right here, and the reason is worth writing
 * down because the instinct is to reach for form encoding instead: RFC 6068
 * says a `+` in a mailto is a LITERAL plus, not a space, since a mailto is not
 * a form submission. `encodeURIComponent` escapes it to `%2B`, so
 * `luka+nexus@…` survives; `application/x-www-form-urlencoded` would leave it
 * bare and a client that decoded the header as a form would deliver mail to
 * `luka nexus@…`. Nothing here should ever be „fixed" into that.
 */
function encodeMailtoHeader(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Percent-encoding for the address itself, which differs from a header in one
 * character: `@` is the addr-spec's own delimiter and stays literal, where
 * `encodeURIComponent` would turn it into `%40`.
 */
function encodeMailtoAddress(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, "@");
}

/** A `mailto:` URI (RFC 6068), with the subject and body as percent-encoded headers. */
export function qrMailtoPayload(mail: QrMailto): string | null {
  const to = mail.to.trim();
  if (!EMAIL_ADDRESS.test(to)) return null;
  const headers: string[] = [];
  if (mail.subject !== undefined && mail.subject !== "") {
    headers.push(`subject=${encodeMailtoHeader(mail.subject)}`);
  }
  if (mail.body !== undefined && mail.body !== "") {
    headers.push(`body=${encodeMailtoHeader(mail.body)}`);
  }
  const query = headers.length === 0 ? "" : `?${headers.join("&")}`;
  return `mailto:${encodeMailtoAddress(to)}${query}`;
}

/**
 * A telephone number reduced to what RFC 3966 admits.
 *
 * Spaces are removed and nothing else is. This is the one normalisation in the
 * file, and it is deliberate: a `tel:` URI has no place for a space, everybody
 * types their number with them, and removing one changes no digit. The visual
 * separators the RFC does allow — `-`, `.`, `(`, `)` — are kept exactly as
 * typed. Anything else is refused rather than stripped, because a stray letter
 * in a phone number is a typo and not a formatting habit.
 *
 * A separator may lead, which `(011) 123-4567` needs and which the RFC's own
 * grammar allows: `phonedigit` is „a digit OR a visual separator", and the only
 * thing required is that at least one real digit appears. Demanding a digit
 * first would have refused the way half of Belgrade writes a landline.
 */
function normaliseTelephone(number: string): string | null {
  const compact = number.replace(/\s/g, "");
  if (!/^\+?[0-9().-]+$/.test(compact)) return null;
  const digits = compact.replace(/[^0-9]/g, "");
  return digits.length >= 3 ? compact : null;
}

/** A `tel:` URI (RFC 3966). */
export function qrTelPayload(number: string): string | null {
  const value = normaliseTelephone(number);
  return value === null ? null : `tel:${value}`;
}

export interface QrSms {
  readonly number: string;
  readonly message?: string;
}

/**
 * An `SMSTO:` payload — again a ZXing convention rather than a standard.
 *
 * The message needs no escaping: everything after the second colon is the body,
 * so a colon inside it is just a colon. It may contain newlines, because an SMS
 * may.
 */
export function qrSmsPayload(sms: QrSms): string | null {
  const number = normaliseTelephone(sms.number);
  if (number === null) return null;
  const message = sms.message ?? "";
  if (message !== "" && hasControlCharacter(message)) return null;
  return message === "" ? `SMSTO:${number}` : `SMSTO:${number}:${message}`;
}

export interface QrGeo {
  readonly latitude: number;
  readonly longitude: number;
  /** Metres above the WGS-84 ellipsoid. Omitted rather than written as zero when unknown. */
  readonly altitude?: number;
}

/**
 * A number written in plain decimal, never in exponent notation, or `null` if
 * it has no such spelling.
 *
 * `String(-0.0000001)` is „-1e-7", and a `geo:` URI containing an `e` is not a
 * `geo:` URI. Coordinates are bounded by 180 so only the small end can produce
 * an exponent, and that end is expanded here by hand rather than rounded — a
 * rounded coordinate is a different place.
 */
function plainDecimal(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  if (!text.includes("e")) return text;
  const match = /^(-?)(\d)(?:\.(\d+))?e-(\d+)$/.exec(text);
  if (match === null) return null;
  const [, sign = "", lead = "", rest = "", exponent = "0"] = match;
  return `${sign}0.${"0".repeat(Number(exponent) - 1)}${lead}${rest}`;
}

/** A `geo:` URI (RFC 5870). Refuses coordinates off the globe rather than wrapping them. */
export function qrGeoPayload(point: QrGeo): string | null {
  if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90) return null;
  if (!Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) return null;
  const latitude = plainDecimal(point.latitude);
  const longitude = plainDecimal(point.longitude);
  if (latitude === null || longitude === null) return null;
  if (point.altitude === undefined) return `geo:${latitude},${longitude}`;
  const altitude = plainDecimal(point.altitude);
  return altitude === null ? null : `geo:${latitude},${longitude},${altitude}`;
}

export interface QrVCardAddress {
  readonly street?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export interface QrVCard {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly organization?: string;
  readonly jobTitle?: string;
  readonly phone?: string;
  readonly workPhone?: string;
  readonly email?: string;
  readonly url?: string;
  readonly address?: QrVCardAddress;
  readonly note?: string;
}

/** RFC 2426 §4: backslash, semicolon and comma are structural, and a line break becomes `\n`. */
function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Folds one content line to 75 octets, RFC 2426 §2.6.
 *
 * Folding is counted in OCTETS and broken between code points, which is the
 * only interesting part: „Đorđe" is five characters and eight bytes, and a fold
 * placed by character count produces a line longer than the limit, while one
 * placed by byte count without this guard splits a character in half and yields
 * a vCard no parser can read.
 *
 * A QR vCard is nearly always short enough that nothing folds. It is done
 * anyway because unfolding is defined and universally implemented, whereas an
 * over-long line is simply out of spec.
 */
function foldVCardLine(line: string): string {
  const encoder = new TextEncoder();
  let folded = "";
  let octets = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (octets + width > 75) {
      folded += "\r\n ";
      octets = 1; // the continuation's leading space
    }
    folded += char;
    octets += width;
  }
  return folded;
}

function vCardValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A vCard 3.0 (RFC 2426), the version phone contact apps import most reliably.
 *
 * Refused when neither name is given: `FN` is mandatory in 3.0 and there would
 * be nothing to put in it — a card that imports as a blank contact is worse
 * than no card.
 *
 * Every field is TEXT and passed through escaped, with two exceptions worth
 * naming. The e-mail address is checked, because an `EMAIL` that is not an
 * address is simply wrong and the mistake is invisible until somebody taps it.
 * Control characters are refused everywhere, because there is no escape for
 * them and they would corrupt the line structure — except tab, CR and LF, which
 * vCard 4.0 does have a representation for: `escapeVCard` folds a break into
 * `\n` and `isSingleLine` refuses one in the fields where even that is wrong.
 * „Everywhere" without that clause read as a stronger promise than the code
 * makes, and the next reader to compare the two would have taken the code for
 * the mistake.
 *
 * The control-character check reads the SAME values the card is built from,
 * rather than a second list beside them. Two lists is how a field gets added to
 * one and forgotten in the other, and the field that slipped through would be
 * the one nothing refuses.
 */
export function qrVCardPayload(card: QrVCard): string | null {
  const firstName = vCardValue(card.firstName);
  const lastName = vCardValue(card.lastName);
  if (firstName === null && lastName === null) return null;

  const email = vCardValue(card.email);
  if (email !== null && !EMAIL_ADDRESS.test(email)) return null;

  const address = card.address ?? {};
  // ADR's seven components: post-office box and extended address (both empty by
  // design — no contact form here collects them), then street, city, region,
  // postal code, country.
  const addressComponents = [
    "",
    "",
    vCardValue(address.street),
    vCardValue(address.city),
    vCardValue(address.region),
    vCardValue(address.postalCode),
    vCardValue(address.country),
  ];
  const properties: readonly (readonly [string, string | null])[] = [
    ["ORG", vCardValue(card.organization)],
    ["TITLE", vCardValue(card.jobTitle)],
    ["TEL;TYPE=CELL,VOICE", vCardValue(card.phone)],
    ["TEL;TYPE=WORK,VOICE", vCardValue(card.workPhone)],
    ["EMAIL;TYPE=INTERNET", email],
    ["URL", vCardValue(card.url)],
  ];
  const note = vCardValue(card.note);

  for (const value of [
    firstName,
    lastName,
    note,
    ...addressComponents,
    ...properties.map(([, value]) => value),
  ]) {
    if (value !== null && hasControlCharacter(value)) return null;
  }

  const fullName = [firstName, lastName].filter((part) => part !== null).join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(lastName ?? "")};${escapeVCard(firstName ?? "")};;;`,
    `FN:${escapeVCard(fullName)}`,
  ];
  for (const [property, value] of properties) {
    if (value !== null) lines.push(`${property}:${escapeVCard(value)}`);
  }
  if (addressComponents.some((component) => component !== null && component !== "")) {
    lines.push(`ADR;TYPE=HOME:${addressComponents.map((c) => escapeVCard(c ?? "")).join(";")}`);
  }
  if (note !== null) lines.push(`NOTE:${escapeVCard(note)}`);
  lines.push("END:VCARD");

  return lines.map(foldVCardLine).join("\r\n");
}
