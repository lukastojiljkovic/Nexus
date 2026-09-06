import {
  fabricYardageRepeat,
  type FabricPieceRow,
  glassPaneWeight,
  type GlassComposition,
  iso286Fit,
  type Iso286ShaftLetter,
  linearCuttingStock,
  type CuttingStockItem,
  mitreAngles,
  mortarMixQuantity,
  type MortarInput,
  type ConsumptionUnit,
  panelCuttingYield,
  sheetMetalBend,
  sheetMetalKFactorFromSample,
  shelfDeflection,
  shelfSpacing,
  type ShelfSpacingMode,
  tapDrillSize,
  type PassHoleSeries,
  timberVolume,
  type TimberMode,
  wallpaperRolls,
  type WallpaperWall,
  type WallpaperMatching,
  weldConsumable,
  type WeldSeamType,
  woodMoistureMovement,
  type GrainDirection,
} from "@nexus/core/pro/zanat";
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
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Zanat" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/zanat.ts`'s. Nothing here divides, rounds
 * or compares; this file shapes fields, hands the numbers over, and reads the
 * answers onto the page — see `pro/gradnja.tsx` for the pattern this follows.
 *
 * **`glass-pane-weight` and `shelf-deflection` are `life-safety`.** Both print
 * a quantity — and, where the assignment makes a limit an input, the user's
 * own limit and the ratio against it — and never a verdict, a colour or a word
 * about what the ratio means. Every other tool here holds no regulated
 * constant either: where a trade rule sets a number (a coverage rate, a
 * packing factor, an engagement percentage), that number is an input with no
 * default, never a value this file assumes.
 */

/**
 * Fabric consumption for a cutting list, with seam allowance and both a
 * vertical and a horizontal pattern repeat, per `fabricYardageRepeat`.
 */
export function FabricYardageTool() {
  const s = strings.pro.zanat["fabric-yardage-repeat"];
  const [rowsText, setRowsText] = useState("");
  const [rollWidthText, setRollWidthText] = useState("");
  const [seamText, setSeamText] = useState("");
  const [verticalRepeatText, setVerticalRepeatText] = useState("");
  const [horizontalRepeatText, setHorizontalRepeatText] = useState("");
  const [wasteText, setWasteText] = useState("");
  const [grainMandatory, setGrainMandatory] = useState<"yes" | "no">("yes");

  const rawRows = proRows(rowsText);
  const typed = rawRows.length > 0;
  const rows: FabricPieceRow[] = rawRows.map((row) => ({
    width: proParse(row[0] ?? "") ?? Number.NaN,
    height: proParse(row[1] ?? "") ?? Number.NaN,
    count: proParse(row[2] ?? "") ?? Number.NaN,
  }));

  const result = fabricYardageRepeat({
    rows,
    rollWidth: proParse(rollWidthText) ?? Number.NaN,
    seamAllowance: proParse(seamText) ?? Number.NaN,
    verticalRepeat: proParse(verticalRepeatText) ?? Number.NaN,
    horizontalRepeat: proParse(horizontalRepeatText),
    waste: proParse(wasteText) ?? Number.NaN,
    grainMandatory: grainMandatory === "yes",
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "rows"
        ? s.errorRows
        : field === "rollWidth"
          ? s.errorRollWidth
          : field === "seamAllowance"
            ? s.errorSeamAllowance
            : field === "verticalRepeat"
              ? s.errorVerticalRepeat
              : field === "horizontalRepeat"
                ? s.errorHorizontalRepeat
                : field === "waste"
                  ? s.errorWaste
                  : field === "width"
                    ? s.errorWidth
                    : field === "height"
                      ? s.errorHeight
                      : field === "count"
                        ? s.errorCount
                        : s.errorAcrossRoll;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalLength}: ${proUnit(proNum(result.totalLength, 2), s.unitM)}`,
        `${s.orderLength}: ${proUnit(proNum(result.orderLength, 1), s.unitM)}`,
        `${s.usedArea}: ${proUnit(proNum(result.usedArea, 3), s.unitM2)}`,
        `${s.usefulArea}: ${proUnit(proNum(result.usefulArea, 3), s.unitM2)}`,
        `${s.wasteArea}: ${proUnit(proNum(result.wasteArea, 3), s.unitM2)}`,
        "",
        ...result.rows.map(
          (r, i) =>
            `${s.colPiece} ${i + 1}: ${proUnit(proNum(r.cutWidth, 1), s.unitCm)} × ${proUnit(proNum(r.cutHeight, 1), s.unitCm)}, ${s.colAcross} ${r.piecesAcrossRoll}, ${s.colRows} ${r.cutRows}, ${s.colUsage} ${proUnit(proNum(r.usage, 3), s.unitM)}`,
        ),
        "",
        `${s.rollWidth}: ${proUnit(proNum(proParse(rollWidthText) ?? 0, 1), s.unitCm)}`,
        `${s.seamAllowance}: ${proUnit(proNum(proParse(seamText) ?? 0, 2), s.unitCm)}`,
        `${s.verticalRepeat}: ${proUnit(proNum(proParse(verticalRepeatText) ?? 0, 1), s.unitCm)}`,
        `${s.horizontalRepeat}: ${proUnit(proNum(proParse(horizontalRepeatText) ?? 0, 1), s.unitCm)}`,
        `${s.waste}: ${proUnit(proNum(proParse(wasteText) ?? 0, 1), s.unitPercent)}`,
        `${s.grainMandatory}: ${grainMandatory === "yes" ? s.grainYes : s.grainNo}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.rows}
        hint={s.rowsHint}
        value={rowsText}
        onChange={setRowsText}
        placeholder={"50;50;12"}
      />
      <ToolInput
        label={s.rollWidth}
        hint={s.rollWidthHint}
        value={rollWidthText}
        onChange={setRollWidthText}
      />
      <ToolInput label={s.seamAllowance} value={seamText} onChange={setSeamText} />
      <ToolInput
        label={s.verticalRepeat}
        hint={s.verticalRepeatHint}
        value={verticalRepeatText}
        onChange={setVerticalRepeatText}
      />
      <ToolInput
        label={s.horizontalRepeat}
        hint={s.horizontalRepeatHint}
        value={horizontalRepeatText}
        onChange={setHorizontalRepeatText}
      />
      <ToolInput label={s.waste} value={wasteText} onChange={setWasteText} />
      <ToolSelect<"yes" | "no">
        label={s.grainMandatory}
        value={grainMandatory}
        onChange={setGrainMandatory}
        hint={s.grainHint}
        options={[
          { id: "yes", label: s.grainYes },
          { id: "no", label: s.grainNo },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[
              s.colPiece,
              s.colCut,
              s.colOrientation,
              s.colCentered,
              s.colAcross,
              s.colRows,
              s.colRowLength,
              s.colAlignment,
              s.colUsage,
              s.colPerPiece,
            ]}
            rows={result.rows.map((r, i) => [
              `${i + 1}`,
              `${proUnit(proNum(r.cutWidth, 1), s.unitCm)} × ${proUnit(proNum(r.cutHeight, 1), s.unitCm)}`,
              r.orientation === "normal" ? s.orientationNormal : s.orientationRotated,
              r.centeredDimension === "width"
                ? s.centeredWidth
                : r.centeredDimension === "height"
                  ? s.centeredHeight
                  : "—",
              `${r.piecesAcrossRoll}`,
              `${r.cutRows}`,
              proUnit(proNum(r.rowLength, 1), s.unitCm),
              proUnit(proNum(r.alignmentAllowance, 1), s.unitCm),
              proUnit(proNum(r.usage, 3), s.unitM),
              proUnit(proNum(r.usagePerPiece, 3), s.unitM),
            ])}
          />
          <ResultRow label={s.totalLength} value={proUnit(proNum(result.totalLength, 2), s.unitM)} />
          <ResultRow label={s.orderLength} value={proUnit(proNum(result.orderLength, 1), s.unitM)} />
          <ResultRow label={s.usedArea} value={proUnit(proNum(result.usedArea, 3), s.unitM2)} />
          <ResultRow label={s.usefulArea} value={proUnit(proNum(result.usefulArea, 3), s.unitM2)} />
          <ResultRow label={s.wasteArea} value={proUnit(proNum(result.wasteArea, 3), s.unitM2)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rollWidth, value: proUnit(proNum(proParse(rollWidthText) ?? 0, 1), s.unitCm) },
              { label: s.seamAllowance, value: proUnit(proNum(proParse(seamText) ?? 0, 2), s.unitCm) },
              {
                label: s.verticalRepeat,
                value: proUnit(proNum(proParse(verticalRepeatText) ?? 0, 1), s.unitCm),
              },
              {
                label: s.horizontalRepeat,
                value: proUnit(proNum(proParse(horizontalRepeatText) ?? 0, 1), s.unitCm),
              },
              { label: s.waste, value: proUnit(proNum(proParse(wasteText) ?? 0, 1), s.unitPercent) },
              { label: s.grainMandatory, value: grainMandatory === "yes" ? s.grainYes : s.grainNo },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Mass of a glass pane — monolithic, laminated or insulated — from its plies
 * alone, per `glassPaneWeight`.
 *
 * **`life-safety`: quantities only.** No handling class, no person count, no
 * equipment recommendation and no comparison to any limit — the assignment
 * gives this tool no limit to compare against, and it prints none.
 */
export function GlassPaneWeightTool() {
  const s = strings.pro.zanat["glass-pane-weight"];
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [composition, setComposition] = useState<GlassComposition>("monolithic");
  const [plyText, setPlyText] = useState("");
  const [pvbLayersText, setPvbLayersText] = useState("");
  const [pvbLayerThicknessText, setPvbLayerThicknessText] = useState("");
  const [piecesText, setPiecesText] = useState("1");
  const [densityText, setDensityText] = useState("");

  const plyLines = plyText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const plyThicknesses = plyLines.map((line) => proParse(line) ?? Number.NaN);
  const typed =
    proParse(widthText) !== undefined || proParse(heightText) !== undefined || plyLines.length > 0;

  const result = glassPaneWeight({
    width: proParse(widthText) ?? Number.NaN,
    height: proParse(heightText) ?? Number.NaN,
    composition,
    plyThicknesses,
    pvbLayers: proParse(pvbLayersText),
    pvbLayerThickness: proParse(pvbLayerThicknessText),
    pieces: proParse(piecesText),
    density: proParse(densityText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "width"
        ? s.errorWidth
        : field === "height"
          ? s.errorHeight
          : field === "density"
            ? s.errorDensity
            : field === "pieces"
              ? s.errorPieces
              : field === "plyThicknesses"
                ? s.errorPlyThicknesses
                : field === "pvbLayers"
                  ? s.errorPvbLayers
                  : s.errorPvbLayerThickness;

  const compositionLabel =
    composition === "monolithic"
      ? s.compositionMonolithic
      : composition === "laminated"
        ? s.compositionLaminated
        : s.compositionInsulated;

  const copyText = !result.ok
    ? ""
    : [
        `${s.area}: ${proUnit(proNum(result.area, 3), s.unitM2)}`,
        `${s.totalArea}: ${proUnit(proNum(result.totalArea, 3), s.unitM2)}`,
        `${s.massPerArea}: ${proUnit(proNum(result.massPerArea, 3), s.unitKgM2)}`,
        `${s.massPerPiece}: ${proUnit(proNum(result.massPerPiece, 2), s.unitKg)}`,
        `${s.totalMass}: ${proUnit(proNum(result.totalMass, 2), s.unitKg)}`,
        `${s.perimeter}: ${proUnit(proNum(result.perimeter, 2), s.unitM)}`,
        "",
        `${s.composition}: ${compositionLabel}`,
        `${s.width}: ${proUnit(proNum(proParse(widthText) ?? 0, 0), s.unitMm)}`,
        `${s.height}: ${proUnit(proNum(proParse(heightText) ?? 0, 0), s.unitMm)}`,
        `${s.pieces}: ${piecesText.trim()}`,
        `${s.densityUsed}: ${proUnit(proNum(result.densityUsed, 0), s.unitKgM3)}`,
        `${s.glassThicknessSum}: ${proUnit(proNum(result.glassThicknessSum, 1), s.unitMm)}`,
        `${s.pvbThicknessSum}: ${proUnit(proNum(result.pvbThicknessSum, 2), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.width} value={widthText} onChange={setWidthText} />
      <ToolInput label={s.height} value={heightText} onChange={setHeightText} />
      <ToolSelect<GlassComposition>
        label={s.composition}
        value={composition}
        onChange={setComposition}
        options={[
          { id: "monolithic", label: s.compositionMonolithic },
          { id: "laminated", label: s.compositionLaminated },
          { id: "insulated", label: s.compositionInsulated },
        ]}
      />
      <ToolTextArea
        label={s.plyThicknesses}
        hint={s.plyThicknessesHint}
        value={plyText}
        onChange={setPlyText}
        placeholder={"4\n4"}
      />
      {composition === "laminated" && (
        <>
          <ToolInput label={s.pvbLayers} value={pvbLayersText} onChange={setPvbLayersText} />
          <ToolInput
            label={s.pvbLayerThickness}
            hint={s.pvbLayerThicknessHint}
            value={pvbLayerThicknessText}
            onChange={setPvbLayerThicknessText}
          />
        </>
      )}
      <ToolInput label={s.pieces} value={piecesText} onChange={setPiecesText} />
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {/* life-safety: quantities only, per the module doc comment — no
              handling class, no verdict, no comparison to any limit. */}
          <ResultRow label={s.area} value={proUnit(proNum(result.area, 3), s.unitM2)} />
          <ResultRow label={s.totalArea} value={proUnit(proNum(result.totalArea, 3), s.unitM2)} />
          <ResultRow label={s.massPerArea} value={proUnit(proNum(result.massPerArea, 3), s.unitKgM2)} />
          <ResultRow label={s.massPerPiece} value={proUnit(proNum(result.massPerPiece, 2), s.unitKg)} />
          <ResultRow label={s.totalMass} value={proUnit(proNum(result.totalMass, 2), s.unitKg)} />
          <ResultRow label={s.perimeter} value={proUnit(proNum(result.perimeter, 2), s.unitM)} />
          <ResultRow label={s.densityUsed} value={proUnit(proNum(result.densityUsed, 0), s.unitKgM3)} />
          <ResultRow
            label={s.glassThicknessSum}
            value={proUnit(proNum(result.glassThicknessSum, 1), s.unitMm)}
          />
          <ResultRow label={s.pvbThicknessSum} value={proUnit(proNum(result.pvbThicknessSum, 2), s.unitMm)} />
          <p className="nx-hint nx-hint--prose">{s.temperingNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.composition, value: compositionLabel },
              { label: s.width, value: proUnit(proNum(proParse(widthText) ?? 0, 0), s.unitMm) },
              { label: s.height, value: proUnit(proNum(proParse(heightText) ?? 0, 0), s.unitMm) },
              { label: s.pieces, value: piecesText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Limit sizes and running clearance for an ISO 286 hole/shaft pair, per
 * `iso286Fit`. Either side may come from a standard grade/letter (the default
 * hole is H7 — `holeGrade` left empty lets the core function's own default
 * apply) or from the user's own upper/lower deviation, in µm.
 */
export function Iso286FitsTool() {
  const s = strings.pro.zanat["iso-286-fits"];
  const [nominalSizeText, setNominalSizeText] = useState("");
  const [holeMode, setHoleMode] = useState<"grade" | "manual">("grade");
  const [holeGradeText, setHoleGradeText] = useState("");
  const [holeUpperText, setHoleUpperText] = useState("");
  const [holeLowerText, setHoleLowerText] = useState("");
  const [shaftMode, setShaftMode] = useState<"letter" | "manual">("letter");
  const [shaftLetter, setShaftLetter] = useState<Iso286ShaftLetter>("g");
  const [shaftGradeText, setShaftGradeText] = useState("");
  const [shaftUpperText, setShaftUpperText] = useState("");
  const [shaftLowerText, setShaftLowerText] = useState("");

  const typed = proParse(nominalSizeText) !== undefined;

  const result = iso286Fit({
    nominalSize: proParse(nominalSizeText) ?? Number.NaN,
    holeGrade: holeMode === "grade" ? proParse(holeGradeText) : undefined,
    holeDeviations:
      holeMode === "manual"
        ? { upper: proParse(holeUpperText) ?? Number.NaN, lower: proParse(holeLowerText) ?? Number.NaN }
        : undefined,
    shaftLetter: shaftMode === "letter" ? shaftLetter : undefined,
    shaftGrade: shaftMode === "letter" ? proParse(shaftGradeText) : undefined,
    shaftDeviations:
      shaftMode === "manual"
        ? {
            upper: proParse(shaftUpperText) ?? Number.NaN,
            lower: proParse(shaftLowerText) ?? Number.NaN,
          }
        : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "nominalSize"
        ? s.errorNominalSize
        : field === "holeGrade"
          ? s.errorHoleGrade
          : field === "holeDeviations"
            ? s.errorHoleDeviations
            : field === "shaftLetter"
              ? s.errorShaftLetter
              : field === "shaftGrade"
                ? s.errorShaftGrade
                : s.errorShaftDeviations;

  const copyText = !result.ok
    ? ""
    : [
        result.fitDesignation === undefined ? undefined : `${s.fitDesignation}: ${result.fitDesignation}`,
        `${s.holeMax}: ${proUnit(proNum(result.hole.maxSize, 3), s.unitMm)}`,
        `${s.holeMin}: ${proUnit(proNum(result.hole.minSize, 3), s.unitMm)}`,
        `${s.shaftMax}: ${proUnit(proNum(result.shaft.maxSize, 3), s.unitMm)}`,
        `${s.shaftMin}: ${proUnit(proNum(result.shaft.minSize, 3), s.unitMm)}`,
        `${s.maxClearance}: ${proUnit(proNum(result.maxClearance, 1), s.unitUm)}`,
        `${s.minClearance}: ${proUnit(proNum(result.minClearance, 1), s.unitUm)}`,
        `${s.meanClearance}: ${proUnit(proNum(result.meanClearance, 1), s.unitUm)}`,
        "",
        `${s.nominalSize}: ${proUnit(proNum(proParse(nominalSizeText) ?? 0, 3), s.unitMm)}`,
        `${s.range}: ${proNum(result.rangeLow, 0)}–${proNum(result.rangeHigh, 0)} ${s.unitMm}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput
        label={s.nominalSize}
        hint={s.nominalSizeHint}
        value={nominalSizeText}
        onChange={setNominalSizeText}
      />
      <ToolSelect<"grade" | "manual">
        label={s.holeMode}
        value={holeMode}
        onChange={setHoleMode}
        options={[
          { id: "grade", label: s.holeModeGrade },
          { id: "manual", label: s.holeModeManual },
        ]}
      />
      {holeMode === "grade" ? (
        <ToolInput
          label={s.holeGrade}
          hint={s.holeGradeHint}
          value={holeGradeText}
          onChange={setHoleGradeText}
        />
      ) : (
        <>
          <ToolInput label={s.holeUpper} value={holeUpperText} onChange={setHoleUpperText} />
          <ToolInput label={s.holeLower} value={holeLowerText} onChange={setHoleLowerText} />
        </>
      )}
      <ToolSelect<"letter" | "manual">
        label={s.shaftMode}
        value={shaftMode}
        onChange={setShaftMode}
        options={[
          { id: "letter", label: s.shaftModeLetter },
          { id: "manual", label: s.shaftModeManual },
        ]}
      />
      {shaftMode === "letter" ? (
        <>
          <ToolSelect<Iso286ShaftLetter>
            label={s.shaftLetter}
            value={shaftLetter}
            onChange={setShaftLetter}
            options={[
              { id: "d", label: "d" },
              { id: "e", label: "e" },
              { id: "f", label: "f" },
              { id: "g", label: "g" },
              { id: "h", label: "h" },
            ]}
          />
          <ToolInput label={s.shaftGrade} value={shaftGradeText} onChange={setShaftGradeText} />
        </>
      ) : (
        <>
          <ToolInput label={s.shaftUpper} value={shaftUpperText} onChange={setShaftUpperText} />
          <ToolInput label={s.shaftLower} value={shaftLowerText} onChange={setShaftLowerText} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.fitDesignation !== undefined && (
            <ResultRow label={s.fitDesignation} value={result.fitDesignation} />
          )}
          <ResultRow
            label={s.range}
            value={`${proNum(result.rangeLow, 0)}–${proNum(result.rangeHigh, 0)} ${s.unitMm}`}
          />
          <ToolTable
            head={[s.colPart, s.colUpper, s.colLower, s.colMax, s.colMin, s.colWidth, s.colMean]}
            rows={[
              [
                s.hole,
                proUnit(proNum(result.hole.upperDeviation, 1), s.unitUm),
                proUnit(proNum(result.hole.lowerDeviation, 1), s.unitUm),
                proUnit(proNum(result.hole.maxSize, 3), s.unitMm),
                proUnit(proNum(result.hole.minSize, 3), s.unitMm),
                proUnit(proNum(result.hole.toleranceWidth, 1), s.unitUm),
                proUnit(proNum(result.hole.meanSize, 3), s.unitMm),
              ],
              [
                s.shaft,
                proUnit(proNum(result.shaft.upperDeviation, 1), s.unitUm),
                proUnit(proNum(result.shaft.lowerDeviation, 1), s.unitUm),
                proUnit(proNum(result.shaft.maxSize, 3), s.unitMm),
                proUnit(proNum(result.shaft.minSize, 3), s.unitMm),
                proUnit(proNum(result.shaft.toleranceWidth, 1), s.unitUm),
                proUnit(proNum(result.shaft.meanSize, 3), s.unitMm),
              ],
            ]}
          />
          <ResultRow label={s.maxClearance} value={proUnit(proNum(result.maxClearance, 1), s.unitUm)} />
          <ResultRow label={s.minClearance} value={proUnit(proNum(result.minClearance, 1), s.unitUm)} />
          <ResultRow label={s.meanClearance} value={proUnit(proNum(result.meanClearance, 1), s.unitUm)} />
          <p className="nx-hint nx-hint--prose">{s.signedNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.nominalSize, value: proUnit(proNum(proParse(nominalSizeText) ?? 0, 3), s.unitMm) },
              { label: s.holeMode, value: holeMode === "grade" ? s.holeModeGrade : s.holeModeManual },
              { label: s.shaftMode, value: shaftMode === "letter" ? s.shaftModeLetter : s.shaftModeManual },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * First-fit-decreasing bar cutting plan, per `linearCuttingStock`. The
 * conservative charge (a cut is billed to the piece that needed it, even one
 * landing flush with the bar's end) and the whole-tenths-of-a-millimetre
 * arithmetic both live in the core function; this file only shapes the list.
 */
export function LinearCuttingStockTool() {
  const s = strings.pro.zanat["linear-cutting-stock"];
  const [itemsText, setItemsText] = useState("");
  const [barLengthText, setBarLengthText] = useState("");
  const [kerfText, setKerfText] = useState("");
  const [startWasteText, setStartWasteText] = useState("");
  const [endWasteText, setEndWasteText] = useState("");
  const [minUsableRemnantText, setMinUsableRemnantText] = useState("");

  const rawItems = proRows(itemsText);
  const typed = rawItems.length > 0;
  const items: CuttingStockItem[] = rawItems.map((row) => ({
    length: proParse(row[0] ?? "") ?? Number.NaN,
    count: proParse(row[1] ?? "") ?? Number.NaN,
  }));

  const result = linearCuttingStock({
    items,
    barLength: proParse(barLengthText) ?? Number.NaN,
    kerf: proParse(kerfText) ?? Number.NaN,
    startWaste: proParse(startWasteText),
    endWaste: proParse(endWasteText),
    minUsableRemnant: proParse(minUsableRemnantText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "items"
        ? s.errorItems
        : field === "barLength"
          ? s.errorBarLength
          : field === "kerf"
            ? s.errorKerf
            : field === "startWaste"
              ? s.errorStartWaste
              : field === "endWaste"
                ? s.errorEndWaste
                : field === "minUsableRemnant"
                  ? s.errorMinUsableRemnant
                  : field === "usableLength"
                    ? s.errorUsableLength
                    : field === "length"
                      ? s.errorLength
                      : s.errorCount;

  const copyText = !result.ok
    ? ""
    : [
        `${s.barCount}: ${result.barCount}`,
        `${s.lowerBoundBars}: ${result.lowerBoundBars}`,
        `${s.totalCutLength}: ${proUnit(proNum(result.totalCutLength, 1), s.unitMm)}`,
        `${s.totalPurchasedLength}: ${proUnit(proNum(result.totalPurchasedLength, 1), s.unitMm)}`,
        `${s.cutCount}: ${result.cutCount}`,
        `${s.kerfLength}: ${proUnit(proNum(result.kerfLength, 1), s.unitMm)}`,
        `${s.wasteIncludingUsable}: ${proUnit(proNum(result.wasteIncludingUsable, 1), s.unitMm)} (${proNum(result.wasteIncludingUsablePercent, 2)} %)`,
        `${s.wasteExcludingUsable}: ${proUnit(proNum(result.wasteExcludingUsable, 1), s.unitMm)} (${proNum(result.wasteExcludingUsablePercent, 2)} %)`,
        `${s.usableRemnantLength}: ${proUnit(proNum(result.usableRemnantLength, 1), s.unitMm)}`,
        "",
        ...result.bars.map(
          (bar, i) =>
            `${s.colBar} ${i + 1}: ${bar.pieces.map((p) => proNum(p.length, 1)).join(", ")} ${s.unitMm} — ${s.colUsed} ${proUnit(proNum(bar.usedLength, 1), s.unitMm)}, ${s.colRemainder} ${proUnit(proNum(bar.remainder, 1), s.unitMm)}`,
        ),
        "",
        `${s.barLength}: ${proUnit(proNum(proParse(barLengthText) ?? 0, 1), s.unitMm)}`,
        `${s.kerf}: ${proUnit(proNum(proParse(kerfText) ?? 0, 1), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.items}
        hint={s.itemsHint}
        value={itemsText}
        onChange={setItemsText}
        placeholder={"1800;4"}
      />
      <ToolInput label={s.barLength} value={barLengthText} onChange={setBarLengthText} />
      <ToolInput label={s.kerf} hint={s.kerfHint} value={kerfText} onChange={setKerfText} />
      <ToolInput label={s.startWaste} value={startWasteText} onChange={setStartWasteText} />
      <ToolInput label={s.endWaste} value={endWasteText} onChange={setEndWasteText} />
      <ToolInput
        label={s.minUsableRemnant}
        hint={s.minUsableRemnantHint}
        value={minUsableRemnantText}
        onChange={setMinUsableRemnantText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colBar, s.colPieces, s.colUsed, s.colRemainder, s.colUsable]}
            rows={result.bars.map((bar, i) => [
              `${i + 1}`,
              bar.pieces
                .map((p) => `${proNum(p.length, 1)} (${proNum(p.start, 1)}–${proNum(p.end, 1)})`)
                .join(", "),
              proUnit(proNum(bar.usedLength, 1), s.unitMm),
              proUnit(proNum(bar.remainder, 1), s.unitMm),
              bar.remainderUsable ? s.usableYes : s.usableNo,
            ])}
            prose={[1]}
          />
          <ResultRow label={s.barCount} value={result.barCount} />
          <ResultRow label={s.lowerBoundBars} value={result.lowerBoundBars} />
          <p className="nx-hint nx-hint--prose">{s.lowerBoundNote}</p>
          <ResultRow label={s.usableLength} value={proUnit(proNum(result.usableLength, 1), s.unitMm)} />
          <ResultRow label={s.totalCutLength} value={proUnit(proNum(result.totalCutLength, 1), s.unitMm)} />
          <ResultRow
            label={s.totalPurchasedLength}
            value={proUnit(proNum(result.totalPurchasedLength, 1), s.unitMm)}
          />
          <ResultRow label={s.cutCount} value={result.cutCount} />
          <ResultRow label={s.kerfLength} value={proUnit(proNum(result.kerfLength, 1), s.unitMm)} />
          <ResultRow
            label={s.wasteIncludingUsable}
            value={proUnit(proNum(result.wasteIncludingUsable, 1), s.unitMm)}
          />
          <ResultRow
            label={s.wasteIncludingUsablePercent}
            value={`${proNum(result.wasteIncludingUsablePercent, 2)} %`}
          />
          <ResultRow
            label={s.wasteExcludingUsable}
            value={proUnit(proNum(result.wasteExcludingUsable, 1), s.unitMm)}
          />
          <ResultRow
            label={s.wasteExcludingUsablePercent}
            value={`${proNum(result.wasteExcludingUsablePercent, 2)} %`}
          />
          <ResultRow
            label={s.usableRemnantLength}
            value={proUnit(proNum(result.usableRemnantLength, 1), s.unitMm)}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.barLength, value: proUnit(proNum(proParse(barLengthText) ?? 0, 1), s.unitMm) },
              { label: s.kerf, value: proUnit(proNum(proParse(kerfText) ?? 0, 1), s.unitMm) },
              {
                label: s.startWaste,
                value: proUnit(proNum(proParse(startWasteText) ?? 0, 1), s.unitMm),
              },
              { label: s.endWaste, value: proUnit(proNum(proParse(endWasteText) ?? 0, 1), s.unitMm) },
              // Four of the figures above are decided by this threshold —
              // „ostatak upotrebljiv", both „bez upotrebljivog" wastes and the
              // usable-remnant total — and it was the one input the echo left
              // out, so a reader could not tell which run they were looking at.
              {
                label: s.minUsableRemnant,
                value: proUnit(proNum(proParse(minUsableRemnantText) ?? 0, 1), s.unitMm),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** How the frame's angle is given, and how a leaning side is given, per `mitreAngles`. */
type MitreAngleMode = "sides" | "baseAngle";
type MitreSlopeMode = "slope" | "spring";

/**
 * Mitre and, for a leaning side, compound-bevel saw settings, per
 * `mitreAngles`. Past m0 = 85° the length figures are still printed — never
 * withheld — but flagged with a caution, exactly as the core function's own
 * doc explains.
 */
export function MitreAnglesTool() {
  const s = strings.pro.zanat["mitre-angles"];
  const [angleMode, setAngleMode] = useState<MitreAngleMode>("sides");
  const [sidesText, setSidesText] = useState("");
  const [baseAngleText, setBaseAngleText] = useState("");
  const [slopeMode, setSlopeMode] = useState<MitreSlopeMode>("slope");
  const [slopeText, setSlopeText] = useState("");
  const [springAngleText, setSpringAngleText] = useState("");
  const [pieceWidthText, setPieceWidthText] = useState("");
  const [insideLengthText, setInsideLengthText] = useState("");

  const typed =
    angleMode === "sides" ? proParse(sidesText) !== undefined : proParse(baseAngleText) !== undefined;

  const result = mitreAngles({
    sides: angleMode === "sides" ? proParse(sidesText) : undefined,
    baseAngle: angleMode === "baseAngle" ? proParse(baseAngleText) : undefined,
    slope: slopeMode === "slope" ? proParse(slopeText) : undefined,
    springAngle: slopeMode === "spring" ? proParse(springAngleText) : undefined,
    pieceWidth: proParse(pieceWidthText),
    insideLength: proParse(insideLengthText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "sides"
        ? s.errorSides
        : field === "baseAngle"
          ? s.errorBaseAngle
          : field === "slope"
            ? s.errorSlope
            : field === "springAngle"
              ? s.errorSpringAngle
              : field === "pieceWidth"
                ? s.errorPieceWidth
                : s.errorInsideLength;

  const copyText = !result.ok
    ? ""
    : [
        `${s.baseAngle}: ${proNum(result.baseAngle, 2)}${s.unitDeg}`,
        `${s.sawMitreAngle}: ${proNum(result.sawMitreAngle, 2)}${s.unitDeg}`,
        `${s.sawMitreComplement}: ${proNum(result.sawMitreComplement, 2)}${s.unitDeg}`,
        `${s.sawBevelAngle}: ${proNum(result.sawBevelAngle, 2)}${s.unitDeg}`,
        result.lengths === undefined
          ? undefined
          : `${s.lengthToLongPoint}: ${proUnit(proNum(result.lengths.toLongPoint, 2), s.unitMm)}`,
        // The short point used to be on the screen and not in the copied text,
        // so a pasted cut list was missing one of the two figures a carpenter
        // takes to the saw.
        result.lengths === undefined
          ? undefined
          : `${s.lengthToShortPoint}: ${proUnit(proNum(result.lengths.toShortPoint, 2), s.unitMm)}`,
        "",
        `${s.angleMode}: ${angleMode === "sides" ? s.angleModeSides : s.angleModeBaseAngle}`,
        `${s.slopeMode}: ${slopeMode === "slope" ? s.slopeModeSlope : s.slopeModeSpring}`,
        `${s.slopeUsed}: ${proNum(result.slopeUsed, 2)}${s.unitDeg}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<MitreAngleMode>
        label={s.angleMode}
        value={angleMode}
        onChange={setAngleMode}
        options={[
          { id: "sides", label: s.angleModeSides },
          { id: "baseAngle", label: s.angleModeBaseAngle },
        ]}
      />
      {angleMode === "sides" ? (
        <ToolInput label={s.sides} value={sidesText} onChange={setSidesText} />
      ) : (
        <ToolInput label={s.baseAngleField} value={baseAngleText} onChange={setBaseAngleText} />
      )}
      <ToolSelect<MitreSlopeMode>
        label={s.slopeMode}
        value={slopeMode}
        onChange={setSlopeMode}
        options={[
          { id: "slope", label: s.slopeModeSlope },
          { id: "spring", label: s.slopeModeSpring },
        ]}
      />
      {slopeMode === "slope" ? (
        <ToolInput label={s.slope} hint={s.slopeHint} value={slopeText} onChange={setSlopeText} />
      ) : (
        <ToolInput
          label={s.springAngle}
          hint={s.springAngleHint}
          value={springAngleText}
          onChange={setSpringAngleText}
        />
      )}
      <ToolInput
        label={s.pieceWidth}
        hint={s.pieceWidthHint}
        value={pieceWidthText}
        onChange={setPieceWidthText}
      />
      <ToolInput label={s.insideLength} value={insideLengthText} onChange={setInsideLengthText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.baseAngle} value={`${proNum(result.baseAngle, 2)}${s.unitDeg}`} />
          <ResultRow label={s.m0} value={`${proNum(result.m0, 2)}${s.unitDeg}`} />
          <ResultRow label={s.simpleMitre} value={`${proNum(result.simpleMitre, 2)}${s.unitDeg}`} />
          <ResultRow label={s.sawMitreAngle} value={`${proNum(result.sawMitreAngle, 2)}${s.unitDeg}`} />
          <ResultRow
            label={s.sawMitreComplement}
            value={`${proNum(result.sawMitreComplement, 2)}${s.unitDeg}`}
          />
          <ResultRow label={s.sawBevelAngle} value={`${proNum(result.sawBevelAngle, 2)}${s.unitDeg}`} />
          <p className="nx-hint nx-hint--prose">{s.scaleConventionNote}</p>
          {result.lengths !== undefined && (
            <>
              {/* Two rows, not three. „Spoljašnja mera" and „mera do duge
                  tačke" were the same number under two labels, which reads as
                  two measurements that happen to agree. */}
              <ResultRow
                label={s.lengthToLongPoint}
                value={proUnit(proNum(result.lengths.toLongPoint, 2), s.unitMm)}
              />
              <ResultRow
                label={s.lengthToShortPoint}
                value={proUnit(proNum(result.lengths.toShortPoint, 2), s.unitMm)}
              />
              <p className="nx-hint nx-hint--prose">{`${s.centeredMeasureNote} ${s.centeredOutsideWidth}`}</p>
              {!result.lengthsAvailable && <p className="nx-hint nx-hint--prose">{s.lengthsCautionNote}</p>}
            </>
          )}
          <ResultRow label={s.tanM0} value={proNum(result.tanM0, 6)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.angleMode,
                value: angleMode === "sides" ? s.angleModeSides : s.angleModeBaseAngle,
              },
              { label: s.slopeMode, value: slopeMode === "slope" ? s.slopeModeSlope : s.slopeModeSpring },
              { label: s.slopeUsed, value: `${proNum(result.slopeUsed, 2)}${s.unitDeg}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Whether the on-site batch is given by area+thickness or by a volume directly, per `mortarMixQuantity`. */
type MortarOnsiteVolumeMode = "area" | "volume";

/**
 * Mortar or adhesive quantity, per `mortarMixQuantity` — a bagged premix by
 * coverage rate, or an on-site mix by a binder:aggregate ratio the user
 * chooses. The two modes take different fields, so the form switches on
 * `mode` rather than showing both kinds of field at once.
 */
export function MortarMixQuantityTool() {
  const s = strings.pro.zanat["mortar-mix-quantity"];
  const [mode, setMode] = useState<"premixed" | "onsite">("premixed");

  const [areaText, setAreaText] = useState("");
  const [thicknessText, setThicknessText] = useState("");
  const [wasteText, setWasteText] = useState("");
  const [consumptionText, setConsumptionText] = useState("");
  const [consumptionUnit, setConsumptionUnit] = useState<ConsumptionUnit>("perM2mm");
  const [bagMassText, setBagMassText] = useState("");
  const [waterPerKgText, setWaterPerKgText] = useState("");

  const [onsiteVolumeMode, setOnsiteVolumeMode] = useState<MortarOnsiteVolumeMode>("area");
  const [onsiteAreaText, setOnsiteAreaText] = useState("");
  const [onsiteThicknessText, setOnsiteThicknessText] = useState("");
  const [onsiteVolumeText, setOnsiteVolumeText] = useState("");
  const [onsiteWasteText, setOnsiteWasteText] = useState("");
  const [packingFactorText, setPackingFactorText] = useState("");
  const [ratioText, setRatioText] = useState("");
  const [binderDensityText, setBinderDensityText] = useState("");
  const [aggregateDensityText, setAggregateDensityText] = useState("");
  const [waterCementRatioText, setWaterCementRatioText] = useState("");
  const [onsiteBagMassText, setOnsiteBagMassText] = useState("");
  const [aggregateMoistureText, setAggregateMoistureText] = useState("");
  const [mixerVolumeText, setMixerVolumeText] = useState("");

  const typed =
    mode === "premixed"
      ? proParse(areaText) !== undefined || proParse(consumptionText) !== undefined
      : proParse(ratioText) !== undefined ||
        (onsiteVolumeMode === "area" ? proParse(onsiteAreaText) : proParse(onsiteVolumeText)) !== undefined;

  const input: MortarInput =
    mode === "premixed"
      ? {
          mode: "premixed",
          area: proParse(areaText) ?? Number.NaN,
          thickness: proParse(thicknessText) ?? Number.NaN,
          waste: proParse(wasteText) ?? Number.NaN,
          consumption: proParse(consumptionText) ?? Number.NaN,
          consumptionUnit,
          bagMass: proParse(bagMassText) ?? Number.NaN,
          waterPerKg: proParse(waterPerKgText) ?? Number.NaN,
        }
      : {
          mode: "onsite",
          area: onsiteVolumeMode === "area" ? proParse(onsiteAreaText) : undefined,
          volume: onsiteVolumeMode === "volume" ? proParse(onsiteVolumeText) : undefined,
          thickness: onsiteVolumeMode === "area" ? proParse(onsiteThicknessText) : undefined,
          waste: proParse(onsiteWasteText) ?? Number.NaN,
          packingFactor: proParse(packingFactorText) ?? Number.NaN,
          ratio: proParse(ratioText) ?? Number.NaN,
          binderDensity: proParse(binderDensityText) ?? Number.NaN,
          aggregateDensity: proParse(aggregateDensityText) ?? Number.NaN,
          waterCementRatio: proParse(waterCementRatioText) ?? Number.NaN,
          bagMass: proParse(onsiteBagMassText) ?? Number.NaN,
          aggregateMoisture: proParse(aggregateMoistureText),
          mixerVolume: proParse(mixerVolumeText),
        };

  const result = mortarMixQuantity(input);
  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "waste"
        ? s.errorWaste
        : field === "volume"
          ? s.errorVolume
          : field === "area"
            ? s.errorArea
            : field === "thickness"
              ? s.errorThickness
              : field === "consumption"
                ? s.errorConsumption
                : field === "bagMass"
                  ? s.errorBagMass
                  : field === "waterPerKg"
                    ? s.errorWaterPerKg
                    : field === "packingFactor"
                      ? s.errorPackingFactor
                      : field === "ratio"
                        ? s.errorRatio
                        : field === "binderDensity"
                          ? s.errorBinderDensity
                          : field === "aggregateDensity"
                            ? s.errorAggregateDensity
                            : field === "waterCementRatio"
                              ? s.errorWaterCementRatio
                              : field === "aggregateMoisture"
                                ? s.errorAggregateMoisture
                                : s.errorMixerVolume;

  const copyText = !result.ok
    ? ""
    : result.mode === "premixed"
      ? [
          `${s.freshVolume}: ${proUnit(proNum(result.freshVolume, 4), s.unitM3)}`,
          `${s.mass}: ${proUnit(proNum(result.mass, 2), s.unitKg)}`,
          `${s.bags}: ${result.bags}`,
          `${s.bagSurplus}: ${proUnit(proNum(result.bagSurplus, 2), s.unitKg)}`,
          `${s.water}: ${proUnit(proNum(result.water, 2), s.unitL)}`,
          "",
          `${s.mode}: ${s.modePremixed}`,
          `${s.consumptionUnitUsed}: ${proNum(result.consumptionUsed, 3)} ${s.unitKgM2mm}`,
        ].join("\n")
      : [
          `${s.freshVolume}: ${proUnit(proNum(result.freshVolume, 4), s.unitM3)}`,
          `${s.compactedVolume}: ${proUnit(proNum(result.compactedVolume, 4), s.unitM3)}`,
          `${s.binderMass}: ${proUnit(proNum(result.binderMass, 2), s.unitKg)}`,
          `${s.aggregateMass}: ${proUnit(proNum(result.aggregateMass, 2), s.unitKg)}`,
          `${s.binderBags}: ${result.binderBags}`,
          `${s.binderBagSurplus}: ${proUnit(proNum(result.binderBagSurplus, 2), s.unitKg)}`,
          `${s.water}: ${proUnit(proNum(result.water, 2), s.unitL)}`,
          // The whole per-batch recipe, not just how many batches there are.
          // The screen showed four figures here and the clipboard carried one,
          // so a pasted mix sheet said „4 šarže" and nothing about what goes
          // into one.
          ...(result.batch === undefined
            ? []
            : [
                `${s.batches}: ${result.batch.count}`,
                `${s.batchBinderMass}: ${proUnit(proNum(result.batch.binderMass, 2), s.unitKg)}`,
                `${s.batchAggregateMass}: ${proUnit(proNum(result.batch.aggregateMass, 2), s.unitKg)}`,
                `${s.batchAggregateVolume}: ${proUnit(proNum(result.batch.aggregateVolume, 4), s.unitM3)}`,
                `${s.batchWater}: ${proUnit(proNum(result.batch.water, 2), s.unitL)}`,
              ]),
          "",
          `${s.mode}: ${s.modeOnsite}`,
          `${s.ratio}: 1:${ratioText.trim()}`,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

  return (
    <>
      <ToolSelect<"premixed" | "onsite">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "premixed", label: s.modePremixed },
          { id: "onsite", label: s.modeOnsite },
        ]}
      />
      {mode === "premixed" ? (
        <>
          <ToolInput label={s.area} value={areaText} onChange={setAreaText} />
          <ToolInput label={s.thickness} value={thicknessText} onChange={setThicknessText} />
          <ToolInput label={s.waste} value={wasteText} onChange={setWasteText} />
          <ToolSelect<ConsumptionUnit>
            label={s.consumptionUnit}
            value={consumptionUnit}
            onChange={setConsumptionUnit}
            options={[
              { id: "perM2mm", label: s.consumptionUnitPerM2mm },
              { id: "perM3", label: s.consumptionUnitPerM3 },
            ]}
          />
          <ToolInput
            label={s.consumption}
            hint={s.consumptionHint}
            value={consumptionText}
            onChange={setConsumptionText}
          />
          <ToolInput label={s.bagMass} value={bagMassText} onChange={setBagMassText} />
          <ToolInput
            label={s.waterPerKg}
            hint={s.waterPerKgHint}
            value={waterPerKgText}
            onChange={setWaterPerKgText}
          />
        </>
      ) : (
        <>
          <ToolSelect<MortarOnsiteVolumeMode>
            label={s.onsiteVolumeMode}
            value={onsiteVolumeMode}
            onChange={setOnsiteVolumeMode}
            options={[
              { id: "area", label: s.onsiteVolumeModeArea },
              { id: "volume", label: s.onsiteVolumeModeVolume },
            ]}
          />
          {onsiteVolumeMode === "area" ? (
            <>
              <ToolInput label={s.area} value={onsiteAreaText} onChange={setOnsiteAreaText} />
              <ToolInput label={s.thickness} value={onsiteThicknessText} onChange={setOnsiteThicknessText} />
            </>
          ) : (
            <ToolInput label={s.volume} value={onsiteVolumeText} onChange={setOnsiteVolumeText} />
          )}
          <ToolInput label={s.waste} value={onsiteWasteText} onChange={setOnsiteWasteText} />
          <ToolInput
            label={s.packingFactor}
            hint={s.packingFactorHint}
            value={packingFactorText}
            onChange={setPackingFactorText}
          />
          <ToolInput label={s.ratio} hint={s.ratioHint} value={ratioText} onChange={setRatioText} />
          <ToolInput label={s.binderDensity} value={binderDensityText} onChange={setBinderDensityText} />
          <ToolInput
            label={s.aggregateDensity}
            value={aggregateDensityText}
            onChange={setAggregateDensityText}
          />
          <ToolInput
            label={s.waterCementRatio}
            value={waterCementRatioText}
            onChange={setWaterCementRatioText}
          />
          <ToolInput label={s.bagMass} value={onsiteBagMassText} onChange={setOnsiteBagMassText} />
          <ToolInput
            label={s.aggregateMoisture}
            hint={s.aggregateMoistureHint}
            value={aggregateMoistureText}
            onChange={setAggregateMoistureText}
          />
          <ToolInput
            label={s.mixerVolume}
            hint={s.mixerVolumeHint}
            value={mixerVolumeText}
            onChange={setMixerVolumeText}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && result.mode === "premixed" && (
        <ToolSection title={s.results}>
          <ResultRow label={s.freshVolume} value={proUnit(proNum(result.freshVolume, 4), s.unitM3)} />
          <ResultRow
            label={s.consumptionUnitUsed}
            value={`${proNum(result.consumptionUsed, 3)} ${s.unitKgM2mm}`}
          />
          <ResultRow label={s.mass} value={proUnit(proNum(result.mass, 2), s.unitKg)} />
          <ResultRow label={s.bags} value={result.bags} />
          <ResultRow label={s.bagSurplus} value={proUnit(proNum(result.bagSurplus, 2), s.unitKg)} />
          <ResultRow label={s.water} value={proUnit(proNum(result.water, 2), s.unitL)} />
          <ToolFormula>{s.formulaPremixed}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.area, value: proUnit(proNum(proParse(areaText) ?? 0, 2), s.unitM2) },
              { label: s.thickness, value: proUnit(proNum(proParse(thicknessText) ?? 0, 1), s.unitMm) },
              { label: s.waste, value: `${proNum(proParse(wasteText) ?? 0, 1)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {result.ok && result.mode === "onsite" && (
        <ToolSection title={s.results}>
          <ResultRow label={s.freshVolume} value={proUnit(proNum(result.freshVolume, 4), s.unitM3)} />
          <ResultRow label={s.compactedVolume} value={proUnit(proNum(result.compactedVolume, 4), s.unitM3)} />
          <ResultRow label={s.binderVolume} value={proUnit(proNum(result.binderVolume, 4), s.unitM3)} />
          <ResultRow label={s.aggregateVolume} value={proUnit(proNum(result.aggregateVolume, 4), s.unitM3)} />
          <ResultRow label={s.binderMass} value={proUnit(proNum(result.binderMass, 2), s.unitKg)} />
          <ResultRow label={s.aggregateMass} value={proUnit(proNum(result.aggregateMass, 2), s.unitKg)} />
          <ResultRow label={s.binderBags} value={result.binderBags} />
          <ResultRow
            label={s.binderBagSurplus}
            value={proUnit(proNum(result.binderBagSurplus, 2), s.unitKg)}
          />
          <ResultRow label={s.waterTheoretical} value={proUnit(proNum(result.waterTheoretical, 2), s.unitL)} />
          {result.aggregateMoistureWater !== undefined && (
            <ResultRow
              label={s.aggregateMoistureWater}
              value={proUnit(proNum(result.aggregateMoistureWater, 2), s.unitL)}
            />
          )}
          <ResultRow label={s.water} value={proUnit(proNum(result.water, 2), s.unitL)} />
          {result.batch !== undefined && (
            <>
              <ResultRow label={s.batches} value={result.batch.count} />
              <ResultRow
                label={s.batchBinderMass}
                value={proUnit(proNum(result.batch.binderMass, 2), s.unitKg)}
              />
              <ResultRow
                label={s.batchAggregateMass}
                value={proUnit(proNum(result.batch.aggregateMass, 2), s.unitKg)}
              />
              <ResultRow
                label={s.batchAggregateVolume}
                value={proUnit(proNum(result.batch.aggregateVolume, 4), s.unitM3)}
              />
              <ResultRow label={s.batchWater} value={proUnit(proNum(result.batch.water, 2), s.unitL)} />
            </>
          )}
          <ToolFormula>{s.formulaOnsite}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.ratio, value: `1:${ratioText.trim()}` },
              { label: s.packingFactor, value: proNum(proParse(packingFactorText) ?? 0, 2) },
              { label: s.waste, value: `${proNum(proParse(onsiteWasteText) ?? 0, 1)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * How many pieces of one fixed format come out of one panel, per
 * `panelCuttingYield` — the grid on the panel's face plus the offcut strips,
 * how many panels that takes, and the guillotine cuts it costs.
 */
export function PanelCuttingYieldTool() {
  const s = strings.pro.zanat["panel-cutting-yield"];
  const [panelWidthText, setPanelWidthText] = useState("");
  const [panelHeightText, setPanelHeightText] = useState("");
  const [pieceWidthText, setPieceWidthText] = useState("");
  const [pieceHeightText, setPieceHeightText] = useState("");
  const [piecesNeededText, setPiecesNeededText] = useState("");
  const [kerfText, setKerfText] = useState("");
  const [edgeTrimText, setEdgeTrimText] = useState("");
  const [grainMandatory, setGrainMandatory] = useState<"yes" | "no">("no");

  const typed =
    proParse(panelWidthText) !== undefined ||
    proParse(pieceWidthText) !== undefined ||
    proParse(piecesNeededText) !== undefined;

  const result = panelCuttingYield({
    panelWidth: proParse(panelWidthText) ?? Number.NaN,
    panelHeight: proParse(panelHeightText) ?? Number.NaN,
    pieceWidth: proParse(pieceWidthText) ?? Number.NaN,
    pieceHeight: proParse(pieceHeightText) ?? Number.NaN,
    piecesNeeded: proParse(piecesNeededText) ?? Number.NaN,
    kerf: proParse(kerfText) ?? Number.NaN,
    edgeTrim: proParse(edgeTrimText),
    grainMandatory: grainMandatory === "yes",
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "panelWidth"
        ? s.errorPanelWidth
        : field === "panelHeight"
          ? s.errorPanelHeight
          : field === "pieceWidth"
            ? s.errorPieceWidth
            : field === "pieceHeight"
              ? s.errorPieceHeight
              : field === "piecesNeeded"
                ? s.errorPiecesNeeded
                : field === "kerf"
                  ? s.errorKerf
                  : s.errorEdgeTrim;

  const copyText = !result.ok
    ? ""
    : [
        `${s.piecesPerPanel}: ${result.piecesPerPanel}`,
        `${s.panelsNeeded}: ${result.panelsNeeded}`,
        `${s.leftoverOnLastPanel}: ${result.leftoverOnLastPanel}`,
        `${s.yieldPercent}: ${proNum(result.yieldPercent, 2)} %`,
        `${s.wasteArea}: ${proUnit(proNum(result.wasteArea, 3), s.unitM2)}`,
        `${s.totalWasteArea}: ${proUnit(proNum(result.totalWasteArea, 3), s.unitM2)}`,
        `${s.rightStrip}: ${proUnit(proNum(result.rightStrip.width, 1), s.unitMm)} × ${proUnit(proNum(result.rightStrip.height, 1), s.unitMm)} (${proUnit(proNum(result.rightStrip.area, 3), s.unitM2)})`,
        `${s.bottomStrip}: ${proUnit(proNum(result.bottomStrip.width, 1), s.unitMm)} × ${proUnit(proNum(result.bottomStrip.height, 1), s.unitMm)} (${proUnit(proNum(result.bottomStrip.area, 3), s.unitM2)})`,
        `${s.cutCount}: ${result.cutCount}`,
        `${s.cutLength}: ${proUnit(proNum(result.cutLength, 2), s.unitM)}`,
        `${s.totalCutLength}: ${proUnit(proNum(result.totalCutLength, 2), s.unitM)}`,
        "",
        `${s.panelWidth}: ${proUnit(proNum(proParse(panelWidthText) ?? 0, 0), s.unitMm)}`,
        `${s.panelHeight}: ${proUnit(proNum(proParse(panelHeightText) ?? 0, 0), s.unitMm)}`,
        `${s.pieceWidth}: ${proUnit(proNum(proParse(pieceWidthText) ?? 0, 0), s.unitMm)}`,
        `${s.pieceHeight}: ${proUnit(proNum(proParse(pieceHeightText) ?? 0, 0), s.unitMm)}`,
        `${s.piecesNeeded}: ${piecesNeededText.trim()}`,
        `${s.grainMandatory}: ${grainMandatory === "yes" ? s.grainYes : s.grainNo}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.panelWidth} value={panelWidthText} onChange={setPanelWidthText} />
      <ToolInput label={s.panelHeight} value={panelHeightText} onChange={setPanelHeightText} />
      <ToolInput label={s.pieceWidth} value={pieceWidthText} onChange={setPieceWidthText} />
      <ToolInput label={s.pieceHeight} value={pieceHeightText} onChange={setPieceHeightText} />
      <ToolInput label={s.piecesNeeded} value={piecesNeededText} onChange={setPiecesNeededText} />
      <ToolInput label={s.kerf} hint={s.kerfHint} value={kerfText} onChange={setKerfText} />
      <ToolInput label={s.edgeTrim} value={edgeTrimText} onChange={setEdgeTrimText} />
      <ToolSelect<"yes" | "no">
        label={s.grainMandatory}
        value={grainMandatory}
        onChange={setGrainMandatory}
        hint={s.grainHint}
        options={[
          { id: "yes", label: s.grainYes },
          { id: "no", label: s.grainNo },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.piecesPerPanel} value={result.piecesPerPanel} />
          <ResultRow label={s.panelsNeeded} value={result.panelsNeeded} />
          <ResultRow label={s.leftoverOnLastPanel} value={result.leftoverOnLastPanel} />
          <ResultRow label={s.yieldPercent} value={`${proNum(result.yieldPercent, 2)} %`} />
          <ResultRow label={s.wasteArea} value={proUnit(proNum(result.wasteArea, 3), s.unitM2)} />
          <ResultRow label={s.totalWasteArea} value={proUnit(proNum(result.totalWasteArea, 3), s.unitM2)} />
          <ResultRow
            label={s.rightStrip}
            value={`${proUnit(proNum(result.rightStrip.width, 1), s.unitMm)} × ${proUnit(proNum(result.rightStrip.height, 1), s.unitMm)} (${proUnit(proNum(result.rightStrip.area, 3), s.unitM2)})`}
          />
          <ResultRow
            label={s.bottomStrip}
            value={`${proUnit(proNum(result.bottomStrip.width, 1), s.unitMm)} × ${proUnit(proNum(result.bottomStrip.height, 1), s.unitMm)} (${proUnit(proNum(result.bottomStrip.area, 3), s.unitM2)})`}
          />
          <ResultRow label={s.cutCount} value={result.cutCount} />
          <ResultRow label={s.cutLength} value={proUnit(proNum(result.cutLength, 2), s.unitM)} />
          <ResultRow label={s.totalCutLength} value={proUnit(proNum(result.totalCutLength, 2), s.unitM)} />
          <p className="nx-hint nx-hint--prose">{s.guillotineNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.panelWidth, value: proUnit(proNum(proParse(panelWidthText) ?? 0, 0), s.unitMm) },
              { label: s.panelHeight, value: proUnit(proNum(proParse(panelHeightText) ?? 0, 0), s.unitMm) },
              { label: s.pieceWidth, value: proUnit(proNum(proParse(pieceWidthText) ?? 0, 0), s.unitMm) },
              { label: s.pieceHeight, value: proUnit(proNum(proParse(pieceHeightText) ?? 0, 0), s.unitMm) },
              { label: s.piecesNeeded, value: piecesNeededText.trim() },
              { label: s.grainMandatory, value: grainMandatory === "yes" ? s.grainYes : s.grainNo },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Developed length and bend-line positions of a sheet-metal part, per
 * `sheetMetalBend` — plus, when a cut samples measured length is entered, the
 * K-factor that sample implies, per `sheetMetalKFactorFromSample`. The reverse
 * calculation reuses the same leg values, and needs them as OUTER legs — it
 * is only offered while `legsAs` is set to that.
 */
export function SheetMetalBendTool() {
  const s = strings.pro.zanat["sheet-metal-bend"];
  const [thicknessText, setThicknessText] = useState("");
  const [radiusText, setRadiusText] = useState("");
  const [angleText, setAngleText] = useState("");
  const [kFactorText, setKFactorText] = useState("");
  const [legsText, setLegsText] = useState("");
  const [legsAs, setLegsAs] = useState<"outer" | "tangent">("outer");
  const [measuredLengthText, setMeasuredLengthText] = useState("");

  const legLines = legsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const legs = legLines.map((line) => proParse(line) ?? Number.NaN);
  const typed =
    proParse(thicknessText) !== undefined || proParse(radiusText) !== undefined || legLines.length > 0;

  const result = sheetMetalBend({
    thickness: proParse(thicknessText) ?? Number.NaN,
    radius: proParse(radiusText) ?? Number.NaN,
    angle: proParse(angleText) ?? Number.NaN,
    kFactor: proParse(kFactorText) ?? Number.NaN,
    legs,
    legsAs,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "thickness"
        ? s.errorThickness
        : field === "radius"
          ? s.errorRadius
          : field === "angle"
            ? s.errorAngle
            : field === "kFactor"
              ? s.errorKFactor
              : s.errorLegs;

  const reverseTyped = legsAs === "outer" && proParse(measuredLengthText) !== undefined;
  const reverseResult = sheetMetalKFactorFromSample({
    thickness: proParse(thicknessText) ?? Number.NaN,
    radius: proParse(radiusText) ?? Number.NaN,
    angle: proParse(angleText) ?? Number.NaN,
    outerLegs: legs,
    measuredLength: proParse(measuredLengthText) ?? Number.NaN,
  });
  const reverseField = reverseResult.ok ? undefined : reasonField(reverseResult.reason);
  const reverseFailure =
    reverseResult.ok || !reverseTyped
      ? undefined
      : reverseField === "thickness"
        ? s.errorThickness
        : reverseField === "radius"
          ? s.errorRadius
          : reverseField === "angle"
            ? s.errorAngle
            : reverseField === "outerLegs"
              ? s.errorLegs
              : s.errorMeasuredLength;

  const copyText = !result.ok
    ? ""
    : [
        `${s.bendAllowance}: ${proUnit(proNum(result.bendAllowance, 3), s.unitMm)}`,
        `${s.bendDeduction}: ${proUnit(proNum(result.bendDeduction, 3), s.unitMm)}`,
        `${s.setback}: ${proUnit(proNum(result.setback, 3), s.unitMm)}`,
        `${s.developedLength}: ${proUnit(proNum(result.developedLength, 2), s.unitMm)}`,
        "",
        `${s.thickness}: ${proUnit(proNum(proParse(thicknessText) ?? 0, 2), s.unitMm)}`,
        `${s.radius}: ${proUnit(proNum(proParse(radiusText) ?? 0, 2), s.unitMm)}`,
        `${s.angle}: ${proUnit(proNum(proParse(angleText) ?? 0, 2), s.unitDeg)}`,
        `${s.kFactor}: ${proNum(proParse(kFactorText) ?? 0, 3)}`,
        `${s.legsAs}: ${legsAs === "outer" ? s.legsAsOuter : s.legsAsTangent}`,
        reverseResult.ok ? `${s.kFactorFromSample}: ${proNum(reverseResult.kFactor, 3)}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.thickness} value={thicknessText} onChange={setThicknessText} />
      <ToolInput label={s.radius} hint={s.radiusHint} value={radiusText} onChange={setRadiusText} />
      <ToolInput label={s.angle} value={angleText} onChange={setAngleText} />
      <ToolInput label={s.kFactor} hint={s.kFactorHint} value={kFactorText} onChange={setKFactorText} />
      <ToolSelect<"outer" | "tangent">
        label={s.legsAs}
        value={legsAs}
        onChange={setLegsAs}
        options={[
          { id: "outer", label: s.legsAsOuter },
          { id: "tangent", label: s.legsAsTangent },
        ]}
      />
      <ToolTextArea
        label={s.legs}
        hint={s.legsHint}
        value={legsText}
        onChange={setLegsText}
        placeholder={"50\n30"}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.bendAllowance} value={proUnit(proNum(result.bendAllowance, 3), s.unitMm)} />
          <ResultRow label={s.bendDeduction} value={proUnit(proNum(result.bendDeduction, 3), s.unitMm)} />
          <ResultRow label={s.setback} value={proUnit(proNum(result.setback, 3), s.unitMm)} />
          <ResultRow
            label={s.developedLength}
            value={proUnit(proNum(result.developedLength, 2), s.unitMm)}
          />
          <ToolTable
            head={[s.colBend, s.colStart, s.colEnd, s.colStartOpposite, s.colEndOpposite]}
            rows={result.bendLines.map((line, i) => [
              `${i + 1}`,
              proUnit(proNum(line.start, 2), s.unitMm),
              proUnit(proNum(line.end, 2), s.unitMm),
              proUnit(proNum(line.startFromOppositeEdge, 2), s.unitMm),
              proUnit(proNum(line.endFromOppositeEdge, 2), s.unitMm),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.thickness, value: proUnit(proNum(proParse(thicknessText) ?? 0, 2), s.unitMm) },
              { label: s.radius, value: proUnit(proNum(proParse(radiusText) ?? 0, 2), s.unitMm) },
              { label: s.angle, value: proUnit(proNum(proParse(angleText) ?? 0, 2), s.unitDeg) },
              { label: s.kFactor, value: proNum(proParse(kFactorText) ?? 0, 3) },
              { label: s.legsAs, value: legsAs === "outer" ? s.legsAsOuter : s.legsAsTangent },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      <ToolInput
        label={s.measuredLength}
        hint={legsAs === "outer" ? s.measuredLengthHint : s.measuredLengthDisabledHint}
        value={measuredLengthText}
        onChange={setMeasuredLengthText}
      />
      {reverseFailure !== undefined && <ToolFailure>{reverseFailure}</ToolFailure>}
      {reverseResult.ok && reverseTyped && (
        <ToolSection title={s.reverseResults}>
          <ResultRow label={s.kFactorFromSample} value={proNum(reverseResult.kFactor, 3)} />
          <ResultRow label={s.radiusToThickness} value={proNum(reverseResult.radiusToThickness, 3)} />
          <p className="nx-hint nx-hint--prose">{s.kFactorScopeNote}</p>
          <ToolFormula>{s.reverseFormula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.thickness, value: proUnit(proNum(reverseResult.thickness, 2), s.unitMm) },
              { label: s.radius, value: proUnit(proNum(reverseResult.radius, 2), s.unitMm) },
              { label: s.angle, value: proUnit(proNum(reverseResult.angle, 2), s.unitDeg) },
              {
                label: s.measuredLength,
                value: proUnit(proNum(proParse(measuredLengthText) ?? 0, 2), s.unitMm),
              },
            ]}
          />
          <CopyButton
            value={[
              `${s.kFactorFromSample}: ${proNum(reverseResult.kFactor, 3)}`,
              `${s.radiusToThickness}: ${proNum(reverseResult.radiusToThickness, 3)}`,
              `${s.thickness}: ${proUnit(proNum(reverseResult.thickness, 2), s.unitMm)}`,
              `${s.radius}: ${proUnit(proNum(reverseResult.radius, 2), s.unitMm)}`,
              `${s.angle}: ${proUnit(proNum(reverseResult.angle, 2), s.unitDeg)}`,
              `${s.measuredLength}: ${proUnit(proNum(proParse(measuredLengthText) ?? 0, 2), s.unitMm)}`,
            ].join("\n")}
          />
        </ToolSection>
      )}
    </>
  );
}

/** How the shelf's own weight is given, and how the user's deflection limit is given, per `shelfDeflection`. */
type ShelfWeightMode = "none" | "density" | "mass";
type DeflectionLimitMode = "value" | "ratio";

/**
 * Deflection, moment and stress for a shelf as a simple beam on two
 * supports, per `shelfDeflection`.
 *
 * **`life-safety`: no verdict, ever.** Both limits are the user's own figures
 * with no default — the hint says so — and what prints beside each computed
 * value is the limit and their ratio, never a word about whether the shelf
 * is „fine".
 */
export function ShelfDeflectionTool() {
  const s = strings.pro.zanat["shelf-deflection"];
  const [spanText, setSpanText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [thicknessText, setThicknessText] = useState("");
  const [udlMassText, setUdlMassText] = useState("");
  const [pointLoadMassText, setPointLoadMassText] = useState("");
  const [modulusText, setModulusText] = useState("");
  const [weightMode, setWeightMode] = useState<ShelfWeightMode>("none");
  const [shelfDensityText, setShelfDensityText] = useState("");
  const [shelfMassText, setShelfMassText] = useState("");
  const [limitMode, setLimitMode] = useState<DeflectionLimitMode>("value");
  const [deflectionLimitText, setDeflectionLimitText] = useState("");
  const [deflectionLimitDivisorText, setDeflectionLimitDivisorText] = useState("");
  const [stressLimitText, setStressLimitText] = useState("");

  const typed =
    proParse(spanText) !== undefined ||
    proParse(widthText) !== undefined ||
    proParse(udlMassText) !== undefined;

  const result = shelfDeflection({
    span: proParse(spanText) ?? Number.NaN,
    width: proParse(widthText) ?? Number.NaN,
    thickness: proParse(thicknessText) ?? Number.NaN,
    udlMass: proParse(udlMassText) ?? Number.NaN,
    pointLoadMass: proParse(pointLoadMassText),
    modulus: proParse(modulusText) ?? Number.NaN,
    shelfDensity: weightMode === "density" ? proParse(shelfDensityText) : undefined,
    shelfMass: weightMode === "mass" ? proParse(shelfMassText) : undefined,
    deflectionLimit: limitMode === "value" ? proParse(deflectionLimitText) : undefined,
    deflectionLimitDivisor: limitMode === "ratio" ? proParse(deflectionLimitDivisorText) : undefined,
    stressLimit: proParse(stressLimitText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "span"
        ? s.errorSpan
        : field === "width"
          ? s.errorWidth
          : field === "thickness"
            ? s.errorThickness
            : field === "udlMass"
              ? s.errorUdlMass
              : field === "pointLoadMass"
                ? s.errorPointLoadMass
                : field === "modulus"
                  ? s.errorModulus
                  : field === "shelfDensity"
                    ? s.errorShelfDensity
                    : field === "shelfMass"
                      ? s.errorShelfMass
                      : field === "deflectionLimitDivisor"
                        ? s.errorDeflectionLimitDivisor
                        : field === "deflectionLimit"
                          ? s.errorDeflectionLimit
                          : s.errorStressLimit;

  const deflectionLimitParsed = result.ok ? result.deflectionLimit : undefined;
  const stressLimitParsed = proParse(stressLimitText);

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalDeflection}: ${proUnit(proNum(result.totalDeflection, 2), s.unitMm)}`,
        result.spanOverDeflection === undefined
          ? undefined
          : `${s.spanOverDeflection}: L/${proNum(result.spanOverDeflection, 1)}`,
        `${s.stress}: ${proUnit(proNum(result.stress, 3), s.unitMpa)}`,
        deflectionLimitParsed === undefined
          ? undefined
          : `${s.deflectionLimit}: ${proUnit(proNum(deflectionLimitParsed, 2), s.unitMm)}`,
        result.deflectionRatio === undefined
          ? undefined
          : `${s.deflectionRatio}: ${proRatio(result.deflectionRatio)}`,
        stressLimitParsed === undefined
          ? undefined
          : `${s.stressLimit}: ${proUnit(proNum(stressLimitParsed, 3), s.unitMpa)}`,
        result.stressRatio === undefined ? undefined : `${s.stressRatio}: ${proRatio(result.stressRatio)}`,
        "",
        `${s.reaction}: ${proUnit(proNum(result.reaction, 1), s.unitN)} · ${proUnit(proNum(result.reactionMass, 2), s.unitKg)}`,
        `${s.span}: ${proUnit(proNum(proParse(spanText) ?? 0, 0), s.unitMm)}`,
        `${s.width}: ${proUnit(proNum(proParse(widthText) ?? 0, 0), s.unitMm)}`,
        `${s.thickness}: ${proUnit(proNum(proParse(thicknessText) ?? 0, 0), s.unitMm)}`,
        `${s.udlMass}: ${proUnit(proNum(proParse(udlMassText) ?? 0, 1), s.unitKg)}`,
        `${s.modulus}: ${proUnit(proNum(proParse(modulusText) ?? 0, 0), s.unitMpa)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.span} value={spanText} onChange={setSpanText} />
      <ToolInput label={s.width} value={widthText} onChange={setWidthText} />
      <ToolInput label={s.thickness} value={thicknessText} onChange={setThicknessText} />
      <ToolInput label={s.udlMass} value={udlMassText} onChange={setUdlMassText} />
      <ToolInput label={s.pointLoadMass} value={pointLoadMassText} onChange={setPointLoadMassText} />
      <ToolInput label={s.modulus} hint={s.modulusHint} value={modulusText} onChange={setModulusText} />
      <ToolSelect<ShelfWeightMode>
        label={s.weightMode}
        value={weightMode}
        onChange={setWeightMode}
        hint={s.weightModeHint}
        options={[
          { id: "none", label: s.weightModeNone },
          { id: "density", label: s.weightModeDensity },
          { id: "mass", label: s.weightModeMass },
        ]}
      />
      {weightMode === "density" && (
        <ToolInput label={s.shelfDensity} value={shelfDensityText} onChange={setShelfDensityText} />
      )}
      {weightMode === "mass" && (
        <ToolInput label={s.shelfMass} value={shelfMassText} onChange={setShelfMassText} />
      )}
      <ToolSelect<DeflectionLimitMode>
        label={s.limitMode}
        value={limitMode}
        onChange={setLimitMode}
        options={[
          { id: "value", label: s.limitModeValue },
          { id: "ratio", label: s.limitModeRatio },
        ]}
      />
      {limitMode === "value" ? (
        <ToolInput
          label={s.deflectionLimit}
          hint={s.limitHint}
          value={deflectionLimitText}
          onChange={setDeflectionLimitText}
        />
      ) : (
        <ToolInput
          label={s.deflectionLimitDivisor}
          hint={s.limitHint}
          value={deflectionLimitDivisorText}
          onChange={setDeflectionLimitDivisorText}
        />
      )}
      <ToolInput label={s.stressLimit} hint={s.limitHint} value={stressLimitText} onChange={setStressLimitText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {/* life-safety: quantities and the user's own limits, never a verdict. */}
          <ResultRow label={s.inertia} value={proNum(result.inertia, 0)} />
          <ResultRow label={s.sectionModulus} value={proNum(result.sectionModulus, 0)} />
          {result.selfWeightMass !== undefined && (
            <ResultRow label={s.selfWeightMass} value={proUnit(proNum(result.selfWeightMass, 2), s.unitKg)} />
          )}
          {result.selfWeightDeflection !== undefined && (
            <ResultRow
              label={s.selfWeightDeflection}
              value={proUnit(proNum(result.selfWeightDeflection, 2), s.unitMm)}
            />
          )}
          <ResultRow
            label={s.distributedDeflection}
            value={proUnit(proNum(result.distributedDeflection, 2), s.unitMm)}
          />
          <ResultRow label={s.pointDeflection} value={proUnit(proNum(result.pointDeflection, 2), s.unitMm)} />
          <ToolAgainstLimit
            label={s.totalDeflection}
            value={proUnit(proNum(result.totalDeflection, 2), s.unitMm)}
            limitLabel={s.deflectionLimit}
            limit={
              deflectionLimitParsed === undefined
                ? undefined
                : proUnit(proNum(deflectionLimitParsed, 2), s.unitMm)
            }
            ratioLabel={s.deflectionRatio}
            ratio={proRatio(result.deflectionRatio)}
          />
          {result.spanOverDeflection !== undefined && (
            <ResultRow label={s.spanOverDeflection} value={`L/${proNum(result.spanOverDeflection, 1)}`} />
          )}
          <ResultRow label={s.maxMoment} value={proUnit(proNum(result.maxMoment, 1), s.unitNmm)} />
          <ToolAgainstLimit
            label={s.stress}
            value={proUnit(proNum(result.stress, 3), s.unitMpa)}
            limitLabel={s.stressLimit}
            limit={stressLimitParsed === undefined ? undefined : proUnit(proNum(stressLimitParsed, 3), s.unitMpa)}
            ratioLabel={s.stressRatio}
            ratio={proRatio(result.stressRatio)}
          />
          <ResultRow
            label={s.reaction}
            value={`${proUnit(proNum(result.reaction, 1), s.unitN)} · ${proUnit(proNum(result.reactionMass, 2), s.unitKg)}`}
          />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.span, value: proUnit(proNum(proParse(spanText) ?? 0, 0), s.unitMm) },
              { label: s.width, value: proUnit(proNum(proParse(widthText) ?? 0, 0), s.unitMm) },
              { label: s.thickness, value: proUnit(proNum(proParse(thicknessText) ?? 0, 0), s.unitMm) },
              { label: s.udlMass, value: proUnit(proNum(proParse(udlMassText) ?? 0, 1), s.unitKg) },
              { label: s.modulus, value: proUnit(proNum(proParse(modulusText) ?? 0, 0), s.unitMpa) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** How the shelf count is given, per `shelfSpacing`. */
type ShelfCountMode = "count" | "maxOpening";

/**
 * Shelf positions for equal clear openings, equal axis spacing, or a fixed
 * bottom opening, with an optional snap to a drilled-hole raster, per
 * `shelfSpacing`.
 */
export function ShelfSpacingTool() {
  const s = strings.pro.zanat["shelf-spacing"];
  const [innerHeightText, setInnerHeightText] = useState("");
  const [countMode, setCountMode] = useState<ShelfCountMode>("count");
  const [shelfCountText, setShelfCountText] = useState("");
  const [maxClearOpeningText, setMaxClearOpeningText] = useState("");
  const [thicknessText, setThicknessText] = useState("");
  const [mode, setMode] = useState<ShelfSpacingMode>("equal-clear");
  const [firstOpeningHeightText, setFirstOpeningHeightText] = useState("");
  const [rasterText, setRasterText] = useState("");
  const [firstHoleFromBottomText, setFirstHoleFromBottomText] = useState("");
  const [snap, setSnap] = useState<"yes" | "no">("no");

  const typed = proParse(innerHeightText) !== undefined || proParse(thicknessText) !== undefined;

  const result = shelfSpacing({
    innerHeight: proParse(innerHeightText) ?? Number.NaN,
    shelfCount: countMode === "count" ? proParse(shelfCountText) : undefined,
    maxClearOpening: countMode === "maxOpening" ? proParse(maxClearOpeningText) : undefined,
    thickness: proParse(thicknessText) ?? Number.NaN,
    mode,
    firstOpeningHeight: mode === "given-first" ? proParse(firstOpeningHeightText) : undefined,
    raster: proParse(rasterText),
    firstHoleFromBottom: proParse(firstHoleFromBottomText),
    snap: snap === "yes",
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "innerHeight"
        ? s.errorInnerHeight
        : field === "thickness"
          ? s.errorThickness
          : field === "shelfCount"
            ? s.errorShelfCount
            : field === "maxClearOpening"
              ? s.errorMaxClearOpening
              : field === "usableHeight"
                ? s.errorUsableHeight
                : field === "firstOpeningHeight"
                  ? s.errorFirstOpeningHeight
                  : field === "firstHoleFromBottom"
                    ? s.errorFirstHoleFromBottom
                    : field === "raster"
                      ? s.errorRaster
                      : s.errorSnap;

  const modeLabel =
    mode === "equal-clear" ? s.modeEqualClear : mode === "equal-axis" ? s.modeEqualAxis : s.modeGivenFirst;

  const copyText = !result.ok
    ? ""
    : [
        `${s.shelfCount}: ${result.shelfCount}`,
        `${s.usableHeight}: ${proUnit(proNum(result.usableHeight, 1), s.unitMm)}`,
        "",
        ...result.shelves.map(
          (sh, i) =>
            `${s.shelf} ${i + 1}: ${s.bottomEdge} ${proUnit(proNum(sh.bottomEdge, 1), s.unitMm)}` +
            (sh.snapped === undefined
              ? ""
              : `, ${s.snappedBottomEdge} ${proUnit(proNum(sh.snapped.bottomEdge, 1), s.unitMm)}` +
                ` (${s.deviation} ${proUnit(proNum(sh.snapped.deviation, 1), s.unitMm)})`),
        ),
        "",
        `${s.clearOpenings}: ${result.clearOpenings.map((o) => proNum(o, 1)).join(", ")}`,
        result.snappedClearOpenings === undefined
          ? undefined
          : `${s.snappedClearOpenings}: ${result.snappedClearOpenings.map((o) => proNum(o, 1)).join(", ")}`,
        "",
        `${s.innerHeight}: ${proUnit(proNum(proParse(innerHeightText) ?? 0, 1), s.unitMm)}`,
        `${s.thickness}: ${proUnit(proNum(proParse(thicknessText) ?? 0, 1), s.unitMm)}`,
        `${s.mode}: ${modeLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.innerHeight} hint={s.innerHeightHint} value={innerHeightText} onChange={setInnerHeightText} />
      <ToolSelect<ShelfCountMode>
        label={s.countMode}
        value={countMode}
        onChange={setCountMode}
        options={[
          { id: "count", label: s.countModeCount },
          { id: "maxOpening", label: s.countModeMaxOpening },
        ]}
      />
      {countMode === "count" ? (
        <ToolInput label={s.shelfCount} value={shelfCountText} onChange={setShelfCountText} />
      ) : (
        <ToolInput
          label={s.maxClearOpening}
          hint={s.maxClearOpeningHint}
          value={maxClearOpeningText}
          onChange={setMaxClearOpeningText}
        />
      )}
      <ToolInput label={s.thickness} value={thicknessText} onChange={setThicknessText} />
      <ToolSelect<ShelfSpacingMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "equal-clear", label: s.modeEqualClear },
          { id: "equal-axis", label: s.modeEqualAxis },
          { id: "given-first", label: s.modeGivenFirst },
        ]}
      />
      {mode === "given-first" && (
        <ToolInput
          label={s.firstOpeningHeight}
          value={firstOpeningHeightText}
          onChange={setFirstOpeningHeightText}
        />
      )}
      <ToolInput label={s.raster} hint={s.rasterHint} value={rasterText} onChange={setRasterText} />
      <ToolSelect<"yes" | "no">
        label={s.snap}
        value={snap}
        onChange={setSnap}
        options={[
          { id: "yes", label: s.snapYes },
          { id: "no", label: s.snapNo },
        ]}
      />
      {snap === "yes" && (
        <ToolInput
          label={s.firstHoleFromBottom}
          hint={s.firstHoleFromBottomHint}
          value={firstHoleFromBottomText}
          onChange={setFirstHoleFromBottomText}
        />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.shelfCount} value={result.shelfCount} />
          <ResultRow label={s.usableHeight} value={proUnit(proNum(result.usableHeight, 1), s.unitMm)} />
          <ToolTable
            head={
              snap === "yes"
                ? [
                    s.colShelf,
                    s.colBottomEdge,
                    s.colTopDistance,
                    s.colHoleIndex,
                    s.colSnapped,
                    // The snapped edge's own distance from the top. The core
                    // computed it from the start and no column showed it, so
                    // the „od vrha" figure on screen belonged to the ideal
                    // position while the shelf goes at the snapped one.
                    s.colSnappedTopDistance,
                    s.colDeviation,
                  ]
                : [s.colShelf, s.colBottomEdge, s.colTopDistance]
            }
            rows={result.shelves.map((sh, i) =>
              snap === "yes"
                ? [
                    `${i + 1}`,
                    proUnit(proNum(sh.bottomEdge, 1), s.unitMm),
                    proUnit(proNum(sh.topEdgeDistance, 1), s.unitMm),
                    sh.snapped === undefined ? "—" : `${sh.snapped.holeIndex}`,
                    sh.snapped === undefined
                      ? "—"
                      : proUnit(proNum(sh.snapped.bottomEdge, 1), s.unitMm),
                    sh.snapped === undefined
                      ? "—"
                      : proUnit(proNum(sh.snapped.topEdgeDistance, 1), s.unitMm),
                    sh.snapped === undefined
                      ? "—"
                      : proUnit(proNum(sh.snapped.deviation, 1), s.unitMm),
                  ]
                : [
                    `${i + 1}`,
                    proUnit(proNum(sh.bottomEdge, 1), s.unitMm),
                    proUnit(proNum(sh.topEdgeDistance, 1), s.unitMm),
                  ],
            )}
          />
          <ToolOutput
            label={s.clearOpenings}
            value={result.clearOpenings.map((o) => proNum(o, 1)).join(", ")}
          />
          {result.snappedClearOpenings !== undefined && (
            <ToolOutput
              label={s.snappedClearOpenings}
              value={result.snappedClearOpenings.map((o) => proNum(o, 1)).join(", ")}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.innerHeight, value: proUnit(proNum(proParse(innerHeightText) ?? 0, 1), s.unitMm) },
              { label: s.thickness, value: proUnit(proNum(proParse(thicknessText) ?? 0, 1), s.unitMm) },
              { label: s.mode, value: modeLabel },
              // The raster the core USED, not the one this file guesses it used.
              {
                label: s.raster,
                value:
                  result.rasterUsed === undefined
                    ? "—"
                    : proUnit(proNum(result.rasterUsed, 1), s.unitMm),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Tap drill diameter for a target thread engagement, the engagement a drill
 * you already have would give, and the matching clearance-hole diameter, per
 * `tapDrillSize`.
 */
export function TapDrillSizeTool() {
  const s = strings.pro.zanat["tap-drill-size"];
  const [nominalDiameterText, setNominalDiameterText] = useState("");
  const [pitchText, setPitchText] = useState("");
  const [desiredEngagementText, setDesiredEngagementText] = useState("");
  const [ownDrillDiameterText, setOwnDrillDiameterText] = useState("");
  const [passHoleSeries, setPassHoleSeries] = useState<PassHoleSeries>("medium");
  const [chamferedThreadsText, setChamferedThreadsText] = useState("");
  const [threadDepthText, setThreadDepthText] = useState("");

  const typed = proParse(nominalDiameterText) !== undefined;

  const result = tapDrillSize({
    nominalDiameter: proParse(nominalDiameterText) ?? Number.NaN,
    pitch: proParse(pitchText),
    desiredEngagement: proParse(desiredEngagementText),
    ownDrillDiameter: proParse(ownDrillDiameterText),
    passHoleSeries,
    chamferedThreads: proParse(chamferedThreadsText),
    threadDepth: proParse(threadDepthText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "nominalDiameter"
        ? s.errorNominalDiameter
        : field === "pitch"
          ? s.errorPitch
          : field === "desiredEngagement"
            ? s.errorDesiredEngagement
            : field === "ownDrillDiameter"
              ? s.errorOwnDrillDiameter
              : field === "chamferedThreads"
                ? s.errorChamferedThreads
                : s.errorThreadDepth;

  const pitchSourceLabel = !result.ok
    ? ""
    : result.pitchSource === "coarse-auto"
      ? s.pitchSourceCoarseAuto
      : result.pitchSource === "coarse-entered"
        ? s.pitchSourceCoarseEntered
        : result.pitchSource === "fine"
          ? s.pitchSourceFine
          : s.pitchSourceCustom;

  const copyText = !result.ok
    ? ""
    : [
        `${s.drillDiameter}: ${proUnit(proNum(result.drillDiameter, 3), s.unitMm)}`,
        `${s.coreDiameter}: ${proUnit(proNum(result.coreDiameter, 4), s.unitMm)}`,
        `${s.threadDepthPerSide}: ${proUnit(proNum(result.threadDepthPerSide, 3), s.unitMm)}`,
        result.ownDrill === undefined
          ? undefined
          : `${s.ownDrillEngagement}: ${proNum(result.ownDrill.engagement, 2)} %`,
        // The depth that drill leaves was on the screen and not in the copy.
        result.ownDrill === undefined
          ? undefined
          : `${s.ownDrillThreadDepth}: ${proUnit(proNum(result.ownDrill.threadDepth, 3), s.unitMm)}`,
        result.passHoleDiameter === undefined
          ? undefined
          : `${s.passHoleDiameter}: ${proUnit(proNum(result.passHoleDiameter, 1), s.unitMm)}`,
        result.minBlindHoleDepth === undefined
          ? undefined
          : `${s.minBlindHoleDepth}: ${proUnit(proNum(result.minBlindHoleDepth, 2), s.unitMm)}`,
        "",
        `${s.nominalDiameter}: ${proUnit(proNum(proParse(nominalDiameterText) ?? 0, 2), s.unitMm)}`,
        `${s.pitchUsed}: ${proUnit(proNum(result.pitchUsed, 2), s.unitMm)} (${pitchSourceLabel})`,
        `${s.engagementUsed}: ${proNum(result.engagementUsed, 0)} %`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput
        label={s.nominalDiameter}
        hint={s.nominalDiameterHint}
        value={nominalDiameterText}
        onChange={setNominalDiameterText}
      />
      <ToolInput label={s.pitch} hint={s.pitchHint} value={pitchText} onChange={setPitchText} />
      <ToolInput
        label={s.desiredEngagement}
        hint={s.desiredEngagementHint}
        value={desiredEngagementText}
        onChange={setDesiredEngagementText}
      />
      <ToolInput
        label={s.ownDrillDiameter}
        hint={s.ownDrillDiameterHint}
        value={ownDrillDiameterText}
        onChange={setOwnDrillDiameterText}
      />
      <ToolSelect<PassHoleSeries>
        label={s.passHoleSeries}
        value={passHoleSeries}
        onChange={setPassHoleSeries}
        options={[
          { id: "fine", label: s.passHoleSeriesFine },
          { id: "medium", label: s.passHoleSeriesMedium },
          { id: "coarse", label: s.passHoleSeriesCoarse },
        ]}
      />
      <ToolInput
        label={s.chamferedThreads}
        hint={s.chamferedThreadsHint}
        value={chamferedThreadsText}
        onChange={setChamferedThreadsText}
      />
      <ToolInput label={s.threadDepth} value={threadDepthText} onChange={setThreadDepthText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.drillDiameter} value={proUnit(proNum(result.drillDiameter, 3), s.unitMm)} />
          <ResultRow label={s.coreDiameter} value={proUnit(proNum(result.coreDiameter, 4), s.unitMm)} />
          <ResultRow
            label={s.threadDepthPerSide}
            value={proUnit(proNum(result.threadDepthPerSide, 3), s.unitMm)}
          />
          {result.ownDrill !== undefined && (
            <>
              <ResultRow
                label={s.ownDrillEngagement}
                value={`${proNum(result.ownDrill.engagement, 2)} %`}
              />
              <ResultRow
                label={s.ownDrillThreadDepth}
                value={proUnit(proNum(result.ownDrill.threadDepth, 3), s.unitMm)}
              />
            </>
          )}
          {result.passHoleDiameter !== undefined && (
            <ResultRow label={s.passHoleDiameter} value={proUnit(proNum(result.passHoleDiameter, 1), s.unitMm)} />
          )}
          {result.minBlindHoleDepth !== undefined && (
            <ResultRow
              label={s.minBlindHoleDepth}
              value={proUnit(proNum(result.minBlindHoleDepth, 2), s.unitMm)}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.nominalDiameter,
                value: proUnit(proNum(proParse(nominalDiameterText) ?? 0, 2), s.unitMm),
              },
              { label: s.pitchUsed, value: `${proUnit(proNum(result.pitchUsed, 2), s.unitMm)} (${pitchSourceLabel})` },
              { label: s.engagementUsed, value: `${proNum(result.engagementUsed, 0)} %` },
              {
                label: s.passHoleSeries,
                value:
                  passHoleSeries === "fine"
                    ? s.passHoleSeriesFine
                    : passHoleSeries === "medium"
                      ? s.passHoleSeriesMedium
                      : s.passHoleSeriesCoarse,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Which of the seven `timberVolume` calculations is on screen. */
type TimberModeKind = TimberMode["kind"];
type TimberSection = "rough" | "planed";

/**
 * Round-log volume by Huber or Smalian, sawn-timber volume, or a stacked/prm
 * conversion, per `timberVolume`. Which fields apply differs per mode, so the
 * form switches on the chosen kind rather than showing all seven at once.
 */
export function TimberVolumeTool() {
  const s = strings.pro.zanat["timber-volume"];
  const [modeKind, setModeKind] = useState<TimberModeKind>("huber");
  const [meanDiameterText, setMeanDiameterText] = useState("");
  const [d1Text, setD1Text] = useState("");
  const [d2Text, setD2Text] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [logCountText, setLogCountText] = useState("");
  const [sawnThicknessText, setSawnThicknessText] = useState("");
  const [sawnWidthText, setSawnWidthText] = useState("");
  const [pieceLengthText, setPieceLengthText] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [targetVolumeText, setTargetVolumeText] = useState("");
  const [section, setSection] = useState<TimberSection>("rough");
  const [stackedVolumeText, setStackedVolumeText] = useState("");
  const [solidVolumeText, setSolidVolumeText] = useState("");
  const [packingCoefficientText, setPackingCoefficientText] = useState("");
  const [barkThicknessText, setBarkThicknessText] = useState("");
  const [densityText, setDensityText] = useState("");

  const typed =
    modeKind === "huber" || modeKind === "huber-smalian"
      ? proParse(meanDiameterText) !== undefined
      : modeKind === "smalian"
        ? proParse(d1Text) !== undefined
        : modeKind === "sawn" || modeKind === "sawn-from-volume"
          ? proParse(sawnThicknessText) !== undefined
          : modeKind === "stacked-to-solid"
            ? proParse(stackedVolumeText) !== undefined
            : proParse(solidVolumeText) !== undefined;

  const mode: TimberMode =
    modeKind === "huber"
      ? {
          kind: "huber",
          meanDiameter: proParse(meanDiameterText) ?? Number.NaN,
          length: proParse(lengthText) ?? Number.NaN,
          logCount: proParse(logCountText),
        }
      : modeKind === "smalian"
        ? {
            kind: "smalian",
            d1: proParse(d1Text) ?? Number.NaN,
            d2: proParse(d2Text) ?? Number.NaN,
            length: proParse(lengthText) ?? Number.NaN,
            logCount: proParse(logCountText),
          }
        : modeKind === "huber-smalian"
          ? {
              kind: "huber-smalian",
              meanDiameter: proParse(meanDiameterText) ?? Number.NaN,
              d1: proParse(d1Text) ?? Number.NaN,
              d2: proParse(d2Text) ?? Number.NaN,
              length: proParse(lengthText) ?? Number.NaN,
              logCount: proParse(logCountText),
            }
          : modeKind === "sawn"
            ? {
                kind: "sawn",
                thickness: proParse(sawnThicknessText) ?? Number.NaN,
                width: proParse(sawnWidthText) ?? Number.NaN,
                pieceLength: proParse(pieceLengthText) ?? Number.NaN,
                pieces: proParse(piecesText) ?? Number.NaN,
                section,
              }
            : modeKind === "sawn-from-volume"
              ? {
                  kind: "sawn-from-volume",
                  thickness: proParse(sawnThicknessText) ?? Number.NaN,
                  width: proParse(sawnWidthText) ?? Number.NaN,
                  pieceLength: proParse(pieceLengthText) ?? Number.NaN,
                  targetVolume: proParse(targetVolumeText) ?? Number.NaN,
                  section,
                }
              : modeKind === "stacked-to-solid"
                ? {
                    kind: "stacked-to-solid",
                    stackedVolume: proParse(stackedVolumeText) ?? Number.NaN,
                    packingCoefficient: proParse(packingCoefficientText) ?? Number.NaN,
                  }
                : {
                    kind: "solid-to-stacked",
                    solidVolume: proParse(solidVolumeText) ?? Number.NaN,
                    packingCoefficient: proParse(packingCoefficientText) ?? Number.NaN,
                  };

  const isLog = modeKind === "huber" || modeKind === "smalian" || modeKind === "huber-smalian";
  const result = timberVolume({
    mode,
    barkThickness: isLog ? proParse(barkThicknessText) : undefined,
    density: proParse(densityText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "barkThickness"
        ? s.errorBarkThickness
        : field === "density"
          ? s.errorDensity
          : field === "length"
            ? s.errorLength
            : field === "logCount"
              ? s.errorLogCount
              : field === "meanDiameter"
                ? s.errorMeanDiameter
                : field === "d1"
                  ? s.errorD1
                  : field === "d2"
                    ? s.errorD2
                    : field === "thickness"
                      ? s.errorSawnThickness
                      : field === "width"
                        ? s.errorSawnWidth
                        : field === "pieceLength"
                          ? s.errorPieceLength
                          : field === "pieces"
                            ? s.errorPieces
                            : field === "targetVolume"
                              ? s.errorTargetVolume
                              : field === "stackedVolume"
                                ? s.errorStackedVolume
                                : field === "packingCoefficient"
                                  ? s.errorPackingCoefficient
                                  : s.errorSolidVolume;

  const modeLabel =
    modeKind === "huber"
      ? s.modeHuber
      : modeKind === "smalian"
        ? s.modeSmalian
        : modeKind === "huber-smalian"
          ? s.modeHuberSmalian
          : modeKind === "sawn"
            ? s.modeSawn
            : modeKind === "sawn-from-volume"
              ? s.modeSawnFromVolume
              : modeKind === "stacked-to-solid"
                ? s.modeStackedToSolid
                : s.modeSolidToStacked;

  const copyText = !result.ok
    ? ""
    : [
        result.huberVolume === undefined
          ? undefined
          : `${s.huberVolume}: ${proUnit(proNum(result.huberVolume, 4), s.unitM3)}`,
        result.smalianVolume === undefined
          ? undefined
          : `${s.smalianVolume}: ${proUnit(proNum(result.smalianVolume, 4), s.unitM3)}`,
        result.volumeGap === undefined
          ? undefined
          : `${s.volumeDifference}: ${proUnit(proNum(result.volumeGap.absolute, 4), s.unitM3)} (${proNum(result.volumeGap.percent, 2)} %)`,
        result.taper === undefined ? undefined : `${s.taper}: ${proNum(result.taper, 3)} ${s.unitCmM}`,
        result.totalLogVolume === undefined
          ? undefined
          : `${s.totalLogVolume}: ${proUnit(proNum(result.totalLogVolume, 4), s.unitM3)}`,
        result.totalLogVolumeHuber === undefined
          ? undefined
          : `${s.totalLogVolumeHuber}: ${proUnit(proNum(result.totalLogVolumeHuber, 4), s.unitM3)}`,
        result.totalLogVolumeSmalian === undefined
          ? undefined
          : `${s.totalLogVolumeSmalian}: ${proUnit(proNum(result.totalLogVolumeSmalian, 4), s.unitM3)}`,
        result.pieceVolume === undefined
          ? undefined
          : `${s.pieceVolume}: ${proUnit(proNum(result.pieceVolume, 4), s.unitM3)}`,
        result.pieceCount === undefined ? undefined : `${s.pieceCount}: ${result.pieceCount}`,
        result.totalVolume === undefined
          ? undefined
          : `${s.totalVolume}: ${proUnit(proNum(result.totalVolume, 4), s.unitM3)}`,
        result.surfaceArea === undefined
          ? undefined
          : `${s.surfaceArea}: ${proUnit(proNum(result.surfaceArea, 3), s.unitM2)}`,
        result.stackedVolume === undefined
          ? undefined
          : `${s.stackedVolume}: ${proUnit(proNum(result.stackedVolume, 4), s.unitM3)}`,
        result.mass === undefined ? undefined : `${s.mass}: ${proUnit(proNum(result.mass, 1), s.unitKg)}`,
        result.massHuber === undefined
          ? undefined
          : `${s.massHuber}: ${proUnit(proNum(result.massHuber, 1), s.unitKg)}`,
        result.massSmalian === undefined
          ? undefined
          : `${s.massSmalian}: ${proUnit(proNum(result.massSmalian, 1), s.unitKg)}`,
        "",
        `${s.mode}: ${modeLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<TimberModeKind>
        label={s.mode}
        value={modeKind}
        onChange={setModeKind}
        options={[
          { id: "huber", label: s.modeHuber },
          { id: "smalian", label: s.modeSmalian },
          { id: "huber-smalian", label: s.modeHuberSmalian },
          { id: "sawn", label: s.modeSawn },
          { id: "sawn-from-volume", label: s.modeSawnFromVolume },
          { id: "stacked-to-solid", label: s.modeStackedToSolid },
          { id: "solid-to-stacked", label: s.modeSolidToStacked },
        ]}
      />
      {(modeKind === "huber" || modeKind === "huber-smalian") && (
        <ToolInput label={s.meanDiameter} hint={s.meanDiameterHint} value={meanDiameterText} onChange={setMeanDiameterText} />
      )}
      {(modeKind === "smalian" || modeKind === "huber-smalian") && (
        <>
          <ToolInput label={s.d1} value={d1Text} onChange={setD1Text} />
          <ToolInput label={s.d2} value={d2Text} onChange={setD2Text} />
        </>
      )}
      {isLog && (
        <>
          <ToolInput label={s.length} value={lengthText} onChange={setLengthText} />
          <ToolInput label={s.logCount} value={logCountText} onChange={setLogCountText} />
          <ToolInput label={s.barkThickness} value={barkThicknessText} onChange={setBarkThicknessText} />
        </>
      )}
      {(modeKind === "sawn" || modeKind === "sawn-from-volume") && (
        <>
          <ToolInput label={s.sawnThickness} value={sawnThicknessText} onChange={setSawnThicknessText} />
          <ToolInput label={s.sawnWidth} value={sawnWidthText} onChange={setSawnWidthText} />
          <ToolInput label={s.pieceLength} value={pieceLengthText} onChange={setPieceLengthText} />
          <ToolSelect<TimberSection>
            label={s.section}
            value={section}
            onChange={setSection}
            options={[
              { id: "rough", label: s.sectionRough },
              { id: "planed", label: s.sectionPlaned },
            ]}
          />
        </>
      )}
      {modeKind === "sawn" && <ToolInput label={s.pieces} value={piecesText} onChange={setPiecesText} />}
      {modeKind === "sawn-from-volume" && (
        <ToolInput label={s.targetVolume} value={targetVolumeText} onChange={setTargetVolumeText} />
      )}
      {modeKind === "stacked-to-solid" && (
        <ToolInput label={s.stackedVolume} value={stackedVolumeText} onChange={setStackedVolumeText} />
      )}
      {modeKind === "solid-to-stacked" && (
        <ToolInput label={s.solidVolume} value={solidVolumeText} onChange={setSolidVolumeText} />
      )}
      {(modeKind === "stacked-to-solid" || modeKind === "solid-to-stacked") && (
        <ToolInput
          label={s.packingCoefficient}
          hint={s.packingCoefficientHint}
          value={packingCoefficientText}
          onChange={setPackingCoefficientText}
        />
      )}
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.huberVolume !== undefined && (
            <ResultRow label={s.huberVolume} value={proUnit(proNum(result.huberVolume, 4), s.unitM3)} />
          )}
          {result.smalianVolume !== undefined && (
            <ResultRow label={s.smalianVolume} value={proUnit(proNum(result.smalianVolume, 4), s.unitM3)} />
          )}
          {result.volumeGap !== undefined && (
            <ResultRow
              label={s.volumeDifference}
              value={`${proUnit(proNum(result.volumeGap.absolute, 4), s.unitM3)} (${proNum(result.volumeGap.percent, 2)} %)`}
            />
          )}
          {result.taper !== undefined && (
            <ResultRow label={s.taper} value={`${proNum(result.taper, 3)} ${s.unitCmM}`} />
          )}
          {result.totalLogVolume !== undefined && (
            <ResultRow label={s.totalLogVolume} value={proUnit(proNum(result.totalLogVolume, 4), s.unitM3)} />
          )}
          {result.totalLogVolumeHuber !== undefined && (
            <ResultRow
              label={s.totalLogVolumeHuber}
              value={proUnit(proNum(result.totalLogVolumeHuber, 4), s.unitM3)}
            />
          )}
          {result.totalLogVolumeSmalian !== undefined && (
            <ResultRow
              label={s.totalLogVolumeSmalian}
              value={proUnit(proNum(result.totalLogVolumeSmalian, 4), s.unitM3)}
            />
          )}
          {result.pieceVolume !== undefined && (
            <ResultRow label={s.pieceVolume} value={proUnit(proNum(result.pieceVolume, 4), s.unitM3)} />
          )}
          {result.pieceCount !== undefined && <ResultRow label={s.pieceCount} value={result.pieceCount} />}
          {result.totalVolume !== undefined && (
            <ResultRow label={s.totalVolume} value={proUnit(proNum(result.totalVolume, 4), s.unitM3)} />
          )}
          {result.surfaceArea !== undefined && (
            <ResultRow label={s.surfaceArea} value={proUnit(proNum(result.surfaceArea, 3), s.unitM2)} />
          )}
          {result.stackedVolume !== undefined && (
            <ResultRow label={s.stackedVolume} value={proUnit(proNum(result.stackedVolume, 4), s.unitM3)} />
          )}
          {result.mass !== undefined && (
            <ResultRow label={s.mass} value={proUnit(proNum(result.mass, 1), s.unitKg)} />
          )}
          {result.massHuber !== undefined && (
            <ResultRow label={s.massHuber} value={proUnit(proNum(result.massHuber, 1), s.unitKg)} />
          )}
          {result.massSmalian !== undefined && (
            <ResultRow label={s.massSmalian} value={proUnit(proNum(result.massSmalian, 1), s.unitKg)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.mode, value: modeLabel }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Wallpaper strips and rolls from a per-wall width list, height, roll size and
 * pattern repeat, per `wallpaperRolls`. The list is walls, not a perimeter —
 * a strip never crosses a corner, so the count is per wall and summed.
 */
export function WallpaperRollsTool() {
  const s = strings.pro.zanat["wallpaper-rolls"];
  const [wallsText, setWallsText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [rollWidthText, setRollWidthText] = useState("");
  const [rollLengthText, setRollLengthText] = useState("");
  const [repeatText, setRepeatText] = useState("");
  const [matching, setMatching] = useState<WallpaperMatching>("straight");
  const [allowanceText, setAllowanceText] = useState("");
  const [reserveStripsText, setReserveStripsText] = useState("");
  const [spareStripHeightText, setSpareStripHeightText] = useState("");

  const rawWalls = proRows(wallsText);
  const typed = rawWalls.length > 0;
  const walls: WallpaperWall[] = rawWalls.map((row) => ({
    width: proParse(row[0] ?? "") ?? Number.NaN,
    fullHeightOpening: proParse(row[1] ?? ""),
  }));

  const result = wallpaperRolls({
    walls,
    height: proParse(heightText) ?? Number.NaN,
    rollWidth: proParse(rollWidthText) ?? Number.NaN,
    rollLength: proParse(rollLengthText) ?? Number.NaN,
    repeat: proParse(repeatText) ?? Number.NaN,
    matching,
    allowance: proParse(allowanceText) ?? Number.NaN,
    reserveStrips: proParse(reserveStripsText),
    spareStripHeight: proParse(spareStripHeightText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "walls"
        ? s.errorWalls
        : field === "height"
          ? s.errorHeight
          : field === "rollWidth"
            ? s.errorRollWidth
            : field === "rollLength"
              ? s.errorRollLength
              : field === "repeat"
                ? s.errorRepeat
                : field === "allowance"
                  ? s.errorAllowance
                  : field === "reserveStrips"
                    ? s.errorReserveStrips
                    : s.errorSpareStripHeight;

  const matchingLabel = matching === "straight" ? s.matchingStraight : s.matchingHalfDrop;

  const copyText = !result.ok
    ? ""
    : [
        `${s.stripCount}: ${result.stripCount}`,
        `${s.stripLength}: ${proUnit(proNum(result.stripLength, 2), s.unitM)}`,
        `${s.stripsPerRollCheck}: ${result.stripsPerRollCheck}`,
        `${s.rollCount}: ${result.rollCount}`,
        `${s.totalPatternWaste}: ${proUnit(proNum(result.totalPatternWaste, 2), s.unitM)}`,
        result.sparePiecesFromRemnants === undefined
          ? undefined
          : `${s.sparePiecesFromRemnants}: ${result.sparePiecesFromRemnants}`,
        "",
        ...result.rolls.map(
          (r, i) =>
            `${s.colRoll} ${i + 1}: ${s.colStripsOnRoll} ${r.stripCount}, ${s.colRemainder} ${proUnit(proNum(r.remainder, 2), s.unitM)}, ${s.colPatternWaste} ${proUnit(proNum(r.patternWaste, 2), s.unitM)}`,
        ),
        "",
        `${s.height}: ${proUnit(proNum(proParse(heightText) ?? 0, 2), s.unitM)}`,
        `${s.rollWidth}: ${proUnit(proNum(proParse(rollWidthText) ?? 0, 2), s.unitM)}`,
        `${s.rollLength}: ${proUnit(proNum(proParse(rollLengthText) ?? 0, 2), s.unitM)}`,
        `${s.repeat}: ${proUnit(proNum(proParse(repeatText) ?? 0, 2), s.unitM)}`,
        `${s.matching}: ${matchingLabel}`,
        `${s.allowance}: ${proUnit(proNum(proParse(allowanceText) ?? 0, 2), s.unitM)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea
        label={s.walls}
        hint={s.wallsHint}
        value={wallsText}
        onChange={setWallsText}
        placeholder={"3.60;0.90\n4.20;0"}
      />
      <ToolInput label={s.height} value={heightText} onChange={setHeightText} />
      <ToolInput label={s.rollWidth} value={rollWidthText} onChange={setRollWidthText} />
      <ToolInput label={s.rollLength} value={rollLengthText} onChange={setRollLengthText} />
      <ToolInput label={s.repeat} hint={s.repeatHint} value={repeatText} onChange={setRepeatText} />
      <ToolSelect<WallpaperMatching>
        label={s.matching}
        value={matching}
        onChange={setMatching}
        options={[
          { id: "straight", label: s.matchingStraight },
          { id: "half-drop", label: s.matchingHalfDrop },
        ]}
      />
      <ToolInput label={s.allowance} hint={s.allowanceHint} value={allowanceText} onChange={setAllowanceText} />
      <ToolInput
        label={s.reserveStrips}
        hint={s.reserveStripsHint}
        value={reserveStripsText}
        onChange={setReserveStripsText}
      />
      <ToolInput
        label={s.spareStripHeight}
        hint={s.spareStripHeightHint}
        value={spareStripHeightText}
        onChange={setSpareStripHeightText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.stripCount} value={result.stripCount} />
          <ResultRow label={s.stripLength} value={proUnit(proNum(result.stripLength, 2), s.unitM)} />
          <ResultRow label={s.stripsPerRollCheck} value={result.stripsPerRollCheck} />
          <ResultRow label={s.rollCount} value={result.rollCount} />
          <ResultRow label={s.totalPatternWaste} value={proUnit(proNum(result.totalPatternWaste, 2), s.unitM)} />
          {result.sparePiecesFromRemnants !== undefined && (
            <ResultRow label={s.sparePiecesFromRemnants} value={result.sparePiecesFromRemnants} />
          )}
          <ToolTable
            head={[s.colRoll, s.colStripsOnRoll, s.colRemainder, s.colPatternWaste]}
            rows={result.rolls.map((r, i) => [
              `${i + 1}`,
              `${r.stripCount}`,
              proUnit(proNum(r.remainder, 2), s.unitM),
              proUnit(proNum(r.patternWaste, 2), s.unitM),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.height, value: proUnit(proNum(proParse(heightText) ?? 0, 2), s.unitM) },
              { label: s.rollWidth, value: proUnit(proNum(proParse(rollWidthText) ?? 0, 2), s.unitM) },
              { label: s.rollLength, value: proUnit(proNum(proParse(rollLengthText) ?? 0, 2), s.unitM) },
              { label: s.repeat, value: proUnit(proNum(proParse(repeatText) ?? 0, 2), s.unitM) },
              { label: s.matching, value: matchingLabel },
              { label: s.allowance, value: proUnit(proNum(proParse(allowanceText) ?? 0, 2), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type FilletInputMode = "leg" | "throat";

/**
 * Weld-metal cross-section, mass and consumable quantity (wire length,
 * electrode count or spool count) for a fillet, V-groove or X-groove seam,
 * per `weldConsumable`. Prints only quantities of material — no joint
 * capacity, no process choice, no seam-size recommendation.
 */
export function WeldConsumableTool() {
  const s = strings.pro.zanat["weld-consumable"];
  const [seamType, setSeamType] = useState<WeldSeamType>("fillet");
  const [filletMode, setFilletMode] = useState<FilletInputMode>("leg");
  const [legText, setLegText] = useState("");
  const [throatText, setThroatText] = useState("");
  const [plateThicknessText, setPlateThicknessText] = useState("");
  const [grooveAngleText, setGrooveAngleText] = useState("");
  const [rootGapText, setRootGapText] = useState("");
  const [rootFaceHeightText, setRootFaceHeightText] = useState("");
  const [reinforcementText, setReinforcementText] = useState("");
  const [weldLengthText, setWeldLengthText] = useState("");
  const [seamCountText, setSeamCountText] = useState("");
  const [densityText, setDensityText] = useState("");
  const [efficiencyText, setEfficiencyText] = useState("");
  const [wasteText, setWasteText] = useState("");
  const [wireDiameterText, setWireDiameterText] = useState("");
  const [electrodeMassText, setElectrodeMassText] = useState("");
  const [electrodeUsableFractionText, setElectrodeUsableFractionText] = useState("");
  const [spoolMassText, setSpoolMassText] = useState("");

  // OR, like every other tool in this drawer, and it was briefly AND. `typed`
  // decides whether a REFUSAL may be shown, so a conjunction means the user who
  // has filled the seam and its geometry but not yet the length sees no result
  // and no error either — an empty panel that names no field, which is the one
  // outcome the refusal ladder below exists to prevent.
  const typed =
    proParse(weldLengthText) !== undefined ||
    proParse(reinforcementText) !== undefined ||
    proParse(legText) !== undefined ||
    proParse(throatText) !== undefined ||
    proParse(plateThicknessText) !== undefined;

  const result = weldConsumable({
    seamType,
    leg: seamType === "fillet" && filletMode === "leg" ? proParse(legText) : undefined,
    throat: seamType === "fillet" && filletMode === "throat" ? proParse(throatText) : undefined,
    plateThickness: seamType === "fillet" ? undefined : proParse(plateThicknessText),
    grooveAngle: seamType === "fillet" ? undefined : proParse(grooveAngleText),
    rootGap: seamType === "fillet" ? undefined : proParse(rootGapText),
    rootFaceHeight: seamType === "fillet" ? undefined : proParse(rootFaceHeightText),
    reinforcement: proParse(reinforcementText) ?? Number.NaN,
    weldLength: proParse(weldLengthText) ?? Number.NaN,
    seamCount: proParse(seamCountText),
    density: proParse(densityText),
    efficiency: proParse(efficiencyText) ?? Number.NaN,
    waste: proParse(wasteText) ?? Number.NaN,
    wireDiameter: proParse(wireDiameterText),
    electrodeMass: proParse(electrodeMassText),
    electrodeUsableFraction: proParse(electrodeUsableFractionText),
    spoolMass: proParse(spoolMassText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "reinforcement"
        ? s.errorReinforcement
        : field === "weldLength"
          ? s.errorWeldLength
          : field === "seamCount"
            ? s.errorSeamCount
            : field === "density"
              ? s.errorDensity
              : field === "efficiency"
                ? s.errorEfficiency
                : field === "waste"
                  ? s.errorWaste
                  : field === "throat"
                    ? s.errorThroat
                    : field === "leg"
                      ? s.errorLeg
                      : field === "plateThickness"
                        ? s.errorPlateThickness
                        : field === "grooveAngle"
                          ? s.errorGrooveAngle
                          : field === "rootGap"
                            ? s.errorRootGap
                            : field === "rootFaceHeight"
                              ? s.errorRootFaceHeight
                              : field === "wireDiameter"
                                ? s.errorWireDiameter
                                : field === "electrodeMass"
                                  ? s.errorElectrodeMass
                                  : field === "electrodeUsableFraction"
                                    ? s.errorElectrodeUsableFraction
                                    : s.errorSpoolMass;

  const seamTypeLabel =
    seamType === "fillet" ? s.seamTypeFillet : seamType === "butt-v" ? s.seamTypeButtV : s.seamTypeButtX;

  const copyText = !result.ok
    ? ""
    : [
        result.legUsed === undefined
          ? undefined
          : `${s.legUsed}: ${proUnit(proNum(result.legUsed, 2), s.unitMm)}`,
        `${s.crossSectionArea}: ${proUnit(proNum(result.crossSectionArea, 3), s.unitMm2)}`,
        `${s.weldMassPerMetre}: ${proUnit(proNum(result.weldMassPerMetre, 3), s.unitKgM)}`,
        `${s.weldVolume}: ${proUnit(proNum(result.weldVolume, 2), s.unitCm3)}`,
        `${s.weldMass}: ${proUnit(proNum(result.weldMass, 3), s.unitKg)}`,
        `${s.consumableMass}: ${proUnit(proNum(result.consumableMass, 3), s.unitKg)}`,
        result.wireLength === undefined
          ? undefined
          : `${s.wireLength}: ${proUnit(proNum(result.wireLength, 1), s.unitM)}`,
        result.electrodeCount === undefined ? undefined : `${s.electrodeCount}: ${result.electrodeCount}`,
        result.spoolCount === undefined ? undefined : `${s.spoolCount}: ${result.spoolCount}`,
        "",
        `${s.seamType}: ${seamTypeLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<WeldSeamType>
        label={s.seamType}
        value={seamType}
        onChange={setSeamType}
        options={[
          { id: "fillet", label: s.seamTypeFillet },
          { id: "butt-v", label: s.seamTypeButtV },
          { id: "butt-x", label: s.seamTypeButtX },
        ]}
      />
      {seamType === "fillet" && (
        <>
          <ToolSelect<FilletInputMode>
            label={s.filletMode}
            value={filletMode}
            onChange={setFilletMode}
            options={[
              { id: "leg", label: s.filletModeLeg },
              { id: "throat", label: s.filletModeThroat },
            ]}
          />
          {filletMode === "leg" ? (
            <ToolInput label={s.leg} value={legText} onChange={setLegText} />
          ) : (
            <ToolInput label={s.throat} value={throatText} onChange={setThroatText} />
          )}
        </>
      )}
      {seamType !== "fillet" && (
        <>
          <ToolInput label={s.plateThickness} value={plateThicknessText} onChange={setPlateThicknessText} />
          <ToolInput label={s.grooveAngle} value={grooveAngleText} onChange={setGrooveAngleText} />
          <ToolInput label={s.rootGap} value={rootGapText} onChange={setRootGapText} />
          <ToolInput
            label={s.rootFaceHeight}
            hint={s.rootFaceHeightHint}
            value={rootFaceHeightText}
            onChange={setRootFaceHeightText}
          />
        </>
      )}
      <ToolInput label={s.reinforcement} hint={s.reinforcementHint} value={reinforcementText} onChange={setReinforcementText} />
      <ToolInput label={s.weldLength} value={weldLengthText} onChange={setWeldLengthText} />
      <ToolInput label={s.seamCount} value={seamCountText} onChange={setSeamCountText} />
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />
      <ToolInput label={s.efficiency} hint={s.efficiencyHint} value={efficiencyText} onChange={setEfficiencyText} />
      <ToolInput label={s.waste} value={wasteText} onChange={setWasteText} />
      <ToolInput
        label={s.wireDiameter}
        hint={s.wireDiameterHint}
        value={wireDiameterText}
        onChange={setWireDiameterText}
      />
      <ToolInput
        label={s.electrodeMass}
        hint={s.electrodeMassHint}
        value={electrodeMassText}
        onChange={setElectrodeMassText}
      />
      <ToolInput
        label={s.electrodeUsableFraction}
        value={electrodeUsableFractionText}
        onChange={setElectrodeUsableFractionText}
      />
      <ToolInput label={s.spoolMass} hint={s.spoolMassHint} value={spoolMassText} onChange={setSpoolMassText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.legUsed !== undefined && (
            <ResultRow label={s.legUsed} value={proUnit(proNum(result.legUsed, 2), s.unitMm)} />
          )}
          <ResultRow label={s.crossSectionArea} value={proUnit(proNum(result.crossSectionArea, 3), s.unitMm2)} />
          <ResultRow label={s.weldMassPerMetre} value={proUnit(proNum(result.weldMassPerMetre, 3), s.unitKgM)} />
          <ResultRow label={s.weldVolume} value={proUnit(proNum(result.weldVolume, 2), s.unitCm3)} />
          <ResultRow label={s.weldMass} value={proUnit(proNum(result.weldMass, 3), s.unitKg)} />
          <ResultRow label={s.consumableMass} value={proUnit(proNum(result.consumableMass, 3), s.unitKg)} />
          {result.wireLength !== undefined && (
            <ResultRow label={s.wireLength} value={proUnit(proNum(result.wireLength, 1), s.unitM)} />
          )}
          {result.electrodeCount !== undefined && (
            <ResultRow label={s.electrodeCount} value={result.electrodeCount} />
          )}
          {result.spoolCount !== undefined && <ResultRow label={s.spoolCount} value={result.spoolCount} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.seamType, value: seamTypeLabel },
              { label: s.reinforcement, value: `${proNum(proParse(reinforcementText) ?? 0, 1)} %` },
              { label: s.weldLength, value: proUnit(proNum(proParse(weldLengthText) ?? 0, 2), s.unitM) },
              { label: s.efficiency, value: proNum(proParse(efficiencyText) ?? 0, 2) },
              { label: s.waste, value: `${proNum(proParse(wasteText) ?? 0, 1)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type ShrinkageMode = "coefficient" | "totalShrinkage";

/**
 * How much a wood dimension changes between two moisture contents, and — when
 * a room's moisture range is also given — the swing to expect against it,
 * per `woodMoistureMovement`. Wood moves only below the fibre saturation
 * point, so every moisture figure is clamped there before use.
 */
export function WoodMoistureMovementTool() {
  const s = strings.pro.zanat["wood-moisture-movement"];
  const [initialDimensionText, setInitialDimensionText] = useState("");
  const [initialMoistureText, setInitialMoistureText] = useState("");
  const [finalMoistureText, setFinalMoistureText] = useState("");
  const [shrinkageMode, setShrinkageMode] = useState<ShrinkageMode>("coefficient");
  const [shrinkageCoefficientText, setShrinkageCoefficientText] = useState("");
  const [totalShrinkageText, setTotalShrinkageText] = useState("");
  const [grainDirection, setGrainDirection] = useState<GrainDirection>("tangential");
  const [fiberSaturationPointText, setFiberSaturationPointText] = useState("");
  const [elementWidthText, setElementWidthText] = useState("");
  const [installMoistureText, setInstallMoistureText] = useState("");
  const [roomMoistureMinText, setRoomMoistureMinText] = useState("");
  const [roomMoistureMaxText, setRoomMoistureMaxText] = useState("");

  const typed = proParse(initialDimensionText) !== undefined;

  const result = woodMoistureMovement({
    initialDimension: proParse(initialDimensionText) ?? Number.NaN,
    initialMoisture: proParse(initialMoistureText) ?? Number.NaN,
    finalMoisture: proParse(finalMoistureText) ?? Number.NaN,
    shrinkageCoefficient: shrinkageMode === "coefficient" ? proParse(shrinkageCoefficientText) : undefined,
    totalShrinkage: shrinkageMode === "totalShrinkage" ? proParse(totalShrinkageText) : undefined,
    grainDirection,
    fiberSaturationPoint: proParse(fiberSaturationPointText),
    roomMoistureMin: proParse(roomMoistureMinText),
    roomMoistureMax: proParse(roomMoistureMaxText),
    installMoisture: proParse(installMoistureText),
    elementWidth: proParse(elementWidthText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "initialDimension"
        ? s.errorInitialDimension
        : field === "initialMoisture"
          ? s.errorInitialMoisture
          : field === "finalMoisture"
            ? s.errorFinalMoisture
            : field === "fiberSaturationPoint"
              ? s.errorFiberSaturationPoint
              : field === "shrinkageCoefficient"
                ? s.errorShrinkageCoefficient
                : field === "totalShrinkage"
                  ? s.errorTotalShrinkage
                  : field === "elementWidth"
                    ? s.errorElementWidth
                    : field === "installMoisture"
                      ? s.errorInstallMoisture
                      : field === "roomMoistureMin"
                        ? s.errorRoomMoistureMin
                        : s.errorRoomMoistureMax;

  const grainLabel =
    grainDirection === "radial"
      ? s.grainRadial
      : grainDirection === "tangential"
        ? s.grainTangential
        : s.grainLongitudinal;

  const copyText = !result.ok
    ? ""
    : [
        `${s.clampedInitialMoisture}: ${proNum(result.clampedInitialMoisture, 1)} %`,
        `${s.clampedFinalMoisture}: ${proNum(result.clampedFinalMoisture, 1)} %`,
        `${s.dimensionChange}: ${proUnit(proNum(result.dimensionChange, 2), s.unitMm)} (${proNum(result.dimensionChangePercent, 2)} %)`,
        `${s.finalDimension}: ${proUnit(proNum(result.finalDimension, 2), s.unitMm)}`,
        result.derivedCoefficient === undefined
          ? undefined
          : `${s.derivedCoefficient}: ${proNum(result.derivedCoefficient, 4)} ${s.unitPercentPerPercent}`,
        result.swellToMax === undefined
          ? undefined
          : `${s.swellToMax}: ${proUnit(proNum(result.swellToMax, 2), s.unitMm)}`,
        result.shrinkToMin === undefined
          ? undefined
          : `${s.shrinkToMin}: ${proUnit(proNum(result.shrinkToMin, 2), s.unitMm)}`,
        result.totalSwing === undefined
          ? undefined
          : `${s.totalSwing}: ${proUnit(proNum(result.totalSwing, 2), s.unitMm)}`,
        "",
        `${s.grainDirection}: ${grainLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.initialDimension} value={initialDimensionText} onChange={setInitialDimensionText} />
      <ToolInput
        label={s.initialMoisture}
        hint={s.initialMoistureHint}
        value={initialMoistureText}
        onChange={setInitialMoistureText}
      />
      <ToolInput label={s.finalMoisture} value={finalMoistureText} onChange={setFinalMoistureText} />
      <ToolSelect<GrainDirection>
        label={s.grainDirection}
        value={grainDirection}
        onChange={setGrainDirection}
        options={[
          { id: "radial", label: s.grainRadial },
          { id: "tangential", label: s.grainTangential },
          { id: "longitudinal", label: s.grainLongitudinal },
        ]}
      />
      <ToolSelect<ShrinkageMode>
        label={s.shrinkageMode}
        value={shrinkageMode}
        onChange={setShrinkageMode}
        options={[
          { id: "coefficient", label: s.shrinkageModeCoefficient },
          { id: "totalShrinkage", label: s.shrinkageModeTotalShrinkage },
        ]}
      />
      {shrinkageMode === "coefficient" ? (
        <ToolInput
          label={s.shrinkageCoefficient}
          hint={s.shrinkageCoefficientHint}
          value={shrinkageCoefficientText}
          onChange={setShrinkageCoefficientText}
        />
      ) : (
        <ToolInput
          label={s.totalShrinkage}
          hint={s.totalShrinkageHint}
          value={totalShrinkageText}
          onChange={setTotalShrinkageText}
        />
      )}
      <ToolInput
        label={s.fiberSaturationPoint}
        hint={s.fiberSaturationPointHint}
        value={fiberSaturationPointText}
        onChange={setFiberSaturationPointText}
      />
      <ToolInput label={s.elementWidth} value={elementWidthText} onChange={setElementWidthText} />
      <ToolInput
        label={s.installMoisture}
        hint={s.installMoistureHint}
        value={installMoistureText}
        onChange={setInstallMoistureText}
      />
      <ToolInput
        label={s.roomMoistureMin}
        hint={s.roomMoistureHint}
        value={roomMoistureMinText}
        onChange={setRoomMoistureMinText}
      />
      <ToolInput label={s.roomMoistureMax} value={roomMoistureMaxText} onChange={setRoomMoistureMaxText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.clampedInitialMoisture} value={`${proNum(result.clampedInitialMoisture, 1)} %`} />
          <ResultRow label={s.clampedFinalMoisture} value={`${proNum(result.clampedFinalMoisture, 1)} %`} />
          <ResultRow
            label={s.dimensionChange}
            value={`${proUnit(proNum(result.dimensionChange, 2), s.unitMm)} (${proNum(result.dimensionChangePercent, 2)} %)`}
          />
          <ResultRow label={s.finalDimension} value={proUnit(proNum(result.finalDimension, 2), s.unitMm)} />
          {result.derivedCoefficient !== undefined && (
            <ResultRow
              label={s.derivedCoefficient}
              value={`${proNum(result.derivedCoefficient, 4)} ${s.unitPercentPerPercent}`}
            />
          )}
          {result.swellToMax !== undefined && (
            <ResultRow label={s.swellToMax} value={proUnit(proNum(result.swellToMax, 2), s.unitMm)} />
          )}
          {result.shrinkToMin !== undefined && (
            <ResultRow label={s.shrinkToMin} value={proUnit(proNum(result.shrinkToMin, 2), s.unitMm)} />
          )}
          {result.totalSwing !== undefined && (
            <ResultRow label={s.totalSwing} value={proUnit(proNum(result.totalSwing, 2), s.unitMm)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.grainDirection, value: grainLabel },
              {
                label: s.initialDimension,
                value: proUnit(proNum(proParse(initialDimensionText) ?? 0, 1), s.unitMm),
              },
              { label: s.initialMoisture, value: `${proNum(proParse(initialMoistureText) ?? 0, 1)} %` },
              { label: s.finalMoisture, value: `${proNum(proParse(finalMoistureText) ?? 0, 1)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const ZANAT_SURFACES: Readonly<Record<string, ComponentType>> = {
  "fabric-yardage-repeat": FabricYardageTool,
  "glass-pane-weight": GlassPaneWeightTool,
  "iso-286-fits": Iso286FitsTool,
  "linear-cutting-stock": LinearCuttingStockTool,
  "mitre-angles": MitreAnglesTool,
  "mortar-mix-quantity": MortarMixQuantityTool,
  "panel-cutting-yield": PanelCuttingYieldTool,
  "sheet-metal-bend": SheetMetalBendTool,
  "shelf-deflection": ShelfDeflectionTool,
  "shelf-spacing": ShelfSpacingTool,
  "tap-drill-size": TapDrillSizeTool,
  "timber-volume": TimberVolumeTool,
  "wallpaper-rolls": WallpaperRollsTool,
  "weld-consumable": WeldConsumableTool,
  "wood-moisture-movement": WoodMoistureMovementTool,
};
