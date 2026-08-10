import { describe, expect, it } from "vitest";

import { assemble } from "./riscvAssemble.js";
import { COMPRESSED_MNEMONICS, assembleCompressed, decodeCompressed } from "./riscvCompressed.js";

const hex = (value: number): string => `0x${(value & 0xffff).toString(16).padStart(4, "0")}`;

function decoded(halfword: number, xlen: 32 | 64 = 64) {
  const result = decodeCompressed(halfword, xlen);
  if (!result.ok) throw new Error(`decode(${hex(halfword)}) refused: ${result.reason}`);
  return result.value;
}

describe("known compressed encodings", () => {
  // Each derived by hand from the manual's field diagrams in chapter 26.
  const known: readonly (readonly [number, string, string])[] = [
    [0x0001, "c.nop", "addi zero, zero, 0"],
    [0x9002, "c.ebreak", "ebreak"],
    [0x4505, "c.li a0, 1", "addi a0, zero, 1"],
    [0x852e, "c.mv a0, a1", "add a0, zero, a1"],
    [0x8082, "c.jr ra", "jalr zero, 0(ra)"],
    [0x1101, "c.addi sp, -32", "addi sp, sp, -32"],
    [0xe406, "c.sdsp ra, 8(sp)", "sd ra, 8(sp)"],
    [0x0808, "c.addi4spn a0, sp, 16", "addi a0, sp, 16"],
  ];

  it.each(known)("%s is %s", (halfword, asm, expansion) => {
    const result = decoded(halfword);
    expect(result.asm).toBe(asm);
    expect(result.expansion).toBe(expansion);
  });

  it("re-encodes each of them from its own spelling", () => {
    for (const [halfword, asm] of known) {
      const back = assembleCompressed(asm, 64);
      expect([asm, back.ok && hex(back.value)]).toEqual([asm, hex(halfword)]);
    }
  });
});

describe("reserved encodings", () => {
  it("keeps the all-zero halfword illegal", () => {
    // The architecture reserves it on purpose: a jump into cleared memory must
    // trap rather than execute an `addi` of nothing.
    const result = decodeCompressed(0x0000);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("nzuimm");
  });

  it("refuses the encodings whose immediate or register the manual forbids", () => {
    // c.addi with rd = 0 (would be a second c.nop), c.lui with rd = 0,
    // c.slli with rd = 0, and c.lwsp with rd = 0.
    for (const [halfword, what] of [
      [0x0005, "rd"], // c.addi x0, 1
      [0x6001, "rd"], // c.lui x0, … — the register is checked first
      [0x0006, "rd"], // c.slli x0, 1
      [0x4002, "rd"], // c.lwsp x0, 0(sp)
    ] as const) {
      const result = decodeCompressed(halfword);
      expect([hex(halfword), result.ok]).toEqual([hex(halfword), false]);
      expect([hex(halfword), !result.ok && result.reason.includes(what)]).toEqual([hex(halfword), true]);
    }
  });

  it("refuses a shift past 31 on RV32, where the sixth bit is reserved", () => {
    // c.slli a0, 32 — bit 12 set, which RV64 reads as shamt[5] and RV32 does not.
    const shiftBy32 = 0x1502;
    expect(decoded(shiftBy32, 64).asm).toBe("c.slli a0, 32");
    const onRv32 = decodeCompressed(shiftBy32, 32);
    expect(onRv32.ok).toBe(false);
    expect(!onRv32.ok && onRv32.reason).toContain("RV64");
  });

  it("says when a halfword is really the low half of a 32-bit instruction", () => {
    const result = decodeCompressed(0x0513);
    expect(!result.ok && result.reason).toContain("32-bit");
  });
});

describe("the two bases disagree about three funct3 values", () => {
  it("reads funct3 001 in quadrant 1 as c.addiw on RV64 and c.jal on RV32", () => {
    const halfword = 0x2505;
    expect(decoded(halfword, 64).mnemonic).toBe("c.addiw");
    expect(decoded(halfword, 32).mnemonic).toBe("c.jal");
  });

  it("offers the doubleword forms only on RV64", () => {
    expect(assembleCompressed("c.sdsp ra, 8(sp)", 64).ok).toBe(true);
    expect(assembleCompressed("c.sdsp ra, 8(sp)", 32).ok).toBe(false);
    expect(assembleCompressed("c.ld a0, 8(a1)", 32).ok).toBe(false);
    expect(assembleCompressed("c.addw a0, a1", 32).ok).toBe(false);
  });
});

describe("every halfword, both directions", () => {
  /** Decodes all 65 536 halfwords and checks each answer against its own inverse. */
  function sweep(xlen: 32 | 64): { readonly decodedCount: number; readonly seen: ReadonlySet<string> } {
    const seen = new Set<string>();
    let decodedCount = 0;

    for (let halfword = 0; halfword <= 0xffff; halfword += 1) {
      const result = decodeCompressed(halfword, xlen);
      if (!result.ok) continue;
      decodedCount += 1;
      seen.add(result.value.mnemonic);

      // Re-encoding the tool's own spelling must land on the same halfword.
      const back = assembleCompressed(result.value.asm, xlen);
      if (!back.ok || back.value !== halfword) {
        throw new Error(
          `${hex(halfword)} decodes as "${result.value.asm}" which re-encodes as ` +
            `${back.ok ? hex(back.value) : `a refusal (${back.reason})`}`,
        );
      }

      // …and the 32-bit equivalent must be something the base assembler accepts.
      const expanded = assemble(result.value.expansion, xlen);
      if (!expanded.ok) {
        throw new Error(`${hex(halfword)} expands to "${result.value.expansion}", which the assembler refuses: ${expanded.reason}`);
      }
      const words = expanded.value.flatMap((line) => line.words);
      if (words.length !== 1) {
        throw new Error(`${hex(halfword)} expands to ${words.length} instructions, and a compressed one is always exactly one`);
      }
    }
    return { decodedCount, seen };
  }

  it("round-trips every legal RV64 halfword", () => {
    const { decodedCount, seen } = sweep(64);
    // Roughly two thirds of the space is legal on RV64; the rest is either a
    // 32-bit instruction (quadrant 11) or a reserved encoding.
    expect(decodedCount).toBeGreaterThan(30_000);
    // Every RV64 mnemonic in the table is reachable — a row nothing can decode
    // to would be a row nobody had checked.
    for (const mnemonic of COMPRESSED_MNEMONICS) {
      if (mnemonic === "c.jal") continue; // RV32 only
      expect([mnemonic, seen.has(mnemonic)]).toEqual([mnemonic, true]);
    }
  });

  it("round-trips every legal RV32 halfword", () => {
    const { seen } = sweep(32);
    expect(seen.has("c.jal")).toBe(true);
    expect(seen.has("c.addiw")).toBe(false);
    expect(seen.has("c.sdsp")).toBe(false);
  });
});

describe("bit fields", () => {
  it("accounts for every bit of the halfword", () => {
    for (const halfword of [0x0808, 0x4505, 0x852e, 0xe406, 0x1101, 0x8082]) {
      const covered = decoded(halfword).fields.reduce((sum, field) => sum + (field.high - field.low + 1), 0);
      expect([hex(halfword), covered]).toEqual([hex(halfword), 16]);
    }
  });

  it("names the three-bit register fields as the manual does", () => {
    const names = decoded(0x0808).fields.map((field) => field.name);
    expect(names).toContain("rd'");
    expect(decoded(0x0808).fields.find((field) => field.name === "rd'")?.text).toBe("a0");
  });
});
