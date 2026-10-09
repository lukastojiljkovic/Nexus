import {
  cuttingSpeed,
  feedPerTooth,
  metalWeight,
  weldThroatLeg,
  type MetalShape,
} from "@nexus/core/pro/metal";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  reasonField,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
} from "./shared.js";

/**
 * „Obrada metala" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/metal.ts`'s. Three of the pack's six tools
 * (`tap-drill-size`, `sheet-metal-bend`, `weld-consumable`) are drawn by
 * `pro/zanat.tsx`, because that is the file that owns their surfaces.
 *
 * **`metal-weight` is `life-safety` and prints a mass.** No surface here says
 * whether a lift is safe or a chain is strong enough; the density is the user's
 * own figure and `massPerPiece` travels with it.
 */

/* -------------------------------------------------------------------------- */
/* cutting-speed                                                              */
/* -------------------------------------------------------------------------- */

export function CuttingSpeedTool() {
  const s = strings.pro.metal["cutting-speed"];
  const [diameterText, setDiameterText] = useState("");
  const [mode, setMode] = useState<"fromSpeed" | "fromRpm">("fromSpeed");
  const [speedText, setSpeedText] = useState("");
  const [rpmText, setRpmText] = useState("");

  const result = cuttingSpeed({
    diameterMm: proParse(diameterText) ?? Number.NaN,
    mode,
    cuttingSpeedMPerMin: mode === "fromSpeed" ? proParse(speedText) : undefined,
    spindleSpeedRpm: mode === "fromRpm" ? proParse(rpmText) : undefined,
  });

  const typed = proParse(diameterText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    diameterMm: s.errorDiameter,
    mode: s.errorMode,
    known: s.errorKnown,
    cuttingSpeed: s.errorSpeed,
    spindleSpeed: s.errorRpm,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.diameter} hint={s.diameterHint} value={diameterText} onChange={setDiameterText} />
      <ToolSelect<"fromSpeed" | "fromRpm">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "fromSpeed", label: s.modeFromSpeed },
          { id: "fromRpm", label: s.modeFromRpm },
        ]}
      />
      {mode === "fromSpeed" ? (
        <ToolInput label={s.cuttingSpeed} hint={s.cuttingSpeedHint} value={speedText} onChange={setSpeedText} />
      ) : (
        <ToolInput label={s.spindleSpeed} hint={s.spindleSpeedHint} value={rpmText} onChange={setRpmText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.resultRpm} value={proUnit(proNum(result.spindleSpeedRpm, 1), s.unitRpm)} />
            <ResultRow
              label={s.resultSpeed}
              value={proUnit(proNum(result.cuttingSpeedMPerMin, 2), s.unitMPerMin)}
            />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.diameter,
                value: proUnit(proNum(proParse(diameterText) ?? 0, 2), s.unitMm),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* feed-per-tooth                                                             */
/* -------------------------------------------------------------------------- */

export function FeedPerToothTool() {
  const s = strings.pro.metal["feed-per-tooth"];
  const [teethText, setTeethText] = useState("");
  const [rpmText, setRpmText] = useState("");
  const [mode, setMode] = useState<"fromPerTooth" | "fromFeedRate">("fromPerTooth");
  const [perToothText, setPerToothText] = useState("");
  const [rateText, setRateText] = useState("");

  const result = feedPerTooth({
    toothCount: proParse(teethText) ?? Number.NaN,
    spindleSpeedRpm: proParse(rpmText) ?? Number.NaN,
    mode,
    feedPerToothMm: mode === "fromPerTooth" ? proParse(perToothText) : undefined,
    feedRateMmPerMin: mode === "fromFeedRate" ? proParse(rateText) : undefined,
  });

  const typed = proParse(teethText) !== undefined || proParse(rpmText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    toothCount: s.errorTeeth,
    spindleSpeed: s.errorSpindle,
    mode: s.errorMode,
    known: s.errorKnown,
    feedPerTooth: s.errorPerTooth,
    feedRate: s.errorRate,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.teeth} hint={s.teethHint} value={teethText} onChange={setTeethText} />
      <ToolInput label={s.spindleSpeed} hint={s.spindleSpeedHint} value={rpmText} onChange={setRpmText} />
      <ToolSelect<"fromPerTooth" | "fromFeedRate">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "fromPerTooth", label: s.modeFromPerTooth },
          { id: "fromFeedRate", label: s.modeFromFeedRate },
        ]}
      />
      {mode === "fromPerTooth" ? (
        <ToolInput label={s.feedPerTooth} hint={s.feedPerToothHint} value={perToothText} onChange={setPerToothText} />
      ) : (
        <ToolInput label={s.feedRate} hint={s.feedRateHint} value={rateText} onChange={setRateText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.resultPerTooth} value={proUnit(proNum(result.feedPerToothMm, 4), s.unitMmPerTooth)} />
            <ResultRow label={s.resultPerRev} value={proUnit(proNum(result.feedPerRevolutionMm, 3), s.unitMmPerRev)} />
            <ResultRow label={s.resultRate} value={proUnit(proNum(result.feedRateMmPerMin, 1), s.unitMmPerMin)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.teeth, value: proNum(proParse(teethText) ?? 0, 0) },
              {
                label: s.spindleSpeed,
                value: proUnit(proNum(proParse(rpmText) ?? 0, 1), s.unitRpm),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* metal-weight                                                               */
/* -------------------------------------------------------------------------- */

const SHAPES: readonly { readonly id: MetalShape; readonly label: string }[] = [
  { id: "round", label: "round" },
  { id: "square", label: "square" },
  { id: "hex", label: "hex" },
  { id: "roundTube", label: "roundTube" },
  { id: "boxTube", label: "boxTube" },
  { id: "rect", label: "rect" },
];

export function MetalWeightTool() {
  const s = strings.pro.metal["metal-weight"];
  const [shape, setShape] = useState<MetalShape>("round");
  const [sizeText, setSizeText] = useState("");
  const [secondText, setSecondText] = useState("");
  const [wallText, setWallText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [densityText, setDensityText] = useState("");

  const usesSecond = shape === "rect";
  const usesWall = shape === "roundTube" || shape === "boxTube";
  const result = metalWeight({
    shape,
    sizeMm: proParse(sizeText) ?? Number.NaN,
    secondSizeMm: usesSecond ? proParse(secondText) : undefined,
    wallMm: usesWall ? proParse(wallText) : undefined,
    lengthM: proParse(lengthText) ?? Number.NaN,
    pieces: proParse(piecesText) ?? 1,
    densityKgM3: proParse(densityText) ?? Number.NaN,
  });

  const typed = proParse(sizeText) !== undefined || proParse(lengthText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    shape: s.errorShape,
    sizeMm: s.errorSize,
    secondSize: s.errorSecondSize,
    wall: s.errorWall,
    lengthM: s.errorLength,
    pieces: s.errorPieces,
    density: s.errorDensity,
    known: s.errorKnown,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolSelect<MetalShape>
        label={s.shape}
        hint={s.shapeHint}
        value={shape}
        onChange={setShape}
        options={SHAPES.map((entry) => ({
          id: entry.id,
          label:
            entry.id === "round"
              ? s.shapeRound
              : entry.id === "square"
                ? s.shapeSquare
                : entry.id === "hex"
                  ? s.shapeHex
                  : entry.id === "roundTube"
                    ? s.shapeRoundTube
                    : entry.id === "boxTube"
                      ? s.shapeBoxTube
                      : s.shapeRect,
        }))}
      />
      <ToolInput label={s.size} hint={s.sizeHint} value={sizeText} onChange={setSizeText} />
      {usesSecond && (
        <ToolInput label={s.secondSize} hint={s.secondSizeHint} value={secondText} onChange={setSecondText} />
      )}
      {usesWall && <ToolInput label={s.wall} hint={s.wallHint} value={wallText} onChange={setWallText} />}
      <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />
      <ToolInput label={s.pieces} value={piecesText} onChange={setPiecesText} />
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.section} value={proUnit(proNum(result.crossSectionMm2, 2), s.unitMm2)} />
            <ResultRow label={s.volume} value={proUnit(proNum(result.volumePerPieceM3, 6), s.unitM3)} />
            <ResultRow label={s.massPerMetre} value={proUnit(proNum(result.massPerMetre, 4), s.unitKgPerM)} />
            <ResultRow label={s.massPerPiece} value={proUnit(proNum(result.massPerPiece, 3), s.unitKg)} />
            <ResultRow label={s.totalMass} value={proUnit(proNum(result.totalMass, 3), s.unitKg)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(proParse(lengthText) ?? 0, 3), s.unitM) },
              { label: s.pieces, value: proNum(proParse(piecesText) ?? 1, 0) },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* weld-throat-leg                                                            */
/* -------------------------------------------------------------------------- */

export function WeldThroatLegTool() {
  const s = strings.pro.metal["weld-throat-leg"];
  const [measure, setMeasure] = useState<"leg" | "throat">("leg");
  const [legText, setLegText] = useState("");
  const [leg2Text, setLeg2Text] = useState("");
  const [throatText, setThroatText] = useState("");
  const [densityText, setDensityText] = useState("");

  const result = weldThroatLeg({
    measure,
    legMm: measure === "leg" ? proParse(legText) : undefined,
    leg2Mm: measure === "leg" ? proParse(leg2Text) : undefined,
    throatMm: measure === "throat" ? proParse(throatText) : undefined,
    densityKgM3: proParse(densityText),
  });

  const typed = proParse(legText) !== undefined || proParse(throatText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    measure: s.errorMeasure,
    leg: s.errorLeg,
    leg2: s.errorLeg2,
    throat: s.errorThroat,
    density: s.errorDensity,
    known: s.errorKnown,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolSelect<"leg" | "throat">
        label={s.measure}
        value={measure}
        onChange={setMeasure}
        options={[
          { id: "leg", label: s.measureLeg },
          { id: "throat", label: s.measureThroat },
        ]}
      />
      {measure === "leg" ? (
        <>
          <ToolInput label={s.leg} hint={s.legHint} value={legText} onChange={setLegText} />
          <ToolInput label={s.leg2} hint={s.leg2Hint} value={leg2Text} onChange={setLeg2Text} />
        </>
      ) : (
        <ToolInput label={s.throat} hint={s.throatHint} value={throatText} onChange={setThroatText} />
      )}
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.resultLeg} value={proUnit(proNum(result.legMm, 3), s.unitMm)} />
            <ResultRow label={s.resultLeg2} value={proUnit(proNum(result.leg2Mm, 3), s.unitMm)} />
            <ResultRow label={s.resultThroat} value={proUnit(proNum(result.throatMm, 3), s.unitMm)} />
            <ResultRow label={s.resultArea} value={proUnit(proNum(result.areaMm2, 2), s.unitMm2)} />
            <ResultRow
              label={s.resultMass}
              value={proUnit(proNum(result.massPerMetre, 3), s.unitKgPerM)}
            />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.density, value: proUnit(proNum(proParse(densityText) ?? 7850, 0), "kg/m³") },
            ]}
          />
        </>
      )}
    </>
  );
}

/** Every surface this file holds, by tool id — held to the registrations by `proToolSurfaces.test.ts`. */
export const METAL_SURFACES: Readonly<Record<string, ComponentType>> = {
  "cutting-speed": CuttingSpeedTool,
  "feed-per-tooth": FeedPerToothTool,
  "metal-weight": MetalWeightTool,
  "weld-throat-leg": WeldThroatLegTool,
};
