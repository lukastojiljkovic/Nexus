import { describe, expect, it } from "vitest";

import {
  INSTRUCTIONS,
  type RiscvInstruction,
  bitsOf,
  extractImmediate,
  parseRegister,
  registerName,
} from "./riscv.js";
import { type Xlen, assemble, decodeInstruction } from "./riscvAssemble.js";

/** One line in, one word out — the shape most tests want. */
function word(source: string, xlen: Xlen = 64): number {
  const result = assemble(source, xlen);
  if (!result.ok) throw new Error(`assemble("${source}") refused: ${result.reason}`);
  const words = result.value.flatMap((line) => line.words);
  if (words.length !== 1) throw new Error(`assemble("${source}") produced ${words.length} words`);
  return words[0]!;
}

function asm(value: number, xlen: Xlen = 64): string {
  const result = decodeInstruction(value, xlen);
  if (!result.ok) throw new Error(`decode(0x${value.toString(16)}) refused: ${result.reason}`);
  return result.value.asm;
}

const hex = (value: number): string => `0x${(value >>> 0).toString(16).padStart(8, "0")}`;

describe("known encodings", () => {
  it("agrees with the words every RISC-V programmer has memorised", () => {
    // Each of these is a fixed, publishable encoding — derived by hand from the
    // manual's field tables, not read back out of this module.
    const known: readonly (readonly [string, number])[] = [
      ["nop", 0x00000013],
      ["addi a0, a0, 1", 0x00150513],
      ["ret", 0x00008067],
      ["jal ra, 0", 0x000000ef],
      ["lw a0, 8(sp)", 0x00812503],
      ["sw a1, 12(sp)", 0x00b12623],
      ["ecall", 0x00000073],
      ["ebreak", 0x00100073],
      ["add a0, a1, a2", 0x00c58533],
      ["sub a0, a1, a2", 0x40c58533],
      ["mul a0, a1, a2", 0x02c58533],
      ["lui a0, 0x12345", 0x12345537],
      ["auipc t0, 0x1", 0x00001297],
    ];
    for (const [source, expected] of known) {
      expect([source, hex(word(source))]).toEqual([source, hex(expected)]);
    }
  });

  it("scatters a branch offset across the four places the B format keeps it", () => {
    // −16 is 0b1_1111_1111_0000 in thirteen bits. Bit 12 goes to word bit 31,
    // bits 10:5 to 30:25, bits 4:1 to 11:8, and bit 11 to word bit 7 — which is
    // the whole reason a hand-written branch is so often four bytes wrong.
    const encoded = word("beq a0, a1, -16");
    expect(hex(encoded)).toBe(hex(0xfeb508e3));
    expect(bitsOf(encoded, 31, 31)).toBe(1); // imm[12]
    expect(bitsOf(encoded, 30, 25)).toBe(0b111111); // imm[10:5]
    expect(bitsOf(encoded, 11, 8)).toBe(0b1000); // imm[4:1]
    expect(bitsOf(encoded, 7, 7)).toBe(1); // imm[11]
    expect(extractImmediate(encoded, "B")).toBe(-16);
  });

  it("scatters a jump offset across the four places the J format keeps it", () => {
    const encoded = word("jal ra, -32");
    expect(hex(encoded)).toBe(hex(0xfe1ff0ef));
    expect(extractImmediate(encoded, "J")).toBe(-32);
  });

  it("encodes the doubleword shifts with six bits of amount on RV64 and five on RV32", () => {
    // `srai a0, a0, 32` needs a sixth bit, so it exists on RV64 and nowhere else.
    expect(bitsOf(word("srai a0, a0, 32"), 25, 20)).toBe(32);
    expect(bitsOf(word("srai a0, a0, 32"), 31, 26)).toBe(0b010000);
    const onRv32 = assemble("srai a0, a0, 32", 32);
    expect(onRv32.ok).toBe(false);
    expect(bitsOf(word("srai a0, a0, 31", 32), 31, 25)).toBe(0b0100000);
  });
});

describe("decoding", () => {
  it("names the pseudo-instruction beside the canonical spelling, never instead of it", () => {
    const nop = decodeInstruction(0x00000013);
    expect(nop.ok && nop.value.asm).toBe("addi zero, zero, 0");
    expect(nop.ok && nop.value.pseudo).toBe("nop");

    const ret = decodeInstruction(0x00008067);
    expect(ret.ok && ret.value.asm).toBe("jalr zero, 0(ra)");
    expect(ret.ok && ret.value.pseudo).toBe("ret");

    const move = decodeInstruction(word("addi a0, a1, 0"));
    expect(move.ok && move.value.pseudo).toBe("mv a0, a1");

    const negate = decodeInstruction(word("sub a0, zero, a1"));
    expect(negate.ok && negate.value.pseudo).toBe("neg a0, a1");

    // `blez` swaps its operands rather than pinning one, which is the rule most
    // often got backwards: `blez rs, off` is `bge zero, rs, off`.
    const lessOrEqualZero = decodeInstruction(word("bge zero, a0, 8"));
    expect(lessOrEqualZero.ok && lessOrEqualZero.value.pseudo).toBe("blez a0, 8");
  });

  it("accounts for every bit of the word in its fields", () => {
    const decoded = decodeInstruction(word("addi a0, a1, -12"));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const covered = decoded.value.fields.reduce((sum, field) => sum + (field.high - field.low + 1), 0);
    expect(covered).toBe(32);
    expect(decoded.value.fields.map((field) => field.name)).toEqual([
      "imm[11:0]", "rs1", "funct3", "rd", "opcode",
    ]);
    expect(decoded.value.fields.find((field) => field.name === "rs1")?.text).toBe("a1");
  });

  it("refuses rather than printing something plausible", () => {
    // Opcode 0x7F is reserved for instructions longer than 32 bits.
    expect(decodeInstruction(0x0000007f).ok).toBe(false);
    // A 16-bit compressed instruction is a different tool's job, and saying so
    // is more useful than decoding its low half as something else.
    const compressed = decodeInstruction(0x0000_4501);
    expect(compressed.ok).toBe(false);
    expect(!compressed.ok && compressed.reason).toContain("compressed");
  });

  it("reads the atomics' ordering bits back into the mnemonic suffix", () => {
    expect(asm(word("amoadd.w a0, a1, (a2)"))).toBe("amoadd.w a0, a1, (a2)");
    expect(asm(word("amoswap.d.aqrl a0, a1, (a2)"))).toBe("amoswap.d.aq.rl a0, a1, (a2)");
    expect(asm(word("lr.w.aq a0, (a1)"))).toBe("lr.w.aq a0, (a1)");
    expect(bitsOf(word("sc.w.rl a0, a1, (a2)"), 25, 25)).toBe(1);
    expect(bitsOf(word("sc.w.rl a0, a1, (a2)"), 26, 26)).toBe(0);
  });

  it("reads a fence's two sets of letters", () => {
    expect(asm(word("fence rw, rw"))).toBe("fence rw, rw");
    expect(asm(word("fence iorw, iorw"))).toBe("fence iorw, iorw");
    expect(asm(0x0ff0000f)).toBe("fence iorw, iorw");
    expect(asm(word("fence"))).toBe("fence iorw, iorw");
  });

  it("names the CSRs it knows and prints an address for the rest", () => {
    expect(asm(word("csrrw a0, mstatus, a1"))).toBe("csrrw a0, mstatus, a1");
    expect(asm(word("csrrs a0, 0x7c0, zero"))).toBe("csrrs a0, 0x7c0, zero");
    expect(decodeInstruction(word("csrrs a0, mcause, zero")).ok).toBe(true);
    const read = decodeInstruction(word("csrrs a0, mcause, zero"));
    expect(read.ok && read.value.pseudo).toBe("csrr a0, mcause");
    // The immediate forms put a five-bit literal where a register number goes.
    expect(asm(word("csrrwi a0, mstatus, 7"))).toBe("csrrwi a0, mstatus, 7");
  });
});

describe("the table drives both directions", () => {
  it("gives every instruction a distinct set of fixed fields", () => {
    const seen = new Map<string, string>();
    for (const instruction of INSTRUCTIONS) {
      const key = JSON.stringify([
        instruction.word ?? null,
        instruction.opcode,
        instruction.funct3 ?? null,
        instruction.funct7 ?? null,
        instruction.funct5 ?? null,
      ]);
      const previous = seen.get(key);
      expect([instruction.mnemonic, previous]).toEqual([instruction.mnemonic, undefined]);
      seen.set(key, instruction.mnemonic);
    }
  });

  it("round-trips every instruction in the table through both directions", () => {
    for (const instruction of INSTRUCTIONS) {
      const source = sampleAsm(instruction);
      const xlen: Xlen = 64;
      const encoded = assemble(source, xlen);
      expect([instruction.mnemonic, encoded.ok]).toEqual([instruction.mnemonic, true]);
      if (!encoded.ok) continue;
      const words = encoded.value.flatMap((line) => line.words);
      expect([instruction.mnemonic, words.length]).toEqual([instruction.mnemonic, 1]);
      const decoded = decodeInstruction(words[0]!, xlen);
      expect([instruction.mnemonic, decoded.ok]).toEqual([instruction.mnemonic, true]);
      if (!decoded.ok) continue;
      expect([instruction.mnemonic, decoded.value.asm]).toEqual([instruction.mnemonic, source]);
      expect([instruction.mnemonic, decoded.value.instruction.mnemonic]).toEqual([
        instruction.mnemonic,
        instruction.mnemonic,
      ]);
    }
  });
});

describe("refusals", () => {
  it("says that it has no symbol table rather than encoding a label as zero", () => {
    const result = assemble("beq a0, a1, loop");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("symbol table");
  });

  it("names the range an immediate fell outside of", () => {
    const result = assemble("addi a0, a1, 2048");
    expect(!result.ok && result.reason).toContain("-2048…2047");
    expect(assemble("addi a0, a1, 2047").ok).toBe(true);
    expect(assemble("addi a0, a1, -2048").ok).toBe(true);
  });

  it("refuses an odd branch offset, because its low bit is not stored", () => {
    const result = assemble("beq a0, a1, 7");
    expect(!result.ok && result.reason).toContain("even");
  });

  it("reports the line a multi-line source failed on", () => {
    const result = assemble("addi a0, zero, 1\n# a comment\nnot.an.instruction a0");
    expect(!result.ok && result.reason).toMatch(/^line 3:/);
  });

  it("refuses an RV64 instruction when reading against RV32", () => {
    expect(assemble("addw a0, a1, a2", 64).ok).toBe(true);
    expect(assemble("addw a0, a1, a2", 32).ok).toBe(false);
    expect(assemble("ld a0, 0(sp)", 32).ok).toBe(false);
  });

  it("refuses an offset on an atomic, which has no offset field", () => {
    const result = assemble("amoadd.w a0, a1, 4(a2)");
    expect(!result.ok && result.reason).toContain("no offset");
  });
});

describe("li — the pseudo-instruction with real arithmetic in it", () => {
  const cases: readonly (readonly [string, string, number])[] = [
    ["li a0, 0", "0", 1],
    ["li a0, 2047", "2047", 1],
    ["li a0, -2048", "-2048", 1],
    // 2048 does not fit a signed 12-bit field, so it costs a lui as well.
    ["li a0, 2048", "2048", 2],
    ["li a0, -2049", "-2049", 2],
    ["li a0, 4096", "4096", 1],
    ["li a0, 0x7fffffff", "2147483647", 2],
    ["li a0, -2147483648", "-2147483648", 1],
    // Past 32 bits the expansion peels twelve bits at a time and shifts what it
    // has built so far back up; four and eight are what the same algorithm in
    // LLVM's RISCVMatInt emits for these two constants.
    ["li a0, 0xdeadbeef", "3735928559", 4],
    ["li a0, -1", "-1", 1],
    ["li a0, 0x123456789abcdef", "81985529216486895", 8],
  ];

  it.each(cases)("%s builds the value it was asked for", (source, expected, count) => {
    const result = assemble(source, 64);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const words = result.value.flatMap((line) => line.words);
    expect(words).toHaveLength(count);
    // Run the sequence rather than compare it to a remembered listing: what
    // matters is that a0 holds the constant, not which instructions got it there.
    expect(String(run(words, parseRegister("a0")!))).toBe(expected);
  });

  it("pays for a negative addi in advance, which is the classic off-by-4096", () => {
    // The low twelve bits of 0x800 read as −2048, so the upper half must be one
    // step larger. Without the correction this lands 4096 short.
    for (const value of [0x800, 0x1800, 0x7ff800, -0x800, 0x123456]) {
      const words = assemble(`li a0, ${value}`, 64);
      expect(words.ok).toBe(true);
      if (!words.ok) continue;
      expect([value, Number(run(words.value.flatMap((line) => line.words), 10))]).toEqual([value, value]);
    }
  });

  it("refuses a value it cannot build", () => {
    expect(assemble("li a0, 0x1234567890", 32).ok).toBe(false);
    expect(assemble("li a0", 64).ok).toBe(false);
  });
});

/**
 * Executes the four instructions `li` expands to, in 64-bit arithmetic, and
 * returns one register. An independent reading of the encodings — if the
 * assembler and this disagree, one of them is wrong and the test says so.
 */
function run(words: readonly number[], target: number): bigint {
  const registers = new Map<number, bigint>();
  const read = (index: number): bigint => (index === 0 ? 0n : (registers.get(index) ?? 0n));
  const write = (index: number, value: bigint): void => {
    if (index !== 0) registers.set(index, BigInt.asIntN(64, value));
  };

  for (const value of words) {
    const decoded = decodeInstruction(value, 64);
    if (!decoded.ok) throw new Error(`the assembler produced a word the decoder refuses: ${decoded.reason}`);
    const rd = bitsOf(value, 11, 7);
    const rs1 = bitsOf(value, 19, 15);
    switch (decoded.value.instruction.mnemonic) {
      // lui writes bits 31:12 and sign-extends from bit 31 on RV64.
      case "lui":
        write(rd, BigInt.asIntN(32, BigInt(extractImmediate(value, "U")) << 12n));
        break;
      case "addi":
        write(rd, read(rs1) + BigInt(extractImmediate(value, "I")));
        break;
      case "addiw":
        write(rd, BigInt.asIntN(32, read(rs1) + BigInt(extractImmediate(value, "I"))));
        break;
      case "slli":
        write(rd, read(rs1) << BigInt(bitsOf(value, 25, 20)));
        break;
      default:
        throw new Error(`li expanded to ${decoded.value.instruction.mnemonic}, which this interpreter does not run`);
    }
  }
  return read(target);
}

/** A valid line for an instruction, built from its format alone. */
function sampleAsm(instruction: RiscvInstruction): string {
  const { mnemonic } = instruction;
  const t = (index: number): string => registerName(index);
  switch (instruction.format) {
    case "R":
      return `${mnemonic} ${t(5)}, ${t(6)}, ${t(7)}`;
    case "shift":
      return `${mnemonic} ${t(5)}, ${t(6)}, 5`;
    case "I":
      return instruction.syntax === "memory"
        ? `${mnemonic} ${t(10)}, 8(${t(2)})`
        : `${mnemonic} ${t(10)}, ${t(11)}, -12`;
    case "S":
      return `${mnemonic} ${t(11)}, -8(${t(2)})`;
    case "B":
      return `${mnemonic} ${t(10)}, ${t(11)}, -16`;
    case "U":
      return `${mnemonic} ${t(10)}, 0x12345`;
    case "J":
      return `${mnemonic} ${t(1)}, -32`;
    case "atomic":
      return instruction.funct5 === 0x02
        ? `${mnemonic} ${t(10)}, (${t(11)})`
        : `${mnemonic} ${t(10)}, ${t(11)}, (${t(12)})`;
    case "csr":
      return instruction.funct3 !== undefined && instruction.funct3 >= 5
        ? `${mnemonic} ${t(10)}, mstatus, 7`
        : `${mnemonic} ${t(10)}, mstatus, ${t(11)}`;
    case "fence":
      return "fence rw, rw";
    case "system":
      return mnemonic;
  }
}
