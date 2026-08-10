import {
  extractImmediate,
  REGISTER_ABI_NAMES,
  REGISTER_ROLES,
} from "@nexus/core/devtools/riscv";
import {
  assemble,
  decodeInstruction,
  parseImmediateText,
  type AssembledLine,
  type RiscvDecoded,
  type RiscvField,
  type Xlen,
} from "@nexus/core/devtools/riscvAssemble";
import {
  assembleCompressed,
  decodeCompressed,
  type CompressedDecoded,
} from "@nexus/core/devtools/riscvCompressed";
import { Button } from "@nexus/ui";
import { useMemo, useState, type ComponentType } from "react";

import { countUnit, fill, strings, type Strings } from "../strings.js";
import {
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „RISC-V" — the 1 surface of this group of the developer drawer.
 *
 * One file per category rather than one map for all forty-eight, because the
 * map is the seam every surface is added at: a single file would be the one
 * place every future tool has to touch, and the place two people writing two
 * unrelated tools collide. `devToolSurfaces.tsx` composes the nine.
 *
 * Every id below is declared in `DEVTOOLS_TOOLS` (`shared/modules.ts`) and
 * `modules.test.ts` pins the two lists against each other in both directions —
 * a surface with no declaration is unreachable, and a declaration with no
 * surface is a row the drawer would offer and then fail to open.
 *
 * The tools this file owes:
 *   - `riscv`
 *
 * **One surface, three views, because it is one person's problem.** Whoever is
 * staring at a hex dump wondering what it says is the same person who, five
 * minutes later, wants to know what `beq a0, a1, -8` encodes to, and both of
 * them eventually reach for „which register is `a2` again, and who has to save
 * it". `@nexus/core/devtools/{riscv,riscvAssemble,riscvCompressed}` already
 * read as one module for exactly this reason — see their headers — so the
 * surface stays one tool with a mode switch rather than three.
 *
 * **Assembling and disassembling share one renderer.** Both directions end at
 * the same place: a `RiscvDecoded` or `CompressedDecoded` with a word, an
 * assembly spelling and a field list. `toWordView` normalises either into one
 * `WordView`, and `WordBreakdown` is the one place that draws it — the field
 * table, the bit grid, the hex and binary spellings. Assembling then decodes
 * what it just built rather than deriving a second field breakdown by hand,
 * which is the same „one table, both directions" discipline `riscv.ts` itself
 * documents, carried one layer up into the surface.
 */

type Mode = "assemble" | "disassemble" | "registers";
type RiscvStrings = Strings["devtools"]["riscv"];
type DecodedStrings = RiscvStrings["decoded"];
type RegistersStrings = RiscvStrings["registers"];
type RiscvErrors = RiscvStrings["errors"];

// — Reading a refusal —

/**
 * Every `fail(...)` reason the three core riscv modules can produce, read off
 * their source rather than guessed at — see the header of `devtools.riscv.ts`.
 * None of them carries a discrete error CODE, only English prose with data
 * embedded in it, so this matches the raw text against that closed set of
 * shapes and hands the DATA (a mnemonic, a range, a bit count — never the
 * English words) to the matching Serbian template in `errors`.
 *
 * Deliberately never called from inside a `useMemo`: the memoised value is the
 * RAW reason, and this runs at render time so a language switch would relabel
 * it instead of freezing it behind a stale memo.
 */
function translateReason(reason: string, errors: RiscvErrors): string {
  const lineMatch = /^line (\d+): ([\s\S]+)$/.exec(reason);
  if (lineMatch !== null) {
    return fill(errors.line, {
      n: Number(lineMatch[1] ?? "0"),
      inner: translateReason(lineMatch[2] ?? "", errors),
    });
  }
  const fixed = fixedReason(reason, errors);
  if (fixed !== null) return fixed;
  for (const rule of REASON_RULES) {
    const match = rule.pattern.exec(reason);
    if (match !== null) return rule.render(match, errors);
  }
  return errors.unknown;
}

/** The reasons that carry no interpolated data at all — matched by exact text. */
function fixedReason(reason: string, e: RiscvErrors): string | null {
  switch (reason) {
    case "the low two bits are not 11, so this is a compressed 16-bit instruction":
      return e.wordIsCompressed;
    case "the low two bits are 11, so this is a 32-bit instruction":
      return e.halfwordIsWord;
    case "lr requires rs2 to be zero":
      return e.lrNeedsZeroRs2;
    case "nothing to assemble":
      return e.nothingToAssemble;
    case "an atomic's address operand is written (register)":
      return e.atomicAddressForm;
    case "an atomic has no offset — write (register), not offset(register)":
      return e.atomicNoOffset;
    case "the immediate CSR forms take a 5-bit unsigned value":
      return e.csrImmediateRange;
    case "a fence operand is a subset of the letters iorw, or 0":
      return e.fenceOperand;
    case "li takes a destination and a value":
      return e.liNeedsTwoOperands;
    case "that value does not fit in 32 bits":
      return e.liTooWide32;
    case "that value does not fit in 64 bits":
      return e.liTooWide64;
    default:
      return null;
  }
}

/** A Serbian noun for a captured operand count, in the grammatical form it needs. */
function operandNoun(countText: string, e: RiscvErrors): string {
  return countUnit(Number(countText), e.operandWord.one, e.operandWord.few, e.operandWord.many);
}

interface ReasonRule {
  readonly pattern: RegExp;
  readonly render: (match: RegExpExecArray, errors: RiscvErrors) => string;
}

const REASON_RULES: readonly ReasonRule[] = [
  {
    pattern: /^no instruction has opcode (0x[0-9a-f]+) with funct3 (\d+)$/,
    render: (m, e) => fill(e.noOpcodeMatch, { opcode: m[1] ?? "", funct3: m[2] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not an instruction this tool knows$/,
    render: (m, e) => fill(e.unknownMnemonic, { mnemonic: m[1] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not a compressed instruction this tool knows$/,
    render: (m, e) => fill(e.unknownCompressedMnemonic, { mnemonic: m[1] ?? "" }),
  },
  {
    pattern: /^only the atomics take an ordering suffix, and "(.*)" is not one$/,
    render: (m, e) => fill(e.notAtomicOrdering, { mnemonic: m[1] ?? "" }),
  },
  {
    pattern: /^(\S+) takes (\d+) operands?, not (\d+)$/,
    render: (m, e) => {
      const expected = m[2] ?? "0";
      return fill(e.operandCount, {
        mnemonic: m[1] ?? "",
        expected,
        noun: operandNoun(expected, e),
        got: m[3] ?? "0",
      });
    },
  },
  {
    pattern: /^(\S+) does not take (\d+) operands?$/,
    render: (m, e) => {
      const got = m[2] ?? "0";
      return fill(e.pseudoOperandCount, {
        mnemonic: m[1] ?? "",
        got,
        noun: operandNoun(got, e),
      });
    },
  },
  {
    pattern: /^(\S+) cannot be written with these registers$/,
    render: (m, e) => fill(e.compressedRegisterMismatch, { mnemonic: m[1] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not a register \((.*)\)$/,
    render: (m, e) => fill(e.notARegisterField, { text: m[1] ?? "", role: m[2] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not a register$/,
    render: (m, e) => fill(e.notARegister, { text: m[1] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not one of x8…x15$/,
    render: (m, e) => fill(e.notNarrowRegister, { text: m[1] ?? "" }),
  },
  {
    pattern:
      /^"(.*)" looks like a label, and this tool has no symbol table — give a numeric offset$/,
    render: (m, e) => fill(e.looksLikeLabel, { text: m[1] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not a number$/,
    render: (m, e) => fill(e.notANumber, { text: m[1] ?? "" }),
  },
  {
    pattern: /^(-?\d+) is outside the (I|S|B|U|J)-format range (-?\d+)…(-?\d+)$/,
    render: (m, e) =>
      fill(e.outOfRange, {
        value: m[1] ?? "",
        format: m[2] ?? "",
        min: m[3] ?? "",
        max: m[4] ?? "",
      }),
  },
  {
    pattern: /^(-?\d+) must be even — the low bit of this offset is not stored$/,
    render: (m, e) => fill(e.mustBeEven, { value: m[1] ?? "" }),
  },
  {
    pattern: /^a shift amount here is 0…(\d+), not "(.*)"$/,
    render: (m, e) => fill(e.shiftRange, { max: m[1] ?? "", text: m[2] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not an offset\(register\) operand$/,
    render: (m, e) => fill(e.notOffsetRegister, { text: m[1] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not an offset\(sp\) operand$/,
    render: (m, e) => fill(e.notOffsetSp, { text: m[1] ?? "" }),
  },
  {
    pattern: /^"(.*)" is not a CSR name or a 12-bit address$/,
    render: (m, e) => fill(e.notCsr, { text: m[1] ?? "" }),
  },
  {
    pattern: /^reserved encoding: (.+) must not be zero in this encoding \((.+)\)$/,
    render: (m, e) => fill(e.reservedMustNotBeZero, { field: m[1] ?? "", mnemonic: m[2] ?? "" }),
  },
  {
    pattern: /^reserved encoding: (.+) must not be zero in this encoding$/,
    render: (m, e) => fill(e.reservedMustNotBeZeroBare, { field: m[1] ?? "" }),
  },
  {
    pattern: /^reserved encoding: a shift amount of (\d+) needs RV64 \((.+)\)$/,
    render: (m, e) => fill(e.reservedShiftNeedsRv64, { amount: m[1] ?? "", mnemonic: m[2] ?? "" }),
  },
  {
    pattern: /^no compressed instruction has quadrant (\d+) with funct3 (\d+)$/,
    render: (m, e) => fill(e.noQuadrantMatch, { quadrant: m[1] ?? "", funct3: m[2] ?? "" }),
  },
];

// — One decoded word, either direction —

interface WordView {
  readonly word: number;
  readonly bits: 16 | 32;
  readonly asm: string;
  /** „Pseudo-instrukcija" for a base word, „Ekvivalentna instrukcija" for a compressed one. */
  readonly secondaryLabel: string;
  readonly secondaryValue: string | null;
  readonly mnemonic: string;
  readonly extension: string;
  readonly format: string;
  readonly immediate: { readonly label: string; readonly value: string } | null;
  readonly fields: readonly RiscvField[];
}

function formatHex(word: number, bits: 16 | 32): string {
  return `0x${(word >>> 0).toString(16).padStart(bits / 4, "0")}`;
}

function formatBinary(word: number, bits: 16 | 32): string {
  return `0b${(word >>> 0).toString(2).padStart(bits, "0")}`;
}

/** The scattered immediate a B/I/J/S/U word carries, read through the one exported extractor. */
function immediateRow(
  d: RiscvDecoded,
  ds: DecodedStrings,
): { readonly label: string; readonly value: string } | null {
  const format = d.instruction.format;
  if (format === "B" || format === "J") {
    if (d.branchOffset === null) return null;
    return { label: ds.offsetLabel, value: String(d.branchOffset) };
  }
  if (format === "U") {
    return { label: ds.immediateLabel, value: `0x${extractImmediate(d.word, "U").toString(16)}` };
  }
  if (format === "I" || format === "S") {
    return { label: ds.immediateLabel, value: String(extractImmediate(d.word, format)) };
  }
  return null;
}

function baseWordView(d: RiscvDecoded, ds: DecodedStrings): WordView {
  return {
    word: d.word,
    bits: 32,
    asm: d.asm,
    secondaryLabel: ds.pseudoLabel,
    secondaryValue: d.pseudo,
    mnemonic: d.instruction.mnemonic,
    extension: d.instruction.extension,
    format: ds.formatNames[d.instruction.format] ?? d.instruction.format,
    immediate: immediateRow(d, ds),
    fields: d.fields,
  };
}

function compressedWordView(d: CompressedDecoded, ds: DecodedStrings): WordView {
  return {
    word: d.halfword,
    bits: 16,
    asm: d.asm,
    secondaryLabel: ds.expansionLabel,
    secondaryValue: d.expansion,
    mnemonic: d.mnemonic,
    extension: ds.compressedExtension,
    format: ds.compressedFormat,
    immediate: null,
    fields: d.fields,
  };
}

/** Every bit of a field's own value, padded to its own width — independent of `field.text`. */
function fieldBinary(field: RiscvField): string {
  const width = field.high - field.low + 1;
  return `0b${field.value.toString(2).padStart(width, "0")}`;
}

function FieldTable({ fields, s }: { fields: readonly RiscvField[]; s: DecodedStrings }) {
  return (
    <ToolSection title={s.fieldsTitle}>
      <ToolTable
        head={[s.fieldColumn, s.bitsColumn, s.binaryColumn, s.meaningColumn]}
        prose={[3]}
        rows={fields.map((field) => [
          field.name,
          field.high === field.low ? String(field.high) : `${field.high}:${field.low}`,
          fieldBinary(field),
          field.text,
        ])}
      />
    </ToolSection>
  );
}

/**
 * A word, drawn as bits — the drawer's one grid, shared with the integer
 * inspector and the bitwise calculator (see `.tool__bits` in `tools.css`).
 * Grouped into nibbles because the CSS groups by markup, not by counting.
 */
function BitGrid({ word, bits }: { word: number; bits: 16 | 32 }) {
  const groups: number[][] = [];
  for (let high = bits - 1; high >= 0; high -= 4) {
    const group: number[] = [];
    for (let bit = high; bit > high - 4 && bit >= 0; bit -= 1) group.push(bit);
    groups.push(group);
  }
  return (
    <div className="tool__bits">
      {groups.map((group, groupIndex) => (
        // Positional groups have no id of their own — nibble 3 of a word IS
        // nibble 3, same reasoning `ToolTable` gives its own row key.
        <div key={groupIndex} className="tool__bits-group">
          {group.map((bit) => {
            const value = (word >>> bit) & 1;
            return (
              <span key={bit} className={`tool__bit${value === 1 ? " tool__bit--set" : ""}`}>
                {value}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WordBreakdown({ view, s }: { view: WordView; s: DecodedStrings }) {
  return (
    <>
      <ToolOutput label={s.hexLabel} value={formatHex(view.word, view.bits)} />
      <div className="tool__results">
        <ResultRow label={s.binaryLabel} value={formatBinary(view.word, view.bits)} />
        <ResultRow label={s.asmLabel} value={view.asm} />
        {view.secondaryValue !== null ? (
          <ResultRow label={view.secondaryLabel} value={view.secondaryValue} />
        ) : null}
        <ResultRow label={s.mnemonicLabel} value={view.mnemonic} />
        <ResultRow label={s.extensionRowLabel} value={view.extension} />
        <ResultRow label={s.formatRowLabel} value={view.format} />
        {view.immediate !== null ? (
          <ResultRow label={view.immediate.label} value={view.immediate.value} />
        ) : null}
      </div>
      <BitGrid word={view.word} bits={view.bits} />
      <FieldTable fields={view.fields} s={s} />
    </>
  );
}

// — Assemble —

interface AssembledWord {
  readonly key: string;
  readonly title: string;
  readonly compressed: boolean;
  readonly word: number;
}

type AssembleOutcome =
  | { readonly ok: true; readonly words: readonly AssembledWord[] }
  | { readonly ok: false; readonly reason: string };

/** Blank, or nothing but a `#`/`;`/`//` comment — mirrors `parseLine`'s own rule. */
function isBlankOrComment(rawLine: string): boolean {
  return (rawLine.split(/[#;]|\/\//, 1)[0] ?? "").trim() === "";
}

function firstToken(rawLine: string): string {
  return (rawLine.split(/[#;]|\/\//, 1)[0] ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Every compressed mnemonic is spelled `c.xxx` — the ISA's own naming, not a guess. */
function isCompressedLine(rawLine: string): boolean {
  return firstToken(rawLine).toLowerCase().startsWith("c.");
}

function stripLinePrefix(reason: string): string {
  return /^line \d+: ([\s\S]+)$/.exec(reason)?.[1] ?? reason;
}

function pushWords(out: AssembledWord[], keyPrefix: string, line: AssembledLine): void {
  line.words.forEach((word, wordIndex) => {
    const title =
      line.words.length > 1
        ? `${line.source} → ${line.expandedFrom ?? ""} (${wordIndex + 1}/${line.words.length})`
        : line.source;
    out.push({ key: `${keyPrefix}-${wordIndex}`, title, compressed: false, word });
  });
}

/**
 * Assembles one or more lines, mixing base and compressed instructions.
 *
 * `assemble()` knows only the base table and `assembleCompressed()` takes one
 * line at a time — neither reads a source that mixes both, because nothing in
 * `@nexus/core/devtools/riscv*` needs to (see the report). When the source has
 * no `c.…` line at all this calls straight through to `assemble()` and keeps
 * its own line numbering; only a mix walks the lines by hand, routing each one
 * by its mnemonic's `c.` prefix — the ISA's own rule, not a parse this surface
 * invents — and re-stating the resulting reason in `assemble()`'s own
 * `line N: reason` shape so `translateReason` reads either path alike.
 */
function runAssemble(source: string, xlen: Xlen): AssembleOutcome {
  const rawLines = source.split(/\r?\n/);
  const mixed = rawLines.some((line) => isCompressedLine(line));

  if (!mixed) {
    const result = assemble(source, xlen);
    if (!result.ok) return { ok: false, reason: result.reason };
    const words: AssembledWord[] = [];
    result.value.forEach((line, index) => pushWords(words, String(index), line));
    return { ok: true, words };
  }

  const words: AssembledWord[] = [];
  for (const [index, raw] of rawLines.entries()) {
    if (isBlankOrComment(raw)) continue;
    const lineNumber = index + 1;
    if (isCompressedLine(raw)) {
      const result = assembleCompressed(raw, xlen);
      if (!result.ok) return { ok: false, reason: `line ${lineNumber}: ${result.reason}` };
      words.push({ key: `c${index}`, title: raw.trim(), compressed: true, word: result.value });
      continue;
    }
    const result = assemble(raw, xlen);
    if (!result.ok) {
      return { ok: false, reason: `line ${lineNumber}: ${stripLinePrefix(result.reason)}` };
    }
    result.value.forEach((line) => pushWords(words, String(index), line));
  }
  return { ok: true, words };
}

function toWordView(entry: AssembledWord, xlen: Xlen, ds: DecodedStrings): WordView | null {
  if (entry.compressed) {
    const decoded = decodeCompressed(entry.word, xlen);
    return decoded.ok ? compressedWordView(decoded.value, ds) : null;
  }
  const decoded = decodeInstruction(entry.word, xlen);
  return decoded.ok ? baseWordView(decoded.value, ds) : null;
}

function AssembleTool({ xlen }: { xlen: Xlen }) {
  // Read inside the component, never at module scope — see shared.tsx's header.
  const s = strings.devtools.riscv;
  const [source, setSource] = useState("");

  // The memo holds the RAW outcome only; translation happens at render time
  // below (`translateReason`), so a language switch relabels it instead of
  // freezing today's Serbian behind a stale dependency array.
  const outcome = useMemo(
    () => (source.trim() === "" ? null : runAssemble(source, xlen)),
    [source, xlen],
  );

  return (
    <>
      <ToolTextArea
        label={s.assemble.sourceLabel}
        value={source}
        onChange={setSource}
        hint={s.assemble.sourceHint}
      />
      {outcome === null ? (
        <ToolOutput
          label={s.decoded.hexLabel}
          value=""
          empty={strings.devtools.common.awaitingInput}
        />
      ) : !outcome.ok ? (
        <ToolFailure>{translateReason(outcome.reason, s.errors)}</ToolFailure>
      ) : (
        outcome.words.map((entry) => {
          const view = toWordView(entry, xlen, s.decoded);
          return (
            <ToolSection key={entry.key} title={entry.title}>
              {view === null ? (
                <ToolOutput
                  label={s.decoded.hexLabel}
                  value={formatHex(entry.word, entry.compressed ? 16 : 32)}
                />
              ) : (
                <WordBreakdown view={view} s={s.decoded} />
              )}
            </ToolSection>
          );
        })
      )}
    </>
  );
}

// — Disassemble —

function DisassembleTool({ xlen }: { xlen: Xlen }) {
  const s = strings.devtools.riscv;
  const [text, setText] = useState("");
  const trimmed = text.trim();

  // `parseImmediateText` (riscvAssemble.ts) already reads decimal/0x/0b/0o with
  // an optional sign into a safe integer — exactly what a typed word needs and
  // nothing this surface has to parse itself.
  const parsed = useMemo(() => (trimmed === "" ? null : parseImmediateText(trimmed)), [trimmed]);
  const invalidFormat = trimmed !== "" && parsed === null;

  // A compressed halfword's low two bits are never 11 — the ISA's own length
  // marker, not a guess this surface makes — so that one test picks the decoder
  // AND the width the word is allowed to have.
  //
  // The width test is the point. `parseImmediateText` returns any safe integer,
  // and both decoders quietly narrow what they are given (`>>> 0` here,
  // `& 0xffff` inside `decodeCompressed`), so `0x100000000` used to be
  // disassembled as the word `0` — confidently, with nothing on screen saying
  // the input had been cut. This drawer refuses instead of repairing.
  const word = useMemo(() => {
    if (parsed === null) return null;
    const compressed = ((parsed >>> 0) & 0b11) !== 0b11;
    const min = compressed ? -0x8000 : -0x8000_0000;
    const max = compressed ? 0xffff : 0xffff_ffff;
    if (parsed < min || parsed > max) return null;
    return { value: compressed ? (parsed >>> 0) & 0xffff : parsed >>> 0, compressed };
  }, [parsed]);
  const tooWide = parsed !== null && word === null;

  const decoded = useMemo(
    () =>
      word === null
        ? null
        : word.compressed
          ? { compressed: true as const, result: decodeCompressed(word.value, xlen) }
          : { compressed: false as const, result: decodeInstruction(word.value, xlen) },
    [word, xlen],
  );

  return (
    <>
      <ToolInput
        label={s.disassemble.wordLabel}
        value={text}
        onChange={setText}
        hint={s.disassemble.wordHint}
        error={
          invalidFormat
            ? s.disassemble.invalid
            : tooWide
              ? s.disassemble.tooWide
              : undefined
        }
        mono
      />
      {trimmed === "" ? (
        <ToolOutput
          label={s.decoded.hexLabel}
          value=""
          empty={strings.devtools.common.awaitingInput}
        />
      ) : decoded === null ? null : !decoded.result.ok ? (
        <ToolFailure>{translateReason(decoded.result.reason, s.errors)}</ToolFailure>
      ) : (
        <WordBreakdown
          view={
            decoded.compressed
              ? compressedWordView(decoded.result.value, s.decoded)
              : baseWordView(decoded.result.value, s.decoded)
          }
          s={s.decoded}
        />
      )}
    </>
  );
}

// — Registers —

/** Keyed by ABI name, not by index — `REGISTER_ROLES` is its own array, not a parallel one. */
const SAVER_BY_ABI = new Map(REGISTER_ROLES.map((role) => [role.abi, role.saver] as const));

function saverLabel(saver: "—" | "caller" | "callee", rs: RegistersStrings): string {
  if (saver === "caller") return rs.saverCaller;
  if (saver === "callee") return rs.saverCallee;
  return rs.saverNone;
}

function RegistersSection() {
  const s = strings.devtools.riscv;
  return (
    <>
      <ToolTable
        head={[
          s.registers.columnRegister,
          s.registers.columnAbi,
          s.registers.columnRole,
          s.registers.columnSaver,
        ]}
        prose={[2, 3]}
        rows={REGISTER_ABI_NAMES.map((abi, index) => [
          `x${index}`,
          abi,
          s.registers.roleByAbi[abi] ?? abi,
          saverLabel(SAVER_BY_ABI.get(abi) ?? "—", s.registers),
        ])}
      />
      <p className="tool__note">{s.registers.savingNote}</p>
      <p className="tool__note">{s.registers.fpNote}</p>
    </>
  );
}

// — The surface —

interface ModeSwitchProps {
  readonly mode: Mode;
  readonly onChange: (mode: Mode) => void;
  readonly s: RiscvStrings;
}

function ModeSwitch({ mode, onChange, s }: ModeSwitchProps) {
  const options: readonly { readonly id: Mode; readonly label: string }[] = [
    { id: "assemble", label: s.modeAssemble },
    { id: "disassemble", label: s.modeDisassemble },
    { id: "registers", label: s.modeRegisters },
  ];
  return (
    <div className="tool__actions" role="group" aria-label={s.modeGroupLabel}>
      {options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={mode === option.id ? "primary" : "ghost"}
          aria-pressed={mode === option.id}
          onClick={() => {
            onChange(option.id);
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

interface XlenSwitchProps {
  readonly xlen: Xlen;
  readonly onChange: (xlen: Xlen) => void;
  readonly s: RiscvStrings;
}

function XlenSwitch({ xlen, onChange, s }: XlenSwitchProps) {
  const options: readonly { readonly id: Xlen; readonly label: string }[] = [
    { id: 32, label: s.xlen32 },
    { id: 64, label: s.xlen64 },
  ];
  return (
    <div className="tool__actions" role="group" aria-label={s.xlenGroupLabel}>
      {options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={xlen === option.id ? "primary" : "ghost"}
          aria-pressed={xlen === option.id}
          onClick={() => {
            onChange(option.id);
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function RiscvTool() {
  const s = strings.devtools.riscv;
  const [mode, setMode] = useState<Mode>("assemble");
  const [xlen, setXlen] = useState<Xlen>(64);

  return (
    <>
      <ModeSwitch mode={mode} onChange={setMode} s={s} />
      {mode === "registers" ? null : <XlenSwitch xlen={xlen} onChange={setXlen} s={s} />}
      {mode === "assemble" ? (
        <AssembleTool xlen={xlen} />
      ) : mode === "disassemble" ? (
        <DisassembleTool xlen={xlen} />
      ) : (
        <RegistersSection />
      )}
    </>
  );
}

export const RISCV_SURFACES: Readonly<Record<string, ComponentType>> = {
  riscv: RiscvTool,
};
