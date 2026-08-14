import {
  aspectRatioFit,
  baselineRhythm,
  bookSpine,
  columnGrid,
  copyfitting,
  typographicUnits,
  colourDifference,
  eanBarcode,
  fontMetricsTrim,
  isoPaperSize,
  modularTypeScale,
  paperWeight,
  printResolution,
  rollYield,
  saddleStitchImposition,
  sheetImposition,
  TYPE_SCALE_RATIOS,
  type AssetScale,
  type DeltaE94Application,
  type FitMode,
  type FitRounding,
  type FontMetricSource,
  type LineHeightUnit,
  type PaperSeries,
  type PhysicalUnit,
  type PrintDirection,
  type RollLayout,
  type SheetLayout,
  type SnapMode,
  type SpineBindingStyle,
  type Symbology,
  type TypeScaleRounding,
  type TypeScaleUnit,
  type TypographicUnit,
} from "@nexus/core/pro/dizajn";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse } from "./format.js";
import {
  CopyButton,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
  ToolTable,
} from "./shared.js";

/**
 * „Dizajn i priprema za štampu" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/dizajn.ts`'s. Nothing here divides, rounds
 * or compares; this file shapes fields, hands the numbers over, and reads the
 * answers onto the page.
 *
 * **Every tool in this pack is `riskClass: "none"`.** A spine is millimetres, a
 * ΔE is a number, an imposition is a table of page positions — there is no
 * regulatory limit anywhere in this pack, so no surface here draws
 * `ToolAgainstLimit`. What every tool still owes: the formula it evaluated, its
 * inputs echoed back, and a copy button carrying both.
 */

/** Odnos stranica — integer ratio, fit into a frame under five modes, and the letterbox bars or crop that mode costs. */
export function AspectRatioFitTool() {
  const s = strings.pro.dizajn["aspect-ratio-fit"];
  const [sourceWidth, setSourceWidth] = useState("");
  const [sourceHeight, setSourceHeight] = useState("");
  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [mode, setMode] = useState<FitMode>("contain");
  const [roundTo, setRoundTo] = useState<FitRounding>("wholePixel");

  const sw = proParse(sourceWidth);
  const sh = proParse(sourceHeight);
  const tw = proParse(targetWidth);
  const th = proParse(targetHeight);
  const typed = sw !== undefined || sh !== undefined || tw !== undefined || th !== undefined;

  const result = aspectRatioFit({
    sourceWidth: sw ?? Number.NaN,
    sourceHeight: sh ?? Number.NaN,
    targetWidth: tw,
    targetHeight: th,
    mode,
    roundTo,
  });

  const modeLabel =
    mode === "contain"
      ? s.modeContain
      : mode === "cover"
        ? s.modeCover
        : mode === "exactWidth"
          ? s.modeExactWidth
          : mode === "exactHeight"
            ? s.modeExactHeight
            : s.modeStretch;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "sourceWidth"
        ? s.errorSourceWidth
        : result.reason === "sourceHeight"
          ? s.errorSourceHeight
          : result.reason === "targetWidth"
            ? s.errorTargetWidth
            : result.reason === "targetHeight"
              ? s.errorTargetHeight
              : result.reason === "roundTo"
                ? s.errorRoundTo
                : s.errorMode;

  const copyText = !result.ok
    ? ""
    : [
        `${s.ratioInteger}: ${
          result.ratioWidth !== undefined && result.ratioHeight !== undefined
            ? `${proNum(result.ratioWidth, 0)}:${proNum(result.ratioHeight, 0)}`
            : s.noIntegerRatio
        }`,
        `${s.ratioDecimal}: ${proNum(result.decimalRatio, 6)}`,
        result.scale !== undefined
          ? `${s.scale}: ${proNum(result.scale, 6)}`
          : `${s.scaleX}: ${proNum(result.scaleX, 6)}, ${s.scaleY}: ${proNum(result.scaleY, 6)}, ${s.distortion}: ${proNum(result.distortion, 6)}`,
        `${s.outputWidth}: ${proNum(result.outputWidth, 2)}`,
        `${s.outputHeight}: ${proNum(result.outputHeight, 2)}`,
        `${s.displayWidth}: ${proNum(result.displayWidth, 2)}`,
        `${s.displayHeight}: ${proNum(result.displayHeight, 2)}`,
        "",
        `${s.sourceWidth}: ${proNum(sw ?? Number.NaN, 2)}`,
        `${s.sourceHeight}: ${proNum(sh ?? Number.NaN, 2)}`,
        `${s.targetWidth}: ${tw === undefined ? "—" : proNum(tw, 2)}`,
        `${s.targetHeight}: ${th === undefined ? "—" : proNum(th, 2)}`,
        `${s.mode}: ${modeLabel}`,
        `${s.roundTo}: ${roundTo === "wholePixel" ? s.roundToPixel : s.roundToNone}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.sourceWidth}
        hint={s.sourceHint}
        value={sourceWidth}
        onChange={setSourceWidth}
      />
      <ToolInput label={s.sourceHeight} value={sourceHeight} onChange={setSourceHeight} />
      <ToolSelect<FitMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "contain", label: s.modeContain },
          { id: "cover", label: s.modeCover },
          { id: "exactWidth", label: s.modeExactWidth },
          { id: "exactHeight", label: s.modeExactHeight },
          { id: "stretch", label: s.modeStretch },
        ]}
      />
      <ToolInput
        label={s.targetWidth}
        hint={s.targetHint}
        value={targetWidth}
        onChange={setTargetWidth}
      />
      <ToolInput label={s.targetHeight} value={targetHeight} onChange={setTargetHeight} />
      <ToolSelect<FitRounding>
        label={s.roundTo}
        value={roundTo}
        onChange={setRoundTo}
        options={[
          { id: "none", label: s.roundToNone },
          { id: "wholePixel", label: s.roundToPixel },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.ratioInteger}
            value={
              result.ratioWidth !== undefined && result.ratioHeight !== undefined
                ? `${proNum(result.ratioWidth, 0)}:${proNum(result.ratioHeight, 0)}`
                : s.noIntegerRatio
            }
          />
          <ResultRow label={s.ratioDecimal} value={proNum(result.decimalRatio, 6)} />
          {result.scale !== undefined ? (
            <ResultRow label={s.scale} value={proNum(result.scale, 6)} />
          ) : (
            <>
              <ResultRow label={s.scaleX} value={proNum(result.scaleX, 6)} />
              <ResultRow label={s.scaleY} value={proNum(result.scaleY, 6)} />
              <ResultRow label={s.distortion} value={proNum(result.distortion, 6)} />
            </>
          )}
          <ResultRow label={s.outputWidth} value={proNum(result.outputWidth, 2)} />
          <ResultRow label={s.outputHeight} value={proNum(result.outputHeight, 2)} />
          <ResultRow label={s.displayWidth} value={proNum(result.displayWidth, 2)} />
          <ResultRow label={s.displayHeight} value={proNum(result.displayHeight, 2)} />
          {result.displayRatio !== undefined && (
            <ResultRow label={s.displayRatioLabel} value={proNum(result.displayRatio, 6)} />
          )}
          <ResultRow
            label={s.roundingRemainderWidth}
            value={proNum(result.roundingRemainderWidth, 3)}
          />
          <ResultRow
            label={s.roundingRemainderHeight}
            value={proNum(result.roundingRemainderHeight, 3)}
          />
          {result.barWidth !== undefined && result.barHeight !== undefined && (
            <>
              <ResultRow label={s.barWidth} value={proNum(result.barWidth, 2)} />
              <ResultRow label={s.barHeight} value={proNum(result.barHeight, 2)} />
            </>
          )}
          {result.cropWidth !== undefined &&
            result.cropHeight !== undefined &&
            result.cropWidthSource !== undefined &&
            result.cropHeightSource !== undefined &&
            result.visibleSourceWidth !== undefined &&
            result.visibleSourceHeight !== undefined && (
              <>
                <ResultRow label={s.cropWidth} value={proNum(result.cropWidth, 2)} />
                <ResultRow label={s.cropHeight} value={proNum(result.cropHeight, 2)} />
                <ResultRow label={s.cropWidthSource} value={proNum(result.cropWidthSource, 2)} />
                <ResultRow
                  label={s.cropHeightSource}
                  value={proNum(result.cropHeightSource, 2)}
                />
                <ResultRow
                  label={s.visibleSourceWidth}
                  value={proNum(result.visibleSourceWidth, 2)}
                />
                <ResultRow
                  label={s.visibleSourceHeight}
                  value={proNum(result.visibleSourceHeight, 2)}
                />
              </>
            )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sourceWidth, value: proNum(sw ?? Number.NaN, 2) },
              { label: s.sourceHeight, value: proNum(sh ?? Number.NaN, 2) },
              { label: s.targetWidth, value: tw === undefined ? "—" : proNum(tw, 2) },
              { label: s.targetHeight, value: th === undefined ? "—" : proNum(th, 2) },
              { label: s.mode, value: modeLabel },
              {
                label: s.roundTo,
                value: roundTo === "wholePixel" ? s.roundToPixel : s.roundToNone,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Prored i vertikalni ritam — line height in px against a baseline grid, raw and snapped side by side. */
export function BaselineRhythmTool() {
  const s = strings.pro.dizajn["baseline-rhythm"];
  const [fontSize, setFontSize] = useState("");
  const [lineHeight, setLineHeight] = useState("");
  const [lineHeightUnit, setLineHeightUnit] = useState<LineHeightUnit>("multiplier");
  const [gridUnit, setGridUnit] = useState("8");
  const [columnHeight, setColumnHeight] = useState("");
  const [snapMode, setSnapMode] = useState<SnapMode>("up");

  const fs = proParse(fontSize);
  const lh = proParse(lineHeight);
  const grid = proParse(gridUnit);
  const colH = proParse(columnHeight);
  const typed = fs !== undefined || lh !== undefined;

  const result = baselineRhythm({
    fontSize: fs ?? Number.NaN,
    lineHeight: lh ?? Number.NaN,
    lineHeightUnit,
    gridUnit: grid ?? Number.NaN,
    columnHeight: colH,
    snapMode,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fontSize"
        ? s.errorFontSize
        : result.reason === "lineHeight"
          ? s.errorLineHeight
          : result.reason === "gridUnit"
            ? s.errorGridUnit
            : result.reason === "lineHeightUnit"
              ? s.errorLineHeightUnit
              : result.reason === "snapMode"
                ? s.errorSnapMode
                : s.errorColumnHeight;

  const copyText = !result.ok
    ? ""
    : [
        `${s.lineHeightPx}: ${proNum(result.lineHeightPx, 4)}`,
        `${s.multiplier}: ${proNum(result.multiplier, 4)}`,
        `${s.leading}: ${proNum(result.leading, 4)}`,
        `${s.halfLeading}: ${proNum(result.halfLeading, 4)}`,
        `${s.gridRemainder}: ${proNum(result.gridRemainder, 4)}`,
        `${s.onGrid}: ${result.onGrid ? s.yes : s.no}`,
        `${s.snapped}: ${proNum(result.snapped, 4)}`,
        `${s.snappedMultiplier}: ${proNum(result.snappedMultiplier, 4)}`,
        `${s.snappedLeading}: ${proNum(result.snappedLeading, 4)}`,
        "",
        `${s.fontSize}: ${proNum(fs ?? Number.NaN, 2)}`,
        `${s.lineHeight}: ${proNum(lh ?? Number.NaN, 4)} (${lineHeightUnit === "px" ? s.unitPx : s.unitMultiplier})`,
        `${s.gridUnit}: ${proNum(grid ?? Number.NaN, 2)}`,
        `${s.snapMode}: ${snapMode === "up" ? s.snapUp : snapMode === "down" ? s.snapDown : s.snapNearest}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.fontSize} value={fontSize} onChange={setFontSize} />
      <ToolInput
        label={s.lineHeight}
        hint={s.lineHeightHint}
        value={lineHeight}
        onChange={setLineHeight}
      />
      <ToolSelect<LineHeightUnit>
        label={s.lineHeightUnit}
        value={lineHeightUnit}
        onChange={setLineHeightUnit}
        options={[
          { id: "multiplier", label: s.unitMultiplier },
          { id: "px", label: s.unitPx },
        ]}
      />
      <ToolInput label={s.gridUnit} hint={s.gridUnitHint} value={gridUnit} onChange={setGridUnit} />
      <ToolInput
        label={s.columnHeight}
        hint={s.columnHeightHint}
        value={columnHeight}
        onChange={setColumnHeight}
      />
      <ToolSelect<SnapMode>
        label={s.snapMode}
        value={snapMode}
        onChange={setSnapMode}
        options={[
          { id: "up", label: s.snapUp },
          { id: "nearest", label: s.snapNearest },
          { id: "down", label: s.snapDown },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.lineHeightPx} value={proNum(result.lineHeightPx, 4)} />
          <ResultRow label={s.multiplier} value={proNum(result.multiplier, 4)} />
          <ResultRow label={s.leading} value={proNum(result.leading, 4)} />
          <ResultRow label={s.halfLeading} value={proNum(result.halfLeading, 4)} />
          <ResultRow label={s.gridRemainder} value={proNum(result.gridRemainder, 4)} />
          <ResultRow label={s.onGrid} value={result.onGrid ? s.yes : s.no} />
          <ResultRow label={s.snapped} value={proNum(result.snapped, 4)} />
          <ResultRow label={s.snappedMultiplier} value={proNum(result.snappedMultiplier, 4)} />
          <ResultRow label={s.snappedLeading} value={proNum(result.snappedLeading, 4)} />
          {result.column !== undefined && (
            <ToolSection title={s.columnRaw}>
              <ResultRow label={s.lines} value={proNum(result.column.lines, 0)} />
              <ResultRow label={s.used} value={proNum(result.column.used, 2)} />
              <ResultRow label={s.leftover} value={proNum(result.column.leftover, 2)} />
            </ToolSection>
          )}
          {result.snappedColumn !== undefined && (
            <ToolSection title={s.columnSnapped}>
              <ResultRow label={s.lines} value={proNum(result.snappedColumn.lines, 0)} />
              <ResultRow label={s.used} value={proNum(result.snappedColumn.used, 2)} />
              <ResultRow label={s.leftover} value={proNum(result.snappedColumn.leftover, 2)} />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.fontSize, value: proNum(fs ?? Number.NaN, 2) },
              {
                label: s.lineHeight,
                value: `${proNum(lh ?? Number.NaN, 4)} (${lineHeightUnit === "px" ? s.unitPx : s.unitMultiplier})`,
              },
              { label: s.gridUnit, value: proNum(grid ?? Number.NaN, 2) },
              {
                label: s.snapMode,
                value: snapMode === "up" ? s.snapUp : snapMode === "down" ? s.snapDown : s.snapNearest,
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
 * Debljina hrbata — spine thickness and the flat cover it implies.
 *
 * The volume field is labelled explicitly and its derived thickness is always
 * shown in the results: a volume of 1,25 typed into a field that expects a
 * thickness of 0,10 produces a spine 12,5× too thin with nothing else to catch
 * it, so the number the field actually produced is printed rather than hidden
 * behind the grammage/volume pair.
 */
export function BookSpineTool() {
  const s = strings.pro.dizajn["book-spine"];
  const [pageCount, setPageCount] = useState("");
  const [paperCaliper, setPaperCaliper] = useState("");
  const [grammage, setGrammage] = useState("");
  const [bulk, setBulk] = useState("");
  const [coverCaliper, setCoverCaliper] = useState("0");
  const [extraAllowance, setExtraAllowance] = useState("0");
  const [coverWidth, setCoverWidth] = useState("");
  const [coverHeight, setCoverHeight] = useState("");
  const [measuredStack, setMeasuredStack] = useState("");
  const [edgeWrap, setEdgeWrap] = useState("0");
  const [bindingStyle, setBindingStyle] = useState<SpineBindingStyle>("soft");
  const [hingeGroove, setHingeGroove] = useState("0");

  const pc = proParse(pageCount);
  const paperCal = proParse(paperCaliper);
  const gram = proParse(grammage);
  const bulkV = proParse(bulk);
  const coverCal = proParse(coverCaliper);
  const extra = proParse(extraAllowance);
  const cw = proParse(coverWidth);
  const ch = proParse(coverHeight);
  const measured = proParse(measuredStack);
  const wrap = proParse(edgeWrap);
  const groove = proParse(hingeGroove);
  const typed =
    pc !== undefined || paperCal !== undefined || gram !== undefined || measured !== undefined;

  const result = bookSpine({
    pageCount: pc ?? Number.NaN,
    paperCaliper: paperCal,
    grammage: gram,
    bulk: bulkV,
    coverCaliper: coverCal ?? Number.NaN,
    extraAllowance: extra ?? Number.NaN,
    coverWidth: cw,
    coverHeight: ch,
    measuredStack: measured,
    edgeWrap: wrap ?? Number.NaN,
    bindingStyle,
    hingeGroove: groove ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "pageCount"
        ? s.errorPageCount
        : result.reason === "coverCaliper"
          ? s.errorCoverCaliper
          : result.reason === "extraAllowance"
            ? s.errorExtraAllowance
            : result.reason === "edgeWrap"
              ? s.errorEdgeWrap
              : result.reason === "hingeGroove"
                ? s.errorHingeGroove
                : result.reason === "bindingStyle"
                  ? s.errorBindingStyle
                  : result.reason === "paperCaliper"
                    ? s.errorPaperCaliper
                    : result.reason === "grammage"
                      ? s.errorGrammage
                      : result.reason === "bulk"
                        ? s.errorBulk
                        : result.reason === "measuredStack"
                          ? s.errorMeasuredStack
                          : result.reason === "caliper"
                            ? s.errorCaliper
                            : result.reason === "coverWidth"
                              ? s.errorCoverWidth
                              : s.errorCoverHeight;

  const sourceLabel = (source: "typed" | "grammage" | "measured"): string =>
    source === "typed" ? s.sourceTyped : source === "grammage" ? s.sourceGrammage : s.sourceMeasured;

  const copyText = !result.ok
    ? ""
    : [
        `${s.leaves}: ${proNum(result.leaves, 0)}`,
        `${s.caliper}: ${proNum(result.caliper, 4)} (${sourceLabel(result.caliperSource)})`,
        `${s.block}: ${proNum(result.block, 3)}`,
        `${s.spine}: ${proNum(result.spine, 2)}`,
        result.flatCoverWidth !== undefined ? `${s.flatCoverWidth}: ${proNum(result.flatCoverWidth, 2)}` : "",
        result.flatCoverHeight !== undefined ? `${s.flatCoverHeight}: ${proNum(result.flatCoverHeight, 2)}` : "",
        "",
        `${s.pageCount}: ${proNum(pc ?? Number.NaN, 0)}`,
        `${s.coverCaliper}: ${proNum(coverCal ?? Number.NaN, 2)}`,
        `${s.extraAllowance}: ${proNum(extra ?? Number.NaN, 2)}`,
        `${s.edgeWrap}: ${proNum(wrap ?? Number.NaN, 2)}`,
        `${s.bindingStyle}: ${bindingStyle === "soft" ? s.bindingSoft : s.bindingHard}`,
        `${s.hingeGroove}: ${proNum(groove ?? Number.NaN, 2)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.pageCount} value={pageCount} onChange={setPageCount} />
      <ToolInput
        label={s.paperCaliper}
        hint={s.paperCaliperHint}
        value={paperCaliper}
        onChange={setPaperCaliper}
      />
      <ToolInput label={s.grammage} hint={s.grammageHint} value={grammage} onChange={setGrammage} />
      <ToolInput label={s.bulk} hint={s.bulkHint} value={bulk} onChange={setBulk} />
      <ToolInput label={s.measuredStack} hint={s.measuredStackHint} value={measuredStack} onChange={setMeasuredStack} />
      <ToolInput label={s.coverCaliper} value={coverCaliper} onChange={setCoverCaliper} />
      <ToolInput label={s.extraAllowance} hint={s.extraAllowanceHint} value={extraAllowance} onChange={setExtraAllowance} />
      <ToolInput label={s.coverWidth} value={coverWidth} onChange={setCoverWidth} />
      <ToolInput label={s.coverHeight} value={coverHeight} onChange={setCoverHeight} />
      <ToolInput label={s.edgeWrap} hint={s.edgeWrapHint} value={edgeWrap} onChange={setEdgeWrap} />
      <ToolSelect<SpineBindingStyle>
        label={s.bindingStyle}
        value={bindingStyle}
        onChange={setBindingStyle}
        options={[
          { id: "soft", label: s.bindingSoft },
          { id: "hard", label: s.bindingHard },
        ]}
      />
      <ToolInput label={s.hingeGroove} hint={s.hingeGrooveHint} value={hingeGroove} onChange={setHingeGroove} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.leaves} value={proNum(result.leaves, 0)} />
          <ResultRow
            label={s.caliper}
            value={`${proNum(result.caliper, 4)} (${sourceLabel(result.caliperSource)})`}
          />
          <ResultRow label={s.block} value={proNum(result.block, 3)} />
          <ResultRow label={s.spine} value={proNum(result.spine, 2)} />
          {result.flatCoverWidth !== undefined && (
            <ResultRow label={s.flatCoverWidth} value={proNum(result.flatCoverWidth, 2)} />
          )}
          {result.flatCoverHeight !== undefined && (
            <ResultRow label={s.flatCoverHeight} value={proNum(result.flatCoverHeight, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pageCount, value: proNum(pc ?? Number.NaN, 0) },
              { label: s.coverCaliper, value: proNum(coverCal ?? Number.NaN, 2) },
              { label: s.extraAllowance, value: proNum(extra ?? Number.NaN, 2) },
              { label: s.edgeWrap, value: proNum(wrap ?? Number.NaN, 2) },
              {
                label: s.bindingStyle,
                value: bindingStyle === "soft" ? s.bindingSoft : s.bindingHard,
              },
              { label: s.hingeGroove, value: proNum(groove ?? Number.NaN, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Mreža kolona — column width, every span, every left edge, and the reverse column count. */
export function ColumnGridTool() {
  const s = strings.pro.dizajn["column-grid"];
  const [containerWidth, setContainerWidth] = useState("");
  const [columns, setColumns] = useState("");
  const [gutter, setGutter] = useState("0");
  const [outerMargin, setOuterMargin] = useState("0");
  const [spanColumns, setSpanColumns] = useState("");
  const [minColumnWidth, setMinColumnWidth] = useState("");

  const cw = proParse(containerWidth);
  const cols = proParse(columns);
  const gut = proParse(gutter);
  const margin = proParse(outerMargin);
  const span = proParse(spanColumns);
  const minWidth = proParse(minColumnWidth);
  const typed = cw !== undefined || cols !== undefined;

  const result = columnGrid({
    containerWidth: cw ?? Number.NaN,
    columns: cols ?? Number.NaN,
    gutter: gut ?? Number.NaN,
    outerMargin: margin ?? Number.NaN,
    spanColumns: span,
    minColumnWidth: minWidth,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "containerWidth"
        ? s.errorContainerWidth
        : result.reason === "columns"
          ? s.errorColumns
          : result.reason === "gutter"
            ? s.errorGutter
            : result.reason === "outerMargin"
              ? s.errorOuterMargin
              : result.reason === "spanColumns"
                ? s.errorSpanColumns
                : s.errorMinColumnWidth;

  const copyText = !result.ok
    ? ""
    : [
        `${s.contentWidth}: ${proNum(result.contentWidth, 2)}`,
        result.columnWidth !== undefined
          ? `${s.columnWidth}: ${proNum(result.columnWidth, 4)}`
          : `${s.noGrid}: ${proNum(result.minRequiredContentWidth ?? Number.NaN, 2)}`,
        result.columnPercent !== undefined ? `${s.columnPercent}: ${proNum(result.columnPercent, 4)}` : "",
        result.span !== undefined ? `${s.span}: ${proNum(result.span, 4)}` : "",
        result.maxColumns !== undefined ? `${s.maxColumns}: ${proNum(result.maxColumns, 0)}` : "",
        "",
        `${s.containerWidth}: ${proNum(cw ?? Number.NaN, 2)}`,
        `${s.columns}: ${proNum(cols ?? Number.NaN, 0)}`,
        `${s.gutter}: ${proNum(gut ?? Number.NaN, 2)}`,
        `${s.outerMargin}: ${proNum(margin ?? Number.NaN, 2)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.containerWidth} value={containerWidth} onChange={setContainerWidth} />
      <ToolInput label={s.columns} value={columns} onChange={setColumns} />
      <ToolInput label={s.gutter} value={gutter} onChange={setGutter} />
      <ToolInput label={s.outerMargin} value={outerMargin} onChange={setOuterMargin} />
      <ToolInput label={s.spanColumns} hint={s.spanColumnsHint} value={spanColumns} onChange={setSpanColumns} />
      <ToolInput
        label={s.minColumnWidth}
        hint={s.minColumnWidthHint}
        value={minColumnWidth}
        onChange={setMinColumnWidth}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.contentWidth} value={proNum(result.contentWidth, 2)} />
          {result.columnWidth !== undefined ? (
            <>
              <ResultRow label={s.columnWidth} value={proNum(result.columnWidth, 4)} />
              {result.columnPercent !== undefined && (
                <ResultRow label={s.columnPercent} value={proNum(result.columnPercent, 4)} />
              )}
              {result.span !== undefined && <ResultRow label={s.span} value={proNum(result.span, 4)} />}
              <ToolTable
                head={[s.colIndex, s.colSpan, s.colLeftEdge]}
                rows={result.spans.map((value, index) => [
                  proNum(index + 1, 0),
                  proNum(value, 4),
                  proNum(result.leftEdges[index] ?? Number.NaN, 4),
                ])}
              />
            </>
          ) : (
            <ResultRow label={s.noGrid} value={proNum(result.minRequiredContentWidth ?? Number.NaN, 2)} />
          )}
          {result.maxColumns !== undefined && (
            <ResultRow label={s.maxColumns} value={proNum(result.maxColumns, 0)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.containerWidth, value: proNum(cw ?? Number.NaN, 2) },
              { label: s.columns, value: proNum(cols ?? Number.NaN, 0) },
              { label: s.gutter, value: proNum(gut ?? Number.NaN, 2) },
              { label: s.outerMargin, value: proNum(margin ?? Number.NaN, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Proračun obima teksta — an estimate built from a MEASURED average character
 * width, never a typesetting. `totalLines` alone is a lower bound (it assumes
 * every line fills to the measure); a paragraph count turns it into a true
 * upper bound too.
 */
export function CopyfittingTool() {
  const s = strings.pro.dizajn.copyfitting;
  const [characterCount, setCharacterCount] = useState("");
  const [charactersPerLine, setCharactersPerLine] = useState("");
  const [columnWidth, setColumnWidth] = useState("");
  const [averageCharacterWidth, setAverageCharacterWidth] = useState("");
  const [linesPerColumn, setLinesPerColumn] = useState("");
  const [columnHeight, setColumnHeight] = useState("");
  const [lineHeight, setLineHeight] = useState("");
  const [columnsPerPage, setColumnsPerPage] = useState("1");
  const [targetPages, setTargetPages] = useState("");
  const [paragraphs, setParagraphs] = useState("");

  const cc = proParse(characterCount);
  const cpl = proParse(charactersPerLine);
  const colW = proParse(columnWidth);
  const avgW = proParse(averageCharacterWidth);
  const lpc = proParse(linesPerColumn);
  const colH = proParse(columnHeight);
  const lh = proParse(lineHeight);
  const cpp = proParse(columnsPerPage);
  const target = proParse(targetPages);
  const paras = proParse(paragraphs);
  const typed = cc !== undefined;

  const result = copyfitting({
    characterCount: cc ?? Number.NaN,
    charactersPerLine: cpl,
    columnWidth: colW,
    averageCharacterWidth: avgW,
    linesPerColumn: lpc,
    columnHeight: colH,
    lineHeight: lh,
    columnsPerPage: cpp ?? Number.NaN,
    targetPages: target,
    paragraphs: paras,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "characterCount"
        ? s.errorCharacterCount
        : result.reason === "columnsPerPage"
          ? s.errorColumnsPerPage
          : result.reason === "charactersPerLine"
            ? s.errorCharactersPerLine
            : result.reason === "columnWidth"
              ? s.errorColumnWidth
              : result.reason === "averageCharacterWidth"
                ? s.errorAverageCharacterWidth
                : result.reason === "linesPerColumn"
                  ? s.errorLinesPerColumn
                  : result.reason === "columnHeight"
                    ? s.errorColumnHeight
                    : result.reason === "lineHeight"
                      ? s.errorLineHeight
                      : result.reason === "targetPages"
                        ? s.errorTargetPages
                        : s.errorParagraphs;

  const copyText = !result.ok
    ? ""
    : [
        `${s.charactersPerLine}: ${proNum(result.charactersPerLine, 0)}`,
        `${s.linesPerColumn}: ${proNum(result.linesPerColumn, 0)}`,
        `${s.totalLines}: ${proNum(result.totalLines, 0)}`,
        result.totalLinesUpperBound !== undefined
          ? `${s.totalLinesUpperBound}: ${proNum(result.totalLinesUpperBound, 0)}`
          : "",
        `${s.linesPerPage}: ${proNum(result.linesPerPage, 0)}`,
        `${s.pages}: ${proNum(result.pages, 0)}`,
        `${s.lastPageLines}: ${proNum(result.lastPageLines, 0)}`,
        `${s.lastPageFill}: ${proNum(result.lastPageFill, 2)}`,
        result.requiredCharactersPerLine !== undefined
          ? `${s.requiredCharactersPerLine}: ${proNum(result.requiredCharactersPerLine, 0)}`
          : "",
        "",
        `${s.characterCount}: ${proNum(cc ?? Number.NaN, 0)}`,
        `${s.columnsPerPage}: ${proNum(cpp ?? Number.NaN, 0)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.characterCount} value={characterCount} onChange={setCharacterCount} />
      <ToolInput
        label={s.charactersPerLine}
        hint={s.charactersPerLineHint}
        value={charactersPerLine}
        onChange={setCharactersPerLine}
      />
      <ToolInput label={s.columnWidth} value={columnWidth} onChange={setColumnWidth} />
      <ToolInput
        label={s.averageCharacterWidth}
        hint={s.averageCharacterWidthHint}
        value={averageCharacterWidth}
        onChange={setAverageCharacterWidth}
      />
      <ToolInput
        label={s.linesPerColumn}
        hint={s.linesPerColumnHint}
        value={linesPerColumn}
        onChange={setLinesPerColumn}
      />
      <ToolInput label={s.columnHeight} value={columnHeight} onChange={setColumnHeight} />
      <ToolInput label={s.lineHeight} value={lineHeight} onChange={setLineHeight} />
      <ToolInput label={s.columnsPerPage} value={columnsPerPage} onChange={setColumnsPerPage} />
      <ToolInput label={s.targetPages} hint={s.targetPagesHint} value={targetPages} onChange={setTargetPages} />
      <ToolInput label={s.paragraphs} hint={s.paragraphsHint} value={paragraphs} onChange={setParagraphs} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.charactersPerLine} value={proNum(result.charactersPerLine, 0)} />
          <ResultRow label={s.linesPerColumn} value={proNum(result.linesPerColumn, 0)} />
          <ResultRow label={s.totalLines} value={proNum(result.totalLines, 0)} />
          {result.totalLinesUpperBound !== undefined && (
            <ResultRow label={s.totalLinesUpperBound} value={proNum(result.totalLinesUpperBound, 0)} />
          )}
          <ResultRow label={s.linesPerPage} value={proNum(result.linesPerPage, 0)} />
          <ResultRow label={s.pages} value={proNum(result.pages, 0)} />
          <ResultRow label={s.lastPageLines} value={proNum(result.lastPageLines, 0)} />
          <ResultRow label={s.lastPageFill} value={proNum(result.lastPageFill, 2)} />
          {result.requiredCharactersPerLine !== undefined && (
            <ResultRow
              label={s.requiredCharactersPerLine}
              value={proNum(result.requiredCharactersPerLine, 0)}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.characterCount, value: proNum(cc ?? Number.NaN, 0) },
              { label: s.columnsPerPage, value: proNum(cpp ?? Number.NaN, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Tipografske jedinice — one length in every unit, plus device pixels and
 * export sizes. The rem/em/device columns are echoed with the reference they
 * were computed at, since neither the root font size nor a device density is a
 * fact the app knows on its own.
 */
export function CssTypographicUnitsTool() {
  const s = strings.pro.dizajn["css-typographic-units"];
  const [value, setValue] = useState("");
  const [fromUnit, setFromUnit] = useState<TypographicUnit>("px");
  const [rootFontSize, setRootFontSize] = useState("16");
  const [parentFontSize, setParentFontSize] = useState("16");
  const [deviceDpi, setDeviceDpi] = useState("");
  const [assetScaleId, setAssetScaleId] = useState<"1" | "2" | "3">("1");
  const assetScale: AssetScale = assetScaleId === "1" ? 1 : assetScaleId === "2" ? 2 : 3;

  const val = proParse(value);
  const root = proParse(rootFontSize);
  const parent = proParse(parentFontSize);
  const dpi = proParse(deviceDpi);
  const typed = val !== undefined;

  const result = typographicUnits({
    value: val ?? Number.NaN,
    fromUnit,
    rootFontSize: root ?? Number.NaN,
    parentFontSize: parent ?? Number.NaN,
    deviceDpi: dpi,
    assetScale,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "value"
        ? s.errorValue
        : result.reason === "rootFontSize"
          ? s.errorRootFontSize
          : result.reason === "parentFontSize"
            ? s.errorParentFontSize
            : result.reason === "assetScale"
              ? s.errorAssetScale
              : result.reason === "deviceDpi"
                ? s.errorDeviceDpi
                : s.errorFromUnit;

  const copyText = !result.ok
    ? ""
    : [
        `px: ${proNum(result.px, 4)}`,
        `${s.rem} (${s.atRoot} ${proNum(result.rootFontSizeUsed, 0)} px): ${proNum(result.rem, 4)}`,
        `${s.em} (${s.atParent} ${proNum(result.parentFontSizeUsed, 0)} px): ${proNum(result.em, 4)}`,
        `pt: ${proNum(result.pt, 4)}`,
        `pc: ${proNum(result.pc, 4)}`,
        `mm: ${proNum(result.mm, 4)}`,
        `cm: ${proNum(result.cm, 4)}`,
        `in: ${proNum(result.inch, 6)}`,
        `Q: ${proNum(result.q, 4)}`,
        `dp: ${proNum(result.dp, 4)}`,
        result.devicePx !== undefined
          ? `${s.devicePx} (${s.atDensity} ${proNum(result.deviceDpiUsed ?? Number.NaN, 0)} dpi): ${proNum(result.devicePx, 0)}`
          : "",
        `${s.assetPx1x}: ${proNum(result.assetPx1x, 0)}`,
        `${s.assetPx2x}: ${proNum(result.assetPx2x, 0)}`,
        `${s.assetPx3x}: ${proNum(result.assetPx3x, 0)}`,
        "",
        `${s.value}: ${proNum(val ?? Number.NaN, 4)} ${fromUnit}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.value} value={value} onChange={setValue} />
      <ToolSelect<TypographicUnit>
        label={s.fromUnit}
        value={fromUnit}
        onChange={setFromUnit}
        options={[
          { id: "px", label: "px" },
          { id: "rem", label: "rem" },
          { id: "em", label: "em" },
          { id: "pt", label: "pt" },
          { id: "pc", label: "pc" },
          { id: "mm", label: "mm" },
          { id: "cm", label: "cm" },
          { id: "in", label: "in" },
          { id: "Q", label: "Q" },
          { id: "dp", label: "dp" },
        ]}
      />
      <ToolInput label={s.rootFontSize} value={rootFontSize} onChange={setRootFontSize} />
      <ToolInput label={s.parentFontSize} value={parentFontSize} onChange={setParentFontSize} />
      <ToolInput label={s.deviceDpi} hint={s.deviceDpiHint} value={deviceDpi} onChange={setDeviceDpi} />
      <ToolSelect<"1" | "2" | "3">
        label={s.assetScale}
        value={assetScaleId}
        onChange={setAssetScaleId}
        options={[
          { id: "1", label: s.scale1x },
          { id: "2", label: s.scale2x },
          { id: "3", label: s.scale3x },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label="px" value={proNum(result.px, 4)} />
          <ResultRow
            label={`${s.rem} (${s.atRoot} ${proNum(result.rootFontSizeUsed, 0)} px)`}
            value={proNum(result.rem, 4)}
          />
          <ResultRow
            label={`${s.em} (${s.atParent} ${proNum(result.parentFontSizeUsed, 0)} px)`}
            value={proNum(result.em, 4)}
          />
          <ResultRow label="pt" value={proNum(result.pt, 4)} />
          <ResultRow label="pc" value={proNum(result.pc, 4)} />
          <ResultRow label="mm" value={proNum(result.mm, 4)} />
          <ResultRow label="cm" value={proNum(result.cm, 4)} />
          <ResultRow label="in" value={proNum(result.inch, 6)} />
          <ResultRow label="Q" value={proNum(result.q, 4)} />
          <ResultRow label="dp" value={proNum(result.dp, 4)} />
          {result.devicePx !== undefined && (
            <ResultRow
              label={`${s.devicePx} (${s.atDensity} ${proNum(result.deviceDpiUsed ?? Number.NaN, 0)} dpi)`}
              value={proNum(result.devicePx, 0)}
            />
          )}
          <ResultRow label={s.assetPx1x} value={proNum(result.assetPx1x, 0)} />
          <ResultRow label={s.assetPx2x} value={proNum(result.assetPx2x, 0)} />
          <ResultRow label={s.assetPx3x} value={proNum(result.assetPx3x, 0)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.value, value: `${proNum(val ?? Number.NaN, 4)} ${fromUnit}` }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Razlika boja — ΔE*ab, ΔE94 and CIEDE2000, side by side. Colour 1 is the
 * STANDARD/original and colour 2 the SAMPLE/print — ΔE94 is asymmetric, built
 * from colour 1's own chroma, so which is which changes the answer. `kL` here
 * only ever feeds ΔE00; ΔE94's own lightness factor is locked to the chosen
 * application (graphic arts 1, textiles 2) and never taken from this field.
 */
export function DeltaETool() {
  const s = strings.pro.dizajn["delta-e"];
  const [l1, setL1] = useState("");
  const [a1, setA1] = useState("");
  const [b1, setB1] = useState("");
  const [l2, setL2] = useState("");
  const [a2, setA2] = useState("");
  const [b2, setB2] = useState("");
  const [kL, setKL] = useState("1");
  const [kC, setKC] = useState("1");
  const [kH, setKH] = useState("1");
  const [de94Application, setDe94Application] = useState<DeltaE94Application>("graphicArts");

  const L1 = proParse(l1);
  const A1 = proParse(a1);
  const B1 = proParse(b1);
  const L2 = proParse(l2);
  const A2 = proParse(a2);
  const B2 = proParse(b2);
  const parsedKL = proParse(kL);
  const parsedKC = proParse(kC);
  const parsedKH = proParse(kH);
  const typed = L1 !== undefined || L2 !== undefined;

  const result = colourDifference({
    colour1: { l: L1 ?? Number.NaN, a: A1 ?? Number.NaN, b: B1 ?? Number.NaN },
    colour2: { l: L2 ?? Number.NaN, a: A2 ?? Number.NaN, b: B2 ?? Number.NaN },
    kL: parsedKL,
    kC: parsedKC,
    kH: parsedKH,
    de94Application,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "colour1"
        ? s.errorColour1
        : result.reason === "colour2"
          ? s.errorColour2
          : result.reason === "kL"
            ? s.errorKL
            : result.reason === "kC"
              ? s.errorKC
              : result.reason === "kH"
                ? s.errorKH
                : s.errorDe94Application;

  const copyText = !result.ok
    ? ""
    : [
        `ΔE*ab: ${proNum(result.deltaE76, 4)}`,
        `ΔE94: ${proNum(result.deltaE94, 4)}`,
        `ΔE00: ${proNum(result.deltaE00, 4)}`,
        `ΔL': ${proNum(result.deltaLPrime, 4)}`,
        `ΔC': ${proNum(result.deltaCPrime, 4)}`,
        `ΔH': ${proNum(result.deltaHPrime, 4)}`,
        `${s.kL94Used}: ${proNum(result.kL94Used, 0)}`,
        "",
        `${s.colour1}: L ${proNum(L1 ?? Number.NaN, 2)} a ${proNum(A1 ?? Number.NaN, 2)} b ${proNum(B1 ?? Number.NaN, 2)}`,
        `${s.colour2}: L ${proNum(L2 ?? Number.NaN, 2)} a ${proNum(A2 ?? Number.NaN, 2)} b ${proNum(B2 ?? Number.NaN, 2)}`,
        `${s.de94Application}: ${de94Application === "graphicArts" ? s.applicationGraphicArts : s.applicationTextiles}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.l1} hint={s.colour1Hint} value={l1} onChange={setL1} />
      <ToolInput label={s.a1} value={a1} onChange={setA1} />
      <ToolInput label={s.b1} value={b1} onChange={setB1} />
      <ToolInput label={s.l2} hint={s.colour2Hint} value={l2} onChange={setL2} />
      <ToolInput label={s.a2} value={a2} onChange={setA2} />
      <ToolInput label={s.b2} value={b2} onChange={setB2} />
      <ToolSelect<DeltaE94Application>
        label={s.de94Application}
        value={de94Application}
        onChange={setDe94Application}
        options={[
          { id: "graphicArts", label: s.applicationGraphicArts },
          { id: "textiles", label: s.applicationTextiles },
        ]}
      />
      <ToolInput label={s.kL} hint={s.kLHint} value={kL} onChange={setKL} />
      <ToolInput label={s.kC} value={kC} onChange={setKC} />
      <ToolInput label={s.kH} value={kH} onChange={setKH} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label="ΔE*ab" value={proNum(result.deltaE76, 4)} />
          <ResultRow label="ΔE94" value={proNum(result.deltaE94, 4)} />
          <ResultRow label="ΔE00" value={proNum(result.deltaE00, 4)} />
          <ResultRow label="ΔL'" value={proNum(result.deltaLPrime, 4)} />
          <ResultRow label="ΔC'" value={proNum(result.deltaCPrime, 4)} />
          <ResultRow label="ΔH'" value={proNum(result.deltaHPrime, 4)} />
          <ResultRow label={s.kL94Used} value={proNum(result.kL94Used, 0)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.colour1,
                value: `L ${proNum(L1 ?? Number.NaN, 2)} a ${proNum(A1 ?? Number.NaN, 2)} b ${proNum(B1 ?? Number.NaN, 2)}`,
              },
              {
                label: s.colour2,
                value: `L ${proNum(L2 ?? Number.NaN, 2)} a ${proNum(A2 ?? Number.NaN, 2)} b ${proNum(B2 ?? Number.NaN, 2)}`,
              },
              {
                label: s.de94Application,
                value: de94Application === "graphicArts" ? s.applicationGraphicArts : s.applicationTextiles,
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
 * EAN barkod — the check digit and the symbol geometry at the user's
 * magnification. The verification row states two digits and whether they
 * match — never „ispravan/neispravan kod": the tool compares two numbers, it
 * does not certify the printed symbol.
 */
export function EanBarcodeTool() {
  const s = strings.pro.dizajn["ean-barcode"];
  const [digits, setDigits] = useState("");
  const [symbology, setSymbology] = useState<Symbology>("ean13");
  const [xDimension, setXDimension] = useState("0,33");
  const [magnificationPercent, setMagnificationPercent] = useState("");
  const [verifyDigits, setVerifyDigits] = useState("");

  const xDim = proParse(xDimension);
  const magPct = proParse(magnificationPercent);
  const typed = digits.trim() !== "";

  const result = eanBarcode({
    digits: digits.trim(),
    symbology,
    xDimension: magPct === undefined ? xDim : undefined,
    magnificationPercent: magPct,
    verifyDigits: verifyDigits.trim() === "" ? undefined : verifyDigits.trim(),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "digits"
        ? s.errorDigits
        : result.reason === "xDimension"
          ? s.errorXDimension
          : result.reason === "magnificationPercent"
            ? s.errorMagnificationPercent
            : result.reason === "verifyDigits"
              ? s.errorVerifyDigits
              : s.errorSymbology;

  const copyText = !result.ok
    ? ""
    : [
        `${s.checkDigit}: ${proNum(result.checkDigit, 0)}`,
        `${s.code}: ${result.code}`,
        `${s.weightedSum}: ${proNum(result.weightedSum, 0)}`,
        `${s.xDimensionLabel}: ${proNum(result.xDimension, 3)}`,
        `${s.magnification}: ${proNum(result.magnification, 1)}`,
        `${s.totalModules}: ${proNum(result.totalModules, 0)}`,
        `${s.symbolWidth}: ${proNum(result.symbolWidth, 3)}`,
        `${s.encodedWidth}: ${proNum(result.encodedWidth, 3)}`,
        `${s.leftQuietZone}: ${proNum(result.leftQuietZone, 3)}`,
        `${s.rightQuietZone}: ${proNum(result.rightQuietZone, 3)}`,
        `${s.barHeight}: ${proNum(result.barHeight, 2)}`,
        `${s.totalHeight}: ${proNum(result.totalHeight, 2)}`,
        result.verification !== undefined
          ? `${s.verifyComputed}: ${proNum(result.verification.computed, 0)}   ${s.verifyTyped}: ${proNum(result.verification.typed, 0)}   ${s.verifyMatches}: ${result.verification.matches ? s.yes : s.no}`
          : "",
        "",
        `${s.digits}: ${digits.trim()}`,
        `${s.symbology}: ${symbology}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.digits} hint={s.digitsHint} value={digits} onChange={setDigits} mono />
      <ToolSelect<Symbology>
        label={s.symbology}
        value={symbology}
        onChange={setSymbology}
        options={[
          { id: "ean13", label: "EAN-13" },
          { id: "ean8", label: "EAN-8" },
          { id: "upca", label: "UPC-A" },
        ]}
      />
      <ToolInput label={s.xDimension} hint={s.xDimensionHint} value={xDimension} onChange={setXDimension} />
      <ToolInput
        label={s.magnificationPercent}
        hint={s.magnificationHint}
        value={magnificationPercent}
        onChange={setMagnificationPercent}
      />
      <ToolInput
        label={s.verifyDigits}
        hint={s.verifyDigitsHint}
        value={verifyDigits}
        onChange={setVerifyDigits}
        mono
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.checkDigit} value={proNum(result.checkDigit, 0)} />
          <ResultRow label={s.code} value={result.code} mono />
          <ResultRow label={s.weightedSum} value={proNum(result.weightedSum, 0)} />
          <ResultRow label={s.xDimensionLabel} value={proNum(result.xDimension, 3)} />
          <ResultRow label={s.magnification} value={proNum(result.magnification, 1)} />
          <ResultRow label={s.totalModules} value={proNum(result.totalModules, 0)} />
          <ResultRow label={s.symbolWidth} value={proNum(result.symbolWidth, 3)} />
          <ResultRow label={s.encodedWidth} value={proNum(result.encodedWidth, 3)} />
          <ResultRow label={s.leftQuietZone} value={proNum(result.leftQuietZone, 3)} />
          <ResultRow label={s.rightQuietZone} value={proNum(result.rightQuietZone, 3)} />
          <ResultRow label={s.barHeight} value={proNum(result.barHeight, 2)} />
          <ResultRow label={s.totalHeight} value={proNum(result.totalHeight, 2)} />
          {result.verification !== undefined && (
            <>
              <ResultRow label={s.verifyComputed} value={proNum(result.verification.computed, 0)} />
              <ResultRow label={s.verifyTyped} value={proNum(result.verification.typed, 0)} />
              <ResultRow
                label={s.verifyMatches}
                value={result.verification.matches ? s.yes : s.no}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.digits, value: digits.trim() },
              { label: s.symbology, value: symbology },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Metrike fonta — the negative margins that sit a text box on the capitals.
 * `lineGap` cancels out of both trims exactly, which is worth saying in the
 * copy: without it a designer expects the field to move the margins and goes
 * looking for a bug that is not there.
 */
export function FontMetricsTrimTool() {
  const s = strings.pro.dizajn["font-metrics-trim"];
  const [unitsPerEm, setUnitsPerEm] = useState("");
  const [ascender, setAscender] = useState("");
  const [descender, setDescender] = useState("");
  const [lineGap, setLineGap] = useState("0");
  const [capHeight, setCapHeight] = useState("");
  const [xHeight, setXHeight] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [lineHeight, setLineHeight] = useState("");
  const [metricSource, setMetricSource] = useState<FontMetricSource>("hhea");

  const upm = proParse(unitsPerEm);
  const asc = proParse(ascender);
  const desc = proParse(descender);
  const gap = proParse(lineGap);
  const cap = proParse(capHeight);
  const xH = proParse(xHeight);
  const fs = proParse(fontSize);
  const lh = proParse(lineHeight);
  const typed = upm !== undefined || asc !== undefined;

  const result = fontMetricsTrim({
    unitsPerEm: upm ?? Number.NaN,
    ascender: asc ?? Number.NaN,
    descender: desc ?? Number.NaN,
    lineGap: gap ?? Number.NaN,
    capHeight: cap ?? Number.NaN,
    xHeight: xH,
    fontSize: fs ?? Number.NaN,
    lineHeight: lh ?? Number.NaN,
    metricSource,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "unitsPerEm"
        ? s.errorUnitsPerEm
        : result.reason === "ascender"
          ? s.errorAscender
          : result.reason === "descender"
            ? s.errorDescender
            : result.reason === "lineGap"
              ? s.errorLineGap
              : result.reason === "capHeight"
                ? s.errorCapHeight
                : result.reason === "fontSize"
                  ? s.errorFontSize
                  : result.reason === "lineHeight"
                    ? s.errorLineHeight
                    : result.reason === "metricSource"
                      ? s.errorMetricSource
                      : s.errorXHeight;

  const sourceLabel = (source: FontMetricSource): string =>
    source === "hhea" ? s.sourceHhea : source === "os2Typo" ? s.sourceOs2Typo : s.sourceOs2Win;

  const copyText = !result.ok
    ? ""
    : [
        `${s.unitScale}: ${proNum(result.unitScale, 6)}`,
        `${s.ascenderPx}: ${proNum(result.ascenderPx, 6)}`,
        `${s.descenderPx}: ${proNum(result.descenderPx, 6)}`,
        `${s.lineGapPx}: ${proNum(result.lineGapPx, 6)}`,
        `${s.capHeightPx}: ${proNum(result.capHeightPx, 6)}`,
        result.xHeightPx !== undefined ? `${s.xHeightPx}: ${proNum(result.xHeightPx, 6)}` : "",
        `${s.contentArea}: ${proNum(result.contentArea, 6)}`,
        `${s.halfLeading}: ${proNum(result.halfLeading, 6)}`,
        `${s.trimTop}: ${proNum(result.trimTop, 6)}   (${proNum(result.trimTopEm, 6)} em)`,
        `${s.trimBottom}: ${proNum(result.trimBottom, 6)}   (${proNum(result.trimBottomEm, 6)} em)`,
        `${s.marginTop}: ${proNum(result.marginTop, 6)}`,
        `${s.marginBottom}: ${proNum(result.marginBottom, 6)}`,
        `${s.metricSourceLabel}: ${sourceLabel(result.metricSourceUsed)}`,
        "",
        `${s.fontSize}: ${proNum(fs ?? Number.NaN, 2)}`,
        `${s.lineHeight}: ${proNum(lh ?? Number.NaN, 2)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.unitsPerEm} value={unitsPerEm} onChange={setUnitsPerEm} />
      <ToolInput label={s.ascender} value={ascender} onChange={setAscender} />
      <ToolInput label={s.descender} hint={s.descenderHint} value={descender} onChange={setDescender} />
      <ToolInput label={s.lineGap} hint={s.lineGapHint} value={lineGap} onChange={setLineGap} />
      <ToolInput label={s.capHeight} value={capHeight} onChange={setCapHeight} />
      <ToolInput label={s.xHeight} value={xHeight} onChange={setXHeight} />
      <ToolInput label={s.fontSize} value={fontSize} onChange={setFontSize} />
      <ToolInput label={s.lineHeight} value={lineHeight} onChange={setLineHeight} />
      <ToolSelect<FontMetricSource>
        label={s.metricSource}
        hint={s.metricSourceHint}
        value={metricSource}
        onChange={setMetricSource}
        options={[
          { id: "hhea", label: s.sourceHhea },
          { id: "os2Typo", label: s.sourceOs2Typo },
          { id: "os2Win", label: s.sourceOs2Win },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.unitScale} value={proNum(result.unitScale, 6)} />
          <ResultRow label={s.ascenderPx} value={proNum(result.ascenderPx, 6)} />
          <ResultRow label={s.descenderPx} value={proNum(result.descenderPx, 6)} />
          <ResultRow label={s.lineGapPx} value={proNum(result.lineGapPx, 6)} />
          <ResultRow label={s.capHeightPx} value={proNum(result.capHeightPx, 6)} />
          {result.xHeightPx !== undefined && (
            <ResultRow label={s.xHeightPx} value={proNum(result.xHeightPx, 6)} />
          )}
          <ResultRow label={s.contentArea} value={proNum(result.contentArea, 6)} />
          <ResultRow label={s.halfLeading} value={proNum(result.halfLeading, 6)} />
          <ResultRow
            label={s.trimTop}
            value={`${proNum(result.trimTop, 6)} (${proNum(result.trimTopEm, 6)} em)`}
          />
          <ResultRow
            label={s.trimBottom}
            value={`${proNum(result.trimBottom, 6)} (${proNum(result.trimBottomEm, 6)} em)`}
          />
          <ResultRow label={s.marginTop} value={proNum(result.marginTop, 6)} />
          <ResultRow label={s.marginBottom} value={proNum(result.marginBottom, 6)} />
          <p className="tool__note">{s.gapCancelsNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.fontSize, value: proNum(fs ?? Number.NaN, 2) },
              { label: s.lineHeight, value: proNum(lh ?? Number.NaN, 2) },
              { label: s.metricSource, value: sourceLabel(metricSource) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * ISO formati papira — the A, B, C, RA and SRA series by the standard's own
 * halve-and-floor construction, plus the envelope and the copier percentage.
 * The nominal count is a fact about the SERIES, not a promise about cutting —
 * every step floors, so two smaller sheets are sometimes a millimetre short of
 * the larger one.
 */
export function IsoPaperSizesTool() {
  const s = strings.pro.dizajn["iso-paper-sizes"];
  const [series, setSeries] = useState<PaperSeries>("A");
  const [index, setIndex] = useState("");
  const [targetSeries, setTargetSeries] = useState<PaperSeries>("A");
  const [targetIndex, setTargetIndex] = useState("");
  const [measuredWidth, setMeasuredWidth] = useState("");
  const [measuredHeight, setMeasuredHeight] = useState("");
  const [matchTolerance, setMatchTolerance] = useState("2");

  const idx = proParse(index);
  const targetIdx = proParse(targetIndex);
  const mw = proParse(measuredWidth);
  const mh = proParse(measuredHeight);
  const tol = proParse(matchTolerance);
  const typed = idx !== undefined;

  const result = isoPaperSize({
    series,
    index: idx ?? Number.NaN,
    targetSeries,
    targetIndex: targetIdx,
    measuredWidth: mw,
    measuredHeight: mh,
    matchTolerance: tol ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "series"
        ? s.errorSeries
        : result.reason === "index"
          ? s.errorIndex
          : result.reason === "matchTolerance"
            ? s.errorMatchTolerance
            : result.reason === "targetIndex"
              ? s.errorTargetIndex
              : result.reason === "targetSeries"
                ? s.errorTargetSeries
                : result.reason === "measuredWidth"
                  ? s.errorMeasuredWidth
                  : s.errorMeasuredHeight;

  const sizeLabel = (size: { readonly series: string; readonly index: number; readonly shortEdge: number; readonly longEdge: number }): string =>
    `${size.series}${proNum(size.index, 0)} — ${proNum(size.shortEdge, 0)}×${proNum(size.longEdge, 0)} mm`;

  const seriesOptions: readonly { readonly id: PaperSeries; readonly label: string }[] = [
    { id: "A", label: "A" },
    { id: "B", label: "B" },
    { id: "C", label: "C" },
    { id: "RA", label: "RA" },
    { id: "SRA", label: "SRA" },
  ];

  const copyText = !result.ok
    ? ""
    : [
        `${s.shortEdge}: ${proNum(result.shortEdge, 0)}`,
        `${s.longEdge}: ${proNum(result.longEdge, 0)}`,
        `${s.areaM2}: ${proNum(result.areaM2, 6)}`,
        `${s.areaCm2}: ${proNum(result.areaCm2, 2)}`,
        `${s.diagonal}: ${proNum(result.diagonal, 2)}`,
        `${s.ratio}: ${proNum(result.ratio, 4)}   ${s.nominalRatio}: ${proNum(result.nominalRatio, 4)}`,
        result.envelopeFlat !== undefined ? `${s.envelopeFlat}: ${sizeLabel(result.envelopeFlat)}` : "",
        result.envelopeFoldedOnce !== undefined
          ? `${s.envelopeFoldedOnce}: ${sizeLabel(result.envelopeFoldedOnce)}`
          : "",
        result.target !== undefined ? `${s.target}: ${sizeLabel(result.target)}` : "",
        result.nominalCount !== undefined ? `${s.nominalCount}: ${proNum(result.nominalCount, 0)}` : "",
        result.copierScaleRounded !== undefined
          ? `${s.copierScale}: ${proNum(result.copierScaleRounded, 0)} % (${proNum(result.copierScale ?? Number.NaN, 2)} %)`
          : "",
        result.match !== undefined
          ? `${s.match}: ${sizeLabel(result.match)}   Δ ${proNum(result.match.deltaShort, 1)} / ${proNum(result.match.deltaLong, 1)}`
          : `${s.noMatch}`,
        "",
        `${s.series}: ${series}${proNum(idx ?? Number.NaN, 0)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<PaperSeries> label={s.series} value={series} onChange={setSeries} options={seriesOptions} />
      <ToolInput label={s.index} value={index} onChange={setIndex} />
      <ToolSelect<PaperSeries>
        label={s.targetSeries}
        value={targetSeries}
        onChange={setTargetSeries}
        options={seriesOptions}
      />
      <ToolInput label={s.targetIndex} hint={s.targetIndexHint} value={targetIndex} onChange={setTargetIndex} />
      <ToolInput label={s.measuredWidth} hint={s.measuredHint} value={measuredWidth} onChange={setMeasuredWidth} />
      <ToolInput label={s.measuredHeight} value={measuredHeight} onChange={setMeasuredHeight} />
      <ToolInput label={s.matchTolerance} value={matchTolerance} onChange={setMatchTolerance} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.shortEdge} value={proNum(result.shortEdge, 0)} />
          <ResultRow label={s.longEdge} value={proNum(result.longEdge, 0)} />
          <ResultRow label={s.areaM2} value={proNum(result.areaM2, 6)} />
          <ResultRow label={s.areaCm2} value={proNum(result.areaCm2, 2)} />
          <ResultRow label={s.diagonal} value={proNum(result.diagonal, 2)} />
          <ResultRow
            label={s.ratio}
            value={`${proNum(result.ratio, 4)} (${s.nominalRatio} ${proNum(result.nominalRatio, 4)})`}
          />
          {result.envelopeFlat !== undefined && (
            <ResultRow label={s.envelopeFlat} value={sizeLabel(result.envelopeFlat)} />
          )}
          {result.envelopeFoldedOnce !== undefined && (
            <ResultRow label={s.envelopeFoldedOnce} value={sizeLabel(result.envelopeFoldedOnce)} />
          )}
          {result.target !== undefined && <ResultRow label={s.target} value={sizeLabel(result.target)} />}
          {result.nominalCount !== undefined && (
            <ResultRow label={s.nominalCount} value={proNum(result.nominalCount, 0)} />
          )}
          {result.copierScaleRounded !== undefined && (
            <ResultRow
              label={s.copierScale}
              value={`${proNum(result.copierScaleRounded, 0)} % (${proNum(result.copierScale ?? Number.NaN, 2)} %)`}
            />
          )}
          {result.match !== undefined ? (
            <ResultRow
              label={s.match}
              value={`${sizeLabel(result.match)}   Δ ${proNum(result.match.deltaShort, 1)} / ${proNum(result.match.deltaLong, 1)}`}
            />
          ) : (
            (mw !== undefined || mh !== undefined) && <ResultRow label={s.match} value={s.noMatch} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.series, value: `${series}${proNum(idx ?? Number.NaN, 0)}` }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** A ratio preset, or a decimal number typed by hand — never a lookup only a name resolves. */
type RatioPresetId = keyof typeof TYPE_SCALE_RATIOS | "custom";

/**
 * Tipografska skala — a geometric scale, one row per step, in px, rem and pt.
 * Rounding never feeds the next step: the raw chain is what generates every
 * row, and only the displayed px column is rounded.
 */
export function ModularTypeScaleTool() {
  const s = strings.pro.dizajn["modular-type-scale"];
  const [baseSize, setBaseSize] = useState("");
  const [baseUnit, setBaseUnit] = useState<TypeScaleUnit>("px");
  const [presetId, setPresetId] = useState<RatioPresetId>("custom");
  const [ratioCustom, setRatioCustom] = useState("");
  const [stepsUp, setStepsUp] = useState("5");
  const [stepsDown, setStepsDown] = useState("2");
  const [rootFontSize, setRootFontSize] = useState("16");
  const [rounding, setRounding] = useState<TypeScaleRounding>("none");

  const bs = proParse(baseSize);
  const customRatio = proParse(ratioCustom);
  const ratio = presetId === "custom" ? customRatio : TYPE_SCALE_RATIOS[presetId];
  const up = proParse(stepsUp);
  const down = proParse(stepsDown);
  const root = proParse(rootFontSize);
  const typed = bs !== undefined;

  const result = modularTypeScale({
    baseSize: bs ?? Number.NaN,
    baseUnit,
    ratio: ratio ?? Number.NaN,
    stepsUp: up ?? Number.NaN,
    stepsDown: down ?? Number.NaN,
    rootFontSize: root ?? Number.NaN,
    rounding,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "baseSize"
        ? s.errorBaseSize
        : result.reason === "ratio"
          ? s.errorRatio
          : result.reason === "stepsUp"
            ? s.errorStepsUp
            : result.reason === "stepsDown"
              ? s.errorStepsDown
              : result.reason === "rootFontSize"
                ? s.errorRootFontSize
                : result.reason === "baseUnit"
                  ? s.errorBaseUnit
                  : s.errorRounding;

  const copyText = !result.ok
    ? ""
    : [
        `${s.basePx}: ${proNum(result.basePx, 4)}`,
        ...result.steps.map(
          (row) =>
            `${s.colStep} ${proNum(row.step, 0)}: ${proNum(row.roundedPx, 4)} px (${s.colPxRaw} ${proNum(row.px, 4)})   ${proNum(row.rem, 4)} rem   ${proNum(row.pt, 2)} pt`,
        ),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.baseSize} value={baseSize} onChange={setBaseSize} />
      <ToolSelect<TypeScaleUnit>
        label={s.baseUnit}
        value={baseUnit}
        onChange={setBaseUnit}
        options={[
          { id: "px", label: "px" },
          { id: "pt", label: "pt" },
        ]}
      />
      <ToolSelect<RatioPresetId>
        label={s.ratio}
        value={presetId}
        onChange={setPresetId}
        options={[
          { id: "octave", label: `${s.ratioOctave} (2:1)` },
          { id: "perfectFifth", label: `${s.ratioPerfectFifth} (3:2)` },
          { id: "perfectFourth", label: `${s.ratioPerfectFourth} (4:3)` },
          { id: "majorThird", label: `${s.ratioMajorThird} (5:4)` },
          { id: "minorThird", label: `${s.ratioMinorThird} (6:5)` },
          { id: "wide", label: "16:9" },
          { id: "sqrt2", label: "√2" },
          { id: "golden", label: "φ" },
          { id: "custom", label: s.ratioCustomLabel },
        ]}
      />
      {presetId === "custom" && (
        <ToolInput label={s.ratioCustomLabel} hint={s.ratioHint} value={ratioCustom} onChange={setRatioCustom} />
      )}
      <ToolInput label={s.stepsUp} value={stepsUp} onChange={setStepsUp} />
      <ToolInput label={s.stepsDown} value={stepsDown} onChange={setStepsDown} />
      <ToolInput label={s.rootFontSize} value={rootFontSize} onChange={setRootFontSize} />
      <ToolSelect<TypeScaleRounding>
        label={s.rounding}
        value={rounding}
        onChange={setRounding}
        options={[
          { id: "none", label: s.roundingNone },
          { id: "halfPixel", label: s.roundingHalf },
          { id: "pixel", label: s.roundingPixel },
          { id: "fourPixel", label: s.roundingFour },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.basePx} value={proNum(result.basePx, 4)} />
          <ToolTable
            head={[s.colStep, s.colPxRaw, s.colPxRounded, s.colRem, s.colPt]}
            rows={result.steps.map((row) => [
              proNum(row.step, 0),
              proNum(row.px, 4),
              proNum(row.roundedPx, 4),
              proNum(row.rem, 4),
              proNum(row.pt, 2),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.baseSize, value: `${proNum(bs ?? Number.NaN, 2)} ${baseUnit}` },
              { label: s.ratio, value: proNum(ratio ?? Number.NaN, 6) },
              { label: s.stepsUp, value: proNum(up ?? Number.NaN, 0) },
              { label: s.stepsDown, value: proNum(down ?? Number.NaN, 0) },
              { label: s.rootFontSize, value: proNum(root ?? Number.NaN, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Gramatura i masa papira — sheet, ream and roll, and the two reverse questions. */
export function PaperWeightTool() {
  const s = strings.pro.dizajn["paper-weight"];
  const [grammage, setGrammage] = useState("");
  const [sheetWidth, setSheetWidth] = useState("");
  const [sheetHeight, setSheetHeight] = useState("");
  const [sheetCount, setSheetCount] = useState("1");
  const [measuredMass, setMeasuredMass] = useState("");
  const [rollWidth, setRollWidth] = useState("");
  const [rollMass, setRollMass] = useState("");

  const gram = proParse(grammage);
  const sw = proParse(sheetWidth);
  const sh = proParse(sheetHeight);
  const count = proParse(sheetCount);
  const measured = proParse(measuredMass);
  const rw = proParse(rollWidth);
  const rm = proParse(rollMass);
  const typed = gram !== undefined || sw !== undefined || sh !== undefined;

  const result = paperWeight({
    grammage: gram ?? Number.NaN,
    sheetWidth: sw ?? Number.NaN,
    sheetHeight: sh ?? Number.NaN,
    sheetCount: count ?? Number.NaN,
    measuredMass: measured,
    rollWidth: rw,
    rollMass: rm,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "grammage"
        ? s.errorGrammage
        : result.reason === "sheetWidth"
          ? s.errorSheetWidth
          : result.reason === "sheetHeight"
            ? s.errorSheetHeight
            : result.reason === "sheetCount"
              ? s.errorSheetCount
              : result.reason === "measuredMass"
                ? s.errorMeasuredMass
                : result.reason === "rollWidth"
                  ? s.errorRollWidth
                  : s.errorRollMass;

  const copyText = !result.ok
    ? ""
    : [
        `${s.areaM2}: ${proNum(result.areaM2, 6)}`,
        `${s.sheetMass}: ${proNum(result.sheetMass, 4)}`,
        `${s.totalMass}: ${proNum(result.totalMass, 2)}`,
        `${s.totalMassKg}: ${proNum(result.totalMassKg, 3)}`,
        result.measuredGrammage !== undefined
          ? `${s.measuredGrammage}: ${proNum(result.measuredGrammage, 2)}`
          : "",
        result.rollLength !== undefined ? `${s.rollLength}: ${proNum(result.rollLength, 2)}` : "",
        "",
        `${s.grammage}: ${proNum(gram ?? Number.NaN, 2)}`,
        `${s.sheetWidth}: ${proNum(sw ?? Number.NaN, 2)}`,
        `${s.sheetHeight}: ${proNum(sh ?? Number.NaN, 2)}`,
        `${s.sheetCount}: ${proNum(count ?? Number.NaN, 0)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.grammage} value={grammage} onChange={setGrammage} />
      <ToolInput label={s.sheetWidth} value={sheetWidth} onChange={setSheetWidth} />
      <ToolInput label={s.sheetHeight} value={sheetHeight} onChange={setSheetHeight} />
      <ToolInput label={s.sheetCount} value={sheetCount} onChange={setSheetCount} />
      <ToolInput
        label={s.measuredMass}
        hint={s.measuredMassHint}
        value={measuredMass}
        onChange={setMeasuredMass}
      />
      <ToolInput label={s.rollWidth} value={rollWidth} onChange={setRollWidth} />
      <ToolInput label={s.rollMass} hint={s.rollMassHint} value={rollMass} onChange={setRollMass} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.areaM2} value={proNum(result.areaM2, 6)} />
          <ResultRow label={s.sheetMass} value={proNum(result.sheetMass, 4)} />
          <ResultRow label={s.totalMass} value={proNum(result.totalMass, 2)} />
          <ResultRow label={s.totalMassKg} value={proNum(result.totalMassKg, 3)} />
          {result.measuredGrammage !== undefined && (
            <ResultRow label={s.measuredGrammage} value={proNum(result.measuredGrammage, 2)} />
          )}
          {result.rollLength !== undefined && (
            <ResultRow label={s.rollLength} value={proNum(result.rollLength, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.grammage, value: proNum(gram ?? Number.NaN, 2) },
              { label: s.sheetWidth, value: proNum(sw ?? Number.NaN, 2) },
              { label: s.sheetHeight, value: proNum(sh ?? Number.NaN, 2) },
              { label: s.sheetCount, value: proNum(count ?? Number.NaN, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Rezolucija za štampu — the one identity, mm = px × 25,4 / ppi, read in three
 * directions. The artboard is rounded UP so it never comes up short of the
 * bleed it exists to hold; the plain px↔mm read-out stays rounded normally.
 * Byte counts are raw samples — no alpha, no ICC profile, no file header.
 */
export function PrintResolutionTool() {
  const s = strings.pro.dizajn["print-resolution"];
  const [direction, setDirection] = useState<PrintDirection>("pxToSize");
  const [widthPx, setWidthPx] = useState("");
  const [heightPx, setHeightPx] = useState("");
  const [resolution, setResolution] = useState("");
  const [physicalWidth, setPhysicalWidth] = useState("");
  const [physicalHeight, setPhysicalHeight] = useState("");
  const [physicalUnit, setPhysicalUnit] = useState<PhysicalUnit>("mm");
  const [bleed, setBleed] = useState("0");
  const [scaleDenominator, setScaleDenominator] = useState("1");
  const [channels, setChannels] = useState("3");
  const [bitsPerChannel, setBitsPerChannel] = useState<"1" | "8" | "16" | "32">("8");

  const wpx = proParse(widthPx);
  const hpx = proParse(heightPx);
  const res = proParse(resolution);
  const pw = proParse(physicalWidth);
  const ph = proParse(physicalHeight);
  const bl = proParse(bleed);
  const scaleDen = proParse(scaleDenominator);
  const ch = proParse(channels);
  const typed = wpx !== undefined || hpx !== undefined || pw !== undefined || ph !== undefined;
  const bits = bitsPerChannel === "1" ? 1 : bitsPerChannel === "8" ? 8 : bitsPerChannel === "16" ? 16 : 32;

  const result = printResolution({
    widthPx: wpx,
    heightPx: hpx,
    resolution: res,
    physicalWidth: pw,
    physicalHeight: ph,
    physicalUnit,
    direction,
    bleed: bl ?? Number.NaN,
    scaleDenominator: scaleDen ?? Number.NaN,
    channels: ch ?? Number.NaN,
    bitsPerChannel: bits,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "bleed"
        ? s.errorBleed
        : result.reason === "scaleDenominator"
          ? s.errorScaleDenominator
          : result.reason === "channels"
            ? s.errorChannels
            : result.reason === "bitsPerChannel"
              ? s.errorBitsPerChannel
              : result.reason === "physicalUnit"
                ? s.errorPhysicalUnit
                : result.reason === "widthPx"
                  ? s.errorWidthPx
                  : result.reason === "heightPx"
                    ? s.errorHeightPx
                    : result.reason === "resolution"
                      ? s.errorResolution
                      : result.reason === "physicalWidth"
                        ? s.errorPhysicalWidth
                        : result.reason === "physicalHeight"
                          ? s.errorPhysicalHeight
                          : s.errorDirection;

  const copyText = !result.ok
    ? ""
    : [
        `${s.widthPx}: ${proNum(result.widthPx, 0)}   ${s.heightPx}: ${proNum(result.heightPx, 0)}`,
        `${s.widthMm}: ${proNum(result.widthMm, 4)}   ${s.heightMm}: ${proNum(result.heightMm, 4)}`,
        `${s.widthIn}: ${proNum(result.widthIn, 6)}   ${s.heightIn}: ${proNum(result.heightIn, 6)}`,
        `${s.ppiWidth}: ${proNum(result.ppiWidth, 2)}   ${s.ppiHeight}: ${proNum(result.ppiHeight, 2)}   ${s.axesDisagree}: ${result.axesDisagree ? s.yes : s.no}`,
        `${s.artboardWidthMm}: ${proNum(result.artboardWidthMm, 3)}   ${s.artboardHeightMm}: ${proNum(result.artboardHeightMm, 3)}`,
        `${s.artboardWidthPx}: ${proNum(result.artboardWidthPx, 0)}   ${s.artboardHeightPx}: ${proNum(result.artboardHeightPx, 0)}`,
        `${s.finalWidthMm}: ${proNum(result.finalWidthMm, 2)}   ${s.finalHeightMm}: ${proNum(result.finalHeightMm, 2)}`,
        `${s.finalPpiWidth}: ${proNum(result.finalPpiWidth, 2)}   ${s.finalPpiHeight}: ${proNum(result.finalPpiHeight, 2)}`,
        `${s.megapixels}: ${proNum(result.megapixels, 2)}`,
        `${s.bytes}: ${proNum(result.bytes, 0)}`,
        `${s.mebibytes}: ${proNum(result.mebibytes, 2)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<PrintDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "pxToSize", label: s.directionPxToSize },
          { id: "sizeToPx", label: s.directionSizeToPx },
          { id: "effectivePpi", label: s.directionEffectivePpi },
        ]}
      />
      <ToolInput label={s.widthPx} value={widthPx} onChange={setWidthPx} />
      <ToolInput label={s.heightPx} value={heightPx} onChange={setHeightPx} />
      <ToolInput label={s.resolution} hint={s.resolutionHint} value={resolution} onChange={setResolution} />
      <ToolInput label={s.physicalWidth} value={physicalWidth} onChange={setPhysicalWidth} />
      <ToolInput label={s.physicalHeight} value={physicalHeight} onChange={setPhysicalHeight} />
      <ToolSelect<PhysicalUnit>
        label={s.physicalUnit}
        value={physicalUnit}
        onChange={setPhysicalUnit}
        options={[
          { id: "mm", label: "mm" },
          { id: "cm", label: "cm" },
          { id: "in", label: "in" },
        ]}
      />
      <ToolInput label={s.bleed} hint={s.bleedHint} value={bleed} onChange={setBleed} />
      <ToolInput label={s.scaleDenominator} hint={s.scaleDenominatorHint} value={scaleDenominator} onChange={setScaleDenominator} />
      <ToolInput label={s.channels} hint={s.channelsHint} value={channels} onChange={setChannels} />
      <ToolSelect<"1" | "8" | "16" | "32">
        label={s.bitsPerChannel}
        value={bitsPerChannel}
        onChange={setBitsPerChannel}
        options={[
          { id: "1", label: "1" },
          { id: "8", label: "8" },
          { id: "16", label: "16" },
          { id: "32", label: "32" },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.widthPx} value={proNum(result.widthPx, 0)} />
          <ResultRow label={s.heightPx} value={proNum(result.heightPx, 0)} />
          <ResultRow label={s.widthMm} value={proNum(result.widthMm, 4)} />
          <ResultRow label={s.heightMm} value={proNum(result.heightMm, 4)} />
          <ResultRow label={s.widthIn} value={proNum(result.widthIn, 6)} />
          <ResultRow label={s.heightIn} value={proNum(result.heightIn, 6)} />
          <ResultRow label={s.ppiWidth} value={proNum(result.ppiWidth, 2)} />
          <ResultRow label={s.ppiHeight} value={proNum(result.ppiHeight, 2)} />
          <ResultRow label={s.axesDisagree} value={result.axesDisagree ? s.yes : s.no} />
          <ResultRow label={s.artboardWidthMm} value={proNum(result.artboardWidthMm, 3)} />
          <ResultRow label={s.artboardHeightMm} value={proNum(result.artboardHeightMm, 3)} />
          <ResultRow label={s.artboardWidthPx} value={proNum(result.artboardWidthPx, 0)} />
          <ResultRow label={s.artboardHeightPx} value={proNum(result.artboardHeightPx, 0)} />
          <ResultRow label={s.finalWidthMm} value={proNum(result.finalWidthMm, 2)} />
          <ResultRow label={s.finalHeightMm} value={proNum(result.finalHeightMm, 2)} />
          <ResultRow label={s.finalPpiWidth} value={proNum(result.finalPpiWidth, 2)} />
          <ResultRow label={s.finalPpiHeight} value={proNum(result.finalPpiHeight, 2)} />
          <ResultRow label={s.megapixels} value={proNum(result.megapixels, 2)} />
          <ResultRow label={s.bytes} value={proNum(result.bytes, 0)} />
          <ResultRow label={s.mebibytes} value={proNum(result.mebibytes, 2)} />
          <p className="tool__note">{s.bytesNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.direction, value: direction },
              { label: s.bleed, value: proNum(bl ?? Number.NaN, 2) },
              { label: s.scaleDenominator, value: proNum(scaleDen ?? Number.NaN, 2) },
              { label: s.channels, value: proNum(ch ?? Number.NaN, 0) },
              { label: s.bitsPerChannel, value: bitsPerChannel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Yes/no as a two-option select — the drawer's kit has no checkbox primitive, and the assignment types this field as an enum anyway. */
type YesNo = "yes" | "no";

/**
 * Iskoristivost rolne — running length off a roll, upright and turned, so the
 * two can be compared. The roll count is built from whole ROWS per roll, never
 * a plain length ÷ roll length, because that would let a row straddle a splice.
 */
export function RollYieldTool() {
  const s = strings.pro.dizajn["roll-yield"];
  const [rollWidth, setRollWidth] = useState("");
  const [pieceWidth, setPieceWidth] = useState("");
  const [pieceHeight, setPieceHeight] = useState("");
  const [sideMargin, setSideMargin] = useState("0");
  const [gutter, setGutter] = useState("0");
  const [leadTrailMargin, setLeadTrailMargin] = useState("0");
  const [quantity, setQuantity] = useState("");
  const [allowRotation, setAllowRotation] = useState<YesNo>("yes");
  const [rollLength, setRollLength] = useState("");
  const [pricePerMetre, setPricePerMetre] = useState("");

  const rw = proParse(rollWidth);
  const pw = proParse(pieceWidth);
  const ph = proParse(pieceHeight);
  const side = proParse(sideMargin);
  const gut = proParse(gutter);
  const leadTrail = proParse(leadTrailMargin);
  const qty = proParse(quantity);
  const rl = proParse(rollLength);
  const price = proParse(pricePerMetre);
  const typed = rw !== undefined || pw !== undefined || ph !== undefined || qty !== undefined;

  const result = rollYield({
    rollWidth: rw ?? Number.NaN,
    pieceWidth: pw ?? Number.NaN,
    pieceHeight: ph ?? Number.NaN,
    sideMargin: side ?? Number.NaN,
    gutter: gut ?? Number.NaN,
    leadTrailMargin: leadTrail ?? Number.NaN,
    quantity: qty ?? Number.NaN,
    allowRotation: allowRotation === "yes",
    rollLength: rl,
    pricePerMetre: price,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "rollWidth"
        ? s.errorRollWidth
        : result.reason === "pieceWidth"
          ? s.errorPieceWidth
          : result.reason === "pieceHeight"
            ? s.errorPieceHeight
            : result.reason === "sideMargin"
              ? s.errorSideMargin
              : result.reason === "gutter"
                ? s.errorGutter
                : result.reason === "leadTrailMargin"
                  ? s.errorLeadTrailMargin
                  : result.reason === "quantity"
                    ? s.errorQuantity
                    : result.reason === "rollLength"
                      ? s.errorRollLength
                      : s.errorPricePerMetre;

  const layoutLines = (label: string, layout: RollLayout): readonly string[] => [
    `${label} ${s.across}: ${proNum(layout.across, 0)}`,
    `${label} ${s.leftoverWidth}: ${proNum(layout.leftoverWidth, 2)}`,
    layout.rows !== undefined ? `${label} ${s.rows}: ${proNum(layout.rows, 0)}` : "",
    layout.lengthM !== undefined ? `${label} ${s.lengthM}: ${proNum(layout.lengthM, 3)}` : "",
    layout.produced !== undefined ? `${label} ${s.produced}: ${proNum(layout.produced, 0)}` : "",
    layout.rolls !== undefined ? `${label} ${s.rolls}: ${proNum(layout.rolls, 0)}` : "",
    layout.cost !== undefined ? `${label} ${s.cost}: ${proNum(layout.cost, 2)}` : "",
  ];

  const copyText = !result.ok
    ? ""
    : [
        `${s.usableWidth}: ${proNum(result.usableWidth, 2)}`,
        ...layoutLines(s.upright, result.upright),
        ...(result.rotated !== undefined ? layoutLines(s.rotated, result.rotated) : []),
        result.shorter !== undefined
          ? `${s.shorter}: ${result.shorter === "upright" ? s.upright : result.shorter === "rotated" ? s.rotated : s.equal}`
          : "",
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.rollWidth} value={rollWidth} onChange={setRollWidth} />
      <ToolInput label={s.pieceWidth} value={pieceWidth} onChange={setPieceWidth} />
      <ToolInput label={s.pieceHeight} value={pieceHeight} onChange={setPieceHeight} />
      <ToolInput label={s.sideMargin} value={sideMargin} onChange={setSideMargin} />
      <ToolInput label={s.gutter} value={gutter} onChange={setGutter} />
      <ToolInput label={s.leadTrailMargin} value={leadTrailMargin} onChange={setLeadTrailMargin} />
      <ToolInput label={s.quantity} value={quantity} onChange={setQuantity} />
      <ToolSelect<YesNo>
        label={s.allowRotation}
        value={allowRotation}
        onChange={setAllowRotation}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />
      <ToolInput label={s.rollLength} hint={s.rollLengthHint} value={rollLength} onChange={setRollLength} />
      <ToolInput label={s.pricePerMetre} value={pricePerMetre} onChange={setPricePerMetre} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.usableWidth} value={proNum(result.usableWidth, 2)} />
          <ToolSection title={s.upright}>
            <ResultRow label={s.across} value={proNum(result.upright.across, 0)} />
            <ResultRow label={s.leftoverWidth} value={proNum(result.upright.leftoverWidth, 2)} />
            {result.upright.rows !== undefined && (
              <ResultRow label={s.rows} value={proNum(result.upright.rows, 0)} />
            )}
            {result.upright.lengthM !== undefined && (
              <ResultRow label={s.lengthM} value={proNum(result.upright.lengthM, 3)} />
            )}
            {result.upright.produced !== undefined && (
              <ResultRow label={s.produced} value={proNum(result.upright.produced, 0)} />
            )}
            {result.upright.rolls !== undefined && (
              <ResultRow label={s.rolls} value={proNum(result.upright.rolls, 0)} />
            )}
            {result.upright.cost !== undefined && (
              <ResultRow label={s.cost} value={proNum(result.upright.cost, 2)} />
            )}
          </ToolSection>
          {result.rotated !== undefined && (
            <ToolSection title={s.rotated}>
              <ResultRow label={s.across} value={proNum(result.rotated.across, 0)} />
              <ResultRow label={s.leftoverWidth} value={proNum(result.rotated.leftoverWidth, 2)} />
              {result.rotated.rows !== undefined && (
                <ResultRow label={s.rows} value={proNum(result.rotated.rows, 0)} />
              )}
              {result.rotated.lengthM !== undefined && (
                <ResultRow label={s.lengthM} value={proNum(result.rotated.lengthM, 3)} />
              )}
              {result.rotated.produced !== undefined && (
                <ResultRow label={s.produced} value={proNum(result.rotated.produced, 0)} />
              )}
              {result.rotated.rolls !== undefined && (
                <ResultRow label={s.rolls} value={proNum(result.rotated.rolls, 0)} />
              )}
              {result.rotated.cost !== undefined && (
                <ResultRow label={s.cost} value={proNum(result.rotated.cost, 2)} />
              )}
            </ToolSection>
          )}
          {result.shorter !== undefined && (
            <ResultRow
              label={s.shorter}
              value={result.shorter === "upright" ? s.upright : result.shorter === "rotated" ? s.rotated : s.equal}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rollWidth, value: proNum(rw ?? Number.NaN, 2) },
              { label: s.pieceWidth, value: proNum(pw ?? Number.NaN, 2) },
              { label: s.pieceHeight, value: proNum(ph ?? Number.NaN, 2) },
              { label: s.quantity, value: proNum(qty ?? Number.NaN, 0) },
              { label: s.allowRotation, value: allowRotation === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Montaža knjižice — which two pages sit on each side of each sheet of a
 * saddle-stitched booklet. A signature size of 4 nests the whole booklet in
 * one gathering; a larger size sections the job into separate folded
 * gatherings, padded to a full section so the fold still works.
 */
export function SaddleStitchImpositionTool() {
  const s = strings.pro.dizajn["saddle-stitch-imposition"];
  const [pageCount, setPageCount] = useState("");
  const [signatureSize, setSignatureSize] = useState<"4" | "8" | "16" | "32">("4");
  const [startPage, setStartPage] = useState("1");

  const pc = proParse(pageCount);
  const sig = signatureSize === "4" ? 4 : signatureSize === "8" ? 8 : signatureSize === "16" ? 16 : 32;
  const start = proParse(startPage);
  const typed = pc !== undefined;

  const result = saddleStitchImposition({
    pageCount: pc ?? Number.NaN,
    signatureSize: sig,
    startPage: start ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "pageCount"
        ? s.errorPageCount
        : result.reason === "signatureSize"
          ? s.errorSignatureSize
          : s.errorStartPage;

  const copyText = !result.ok
    ? ""
    : [
        `${s.paddedPages}: ${proNum(result.paddedPages, 0)}`,
        `${s.blanks}: ${proNum(result.blanks, 0)}`,
        result.firstBlankPage !== undefined ? `${s.firstBlankPage}: ${proNum(result.firstBlankPage, 0)}` : "",
        `${s.sheets}: ${proNum(result.sheets, 0)}`,
        `${s.signatures}: ${proNum(result.signatures, 0)}`,
        "",
        ...result.plan.map(
          (row) =>
            `${s.sheet} ${proNum(row.sheet, 0)} (${s.signature} ${proNum(row.signature, 0)}): ${proNum(row.frontLeft, 0)} | ${proNum(row.frontRight, 0)}   ${proNum(row.backLeft, 0)} | ${proNum(row.backRight, 0)}`,
        ),
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.pageCount} value={pageCount} onChange={setPageCount} />
      <ToolSelect<"4" | "8" | "16" | "32">
        label={s.signatureSize}
        hint={s.signatureSizeHint}
        value={signatureSize}
        onChange={setSignatureSize}
        options={[
          { id: "4", label: "4" },
          { id: "8", label: "8" },
          { id: "16", label: "16" },
          { id: "32", label: "32" },
        ]}
      />
      <ToolInput label={s.startPage} hint={s.startPageHint} value={startPage} onChange={setStartPage} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.paddedPages} value={proNum(result.paddedPages, 0)} />
          <ResultRow label={s.blanks} value={proNum(result.blanks, 0)} />
          {result.firstBlankPage !== undefined && (
            <ResultRow label={s.firstBlankPage} value={proNum(result.firstBlankPage, 0)} />
          )}
          <ResultRow label={s.sheets} value={proNum(result.sheets, 0)} />
          <ResultRow label={s.signatures} value={proNum(result.signatures, 0)} />
          <ToolTable
            head={[s.colSheet, s.colSignature, s.colFrontLeft, s.colFrontRight, s.colBackLeft, s.colBackRight]}
            rows={result.plan.map((row) => [
              proNum(row.sheet, 0),
              proNum(row.signature, 0),
              proNum(row.frontLeft, 0),
              proNum(row.frontRight, 0),
              proNum(row.backLeft, 0),
              proNum(row.backRight, 0),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pageCount, value: proNum(pc ?? Number.NaN, 0) },
              { label: s.signatureSize, value: signatureSize },
              { label: s.startPage, value: proNum(start ?? Number.NaN, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Uklapanje na tabak — how many pieces a sheet yields, upright and turned, and
 * what it wastes. Waste is reported against the whole sheet (what the
 * customer pays for) and against the usable area alone (what the layout
 * itself cost), because the two answer different questions.
 */
export function SheetImpositionTool() {
  const s = strings.pro.dizajn["sheet-imposition"];
  const [sheetWidth, setSheetWidth] = useState("");
  const [sheetHeight, setSheetHeight] = useState("");
  const [pieceWidth, setPieceWidth] = useState("");
  const [pieceHeight, setPieceHeight] = useState("");
  const [marginTop, setMarginTop] = useState("0");
  const [marginBottom, setMarginBottom] = useState("0");
  const [marginLeft, setMarginLeft] = useState("0");
  const [marginRight, setMarginRight] = useState("0");
  const [gutter, setGutter] = useState("0");
  const [allowRotation, setAllowRotation] = useState<YesNo>("yes");
  const [requiredQuantity, setRequiredQuantity] = useState("");

  const sw = proParse(sheetWidth);
  const sh = proParse(sheetHeight);
  const pw = proParse(pieceWidth);
  const ph = proParse(pieceHeight);
  const mt = proParse(marginTop);
  const mb = proParse(marginBottom);
  const ml = proParse(marginLeft);
  const mr = proParse(marginRight);
  const gut = proParse(gutter);
  const qty = proParse(requiredQuantity);
  const typed = sw !== undefined || sh !== undefined || pw !== undefined || ph !== undefined;

  const result = sheetImposition({
    sheetWidth: sw ?? Number.NaN,
    sheetHeight: sh ?? Number.NaN,
    pieceWidth: pw ?? Number.NaN,
    pieceHeight: ph ?? Number.NaN,
    marginTop: mt ?? Number.NaN,
    marginBottom: mb ?? Number.NaN,
    marginLeft: ml ?? Number.NaN,
    marginRight: mr ?? Number.NaN,
    gutter: gut ?? Number.NaN,
    allowRotation: allowRotation === "yes",
    requiredQuantity: qty,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "sheetWidth"
        ? s.errorSheetWidth
        : result.reason === "sheetHeight"
          ? s.errorSheetHeight
          : result.reason === "pieceWidth"
            ? s.errorPieceWidth
            : result.reason === "pieceHeight"
              ? s.errorPieceHeight
              : result.reason === "marginTop"
                ? s.errorMarginTop
                : result.reason === "marginBottom"
                  ? s.errorMarginBottom
                  : result.reason === "marginLeft"
                    ? s.errorMarginLeft
                    : result.reason === "marginRight"
                      ? s.errorMarginRight
                      : result.reason === "gutter"
                        ? s.errorGutter
                        : s.errorRequiredQuantity;

  const layoutLines = (label: string, layout: SheetLayout): readonly string[] => [
    `${label} ${s.across}: ${proNum(layout.across, 0)}   ${s.down}: ${proNum(layout.down, 0)}   ${s.count}: ${proNum(layout.count, 0)}`,
    `${label} ${s.leftoverWidth}: ${proNum(layout.leftoverWidth, 2)}   ${s.leftoverHeight}: ${proNum(layout.leftoverHeight, 2)}`,
  ];

  const copyText = !result.ok
    ? ""
    : [
        `${s.usableWidth}: ${proNum(result.usableWidth, 2)}   ${s.usableHeight}: ${proNum(result.usableHeight, 2)}`,
        ...layoutLines(s.upright, result.upright),
        ...(result.rotated !== undefined ? layoutLines(s.rotated, result.rotated) : []),
        `${s.best}: ${proNum(result.best.count, 0)} (${
          result.bestOrientation === "upright" ? s.upright : result.bestOrientation === "rotated" ? s.rotated : s.either
        })`,
        result.usedPercent !== undefined ? `${s.usedPercent}: ${proNum(result.usedPercent, 2)}` : "",
        result.wastePercent !== undefined ? `${s.wastePercent}: ${proNum(result.wastePercent, 2)}` : "",
        result.usedPercentOfUsable !== undefined
          ? `${s.usedPercentOfUsable}: ${proNum(result.usedPercentOfUsable, 2)}`
          : "",
        result.wastePercentOfUsable !== undefined
          ? `${s.wastePercentOfUsable}: ${proNum(result.wastePercentOfUsable, 2)}`
          : "",
        result.sheets !== undefined ? `${s.sheets}: ${proNum(result.sheets, 0)}` : "",
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.sheetWidth} value={sheetWidth} onChange={setSheetWidth} />
      <ToolInput label={s.sheetHeight} value={sheetHeight} onChange={setSheetHeight} />
      <ToolInput label={s.pieceWidth} value={pieceWidth} onChange={setPieceWidth} />
      <ToolInput label={s.pieceHeight} value={pieceHeight} onChange={setPieceHeight} />
      <ToolInput label={s.marginTop} hint={s.marginHint} value={marginTop} onChange={setMarginTop} />
      <ToolInput label={s.marginBottom} value={marginBottom} onChange={setMarginBottom} />
      <ToolInput label={s.marginLeft} value={marginLeft} onChange={setMarginLeft} />
      <ToolInput label={s.marginRight} value={marginRight} onChange={setMarginRight} />
      <ToolInput label={s.gutter} hint={s.gutterHint} value={gutter} onChange={setGutter} />
      <ToolSelect<YesNo>
        label={s.allowRotation}
        value={allowRotation}
        onChange={setAllowRotation}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />
      <ToolInput label={s.requiredQuantity} value={requiredQuantity} onChange={setRequiredQuantity} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.usableWidth} value={proNum(result.usableWidth, 2)} />
          <ResultRow label={s.usableHeight} value={proNum(result.usableHeight, 2)} />
          <ToolSection title={s.upright}>
            <ResultRow label={s.across} value={proNum(result.upright.across, 0)} />
            <ResultRow label={s.down} value={proNum(result.upright.down, 0)} />
            <ResultRow label={s.count} value={proNum(result.upright.count, 0)} />
            <ResultRow label={s.leftoverWidth} value={proNum(result.upright.leftoverWidth, 2)} />
            <ResultRow label={s.leftoverHeight} value={proNum(result.upright.leftoverHeight, 2)} />
          </ToolSection>
          {result.rotated !== undefined && (
            <ToolSection title={s.rotated}>
              <ResultRow label={s.across} value={proNum(result.rotated.across, 0)} />
              <ResultRow label={s.down} value={proNum(result.rotated.down, 0)} />
              <ResultRow label={s.count} value={proNum(result.rotated.count, 0)} />
              <ResultRow label={s.leftoverWidth} value={proNum(result.rotated.leftoverWidth, 2)} />
              <ResultRow label={s.leftoverHeight} value={proNum(result.rotated.leftoverHeight, 2)} />
            </ToolSection>
          )}
          <ResultRow
            label={s.bestOrientation}
            value={
              result.bestOrientation === "upright"
                ? s.upright
                : result.bestOrientation === "rotated"
                  ? s.rotated
                  : s.either
            }
          />
          <ResultRow label={s.best} value={proNum(result.best.count, 0)} />
          {result.usedPercent !== undefined && (
            <ResultRow label={s.usedPercent} value={proNum(result.usedPercent, 2)} />
          )}
          {result.wastePercent !== undefined && (
            <ResultRow label={s.wastePercent} value={proNum(result.wastePercent, 2)} />
          )}
          {result.usedPercentOfUsable !== undefined && (
            <ResultRow label={s.usedPercentOfUsable} value={proNum(result.usedPercentOfUsable, 2)} />
          )}
          {result.wastePercentOfUsable !== undefined && (
            <ResultRow label={s.wastePercentOfUsable} value={proNum(result.wastePercentOfUsable, 2)} />
          )}
          {result.sheets !== undefined && <ResultRow label={s.sheets} value={proNum(result.sheets, 0)} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sheetWidth, value: proNum(sw ?? Number.NaN, 2) },
              { label: s.sheetHeight, value: proNum(sh ?? Number.NaN, 2) },
              { label: s.pieceWidth, value: proNum(pw ?? Number.NaN, 2) },
              { label: s.pieceHeight, value: proNum(ph ?? Number.NaN, 2) },
              { label: s.allowRotation, value: allowRotation === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Every tool this pack registers, keyed exactly as the assignment spells its id. */
export const DIZAJN_SURFACES: Readonly<Record<string, ComponentType>> = {
  "aspect-ratio-fit": AspectRatioFitTool,
  "baseline-rhythm": BaselineRhythmTool,
  "book-spine": BookSpineTool,
  "column-grid": ColumnGridTool,
  copyfitting: CopyfittingTool,
  "css-typographic-units": CssTypographicUnitsTool,
  "delta-e": DeltaETool,
  "ean-barcode": EanBarcodeTool,
  "font-metrics-trim": FontMetricsTrimTool,
  "iso-paper-sizes": IsoPaperSizesTool,
  "modular-type-scale": ModularTypeScaleTool,
  "paper-weight": PaperWeightTool,
  "print-resolution": PrintResolutionTool,
  "roll-yield": RollYieldTool,
  "saddle-stitch-imposition": SaddleStitchImpositionTool,
  "sheet-imposition": SheetImpositionTool,
};
