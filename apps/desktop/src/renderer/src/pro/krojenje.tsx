import {
  biasBinding,
  buttonSpacing,
  circleSkirt,
  gatherRatio,
  seamAllowance,
  type SkirtCircle,
} from "@nexus/core/pro/krojenje";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  reasonField,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolSection,
  ToolSelect,
  ToolTable,
} from "./shared.js";

/**
 * „Krojenje" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/krojenje.ts`'s. `fabric-yardage-repeat` is
 * drawn by `pro/zanat.tsx`, which owns it.
 *
 * **Nothing here is a trade rule.** A radius, an allowance, an area, a ratio
 * and a spacing are divisions; the one figure that is a convention, the gather
 * ratio, comes from the user's own two lengths and is not compared with a range.
 */

/* -------------------------------------------------------------------------- */
/* circle-skirt                                                               */
/* -------------------------------------------------------------------------- */

export function CircleSkirtTool() {
  const s = strings.pro.krojenje["circle-skirt"];
  const [waistText, setWaistText] = useState("");
  const [circle, setCircle] = useState<SkirtCircle>("full");
  const [lengthText, setLengthText] = useState("");

  const result = circleSkirt({
    waistCm: proParse(waistText) ?? Number.NaN,
    circle,
    lengthCm: proParse(lengthText) ?? Number.NaN,
  });
  const typed = proParse(waistText) !== undefined || proParse(lengthText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    waist: s.errorWaist,
    length: s.errorLength,
    circle: s.errorCircle,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.waist} hint={s.waistHint} value={waistText} onChange={setWaistText} />
      <ToolSelect<SkirtCircle>
        label={s.circle}
        value={circle}
        onChange={setCircle}
        options={[
          { id: "full", label: s.circleFull },
          { id: "half", label: s.circleHalf },
          { id: "quarter", label: s.circleQuarter },
        ]}
      />
      <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.waistRadius} value={proUnit(proNum(result.waistRadiusCm, 3), s.unitCm)} />
            <ResultRow label={s.hemRadius} value={proUnit(proNum(result.hemRadiusCm, 3), s.unitCm)} />
            <ResultRow label={s.waistArc} value={proUnit(proNum(result.waistArcCm, 2), s.unitCm)} />
            <ResultRow
              label={s.hemCircumference}
              value={proUnit(proNum(result.hemCircumferenceCm, 2), s.unitCm)}
            />
            <ResultRow label={s.fabricSquare} value={proUnit(proNum(result.fabricSquareCm, 2), s.unitCm)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* seam-allowance                                                             */
/* -------------------------------------------------------------------------- */

export function SeamAllowanceTool() {
  const s = strings.pro.krojenje["seam-allowance"];
  const [mode, setMode] = useState<"toCut" | "toFinished">("toCut");
  const [dimensionText, setDimensionText] = useState("");
  const [seamsText, setSeamsText] = useState("");
  const [allowanceText, setAllowanceText] = useState("");

  const result = seamAllowance({
    mode,
    dimensionCm: proParse(dimensionText) ?? Number.NaN,
    seams: proParse(seamsText) ?? Number.NaN,
    allowanceCm: proParse(allowanceText) ?? Number.NaN,
  });
  const typed = proParse(dimensionText) !== undefined || proParse(allowanceText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    mode: s.errorMode,
    dimension: s.errorDimension,
    seams: s.errorSeams,
    allowance: s.errorAllowance,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolSelect<"toCut" | "toFinished">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "toCut", label: s.modeToCut },
          { id: "toFinished", label: s.modeToFinished },
        ]}
      />
      <ToolInput label={s.dimension} hint={s.dimensionHint} value={dimensionText} onChange={setDimensionText} />
      <ToolInput label={s.seams} hint={s.seamsHint} value={seamsText} onChange={setSeamsText} />
      <ToolInput label={s.allowance} hint={s.allowanceHint} value={allowanceText} onChange={setAllowanceText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.cut} value={proUnit(proNum(result.cutCm, 3), s.unitCm)} />
            <ResultRow label={s.finished} value={proUnit(proNum(result.finishedCm, 3), s.unitCm)} />
            <ResultRow label={s.added} value={proUnit(proNum(result.totalAddedCm, 3), s.unitCm)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* bias-binding                                                               */
/* -------------------------------------------------------------------------- */

export function BiasBindingTool() {
  const s = strings.pro.krojenje["bias-binding"];
  const [squareText, setSquareText] = useState("");
  const [widthText, setWidthText] = useState("");

  const result = biasBinding({
    squareCm: proParse(squareText) ?? Number.NaN,
    stripWidthCm: proParse(widthText) ?? Number.NaN,
  });
  const typed = proParse(squareText) !== undefined || proParse(widthText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    square: s.errorSquare,
    stripWidth: s.errorWidth,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.square} hint={s.squareHint} value={squareText} onChange={setSquareText} />
      <ToolInput label={s.width} hint={s.widthHint} value={widthText} onChange={setWidthText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.length} value={proUnit(proNum(result.stripLengthCm, 2), s.unitCm)} />
            <ResultRow label={s.lengthM} value={proUnit(proNum(result.stripLengthM, 3), s.unitM)} />
            <ResultRow label={s.strips} value={proNum(result.stripCount, 0)} />
            <ResultRow label={s.diagonal} value={proUnit(proNum(result.diagonalCm, 3), s.unitCm)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* gather-ratio                                                               */
/* -------------------------------------------------------------------------- */

export function GatherRatioTool() {
  const s = strings.pro.krojenje["gather-ratio"];
  const [flatText, setFlatText] = useState("");
  const [setText, setSetText] = useState("");

  const result = gatherRatio({
    flatLengthCm: proParse(flatText) ?? Number.NaN,
    setLengthCm: proParse(setText) ?? Number.NaN,
  });
  const typed = proParse(flatText) !== undefined || proParse(setText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    flatLength: s.errorFlat,
    setLength: s.errorSet,
  };
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "flatLength" && proParse(flatText) !== undefined && proParse(setText) !== undefined
        ? s.errorFlatTooShort
        : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.flat} hint={s.flatHint} value={flatText} onChange={setFlatText} />
      <ToolInput label={s.set} hint={s.setHint} value={setText} onChange={setSetText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.ratio} value={proNum(result.ratio, 3)} />
            <ResultRow label={s.ease} value={proUnit(proNum(result.easePerCm, 3), s.unitCm)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* button-spacing                                                             */
/* -------------------------------------------------------------------------- */

export function ButtonSpacingTool() {
  const s = strings.pro.krojenje["button-spacing"];
  const [lengthText, setLengthText] = useState("");
  const [buttonsText, setButtonsText] = useState("");

  const result = buttonSpacing({
    lengthCm: proParse(lengthText) ?? Number.NaN,
    buttons: proParse(buttonsText) ?? Number.NaN,
  });
  const typed = proParse(lengthText) !== undefined || proParse(buttonsText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    length: s.errorLength,
    buttons: s.errorButtons,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />
      <ToolInput label={s.buttons} hint={s.buttonsHint} value={buttonsText} onChange={setButtonsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.spacing} value={proUnit(proNum(result.spacingCm, 3), s.unitCm)} />
            <ToolTable
              head={[s.colButton, s.colPosition]}
              rows={result.positionsCm.map((position, index) => [
                `${index + 1}`,
                proUnit(proNum(position, 2), s.unitCm),
              ])}
            />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
        </>
      )}
    </>
  );
}

/** Every surface this file holds, by tool id — held to the registrations by `proToolSurfaces.test.ts`. */
export const KROJENJE_SURFACES: Readonly<Record<string, ComponentType>> = {
  "circle-skirt": CircleSkirtTool,
  "seam-allowance": SeamAllowanceTool,
  "bias-binding": BiasBindingTool,
  "gather-ratio": GatherRatioTool,
  "button-spacing": ButtonSpacingTool,
};
