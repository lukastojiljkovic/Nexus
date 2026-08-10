/**
 * The C extension: sixteen-bit instructions, and what each one really is.
 *
 * **Why this is a separate file and a different shape.** The base ISA has six
 * formats whose fields sit in the same place every time — that is what made
 * {@link ./riscv}'s table possible. The compressed encodings have nine formats
 * and no such regularity: `c.lw` scatters a five-bit offset across bits 12:10
 * and 6:5 in one order, `c.lwsp` scatters the same offset across 12 and 6:2 in
 * another, and `c.swsp` uses a third. There is no shared rule to factor out.
 * Each row therefore carries its own bit map, written from the manual's own
 * field diagram, and both directions read that map.
 *
 * **Every compressed instruction is exactly one 32-bit instruction.** That is
 * the extension's defining property and the most useful thing the tool can say:
 * `c.addi4spn a0, sp, 16` is `addi a0, sp, 16`, and a reader who has that in
 * front of them no longer has to remember which of the three stack-pointer
 * forms they are looking at. Each row states its expansion as assembly text,
 * and the test assembles it through {@link ./riscvAssemble} — so the expansion
 * is checked against the base encoder rather than asserted.
 *
 * **The reserved encodings are refused.** A `c.addi4spn` with a zero immediate
 * is not an `addi` of zero; it is the defined illegal instruction, and the
 * all-zero halfword being illegal is deliberate — it makes a jump into cleared
 * memory trap instead of running. Every `nzimm`, `nzuimm` and non-zero-register
 * constraint in the manual is a refusal here.
 *
 * Layouts follow *The RISC-V Instruction Set Manual, Volume I*, version
 * 20240411, chapter 26 and its tables 26.1 and 26.3.
 */

import { registerName } from "./riscv.js";
import { type RiscvField, type RiscvResult, type Xlen } from "./riscvAssemble.js";

/** `[immediateBit, halfwordBit]` pairs. Order does not matter; completeness does. */
type ImmediateMap = readonly (readonly [number, number])[];

/** Where the operands of one compressed shape live, and how it is written. */
type CompressedShape =
  /** `c.addi4spn rd', sp, uimm` — `rd'` at 4:2. */
  | "ciw"
  /** `c.lw rd', uimm(rs1')` — `rd'` at 4:2, `rs1'` at 9:7. */
  | "cl"
  /** `c.sw rs2', uimm(rs1')` — `rs2'` at 4:2, `rs1'` at 9:7. */
  | "cs"
  /** `c.addi rd, imm` — `rd` at 11:7. */
  | "ci"
  /** `c.addi16sp sp, imm` — the register field is fixed at 2. */
  | "ci-sp"
  /** `c.srli rd', shamt` and `c.andi rd', imm` — `rd'` at 9:7. */
  | "cb-alu"
  /** `c.sub rd', rs2'` — `rd'` at 9:7, `rs2'` at 4:2. */
  | "ca"
  /** `c.beqz rs1', offset` — `rs1'` at 9:7. */
  | "cb"
  /** `c.j offset`. */
  | "cj"
  /** `c.lwsp rd, uimm(sp)` — `rd` at 11:7. */
  | "ci-load"
  /** `c.swsp rs2, uimm(sp)` — `rs2` at 6:2. */
  | "css"
  /** `c.mv rd, rs2` — both full five-bit fields. */
  | "cr"
  /** `c.jr rs1` — one full five-bit field at 11:7. */
  | "cr-one"
  /** `c.nop`, `c.ebreak`. */
  | "none";

/** The operand values a row works with, whichever shape it has. */
interface Parts {
  /** The full five-bit field at 11:7, or the widened `rd'` where the shape uses one. */
  readonly rd: number;
  /** The full five-bit field at 6:2, or the widened `rs2'`. */
  readonly rs2: number;
  readonly immediate: number;
}

/** One compressed instruction, in both directions. */
interface CompressedRow {
  readonly mnemonic: string;
  readonly quadrant: 0 | 1 | 2;
  readonly funct3: number;
  readonly shape: CompressedShape;
  /** Additional fixed bits as `[high, low, value]`, inside the halfword. */
  readonly fixed?: readonly (readonly [number, number, number])[];
  readonly immediateMap?: ImmediateMap;
  /** The immediate's sign bit, when it has one. Absent means unsigned. */
  readonly signBit?: number;
  /** Present when the instruction exists on only one base. */
  readonly onlyXlen?: Xlen;
  /** Distinguishes rows that share every fixed bit — the `c.jr`/`c.mv`/`c.add` family. */
  readonly guard?: (parts: Parts) => boolean;
  /** Why this particular encoding is reserved, or `null` when it is legal. */
  readonly reject?: (parts: Parts) => string | null;
  /** The equivalent 32-bit instruction, as assembly text. */
  readonly expand: (parts: Parts) => string;
}

// The immediate maps, each read straight off the manual's field diagram.
const IMM_ADDI4SPN: ImmediateMap = [[5, 12], [4, 11], [9, 10], [8, 9], [7, 8], [6, 7], [2, 6], [3, 5]];
const IMM_LW: ImmediateMap = [[5, 12], [4, 11], [3, 10], [2, 6], [6, 5]];
const IMM_LD: ImmediateMap = [[5, 12], [4, 11], [3, 10], [7, 6], [6, 5]];
const IMM_CI: ImmediateMap = [[5, 12], [4, 6], [3, 5], [2, 4], [1, 3], [0, 2]];
const IMM_LUI: ImmediateMap = [[17, 12], [16, 6], [15, 5], [14, 4], [13, 3], [12, 2]];
const IMM_ADDI16SP: ImmediateMap = [[9, 12], [4, 6], [6, 5], [8, 4], [7, 3], [5, 2]];
const IMM_CJ: ImmediateMap = [
  [11, 12], [4, 11], [9, 10], [8, 9], [10, 8], [6, 7], [7, 6], [3, 5], [2, 4], [1, 3], [5, 2],
];
const IMM_CB: ImmediateMap = [[8, 12], [4, 11], [3, 10], [7, 6], [6, 5], [2, 4], [1, 3], [5, 2]];
const IMM_LWSP: ImmediateMap = [[5, 12], [4, 6], [3, 5], [2, 4], [7, 3], [6, 2]];
const IMM_LDSP: ImmediateMap = [[5, 12], [4, 6], [3, 5], [8, 4], [7, 3], [6, 2]];
const IMM_SWSP: ImmediateMap = [[5, 12], [4, 11], [3, 10], [2, 9], [7, 8], [6, 7]];
const IMM_SDSP: ImmediateMap = [[5, 12], [4, 11], [3, 10], [8, 9], [7, 8], [6, 7]];

const nonZero = (what: string, value: number): string | null =>
  value === 0 ? `${what} must not be zero in this encoding` : null;

/** `x8`…`x15` are all the three-bit register fields can name. */
const compressedRegister = (field: number): number => field + 8;

const name = registerName;

/**
 * Every compressed instruction, in the order the decoder searches. Rows that
 * share fixed bits are separated by their `guard`, and the first match wins.
 */
const ROWS: readonly CompressedRow[] = [
  // — quadrant 0 —
  {
    mnemonic: "c.addi4spn", quadrant: 0, funct3: 0, shape: "ciw", immediateMap: IMM_ADDI4SPN,
    // The all-zero halfword is the architecture's designated illegal
    // instruction; it must stay illegal so a jump into cleared memory traps.
    reject: ({ immediate }) => nonZero("nzuimm", immediate),
    expand: ({ rd, immediate }) => `addi ${name(rd)}, sp, ${immediate}`,
  },
  { mnemonic: "c.lw", quadrant: 0, funct3: 2, shape: "cl", immediateMap: IMM_LW,
    expand: ({ rd, rs2, immediate }) => `lw ${name(rd)}, ${immediate}(${name(rs2)})` },
  { mnemonic: "c.ld", quadrant: 0, funct3: 3, shape: "cl", immediateMap: IMM_LD, onlyXlen: 64,
    expand: ({ rd, rs2, immediate }) => `ld ${name(rd)}, ${immediate}(${name(rs2)})` },
  { mnemonic: "c.sw", quadrant: 0, funct3: 6, shape: "cs", immediateMap: IMM_LW,
    expand: ({ rd, rs2, immediate }) => `sw ${name(rs2)}, ${immediate}(${name(rd)})` },
  { mnemonic: "c.sd", quadrant: 0, funct3: 7, shape: "cs", immediateMap: IMM_LD, onlyXlen: 64,
    expand: ({ rd, rs2, immediate }) => `sd ${name(rs2)}, ${immediate}(${name(rd)})` },

  // — quadrant 1 —
  { mnemonic: "c.nop", quadrant: 1, funct3: 0, shape: "none", immediateMap: IMM_CI, signBit: 5,
    guard: ({ rd, immediate }) => rd === 0 && immediate === 0,
    expand: () => "addi zero, zero, 0" },
  { mnemonic: "c.addi", quadrant: 1, funct3: 0, shape: "ci", immediateMap: IMM_CI, signBit: 5,
    reject: ({ rd, immediate }) => nonZero("rd", rd) ?? nonZero("nzimm", immediate),
    expand: ({ rd, immediate }) => `addi ${name(rd)}, ${name(rd)}, ${immediate}` },
  { mnemonic: "c.jal", quadrant: 1, funct3: 1, shape: "cj", immediateMap: IMM_CJ, signBit: 11, onlyXlen: 32,
    expand: ({ immediate }) => `jal ra, ${immediate}` },
  { mnemonic: "c.addiw", quadrant: 1, funct3: 1, shape: "ci", immediateMap: IMM_CI, signBit: 5, onlyXlen: 64,
    reject: ({ rd }) => nonZero("rd", rd),
    expand: ({ rd, immediate }) => `addiw ${name(rd)}, ${name(rd)}, ${immediate}` },
  { mnemonic: "c.li", quadrant: 1, funct3: 2, shape: "ci", immediateMap: IMM_CI, signBit: 5,
    reject: ({ rd }) => nonZero("rd", rd),
    expand: ({ rd, immediate }) => `addi ${name(rd)}, zero, ${immediate}` },
  { mnemonic: "c.addi16sp", quadrant: 1, funct3: 3, shape: "ci-sp", immediateMap: IMM_ADDI16SP, signBit: 9,
    guard: ({ rd }) => rd === 2,
    reject: ({ immediate }) => nonZero("nzimm", immediate),
    expand: ({ immediate }) => `addi sp, sp, ${immediate}` },
  { mnemonic: "c.lui", quadrant: 1, funct3: 3, shape: "ci", immediateMap: IMM_LUI, signBit: 17,
    reject: ({ rd, immediate }) => (rd === 0 ? "rd must not be zero in this encoding" : nonZero("nzimm", immediate)),
    // The operand of `lui` is the twenty-bit field, so the value is shifted back
    // down; masking keeps a negative `c.lui` in the field's own range.
    expand: ({ rd, immediate }) => `lui ${name(rd)}, 0x${(((immediate >> 12) & 0xfffff) >>> 0).toString(16)}` },

  { mnemonic: "c.srli", quadrant: 1, funct3: 4, shape: "cb-alu", fixed: [[11, 10, 0]], immediateMap: IMM_CI,
    reject: ({ immediate }) => nonZero("shamt", immediate),
    expand: ({ rd, immediate }) => `srli ${name(rd)}, ${name(rd)}, ${immediate}` },
  { mnemonic: "c.srai", quadrant: 1, funct3: 4, shape: "cb-alu", fixed: [[11, 10, 1]], immediateMap: IMM_CI,
    reject: ({ immediate }) => nonZero("shamt", immediate),
    expand: ({ rd, immediate }) => `srai ${name(rd)}, ${name(rd)}, ${immediate}` },
  { mnemonic: "c.andi", quadrant: 1, funct3: 4, shape: "cb-alu", fixed: [[11, 10, 2]], immediateMap: IMM_CI, signBit: 5,
    expand: ({ rd, immediate }) => `andi ${name(rd)}, ${name(rd)}, ${immediate}` },
  { mnemonic: "c.sub", quadrant: 1, funct3: 4, shape: "ca", fixed: [[12, 12, 0], [11, 10, 3], [6, 5, 0]],
    expand: ({ rd, rs2 }) => `sub ${name(rd)}, ${name(rd)}, ${name(rs2)}` },
  { mnemonic: "c.xor", quadrant: 1, funct3: 4, shape: "ca", fixed: [[12, 12, 0], [11, 10, 3], [6, 5, 1]],
    expand: ({ rd, rs2 }) => `xor ${name(rd)}, ${name(rd)}, ${name(rs2)}` },
  { mnemonic: "c.or", quadrant: 1, funct3: 4, shape: "ca", fixed: [[12, 12, 0], [11, 10, 3], [6, 5, 2]],
    expand: ({ rd, rs2 }) => `or ${name(rd)}, ${name(rd)}, ${name(rs2)}` },
  { mnemonic: "c.and", quadrant: 1, funct3: 4, shape: "ca", fixed: [[12, 12, 0], [11, 10, 3], [6, 5, 3]],
    expand: ({ rd, rs2 }) => `and ${name(rd)}, ${name(rd)}, ${name(rs2)}` },
  { mnemonic: "c.subw", quadrant: 1, funct3: 4, shape: "ca", fixed: [[12, 12, 1], [11, 10, 3], [6, 5, 0]], onlyXlen: 64,
    expand: ({ rd, rs2 }) => `subw ${name(rd)}, ${name(rd)}, ${name(rs2)}` },
  { mnemonic: "c.addw", quadrant: 1, funct3: 4, shape: "ca", fixed: [[12, 12, 1], [11, 10, 3], [6, 5, 1]], onlyXlen: 64,
    expand: ({ rd, rs2 }) => `addw ${name(rd)}, ${name(rd)}, ${name(rs2)}` },

  { mnemonic: "c.j", quadrant: 1, funct3: 5, shape: "cj", immediateMap: IMM_CJ, signBit: 11,
    expand: ({ immediate }) => `jal zero, ${immediate}` },
  { mnemonic: "c.beqz", quadrant: 1, funct3: 6, shape: "cb", immediateMap: IMM_CB, signBit: 8,
    expand: ({ rd, immediate }) => `beq ${name(rd)}, zero, ${immediate}` },
  { mnemonic: "c.bnez", quadrant: 1, funct3: 7, shape: "cb", immediateMap: IMM_CB, signBit: 8,
    expand: ({ rd, immediate }) => `bne ${name(rd)}, zero, ${immediate}` },

  // — quadrant 2 —
  { mnemonic: "c.slli", quadrant: 2, funct3: 0, shape: "ci", immediateMap: IMM_CI,
    reject: ({ rd, immediate }) => nonZero("rd", rd) ?? nonZero("shamt", immediate),
    expand: ({ rd, immediate }) => `slli ${name(rd)}, ${name(rd)}, ${immediate}` },
  { mnemonic: "c.lwsp", quadrant: 2, funct3: 2, shape: "ci-load", immediateMap: IMM_LWSP,
    reject: ({ rd }) => nonZero("rd", rd),
    expand: ({ rd, immediate }) => `lw ${name(rd)}, ${immediate}(sp)` },
  { mnemonic: "c.ldsp", quadrant: 2, funct3: 3, shape: "ci-load", immediateMap: IMM_LDSP, onlyXlen: 64,
    reject: ({ rd }) => nonZero("rd", rd),
    expand: ({ rd, immediate }) => `ld ${name(rd)}, ${immediate}(sp)` },

  // The four rows below share quadrant, funct3 and every fixed bit; only the
  // register fields tell them apart, which is why they carry guards.
  { mnemonic: "c.jr", quadrant: 2, funct3: 4, shape: "cr-one", fixed: [[12, 12, 0]],
    guard: ({ rd, rs2 }) => rd !== 0 && rs2 === 0,
    expand: ({ rd }) => `jalr zero, 0(${name(rd)})` },
  { mnemonic: "c.mv", quadrant: 2, funct3: 4, shape: "cr", fixed: [[12, 12, 0]],
    guard: ({ rd, rs2 }) => rd !== 0 && rs2 !== 0,
    expand: ({ rd, rs2 }) => `add ${name(rd)}, zero, ${name(rs2)}` },
  { mnemonic: "c.ebreak", quadrant: 2, funct3: 4, shape: "none", fixed: [[12, 12, 1]],
    guard: ({ rd, rs2 }) => rd === 0 && rs2 === 0,
    expand: () => "ebreak" },
  { mnemonic: "c.jalr", quadrant: 2, funct3: 4, shape: "cr-one", fixed: [[12, 12, 1]],
    guard: ({ rd, rs2 }) => rd !== 0 && rs2 === 0,
    expand: ({ rd }) => `jalr ra, 0(${name(rd)})` },
  { mnemonic: "c.add", quadrant: 2, funct3: 4, shape: "cr", fixed: [[12, 12, 1]],
    guard: ({ rd, rs2 }) => rd !== 0 && rs2 !== 0,
    expand: ({ rd, rs2 }) => `add ${name(rd)}, ${name(rd)}, ${name(rs2)}` },

  { mnemonic: "c.swsp", quadrant: 2, funct3: 6, shape: "css", immediateMap: IMM_SWSP,
    expand: ({ rs2, immediate }) => `sw ${name(rs2)}, ${immediate}(sp)` },
  { mnemonic: "c.sdsp", quadrant: 2, funct3: 7, shape: "css", immediateMap: IMM_SDSP, onlyXlen: 64,
    expand: ({ rs2, immediate }) => `sd ${name(rs2)}, ${immediate}(sp)` },
];

/** Every compressed mnemonic this module knows, for a UI that wants to list them. */
export const COMPRESSED_MNEMONICS: readonly string[] = ROWS.map((candidate) => candidate.mnemonic);

const halfwordBits = (halfword: number, high: number, low: number): number =>
  (halfword >>> low) & ((1 << (high - low + 1)) - 1);

/** Collects a scattered immediate, sign-extending from `signBit` when there is one. */
function gatherImmediate(halfword: number, map: ImmediateMap, signBit?: number): number {
  let value = 0;
  for (const [immediateBit, halfwordBit] of map) {
    value |= halfwordBits(halfword, halfwordBit, halfwordBit) << immediateBit;
  }
  if (signBit === undefined) return value >>> 0;
  const shift = 31 - signBit;
  return (value << shift) >> shift;
}

/** Scatters an immediate back out. The caller has already checked its range. */
function scatterImmediate(value: number, map: ImmediateMap): number {
  let halfword = 0;
  for (const [immediateBit, halfwordBit] of map) {
    halfword |= ((value >> immediateBit) & 1) << halfwordBit;
  }
  return halfword & 0xffff;
}

/** Reads the operand fields the shape uses, widening the three-bit ones to real registers. */
function partsOf(halfword: number, row: CompressedRow): Parts {
  const immediate =
    row.immediateMap === undefined ? 0 : gatherImmediate(halfword, row.immediateMap, row.signBit);

  switch (row.shape) {
    case "ciw":
      return { rd: compressedRegister(halfwordBits(halfword, 4, 2)), rs2: 0, immediate };
    case "cl":
    case "cs":
      return {
        rd: compressedRegister(halfwordBits(halfword, 4, 2)),
        rs2: compressedRegister(halfwordBits(halfword, 9, 7)),
        immediate,
      };
    case "cb-alu":
    case "cb":
      return { rd: compressedRegister(halfwordBits(halfword, 9, 7)), rs2: 0, immediate };
    case "ca":
      return {
        rd: compressedRegister(halfwordBits(halfword, 9, 7)),
        rs2: compressedRegister(halfwordBits(halfword, 4, 2)),
        immediate,
      };
    case "cj":
      return { rd: 0, rs2: 0, immediate };
    case "css":
      return { rd: 0, rs2: halfwordBits(halfword, 6, 2), immediate };
    default:
      return { rd: halfwordBits(halfword, 11, 7), rs2: halfwordBits(halfword, 6, 2), immediate };
  }
}

/**
 * `cl` and `cs` put the base register in the field the other shapes use for a
 * source, so the two are swapped when the assembly is written out. Naming the
 * swap once here keeps it out of every row's `expand`.
 */
function renderCompressed(row: CompressedRow, parts: Parts): string {
  const { mnemonic } = row;
  const { rd, rs2, immediate } = parts;
  switch (row.shape) {
    case "ciw":
      return `${mnemonic} ${name(rd)}, sp, ${immediate}`;
    case "cl":
      return `${mnemonic} ${name(rd)}, ${immediate}(${name(rs2)})`;
    case "cs":
      return `${mnemonic} ${name(rs2)}, ${immediate}(${name(rd)})`;
    case "ci":
    case "cb-alu":
      return `${mnemonic} ${name(rd)}, ${immediate}`;
    case "ci-sp":
      return `${mnemonic} sp, ${immediate}`;
    case "ca":
    case "cr":
      return `${mnemonic} ${name(rd)}, ${name(rs2)}`;
    case "cb":
      return `${mnemonic} ${name(rd)}, ${immediate}`;
    case "cj":
      return `${mnemonic} ${immediate}`;
    case "ci-load":
      return `${mnemonic} ${name(rd)}, ${immediate}(sp)`;
    case "css":
      return `${mnemonic} ${name(rs2)}, ${immediate}(sp)`;
    case "cr-one":
      return `${mnemonic} ${name(rd)}`;
    case "none":
      return mnemonic;
  }
}

/** A compressed halfword, understood. */
export interface CompressedDecoded {
  readonly halfword: number;
  readonly mnemonic: string;
  /** The compressed spelling. */
  readonly asm: string;
  /** The 32-bit instruction it is exactly equivalent to, as assembly text. */
  readonly expansion: string;
  readonly fields: readonly RiscvField[];
}

const ok = <T>(value: T): RiscvResult<T> => ({ ok: true, value });
const fail = <T>(reason: string): RiscvResult<T> => ({ ok: false, reason });

/** Reads a sixteen-bit halfword. */
export function decodeCompressed(rawHalfword: number, xlen: Xlen = 64): RiscvResult<CompressedDecoded> {
  const halfword = rawHalfword & 0xffff;
  const quadrant = halfwordBits(halfword, 1, 0);
  if (quadrant === 3) return fail("the low two bits are 11, so this is a 32-bit instruction");

  const funct3 = halfwordBits(halfword, 15, 13);
  for (const row of ROWS) {
    if (row.quadrant !== quadrant || row.funct3 !== funct3) continue;
    if (row.onlyXlen !== undefined && row.onlyXlen !== xlen) continue;
    if (row.fixed?.some(([high, low, value]) => halfwordBits(halfword, high, low) !== value)) continue;
    const parts = partsOf(halfword, row);
    if (row.guard !== undefined && !row.guard(parts)) continue;
    // On RV32 the sixth shift bit is reserved as zero, so a shift of 32 or more
    // is not a different instruction — it is this one, invalid.
    const isShift = row.mnemonic === "c.slli" || row.mnemonic === "c.srli" || row.mnemonic === "c.srai";
    if (xlen === 32 && isShift && parts.immediate >= 32) {
      return fail(`reserved encoding: a shift amount of ${parts.immediate} needs RV64 (${row.mnemonic})`);
    }

    const refusal = row.reject?.(parts);
    if (refusal !== undefined && refusal !== null) {
      return fail(`reserved encoding: ${refusal} (${row.mnemonic})`);
    }
    return ok({
      halfword,
      mnemonic: row.mnemonic,
      asm: renderCompressed(row, parts),
      expansion: row.expand(parts),
      fields: fieldsOf(halfword, row, parts),
    });
  }
  return fail(`no compressed instruction has quadrant ${quadrant} with funct3 ${funct3}`);
}

/** The halfword split at its field boundaries, for the bit grid. */
function fieldsOf(halfword: number, row: CompressedRow, parts: Parts): readonly RiscvField[] {
  const slice = (name_: string, high: number, low: number, text?: string): RiscvField => ({
    name: name_,
    high,
    low,
    value: halfwordBits(halfword, high, low),
    text: text ?? `0b${halfwordBits(halfword, high, low).toString(2).padStart(high - low + 1, "0")}`,
  });

  const immediateFields = (row.immediateMap ?? []).map(([immediateBit, halfwordBit]) =>
    slice(`imm[${immediateBit}]`, halfwordBit, halfwordBit),
  );

  // `funct3` and a row's extra fixed bits are often contiguous, and where they
  // are the manual gives the run a single name — `funct4` for the CR rows,
  // `funct6` for the CA ones. Merging them produces exactly those names, and
  // ensures every bit of the halfword appears in the grid exactly once.
  const opcodeRuns: RiscvField[] = [];
  const ranges = [[15, 13] as const, ...(row.fixed ?? []).map(([high, low]) => [high, low] as const)].sort(
    (a, b) => b[0] - a[0],
  );
  for (const [high, low] of ranges) {
    const previous = opcodeRuns.at(-1);
    if (previous !== undefined && previous.low === high + 1) {
      opcodeRuns[opcodeRuns.length - 1] = slice("", previous.high, low);
    } else {
      opcodeRuns.push(slice("", high, low));
    }
  }
  const functFields = opcodeRuns.map((field) => ({ ...field, name: `funct${field.high - field.low + 1}` }));

  const registerFields: readonly RiscvField[] =
    row.shape === "ciw"
      ? [slice("rd'", 4, 2, name(parts.rd))]
      : row.shape === "cl" || row.shape === "cs"
        ? [slice("rs1'", 9, 7, name(parts.rs2)), slice(row.shape === "cl" ? "rd'" : "rs2'", 4, 2, name(parts.rd))]
        : row.shape === "ca"
          ? [slice("rd'", 9, 7, name(parts.rd)), slice("rs2'", 4, 2, name(parts.rs2))]
          : row.shape === "cb" || row.shape === "cb-alu"
            ? [slice("rs1'", 9, 7, name(parts.rd))]
            : row.shape === "css"
              ? [slice("rs2", 6, 2, name(parts.rs2))]
              : row.shape === "cr" || row.shape === "cr-one"
                ? [slice("rd", 11, 7, name(parts.rd)), slice("rs2", 6, 2, name(parts.rs2))]
                : row.shape === "ci" || row.shape === "ci-load" || row.shape === "ci-sp"
                  ? [slice("rd", 11, 7, name(parts.rd))]
                  : [];

  return [...functFields, ...immediateFields, ...registerFields, slice("op", 1, 0)].sort(
    (a, b) => b.high - a.high,
  );
}

/**
 * Builds a halfword from a compressed instruction's own spelling — the inverse
 * of {@link decodeCompressed}, and what makes the round trip a testable property
 * rather than a hope.
 */
export function assembleCompressed(source: string, xlen: Xlen = 64): RiscvResult<number> {
  const trimmed = source.split(/[#;]|\/\//, 1)[0]?.trim() ?? "";
  const [mnemonic = "", ...rest] = trimmed.split(/\s+/);
  const operands = rest
    .join(" ")
    .split(",")
    .map((operand) => operand.trim())
    .filter((operand) => operand !== "");

  const row = ROWS.find(
    (candidate) =>
      candidate.mnemonic === mnemonic.toLowerCase() &&
      (candidate.onlyXlen === undefined || candidate.onlyXlen === xlen),
  );
  if (row === undefined) return fail(`"${mnemonic}" is not a compressed instruction this tool knows`);

  const parsed = parseCompressedOperands(row, operands);
  if (!parsed.ok) return parsed;

  const refusal = row.reject?.(parsed.value);
  if (refusal !== undefined && refusal !== null) return fail(`reserved encoding: ${refusal}`);

  let halfword = row.quadrant | (row.funct3 << 13);
  // `_high` is the field's top bit, which the DECODER needs to slice the range
  // back out; encoding only ever shifts the value up to `low`.
  for (const [_high, low, value] of row.fixed ?? []) halfword |= value << low;
  if (row.immediateMap !== undefined) halfword |= scatterImmediate(parsed.value.immediate, row.immediateMap);

  const { rd, rs2 } = parsed.value;
  switch (row.shape) {
    case "ciw":
      halfword |= (rd - 8) << 2;
      break;
    case "cl":
    case "cs":
      halfword |= ((rd - 8) << 2) | ((rs2 - 8) << 7);
      break;
    case "cb":
    case "cb-alu":
      halfword |= (rd - 8) << 7;
      break;
    case "ca":
      halfword |= ((rd - 8) << 7) | ((rs2 - 8) << 2);
      break;
    case "cj":
      break;
    case "css":
      halfword |= rs2 << 2;
      break;
    case "ci-sp":
      halfword |= 2 << 7;
      break;
    default:
      halfword |= (rd << 7) | (rs2 << 2);
  }

  // Encoding and decoding must agree about which row a halfword belongs to; a
  // guard that the built word fails would mean the two disagree.
  if (row.guard !== undefined && !row.guard(parsed.value)) {
    return fail(`${row.mnemonic} cannot be written with these registers`);
  }
  return ok(halfword & 0xffff);
}

/** Register or `null`, restricted to `x8`…`x15` where the shape has only three bits. */
function narrowRegister(text: string): number | null {
  const index = compressedRegisterOf(text);
  return index !== null && index >= 8 && index <= 15 ? index : null;
}

function compressedRegisterOf(text: string): number | null {
  // Deliberately the base module's parser, so the two accept exactly the same
  // spellings — `fp` for `s0` included.
  const parsed = /^x(\d{1,2})$/.exec(text.trim().toLowerCase());
  if (parsed !== null) {
    const index = Number(parsed[1]);
    return index <= 31 ? index : null;
  }
  const abi = ["zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3",
    "a4", "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11",
    "t3", "t4", "t5", "t6"].indexOf(text.trim().toLowerCase());
  if (abi !== -1) return abi;
  return text.trim().toLowerCase() === "fp" ? 8 : null;
}

function parseNumber(text: string): number | null {
  const match = /^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)$/.exec(text.trim());
  if (match === null) return null;
  const magnitude = Number(match[2]);
  return Number.isSafeInteger(magnitude) ? (match[1] === "-" ? -magnitude : magnitude) : null;
}

function parseMemory(text: string): { readonly immediate: number; readonly register: string } | null {
  const match = /^([^()]*)\(([^()]+)\)$/.exec(text.trim());
  if (match === null) return null;
  const offset = (match[1] ?? "").trim();
  const immediate = offset === "" ? 0 : parseNumber(offset);
  return immediate === null ? null : { immediate, register: match[2] ?? "" };
}

function parseCompressedOperands(row: CompressedRow, operands: readonly string[]): RiscvResult<Parts> {
  const wrong = (): RiscvResult<Parts> =>
    fail(`${row.mnemonic} does not take ${operands.length} operand${operands.length === 1 ? "" : "s"}`);
  const bad = (what: string, text: string | undefined): RiscvResult<Parts> =>
    fail(`"${text}" is not ${what}`);

  switch (row.shape) {
    case "ciw": {
      if (operands.length !== 3 || operands[1]?.toLowerCase() !== "sp") return wrong();
      const rd = narrowRegister(operands[0] ?? "");
      const immediate = parseNumber(operands[2] ?? "");
      if (rd === null) return bad("one of x8…x15", operands[0]);
      if (immediate === null) return bad("a number", operands[2]);
      return ok({ rd, rs2: 0, immediate });
    }
    case "cl":
    case "cs": {
      if (operands.length !== 2) return wrong();
      const first = narrowRegister(operands[0] ?? "");
      const memory = parseMemory(operands[1] ?? "");
      if (first === null) return bad("one of x8…x15", operands[0]);
      if (memory === null) return bad("an offset(register) operand", operands[1]);
      const base = narrowRegister(memory.register);
      if (base === null) return bad("one of x8…x15", memory.register);
      return row.shape === "cl"
        ? ok({ rd: first, rs2: base, immediate: memory.immediate })
        : ok({ rd: base, rs2: first, immediate: memory.immediate });
    }
    case "cb":
    case "cb-alu": {
      if (operands.length !== 2) return wrong();
      const rd = narrowRegister(operands[0] ?? "");
      const immediate = parseNumber(operands[1] ?? "");
      if (rd === null) return bad("one of x8…x15", operands[0]);
      if (immediate === null) return bad("a number", operands[1]);
      return ok({ rd, rs2: 0, immediate });
    }
    case "ca": {
      if (operands.length !== 2) return wrong();
      const rd = narrowRegister(operands[0] ?? "");
      const rs2 = narrowRegister(operands[1] ?? "");
      if (rd === null) return bad("one of x8…x15", operands[0]);
      if (rs2 === null) return bad("one of x8…x15", operands[1]);
      return ok({ rd, rs2, immediate: 0 });
    }
    case "cj": {
      if (operands.length !== 1) return wrong();
      const immediate = parseNumber(operands[0] ?? "");
      return immediate === null ? bad("a number", operands[0]) : ok({ rd: 0, rs2: 0, immediate });
    }
    case "ci": {
      if (operands.length !== 2) return wrong();
      const rd = compressedRegisterOf(operands[0] ?? "");
      const immediate = parseNumber(operands[1] ?? "");
      if (rd === null) return bad("a register", operands[0]);
      if (immediate === null) return bad("a number", operands[1]);
      return ok({ rd, rs2: 0, immediate });
    }
    case "ci-sp": {
      if (operands.length !== 2 || operands[0]?.toLowerCase() !== "sp") return wrong();
      const immediate = parseNumber(operands[1] ?? "");
      return immediate === null ? bad("a number", operands[1]) : ok({ rd: 2, rs2: 0, immediate });
    }
    case "ci-load": {
      if (operands.length !== 2) return wrong();
      const rd = compressedRegisterOf(operands[0] ?? "");
      const memory = parseMemory(operands[1] ?? "");
      if (rd === null) return bad("a register", operands[0]);
      if (memory === null || memory.register.toLowerCase() !== "sp") return bad("an offset(sp) operand", operands[1]);
      return ok({ rd, rs2: 0, immediate: memory.immediate });
    }
    case "css": {
      if (operands.length !== 2) return wrong();
      const rs2 = compressedRegisterOf(operands[0] ?? "");
      const memory = parseMemory(operands[1] ?? "");
      if (rs2 === null) return bad("a register", operands[0]);
      if (memory === null || memory.register.toLowerCase() !== "sp") return bad("an offset(sp) operand", operands[1]);
      return ok({ rd: 0, rs2, immediate: memory.immediate });
    }
    case "cr": {
      if (operands.length !== 2) return wrong();
      const rd = compressedRegisterOf(operands[0] ?? "");
      const rs2 = compressedRegisterOf(operands[1] ?? "");
      if (rd === null) return bad("a register", operands[0]);
      if (rs2 === null) return bad("a register", operands[1]);
      return ok({ rd, rs2, immediate: 0 });
    }
    case "cr-one": {
      if (operands.length !== 1) return wrong();
      const rd = compressedRegisterOf(operands[0] ?? "");
      return rd === null ? bad("a register", operands[0]) : ok({ rd, rs2: 0, immediate: 0 });
    }
    case "none":
      return operands.length === 0 ? ok({ rd: 0, rs2: 0, immediate: 0 }) : wrong();
  }
}
