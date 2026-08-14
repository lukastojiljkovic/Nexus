import { foldSearchText } from "@nexus/core";
import {
  backwardsTimeline,
  type TimelineStep,
  type BackwardsTimelineInput,
  type TimelineMoment,
  bakersPercentage,
  type BakersRole,
  type BakersMode,
  type BakersLine,
  brineSalt,
  type BrineMode,
  type BrineBasis,
  coffeeExtraction,
  doughWaterTemperature,
  type DoughTempMode,
  iceCreamOverrun,
  type OverrunMode,
  laminationLayers,
  type FoldKind,
  levainHydration,
  type LevainMode,
  nutritionPerPortion,
  type NutritionDirection,
  type EnergyUnit,
  type NutritionRow,
  panConversion,
  type PanShape,
  frustumVolume,
  plateCost,
  type PlateUnit,
  type PlateLine,
  portionsFromPack,
  type PackUnit,
  parseRatio,
  ratioSplit,
  parseQuantity,
  type RecipeUnit,
  type RecipeScaleMode,
  type RecipeLine,
  recipeScale,
  solutionConcentration,
  type SolutionMode,
  usCustomaryUnit,
  type UsSourceUnit,
  type MetricTargetUnit,
  yieldTrimCook,
  type YieldMode,
} from "@nexus/core/pro/kuhinja";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  proRows,
  reasonField,
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
 * „Kuhinja i pekara" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/kuhinja.ts`'s. This file parses fields with
 * `proParse`, hands the numbers to the core function, and prints what comes
 * back — nothing here divides, rounds or compares.
 *
 * **Two tools carry an absolute discipline this file cannot relax.**
 * `BrineSaltTool` (food-safety) and `SolutionConcentrationTool` (life-safety)
 * print masses, percentages and ratios and never a word about whether either is
 * enough, appropriate or safe — the host draws the notice, and what is left here
 * is to never grow an opinion in the copy.
 */

/* -------------------------------------------------------------------------- */
/* backwards-timeline                                                          */
/* -------------------------------------------------------------------------- */

/** "HH:MM" plus a day marker, or a concrete date when one was given. */
function timelineMomentText(
  m: TimelineMoment,
  s: (typeof strings.pro.kuhinja)["backwards-timeline"],
): string {
  if (m.date !== undefined) return `${m.clock} (${m.date})`;
  if (m.dayOffset === 0) return m.clock;
  const n = Math.abs(m.dayOffset);
  const word = n === 1 ? s.dayWordOne : s.dayWordMany;
  return `${m.clock} (${proNum(m.dayOffset, 0)} ${word})`;
}

/**
 * Every preparation step placed backwards from the moment of service, in wall
 * time — no time zone, no daylight-saving adjustment, which the note beneath
 * the table states rather than hides.
 */
export function BackwardsTimelineTool() {
  const s = strings.pro.kuhinja["backwards-timeline"];
  const [serviceTime, setServiceTime] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [bufferText, setBufferText] = useState("");

  const rows = proRows(stepsText);
  const typed = serviceTime.trim() !== "" || rows.length > 0;
  const steps: TimelineStep[] = rows.map((cells) => ({
    name: cells[0] ?? "",
    duration: cells[1] ?? "",
  }));

  const input: BackwardsTimelineInput = {
    serviceTime: serviceTime.trim(),
    serviceDate: serviceDate.trim() === "" ? undefined : serviceDate.trim(),
    steps,
    buffer: proParse(bufferText),
  };
  const result = backwardsTimeline(input);

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "serviceTime"
        ? s.errorServiceTime
        : field === "serviceDate"
          ? s.errorServiceDate
          : field === "steps"
            ? s.errorSteps
            : field === "buffer"
              ? s.errorBuffer
              : s.errorStepDuration;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.kind === "buffer" ? s.bufferRowName : row.name}: ${timelineMomentText(row.start, s)} – ${timelineMomentText(row.end, s)}`,
        ),
        "",
        `${s.totalLabel}: ${result.totalLabel}`,
        `${s.jobStart}: ${timelineMomentText(result.start, s)}`,
        "",
        `${s.serviceTime}: ${serviceTime.trim()}`,
        serviceDate.trim() === "" ? undefined : `${s.serviceDate}: ${serviceDate.trim()}`,
        bufferText.trim() === "" ? undefined : `${s.buffer}: ${bufferText.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.serviceTime} hint={s.serviceTimeHint} value={serviceTime} onChange={setServiceTime} />
      <ToolInput label={s.serviceDate} hint={s.serviceDateHint} value={serviceDate} onChange={setServiceDate} />
      <ToolTextArea label={s.steps} hint={s.stepsHint} value={stepsText} onChange={setStepsText} />
      <ToolInput label={s.buffer} hint={s.bufferHint} value={bufferText} onChange={setBufferText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colStep, s.colStart, s.colEnd, s.colMinutes]}
            rows={result.rows.map((row) => [
              row.kind === "buffer" ? s.bufferRowName : row.name,
              timelineMomentText(row.start, s),
              timelineMomentText(row.end, s),
              proNum(row.minutes, 0),
            ])}
            prose={[0]}
          />
          <ResultRow label={s.totalLabel} value={result.totalLabel} />
          <ResultRow label={s.jobStart} value={timelineMomentText(result.start, s)} />
          <p className="tool__note">{s.wallClockNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.serviceTime, value: serviceTime.trim() },
              ...(serviceDate.trim() === ""
                ? []
                : [{ label: s.serviceDate, value: serviceDate.trim() }]),
              { label: s.steps, value: `${rows.length}` },
              ...(bufferText.trim() === ""
                ? []
                : [{ label: s.buffer, value: bufferText.trim() }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* bakers-percentage                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The role a typed word means — read from the SAME strings the labels are drawn
 * from, and folded before comparison.
 *
 * Both halves of that were defects. This used to be a module-level map holding
 * a second copy of „brašno" / „voda" / „ostalo" / „predferment", while the hint
 * telling the user which words to type read them out of `strings`. One
 * vocabulary with two authors: change the hint and the tool silently stops
 * recognising the word it now asks for, and „silently" is exact — an
 * unrecognised role falls through to „other", which changes the percentage base
 * every other number on the screen is computed against. Nothing on the screen
 * says so.
 *
 * And the map was keyed on the diacritic spelling alone, so a user typing
 * „brasno" — which is most of them, and which the app's own search has always
 * accepted — had their flour classified as „other". `foldSearchText` is the
 * answer this app already gives to „compare two pieces of Serbian loosely", so
 * it is the answer here too rather than a second one.
 */
export function bakersRoleFromWord(
  word: string,
  s: (typeof strings.pro.kuhinja)["bakers-percentage"],
): BakersRole {
  // Trimmed here and not left to the caller. `proRows` happens to trim its
  // cells today, so relying on that would make this function correct by
  // coincidence — and the coincidence is in a different file.
  const folded = foldSearchText(word.trim());
  return folded === foldSearchText(s.roleFlour)
    ? "flour"
    : folded === foldSearchText(s.roleWater)
      ? "water"
      : folded === foldSearchText(s.rolePreferment)
        ? "preferment"
        : "other";
}

function bakersRoleLabel(
  role: BakersRole,
  s: (typeof strings.pro.kuhinja)["bakers-percentage"],
): string {
  return role === "flour"
    ? s.roleFlour
    : role === "water"
      ? s.roleWater
      : role === "preferment"
        ? s.rolePreferment
        : s.roleOther;
}

/**
 * A formula in baker's percentages, either direction — plus a pieces-based
 * target that folds bake loss into the target dough mass before the same
 * arithmetic runs.
 */
export function BakersPercentageTool() {
  const s = strings.pro.kuhinja["bakers-percentage"];
  const [mode, setMode] = useState<BakersMode>("weightsToPercent");
  const [linesText, setLinesText] = useState("");
  const [targetMode, setTargetMode] = useState<"mass" | "pieces">("mass");
  const [doughMassText, setDoughMassText] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [bakedPieceMassText, setBakedPieceMassText] = useState("");
  const [bakeLossText, setBakeLossText] = useState("");

  const rows = proRows(linesText);
  const typed = rows.length > 0;
  const lines: BakersLine[] = rows.map((cells) => {
    return {
      name: cells[0] ?? "",
      role: bakersRoleFromWord(cells[1] ?? "", s),
      value: proParse(cells[2] ?? "") ?? Number.NaN,
    };
  });

  const result = bakersPercentage({
    mode,
    lines,
    doughMass: mode === "percentToWeights" && targetMode === "mass" ? proParse(doughMassText) : undefined,
    pieces: mode === "percentToWeights" && targetMode === "pieces" ? proParse(piecesText) : undefined,
    bakedPieceMass:
      mode === "percentToWeights" && targetMode === "pieces" ? proParse(bakedPieceMassText) : undefined,
    bakeLoss: mode === "percentToWeights" && targetMode === "pieces" ? proParse(bakeLossText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "lines"
        ? s.errorLines
        : field === "lineValue"
          ? s.errorLineValue
          : field === "preferment"
            ? s.errorPreferment
            : field === "flour"
              ? s.errorFlour
              : field === "doughMass"
                ? s.errorDoughMass
                : field === "pieces"
                  ? s.errorPieces
                  : field === "bakedPieceMass"
                    ? s.errorBakedPieceMass
                    : field === "bakeLoss"
                      ? s.errorBakeLoss
                      : s.errorFlourPercentSum;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.name} (${bakersRoleLabel(row.role, s)}): ${proNum(row.percent, 1)}%  ${proUnit(proNum(row.weightRounded, 2), s.unitG)}`,
        ),
        "",
        `${s.totalPercent}: ${proNum(result.totalPercent, 1)}%`,
        `${s.flourWeight}: ${proUnit(proNum(result.flourWeight, 2), s.unitG)}`,
        `${s.doughMass}: ${proUnit(proNum(result.doughMass, 2), s.unitG)}`,
        `${s.hydration}: ${proNum(result.hydration, 1)}%`,
        result.rawPieceMass === undefined
          ? undefined
          : `${s.rawPieceMass}: ${proUnit(proNum(result.rawPieceMass, 2), s.unitG)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<BakersMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "weightsToPercent", label: s.modeWeightsToPercent },
          { id: "percentToWeights", label: s.modePercentToWeights },
        ]}
      />
      <ToolTextArea label={s.lines} hint={s.linesHint} value={linesText} onChange={setLinesText} />
      {mode === "percentToWeights" && (
        <>
          <ToolSelect<"mass" | "pieces">
            label={s.targetMode}
            value={targetMode}
            onChange={setTargetMode}
            options={[
              { id: "mass", label: s.targetModeMass },
              { id: "pieces", label: s.targetModePieces },
            ]}
          />
          {targetMode === "mass" ? (
            <ToolInput label={s.doughMass} value={doughMassText} onChange={setDoughMassText} />
          ) : (
            <>
              <ToolInput label={s.pieces} value={piecesText} onChange={setPiecesText} />
              <ToolInput label={s.bakedPieceMass} value={bakedPieceMassText} onChange={setBakedPieceMassText} />
              <ToolInput label={s.bakeLoss} hint={s.bakeLossHint} value={bakeLossText} onChange={setBakeLossText} />
            </>
          )}
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colRole, s.colPercent, s.colWeight]}
            rows={result.rows.map((row) => [
              row.name,
              bakersRoleLabel(row.role, s),
              `${proNum(row.percent, 1)}%`,
              proUnit(proNum(row.weightRounded, 2), s.unitG),
            ])}
            prose={[0]}
          />
          <ResultRow label={s.totalPercent} value={`${proNum(result.totalPercent, 1)}%`} />
          <ResultRow label={s.flourWeight} value={proUnit(proNum(result.flourWeight, 2), s.unitG)} />
          <ResultRow label={s.doughMass} value={proUnit(proNum(result.doughMass, 2), s.unitG)} />
          <ResultRow label={s.hydration} value={`${proNum(result.hydration, 1)}%`} />
          <p className="tool__note">{s.hydrationNote}</p>
          {result.rawPieceMass !== undefined && (
            <ResultRow label={s.rawPieceMass} value={proUnit(proNum(result.rawPieceMass, 2), s.unitG)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: mode === "weightsToPercent" ? s.modeWeightsToPercent : s.modePercentToWeights },
              { label: s.lines, value: `${rows.length}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* brine-salt — FOOD SAFETY: quantities only, never a verdict                   */
/* -------------------------------------------------------------------------- */

/**
 * Salt (and optionally sugar) for a brine, a dry cure, or the concentration of
 * an existing brine. **Food safety: this prints masses and percentages and
 * nothing about whether either is enough, appropriate or safe for any purpose.**
 */
export function BrineSaltTool() {
  const s = strings.pro.kuhinja["brine-salt"];
  const [mode, setMode] = useState<BrineMode>("brine");
  const [basis, setBasis] = useState<BrineBasis>("foodAndWater");
  const [foodMassText, setFoodMassText] = useState("");
  const [waterMassText, setWaterMassText] = useState("");
  const [saltPercentText, setSaltPercentText] = useState("");
  const [dissolvedSaltText, setDissolvedSaltText] = useState("");
  const [sugarPercentText, setSugarPercentText] = useState("");
  const [percentLimitText, setPercentLimitText] = useState("");

  const typed =
    proParse(foodMassText) !== undefined ||
    proParse(waterMassText) !== undefined ||
    proParse(dissolvedSaltText) !== undefined;

  const result = brineSalt({
    mode,
    foodMass: mode === "concentration" ? undefined : proParse(foodMassText),
    waterMass: mode === "dryCure" ? undefined : proParse(waterMassText),
    saltPercent: mode === "concentration" ? undefined : proParse(saltPercentText),
    basis,
    dissolvedSalt: mode === "concentration" ? proParse(dissolvedSaltText) : undefined,
    sugarPercent: mode === "concentration" ? undefined : proParse(sugarPercentText),
    percentLimit: proParse(percentLimitText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "waterMass"
        ? s.errorWaterMass
        : field === "dissolvedSalt"
          ? s.errorDissolvedSalt
          : field === "foodMass"
            ? s.errorFoodMass
            : field === "saltPercent"
              ? s.errorSaltPercent
              : s.errorSugarPercent;

  const displayedPercent = result.ok
    ? basis === "totalWithSalt"
      ? result.percentOfTotal
      : result.percentOfBase
    : 0;

  const copyText = !result.ok
    ? ""
    : [
        `${s.saltMass}: ${proUnit(proNum(result.saltMass, 2), s.unitG)}`,
        result.sugarMass === undefined
          ? undefined
          : `${s.sugarMass}: ${proUnit(proNum(result.sugarMass, 2), s.unitG)}`,
        `${s.totalMass}: ${proUnit(proNum(result.totalMass, 2), s.unitG)}`,
        `${s.percentOfBase}: ${proNum(result.percentOfBase, 3)}%`,
        `${s.percentOfTotal}: ${proNum(result.percentOfTotal, 3)}%`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<BrineMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "brine", label: s.modeBrine },
          { id: "dryCure", label: s.modeDryCure },
          { id: "concentration", label: s.modeConcentration },
        ]}
      />
      <ToolSelect<BrineBasis>
        label={s.basis}
        value={basis}
        onChange={setBasis}
        options={[
          { id: "foodAndWater", label: s.basisFoodAndWater },
          { id: "totalWithSalt", label: s.basisTotalWithSalt },
        ]}
      />
      {mode !== "concentration" && (
        <ToolInput label={s.foodMass} value={foodMassText} onChange={setFoodMassText} />
      )}
      {mode !== "dryCure" && (
        <ToolInput
          label={s.waterMass}
          hint={mode === "concentration" ? undefined : s.waterMassHint}
          value={waterMassText}
          onChange={setWaterMassText}
        />
      )}
      {mode === "concentration" ? (
        <ToolInput label={s.dissolvedSalt} value={dissolvedSaltText} onChange={setDissolvedSaltText} />
      ) : (
        <>
          <ToolInput label={s.saltPercent} value={saltPercentText} onChange={setSaltPercentText} />
          <ToolInput label={s.sugarPercent} hint={s.sugarPercentHint} value={sugarPercentText} onChange={setSugarPercentText} />
        </>
      )}
      <ToolInput label={s.percentLimit} hint={s.percentLimitHint} value={percentLimitText} onChange={setPercentLimitText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.saltMass} value={proUnit(proNum(result.saltMass, 2), s.unitG)} />
          {result.sugarMass !== undefined && (
            <ResultRow label={s.sugarMass} value={proUnit(proNum(result.sugarMass, 2), s.unitG)} />
          )}
          <ResultRow label={s.totalMass} value={proUnit(proNum(result.totalMass, 2), s.unitG)} />
          <ResultRow label={s.percentOfBase} value={`${proNum(result.percentOfBase, 3)}%`} />
          <ResultRow label={s.percentOfTotal} value={`${proNum(result.percentOfTotal, 3)}%`} />
          <ToolAgainstLimit
            label={s.selectedPercent}
            value={`${proNum(displayedPercent, 3)}%`}
            limitLabel={s.percentLimit}
            limit={proParse(percentLimitText) === undefined ? undefined : `${proNum(proParse(percentLimitText) ?? 0, 3)}%`}
            ratioLabel={s.percentRatio}
            ratio={proRatio(result.percentRatio)}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: mode === "brine" ? s.modeBrine : mode === "dryCure" ? s.modeDryCure : s.modeConcentration },
              { label: s.basis, value: basis === "foodAndWater" ? s.basisFoodAndWater : s.basisTotalWithSalt },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* coffee-extraction                                                           */
/* -------------------------------------------------------------------------- */

/** Two ratios exist and this prints both, each labelled — never one derived from the other. */
export function CoffeeExtractionTool() {
  const s = strings.pro.kuhinja["coffee-extraction"];
  const [doseText, setDoseText] = useState("");
  const [brewWaterText, setBrewWaterText] = useState("");
  const [beverageMassText, setBeverageMassText] = useState("");
  const [tdsText, setTdsText] = useState("");
  const [targetRatioText, setTargetRatioText] = useState("");

  const typed =
    proParse(doseText) !== undefined ||
    proParse(beverageMassText) !== undefined ||
    proParse(tdsText) !== undefined;

  const result = coffeeExtraction({
    dose: proParse(doseText) ?? Number.NaN,
    beverageMass: proParse(beverageMassText) ?? Number.NaN,
    tds: proParse(tdsText) ?? Number.NaN,
    brewWater: proParse(brewWaterText),
    targetRatio: proParse(targetRatioText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "dose"
        ? s.errorDose
        : field === "beverageMass"
          ? s.errorBeverageMass
          : field === "tds"
            ? s.errorTds
            : field === "brewWater"
              ? s.errorBrewWater
              : s.errorTargetRatio;

  const copyText = !result.ok
    ? ""
    : [
        result.waterRatio === undefined ? undefined : `${s.waterRatio}: 1:${proNum(result.waterRatio, 1)}`,
        `${s.beverageRatio}: 1:${proNum(result.beverageRatio, 1)}`,
        `${s.extractionYield}: ${proNum(result.extractionYield, 2)}%`,
        `${s.dissolved}: ${proUnit(proNum(result.dissolved, 2), s.unitG)}`,
        result.retained === undefined ? undefined : `${s.retained}: ${proUnit(proNum(result.retained, 1), s.unitG)}`,
        result.weighingShortfall === undefined
          ? undefined
          : `${s.weighingShortfall}: ${proUnit(proNum(result.weighingShortfall, 1), s.unitG)}`,
        result.waterForTarget === undefined
          ? undefined
          : `${s.waterForTarget}: ${proUnit(proNum(result.waterForTarget, 1), s.unitG)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.dose} value={doseText} onChange={setDoseText} />
      <ToolInput label={s.brewWater} hint={s.brewWaterHint} value={brewWaterText} onChange={setBrewWaterText} />
      <ToolInput label={s.beverageMass} value={beverageMassText} onChange={setBeverageMassText} />
      <ToolInput label={s.tds} hint={s.tdsHint} value={tdsText} onChange={setTdsText} />
      <ToolInput label={s.targetRatio} value={targetRatioText} onChange={setTargetRatioText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          {result.waterRatio !== undefined && (
            <ResultRow label={s.waterRatio} value={`1:${proNum(result.waterRatio, 1)}`} />
          )}
          <ResultRow label={s.beverageRatio} value={`1:${proNum(result.beverageRatio, 1)}`} />
          <ResultRow label={s.extractionYield} value={`${proNum(result.extractionYield, 2)}%`} />
          <ResultRow label={s.dissolved} value={proUnit(proNum(result.dissolved, 2), s.unitG)} />
          {result.retained !== undefined && (
            <ResultRow label={s.retained} value={proUnit(proNum(result.retained, 1), s.unitG)} />
          )}
          {result.weighingShortfall !== undefined && (
            <>
              <ResultRow label={s.weighingShortfall} value={proUnit(proNum(result.weighingShortfall, 1), s.unitG)} />
              <p className="tool__note">{s.weighingShortfallNote}</p>
            </>
          )}
          {result.waterForTarget !== undefined && (
            <ResultRow label={s.waterForTarget} value={proUnit(proNum(result.waterForTarget, 1), s.unitG)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.dose, value: proUnit(proNum(proParse(doseText) ?? 0, 2), s.unitG) },
              { label: s.beverageMass, value: proUnit(proNum(proParse(beverageMassText) ?? 0, 2), s.unitG) },
              { label: s.tds, value: `${proNum(proParse(tdsText) ?? 0, 2)}%` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* dough-water-temp                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The water temperature that lands the dough on its desired temperature — and
 * the same equation run backwards to measure a mixer's friction factor.
 */
export function DoughWaterTempTool() {
  const s = strings.pro.kuhinja["dough-water-temp"];
  const [mode, setMode] = useState<DoughTempMode>("waterTemperature");
  const [flourTempText, setFlourTempText] = useState("");
  const [roomTempText, setRoomTempText] = useState("");
  const [hasPreferment, setHasPreferment] = useState<"no" | "yes">("no");
  const [prefermentTempText, setPrefermentTempText] = useState("");
  const [desiredDoughTempText, setDesiredDoughTempText] = useState("");
  const [frictionFactorText, setFrictionFactorText] = useState("");
  const [frictionN, setFrictionN] = useState<"3" | "4">("3");
  const [availableWaterTempText, setAvailableWaterTempText] = useState("");
  const [measuredDoughTempText, setMeasuredDoughTempText] = useState("");
  const [measuredWaterTempText, setMeasuredWaterTempText] = useState("");

  const typed = proParse(flourTempText) !== undefined || proParse(roomTempText) !== undefined;
  const prefermentTemp = hasPreferment === "yes" ? proParse(prefermentTempText) : undefined;

  const result = doughWaterTemperature({
    mode,
    flourTemp: proParse(flourTempText) ?? Number.NaN,
    roomTemp: proParse(roomTempText) ?? Number.NaN,
    prefermentTemp,
    desiredDoughTemp: mode === "waterTemperature" ? proParse(desiredDoughTempText) : undefined,
    frictionFactor: mode === "waterTemperature" ? proParse(frictionFactorText) : undefined,
    frictionFactorMeasuredAtN: mode === "waterTemperature" ? Number(frictionN) : undefined,
    measuredDoughTemp: mode === "frictionFactor" ? proParse(measuredDoughTempText) : undefined,
    measuredWaterTemp: mode === "frictionFactor" ? proParse(measuredWaterTempText) : undefined,
    availableWaterTemp: mode === "waterTemperature" ? proParse(availableWaterTempText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "flourTemp"
        ? s.errorFlourTemp
        : field === "roomTemp"
          ? s.errorRoomTemp
          : field === "prefermentTemp"
            ? s.errorPrefermentTemp
            : field === "desiredDoughTemp"
              ? s.errorDesiredDoughTemp
              : field === "frictionFactor"
                ? s.errorFrictionFactor
                : field === "frictionFactorMeasuredAtN"
                  ? s.errorFrictionFactorMeasuredAtN
                  : field === "availableWaterTemp"
                    ? s.errorAvailableWaterTemp
                    : field === "measuredDoughTemp"
                      ? s.errorMeasuredDoughTemp
                      : s.errorMeasuredWaterTemp;

  const copyText = !result.ok
    ? ""
    : [
        `${s.multiplier}: N=${result.multiplier}`,
        `${s.components}: ${result.components.map((c) => proNum(c, 1)).join(" + ")}`,
        result.waterTemp === undefined
          ? undefined
          : `${s.waterTemp}: ${proUnit(proNum(result.waterTemp, 1), s.unitC)}`,
        result.frictionFactor === undefined
          ? undefined
          : `${s.frictionFactor}: ${proUnit(proNum(result.frictionFactor, 1), s.unitC)}`,
        result.availableDelta === undefined
          ? undefined
          : `${s.availableDelta}: ${proUnit(proNum(result.availableDelta, 1), s.unitC)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<DoughTempMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "waterTemperature", label: s.modeWaterTemperature },
          { id: "frictionFactor", label: s.modeFrictionFactor },
        ]}
      />
      <ToolInput label={s.flourTemp} value={flourTempText} onChange={setFlourTempText} />
      <ToolInput label={s.roomTemp} value={roomTempText} onChange={setRoomTempText} />
      <ToolSelect<"no" | "yes">
        label={s.hasPreferment}
        value={hasPreferment}
        onChange={setHasPreferment}
        options={[
          { id: "no", label: s.hasPrefermentNo },
          { id: "yes", label: s.hasPrefermentYes },
        ]}
      />
      {hasPreferment === "yes" && (
        <ToolInput label={s.prefermentTemp} value={prefermentTempText} onChange={setPrefermentTempText} />
      )}
      {mode === "waterTemperature" ? (
        <>
          <ToolInput label={s.desiredDoughTemp} value={desiredDoughTempText} onChange={setDesiredDoughTempText} />
          <ToolInput label={s.frictionFactor} hint={s.frictionFactorHint} value={frictionFactorText} onChange={setFrictionFactorText} />
          <ToolSelect<"3" | "4">
            label={s.frictionN}
            hint={s.frictionNHint}
            value={frictionN}
            onChange={setFrictionN}
            options={[
              { id: "3", label: s.frictionN3 },
              { id: "4", label: s.frictionN4 },
            ]}
          />
          <ToolInput label={s.availableWaterTemp} value={availableWaterTempText} onChange={setAvailableWaterTempText} />
        </>
      ) : (
        <>
          <ToolInput label={s.measuredDoughTemp} value={measuredDoughTempText} onChange={setMeasuredDoughTempText} />
          <ToolInput label={s.measuredWaterTemp} value={measuredWaterTempText} onChange={setMeasuredWaterTempText} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.multiplier} value={`N=${result.multiplier}`} />
          <ResultRow label={s.components} value={result.components.map((c) => proNum(c, 1)).join(" + ")} />
          {result.waterTemp !== undefined && (
            <>
              <ResultRow label={s.waterTemp} value={proUnit(proNum(result.waterTemp, 1), s.unitC)} />
              {result.belowFreezingPoint && <p className="tool__note">{s.belowFreezingNote}</p>}
            </>
          )}
          {result.frictionFactor !== undefined && mode === "frictionFactor" && (
            <ResultRow label={s.frictionFactor} value={proUnit(proNum(result.frictionFactor, 1), s.unitC)} />
          )}
          {result.availableDelta !== undefined && (
            <ToolAgainstLimit
              label={s.waterTemp}
              value={result.waterTemp === undefined ? "—" : proUnit(proNum(result.waterTemp, 1), s.unitC)}
              limitLabel={s.availableWaterTemp}
              limit={proUnit(proNum(proParse(availableWaterTempText) ?? 0, 1), s.unitC)}
              ratioLabel={s.availableDelta}
              ratio={proUnit(proNum(result.availableDelta, 1), s.unitC)}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.flourTemp, value: proUnit(proNum(proParse(flourTempText) ?? 0, 1), s.unitC) },
              { label: s.roomTemp, value: proUnit(proNum(proParse(roomTempText) ?? 0, 1), s.unitC) },
              ...(prefermentTemp === undefined
                ? []
                : [{ label: s.prefermentTemp, value: proUnit(proNum(prefermentTemp, 1), s.unitC) }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* ice-cream-overrun                                                           */
/* -------------------------------------------------------------------------- */

/** Overrun from two weighings of the same container — or a target overrun's implied volume and weights. */
export function IceCreamOverrunTool() {
  const s = strings.pro.kuhinja["ice-cream-overrun"];
  const [mode, setMode] = useState<OverrunMode>("fromWeighings");
  const [grossMixText, setGrossMixText] = useState("");
  const [grossFrozenText, setGrossFrozenText] = useState("");
  const [tareText, setTareText] = useState("");
  const [targetOverrunText, setTargetOverrunText] = useState("");
  const [mixVolumeText, setMixVolumeText] = useState("");
  const [mixDensityText, setMixDensityText] = useState("");
  const [tubVolumeText, setTubVolumeText] = useState("");

  const typed =
    mode === "fromWeighings"
      ? proParse(grossMixText) !== undefined || proParse(grossFrozenText) !== undefined
      : proParse(targetOverrunText) !== undefined;

  const result = iceCreamOverrun({
    mode,
    grossMixMass: mode === "fromWeighings" ? proParse(grossMixText) : undefined,
    grossFrozenMass: mode === "fromWeighings" ? proParse(grossFrozenText) : undefined,
    tare: mode === "fromWeighings" ? proParse(tareText) : undefined,
    targetOverrun: mode === "fromTarget" ? proParse(targetOverrunText) : undefined,
    mixVolume: proParse(mixVolumeText),
    mixDensity: proParse(mixDensityText),
    tubVolume: proParse(tubVolumeText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "grossMixMass"
        ? s.errorGrossMixMass
        : field === "grossFrozenMass"
          ? s.errorGrossFrozenMass
          : field === "tare"
            ? s.errorTare
            : field === "targetOverrun"
              ? s.errorTargetOverrun
              : field === "mixVolume"
                ? s.errorMixVolume
                : field === "mixDensity"
                  ? s.errorMixDensity
                  : s.errorTubVolume;

  const copyText = !result.ok
    ? ""
    : [
        `${s.overrun}: ${proNum(result.overrun, 1)}%`,
        result.netMixMass === undefined ? undefined : `${s.netMixMass}: ${proUnit(proNum(result.netMixMass, 2), s.unitG)}`,
        result.netFrozenMass === undefined
          ? undefined
          : `${s.netFrozenMass}: ${proUnit(proNum(result.netFrozenMass, 2), s.unitG)}`,
        result.frozenVolume === undefined
          ? undefined
          : `${s.frozenVolume}: ${proUnit(proNum(result.frozenVolume, 3), s.unitL)}`,
        result.finishedMassPerLitre === undefined
          ? undefined
          : `${s.finishedMassPerLitre}: ${proUnit(proNum(result.finishedMassPerLitre, 1), s.unitGPerL)}`,
        result.tubNetWeight === undefined
          ? undefined
          : `${s.tubNetWeight}: ${proUnit(proNum(result.tubNetWeight, 1), s.unitG)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<OverrunMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "fromWeighings", label: s.modeFromWeighings },
          { id: "fromTarget", label: s.modeFromTarget },
        ]}
      />
      {mode === "fromWeighings" ? (
        <>
          <ToolInput label={s.grossMixMass} value={grossMixText} onChange={setGrossMixText} />
          <ToolInput label={s.grossFrozenMass} value={grossFrozenText} onChange={setGrossFrozenText} />
          <ToolInput label={s.tare} hint={s.tareHint} value={tareText} onChange={setTareText} />
        </>
      ) : (
        <ToolInput label={s.targetOverrun} value={targetOverrunText} onChange={setTargetOverrunText} />
      )}
      <ToolInput label={s.mixVolume} value={mixVolumeText} onChange={setMixVolumeText} />
      <ToolInput label={s.mixDensity} value={mixDensityText} onChange={setMixDensityText} />
      <ToolInput label={s.tubVolume} value={tubVolumeText} onChange={setTubVolumeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.overrun} value={`${proNum(result.overrun, 1)}%`} />
          {result.netMixMass !== undefined && (
            <ResultRow label={s.netMixMass} value={proUnit(proNum(result.netMixMass, 2), s.unitG)} />
          )}
          {result.netFrozenMass !== undefined && (
            <ResultRow label={s.netFrozenMass} value={proUnit(proNum(result.netFrozenMass, 2), s.unitG)} />
          )}
          {result.frozenVolume !== undefined && (
            <ResultRow label={s.frozenVolume} value={proUnit(proNum(result.frozenVolume, 3), s.unitL)} />
          )}
          {result.finishedMassPerLitre !== undefined && (
            <ResultRow label={s.finishedMassPerLitre} value={proUnit(proNum(result.finishedMassPerLitre, 1), s.unitGPerL)} />
          )}
          {result.tubNetWeight !== undefined && (
            <ResultRow label={s.tubNetWeight} value={proUnit(proNum(result.tubNetWeight, 1), s.unitG)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.mode, value: mode === "fromWeighings" ? s.modeFromWeighings : s.modeFromTarget }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* lamination-layers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The fold word the user typed, or `undefined` when it is not one of the three.
 *
 * Same shape as {@link bakersRoleFromWord} and for the same reason: the words
 * this accepts and the words `foldLabel` prints are now one vocabulary with one
 * author, and the comparison is folded so that case and diacritics do not
 * decide whether a fold is recognised.
 */
export function foldFromWord(
  word: string,
  s: (typeof strings.pro.kuhinja)["lamination-layers"],
): FoldKind | undefined {
  const folded = foldSearchText(word.trim());
  return folded === foldSearchText(s.foldLetter)
    ? "letter"
    : folded === foldSearchText(s.foldBook)
      ? "book"
      : folded === foldSearchText(s.foldHalf)
        ? "half"
        : undefined;
}

function foldLabel(fold: FoldKind, s: (typeof strings.pro.kuhinja)["lamination-layers"]): string {
  return fold === "letter" ? s.foldLetter : fold === "book" ? s.foldBook : s.foldHalf;
}

/**
 * Layer counts and layer thicknesses for a laminated dough, plus the
 * fold-by-fold thickness and length as the strip is worked.
 */
export function LaminationLayersTool() {
  const s = strings.pro.kuhinja["lamination-layers"];
  const [foldsText, setFoldsText] = useState("");
  const [startingFatLayersText, setStartingFatLayersText] = useState("");
  const [fatMassText, setFatMassText] = useState("");
  const [doughMassText, setDoughMassText] = useState("");
  const [finalThicknessText, setFinalThicknessText] = useState("");
  const [startThicknessText, setStartThicknessText] = useState("");
  const [startLengthText, setStartLengthText] = useState("");

  const rows = proRows(foldsText);
  const typed = rows.length > 0;
  // Any row whose fold word is not recognised forces an empty `folds` array,
  // which the core function itself refuses — the surface never guesses a fold.
  const parsedFolds = rows.map((cells) => foldFromWord(cells[0] ?? "", s));
  const allRecognised = parsedFolds.every((fold) => fold !== undefined);
  const folds: FoldKind[] = allRecognised ? parsedFolds.filter((fold) => fold !== undefined) : [];
  const rollThicknesses = allRecognised
    ? rows.map((cells) => (cells[1] === undefined || cells[1].trim() === "" ? undefined : proParse(cells[1])))
    : undefined;

  const result = laminationLayers({
    folds,
    startingFatLayers: proParse(startingFatLayersText),
    fatMass: proParse(fatMassText) ?? Number.NaN,
    doughMass: proParse(doughMassText) ?? Number.NaN,
    finalThickness: proParse(finalThicknessText) ?? Number.NaN,
    startThickness: proParse(startThicknessText),
    startLength: proParse(startLengthText),
    rollThicknesses,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : !allRecognised
        ? s.errorFolds
        : field === "folds"
          ? s.errorFolds
          : field === "startingFatLayers"
            ? s.errorStartingFatLayers
            : field === "finalThickness"
              ? s.errorFinalThickness
              : field === "fatMass"
                ? s.errorFatMass
                : field === "doughMass"
                  ? s.errorDoughMass
                  : field === "startThickness"
                    ? s.errorStartThickness
                    : field === "startLength"
                      ? s.errorStartLength
                      : s.errorRollThickness;

  const copyText = !result.ok
    ? ""
    : [
        `${s.fatLayers}: ${proNum(result.fatLayers, 0)}`,
        `${s.doughLayers}: ${proNum(result.doughLayers, 0)}`,
        `${s.fatLayerMicrons}: ${proUnit(proNum(result.fatLayerMicrons, 1), s.unitUm)}`,
        `${s.doughLayerMicrons}: ${proUnit(proNum(result.doughLayerMicrons, 1), s.unitUm)}`,
        ...result.passes.map(
          (pass, index) =>
            `${index + 1}. ${foldLabel(pass.fold, s)}: ${proUnit(proNum(pass.rolledThickness, 2), s.unitMm)} / ${proUnit(proNum(pass.rolledLength, 1), s.unitCm)}`,
        ),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.folds} hint={s.foldsHint} value={foldsText} onChange={setFoldsText} />
      <ToolInput label={s.startingFatLayers} hint={s.startingFatLayersHint} value={startingFatLayersText} onChange={setStartingFatLayersText} />
      <ToolInput label={s.fatMass} value={fatMassText} onChange={setFatMassText} />
      <ToolInput label={s.doughMass} value={doughMassText} onChange={setDoughMassText} />
      <ToolInput label={s.finalThickness} value={finalThicknessText} onChange={setFinalThicknessText} />
      <ToolInput label={s.startThickness} value={startThicknessText} onChange={setStartThicknessText} />
      <ToolInput label={s.startLength} value={startLengthText} onChange={setStartLengthText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.fatLayers} value={proNum(result.fatLayers, 0)} />
          <ResultRow label={s.doughLayers} value={proNum(result.doughLayers, 0)} />
          <ResultRow label={s.fatLayerMicrons} value={proUnit(proNum(result.fatLayerMicrons, 1), s.unitUm)} />
          <ResultRow label={s.doughLayerMicrons} value={proUnit(proNum(result.doughLayerMicrons, 1), s.unitUm)} />
          {result.passes.length > 0 && (
            <ToolTable
              head={[s.colFold, s.colFoldedThickness, s.colFoldedLength, s.colRolledThickness, s.colRolledLength]}
              rows={result.passes.map((pass) => [
                foldLabel(pass.fold, s),
                proUnit(proNum(pass.foldedThickness, 2), s.unitMm),
                proUnit(proNum(pass.foldedLength, 1), s.unitCm),
                proUnit(proNum(pass.rolledThickness, 2), s.unitMm),
                proUnit(proNum(pass.rolledLength, 1), s.unitCm),
              ])}
            />
          )}
          <p className="tool__note">{s.constantWidthNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.folds, value: `${folds.length}` },
              { label: s.fatMass, value: proUnit(proNum(proParse(fatMassText) ?? 0, 2), s.unitG) },
              { label: s.doughMass, value: proUnit(proNum(proParse(doughMassText) ?? 0, 2), s.unitG) },
              { label: s.finalThickness, value: proUnit(proNum(proParse(finalThicknessText) ?? 0, 2), s.unitMm) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* levain-hydration                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How much flour and water still have to go in, once the levain's own flour
 * and water are counted — or how to build a levain from a seed to a target.
 */
export function LevainHydrationTool() {
  const s = strings.pro.kuhinja["levain-hydration"];
  const [mode, setMode] = useState<LevainMode>("correctDough");
  const [totalFlourText, setTotalFlourText] = useState("");
  const [targetHydrationText, setTargetHydrationText] = useState("");
  const [levainMassText, setLevainMassText] = useState("");
  const [levainHydrationText, setLevainHydrationText] = useState("");
  const [seedMassText, setSeedMassText] = useState("");
  const [seedHydrationText, setSeedHydrationText] = useState("");
  const [targetLevainMassText, setTargetLevainMassText] = useState("");
  const [targetLevainHydrationText, setTargetLevainHydrationText] = useState("");

  const typed =
    mode === "correctDough"
      ? proParse(totalFlourText) !== undefined || proParse(levainMassText) !== undefined
      : proParse(seedMassText) !== undefined || proParse(targetLevainMassText) !== undefined;

  const result = levainHydration({
    mode,
    totalFlour: mode === "correctDough" ? proParse(totalFlourText) : undefined,
    targetHydration: mode === "correctDough" ? proParse(targetHydrationText) : undefined,
    levainMass: mode === "correctDough" ? proParse(levainMassText) : undefined,
    levainHydration: mode === "correctDough" ? proParse(levainHydrationText) : undefined,
    seedMass: mode === "buildLevain" ? proParse(seedMassText) : undefined,
    seedHydration: mode === "buildLevain" ? proParse(seedHydrationText) : undefined,
    targetLevainMass: mode === "buildLevain" ? proParse(targetLevainMassText) : undefined,
    targetLevainHydration: mode === "buildLevain" ? proParse(targetLevainHydrationText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "totalFlour"
        ? s.errorTotalFlour
        : field === "targetHydration"
          ? s.errorTargetHydration
          : field === "levainMass"
            ? s.errorLevainMass
            : field === "levainHydration"
              ? s.errorLevainHydration
              : field === "seedMass"
                ? s.errorSeedMass
                : field === "seedHydration"
                  ? s.errorSeedHydration
                  : field === "targetLevainMass"
                    ? s.errorTargetLevainMass
                    : field === "targetLevainHydration"
                      ? s.errorTargetLevainHydration
                      : field === "flourOver"
                        ? s.errorFlourOver
                        : s.errorWaterOver;

  const copyText = !result.ok
    ? ""
    : [
        `${s.levainFlour}: ${proUnit(proNum(result.levainFlour, 2), s.unitG)}`,
        `${s.levainWater}: ${proUnit(proNum(result.levainWater, 2), s.unitG)}`,
        `${s.addedFlour}: ${proUnit(proNum(result.addedFlour, 2), s.unitG)}`,
        `${s.addedWater}: ${proUnit(proNum(result.addedWater, 2), s.unitG)}`,
        result.doughMass === undefined ? undefined : `${s.doughMass}: ${proUnit(proNum(result.doughMass, 2), s.unitG)}`,
        `${s.achievedHydration}: ${proNum(result.achievedHydration, 1)}%`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<LevainMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "correctDough", label: s.modeCorrectDough },
          { id: "buildLevain", label: s.modeBuildLevain },
        ]}
      />
      {mode === "correctDough" ? (
        <>
          <ToolInput label={s.totalFlour} hint={s.totalFlourHint} value={totalFlourText} onChange={setTotalFlourText} />
          <ToolInput label={s.targetHydration} value={targetHydrationText} onChange={setTargetHydrationText} />
          <ToolInput label={s.levainMass} value={levainMassText} onChange={setLevainMassText} />
          <ToolInput label={s.levainHydration} value={levainHydrationText} onChange={setLevainHydrationText} />
        </>
      ) : (
        <>
          <ToolInput label={s.seedMass} value={seedMassText} onChange={setSeedMassText} />
          <ToolInput label={s.seedHydration} value={seedHydrationText} onChange={setSeedHydrationText} />
          <ToolInput label={s.targetLevainMass} value={targetLevainMassText} onChange={setTargetLevainMassText} />
          <ToolInput label={s.targetLevainHydration} value={targetLevainHydrationText} onChange={setTargetLevainHydrationText} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.levainFlour} value={proUnit(proNum(result.levainFlour, 2), s.unitG)} />
          <ResultRow label={s.levainWater} value={proUnit(proNum(result.levainWater, 2), s.unitG)} />
          <ResultRow label={s.addedFlour} value={proUnit(proNum(result.addedFlour, 2), s.unitG)} />
          <ResultRow label={s.addedWater} value={proUnit(proNum(result.addedWater, 2), s.unitG)} />
          {result.doughMass !== undefined && (
            <ResultRow label={s.doughMass} value={proUnit(proNum(result.doughMass, 2), s.unitG)} />
          )}
          <ResultRow label={s.achievedHydration} value={`${proNum(result.achievedHydration, 1)}%`} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.mode, value: mode === "correctDough" ? s.modeCorrectDough : s.modeBuildLevain }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* nutrition-per-portion                                                       */
/* -------------------------------------------------------------------------- */

/** The seven fixed nutrients a Serbian label carries, each with its own optional reference. */
const NUTRITION_KEYS = ["fat", "satFat", "carbs", "sugars", "fiber", "protein", "salt"] as const;
type NutritionKey = (typeof NUTRITION_KEYS)[number];

/**
 * One nutrition table in three columns, and the exact kJ/kcal pairing. Holds no
 * food composition table and no Atwater factors — every number is one the user
 * typed, rearranged. The decimal count is a DISPLAY choice the user picks here,
 * never a rounding baked into a legal declaration.
 */
export function NutritionPerPortionTool() {
  const s = strings.pro.kuhinja["nutrition-per-portion"];
  const [direction, setDirection] = useState<NutritionDirection>("per100ToPortion");
  const [energyText, setEnergyText] = useState("");
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>("kJ");
  const [values, setValues] = useState<Record<NutritionKey, string>>({
    fat: "",
    satFat: "",
    carbs: "",
    sugars: "",
    fiber: "",
    protein: "",
    salt: "",
  });
  const [references, setReferences] = useState<Record<NutritionKey, string>>({
    fat: "",
    satFat: "",
    carbs: "",
    sugars: "",
    fiber: "",
    protein: "",
    salt: "",
  });
  const [portionMassText, setPortionMassText] = useState("");
  const [packageMassText, setPackageMassText] = useState("");
  const [portionsPerPackageText, setPortionsPerPackageText] = useState("");
  const [digits, setDigits] = useState<"0" | "1" | "2" | "3">("1");

  const nutrientLabel = (key: NutritionKey): string =>
    key === "fat"
      ? s.fat
      : key === "satFat"
        ? s.satFat
        : key === "carbs"
          ? s.carbs
          : key === "sugars"
            ? s.sugars
            : key === "fiber"
              ? s.fiber
              : key === "protein"
                ? s.protein
                : s.salt;

  const typed = proParse(energyText) !== undefined || proParse(portionMassText) !== undefined;
  const nutrients: NutritionRow[] = NUTRITION_KEYS.filter((key) => values[key].trim() !== "").map((key) => ({
    name: nutrientLabel(key),
    value: proParse(values[key]) ?? Number.NaN,
    reference: proParse(references[key]),
  }));

  const result = nutritionPerPortion({
    direction,
    energy: proParse(energyText) ?? Number.NaN,
    energyUnit,
    nutrients,
    portionMass: proParse(portionMassText) ?? Number.NaN,
    packageMass: proParse(packageMassText),
    portionsPerPackage: proParse(portionsPerPackageText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "portionMass"
        ? s.errorPortionMass
        : field === "energy"
          ? s.errorEnergy
          : field === "nutrientValue"
            ? s.errorNutrientValue
            : field === "reference"
              ? s.errorReference
              : field === "packageMass"
                ? s.errorPackageMass
                : field === "portionsPerPackage"
                  ? s.errorPortionsPerPackage
                  : s.errorPackage;

  const d = Number(digits);
  const copyText = !result.ok
    ? ""
    : [
        `${s.energyKJ}: ${proUnit(proNum(result.energy.per100gKJ, 0), s.unitKj)} / ${proUnit(proNum(result.energy.perPortionKJ, 0), s.unitKj)}`,
        `${s.energyKcal}: ${proUnit(proNum(result.energy.per100gKcal, 0), s.unitKcal)} / ${proUnit(proNum(result.energy.perPortionKcal, 0), s.unitKcal)}`,
        ...result.rows.map(
          (row) =>
            `${row.name}: ${proUnit(proNum(row.per100g, d), s.unitG)} / ${proUnit(proNum(row.perPortion, d), s.unitG)}${
              row.percentOfReference === undefined ? "" : ` (${proNum(row.percentOfReference, 1)}% RI)`
            }`,
        ),
      ].join("\n");

  return (
    <>
      <ToolSelect<NutritionDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "per100ToPortion", label: s.directionPer100ToPortion },
          { id: "portionToPer100", label: s.directionPortionToPer100 },
        ]}
      />
      <ToolInput label={s.energy} value={energyText} onChange={setEnergyText} />
      <ToolSelect<EnergyUnit>
        label={s.energyUnit}
        value={energyUnit}
        onChange={setEnergyUnit}
        options={[
          { id: "kJ", label: s.unitKj },
          { id: "kcal", label: s.unitKcal },
        ]}
      />
      {NUTRITION_KEYS.map((key) => (
        <ToolInput
          key={key}
          label={nutrientLabel(key)}
          value={values[key]}
          onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
        />
      ))}
      <ToolInput label={s.portionMass} value={portionMassText} onChange={setPortionMassText} />
      <ToolInput label={s.packageMass} hint={s.packageMassHint} value={packageMassText} onChange={setPackageMassText} />
      <ToolInput label={s.portionsPerPackage} value={portionsPerPackageText} onChange={setPortionsPerPackageText} />
      {NUTRITION_KEYS.map((key) => (
        <ToolInput
          key={`${key}Ref`}
          label={`${s.referencePrefix} ${nutrientLabel(key)}`}
          hint={s.referenceHint}
          value={references[key]}
          onChange={(v) => setReferences((prev) => ({ ...prev, [key]: v }))}
        />
      ))}
      <ToolSelect<"0" | "1" | "2" | "3">
        label={s.digits}
        hint={s.digitsHint}
        value={digits}
        onChange={setDigits}
        options={[
          { id: "0", label: "0" },
          { id: "1", label: "1" },
          { id: "2", label: "2" },
          { id: "3", label: "3" },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.energyKJ}
            value={`${proUnit(proNum(result.energy.per100gKJ, 0), s.unitKj)} / ${proUnit(proNum(result.energy.perPortionKJ, 0), s.unitKj)}${
              result.energy.perPackageKJ === undefined ? "" : ` / ${proUnit(proNum(result.energy.perPackageKJ, 0), s.unitKj)}`
            }`}
          />
          <ResultRow
            label={s.energyKcal}
            value={`${proUnit(proNum(result.energy.per100gKcal, 0), s.unitKcal)} / ${proUnit(proNum(result.energy.perPortionKcal, 0), s.unitKcal)}${
              result.energy.perPackageKcal === undefined ? "" : ` / ${proUnit(proNum(result.energy.perPackageKcal, 0), s.unitKcal)}`
            }`}
          />
          <ToolTable
            head={
              result.rows.some((r) => r.percentOfReference !== undefined)
                ? [s.colNutrient, s.colPer100, s.colPerPortion, s.colPerPackage, s.colReferencePercent]
                : [s.colNutrient, s.colPer100, s.colPerPortion, s.colPerPackage]
            }
            rows={result.rows.map((row) => {
              const hasReference = result.rows.some((r) => r.percentOfReference !== undefined);
              const base = [
                row.name,
                proUnit(proNum(row.per100g, d), s.unitG),
                proUnit(proNum(row.perPortion, d), s.unitG),
                row.perPackage === undefined ? "—" : proUnit(proNum(row.perPackage, d), s.unitG),
              ];
              return hasReference
                ? [...base, row.percentOfReference === undefined ? "—" : `${proNum(row.percentOfReference, 1)}%`]
                : base;
            })}
            prose={[0]}
          />
          <p className="tool__note">{s.notADeclarationNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.direction, value: direction === "per100ToPortion" ? s.directionPer100ToPortion : s.directionPortionToPer100 },
              { label: s.portionMass, value: proUnit(proNum(proParse(portionMassText) ?? 0, 1), s.unitG) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* pan-area-volume                                                             */
/* -------------------------------------------------------------------------- */

type PanShapeKind = PanShape["kind"];

/** One shape's own field set, read from four shared text fields per the kind selected. */
function buildPanShape(
  kind: PanShapeKind,
  diameterText: string,
  sideText: string,
  aText: string,
  bText: string,
  outerText: string,
  innerText: string,
): PanShape {
  if (kind === "circle") return { kind, diameter: proParse(diameterText) ?? Number.NaN };
  if (kind === "square") return { kind, side: proParse(sideText) ?? Number.NaN };
  if (kind === "rect") return { kind, a: proParse(aText) ?? Number.NaN, b: proParse(bText) ?? Number.NaN };
  return { kind, outer: proParse(outerText) ?? Number.NaN, inner: proParse(innerText) ?? Number.NaN };
}

function PanShapeFields({
  kind,
  onKind,
  diameterText,
  onDiameter,
  sideText,
  onSide,
  aText,
  onA,
  bText,
  onB,
  outerText,
  onOuter,
  innerText,
  onInner,
  s,
}: {
  kind: PanShapeKind;
  onKind: (k: PanShapeKind) => void;
  diameterText: string;
  onDiameter: (v: string) => void;
  sideText: string;
  onSide: (v: string) => void;
  aText: string;
  onA: (v: string) => void;
  bText: string;
  onB: (v: string) => void;
  outerText: string;
  onOuter: (v: string) => void;
  innerText: string;
  onInner: (v: string) => void;
  s: (typeof strings.pro.kuhinja)["pan-area-volume"];
}) {
  return (
    <>
      <ToolSelect<PanShapeKind>
        label={s.shapeKind}
        value={kind}
        onChange={onKind}
        options={[
          { id: "circle", label: s.shapeCircle },
          { id: "square", label: s.shapeSquare },
          { id: "rect", label: s.shapeRect },
          { id: "ring", label: s.shapeRing },
        ]}
      />
      {kind === "circle" && <ToolInput label={s.diameter} value={diameterText} onChange={onDiameter} />}
      {kind === "square" && <ToolInput label={s.side} value={sideText} onChange={onSide} />}
      {kind === "rect" && (
        <>
          <ToolInput label={s.a} value={aText} onChange={onA} />
          <ToolInput label={s.b} value={bText} onChange={onB} />
        </>
      )}
      {kind === "ring" && (
        <>
          <ToolInput label={s.outer} value={outerText} onChange={onOuter} />
          <ToolInput label={s.inner} value={innerText} onChange={onInner} />
        </>
      )}
    </>
  );
}

/**
 * Areas, the swap factor between two tins, and the volume/height pair — plus a
 * separate exact frustum calculation for a tapered vessel, where `area × height`
 * would overestimate.
 */
export function PanAreaVolumeTool() {
  const s = strings.pro.kuhinja["pan-area-volume"];
  const [kindA, setKindA] = useState<PanShapeKind>("circle");
  const [diameterAText, setDiameterAText] = useState("");
  const [sideAText, setSideAText] = useState("");
  const [aAText, setAAText] = useState("");
  const [bAText, setBAText] = useState("");
  const [outerAText, setOuterAText] = useState("");
  const [innerAText, setInnerAText] = useState("");
  const [hasShapeB, setHasShapeB] = useState<"no" | "yes">("no");
  const [kindB, setKindB] = useState<PanShapeKind>("circle");
  const [diameterBText, setDiameterBText] = useState("");
  const [sideBText, setSideBText] = useState("");
  const [aBText, setABText] = useState("");
  const [bBText, setBBText] = useState("");
  const [outerBText, setOuterBText] = useState("");
  const [innerBText, setInnerBText] = useState("");
  const [fillHeightText, setFillHeightText] = useState("");
  const [targetVolumeText, setTargetVolumeText] = useState("");
  const [batterMassAText, setBatterMassAText] = useState("");

  const shapeA = buildPanShape(kindA, diameterAText, sideAText, aAText, bAText, outerAText, innerAText);
  const typed =
    proParse(diameterAText) !== undefined ||
    proParse(sideAText) !== undefined ||
    proParse(aAText) !== undefined ||
    proParse(outerAText) !== undefined;

  const result = panConversion({
    shapeA,
    shapeB: hasShapeB === "yes" ? buildPanShape(kindB, diameterBText, sideBText, aBText, bBText, outerBText, innerBText) : undefined,
    fillHeight: proParse(fillHeightText),
    targetVolume: proParse(targetVolumeText),
    batterMassA: proParse(batterMassAText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "diameter"
        ? s.errorDiameter
        : field === "side"
          ? s.errorSide
          : field === "a"
            ? s.errorA
            : field === "b"
              ? s.errorB
              : field === "outer" || field === "inner"
                ? s.errorRing
                : field === "fillHeight"
                  ? s.errorFillHeight
                  : field === "targetVolume"
                    ? s.errorTargetVolume
                    : s.errorBatterMassA;

  const [topDiameterText, setTopDiameterText] = useState("");
  const [bottomDiameterText, setBottomDiameterText] = useState("");
  const [frustumHeightText, setFrustumHeightText] = useState("");
  const frustumTyped = proParse(topDiameterText) !== undefined || proParse(bottomDiameterText) !== undefined;
  const frustum = frustumVolume({
    topDiameter: proParse(topDiameterText) ?? Number.NaN,
    bottomDiameter: proParse(bottomDiameterText) ?? Number.NaN,
    height: proParse(frustumHeightText) ?? Number.NaN,
  });
  const frustumField = frustum.ok ? undefined : reasonField(frustum.reason);
  const frustumFailure =
    frustum.ok || !frustumTyped
      ? undefined
      : frustumField === "topDiameter"
        ? s.errorTopDiameter
        : frustumField === "bottomDiameter"
          ? s.errorBottomDiameter
          : s.errorFrustumHeight;

  const copyText = !result.ok
    ? ""
    : [
        `${s.areaA}: ${proUnit(proNum(result.areaA, 2), s.unitCm2)}`,
        result.areaB === undefined ? undefined : `${s.areaB}: ${proUnit(proNum(result.areaB, 2), s.unitCm2)}`,
        result.swapFactor === undefined ? undefined : `${s.swapFactor}: ${proNum(result.swapFactor, 4)}`,
        result.massB === undefined ? undefined : `${s.massB}: ${proUnit(proNum(result.massB, 1), s.unitG)}`,
        result.volumeAtHeight === undefined ? undefined : `${s.volumeAtHeight}: ${proUnit(proNum(result.volumeAtHeight, 3), s.unitL)}`,
        result.heightForVolume === undefined ? undefined : `${s.heightForVolume}: ${proUnit(proNum(result.heightForVolume, 2), s.unitCm)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSection title={s.sectionA}>
        <PanShapeFields
          kind={kindA}
          onKind={setKindA}
          diameterText={diameterAText}
          onDiameter={setDiameterAText}
          sideText={sideAText}
          onSide={setSideAText}
          aText={aAText}
          onA={setAAText}
          bText={bAText}
          onB={setBAText}
          outerText={outerAText}
          onOuter={setOuterAText}
          innerText={innerAText}
          onInner={setInnerAText}
          s={s}
        />
      </ToolSection>
      <ToolSelect<"no" | "yes">
        label={s.hasShapeB}
        value={hasShapeB}
        onChange={setHasShapeB}
        options={[
          { id: "no", label: s.hasShapeBNo },
          { id: "yes", label: s.hasShapeBYes },
        ]}
      />
      {hasShapeB === "yes" && (
        <ToolSection title={s.sectionB}>
          <PanShapeFields
            kind={kindB}
            onKind={setKindB}
            diameterText={diameterBText}
            onDiameter={setDiameterBText}
            sideText={sideBText}
            onSide={setSideBText}
            aText={aBText}
            onA={setABText}
            bText={bBText}
            onB={setBBText}
            outerText={outerBText}
            onOuter={setOuterBText}
            innerText={innerBText}
            onInner={setInnerBText}
            s={s}
          />
          <ToolInput label={s.batterMassA} value={batterMassAText} onChange={setBatterMassAText} />
        </ToolSection>
      )}
      <ToolInput label={s.fillHeight} value={fillHeightText} onChange={setFillHeightText} />
      <ToolInput label={s.targetVolume} value={targetVolumeText} onChange={setTargetVolumeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.areaA} value={proUnit(proNum(result.areaA, 2), s.unitCm2)} />
          {result.areaB !== undefined && <ResultRow label={s.areaB} value={proUnit(proNum(result.areaB, 2), s.unitCm2)} />}
          {result.swapFactor !== undefined && <ResultRow label={s.swapFactor} value={proNum(result.swapFactor, 4)} />}
          {result.massB !== undefined && (
            <>
              <ResultRow label={s.massB} value={proUnit(proNum(result.massB, 1), s.unitG)} />
              <p className="tool__note">{s.massBNote}</p>
            </>
          )}
          {result.volumeAtHeight !== undefined && (
            <ResultRow label={s.volumeAtHeight} value={proUnit(proNum(result.volumeAtHeight, 3), s.unitL)} />
          )}
          {result.heightForVolume !== undefined && (
            <ResultRow label={s.heightForVolume} value={proUnit(proNum(result.heightForVolume, 2), s.unitCm)} />
          )}
          <p className="tool__note">{s.straightWalledNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.shapeKind, value: kindA === "circle" ? s.shapeCircle : kindA === "square" ? s.shapeSquare : kindA === "rect" ? s.shapeRect : s.shapeRing },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      <ToolSection title={s.frustumTitle}>
        <ToolInput label={s.topDiameter} value={topDiameterText} onChange={setTopDiameterText} />
        <ToolInput label={s.bottomDiameter} value={bottomDiameterText} onChange={setBottomDiameterText} />
        <ToolInput label={s.frustumHeight} value={frustumHeightText} onChange={setFrustumHeightText} />
        {frustumFailure !== undefined && <ToolFailure>{frustumFailure}</ToolFailure>}
        {frustum.ok && frustumTyped && (
          <>
            <ResultRow label={s.frustumVolume} value={proUnit(proNum(frustum.volume, 3), s.unitL)} />
            <ToolFormula>{s.frustumFormula}</ToolFormula>
            <ToolInputEcho
              entries={[
                { label: s.topDiameter, value: proUnit(proNum(proParse(topDiameterText) ?? 0, 1), s.unitCm) },
                { label: s.bottomDiameter, value: proUnit(proNum(proParse(bottomDiameterText) ?? 0, 1), s.unitCm) },
                { label: s.frustumHeight, value: proUnit(proNum(proParse(frustumHeightText) ?? 0, 1), s.unitCm) },
              ]}
            />
            <CopyButton
              value={`${s.frustumVolume}: ${proUnit(proNum(frustum.volume, 3), s.unitL)}`}
            />
          </>
        )}
      </ToolSection>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* plate-cost                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The unit word the user typed, or `undefined` when it is none of the three.
 *
 * The `undefined` is the point. This used to be a map with a `?? "g"` fallback,
 * so „200;ml" was silently costed as 200 g — priced per kilogram instead of per
 * litre, printed as „200 g", and wrong by whatever the two prices differ by.
 * `errorUnit` was written for exactly this case and no input could ever reach
 * it, because a `PlateUnit` field cannot carry „not a unit".
 */
export function plateUnitFromWord(
  word: string,
  s: (typeof strings.pro.kuhinja)["plate-cost"],
): PlateUnit | undefined {
  const folded = foldSearchText(word.trim());
  return folded === foldSearchText(s.unitG)
    ? "g"
    : folded === foldSearchText(s.unitMl)
      ? "ml"
      : folded === foldSearchText(s.unitPiece)
        ? "piece"
        : undefined;
}

function plateUnitLabel(unit: PlateUnit, s: (typeof strings.pro.kuhinja)["plate-cost"]): string {
  return unit === "g" ? s.unitG : unit === "ml" ? s.unitMl : s.unitPiece;
}

/**
 * What one plate costs, and what it has to sell for at the food-cost target —
 * NET of any tax, which the result states rather than assumes.
 */
export function PlateCostTool() {
  const s = strings.pro.kuhinja["plate-cost"];
  const [linesText, setLinesText] = useState("");
  const [portionsText, setPortionsText] = useState("");
  const [targetFoodCostText, setTargetFoodCostText] = useState("");
  const [extraPerPortionText, setExtraPerPortionText] = useState("");

  const rows = proRows(linesText);
  const typed = rows.length > 0;
  const units = rows.map((cells) => plateUnitFromWord(cells[2] ?? "", s));
  const unitUnknown = units.some((unit) => unit === undefined);
  const lines: PlateLine[] = rows.map((cells, index) => ({
    name: cells[0] ?? "",
    quantity: proParse(cells[1] ?? "") ?? Number.NaN,
    // Only ever reached for a row this tool refuses to cost, so the „g" is a
    // placeholder in an unread result, not an assumption about that row.
    unit: units[index] ?? "g",
    unitPrice: proParse(cells[3] ?? "") ?? Number.NaN,
    yieldPercent: proParse(cells[4] ?? "") ?? Number.NaN,
  }));

  const result = plateCost({
    lines,
    portions: proParse(portionsText) ?? Number.NaN,
    targetFoodCost: proParse(targetFoodCostText) ?? Number.NaN,
    extraPerPortion: proParse(extraPerPortionText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    !typed || (result.ok && !unitUnknown)
      ? undefined
      : unitUnknown
        ? s.errorUnit
        : field === "lines"
          ? s.errorLines
          : field === "portions"
            ? s.errorPortions
            : field === "targetFoodCost"
              ? s.errorTargetFoodCost
              : field === "extraPerPortion"
                ? s.errorExtraPerPortion
                : field === "quantity"
                  ? s.errorQuantity
                  : field === "unitPrice"
                    ? s.errorUnitPrice
                    : field === "yieldPercent"
                      ? s.errorYieldPercent
                      : s.errorUnit;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.name}: ${proUnit(proNum(row.cost, 2), s.unitCurrency)}${row.share === undefined ? "" : ` (${proNum(row.share, 1)}%)`}`,
        ),
        "",
        `${s.total}: ${proUnit(proNum(result.total, 2), s.unitCurrency)}`,
        `${s.costPerPortion}: ${proUnit(proNum(result.costPerPortion, 2), s.unitCurrency)}`,
        `${s.sellingPrice}: ${proUnit(proNum(result.sellingPrice, 2), s.unitCurrency)}`,
        `${s.margin}: ${proUnit(proNum(result.margin, 2), s.unitCurrency)}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.lines} hint={s.linesHint} value={linesText} onChange={setLinesText} />
      <ToolInput label={s.portions} value={portionsText} onChange={setPortionsText} />
      <ToolInput label={s.targetFoodCost} value={targetFoodCostText} onChange={setTargetFoodCostText} />
      <ToolInput label={s.extraPerPortion} hint={s.extraPerPortionHint} value={extraPerPortionText} onChange={setExtraPerPortionText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && !unitUnknown && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colUsed, s.colCost, s.colShare]}
            rows={result.rows.map((row) => [
              row.name,
              proUnit(proNum(row.usedQuantity, 3), plateUnitLabel(row.unit, s)),
              proUnit(proNum(row.cost, 2), s.unitCurrency),
              row.share === undefined ? "—" : `${proNum(row.share, 1)}%`,
            ])}
            prose={[0]}
          />
          <ResultRow label={s.total} value={proUnit(proNum(result.total, 2), s.unitCurrency)} />
          <ResultRow label={s.costPerPortion} value={proUnit(proNum(result.costPerPortion, 2), s.unitCurrency)} />
          <ResultRow label={s.sellingPrice} value={proUnit(proNum(result.sellingPrice, 2), s.unitCurrency)} />
          <p className="tool__note">{s.netPriceNote}</p>
          <ResultRow label={s.margin} value={proUnit(proNum(result.margin, 2), s.unitCurrency)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.portions, value: proNum(proParse(portionsText) ?? 0, 0) },
              { label: s.targetFoodCost, value: `${proNum(proParse(targetFoodCostText) ?? 0, 1)}%` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* portions-from-pack                                                          */
/* -------------------------------------------------------------------------- */

function packUnitLabel(unit: PackUnit, s: (typeof strings.pro.kuhinja)["portions-from-pack"]): string {
  return unit === "g" ? s.unitG : unit === "kg" ? s.unitKg : unit === "ml" ? s.unitMl : unit === "l" ? s.unitL : s.unitPiece;
}

/**
 * How many portions a pack yields, how many packs a service needs, and what a
 * portion costs. Mass and volume are never interconverted.
 */
export function PortionsFromPackTool() {
  const s = strings.pro.kuhinja["portions-from-pack"];
  const [packQuantityText, setPackQuantityText] = useState("");
  const [packUnit, setPackUnit] = useState<PackUnit>("kg");
  const [portionQuantityText, setPortionQuantityText] = useState("");
  const [portionUnit, setPortionUnit] = useState<PackUnit>("g");
  const [lossPercentText, setLossPercentText] = useState("");
  const [portionsNeededText, setPortionsNeededText] = useState("");
  const [packPriceText, setPackPriceText] = useState("");

  const typed = proParse(packQuantityText) !== undefined || proParse(portionQuantityText) !== undefined;
  const result = portionsFromPack({
    packQuantity: proParse(packQuantityText) ?? Number.NaN,
    packUnit,
    portionQuantity: proParse(portionQuantityText) ?? Number.NaN,
    portionUnit,
    lossPercent: proParse(lossPercentText) ?? 0,
    portionsNeeded: proParse(portionsNeededText),
    packPrice: proParse(packPriceText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "packUnit"
        ? s.errorPackUnit
        : field === "portionUnit"
          ? s.errorPortionUnit
          : field === "unitMismatch"
            ? s.errorUnitMismatch
            : field === "packQuantity"
              ? s.errorPackQuantity
              : field === "portionQuantity"
                ? s.errorPortionQuantity
                : field === "lossPercent"
                  ? s.errorLossPercent
                  : field === "portionsNeeded"
                    ? s.errorPortionsNeeded
                    : field === "packPrice"
                      ? s.errorPackPrice
                      : s.errorPortionLargerThanPack;

  const packUnitOptions = [
    { id: "g" as const, label: s.unitG },
    { id: "kg" as const, label: s.unitKg },
    { id: "ml" as const, label: s.unitMl },
    { id: "l" as const, label: s.unitL },
    { id: "piece" as const, label: s.unitPiece },
  ];

  const copyText = !result.ok
    ? ""
    : [
        `${s.portionsPerPack}: ${proNum(result.portionsPerPack, 0)}`,
        `${s.leftover}: ${proNum(result.leftover, 2)} ${packUnitLabel(packUnit, s)}`,
        `${s.yieldPercent}: ${proNum(result.yieldPercent, 1)}%`,
        result.packsNeeded === undefined ? undefined : `${s.packsNeeded}: ${proNum(result.packsNeeded, 0)}`,
        result.surplusPortions === undefined ? undefined : `${s.surplusPortions}: ${proNum(result.surplusPortions, 0)}`,
        result.totalCost === undefined ? undefined : `${s.totalCost}: ${proUnit(proNum(result.totalCost, 2), s.unitCurrency)}`,
        result.pricePerPortion === undefined
          ? undefined
          : `${s.pricePerPortion}: ${proUnit(proNum(result.pricePerPortion, 2), s.unitCurrency)}`,
        result.unitPrice === undefined ? undefined : `${s.unitPrice}: ${proUnit(proNum(result.unitPrice, 2), s.unitCurrency)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.packQuantity} value={packQuantityText} onChange={setPackQuantityText} />
      <ToolSelect<PackUnit> label={s.packUnit} value={packUnit} onChange={setPackUnit} options={packUnitOptions} />
      <ToolInput label={s.portionQuantity} value={portionQuantityText} onChange={setPortionQuantityText} />
      <ToolSelect<PackUnit> label={s.portionUnit} value={portionUnit} onChange={setPortionUnit} options={packUnitOptions} />
      <ToolInput label={s.lossPercent} value={lossPercentText} onChange={setLossPercentText} />
      <ToolInput label={s.portionsNeeded} value={portionsNeededText} onChange={setPortionsNeededText} />
      <ToolInput label={s.packPrice} value={packPriceText} onChange={setPackPriceText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.portionsPerPack} value={proNum(result.portionsPerPack, 0)} />
          <ResultRow label={s.leftover} value={`${proNum(result.leftover, 2)} ${packUnitLabel(packUnit, s)}`} />
          <ResultRow label={s.yieldPercent} value={`${proNum(result.yieldPercent, 1)}%`} />
          {result.packsNeeded !== undefined && <ResultRow label={s.packsNeeded} value={proNum(result.packsNeeded, 0)} />}
          {result.surplusPortions !== undefined && (
            <ResultRow label={s.surplusPortions} value={proNum(result.surplusPortions, 0)} />
          )}
          {result.totalCost !== undefined && (
            <ResultRow label={s.totalCost} value={proUnit(proNum(result.totalCost, 2), s.unitCurrency)} />
          )}
          {result.pricePerPortion !== undefined && (
            <ResultRow label={s.pricePerPortion} value={proUnit(proNum(result.pricePerPortion, 2), s.unitCurrency)} />
          )}
          {result.unitPrice !== undefined && (
            <ResultRow label={s.unitPrice} value={proUnit(proNum(result.unitPrice, 2), s.unitCurrency)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.packQuantity, value: `${proNum(proParse(packQuantityText) ?? 0, 3)} ${packUnitLabel(packUnit, s)}` },
              { label: s.portionQuantity, value: `${proNum(proParse(portionQuantityText) ?? 0, 3)} ${packUnitLabel(portionUnit, s)}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* ratio-split                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A quantity divided by a ratio, rounded by largest remainder so the printed
 * column still adds up — with a printed row for what a step size cannot allot.
 */
export function RatioSplitTool() {
  const s = strings.pro.kuhinja["ratio-split"];
  const [totalText, setTotalText] = useState("");
  const [unitText, setUnitText] = useState("g");
  const [ratioText, setRatioText] = useState("");
  const [namesText, setNamesText] = useState("");
  const [stepText, setStepText] = useState("");

  const typed = totalText.trim() !== "" || ratioText.trim() !== "";
  const parsedRatio = parseRatio(ratioText);
  const names = namesText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const result = parsedRatio.ok
    ? ratioSplit({
        total: proParse(totalText) ?? Number.NaN,
        parts: parsedRatio.parts,
        step: proParse(stepText),
      })
    : parsedRatio;

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "ratio"
        ? s.errorRatio
        : field === "total"
          ? s.errorTotal
          : s.errorStep;

  const unit = unitText.trim() === "" ? s.unitG : unitText.trim();

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row, index) => `${names[index] ?? `${s.partPrefix} ${index + 1}`}: ${proUnit(proNum(row.amount, 2), unit)} (${proNum(row.share, 1)}%)`,
        ),
        `${s.total}: ${proUnit(proNum(result.total, 2), unit)}`,
        `${s.unallocated}: ${proUnit(proNum(result.unallocated, 2), unit)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.total} value={totalText} onChange={setTotalText} />
      <ToolInput label={s.unit} hint={s.unitHint} value={unitText} onChange={setUnitText} />
      <ToolInput label={s.ratio} hint={s.ratioHint} value={ratioText} onChange={setRatioText} />
      <ToolTextArea label={s.names} hint={s.namesHint} value={namesText} onChange={setNamesText} />
      <ToolInput label={s.step} hint={s.stepHint} value={stepText} onChange={setStepText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colRatioPart, s.colExact, s.colAmount, s.colShare]}
            rows={result.rows.map((row, index) => [
              names[index] ?? `${s.partPrefix} ${index + 1}`,
              proNum(parsedRatio.ok ? (parsedRatio.parts[index] ?? 0) : 0, 2),
              proUnit(proNum(row.exact, 2), unit),
              proUnit(proNum(row.amount, 2), unit),
              `${proNum(row.share, 1)}%`,
            ])}
            prose={[0]}
          />
          <ResultRow label={s.total} value={proUnit(proNum(result.total, 2), unit)} />
          <ResultRow label={s.unallocated} value={proUnit(proNum(result.unallocated, 2), unit)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.ratio, value: ratioText.trim() }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* recipe-scale                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The unit word the user typed. Unlike {@link plateUnitFromWord} this one has
 * an honest total answer: „other" is a member of `RecipeUnit`, meaning „a unit
 * I do not convert, just scale the number", so a spoon or a „dl" lands there by
 * design rather than by accident — and `displayUnitLabel` echoes back the word
 * as written so nothing the user typed is erased.
 *
 * The vocabulary is still read out of `strings` rather than restated here. It
 * was restated, and the two copies had already drifted: the map's own key for
 * „other" was „ostalo" while the label read „drugo" — invisible only because
 * every unrecognised word ends at „other" anyway.
 */
export function recipeUnitFromWord(
  word: string,
  s: (typeof strings.pro.kuhinja)["recipe-scale"],
): RecipeUnit {
  const folded = foldSearchText(word.trim());
  return folded === foldSearchText(s.unitG)
    ? "g"
    : folded === foldSearchText(s.unitKg)
      ? "kg"
      : folded === foldSearchText(s.unitMl)
        ? "ml"
        : folded === foldSearchText(s.unitL)
          ? "l"
          : folded === foldSearchText(s.unitPiece)
            ? "piece"
            : "other";
}

function recipeUnitLabel(unit: RecipeUnit, s: (typeof strings.pro.kuhinja)["recipe-scale"]): string {
  return unit === "g"
    ? s.unitG
    : unit === "kg"
      ? s.unitKg
      : unit === "ml"
        ? s.unitMl
        : unit === "l"
          ? s.unitL
          : unit === "piece"
            ? s.unitPiece
            : s.unitOther;
}

/**
 * A whole ingredient list moved to another number of portions, a factor, or a
 * target total mass — with fraction/mixed-number quantities parsed on the way in.
 */
export function RecipeScaleTool() {
  const s = strings.pro.kuhinja["recipe-scale"];
  const [mode, setMode] = useState<RecipeScaleMode>("portions");
  const [linesText, setLinesText] = useState("");
  const [originalPortionsText, setOriginalPortionsText] = useState("");
  const [targetPortionsText, setTargetPortionsText] = useState("");
  const [factorText, setFactorText] = useState("");
  const [targetMassText, setTargetMassText] = useState("");
  const [stepText, setStepText] = useState("");

  const rows = proRows(linesText);
  const typed = rows.length > 0;
  // The raw unit word as typed — kept so a line whose unit falls back to
  // "other" (a spoon, a "dl") still echoes what the baker actually wrote,
  // instead of a generic label that would erase it.
  const rawUnits = rows.map((cells) => (cells[1] ?? "").trim());
  // Every row's quantity must parse as a number, fraction or mixed number
  // before recipeScale ever runs — a row that fails is a formatting problem,
  // not an arithmetic one, and is reported as its own refusal.
  const quantityResults = rows.map((cells) => parseQuantity(cells[0] ?? ""));
  const badRowIndex = quantityResults.findIndex((r) => !r.ok);
  const lines: RecipeLine[] = rows.map((cells, index) => {
    const parsed = quantityResults[index];
    const step = (cells[3] ?? "").trim();
    return {
      name: cells[2] ?? "",
      quantity: parsed !== undefined && parsed.ok ? parsed.value : Number.NaN,
      unit: recipeUnitFromWord(cells[1] ?? "", s),
      step: step === "" ? undefined : proParse(step),
    };
  });
  const displayUnitLabel = (unit: RecipeUnit, index: number): string =>
    unit === "other" ? (rawUnits[index] ?? s.unitOther) : recipeUnitLabel(unit, s);

  const result =
    badRowIndex === -1
      ? recipeScale({
          mode,
          lines,
          originalPortions: mode === "portions" ? proParse(originalPortionsText) : undefined,
          targetPortions: mode === "portions" ? proParse(targetPortionsText) : undefined,
          factor: mode === "factor" ? proParse(factorText) : undefined,
          targetMass: mode === "targetMass" ? proParse(targetMassText) : undefined,
          step: proParse(stepText),
        })
      : { ok: false as const, reason: `quantity:${badRowIndex}` };

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "quantity"
        ? s.errorQuantityFormat
        : field === "lines"
          ? s.errorLines
          : field === "lineQuantity"
            ? s.errorLineQuantity
            : field === "lineStep"
              ? s.errorLineStep
              : field === "step"
                ? s.errorStep
                : field === "originalPortions"
                  ? s.errorOriginalPortions
                  : field === "targetPortions"
                    ? s.errorTargetPortions
                    : field === "factor"
                      ? s.errorFactor
                      : field === "targetMass"
                        ? s.errorTargetMass
                        : s.errorUnitMismatch;

  const copyText = !result.ok
    ? ""
    : [
        `${s.factor}: ${proNum(result.factor, 4)}`,
        ...result.rows.map(
          (row, index) =>
            `${row.name}: ${proUnit(proNum(row.displayQuantity, 2), displayUnitLabel(row.displayUnit, index))}${
              row.share === undefined ? "" : ` (${proNum(row.share, 1)}%)`
            }`,
        ),
        result.totalMass === undefined ? undefined : `${s.totalMass}: ${proUnit(proNum(result.totalMass, 2), s.unitG)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<RecipeScaleMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "portions", label: s.modePortions },
          { id: "factor", label: s.modeFactor },
          { id: "targetMass", label: s.modeTargetMass },
        ]}
      />
      <ToolTextArea label={s.lines} hint={s.linesHint} value={linesText} onChange={setLinesText} />
      {mode === "portions" && (
        <>
          <ToolInput label={s.originalPortions} value={originalPortionsText} onChange={setOriginalPortionsText} />
          <ToolInput label={s.targetPortions} value={targetPortionsText} onChange={setTargetPortionsText} />
        </>
      )}
      {mode === "factor" && <ToolInput label={s.factor} value={factorText} onChange={setFactorText} />}
      {mode === "targetMass" && <ToolInput label={s.targetMass} value={targetMassText} onChange={setTargetMassText} />}
      <ToolInput label={s.step} hint={s.stepHint} value={stepText} onChange={setStepText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.factor} value={proNum(result.factor, 4)} />
          <ToolTable
            head={[s.colName, s.colScaled, s.colShare]}
            rows={result.rows.map((row, index) => [
              row.name,
              proUnit(proNum(row.displayQuantity, 2), displayUnitLabel(row.displayUnit, index)),
              row.share === undefined ? "—" : `${proNum(row.share, 1)}%`,
            ])}
            prose={[0]}
          />
          {result.totalMass !== undefined && (
            <ResultRow label={s.totalMass} value={proUnit(proNum(result.totalMass, 2), s.unitG)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.mode, value: mode === "portions" ? s.modePortions : mode === "factor" ? s.modeFactor : s.modeTargetMass }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* solution-concentration — LIFE SAFETY: quantities only, never a verdict       */
/* -------------------------------------------------------------------------- */

const SOLUTION_MODES: readonly SolutionMode[] = ["blend", "blendAddSecond", "dilute", "concentrate", "addSolute"];

/**
 * One mass balance, solved five ways. **Life safety: this prints masses and a
 * percentage, and never a word about whether a concentration is appropriate,
 * permitted or safe for any use.**
 */
export function SolutionConcentrationTool() {
  const s = strings.pro.kuhinja["solution-concentration"];
  const [mode, setMode] = useState<SolutionMode>("blend");
  const [c1Text, setC1Text] = useState("");
  const [c2Text, setC2Text] = useState("");
  const [targetText, setTargetText] = useState("");
  const [massText, setMassText] = useState("");
  const [targetMassText, setTargetMassText] = useState("");
  const [concentrationLimitText, setConcentrationLimitText] = useState("");

  const needsC2 = mode === "blend" || mode === "blendAddSecond";
  const needsMass = mode !== "blend";
  const typed = proParse(c1Text) !== undefined || proParse(targetText) !== undefined;

  const result = solutionConcentration({
    mode,
    c1: proParse(c1Text) ?? Number.NaN,
    c2: needsC2 ? proParse(c2Text) : undefined,
    targetConcentration: proParse(targetText) ?? Number.NaN,
    mass: needsMass ? proParse(massText) : undefined,
    targetMass: mode === "blend" ? proParse(targetMassText) : undefined,
    concentrationLimit: proParse(concentrationLimitText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "c1"
        ? s.errorC1
        : field === "targetConcentration"
          ? s.errorTargetConcentration
          : field === "c2"
            ? s.errorC2
            : field === "targetMass"
              ? s.errorTargetMass
              : field === "equalConcentrations"
                ? s.errorEqualConcentrations
                : field === "targetOutOfRange"
                  ? s.errorTargetOutOfRange
                  : s.errorMass;

  const modeLabel = (m: SolutionMode): string =>
    m === "blend"
      ? s.modeBlend
      : m === "blendAddSecond"
        ? s.modeBlendAddSecond
        : m === "dilute"
          ? s.modeDilute
          : m === "concentrate"
            ? s.modeConcentrate
            : s.modeAddSolute;

  const copyText = !result.ok
    ? ""
    : [
        result.componentMass1 === undefined ? undefined : `${s.componentMass1}: ${proUnit(proNum(result.componentMass1, 2), s.unitG)}`,
        result.componentMass2 === undefined ? undefined : `${s.componentMass2}: ${proUnit(proNum(result.componentMass2, 2), s.unitG)}`,
        result.solventAdded === undefined ? undefined : `${s.solventAdded}: ${proUnit(proNum(result.solventAdded, 2), s.unitG)}`,
        result.massRemoved === undefined ? undefined : `${s.massRemoved}: ${proUnit(proNum(result.massRemoved, 2), s.unitG)}`,
        result.soluteAdded === undefined ? undefined : `${s.soluteAdded}: ${proUnit(proNum(result.soluteAdded, 2), s.unitG)}`,
        `${s.totalMass}: ${proUnit(proNum(result.totalMass, 2), s.unitG)}`,
        `${s.achievedConcentration}: ${proNum(result.achievedConcentration, 3)}%`,
        result.concentrationSpread === undefined
          ? undefined
          : `${s.concentrationSpread}: ${proNum(result.concentrationSpread, 2)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<SolutionMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={SOLUTION_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      <ToolInput label={s.c1} hint={s.massBasisHint} value={c1Text} onChange={setC1Text} />
      {needsC2 && <ToolInput label={s.c2} hint={s.massBasisHint} value={c2Text} onChange={setC2Text} />}
      <ToolInput label={s.targetConcentration} hint={s.massBasisHint} value={targetText} onChange={setTargetText} />
      {needsMass && <ToolInput label={s.mass} value={massText} onChange={setMassText} />}
      {mode === "blend" && <ToolInput label={s.targetMass} value={targetMassText} onChange={setTargetMassText} />}
      <ToolInput label={s.concentrationLimit} hint={s.limitHint} value={concentrationLimitText} onChange={setConcentrationLimitText} />
      {mode === "concentrate" && <p className="tool__note">{s.concentrateNote}</p>}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          {result.componentMass1 !== undefined && (
            <ResultRow label={s.componentMass1} value={proUnit(proNum(result.componentMass1, 2), s.unitG)} />
          )}
          {result.componentMass2 !== undefined && (
            <ResultRow label={s.componentMass2} value={proUnit(proNum(result.componentMass2, 2), s.unitG)} />
          )}
          {result.solventAdded !== undefined && (
            <ResultRow label={s.solventAdded} value={proUnit(proNum(result.solventAdded, 2), s.unitG)} />
          )}
          {result.massRemoved !== undefined && (
            <ResultRow label={s.massRemoved} value={proUnit(proNum(result.massRemoved, 2), s.unitG)} />
          )}
          {result.soluteAdded !== undefined && (
            <ResultRow label={s.soluteAdded} value={proUnit(proNum(result.soluteAdded, 2), s.unitG)} />
          )}
          <ResultRow label={s.totalMass} value={proUnit(proNum(result.totalMass, 2), s.unitG)} />
          <ToolAgainstLimit
            label={s.achievedConcentration}
            value={`${proNum(result.achievedConcentration, 3)}%`}
            limitLabel={s.concentrationLimit}
            limit={proParse(concentrationLimitText) === undefined ? undefined : `${proNum(proParse(concentrationLimitText) ?? 0, 3)}%`}
            ratioLabel={s.concentrationRatio}
            ratio={proRatio(result.concentrationRatio)}
          />
          {result.concentrationSpread !== undefined && (
            <ResultRow label={s.concentrationSpread} value={proNum(result.concentrationSpread, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: modeLabel(mode) },
              { label: s.c1, value: `${proNum(proParse(c1Text) ?? 0, 2)}%` },
              { label: s.targetConcentration, value: `${proNum(proParse(targetText) ?? 0, 2)}%` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* us-customary-kitchen-units                                                  */
/* -------------------------------------------------------------------------- */

const US_SOURCE_UNITS: readonly UsSourceUnit[] = [
  "usCupLegal",
  "usCupDeclared",
  "auNzCup",
  "usFlOz",
  "usTbsp",
  "usTsp",
  "usPint",
  "usQuart",
  "usGallon",
  "impFlOz",
  "impPint",
  "impQuart",
  "impGallon",
  "metricTbsp",
  "metricTsp",
  "ozAvoirdupois",
  "pound",
  "degF",
  "degC",
];

const US_TARGET_UNITS: readonly MetricTargetUnit[] = ["ml", "l", "g", "kg", "degC", "degF"];

function usSourceLabel(unit: UsSourceUnit, s: (typeof strings.pro.kuhinja)["us-customary-kitchen-units"]): string {
  const table: Record<UsSourceUnit, string> = {
    usCupLegal: s.usCupLegal,
    usCupDeclared: s.usCupDeclared,
    auNzCup: s.auNzCup,
    usFlOz: s.usFlOz,
    usTbsp: s.usTbsp,
    usTsp: s.usTsp,
    usPint: s.usPint,
    usQuart: s.usQuart,
    usGallon: s.usGallon,
    impFlOz: s.impFlOz,
    impPint: s.impPint,
    impQuart: s.impQuart,
    impGallon: s.impGallon,
    metricTbsp: s.metricTbsp,
    metricTsp: s.metricTsp,
    ozAvoirdupois: s.ozAvoirdupois,
    pound: s.pound,
    degF: s.degF,
    degC: s.degC,
  };
  return table[unit];
}

function usTargetLabel(unit: MetricTargetUnit, s: (typeof strings.pro.kuhinja)["us-customary-kitchen-units"]): string {
  return unit === "ml" ? s.targetMl : unit === "l" ? s.targetL : unit === "g" ? s.targetG : unit === "kg" ? s.targetKg : unit === "degC" ? s.degC : s.degF;
}

/**
 * One US customary or imperial kitchen unit into metric — refusing outright to
 * turn a volume into a mass, because that needs a density this tool never invents.
 */
export function UsCustomaryKitchenUnitsTool() {
  const s = strings.pro.kuhinja["us-customary-kitchen-units"];
  const [valueText, setValueText] = useState("");
  const [from, setFrom] = useState<UsSourceUnit>("usCupLegal");
  const [to, setTo] = useState<MetricTargetUnit>("ml");
  const [tablespoonMlText, setTablespoonMlText] = useState("15");
  const [teaspoonMlText, setTeaspoonMlText] = useState("5");

  const typed = proParse(valueText) !== undefined;
  const result = usCustomaryUnit({
    value: proParse(valueText) ?? Number.NaN,
    from,
    to,
    tablespoonMl: proParse(tablespoonMlText),
    teaspoonMl: proParse(teaspoonMlText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "from"
        ? s.errorFrom
        : field === "targetUnit"
          ? s.errorTargetUnit
          : field === "value"
            ? s.errorValue
            : field === "tablespoonMl"
              ? s.errorTablespoonMl
              : s.errorTeaspoonMl;

  const targetUnitText = to === "ml" ? s.unitMl : to === "l" ? s.unitL : to === "g" ? s.unitG : to === "kg" ? s.unitKg : "°C";

  const copyText = !result.ok
    ? ""
    : `${s.result}: ${result.dimension === "temperature" ? proUnit(proNum(result.value, 1), "°") : proUnit(proNum(result.value, to === "l" || to === "kg" ? 4 : 2), targetUnitText)}`;

  return (
    <>
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolSelect<UsSourceUnit>
        label={s.from}
        value={from}
        onChange={setFrom}
        options={US_SOURCE_UNITS.map((id) => ({ id, label: usSourceLabel(id, s) }))}
      />
      <ToolSelect<MetricTargetUnit>
        label={s.to}
        value={to}
        onChange={setTo}
        options={US_TARGET_UNITS.map((id) => ({ id, label: usTargetLabel(id, s) }))}
      />
      {from === "metricTbsp" && (
        <ToolInput label={s.tablespoonMl} hint={s.spoonHint} value={tablespoonMlText} onChange={setTablespoonMlText} />
      )}
      {from === "metricTsp" && (
        <ToolInput label={s.teaspoonMl} hint={s.spoonHint} value={teaspoonMlText} onChange={setTeaspoonMlText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.result}
            value={
              result.dimension === "temperature"
                ? proUnit(proNum(result.value, 1), "°C")
                : proUnit(proNum(result.value, to === "l" || to === "kg" ? 4 : 2), targetUnitText)
            }
          />
          <p className="tool__note">
            {result.factor === undefined
              ? s.relationTemperature
              : `${s.relationPrefix} 1 ${usSourceLabel(from, s)} = ${proNum(result.factor, 6)} ${result.dimension === "mass" ? s.unitG : s.unitMl}`}
          </p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.value, value: proNum(proParse(valueText) ?? 0, 4) },
              { label: s.from, value: usSourceLabel(from, s) },
              { label: s.to, value: usTargetLabel(to, s) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* yield-trim-cook                                                             */
/* -------------------------------------------------------------------------- */

/**
 * From as-purchased to portions on the plate, through trimming and cooking —
 * and back again. No yield table is embedded: every percentage is the
 * kitchen's own measurement.
 */
export function YieldTrimCookTool() {
  const s = strings.pro.kuhinja["yield-trim-cook"];
  const [mode, setMode] = useState<YieldMode>("forward");
  const [apMassText, setApMassText] = useState("");
  const [cleaningYieldText, setCleaningYieldText] = useState("");
  const [cookingYieldText, setCookingYieldText] = useState("");
  const [portionMassText, setPortionMassText] = useState("");
  const [portionsNeededText, setPortionsNeededText] = useState("");
  const [pricePerKgApText, setPricePerKgApText] = useState("");

  const typed = proParse(cleaningYieldText) !== undefined || proParse(cookingYieldText) !== undefined;
  const result = yieldTrimCook({
    mode,
    apMass: mode === "forward" ? proParse(apMassText) : undefined,
    cleaningYield: proParse(cleaningYieldText) ?? Number.NaN,
    cookingYield: proParse(cookingYieldText) ?? Number.NaN,
    portionMass: proParse(portionMassText) ?? Number.NaN,
    portionsNeeded: mode === "inverse" ? proParse(portionsNeededText) : undefined,
    pricePerKgAp: proParse(pricePerKgApText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "cleaningYield"
        ? s.errorCleaningYield
        : field === "cookingYield"
          ? s.errorCookingYield
          : field === "portionMass"
            ? s.errorPortionMass
            : field === "pricePerKgAp"
              ? s.errorPricePerKgAp
              : field === "apMass"
                ? s.errorApMass
                : s.errorPortionsNeeded;

  const copyText = !result.ok
    ? ""
    : [
        result.cleanedMass === undefined ? undefined : `${s.cleanedMass}: ${proUnit(proNum(result.cleanedMass, 2), s.unitG)}`,
        result.cookedMass === undefined ? undefined : `${s.cookedMass}: ${proUnit(proNum(result.cookedMass, 2), s.unitG)}`,
        `${s.combinedYield}: ${proNum(result.combinedYield, 2)}%`,
        `${s.combinedLossPercent}: ${proNum(result.combinedLossPercent, 2)}%`,
        result.portions === undefined ? undefined : `${s.portions}: ${proNum(result.portions, 0)}`,
        result.leftover === undefined ? undefined : `${s.leftover}: ${proUnit(proNum(result.leftover, 2), s.unitG)}`,
        result.apNeeded === undefined ? undefined : `${s.apNeeded}: ${proUnit(proNum(result.apNeeded, 3), s.unitKg)}`,
        result.pricePerKgCooked === undefined
          ? undefined
          : `${s.pricePerKgCooked}: ${proUnit(proNum(result.pricePerKgCooked, 2), s.unitCurrency)}`,
        result.pricePerPortion === undefined
          ? undefined
          : `${s.pricePerPortion}: ${proUnit(proNum(result.pricePerPortion, 2), s.unitCurrency)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<YieldMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "forward", label: s.modeForward },
          { id: "inverse", label: s.modeInverse },
        ]}
      />
      {mode === "forward" && <ToolInput label={s.apMass} value={apMassText} onChange={setApMassText} />}
      <ToolInput label={s.cleaningYield} hint={s.yieldHint} value={cleaningYieldText} onChange={setCleaningYieldText} />
      <ToolInput label={s.cookingYield} hint={s.cookingYieldHint} value={cookingYieldText} onChange={setCookingYieldText} />
      <ToolInput label={s.portionMass} value={portionMassText} onChange={setPortionMassText} />
      {mode === "inverse" && <ToolInput label={s.portionsNeeded} value={portionsNeededText} onChange={setPortionsNeededText} />}
      <ToolInput label={s.pricePerKgAp} value={pricePerKgApText} onChange={setPricePerKgApText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          {result.cleanedMass !== undefined && (
            <ResultRow label={s.cleanedMass} value={proUnit(proNum(result.cleanedMass, 2), s.unitG)} />
          )}
          {result.cookedMass !== undefined && (
            <ResultRow label={s.cookedMass} value={proUnit(proNum(result.cookedMass, 2), s.unitG)} />
          )}
          <ResultRow label={s.combinedYield} value={`${proNum(result.combinedYield, 2)}%`} />
          <ResultRow label={s.combinedLossPercent} value={`${proNum(result.combinedLossPercent, 2)}%`} />
          <p className="tool__note">{s.yieldLossPairNote}</p>
          {result.portions !== undefined && <ResultRow label={s.portions} value={proNum(result.portions, 0)} />}
          {result.leftover !== undefined && (
            <ResultRow label={s.leftover} value={proUnit(proNum(result.leftover, 2), s.unitG)} />
          )}
          {result.apNeeded !== undefined && (
            <ResultRow label={s.apNeeded} value={proUnit(proNum(result.apNeeded, 3), s.unitKg)} />
          )}
          {result.pricePerKgCooked !== undefined && (
            <ResultRow label={s.pricePerKgCooked} value={proUnit(proNum(result.pricePerKgCooked, 2), s.unitCurrency)} />
          )}
          {result.pricePerPortion !== undefined && (
            <ResultRow label={s.pricePerPortion} value={proUnit(proNum(result.pricePerPortion, 2), s.unitCurrency)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.cleaningYield, value: `${proNum(proParse(cleaningYieldText) ?? 0, 1)}%` },
              { label: s.cookingYield, value: `${proNum(proParse(cookingYieldText) ?? 0, 1)}%` },
              { label: s.portionMass, value: proUnit(proNum(proParse(portionMassText) ?? 0, 1), s.unitG) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * One entry per tool id, spelled exactly as the assignment spells it — a
 * missing or misspelled id makes the tool unreachable.
 */
export const KUHINJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "backwards-timeline": BackwardsTimelineTool,
  "bakers-percentage": BakersPercentageTool,
  "brine-salt": BrineSaltTool,
  "coffee-extraction": CoffeeExtractionTool,
  "dough-water-temp": DoughWaterTempTool,
  "ice-cream-overrun": IceCreamOverrunTool,
  "lamination-layers": LaminationLayersTool,
  "levain-hydration": LevainHydrationTool,
  "nutrition-per-portion": NutritionPerPortionTool,
  "pan-area-volume": PanAreaVolumeTool,
  "plate-cost": PlateCostTool,
  "portions-from-pack": PortionsFromPackTool,
  "ratio-split": RatioSplitTool,
  "recipe-scale": RecipeScaleTool,
  "solution-concentration": SolutionConcentrationTool,
  "us-customary-kitchen-units": UsCustomaryKitchenUnitsTool,
  "yield-trim-cook": YieldTrimCookTool,
};
