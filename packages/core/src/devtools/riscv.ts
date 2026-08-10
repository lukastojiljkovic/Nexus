/**
 * RISC-V: a 32-bit word in one direction, a line of assembly in the other.
 *
 * Covers RV32I and RV64I, the M extension (multiply and divide), the A
 * extension (atomics) and Zicsr, which together are what a person actually has
 * in front of them when they are staring at a word and asking what it is. The
 * compressed 16-bit encodings live next door in {@link ./riscvCompressed}.
 *
 * **One table, both directions.** The encoder and the disassembler read the same
 * {@link INSTRUCTIONS} rows. That is not tidiness for its own sake: an encoder
 * and a decoder written separately agree until the one instruction where they
 * do not, and the disagreement is invisible because each is self-consistent.
 * Here a round trip through both is a property of the table rather than a
 * coincidence, and the test sweeps it.
 *
 * **The immediates are scrambled, and that is the whole difficulty.** RISC-V
 * scatters branch and jump offsets across non-contiguous bit ranges — the B
 * format puts bit 12 at position 31 and bit 11 at position 7, the J format puts
 * bit 11 at position 20 — so that the wires that carry each immediate bit land
 * in the same place in every format and the hardware multiplexer stays cheap.
 * It is a good decision for silicon and a menace for anyone reading a hex dump,
 * which is why this tool exists. {@link IMMEDIATE_LAYOUTS} states each scramble
 * once, as data, and both directions walk the same list.
 *
 * **Branch and jump targets are numbers here, not labels.** There is no symbol
 * table and none is pretended: `beq a0, a1, -8` assembles, `beq a0, a1, loop`
 * is refused with that reason. A tool that silently assembled a label as zero
 * would be producing a valid word that means something else.
 *
 * Field widths, opcodes and layouts follow *The RISC-V Instruction Set Manual,
 * Volume I: Unprivileged ISA*, version 20240411, chapters 2, 7, 8 and 12.
 */

/** The instruction formats of the base ISA, plus the shapes the manual gives their own tables. */
export type RiscvFormat =
  | "R"
  | "I"
  | "S"
  | "B"
  | "U"
  | "J"
  /** An I-format word whose immediate is a shift amount, five bits wide or six. */
  | "shift"
  /** The A extension's own layout: `funct5`, then the `aq` and `rl` ordering bits. */
  | "atomic"
  /** `rd, csr, rs1` — or `rd, csr, uimm5`, where the register field holds a literal. */
  | "csr"
  /** `fence pred, succ`, whose two operands are sets of the four `iorw` letters. */
  | "fence"
  /** A word with no operands at all: `ecall`, `mret`, `wfi`. */
  | "system";

/** Which part of the ISA an instruction comes from, so the tool can say. */
export type RiscvExtension = "RV32I" | "RV64I" | "M" | "A" | "Zicsr" | "Zifencei";

/** How the operands are written, which is not always in encoding order. */
export type RiscvSyntax =
  /** `rd, rs1, rs2` — commas all the way, operands in the order the row lists them. */
  | "plain"
  /** `rd, imm(rs1)` for loads, `rs2, imm(rs1)` for stores. */
  | "memory"
  /** `rd, rs2, (rs1)` for the atomics, and `rd, (rs1)` for `lr`. */
  | "atomic"
  /** No operands at all. */
  | "none";

/** One row of the instruction table — everything both directions need. */
export interface RiscvInstruction {
  readonly mnemonic: string;
  readonly format: RiscvFormat;
  readonly extension: RiscvExtension;
  readonly opcode: number;
  readonly funct3?: number;
  readonly funct7?: number;
  /** Bits 31:27 of an atomic. */
  readonly funct5?: number;
  /** The whole 32-bit word, for instructions that have no operands. */
  readonly word?: number;
  readonly syntax?: RiscvSyntax;
  /** `true` when the shift amount is six bits rather than five — the RV64 doubleword shifts. */
  readonly wideShift?: boolean;
}

const OPCODE = {
  load: 0x03,
  opImm: 0x13,
  auipc: 0x17,
  opImm32: 0x1b,
  store: 0x23,
  amo: 0x2f,
  op: 0x33,
  lui: 0x37,
  op32: 0x3b,
  branch: 0x63,
  jalr: 0x67,
  jal: 0x6f,
  system: 0x73,
  fence: 0x0f,
} as const;

const row = (
  mnemonic: string,
  format: RiscvFormat,
  extension: RiscvExtension,
  opcode: number,
  rest: Omit<RiscvInstruction, "mnemonic" | "format" | "extension" | "opcode"> = {},
): RiscvInstruction => ({ mnemonic, format, extension, opcode, ...rest });

const branch = (mnemonic: string, funct3: number): RiscvInstruction =>
  row(mnemonic, "B", "RV32I", OPCODE.branch, { funct3 });
const load = (mnemonic: string, funct3: number, extension: RiscvExtension): RiscvInstruction =>
  row(mnemonic, "I", extension, OPCODE.load, { funct3, syntax: "memory" });
const store = (mnemonic: string, funct3: number, extension: RiscvExtension): RiscvInstruction =>
  row(mnemonic, "S", extension, OPCODE.store, { funct3, syntax: "memory" });

/** Every atomic is the same row with a different `funct5`; `.w` and `.d` differ only in `funct3`. */
const atomics = (mnemonic: string, funct5: number): readonly RiscvInstruction[] => [
  row(`${mnemonic}.w`, "atomic", "A", OPCODE.amo, { funct3: 2, funct5, syntax: "atomic" }),
  row(`${mnemonic}.d`, "atomic", "A", OPCODE.amo, { funct3: 3, funct5, syntax: "atomic" }),
];

/**
 * The instruction table. Order matters only for the disassembler's search, which
 * takes the first row whose fixed fields all match — and every row's fixed
 * fields are distinct, which {@link ./riscv.test} asserts rather than assumes.
 */
export const INSTRUCTIONS: readonly RiscvInstruction[] = [
  // — RV32I —
  row("lui", "U", "RV32I", OPCODE.lui),
  row("auipc", "U", "RV32I", OPCODE.auipc),
  row("jal", "J", "RV32I", OPCODE.jal),
  row("jalr", "I", "RV32I", OPCODE.jalr, { funct3: 0, syntax: "memory" }),

  branch("beq", 0),
  branch("bne", 1),
  branch("blt", 4),
  branch("bge", 5),
  branch("bltu", 6),
  branch("bgeu", 7),

  load("lb", 0, "RV32I"),
  load("lh", 1, "RV32I"),
  load("lw", 2, "RV32I"),
  load("lbu", 4, "RV32I"),
  load("lhu", 5, "RV32I"),
  load("ld", 3, "RV64I"),
  load("lwu", 6, "RV64I"),

  store("sb", 0, "RV32I"),
  store("sh", 1, "RV32I"),
  store("sw", 2, "RV32I"),
  store("sd", 3, "RV64I"),

  row("addi", "I", "RV32I", OPCODE.opImm, { funct3: 0 }),
  row("slti", "I", "RV32I", OPCODE.opImm, { funct3: 2 }),
  row("sltiu", "I", "RV32I", OPCODE.opImm, { funct3: 3 }),
  row("xori", "I", "RV32I", OPCODE.opImm, { funct3: 4 }),
  row("ori", "I", "RV32I", OPCODE.opImm, { funct3: 6 }),
  row("andi", "I", "RV32I", OPCODE.opImm, { funct3: 7 }),
  // The doubleword shifts steal a bit from funct7 for the shift amount, so the
  // fixed part is six bits wide rather than seven.
  row("slli", "shift", "RV32I", OPCODE.opImm, { funct3: 1, funct7: 0x00, wideShift: true }),
  row("srli", "shift", "RV32I", OPCODE.opImm, { funct3: 5, funct7: 0x00, wideShift: true }),
  row("srai", "shift", "RV32I", OPCODE.opImm, { funct3: 5, funct7: 0x20, wideShift: true }),

  row("add", "R", "RV32I", OPCODE.op, { funct3: 0, funct7: 0x00 }),
  row("sub", "R", "RV32I", OPCODE.op, { funct3: 0, funct7: 0x20 }),
  row("sll", "R", "RV32I", OPCODE.op, { funct3: 1, funct7: 0x00 }),
  row("slt", "R", "RV32I", OPCODE.op, { funct3: 2, funct7: 0x00 }),
  row("sltu", "R", "RV32I", OPCODE.op, { funct3: 3, funct7: 0x00 }),
  row("xor", "R", "RV32I", OPCODE.op, { funct3: 4, funct7: 0x00 }),
  row("srl", "R", "RV32I", OPCODE.op, { funct3: 5, funct7: 0x00 }),
  row("sra", "R", "RV32I", OPCODE.op, { funct3: 5, funct7: 0x20 }),
  row("or", "R", "RV32I", OPCODE.op, { funct3: 6, funct7: 0x00 }),
  row("and", "R", "RV32I", OPCODE.op, { funct3: 7, funct7: 0x00 }),

  // — RV64I —
  row("addiw", "I", "RV64I", OPCODE.opImm32, { funct3: 0 }),
  row("slliw", "shift", "RV64I", OPCODE.opImm32, { funct3: 1, funct7: 0x00 }),
  row("srliw", "shift", "RV64I", OPCODE.opImm32, { funct3: 5, funct7: 0x00 }),
  row("sraiw", "shift", "RV64I", OPCODE.opImm32, { funct3: 5, funct7: 0x20 }),
  row("addw", "R", "RV64I", OPCODE.op32, { funct3: 0, funct7: 0x00 }),
  row("subw", "R", "RV64I", OPCODE.op32, { funct3: 0, funct7: 0x20 }),
  row("sllw", "R", "RV64I", OPCODE.op32, { funct3: 1, funct7: 0x00 }),
  row("srlw", "R", "RV64I", OPCODE.op32, { funct3: 5, funct7: 0x00 }),
  row("sraw", "R", "RV64I", OPCODE.op32, { funct3: 5, funct7: 0x20 }),

  // — M —
  row("mul", "R", "M", OPCODE.op, { funct3: 0, funct7: 0x01 }),
  row("mulh", "R", "M", OPCODE.op, { funct3: 1, funct7: 0x01 }),
  row("mulhsu", "R", "M", OPCODE.op, { funct3: 2, funct7: 0x01 }),
  row("mulhu", "R", "M", OPCODE.op, { funct3: 3, funct7: 0x01 }),
  row("div", "R", "M", OPCODE.op, { funct3: 4, funct7: 0x01 }),
  row("divu", "R", "M", OPCODE.op, { funct3: 5, funct7: 0x01 }),
  row("rem", "R", "M", OPCODE.op, { funct3: 6, funct7: 0x01 }),
  row("remu", "R", "M", OPCODE.op, { funct3: 7, funct7: 0x01 }),
  row("mulw", "R", "M", OPCODE.op32, { funct3: 0, funct7: 0x01 }),
  row("divw", "R", "M", OPCODE.op32, { funct3: 4, funct7: 0x01 }),
  row("divuw", "R", "M", OPCODE.op32, { funct3: 5, funct7: 0x01 }),
  row("remw", "R", "M", OPCODE.op32, { funct3: 6, funct7: 0x01 }),
  row("remuw", "R", "M", OPCODE.op32, { funct3: 7, funct7: 0x01 }),

  // — A —
  ...atomics("amoadd", 0x00),
  ...atomics("amoswap", 0x01),
  row("lr.w", "atomic", "A", OPCODE.amo, { funct3: 2, funct5: 0x02, syntax: "atomic" }),
  row("lr.d", "atomic", "A", OPCODE.amo, { funct3: 3, funct5: 0x02, syntax: "atomic" }),
  ...atomics("sc", 0x03),
  ...atomics("amoxor", 0x04),
  ...atomics("amoor", 0x08),
  ...atomics("amoand", 0x0c),
  ...atomics("amomin", 0x10),
  ...atomics("amomax", 0x14),
  ...atomics("amominu", 0x18),
  ...atomics("amomaxu", 0x1c),

  // — Zicsr —
  row("csrrw", "csr", "Zicsr", OPCODE.system, { funct3: 1 }),
  row("csrrs", "csr", "Zicsr", OPCODE.system, { funct3: 2 }),
  row("csrrc", "csr", "Zicsr", OPCODE.system, { funct3: 3 }),
  row("csrrwi", "csr", "Zicsr", OPCODE.system, { funct3: 5 }),
  row("csrrsi", "csr", "Zicsr", OPCODE.system, { funct3: 6 }),
  row("csrrci", "csr", "Zicsr", OPCODE.system, { funct3: 7 }),

  // — ordering —
  row("fence", "fence", "RV32I", OPCODE.fence, { funct3: 0 }),
  row("fence.i", "system", "Zifencei", OPCODE.fence, { word: 0x0000100f, syntax: "none" }),

  // — the fixed words —
  row("ecall", "system", "RV32I", OPCODE.system, { word: 0x00000073, syntax: "none" }),
  row("ebreak", "system", "RV32I", OPCODE.system, { word: 0x00100073, syntax: "none" }),
  row("sret", "system", "RV32I", OPCODE.system, { word: 0x10200073, syntax: "none" }),
  row("mret", "system", "RV32I", OPCODE.system, { word: 0x30200073, syntax: "none" }),
  row("wfi", "system", "RV32I", OPCODE.system, { word: 0x10500073, syntax: "none" }),
];

/** ABI names in register order, `x0` first. The manual's calling convention, chapter 25. */
export const REGISTER_ABI_NAMES = [
  "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2",
  "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5",
  "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7",
  "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6",
] as const;

/** What each register is for, and who is responsible for preserving it across a call. */
export const REGISTER_ROLES: readonly { readonly abi: string; readonly saver: "—" | "caller" | "callee" }[] = [
  { abi: "zero", saver: "—" },
  { abi: "ra", saver: "caller" },
  { abi: "sp", saver: "callee" },
  { abi: "gp", saver: "—" },
  { abi: "tp", saver: "—" },
  ...["t0", "t1", "t2"].map((abi) => ({ abi, saver: "caller" as const })),
  { abi: "s0", saver: "callee" },
  { abi: "s1", saver: "callee" },
  ...["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"].map((abi) => ({ abi, saver: "caller" as const })),
  ...["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"].map((abi) => ({
    abi,
    saver: "callee" as const,
  })),
  ...["t3", "t4", "t5", "t6"].map((abi) => ({ abi, saver: "caller" as const })),
];

/** A register number from `x5`, `t0`, or `fp`, or `null` when the text names no register. */
export function parseRegister(text: string): number | null {
  const name = text.trim().toLowerCase();
  const numbered = /^x(\d{1,2})$/.exec(name);
  if (numbered !== null) {
    const index = Number(numbered[1]);
    return index <= 31 ? index : null;
  }
  // `fp` is `s0` under another name; the manual lists both and compilers emit both.
  if (name === "fp") return 8;
  const abi = REGISTER_ABI_NAMES.indexOf(name as (typeof REGISTER_ABI_NAMES)[number]);
  return abi === -1 ? null : abi;
}

/** `x5` becomes `t0` — the spelling every disassembler prints and every human reads. */
export function registerName(index: number): string {
  return REGISTER_ABI_NAMES[index] ?? `x${index}`;
}

/** Bits `high..low` of a word, as an unsigned integer. */
export function bitsOf(word: number, high: number, low: number): number {
  const width = high - low + 1;
  const shifted = word >>> low;
  return width >= 32 ? shifted >>> 0 : shifted & ((1 << width) - 1);
}

/** Widens a `width`-bit two's-complement value to a full JavaScript number. */
export function signExtend(value: number, width: number): number {
  const shift = 32 - width;
  return (value << shift) >> shift;
}

/**
 * Where each immediate bit lives, as `[immediateHigh, immediateLow, wordLow]`
 * triples: immediate bits `immediateHigh..immediateLow` are stored starting at
 * word bit `wordLow`.
 *
 * Written once and read by both directions. The B and J rows are the scrambled
 * ones, and seeing them as three and four fragments respectively is the clearest
 * statement of why a hand-written branch offset is so often wrong.
 */
export const IMMEDIATE_LAYOUTS: Readonly<Record<"I" | "S" | "B" | "U" | "J", readonly (readonly [number, number, number])[]>> = {
  I: [[11, 0, 20]],
  S: [
    [11, 5, 25],
    [4, 0, 7],
  ],
  B: [
    [12, 12, 31],
    [10, 5, 25],
    [4, 1, 8],
    [11, 11, 7],
  ],
  // Twenty bits, numbered from zero — because `lui rd, 0x12345` writes the FIELD
  // and not the value 0x12345000 that the field eventually contributes. Every
  // disassembler prints it that way and the encoder must read it back the same.
  U: [[19, 0, 12]],
  J: [
    [20, 20, 31],
    [10, 1, 21],
    [11, 11, 20],
    [19, 12, 12],
  ],
};

/** How wide each immediate is, counting the sign bit where there is one. */
const IMMEDIATE_WIDTH: Readonly<Record<keyof typeof IMMEDIATE_LAYOUTS, number>> = {
  I: 12,
  S: 12,
  B: 13,
  U: 20,
  J: 21,
};

/** Pulls the immediate out of a word and sign-extends it. */
export function extractImmediate(word: number, layout: keyof typeof IMMEDIATE_LAYOUTS): number {
  let value = 0;
  for (const [high, low, wordLow] of IMMEDIATE_LAYOUTS[layout]) {
    value |= bitsOf(word, wordLow + (high - low), wordLow) << low;
  }
  // The U field is a bit pattern rather than a quantity, so it is printed
  // unsigned; every other immediate is a signed offset.
  return layout === "U" ? value >>> 0 : signExtend(value, IMMEDIATE_WIDTH[layout]);
}

/** Scatters an immediate into a word. The caller has already checked its range. */
export function insertImmediate(value: number, layout: keyof typeof IMMEDIATE_LAYOUTS): number {
  let word = 0;
  for (const [high, low, wordLow] of IMMEDIATE_LAYOUTS[layout]) {
    const fragment = (value >> low) & ((1 << (high - low + 1)) - 1);
    word |= fragment << wordLow;
  }
  return word >>> 0;
}

/**
 * The inclusive range an immediate may take, and its alignment.
 *
 * The U field is accepted both ways round — `0x12345` and `-1` both name a
 * twenty-bit pattern, and assemblers in the field disagree about which they
 * admit, so this one admits both and prints the unsigned spelling back.
 */
export function immediateRange(layout: keyof typeof IMMEDIATE_LAYOUTS): {
  readonly min: number;
  readonly max: number;
  readonly step: number;
} {
  const width = IMMEDIATE_WIDTH[layout];
  if (layout === "U") return { min: -(2 ** (width - 1)), max: 2 ** width - 1, step: 1 };
  // B and J address halfwords: their bit 0 is not stored, so the offset is even.
  const step = layout === "B" || layout === "J" ? 2 : 1;
  return { min: -(2 ** (width - 1)), max: 2 ** (width - 1) - step, step };
}
