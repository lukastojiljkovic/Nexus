/**
 * „RISC-V" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 *
 * **`errors` is the odd one out.** `@nexus/core/devtools/{riscv,riscvAssemble,
 * riscvCompressed}` refuse with a free-text English `reason` rather than a
 * discrete code — there is no finite `Record<code, string>` to write. What IS
 * finite is the set of message TEMPLATES those three modules can produce (every
 * `fail(...)` call site was read to build this list), so `riscv.tsx` matches the
 * raw reason against that closed set of shapes and calls the matching entry
 * here with the pieces of data the message carries (a mnemonic, a range, a bit
 * count) — never the English prose itself. `line` renders the line number the
 * assembler names its refusal by; `operandWord` is the three Serbian forms
 * `countUnit` (`../strings.js`) chooses between for an operand count.
 */
export const DEVTOOLS_RISCV_SR = {
  modeGroupLabel: "Izbor režima",
  modeAssemble: "Sastavljanje",
  modeDisassemble: "Rastavljanje",
  modeRegisters: "Registri",
  xlenGroupLabel: "Osnova (XLEN)",
  xlen32: "RV32",
  xlen64: "RV64",

  assemble: {
    sourceLabel: "Asemblerski izvor",
    sourceHint:
      "Jedna instrukcija po redu. Komentar posle #, ; ili //. Podržani su i " +
      "sažeti (C) oblici, npr. c.addi.",
  },

  disassemble: {
    wordLabel: "Reč (0x, 0b, 0o ili dekadno)",
    wordHint:
      "Npr. 0x00a50533. Širinu objavljuje sama reč: 32 bita kada su dva najniža " +
      "bita 11, inače 16.",
    invalid: "Ovo nije ispravan zapis broja.",
    tooWide: "Reč je šira od dužine koju njena dva najniža bita objavljuju.",
  },

  registers: {
    columnRegister: "Registar",
    columnAbi: "ABI ime",
    columnRole: "Uloga",
    columnSaver: "Ko čuva",
    saverCaller: "pozivalac (caller-saved)",
    saverCallee: "pozvana funkcija (callee-saved)",
    saverNone: "—",
    savingNote:
      "„Ko čuva“ pokazuje ko je odgovoran da sačuva vrednost registra preko " +
      "poziva funkcije — pozivalac je mora sačuvati pre poziva ako joj je i " +
      "posle potrebna, pozvana funkcija je mora vratiti neizmenjenu ako je koristi.",
    fpNote:
      "fp je alternativni naziv za s0 (x8) — pokazivač na okvir trenutnog " +
      "poziva funkcije. Alatka prihvata oba imena.",
    roleByAbi: {
      zero: "Uvek nula — upisi u nju se odbacuju.",
      ra: "Adresa povratka iz poziva funkcije.",
      sp: "Pokazivač steka.",
      gp: "Globalni pokazivač (global pointer).",
      tp: "Pokazivač niti (thread pointer).",
      t0: "Privremeni registar.",
      t1: "Privremeni registar.",
      t2: "Privremeni registar.",
      s0: "Sačuvani registar — najčešće i okvir steka (frame pointer).",
      s1: "Sačuvani registar.",
      a0: "Argument funkcije / povratna vrednost.",
      a1: "Argument funkcije / povratna vrednost.",
      a2: "Argument funkcije.",
      a3: "Argument funkcije.",
      a4: "Argument funkcije.",
      a5: "Argument funkcije.",
      a6: "Argument funkcije.",
      a7: "Argument funkcije.",
      s2: "Sačuvani registar.",
      s3: "Sačuvani registar.",
      s4: "Sačuvani registar.",
      s5: "Sačuvani registar.",
      s6: "Sačuvani registar.",
      s7: "Sačuvani registar.",
      s8: "Sačuvani registar.",
      s9: "Sačuvani registar.",
      s10: "Sačuvani registar.",
      s11: "Sačuvani registar.",
      t3: "Privremeni registar.",
      t4: "Privremeni registar.",
      t5: "Privremeni registar.",
      t6: "Privremeni registar.",
    },
  },

  decoded: {
    hexLabel: "Heksadecimalno",
    binaryLabel: "Binarno",
    asmLabel: "Instrukcija",
    pseudoLabel: "Pseudo-instrukcija",
    expansionLabel: "Ekvivalentna instrukcija (32-bitna)",
    mnemonicLabel: "Mnemonik",
    extensionRowLabel: "Proširenje",
    formatRowLabel: "Format",
    immediateLabel: "Neposredna vrednost",
    offsetLabel: "Pomeraj (offset)",
    fieldsTitle: "Raspored polja",
    fieldColumn: "Polje",
    bitsColumn: "Bitovi",
    binaryColumn: "Binarno",
    meaningColumn: "Značenje",
    compressedFormat: "sažeti oblik (C)",
    compressedExtension: "C",
    formatNames: {
      R: "R",
      I: "I",
      S: "S",
      B: "B",
      U: "U",
      J: "J",
      shift: "I (pomeraj)",
      atomic: "atomska (A)",
      csr: "CSR",
      fence: "fence",
      system: "sistemska",
    },
  },

  errors: {
    unknown: "Alatka ne ume da protumači ovaj zapis.",
    /**
     * The interpolated refusals. Every `{name}` is filled by `fill()` from
     * `strings.ts` — the table holds DATA, never a function: the live table is a
     * `structuredClone` of this one, and a function leaf throws `DataCloneError`
     * at import. See `LocaleShape`.
     */
    line: "Linija {n}: {inner}",

    wordIsCompressed:
      "Poslednja dva bita nisu 11 — ovo je 16-bitna sažeta (C) instrukcija, ne " +
      "32-bitna reč.",
    halfwordIsWord:
      "Poslednja dva bita su 11 — ovo je 32-bitna instrukcija, ne sažeta (C) " +
      "instrukcija.",
    lrNeedsZeroRs2: "lr zahteva da polje rs2 bude nula.",
    nothingToAssemble: "Nema šta da se sastavi — upiši bar jednu instrukciju.",
    atomicAddressForm: "Adresni operand atomske instrukcije piše se kao (registar).",
    atomicNoOffset:
      "Atomska instrukcija nema pomeraj — piši (registar), a ne pomeraj(registar).",
    csrImmediateRange:
      "Neposredni CSR oblici uzimaju samo 5-bitnu vrednost bez znaka (0–31).",
    fenceOperand: "Operand fence instrukcije je podskup slova i, o, r, w — ili 0.",
    liNeedsTwoOperands: "li zahteva odredišni registar i vrednost.",
    liTooWide32: "Ova vrednost ne staje u 32 bita.",
    liTooWide64: "Ova vrednost ne staje u 64 bita.",

    operandWord: { one: "operand", few: "operanda", many: "operanada" },

    noOpcodeMatch: "Nijedna instrukcija nema opcode {opcode} sa funct3 {funct3}.",
    unknownMnemonic: "Alatka ne poznaje instrukciju „{mnemonic}“.",
    unknownCompressedMnemonic: "Alatka ne poznaje sažetu (C) instrukciju „{mnemonic}“.",
    notAtomicOrdering:
      "Samo atomske instrukcije imaju sufiks poretka (.aq/.rl) — „{mnemonic}“ nije atomska.",
    operandCount: "„{mnemonic}“ zahteva {expected} {noun}, a upisano je {got}.",
    pseudoOperandCount: "„{mnemonic}“ ne prihvata {got} {noun}.",
    compressedRegisterMismatch: "„{mnemonic}“ se ne može zapisati sa ovim registrima.",
    notARegisterField: "„{text}“ nije registar (polje {role}).",
    notARegister: "„{text}“ nije registar.",
    notNarrowRegister:
      "„{text}“ mora biti jedan od x8…x15 — jedini registri koje sažeti oblik može da imenuje.",
    looksLikeLabel:
      "„{text}“ izgleda kao oznaka (label) — alatka nema tabelu simbola; upiši brojčani pomeraj.",
    notANumber: "„{text}“ nije broj.",
    outOfRange: "{value} je van opsega {format} formata ({min}…{max}).",
    mustBeEven: "{value} mora biti paran broj — najniži bit ovog pomeraja se ne upisuje.",
    shiftRange: "Pomeraj ovde mora biti 0…{max}, a upisano je „{text}“.",
    notOffsetRegister: "„{text}“ nije oblika pomeraj(registar).",
    notOffsetSp: "„{text}“ nije oblika pomeraj(sp).",
    notCsr: "„{text}“ nije ime CSR registra ni 12-bitna adresa.",
    reservedMustNotBeZero: "Rezervisano kodiranje: polje {field} ne sme biti nula ({mnemonic}).",
    reservedMustNotBeZeroBare: "Rezervisano kodiranje: polje {field} ne sme biti nula.",
    reservedShiftNeedsRv64:
      "Rezervisano kodiranje: pomeraj od {amount} zahteva RV64 ({mnemonic}).",
    noQuadrantMatch:
      "Nijedna sažeta (C) instrukcija nema kvadrant {quadrant} sa funct3 {funct3}.",
  },
} as const;
