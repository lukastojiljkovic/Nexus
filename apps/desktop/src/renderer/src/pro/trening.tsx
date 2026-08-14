import {
  barbellPlateLoading,
  bodyComposition,
  bodyIndices,
  cadenceStride,
  ergSplitWatts,
  heartRateZones,
  intervalSession,
  jumpHeight,
  limbSymmetry,
  oneRepMaxTable,
  runningPace,
  setTempoTut,
  splitSeries,
  sweatRate,
  trainingVolumeLoad,
  weightClassCut,
  type DistanceUnit,
  type IntervalRest,
  type IntervalWork,
  type OneRmFormula,
  type PaceUnit,
  type PlateStock,
  type SpeedUnit,
  type VolumeRow,
} from "@nexus/core/pro/trening";
import { useState, type ComponentType } from "react";

import { fill, strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
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

/**
 * „Trening i sport" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/trening.ts`'s. Nothing here divides,
 * rounds or compares; this file shapes fields, hands the numbers over, and
 * reads the answers onto the page.
 *
 * **Two local helpers decode and format clock notation** (`parseClock`,
 * `clockMinSec`, `clockMinSecFrac`) because several of these tools' inputs
 * and outputs are conventionally written as a clock — a split as „1:45,3",
 * a pace as „4:15/km" — while the values that flow through the core
 * functions are plain seconds (the core module's own header explains why: a
 * fractional second's separator is a locale decision the core package does
 * not make). These three functions decode or lay out notation; they never
 * decide anything about training, and every tool that uses them still hands
 * every number that matters to `@nexus/core` before it prints it.
 *
 * **No tool in this pack is `life-safety` or `food-safety`** — the registry
 * marks every one of them `none` or `wellness` — but two of them carry a
 * regulated figure a rule-maker owns (the symmetry target, the weight-class
 * limit) and get the same discipline anyway: the figure is the user's own
 * input, echoed back beside the computed value, with nothing but the two
 * numbers side by side.
 */

/**
 * Decodes a clock-style duration — a plain number of seconds, „mm:ss[,d]" or
 * „h:mm:ss[,d]" — into seconds. Notation decoding, not this pack's own
 * arithmetic: every field that accepts this could equally accept a plain
 * number of seconds, and the two are the same value spelled two ways.
 * `proParse` still does the actual digit parsing on each segment, including
 * its comma decimal on the seconds part.
 */
function parseClock(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (!trimmed.includes(":")) return proParse(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const secText = parts[parts.length - 1];
  const minText = parts[parts.length - 2];
  const hourText = parts.length === 3 ? parts[0] : "0";
  if (secText === undefined || minText === undefined || hourText === undefined) return undefined;
  const seconds = proParse(secText);
  const minutes = proParse(minText);
  const hours = proParse(hourText);
  if (seconds === undefined || minutes === undefined || hours === undefined) return undefined;
  if (!Number.isInteger(minutes) || !Number.isInteger(hours) || minutes < 0 || hours < 0) {
    return undefined;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/** m:ss, rounded to the whole second — the display half of `parseClock` for a plain pace. */
function clockMinSec(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const sec = whole % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

/** m:ss with `digits` decimal places on the seconds — a split or a per-100 m tempo. */
function clockMinSecFrac(seconds: number, digits: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const scale = 10 ** digits;
  const totalUnits = Math.round(seconds * scale);
  const wholeSeconds = Math.floor(totalUnits / scale);
  const frac = totalUnits - wholeSeconds * scale;
  const m = Math.floor(wholeSeconds / 60);
  const sec = wholeSeconds % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec},${String(frac).padStart(digits, "0")}`;
}

/** Which plates to load per side, from a wanted total and the gym's inventory. */
export function BarbellPlateLoadingTool() {
  const s = strings.pro.trening["barbell-plate-loading"];
  const [target, setTarget] = useState("");
  const [bar, setBar] = useState("20");
  const [collar, setCollar] = useState("0");
  const [platesText, setPlatesText] = useState("25\n20\n15\n10\n5\n2,5\n1,25");

  const typed = proParse(target) !== undefined;

  // One plate type per line: mass, and optionally a space then how many
  // pairs are on hand. No count at all means unlimited, matching the core
  // function's own reading of an absent `pairs`.
  const plateLines = platesText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const plates: PlateStock[] = plateLines.map((line) => {
    const tokens = line.split(/\s+/);
    const mass = proParse(tokens[0] ?? "") ?? Number.NaN;
    const pairsToken = tokens[1];
    const pairs = pairsToken === undefined ? undefined : proParse(pairsToken);
    return pairs === undefined ? { mass } : { mass, pairs };
  });

  const load = barbellPlateLoading({
    target: proParse(target) ?? Number.NaN,
    bar: proParse(bar) ?? Number.NaN,
    collar: proParse(collar) ?? Number.NaN,
    plates,
  });

  const failure =
    load.ok || !typed
      ? undefined
      : load.reason === "target"
        ? s.errorTarget
        : load.reason === "bar"
          ? s.errorBar
          : load.reason === "collar"
            ? s.errorCollar
            : load.reason === "belowBar"
              ? s.errorBelowBar
              : load.reason === "tooManyOperations"
                ? s.errorTooManyOperations
                : s.errorPlates;

  const copyText = !load.ok
    ? ""
    : [
        `${s.perSideTitle}:`,
        ...load.perSide.map((p) => `  ${proUnit(proNum(p.mass, 2), s.unitKg)} × ${proNum(p.count, 0)}`),
        `${s.achieved}: ${proUnit(proNum(load.achieved, 2), s.unitKg)}`,
        `${s.difference}: ${proUnit(proNum(load.difference, 2), s.unitKg)}`,
        "",
        `${s.target}: ${proUnit(proNum(proParse(target) ?? 0, 2), s.unitKg)}`,
        `${s.barUsed}: ${proUnit(proNum(load.bar, 2), s.unitKg)}`,
        `${s.collar}: ${proUnit(proNum(proParse(collar) ?? 0, 2), s.unitKg)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.target} hint={s.targetHint} value={target} onChange={setTarget} />
      <ToolInput label={s.bar} hint={s.barHint} value={bar} onChange={setBar} />
      <ToolInput label={s.collar} hint={s.collarHint} value={collar} onChange={setCollar} />
      <ToolTextArea label={s.plates} hint={s.platesHint} value={platesText} onChange={setPlatesText} rows={7} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {load.ok && (
        <ToolSection title={s.results}>
          {load.perSide.length === 0 ? (
            <p className="tool__note">{s.noPlates}</p>
          ) : (
            <ToolTable
              head={[s.headMass, s.headCount]}
              rows={load.perSide.map((p) => [proUnit(proNum(p.mass, 2), s.unitKg), proNum(p.count, 0)])}
            />
          )}
          <ResultRow label={s.barUsed} value={proUnit(proNum(load.bar, 2), s.unitKg)} />
          <ResultRow label={s.perSideMass} value={proUnit(proNum(load.perSideMass, 2), s.unitKg)} />
          <ResultRow label={s.plateCount} value={proNum(load.plateCount, 0)} />
          <ResultRow label={s.achieved} value={proUnit(proNum(load.achieved, 2), s.unitKg)} />
          <ResultRow label={s.difference} value={proUnit(proNum(load.difference, 2), s.unitKg)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.target, value: proUnit(proNum(proParse(target) ?? 0, 2), s.unitKg) },
              { label: s.bar, value: proUnit(proNum(proParse(bar) ?? 0, 2), s.unitKg) },
              { label: s.collar, value: proUnit(proNum(proParse(collar) ?? 0, 2), s.unitKg) },
              { label: s.plates, value: plateLines.join("; ") },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Fat mass, lean mass, and what the same body would weigh at another fat percentage. */
export function BodyFatTargetMassTool() {
  const s = strings.pro.trening["body-fat-target-mass"];
  const [mass, setMass] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [target, setTarget] = useState("");

  const typed =
    proParse(mass) !== undefined || proParse(bodyFat) !== undefined || proParse(target) !== undefined;

  const composition = bodyComposition({
    mass: proParse(mass) ?? Number.NaN,
    bodyFat: proParse(bodyFat) ?? Number.NaN,
    target: proParse(target) ?? Number.NaN,
  });

  const failure =
    composition.ok || !typed
      ? undefined
      : composition.reason === "mass"
        ? s.errorMass
        : composition.reason === "bodyFat"
          ? s.errorBodyFat
          : s.errorTarget;

  const copyText = !composition.ok
    ? ""
    : [
        `${s.condition}: ${s.conditionNote}`,
        `${s.targetMass}: ${proUnit(proNum(composition.targetMass, 2), s.unitKg)}`,
        `${s.change}: ${proUnit(proNum(composition.change, 2), s.unitKg)}`,
        `${s.fatMass}: ${proUnit(proNum(composition.fatMass, 2), s.unitKg)}`,
        `${s.leanMass}: ${proUnit(proNum(composition.leanMass, 2), s.unitKg)}`,
        `${s.targetFatMass}: ${proUnit(proNum(composition.targetFatMass, 2), s.unitKg)}`,
        "",
        `${s.mass}: ${proUnit(proNum(proParse(mass) ?? 0, 2), s.unitKg)}`,
        `${s.bodyFat}: ${proNum(proParse(bodyFat) ?? 0, 2)} %`,
        `${s.target}: ${proNum(proParse(target) ?? 0, 2)} %`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.mass} hint={s.massHint} value={mass} onChange={setMass} />
      <ToolInput label={s.bodyFat} hint={s.bodyFatHint} value={bodyFat} onChange={setBodyFat} />
      <ToolInput label={s.target} hint={s.targetHint} value={target} onChange={setTarget} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {composition.ok && (
        <ToolSection title={s.results}>
          {/* The condition leads, per the review: the algebra assuming lean
              mass is held constant IS the whole content of this tool. */}
          <ResultRow label={s.condition} value={s.conditionNote} mono={false} />
          <ResultRow label={s.targetMass} value={proUnit(proNum(composition.targetMass, 2), s.unitKg)} />
          <ResultRow label={s.change} value={proUnit(proNum(composition.change, 2), s.unitKg)} />
          <ResultRow label={s.fatMass} value={proUnit(proNum(composition.fatMass, 2), s.unitKg)} />
          <ResultRow label={s.leanMass} value={proUnit(proNum(composition.leanMass, 2), s.unitKg)} />
          <ResultRow
            label={s.targetFatMass}
            value={proUnit(proNum(composition.targetFatMass, 2), s.unitKg)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mass, value: proUnit(proNum(proParse(mass) ?? 0, 2), s.unitKg) },
              { label: s.bodyFat, value: `${proNum(proParse(bodyFat) ?? 0, 2)} %` },
              { label: s.target, value: `${proNum(proParse(target) ?? 0, 2)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** BMI, the ponderal (Rohrer) index, and the two waist ratios — four numbers, no category. */
export function BodyIndicesTool() {
  const s = strings.pro.trening["body-indices"];
  const [mass, setMass] = useState("");
  const [height, setHeight] = useState("");
  const [waist, setWaist] = useState("");
  const [hip, setHip] = useState("");

  const typed =
    proParse(mass) !== undefined ||
    proParse(height) !== undefined ||
    proParse(waist) !== undefined ||
    proParse(hip) !== undefined;

  const waistVal = proParse(waist);
  const hipVal = proParse(hip);
  const indices = bodyIndices({
    mass: proParse(mass) ?? Number.NaN,
    height: proParse(height) ?? Number.NaN,
    ...(waist.trim() === "" ? {} : { waist: waistVal ?? Number.NaN }),
    ...(hip.trim() === "" ? {} : { hip: hipVal ?? Number.NaN }),
  });

  const failure =
    indices.ok || !typed
      ? undefined
      : indices.reason === "mass"
        ? s.errorMass
        : indices.reason === "height"
          ? s.errorHeight
          : indices.reason === "waist"
            ? s.errorWaist
            : s.errorHip;

  const copyText = !indices.ok
    ? ""
    : [
        `${s.bmi}: ${proUnit(proNum(indices.bmi, 1), s.unitBmi)}`,
        `${s.ponderal}: ${proUnit(proNum(indices.ponderal, 1), s.unitPonderal)}`,
        ...(indices.waistToHeight === undefined
          ? []
          : [`${s.waistToHeight}: ${proNum(indices.waistToHeight, 2)}`]),
        ...(indices.waistToHip === undefined ? [] : [`${s.waistToHip}: ${proNum(indices.waistToHip, 2)}`]),
        "",
        `${s.mass}: ${proUnit(proNum(proParse(mass) ?? 0, 2), s.unitKg)}`,
        `${s.height}: ${proUnit(proNum(proParse(height) ?? 0, 1), s.unitCm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.mass} hint={s.massHint} value={mass} onChange={setMass} />
      <ToolInput label={s.height} hint={s.heightHint} value={height} onChange={setHeight} />
      <ToolInput label={s.waist} hint={s.waistHint} value={waist} onChange={setWaist} />
      <ToolInput label={s.hip} hint={s.hipHint} value={hip} onChange={setHip} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {indices.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.bmi} value={proUnit(proNum(indices.bmi, 1), s.unitBmi)} />
          <ResultRow label={s.ponderal} value={proUnit(proNum(indices.ponderal, 1), s.unitPonderal)} />
          {indices.waistToHeight !== undefined && (
            <ResultRow label={s.waistToHeight} value={proNum(indices.waistToHeight, 2)} />
          )}
          {indices.waistToHip !== undefined && (
            <ResultRow label={s.waistToHip} value={proNum(indices.waistToHip, 2)} />
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mass, value: proUnit(proNum(proParse(mass) ?? 0, 2), s.unitKg) },
              { label: s.height, value: proUnit(proNum(proParse(height) ?? 0, 1), s.unitCm) },
              ...(waistVal === undefined
                ? []
                : [{ label: s.waist, value: proUnit(proNum(waistVal, 1), s.unitCm) }]),
              ...(hipVal === undefined ? [] : [{ label: s.hip, value: proUnit(proNum(hipVal, 1), s.unitCm) }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Target heart rates by Karvonen and by percent of maximum, and the reverse for a measured rate. */
export function HeartRateZonesKarvonenTool() {
  const s = strings.pro.trening["heart-rate-zones-karvonen"];
  const [hrMax, setHrMax] = useState("");
  const [hrRest, setHrRest] = useState("");
  const [percentsText, setPercentsText] = useState("");
  const [measuredHr, setMeasuredHr] = useState("");

  const typed = proParse(hrMax) !== undefined || proParse(hrRest) !== undefined;
  const percentsProvided = percentsText.trim() !== "";
  const measuredProvided = measuredHr.trim() !== "";

  const result = heartRateZones({
    hrMax: proParse(hrMax) ?? Number.NaN,
    hrRest: proParse(hrRest) ?? Number.NaN,
    ...(percentsProvided
      ? { percents: percentsText.split(";").map((token) => proParse(token) ?? Number.NaN) }
      : {}),
    ...(measuredProvided ? { measuredHr: proParse(measuredHr) ?? Number.NaN } : {}),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "hrRest"
        ? s.errorHrRest
        : result.reason === "hrMax"
          ? s.errorHrMax
          : result.reason === "percents"
            ? s.errorPercents
            : s.errorMeasuredHr;

  const copyText = !result.ok
    ? ""
    : [
        `${s.reserve}: ${proUnit(proNum(result.reserve, 0), s.unitBpm)}`,
        ...result.rows.map(
          (row) =>
            `  ${proNum(row.percent, 0)} % — ${s.headKarvonen}: ${proUnit(proNum(row.karvonen, 0), s.unitBpm)}, ${s.headPercentMax}: ${proUnit(proNum(row.percentOfMax, 0), s.unitBpm)}`,
        ),
        ...(result.measuredPercentOfReserve === undefined || result.measuredPercentOfMax === undefined
          ? []
          : [
              `${s.measuredReserve}: ${proNum(result.measuredPercentOfReserve, 1)} %`,
              `${s.measuredMax}: ${proNum(result.measuredPercentOfMax, 1)} %`,
            ]),
        "",
        `${s.hrMax}: ${proUnit(proNum(proParse(hrMax) ?? 0, 0), s.unitBpm)}`,
        `${s.hrRest}: ${proUnit(proNum(proParse(hrRest) ?? 0, 0), s.unitBpm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.hrMax} hint={s.hrMaxHint} value={hrMax} onChange={setHrMax} />
      <ToolInput label={s.hrRest} hint={s.hrRestHint} value={hrRest} onChange={setHrRest} />
      <ToolInput label={s.percents} hint={s.percentsHint} value={percentsText} onChange={setPercentsText} />
      <ToolInput label={s.measuredHr} hint={s.measuredHrHint} value={measuredHr} onChange={setMeasuredHr} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.reserve} value={proUnit(proNum(result.reserve, 0), s.unitBpm)} />
          <ToolTable
            head={[s.headPercent, s.headKarvonen, s.headPercentMax]}
            rows={result.rows.map((row) => [
              `${proNum(row.percent, 0)} %`,
              proUnit(proNum(row.karvonen, 0), s.unitBpm),
              proUnit(proNum(row.percentOfMax, 0), s.unitBpm),
            ])}
          />
          {result.measuredPercentOfReserve !== undefined && result.measuredPercentOfMax !== undefined && (
            <ToolSection title={s.measuredTitle}>
              <ResultRow label={s.measuredReserve} value={`${proNum(result.measuredPercentOfReserve, 1)} %`} />
              <ResultRow label={s.measuredMax} value={`${proNum(result.measuredPercentOfMax, 1)} %`} />
            </ToolSection>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.hrMax, value: proUnit(proNum(proParse(hrMax) ?? 0, 0), s.unitBpm) },
              { label: s.hrRest, value: proUnit(proNum(proParse(hrRest) ?? 0, 0), s.unitBpm) },
              ...(percentsProvided ? [{ label: s.percents, value: percentsText.trim() }] : []),
              ...(measuredProvided
                ? [{ label: s.measuredHr, value: proUnit(proNum(proParse(measuredHr) ?? 0, 0), s.unitBpm) }]
                : []),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Cadence, step length and speed: give any two and this returns the third. */
export function CadenceStrideLengthTool() {
  const s = strings.pro.trening["cadence-stride-length"];
  const [cadence, setCadence] = useState("");
  const [stepLength, setStepLength] = useState("");
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("kmh");
  const [speedValue, setSpeedValue] = useState("");

  const typed = cadence.trim() !== "" || stepLength.trim() !== "" || speedValue.trim() !== "";

  const cadenceProvided = cadence.trim() !== "";
  const stepProvided = stepLength.trim() !== "";
  const speedProvided = speedValue.trim() !== "";
  const speedParsed = speedUnit === "pacePerKm" ? parseClock(speedValue) : proParse(speedValue);

  const result = cadenceStride({
    ...(cadenceProvided ? { cadence: proParse(cadence) ?? Number.NaN } : {}),
    ...(stepProvided ? { stepLength: proParse(stepLength) ?? Number.NaN } : {}),
    ...(speedProvided ? { speed: { unit: speedUnit, value: speedParsed ?? Number.NaN } } : {}),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fields"
        ? s.errorFields
        : result.reason === "cadence"
          ? s.errorCadence
          : result.reason === "stepLength"
            ? s.errorStepLength
            : s.errorSpeed;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resolvedCadence}: ${proUnit(proNum(result.cadence, 1), s.unitStepsPerMin)}`,
        `${s.resolvedStep}: ${proUnit(proNum(result.stepLength, 3), s.unitM)}`,
        `${s.speedMps}: ${proUnit(proNum(result.speedMps, 2), s.unitMps)}`,
        `${s.speedKmh}: ${proUnit(proNum(result.speedKmh, 2), s.unitKmh)}`,
        `${s.pacePerKm}: ${clockMinSec(result.pacePerKm)}${s.unitPerKm}`,
        `${s.stepsPerKm}: ${proUnit(proNum(result.stepsPerKm, 1), s.unitStepsPerKm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.cadence} hint={s.cadenceHint} value={cadence} onChange={setCadence} />
      <ToolInput label={s.stepLength} hint={s.stepLengthHint} value={stepLength} onChange={setStepLength} />
      <ToolSelect<SpeedUnit>
        label={s.speedUnit}
        value={speedUnit}
        onChange={setSpeedUnit}
        options={[
          { id: "mps", label: s.speedUnitMps },
          { id: "kmh", label: s.speedUnitKmh },
          { id: "pacePerKm", label: s.speedUnitPace },
        ]}
      />
      <ToolInput label={s.speedValue} hint={s.speedValueHint} value={speedValue} onChange={setSpeedValue} />
      <p className="tool__note">{s.fieldsHint}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resolvedCadence} value={proUnit(proNum(result.cadence, 1), s.unitStepsPerMin)} />
          <ResultRow label={s.resolvedStep} value={proUnit(proNum(result.stepLength, 3), s.unitM)} />
          <p className="tool__note">{s.stepNote}</p>
          <ResultRow label={s.speedMps} value={proUnit(proNum(result.speedMps, 2), s.unitMps)} />
          <ResultRow label={s.speedKmh} value={proUnit(proNum(result.speedKmh, 2), s.unitKmh)} />
          <ResultRow label={s.pacePerKm} value={`${clockMinSec(result.pacePerKm)}${s.unitPerKm}`} />
          <ResultRow label={s.stepsPerKm} value={proUnit(proNum(result.stepsPerKm, 1), s.unitStepsPerKm)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              ...(cadenceProvided
                ? [{ label: s.cadence, value: proUnit(proNum(proParse(cadence) ?? 0, 1), s.unitStepsPerMin) }]
                : []),
              ...(stepProvided
                ? [{ label: s.stepLength, value: proUnit(proNum(proParse(stepLength) ?? 0, 3), s.unitM) }]
                : []),
              ...(speedProvided ? [{ label: s.speedValue, value: speedValue.trim() }] : []),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Split ↔ watts on the published Concept2 relation, and a projected time at that split. */
export function ErgSplitWattsTool() {
  const s = strings.pro.trening["erg-split-watts"];
  const [split, setSplit] = useState("");
  const [power, setPower] = useState("");
  const [distance, setDistance] = useState("2000");

  const typed = split.trim() !== "" || power.trim() !== "";
  const splitProvided = split.trim() !== "";
  const powerProvided = power.trim() !== "";

  const result = ergSplitWatts({
    ...(splitProvided ? { split: parseClock(split) ?? Number.NaN } : {}),
    ...(powerProvided ? { power: proParse(power) ?? Number.NaN } : {}),
    distance: proParse(distance) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fields"
        ? s.errorFields
        : result.reason === "distance"
          ? s.errorDistance
          : result.reason === "split"
            ? s.errorSplit
            : s.errorPower;

  const copyText = !result.ok
    ? ""
    : [
        `${s.power2}: ${proUnit(proNum(result.power, 1), s.unitW)}`,
        `${s.split2}: ${clockMinSecFrac(result.split, 1)}`,
        `${s.pace}: ${proUnit(proNum(result.pace, 4), s.unitSPerM)}`,
        `${s.projected}: ${clockMinSecFrac(result.projected, 1)}`,
        "",
        `${s.distance}: ${proUnit(proNum(proParse(distance) ?? 0, 0), s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.split} hint={s.splitHint} value={split} onChange={setSplit} />
      <ToolInput label={s.power} hint={s.powerHint} value={power} onChange={setPower} />
      <ToolInput label={s.distance} hint={s.distanceHint} value={distance} onChange={setDistance} />
      <p className="tool__note">{s.fieldsHint}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.power2} value={proUnit(proNum(result.power, 1), s.unitW)} />
          <ResultRow label={s.split2} value={clockMinSecFrac(result.split, 1)} />
          <ResultRow label={s.pace} value={proUnit(proNum(result.pace, 4), s.unitSPerM)} />
          <ResultRow label={s.projected} value={clockMinSecFrac(result.projected, 1)} />
          <p className="tool__note">{s.projectedNote}</p>
          <p className="tool__note">{fill(s.coefficientNote, { coefficient: proNum(result.coefficient, 2) })}</p>
          <p className="tool__note">{fill(s.referenceNote, { reference: proNum(result.referenceMetres, 0) })}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              ...(splitProvided ? [{ label: s.split, value: split.trim() }] : []),
              ...(powerProvided ? [{ label: s.power, value: proUnit(proNum(proParse(power) ?? 0, 1), s.unitW) }] : []),
              { label: s.distance, value: proUnit(proNum(proParse(distance) ?? 0, 0), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * How long an interval session takes, and its real work-to-rest ratio.
 *
 * The tempo mode enters the same four phases „Tempo serije" does; both surfaces
 * hand them to the same core function, `intervalSession`'s `work: "tempo"`.
 */
export function IntervalSessionTimingTool() {
  const s = strings.pro.trening["interval-session-timing"];
  const [workMode, setWorkMode] = useState<"seconds" | "tempo">("seconds");
  const [workSeconds, setWorkSeconds] = useState("");
  const [eccentric, setEccentric] = useState("");
  const [pauseBottom, setPauseBottom] = useState("");
  const [concentric, setConcentric] = useState("");
  const [pauseTop, setPauseTop] = useState("");
  const [restMode, setRestMode] = useState<"seconds" | "ratio">("seconds");
  const [restSeconds, setRestSeconds] = useState("");
  const [ratioWork, setRatioWork] = useState("");
  const [ratioRest, setRatioRest] = useState("");
  const [reps, setReps] = useState("");
  const [sets, setSets] = useState("1");
  const [restBetweenSets, setRestBetweenSets] = useState("0");
  const [warmup, setWarmup] = useState("0");
  const [cooldown, setCooldown] = useState("0");

  const typed =
    reps.trim() !== "" ||
    (workMode === "seconds"
      ? workSeconds.trim() !== ""
      : [eccentric, pauseBottom, concentric, pauseTop].some((v) => v.trim() !== ""));

  const work: IntervalWork =
    workMode === "tempo"
      ? {
          kind: "tempo",
          eccentric: proParse(eccentric) ?? Number.NaN,
          pauseBottom: proParse(pauseBottom) ?? Number.NaN,
          concentric: proParse(concentric) ?? Number.NaN,
          pauseTop: proParse(pauseTop) ?? Number.NaN,
        }
      : { kind: "seconds", seconds: proParse(workSeconds) ?? Number.NaN };
  const rest: IntervalRest | undefined =
    workMode !== "seconds"
      ? undefined
      : restMode === "ratio"
        ? { kind: "ratio", work: proParse(ratioWork) ?? Number.NaN, rest: proParse(ratioRest) ?? Number.NaN }
        : { kind: "seconds", seconds: proParse(restSeconds) ?? Number.NaN };

  const result = intervalSession({
    work,
    ...(rest === undefined ? {} : { rest }),
    reps: proParse(reps) ?? Number.NaN,
    sets: proParse(sets) ?? Number.NaN,
    restBetweenSets: proParse(restBetweenSets) ?? Number.NaN,
    warmup: proParse(warmup) ?? Number.NaN,
    cooldown: proParse(cooldown) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "reps"
        ? s.errorReps
        : result.reason === "sets"
          ? s.errorSets
          : result.reason === "restBetweenSets"
            ? s.errorRestBetweenSets
            : result.reason === "warmup"
              ? s.errorWarmup
              : result.reason === "cooldown"
                ? s.errorCooldown
                : result.reason === "tempo"
                  ? s.errorTempo
                  : result.reason === "work"
                    ? s.errorWork
                    : result.reason === "rest"
                      ? s.errorRest
                      : s.errorRestRatio;

  const copyText = !result.ok
    ? ""
    : [
        `${s.restResolved}: ${proUnit(proNum(result.rest, 0), s.unitS)}`,
        `${s.setDuration}: ${result.setDurationClock}`,
        `${s.totalWork}: ${result.totalWorkClock}`,
        `${s.totalRest}: ${result.totalRestClock}`,
        `${s.total}: ${result.totalClock}`,
        `${s.repRatio}: 1:${proNum(result.repRestRatio, 2)}`,
        `${s.sessionRatio}: 1:${proNum(result.sessionRestRatio, 2)}`,
        `${s.reps}: ${proNum(proParse(reps) ?? 0, 0)}`,
        `${s.sets}: ${proNum(proParse(sets) ?? 0, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"seconds" | "tempo">
        label={s.workMode}
        value={workMode}
        onChange={setWorkMode}
        options={[
          { id: "seconds", label: s.workModeSeconds },
          { id: "tempo", label: s.workModeTempo },
        ]}
      />
      {workMode === "seconds" ? (
        <ToolInput label={s.workSeconds} hint={s.workSecondsHint} value={workSeconds} onChange={setWorkSeconds} />
      ) : (
        <>
          <ToolInput label={s.eccentric} hint={s.tempoHint} value={eccentric} onChange={setEccentric} />
          <ToolInput label={s.pauseBottom} value={pauseBottom} onChange={setPauseBottom} />
          <ToolInput label={s.concentric} value={concentric} onChange={setConcentric} />
          <ToolInput label={s.pauseTop} value={pauseTop} onChange={setPauseTop} />
        </>
      )}
      {workMode === "seconds" && (
        <>
          <ToolSelect<"seconds" | "ratio">
            label={s.restMode}
            value={restMode}
            onChange={setRestMode}
            options={[
              { id: "seconds", label: s.restModeSeconds },
              { id: "ratio", label: s.restModeRatio },
            ]}
          />
          {restMode === "seconds" ? (
            <ToolInput label={s.restSeconds} hint={s.restSecondsHint} value={restSeconds} onChange={setRestSeconds} />
          ) : (
            <>
              <ToolInput label={s.ratioWork} hint={s.ratioHint} value={ratioWork} onChange={setRatioWork} />
              <ToolInput label={s.ratioRest} value={ratioRest} onChange={setRatioRest} />
            </>
          )}
        </>
      )}
      <ToolInput label={s.reps} value={reps} onChange={setReps} />
      <ToolInput label={s.sets} value={sets} onChange={setSets} />
      <ToolInput label={s.restBetweenSets} hint={s.secondsHint} value={restBetweenSets} onChange={setRestBetweenSets} />
      <ToolInput label={s.warmup} hint={s.secondsHint} value={warmup} onChange={setWarmup} />
      <ToolInput label={s.cooldown} hint={s.secondsHint} value={cooldown} onChange={setCooldown} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.restResolved} value={proUnit(proNum(result.rest, 0), s.unitS)} />
          <ResultRow label={s.setDuration} value={result.setDurationClock} />
          <ResultRow label={s.totalWork} value={result.totalWorkClock} />
          <ResultRow label={s.totalRest} value={result.totalRestClock} />
          <ResultRow label={s.total} value={result.totalClock} />
          <ResultRow label={s.repRatio} value={`1:${proNum(result.repRestRatio, 2)}`} />
          <ResultRow label={s.sessionRatio} value={`1:${proNum(result.sessionRestRatio, 2)}`} />
          <p className="tool__note">{s.ratioNote}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              ...(workMode === "seconds"
                ? [{ label: s.workSeconds, value: proUnit(proNum(proParse(workSeconds) ?? 0, 0), s.unitS) }]
                : [
                    { label: s.eccentric, value: proUnit(proNum(proParse(eccentric) ?? 0, 0), s.unitS) },
                    { label: s.pauseBottom, value: proUnit(proNum(proParse(pauseBottom) ?? 0, 0), s.unitS) },
                    { label: s.concentric, value: proUnit(proNum(proParse(concentric) ?? 0, 0), s.unitS) },
                    { label: s.pauseTop, value: proUnit(proNum(proParse(pauseTop) ?? 0, 0), s.unitS) },
                  ]),
              { label: s.reps, value: proNum(proParse(reps) ?? 0, 0) },
              { label: s.sets, value: proNum(proParse(sets) ?? 0, 0) },
              { label: s.restBetweenSets, value: proUnit(proNum(proParse(restBetweenSets) ?? 0, 0), s.unitS) },
              { label: s.warmup, value: proUnit(proNum(proParse(warmup) ?? 0, 0), s.unitS) },
              { label: s.cooldown, value: proUnit(proNum(proParse(cooldown) ?? 0, 0), s.unitS) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Jump height from flight time and back, plus the reactive strength index. */
export function JumpHeightFlightTimeTool() {
  const s = strings.pro.trening["jump-height-flight-time"];
  const [flightTime, setFlightTime] = useState("");
  const [height, setHeight] = useState("");
  const [contactTime, setContactTime] = useState("");
  const [gravity, setGravity] = useState("9,80665");

  const typed = flightTime.trim() !== "" || height.trim() !== "";
  const flightProvided = flightTime.trim() !== "";
  const heightProvided = height.trim() !== "";
  const contactProvided = contactTime.trim() !== "";

  const result = jumpHeight({
    ...(flightProvided ? { flightTime: proParse(flightTime) ?? Number.NaN } : {}),
    ...(heightProvided ? { height: proParse(height) ?? Number.NaN } : {}),
    ...(contactProvided ? { contactTime: proParse(contactTime) ?? Number.NaN } : {}),
    gravity: proParse(gravity) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fields"
        ? s.errorFields
        : result.reason === "gravity"
          ? s.errorGravity
          : result.reason === "flightTime"
            ? s.errorFlightTime
            : result.reason === "height"
              ? s.errorHeight
              : s.errorContactTime;

  const copyText = !result.ok
    ? ""
    : [
        `${s.condition}: ${s.conditionNote}`,
        `${s.height2}: ${proUnit(proNum(result.height, 1), s.unitCm)}`,
        `${s.flightTime2}: ${proUnit(proNum(result.flightTime, 3), s.unitS)}`,
        `${s.takeoff}: ${proUnit(proNum(result.takeoff, 2), s.unitMps)}`,
        ...(result.rsi === undefined ? [] : [`${s.rsi}: ${proUnit(proNum(result.rsi, 2), s.unitMps)}`]),
        `${s.gravityUsed}: ${proUnit(proNum(result.gravity, 5), s.unitG)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.flightTime} hint={s.flightTimeHint} value={flightTime} onChange={setFlightTime} />
      <ToolInput label={s.height} hint={s.heightHint} value={height} onChange={setHeight} />
      <p className="tool__note">{s.fieldsHint}</p>
      <ToolInput label={s.contactTime} hint={s.contactTimeHint} value={contactTime} onChange={setContactTime} />
      <ToolInput label={s.gravity} hint={s.gravityHint} value={gravity} onChange={setGravity} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.condition} value={s.conditionNote} mono={false} />
          <ResultRow label={s.height2} value={proUnit(proNum(result.height, 1), s.unitCm)} />
          <ResultRow label={s.flightTime2} value={proUnit(proNum(result.flightTime, 3), s.unitS)} />
          <ResultRow label={s.takeoff} value={proUnit(proNum(result.takeoff, 2), s.unitMps)} />
          {result.rsi !== undefined && <ResultRow label={s.rsi} value={proUnit(proNum(result.rsi, 2), s.unitMps)} />}
          <ResultRow label={s.gravityUsed} value={proUnit(proNum(result.gravity, 5), s.unitG)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              ...(flightProvided
                ? [{ label: s.flightTime, value: proUnit(proNum(proParse(flightTime) ?? 0, 3), s.unitS) }]
                : []),
              ...(heightProvided
                ? [{ label: s.height, value: proUnit(proNum(proParse(height) ?? 0, 1), s.unitCm) }]
                : []),
              ...(contactProvided
                ? [{ label: s.contactTime, value: proUnit(proNum(proParse(contactTime) ?? 0, 3), s.unitS) }]
                : []),
              { label: s.gravity, value: proUnit(proNum(proParse(gravity) ?? 0, 5), s.unitG) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** The two sides as a percentage, and what the tested side would need to reach a chosen ratio. */
export function LimbSymmetryIndexTool() {
  const s = strings.pro.trening["limb-symmetry-index"];
  const [involved, setInvolved] = useState("");
  const [reference, setReference] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");

  const typed =
    proParse(involved) !== undefined || proParse(reference) !== undefined || proParse(target) !== undefined;
  const unitTrimmed = unit.trim();

  const result = limbSymmetry({
    involved: proParse(involved) ?? Number.NaN,
    reference: proParse(reference) ?? Number.NaN,
    target: proParse(target) ?? Number.NaN,
    ...(unitTrimmed === "" ? {} : { unit: unitTrimmed }),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "involved"
        ? s.errorInvolved
        : result.reason === "reference"
          ? s.errorReference
          : s.errorTarget;

  const resultUnit = result.ok ? (result.unit ?? "") : "";
  const withUnit = (value: string): string => (resultUnit === "" ? value : `${value} ${resultUnit}`);

  const copyText = !result.ok
    ? ""
    : [
        `${s.ratio}: ${proNum(result.ratio, 1)} %`,
        `${s.shortfall}: ${proNum(result.shortfall, 1)} %`,
        `${s.needed}: ${withUnit(proNum(result.needed, 2))}`,
        `${s.gap}: ${withUnit(proNum(result.gap, 2))}`,
        "",
        `${s.involved}: ${withUnit(proNum(proParse(involved) ?? 0, 2))}`,
        `${s.reference}: ${withUnit(proNum(proParse(reference) ?? 0, 2))}`,
        `${s.target}: ${proNum(proParse(target) ?? 0, 1)} %`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.involved} hint={s.involvedHint} value={involved} onChange={setInvolved} />
      <ToolInput label={s.reference} hint={s.referenceHint} value={reference} onChange={setReference} />
      <ToolInput label={s.target} hint={s.targetHint} value={target} onChange={setTarget} />
      <ToolInput label={s.unit} hint={s.unitHint} value={unit} onChange={setUnit} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {/* Only ratio, target and their quotient — nothing here says whether
              the ratio is acceptable, per the risk discipline this tool owes
              even outside the two enforced risk classes. */}
          <ToolAgainstLimit
            label={s.ratio}
            value={`${proNum(result.ratio, 1)} %`}
            limitLabel={s.target}
            limit={`${proNum(proParse(target) ?? 0, 1)} %`}
            ratioLabel=""
            ratio={undefined}
          />
          <ResultRow label={s.shortfall} value={`${proNum(result.shortfall, 1)} %`} />
          <ResultRow label={s.needed} value={withUnit(proNum(result.needed, 2))} />
          <ResultRow label={s.gap} value={withUnit(proNum(result.gap, 2))} />
          <p className="tool__note">{s.unitNote}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.involved, value: withUnit(proNum(proParse(involved) ?? 0, 2)) },
              { label: s.reference, value: withUnit(proNum(proParse(reference) ?? 0, 2)) },
              { label: s.target, value: `${proNum(proParse(target) ?? 0, 1)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Both published one-rep-max estimates, and a percentage table rounded to the plates on hand. */
export function OneRepMaxTableTool() {
  const s = strings.pro.trening["one-rep-max-table"];
  const [load, setLoad] = useState("");
  const [reps, setReps] = useState("");
  const [formula, setFormula] = useState<OneRmFormula>("epley");
  const [step, setStep] = useState("2,5");
  const [known1Rm, setKnown1Rm] = useState("");
  const [customPercent, setCustomPercent] = useState("");

  const typed = proParse(load) !== undefined || proParse(reps) !== undefined;
  const known1RmProvided = known1Rm.trim() !== "";
  const customProvided = customPercent.trim() !== "";

  const result = oneRepMaxTable({
    load: proParse(load) ?? Number.NaN,
    reps: proParse(reps) ?? Number.NaN,
    formula,
    step: proParse(step) ?? Number.NaN,
    ...(known1RmProvided ? { known1Rm: proParse(known1Rm) ?? Number.NaN } : {}),
    ...(customProvided ? { customPercent: proParse(customPercent) ?? Number.NaN } : {}),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "load"
        ? s.errorLoad
        : result.reason === "reps"
          ? s.errorReps
          : result.reason === "step"
            ? s.errorStep
            : result.reason === "known1Rm"
              ? s.errorKnown1Rm
              : s.errorCustomPercent;

  const copyText = !result.ok
    ? ""
    : [
        `${s.epley}: ${proUnit(proNum(result.epley, 1), s.unitKg)}`,
        `${s.brzycki}: ${proUnit(proNum(result.brzycki, 1), s.unitKg)}`,
        `${s.tableTitle}:`,
        ...result.rows.map(
          (row) =>
            `  ${proNum(row.percent, 1)} % — ${s.headExact}: ${proUnit(proNum(row.exact, 1), s.unitKg)}, ${s.headLoadable}: ${proUnit(proNum(row.loadable, 2), s.unitKg)}`,
        ),
        "",
        `${s.load}: ${proUnit(proNum(proParse(load) ?? 0, 2), s.unitKg)}`,
        `${s.reps}: ${proNum(proParse(reps) ?? 0, 0)}`,
        `${s.step}: ${proUnit(proNum(proParse(step) ?? 0, 2), s.unitKg)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.load} hint={s.loadHint} value={load} onChange={setLoad} />
      <ToolInput label={s.reps} hint={s.repsHint} value={reps} onChange={setReps} />
      <ToolSelect<OneRmFormula>
        label={s.formula2}
        value={formula}
        onChange={setFormula}
        options={[
          { id: "epley", label: s.formulaEpley },
          { id: "brzycki", label: s.formulaBrzycki },
        ]}
      />
      <ToolInput label={s.step} hint={s.stepHint} value={step} onChange={setStep} />
      <ToolInput label={s.known1Rm} hint={s.known1RmHint} value={known1Rm} onChange={setKnown1Rm} />
      <ToolInput label={s.customPercent} hint={s.customPercentHint} value={customPercent} onChange={setCustomPercent} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.epley} value={proUnit(proNum(result.epley, 1), s.unitKg)} />
          <ResultRow label={s.brzycki} value={proUnit(proNum(result.brzycki, 1), s.unitKg)} />
          {proParse(reps) === 1 && <p className="tool__note">{s.singleRepNote}</p>}
          {known1RmProvided && <p className="tool__note">{s.knownNote}</p>}
          <ToolTable
            head={[s.headPercent, s.headExact, s.headLoadable]}
            rows={result.rows.map((row) => [
              `${proNum(row.percent, 1)} %`,
              proUnit(proNum(row.exact, 1), s.unitKg),
              proUnit(proNum(row.loadable, 2), s.unitKg),
            ])}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.load, value: proUnit(proNum(proParse(load) ?? 0, 2), s.unitKg) },
              { label: s.reps, value: proNum(proParse(reps) ?? 0, 0) },
              { label: s.formula2, value: formula === "epley" ? s.formulaEpley : s.formulaBrzycki },
              { label: s.step, value: proUnit(proNum(proParse(step) ?? 0, 2), s.unitKg) },
              ...(known1RmProvided
                ? [{ label: s.known1Rm, value: proUnit(proNum(proParse(known1Rm) ?? 0, 2), s.unitKg) }]
                : []),
              ...(customProvided
                ? [{ label: s.customPercent, value: `${proNum(proParse(customPercent) ?? 0, 1)} %` }]
                : []),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Distance, time and pace: give any two and this returns the third, with an even split table. */
export function RunningPaceSplitsTool() {
  const s = strings.pro.trening["running-pace-splits"];
  const [distanceValue, setDistanceValue] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("km");
  const [time, setTime] = useState("");
  const [paceValue, setPaceValue] = useState("");
  const [paceUnit, setPaceUnit] = useState<PaceUnit>("perKm");
  const [splitStep, setSplitStep] = useState("1");
  const [splitStepUnit, setSplitStepUnit] = useState<"m" | "km">("km");

  const typed = distanceValue.trim() !== "" || time.trim() !== "" || paceValue.trim() !== "";
  const distanceProvided = distanceValue.trim() !== "";
  const timeProvided = time.trim() !== "";
  const paceProvided = paceValue.trim() !== "";
  const distanceUnitLabel =
    distanceUnit === "m" ? s.distanceUnitM : distanceUnit === "km" ? s.distanceUnitKm : s.distanceUnitMile;
  const paceUnitLabel = paceUnit === "perKm" ? s.paceUnitPerKm : s.paceUnitPerMile;

  // The one multiplication this surface performs: a km step into the metres
  // the core function's `splitStep` wants — the same „divide by 1000 to also
  // show metres" exception the exemplar names, run in reverse.
  const splitStepMetres =
    splitStepUnit === "km" ? (proParse(splitStep) ?? Number.NaN) * 1000 : (proParse(splitStep) ?? Number.NaN);

  const result = runningPace({
    ...(distanceProvided
      ? { distance: { unit: distanceUnit, value: proParse(distanceValue) ?? Number.NaN } }
      : {}),
    ...(timeProvided ? { time: parseClock(time) ?? Number.NaN } : {}),
    ...(paceProvided ? { pace: { unit: paceUnit, seconds: parseClock(paceValue) ?? Number.NaN } } : {}),
    splitStep: splitStepMetres,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fields"
        ? s.errorFields
        : result.reason === "step"
          ? s.errorStep
          : result.reason === "distance"
            ? s.errorDistance
            : result.reason === "time"
              ? s.errorTime
              : result.reason === "pace"
                ? s.errorPace
                : s.errorTooManyRows;

  const copyText = !result.ok
    ? ""
    : [
        `${s.pacePerKm}: ${clockMinSec(result.pacePerKm)}${s.unitPerKm}`,
        `${s.pacePerMile}: ${clockMinSec(result.pacePerMile)}${s.unitPerMile}`,
        `${s.pacePer100m}: ${clockMinSecFrac(result.pacePer100m, 1)}${s.unitPer100m}`,
        `${s.speedKmh}: ${proUnit(proNum(result.speedKmh, 2), s.unitKmh)}`,
        `${s.speedMps}: ${proUnit(proNum(result.speedMps, 2), s.unitMps)}`,
        `${s.splitsTitle}:`,
        ...result.splits.map(
          (sp) => `  ${proNum(sp.index, 0)}. ${proUnit(proNum(sp.distance, 0), s.unitM)} — ${sp.clock}`,
        ),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.distance} value={distanceValue} onChange={setDistanceValue} />
      <ToolSelect<DistanceUnit>
        label={s.distanceUnit}
        value={distanceUnit}
        onChange={setDistanceUnit}
        options={[
          { id: "m", label: s.distanceUnitM },
          { id: "km", label: s.distanceUnitKm },
          { id: "mile", label: s.distanceUnitMile },
        ]}
      />
      <ToolInput label={s.time} hint={s.timeHint} value={time} onChange={setTime} />
      <ToolInput label={s.pace} hint={s.paceHint} value={paceValue} onChange={setPaceValue} />
      <ToolSelect<PaceUnit>
        label={s.paceUnit}
        value={paceUnit}
        onChange={setPaceUnit}
        options={[
          { id: "perKm", label: s.paceUnitPerKm },
          { id: "perMile", label: s.paceUnitPerMile },
        ]}
      />
      <p className="tool__note">{s.fieldsHint}</p>
      <ToolInput label={s.splitStep} value={splitStep} onChange={setSplitStep} />
      <ToolSelect<"m" | "km">
        label={s.splitStepUnit}
        value={splitStepUnit}
        onChange={setSplitStepUnit}
        options={[
          { id: "m", label: s.splitStepUnitM },
          { id: "km", label: s.splitStepUnitKm },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.pacePerKm} value={`${clockMinSec(result.pacePerKm)}${s.unitPerKm}`} />
          <ResultRow label={s.pacePerMile} value={`${clockMinSec(result.pacePerMile)}${s.unitPerMile}`} />
          <ResultRow label={s.pacePer100m} value={`${clockMinSecFrac(result.pacePer100m, 1)}${s.unitPer100m}`} />
          <ResultRow label={s.speedKmh} value={proUnit(proNum(result.speedKmh, 2), s.unitKmh)} />
          <ResultRow label={s.speedMps} value={proUnit(proNum(result.speedMps, 2), s.unitMps)} />

          <ToolTable
            head={[s.headIndex, s.headDistance, s.headTime]}
            rows={result.splits.map((sp) => [
              proNum(sp.index, 0),
              proUnit(proNum(sp.distance, 0), s.unitM),
              sp.clock,
            ])}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              ...(distanceProvided
                ? [{ label: s.distance, value: `${distanceValue.trim()} ${distanceUnitLabel}` }]
                : []),
              ...(timeProvided ? [{ label: s.time, value: time.trim() }] : []),
              ...(paceProvided ? [{ label: s.pace, value: `${paceValue.trim()} ${paceUnitLabel}` }] : []),
              {
                label: s.splitStep,
                value: `${splitStep.trim()} ${splitStepUnit === "m" ? s.splitStepUnitM : s.splitStepUnitKm}`,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Time under tension for a four-number tempo, and how long the block takes. */
export function SetTempoTutTool() {
  const s = strings.pro.trening["set-tempo-tut"];
  const [eccentric, setEccentric] = useState("");
  const [pauseBottom, setPauseBottom] = useState("");
  const [concentric, setConcentric] = useState("");
  const [pauseTop, setPauseTop] = useState("");
  const [reps, setReps] = useState("");
  const [sets, setSets] = useState("1");
  const [restBetweenSets, setRestBetweenSets] = useState("0");

  const typed = [eccentric, pauseBottom, concentric, pauseTop, reps].some((v) => v.trim() !== "");

  const result = setTempoTut({
    eccentric: proParse(eccentric) ?? Number.NaN,
    pauseBottom: proParse(pauseBottom) ?? Number.NaN,
    concentric: proParse(concentric) ?? Number.NaN,
    pauseTop: proParse(pauseTop) ?? Number.NaN,
    reps: proParse(reps) ?? Number.NaN,
    sets: proParse(sets) ?? Number.NaN,
    restBetweenSets: proParse(restBetweenSets) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "tempo"
        ? s.errorTempo
        : result.reason === "reps"
          ? s.errorReps
          : result.reason === "sets"
            ? s.errorSets
            : s.errorRestBetweenSets;

  const copyText = !result.ok
    ? ""
    : [
        `${s.perRep}: ${proUnit(proNum(result.perRep, 0), s.unitS)}`,
        `${s.tutPerSet}: ${result.tutPerSetClock}`,
        `${s.totalTut}: ${result.totalTutClock}`,
        `${s.block}: ${result.blockClock}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.eccentric} hint={s.tempoHint} value={eccentric} onChange={setEccentric} />
      <ToolInput label={s.pauseBottom} value={pauseBottom} onChange={setPauseBottom} />
      <ToolInput label={s.concentric} value={concentric} onChange={setConcentric} />
      <ToolInput label={s.pauseTop} value={pauseTop} onChange={setPauseTop} />
      <ToolInput label={s.reps} value={reps} onChange={setReps} />
      <ToolInput label={s.sets} value={sets} onChange={setSets} />
      <ToolInput
        label={s.restBetweenSets}
        hint={s.restBetweenSetsHint}
        value={restBetweenSets}
        onChange={setRestBetweenSets}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.perRep} value={proUnit(proNum(result.perRep, 0), s.unitS)} />
          <ResultRow label={s.tutPerSet} value={result.tutPerSetClock} />
          <ResultRow label={s.totalTut} value={result.totalTutClock} />
          <ResultRow label={s.block} value={result.blockClock} />
          <p className="tool__note">{s.definitionNote}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.eccentric, value: proUnit(proNum(proParse(eccentric) ?? 0, 0), s.unitS) },
              { label: s.pauseBottom, value: proUnit(proNum(proParse(pauseBottom) ?? 0, 0), s.unitS) },
              { label: s.concentric, value: proUnit(proNum(proParse(concentric) ?? 0, 0), s.unitS) },
              { label: s.pauseTop, value: proUnit(proNum(proParse(pauseTop) ?? 0, 0), s.unitS) },
              { label: s.reps, value: proNum(proParse(reps) ?? 0, 0) },
              { label: s.sets, value: proNum(proParse(sets) ?? 0, 0) },
              {
                label: s.restBetweenSets,
                value: proUnit(proNum(proParse(restBetweenSets) ?? 0, 0), s.unitS),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Totals, spread and the two decline measures for a set of repeated efforts. */
export function SplitTimesFatigueTool() {
  const s = strings.pro.trening["split-times-fatigue"];
  const [timesText, setTimesText] = useState("");

  const lines = timesText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const typed = lines.length > 0;
  const times = lines.map((line) => parseClock(line) ?? Number.NaN);

  const result = splitSeries(times);

  const failure = result.ok || !typed ? undefined : s.errorTimes;

  const copyText = !result.ok
    ? ""
    : [
        `${s.count}: ${proNum(result.count, 0)}`,
        `${s.total}: ${clockMinSecFrac(result.total, 2)}`,
        `${s.mean}: ${proUnit(proNum(result.mean, 2), s.unitS)}`,
        `${s.median}: ${proUnit(proNum(result.median, 2), s.unitS)}`,
        `${s.best}: ${proUnit(proNum(result.best, 2), s.unitS)}`,
        `${s.worst}: ${proUnit(proNum(result.worst, 2), s.unitS)}`,
        `${s.range}: ${proUnit(proNum(result.range, 2), s.unitS)}`,
        `${s.fatigueIndex}: ${proNum(result.fatigueIndex, 2)} %`,
        `${s.decrement}: ${proNum(result.decrement, 2)} %`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.times} hint={s.timesHint} value={timesText} onChange={setTimesText} rows={8} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.count} value={proNum(result.count, 0)} />
          <ResultRow label={s.total} value={clockMinSecFrac(result.total, 2)} />
          <ResultRow label={s.mean} value={proUnit(proNum(result.mean, 2), s.unitS)} />
          <ResultRow label={s.median} value={proUnit(proNum(result.median, 2), s.unitS)} />
          <ResultRow label={s.best} value={proUnit(proNum(result.best, 2), s.unitS)} />
          <ResultRow label={s.worst} value={proUnit(proNum(result.worst, 2), s.unitS)} />
          <ResultRow label={s.range} value={proUnit(proNum(result.range, 2), s.unitS)} />
          <ResultRow label={s.fatigueIndex} value={`${proNum(result.fatigueIndex, 2)} %`} />
          <ResultRow label={s.decrement} value={`${proNum(result.decrement, 2)} %`} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={lines.map((line, index) => ({ label: `#${index + 1}`, value: line }))}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Sweat loss and sweat rate from the mass balance over a session. */
export function SweatRateHydrationTool() {
  const s = strings.pro.trening["sweat-rate-hydration"];
  const [preMass, setPreMass] = useState("");
  const [postMass, setPostMass] = useState("");
  const [drunk, setDrunk] = useState("0");
  const [food, setFood] = useState("0");
  const [urine, setUrine] = useState("0");
  const [duration, setDuration] = useState("");
  const [replacementPercent, setReplacementPercent] = useState("100");

  const typed =
    proParse(preMass) !== undefined || proParse(postMass) !== undefined || proParse(duration) !== undefined;

  const result = sweatRate({
    preMass: proParse(preMass) ?? Number.NaN,
    postMass: proParse(postMass) ?? Number.NaN,
    drunk: proParse(drunk) ?? Number.NaN,
    food: proParse(food) ?? Number.NaN,
    urine: proParse(urine) ?? Number.NaN,
    duration: proParse(duration) ?? Number.NaN,
    replacementPercent: proParse(replacementPercent) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "preMass"
        ? s.errorPreMass
        : result.reason === "postMass"
          ? s.errorPostMass
          : result.reason === "drunk"
            ? s.errorDrunk
            : result.reason === "food"
              ? s.errorFood
              : result.reason === "urine"
                ? s.errorUrine
                : result.reason === "duration"
                  ? s.errorDuration
                  : s.errorReplacementPercent;

  const copyText = !result.ok
    ? ""
    : [
        s.conventionNote,
        `${s.massLost}: ${proUnit(proNum(result.massLost, 3), s.unitKg)}`,
        `${s.percentBodyMass}: ${proNum(result.percentBodyMass, 2)} %`,
        `${s.sweatGrams}: ${proUnit(proNum(result.sweatGrams, 0), s.unitG)}`,
        `${s.sweatMl}: ${proUnit(proNum(result.sweatMl, 0), s.unitMl)}`,
        `${s.ratePerHour}: ${proUnit(proNum(result.ratePerHour, 0), s.unitMlPerH)}`,
        `${s.litresPerHour}: ${proUnit(proNum(result.litresPerHour, 2), s.unitLPerH)}`,
        `${s.replacementPerHour}: ${proUnit(proNum(result.replacementPerHour, 0), s.unitMlPerH)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.preMass} hint={s.massHint} value={preMass} onChange={setPreMass} />
      <ToolInput label={s.postMass} hint={s.massHint} value={postMass} onChange={setPostMass} />
      <ToolInput label={s.drunk} hint={s.drunkHint} value={drunk} onChange={setDrunk} />
      <ToolInput label={s.food} hint={s.foodHint} value={food} onChange={setFood} />
      <ToolInput label={s.urine} hint={s.urineHint} value={urine} onChange={setUrine} />
      <ToolInput label={s.duration} hint={s.durationHint} value={duration} onChange={setDuration} />
      <ToolInput label={s.replacementPercent} value={replacementPercent} onChange={setReplacementPercent} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="tool__note">{s.conventionNote}</p>
          <ResultRow label={s.massLost} value={proUnit(proNum(result.massLost, 3), s.unitKg)} />
          <ResultRow label={s.percentBodyMass} value={`${proNum(result.percentBodyMass, 2)} %`} />
          <ResultRow label={s.sweatGrams} value={proUnit(proNum(result.sweatGrams, 0), s.unitG)} />
          <ResultRow label={s.sweatMl} value={proUnit(proNum(result.sweatMl, 0), s.unitMl)} />
          <ResultRow label={s.ratePerHour} value={proUnit(proNum(result.ratePerHour, 0), s.unitMlPerH)} />
          <ResultRow label={s.litresPerHour} value={proUnit(proNum(result.litresPerHour, 2), s.unitLPerH)} />
          <ResultRow
            label={s.replacementPerHour}
            value={proUnit(proNum(result.replacementPerHour, 0), s.unitMlPerH)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.preMass, value: proUnit(proNum(proParse(preMass) ?? 0, 3), s.unitKg) },
              { label: s.postMass, value: proUnit(proNum(proParse(postMass) ?? 0, 3), s.unitKg) },
              { label: s.drunk, value: proUnit(proNum(proParse(drunk) ?? 0, 0), s.unitMl) },
              { label: s.food, value: proUnit(proNum(proParse(food) ?? 0, 0), s.unitG) },
              { label: s.urine, value: proUnit(proNum(proParse(urine) ?? 0, 0), s.unitMl) },
              { label: s.duration, value: proNum(proParse(duration) ?? 0, 0) },
              {
                label: s.replacementPercent,
                value: `${proNum(proParse(replacementPercent) ?? 0, 0)} %`,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Repetitions, tonnage and mean intensity for a written program. */
export function TrainingVolumeLoadTool() {
  const s = strings.pro.trening["training-volume-load"];
  const [rowsText, setRowsText] = useState("");

  const lines = rowsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const typed = lines.length > 0;

  // "serije x ponavljanja x opterećenje" and optionally "x 1RM" for that row.
  const rows: VolumeRow[] = lines.map((line) => {
    const tokens = line.split("x").map((token) => token.trim());
    const sets = proParse(tokens[0] ?? "") ?? Number.NaN;
    const reps = proParse(tokens[1] ?? "") ?? Number.NaN;
    const load = proParse(tokens[2] ?? "") ?? Number.NaN;
    const oneRmToken = tokens[3];
    const oneRm = oneRmToken === undefined || oneRmToken === "" ? undefined : proParse(oneRmToken);
    return oneRm === undefined ? { sets, reps, load } : { sets, reps, load, oneRm };
  });

  const result = trainingVolumeLoad({ rows });

  const failure = result.ok || !typed ? undefined : s.errorRows;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalSets}: ${proNum(result.totalSets, 0)}`,
        `${s.totalReps}: ${proNum(result.totalReps, 0)}`,
        `${s.tonnage}: ${proUnit(proNum(result.tonnage, 1), s.unitKg)}`,
        ...(result.meanLoad === undefined
          ? []
          : [`${s.meanLoad}: ${proUnit(proNum(result.meanLoad, 1), s.unitKg)}`]),
        ...result.intensityGroups.map(
          (group) => `  1RM ${proUnit(proNum(group.oneRm, 1), s.unitKg)} → ${proNum(group.meanIntensity, 1)} %`,
        ),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.rows} hint={s.rowsHint} value={rowsText} onChange={setRowsText} rows={8} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolSection title={s.rowsTitle}>
            <ToolTable
              head={[s.headReps, s.headTonnage, s.headIntensity]}
              rows={result.rows.map((row) => [
                proNum(row.reps, 0),
                proUnit(proNum(row.tonnage, 1), s.unitKg),
                row.intensity === undefined ? "—" : `${proNum(row.intensity, 1)} %`,
              ])}
            />
          </ToolSection>
          <ResultRow label={s.totalSets} value={proNum(result.totalSets, 0)} />
          <ResultRow label={s.totalReps} value={proNum(result.totalReps, 0)} />
          <ResultRow label={s.tonnage} value={proUnit(proNum(result.tonnage, 1), s.unitKg)} />
          {result.meanLoad !== undefined && (
            <ResultRow label={s.meanLoad} value={proUnit(proNum(result.meanLoad, 1), s.unitKg)} />
          )}
          {result.intensityGroups.length > 0 && (
            <ToolSection title={s.groupsTitle}>
              <ToolTable
                head={[s.headOneRm, s.headMeanIntensity]}
                rows={result.intensityGroups.map((group) => [
                  proUnit(proNum(group.oneRm, 1), s.unitKg),
                  `${proNum(group.meanIntensity, 1)} %`,
                ])}
              />
            </ToolSection>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={lines.map((line, index) => ({ label: `#${index + 1}`, value: line }))}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** How far a mass sits from a weight-class limit the athlete typed, and its even daily pace. */
export function WeightClassCutTool() {
  const s = strings.pro.trening["weight-class-cut"];
  const [mass, setMass] = useState("");
  const [limit, setLimit] = useState("");
  const [days, setDays] = useState("");

  const typed = proParse(mass) !== undefined || proParse(limit) !== undefined;

  const result = weightClassCut({
    mass: proParse(mass) ?? Number.NaN,
    limit: proParse(limit) ?? Number.NaN,
    days: proParse(days) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "mass"
        ? s.errorMass
        : result.reason === "limit"
          ? s.errorLimit
          : s.errorDays;

  // The label carries the sign — „iznad" or „ispod (rezerva)" — rather than a
  // verdict: neither word says whether the number is a problem, only where it
  // sits relative to the figure the user typed.
  const differenceNote = result.ok ? (result.difference > 0 ? s.aboveNote : s.belowNote) : "";

  const copyText = !result.ok
    ? ""
    : [
        differenceNote,
        `${s.difference}: ${proUnit(proNum(result.difference, 3), s.unitKg)}`,
        `${s.percentOfMass}: ${proNum(result.percentOfMass, 2)} %`,
        ...(result.perDay === undefined ? [] : [`${s.perDay}: ${proUnit(proNum(result.perDay, 3), s.unitKg)}`]),
        ...(result.perWeek === undefined
          ? []
          : [`${s.perWeek}: ${proUnit(proNum(result.perWeek, 3), s.unitKg)}`]),
        `${s.daysUsed}: ${proNum(result.days, 0)}`,
        ...(result.perWeekExtrapolated === true ? [s.extrapolatedNote] : []),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.mass} hint={s.massHint} value={mass} onChange={setMass} />
      <ToolInput label={s.limit} hint={s.limitHint} value={limit} onChange={setLimit} />
      <ToolInput label={s.days} hint={s.daysHint} value={days} onChange={setDays} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="tool__note">{differenceNote}</p>
          {/* Value beside the user's own limit, and nothing but that — the
              limit is a regulated figure a federation owns, never a default. */}
          <ToolAgainstLimit
            label={s.mass}
            value={proUnit(proNum(proParse(mass) ?? 0, 3), s.unitKg)}
            limitLabel={s.limit}
            limit={proUnit(proNum(proParse(limit) ?? 0, 3), s.unitKg)}
            ratioLabel=""
            ratio={undefined}
          />
          <ResultRow label={s.difference} value={proUnit(proNum(result.difference, 3), s.unitKg)} />
          <ResultRow label={s.percentOfMass} value={`${proNum(result.percentOfMass, 2)} %`} />
          {result.perDay !== undefined && (
            <ResultRow label={s.perDay} value={proUnit(proNum(result.perDay, 3), s.unitKg)} />
          )}
          {result.perWeek !== undefined && (
            <ResultRow label={s.perWeek} value={proUnit(proNum(result.perWeek, 3), s.unitKg)} />
          )}
          <ResultRow label={s.daysUsed} value={proNum(result.days, 0)} />
          {result.perWeekExtrapolated === true && <p className="tool__note">{s.extrapolatedNote}</p>}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mass, value: proUnit(proNum(proParse(mass) ?? 0, 3), s.unitKg) },
              { label: s.limit, value: proUnit(proNum(proParse(limit) ?? 0, 3), s.unitKg) },
              { label: s.days, value: proNum(proParse(days) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const TRENING_SURFACES: Readonly<Record<string, ComponentType>> = {
  "barbell-plate-loading": BarbellPlateLoadingTool,
  "body-fat-target-mass": BodyFatTargetMassTool,
  "body-indices": BodyIndicesTool,
  "cadence-stride-length": CadenceStrideLengthTool,
  "erg-split-watts": ErgSplitWattsTool,
  "heart-rate-zones-karvonen": HeartRateZonesKarvonenTool,
  "interval-session-timing": IntervalSessionTimingTool,
  "jump-height-flight-time": JumpHeightFlightTimeTool,
  "limb-symmetry-index": LimbSymmetryIndexTool,
  "one-rep-max-table": OneRepMaxTableTool,
  "running-pace-splits": RunningPaceSplitsTool,
  "set-tempo-tut": SetTempoTutTool,
  "split-times-fatigue": SplitTimesFatigueTool,
  "sweat-rate-hydration": SweatRateHydrationTool,
  "training-volume-load": TrainingVolumeLoadTool,
  "weight-class-cut": WeightClassCutTool,
};
