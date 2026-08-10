import { describe, expect, it } from "vitest";

import {
  QR_EC_LEVELS,
  QR_QUIET_ZONE,
  encodeQr,
  qrAlignmentPatternPositions,
  qrBlockLayout,
  qrDataCapacityBits,
  qrErrorCorrectionCodewords,
  qrFormatBits,
  qrGeneratorPolynomial,
  qrGeoPayload,
  qrMailtoPayload,
  qrMaskBit,
  qrPenalty,
  qrPenaltyRule1,
  qrPenaltyRule2,
  qrPenaltyRule3,
  qrPenaltyRule4,
  qrPlainText,
  qrSmsPayload,
  qrTelPayload,
  qrToBitmap,
  qrToSvg,
  qrToSvgPath,
  qrUrlPayload,
  qrVCardPayload,
  qrVersionBits,
  qrWifiPayload,
  type QrCode,
  type QrEcLevel,
  type QrModules,
} from "./qr.js";

// ---------------------------------------------------------------------------
// Arithmetic the tests own, so nothing here is checked against itself
// ---------------------------------------------------------------------------

/**
 * α^i in GF(256) under the QR primitive polynomial 0x11D, by repeated doubling.
 * The module multiplies by shifting and reducing; this file multiplies through
 * a log table built from these powers, so the two never share a line of code.
 */
const ALPHA: readonly number[] = (() => {
  const powers = [1];
  for (let i = 1; i < 255; i++) {
    const doubled = (powers[i - 1] ?? 0) * 2;
    powers.push(doubled >= 256 ? doubled ^ 0x11d : doubled);
  }
  return powers;
})();

const LOG: readonly number[] = (() => {
  const log = new Array<number>(256).fill(0);
  for (let i = 0; i < 255; i++) log[ALPHA[i] ?? 0] = i;
  return log;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return ALPHA[(((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255)] ?? 0;
}

/** A polynomial given highest-degree-first, evaluated at `x` by Horner's rule. */
function evaluatePolynomial(coefficients: ArrayLike<number>, x: number): number {
  let value = 0;
  for (let i = 0; i < coefficients.length; i++) {
    value = gfMul(value, x) ^ (coefficients[i] ?? 0);
  }
  return value;
}

function hammingDistance(a: number, b: number): number {
  let difference = a ^ b;
  let bits = 0;
  while (difference !== 0) {
    bits += difference & 1;
    difference >>>= 1;
  }
  return bits;
}

/** Polynomial division over GF(2); a valid BCH codeword leaves remainder 0. */
function bchRemainder(value: number, generator: number, width: number): number {
  const generatorDegree = 31 - Math.clz32(generator);
  let remainder = value;
  for (let i = width - 1; i >= generatorDegree; i--) {
    if (((remainder >>> i) & 1) === 1) remainder ^= generator << (i - generatorDegree);
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// A reader, written from the spec rather than borrowed from the encoder
// ---------------------------------------------------------------------------

const ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** §7.4.1, Table 3 — transcribed a second time on purpose, as a check on the first. */
function countIndicatorBits(mode: "numeric" | "alphanumeric" | "byte", version: number): number {
  const group = version < 10 ? 0 : version < 27 ? 1 : 2;
  if (mode === "numeric") return [10, 12, 14][group] ?? 0;
  if (mode === "alphanumeric") return [9, 11, 13][group] ?? 0;
  return [8, 16, 16][group] ?? 0;
}

function isDark(modules: QrModules, row: number, col: number): boolean {
  return modules[row]?.[col] ?? false;
}

/** Every module a function pattern claims, rebuilt from §6.3 for a given version. */
function functionModules(version: number): boolean[][] {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (row: number, col: number): void => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    const line = reserved[row];
    if (line !== undefined) line[col] = true;
  };

  const finders: readonly (readonly [number, number])[] = [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ];
  for (const [centreRow, centreCol] of finders) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) mark(centreRow + dr, centreCol + dc);
    }
  }
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const positions = qrAlignmentPatternPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) mark((positions[i] ?? 0) + dr, (positions[j] ?? 0) + dc);
      }
    }
  }
  for (let i = 0; i <= 8; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const far = size - 11 + (i % 3);
      const near = Math.floor(i / 3);
      mark(near, far);
      mark(far, near);
    }
  }
  return reserved;
}

/** The fifteen format bits of one copy, corrected to the nearest of the 32 valid patterns. */
function readFormatInformation(code: QrCode, copy: 0 | 1): { ecLevel: QrEcLevel; mask: number } {
  const size = code.size;
  const bits: boolean[] = [];
  if (copy === 0) {
    for (let i = 0; i <= 5; i++) bits.push(isDark(code.modules, i, 8));
    bits.push(isDark(code.modules, 7, 8));
    bits.push(isDark(code.modules, 8, 8));
    bits.push(isDark(code.modules, 8, 7));
    for (let i = 9; i < 15; i++) bits.push(isDark(code.modules, 8, 14 - i));
  } else {
    for (let i = 0; i < 8; i++) bits.push(isDark(code.modules, 8, size - 1 - i));
    for (let i = 8; i < 15; i++) bits.push(isDark(code.modules, size - 15 + i, 8));
  }
  let value = 0;
  bits.forEach((bit, index) => {
    if (bit) value |= 1 << index;
  });

  let best: { ecLevel: QrEcLevel; mask: number } | null = null;
  let bestDistance = 16;
  for (const ecLevel of QR_EC_LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      const distance = hammingDistance(value, qrFormatBits(ecLevel, mask));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { ecLevel, mask };
      }
    }
  }
  if (best === null) throw new Error("no format pattern within reach");
  return best;
}

function readVersionInformation(code: QrCode, copy: 0 | 1): number {
  const size = code.size;
  let value = 0;
  for (let i = 0; i < 18; i++) {
    const far = size - 11 + (i % 3);
    const near = Math.floor(i / 3);
    const dark = copy === 0 ? isDark(code.modules, near, far) : isDark(code.modules, far, near);
    if (dark) value |= 1 << i;
  }
  let best = -1;
  let bestDistance = 19;
  for (let version = 7; version <= 40; version++) {
    const distance = hammingDistance(value, qrVersionBits(version));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = version;
    }
  }
  return best;
}

/** Unmasks the symbol, walks the zigzag, de-interleaves, and hands back the message codewords. */
function readCodewords(code: QrCode): { readonly total: number; readonly data: number[] } {
  const size = code.size;
  const reserved = functionModules(code.version);
  const { mask } = readFormatInformation(code, 0);

  const bits: number[] = [];
  let right = size - 1;
  while (right >= 1) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let offset = 0; offset < 2; offset++) {
        const col = right - offset;
        const row = upward ? size - 1 - vertical : vertical;
        if (reserved[row]?.[col] === true) continue;
        bits.push(isDark(code.modules, row, col) !== qrMaskBit(mask, row, col) ? 1 : 0);
      }
    }
    right -= 2;
  }

  const total = Math.floor(bits.length / 8);
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i * 8 + b] ?? 0);
    codewords.push(byte);
  }

  const layout = qrBlockLayout(code.version, code.ecLevel);
  const shortBlocks = layout.blocks - (layout.totalCodewords % layout.blocks);
  const shortLength =
    Math.floor(layout.totalCodewords / layout.blocks) - layout.ecCodewordsPerBlock;
  const lengths = Array.from({ length: layout.blocks }, (_, block) =>
    block < shortBlocks ? shortLength : shortLength + 1,
  );
  const blocks: number[][] = lengths.map(() => []);
  let read = 0;
  for (let i = 0; i <= shortLength; i++) {
    for (let block = 0; block < layout.blocks; block++) {
      if (i >= (lengths[block] ?? 0)) continue;
      blocks[block]?.push(codewords[read++] ?? 0);
    }
  }
  return { total, data: blocks.flat() };
}

/** Parses the message bit stream back into the text it was built from (§7.4). */
function decodePayload(code: QrCode): string {
  const { data } = readCodewords(code);
  const bits: number[] = [];
  for (const byte of data) {
    for (let b = 7; b >= 0; b--) bits.push((byte >>> b) & 1);
  }
  let cursor = 0;
  const take = (width: number): number => {
    let value = 0;
    for (let i = 0; i < width; i++) value = (value << 1) | (bits[cursor++] ?? 0);
    return value;
  };

  const decoder = new TextDecoder();
  let text = "";
  while (cursor + 4 <= bits.length) {
    const mode = take(4);
    if (mode === 0) break;
    if (mode === 1) {
      let remaining = take(countIndicatorBits("numeric", code.version));
      while (remaining > 0) {
        const digits = Math.min(3, remaining);
        text += String(take(digits * 3 + 1)).padStart(digits, "0");
        remaining -= digits;
      }
    } else if (mode === 2) {
      let remaining = take(countIndicatorBits("alphanumeric", code.version));
      while (remaining > 0) {
        if (remaining === 1) {
          text += ALPHANUMERIC_CHARSET.charAt(take(6));
          remaining = 0;
        } else {
          const pair = take(11);
          text +=
            ALPHANUMERIC_CHARSET.charAt(Math.floor(pair / 45)) +
            ALPHANUMERIC_CHARSET.charAt(pair % 45);
          remaining -= 2;
        }
      }
    } else if (mode === 4) {
      const length = take(countIndicatorBits("byte", code.version));
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = take(8);
      text += decoder.decode(bytes);
    } else {
      throw new Error(`unexpected mode indicator ${mode}`);
    }
  }
  return text;
}

/** `#` is a dark module, anything else light. Rows must all be the same length. */
function grid(rows: readonly string[]): QrModules {
  return rows.map((row) => [...row].map((char) => char === "#"));
}

function darkModuleCount(modules: QrModules): number {
  return modules.reduce((total, row) => total + row.filter(Boolean).length, 0);
}

// ---------------------------------------------------------------------------

describe("GF(256) and Reed-Solomon", () => {
  /**
   * ISO/IEC 18004 Annex A prints the generator polynomials as lists of α
   * exponents, highest degree first. Three of them, spelled out.
   */
  const ANNEX_A: ReadonlyMap<number, readonly number[]> = new Map([
    [7, [0, 87, 229, 146, 149, 238, 102, 21]],
    [10, [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]],
    [13, [0, 74, 152, 176, 100, 86, 100, 106, 104, 130, 218, 206, 140, 78]],
  ]);

  it("reproduces the generator polynomials Annex A publishes", () => {
    for (const [degree, exponents] of ANNEX_A) {
      const expected = exponents.map((exponent) => ALPHA[exponent] ?? 0);
      expect([...qrGeneratorPolynomial(degree)], `degree ${degree}`).toEqual(expected);
    }
  });

  /**
   * The mathematical definition, which pins the polynomial without any table:
   * it is the monic one whose roots are α⁰ … α^(n−1). Checked for every
   * codeword count the spec's block tables actually use.
   */
  it("makes every generator monic with the right roots and no others", () => {
    for (const degree of [7, 10, 13, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30]) {
      const generator = qrGeneratorPolynomial(degree);
      expect(generator.length, `degree ${degree}`).toBe(degree + 1);
      expect(generator[0], `degree ${degree} leading coefficient`).toBe(1);
      for (let i = 0; i < degree; i++) {
        expect(evaluatePolynomial(generator, ALPHA[i] ?? 0), `degree ${degree} at α^${i}`).toBe(0);
      }
      // α^degree is not a root, so the polynomial is not accidentally larger.
      expect(evaluatePolynomial(generator, ALPHA[degree] ?? 0)).not.toBe(0);
    }
  });

  /**
   * „HELLO WORLD" at version 1-Q — the worked example the standard's own
   * tutorials reproduce. The thirteen data codewords are derived by hand in the
   * encoding suite below; these are the thirteen error-correction codewords
   * that follow them.
   */
  const HELLO_DATA = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
  const HELLO_EC = [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16];

  it("produces the published error-correction codewords for HELLO WORLD at 1-Q", () => {
    const ec = qrErrorCorrectionCodewords(Uint8Array.from(HELLO_DATA), 13);
    expect([...ec]).toEqual(HELLO_EC);
  });

  /**
   * The property that makes a Reed-Solomon block a Reed-Solomon block: the
   * whole codeword, read as a polynomial, vanishes at every root of the
   * generator. This holds whatever the published vector says, so it catches a
   * wrong answer that happens to agree with a mis-remembered table.
   */
  it("leaves every syndrome zero, for blocks of several lengths", () => {
    for (const count of [7, 13, 17, 30]) {
      const data = Uint8Array.from({ length: 40 }, (_, i) => (i * 37 + 11) & 0xff);
      const block = [...data, ...qrErrorCorrectionCodewords(data, count)];
      for (let i = 0; i < count; i++) {
        expect(evaluatePolynomial(block, ALPHA[i] ?? 0), `count ${count}, syndrome ${i}`).toBe(0);
      }
    }
  });

  it("breaks a syndrome when a single codeword is corrupted, so the check has teeth", () => {
    const data = Uint8Array.from([1, 2, 3, 4, 5]);
    const block = [...data, ...qrErrorCorrectionCodewords(data, 10)];
    block[2] = (block[2] ?? 0) ^ 0x40;
    const syndromes = Array.from({ length: 10 }, (_, i) =>
      evaluatePolynomial(block, ALPHA[i] ?? 0),
    );
    expect(syndromes.some((syndrome) => syndrome !== 0)).toBe(true);
  });
});

describe("capacity tables", () => {
  /**
   * The total-codeword column of ISO/IEC 18004 Table 9. It comes from the
   * module geometry rather than from any transcribed table, so this is the one
   * test here that checks the derivation instead of the typing.
   */
  const PUBLISHED_TOTAL_CODEWORDS: readonly number[] = [
    26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
    1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876,
    3034, 3196, 3362, 3532, 3706,
  ];

  /**
   * Every data-codeword count ISO/IEC 18004 Table 7 publishes — all 160 of
   * them, not a sample.
   *
   * A sample is what this was, and it let a single mistyped block count for
   * version 8-H through: eighteen spot checks happened to miss the one cell
   * that was wrong, and the defect only surfaced because a separate invariant
   * noticed level H holding MORE data than level Q. Sampling a transcribed
   * table tests the sample. So the whole column is here for each level, and
   * every cell is pinned two ways at once — the count itself, and the fact that
   * `totalCodewords − dataCodewords` divides exactly by the error-correction
   * codewords per block, which a mistyped digit almost never survives.
   */
  const PUBLISHED_DATA_CODEWORDS: Readonly<Record<QrEcLevel, readonly number[]>> = {
    L: [
      19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589, 647, 721, 795,
      861, 932, 1006, 1094, 1174, 1276, 1370, 1468, 1531, 1631, 1735, 1843, 1955, 2071, 2191, 2306,
      2434, 2566, 2702, 2812, 2956,
    ],
    M: [
      16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669,
      714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914,
      1992, 2102, 2216, 2334,
    ],
    Q: [
      13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295, 325, 367, 397, 445, 485,
      512, 568, 614, 664, 718, 754, 808, 871, 911, 985, 1033, 1115, 1171, 1231, 1286, 1354, 1426,
      1502, 1582, 1666,
    ],
    H: [
      9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253, 283, 313, 341, 385,
      406, 442, 464, 514, 538, 596, 628, 661, 701, 745, 793, 845, 901, 961, 986, 1054, 1096, 1142,
      1222, 1276,
    ],
  };

  it("derives the published total-codeword count at every version", () => {
    for (let version = 1; version <= 40; version++) {
      expect(qrBlockLayout(version, "L").totalCodewords, `version ${version}`).toBe(
        PUBLISHED_TOTAL_CODEWORDS[version - 1],
      );
    }
  });

  it("matches every one of the 160 published data-codeword counts", () => {
    for (const ecLevel of QR_EC_LEVELS) {
      const column = PUBLISHED_DATA_CODEWORDS[ecLevel];
      expect(column.length).toBe(40);
      for (let version = 1; version <= 40; version++) {
        expect(
          qrBlockLayout(version, ecLevel).dataCodewords,
          `${version}-${ecLevel}`,
        ).toBe(column[version - 1]);
      }
    }
  });

  it("divides the published error-correction remainder exactly into blocks", () => {
    for (const ecLevel of QR_EC_LEVELS) {
      const column = PUBLISHED_DATA_CODEWORDS[ecLevel];
      for (let version = 1; version <= 40; version++) {
        const layout = qrBlockLayout(version, ecLevel);
        const ecTotal = layout.totalCodewords - (column[version - 1] ?? 0);
        expect(ecTotal % layout.ecCodewordsPerBlock, `${version}-${ecLevel}`).toBe(0);
        expect(ecTotal / layout.ecCodewordsPerBlock, `${version}-${ecLevel}`).toBe(layout.blocks);
      }
    }
  });

  it("splits every version and level into blocks that add back up", () => {
    for (let version = 1; version <= 40; version++) {
      for (const ecLevel of QR_EC_LEVELS) {
        const layout = qrBlockLayout(version, ecLevel);
        expect(
          layout.dataCodewords + layout.blocks * layout.ecCodewordsPerBlock,
          `${version}-${ecLevel}`,
        ).toBe(layout.totalCodewords);
        expect(layout.dataCodewords, `${version}-${ecLevel}`).toBeGreaterThan(0);
        // Every block must hold at least one data codeword, or interleaving is undefined.
        expect(
          Math.floor(layout.totalCodewords / layout.blocks) - layout.ecCodewordsPerBlock,
          `${version}-${ecLevel}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("orders the levels by strength: L holds the most data at every version, H the least", () => {
    for (let version = 1; version <= 40; version++) {
      const capacities = QR_EC_LEVELS.map((level) => qrDataCapacityBits(version, level));
      for (let i = 1; i < capacities.length; i++) {
        expect(capacities[i], `version ${version}`).toBeLessThan(capacities[i - 1] ?? 0);
      }
    }
  });

  /** ISO/IEC 18004 Annex E, Table E.1 — four rows of it, including the one the formula misses. */
  it("places the alignment patterns where Annex E does", () => {
    expect(qrAlignmentPatternPositions(1)).toEqual([]);
    expect(qrAlignmentPatternPositions(2)).toEqual([6, 18]);
    expect(qrAlignmentPatternPositions(7)).toEqual([6, 22, 38]);
    expect(qrAlignmentPatternPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(qrAlignmentPatternPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it("keeps every alignment centre inside the symbol and strictly ascending", () => {
    for (let version = 2; version <= 40; version++) {
      const positions = qrAlignmentPatternPositions(version);
      expect(positions.length, `version ${version}`).toBe(Math.floor(version / 7) + 2);
      expect(positions[0]).toBe(6);
      expect(positions[positions.length - 1]).toBe(version * 4 + 17 - 7);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i], `version ${version}`).toBeGreaterThan(positions[i - 1] ?? 0);
      }
    }
  });

  it("refuses a version outside 1..40", () => {
    expect(() => qrAlignmentPatternPositions(0)).toThrow(RangeError);
    expect(() => qrAlignmentPatternPositions(41)).toThrow(RangeError);
    expect(() => qrAlignmentPatternPositions(7.5)).toThrow(RangeError);
  });
});

describe("format and version information", () => {
  it("keeps every format string a valid BCH(15,5) codeword", () => {
    for (const ecLevel of QR_EC_LEVELS) {
      for (let mask = 0; mask < 8; mask++) {
        const bits = qrFormatBits(ecLevel, mask);
        expect(bits, `${ecLevel}/${mask}`).toBeLessThan(1 << 15);
        // The XOR mask comes off before the code is checked; 0x537 is the generator.
        expect(bchRemainder(bits ^ 0x5412, 0x537, 15), `${ecLevel}/${mask}`).toBe(0);
      }
    }
  });

  /**
   * §7.9.1 states the minimum Hamming distance of the format code is 7, which
   * is why a reader recovers the level and mask from a copy with three damaged
   * modules. That figure is an external fact about the code, so it pins the
   * XOR mask and the generator together without either being restated here.
   */
  it("keeps all 32 format strings at least 7 bits apart", () => {
    const patterns = QR_EC_LEVELS.flatMap((ecLevel) =>
      Array.from({ length: 8 }, (_, mask) => qrFormatBits(ecLevel, mask)),
    );
    expect(new Set(patterns).size).toBe(32);
    let minimum = 15;
    for (let i = 0; i < patterns.length; i++) {
      for (let j = i + 1; j < patterns.length; j++) {
        minimum = Math.min(minimum, hammingDistance(patterns[i] ?? 0, patterns[j] ?? 0));
      }
    }
    expect(minimum).toBe(7);
  });

  it("never lets a format string be all zeros, which the XOR mask exists to prevent", () => {
    for (const ecLevel of QR_EC_LEVELS) {
      for (let mask = 0; mask < 8; mask++) expect(qrFormatBits(ecLevel, mask)).not.toBe(0);
    }
  });

  it("keeps every version string a valid BCH(18,6) codeword, 8 bits apart", () => {
    const patterns: number[] = [];
    for (let version = 7; version <= 40; version++) {
      const bits = qrVersionBits(version);
      expect(bits, `version ${version}`).toBeLessThan(1 << 18);
      expect(bits >>> 12, `version ${version}`).toBe(version);
      expect(bchRemainder(bits, 0x1f25, 18), `version ${version}`).toBe(0);
      patterns.push(bits);
    }
    let minimum = 18;
    for (let i = 0; i < patterns.length; i++) {
      for (let j = i + 1; j < patterns.length; j++) {
        minimum = Math.min(minimum, hammingDistance(patterns[i] ?? 0, patterns[j] ?? 0));
      }
    }
    expect(minimum).toBe(8);
  });

  it("refuses a mask outside 0..7", () => {
    expect(() => qrFormatBits("M", 8)).toThrow(RangeError);
    expect(() => qrFormatBits("M", -1)).toThrow(RangeError);
  });
});

describe("mask patterns", () => {
  /**
   * §7.8.2, Table 10, evaluated by hand at (row, col) = (2, 3): the point was
   * chosen because it separates all eight conditions into a mixture of true and
   * false, so a swapped row/column argument cannot pass.
   *
   * 0 → (2+3) % 2 = 1        → false
   * 1 → 2 % 2 = 0            → true
   * 2 → 3 % 3 = 0            → true
   * 3 → (2+3) % 3 = 2        → false
   * 4 → (1 + 1) % 2 = 0      → true
   * 5 → 6%2 + 6%3 = 0 + 0    → true
   * 6 → (6%2 + 6%3) % 2 = 0  → true
   * 7 → ((2+3)%2 + 6%3) % 2 = (1 + 0) % 2 = 1 → false
   */
  it("matches Table 10 at (2, 3)", () => {
    const expected = [false, true, true, false, true, true, true, false];
    expect(Array.from({ length: 8 }, (_, mask) => qrMaskBit(mask, 2, 3))).toEqual(expected);
  });

  /**
   * And at (3, 2), the transpose. Masks 1 and 2 swap, which is exactly the
   * failure a row/column mix-up produces and nothing else detects.
   *
   * 0 → (3+2) % 2 = 1        → false
   * 1 → 3 % 2 = 1            → false
   * 2 → 2 % 3 = 2            → false
   * 3 → (3+2) % 3 = 2        → false
   * 4 → (1 + 0) % 2 = 1      → false
   * 5 → 6%2 + 6%3 = 0        → true
   * 6 → 0 % 2 = 0            → true
   * 7 → ((3+2)%2 + 6%3) % 2 = 1 → false
   */
  it("matches Table 10 at (3, 2), which masks 1 and 2 tell apart from (2, 3)", () => {
    const expected = [false, false, false, false, false, true, true, false];
    expect(Array.from({ length: 8 }, (_, mask) => qrMaskBit(mask, 3, 2))).toEqual(expected);
  });

  it("covers close to half the plane with every pattern", () => {
    for (let mask = 0; mask < 8; mask++) {
      let hits = 0;
      for (let row = 0; row < 60; row++) {
        for (let col = 0; col < 60; col++) if (qrMaskBit(mask, row, col)) hits++;
      }
      expect(hits / 3600, `mask ${mask}`).toBeGreaterThan(0.3);
      expect(hits / 3600, `mask ${mask}`).toBeLessThan(0.7);
    }
  });

  it("refuses a pattern outside 0..7", () => {
    expect(() => qrMaskBit(8, 0, 0)).toThrow(RangeError);
  });
});

describe("penalty rule 1 — runs of one colour", () => {
  /**
   * A 5×5 of light modules. Five rows and five columns, each one run of five,
   * and a run of exactly five scores 3 + (5 − 5) = 3. Ten lines × 3 = 30.
   */
  it("scores a blank 5×5 at 30", () => {
    expect(qrPenaltyRule1(grid([".....", ".....", ".....", ".....", "....."]))).toBe(30);
  });

  /**
   * One dark row on top. Rows: the dark row is a run of five (3) and the four
   * light rows are runs of five (3 each) — 15. Columns: every column reads one
   * dark then four light, and neither run reaches five — 0.
   */
  it("scores a single dark row at 15, counting nothing down the columns", () => {
    expect(qrPenaltyRule1(grid(["#####", ".....", ".....", ".....", "....."]))).toBe(15);
  });

  /**
   * One dark row on top of an 8×8, which exercises the „+1 per module past the
   * fifth" clause in both directions.
   *
   * Rows: each of the eight rows is a single run of eight, scoring
   * 3 + (8 − 5) = 6, so 8 × 6 = 48.
   * Columns: each column reads one dark module then seven light. The run of one
   * scores nothing; the run of seven scores 3 + (7 − 5) = 5. 8 × 5 = 40.
   * Total 88.
   */
  it("adds one point for every module past the fifth", () => {
    const rows = ["########", ...Array.from({ length: 7 }, () => "........")];
    expect(qrPenaltyRule1(grid(rows))).toBe(88);
  });

  it("scores nothing when no run reaches five", () => {
    expect(qrPenaltyRule1(grid(["#.#.#", ".#.#.", "#.#.#", ".#.#.", "#.#.#"]))).toBe(0);
  });
});

describe("penalty rule 2 — 2×2 blocks", () => {
  /** A 5×5 holds 4 × 4 = 16 overlapping 2×2 blocks, each one colour, at 3 apiece. */
  it("scores a blank 5×5 at 48", () => {
    expect(qrPenaltyRule2(grid([".....", ".....", ".....", ".....", "....."]))).toBe(48);
  });

  /**
   * With the top row dark, the four blocks spanning rows 0–1 are mixed and
   * score nothing; the twelve blocks in rows 1–4 are all light. 12 × 3 = 36.
   */
  it("skips blocks that are not one colour", () => {
    expect(qrPenaltyRule2(grid(["#####", ".....", ".....", ".....", "....."]))).toBe(36);
  });

  it("scores a checkerboard at nothing", () => {
    expect(qrPenaltyRule2(grid(["#.#.#", ".#.#.", "#.#.#", ".#.#.", "#.#.#"]))).toBe(0);
  });
});

describe("penalty rule 3 — finder lookalikes", () => {
  /**
   * An 11-wide row holding `#.###.#....` and nothing else dark anywhere.
   *
   * Run history for that row, newest first, with the quiet zone counted as an
   * 11-module light run at each end: the dark 1, light 1, dark 3, light 1,
   * dark 1 core sits between a leading light run of 11 and a trailing one of
   * 4 + 11 = 15. Both are at least four times the unit, so the lookalike counts
   * once in each direction — 2 × 40 = 80.
   *
   * Every other line scores nothing: the remaining rows are blank, and each
   * column is at most one dark module against ten light, which is no ratio.
   */
  it("scores a finder lookalike touching the edge at 80, once for each side", () => {
    const rows = ["#.###.#....", ...Array.from({ length: 10 }, () => "...........")];
    expect(qrPenaltyRule3(grid(rows))).toBe(80);
  });

  it("scores a blank symbol at nothing", () => {
    expect(qrPenaltyRule3(grid(Array.from({ length: 11 }, () => "...........")))).toBe(0);
  });

  /**
   * The ratio is scale-free, which is the whole difference between the 2015
   * reading and the older substring search. Doubling every run — dark 2, light
   * 2, dark 6, light 2, dark 2 — is still 1:1:3:1:1 and still scores.
   */
  it("recognises the ratio at scale 2, not only at scale 1", () => {
    const line = "##..######..##......";
    const rows = [line, ...Array.from({ length: 19 }, () => "....................")];
    expect(qrPenaltyRule3(grid(rows))).toBeGreaterThanOrEqual(40);
  });
});

describe("penalty rule 4 — proportion of dark modules", () => {
  /**
   * All light: 0% dark, 50 points of deviation. The band is 50 ± 5(k+1), so the
   * smallest k that contains 0% needs 5(k+1) ≥ 50, giving k = 9 and 90 points.
   */
  it("scores a blank symbol at 90", () => {
    expect(qrPenaltyRule4(grid([".....", ".....", ".....", ".....", "....."]))).toBe(90);
  });

  it("scores an entirely dark symbol at 90 as well", () => {
    expect(qrPenaltyRule4(grid(["#####", "#####", "#####", "#####", "#####"]))).toBe(90);
  });

  /** 12 dark of 25 is 48%, inside 50 ± 5, so k = 0. */
  it("scores nothing when the proportion is within five points of half", () => {
    expect(qrPenaltyRule4(grid(["###..", "###..", "###..", "###..", "....."]))).toBe(0);
  });

  /** 15 dark of 25 is 60%: 5(k+1) ≥ 10 gives k = 1. */
  it("scores ten points at ten points of deviation", () => {
    expect(qrPenaltyRule4(grid(["#####", "#####", "#####", ".....", "....."]))).toBe(10);
  });

  /**
   * Exactly 55% — the band edge. „Inside 50 ± 5(k+1)" puts it in the k = 0
   * band, so it scores nothing, and one module more scores ten. Which side of
   * the edge this falls on is a choice, and this is the test that records it.
   */
  it("puts a proportion sitting exactly on a band edge in the lower band", () => {
    const fiftyFive = [
      ...Array.from({ length: 5 }, () => "##########"),
      "#####.....",
      ...Array.from({ length: 4 }, () => ".........."),
    ];
    expect(darkModuleCount(grid(fiftyFive))).toBe(55);
    expect(qrPenaltyRule4(grid(fiftyFive))).toBe(0);

    const fiftySix = [...fiftyFive];
    fiftySix[5] = "######....";
    expect(darkModuleCount(grid(fiftySix))).toBe(56);
    expect(qrPenaltyRule4(grid(fiftySix))).toBe(10);
  });
});

describe("encoding HELLO WORLD at version 1-Q", () => {
  /**
   * The worked example, derived here rather than copied.
   *
   * „HELLO WORLD" is eleven characters, all inside Table 5, so alphanumeric
   * mode takes it: H=17 E=14 L=21 L=21 O=24 ␠=36 W=32 O=24 R=27 L=21 D=13.
   * Pairs pack as 45a + b into 11 bits and the odd tail into 6:
   *   HE 17×45+14 =  779 → 01100001011
   *   LL 21×45+21 =  966 → 01111000110
   *   O␠ 24×45+36 = 1116 → 10001011100
   *   WO 32×45+24 = 1464 → 10110111000
   *   RL 27×45+21 = 1236 → 10011010100
   *   D                13 → 001101
   * In front of that: mode 0010 and an eleven-character count in nine bits,
   * 000001011. That is 4 + 9 + 55 + 6 = 74 bits. Version 1-Q holds 13 data
   * codewords = 104 bits, so a four-bit terminator brings it to 78, two more
   * zeros reach a byte boundary at 80, and three pad codewords —
   * 11101100 / 00010001 / 11101100 — fill the remaining 24.
   *
   * Regrouped into bytes, that is the vector below.
   */
  const EXPECTED_DATA = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];

  it("chooses version 1 and carries exactly the hand-derived codewords", () => {
    const code = encodeQr("HELLO WORLD", { ecLevel: "Q" });
    expect(code).not.toBeNull();
    if (code === null) return;
    expect(code.version).toBe(1);
    expect(code.size).toBe(21);
    expect(code.ecLevel).toBe("Q");
    const { total, data } = readCodewords(code);
    expect(total).toBe(26);
    expect(data).toEqual(EXPECTED_DATA);
  });

  it("reads back as HELLO WORLD at every mask, forced or chosen", () => {
    for (let mask = 0; mask < 8; mask++) {
      const code = encodeQr("HELLO WORLD", { ecLevel: "Q", mask });
      expect(code?.mask, `mask ${mask}`).toBe(mask);
      if (code !== null) expect(decodePayload(code), `mask ${mask}`).toBe("HELLO WORLD");
    }
  });
});

describe("the finished matrix", () => {
  const code = encodeQr("https://example.com/nexus", { ecLevel: "M" });
  const big = encodeQr("N".repeat(300), { ecLevel: "H" });

  it("builds a symbol at all", () => {
    expect(code).not.toBeNull();
    expect(big).not.toBeNull();
  });

  it("puts a finder pattern in three corners and none in the fourth", () => {
    if (code === null) return;
    const size = code.size;
    const finder = [
      "#######",
      "#.....#",
      "#.###.#",
      "#.###.#",
      "#.###.#",
      "#.....#",
      "#######",
    ];
    const corners: readonly (readonly [number, number])[] = [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ];
    for (const [top, left] of corners) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
          const expected = (finder[row] ?? "").charAt(col) === "#";
          expect(isDark(code.modules, top + row, left + col), `(${top + row},${left + col})`).toBe(
            expected,
          );
        }
      }
    }
    // The bottom-right corner carries data, so it must not read as a finder.
    let matches = 0;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const expected = (finder[row] ?? "").charAt(col) === "#";
        if (isDark(code.modules, size - 7 + row, size - 7 + col) === expected) matches++;
      }
    }
    expect(matches).toBeLessThan(49);
  });

  it("clears the separator around each finder pattern", () => {
    if (code === null) return;
    const size = code.size;
    for (let i = 0; i <= 7; i++) {
      expect(isDark(code.modules, 7, i), `top-left row 7 col ${i}`).toBe(false);
      expect(isDark(code.modules, i, 7), `top-left col 7 row ${i}`).toBe(false);
      expect(isDark(code.modules, 7, size - 1 - i)).toBe(false);
      expect(isDark(code.modules, size - 1 - i, 7)).toBe(false);
    }
  });

  it("alternates both timing patterns between the finders", () => {
    if (code === null) return;
    for (let i = 8; i < code.size - 8; i++) {
      expect(isDark(code.modules, 6, i), `timing row at ${i}`).toBe(i % 2 === 0);
      expect(isDark(code.modules, i, 6), `timing column at ${i}`).toBe(i % 2 === 0);
    }
  });

  it("keeps the module at (4v + 9, 8) dark", () => {
    if (code === null) return;
    expect(isDark(code.modules, code.version * 4 + 9, 8)).toBe(true);
    expect(code.version * 4 + 9).toBe(code.size - 8);
  });

  it("stamps an alignment pattern on every centre that is not under a finder", () => {
    if (big === null) return;
    const positions = qrAlignmentPatternPositions(big.version);
    const last = positions.length - 1;
    let stamped = 0;
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        const row = positions[i] ?? 0;
        const col = positions[j] ?? 0;
        // The whole 5×5: dark centre, a light ring one module out, a dark
        // border two modules out. Chebyshev distance 1 is the only light shell.
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const expected = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            expect(
              isDark(big.modules, row + dr, col + dc),
              `alignment (${row},${col}) offset (${dr},${dc})`,
            ).toBe(expected);
          }
        }
        stamped++;
      }
    }
    expect(stamped).toBe((last + 1) * (last + 1) - 3);
  });

  it("writes format information that decodes back to the level and mask, in both copies", () => {
    for (const ecLevel of QR_EC_LEVELS) {
      for (let mask = 0; mask < 8; mask++) {
        const symbol = encodeQr("Nexus", { ecLevel, mask });
        expect(symbol, `${ecLevel}/${mask}`).not.toBeNull();
        if (symbol === null) continue;
        expect(readFormatInformation(symbol, 0), `${ecLevel}/${mask} copy 1`).toEqual({
          ecLevel,
          mask,
        });
        expect(readFormatInformation(symbol, 1), `${ecLevel}/${mask} copy 2`).toEqual({
          ecLevel,
          mask,
        });
      }
    }
  });

  it("writes version information from version 7 up, in both copies", () => {
    for (const version of [7, 12, 26, 27, 40]) {
      const symbol = encodeQr("Nexus", { ecLevel: "L", minVersion: version, maxVersion: version });
      expect(symbol?.version, `version ${version}`).toBe(version);
      if (symbol === undefined || symbol === null) continue;
      expect(readVersionInformation(symbol, 0), `version ${version} copy 1`).toBe(version);
      expect(readVersionInformation(symbol, 1), `version ${version} copy 2`).toBe(version);
    }
  });

  it("reads the number of codewords straight off the module count", () => {
    for (const version of [1, 2, 6, 7, 14, 27, 40]) {
      const symbol = encodeQr("Nexus", { ecLevel: "M", minVersion: version, maxVersion: version });
      if (symbol === null) continue;
      expect(readCodewords(symbol).total, `version ${version}`).toBe(
        qrBlockLayout(version, "M").totalCodewords,
      );
    }
  });
});

describe("mask selection", () => {
  it("picks the mask with the lowest penalty score", () => {
    for (const payload of ["Nexus", "0123456789", "Đorđe Petrović — Beograd"]) {
      const scores = Array.from({ length: 8 }, (_, mask) => {
        const forced = encodeQr(payload, { ecLevel: "M", mask });
        return forced === null ? Number.POSITIVE_INFINITY : qrPenalty(forced.modules);
      });
      const lowest = Math.min(...scores);
      const chosen = encodeQr(payload, { ecLevel: "M" });
      expect(chosen, payload).not.toBeNull();
      if (chosen === null) continue;
      expect(qrPenalty(chosen.modules), payload).toBe(lowest);
      expect(scores[chosen.mask], payload).toBe(lowest);
      // Ties go to the lower-numbered mask, so the choice is reproducible.
      expect(chosen.mask, payload).toBe(scores.indexOf(lowest));
    }
  });

  it("sums the four rules and nothing else", () => {
    const code = encodeQr("Nexus", { ecLevel: "Q" });
    expect(code).not.toBeNull();
    if (code === null) return;
    const parts =
      qrPenaltyRule1(code.modules) +
      qrPenaltyRule2(code.modules) +
      qrPenaltyRule3(code.modules) +
      qrPenaltyRule4(code.modules);
    expect(qrPenalty(code.modules)).toBe(parts);
  });
});

describe("segmentation and version choice", () => {
  /**
   * The character capacities ISO/IEC 18004 Table 7 publishes for version 1.
   * Each one is checked twice: the count given must fit, and one more must not.
   * Together they pin the mode selection, the header widths and the capacity
   * arithmetic at once — a wrong mode overflows several characters early.
   */
  const VERSION_1_CAPACITY: readonly (readonly [QrEcLevel, string, number])[] = [
    ["L", "numeric", 41],
    ["L", "alphanumeric", 25],
    ["L", "byte", 17],
    ["M", "numeric", 34],
    ["M", "alphanumeric", 20],
    ["M", "byte", 14],
    ["Q", "numeric", 27],
    ["Q", "alphanumeric", 16],
    ["Q", "byte", 11],
    ["H", "numeric", 17],
    ["H", "alphanumeric", 10],
    ["H", "byte", 7],
  ];

  it("fills version 1 to the published character capacity and refuses one more", () => {
    const unit: Readonly<Record<string, string>> = { numeric: "7", alphanumeric: "A", byte: "a" };
    for (const [ecLevel, mode, capacity] of VERSION_1_CAPACITY) {
      const character = unit[mode] ?? "a";
      const label = `${ecLevel} ${mode}`;
      expect(
        encodeQr(character.repeat(capacity), { ecLevel, maxVersion: 1 })?.version,
        label,
      ).toBe(1);
      const overflow = encodeQr(character.repeat(capacity + 1), { ecLevel, maxVersion: 1 });
      expect(overflow, label).toBeNull();
    }
  });

  /**
   * Version 40-L holds 2956 data codewords = 23648 bits; a numeric segment's
   * header there is 4 + 14 = 18 bits, leaving 23630, and 7089 digits pack into
   * exactly 2363 groups of ten bits. The published capacity is 7089, and the
   * arithmetic lands on it with nothing to spare — the sharpest single check of
   * the whole capacity path there is.
   */
  it("reaches the published 7089-digit capacity at version 40-L exactly", () => {
    expect(qrDataCapacityBits(40, "L")).toBe(23648);
    expect(encodeQr("3".repeat(7089), { ecLevel: "L" })?.version).toBe(40);
    expect(encodeQr("3".repeat(7090), { ecLevel: "L" })).toBeNull();
  });

  /**
   * Mixed-mode segmentation, and a case where it is the difference between two
   * versions. One byte-mode character followed by fifty digits costs 51 bytes
   * — 420 bits with its header — in a single byte segment, which needs version
   * 3-L (440 bits). Split, it is a 20-bit byte segment plus a 181-bit numeric
   * one, 201 bits in all, which fits version 2-L (272 bits).
   */
  it("splits a byte run from a digit run when splitting is cheaper", () => {
    const payload = `a${"0".repeat(50)}`;
    const code = encodeQr(payload, { ecLevel: "L" });
    expect(code?.version).toBe(2);
    if (code !== null) expect(decodePayload(code)).toBe(payload);
  });

  it("never splits when splitting costs more", () => {
    // Two digits between letters are cheaper left in the alphanumeric run: a
    // numeric segment would pay a 13-bit header to save four bits.
    const payload = "NEXUS 12 ALATI";
    const code = encodeQr(payload, { ecLevel: "L", maxVersion: 1 });
    expect(code?.version).toBe(1);
    if (code !== null) expect(decodePayload(code)).toBe(payload);
  });
});

describe("round trip", () => {
  const payloads: readonly string[] = [
    "N",
    "0",
    "HELLO WORLD",
    "1234567890",
    "https://example.com/nexus?q=1",
    "Đorđe Petrović, Bulevar kralja Aleksandra 73, 11000 Beograd",
    "mešano ABC 123 čćžšđ",
    "WIFI:T:WPA;S:Nexus;P:tajna123;;",
    "a".repeat(300),
    "9".repeat(500),
    "ЖЖЖ мешано с ћирилицом и 4242",
    "emoji: \u{1f600}\u{1f680}",
  ];

  it("decodes back to exactly what went in, at every error-correction level", () => {
    for (const payload of payloads) {
      for (const ecLevel of QR_EC_LEVELS) {
        const code = encodeQr(payload, { ecLevel });
        expect(code, `${ecLevel}: ${payload.slice(0, 24)}`).not.toBeNull();
        if (code === null) continue;
        expect(decodePayload(code), `${ecLevel}: ${payload.slice(0, 24)}`).toBe(payload);
        expect(code.ecLevel).toBe(ecLevel);
        expect(code.size).toBe(code.version * 4 + 17);
        expect(code.modules.length).toBe(code.size);
      }
    }
  });

  it("decodes back across the version-group boundaries, where the header widths change", () => {
    for (const version of [9, 10, 26, 27]) {
      const payload = `granica ${version} — 1234567890 ABCDEF`;
      const code = encodeQr(payload, { ecLevel: "L", minVersion: version, maxVersion: version });
      expect(code?.version, `version ${version}`).toBe(version);
      if (code !== null && code !== undefined) {
        expect(decodePayload(code), `version ${version}`).toBe(payload);
      }
    }
  });
});

describe("refusals and caller errors", () => {
  it("refuses empty text rather than drawing a scannable picture of nothing", () => {
    expect(encodeQr("")).toBeNull();
  });

  it("refuses a payload that will not fit, instead of quietly weakening the level", () => {
    // Version 40-H holds 1276 data codewords: 1273 bytes after the 20-bit header.
    expect(encodeQr("x".repeat(1273), { ecLevel: "H" })?.version).toBe(40);
    expect(encodeQr("x".repeat(1274), { ecLevel: "H" })).toBeNull();
    // …and the same payload at L is fine, which is the trade the caller must make.
    expect(encodeQr("x".repeat(1274), { ecLevel: "L" })).not.toBeNull();
  });

  it("refuses to grow past a maximum the caller set", () => {
    expect(encodeQr("Nexus alati", { ecLevel: "H", maxVersion: 1 })).toBeNull();
    expect(encodeQr("Nexus alati", { ecLevel: "H", maxVersion: 2 })).not.toBeNull();
  });

  it("throws for a version range or mask outside the spec", () => {
    expect(() => encodeQr("Nexus", { minVersion: 0 })).toThrow(RangeError);
    expect(() => encodeQr("Nexus", { maxVersion: 41 })).toThrow(RangeError);
    expect(() => encodeQr("Nexus", { minVersion: 5, maxVersion: 4 })).toThrow(RangeError);
    expect(() => encodeQr("Nexus", { mask: 8 })).toThrow(RangeError);
    expect(() => encodeQr("Nexus", { mask: 1.5 })).toThrow(RangeError);
  });
});

describe("renderers", () => {
  const code = encodeQr("https://example.com/nexus", { ecLevel: "M" });

  it("draws one rectangle per horizontal run and covers every dark module once", () => {
    if (code === null) return;
    const path = qrToSvgPath(code, 0);
    const widths = [...path.matchAll(/h(\d+)v1/g)].map((match) => Number(match[1]));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(darkModuleCount(code.modules));
    // Merged runs, so there are strictly fewer rectangles than dark modules.
    expect(widths.length).toBeLessThan(darkModuleCount(code.modules));
    expect(path.startsWith("M")).toBe(true);
  });

  it("offsets every rectangle by the quiet zone", () => {
    if (code === null) return;
    const path = qrToSvgPath(code, QR_QUIET_ZONE);
    const origins = [...path.matchAll(/M(\d+) (\d+)h/g)];
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(Number(origin[1])).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(Number(origin[2])).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(Number(origin[1])).toBeLessThan(code.size + QR_QUIET_ZONE);
    }
  });

  it("wraps the path in an SVG sized in modules, quiet zone included", () => {
    if (code === null) return;
    const svg = qrToSvg(code, { dark: "var(--nx-text)", light: "var(--nx-bg)" });
    const span = code.size + QR_QUIET_ZONE * 2;
    expect(svg).toContain(`viewBox="0 0 ${span} ${span}"`);
    expect(svg).toContain('fill="var(--nx-text)"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("leaves the background out entirely when the light colour is null", () => {
    if (code === null) return;
    const svg = qrToSvg(code, { dark: "var(--nx-text)", light: null });
    expect(svg).not.toContain("<rect");
  });

  it("escapes the label and the colours rather than letting them close an attribute", () => {
    if (code === null) return;
    const svg = qrToSvg(code, {
      dark: 'var(--nx-text)"/><script>x</script><path fill="',
      light: null,
      label: "Nexus & <QR>",
    });
    expect(svg).toContain("<title>Nexus &amp; &lt;QR&gt;</title>");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot;");
  });

  it("paints a bitmap whose quiet zone is light and whose finder corner is dark", () => {
    if (code === null) return;
    const black = { r: 0, g: 0, b: 0, a: 255 };
    const white = { r: 255, g: 255, b: 255, a: 255 };
    const scale = 3;
    const bitmap = qrToBitmap(code, { scale, dark: black, light: white });
    const span = (code.size + QR_QUIET_ZONE * 2) * scale;
    expect(bitmap.width).toBe(span);
    expect(bitmap.height).toBe(span);
    expect(bitmap.data.length).toBe(span * span * 4);

    const pixel = (x: number, y: number): readonly number[] => {
      const at = (y * span + x) * 4;
      return [bitmap.data[at], bitmap.data[at + 1], bitmap.data[at + 2], bitmap.data[at + 3]].map(
        (channel) => channel ?? -1,
      );
    };
    expect(pixel(0, 0)).toEqual([255, 255, 255, 255]);
    // Module (0, 0) is the top-left corner of the finder pattern, and it is dark.
    const inside = QR_QUIET_ZONE * scale + 1;
    expect(pixel(inside, inside)).toEqual([0, 0, 0, 255]);
    // Module (7, 7) is inside the separator, and it is light.
    const separator = (QR_QUIET_ZONE + 7) * scale + 1;
    expect(pixel(separator, separator)).toEqual([255, 255, 255, 255]);
  });

  it("refuses a fractional scale, a negative quiet zone and an out-of-range channel", () => {
    if (code === null) return;
    const black = { r: 0, g: 0, b: 0, a: 255 };
    const white = { r: 255, g: 255, b: 255, a: 255 };
    expect(() => qrToBitmap(code, { scale: 1.5, dark: black, light: white })).toThrow(RangeError);
    expect(() => qrToBitmap(code, { scale: 0, dark: black, light: white })).toThrow(RangeError);
    expect(() =>
      qrToBitmap(code, { scale: 1, dark: black, light: white, quietZone: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      qrToBitmap(code, { scale: 1, dark: { r: 256, g: 0, b: 0, a: 255 }, light: white }),
    ).toThrow(RangeError);
    expect(() =>
      qrToBitmap(code, { scale: 1, dark: black, light: { r: 0, g: 0, b: 0, a: 0.5 } }),
    ).toThrow(RangeError);
    expect(() => qrToSvgPath(code, -1)).toThrow(RangeError);
  });
});

describe("payload builders", () => {
  it("passes plain text through and refuses text that is only whitespace", () => {
    expect(qrPlainText("  vodi računa  ")).toBe("  vodi računa  ");
    expect(qrPlainText("")).toBeNull();
    expect(qrPlainText("   \n\t ")).toBeNull();
  });

  it("takes an http or https URL verbatim and refuses anything else", () => {
    expect(qrUrlPayload("https://example.com/a?b=1&c=2")).toBe("https://example.com/a?b=1&c=2");
    expect(qrUrlPayload("  http://example.com  ")).toBe("http://example.com");
    // Not normalised: the scheme's case is the user's, not the encoder's.
    expect(qrUrlPayload("HTTPS://example.com")).toBe("HTTPS://example.com");
    expect(qrUrlPayload("example.com")).toBeNull();
    expect(qrUrlPayload("javascript:alert(1)")).toBeNull();
    expect(qrUrlPayload("https://example.com/a b")).toBeNull();
    expect(qrUrlPayload("")).toBeNull();
  });

  it("builds a WIFI: payload and escapes the delimiters inside a value", () => {
    expect(qrWifiPayload({ ssid: "Nexus", security: "WPA", password: "tajna" })).toBe(
      "WIFI:T:WPA;S:Nexus;P:tajna;;",
    );
    expect(qrWifiPayload({ ssid: "Kuća;1", security: "WEP", password: "a:b,c" })).toBe(
      "WIFI:T:WEP;S:Kuća\\;1;P:a\\:b\\,c;;",
    );
    expect(qrWifiPayload({ ssid: "Gost", security: "nopass" })).toBe("WIFI:T:nopass;S:Gost;;");
    expect(qrWifiPayload({ ssid: "Nexus", security: "WPA", password: "x", hidden: true })).toBe(
      "WIFI:T:WPA;S:Nexus;P:x;H:true;;",
    );
  });

  it("refuses a Wi-Fi payload that contradicts itself", () => {
    expect(qrWifiPayload({ ssid: "", security: "WPA", password: "x" })).toBeNull();
    expect(qrWifiPayload({ ssid: "Nexus", security: "WPA" })).toBeNull();
    expect(qrWifiPayload({ ssid: "Nexus", security: "WPA", password: "" })).toBeNull();
    // A password on an open network is a contradiction, not a detail to drop.
    expect(qrWifiPayload({ ssid: "Gost", security: "nopass", password: "x" })).toBeNull();
    expect(qrWifiPayload({ ssid: "Nexus\nDrugi", security: "nopass" })).toBeNull();
  });

  it("percent-encodes a mailto's headers and never turns a plus into a space", () => {
    expect(qrMailtoPayload({ to: "luka@example.com" })).toBe("mailto:luka@example.com");
    expect(
      qrMailtoPayload({ to: "luka@example.com", subject: "Zdravo, svete", body: "Prvi\nDrugi" }),
    ).toBe("mailto:luka@example.com?subject=Zdravo%2C%20svete&body=Prvi%0ADrugi");
    // RFC 6068: a plus in a mailto is a literal plus, so it must be escaped
    // rather than left where a form-decoder would read it as a space.
    expect(qrMailtoPayload({ to: "luka+nexus@example.com" })).toBe(
      "mailto:luka%2Bnexus@example.com",
    );
    expect(qrMailtoPayload({ to: "nije adresa" })).toBeNull();
    expect(qrMailtoPayload({ to: "@example.com" })).toBeNull();
    expect(qrMailtoPayload({ to: "" })).toBeNull();
  });

  it("builds a tel: URI, dropping spaces and keeping the RFC's visual separators", () => {
    expect(qrTelPayload("+381 64 123 4567")).toBe("tel:+381641234567");
    expect(qrTelPayload("011 / 123")).toBeNull();
    expect(qrTelPayload("(011) 123-4567")).toBe("tel:(011)123-4567");
    expect(qrTelPayload("192")).toBe("tel:192");
    expect(qrTelPayload("12")).toBeNull();
    expect(qrTelPayload("06x123456")).toBeNull();
    expect(qrTelPayload("")).toBeNull();
  });

  it("builds an SMSTO: payload and leaves colons in the body alone", () => {
    expect(qrSmsPayload({ number: "064123456" })).toBe("SMSTO:064123456");
    expect(qrSmsPayload({ number: "064 123 456", message: "Stižem u 18:30" })).toBe(
      "SMSTO:064123456:Stižem u 18:30",
    );
    expect(qrSmsPayload({ number: "064123456", message: "Prvi\nDrugi" })).toBe(
      "SMSTO:064123456:Prvi\nDrugi",
    );
    expect(qrSmsPayload({ number: "abc" })).toBeNull();
  });

  it("builds a geo: URI and refuses a point that is not on the globe", () => {
    expect(qrGeoPayload({ latitude: 44.8176, longitude: 20.4569 })).toBe("geo:44.8176,20.4569");
    expect(qrGeoPayload({ latitude: -44.5, longitude: 20, altitude: 117 })).toBe(
      "geo:-44.5,20,117",
    );
    // Small magnitudes are expanded rather than written in exponent notation,
    // which a geo: URI has no grammar for — and never rounded away.
    expect(qrGeoPayload({ latitude: 1e-7, longitude: 0 })).toBe("geo:0.0000001,0");
    expect(qrGeoPayload({ latitude: 90.1, longitude: 0 })).toBeNull();
    expect(qrGeoPayload({ latitude: 0, longitude: -180.5 })).toBeNull();
    expect(qrGeoPayload({ latitude: Number.NaN, longitude: 0 })).toBeNull();
  });

  it("builds a vCard 3.0 with the properties that were given and no others", () => {
    const card = qrVCardPayload({
      firstName: "Luka",
      lastName: "Stojiljković",
      organization: "Nexus",
      jobTitle: "Inženjer",
      phone: "+381641234567",
      email: "luka@example.com",
      address: {
        street: "Kralja Petra 1",
        city: "Beograd",
        postalCode: "11000",
        country: "Srbija",
      },
    });
    expect(card?.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Stojiljković;Luka;;;",
      "FN:Luka Stojiljković",
      "ORG:Nexus",
      "TITLE:Inženjer",
      "TEL;TYPE=CELL,VOICE:+381641234567",
      "EMAIL;TYPE=INTERNET:luka@example.com",
      "ADR;TYPE=HOME:;;Kralja Petra 1;Beograd;;11000;Srbija",
      "END:VCARD",
    ]);
  });

  it("escapes the characters that structure a vCard line", () => {
    const card = qrVCardPayload({ firstName: "A;B,C", lastName: "D\\E", note: "prvi\ndrugi" });
    expect(card).toContain("N:D\\\\E;A\\;B\\,C;;;");
    expect(card).toContain("NOTE:prvi\\ndrugi");
  });

  it("refuses a card with no name and one with an e-mail that is not an address", () => {
    expect(qrVCardPayload({})).toBeNull();
    expect(qrVCardPayload({ organization: "Nexus" })).toBeNull();
    expect(qrVCardPayload({ firstName: "   " })).toBeNull();
    expect(qrVCardPayload({ firstName: "Luka", email: "nije adresa" })).toBeNull();
  });

  /**
   * RFC 2426 §2.6 folds a content line at 75 octets. „NOTE:" plus a hundred
   * letters is 105 octets, so the first line takes 75 of them — the property
   * name and seventy letters — and the remaining thirty follow after a CRLF
   * and one space.
   */
  it("folds a long line at 75 octets", () => {
    const card = qrVCardPayload({ firstName: "A", note: "b".repeat(100) });
    const lines = card?.split("\r\n") ?? [];
    expect(lines).toContain(`NOTE:${"b".repeat(70)}`);
    expect(lines).toContain(` ${"b".repeat(30)}`);
  });

  /**
   * And it folds by OCTETS, not by characters. „č" is two bytes, so „NOTE:"
   * (5 octets) leaves room for thirty-five of them before the limit, not for
   * seventy — and the fold lands between characters, never inside one.
   */
  it("folds multi-byte characters by their byte length and never splits one", () => {
    const card = qrVCardPayload({ firstName: "A", note: "č".repeat(40) });
    const lines = card?.split("\r\n") ?? [];
    expect(lines).toContain(`NOTE:${"č".repeat(35)}`);
    expect(lines).toContain(` ${"č".repeat(5)}`);
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    }
  });

  it("round-trips every builder's output through the encoder", () => {
    const payloads = [
      qrPlainText("Zabeleška za kasnije"),
      qrUrlPayload("https://example.com/nexus"),
      qrWifiPayload({ ssid: "Kuća;1", security: "WPA", password: "tajna:123" }),
      qrMailtoPayload({ to: "luka@example.com", subject: "Zdravo" }),
      qrTelPayload("+381 64 123 4567"),
      qrSmsPayload({ number: "064123456", message: "Stižem" }),
      qrGeoPayload({ latitude: 44.8176, longitude: 20.4569 }),
      qrVCardPayload({ firstName: "Luka", lastName: "Stojiljković", phone: "+381641234567" }),
    ];
    for (const payload of payloads) {
      expect(payload).not.toBeNull();
      if (payload === null) continue;
      const code = encodeQr(payload, { ecLevel: "M" });
      expect(code, payload.slice(0, 30)).not.toBeNull();
      if (code !== null) expect(decodePayload(code), payload.slice(0, 30)).toBe(payload);
    }
  });
});
