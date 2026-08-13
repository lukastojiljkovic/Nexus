import { parseToolNumber, type DataConvention } from "@nexus/core";
import {
  BASE_INPUT_MAX_LENGTH,
  BASE_MAX,
  BASE_MIN,
  BASE_PRESETS,
  BITWISE_OPS,
  DATA_UNITS,
  INT_WIDTHS,
  bestDataUnit,
  bitwiseBinary,
  bitwiseNot,
  byteOrder,
  convertData,
  dataLadder,
  describeBits,
  formatBytes,
  formatIntegerInBase,
  groupDigits,
  inspectInteger,
  parseIntegerInBase,
  shiftBits,
  smallestIntegerType,
  type BitsView,
  type BitwiseOpId,
  type IntWidth,
} from "@nexus/core/devtools/numbers";
import {
  FLOAT_FORMATS,
  FLOAT_FORMAT_IDS,
  decodeFloat,
  exactDecimal,
  type DecodedFloat,
  type FloatFormatId,
  type FloatInput,
  type RoundingMode,
} from "@nexus/core/devtools/floatFormats";
import {
  convertAcross,
  formatBitPattern,
  localizeDecimal,
  parseBitPattern,
  parseFloatValue,
} from "@nexus/core/devtools/floatInput";
import {
  MX_BLOCK_SIZE,
  MX_EXTENDED_ELEMENTS,
  MX_SPEC_ELEMENTS,
  decodeMxBlock,
  encodeMxBlock,
  isSpecElement,
  mxBitsPerValue,
  mxBlockBitSize,
  type MxElementFormatId,
} from "@nexus/core/devtools/microscaling";
import { Button, Checkbox } from "@nexus/ui";
import { useState, type ComponentType } from "react";

import { lookup, strings } from "../strings.js";
import { formatToolNumber } from "../toolFormat.js";
import {
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Brojevi i bitovi" — the 6 surfaces of this group of the developer drawer.
 *
 * One file per category rather than one map for all forty-eight, because the
 * map is the seam every surface is added at: a single file would be the one
 * place every future tool has to touch, and the place two people writing two
 * unrelated tools collide. `proToolSurfaces.tsx` composes the nine.
 *
 * Every id below is declared in `DEVTOOLS_TOOLS` (`shared/modules.ts`) and
 * `modules.test.ts` pins the two lists against each other in both directions —
 * a surface with no declaration is unreachable, and a declaration with no
 * surface is a row the drawer would offer and then fail to open.
 *
 * **All the arithmetic lives in `@nexus/core/devtools/*`.** This file only
 * parses a keystroke into the shape a core function wants, and draws what it
 * returns — nothing here rounds, encodes or converts on its own.
 */

/**
 * A word, drawn as bits — `.tool__bits` > `.tool__bits-group` > `.tool__bit`.
 * Shared by the three tools that show one: the integer inspector, the bitwise
 * calculator and the float formats' sign/exponent/mantissa split. `groups` is
 * split by the CALLER — `groupDigits` for a uniform nibble, `formatBitPattern`
 * for a format's own field widths — so this component decides nothing about
 * where the seams fall, only how a bit reads once they are given.
 */
function BitGrid({ groups }: { groups: readonly string[] }) {
  return (
    <div className="tool__bits">
      {groups
        .filter((group) => group.length > 0)
        .map((group, groupIndex) => (
          <div className="tool__bits-group" key={groupIndex}>
            {[...group].map((bit, bitIndex) => (
              <span key={bitIndex} className={`tool__bit${bit === "1" ? " tool__bit--set" : ""}`}>
                {bit}
              </span>
            ))}
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// number-base
// ---------------------------------------------------------------------------

const BASE_OPTIONS: readonly { id: string; label: string }[] = Array.from(
  { length: BASE_MAX - BASE_MIN + 1 },
  (_, index) => {
    const base = BASE_MIN + index;
    return { id: String(base), label: String(base) };
  },
);

function NumberBaseTool() {
  const s = strings.devtools.numbers["number-base"];
  const [text, setText] = useState("");
  const [fromBase, setFromBase] = useState("10");
  const [toBase, setToBase] = useState("16");
  const [group, setGroup] = useState(true);
  const [uppercase, setUppercase] = useState(true);

  const trimmed = text.trim();
  const tooLong = trimmed.length > BASE_INPUT_MAX_LENGTH;
  const value = trimmed === "" || tooLong ? null : parseIntegerInBase(trimmed, Number(fromBase));
  const result =
    value === null ? null : formatIntegerInBase(value, Number(toBase), { uppercase, group });

  return (
    <>
      <ToolInput
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
        mono
      />
      <div className="tool__pair">
        <ToolSelect
          label={s.from}
          value={fromBase}
          options={BASE_OPTIONS}
          onChange={setFromBase}
          hint={s.prefixHint}
        />
        <ToolSelect label={s.to} value={toBase} options={BASE_OPTIONS} onChange={setToBase} />
      </div>
      <div className="tool__actions">
        <Checkbox checked={group} onChange={(event) => setGroup(event.target.checked)}>
          {s.group}
        </Checkbox>
        <Checkbox checked={uppercase} onChange={(event) => setUppercase(event.target.checked)}>
          {s.uppercase}
        </Checkbox>
      </div>
      {trimmed === "" ? null : tooLong ? (
        <ToolFailure>{s.tooLong}</ToolFailure>
      ) : value === null ? (
        <ToolFailure>{s.invalid}</ToolFailure>
      ) : (
        <>
          <ToolOutput label={s.result} value={result ?? ""} />
          <ToolSection title={s.others}>
            <ToolTable
              head={[s.baseColumn, s.valueColumn]}
              rows={BASE_PRESETS.map((base) => [
                String(base),
                formatIntegerInBase(value, base, { uppercase, group }),
              ])}
            />
          </ToolSection>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// integer-inspector & bitwise share a width picker and an input-base picker
// ---------------------------------------------------------------------------

const WIDTH_OPTIONS: readonly { id: string; label: string }[] = INT_WIDTHS.map((width) => ({
  id: String(width),
  label: String(width),
}));

const INPUT_BASE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "10", label: "10" },
  { id: "16", label: "16" },
  { id: "2", label: "2" },
];

function widthFromId(widthId: string): IntWidth {
  return INT_WIDTHS.find((candidate) => String(candidate) === widthId) ?? 32;
}

function IntegerInspectorTool() {
  const s = strings.devtools.numbers["integer-inspector"];
  const [text, setText] = useState("");
  const [inputBase, setInputBase] = useState("10");
  const [widthId, setWidthId] = useState("32");

  const width = widthFromId(widthId);
  const trimmed = text.trim();
  const value = trimmed === "" ? null : parseIntegerInBase(trimmed, Number(inputBase));
  const rows = value === null ? null : inspectInteger(value);
  const smallest = value === null ? null : smallestIntegerType(value);
  // `filter` before `find`: TypeScript infers a type predicate from the simple
  // `row.fits` callback, so the row that survives is the fitting variant and
  // `.binary` is reachable without an assertion. The two-step spelling is the
  // point — `find(row => … && row.fits)` returns the union and cannot narrow.
  const widthRow = rows?.filter((row) => row.fits).find((row) => row.type.width === width) ?? null;
  const bytes = value === null ? null : byteOrder(value, width);

  return (
    <>
      <div className="tool__pair">
        <ToolInput
          label={s.value}
          value={text}
          onChange={setText}
          placeholder={s.valuePlaceholder}
          mono
        />
        <ToolSelect
          label={s.inputBase}
          value={inputBase}
          options={INPUT_BASE_OPTIONS}
          onChange={setInputBase}
          hint={s.prefixHint}
        />
      </div>
      {trimmed === "" ? null : rows === null ? (
        <ToolFailure>{s.invalid}</ToolFailure>
      ) : (
        <>
          <ToolTable
            head={[s.type, s.range, s.decimal, s.hex, s.binary]}
            rows={rows.map((row) => [
              row.type.id,
              `${row.type.min.toString(10)} … ${row.type.max.toString(10)}`,
              row.fits ? row.decimal : s.doesNotFit,
              row.fits ? `0x${row.hex}` : "—",
              row.fits ? groupDigits(row.binary, 4) : "—",
            ])}
          />
          <ResultRow label={s.smallest} value={smallest === null ? s.noneFits : smallest.id} />
          <ToolSection title={s.byteOrder}>
            <ToolSelect
              label={s.width}
              value={widthId}
              options={WIDTH_OPTIONS}
              onChange={setWidthId}
            />
            {widthRow === null ? (
              <ToolFailure>{s.noWidthFit}</ToolFailure>
            ) : (
              <BitGrid groups={groupDigits(widthRow.binary, 4).split(" ")} />
            )}
            {bytes !== null && (
              <>
                <ResultRow label={s.bigEndian} value={formatBytes(bytes.bigEndian)} />
                <ResultRow label={s.littleEndian} value={formatBytes(bytes.littleEndian)} />
              </>
            )}
          </ToolSection>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// bitwise
// ---------------------------------------------------------------------------

type BitwiseEvaluation =
  | { readonly status: "empty" }
  | { readonly status: "invalid" }
  | { readonly status: "invalid-amount" }
  | {
      readonly status: "ok";
      readonly a: bigint;
      readonly b: bigint | null;
      readonly result: bigint;
    };

/**
 * Parses A, B (or a shift amount) and dispatches to the right core function.
 * Switches on `opId` itself rather than on a separately looked-up `arity`, so
 * TypeScript narrows `opId` to exactly the union `bitwiseBinary`/`shiftBits`
 * expect — no cast needed at either call.
 */
function evaluateBitwise(
  opId: BitwiseOpId,
  aText: string,
  bText: string,
  amountText: string,
  base: number,
  width: IntWidth,
): BitwiseEvaluation {
  const aTrimmed = aText.trim();
  switch (opId) {
    case "and":
    case "or":
    case "xor":
    case "nand":
    case "nor":
    case "xnor": {
      const bTrimmed = bText.trim();
      if (aTrimmed === "" && bTrimmed === "") return { status: "empty" };
      const a = aTrimmed === "" ? null : parseIntegerInBase(aTrimmed, base);
      const b = bTrimmed === "" ? null : parseIntegerInBase(bTrimmed, base);
      if (a === null || b === null) return { status: "invalid" };
      return { status: "ok", a, b, result: bitwiseBinary(opId, a, b, width) };
    }
    case "not": {
      if (aTrimmed === "") return { status: "empty" };
      const a = parseIntegerInBase(aTrimmed, base);
      if (a === null) return { status: "invalid" };
      return { status: "ok", a, b: null, result: bitwiseNot(a, width) };
    }
    case "shl":
    case "shr":
    case "sar":
    case "rol":
    case "ror": {
      const amountTrimmed = amountText.trim();
      if (aTrimmed === "" && amountTrimmed === "") return { status: "empty" };
      const a = aTrimmed === "" ? null : parseIntegerInBase(aTrimmed, base);
      if (a === null) return { status: "invalid" };
      // The SAME base as the operands. „Osnova unosa" governs everything typed
      // into this tool — a shift amount that was silently decimal while the
      // selector said 16 turned „shift by 0x10" into a shift by 10 with no
      // refusal, and typing the prefix the hint asks for („0x10") refused with
      // „the shift must be a whole number", which was true of neither.
      const amountValue = amountTrimmed === "" ? null : parseIntegerInBase(amountTrimmed, base);
      if (amountValue === null) return { status: "invalid-amount" };
      const shifted = shiftBits(opId, a, Number(amountValue), width);
      if (shifted === null) return { status: "invalid-amount" };
      return { status: "ok", a, b: null, result: shifted };
    }
  }
}

interface BitwiseFieldStrings {
  readonly hex: string;
  readonly unsigned: string;
  readonly signed: string;
  readonly popcount: string;
  readonly leadingZeros: string;
  readonly trailingZeros: string;
  readonly parity: string;
  readonly parityOdd: string;
  readonly parityEven: string;
}

/**
 * One operand or the result, drawn identically — the bit grid plus every
 * fact `describeBits` gives about it.
 */
function BitwiseOperandView({
  label,
  view,
  s,
}: {
  label: string;
  view: BitsView;
  s: BitwiseFieldStrings;
}) {
  return (
    <ToolSection title={label}>
      <BitGrid groups={groupDigits(view.binary, 4).split(" ")} />
      <ResultRow label={s.hex} value={`0x${view.hex}`} />
      <ResultRow label={s.unsigned} value={view.bits.toString(10)} />
      <ResultRow label={s.signed} value={view.signed.toString(10)} />
      <ResultRow label={s.popcount} value={String(view.popcount)} />
      <ResultRow label={s.leadingZeros} value={String(view.leadingZeros)} />
      <ResultRow label={s.trailingZeros} value={String(view.trailingZeros)} />
      <ResultRow label={s.parity} value={view.oddParity ? s.parityOdd : s.parityEven} />
    </ToolSection>
  );
}

function BitwiseTool() {
  const s = strings.devtools.numbers.bitwise;
  const [widthId, setWidthId] = useState("32");
  const [inputBase, setInputBase] = useState("16");
  const [opId, setOpId] = useState<BitwiseOpId>("and");
  const [aText, setAText] = useState("");
  const [bText, setBText] = useState("");
  const [amountText, setAmountText] = useState("");

  const width = widthFromId(widthId);
  const opDef = BITWISE_OPS.find((candidate) => candidate.id === opId);
  const arity = opDef === undefined ? "binary" : opDef.arity;
  const evaluation = evaluateBitwise(opId, aText, bText, amountText, Number(inputBase), width);

  return (
    <>
      <div className="tool__pair">
        <ToolSelect label={s.width} value={widthId} options={WIDTH_OPTIONS} onChange={setWidthId} />
        <ToolSelect
          label={s.operandBase}
          value={inputBase}
          options={INPUT_BASE_OPTIONS}
          onChange={setInputBase}
          hint={s.prefixHint}
        />
      </div>
      <ToolSelect
        label={s.operation}
        value={opId}
        options={BITWISE_OPS.map((op) => ({ id: op.id, label: s.ops[op.id] }))}
        onChange={setOpId}
      />
      <div className="tool__pair">
        <ToolInput label={s.operandA} value={aText} onChange={setAText} mono />
        {arity === "binary" && (
          <ToolInput label={s.operandB} value={bText} onChange={setBText} mono />
        )}
        {arity === "shift" && (
          <ToolInput label={s.amount} value={amountText} onChange={setAmountText} mono />
        )}
      </div>
      {evaluation.status === "empty" ? null : evaluation.status === "invalid" ? (
        <ToolFailure>{s.invalid}</ToolFailure>
      ) : evaluation.status === "invalid-amount" ? (
        <ToolFailure>{s.invalidAmount}</ToolFailure>
      ) : (
        <>
          <BitwiseOperandView label={s.operandA} view={describeBits(evaluation.a, width)} s={s} />
          {evaluation.b !== null && (
            <BitwiseOperandView label={s.operandB} view={describeBits(evaluation.b, width)} s={s} />
          )}
          <BitwiseOperandView
            label={s.result}
            view={describeBits(evaluation.result, width)}
            s={s}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// data-unit
// ---------------------------------------------------------------------------

function DataUnitTool() {
  const s = strings.devtools.numbers["data-unit"];
  const unitOptions = DATA_UNITS.map((unit) => ({
    id: unit.id,
    label: lookup(s.units, unit.id) ?? unit.id,
  }));

  const [text, setText] = useState("");
  const [fromId, setFromId] = useState("mb-dec");
  const [toId, setToId] = useState("mib");
  const [convention, setConvention] = useState<DataConvention>("decimal");

  const trimmed = text.trim();
  const value = trimmed === "" ? null : parseToolNumber(trimmed);
  const result = value === null ? null : convertData(value, fromId, toId);
  const ladder = value === null ? null : dataLadder(value, fromId);
  const bytes = value === null ? null : convertData(value, fromId, "byte");
  const best = bytes === null ? null : bestDataUnit(bytes, convention);
  const toLabel = lookup(s.units, toId) ?? toId;

  return (
    <>
      <ToolInput label={s.value} value={text} onChange={setText} placeholder={s.valuePlaceholder} />
      <div className="tool__pair">
        <ToolSelect label={s.from} value={fromId} options={unitOptions} onChange={setFromId} />
        <ToolSelect label={s.to} value={toId} options={unitOptions} onChange={setToId} />
      </div>
      {trimmed === "" ? null : value === null ? (
        <ToolFailure>{s.invalid}</ToolFailure>
      ) : result === null || ladder === null ? (
        <ToolFailure>{s.overflow}</ToolFailure>
      ) : (
        <>
          <p className="tool__figure">
            <span className="tool__figure-value">{formatToolNumber(result)}</span>
            <span className="tool__figure-unit">{toLabel}</span>
          </p>
          <ToolSection title={s.ladder}>
            <ToolTable
              head={[s.unitColumn, s.valueColumn]}
              rows={ladder.map((row) => [
                lookup(s.units, row.unitId) ?? row.unitId,
                row.value === null ? "—" : formatToolNumber(row.value),
              ])}
            />
          </ToolSection>
          <div className="tool__actions" role="group" aria-label={s.convention}>
            <Button
              size="sm"
              variant={convention === "decimal" ? "primary" : "ghost"}
              aria-pressed={convention === "decimal"}
              onClick={() => setConvention("decimal")}
            >
              {s.conventionDecimal}
            </Button>
            <Button
              size="sm"
              variant={convention === "binary" ? "primary" : "ghost"}
              aria-pressed={convention === "binary"}
              onClick={() => setConvention("binary")}
            >
              {s.conventionBinary}
            </Button>
          </div>
          <ResultRow
            label={s.best}
            value={
              best === null
                ? "—"
                : `${formatToolNumber(best.value)} ${lookup(s.units, best.unitId) ?? best.unitId}`
            }
          />
        </>
      )}
      <p className="tool__note">{s.note}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// float-convert
// ---------------------------------------------------------------------------

type FloatMode = "decimal" | "bits";

const ROUNDING_MODES: readonly RoundingMode[] = [
  "nearest-even",
  "nearest-away",
  "toward-zero",
  "toward-positive",
  "toward-negative",
];

/**
 * A decoded bit pattern, re-expressed as the `FloatInput` `convertAcross`
 * wants — by round-tripping through `exactDecimal`/`parseFloatValue`, both
 * exact, rather than re-deriving the numerator/denominator by hand.
 */
function decodedToInput(decoded: DecodedFloat): FloatInput {
  if (decoded.classification === "nan") return { kind: "nan" };
  if (decoded.classification === "infinity") {
    return { kind: "infinity", negative: decoded.negative };
  }
  // Unreachable in practice — `decodeFloat` leaves `exact` null only for the two
  // classifications handled above — but the field IS nullable, and a narrowing
  // assertion here would be a claim about another module's internals.
  if (decoded.exact === null) return { kind: "nan" };
  return parseFloatValue(exactDecimal(decoded.exact)) ?? { kind: "nan" };
}

function FloatConvertTool() {
  const s = strings.devtools.numbers["float-convert"];
  const [mode, setMode] = useState<FloatMode>("decimal");
  const [formatId, setFormatId] = useState<FloatFormatId>("fp32");
  const [text, setText] = useState("");
  const [roundingMode, setRoundingMode] = useState<RoundingMode>("nearest-even");

  const fmt = FLOAT_FORMATS[formatId];
  const trimmed = text.trim();

  let input: FloatInput | null = null;
  let parseFailed = false;
  if (trimmed !== "") {
    if (mode === "decimal") {
      input = parseFloatValue(trimmed);
      parseFailed = input === null;
    } else {
      const bits = parseBitPattern(fmt, trimmed);
      if (bits === null) parseFailed = true;
      else input = decodedToInput(decodeFloat(fmt, bits));
    }
  }

  const targetFormats = FLOAT_FORMAT_IDS.map((id) => FLOAT_FORMATS[id]);
  const conversions = input === null ? null : convertAcross(input, targetFormats, roundingMode);
  const source = conversions?.find((conversion) => conversion.format.id === formatId) ?? null;
  const sourceFields = source === null ? null : formatBitPattern(fmt, source.encoded.bits);

  return (
    <>
      <div className="tool__actions" role="group" aria-label={s.modeLabel}>
        <Button
          size="sm"
          variant={mode === "decimal" ? "primary" : "ghost"}
          aria-pressed={mode === "decimal"}
          onClick={() => setMode("decimal")}
        >
          {s.modeDecimal}
        </Button>
        <Button
          size="sm"
          variant={mode === "bits" ? "primary" : "ghost"}
          aria-pressed={mode === "bits"}
          onClick={() => setMode("bits")}
        >
          {s.modeBits}
        </Button>
      </div>
      <div className="tool__pair">
        <ToolSelect
          label={s.format}
          value={formatId}
          options={FLOAT_FORMAT_IDS.map((id) => ({ id, label: FLOAT_FORMATS[id].label }))}
          onChange={setFormatId}
        />
        <ToolSelect
          label={s.rounding}
          value={roundingMode}
          options={ROUNDING_MODES.map((rm) => ({ id: rm, label: s.roundingModes[rm] }))}
          onChange={setRoundingMode}
        />
      </div>
      <ToolInput
        label={mode === "decimal" ? s.valueLabel : s.bitsLabel}
        value={text}
        onChange={setText}
        placeholder={mode === "decimal" ? s.valuePlaceholder : s.bitsPlaceholder}
        mono
      />
      {trimmed === "" ? null : parseFailed ? (
        <ToolFailure>{mode === "decimal" ? s.invalid : s.invalidBits}</ToolFailure>
      ) : source === null || sourceFields === null ? null : (
        <>
          <ToolSection title={fmt.label}>
            <BitGrid
              groups={[sourceFields.signBits, sourceFields.exponentBits, sourceFields.mantissaBits]}
            />
            <ResultRow label={s.bits} value={sourceFields.hex} />
            <ResultRow label={s.classLabel} value={s.classes[source.decoded.classification]} />
            <ResultRow label={s.exact} value={localizeDecimal(source.stored)} />
            <ResultRow
              label={s.roundingApplied}
              value={source.encoded.exact ? s.roundingExact : s.roundingModes[roundingMode]}
            />
            {(source.encoded.overflow || source.encoded.underflow || source.encoded.signLost) && (
              <ResultRow
                label={s.flags}
                mono={false}
                value={
                  <>
                    {source.encoded.overflow && <span className="tool__badge">{s.overflow}</span>}
                    {source.encoded.underflow && <span className="tool__badge">{s.underflow}</span>}
                    {source.encoded.signLost && <span className="tool__badge">{s.signLost}</span>}
                  </>
                }
              />
            )}
          </ToolSection>
          <ToolSection title={s.allFormats}>
            <ToolTable
              head={[s.format, s.bits, s.value]}
              rows={(conversions ?? []).map((conversion) => {
                const fields = formatBitPattern(conversion.format, conversion.encoded.bits);
                const flags: string[] = [];
                if (conversion.format.id === formatId) flags.push(s.sourceBadge);
                if (!conversion.encoded.exact) flags.push(s.rounded);
                if (conversion.encoded.overflow) flags.push(s.overflow);
                if (conversion.encoded.underflow) flags.push(s.underflow);
                if (conversion.encoded.signLost) flags.push(s.signLost);
                return [
                  conversion.format.label,
                  fields.hex,
                  <span>
                    {localizeDecimal(conversion.stored)}{" "}
                    {flags.map((flag) => (
                      <span className="tool__badge" key={flag}>
                        {flag}
                      </span>
                    ))}
                  </span>,
                ];
              })}
            />
          </ToolSection>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// mx-block
// ---------------------------------------------------------------------------

const MX_ELEMENT_IDS: readonly MxElementFormatId[] = [...MX_SPEC_ELEMENTS, ...MX_EXTENDED_ELEMENTS];

function MxBlockTool() {
  const s = strings.devtools.numbers["mx-block"];
  const [elementId, setElementId] = useState<MxElementFormatId>("mxfp4");
  const [valuesText, setValuesText] = useState("");
  const [roundingMode, setRoundingMode] = useState<RoundingMode>("nearest-even");

  const elementFormat = FLOAT_FORMATS[elementId];
  const tokens = valuesText
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "");

  let error: string | null = null;
  let values: FloatInput[] | null = null;
  if (tokens.length > MX_BLOCK_SIZE) {
    error = s.tooManyValues;
  } else if (tokens.length > 0) {
    const parsed = tokens.map((token) => parseFloatValue(token));
    if (parsed.some((value) => value === null)) {
      error = s.invalidValue;
    } else {
      values = parsed.filter((value): value is FloatInput => value !== null);
    }
  }

  const outcome = values === null ? null : encodeMxBlock(elementFormat, values, roundingMode);
  const decoded = outcome === null ? null : decodeMxBlock(outcome.block);
  const scaleFields =
    outcome === null ? null : formatBitPattern(FLOAT_FORMATS.e8m0, outcome.block.scaleBits);
  const enteredCount = values?.length ?? 0;

  return (
    <>
      <div className="tool__pair">
        <ToolSelect
          label={s.element}
          value={elementId}
          options={MX_ELEMENT_IDS.map((id) => {
            const label = FLOAT_FORMATS[id].label;
            return { id, label: isSpecElement(id) ? label : `${label} ${s.extended}` };
          })}
          onChange={setElementId}
        />
        <ToolSelect
          label={s.rounding}
          value={roundingMode}
          options={ROUNDING_MODES.map((rm) => ({ id: rm, label: s.roundingModes[rm] }))}
          onChange={setRoundingMode}
        />
      </div>
      <ToolTextArea
        label={s.values}
        value={valuesText}
        onChange={setValuesText}
        placeholder={s.valuesPlaceholder}
        hint={s.valuesHint}
      />
      {error !== null ? (
        <ToolFailure>{error}</ToolFailure>
      ) : outcome === null || decoded === null || scaleFields === null ? null : (
        <>
          <ResultRow
            label={s.scale}
            value={
              decoded.scaleExponent === null
                ? s.scaleNaN
                : `2^${decoded.scaleExponent} (${scaleFields.hex})`
            }
          />
          {outcome.diagnostics.scaleClamped && <p className="tool__note">{s.scaleClamped}</p>}
          <ToolTable
            head={[s.index, s.input, s.elementBits, s.decodedValue, s.notes]}
            prose={[4]}
            rows={decoded.elements.slice(0, enteredCount).map((element, index) => {
              const fields = formatBitPattern(elementFormat, element.elementBits);
              const flags: string[] = [];
              if (outcome.diagnostics.inexactIndices.includes(index)) flags.push(s.inexact);
              if (outcome.diagnostics.saturatedIndices.includes(index)) flags.push(s.saturated);
              if (outcome.diagnostics.underflowedIndices.includes(index)) flags.push(s.underflowed);
              return [
                String(index),
                tokens[index] ?? "",
                fields.hex,
                Number.isNaN(element.value) ? "—" : formatToolNumber(element.value),
                flags.map((flag) => (
                  <span className="tool__badge" key={flag}>
                    {flag}
                  </span>
                )),
              ];
            })}
          />
          {enteredCount < MX_BLOCK_SIZE && <p className="tool__note">{s.padded}</p>}
          <ResultRow
            label={s.bitsPerValue}
            value={formatToolNumber(mxBitsPerValue(elementFormat))}
          />
          <ResultRow label={s.blockBits} value={String(mxBlockBitSize(elementFormat))} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export const NUMBERS_SURFACES: Readonly<Record<string, ComponentType>> = {
  "number-base": NumberBaseTool,
  "integer-inspector": IntegerInspectorTool,
  bitwise: BitwiseTool,
  "data-unit": DataUnitTool,
  "float-convert": FloatConvertTool,
  "mx-block": MxBlockTool,
};
