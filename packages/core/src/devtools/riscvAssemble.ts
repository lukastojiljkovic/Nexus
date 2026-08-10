/**
 * Assembling and disassembling RISC-V, over the table in {@link ./riscv}.
 *
 * **A word is never half-understood.** Decoding either produces a named
 * instruction with every field accounted for, or it produces a refusal that says
 * which field it could not place. There is no `.word 0x…` fallback that prints
 * something plausible: a disassembler that guesses is worse than one that stops,
 * because the reader cannot tell the guesses from the answers.
 *
 * **Pseudo-instructions go both ways, but not symmetrically.** Assembling
 * accepts them and expands them — that is what they are for. Disassembling
 * *recognises* them and shows both spellings side by side, never instead of each
 * other, because `addi a0, zero, 0` and `nop` are the same word and a reader
 * comparing against a hex dump needs the real one.
 *
 * **No symbol table.** `beq a0, a1, -8` assembles; `beq a0, a1, loop` is refused
 * with that as the reason. Labels belong to an assembler with a second pass, and
 * quietly encoding an unknown label as zero would produce a valid word that
 * jumps somewhere else.
 */

import {
  INSTRUCTIONS,
  IMMEDIATE_LAYOUTS,
  type RiscvInstruction,
  bitsOf,
  extractImmediate,
  immediateRange,
  insertImmediate,
  parseRegister,
  registerName,
} from "./riscv.js";

/** Which base the tool is reading against. Only the shift widths and a few mnemonics differ. */
export type Xlen = 32 | 64;

/** One named slice of the encoded word, for the bit grid. */
export interface RiscvField {
  readonly name: string;
  readonly high: number;
  readonly low: number;
  readonly value: number;
  /** How the value reads: a register's ABI name, a signed offset, a hex constant. */
  readonly text: string;
}

/** A word, fully accounted for. */
export interface RiscvDecoded {
  readonly word: number;
  readonly instruction: RiscvInstruction;
  /** The canonical spelling, always. */
  readonly asm: string;
  /** The pseudo-instruction spelling, when one applies. Shown beside `asm`, never instead of it. */
  readonly pseudo: string | null;
  readonly fields: readonly RiscvField[];
  /** The byte offset a branch or jump adds to its own address, or `null` for everything else. */
  readonly branchOffset: number | null;
}

export type RiscvResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const ok = <T>(value: T): RiscvResult<T> => ({ ok: true, value });
const fail = <T>(reason: string): RiscvResult<T> => ({ ok: false, reason });

/** The `iorw` letters, most significant first, as bits 3..0 of a fence field. */
const FENCE_LETTERS = ["i", "o", "r", "w"] as const;

/** The control and status registers with names worth knowing, by address. */
export const CSR_NAMES: Readonly<Record<number, string>> = {
  0x001: "fflags", 0x002: "frm", 0x003: "fcsr",
  0x100: "sstatus", 0x104: "sie", 0x105: "stvec", 0x106: "scounteren",
  0x140: "sscratch", 0x141: "sepc", 0x142: "scause", 0x143: "stval", 0x144: "sip",
  0x180: "satp",
  0x300: "mstatus", 0x301: "misa", 0x302: "medeleg", 0x303: "mideleg",
  0x304: "mie", 0x305: "mtvec", 0x306: "mcounteren",
  0x340: "mscratch", 0x341: "mepc", 0x342: "mcause", 0x343: "mtval", 0x344: "mip",
  0xb00: "mcycle", 0xb02: "minstret",
  0xc00: "cycle", 0xc01: "time", 0xc02: "instret",
  0xf11: "mvendorid", 0xf12: "marchid", 0xf13: "mimpid", 0xf14: "mhartid",
};

const CSR_BY_NAME: ReadonlyMap<string, number> = new Map(
  Object.entries(CSR_NAMES).map(([address, name]) => [name, Number(address)]),
);

// ————————————————————————————————————————————————————————————————
// Decoding
// ————————————————————————————————————————————————————————————————

/** The first row whose fixed fields all match the word, or `null`. */
function findInstruction(word: number, xlen: Xlen): RiscvInstruction | null {
  const opcode = bitsOf(word, 6, 0);
  const funct3 = bitsOf(word, 14, 12);

  // The whole-word rows are checked first: `ecall` and `ebreak` share every
  // other field with each other, so only the complete word tells them apart.
  for (const candidate of INSTRUCTIONS) {
    if (candidate.word !== undefined && (word >>> 0) === candidate.word) return candidate;
  }

  for (const candidate of INSTRUCTIONS) {
    if (candidate.word !== undefined) continue;
    if (candidate.opcode !== opcode) continue;
    if (candidate.funct3 !== undefined && candidate.funct3 !== funct3) continue;
    if (candidate.extension === "RV64I" && xlen === 32) continue;
    if (candidate.funct5 !== undefined && candidate.funct5 !== bitsOf(word, 31, 27)) continue;
    if (candidate.funct7 !== undefined) {
      // A doubleword shift's amount reaches into bit 25, so only the top six
      // bits are fixed — reading seven would reject every shift of 32 or more.
      const fixedWidth = candidate.wideShift && xlen === 64 ? 6 : 7;
      if (bitsOf(word, 31, 32 - fixedWidth) !== candidate.funct7 >>> (7 - fixedWidth)) continue;
    }
    return candidate;
  }
  return null;
}

/** A signed number as assembly writes it. */
const signedText = (value: number): string => String(value);

/** A fence's four-bit field as its `iorw` letters, or `0` when it names nothing. */
function fenceText(value: number): string {
  const letters = FENCE_LETTERS.filter((_, index) => (value & (8 >> index)) !== 0).join("");
  return letters === "" ? "0" : letters;
}

/** Everything a word says about itself. */
export function decodeInstruction(rawWord: number, xlen: Xlen = 64): RiscvResult<RiscvDecoded> {
  const word = rawWord >>> 0;
  if ((word & 0b11) !== 0b11) {
    return fail("the low two bits are not 11, so this is a compressed 16-bit instruction");
  }
  const instruction = findInstruction(word, xlen);
  if (instruction === null) {
    return fail(`no instruction has opcode 0x${bitsOf(word, 6, 0).toString(16)} with funct3 ${bitsOf(word, 14, 12)}`);
  }

  const rd = bitsOf(word, 11, 7);
  const rs1 = bitsOf(word, 19, 15);
  const rs2 = bitsOf(word, 24, 20);

  const opcodeField: RiscvField = {
    name: "opcode",
    high: 6,
    low: 0,
    value: bitsOf(word, 6, 0),
    text: `0x${bitsOf(word, 6, 0).toString(16).padStart(2, "0")}`,
  };
  const rdField: RiscvField = { name: "rd", high: 11, low: 7, value: rd, text: registerName(rd) };
  const rs1Field: RiscvField = { name: "rs1", high: 19, low: 15, value: rs1, text: registerName(rs1) };
  const rs2Field: RiscvField = { name: "rs2", high: 24, low: 20, value: rs2, text: registerName(rs2) };
  const funct3Field: RiscvField = {
    name: "funct3",
    high: 14,
    low: 12,
    value: bitsOf(word, 14, 12),
    text: `0b${bitsOf(word, 14, 12).toString(2).padStart(3, "0")}`,
  };
  const funct7Field: RiscvField = {
    name: "funct7",
    high: 31,
    low: 25,
    value: bitsOf(word, 31, 25),
    text: `0b${bitsOf(word, 31, 25).toString(2).padStart(7, "0")}`,
  };

  /** The immediate's scattered fragments, named the way the manual names them. */
  const immediateFields = (layout: keyof typeof IMMEDIATE_LAYOUTS): readonly RiscvField[] =>
    IMMEDIATE_LAYOUTS[layout].map(([high, low, wordLow]) => ({
      name: high === low ? `imm[${high}]` : `imm[${high}:${low}]`,
      high: wordLow + (high - low),
      low: wordLow,
      value: bitsOf(word, wordLow + (high - low), wordLow),
      text: `0b${bitsOf(word, wordLow + (high - low), wordLow).toString(2).padStart(high - low + 1, "0")}`,
    }));

  const { mnemonic } = instruction;
  const done = (asm: string, fields: readonly RiscvField[], branchOffset: number | null = null) =>
    ok<RiscvDecoded>({ word, instruction, asm, pseudo: pseudoFor(instruction, word), fields, branchOffset });

  switch (instruction.format) {
    case "R":
      return done(`${mnemonic} ${registerName(rd)}, ${registerName(rs1)}, ${registerName(rs2)}`, [
        funct7Field, rs2Field, rs1Field, funct3Field, rdField, opcodeField,
      ]);

    case "shift": {
      const width = instruction.wideShift && xlen === 64 ? 6 : 5;
      const shamtHigh = 20 + width - 1;
      const shamt = bitsOf(word, shamtHigh, 20);
      return done(`${mnemonic} ${registerName(rd)}, ${registerName(rs1)}, ${shamt}`, [
        {
          name: width === 6 ? "funct6" : "funct7",
          high: 31,
          low: shamtHigh + 1,
          value: bitsOf(word, 31, shamtHigh + 1),
          text: `0b${bitsOf(word, 31, shamtHigh + 1).toString(2).padStart(31 - shamtHigh, "0")}`,
        },
        { name: "shamt", high: shamtHigh, low: 20, value: shamt, text: String(shamt) },
        rs1Field, funct3Field, rdField, opcodeField,
      ]);
    }

    case "I": {
      const immediate = extractImmediate(word, "I");
      const fields = [...immediateFields("I"), rs1Field, funct3Field, rdField, opcodeField];
      const asm =
        instruction.syntax === "memory"
          ? `${mnemonic} ${registerName(rd)}, ${signedText(immediate)}(${registerName(rs1)})`
          : `${mnemonic} ${registerName(rd)}, ${registerName(rs1)}, ${signedText(immediate)}`;
      return done(asm, fields);
    }

    case "S": {
      const immediate = extractImmediate(word, "S");
      const [high, low] = immediateFields("S");
      return done(`${mnemonic} ${registerName(rs2)}, ${signedText(immediate)}(${registerName(rs1)})`, [
        high!, rs2Field, rs1Field, funct3Field, low!, opcodeField,
      ]);
    }

    case "B": {
      const offset = extractImmediate(word, "B");
      const [top, high, low, eleven] = immediateFields("B");
      return done(
        `${mnemonic} ${registerName(rs1)}, ${registerName(rs2)}, ${signedText(offset)}`,
        [top!, high!, rs2Field, rs1Field, funct3Field, low!, eleven!, opcodeField],
        offset,
      );
    }

    case "U": {
      const immediate = extractImmediate(word, "U");
      // The manual labels this field by where its bits LAND (31:12), while the
      // operand names the bits themselves (19:0). The grid shows the manual's
      // spelling, because that is what the reader is holding it next to.
      return done(`${mnemonic} ${registerName(rd)}, 0x${immediate.toString(16)}`, [
        { name: "imm[31:12]", high: 31, low: 12, value: immediate, text: `0x${immediate.toString(16)}` },
        rdField, opcodeField,
      ]);
    }

    case "J": {
      const offset = extractImmediate(word, "J");
      const [twenty, tenToOne, eleven, nineteenToTwelve] = immediateFields("J");
      return done(
        `${mnemonic} ${registerName(rd)}, ${signedText(offset)}`,
        [twenty!, tenToOne!, eleven!, nineteenToTwelve!, rdField, opcodeField],
        offset,
      );
    }

    case "atomic": {
      const ordering = `${bitsOf(word, 26, 26) === 1 ? ".aq" : ""}${bitsOf(word, 25, 25) === 1 ? ".rl" : ""}`;
      const isLoadReserved = instruction.funct5 === 0x02;
      const fields: readonly RiscvField[] = [
        { name: "funct5", high: 31, low: 27, value: bitsOf(word, 31, 27), text: `0b${bitsOf(word, 31, 27).toString(2).padStart(5, "0")}` },
        { name: "aq", high: 26, low: 26, value: bitsOf(word, 26, 26), text: String(bitsOf(word, 26, 26)) },
        { name: "rl", high: 25, low: 25, value: bitsOf(word, 25, 25), text: String(bitsOf(word, 25, 25)) },
        rs2Field, rs1Field, funct3Field, rdField, opcodeField,
      ];
      // `lr` has no source operand; its rs2 field must be zero and reading it as
      // a register would print a third operand that is not there.
      if (isLoadReserved && rs2 !== 0) return fail("lr requires rs2 to be zero");
      return done(
        isLoadReserved
          ? `${mnemonic}${ordering} ${registerName(rd)}, (${registerName(rs1)})`
          : `${mnemonic}${ordering} ${registerName(rd)}, ${registerName(rs2)}, (${registerName(rs1)})`,
        fields,
      );
    }

    case "csr": {
      const address = bitsOf(word, 31, 20);
      const csr = CSR_NAMES[address] ?? `0x${address.toString(16)}`;
      // The immediate forms put a five-bit literal where a register number goes.
      const literal = instruction.funct3 !== undefined && instruction.funct3 >= 5;
      return done(`${mnemonic} ${registerName(rd)}, ${csr}, ${literal ? rs1 : registerName(rs1)}`, [
        { name: "csr", high: 31, low: 20, value: address, text: csr },
        literal ? { name: "uimm", high: 19, low: 15, value: rs1, text: String(rs1) } : rs1Field,
        funct3Field, rdField, opcodeField,
      ]);
    }

    case "fence": {
      const pred = bitsOf(word, 27, 24);
      const succ = bitsOf(word, 23, 20);
      return done(`fence ${fenceText(pred)}, ${fenceText(succ)}`, [
        { name: "fm", high: 31, low: 28, value: bitsOf(word, 31, 28), text: `0b${bitsOf(word, 31, 28).toString(2).padStart(4, "0")}` },
        { name: "pred", high: 27, low: 24, value: pred, text: fenceText(pred) },
        { name: "succ", high: 23, low: 20, value: succ, text: fenceText(succ) },
        rs1Field, funct3Field, rdField, opcodeField,
      ]);
    }

    case "system":
      return done(mnemonic, [
        { name: "word", high: 31, low: 0, value: word, text: `0x${word.toString(16).padStart(8, "0")}` },
      ]);
  }
}

/**
 * The pseudo-instruction a word also spells, or `null`.
 *
 * Every rule here is a canonical form from the manual's chapter 25 table, and
 * each is a narrowing rather than a rewriting: the word is unchanged and the
 * canonical spelling is still shown next to it.
 */
function pseudoFor(instruction: RiscvInstruction, word: number): string | null {
  const rd = bitsOf(word, 11, 7);
  const rs1 = bitsOf(word, 19, 15);
  const rs2 = bitsOf(word, 24, 20);
  const immediate = extractImmediate(word, "I");
  const name = (index: number) => registerName(index);

  switch (instruction.mnemonic) {
    case "addi":
      if (rd === 0 && rs1 === 0 && immediate === 0) return "nop";
      if (immediate === 0) return `mv ${name(rd)}, ${name(rs1)}`;
      if (rs1 === 0) return `li ${name(rd)}, ${immediate}`;
      return null;
    case "addiw":
      return immediate === 0 ? `sext.w ${name(rd)}, ${name(rs1)}` : null;
    case "xori":
      return immediate === -1 ? `not ${name(rd)}, ${name(rs1)}` : null;
    case "sltiu":
      return immediate === 1 ? `seqz ${name(rd)}, ${name(rs1)}` : null;
    case "sub":
      return rs1 === 0 ? `neg ${name(rd)}, ${name(rs2)}` : null;
    case "subw":
      return rs1 === 0 ? `negw ${name(rd)}, ${name(rs2)}` : null;
    case "sltu":
      return rs1 === 0 ? `snez ${name(rd)}, ${name(rs2)}` : null;
    case "slt":
      if (rs2 === 0) return `sltz ${name(rd)}, ${name(rs1)}`;
      if (rs1 === 0) return `sgtz ${name(rd)}, ${name(rs2)}`;
      return null;
    case "beq":
      return rs2 === 0 ? `beqz ${name(rs1)}, ${extractImmediate(word, "B")}` : null;
    case "bne":
      return rs2 === 0 ? `bnez ${name(rs1)}, ${extractImmediate(word, "B")}` : null;
    case "bge":
      if (rs2 === 0) return `bgez ${name(rs1)}, ${extractImmediate(word, "B")}`;
      if (rs1 === 0) return `blez ${name(rs2)}, ${extractImmediate(word, "B")}`;
      return null;
    case "blt":
      if (rs2 === 0) return `bltz ${name(rs1)}, ${extractImmediate(word, "B")}`;
      if (rs1 === 0) return `bgtz ${name(rs2)}, ${extractImmediate(word, "B")}`;
      return null;
    case "jal":
      return rd === 0 ? `j ${extractImmediate(word, "J")}` : rd === 1 ? `jal ${extractImmediate(word, "J")}` : null;
    case "jalr":
      if (rd === 0 && rs1 === 1 && immediate === 0) return "ret";
      if (rd === 0 && immediate === 0) return `jr ${name(rs1)}`;
      if (rd === 1 && immediate === 0) return `jalr ${name(rs1)}`;
      return null;
    case "csrrs":
      return rs1 === 0 ? `csrr ${name(rd)}, ${CSR_NAMES[bitsOf(word, 31, 20)] ?? `0x${bitsOf(word, 31, 20).toString(16)}`}` : null;
    case "csrrw":
      return rd === 0 ? `csrw ${CSR_NAMES[bitsOf(word, 31, 20)] ?? `0x${bitsOf(word, 31, 20).toString(16)}`}, ${name(rs1)}` : null;
    default:
      return null;
  }
}

// ————————————————————————————————————————————————————————————————
// Assembling
// ————————————————————————————————————————————————————————————————

/**
 * A number as assembly writes it: decimal, `0x`, `0b`, `0o`, with an optional
 * sign. `bigint`, because `li` on RV64 takes constants past 2^53 and a `number`
 * would round them into a different instruction sequence without saying so.
 */
export function parseWideImmediateText(text: string): bigint | null {
  const cleaned = text.trim().replace(/_/g, "");
  const match = /^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)$/.exec(cleaned);
  if (match === null) return null;
  try {
    const magnitude = BigInt(match[2] ?? "");
    return match[1] === "-" ? -magnitude : magnitude;
  } catch {
    return null;
  }
}

/**
 * The same grammar, narrowed to a `number` — refusing only what a `number`
 * cannot hold exactly.
 *
 * It does NOT bound the value to any instruction field: every caller knows its
 * own field's width and range-checks there, and the ones that do not are why
 * this comment used to claim a twenty-bit cap it never enforced.
 */
export function parseImmediateText(text: string): number | null {
  const wide = parseWideImmediateText(text);
  if (wide === null) return null;
  const value = Number(wide);
  return Number.isSafeInteger(value) ? value : null;
}

/** `-8(sp)` and `(a0)` split into their two halves. */
function parseMemoryOperand(text: string): { readonly immediate: number; readonly register: number } | null {
  const match = /^([^()]*)\(([^()]+)\)$/.exec(text.trim());
  if (match === null) return null;
  const register = parseRegister(match[2] ?? "");
  if (register === null) return null;
  const offsetText = (match[1] ?? "").trim();
  const immediate = offsetText === "" ? 0 : parseImmediateText(offsetText);
  return immediate === null ? null : { immediate, register };
}

/** The pieces of one line, with comments and blank space gone. */
interface ParsedLine {
  readonly mnemonic: string;
  readonly operands: readonly string[];
}

function parseLine(line: string): ParsedLine | null {
  const withoutComment = line.split(/[#;]|\/\//, 1)[0] ?? "";
  const trimmed = withoutComment.trim();
  if (trimmed === "") return null;
  const [mnemonic = "", ...rest] = trimmed.split(/\s+/);
  const operands = rest
    .join(" ")
    .split(",")
    .map((operand) => operand.trim())
    .filter((operand) => operand !== "");
  return { mnemonic: mnemonic.toLowerCase(), operands };
}

/** One assembled line: the words it produced, and the source it came from. */
export interface AssembledLine {
  readonly source: string;
  readonly words: readonly number[];
  /** Set when the line was a pseudo-instruction and the words are its expansion. */
  readonly expandedFrom: string | null;
}

/**
 * Assemble one or more lines.
 *
 * Stops at the first line it cannot encode and says which line and why —
 * assembling the rest around a hole would produce a listing whose addresses are
 * right and whose contents are not.
 */
export function assemble(source: string, xlen: Xlen = 64): RiscvResult<readonly AssembledLine[]> {
  const lines: AssembledLine[] = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const parsed = parseLine(raw);
    if (parsed === null) continue;
    const encoded = assembleOne(parsed, xlen);
    if (!encoded.ok) return fail(`line ${index + 1}: ${encoded.reason}`);
    lines.push({ source: raw.trim(), words: encoded.value.words, expandedFrom: encoded.value.expandedFrom });
  }
  return lines.length === 0 ? fail("nothing to assemble") : ok(lines);
}

interface OneEncoding {
  readonly words: readonly number[];
  readonly expandedFrom: string | null;
}

function assembleOne(line: ParsedLine, xlen: Xlen): RiscvResult<OneEncoding> {
  const expansion = expandPseudo(line, xlen);
  if (expansion !== null) {
    if (!expansion.ok) return expansion;
    const words: number[] = [];
    for (const step of expansion.value) {
      const encoded = encodeCanonical(step, xlen);
      if (!encoded.ok) return encoded;
      words.push(encoded.value);
    }
    return ok({ words, expandedFrom: line.mnemonic });
  }
  const encoded = encodeCanonical(line, xlen);
  return encoded.ok ? ok({ words: [encoded.value], expandedFrom: null }) : encoded;
}

/** The base word: opcode and the fixed function fields, before any operand. */
function fixedPart(instruction: RiscvInstruction, xlen: Xlen): number {
  let word = instruction.opcode;
  if (instruction.funct3 !== undefined) word |= instruction.funct3 << 12;
  if (instruction.funct7 !== undefined) {
    // The wide shifts fix only six bits; the seventh belongs to the shift amount.
    const fixedWidth = instruction.wideShift && xlen === 64 ? 6 : 7;
    word |= (instruction.funct7 >>> (7 - fixedWidth)) << (32 - fixedWidth);
  }
  if (instruction.funct5 !== undefined) word |= instruction.funct5 << 27;
  return word >>> 0;
}

/** Encodes one canonical instruction — no pseudo-instructions reach here. */
function encodeCanonical(line: ParsedLine, xlen: Xlen): RiscvResult<number> {
  // The atomics carry their ordering in a suffix rather than an operand.
  const ordering = /\.(aqrl|aq|rl)$/.exec(line.mnemonic);
  const mnemonic = ordering === null ? line.mnemonic : line.mnemonic.slice(0, ordering.index);
  const acquire = ordering !== null && ordering[1] !== "rl";
  const release = ordering !== null && ordering[1] !== "aq";

  const instruction = INSTRUCTIONS.find(
    (candidate) => candidate.mnemonic === mnemonic && !(candidate.extension === "RV64I" && xlen === 32),
  );
  if (instruction === undefined) return fail(`"${mnemonic}" is not an instruction this tool knows`);
  if (ordering !== null && instruction.format !== "atomic") {
    return fail(`only the atomics take an ordering suffix, and "${mnemonic}" is not one`);
  }

  const operands = line.operands;
  const need = (count: number): RiscvResult<null> =>
    operands.length === count
      ? ok(null)
      : fail(`${mnemonic} takes ${count} operand${count === 1 ? "" : "s"}, not ${operands.length}`);

  const register = (text: string | undefined, role: string): RiscvResult<number> => {
    const index = parseRegister(text ?? "");
    return index === null ? fail(`"${text}" is not a register (${role})`) : ok(index);
  };

  const immediate = (text: string | undefined, layout: keyof typeof IMMEDIATE_LAYOUTS): RiscvResult<number> => {
    const value = parseImmediateText(text ?? "");
    if (value === null) {
      return fail(
        /^[A-Za-z_.]/.test((text ?? "").trim())
          ? `"${text}" looks like a label, and this tool has no symbol table — give a numeric offset`
          : `"${text}" is not a number`,
      );
    }
    const { min, max, step } = immediateRange(layout);
    if (value < min || value > max) return fail(`${value} is outside the ${layout}-format range ${min}…${max}`);
    if (value % step !== 0) return fail(`${value} must be even — the low bit of this offset is not stored`);
    return ok(value);
  };

  const base = fixedPart(instruction, xlen);

  switch (instruction.format) {
    case "R": {
      const check = need(3);
      if (!check.ok) return check;
      const rd = register(operands[0], "rd");
      const rs1 = register(operands[1], "rs1");
      const rs2 = register(operands[2], "rs2");
      if (!rd.ok) return rd;
      if (!rs1.ok) return rs1;
      if (!rs2.ok) return rs2;
      return ok((base | (rd.value << 7) | (rs1.value << 15) | (rs2.value << 20)) >>> 0);
    }

    case "shift": {
      const check = need(3);
      if (!check.ok) return check;
      const rd = register(operands[0], "rd");
      const rs1 = register(operands[1], "rs1");
      if (!rd.ok) return rd;
      if (!rs1.ok) return rs1;
      const width = instruction.wideShift && xlen === 64 ? 6 : 5;
      const shamt = parseImmediateText(operands[2] ?? "");
      if (shamt === null || shamt < 0 || shamt >= 1 << width) {
        return fail(`a shift amount here is 0…${(1 << width) - 1}, not "${operands[2]}"`);
      }
      return ok((base | (rd.value << 7) | (rs1.value << 15) | (shamt << 20)) >>> 0);
    }

    case "I": {
      const memory = operands.length === 2 ? parseMemoryOperand(operands[1] ?? "") : null;
      const rd = register(operands[0], "rd");
      if (!rd.ok) return rd;
      if (memory !== null) {
        const { min, max } = immediateRange("I");
        if (memory.immediate < min || memory.immediate > max) {
          return fail(`${memory.immediate} is outside the I-format range ${min}…${max}`);
        }
        return ok((base | (rd.value << 7) | (memory.register << 15) | insertImmediate(memory.immediate, "I")) >>> 0);
      }
      const check = need(3);
      if (!check.ok) return check;
      const rs1 = register(operands[1], "rs1");
      const value = immediate(operands[2], "I");
      if (!rs1.ok) return rs1;
      if (!value.ok) return value;
      return ok((base | (rd.value << 7) | (rs1.value << 15) | insertImmediate(value.value, "I")) >>> 0);
    }

    case "S": {
      const check = need(2);
      if (!check.ok) return check;
      const rs2 = register(operands[0], "rs2");
      if (!rs2.ok) return rs2;
      const memory = parseMemoryOperand(operands[1] ?? "");
      if (memory === null) return fail(`"${operands[1]}" is not an offset(register) operand`);
      const { min, max } = immediateRange("S");
      if (memory.immediate < min || memory.immediate > max) {
        return fail(`${memory.immediate} is outside the S-format range ${min}…${max}`);
      }
      return ok((base | (rs2.value << 20) | (memory.register << 15) | insertImmediate(memory.immediate, "S")) >>> 0);
    }

    case "B": {
      const check = need(3);
      if (!check.ok) return check;
      const rs1 = register(operands[0], "rs1");
      const rs2 = register(operands[1], "rs2");
      const offset = immediate(operands[2], "B");
      if (!rs1.ok) return rs1;
      if (!rs2.ok) return rs2;
      if (!offset.ok) return offset;
      return ok((base | (rs1.value << 15) | (rs2.value << 20) | insertImmediate(offset.value, "B")) >>> 0);
    }

    case "U": {
      const check = need(2);
      if (!check.ok) return check;
      const rd = register(operands[0], "rd");
      const value = immediate(operands[1], "U");
      if (!rd.ok) return rd;
      if (!value.ok) return value;
      return ok((base | (rd.value << 7) | insertImmediate(value.value & 0xfffff, "U")) >>> 0);
    }

    case "J": {
      const check = need(2);
      if (!check.ok) return check;
      const rd = register(operands[0], "rd");
      const offset = immediate(operands[1], "J");
      if (!rd.ok) return rd;
      if (!offset.ok) return offset;
      return ok((base | (rd.value << 7) | insertImmediate(offset.value, "J")) >>> 0);
    }

    case "atomic": {
      const loadReserved = instruction.funct5 === 0x02;
      const check = need(loadReserved ? 2 : 3);
      if (!check.ok) return check;
      const rd = register(operands[0], "rd");
      if (!rd.ok) return rd;
      const rs2 = loadReserved ? ok(0) : register(operands[1], "rs2");
      if (!rs2.ok) return rs2;
      const memory = parseMemoryOperand(operands[loadReserved ? 1 : 2] ?? "");
      if (memory === null) return fail("an atomic's address operand is written (register)");
      if (memory.immediate !== 0) return fail("an atomic has no offset — write (register), not offset(register)");
      return ok(
        (base |
          (rd.value << 7) |
          (memory.register << 15) |
          (rs2.value << 20) |
          (acquire ? 1 << 26 : 0) |
          (release ? 1 << 25 : 0)) >>>
          0,
      );
    }

    case "csr": {
      const check = need(3);
      if (!check.ok) return check;
      const rd = register(operands[0], "rd");
      if (!rd.ok) return rd;
      const address = parseCsr(operands[1] ?? "");
      if (address === null) return fail(`"${operands[1]}" is not a CSR name or a 12-bit address`);
      const literal = instruction.funct3 !== undefined && instruction.funct3 >= 5;
      let sourceField: number;
      if (literal) {
        const value = parseImmediateText(operands[2] ?? "");
        if (value === null || value < 0 || value > 31) return fail("the immediate CSR forms take a 5-bit unsigned value");
        sourceField = value;
      } else {
        const rs1 = register(operands[2], "rs1");
        if (!rs1.ok) return rs1;
        sourceField = rs1.value;
      }
      return ok((base | (rd.value << 7) | (sourceField << 15) | (address << 20)) >>> 0);
    }

    case "fence": {
      // Bare `fence` means the strongest ordering, which is what the manual's
      // own pseudo-instruction table says it expands to.
      if (operands.length === 0) return ok(0x0ff0000f);
      const check = need(2);
      if (!check.ok) return check;
      const pred = parseFenceSet(operands[0] ?? "");
      const succ = parseFenceSet(operands[1] ?? "");
      if (pred === null || succ === null) return fail("a fence operand is a subset of the letters iorw, or 0");
      return ok((base | (pred << 24) | (succ << 20)) >>> 0);
    }

    case "system": {
      const check = need(0);
      return check.ok ? ok(instruction.word ?? 0) : check;
    }
  }
}

/** A CSR by name or by address. */
function parseCsr(text: string): number | null {
  const named = CSR_BY_NAME.get(text.trim().toLowerCase());
  if (named !== undefined) return named;
  const address = parseImmediateText(text);
  return address !== null && address >= 0 && address <= 0xfff ? address : null;
}

/** `rw` becomes `0b0011`; `0` becomes zero; anything else is not a fence set. */
function parseFenceSet(text: string): number | null {
  const cleaned = text.trim().toLowerCase();
  if (cleaned === "0") return 0;
  let value = 0;
  for (const letter of cleaned) {
    const index = FENCE_LETTERS.indexOf(letter as (typeof FENCE_LETTERS)[number]);
    if (index === -1) return null;
    const bit = 8 >> index;
    if ((value & bit) !== 0) return null;
    value |= bit;
  }
  return value === 0 ? null : value;
}

// ————————————————————————————————————————————————————————————————
// Pseudo-instructions
// ————————————————————————————————————————————————————————————————

/** Rewrites that are one instruction for one instruction, as `[mnemonic, operand pattern]`. */
const SIMPLE_PSEUDOS: Readonly<Record<string, (operands: readonly string[]) => readonly string[] | null>> = {
  nop: (o) => (o.length === 0 ? ["addi", "zero", "zero", "0"] : null),
  mv: (o) => (o.length === 2 ? ["addi", o[0]!, o[1]!, "0"] : null),
  not: (o) => (o.length === 2 ? ["xori", o[0]!, o[1]!, "-1"] : null),
  neg: (o) => (o.length === 2 ? ["sub", o[0]!, "zero", o[1]!] : null),
  negw: (o) => (o.length === 2 ? ["subw", o[0]!, "zero", o[1]!] : null),
  "sext.w": (o) => (o.length === 2 ? ["addiw", o[0]!, o[1]!, "0"] : null),
  seqz: (o) => (o.length === 2 ? ["sltiu", o[0]!, o[1]!, "1"] : null),
  snez: (o) => (o.length === 2 ? ["sltu", o[0]!, "zero", o[1]!] : null),
  sltz: (o) => (o.length === 2 ? ["slt", o[0]!, o[1]!, "zero"] : null),
  sgtz: (o) => (o.length === 2 ? ["slt", o[0]!, "zero", o[1]!] : null),
  beqz: (o) => (o.length === 2 ? ["beq", o[0]!, "zero", o[1]!] : null),
  bnez: (o) => (o.length === 2 ? ["bne", o[0]!, "zero", o[1]!] : null),
  bgez: (o) => (o.length === 2 ? ["bge", o[0]!, "zero", o[1]!] : null),
  bltz: (o) => (o.length === 2 ? ["blt", o[0]!, "zero", o[1]!] : null),
  // These two swap the operands rather than pinning one, which is why they are
  // written out: `blez rs, off` is `bge zero, rs, off`, not `bge rs, zero, off`.
  blez: (o) => (o.length === 2 ? ["bge", "zero", o[0]!, o[1]!] : null),
  bgtz: (o) => (o.length === 2 ? ["blt", "zero", o[0]!, o[1]!] : null),
  j: (o) => (o.length === 1 ? ["jal", "zero", o[0]!] : null),
  jr: (o) => (o.length === 1 ? ["jalr", "zero", o[0]!, "0"] : null),
  ret: (o) => (o.length === 0 ? ["jalr", "zero", "ra", "0"] : null),
  csrr: (o) => (o.length === 2 ? ["csrrs", o[0]!, o[1]!, "zero"] : null),
  csrw: (o) => (o.length === 2 ? ["csrrw", "zero", o[0]!, o[1]!] : null),
  csrs: (o) => (o.length === 2 ? ["csrrs", "zero", o[0]!, o[1]!] : null),
  csrc: (o) => (o.length === 2 ? ["csrrc", "zero", o[0]!, o[1]!] : null),
  csrwi: (o) => (o.length === 2 ? ["csrrwi", "zero", o[0]!, o[1]!] : null),
  csrsi: (o) => (o.length === 2 ? ["csrrsi", "zero", o[0]!, o[1]!] : null),
  csrci: (o) => (o.length === 2 ? ["csrrci", "zero", o[0]!, o[1]!] : null),
};

/**
 * `null` when the line is not a pseudo-instruction; otherwise the canonical
 * lines it stands for, or a refusal.
 *
 * `jal` and `jalr` are the awkward pair: each is both a real instruction and a
 * pseudo-instruction, told apart only by how many operands were written.
 */
function expandPseudo(line: ParsedLine, xlen: Xlen): RiscvResult<readonly ParsedLine[]> | null {
  const { mnemonic, operands } = line;

  const simple = SIMPLE_PSEUDOS[mnemonic];
  if (simple !== undefined) {
    const expanded = simple(operands);
    return expanded === null
      ? fail(`${mnemonic} does not take ${operands.length} operand${operands.length === 1 ? "" : "s"}`)
      : ok([{ mnemonic: expanded[0]!, operands: expanded.slice(1) }]);
  }

  if (mnemonic === "jal" && operands.length === 1) {
    return ok([{ mnemonic: "jal", operands: ["ra", operands[0]!] }]);
  }
  if (mnemonic === "jalr" && operands.length === 1) {
    return ok([{ mnemonic: "jalr", operands: ["ra", operands[0]!, "0"] }]);
  }
  if (mnemonic === "li") {
    if (operands.length !== 2) return fail("li takes a destination and a value");
    const value = parseWideImmediateText(operands[1] ?? "");
    if (value === null) return fail(`"${operands[1]}" is not a number`);
    return expandLoadImmediate(operands[0]!, value, xlen);
  }
  return null;
}

/**
 * `li rd, value` as the shortest sequence that builds it.
 *
 * **The `+0x800` is the whole trick.** `lui` takes the top twenty bits and
 * `addi` adds a *signed* twelve-bit value, so when the low twelve bits are 0x800
 * or more the `addi` subtracts and the upper half must be one larger to
 * compensate. Rounding the value up by half a `lui` step before the shift does
 * exactly that, and forgetting it is the classic off-by-4096.
 *
 * Beyond thirty-two bits the sequence continues by shifting what it has built so
 * far left and adding the next twelve bits, which is the same expansion an
 * assembler emits.
 */
function expandLoadImmediate(rd: string, value: bigint, xlen: Xlen): RiscvResult<readonly ParsedLine[]> {
  if (xlen === 32 && (value < -(2n ** 31n) || value > 2n ** 32n - 1n)) {
    return fail("that value does not fit in 32 bits");
  }
  if (value < -(2n ** 63n) || value > 2n ** 64n - 1n) return fail("that value does not fit in 64 bits");

  const signed = asSigned(value, xlen === 32 ? 32 : 64);
  const steps = buildImmediate(signed, rd);
  return ok(steps);
}

/** Reads a bit pattern as a two's-complement value of the given width. */
function asSigned(value: bigint, width: number): bigint {
  const modulus = 1n << BigInt(width);
  const wrapped = ((value % modulus) + modulus) % modulus;
  return wrapped >= modulus / 2n ? wrapped - modulus : wrapped;
}

function buildImmediate(value: bigint, rd: string): readonly ParsedLine[] {
  const low12 = asSigned(value & 0xfffn, 12);

  if (value >= -(2n ** 31n) && value < 2n ** 31n) {
    // The upper half, rounded so that a negative `addi` is paid for in advance.
    const high20 = ((value - low12) >> 12n) & 0xfffffn;
    if (high20 === 0n) return [{ mnemonic: "addi", operands: [rd, "zero", String(low12)] }];
    const lui: ParsedLine = { mnemonic: "lui", operands: [rd, `0x${high20.toString(16)}`] };
    if (low12 === 0n) return [lui];
    // `addiw` rather than `addi`, because on RV64 the `lui` result is already
    // sign-extended from bit 31 and `addiw` keeps it that way.
    return [lui, { mnemonic: "addiw", operands: [rd, rd, String(low12)] }];
  }

  // Peel the low twelve bits off, build what remains, then shift it back up.
  const upper = (value - low12) >> 12n;
  let shift = 12;
  let remaining = upper;
  while ((remaining & 1n) === 0n && remaining !== 0n && shift < 63) {
    remaining >>= 1n;
    shift += 1;
  }
  const steps: ParsedLine[] = [
    ...buildImmediate(remaining, rd),
    { mnemonic: "slli", operands: [rd, rd, String(shift)] },
  ];
  if (low12 !== 0n) steps.push({ mnemonic: "addi", operands: [rd, rd, String(low12)] });
  return steps;
}
