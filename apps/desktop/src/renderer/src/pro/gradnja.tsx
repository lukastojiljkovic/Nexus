import {
  stairFlight,
  type StairTop,
  convertAngle,
  type AngleInput,
  type AngleUnit,
  barSpacing,
  type BarLayout,
  beamCheck,
  type BeamScheme,
  concreteTakeoff,
  type ConcreteElement,
  drawingScaleLength,
  drawingScaleArea,
  drawingScaleFit,
  type ScaleDirection,
  type SheetSize,
  type SheetOrientation,
  earthworkVolumes,
  type EarthworkProfile,
  levelRun,
  type LevelReading,
  rebarFromLength,
  rebarFromMass,
  roofPitch,
  roomSurfaces,
  type RoomOpening,
  type RoomOpeningKind,
  type CoverageMode,
  slopeGrade,
  type SlopeKnown,
  type SlopeUnit,
  squareCheck,
  surveyInverse,
  surveyForward,
  type SurveyAngleUnit,
  tileCount,
  trenchVolume,
  wallAssembly,
  type WallLayer,
} from "@nexus/core/pro/gradnja";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  ResultRow,
  ToolAgainstLimit,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * The drawer's one row shape for a list, since the kit has no table-input
 * primitive: one row per line, cells separated by `;`. This SPLITS text — it
 * does not compute anything — and every cell still goes through `proParse`
 * before a tool ever sees it, exactly like a single-field input does.
 */
function proRows(text: string): readonly (readonly string[])[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split(";").map((cell) => cell.trim()));
}

/** The field name a core refusal names, with a `:row` suffix stripped. */
function reasonField(reason: string): string {
  const at = reason.indexOf(":");
  return at === -1 ? reason : reason.slice(0, at);
}

/**
 * „Gradnja i projektovanje" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/gradnja.ts`'s. Nothing here divides,
 * rounds or compares; this file shapes fields, hands the numbers over, and
 * reads the answers onto the page. That separation is what lets the maths be
 * tested against hand-worked vectors rather than against a screenshot.
 *
 * **Every surface in this file is `life-safety` or is not, and it never decides
 * which.** The host draws the notice from the registration and the copy button
 * appends the travelling line from the same place (`toolRisk.tsx`), so what is
 * left for a surface is the discipline the contract cannot enforce: show the
 * formula, echo the inputs, and put the user's own limit beside the computed
 * value with nothing but a ratio between them.
 */

export function StairGeometryTool() {
  const s = strings.pro.gradnja["stair-geometry"];
  const [rise, setRise] = useState("");
  const [risers, setRisers] = useState("");
  const [going, setGoing] = useState("");
  const [top, setTop] = useState<StairTop>("flush");
  const [riserLimit, setRiserLimit] = useState("");
  const [goingLimit, setGoingLimit] = useState("");
  const [roundTo, setRoundTo] = useState("");

  const typed = proParse(rise) !== undefined || proParse(risers) !== undefined || proParse(going) !== undefined;
  const flight = stairFlight({
    rise: proParse(rise) ?? Number.NaN,
    risers: proParse(risers) ?? Number.NaN,
    going: proParse(going) ?? Number.NaN,
    top,
    riserLimit: proParse(riserLimit),
    goingLimit: proParse(goingLimit),
    roundTo: proParse(roundTo),
  });

  const failure =
    flight.ok || !typed
      ? undefined
      : flight.reason === "rise"
        ? s.errorRise
        : flight.reason === "risers"
          ? s.errorRisers
          : flight.reason === "roundTo"
            ? s.errorRoundTo
            : s.errorGoing;

  const copyText = !flight.ok
    ? ""
    : [
        `${s.riser}: ${proUnit(proNum(flight.riser, 3), s.unitMm)}`,
        `${s.goings}: ${flight.goings}`,
        `${s.run}: ${proUnit(proNum(flight.run, 1), s.unitMm)}`,
        `${s.pitch}: ${proNum(flight.pitch, 4)}${s.unitDeg}`,
        `${s.blondel}: ${proUnit(proNum(flight.blondel, 3), s.unitMm)}`,
        "",
        // The rounding travels with the answer. A pasted riser of 167,647 mm
        // that omits „and it will be built at 168, six short at the top" is the
        // half of the result that causes the argument on site.
        `${s.roundedRiser}: ${proUnit(proNum(flight.rounded.riser, 3), s.unitMm)}`,
        `${s.roundedRise}: ${proUnit(proNum(flight.rounded.rise, 3), s.unitMm)}`,
        `${s.remainder}: ${proUnit(proNum(flight.rounded.remainder, 3), s.unitMm)}`,
        "",
        `${s.rise}: ${proUnit(proNum(proParse(rise) ?? 0, 1), s.unitMm)}`,
        `${s.risers}: ${risers.trim()}`,
        `${s.going}: ${proUnit(proNum(proParse(going) ?? 0, 1), s.unitMm)}`,
        `${s.roundTo}: ${proUnit(proNum(flight.rounded.step, 3), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.rise} hint={s.riseHint} value={rise} onChange={setRise} />
      <ToolInput label={s.risers} hint={s.risersHint} value={risers} onChange={setRisers} />
      <ToolInput label={s.going} hint={s.goingHint} value={going} onChange={setGoing} />
      <ToolSelect<StairTop>
        label={s.top}
        value={top}
        onChange={setTop}
        options={[
          { id: "flush", label: s.topFlush },
          { id: "landing", label: s.topLanding },
        ]}
      />
      {/* The two regulated figures, side by side with everything else and with
          no default in either. Which maximum applies depends on the building,
          its use and the rule in force — none of which this app has been told. */}
      <ToolInput
        label={s.riserLimit}
        hint={s.limitHint}
        value={riserLimit}
        onChange={setRiserLimit}
      />
      <ToolInput label={s.goingLimit} value={goingLimit} onChange={setGoingLimit} />
      {/* Empty means 1 mm, and the hint says so rather than the field showing a
          „1" the user then has to decide whether to trust. */}
      <ToolInput label={s.roundTo} hint={s.roundToHint} value={roundTo} onChange={setRoundTo} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {flight.ok && (
        <ToolSection title={s.results}>
          {/* Three decimals of a millimetre, and the reason is in the core
              module: the riser is H/n exactly, and rounding it is what leaves
              one step at the top a different height from the other sixteen. */}
          <ResultRow label={s.riser} value={proUnit(proNum(flight.riser, 3), s.unitMm)} />
          <ResultRow label={s.goings} value={flight.goings} />
          <ResultRow
            label={s.run}
            value={`${proUnit(proNum(flight.run, 1), s.unitMm)} · ${proUnit(proNum(flight.run / 1000, 3), s.unitM)}`}
          />
          <ResultRow label={s.pitch} value={`${proNum(flight.pitch, 4)}${s.unitDeg}`} />
          <ResultRow label={s.blondel} value={proUnit(proNum(flight.blondel, 3), s.unitMm)} />
          <p className="tool__note">{s.blondelNote}</p>

          {/* The computed value, the limit the user typed, and the quotient.
              No word, no colour, no icon — whether 0,96 is acceptable is a
              question for the person who chose the rule. */}
          <ToolAgainstLimit
            label={s.riser}
            value={proUnit(proNum(flight.riser, 3), s.unitMm)}
            limitLabel={s.riserLimit}
            limit={
              proParse(riserLimit) === undefined
                ? undefined
                : proUnit(proNum(proParse(riserLimit) ?? 0, 1), s.unitMm)
            }
            ratioLabel={s.riserRatio}
            ratio={proRatio(flight.riserRatio)}
          />
          <ToolAgainstLimit
            label={s.going}
            value={proUnit(proNum(proParse(going) ?? 0, 1), s.unitMm)}
            limitLabel={s.goingLimit}
            limit={
              proParse(goingLimit) === undefined
                ? undefined
                : proUnit(proNum(proParse(goingLimit) ?? 0, 1), s.unitMm)
            }
            ratioLabel={s.goingRatio}
            ratio={proRatio(flight.goingRatio)}
          />

          {/* The flight as the joiner will set it out. Three decimals above are
              the division; these are what gets marked on the batten, and the
              remainder is the millimetres that land on one step at the top. It
              is stated as arithmetic — no „pazi", no colour: whether 6 mm on the
              last step is acceptable depends on a rule this app was not told. */}
          <ToolSection title={s.rounded}>
            <ResultRow
              label={s.roundedRiser}
              value={proUnit(proNum(flight.rounded.riser, 3), s.unitMm)}
            />
            <ResultRow
              label={s.roundedRise}
              value={proUnit(proNum(flight.rounded.rise, 3), s.unitMm)}
            />
            <ResultRow
              label={s.remainder}
              value={proUnit(proNum(flight.rounded.remainder, 3), s.unitMm)}
            />
            <p className="tool__note">{s.remainderNote}</p>
          </ToolSection>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rise, value: proUnit(proNum(proParse(rise) ?? 0, 1), s.unitMm) },
              { label: s.risers, value: risers.trim() },
              { label: s.going, value: proUnit(proNum(proParse(going) ?? 0, 1), s.unitMm) },
              { label: s.top, value: top === "flush" ? s.topFlush : s.topLanding },
              // The step as it was USED, not as it was typed — an empty field
              // means 1 mm, and the echo has to say which number ran.
              {
                label: s.roundTo,
                value: proUnit(proNum(flight.rounded.step, 3), s.unitMm),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Which notation the angle field switches between — `AngleUnit` plus the DMS entry. */
type AngleFieldUnit = AngleUnit | "dms";

/**
 * One angle in all four notations at once, folded into a full circle and with
 * its reciprocal direction — the DMS parser/printer and the fold are what a
 * general unit converter does not do, which is the whole reason this tool
 * exists beside one.
 */
export function AngleUnitsTool() {
  const s = strings.pro.gradnja["angle-units"];
  const [unit, setUnit] = useState<AngleFieldUnit>("dms");
  const [value, setValue] = useState("");
  const [dmsSign, setDmsSign] = useState<"pos" | "neg">("pos");
  const [dmsDeg, setDmsDeg] = useState("");
  const [dmsMin, setDmsMin] = useState("");
  const [dmsSec, setDmsSec] = useState("");
  const [normalize, setNormalize] = useState<"yes" | "no">("yes");

  const typed =
    unit === "dms"
      ? proParse(dmsDeg) !== undefined || proParse(dmsMin) !== undefined || proParse(dmsSec) !== undefined
      : proParse(value) !== undefined;

  const input: AngleInput =
    unit === "dms"
      ? {
          unit: "dms",
          dms: {
            negative: dmsSign === "neg",
            degrees: proParse(dmsDeg) ?? Number.NaN,
            minutes: proParse(dmsMin) ?? Number.NaN,
            seconds: proParse(dmsSec) ?? Number.NaN,
          },
          normalize: normalize === "yes",
        }
      : { unit, value: proParse(value) ?? Number.NaN, normalize: normalize === "yes" };
  const result = convertAngle(input);

  const angleField = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : angleField === "degrees"
        ? s.errorDegrees
        : angleField === "minutes"
          ? s.errorMinutes
          : angleField === "seconds"
            ? s.errorSeconds
            : s.errorValue;

  const dmsText = (d: { negative: boolean; degrees: number; minutes: number; seconds: number }): string =>
    `${d.negative ? "-" : ""}${proNum(d.degrees, 0)}° ${proNum(d.minutes, 0)}′ ${proNum(d.seconds, 3)}″`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultDms}: ${dmsText(result.dms)}`,
        `${s.resultDeg}: ${proNum(result.degrees, 6)}${s.unitDeg}`,
        `${s.resultGon}: ${proNum(result.gon, 4)}${s.unitGon}`,
        `${s.resultRad}: ${proNum(result.radians, 9)}`,
        `${s.resultNormDeg}: ${proNum(result.normalizedDegrees, 6)}${s.unitDeg}`,
        `${s.resultNormGon}: ${proNum(result.normalizedGon, 4)}${s.unitGon}`,
        `${s.resultOppDeg}: ${proNum(result.oppositeDegrees, 6)}${s.unitDeg}`,
        `${s.resultOppGon}: ${proNum(result.oppositeGon, 4)}${s.unitGon}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<AngleFieldUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={[
          { id: "dms", label: s.unitDmsOpt },
          { id: "deg", label: s.unitDegOpt },
          { id: "gon", label: s.unitGonOpt },
          { id: "rad", label: s.unitRadOpt },
        ]}
      />
      {unit === "dms" ? (
        <>
          <ToolSelect<"pos" | "neg">
            label={s.sign}
            value={dmsSign}
            onChange={setDmsSign}
            options={[
              { id: "pos", label: s.signPos },
              { id: "neg", label: s.signNeg },
            ]}
          />
          <ToolInput label={s.degrees} value={dmsDeg} onChange={setDmsDeg} />
          <ToolInput label={s.minutes} value={dmsMin} onChange={setDmsMin} />
          <ToolInput label={s.seconds} value={dmsSec} onChange={setDmsSec} />
        </>
      ) : (
        <ToolInput label={s.value} value={value} onChange={setValue} />
      )}
      <ToolSelect<"yes" | "no">
        label={s.normalize}
        value={normalize}
        onChange={setNormalize}
        hint={s.normalizeHint}
        options={[
          { id: "yes", label: s.normalizeYes },
          { id: "no", label: s.normalizeNo },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultDms} value={dmsText(result.dms)} />
          <ResultRow label={s.resultDeg} value={`${proNum(result.degrees, 6)}${s.unitDeg}`} />
          <ResultRow label={s.resultGon} value={`${proNum(result.gon, 4)}${s.unitGon}`} />
          <ResultRow label={s.resultRad} value={proNum(result.radians, 9)} />
          <ResultRow
            label={s.resultNormDeg}
            value={`${proNum(result.normalizedDegrees, 6)}${s.unitDeg}`}
          />
          <ResultRow
            label={s.resultNormGon}
            value={`${proNum(result.normalizedGon, 4)}${s.unitGon}`}
          />
          <ResultRow
            label={s.resultOppDeg}
            value={`${proNum(result.oppositeDegrees, 6)}${s.unitDeg}`}
          />
          <ResultRow
            label={s.resultOppGon}
            value={`${proNum(result.oppositeGon, 4)}${s.unitGon}`}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.unit, value: unit === "dms" ? s.unitDmsOpt : unit === "deg" ? s.unitDegOpt : unit === "gon" ? s.unitGonOpt : s.unitRadOpt },
              { label: s.normalize, value: normalize === "yes" ? s.normalizeYes : s.normalizeNo },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** How the target spacing was given: a maximum, a fixed count, or a clear gap between real pieces. */
type BarMode = "maxSpacing" | "count" | "maxGap";

/**
 * Equal spacings over a run — from a maximum, from a fixed piece count, or
 * (absorbing the retired guard-rail infill tool) from a clear gap between
 * pieces of real width. The COUNT is what gets rounded up; the spacing itself
 * is always the exact division, which is the entire reason this tool exists
 * over doing it by hand — see `barSpacing`'s own doc for why the other order
 * produces a final gap wider than the maximum typed.
 */
export function BarSpacingTool() {
  const s = strings.pro.gradnja["bar-spacing"];
  const [lengthText, setLengthText] = useState("");
  const [lengthUnit, setLengthUnit] = useState<"m" | "mm">("m");
  const [startCoverText, setStartCoverText] = useState("");
  const [endCoverText, setEndCoverText] = useState("");
  const [layout, setLayout] = useState<BarLayout>("ends");
  const [mode, setMode] = useState<BarMode>("maxSpacing");
  const [maxSpacingText, setMaxSpacingText] = useState("");
  const [countText, setCountText] = useState("");
  const [maxGapText, setMaxGapText] = useState("");
  const [pieceWidthText, setPieceWidthText] = useState("");

  const lengthParsed = proParse(lengthText);
  const lengthMm = lengthParsed === undefined ? undefined : lengthUnit === "mm" ? lengthParsed : lengthParsed * 1000;
  const modeText = mode === "maxSpacing" ? maxSpacingText : mode === "count" ? countText : maxGapText;
  const typed = lengthParsed !== undefined || proParse(modeText) !== undefined;

  const result = barSpacing({
    length: lengthMm ?? Number.NaN,
    startCover: proParse(startCoverText) ?? Number.NaN,
    endCover: proParse(endCoverText) ?? Number.NaN,
    layout,
    maxSpacing: mode === "maxSpacing" ? proParse(maxSpacingText) : undefined,
    count: mode === "count" ? proParse(countText) : undefined,
    pieceWidth: proParse(pieceWidthText),
    maxGap: mode === "maxGap" ? proParse(maxGapText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "length"
        ? s.errorLength
        : field === "startCover"
          ? s.errorStartCover
          : field === "endCover"
            ? s.errorEndCover
            : field === "usableLength"
              ? s.errorUsableLength
              : field === "count"
                ? s.errorCount
                : field === "maxSpacing"
                  ? s.errorMaxSpacing
                  : field === "pieceWidth"
                    ? s.errorPieceWidth
                    : s.errorMaxGap;

  const limitText = mode === "maxSpacing" ? maxSpacingText : mode === "maxGap" ? maxGapText : "";
  const limitParsed = proParse(limitText);
  const limitLabel = mode === "maxGap" ? s.maxGap : s.maxSpacing;

  const copyText = !result.ok
    ? ""
    : [
        `${s.count}: ${result.count}`,
        `${s.spaces}: ${result.spaces}`,
        `${s.spacing}: ${proUnit(proNum(result.spacing, 1), s.unitMm)}`,
        `${s.usableLength}: ${proUnit(proNum(result.usableLength, 1), s.unitMm)}`,
        result.axisPitch === undefined
          ? undefined
          : `${s.axisPitch}: ${proUnit(proNum(result.axisPitch, 1), s.unitMm)}`,
        "",
        `${s.positions}: ${result.positions.map((p) => proNum(p, 1)).join(", ")}`,
        "",
        `${s.length}: ${proUnit(proNum(lengthMm ?? 0, 1), s.unitMm)}`,
        `${s.startCover}: ${proUnit(proNum(proParse(startCoverText) ?? 0, 1), s.unitMm)}`,
        `${s.endCover}: ${proUnit(proNum(proParse(endCoverText) ?? 0, 1), s.unitMm)}`,
        limitParsed === undefined ? undefined : `${limitLabel}: ${proUnit(proNum(limitParsed, 1), s.unitMm)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.length} value={lengthText} onChange={setLengthText} />
      <ToolSelect<"m" | "mm">
        label={s.lengthUnit}
        value={lengthUnit}
        onChange={setLengthUnit}
        options={[
          { id: "m", label: s.unitM },
          { id: "mm", label: s.unitMm },
        ]}
      />
      <ToolInput label={s.startCover} value={startCoverText} onChange={setStartCoverText} />
      <ToolInput label={s.endCover} value={endCoverText} onChange={setEndCoverText} />
      <ToolSelect<BarMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "maxSpacing", label: s.modeMaxSpacing },
          { id: "count", label: s.modeCount },
          { id: "maxGap", label: s.modeMaxGap },
        ]}
      />
      {mode !== "maxGap" && (
        <ToolSelect<BarLayout>
          label={s.layout}
          value={layout}
          onChange={setLayout}
          options={[
            { id: "ends", label: s.layoutEnds },
            { id: "field", label: s.layoutField },
          ]}
        />
      )}
      {mode === "maxSpacing" && (
        <ToolInput label={s.maxSpacing} hint={s.limitHint} value={maxSpacingText} onChange={setMaxSpacingText} />
      )}
      {mode === "count" && <ToolInput label={s.countLabel} value={countText} onChange={setCountText} />}
      {mode === "maxGap" && (
        <ToolInput label={s.maxGap} hint={s.limitHint} value={maxGapText} onChange={setMaxGapText} />
      )}
      <ToolInput
        label={s.pieceWidth}
        {...(mode === "maxGap" ? {} : { hint: s.pieceWidthHint })}
        value={pieceWidthText}
        onChange={setPieceWidthText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.count} value={result.count} />
          <ResultRow label={s.spaces} value={result.spaces} />
          <ToolAgainstLimit
            label={s.spacing}
            value={proUnit(proNum(result.spacing, 1), s.unitMm)}
            limitLabel={limitLabel}
            limit={limitParsed === undefined ? undefined : proUnit(proNum(limitParsed, 1), s.unitMm)}
            ratioLabel={s.spacingRatio}
            ratio={proRatio(result.spacingRatio)}
          />
          <ResultRow label={s.usableLength} value={proUnit(proNum(result.usableLength, 1), s.unitMm)} />
          {result.axisPitch !== undefined && (
            <ResultRow label={s.axisPitch} value={proUnit(proNum(result.axisPitch, 1), s.unitMm)} />
          )}
          <ToolOutput
            label={s.positions}
            value={result.positions.map((p) => proNum(p, 1)).join(", ")}
            multiline
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(lengthMm ?? 0, 1), s.unitMm) },
              { label: s.startCover, value: proUnit(proNum(proParse(startCoverText) ?? 0, 1), s.unitMm) },
              { label: s.endCover, value: proUnit(proNum(proParse(endCoverText) ?? 0, 1), s.unitMm) },
              { label: s.mode, value: mode === "maxSpacing" ? s.modeMaxSpacing : mode === "count" ? s.modeCount : s.modeMaxGap },
              { label: s.layout, value: layout === "ends" ? s.layoutEnds : s.layoutField },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Whether the second moment of area comes in directly or from a rectangular section. */
type BeamInertiaMode = "direct" | "section";

/**
 * Reactions, moment, stress and deflection for one of four textbook statical
 * schemes. Everything the surface does is unit bookkeeping and field
 * plumbing — the SI conversion and the four closed forms are `beamCheck`'s.
 */
export function BeamCheckTool() {
  const s = strings.pro.gradnja["beam-check"];
  const [scheme, setScheme] = useState<BeamScheme>("simple-udl");
  const [spanText, setSpanText] = useState("");
  const [loadText, setLoadText] = useState("");
  const [forceText, setForceText] = useState("");
  const [modulusText, setModulusText] = useState("");
  const [inertiaMode, setInertiaMode] = useState<BeamInertiaMode>("direct");
  const [inertiaText, setInertiaText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [sectionModulusText, setSectionModulusText] = useState("");
  const [stressLimitText, setStressLimitText] = useState("");
  const [deflectionRatioLimitText, setDeflectionRatioLimitText] = useState("");

  const distributed = scheme === "simple-udl" || scheme === "cantilever-udl";
  const typed =
    proParse(spanText) !== undefined ||
    proParse(loadText) !== undefined ||
    proParse(forceText) !== undefined;

  const result = beamCheck({
    scheme,
    span: proParse(spanText) ?? Number.NaN,
    load: distributed ? proParse(loadText) : undefined,
    force: distributed ? undefined : proParse(forceText),
    modulus: proParse(modulusText),
    inertia: inertiaMode === "direct" ? proParse(inertiaText) : undefined,
    section:
      inertiaMode === "section"
        ? { width: proParse(widthText) ?? Number.NaN, height: proParse(heightText) ?? Number.NaN }
        : undefined,
    sectionModulus: proParse(sectionModulusText),
    stressLimit: proParse(stressLimitText),
    deflectionRatioLimit: proParse(deflectionRatioLimitText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "span"
        ? s.errorSpan
        : field === "load"
          ? s.errorLoad
          : field === "force"
            ? s.errorForce
            : field === "modulus"
              ? s.errorModulus
              : field === "section"
                ? s.errorSection
                : field === "sectionModulus"
                  ? s.errorSectionModulus
                  : s.errorInertia;

  const stressLimitParsed = proParse(stressLimitText);
  const deflectionRatioLimitParsed = proParse(deflectionRatioLimitText);
  const schemeText =
    scheme === "simple-udl"
      ? s.schemeSimpleUdl
      : scheme === "simple-point"
        ? s.schemeSimplePoint
        : scheme === "cantilever-udl"
          ? s.schemeCantileverUdl
          : s.schemeCantileverPoint;

  const copyText = !result.ok
    ? ""
    : [
        `${s.reaction}: ${proUnit(proNum(result.reaction, 3), s.unitKn)}`,
        `${s.shear}: ${proUnit(proNum(result.shear, 3), s.unitKn)}`,
        `${s.maxMoment}: ${proUnit(proNum(result.maxMoment, 4), s.unitKnm)}`,
        result.fixingMoment === undefined
          ? undefined
          : `${s.fixingMoment}: ${proUnit(proNum(result.fixingMoment, 4), s.unitKnm)}`,
        result.stress === undefined
          ? undefined
          : `${s.stress}: ${proUnit(proNum(result.stress, 3), s.unitMpa)}`,
        result.deflection === undefined
          ? undefined
          : `${s.deflection}: ${proUnit(proNum(result.deflection, 4), s.unitMm)}`,
        result.spanOverDeflection === undefined
          ? undefined
          : `${s.spanOverDeflection}: ${result.spanOverDeflection}`,
        "",
        `${s.scheme}: ${schemeText}`,
        `${s.span}: ${proUnit(proNum(proParse(spanText) ?? 0, 3), s.unitM)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<BeamScheme>
        label={s.scheme}
        value={scheme}
        onChange={setScheme}
        options={[
          { id: "simple-udl", label: s.schemeSimpleUdl },
          { id: "simple-point", label: s.schemeSimplePoint },
          { id: "cantilever-udl", label: s.schemeCantileverUdl },
          { id: "cantilever-point", label: s.schemeCantileverPoint },
        ]}
      />
      <ToolInput label={s.span} value={spanText} onChange={setSpanText} />
      {distributed ? (
        <ToolInput label={s.load} value={loadText} onChange={setLoadText} />
      ) : (
        <ToolInput label={s.force} value={forceText} onChange={setForceText} />
      )}
      <ToolInput label={s.modulus} hint={s.modulusHint} value={modulusText} onChange={setModulusText} />
      <ToolSelect<BeamInertiaMode>
        label={s.inertiaMode}
        value={inertiaMode}
        onChange={setInertiaMode}
        options={[
          { id: "direct", label: s.inertiaModeDirect },
          { id: "section", label: s.inertiaModeSection },
        ]}
      />
      {inertiaMode === "direct" ? (
        <ToolInput label={s.inertia} value={inertiaText} onChange={setInertiaText} />
      ) : (
        <>
          <ToolInput label={s.width} hint={s.widthHint} value={widthText} onChange={setWidthText} />
          <ToolInput label={s.height} hint={s.heightHint} value={heightText} onChange={setHeightText} />
        </>
      )}
      <ToolInput
        label={s.sectionModulus}
        hint={s.sectionModulusHint}
        value={sectionModulusText}
        onChange={setSectionModulusText}
      />
      <ToolInput label={s.stressLimit} hint={s.limitHint} value={stressLimitText} onChange={setStressLimitText} />
      <ToolInput
        label={s.deflectionRatioLimit}
        hint={s.limitHint}
        value={deflectionRatioLimitText}
        onChange={setDeflectionRatioLimitText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.reaction} value={proUnit(proNum(result.reaction, 3), s.unitKn)} />
          <ResultRow label={s.shear} value={proUnit(proNum(result.shear, 3), s.unitKn)} />
          <ResultRow label={s.maxMoment} value={proUnit(proNum(result.maxMoment, 4), s.unitKnm)} />
          {result.fixingMoment !== undefined && (
            <ResultRow label={s.fixingMoment} value={proUnit(proNum(result.fixingMoment, 4), s.unitKnm)} />
          )}
          {result.stress !== undefined && (
            <ToolAgainstLimit
              label={s.stress}
              value={proUnit(proNum(result.stress, 3), s.unitMpa)}
              limitLabel={s.stressLimit}
              limit={stressLimitParsed === undefined ? undefined : proUnit(proNum(stressLimitParsed, 3), s.unitMpa)}
              ratioLabel={s.stressRatio}
              ratio={proRatio(result.stressRatio)}
            />
          )}
          {result.deflection !== undefined && (
            <ResultRow label={s.deflection} value={proUnit(proNum(result.deflection, 4), s.unitMm)} />
          )}
          {result.spanOverDeflection !== undefined && (
            <ToolAgainstLimit
              label={s.spanOverDeflection}
              value={result.spanOverDeflection}
              limitLabel={s.deflectionRatioLimit}
              limit={deflectionRatioLimitParsed === undefined ? undefined : proNum(deflectionRatioLimitParsed, 0)}
              ratioLabel={s.deflectionRatio}
              ratio={proRatio(result.deflectionRatio)}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.scheme, value: schemeText },
              { label: s.span, value: proUnit(proNum(proParse(spanText) ?? 0, 3), s.unitM) },
              distributed
                ? { label: s.load, value: proUnit(proNum(proParse(loadText) ?? 0, 3), s.unitKnm2) }
                : { label: s.force, value: proUnit(proNum(proParse(forceText) ?? 0, 3), s.unitKn) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** The five element kinds — see `ConcreteElement` for why this is a union and not one bag of fields. */
type ConcreteKind = ConcreteElement["kind"];

/**
 * Volume, formwork area and mixer batches for one repeated concrete element.
 * Which dimensions apply and what formwork counts differ per kind, so the
 * form itself switches on `kind` rather than showing five kinds of field at
 * once — the same fields (`a`, `b`, `h`, `length`) are reused with a
 * different meaning per kind, exactly as `concreteTakeoff`'s union does.
 */
export function ConcreteTakeoffTool() {
  const s = strings.pro.gradnja["concrete-takeoff"];
  const [kind, setKind] = useState<ConcreteKind>("slab");
  const [aText, setAText] = useState("");
  const [bText, setBText] = useState("");
  const [dText, setDText] = useState("");
  const [hText, setHText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [piecesText, setPiecesText] = useState("1");
  const [openingsText, setOpeningsText] = useState("");
  const [wasteText, setWasteText] = useState("");
  const [mixerVolumeText, setMixerVolumeText] = useState("");
  const [densityText, setDensityText] = useState("");
  const [rebarRateText, setRebarRateText] = useState("");

  const typed = [aText, bText, dText, hText, lengthText].some((t) => proParse(t) !== undefined);

  const element: ConcreteElement =
    kind === "slab"
      ? { kind, a: proParse(aText) ?? Number.NaN, b: proParse(bText) ?? Number.NaN, d: proParse(dText) ?? Number.NaN }
      : kind === "beam"
        ? { kind, b: proParse(bText) ?? Number.NaN, h: proParse(hText) ?? Number.NaN, length: proParse(lengthText) ?? Number.NaN }
        : kind === "column"
          ? { kind, a: proParse(aText) ?? Number.NaN, b: proParse(bText) ?? Number.NaN, h: proParse(hText) ?? Number.NaN }
          : kind === "strip-footing"
            ? { kind, b: proParse(bText) ?? Number.NaN, h: proParse(hText) ?? Number.NaN, length: proParse(lengthText) ?? Number.NaN }
            : { kind, a: proParse(aText) ?? Number.NaN, b: proParse(bText) ?? Number.NaN, h: proParse(hText) ?? Number.NaN };

  const result = concreteTakeoff({
    element,
    pieces: proParse(piecesText) ?? Number.NaN,
    openings: kind === "slab" ? proParse(openingsText) : undefined,
    waste: proParse(wasteText) ?? Number.NaN,
    mixerVolume: proParse(mixerVolumeText),
    density: proParse(densityText),
    rebarRate: proParse(rebarRateText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "pieces"
        ? s.errorPieces
        : field === "waste"
          ? s.errorWaste
          : field === "mixerVolume"
            ? s.errorMixerVolume
            : field === "density"
              ? s.errorDensity
              : field === "rebarRate"
                ? s.errorRebarRate
                : field === "openings"
                  ? s.errorOpenings
                  : field === "a"
                    ? s.errorA
                    : field === "b"
                      ? s.errorB
                      : field === "d"
                        ? s.errorD
                        : field === "h"
                          ? s.errorH
                          : s.errorLength;

  const kindLabel =
    kind === "slab"
      ? s.kindSlab
      : kind === "beam"
        ? s.kindBeam
        : kind === "column"
          ? s.kindColumn
          : kind === "strip-footing"
            ? s.kindStripFooting
            : s.kindPadFooting;

  const copyText = !result.ok
    ? ""
    : [
        `${s.netVolume}: ${proUnit(proNum(result.netVolume, 4), s.unitM3)}`,
        `${s.grossVolume}: ${proUnit(proNum(result.grossVolume, 4), s.unitM3)}`,
        `${s.formwork}: ${proUnit(proNum(result.formwork, 3), s.unitM2)}`,
        result.concreteMass === undefined
          ? undefined
          : `${s.concreteMass}: ${proUnit(proNum(result.concreteMass, 3), s.unitT)}`,
        result.rebarMass === undefined
          ? undefined
          : `${s.rebarMass}: ${proUnit(proNum(result.rebarMass, 1), s.unitKg)}`,
        result.batches === undefined ? undefined : `${s.batches}: ${result.batches}`,
        "",
        `${s.kind}: ${kindLabel}`,
        `${s.pieces}: ${piecesText.trim()}`,
        `${s.waste}: ${proUnit(proNum(proParse(wasteText) ?? 0, 1), s.unitPercent)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<ConcreteKind>
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "slab", label: s.kindSlab },
          { id: "beam", label: s.kindBeam },
          { id: "column", label: s.kindColumn },
          { id: "strip-footing", label: s.kindStripFooting },
          { id: "pad-footing", label: s.kindPadFooting },
        ]}
      />
      {(kind === "slab" || kind === "column" || kind === "pad-footing") && (
        <ToolInput label={s.a} value={aText} onChange={setAText} />
      )}
      <ToolInput label={s.b} value={bText} onChange={setBText} />
      {kind === "slab" && <ToolInput label={s.d} value={dText} onChange={setDText} />}
      {kind !== "slab" && <ToolInput label={s.h} value={hText} onChange={setHText} />}
      {(kind === "beam" || kind === "strip-footing") && (
        <ToolInput label={s.length} value={lengthText} onChange={setLengthText} />
      )}
      <ToolInput label={s.pieces} value={piecesText} onChange={setPiecesText} />
      {kind === "slab" && (
        <ToolInput label={s.openings} hint={s.openingsHint} value={openingsText} onChange={setOpeningsText} />
      )}
      <ToolInput label={s.waste} hint={s.wasteHint} value={wasteText} onChange={setWasteText} />
      <ToolInput label={s.mixerVolume} value={mixerVolumeText} onChange={setMixerVolumeText} />
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />
      <ToolInput label={s.rebarRate} hint={s.rebarRateHint} value={rebarRateText} onChange={setRebarRateText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.netVolume} value={proUnit(proNum(result.netVolume, 4), s.unitM3)} />
          <ResultRow label={s.grossVolume} value={proUnit(proNum(result.grossVolume, 4), s.unitM3)} />
          <ResultRow label={s.formwork} value={proUnit(proNum(result.formwork, 3), s.unitM2)} />
          {result.concreteMass !== undefined && (
            <ResultRow label={s.concreteMass} value={proUnit(proNum(result.concreteMass, 3), s.unitT)} />
          )}
          {result.rebarMass !== undefined && (
            <ResultRow label={s.rebarMass} value={proUnit(proNum(result.rebarMass, 1), s.unitKg)} />
          )}
          {result.batches !== undefined && <ResultRow label={s.batches} value={result.batches} />}
          <p className="tool__note">{s.formworkNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.kind, value: kindLabel },
              { label: s.pieces, value: piecesText.trim() },
              { label: s.waste, value: proUnit(proNum(proParse(wasteText) ?? 0, 1), s.unitPercent) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

const SHEET_SIZES: readonly SheetSize[] = ["A0", "A1", "A2", "A3", "A4"];

/**
 * A length or an area across a drawing scale, and whether an object at that
 * scale fits a chosen sheet — three related questions the trade asks about
 * one scale, kept as one tool because a designer reaches for all three in the
 * same sitting. The length conversion always shows; the area and fit sections
 * appear once their own fields are typed, each with its own refusal.
 */
export function DrawingScaleTool() {
  const s = strings.pro.gradnja["drawing-scale"];
  const [direction, setDirection] = useState<ScaleDirection>("paper-to-real");
  const [denominatorText, setDenominatorText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [paperAreaText, setPaperAreaText] = useState("");
  const [objectWidthText, setObjectWidthText] = useState("");
  const [objectHeightText, setObjectHeightText] = useState("");
  const [sheet, setSheet] = useState<SheetSize>("A3");
  const [orientation, setOrientation] = useState<SheetOrientation>("landscape");
  const [marginText, setMarginText] = useState("");

  const denominator = proParse(denominatorText);
  const typed = denominator !== undefined || proParse(lengthText) !== undefined;
  const lengthResult = drawingScaleLength({
    denominator: denominator ?? Number.NaN,
    direction,
    length: proParse(lengthText) ?? Number.NaN,
  });
  const lengthField = lengthResult.ok ? undefined : reasonField(lengthResult.reason);
  const lengthFailure =
    lengthResult.ok || !typed
      ? undefined
      : lengthField === "denominator"
        ? s.errorDenominator
        : s.errorLength;

  const areaTyped = proParse(paperAreaText) !== undefined;
  const areaResult = drawingScaleArea(denominator ?? Number.NaN, proParse(paperAreaText) ?? Number.NaN);
  const areaFailure =
    areaResult.ok || !areaTyped
      ? undefined
      : reasonField(areaResult.reason) === "denominator"
        ? s.errorDenominator
        : s.errorPaperArea;

  const fitTyped = proParse(objectWidthText) !== undefined && proParse(objectHeightText) !== undefined;
  const fitResult = drawingScaleFit({
    denominator: denominator ?? Number.NaN,
    objectWidth: proParse(objectWidthText) ?? Number.NaN,
    objectHeight: proParse(objectHeightText) ?? Number.NaN,
    sheet,
    orientation,
    margin: proParse(marginText) ?? 0,
  });
  const fitField = fitResult.ok ? undefined : reasonField(fitResult.reason);
  const fitFailure =
    fitResult.ok || !fitTyped
      ? undefined
      : fitField === "denominator"
        ? s.errorDenominator
        : fitField === "objectWidth"
          ? s.errorObjectWidth
          : fitField === "objectHeight"
            ? s.errorObjectHeight
            : s.errorMargin;

  const copyText = !lengthResult.ok
    ? ""
    : [
        `${s.paperLength}: ${proUnit(proNum(lengthResult.paperLength, 2), s.unitMm)}`,
        `${s.realLength}: ${proUnit(proNum(lengthResult.realLength, 3), s.unitM)}`,
        areaResult.ok ? `${s.realArea}: ${proUnit(proNum(areaResult.realArea, 3), s.unitM2)}` : undefined,
        fitResult.ok
          ? `${s.fits}: ${fitResult.fits ? s.fitsYes : fitResult.fitsRotated ? s.fitsRotated : s.fitsNo}`
          : undefined,
        fitResult.ok && fitResult.seriesDenominator !== undefined
          ? `${s.seriesDenominator}: 1:${proNum(fitResult.seriesDenominator, 0)}`
          : undefined,
        "",
        `${s.denominator}: 1:${denominatorText.trim()}`,
        `${s.direction}: ${direction === "paper-to-real" ? s.directionPaperToReal : s.directionRealToPaper}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.denominator} hint={s.denominatorHint} value={denominatorText} onChange={setDenominatorText} />
      <ToolSelect<ScaleDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "paper-to-real", label: s.directionPaperToReal },
          { id: "real-to-paper", label: s.directionRealToPaper },
        ]}
      />
      <ToolInput
        label={direction === "paper-to-real" ? s.lengthOnPaper : s.lengthReal}
        value={lengthText}
        onChange={setLengthText}
      />
      {lengthFailure !== undefined && <ToolFailure>{lengthFailure}</ToolFailure>}
      {lengthResult.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.paperLength} value={proUnit(proNum(lengthResult.paperLength, 2), s.unitMm)} />
          <ResultRow label={s.realLength} value={proUnit(proNum(lengthResult.realLength, 3), s.unitM)} />
        </ToolSection>
      )}

      <ToolInput label={s.paperArea} hint={s.paperAreaHint} value={paperAreaText} onChange={setPaperAreaText} />
      {areaFailure !== undefined && <ToolFailure>{areaFailure}</ToolFailure>}
      {areaResult.ok && areaTyped && (
        <ToolSection title={s.areaResults}>
          <ResultRow label={s.realArea} value={proUnit(proNum(areaResult.realArea, 3), s.unitM2)} />
        </ToolSection>
      )}

      <ToolInput label={s.objectWidth} value={objectWidthText} onChange={setObjectWidthText} />
      <ToolInput label={s.objectHeight} value={objectHeightText} onChange={setObjectHeightText} />
      <ToolSelect<SheetSize>
        label={s.sheet}
        value={sheet}
        onChange={setSheet}
        options={SHEET_SIZES.map((id) => ({ id, label: id }))}
      />
      <ToolSelect<SheetOrientation>
        label={s.orientation}
        value={orientation}
        onChange={setOrientation}
        options={[
          { id: "portrait", label: s.orientationPortrait },
          { id: "landscape", label: s.orientationLandscape },
        ]}
      />
      <ToolInput label={s.margin} hint={s.marginHint} value={marginText} onChange={setMarginText} />
      {fitFailure !== undefined && <ToolFailure>{fitFailure}</ToolFailure>}
      {fitResult.ok && fitTyped && (
        <ToolSection title={s.fitResults}>
          <ResultRow label={s.drawnWidth} value={proUnit(proNum(fitResult.drawnWidth, 1), s.unitMm)} />
          <ResultRow label={s.drawnHeight} value={proUnit(proNum(fitResult.drawnHeight, 1), s.unitMm)} />
          <ResultRow label={s.usableWidth} value={proUnit(proNum(fitResult.usableWidth, 1), s.unitMm)} />
          <ResultRow label={s.usableHeight} value={proUnit(proNum(fitResult.usableHeight, 1), s.unitMm)} />
          <ResultRow
            label={s.fits}
            value={fitResult.fits ? s.fitsYes : fitResult.fitsRotated ? s.fitsRotated : s.fitsNo}
          />
          <ResultRow
            label={s.seriesDenominator}
            value={fitResult.seriesDenominator === undefined ? s.seriesNone : `1:${proNum(fitResult.seriesDenominator, 0)}`}
          />
          <ResultRow label={s.requiredDenominator} value={`1:${proNum(fitResult.requiredDenominator, 1)}`} />
        </ToolSection>
      )}

      {lengthResult.ok && (
        <>
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="tool__note">{s.source}</p>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.denominator, value: `1:${denominatorText.trim()}` },
              { label: s.direction, value: direction === "paper-to-real" ? s.directionPaperToReal : s.directionRealToPaper },
            ]}
          />
          <CopyButton value={copyText} />
        </>
      )}
    </>
  );
}

/**
 * Cut and fill between cross-sections, by average end area or — where a
 * mid-section area was measured — by the prismoidal rule. One row per
 * profile: `stacionaža;iskop;nasip;srednji iskop;srednji nasip`, the last two
 * optional and only attached to the profile that BEGINS the segment they
 * describe.
 */
export function EarthworkTool() {
  const s = strings.pro.gradnja["earthwork-prismoidal"];
  const [profilesText, setProfilesText] = useState("");
  const [bulkingText, setBulkingText] = useState("");
  const [settlementText, setSettlementText] = useState("");

  const rows = proRows(profilesText);
  const typed = rows.length > 0;
  const profiles: EarthworkProfile[] = rows.map((row) => ({
    station: proParse(row[0] ?? "") ?? Number.NaN,
    cut: proParse(row[1] ?? "") ?? Number.NaN,
    fill: proParse(row[2] ?? "") ?? Number.NaN,
    midCut: proParse(row[3] ?? ""),
    midFill: proParse(row[4] ?? ""),
  }));

  const result = earthworkVolumes({
    profiles,
    bulking: proParse(bulkingText),
    settlement: proParse(settlementText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "rows"
        ? s.errorRows
        : field === "bulking"
          ? s.errorBulking
          : field === "settlement"
            ? s.errorSettlement
            : field === "station"
              ? s.errorStation
              : field === "cut"
                ? s.errorCut
                : field === "fill"
                  ? s.errorFill
                  : field === "midCut"
                    ? s.errorMidCut
                    : s.errorMidFill;

  const methodLabel = (method: "average-end-area" | "prismoidal"): string =>
    method === "prismoidal" ? s.methodPrismoidal : s.methodAverage;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalCut}: ${proUnit(proNum(result.totalCut, 2), s.unitM3)}`,
        `${s.totalFill}: ${proUnit(proNum(result.totalFill, 2), s.unitM3)}`,
        `${s.balance}: ${proUnit(proNum(result.balance, 2), s.unitM3)}`,
        result.cutLoose === undefined ? undefined : `${s.cutLoose}: ${proUnit(proNum(result.cutLoose, 2), s.unitM3)}`,
        result.fillWithSettlement === undefined
          ? undefined
          : `${s.fillWithSettlement}: ${proUnit(proNum(result.fillWithSettlement, 2), s.unitM3)}`,
        result.balanceAdjusted === undefined
          ? undefined
          : `${s.balanceAdjusted}: ${proUnit(proNum(result.balanceAdjusted, 2), s.unitM3)}`,
        "",
        `${s.profiles}: ${rows.length}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.profiles} hint={s.profilesHint} value={profilesText} onChange={setProfilesText} />
      <ToolInput label={s.bulking} hint={s.bulkingHint} value={bulkingText} onChange={setBulkingText} />
      <ToolInput label={s.settlement} value={settlementText} onChange={setSettlementText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colFrom, s.colTo, s.colLength, s.colCut, s.colFill, s.colMethod]}
            rows={result.segments.map((segment) => [
              proNum(segment.from, 2),
              proNum(segment.to, 2),
              proNum(segment.length, 2),
              proNum(segment.cut, 2),
              proNum(segment.fill, 2),
              segment.cutMethod === segment.fillMethod
                ? methodLabel(segment.cutMethod)
                : `${methodLabel(segment.cutMethod)} / ${methodLabel(segment.fillMethod)}`,
            ])}
          />
          <ResultRow label={s.totalCut} value={proUnit(proNum(result.totalCut, 2), s.unitM3)} />
          <ResultRow label={s.totalFill} value={proUnit(proNum(result.totalFill, 2), s.unitM3)} />
          <ResultRow label={s.balance} value={proUnit(proNum(result.balance, 2), s.unitM3)} />
          {result.cutLoose !== undefined && (
            <ResultRow label={s.cutLoose} value={proUnit(proNum(result.cutLoose, 2), s.unitM3)} />
          )}
          {result.fillWithSettlement !== undefined && (
            <ResultRow label={s.fillWithSettlement} value={proUnit(proNum(result.fillWithSettlement, 2), s.unitM3)} />
          )}
          {result.balanceAdjusted !== undefined && (
            <ResultRow label={s.balanceAdjusted} value={proUnit(proNum(result.balanceAdjusted, 2), s.unitM3)} />
          )}
          <p className="tool__note">{s.balanceNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.profiles, value: rows.length }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** A figure that may be absent from a row, printed as an em dash rather than skipped. */
function cellOrDash(value: number | undefined, digits: number): string {
  return value === undefined ? "—" : proNum(value, digits);
}

/**
 * A levelling run by height of collimation, with the arithmetic check and the
 * misclosure. One row per reading:
 * `tačka;nazad(BS);međuočitanje(IS);napred(FS);dužina viza`, all four numeric
 * cells optional except that every row needs at least one of BS/IS/FS.
 */
export function LevelRunTool() {
  const s = strings.pro.gradnja["level-run"];
  const [startElevationText, setStartElevationText] = useState("");
  const [readingsText, setReadingsText] = useState("");
  const [closingElevationText, setClosingElevationText] = useState("");

  const rows = proRows(readingsText);
  const typed = rows.length > 0 || proParse(startElevationText) !== undefined;
  const readings: LevelReading[] = rows.map((row) => ({
    point: row[0] ?? "",
    backsight: proParse(row[1] ?? ""),
    intermediate: proParse(row[2] ?? ""),
    foresight: proParse(row[3] ?? ""),
    distance: proParse(row[4] ?? ""),
  }));

  const result = levelRun({
    startElevation: proParse(startElevationText) ?? Number.NaN,
    readings,
    closingElevation: proParse(closingElevationText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "startElevation"
        ? s.errorStartElevation
        : field === "rows"
          ? s.errorRows
          : field === "closingElevation"
            ? s.errorClosingElevation
            : field === "row"
              ? s.errorRow
              : field === "backsight"
                ? s.errorBacksight
                : field === "intermediate"
                  ? s.errorIntermediate
                  : field === "foresight"
                    ? s.errorForesight
                    : s.errorDistance;

  const copyText = !result.ok
    ? ""
    : [
        `${s.firstElevation}: ${proNum(result.firstElevation, 3)}`,
        `${s.lastElevation}: ${proNum(result.lastElevation, 3)}`,
        `${s.sumBacksights}: ${proNum(result.sumBacksights, 3)}`,
        `${s.sumForesights}: ${proNum(result.sumForesights, 3)}`,
        `${s.checkDifference}: ${proNum(result.checkDifference, 3)}`,
        result.misclosure === undefined
          ? undefined
          : `${s.misclosure}: ${proUnit(proNum(result.misclosure * 1000, 1), s.unitMm)}`,
        `${s.stations}: ${result.stations}`,
        "",
        `${s.startElevation}: ${proNum(proParse(startElevationText) ?? 0, 3)}`,
        `${s.readingCount}: ${rows.length}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.startElevation} value={startElevationText} onChange={setStartElevationText} />
      <ToolTextArea label={s.readings} hint={s.readingsHint} value={readingsText} onChange={setReadingsText} />
      <ToolInput
        label={s.closingElevation}
        hint={s.closingElevationHint}
        value={closingElevationText}
        onChange={setClosingElevationText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colPoint, s.colInstrument, s.colElevation, s.colCorrection, s.colAdjusted]}
            rows={result.rows.map((row) => [
              row.point,
              cellOrDash(row.instrumentHeight, 3),
              proNum(row.elevation, 3),
              cellOrDash(row.correction, 3),
              cellOrDash(row.adjustedElevation, 3),
            ])}
          />
          <ResultRow label={s.sumBacksights} value={proNum(result.sumBacksights, 3)} />
          <ResultRow label={s.sumForesights} value={proNum(result.sumForesights, 3)} />
          <ResultRow label={s.checkDifference} value={proNum(result.checkDifference, 3)} />
          {result.misclosure !== undefined && (
            <ResultRow label={s.misclosure} value={proUnit(proNum(result.misclosure * 1000, 1), s.unitMm)} />
          )}
          <ResultRow label={s.stations} value={result.stations} />
          <p className="tool__note">{s.checkNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.startElevation, value: proNum(proParse(startElevationText) ?? 0, 3) },
              { label: s.readingCount, value: rows.length },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Which way the bar of reinforcement is being converted. */
type RebarDirection = "length-to-mass" | "mass-to-length";

/**
 * Nominal mass per metre of reinforcing bar, from EN 10080 / ISO 6935's
 * conventional density — and the same conversion run the other way, from a
 * mass back into metres and whole stock bars.
 */
export function RebarWeightTool() {
  const s = strings.pro.gradnja["rebar-weight"];
  const [diameterText, setDiameterText] = useState("");
  const [direction, setDirection] = useState<RebarDirection>("length-to-mass");
  const [barLengthText, setBarLengthText] = useState("");
  const [barsText, setBarsText] = useState("");
  const [massText, setMassText] = useState("");

  const typed =
    proParse(diameterText) !== undefined ||
    (direction === "length-to-mass"
      ? proParse(barLengthText) !== undefined || proParse(barsText) !== undefined
      : proParse(massText) !== undefined);

  const lengthResult =
    direction === "length-to-mass"
      ? rebarFromLength({
          diameter: proParse(diameterText) ?? Number.NaN,
          barLength: proParse(barLengthText) ?? Number.NaN,
          bars: proParse(barsText) ?? Number.NaN,
        })
      : undefined;
  const massResult =
    direction === "mass-to-length"
      ? rebarFromMass({
          diameter: proParse(diameterText) ?? Number.NaN,
          mass: proParse(massText) ?? Number.NaN,
          barLength: proParse(barLengthText),
        })
      : undefined;
  const result = lengthResult ?? massResult;

  const field = result === undefined || result.ok ? undefined : reasonField(result.reason);
  const failure =
    result === undefined || result.ok || !typed
      ? undefined
      : field === "diameter"
        ? s.errorDiameter
        : field === "barLength"
          ? s.errorBarLength
          : field === "bars"
            ? s.errorBars
            : s.errorMass;

  const copyText =
    lengthResult?.ok === true
      ? [
          `${s.massPerMetre}: ${proUnit(proNum(lengthResult.massPerMetre, 4), s.unitKgm)}`,
          `${s.totalLength}: ${proUnit(proNum(lengthResult.totalLength, 2), s.unitM)}`,
          `${s.totalMass}: ${proUnit(proNum(lengthResult.totalMass, 3), s.unitKg)}`,
          `${s.totalTonnes}: ${proUnit(proNum(lengthResult.totalTonnes, 3), s.unitT)}`,
          "",
          `${s.diameter}: ${proUnit(proNum(proParse(diameterText) ?? 0, 0), s.unitMm)}`,
        ].join("\n")
      : massResult?.ok === true
        ? [
            `${s.massPerMetre}: ${proUnit(proNum(massResult.massPerMetre, 4), s.unitKgm)}`,
            `${s.totalLength}: ${proUnit(proNum(massResult.totalLength, 2), s.unitM)}`,
            massResult.wholeBars === undefined ? undefined : `${s.wholeBars}: ${massResult.wholeBars}`,
            massResult.remainder === undefined
              ? undefined
              : `${s.remainder}: ${proUnit(proNum(massResult.remainder, 2), s.unitM)}`,
            "",
            `${s.diameter}: ${proUnit(proNum(proParse(diameterText) ?? 0, 0), s.unitMm)}`,
          ]
            .filter((line): line is string => line !== undefined)
            .join("\n")
        : "";

  return (
    <>
      <ToolInput label={s.diameter} hint={s.diameterHint} value={diameterText} onChange={setDiameterText} />
      <ToolSelect<RebarDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "length-to-mass", label: s.directionToMass },
          { id: "mass-to-length", label: s.directionToLength },
        ]}
      />
      {direction === "length-to-mass" ? (
        <>
          <ToolInput label={s.barLength} value={barLengthText} onChange={setBarLengthText} />
          <ToolInput label={s.bars} value={barsText} onChange={setBarsText} />
        </>
      ) : (
        <>
          <ToolInput label={s.mass} value={massText} onChange={setMassText} />
          <ToolInput label={s.stockLength} hint={s.stockLengthHint} value={barLengthText} onChange={setBarLengthText} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {lengthResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.massPerMetre} value={proUnit(proNum(lengthResult.massPerMetre, 4), s.unitKgm)} />
          <ResultRow label={s.totalLength} value={proUnit(proNum(lengthResult.totalLength, 2), s.unitM)} />
          <ResultRow label={s.totalMass} value={proUnit(proNum(lengthResult.totalMass, 3), s.unitKg)} />
          <ResultRow label={s.totalTonnes} value={proUnit(proNum(lengthResult.totalTonnes, 3), s.unitT)} />
          <p className="tool__note">{s.densityNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.diameter, value: proUnit(proNum(proParse(diameterText) ?? 0, 0), s.unitMm) },
              { label: s.barLength, value: proUnit(proNum(proParse(barLengthText) ?? 0, 2), s.unitM) },
              { label: s.bars, value: barsText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
      {massResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.massPerMetre} value={proUnit(proNum(massResult.massPerMetre, 4), s.unitKgm)} />
          <ResultRow label={s.totalLength} value={proUnit(proNum(massResult.totalLength, 2), s.unitM)} />
          {massResult.wholeBars !== undefined && <ResultRow label={s.wholeBars} value={massResult.wholeBars} />}
          {massResult.remainder !== undefined && (
            <ResultRow label={s.remainder} value={proUnit(proNum(massResult.remainder, 2), s.unitM)} />
          )}
          <p className="tool__note">{s.densityNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.diameter, value: proUnit(proNum(proParse(diameterText) ?? 0, 0), s.unitMm) },
              { label: s.mass, value: proUnit(proNum(proParse(massText) ?? 0, 2), s.unitKg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** How the pitch itself is written down — the same three notations `slopeGrade` reads. */
type RoofPitchUnit = "degrees" | "percent" | "ratio";

/**
 * Ridge height, rafter length, true plane area and the hip, from a pitch in
 * any of its three notations. `roofPitch` divides the plan area by the
 * cosine, never multiplies by the pitch — the substitution that is out by
 * about 13 % at 30° and is made constantly on site.
 */
export function RoofPitchTool() {
  const s = strings.pro.gradnja["roof-pitch"];
  const [pitchText, setPitchText] = useState("");
  const [pitchUnit, setPitchUnit] = useState<RoofPitchUnit>("degrees");
  const [baseText, setBaseText] = useState("");
  const [eavesText, setEavesText] = useState("");
  const [planAreaText, setPlanAreaText] = useState("");
  const [secondBaseText, setSecondBaseText] = useState("");

  const typed = proParse(pitchText) !== undefined || proParse(baseText) !== undefined;
  const result = roofPitch({
    pitch: proParse(pitchText) ?? Number.NaN,
    pitchUnit,
    base: proParse(baseText) ?? Number.NaN,
    eaves: proParse(eavesText),
    planArea: proParse(planAreaText),
    secondBase: proParse(secondBaseText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "pitch"
        ? s.errorPitch
        : field === "base"
          ? s.errorBase
          : field === "eaves"
            ? s.errorEaves
            : field === "planArea"
              ? s.errorPlanArea
              : s.errorSecondBase;

  const pitchUnitLabel =
    pitchUnit === "degrees" ? s.unitDegOpt : pitchUnit === "percent" ? s.unitPercentOpt : s.unitRatioOpt;

  const copyText = !result.ok
    ? ""
    : [
        `${s.angle}: ${proNum(result.angle, 4)}${s.unitDeg}`,
        `${s.height}: ${proUnit(proNum(result.height, 4), s.unitM)}`,
        `${s.rafter}: ${proUnit(proNum(result.rafter, 4), s.unitM)}`,
        result.rafterWithEaves === undefined
          ? undefined
          : `${s.rafterWithEaves}: ${proUnit(proNum(result.rafterWithEaves, 4), s.unitM)}`,
        result.slopeArea === undefined ? undefined : `${s.slopeArea}: ${proUnit(proNum(result.slopeArea, 3), s.unitM2)}`,
        result.hipLength === undefined ? undefined : `${s.hipLength}: ${proUnit(proNum(result.hipLength, 4), s.unitM)}`,
        result.hipAngle === undefined ? undefined : `${s.hipAngle}: ${proNum(result.hipAngle, 4)}${s.unitDeg}`,
        "",
        `${s.pitch}: ${proNum(proParse(pitchText) ?? 0, 4)} (${pitchUnitLabel})`,
        `${s.base}: ${proUnit(proNum(proParse(baseText) ?? 0, 3), s.unitM)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.pitch} value={pitchText} onChange={setPitchText} />
      <ToolSelect<RoofPitchUnit>
        label={s.pitchUnit}
        value={pitchUnit}
        onChange={setPitchUnit}
        options={[
          { id: "degrees", label: s.unitDegOpt },
          { id: "percent", label: s.unitPercentOpt },
          { id: "ratio", label: s.unitRatioOpt },
        ]}
      />
      <ToolInput label={s.base} value={baseText} onChange={setBaseText} />
      <ToolInput label={s.eaves} value={eavesText} onChange={setEavesText} />
      <ToolInput label={s.planArea} value={planAreaText} onChange={setPlanAreaText} />
      <ToolInput label={s.secondBase} hint={s.secondBaseHint} value={secondBaseText} onChange={setSecondBaseText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.angle} value={`${proNum(result.angle, 4)}${s.unitDeg}`} />
          <ResultRow label={s.height} value={proUnit(proNum(result.height, 4), s.unitM)} />
          <ResultRow label={s.rafter} value={proUnit(proNum(result.rafter, 4), s.unitM)} />
          {result.rafterWithEaves !== undefined && (
            <ResultRow label={s.rafterWithEaves} value={proUnit(proNum(result.rafterWithEaves, 4), s.unitM)} />
          )}
          {result.slopeArea !== undefined && (
            <ResultRow label={s.slopeArea} value={proUnit(proNum(result.slopeArea, 3), s.unitM2)} />
          )}
          {result.hipLength !== undefined && (
            <ResultRow label={s.hipLength} value={proUnit(proNum(result.hipLength, 4), s.unitM)} />
          )}
          {result.hipAngle !== undefined && (
            <ResultRow label={s.hipAngle} value={`${proNum(result.hipAngle, 4)}${s.unitDeg}`} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pitch, value: `${proNum(proParse(pitchText) ?? 0, 4)} (${pitchUnitLabel})` },
              { label: s.base, value: proUnit(proNum(proParse(baseText) ?? 0, 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** How the plan was measured: as a rectangle, or as a perimeter for a shape that is not one. */
type RoomPlanMode = "rectangle" | "perimeter";

/**
 * Wall, ceiling and reveal areas for one room, and the material they need.
 * Openings are one row each: `širina;visina;broj;vrata ili prozor;uključi
 * parapet(da/ne, opciono)`. A negative net wall is reported as-is rather than
 * clamped — see `roomSurfaces`'s own doc for why that is the correct answer.
 */
export function RoomSurfacesTool() {
  const s = strings.pro.gradnja["room-surfaces"];
  const [planMode, setPlanMode] = useState<RoomPlanMode>("rectangle");
  const [lengthText, setLengthText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [perimeterText, setPerimeterText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [openingsText, setOpeningsText] = useState("");
  const [deductOpenings, setDeductOpenings] = useState<"yes" | "no">("yes");
  const [revealDepthText, setRevealDepthText] = useState("");
  const [ceilingAreaText, setCeilingAreaText] = useState("");
  const [includeWalls, setIncludeWalls] = useState<"yes" | "no">("yes");
  const [includeReveals, setIncludeReveals] = useState<"yes" | "no">("no");
  const [includeCeiling, setIncludeCeiling] = useState<"yes" | "no">("yes");
  const [coverageText, setCoverageText] = useState("");
  const [coverageMode, setCoverageMode] = useState<CoverageMode>("area-per-litre");
  const [coatsText, setCoatsText] = useState("");

  const typed =
    proParse(lengthText) !== undefined ||
    proParse(widthText) !== undefined ||
    proParse(perimeterText) !== undefined ||
    proParse(heightText) !== undefined;

  const rows = proRows(openingsText);
  const openings: RoomOpening[] = rows.map((row) => {
    const kindCell = (row[3] ?? "").trim();
    const kind: RoomOpeningKind = kindCell === "vrata" ? "door" : "window";
    const sillCell = (row[4] ?? "").trim();
    return {
      width: proParse(row[0] ?? "") ?? Number.NaN,
      height: proParse(row[1] ?? "") ?? Number.NaN,
      count: proParse(row[2] ?? "") ?? Number.NaN,
      kind,
      includeSill: sillCell === "da" ? true : sillCell === "ne" ? false : undefined,
    };
  });
  const coverageParsed = proParse(coverageText);

  const result = roomSurfaces({
    length: planMode === "rectangle" ? proParse(lengthText) : undefined,
    width: planMode === "rectangle" ? proParse(widthText) : undefined,
    perimeter: planMode === "perimeter" ? proParse(perimeterText) : undefined,
    height: proParse(heightText) ?? Number.NaN,
    openings,
    deductOpenings: deductOpenings === "yes",
    revealDepth: proParse(revealDepthText),
    ceilingArea: proParse(ceilingAreaText),
    includeWalls: includeWalls === "yes",
    includeReveals: includeReveals === "yes",
    includeCeiling: includeCeiling === "yes",
    coverage: coverageParsed,
    coverageMode: coverageParsed === undefined ? undefined : coverageMode,
    coats: proParse(coatsText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "height"
        ? s.errorHeight
        : field === "length"
          ? s.errorLength
          : field === "width"
            ? s.errorWidth
            : field === "perimeter"
              ? s.errorPerimeter
              : field === "revealDepth"
                ? s.errorRevealDepth
                : field === "opening"
                  ? s.errorOpening
                  : field === "ceilingArea"
                    ? s.errorCeilingArea
                    : field === "coverage"
                      ? s.errorCoverage
                      : field === "coverageMode"
                        ? s.errorCoverageMode
                        : s.errorCoats;

  const copyText = !result.ok
    ? ""
    : [
        `${s.perimeter}: ${proUnit(proNum(result.perimeter, 3), s.unitM)}`,
        `${s.grossWall}: ${proUnit(proNum(result.grossWall, 4), s.unitM2)}`,
        `${s.openingArea}: ${proUnit(proNum(result.openingArea, 3), s.unitM2)}`,
        `${s.netWall}: ${proUnit(proNum(result.netWall, 4), s.unitM2)}`,
        `${s.revealLength}: ${proUnit(proNum(result.revealLength, 2), s.unitM)}`,
        result.revealArea === undefined ? undefined : `${s.revealArea}: ${proUnit(proNum(result.revealArea, 3), s.unitM2)}`,
        result.ceiling === undefined ? undefined : `${s.ceiling}: ${proUnit(proNum(result.ceiling, 3), s.unitM2)}`,
        `${s.totalArea}: ${proUnit(proNum(result.totalArea, 3), s.unitM2)}`,
        result.quantity === undefined
          ? undefined
          : `${s.quantity}: ${proNum(result.quantity, 3)} ${coverageMode === "area-per-litre" ? s.unitL : s.unitKg}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<RoomPlanMode>
        label={s.planMode}
        value={planMode}
        onChange={setPlanMode}
        options={[
          { id: "rectangle", label: s.planModeRectangle },
          { id: "perimeter", label: s.planModePerimeter },
        ]}
      />
      {planMode === "rectangle" ? (
        <>
          <ToolInput label={s.length} value={lengthText} onChange={setLengthText} />
          <ToolInput label={s.width} value={widthText} onChange={setWidthText} />
        </>
      ) : (
        <ToolInput label={s.perimeter} value={perimeterText} onChange={setPerimeterText} />
      )}
      <ToolInput label={s.height} value={heightText} onChange={setHeightText} />
      <ToolTextArea label={s.openings} hint={s.openingsHint} value={openingsText} onChange={setOpeningsText} />
      <ToolSelect<"yes" | "no">
        label={s.deductOpenings}
        value={deductOpenings}
        onChange={setDeductOpenings}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />
      <ToolInput label={s.revealDepth} value={revealDepthText} onChange={setRevealDepthText} />
      <ToolInput
        label={s.ceilingArea}
        hint={s.ceilingAreaHint}
        value={ceilingAreaText}
        onChange={setCeilingAreaText}
      />
      <ToolSelect<"yes" | "no">
        label={s.includeWalls}
        value={includeWalls}
        onChange={setIncludeWalls}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />
      <ToolSelect<"yes" | "no">
        label={s.includeReveals}
        value={includeReveals}
        onChange={setIncludeReveals}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />
      <ToolSelect<"yes" | "no">
        label={s.includeCeiling}
        value={includeCeiling}
        onChange={setIncludeCeiling}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />
      <ToolInput label={s.coverage} hint={s.coverageHint} value={coverageText} onChange={setCoverageText} />
      <ToolSelect<CoverageMode>
        label={s.coverageMode}
        value={coverageMode}
        onChange={setCoverageMode}
        options={[
          { id: "area-per-litre", label: s.coverageAreaPerLitre },
          { id: "mass-per-area", label: s.coverageMassPerArea },
        ]}
      />
      <ToolInput label={s.coats} value={coatsText} onChange={setCoatsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.perimeter} value={proUnit(proNum(result.perimeter, 3), s.unitM)} />
          <ResultRow label={s.grossWall} value={proUnit(proNum(result.grossWall, 4), s.unitM2)} />
          <ResultRow label={s.openingArea} value={proUnit(proNum(result.openingArea, 3), s.unitM2)} />
          <ResultRow label={s.netWall} value={proUnit(proNum(result.netWall, 4), s.unitM2)} />
          <ResultRow label={s.revealLength} value={proUnit(proNum(result.revealLength, 2), s.unitM)} />
          {result.revealArea !== undefined && (
            <ResultRow label={s.revealArea} value={proUnit(proNum(result.revealArea, 3), s.unitM2)} />
          )}
          {result.ceiling !== undefined && (
            <ResultRow label={s.ceiling} value={proUnit(proNum(result.ceiling, 3), s.unitM2)} />
          )}
          <ResultRow label={s.totalArea} value={proUnit(proNum(result.totalArea, 3), s.unitM2)} />
          {result.quantity !== undefined && (
            <ResultRow
              label={s.quantity}
              value={`${proNum(result.quantity, 3)} ${coverageMode === "area-per-litre" ? s.unitL : s.unitKg}`}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.height, value: proUnit(proNum(proParse(heightText) ?? 0, 3), s.unitM) },
              { label: s.deductOpenings, value: deductOpenings === "yes" ? s.yes : s.no },
              { label: s.openings, value: rows.length },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Every notation of a slope, from any two of run, rise, slant distance and
 * the slope itself. Which fields are shown follows `known` directly — this
 * is field plumbing, not a sixth copy of the trigonometry `slopeGrade` and
 * `roofPitch` already share through `angleFromSlopeNotation`.
 */
export function SlopeGradeTool() {
  const s = strings.pro.gradnja["slope-grade"];
  const [known, setKnown] = useState<SlopeKnown>("run-rise");
  const [runText, setRunText] = useState("");
  const [riseText, setRiseText] = useState("");
  const [slantText, setSlantText] = useState("");
  const [slopeText, setSlopeText] = useState("");
  const [slopeUnit, setSlopeUnit] = useState<SlopeUnit>("percent");

  const needsRun = known === "run-rise" || known === "run-slope" || known === "slant-run";
  const needsRise = known === "run-rise" || known === "rise-slope" || known === "slant-rise";
  const needsSlant = known === "slant-slope" || known === "slant-rise" || known === "slant-run";
  const needsSlope = known === "run-slope" || known === "rise-slope" || known === "slant-slope";

  const typed = [runText, riseText, slantText, slopeText].some((t) => proParse(t) !== undefined);
  const result = slopeGrade({
    known,
    run: needsRun ? proParse(runText) : undefined,
    rise: needsRise ? proParse(riseText) : undefined,
    slant: needsSlant ? proParse(slantText) : undefined,
    slope: needsSlope ? proParse(slopeText) : undefined,
    slopeUnit: needsSlope ? slopeUnit : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "run"
        ? s.errorRun
        : field === "rise"
          ? s.errorRise
          : field === "slant"
            ? s.errorSlant
            : s.errorSlope;

  const knownLabel =
    known === "run-rise"
      ? s.knownRunRise
      : known === "run-slope"
        ? s.knownRunSlope
        : known === "rise-slope"
          ? s.knownRiseSlope
          : known === "slant-slope"
            ? s.knownSlantSlope
            : known === "slant-rise"
              ? s.knownSlantRise
              : s.knownSlantRun;

  const copyText = !result.ok
    ? ""
    : [
        `${s.percent}: ${proNum(result.percent, 4)}${s.unitPercent}`,
        `${s.permille}: ${proNum(result.permille, 3)}${s.unitPermille}`,
        `${s.degrees}: ${proNum(result.degrees, 6)}${s.unitDeg}`,
        result.ratio === undefined ? undefined : `${s.ratio}: 1:${proNum(result.ratio, 4)}`,
        `${s.rise}: ${proUnit(proNum(result.rise, 4), s.unitM)}`,
        `${s.run}: ${proUnit(proNum(result.run, 4), s.unitM)}`,
        `${s.slant}: ${proUnit(proNum(result.slant, 5), s.unitM)}`,
        `${s.descending}: ${result.descending ? s.descendingYes : s.descendingNo}`,
        "",
        `${s.known}: ${knownLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<SlopeKnown>
        label={s.known}
        value={known}
        onChange={setKnown}
        options={[
          { id: "run-rise", label: s.knownRunRise },
          { id: "run-slope", label: s.knownRunSlope },
          { id: "rise-slope", label: s.knownRiseSlope },
          { id: "slant-slope", label: s.knownSlantSlope },
          { id: "slant-rise", label: s.knownSlantRise },
          { id: "slant-run", label: s.knownSlantRun },
        ]}
      />
      {needsRun && <ToolInput label={s.run} value={runText} onChange={setRunText} />}
      {needsRise && <ToolInput label={s.rise} hint={s.riseHint} value={riseText} onChange={setRiseText} />}
      {needsSlant && <ToolInput label={s.slant} value={slantText} onChange={setSlantText} />}
      {needsSlope && (
        <>
          <ToolInput label={s.slope} value={slopeText} onChange={setSlopeText} />
          <ToolSelect<SlopeUnit>
            label={s.slopeUnit}
            value={slopeUnit}
            onChange={setSlopeUnit}
            options={[
              { id: "percent", label: s.unitPercentOpt },
              { id: "permille", label: s.unitPermilleOpt },
              { id: "degrees", label: s.unitDegOpt },
              { id: "ratio", label: s.unitRatioOpt },
            ]}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.percent} value={`${proNum(result.percent, 4)}${s.unitPercent}`} />
          <ResultRow label={s.permille} value={`${proNum(result.permille, 3)}${s.unitPermille}`} />
          <ResultRow label={s.degrees} value={`${proNum(result.degrees, 6)}${s.unitDeg}`} />
          {result.ratio !== undefined && <ResultRow label={s.ratio} value={`1:${proNum(result.ratio, 4)}`} />}
          <p className="tool__note">{s.ratioNote}</p>
          <ResultRow label={s.rise} value={proUnit(proNum(result.rise, 4), s.unitM)} />
          <ResultRow label={s.run} value={proUnit(proNum(result.run, 4), s.unitM)} />
          <ResultRow label={s.slant} value={proUnit(proNum(result.slant, 5), s.unitM)} />
          <ResultRow label={s.descending} value={result.descending ? s.descendingYes : s.descendingNo} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.known, value: knownLabel }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * How far out of square a corner is, from its two sides and the measured
 * diagonal — the 3-4-5 rule is the integer case of this Pythagoras, not a
 * separate method, and the second diagonal's prediction holds only if the
 * quadrilateral really is a parallelogram, which two sides and one diagonal
 * do not on their own prove.
 */
export function SquareCheckTool() {
  const s = strings.pro.gradnja["square-check"];
  const [sideAText, setSideAText] = useState("");
  const [sideBText, setSideBText] = useState("");
  const [measuredDiagonalText, setMeasuredDiagonalText] = useState("");
  const [secondDiagonalText, setSecondDiagonalText] = useState("");

  const typed = proParse(sideAText) !== undefined || proParse(sideBText) !== undefined;
  const result = squareCheck({
    sideA: proParse(sideAText) ?? Number.NaN,
    sideB: proParse(sideBText) ?? Number.NaN,
    measuredDiagonal: proParse(measuredDiagonalText),
    secondDiagonal: proParse(secondDiagonalText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "sideA"
        ? s.errorSideA
        : field === "sideB"
          ? s.errorSideB
          : field === "measuredDiagonal"
            ? s.errorMeasuredDiagonal
            : s.errorSecondDiagonal;

  const copyText = !result.ok
    ? ""
    : [
        `${s.expectedDiagonal}: ${proUnit(proNum(result.expectedDiagonal, 4), s.unitM)}`,
        result.diagonalError === undefined
          ? undefined
          : `${s.diagonalError}: ${proUnit(proNum(result.diagonalError, 1), s.unitMm)}`,
        result.angle === undefined ? undefined : `${s.angle}: ${proNum(result.angle, 5)}${s.unitDeg}`,
        result.angleError === undefined ? undefined : `${s.angleError}: ${proNum(result.angleError, 5)}${s.unitDeg}`,
        result.offsetAlongA === undefined
          ? undefined
          : `${s.offsetAlongA}: ${proUnit(proNum(result.offsetAlongA, 1), s.unitMm)}`,
        result.diagonalDifference === undefined
          ? undefined
          : `${s.diagonalDifference}: ${proUnit(proNum(result.diagonalDifference, 1), s.unitMm)}`,
        result.expectedSecondDiagonal === undefined
          ? undefined
          : `${s.expectedSecondDiagonal}: ${proUnit(proNum(result.expectedSecondDiagonal, 4), s.unitM)}`,
        result.parallelogramSkew === undefined
          ? undefined
          : `${s.parallelogramSkew}: ${proUnit(proNum(result.parallelogramSkew, 1), s.unitMm)}`,
        "",
        `${s.sideA}: ${proUnit(proNum(proParse(sideAText) ?? 0, 3), s.unitM)}`,
        `${s.sideB}: ${proUnit(proNum(proParse(sideBText) ?? 0, 3), s.unitM)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.sideA} value={sideAText} onChange={setSideAText} />
      <ToolInput label={s.sideB} value={sideBText} onChange={setSideBText} />
      <ToolInput label={s.measuredDiagonal} value={measuredDiagonalText} onChange={setMeasuredDiagonalText} />
      <ToolInput
        label={s.secondDiagonal}
        hint={s.secondDiagonalHint}
        value={secondDiagonalText}
        onChange={setSecondDiagonalText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.expectedDiagonal} value={proUnit(proNum(result.expectedDiagonal, 4), s.unitM)} />
          {result.diagonalError !== undefined && (
            <ResultRow label={s.diagonalError} value={proUnit(proNum(result.diagonalError, 1), s.unitMm)} />
          )}
          {result.angle !== undefined && (
            <ResultRow label={s.angle} value={`${proNum(result.angle, 5)}${s.unitDeg}`} />
          )}
          {result.angleError !== undefined && (
            <ResultRow label={s.angleError} value={`${proNum(result.angleError, 5)}${s.unitDeg}`} />
          )}
          {result.offsetAlongA !== undefined && (
            <ResultRow label={s.offsetAlongA} value={proUnit(proNum(result.offsetAlongA, 1), s.unitMm)} />
          )}
          {result.diagonalDifference !== undefined && (
            <ResultRow label={s.diagonalDifference} value={proUnit(proNum(result.diagonalDifference, 1), s.unitMm)} />
          )}
          {result.expectedSecondDiagonal !== undefined && (
            <ResultRow
              label={s.expectedSecondDiagonal}
              value={proUnit(proNum(result.expectedSecondDiagonal, 4), s.unitM)}
            />
          )}
          {result.parallelogramSkew !== undefined && (
            <ResultRow label={s.parallelogramSkew} value={proUnit(proNum(result.parallelogramSkew, 1), s.unitMm)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sideA, value: proUnit(proNum(proParse(sideAText) ?? 0, 3), s.unitM) },
              { label: s.sideB, value: proUnit(proNum(proParse(sideBText) ?? 0, 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** The second geodetic problem (from coordinates) or the first (from a bearing and distance). */
type SurveyDirection = "inverse" | "forward";

/**
 * Distance and bearing between two known points, or a new point's
 * coordinates from a known one, a bearing and a distance. `atan2(ΔY, ΔX)` —
 * Y (east) first — is the one order that keeps the whole traverse from
 * silently rotating; see `surveyInverse`'s own doc for why the swap is
 * invisible in every single output.
 */
export function SurveyBearingDistanceTool() {
  const s = strings.pro.gradnja["survey-bearing-distance"];
  const [direction, setDirection] = useState<SurveyDirection>("inverse");
  const [ayText, setAyText] = useState("");
  const [axText, setAxText] = useState("");
  const [byText, setByText] = useState("");
  const [bxText, setBxText] = useState("");
  const [bearingUnit, setBearingUnit] = useState<SurveyAngleUnit>("gon");
  const [bearingText, setBearingText] = useState("");
  const [dmsSign, setDmsSign] = useState<"pos" | "neg">("pos");
  const [dmsDeg, setDmsDeg] = useState("");
  const [dmsMin, setDmsMin] = useState("");
  const [dmsSec, setDmsSec] = useState("");
  const [distanceText, setDistanceText] = useState("");

  const inverseTyped =
    proParse(ayText) !== undefined ||
    proParse(axText) !== undefined ||
    proParse(byText) !== undefined ||
    proParse(bxText) !== undefined;
  const forwardTyped =
    proParse(ayText) !== undefined ||
    proParse(axText) !== undefined ||
    proParse(bearingText) !== undefined ||
    proParse(dmsDeg) !== undefined ||
    proParse(distanceText) !== undefined;

  const inverseResult =
    direction === "inverse"
      ? surveyInverse({
          from: { y: proParse(ayText) ?? Number.NaN, x: proParse(axText) ?? Number.NaN },
          to: { y: proParse(byText) ?? Number.NaN, x: proParse(bxText) ?? Number.NaN },
        })
      : undefined;
  const forwardResult =
    direction === "forward"
      ? surveyForward({
          from: { y: proParse(ayText) ?? Number.NaN, x: proParse(axText) ?? Number.NaN },
          bearing: bearingUnit === "dms" ? undefined : proParse(bearingText),
          bearingUnit,
          bearingDms:
            bearingUnit === "dms"
              ? {
                  negative: dmsSign === "neg",
                  degrees: proParse(dmsDeg) ?? Number.NaN,
                  minutes: proParse(dmsMin) ?? Number.NaN,
                  seconds: proParse(dmsSec) ?? Number.NaN,
                }
              : undefined,
          distance: proParse(distanceText) ?? Number.NaN,
        })
      : undefined;
  const result = inverseResult ?? forwardResult;

  const field = result === undefined || result.ok ? undefined : reasonField(result.reason);
  const failure =
    result === undefined || result.ok || !(direction === "inverse" ? inverseTyped : forwardTyped)
      ? undefined
      : field === "pointA"
        ? s.errorPointA
        : field === "pointB"
          ? s.errorPointB
          : field === "distance"
            ? s.errorDistance
            : s.errorBearing;

  const copyText =
    inverseResult?.ok === true
      ? [
          `${s.deltaY}: ${proUnit(proNum(inverseResult.deltaY, 3), s.unitM)}`,
          `${s.deltaX}: ${proUnit(proNum(inverseResult.deltaX, 3), s.unitM)}`,
          `${s.distance}: ${proUnit(proNum(inverseResult.distance, 3), s.unitM)}`,
          inverseResult.bearingGon === undefined ? undefined : `${s.bearingGon}: ${proNum(inverseResult.bearingGon, 4)} gon`,
          inverseResult.bearingDeg === undefined ? undefined : `${s.bearingDeg}: ${proNum(inverseResult.bearingDeg, 6)}°`,
          inverseResult.oppositeGon === undefined ? undefined : `${s.oppositeGon}: ${proNum(inverseResult.oppositeGon, 4)} gon`,
          inverseResult.oppositeDeg === undefined ? undefined : `${s.oppositeDeg}: ${proNum(inverseResult.oppositeDeg, 6)}°`,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n")
      : forwardResult?.ok === true
        ? [
            `${s.newY}: ${proUnit(proNum(forwardResult.point.y, 3), s.unitM)}`,
            `${s.newX}: ${proUnit(proNum(forwardResult.point.x, 3), s.unitM)}`,
            `${s.bearingGon}: ${proNum(forwardResult.bearingGon, 4)} gon`,
            `${s.bearingDeg}: ${proNum(forwardResult.bearingDeg, 6)}°`,
            `${s.oppositeGon}: ${proNum(forwardResult.oppositeGon, 4)} gon`,
            `${s.oppositeDeg}: ${proNum(forwardResult.oppositeDeg, 6)}°`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<SurveyDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "inverse", label: s.directionInverse },
          { id: "forward", label: s.directionForward },
        ]}
      />
      <ToolInput label={s.pointAY} value={ayText} onChange={setAyText} />
      <ToolInput label={s.pointAX} value={axText} onChange={setAxText} />
      {direction === "inverse" ? (
        <>
          <ToolInput label={s.pointBY} value={byText} onChange={setByText} />
          <ToolInput label={s.pointBX} value={bxText} onChange={setBxText} />
        </>
      ) : (
        <>
          <ToolSelect<SurveyAngleUnit>
            label={s.bearingUnit}
            value={bearingUnit}
            onChange={setBearingUnit}
            options={[
              { id: "gon", label: s.unitGonOpt },
              { id: "deg", label: s.unitDegOpt },
              { id: "dms", label: s.unitDmsOpt },
            ]}
          />
          {bearingUnit === "dms" ? (
            <>
              <ToolSelect<"pos" | "neg">
                label={s.sign}
                value={dmsSign}
                onChange={setDmsSign}
                options={[
                  { id: "pos", label: s.signPos },
                  { id: "neg", label: s.signNeg },
                ]}
              />
              <ToolInput label={s.degrees} value={dmsDeg} onChange={setDmsDeg} />
              <ToolInput label={s.minutes} value={dmsMin} onChange={setDmsMin} />
              <ToolInput label={s.seconds} value={dmsSec} onChange={setDmsSec} />
            </>
          ) : (
            <ToolInput label={s.bearing} value={bearingText} onChange={setBearingText} />
          )}
          <ToolInput label={s.distance} value={distanceText} onChange={setDistanceText} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {inverseResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.deltaY} value={proUnit(proNum(inverseResult.deltaY, 3), s.unitM)} />
          <ResultRow label={s.deltaX} value={proUnit(proNum(inverseResult.deltaX, 3), s.unitM)} />
          <ResultRow label={s.distance} value={proUnit(proNum(inverseResult.distance, 3), s.unitM)} />
          {inverseResult.bearingGon !== undefined && (
            <ResultRow label={s.bearingGon} value={`${proNum(inverseResult.bearingGon, 4)} gon`} />
          )}
          {inverseResult.bearingDeg !== undefined && (
            <ResultRow label={s.bearingDeg} value={`${proNum(inverseResult.bearingDeg, 6)}°`} />
          )}
          {inverseResult.oppositeGon !== undefined && (
            <ResultRow label={s.oppositeGon} value={`${proNum(inverseResult.oppositeGon, 4)} gon`} />
          )}
          {inverseResult.oppositeDeg !== undefined && (
            <ResultRow label={s.oppositeDeg} value={`${proNum(inverseResult.oppositeDeg, 6)}°`} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pointAY, value: proNum(proParse(ayText) ?? 0, 3) },
              { label: s.pointAX, value: proNum(proParse(axText) ?? 0, 3) },
              { label: s.pointBY, value: proNum(proParse(byText) ?? 0, 3) },
              { label: s.pointBX, value: proNum(proParse(bxText) ?? 0, 3) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
      {forwardResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.newY} value={proUnit(proNum(forwardResult.point.y, 3), s.unitM)} />
          <ResultRow label={s.newX} value={proUnit(proNum(forwardResult.point.x, 3), s.unitM)} />
          <ResultRow label={s.bearingGon} value={`${proNum(forwardResult.bearingGon, 4)} gon`} />
          <ResultRow label={s.bearingDeg} value={`${proNum(forwardResult.bearingDeg, 6)}°`} />
          <ResultRow label={s.oppositeGon} value={`${proNum(forwardResult.oppositeGon, 4)} gon`} />
          <ResultRow label={s.oppositeDeg} value={`${proNum(forwardResult.oppositeDeg, 6)}°`} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pointAY, value: proNum(proParse(ayText) ?? 0, 3) },
              { label: s.pointAX, value: proNum(proParse(axText) ?? 0, 3) },
              { label: s.distance, value: proUnit(proNum(proParse(distanceText) ?? 0, 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Which box figure fixes the box count — pieces per box wins when both are given. */
type TileBoxMode = "perBox" | "areaPerBox";

/**
 * Pieces, boxes and the leftover from an area and a tile format. The count is
 * rounded up ONCE, at the very end — rounding the pieces-per-square-metre
 * figure first and multiplying afterwards under-orders, which is the
 * classic mistake copied out of a printed table.
 */
export function TileCountTool() {
  const s = strings.pro.gradnja["tile-count"];
  const [areaText, setAreaText] = useState("");
  const [tileWidthText, setTileWidthText] = useState("");
  const [tileHeightText, setTileHeightText] = useState("");
  const [jointText, setJointText] = useState("");
  const [wasteText, setWasteText] = useState("");
  const [boxMode, setBoxMode] = useState<TileBoxMode>("perBox");
  const [perBoxText, setPerBoxText] = useState("");
  const [areaPerBoxText, setAreaPerBoxText] = useState("");

  const typed = proParse(areaText) !== undefined || proParse(tileWidthText) !== undefined;
  const result = tileCount({
    area: proParse(areaText) ?? Number.NaN,
    tileWidth: proParse(tileWidthText) ?? Number.NaN,
    tileHeight: proParse(tileHeightText) ?? Number.NaN,
    joint: proParse(jointText) ?? Number.NaN,
    waste: proParse(wasteText) ?? Number.NaN,
    perBox: boxMode === "perBox" ? proParse(perBoxText) : undefined,
    areaPerBox: boxMode === "areaPerBox" ? proParse(areaPerBoxText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "area"
        ? s.errorArea
        : field === "tileWidth"
          ? s.errorTileWidth
          : field === "tileHeight"
            ? s.errorTileHeight
            : field === "joint"
              ? s.errorJoint
              : field === "waste"
                ? s.errorWaste
                : field === "perBox"
                  ? s.errorPerBox
                  : s.errorAreaPerBox;

  const copyText = !result.ok
    ? ""
    : [
        `${s.perSquareMetre}: ${proNum(result.perSquareMetre, 4)}`,
        `${s.areaWithWaste}: ${proUnit(proNum(result.areaWithWaste, 3), s.unitM2)}`,
        `${s.pieces}: ${result.pieces}`,
        result.boxes === undefined ? undefined : `${s.boxes}: ${result.boxes}`,
        result.surplusPieces === undefined ? undefined : `${s.surplusPieces}: ${result.surplusPieces}`,
        result.surplusArea === undefined
          ? undefined
          : `${s.surplusArea}: ${proUnit(proNum(result.surplusArea, 3), s.unitM2)}`,
        "",
        `${s.area}: ${proUnit(proNum(proParse(areaText) ?? 0, 3), s.unitM2)}`,
        `${s.tileWidth}: ${proUnit(proNum(proParse(tileWidthText) ?? 0, 0), s.unitMm)}`,
        `${s.tileHeight}: ${proUnit(proNum(proParse(tileHeightText) ?? 0, 0), s.unitMm)}`,
        `${s.joint}: ${proUnit(proNum(proParse(jointText) ?? 0, 1), s.unitMm)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.area} value={areaText} onChange={setAreaText} />
      <ToolInput label={s.tileWidth} value={tileWidthText} onChange={setTileWidthText} />
      <ToolInput label={s.tileHeight} value={tileHeightText} onChange={setTileHeightText} />
      <ToolInput label={s.joint} value={jointText} onChange={setJointText} />
      <ToolInput label={s.waste} hint={s.wasteHint} value={wasteText} onChange={setWasteText} />
      <ToolSelect<TileBoxMode>
        label={s.boxMode}
        value={boxMode}
        onChange={setBoxMode}
        options={[
          { id: "perBox", label: s.boxModePerBox },
          { id: "areaPerBox", label: s.boxModeAreaPerBox },
        ]}
      />
      {boxMode === "perBox" ? (
        <ToolInput label={s.perBox} value={perBoxText} onChange={setPerBoxText} />
      ) : (
        <ToolInput label={s.areaPerBox} value={areaPerBoxText} onChange={setAreaPerBoxText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.perSquareMetre} value={proNum(result.perSquareMetre, 4)} />
          <ResultRow label={s.areaWithWaste} value={proUnit(proNum(result.areaWithWaste, 3), s.unitM2)} />
          <ResultRow label={s.pieces} value={result.pieces} />
          {result.boxes !== undefined && <ResultRow label={s.boxes} value={result.boxes} />}
          {result.surplusPieces !== undefined && (
            <ResultRow label={s.surplusPieces} value={result.surplusPieces} />
          )}
          {result.surplusArea !== undefined && (
            <ResultRow label={s.surplusArea} value={proUnit(proNum(result.surplusArea, 3), s.unitM2)} />
          )}
          <p className="tool__note">{s.gridNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.area, value: proUnit(proNum(proParse(areaText) ?? 0, 3), s.unitM2) },
              { label: s.tileWidth, value: proUnit(proNum(proParse(tileWidthText) ?? 0, 0), s.unitMm) },
              { label: s.tileHeight, value: proUnit(proNum(proParse(tileHeightText) ?? 0, 0), s.unitMm) },
              { label: s.joint, value: proUnit(proNum(proParse(jointText) ?? 0, 1), s.unitMm) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Whether the bottom width is typed directly, or derived from the pipe plus its working space. */
type TrenchWidthMode = "direct" | "fromPipe";

/**
 * Excavation, backfill and spoil for a trapezoidal trench. Bulking applies
 * only to the spoil that actually leaves the site — see `trenchVolume`'s own
 * doc for why adding a bulked excavation to an in-situ backfill counts the
 * same cubic metre twice, at two different sizes.
 */
export function TrenchVolumeTool() {
  const s = strings.pro.gradnja["trench-volume"];
  const [lengthText, setLengthText] = useState("");
  const [widthMode, setWidthMode] = useState<TrenchWidthMode>("direct");
  const [bottomWidthText, setBottomWidthText] = useState("");
  const [depthText, setDepthText] = useState("");
  const [batterText, setBatterText] = useState("");
  const [pipeDiameterText, setPipeDiameterText] = useState("");
  const [workingSpaceText, setWorkingSpaceText] = useState("");
  const [beddingThicknessText, setBeddingThicknessText] = useState("");
  const [bulkingText, setBulkingText] = useState("");
  const [returnsSpoil, setReturnsSpoil] = useState<"yes" | "no">("yes");

  const typed = proParse(lengthText) !== undefined || proParse(depthText) !== undefined;
  const result = trenchVolume({
    length: proParse(lengthText) ?? Number.NaN,
    bottomWidth: widthMode === "direct" ? proParse(bottomWidthText) : undefined,
    depth: proParse(depthText) ?? Number.NaN,
    batter: proParse(batterText) ?? Number.NaN,
    pipeDiameter: proParse(pipeDiameterText),
    workingSpace: proParse(workingSpaceText),
    beddingThickness: proParse(beddingThicknessText),
    bulking: proParse(bulkingText) ?? Number.NaN,
    returnsSpoil: returnsSpoil === "yes",
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "length"
        ? s.errorLength
        : field === "depth"
          ? s.errorDepth
          : field === "batter"
            ? s.errorBatter
            : field === "bulking"
              ? s.errorBulking
              : field === "pipeDiameter"
                ? s.errorPipeDiameter
                : field === "bottomWidth"
                  ? s.errorBottomWidth
                  : s.errorBeddingThickness;

  const copyText = !result.ok
    ? ""
    : [
        `${s.crossSection}: ${proUnit(proNum(result.crossSection, 4), s.unitM2)}`,
        `${s.topWidth}: ${proUnit(proNum(result.topWidth, 3), s.unitM)}`,
        `${s.excavation}: ${proUnit(proNum(result.excavation, 3), s.unitM3)}`,
        `${s.bedding}: ${proUnit(proNum(result.bedding, 3), s.unitM3)}`,
        `${s.pipe}: ${proUnit(proNum(result.pipe, 3), s.unitM3)}`,
        `${s.backfill}: ${proUnit(proNum(result.backfill, 3), s.unitM3)}`,
        `${s.surplus}: ${proUnit(proNum(result.surplus, 3), s.unitM3)}`,
        `${s.surplusLoose}: ${proUnit(proNum(result.surplusLoose, 3), s.unitM3)}`,
        "",
        `${s.length}: ${proUnit(proNum(proParse(lengthText) ?? 0, 2), s.unitM)}`,
        `${s.depth}: ${proUnit(proNum(proParse(depthText) ?? 0, 3), s.unitM)}`,
        `${s.batter}: ${proNum(proParse(batterText) ?? 0, 3)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.length} value={lengthText} onChange={setLengthText} />
      <ToolSelect<TrenchWidthMode>
        label={s.widthMode}
        value={widthMode}
        onChange={setWidthMode}
        options={[
          { id: "direct", label: s.widthModeDirect },
          { id: "fromPipe", label: s.widthModeFromPipe },
        ]}
      />
      {widthMode === "direct" ? (
        <ToolInput label={s.bottomWidth} value={bottomWidthText} onChange={setBottomWidthText} />
      ) : (
        <ToolInput label={s.workingSpace} hint={s.workingSpaceHint} value={workingSpaceText} onChange={setWorkingSpaceText} />
      )}
      <ToolInput label={s.depth} value={depthText} onChange={setDepthText} />
      <ToolInput label={s.batter} hint={s.limitHint} value={batterText} onChange={setBatterText} />
      <ToolInput label={s.pipeDiameter} value={pipeDiameterText} onChange={setPipeDiameterText} />
      <ToolInput label={s.beddingThickness} value={beddingThicknessText} onChange={setBeddingThicknessText} />
      <ToolInput label={s.bulking} hint={s.bulkingHint} value={bulkingText} onChange={setBulkingText} />
      <ToolSelect<"yes" | "no">
        label={s.returnsSpoil}
        value={returnsSpoil}
        onChange={setReturnsSpoil}
        hint={s.returnsSpoilHint}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.crossSection} value={proUnit(proNum(result.crossSection, 4), s.unitM2)} />
          <ResultRow label={s.topWidth} value={proUnit(proNum(result.topWidth, 3), s.unitM)} />
          <ResultRow label={s.excavation} value={proUnit(proNum(result.excavation, 3), s.unitM3)} />
          <ResultRow label={s.bedding} value={proUnit(proNum(result.bedding, 3), s.unitM3)} />
          <ResultRow label={s.pipe} value={proUnit(proNum(result.pipe, 3), s.unitM3)} />
          <ResultRow label={s.backfill} value={proUnit(proNum(result.backfill, 3), s.unitM3)} />
          <ResultRow label={s.surplus} value={proUnit(proNum(result.surplus, 3), s.unitM3)} />
          <ResultRow label={s.surplusLoose} value={proUnit(proNum(result.surplusLoose, 3), s.unitM3)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(proParse(lengthText) ?? 0, 2), s.unitM) },
              { label: s.depth, value: proUnit(proNum(proParse(depthText) ?? 0, 3), s.unitM) },
              { label: s.batter, value: proNum(proParse(batterText) ?? 0, 3) },
              { label: s.returnsSpoil, value: returnsSpoil === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Total resistance, U-value and the temperature at every layer boundary of a
 * wall or roof assembly. One row per layer, inside to outside:
 * `naziv;debljina(cm);λ;otpor` — the last cell, when filled, is a ready-made
 * resistance for an unventilated air layer (which has no λ to divide a
 * thickness by) and wins over the thickness/conductivity pair.
 */
export function WallUValueTool() {
  const s = strings.pro.gradnja["wall-u-value"];
  const [layersText, setLayersText] = useState("");
  const [rsiText, setRsiText] = useState("");
  const [rseText, setRseText] = useState("");
  const [insideTempText, setInsideTempText] = useState("");
  const [outsideTempText, setOutsideTempText] = useState("");

  const rows = proRows(layersText);
  const typed = rows.length > 0;
  const layers: WallLayer[] = rows.map((row) => {
    const resistance = proParse(row[3] ?? "");
    if (resistance !== undefined) return { resistance };
    const thicknessCm = proParse(row[1] ?? "");
    return {
      thickness: thicknessCm === undefined ? undefined : thicknessCm / 100,
      conductivity: proParse(row[2] ?? ""),
    };
  });

  const result = wallAssembly({
    layers,
    rsi: proParse(rsiText) ?? Number.NaN,
    rse: proParse(rseText) ?? Number.NaN,
    insideTemperature: proParse(insideTempText),
    outsideTemperature: proParse(outsideTempText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "layers"
        ? s.errorLayers
        : field === "rsi"
          ? s.errorRsi
          : field === "rse"
            ? s.errorRse
            : field === "resistance"
              ? s.errorResistance
              : field === "thickness"
                ? s.errorThickness
                : s.errorConductivity;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalResistance}: ${proNum(result.totalResistance, 6)}`,
        result.uValue === undefined ? undefined : `${s.uValue}: ${proUnit(proNum(result.uValue, 4), s.unitWm2k)}`,
        result.innerSurfaceTemperature === undefined
          ? undefined
          : `${s.innerSurfaceTemperature}: ${proNum(result.innerSurfaceTemperature, 3)}${s.unitC}`,
        result.outerSurfaceTemperature === undefined
          ? undefined
          : `${s.outerSurfaceTemperature}: ${proNum(result.outerSurfaceTemperature, 3)}${s.unitC}`,
        "",
        `${s.layers}: ${rows.length}`,
        `${s.rsi}: ${proNum(proParse(rsiText) ?? 0, 2)}`,
        `${s.rse}: ${proNum(proParse(rseText) ?? 0, 2)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.layers} hint={s.layersHint} value={layersText} onChange={setLayersText} />
      <ToolInput label={s.rsi} hint={s.rsiHint} value={rsiText} onChange={setRsiText} />
      <ToolInput label={s.rse} value={rseText} onChange={setRseText} />
      <ToolInput label={s.insideTemperature} value={insideTempText} onChange={setInsideTempText} />
      <ToolInput label={s.outsideTemperature} value={outsideTempText} onChange={setOutsideTempText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colLayer, s.colResistance, s.colShare, s.colBoundaryTemp]}
            rows={result.layers.map((layer, index) => [
              (rows[index]?.[0] ?? "").trim() || `${index + 1}.`,
              proNum(layer.resistance, 6),
              `${proNum(layer.share, 1)}%`,
              cellOrDash(layer.boundaryTemperature, 3),
            ])}
          />
          <ResultRow label={s.totalResistance} value={proNum(result.totalResistance, 6)} />
          {result.uValue !== undefined && (
            <ResultRow label={s.uValue} value={proUnit(proNum(result.uValue, 4), s.unitWm2k)} />
          )}
          {result.innerSurfaceTemperature !== undefined && (
            <ResultRow label={s.innerSurfaceTemperature} value={`${proNum(result.innerSurfaceTemperature, 3)}${s.unitC}`} />
          )}
          {result.outerSurfaceTemperature !== undefined && (
            <ResultRow label={s.outerSurfaceTemperature} value={`${proNum(result.outerSurfaceTemperature, 3)}${s.unitC}`} />
          )}
          <p className="tool__note">{s.scopeNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.layers, value: rows.length },
              { label: s.rsi, value: proNum(proParse(rsiText) ?? 0, 2) },
              { label: s.rse, value: proNum(proParse(rseText) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const GRADNJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "stair-geometry": StairGeometryTool,
  "angle-units": AngleUnitsTool,
  "bar-spacing": BarSpacingTool,
  "beam-check": BeamCheckTool,
  "concrete-takeoff": ConcreteTakeoffTool,
  "drawing-scale": DrawingScaleTool,
  "earthwork-prismoidal": EarthworkTool,
  "level-run": LevelRunTool,
  "rebar-weight": RebarWeightTool,
  "roof-pitch": RoofPitchTool,
  "room-surfaces": RoomSurfacesTool,
  "slope-grade": SlopeGradeTool,
  "square-check": SquareCheckTool,
  "survey-bearing-distance": SurveyBearingDistanceTool,
  "tile-count": TileCountTool,
  "trench-volume": TrenchVolumeTool,
  "wall-u-value": WallUValueTool,
};
