import {
  audioLevel,
  type AudioLevelCalibration,
  type AudioLevelEntry,
  type AudioLevelInput,
  barDuration,
  barsInDuration,
  type BarCountInput,
  type BarDurationInput,
  type BpmReference,
  bufferLatency,
  type BufferLatencyInput,
  centsRatio,
  type IntervalEntry,
  compressorCurve,
  type CompressorInput,
  decibelRatio,
  decibelSum,
  type ChordType,
  type DecibelEntry,
  type DecibelQuantity,
  type DecibelRatioInput,
  delayTimes,
  delayTimesFromMeasuredMs,
  type DelayTimesInput,
  midiToPitch,
  type MidiPitchInput,
  type NamedPitchInput,
  type FrequencyPitchInput,
  type OctaveConvention,
  type NoteDenominator,
  type NoteModifier,
  pcmDuration,
  pcmSize,
  type BitDepth,
  type PcmDurationInput,
  type PcmSizeInput,
  pitchFromFrequency,
  pitchFromName,
  reverbTime,
  type AbsorptionSurface,
  type AirAbsorptionCoefficients,
  type ReverbBand,
  type ReverbTimeInput,
  roomModes,
  type RoomModesInput,
  sampleCount,
  sampleDuration,
  type SampleCountInput,
  type SampleDurationInput,
  type ScaleType,
  soundWavelength,
  type SoundWaveEntry,
  type SoundWavelengthInput,
  speakerLoad,
  type SpeakerCabinet,
  type SpeakerLoadInput,
  type SpeakerWiring,
  spellChord,
  spellScale,
  splAtDistance,
  type TriadQuality,
  type SplInput,
  type SplSensitivityReference,
  type TimeSignatureDenominator,
  transposeKey,
  transposePitch,
  transposeText,
  type IntervalName,
  type TransposeBy,
  type TransposeKeyInput,
  type TransposePitchInput,
  type TransposeTextInput,
  type TransposingInstrument,
  varispeed,
  type VarispeedEntry,
  type VarispeedInput,
} from "@nexus/core/pro/muzika";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  proRows,
  ResultRow,
  ToolAgainstLimit,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/** Time-signature denominator select options — a numeric union, so the id and the value differ. */
const DENOMINATOR_OPTIONS = ["1", "2", "4", "8", "16", "32"] as const;
type DenominatorOption = (typeof DENOMINATOR_OPTIONS)[number];
const DENOMINATOR_VALUES: Record<DenominatorOption, TimeSignatureDenominator> = {
  "1": 1,
  "2": 2,
  "4": 4,
  "8": 8,
  "16": 16,
  "32": 32,
};

/** Note-value select options for the delay-time tables — includes 1/64, unlike a time signature. */
const NOTE_DENOMINATOR_OPTIONS = ["1", "2", "4", "8", "16", "32", "64"] as const;
type NoteDenominatorOption = (typeof NOTE_DENOMINATOR_OPTIONS)[number];
const NOTE_DENOMINATOR_VALUES: Record<NoteDenominatorOption, NoteDenominator> = {
  "1": 1,
  "2": 2,
  "4": 4,
  "8": 8,
  "16": 16,
  "32": 32,
  "64": 64,
};

/** Bit-depth select options — 32-bit integer and 32-bit float share one numeric value. */
const BIT_DEPTH_OPTIONS = ["8", "16", "24", "32"] as const;
type BitDepthOption = (typeof BIT_DEPTH_OPTIONS)[number];
const BIT_DEPTH_VALUES: Record<BitDepthOption, BitDepth> = { "8": 8, "16": 16, "24": 24, "32": 32 };

/**
 * „Muzika i produkcija" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/muzika.ts`'s. Nothing here divides,
 * rounds or compares; this file shapes fields, hands the numbers over, and
 * reads the answers onto the page — the same discipline `pro/gradnja.tsx`
 * documents at its own head.
 *
 * **`speaker-load` and `spl-distance` are `life-safety`.** The host draws the
 * notice from the registration and appends the travelling line to every
 * copy; what is left here is the part the contract cannot enforce: no
 * verdict word, no colour, no icon — a computed quantity beside the user's
 * own limit and nothing but their ratio, via `ToolAgainstLimit`.
 *
 * **`cents-ratio` has its own component**, against this file's first draft,
 * which retired it as absorbed by `NoteFrequencyTool` and
 * `VarispeedRepitchTool`. `NoteFrequencyTool` reaches the identity only
 * through a note, so two of `centsRatio`'s three entry kinds are unreachable
 * from it; `VarispeedRepitchTool` does cover the bare conversion but is
 * `muzika` only, while this tool is also `prosveta`. All three call the same
 * `centsRatio`, so nothing is duplicated. See `strings/pro.muzika.ts`.
 */

/**
 * Line level in every unit at once — dBu, dBV, RMS/peak/peak-to-peak volts,
 * and, only with an impedance or a calibration typed, dBm and dBFS.
 *
 * Exactly one field is the entry point; picking a different one clears the
 * question rather than answering two at once.
 */
export function AudioLevelReferenceTool() {
  const s = strings.pro.muzika["audio-level-reference"];
  const [entryKind, setEntryKind] = useState<AudioLevelEntry["kind"]>("dbu");
  const [valueText, setValueText] = useState("");
  const [impedanceText, setImpedanceText] = useState("");
  const [calibrationKind, setCalibrationKind] = useState<AudioLevelCalibration["kind"] | "none">(
    "none",
  );
  const [calibrationValueText, setCalibrationValueText] = useState("");

  const typed = proParse(valueText) !== undefined;
  const entry: AudioLevelEntry = { kind: entryKind, value: proParse(valueText) ?? Number.NaN };
  const calibration: AudioLevelCalibration | undefined =
    calibrationKind === "none"
      ? undefined
      : { kind: calibrationKind, value: proParse(calibrationValueText) ?? Number.NaN };

  const result = audioLevel({
    entry,
    impedance: proParse(impedanceText),
    calibration,
  } satisfies AudioLevelInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "dbu"
        ? s.errorDbu
        : result.reason === "dbv"
          ? s.errorDbv
          : result.reason === "vrms"
            ? s.errorVrms
            : result.reason === "vpp"
              ? s.errorVpp
              : result.reason === "dbm"
                ? s.errorDbm
                : result.reason === "impedance"
                  ? s.errorImpedance
                  : result.reason === "dbfs"
                    ? s.errorDbfs
                    : s.errorCalibration;

  const entryLabel =
    entryKind === "dbu"
      ? s.entryDbu
      : entryKind === "dbv"
        ? s.entryDbv
        : entryKind === "vrms"
          ? s.entryVrms
          : entryKind === "vpp"
            ? s.entryVpp
            : entryKind === "dbm"
              ? s.entryDbm
              : s.entryDbfs;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultDbu}: ${proUnit(proNum(result.dbu, 3), s.unitDbu)}`,
        `${s.resultDbv}: ${proUnit(proNum(result.dbv, 3), s.unitDbv)}`,
        `${s.resultVrms}: ${proUnit(proNum(result.vrms, 4), s.unitV)}`,
        `${s.resultVpeak}: ${proUnit(proNum(result.vpeak, 4), s.unitV)}`,
        `${s.resultVpp}: ${proUnit(proNum(result.vpp, 4), s.unitV)}`,
        result.dbm === undefined ? undefined : `${s.resultDbm}: ${proUnit(proNum(result.dbm, 3), s.unitDbm)}`,
        result.dbfs === undefined ? undefined : `${s.resultDbfs}: ${proUnit(proNum(result.dbfs, 3), s.unitDbfs)}`,
        "",
        `${s.entryKind}: ${entryLabel}`,
        `${s.value}: ${valueText.trim()}`,
        result.impedance === undefined
          ? undefined
          : `${s.impedance}: ${proUnit(proNum(result.impedance, 1), s.unitOhm)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<AudioLevelEntry["kind"]>
        label={s.entryKind}
        value={entryKind}
        onChange={setEntryKind}
        options={[
          { id: "dbu", label: s.entryDbu },
          { id: "dbv", label: s.entryDbv },
          { id: "vrms", label: s.entryVrms },
          { id: "vpp", label: s.entryVpp },
          { id: "dbm", label: s.entryDbm },
          { id: "dbfs", label: s.entryDbfs },
        ]}
      />
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolInput label={s.impedance} hint={s.impedanceHint} value={impedanceText} onChange={setImpedanceText} />
      <ToolSelect<AudioLevelCalibration["kind"] | "none">
        label={s.calibrationKind}
        value={calibrationKind}
        onChange={setCalibrationKind}
        hint={s.calibrationHint}
        options={[
          { id: "none", label: s.calibrationNone },
          { id: "dbu-at-0-dbfs", label: s.calibrationDbuAt0 },
          { id: "dbfs-at-plus4-dbu", label: s.calibrationDbfsAtPlus4 },
        ]}
      />
      {calibrationKind !== "none" && (
        <ToolInput label={s.calibrationValue} value={calibrationValueText} onChange={setCalibrationValueText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultDbu} value={proUnit(proNum(result.dbu, 3), s.unitDbu)} />
          <ResultRow label={s.resultDbv} value={proUnit(proNum(result.dbv, 3), s.unitDbv)} />
          <ResultRow label={s.resultVrms} value={proUnit(proNum(result.vrms, 4), s.unitV)} />
          <ResultRow label={s.resultVpeak} value={proUnit(proNum(result.vpeak, 4), s.unitV)} />
          <ResultRow label={s.resultVpp} value={proUnit(proNum(result.vpp, 4), s.unitV)} />
          <p className="tool__note">{s.peakNote}</p>
          {result.dbm !== undefined && (
            <>
              <ResultRow label={s.resultDbm} value={proUnit(proNum(result.dbm, 3), s.unitDbm)} />
              <p className="tool__note">{s.dbmNote}</p>
            </>
          )}
          {result.dbfs !== undefined && (
            <ResultRow label={s.resultDbfs} value={proUnit(proNum(result.dbfs, 3), s.unitDbfs)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.entryKind, value: entryLabel },
              { label: s.value, value: valueText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * How long a number of bars lasts, or how many bars fit a duration — the
 * field the user typed LAST leads; the other becomes read-only computed
 * output, so the pane can never hold two contradictory answers at once.
 */
export function BarDurationTool() {
  const s = strings.pro.muzika["bar-duration"];
  const [bpmText, setBpmText] = useState("");
  const [bpmReference, setBpmReference] = useState<BpmReference>("quarter");
  const [numeratorText, setNumeratorText] = useState("");
  const [denominator, setDenominator] = useState<DenominatorOption>("4");
  const [barsText, setBarsText] = useState("");
  const [durationText, setDurationText] = useState("");
  const [lastEdited, setLastEdited] = useState<"bars" | "duration" | undefined>(undefined);

  const timing = {
    bpm: proParse(bpmText) ?? Number.NaN,
    numerator: proParse(numeratorText) ?? Number.NaN,
    denominator: DENOMINATOR_VALUES[denominator],
    bpmReference,
  };

  const direction = lastEdited ?? (proParse(barsText) !== undefined ? "bars" : "duration");
  const typed = [bpmText, numeratorText, barsText, durationText].some((t) => proParse(t) !== undefined);

  const forward: ReturnType<typeof barDuration> = barDuration({
    ...timing,
    bars: proParse(barsText) ?? Number.NaN,
  } satisfies BarDurationInput);
  const inverse: ReturnType<typeof barsInDuration> = barsInDuration({
    ...timing,
    seconds: proParse(durationText) ?? Number.NaN,
  } satisfies BarCountInput);
  const result = direction === "bars" ? forward : inverse;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "bpm"
        ? s.errorBpm
        : result.reason === "numerator"
          ? s.errorNumerator
          : result.reason === "denominator"
            ? s.errorDenominator
            : result.reason === "bpmReference"
              ? s.errorBpmReference
              : result.reason === "bars"
                ? s.errorBars
                : s.errorSeconds;

  const referenceLabel =
    bpmReference === "quarter"
      ? s.bpmRefQuarter
      : bpmReference === "dotted-quarter"
        ? s.bpmRefDottedQuarter
        : s.bpmRefDenominatorUnit;

  const copyText = !result.ok
    ? ""
    : direction === "bars" && "formatted" in result
      ? [
          `${s.resultSeconds}: ${proUnit(proNum(result.seconds, 3), s.unitS)}`,
          `${s.resultFormatted}: ${result.formatted}`,
          `${s.resultSecondsPerBar}: ${proUnit(proNum(result.secondsPerBar, 6), s.unitS)}`,
          `${s.resultSecondsPerBeatUnit}: ${proUnit(proNum(result.secondsPerBeatUnit, 6), s.unitS)}`,
          "",
          `${s.bpm}: ${bpmText.trim()}`,
          `${s.bpmReference}: ${referenceLabel}`,
          `${s.numerator}: ${numeratorText.trim()}`,
          `${s.denominator}: ${denominator}`,
          `${s.bars}: ${barsText.trim()}`,
        ].join("\n")
      : "bars" in result
        ? [
            `${s.resultBars}: ${result.bars}`,
            `${s.resultRemainderSeconds}: ${proUnit(proNum(result.remainderSeconds, 3), s.unitS)}`,
            `${s.resultRemainderBeats}: ${proUnit(proNum(result.remainderBeats, 3), s.unitDoba)}`,
            `${s.resultRemainderMs}: ${proUnit(proNum(result.remainderMs, 1), s.unitMs)}`,
            "",
            `${s.bpm}: ${bpmText.trim()}`,
            `${s.bpmReference}: ${referenceLabel}`,
            `${s.numerator}: ${numeratorText.trim()}`,
            `${s.denominator}: ${denominator}`,
            `${s.duration}: ${durationText.trim()}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolInput label={s.bpm} hint={s.bpmHint} value={bpmText} onChange={setBpmText} />
      <ToolSelect<BpmReference>
        label={s.bpmReference}
        value={bpmReference}
        onChange={setBpmReference}
        hint={s.bpmReferenceHint}
        options={[
          { id: "quarter", label: s.bpmRefQuarter },
          { id: "dotted-quarter", label: s.bpmRefDottedQuarter },
          { id: "denominator-unit", label: s.bpmRefDenominatorUnit },
        ]}
      />
      <ToolInput label={s.numerator} value={numeratorText} onChange={setNumeratorText} />
      <ToolSelect<DenominatorOption>
        label={s.denominator}
        value={denominator}
        onChange={setDenominator}
        options={DENOMINATOR_OPTIONS.map((id) => ({ id, label: id }))}
      />
      <ToolInput
        label={s.bars}
        hint={s.barsHint}
        value={barsText}
        onChange={(value) => {
          setBarsText(value);
          setLastEdited("bars");
        }}
      />
      <ToolInput
        label={s.duration}
        hint={s.durationHint}
        value={durationText}
        onChange={(value) => {
          setDurationText(value);
          setLastEdited("duration");
        }}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {direction === "bars" && "formatted" in result && (
            <>
              <ResultRow label={s.resultSeconds} value={proUnit(proNum(result.seconds, 3), s.unitS)} />
              <ResultRow label={s.resultFormatted} value={result.formatted} />
            </>
          )}
          {direction === "duration" && "bars" in result && (
            <>
              <ResultRow label={s.resultBars} value={result.bars} />
              <ResultRow
                label={s.resultRemainderSeconds}
                value={proUnit(proNum(result.remainderSeconds, 3), s.unitS)}
              />
              <ResultRow
                label={s.resultRemainderBeats}
                value={proUnit(proNum(result.remainderBeats, 3), s.unitDoba)}
              />
              <ResultRow label={s.resultRemainderMs} value={proUnit(proNum(result.remainderMs, 1), s.unitMs)} />
            </>
          )}
          <ResultRow label={s.resultSecondsPerBar} value={proUnit(proNum(result.secondsPerBar, 6), s.unitS)} />
          <ResultRow
            label={s.resultSecondsPerBeatUnit}
            value={proUnit(proNum(result.secondsPerBeatUnit, 6), s.unitS)}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.bpm, value: bpmText.trim() },
              { label: s.bpmReference, value: referenceLabel },
              { label: s.numerator, value: numeratorText.trim() },
              { label: s.denominator, value: denominator },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

const NOTE_MODIFIERS: readonly NoteModifier[] = ["straight", "dotted", "triplet"];

/**
 * Delay times for every note value at a tempo, straight/dotted/triplet, and
 * the reverse: the tempo a MEASURED delay is each of those values at. The
 * note-value and modifier selectors only highlight a row in the forward
 * table — the table itself always renders in full, which is what makes the
 * highlight a reading aid and not a second, narrower answer.
 */
export function BpmDelayTimesTool() {
  const s = strings.pro.muzika["bpm-delay-times"];
  const [bpmText, setBpmText] = useState("");
  const [highlight, setHighlight] = useState<NoteDenominatorOption>("4");
  const [modifier, setModifier] = useState<NoteModifier>("straight");
  const [measuredMsText, setMeasuredMsText] = useState("");

  const forwardTyped = proParse(bpmText) !== undefined;
  const forward = delayTimes({
    bpm: proParse(bpmText) ?? Number.NaN,
    denominator: NOTE_DENOMINATOR_VALUES[highlight],
    modifier,
  } satisfies DelayTimesInput);
  const forwardFailure =
    forward.ok || !forwardTyped
      ? undefined
      : forward.reason === "denominator"
        ? s.errorDenominator
        : s.errorBpm;

  const inverseTyped = proParse(measuredMsText) !== undefined;
  const inverse = delayTimesFromMeasuredMs({ measuredMs: proParse(measuredMsText) ?? Number.NaN });
  const inverseFailure = inverse.ok || !inverseTyped ? undefined : s.errorMeasuredMs;

  const modifierLabel = (m: NoteModifier): string =>
    m === "straight" ? s.modStraight : m === "dotted" ? s.modDotted : s.modTriplet;

  const forwardCopy = !forward.ok
    ? ""
    : [
        `${s.beatMs}: ${proUnit(proNum(forward.beatMs, 4), s.unitMs)}`,
        ...forward.rows.map(
          (row) =>
            `1/${row.denominator} — ${s.modStraight} ${proUnit(proNum(row.straight.milliseconds, 3), s.unitMs)} (${proUnit(proNum(row.straight.hertz, 4), s.unitHz)}), ${s.modDotted} ${proUnit(proNum(row.dotted.milliseconds, 3), s.unitMs)} (${proUnit(proNum(row.dotted.hertz, 4), s.unitHz)}), ${s.modTriplet} ${proUnit(proNum(row.triplet.milliseconds, 3), s.unitMs)} (${proUnit(proNum(row.triplet.hertz, 4), s.unitHz)})`,
        ),
        "",
        `${s.bpm}: ${bpmText.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.bpm} value={bpmText} onChange={setBpmText} />
      <ToolSelect<NoteDenominatorOption>
        label={s.highlightDenominator}
        value={highlight}
        onChange={setHighlight}
        options={NOTE_DENOMINATOR_OPTIONS.map((id) => ({ id, label: `1/${id}` }))}
      />
      <ToolSelect<NoteModifier>
        label={s.highlightModifier}
        value={modifier}
        onChange={setModifier}
        options={NOTE_MODIFIERS.map((id) => ({ id, label: modifierLabel(id) }))}
      />

      {forwardFailure !== undefined && <ToolFailure>{forwardFailure}</ToolFailure>}

      {forward.ok && (
        <ToolSection title={s.resultsForward}>
          <ResultRow label={s.beatMs} value={proUnit(proNum(forward.beatMs, 4), s.unitMs)} />
          <ToolTable
            head={[s.colNote, s.colStraightMs, s.colStraightHz, s.colDottedMs, s.colDottedHz, s.colTripletMs, s.colTripletHz]}
            rows={forward.rows.map((row) => [
              `1/${row.denominator}`,
              proNum(row.straight.milliseconds, 3),
              proNum(row.straight.hertz, 4),
              proNum(row.dotted.milliseconds, 3),
              proNum(row.dotted.hertz, 4),
              proNum(row.triplet.milliseconds, 3),
              proNum(row.triplet.hertz, 4),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.bpm, value: bpmText.trim() }]} />
          <CopyButton value={forwardCopy} />
        </ToolSection>
      )}

      <ToolInput label={s.measuredMs} hint={s.measuredMsHint} value={measuredMsText} onChange={setMeasuredMsText} />
      {inverseFailure !== undefined && <ToolFailure>{inverseFailure}</ToolFailure>}
      {inverse.ok && (
        <ToolSection title={s.resultsInverse}>
          <ToolTable
            head={[s.colNote, s.colStraightBpm, s.colDottedBpm, s.colTripletBpm]}
            rows={inverse.rows.map((row) => [
              `1/${row.denominator}`,
              proNum(row.bpm.straightBpm, 3),
              proNum(row.bpm.dottedBpm, 3),
              proNum(row.bpm.tripletBpm, 3),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.measuredMs, value: proUnit(proNum(proParse(measuredMsText) ?? 0, 3), s.unitMs) }]} />
          <CopyButton
            value={[
              ...inverse.rows.map(
                (row) =>
                  `1/${row.denominator} — ${s.modStraight} ${proNum(row.bpm.straightBpm, 3)} ${s.unitBpm}, ${s.modDotted} ${proNum(row.bpm.dottedBpm, 3)} ${s.unitBpm}, ${s.modTriplet} ${proNum(row.bpm.tripletBpm, 3)} ${s.unitBpm}`,
              ),
              "",
              `${s.measuredMs}: ${measuredMsText.trim()}`,
            ].join("\n")}
          />
        </ToolSection>
      )}
    </>
  );
}

/**
 * One interval, whichever way round the user knows it — two frequencies, a
 * cent figure, or a bare ratio — with the other two spelled out.
 *
 * The base frequency is optional and is what turns a pure interval into a
 * pitch: only with it are a resulting frequency and a beat rate reported. The
 * `frequencies` entry carries its own base in field A, so the field is hidden
 * there rather than being offered and quietly ignored.
 */
export function CentsRatioTool() {
  const s = strings.pro.muzika["cents-ratio"];
  const [entryKind, setEntryKind] = useState<IntervalEntry["kind"]>("frequencies");
  const [frequencyAText, setFrequencyAText] = useState("");
  const [frequencyBText, setFrequencyBText] = useState("");
  const [valueText, setValueText] = useState("");
  const [baseFrequencyText, setBaseFrequencyText] = useState("");

  const frequencyA = proParse(frequencyAText);
  const frequencyB = proParse(frequencyBText);
  const value = proParse(valueText);

  const entry: IntervalEntry =
    entryKind === "frequencies"
      ? { kind: "frequencies", a: frequencyA ?? Number.NaN, b: frequencyB ?? Number.NaN }
      : entryKind === "cents"
        ? { kind: "cents", value: value ?? Number.NaN }
        : { kind: "ratio", value: value ?? Number.NaN };

  /**
   * Gates whether a REFUSAL may be shown, never whether the tool may run: an
   * empty field is a question nobody has finished asking, and answering it
   * with „mora biti veća od nule" reads as a complaint about not typing yet.
   */
  const typed =
    entryKind === "frequencies"
      ? frequencyA !== undefined && frequencyB !== undefined
      : value !== undefined;

  const result = centsRatio({
    entry,
    ...(entryKind === "frequencies" ? {} : { baseFrequency: proParse(baseFrequencyText) }),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "frequencyA"
        ? s.errorFrequencyA
        : result.reason === "frequencyB"
          ? s.errorFrequencyB
          : result.reason === "cents"
            ? s.errorCents
            : result.reason === "ratio"
              ? s.errorRatio
              : s.errorBaseFrequency;

  const entryLabel =
    entryKind === "frequencies" ? s.entryFrequencies : entryKind === "cents" ? s.entryCents : s.entryRatio;

  const entryValue =
    entryKind === "frequencies"
      ? `${frequencyAText.trim()} → ${frequencyBText.trim()}`
      : valueText.trim();

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultCents}: ${proUnit(proNum(result.cents, 3), s.unitCent)}`,
        `${s.resultSemitones}: ${proUnit(proNum(result.semitones, 4), s.unitSemitone)}`,
        `${s.resultRatio}: ${proNum(result.ratio, 6)}`,
        result.baseFrequency === undefined
          ? undefined
          : `${s.resultBaseFrequency}: ${proUnit(proNum(result.baseFrequency, 3), s.unitHz)}`,
        result.resultFrequency === undefined
          ? undefined
          : `${s.resultFrequency}: ${proUnit(proNum(result.resultFrequency, 3), s.unitHz)}`,
        result.beatHz === undefined
          ? undefined
          : `${s.resultBeatHz}: ${proUnit(proNum(result.beatHz, 3), s.unitHz)}`,
        "",
        `${s.entryKind}: ${entryLabel}`,
        `${entryLabel}: ${entryValue}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<IntervalEntry["kind"]>
        label={s.entryKind}
        value={entryKind}
        onChange={setEntryKind}
        options={[
          { id: "frequencies", label: s.entryFrequencies },
          { id: "cents", label: s.entryCents },
          { id: "ratio", label: s.entryRatio },
        ]}
      />
      {entryKind === "frequencies" ? (
        <>
          <ToolInput label={s.frequencyA} value={frequencyAText} onChange={setFrequencyAText} />
          <ToolInput label={s.frequencyB} value={frequencyBText} onChange={setFrequencyBText} />
          <p className="tool__note">{s.baseFrequencyFromA}</p>
        </>
      ) : (
        <>
          <ToolInput
            label={entryKind === "cents" ? s.cents : s.ratio}
            hint={entryKind === "cents" ? s.centsHint : s.ratioHint}
            value={valueText}
            onChange={setValueText}
          />
          <ToolInput
            label={s.baseFrequency}
            hint={s.baseFrequencyHint}
            value={baseFrequencyText}
            onChange={setBaseFrequencyText}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultCents} value={proUnit(proNum(result.cents, 3), s.unitCent)} />
          <ResultRow label={s.resultSemitones} value={proUnit(proNum(result.semitones, 4), s.unitSemitone)} />
          <ResultRow label={s.resultRatio} value={proNum(result.ratio, 6)} />
          <p className="tool__note">{s.signNote}</p>
          {result.baseFrequency !== undefined && (
            <ResultRow
              label={s.resultBaseFrequency}
              value={proUnit(proNum(result.baseFrequency, 3), s.unitHz)}
            />
          )}
          {result.resultFrequency !== undefined && (
            <ResultRow label={s.resultFrequency} value={proUnit(proNum(result.resultFrequency, 3), s.unitHz)} />
          )}
          {result.beatHz !== undefined && (
            <>
              <ResultRow label={s.resultBeatHz} value={proUnit(proNum(result.beatHz, 3), s.unitHz)} />
              <p className="tool__note">{s.beatNote}</p>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.entryKind, value: entryLabel },
              { label: entryLabel, value: entryValue },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * The soft-knee compressor transfer function at one input level. A static
 * gain curve only — no attack, release, detector type or lookahead, which
 * the note under the result says in words rather than implying.
 */
export function CompressorCurveTool() {
  const s = strings.pro.muzika["compressor-curve"];
  const [thresholdText, setThresholdText] = useState("");
  const [ratioText, setRatioText] = useState("");
  const [kneeText, setKneeText] = useState("");
  const [inputLevelText, setInputLevelText] = useState("");
  const [makeupText, setMakeupText] = useState("");
  const [makeupReferenceText, setMakeupReferenceText] = useState("");

  const typed =
    proParse(thresholdText) !== undefined ||
    proParse(ratioText) !== undefined ||
    proParse(inputLevelText) !== undefined;

  const result = compressorCurve({
    threshold: proParse(thresholdText) ?? Number.NaN,
    ratio: proParse(ratioText) ?? Number.NaN,
    knee: proParse(kneeText),
    inputLevel: proParse(inputLevelText) ?? Number.NaN,
    makeup: proParse(makeupText),
    makeupReferenceLevel: proParse(makeupReferenceText),
  } satisfies CompressorInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "threshold"
        ? s.errorThreshold
        : result.reason === "ratio"
          ? s.errorRatio
          : result.reason === "knee"
            ? s.errorKnee
            : result.reason === "inputLevel"
              ? s.errorInputLevel
              : result.reason === "makeup"
                ? s.errorMakeup
                : s.errorMakeupReferenceLevel;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultOutputLevel}: ${proUnit(proNum(result.outputLevel, 3), s.unitDbfs)}`,
        `${s.resultGainReduction}: ${proUnit(proNum(result.gainReduction, 3), s.unitDb)}`,
        `${s.resultOutputWithMakeup}: ${proUnit(proNum(result.outputWithMakeup, 3), s.unitDbfs)}`,
        result.makeupToReference === undefined
          ? undefined
          : `${s.resultMakeupToReference}: ${proUnit(proNum(result.makeupToReference, 3), s.unitDb)}`,
        "",
        `${s.threshold}: ${proUnit(proNum(proParse(thresholdText) ?? 0, 2), s.unitDbfs)}`,
        `${s.ratio}: ${ratioText.trim()}:1`,
        `${s.knee}: ${proUnit(proNum(proParse(kneeText) ?? 0, 2), s.unitDb)}`,
        `${s.inputLevel}: ${proUnit(proNum(proParse(inputLevelText) ?? 0, 2), s.unitDbfs)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.threshold} hint={s.thresholdHint} value={thresholdText} onChange={setThresholdText} />
      <ToolInput label={s.ratio} value={ratioText} onChange={setRatioText} />
      <ToolInput label={s.knee} hint={s.kneeHint} value={kneeText} onChange={setKneeText} />
      <ToolInput label={s.inputLevel} hint={s.inputLevelHint} value={inputLevelText} onChange={setInputLevelText} />
      <ToolInput label={s.makeup} hint={s.makeupHint} value={makeupText} onChange={setMakeupText} />
      <ToolInput
        label={s.makeupReferenceLevel}
        hint={s.makeupReferenceLevelHint}
        value={makeupReferenceText}
        onChange={setMakeupReferenceText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultOutputLevel} value={proUnit(proNum(result.outputLevel, 3), s.unitDbfs)} />
          <ResultRow label={s.resultGainReduction} value={proUnit(proNum(result.gainReduction, 3), s.unitDb)} />
          <ResultRow
            label={s.resultOutputWithMakeup}
            value={proUnit(proNum(result.outputWithMakeup, 3), s.unitDbfs)}
          />
          {result.makeupToReference !== undefined && (
            <ResultRow
              label={s.resultMakeupToReference}
              value={proUnit(proNum(result.makeupToReference, 3), s.unitDb)}
            />
          )}
          <p className="tool__note">{s.scopeNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.threshold, value: proUnit(proNum(proParse(thresholdText) ?? 0, 2), s.unitDbfs) },
              { label: s.ratio, value: `${ratioText.trim()}:1` },
              { label: s.inputLevel, value: proUnit(proNum(proParse(inputLevelText) ?? 0, 2), s.unitDbfs) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Decibels and a linear ratio, either direction, plus the incoherent
 * (power) sum of a typed list of levels — a separate question, answered in
 * its own section with its own refusal.
 */
export function DecibelRatioTool() {
  const s = strings.pro.muzika["decibel-ratio"];
  const [entryKind, setEntryKind] = useState<DecibelEntry["kind"]>("decibels");
  const [valueText, setValueText] = useState("");
  const [quantity, setQuantity] = useState<DecibelQuantity>("amplitude");
  const [levelsText, setLevelsText] = useState("");

  const typed = proParse(valueText) !== undefined;
  const entry: DecibelEntry = { kind: entryKind, value: proParse(valueText) ?? Number.NaN };
  const result = decibelRatio({ entry, quantity } satisfies DecibelRatioInput);
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "decibels"
        ? s.errorDecibels
        : result.reason === "ratio"
          ? s.errorRatio
          : s.errorQuantity;

  const quantityLabel = quantity === "amplitude" ? s.quantityAmplitude : s.quantityPower;
  const entryLabel = entryKind === "decibels" ? s.entryDecibels : s.entryRatio;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultDecibels}: ${proUnit(proNum(result.decibels, 4), s.unitDb)}`,
        `${s.resultRatio}: ${proNum(result.ratio, 6)}`,
        `${s.resultPercent}: ${proUnit(proNum(result.percent, 4), s.unitPercent)}`,
        "",
        `${s.entryKind}: ${entryLabel}`,
        `${s.value}: ${valueText.trim()}`,
        `${s.quantity}: ${quantityLabel}`,
      ].join("\n");

  const levelValues = levelsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => proParse(line) ?? Number.NaN);
  const sumTyped = levelValues.length > 0;
  const sum = decibelSum({ levels: levelValues });
  const sumFailure = sum.ok || !sumTyped ? undefined : s.errorLevels;

  return (
    <>
      <ToolSelect<DecibelEntry["kind"]>
        label={s.entryKind}
        value={entryKind}
        onChange={setEntryKind}
        options={[
          { id: "decibels", label: s.entryDecibels },
          { id: "ratio", label: s.entryRatio },
        ]}
      />
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolSelect<DecibelQuantity>
        label={s.quantity}
        value={quantity}
        onChange={setQuantity}
        options={[
          { id: "amplitude", label: s.quantityAmplitude },
          { id: "power", label: s.quantityPower },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultDecibels} value={proUnit(proNum(result.decibels, 4), s.unitDb)} />
          <ResultRow label={s.resultRatio} value={proNum(result.ratio, 6)} />
          <ResultRow label={s.resultPercent} value={proUnit(proNum(result.percent, 4), s.unitPercent)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.entryKind, value: entryLabel },
              { label: s.value, value: valueText.trim() },
              { label: s.quantity, value: quantityLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      <ToolTextArea label={s.levels} hint={s.levelsHint} value={levelsText} onChange={setLevelsText} />
      {sumFailure !== undefined && <ToolFailure>{sumFailure}</ToolFailure>}
      {sum.ok && (
        <ToolSection title={s.resultsSum}>
          <ResultRow label={s.resultSum} value={proUnit(proNum(sum.sum, 4), s.unitDb)} />
          <p className="tool__note">{s.sumNote}</p>
          <ToolTable
            head={[s.colLevel, s.colShare]}
            rows={sum.shares.map((share) => [proNum(share.level, 2), proNum(share.percent, 2)])}
          />
          <CopyButton
            value={[
              `${s.resultSum}: ${proUnit(proNum(sum.sum, 4), s.unitDb)}`,
              ...sum.shares.map((share) => `${proNum(share.level, 2)} dB: ${proNum(share.percent, 2)} %`),
            ].join("\n")}
          />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Note name, MIDI number and frequency, in any direction — plus, absorbed
 * from the retired standalone cents/ratio tool, an optional interval to a
 * second frequency and an optional cents shift applied to the result.
 */
export function NoteFrequencyTool() {
  const s = strings.pro.muzika["note-frequency"];
  const [entryKind, setEntryKind] = useState<"midi" | "name" | "frequency">("name");
  const [midiText, setMidiText] = useState("");
  const [nameText, setNameText] = useState("");
  const [freqText, setFreqText] = useState("");
  const [referencePitchText, setReferencePitchText] = useState("");
  const [octaveConvention, setOctaveConvention] = useState<OctaveConvention>("scientific");
  const [secondFrequencyText, setSecondFrequencyText] = useState("");
  const [pitchShiftCentsText, setPitchShiftCentsText] = useState("");

  const typed =
    entryKind === "midi"
      ? proParse(midiText) !== undefined
      : entryKind === "name"
        ? nameText.trim() !== ""
        : proParse(freqText) !== undefined;

  const extras = {
    referencePitch: proParse(referencePitchText),
    octaveConvention,
    secondFrequency: proParse(secondFrequencyText),
    pitchShiftCents: proParse(pitchShiftCentsText),
  };

  const midiResult = midiToPitch({
    midi: proParse(midiText) ?? Number.NaN,
    ...extras,
  } satisfies MidiPitchInput);
  const nameResult = pitchFromName({ name: nameText, ...extras } satisfies NamedPitchInput);
  const freqResult = pitchFromFrequency({
    frequency: proParse(freqText) ?? Number.NaN,
    ...extras,
  } satisfies FrequencyPitchInput);
  const result = entryKind === "midi" ? midiResult : entryKind === "name" ? nameResult : freqResult;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "midi"
        ? s.errorMidi
        : result.reason === "name"
          ? s.errorName
          : result.reason === "frequency"
            ? s.errorFrequency
            : result.reason === "referencePitch"
              ? s.errorReferencePitch
              : result.reason === "octaveConvention"
                ? s.errorOctaveConvention
                : result.reason === "secondFrequency"
                  ? s.errorSecondFrequency
                  : s.errorPitchShiftCents;

  const conventionLabel =
    octaveConvention === "scientific" ? s.octaveConventionScientific : s.octaveConventionYamaha;
  const entryLabel = entryKind === "midi" ? s.entryMidi : entryKind === "name" ? s.entryName : s.entryFrequency;

  // `result` is a union of `Pitch` (the midi/name entries) and `NearestPitch`
  // (the frequency entry, which alone carries `midiExact`/`cents`). `"cents"
  // in result` does not eliminate the `Pitch` branch — an interface admits
  // excess properties structurally, so TypeScript can only ADD `& Record<
  // "cents", unknown>` rather than narrow — so the frequency entry point is
  // the discriminant instead, checked directly against `freqResult`.
  const nearest = entryKind === "frequency" && freqResult.ok ? freqResult : undefined;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultName}: ${result.name ?? "—"}`,
        `${s.resultFlatName}: ${result.flatName ?? "—"}`,
        `${s.resultMidi}: ${result.midi}`,
        `${s.resultFrequency}: ${proUnit(proNum(result.frequency, 3), s.unitHz)}`,
        nearest === undefined ? undefined : `${s.resultMidiExact}: ${proNum(nearest.midiExact, 4)}`,
        nearest === undefined ? undefined : `${s.resultCents}: ${proNum(nearest.cents, 2)}`,
        result.intervalToSecond === undefined
          ? undefined
          : `${s.resultIntervalCents}: ${proNum(result.intervalToSecond.cents, 3)}`,
        result.intervalToSecond === undefined
          ? undefined
          : `${s.resultIntervalRatio}: ${proNum(result.intervalToSecond.ratio, 6)}`,
        result.shifted === undefined ? undefined : `${s.resultShiftedName}: ${result.shifted.name ?? "—"}`,
        result.shifted === undefined
          ? undefined
          : `${s.resultShiftedFrequency}: ${proUnit(proNum(result.shifted.frequency, 3), s.unitHz)}`,
        "",
        `${s.entryKind}: ${entryLabel}`,
        `${s.referencePitch}: ${proUnit(proNum(proParse(referencePitchText) ?? 440, 1), s.unitHz)}`,
        `${s.octaveConvention}: ${conventionLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<"midi" | "name" | "frequency">
        label={s.entryKind}
        value={entryKind}
        onChange={setEntryKind}
        options={[
          { id: "name", label: s.entryName },
          { id: "midi", label: s.entryMidi },
          { id: "frequency", label: s.entryFrequency },
        ]}
      />
      {entryKind === "midi" && <ToolInput label={s.midi} hint={s.midiHint} value={midiText} onChange={setMidiText} />}
      {entryKind === "name" && <ToolInput label={s.name} hint={s.nameHint} value={nameText} onChange={setNameText} />}
      {entryKind === "frequency" && <ToolInput label={s.frequency} value={freqText} onChange={setFreqText} />}
      <ToolInput
        label={s.referencePitch}
        hint={s.referencePitchHint}
        value={referencePitchText}
        onChange={setReferencePitchText}
      />
      <ToolSelect<OctaveConvention>
        label={s.octaveConvention}
        value={octaveConvention}
        onChange={setOctaveConvention}
        options={[
          { id: "scientific", label: s.octaveConventionScientific },
          { id: "yamaha", label: s.octaveConventionYamaha },
        ]}
      />
      <ToolInput
        label={s.secondFrequency}
        hint={s.secondFrequencyHint}
        value={secondFrequencyText}
        onChange={setSecondFrequencyText}
      />
      <ToolInput
        label={s.pitchShiftCents}
        hint={s.pitchShiftCentsHint}
        value={pitchShiftCentsText}
        onChange={setPitchShiftCentsText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultName} value={result.name ?? "—"} />
          <ResultRow label={s.resultFlatName} value={result.flatName ?? "—"} />
          <ResultRow label={s.resultMidi} value={result.midi} />
          <ResultRow label={s.resultFrequency} value={proUnit(proNum(result.frequency, 3), s.unitHz)} />
          {result.outsideMidiRange && <p className="tool__note">{s.outsideMidiRangeNote}</p>}
          {nearest !== undefined && (
            <>
              <ResultRow label={s.resultMidiExact} value={proNum(nearest.midiExact, 4)} />
              <ResultRow label={s.resultCents} value={proUnit(proNum(nearest.cents, 2), s.unitCent)} />
            </>
          )}
          {result.intervalToSecond !== undefined && (
            <ToolSection title={s.intervalTitle}>
              <ResultRow
                label={s.resultIntervalCents}
                value={proUnit(proNum(result.intervalToSecond.cents, 3), s.unitCent)}
              />
              <ResultRow
                label={s.resultIntervalSemitones}
                value={proUnit(proNum(result.intervalToSecond.semitones, 4), s.unitSemitone)}
              />
              <ResultRow label={s.resultIntervalRatio} value={proNum(result.intervalToSecond.ratio, 6)} />
              {result.intervalToSecond.resultFrequency !== undefined && (
                <ResultRow
                  label={s.resultIntervalResultFrequency}
                  value={proUnit(proNum(result.intervalToSecond.resultFrequency, 3), s.unitHz)}
                />
              )}
              {result.intervalToSecond.beatHz !== undefined && (
                <ResultRow label={s.resultBeatHz} value={proUnit(proNum(result.intervalToSecond.beatHz, 3), s.unitHz)} />
              )}
            </ToolSection>
          )}
          {result.shifted !== undefined && (
            <ToolSection title={s.shiftedTitle}>
              <ResultRow label={s.resultShiftedName} value={result.shifted.name ?? "—"} />
              <ResultRow
                label={s.resultShiftedFrequency}
                value={proUnit(proNum(result.shifted.frequency, 3), s.unitHz)}
              />
              <ResultRow label={s.resultShiftedCents} value={proUnit(proNum(result.shifted.cents, 2), s.unitCent)} />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.entryKind, value: entryLabel },
              { label: s.referencePitch, value: proUnit(proNum(proParse(referencePitchText) ?? 440, 1), s.unitHz) },
              { label: s.octaveConvention, value: conventionLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** MB/GB are decimal (10ⁿ), MiB/GiB binary (2ⁿ) — IEC 80000-13, the same split `pcmSize` reports both halves of. */
type SizeUnit = "mb" | "gb" | "mib" | "gib";
const SIZE_UNIT_BYTES: Record<SizeUnit, number> = { mb: 1e6, gb: 1e9, mib: 2 ** 20, gib: 2 ** 30 };

/**
 * How much room an uncompressed take needs, at what data rate, or — the
 * other direction — how much recording time a stated amount of space holds.
 */
export function PcmFileSizeTool() {
  const s = strings.pro.muzika["pcm-file-size"];
  const [direction, setDirection] = useState<"fromDuration" | "fromSize">("fromDuration");
  const [durationText, setDurationText] = useState("");
  const [sizeText, setSizeText] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("mb");
  const [sampleRateText, setSampleRateText] = useState("");
  const [bitDepth, setBitDepth] = useState<BitDepthOption>("16");
  const [channelsText, setChannelsText] = useState("");
  const [tracksText, setTracksText] = useState("");
  const [includeHeader, setIncludeHeader] = useState<"yes" | "no">("no");

  const format = {
    sampleRate: proParse(sampleRateText) ?? Number.NaN,
    bitDepth: BIT_DEPTH_VALUES[bitDepth],
    channels: proParse(channelsText) ?? Number.NaN,
    tracks: proParse(tracksText),
    includeHeader: includeHeader === "yes",
  };
  const sizeParsed = proParse(sizeText);
  const bytesTyped = sizeParsed === undefined ? undefined : sizeParsed * SIZE_UNIT_BYTES[sizeUnit];

  const typed = direction === "fromDuration" ? proParse(durationText) !== undefined : sizeParsed !== undefined;

  const forward = pcmSize({ ...format, seconds: proParse(durationText) ?? Number.NaN } satisfies PcmSizeInput);
  const inverse = pcmDuration({ ...format, bytes: bytesTyped ?? Number.NaN } satisfies PcmDurationInput);
  const result = direction === "fromDuration" ? forward : inverse;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "sampleRate"
        ? s.errorSampleRate
        : result.reason === "bitDepth"
          ? s.errorBitDepth
          : result.reason === "channels"
            ? s.errorChannels
            : result.reason === "tracks"
              ? s.errorTracks
              : result.reason === "seconds"
                ? s.errorSeconds
                : s.errorBytes;

  const headerLabel = includeHeader === "yes" ? s.yes : s.no;

  const copyText = !result.ok
    ? ""
    : [
        "bytes" in result
          ? `${s.resultBytes}: ${proNum(result.bytes, 0)}`
          : `${s.resultSeconds}: ${proUnit(proNum(result.seconds, 3), s.unitS)}`,
        "formatted" in result ? `${s.resultFormatted}: ${result.formatted}` : undefined,
        "megabytes" in result ? `${s.resultMegabytes}: ${proUnit(proNum(result.megabytes, 3), s.unitMb)}` : undefined,
        "gibibytes" in result ? `${s.resultGibibytes}: ${proUnit(proNum(result.gibibytes, 3), s.unitGib)}` : undefined,
        `${s.resultHeaderBytes}: ${proNum(result.headerBytes, 0)}`,
        `${s.resultBytesPerSecond}: ${proNum(result.bytesPerSecond, 0)}`,
        "bitrateKbps" in result ? `${s.resultBitrate}: ${proUnit(proNum(result.bitrateKbps, 3), s.unitKbps)}` : undefined,
        "",
        `${s.sampleRate}: ${sampleRateText.trim()}`,
        `${s.bitDepth}: ${bitDepth}`,
        `${s.channels}: ${channelsText.trim()}`,
        `${s.includeHeader}: ${headerLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<"fromDuration" | "fromSize">
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "fromDuration", label: s.directionFromDuration },
          { id: "fromSize", label: s.directionFromSize },
        ]}
      />
      {direction === "fromDuration" ? (
        <ToolInput label={s.duration} hint={s.durationHint} value={durationText} onChange={setDurationText} />
      ) : (
        <>
          <ToolInput label={s.size} value={sizeText} onChange={setSizeText} />
          <ToolSelect<SizeUnit>
            label={s.sizeUnit}
            value={sizeUnit}
            onChange={setSizeUnit}
            options={[
              { id: "mb", label: s.sizeUnitMb },
              { id: "gb", label: s.sizeUnitGb },
              { id: "mib", label: s.sizeUnitMib },
              { id: "gib", label: s.sizeUnitGib },
            ]}
          />
        </>
      )}
      <ToolInput label={s.sampleRate} value={sampleRateText} onChange={setSampleRateText} />
      <ToolSelect<BitDepthOption>
        label={s.bitDepth}
        value={bitDepth}
        onChange={setBitDepth}
        hint={s.bitDepth32Note}
        options={BIT_DEPTH_OPTIONS.map((id) => ({ id, label: id }))}
      />
      <ToolInput label={s.channels} value={channelsText} onChange={setChannelsText} />
      <ToolInput label={s.tracks} hint={s.tracksHint} value={tracksText} onChange={setTracksText} />
      <ToolSelect<"yes" | "no">
        label={s.includeHeader}
        value={includeHeader}
        onChange={setIncludeHeader}
        options={[
          { id: "no", label: s.no },
          { id: "yes", label: s.yes },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {"bytes" in result ? (
            <>
              <ResultRow label={s.resultBytes} value={proUnit(proNum(result.bytes, 0), s.unitB)} />
              <ResultRow label={s.resultMegabytes} value={proUnit(proNum(result.megabytes, 3), s.unitMb)} />
              <ResultRow label={s.resultGigabytes} value={proUnit(proNum(result.gigabytes, 3), s.unitGb)} />
              <ResultRow label={s.resultMebibytes} value={proUnit(proNum(result.mebibytes, 3), s.unitMib)} />
              <ResultRow label={s.resultGibibytes} value={proUnit(proNum(result.gibibytes, 3), s.unitGib)} />
              {result.exceedsWav32BitRange && <p className="tool__note">{s.exceedsNote}</p>}
              <ResultRow label={s.resultBitrate} value={proUnit(proNum(result.bitrateKbps, 3), s.unitKbps)} />
            </>
          ) : (
            <>
              <ResultRow label={s.resultSeconds} value={proUnit(proNum(result.seconds, 3), s.unitS)} />
              <ResultRow label={s.resultFormatted} value={result.formatted} />
            </>
          )}
          <ResultRow label={s.resultHeaderBytes} value={proUnit(proNum(result.headerBytes, 0), s.unitB)} />
          <ResultRow label={s.resultBytesPerSecond} value={proNum(result.bytesPerSecond, 0)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sampleRate, value: proUnit(sampleRateText.trim(), s.unitHz) },
              { label: s.bitDepth, value: bitDepth },
              { label: s.channels, value: channelsText.trim() },
              { label: s.includeHeader, value: headerLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * RT60 by Sabine and by Eyring, per octave band, from the user's own
 * absorption coefficients — no material table is embedded, because alpha
 * belongs to a specific product's data sheet.
 */
export function ReverbTimeTool() {
  const s = strings.pro.muzika["reverb-time"];
  const [volumeText, setVolumeText] = useState("");
  const [temperatureText, setTemperatureText] = useState("");
  const [surfacesText, setSurfacesText] = useState("");
  const [air125Text, setAir125Text] = useState("");
  const [air250Text, setAir250Text] = useState("");
  const [air500Text, setAir500Text] = useState("");
  const [air1000Text, setAir1000Text] = useState("");
  const [air2000Text, setAir2000Text] = useState("");
  const [air4000Text, setAir4000Text] = useState("");

  const rows = proRows(surfacesText);
  const typed = rows.length > 0;
  const surfaces: AbsorptionSurface[] = rows.map((row) => ({
    area: proParse(row[0] ?? "") ?? Number.NaN,
    alpha125: proParse(row[1] ?? "") ?? Number.NaN,
    alpha250: proParse(row[2] ?? "") ?? Number.NaN,
    alpha500: proParse(row[3] ?? "") ?? Number.NaN,
    alpha1000: proParse(row[4] ?? "") ?? Number.NaN,
    alpha2000: proParse(row[5] ?? "") ?? Number.NaN,
    alpha4000: proParse(row[6] ?? "") ?? Number.NaN,
  }));
  const airAbsorption: AirAbsorptionCoefficients = {
    at125: proParse(air125Text),
    at250: proParse(air250Text),
    at500: proParse(air500Text),
    at1000: proParse(air1000Text),
    at2000: proParse(air2000Text),
    at4000: proParse(air4000Text),
  };

  const result = reverbTime({
    volume: proParse(volumeText) ?? Number.NaN,
    surfaces,
    temperature: proParse(temperatureText),
    airAbsorption,
  } satisfies ReverbTimeInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "temperature"
        ? s.errorTemperature
        : result.reason === "volume"
          ? s.errorVolume
          : result.reason.startsWith("at")
            ? s.errorAirAbsorption
            : s.errorSurfaces;

  const bandLabel = (band: ReverbBand): string => `${band} ${s.unitHz}`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.speedOfSound}: ${proUnit(proNum(result.speedOfSound, 4), s.unitMps)}`,
        `${s.totalArea}: ${proUnit(proNum(result.totalArea, 3), s.unitM2)}`,
        ...result.bands.map(
          (band) =>
            `${bandLabel(band.band)}: A=${proNum(band.absorption, 3)}, Sabine=${band.sabine === undefined ? "—" : proNum(band.sabine, 3)}, Eyring=${band.eyring === undefined ? "—" : proNum(band.eyring, 3)}`,
        ),
        "",
        `${s.volume}: ${proUnit(proNum(proParse(volumeText) ?? 0, 3), s.unitM3)}`,
        `${s.temperature}: ${proUnit(proNum(result.temperatureUsed, 1), s.unitC)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.volume} value={volumeText} onChange={setVolumeText} />
      <ToolInput label={s.temperature} hint={s.temperatureHint} value={temperatureText} onChange={setTemperatureText} />
      <ToolTextArea label={s.surfaces} hint={s.surfacesHint} value={surfacesText} onChange={setSurfacesText} />
      <ToolInput label={`${s.airAbsorption} — ${s.air125}`} hint={s.airAbsorptionHint} value={air125Text} onChange={setAir125Text} />
      <ToolInput label={`${s.airAbsorption} — ${s.air250}`} value={air250Text} onChange={setAir250Text} />
      <ToolInput label={`${s.airAbsorption} — ${s.air500}`} value={air500Text} onChange={setAir500Text} />
      <ToolInput label={`${s.airAbsorption} — ${s.air1000}`} value={air1000Text} onChange={setAir1000Text} />
      <ToolInput label={`${s.airAbsorption} — ${s.air2000}`} value={air2000Text} onChange={setAir2000Text} />
      <ToolInput label={`${s.airAbsorption} — ${s.air4000}`} value={air4000Text} onChange={setAir4000Text} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.speedOfSound} value={proUnit(proNum(result.speedOfSound, 4), s.unitMps)} />
          <ResultRow label={s.totalArea} value={proUnit(proNum(result.totalArea, 3), s.unitM2)} />
          <ToolTable
            head={[s.colBand, s.colAbsorption, s.colAverageAlpha, s.colSabine, s.colSabineWithAir, s.colEyring]}
            rows={result.bands.map((band) => [
              bandLabel(band.band),
              proNum(band.absorption, 3),
              proNum(band.averageAlpha, 4),
              band.sabine === undefined ? s.noValue : proNum(band.sabine, 3),
              band.sabineWithAir === undefined ? s.noValue : proNum(band.sabineWithAir, 3),
              band.eyring === undefined ? s.noValue : proNum(band.eyring, 3),
            ])}
          />
          <p className="tool__note">{s.sabineLimitNote}</p>
          <p className="tool__note">{s.divergenceNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.volume, value: proUnit(proNum(proParse(volumeText) ?? 0, 3), s.unitM3) },
              { label: s.temperature, value: proUnit(proNum(result.temperatureUsed, 1), s.unitC) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Rayleigh's modal frequencies for a rigid rectangular box, sorted, with the
 * gap to the previous mode beside each — no rating, no "problem point": just
 * the list, because a weighted score would be an invented pointer this
 * review's own corrections refuse to add.
 */
export function RoomModesTool() {
  const s = strings.pro.muzika["room-modes"];
  const [lengthText, setLengthText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [temperatureText, setTemperatureText] = useState("");
  const [frequencyLimitText, setFrequencyLimitText] = useState("");
  const [maxOrderText, setMaxOrderText] = useState("");

  const typed =
    proParse(lengthText) !== undefined || proParse(widthText) !== undefined || proParse(heightText) !== undefined;

  const result = roomModes({
    length: proParse(lengthText) ?? Number.NaN,
    width: proParse(widthText) ?? Number.NaN,
    height: proParse(heightText) ?? Number.NaN,
    temperature: proParse(temperatureText),
    frequencyLimit: proParse(frequencyLimitText),
    maxOrder: proParse(maxOrderText),
  } satisfies RoomModesInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "length"
        ? s.errorLength
        : result.reason === "width"
          ? s.errorWidth
          : result.reason === "height"
            ? s.errorHeight
            : result.reason === "temperature"
              ? s.errorTemperature
              : result.reason === "frequencyLimit"
                ? s.errorFrequencyLimit
                : s.errorMaxOrder;

  const typeLabel = (type: "axial" | "tangential" | "oblique"): string =>
    type === "axial" ? s.typeAxial : type === "tangential" ? s.typeTangential : s.typeOblique;

  const copyText = !result.ok
    ? ""
    : [
        `${s.speedOfSound}: ${proUnit(proNum(result.speedOfSound, 4), s.unitMps)}`,
        ...result.modes.map(
          (mode) =>
            `(${mode.p},${mode.q},${mode.r}) ${typeLabel(mode.type)}: ${proUnit(proNum(mode.frequency, 2), s.unitHz)}${mode.spacing === undefined ? "" : ` (+${proUnit(proNum(mode.spacing, 2), s.unitHz)})`}`,
        ),
        "",
        `${s.length}: ${proUnit(proNum(proParse(lengthText) ?? 0, 3), s.unitM)}`,
        `${s.width}: ${proUnit(proNum(proParse(widthText) ?? 0, 3), s.unitM)}`,
        `${s.height}: ${proUnit(proNum(proParse(heightText) ?? 0, 3), s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.length} value={lengthText} onChange={setLengthText} />
      <ToolInput label={s.width} value={widthText} onChange={setWidthText} />
      <ToolInput label={s.height} value={heightText} onChange={setHeightText} />
      <ToolInput label={s.temperature} hint={s.temperatureHint} value={temperatureText} onChange={setTemperatureText} />
      <ToolInput
        label={s.frequencyLimit}
        hint={s.frequencyLimitHint}
        value={frequencyLimitText}
        onChange={setFrequencyLimitText}
      />
      <ToolInput label={s.maxOrder} hint={s.maxOrderHint} value={maxOrderText} onChange={setMaxOrderText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.speedOfSound} value={proUnit(proNum(result.speedOfSound, 4), s.unitMps)} />
          <ToolTable
            head={[s.colIndex, s.colFrequency, s.colType, s.colSpacing]}
            rows={result.modes.map((mode) => [
              `(${mode.p}, ${mode.q}, ${mode.r})`,
              proNum(mode.frequency, 2),
              typeLabel(mode.type),
              mode.spacing === undefined ? "—" : proNum(mode.spacing, 2),
            ])}
          />
          <p className="tool__note">{s.idealizationNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(proParse(lengthText) ?? 0, 3), s.unitM) },
              { label: s.width, value: proUnit(proNum(proParse(widthText) ?? 0, 3), s.unitM) },
              { label: s.height, value: proUnit(proNum(proParse(heightText) ?? 0, 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Buffer latency, one way and round trip, and the reciprocal question of
 * samples and milliseconds at a sample rate — two related calculations that
 * share one sample-rate field but are otherwise independent.
 */
export function SampleBufferLatencyTool() {
  const s = strings.pro.muzika["sample-buffer-latency"];
  const [sampleRateText, setSampleRateText] = useState("");
  const [bufferSamplesText, setBufferSamplesText] = useState("");
  const [extraInMsText, setExtraInMsText] = useState("");
  const [extraOutMsText, setExtraOutMsText] = useState("");
  const [msText, setMsText] = useState("");
  const [samplesText, setSamplesText] = useState("");
  const [lastEdited, setLastEdited] = useState<"ms" | "samples" | undefined>(undefined);

  const sampleRate = proParse(sampleRateText) ?? Number.NaN;
  const bufferTyped = proParse(bufferSamplesText) !== undefined;
  const buffer = bufferLatency({
    sampleRate,
    bufferSamples: proParse(bufferSamplesText) ?? Number.NaN,
    extraInMs: proParse(extraInMsText),
    extraOutMs: proParse(extraOutMsText),
  } satisfies BufferLatencyInput);
  const bufferFailure =
    buffer.ok || !bufferTyped
      ? undefined
      : buffer.reason === "sampleRate"
        ? s.errorSampleRate
        : buffer.reason === "bufferSamples"
          ? s.errorBufferSamples
          : buffer.reason === "extraInMs"
            ? s.errorExtraInMs
            : s.errorExtraOutMs;

  const direction = lastEdited ?? (proParse(msText) !== undefined ? "ms" : "samples");
  const convertTyped = proParse(msText) !== undefined || proParse(samplesText) !== undefined;
  const fromMs = sampleCount({ sampleRate, milliseconds: proParse(msText) ?? Number.NaN } satisfies SampleCountInput);
  const fromSamples = sampleDuration({
    sampleRate,
    samples: proParse(samplesText) ?? Number.NaN,
  } satisfies SampleDurationInput);
  const convertResult = direction === "ms" ? fromMs : fromSamples;
  const convertFailure =
    convertResult.ok || !convertTyped
      ? undefined
      : convertResult.reason === "sampleRate"
        ? s.errorSampleRate
        : convertResult.reason === "milliseconds"
          ? s.errorMilliseconds
          : s.errorSamples;

  const bufferCopy = !buffer.ok
    ? ""
    : [
        `${s.resultOneWayMs}: ${proUnit(proNum(buffer.oneWayMs, 4), s.unitMs)}`,
        `${s.resultBufferRoundTripMs}: ${proUnit(proNum(buffer.bufferRoundTripMs, 4), s.unitMs)}`,
        buffer.oneWayInMs === undefined ? undefined : `${s.resultOneWayInMs}: ${proUnit(proNum(buffer.oneWayInMs, 4), s.unitMs)}`,
        buffer.oneWayOutMs === undefined ? undefined : `${s.resultOneWayOutMs}: ${proUnit(proNum(buffer.oneWayOutMs, 4), s.unitMs)}`,
        buffer.roundTripMs === undefined ? undefined : `${s.resultRoundTripMs}: ${proUnit(proNum(buffer.roundTripMs, 4), s.unitMs)}`,
        "",
        `${s.sampleRate}: ${sampleRateText.trim()}`,
        `${s.bufferSamples}: ${bufferSamplesText.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.sampleRate} value={sampleRateText} onChange={setSampleRateText} />
      <ToolInput label={s.bufferSamples} value={bufferSamplesText} onChange={setBufferSamplesText} />
      <ToolInput label={s.extraInMs} hint={s.extraInMsHint} value={extraInMsText} onChange={setExtraInMsText} />
      <ToolInput label={s.extraOutMs} hint={s.extraOutMsHint} value={extraOutMsText} onChange={setExtraOutMsText} />

      {bufferFailure !== undefined && <ToolFailure>{bufferFailure}</ToolFailure>}
      {buffer.ok && (
        <ToolSection title={s.resultsBuffer}>
          <ResultRow label={s.resultOneWayMs} value={proUnit(proNum(buffer.oneWayMs, 4), s.unitMs)} />
          <ResultRow label={s.resultBufferRoundTripMs} value={proUnit(proNum(buffer.bufferRoundTripMs, 4), s.unitMs)} />
          {buffer.oneWayInMs !== undefined && (
            <ResultRow label={s.resultOneWayInMs} value={proUnit(proNum(buffer.oneWayInMs, 4), s.unitMs)} />
          )}
          {buffer.oneWayOutMs !== undefined && (
            <ResultRow label={s.resultOneWayOutMs} value={proUnit(proNum(buffer.oneWayOutMs, 4), s.unitMs)} />
          )}
          {buffer.roundTripMs !== undefined && (
            <ResultRow label={s.resultRoundTripMs} value={proUnit(proNum(buffer.roundTripMs, 4), s.unitMs)} />
          )}
          <p className="tool__note">{s.theoreticalNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sampleRate, value: sampleRateText.trim() },
              { label: s.bufferSamples, value: bufferSamplesText.trim() },
            ]}
          />
          <CopyButton value={bufferCopy} />
        </ToolSection>
      )}

      <ToolInput
        label={s.msToSamples}
        hint={s.msToSamplesHint}
        value={msText}
        onChange={(value) => {
          setMsText(value);
          setLastEdited("ms");
        }}
      />
      <ToolInput
        label={s.samplesInput}
        hint={s.samplesInputHint}
        value={samplesText}
        onChange={(value) => {
          setSamplesText(value);
          setLastEdited("samples");
        }}
      />
      {convertFailure !== undefined && <ToolFailure>{convertFailure}</ToolFailure>}
      {convertResult.ok && (
        <ToolSection title={s.resultsConvert}>
          {"samples" in convertResult ? (
            <>
              <ResultRow label={s.resultSamples} value={proNum(convertResult.samples, 4)} />
              {!convertResult.wholeSamples && <p className="tool__note">{s.wholeSamplesNote}</p>}
            </>
          ) : (
            <ResultRow label={s.resultMilliseconds} value={proUnit(proNum(convertResult.milliseconds, 4), s.unitMs)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          {/* The converter reads the sample rate typed at the top of the tool,
              which is nowhere in this section. Without it „4410 odbiraka" is a
              number with no unit of time attached, on screen and in the copy. */}
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sampleRate, value: sampleRateText.trim() },
              {
                label: direction === "ms" ? s.msToSamples : s.samplesInput,
                value: (direction === "ms" ? msText : samplesText).trim(),
              },
            ]}
          />
          <CopyButton
            value={[
              "samples" in convertResult
                ? `${s.resultSamples}: ${proNum(convertResult.samples, 4)}`
                : `${s.resultMilliseconds}: ${proUnit(proNum(convertResult.milliseconds, 4), s.unitMs)}`,
              `${s.sampleRate}: ${sampleRateText.trim()}`,
            ].join("\n")}
          />
        </ToolSection>
      )}
    </>
  );
}

const SCALE_TYPE_OPTIONS: readonly ScaleType[] = [
  "major",
  "natural-minor",
  "harmonic-minor",
  "melodic-minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian",
  "major-pentatonic",
  "minor-pentatonic",
  "blues",
];

const CHORD_TYPE_OPTIONS: readonly ChordType[] = [
  "maj",
  "min",
  "dim",
  "aug",
  "sus2",
  "sus4",
  "6",
  "m6",
  "7",
  "maj7",
  "m7",
  "m7b5",
  "dim7",
  "9",
  "m9",
  "maj9",
  "11",
  "13",
];

/**
 * Scale and chord spelling by LETTER order — key signature and diatonic
 * triads follow for a seven-note scale. The letter, not the pitch class,
 * chooses the name, which is what lets Eb minor spell six flats.
 */
export function ScaleChordSpellerTool() {
  const s = strings.pro.muzika["scale-chord-speller"];
  const [rootText, setRootText] = useState("");
  const [kind, setKind] = useState<"scale" | "chord">("scale");
  const [scaleType, setScaleType] = useState<ScaleType>("major");
  const [chordType, setChordType] = useState<ChordType>("maj");

  const typed = rootText.trim() !== "";
  const scaleResult = spellScale({ root: rootText, scale: scaleType });
  const chordResult = spellChord({ root: rootText, chord: chordType });
  const result = kind === "scale" ? scaleResult : chordResult;
  // `SpelledChord` carries no `keySignature`/`triads` at all, but an `in`
  // check on the `result` union cannot eliminate that branch — an interface
  // admits excess properties structurally, so TypeScript can only widen with
  // `& Record<K, unknown>` rather than narrow. `kind` is the real discriminant.
  const scale = kind === "scale" && scaleResult.ok ? scaleResult : undefined;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "root"
        ? s.errorRoot
        : result.reason === "scale"
          ? s.errorScale
          : s.errorChord;

  const scaleLabel = (t: ScaleType): string =>
    t === "major"
      ? s.scaleMajor
      : t === "natural-minor"
        ? s.scaleNaturalMinor
        : t === "harmonic-minor"
          ? s.scaleHarmonicMinor
          : t === "melodic-minor"
            ? s.scaleMelodicMinor
            : t === "dorian"
              ? s.scaleDorian
              : t === "phrygian"
                ? s.scalePhrygian
                : t === "lydian"
                  ? s.scaleLydian
                  : t === "mixolydian"
                    ? s.scaleMixolydian
                    : t === "locrian"
                      ? s.scaleLocrian
                      : t === "major-pentatonic"
                        ? s.scaleMajorPentatonic
                        : t === "minor-pentatonic"
                          ? s.scaleMinorPentatonic
                          : s.scaleBlues;

  const chordLabel = (t: ChordType): string =>
    t === "maj"
      ? s.chordMaj
      : t === "min"
        ? s.chordMin
        : t === "dim"
          ? s.chordDim
          : t === "aug"
            ? s.chordAug
            : t === "sus2"
              ? s.chordSus2
              : t === "sus4"
                ? s.chordSus4
                : t === "6"
                  ? s.chord6
                  : t === "m6"
                    ? s.chordM6
                    : t === "7"
                      ? s.chord7
                      : t === "maj7"
                        ? s.chordMaj7
                        : t === "m7"
                          ? s.chordM7
                          : t === "m7b5"
                            ? s.chordM7b5
                            : t === "dim7"
                              ? s.chordDim7
                              : t === "9"
                                ? s.chord9
                                : t === "m9"
                                  ? s.chordM9
                                  : t === "maj9"
                                    ? s.chordMaj9
                                    : t === "11"
                                      ? s.chord11
                                      : s.chord13;

  const qualityLabel = (t: TriadQuality): string =>
    t === "major" ? s.qualityMajor : t === "minor" ? s.qualityMinor : t === "diminished" ? s.qualityDiminished : s.qualityAugmented;

  const copyText = !result.ok
    ? ""
    : [
        ...result.notes.map((note, index) => `${index + 1}: ${note.name ?? s.unspellableCell} (${note.semitones})`),
        scale === undefined
          ? undefined
          : scale.keySignature === undefined
            ? `${s.keySignatureTitle}: ${s.keyNone}`
            : `${s.keySignatureTitle}: ${s.resultSharps} ${scale.keySignature.sharps}, ${s.resultFlats} ${scale.keySignature.flats}`,
        "",
        `${s.root}: ${rootText.trim()}`,
        `${s.kind}: ${kind === "scale" ? s.kindScale : s.kindChord}`,
        kind === "scale" ? `${s.scaleType}: ${scaleLabel(scaleType)}` : `${s.chordType}: ${chordLabel(chordType)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.root} hint={s.rootHint} value={rootText} onChange={setRootText} />
      <ToolSelect<"scale" | "chord">
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "scale", label: s.kindScale },
          { id: "chord", label: s.kindChord },
        ]}
      />
      {kind === "scale" ? (
        <ToolSelect<ScaleType>
          label={s.scaleType}
          value={scaleType}
          onChange={setScaleType}
          options={SCALE_TYPE_OPTIONS.map((id) => ({ id, label: scaleLabel(id) }))}
        />
      ) : (
        <ToolSelect<ChordType>
          label={s.chordType}
          value={chordType}
          onChange={setChordType}
          options={CHORD_TYPE_OPTIONS.map((id) => ({ id, label: chordLabel(id) }))}
        />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colDegree, s.colNote, s.colSemitones]}
            rows={result.notes.map((note, index) => [String(index + 1), note.name ?? s.unspellableCell, String(note.semitones)])}
          />
          {result.notes.some((note) => note.name === undefined) && <p className="tool__note">{s.unspellableNote}</p>}

          {scale !== undefined && (
            <ToolSection title={s.keySignatureTitle}>
              {scale.keySignature === undefined ? (
                <ResultRow label={s.keySignatureTitle} value={s.keyNone} />
              ) : (
                <>
                  <ResultRow label={s.resultSharps} value={scale.keySignature.sharps} />
                  <ResultRow label={s.resultFlats} value={scale.keySignature.flats} />
                  {scale.keySignature.mixed && <p className="tool__note">{s.mixedNote}</p>}
                  {scale.keySignatureIsRelative && <p className="tool__note">{s.relativeNote}</p>}
                </>
              )}
            </ToolSection>
          )}

          {scale !== undefined && scale.triads !== undefined && (
            <ToolSection title={s.triadsTitle}>
              <ToolTable
                head={[s.colTriadDegree, s.colTriadNotes, s.colTriadQuality]}
                rows={scale.triads.map((triad) => [
                  String(triad.degree),
                  triad.notes.map((note) => note ?? s.unspellableCell).join(" "),
                  triad.quality === undefined
                    ? `${s.qualityUnnamed} (${triad.gaps[0]}, ${triad.gaps[1]})`
                    : qualityLabel(triad.quality),
                ])}
              />
            </ToolSection>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.root, value: rootText.trim() },
              { label: s.kind, value: kind === "scale" ? s.kindScale : s.kindChord },
              kind === "scale"
                ? { label: s.scaleType, value: scaleLabel(scaleType) }
                : { label: s.chordType, value: chordLabel(chordType) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Wavelength and speed of sound at a stated air temperature, either
 * direction — the temperature is in the answer rather than baked into a
 * fixed 343 m/s.
 */
export function SoundWavelengthTool() {
  const s = strings.pro.muzika["sound-wavelength"];
  const [entryKind, setEntryKind] = useState<SoundWaveEntry["kind"]>("frequency");
  const [valueText, setValueText] = useState("");
  const [temperatureText, setTemperatureText] = useState("");
  const [distanceText, setDistanceText] = useState("");
  const [speedOverrideText, setSpeedOverrideText] = useState("");

  const typed = proParse(valueText) !== undefined;
  const entry: SoundWaveEntry = { kind: entryKind, value: proParse(valueText) ?? Number.NaN };
  const result = soundWavelength({
    entry,
    temperature: proParse(temperatureText),
    distance: proParse(distanceText),
    speedOverride: proParse(speedOverrideText),
  } satisfies SoundWavelengthInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "frequency"
        ? s.errorFrequency
        : result.reason === "wavelength"
          ? s.errorWavelength
          : result.reason === "temperature"
            ? s.errorTemperature
            : result.reason === "distance"
              ? s.errorDistance
              : s.errorSpeedOverride;

  const entryLabel = entryKind === "frequency" ? s.entryFrequency : s.entryWavelength;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultSpeedOfSound}: ${proUnit(proNum(result.speedOfSound, 3), s.unitMps)}`,
        `${s.resultFrequency}: ${proUnit(proNum(result.frequency, 3), s.unitHz)}`,
        `${s.resultWavelength}: ${proUnit(proNum(result.wavelength, 4), s.unitM)}`,
        `${s.resultHalfWavelength}: ${proUnit(proNum(result.halfWavelength, 4), s.unitM)}`,
        `${s.resultQuarterWavelength}: ${proUnit(proNum(result.quarterWavelength, 4), s.unitM)}`,
        `${s.resultDelayPerMetre}: ${proUnit(proNum(result.delayPerMetreMs, 4), s.unitMs)}`,
        result.delayMs === undefined ? undefined : `${s.resultDelay}: ${proUnit(proNum(result.delayMs, 3), s.unitMs)}`,
        "",
        `${s.entryKind}: ${entryLabel}`,
        `${s.value}: ${valueText.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<SoundWaveEntry["kind"]>
        label={s.entryKind}
        value={entryKind}
        onChange={setEntryKind}
        options={[
          { id: "frequency", label: s.entryFrequency },
          { id: "wavelength", label: s.entryWavelength },
        ]}
      />
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolInput label={s.temperature} hint={s.temperatureHint} value={temperatureText} onChange={setTemperatureText} />
      <ToolInput label={s.distance} hint={s.distanceHint} value={distanceText} onChange={setDistanceText} />
      <ToolInput
        label={s.speedOverride}
        hint={s.speedOverrideHint}
        value={speedOverrideText}
        onChange={setSpeedOverrideText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultSpeedOfSound} value={proUnit(proNum(result.speedOfSound, 3), s.unitMps)} />
          <ResultRow label={s.resultFrequency} value={proUnit(proNum(result.frequency, 3), s.unitHz)} />
          <ResultRow label={s.resultWavelength} value={proUnit(proNum(result.wavelength, 4), s.unitM)} />
          <ResultRow label={s.resultWavelengthCm} value={proUnit(proNum(result.wavelength * 100, 2), s.unitCm)} />
          <ResultRow label={s.resultHalfWavelength} value={proUnit(proNum(result.halfWavelength, 4), s.unitM)} />
          <ResultRow label={s.resultQuarterWavelength} value={proUnit(proNum(result.quarterWavelength, 4), s.unitM)} />
          <ResultRow label={s.resultDelayPerMetre} value={proUnit(proNum(result.delayPerMetreMs, 4), s.unitMs)} />
          {result.delayMs !== undefined && (
            <ResultRow label={s.resultDelay} value={proUnit(proNum(result.delayMs, 3), s.unitMs)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.entryKind, value: entryLabel },
              { label: s.value, value: valueText.trim() },
              // Omitted, not defaulted: a speed typed in directly came from no
              // temperature, and the echo used to print 20 °C beside it anyway.
              ...(result.temperatureUsed === undefined
                ? [
                    {
                      label: s.speedOverride,
                      value: proUnit(proNum(result.speedOfSound, 2), s.unitMps),
                    },
                  ]
                : [
                    {
                      label: s.temperature,
                      value: proUnit(proNum(result.temperatureUsed, 1), s.unitC),
                    },
                  ]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Total impedance of a speaker load and the power each cabinet takes.
 *
 * **`life-safety`.** The minimum rated load is the user's own typed figure,
 * read off their amplifier's data sheet — never a default, never embedded.
 * What comes back is the computed impedance, that figure, and their ratio,
 * via `ToolAgainstLimit`. No word says whether an amplifier will survive the
 * load: that depends on the amplifier, the bridging mode and the programme
 * material, none of which this app has been told.
 */
export function SpeakerLoadTool() {
  const s = strings.pro.muzika["speaker-load"];
  const [cabinetsText, setCabinetsText] = useState("");
  const [wiring, setWiring] = useState<SpeakerWiring>("parallel");
  const [powerText, setPowerText] = useState("");
  const [minimumLoadText, setMinimumLoadText] = useState("");

  const rows = proRows(cabinetsText);
  const typed = rows.length > 0;
  const cabinets: SpeakerCabinet[] = rows.map((row) => ({
    impedance: proParse(row[0] ?? "") ?? Number.NaN,
    group: proParse(row[1] ?? ""),
  }));

  const result = speakerLoad({
    cabinets,
    wiring,
    power: proParse(powerText),
    minimumLoad: proParse(minimumLoadText),
  } satisfies SpeakerLoadInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "cabinets"
        ? s.errorCabinets
        : result.reason === "impedance"
          ? s.errorImpedance
          : result.reason === "group"
            ? s.errorGroup
            : result.reason === "power"
              ? s.errorPower
              : s.errorMinimumLoad;

  const wiringLabel =
    wiring === "parallel" ? s.wiringParallel : wiring === "series" ? s.wiringSeries : s.wiringSeriesParallel;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultTotalImpedance}: ${proUnit(proNum(result.totalImpedance, 4), s.unitOhm)}`,
        result.driveVoltage === undefined
          ? undefined
          : `${s.resultDriveVoltage}: ${proUnit(proNum(result.driveVoltage, 4), s.unitV)}`,
        result.minimumLoad === undefined
          ? undefined
          : `${s.limitLabel}: ${proUnit(proNum(result.minimumLoad, 4), s.unitOhm)}`,
        result.loadRatio === undefined ? undefined : `${s.ratioLabel}: ${proRatio(result.loadRatio)}`,
        ...result.cabinets.map(
          (c, index) =>
            `${s.colCabinet} ${index + 1}: ${proUnit(proNum(c.impedance, 2), s.unitOhm)}, ${proNum(c.sharePercent, 2)} %${c.power === undefined ? "" : `, ${proUnit(proNum(c.power, 3), s.unitW)}`}`,
        ),
        "",
        `${s.wiring}: ${wiringLabel}`,
        `${s.power}: ${powerText.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.cabinets} hint={s.cabinetsHint} value={cabinetsText} onChange={setCabinetsText} />
      <ToolSelect<SpeakerWiring>
        label={s.wiring}
        value={wiring}
        onChange={setWiring}
        options={[
          { id: "parallel", label: s.wiringParallel },
          { id: "series", label: s.wiringSeries },
          { id: "series-parallel", label: s.wiringSeriesParallel },
        ]}
      />
      <ToolInput label={s.power} hint={s.powerHint} value={powerText} onChange={setPowerText} />
      <ToolInput label={s.minimumLoad} hint={s.minimumLoadHint} value={minimumLoadText} onChange={setMinimumLoadText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolAgainstLimit
            label={s.resultTotalImpedance}
            value={proUnit(proNum(result.totalImpedance, 4), s.unitOhm)}
            limitLabel={s.limitLabel}
            limit={
              result.minimumLoad === undefined ? undefined : proUnit(proNum(result.minimumLoad, 4), s.unitOhm)
            }
            ratioLabel={s.ratioLabel}
            ratio={proRatio(result.loadRatio)}
          />
          {result.driveVoltage !== undefined && (
            <ResultRow label={s.resultDriveVoltage} value={proUnit(proNum(result.driveVoltage, 4), s.unitV)} />
          )}
          <ToolTable
            head={[s.colCabinet, s.colImpedance, s.colShare, s.colPower]}
            rows={result.cabinets.map((c, index) => [
              String(index + 1),
              proUnit(proNum(c.impedance, 2), s.unitOhm),
              proNum(c.sharePercent, 2),
              c.power === undefined ? "—" : proNum(c.power, 3),
            ])}
          />
          <p className="tool__note">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.wiring, value: wiringLabel },
              { label: s.power, value: powerText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Sound pressure level at a distance, for a stated sensitivity and power.
 *
 * **`life-safety`.** The sound-level limit is the user's own figure — a
 * venue rule, a permit condition, a national regulation — never embedded,
 * never defaulted. What comes back is the computed level, that figure, and
 * their difference, via `ToolAgainstLimit`. No word says whether the level
 * is acceptable.
 */
export function SplDistanceTool() {
  const s = strings.pro.muzika["spl-distance"];
  const [sensitivityText, setSensitivityText] = useState("");
  const [sensitivityReference, setSensitivityReference] = useState<SplSensitivityReference>("1w");
  const [nominalImpedanceText, setNominalImpedanceText] = useState("");
  const [powerText, setPowerText] = useState("");
  const [distanceText, setDistanceText] = useState("");
  const [referenceDistanceText, setReferenceDistanceText] = useState("");
  const [secondDistanceText, setSecondDistanceText] = useState("");
  const [limitText, setLimitText] = useState("");

  const typed = [sensitivityText, powerText, distanceText].some((t) => proParse(t) !== undefined);

  const result = splAtDistance({
    sensitivity: proParse(sensitivityText) ?? Number.NaN,
    sensitivityReference,
    nominalImpedance: proParse(nominalImpedanceText),
    power: proParse(powerText) ?? Number.NaN,
    distance: proParse(distanceText) ?? Number.NaN,
    referenceDistance: proParse(referenceDistanceText),
    secondDistance: proParse(secondDistanceText),
    limit: proParse(limitText),
  } satisfies SplInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "sensitivity"
        ? s.errorSensitivity
        : result.reason === "sensitivityReference"
          ? s.errorSensitivityReference
          : result.reason === "nominalImpedance"
            ? s.errorNominalImpedance
            : result.reason === "power"
              ? s.errorPower
              : result.reason === "distance"
                ? s.errorDistance
                : result.reason === "referenceDistance"
                  ? s.errorReferenceDistance
                  : result.reason === "secondDistance"
                    ? s.errorSecondDistance
                    : s.errorLimit;

  const referenceLabel =
    sensitivityReference === "1w" ? s.sensitivityReference1w : s.sensitivityReference283v;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultLevel}: ${proUnit(proNum(result.level, 2), s.unitDb)}`,
        `${s.resultSensitivity1W}: ${proUnit(proNum(result.sensitivity1W, 2), s.unitDb)}`,
        `${s.resultPowerTerm}: ${proUnit(proNum(result.powerTermDb, 2), s.unitDb)}`,
        `${s.resultDistanceLoss}: ${proUnit(proNum(result.distanceLossDb, 2), s.unitDb)}`,
        result.secondLevel === undefined ? undefined : `${s.resultSecondLevel}: ${proUnit(proNum(result.secondLevel, 2), s.unitDb)}`,
        result.secondDifferenceDb === undefined
          ? undefined
          : `${s.resultSecondDifference}: ${proUnit(proNum(result.secondDifferenceDb, 2), s.unitDb)}`,
        result.limit === undefined ? undefined : `${s.limit}: ${proUnit(proNum(result.limit, 2), s.unitDb)}`,
        result.limitDifferenceDb === undefined
          ? undefined
          : `${s.resultLimitDifference}: ${proUnit(proNum(result.limitDifferenceDb, 2), s.unitDb)}`,
        result.limitPressureRatio === undefined ? undefined : `${s.ratioLabel}: ${proRatio(result.limitPressureRatio)}`,
        "",
        `${s.sensitivity}: ${sensitivityText.trim()}`,
        `${s.sensitivityReference}: ${referenceLabel}`,
        `${s.power}: ${powerText.trim()}`,
        `${s.distance}: ${distanceText.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.sensitivity} value={sensitivityText} onChange={setSensitivityText} />
      <ToolSelect<SplSensitivityReference>
        label={s.sensitivityReference}
        value={sensitivityReference}
        onChange={setSensitivityReference}
        options={[
          { id: "1w", label: s.sensitivityReference1w },
          { id: "2.83v", label: s.sensitivityReference283v },
        ]}
      />
      {sensitivityReference === "2.83v" && (
        <ToolInput
          label={s.nominalImpedance}
          hint={s.nominalImpedanceHint}
          value={nominalImpedanceText}
          onChange={setNominalImpedanceText}
        />
      )}
      <ToolInput label={s.power} value={powerText} onChange={setPowerText} />
      <ToolInput label={s.distance} value={distanceText} onChange={setDistanceText} />
      <ToolInput
        label={s.referenceDistance}
        hint={s.referenceDistanceHint}
        value={referenceDistanceText}
        onChange={setReferenceDistanceText}
      />
      <ToolInput
        label={s.secondDistance}
        hint={s.secondDistanceHint}
        value={secondDistanceText}
        onChange={setSecondDistanceText}
      />
      <ToolInput label={s.limit} hint={s.limitHint} value={limitText} onChange={setLimitText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolAgainstLimit
            label={s.resultLevel}
            value={proUnit(proNum(result.level, 2), s.unitDb)}
            limitLabel={s.limit}
            limit={result.limit === undefined ? undefined : proUnit(proNum(result.limit, 2), s.unitDb)}
            ratioLabel={s.ratioLabel}
            ratio={proRatio(result.limitPressureRatio)}
          />
          {result.limitDifferenceDb !== undefined && (
            <ResultRow label={s.resultLimitDifference} value={proUnit(proNum(result.limitDifferenceDb, 2), s.unitDb)} />
          )}
          <ResultRow label={s.resultSensitivity1W} value={proUnit(proNum(result.sensitivity1W, 2), s.unitDb)} />
          <ResultRow label={s.resultPowerTerm} value={proUnit(proNum(result.powerTermDb, 2), s.unitDb)} />
          <ResultRow label={s.resultDistanceLoss} value={proUnit(proNum(result.distanceLossDb, 2), s.unitDb)} />
          {result.secondLevel !== undefined && (
            <ResultRow label={s.resultSecondLevel} value={proUnit(proNum(result.secondLevel, 2), s.unitDb)} />
          )}
          {result.secondDifferenceDb !== undefined && (
            <ResultRow
              label={s.resultSecondDifference}
              value={proUnit(proNum(result.secondDifferenceDb, 2), s.unitDb)}
            />
          )}
          <p className="tool__note">{s.freeFieldNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sensitivity, value: sensitivityText.trim() },
              { label: s.sensitivityReference, value: referenceLabel },
              { label: s.power, value: powerText.trim() },
              { label: s.distance, value: distanceText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

const INTERVAL_OPTIONS: readonly IntervalName[] = [
  "unison",
  "minor-second",
  "major-second",
  "minor-third",
  "major-third",
  "perfect-fourth",
  "augmented-fourth",
  "diminished-fifth",
  "perfect-fifth",
  "minor-sixth",
  "major-sixth",
  "minor-seventh",
  "major-seventh",
  "octave",
];

const INSTRUMENT_OPTIONS: readonly TransposingInstrument[] = ["bb", "a", "eb-alto", "eb-sopranino", "f"];

/**
 * Transposes a chord chart or a single written pitch by an interval or
 * between a transposing instrument's written and sounding pitch, and —
 * optionally — reports the key signature a starting tonic lands in.
 */
export function TranspositionTool() {
  const s = strings.pro.muzika.transposition;
  const [mode, setMode] = useState<"text" | "pitch">("text");
  const [text, setText] = useState("");
  const [pitchName, setPitchName] = useState("");
  const [octaveShiftText, setOctaveShiftText] = useState("");
  const [byKind, setByKind] = useState<TransposeBy["kind"]>("interval");
  const [interval, setInterval] = useState<IntervalName>("major-second");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [instrument, setInstrument] = useState<TransposingInstrument>("bb");
  const [instrumentDirection, setInstrumentDirection] = useState<
    "written-to-sounding" | "sounding-to-written"
  >("written-to-sounding");
  const [sourceKeyTonic, setSourceKeyTonic] = useState("");
  const [sourceKeyMode, setSourceKeyMode] = useState<"major" | "minor">("major");
  const [enharmonicPreference, setEnharmonicPreference] = useState<"source" | "sharps" | "flats">("source");

  const by: TransposeBy =
    byKind === "interval" ? { kind: "interval", interval, direction } : { kind: "instrument", instrument, direction: instrumentDirection };

  const typed = mode === "text" ? text.trim() !== "" : pitchName.trim() !== "";

  const textResult = transposeText({ text, by } satisfies TransposeTextInput);
  const pitchResult = transposePitch({
    name: pitchName,
    by,
    octaveShift: proParse(octaveShiftText),
  } satisfies TransposePitchInput);
  const result = mode === "text" ? textResult : pitchResult;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "text"
        ? s.errorText
        : result.reason === "interval"
          ? s.errorInterval
          : result.reason === "direction"
            ? s.errorDirection
            : result.reason === "instrument"
              ? s.errorInstrument
              : result.reason === "name"
                ? s.errorName
                : s.errorOctaveShift;

  const intervalLabel = (id: IntervalName): string =>
    id === "unison"
      ? s.intervalUnison
      : id === "minor-second"
        ? s.intervalMinorSecond
        : id === "major-second"
          ? s.intervalMajorSecond
          : id === "minor-third"
            ? s.intervalMinorThird
            : id === "major-third"
              ? s.intervalMajorThird
              : id === "perfect-fourth"
                ? s.intervalPerfectFourth
                : id === "augmented-fourth"
                  ? s.intervalAugmentedFourth
                  : id === "diminished-fifth"
                    ? s.intervalDiminishedFifth
                    : id === "perfect-fifth"
                      ? s.intervalPerfectFifth
                      : id === "minor-sixth"
                        ? s.intervalMinorSixth
                        : id === "major-sixth"
                          ? s.intervalMajorSixth
                          : id === "minor-seventh"
                            ? s.intervalMinorSeventh
                            : id === "major-seventh"
                              ? s.intervalMajorSeventh
                              : s.intervalOctave;

  const instrumentLabel = (id: TransposingInstrument): string =>
    id === "bb"
      ? s.instrumentBb
      : id === "a"
        ? s.instrumentA
        : id === "eb-alto"
          ? s.instrumentEbAlto
          : id === "eb-sopranino"
            ? s.instrumentEbSopranino
            : s.instrumentF;

  const byLabel =
    byKind === "interval"
      ? `${intervalLabel(interval)}, ${direction === "up" ? s.directionUp : s.directionDown}`
      : `${instrumentLabel(instrument)}, ${
          instrumentDirection === "written-to-sounding"
            ? s.instrumentDirectionWrittenToSounding
            : s.instrumentDirectionSoundingToWritten
        }`;

  const sourceKeyTyped = sourceKeyTonic.trim() !== "";
  const keyResult = transposeKey({
    tonic: sourceKeyTonic,
    mode: sourceKeyMode,
    by,
    enharmonicPreference,
  } satisfies TransposeKeyInput);
  const keyFailure =
    keyResult.ok || !sourceKeyTyped
      ? undefined
      : keyResult.reason === "tonic"
        ? s.errorTonic
        : keyResult.reason === "mode"
          ? s.errorMode
          : keyResult.reason === "enharmonicPreference"
            ? s.errorEnharmonicPreference
            : keyResult.reason === "interval"
              ? s.errorInterval
              : keyResult.reason === "instrument"
                ? s.errorInstrument
                : s.errorDirection;

  const copyText = !result.ok
    ? ""
    : [
        "text" in result ? `${s.resultText}: ${result.text}` : undefined,
        "text" in result ? `${s.resultUnspellable}: ${result.unspellable}` : undefined,
        "name" in result ? `${s.resultName}: ${result.name ?? "—"}` : undefined,
        "octave" in result ? `${s.resultOctave}: ${result.octave}` : undefined,
        "midi" in result ? `${s.resultMidi}: ${result.midi}` : undefined,
        keyResult.ok ? `${s.resultKeyTonic}: ${keyResult.tonic ?? "—"}` : undefined,
        keyResult.ok && keyResult.signature !== undefined
          ? `${s.resultKeySharps}: ${keyResult.signature.sharps}, ${s.resultKeyFlats}: ${keyResult.signature.flats}`
          : undefined,
        "",
        `${s.byKind}: ${byLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<"text" | "pitch">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "text", label: s.modeText },
          { id: "pitch", label: s.modePitch },
        ]}
      />
      {mode === "text" ? (
        <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} />
      ) : (
        <>
          <ToolInput label={s.pitchName} hint={s.pitchNameHint} value={pitchName} onChange={setPitchName} />
          <ToolInput label={s.octaveShift} hint={s.octaveShiftHint} value={octaveShiftText} onChange={setOctaveShiftText} />
        </>
      )}
      <ToolSelect<TransposeBy["kind"]>
        label={s.byKind}
        value={byKind}
        onChange={setByKind}
        options={[
          { id: "interval", label: s.byKindInterval },
          { id: "instrument", label: s.byKindInstrument },
        ]}
      />
      {byKind === "interval" ? (
        <>
          <ToolSelect<IntervalName>
            label={s.interval}
            value={interval}
            onChange={setInterval}
            options={INTERVAL_OPTIONS.map((id) => ({ id, label: intervalLabel(id) }))}
          />
          <ToolSelect<"up" | "down">
            label={s.direction}
            value={direction}
            onChange={setDirection}
            options={[
              { id: "up", label: s.directionUp },
              { id: "down", label: s.directionDown },
            ]}
          />
        </>
      ) : (
        <>
          <ToolSelect<TransposingInstrument>
            label={s.instrument}
            value={instrument}
            onChange={setInstrument}
            options={INSTRUMENT_OPTIONS.map((id) => ({ id, label: instrumentLabel(id) }))}
          />
          <ToolSelect<"written-to-sounding" | "sounding-to-written">
            label={s.instrumentDirection}
            value={instrumentDirection}
            onChange={setInstrumentDirection}
            options={[
              { id: "written-to-sounding", label: s.instrumentDirectionWrittenToSounding },
              { id: "sounding-to-written", label: s.instrumentDirectionSoundingToWritten },
            ]}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={mode === "text" ? s.resultsText : s.resultsPitch}>
          {"text" in result ? (
            <>
              <ResultRow label={s.resultText} value={result.text} />
              <ResultRow label={s.resultUnspellable} value={result.unspellable} />
              {result.unspellable > 0 && <p className="tool__note">{s.unspellableNote}</p>}
            </>
          ) : (
            <>
              <ResultRow label={s.resultName} value={result.name ?? "—"} />
              <ResultRow label={s.resultOctave} value={result.octave} />
              <ResultRow label={s.resultMidi} value={result.midi} />
              {result.name === undefined && <p className="tool__note">{s.pitchUnspellableNote}</p>}
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.byKind, value: byLabel }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      <ToolSection title={s.sourceKeyTitle}>
        <ToolInput label={s.sourceKey} hint={s.sourceKeyHint} value={sourceKeyTonic} onChange={setSourceKeyTonic} />
        <ToolSelect<"major" | "minor">
          label={s.sourceKeyMode}
          value={sourceKeyMode}
          onChange={setSourceKeyMode}
          options={[
            { id: "major", label: s.sourceKeyModeMajor },
            { id: "minor", label: s.sourceKeyModeMinor },
          ]}
        />
        <ToolSelect<"source" | "sharps" | "flats">
          label={s.enharmonicPreference}
          value={enharmonicPreference}
          onChange={setEnharmonicPreference}
          options={[
            { id: "source", label: s.enharmonicSource },
            { id: "sharps", label: s.enharmonicSharps },
            { id: "flats", label: s.enharmonicFlats },
          ]}
        />
        {keyFailure !== undefined && <ToolFailure>{keyFailure}</ToolFailure>}
        {keyResult.ok && sourceKeyTyped && (
          <>
            <ResultRow label={s.resultKeyTonic} value={keyResult.tonic ?? "—"} />
            {keyResult.signature === undefined ? (
              <p className="tool__note">{s.keyUnspellableNote}</p>
            ) : (
              <>
                <ResultRow label={s.resultKeySharps} value={keyResult.signature.sharps} />
                <ResultRow label={s.resultKeyFlats} value={keyResult.signature.flats} />
              </>
            )}
          </>
        )}
      </ToolSection>
    </>
  );
}

/**
 * Resampling: pitch, speed, tempo and length move together as one ratio,
 * reached from whichever entry point was typed — semitones, cents, a ratio,
 * or the pair of sample rates a file was recorded at and is played back at.
 */
export function VarispeedRepitchTool() {
  const s = strings.pro.muzika["varispeed-repitch"];
  const [entryKind, setEntryKind] = useState<VarispeedEntry["kind"]>("semitones");
  const [valueText, setValueText] = useState("");
  const [recordedAtHzText, setRecordedAtHzText] = useState("");
  const [playedBackAtHzText, setPlayedBackAtHzText] = useState("");
  const [tempoText, setTempoText] = useState("");
  const [lengthSecondsText, setLengthSecondsText] = useState("");

  const typed =
    entryKind === "sampleRates"
      ? proParse(recordedAtHzText) !== undefined || proParse(playedBackAtHzText) !== undefined
      : proParse(valueText) !== undefined;

  const entry: VarispeedEntry =
    entryKind === "sampleRates"
      ? {
          kind: "sampleRates",
          recordedAtHz: proParse(recordedAtHzText) ?? Number.NaN,
          playedBackAtHz: proParse(playedBackAtHzText) ?? Number.NaN,
        }
      : { kind: entryKind, value: proParse(valueText) ?? Number.NaN };

  const result = varispeed({
    entry,
    tempo: proParse(tempoText),
    lengthSeconds: proParse(lengthSecondsText),
  } satisfies VarispeedInput);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "semitones"
        ? s.errorSemitones
        : result.reason === "cents"
          ? s.errorCents
          : result.reason === "ratio"
            ? s.errorRatio
            : result.reason === "recordedAtHz"
              ? s.errorRecordedAtHz
              : result.reason === "playedBackAtHz"
                ? s.errorPlayedBackAtHz
                : result.reason === "tempo"
                  ? s.errorTempo
                  : s.errorLengthSeconds;

  const entryLabel =
    entryKind === "semitones"
      ? s.entrySemitones
      : entryKind === "cents"
        ? s.entryCents
        : entryKind === "ratio"
          ? s.entryRatio
          : s.entrySampleRates;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultRatio}: ${proNum(result.ratio, 6)}`,
        `${s.resultSemitones}: ${proUnit(proNum(result.semitones, 4), s.unitSemitone)}`,
        `${s.resultCents}: ${proUnit(proNum(result.cents, 2), s.unitCent)}`,
        result.tempo === undefined ? undefined : `${s.resultTempo}: ${proUnit(proNum(result.tempo, 3), s.unitBpm)}`,
        result.lengthSeconds === undefined
          ? undefined
          : `${s.resultLength}: ${proUnit(proNum(result.lengthSeconds, 3), s.unitS)}`,
        result.lengthFormatted === undefined ? undefined : `${s.resultLengthFormatted}: ${result.lengthFormatted}`,
        "",
        `${s.entryKind}: ${entryLabel}`,
        entryKind === "sampleRates"
          ? `${s.recordedAtHz}: ${recordedAtHzText.trim()}, ${s.playedBackAtHz}: ${playedBackAtHzText.trim()}`
          : `${s.value}: ${valueText.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<VarispeedEntry["kind"]>
        label={s.entryKind}
        value={entryKind}
        onChange={setEntryKind}
        options={[
          { id: "semitones", label: s.entrySemitones },
          { id: "cents", label: s.entryCents },
          { id: "ratio", label: s.entryRatio },
          { id: "sampleRates", label: s.entrySampleRates },
        ]}
      />
      {entryKind === "sampleRates" ? (
        <>
          <ToolInput
            label={s.recordedAtHz}
            hint={s.recordedAtHzHint}
            value={recordedAtHzText}
            onChange={setRecordedAtHzText}
          />
          <ToolInput label={s.playedBackAtHz} value={playedBackAtHzText} onChange={setPlayedBackAtHzText} />
        </>
      ) : (
        <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      )}
      <ToolInput label={s.originalTempo} hint={s.originalTempoHint} value={tempoText} onChange={setTempoText} />
      <ToolInput
        label={s.originalLength}
        hint={s.originalLengthHint}
        value={lengthSecondsText}
        onChange={setLengthSecondsText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultRatio} value={proNum(result.ratio, 6)} />
          <ResultRow label={s.resultSemitones} value={proUnit(proNum(result.semitones, 4), s.unitSemitone)} />
          <ResultRow label={s.resultCents} value={proUnit(proNum(result.cents, 2), s.unitCent)} />
          {result.tempo !== undefined && (
            <ResultRow label={s.resultTempo} value={proUnit(proNum(result.tempo, 3), s.unitBpm)} />
          )}
          {result.lengthSeconds !== undefined && (
            <>
              <ResultRow label={s.resultLength} value={proUnit(proNum(result.lengthSeconds, 3), s.unitS)} />
              <ResultRow label={s.resultLengthFormatted} value={result.lengthFormatted ?? "—"} />
            </>
          )}
          <p className="tool__note">{s.speedNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.entryKind, value: entryLabel },
              entryKind === "sampleRates"
                ? { label: s.recordedAtHz, value: proUnit(proNum(proParse(recordedAtHzText) ?? 0, 0), s.unitHz) }
                : { label: s.value, value: valueText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const MUZIKA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "audio-level-reference": AudioLevelReferenceTool,
  "bar-duration": BarDurationTool,
  "bpm-delay-times": BpmDelayTimesTool,
  "cents-ratio": CentsRatioTool,
  "compressor-curve": CompressorCurveTool,
  "decibel-ratio": DecibelRatioTool,
  "note-frequency": NoteFrequencyTool,
  "pcm-file-size": PcmFileSizeTool,
  "reverb-time": ReverbTimeTool,
  "room-modes": RoomModesTool,
  "sample-buffer-latency": SampleBufferLatencyTool,
  "scale-chord-speller": ScaleChordSpellerTool,
  "sound-wavelength": SoundWavelengthTool,
  "speaker-load": SpeakerLoadTool,
  "spl-distance": SplDistanceTool,
  transposition: TranspositionTool,
  "varispeed-repitch": VarispeedRepitchTool,
};
