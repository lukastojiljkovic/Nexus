/**
 * RISC-V - the English copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are
 * not here: those live in the `name` and `blurb` tables of
 * `./devtools.en.ts`, because the drawer's rail needs them before any surface
 * is opened.
 *
 * **`errors` is the odd one out.** `@nexus/core/devtools/{riscv,riscvAssemble,
 * riscvCompressed}` refuse with a free-text English `reason` rather than a
 * discrete code - there is no finite `Record<code, string>` to write. What IS
 * finite is the set of message TEMPLATES those three modules can produce (every
 * `fail(...)` call site was read to build this list), so `riscv.tsx` matches
 * the raw reason against that closed set of shapes and calls the matching entry
 * here with the pieces of data the message carries (a mnemonic, a range, a bit
 * count) - never the English prose itself. `line` renders the line number the
 * assembler names its refusal by; `operandWord` is the three forms
 * `countUnit` (`../strings.js`) chooses between for an operand count -
 * English answers with `one` or `other`, and `few` carries the same plural
 * as `many` so all three slots stay filled.
 */
export const DEVTOOLS_RISCV_EN = {
  modeGroupLabel: "Mode",
  modeAssemble: "Assemble",
  modeDisassemble: "Disassemble",
  modeRegisters: "Registers",
  xlenGroupLabel: "Base (XLEN)",
  xlen32: "RV32",
  xlen64: "RV64",

  assemble: {
    sourceLabel: "Assembly source",
    sourceHint:
      "One instruction per line. A comment after #, ; or //. Compressed (C) forms are supported too, e.g. c.addi.",
  },

  disassemble: {
    wordLabel: "Word (0x, 0b, 0o or decimal)",
    wordHint:
      "E.g. 0x00a50533. The word announces its own width: 32 bits when the two lowest bits are 11, otherwise 16.",
    invalid: "This is not a valid number.",
    tooWide: "The word is wider than the length its two lowest bits announce.",
  },

  registers: {
    columnRegister: "Register",
    columnAbi: "ABI name",
    columnRole: "Role",
    columnSaver: "Who preserves it",
    saverCaller: "caller (caller-saved)",
    saverCallee: "callee (callee-saved)",
    saverNone: "—",
    savingNote:
      "“Who preserves it” shows who is responsible for preserving the register's value across a function call — the caller must save it before the call if it still needs it afterwards, and the callee must return it unchanged if it uses it.",
    fpNote:
      "fp is an alternative name for s0 (x8) — the frame pointer of the current call. The tool accepts both names.",
    roleByAbi: {
      zero: "Always zero — writes to it are discarded.",
      ra: "The return address of a function call.",
      sp: "Stack pointer.",
      gp: "Global pointer.",
      tp: "Thread pointer.",
      t0: "Temporary register.",
      t1: "Temporary register.",
      t2: "Temporary register.",
      s0: "Preserved register — usually the frame pointer too.",
      s1: "Preserved register.",
      a0: "Function argument / return value.",
      a1: "Function argument / return value.",
      a2: "Function argument.",
      a3: "Function argument.",
      a4: "Function argument.",
      a5: "Function argument.",
      a6: "Function argument.",
      a7: "Function argument.",
      s2: "Preserved register.",
      s3: "Preserved register.",
      s4: "Preserved register.",
      s5: "Preserved register.",
      s6: "Preserved register.",
      s7: "Preserved register.",
      s8: "Preserved register.",
      s9: "Preserved register.",
      s10: "Preserved register.",
      s11: "Preserved register.",
      t3: "Temporary register.",
      t4: "Temporary register.",
      t5: "Temporary register.",
      t6: "Temporary register.",
    },
  },

  decoded: {
    hexLabel: "Hexadecimal",
    binaryLabel: "Binary",
    asmLabel: "Instruction",
    pseudoLabel: "Pseudo-instruction",
    expansionLabel: "Equivalent instruction (32-bit)",
    mnemonicLabel: "Mnemonic",
    extensionRowLabel: "Extension",
    formatRowLabel: "Format",
    immediateLabel: "Immediate",
    offsetLabel: "Offset",
    fieldsTitle: "Field layout",
    fieldColumn: "Field",
    bitsColumn: "Bits",
    binaryColumn: "Binary",
    meaningColumn: "Meaning",
    compressedFormat: "compressed form (C)",
    compressedExtension: "C",
    formatNames: {
      R: "R",
      I: "I",
      S: "S",
      B: "B",
      U: "U",
      J: "J",
      shift: "I (offset)",
      atomic: "atomic (A)",
      csr: "CSR",
      fence: "fence",
      system: "system",
    },
  },

  errors: {
    unknown: "The tool cannot interpret this encoding.",
    /**
     * The interpolated refusals. Every `{name}` is filled by `fill()` from
     * `strings.ts` — the table holds DATA, never a function: the live table is a
     * `structuredClone` of this one, and a function leaf throws `DataCloneError`
     * at import. See `LocaleShape`.
     */
    line: "Line {n}: {inner}",

    wordIsCompressed:
      "The two lowest bits are not 11 — this is a 16-bit compressed (C) instruction, not a 32-bit word.",
    halfwordIsWord:
      "The two lowest bits are 11 — this is a 32-bit instruction, not a compressed (C) one.",
    lrNeedsZeroRs2: "lr requires the rs2 field to be zero.",
    nothingToAssemble: "There is nothing to assemble — enter at least one instruction.",
    atomicAddressForm: "An atomic instruction's address operand is written as (register).",
    atomicNoOffset:
      "An atomic instruction has no offset — write (register), not offset(register).",
    csrImmediateRange:
      "The immediate CSR forms take only a 5-bit unsigned value (0–31).",
    fenceOperand: "The operand of a fence instruction is a subset of the letters i, o, r, w — or 0.",
    liNeedsTwoOperands: "li requires a destination register and a value.",
    liTooWide32: "This value does not fit in 32 bits.",
    liTooWide64: "This value does not fit in 64 bits.",

    operandWord: { one: "operand", few: "operands", many: "operands" },

    noOpcodeMatch: "No instruction has opcode {opcode} with funct3 {funct3}.",
    unknownMnemonic: "The tool does not know the instruction “{mnemonic}”.",
    unknownCompressedMnemonic: "The tool does not know the compressed (C) instruction “{mnemonic}”.",
    notAtomicOrdering:
      "Only atomic instructions carry an ordering suffix (.aq/.rl) — “{mnemonic}” is not atomic.",
    operandCount: "“{mnemonic}” needs {expected} {noun}, but {got} was entered.",
    pseudoOperandCount: "“{mnemonic}” does not accept {got} {noun}.",
    compressedRegisterMismatch: "“{mnemonic}” cannot be written with these registers.",
    notARegisterField: "“{text}” is not a register ({role} field).",
    notARegister: "“{text}” is not a register.",
    notNarrowRegister:
      "“{text}” must be one of x8…x15 — the only registers the compressed form can name.",
    looksLikeLabel:
      "“{text}” looks like a label — the tool has no symbol table; enter a numeric offset.",
    notANumber: "“{text}” is not a number.",
    outOfRange: "{value} is outside the {format} format's range ({min}…{max}).",
    mustBeEven: "{value} must be an even number — the lowest bit of this offset is not written.",
    shiftRange: "The offset here must be 0…{max}, but “{text}” was entered.",
    notOffsetRegister: "“{text}” is not of the form offset(register).",
    notOffsetSp: "“{text}” is not of the form offset(sp).",
    notCsr: "“{text}” is neither a CSR register name nor a 12-bit address.",
    reservedMustNotBeZero: "Reserved encoding: the {field} field may not be zero ({mnemonic}).",
    reservedMustNotBeZeroBare: "Reserved encoding: the {field} field may not be zero.",
    reservedShiftNeedsRv64:
      "Reserved encoding: an offset of {amount} requires RV64 ({mnemonic}).",
    noQuadrantMatch:
      "No compressed (C) instruction has quadrant {quadrant} with funct3 {funct3}.",
  },
} as const;
