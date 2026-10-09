import {
  airFuelRatio,
  compressionRatio,
  engineDisplacement,
  injectorFlow,
  meanPistonSpeed,
  wheelOffset,
  type AfrMode,
} from "@nexus/core/pro/auto";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  reasonField,
  ResultRow,
  ToolAgainstLimit,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
} from "./shared.js";

/**
 * „Auto" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/auto.ts`'s. This file parses fields with
 * `proParse`, hands the numbers to the core function and prints what comes back.
 *
 * **Two tools print a figure beside a limit the user typed and say nothing about
 * the pair.** Mean piston speed and compression ratio are quantities; whether a
 * build's limit or a fuel's tolerance applies is the person at the engine's call.
 */

/* -------------------------------------------------------------------------- */
/* engine-displacement                                                          */
/* -------------------------------------------------------------------------- */

export function EngineDisplacementTool() {
  const s = strings.pro.auto["engine-displacement"];
  const [boreText, setBoreText] = useState("");
  const [strokeText, setStrokeText] = useState("");
  const [cylindersText, setCylindersText] = useState("");

  const typed = [boreText, strokeText, cylindersText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = engineDisplacement({
    boreMm: proParse(boreText) ?? Number.NaN,
    strokeMm: proParse(strokeText) ?? Number.NaN,
    cylinders: proParse(cylindersText) ?? Number.NaN,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "bore"
        ? s.errorBore
        : field === "stroke"
          ? s.errorStroke
          : s.errorCylinders;

  const copyText = !result.ok
    ? ""
    : [
        `${s.perCylinder}: ${proUnit(proNum(result.perCylinderCc, 2), s.unitCc)}`,
        `${s.total}: ${proUnit(proNum(result.totalCc, 2), s.unitCc)}`,
        `${s.totalLitres}: ${proUnit(proNum(result.totalLitres, 3), s.unitL)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.bore} value={boreText} onChange={setBoreText} />
      <ToolInput label={s.stroke} value={strokeText} onChange={setStrokeText} />
      <ToolInput label={s.cylinders} value={cylindersText} onChange={setCylindersText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.perCylinder} value={proUnit(proNum(result.perCylinderCc, 2), s.unitCc)} />
          <ResultRow label={s.total} value={proUnit(proNum(result.totalCc, 2), s.unitCc)} />
          <ResultRow label={s.totalLitres} value={proUnit(proNum(result.totalLitres, 3), s.unitL)} />
          <ResultRow label={s.boreStrokeRatio} value={proNum(result.boreStrokeRatio, 4)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.bore, value: proUnit(proNum(proParse(boreText) ?? 0, 2), s.unitMm) },
              { label: s.stroke, value: proUnit(proNum(proParse(strokeText) ?? 0, 2), s.unitMm) },
              { label: s.cylinders, value: proNum(proParse(cylindersText) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* compression-ratio                                                            */
/* -------------------------------------------------------------------------- */

export function CompressionRatioTool() {
  const s = strings.pro.auto["compression-ratio"];
  const [boreText, setBoreText] = useState("");
  const [strokeText, setStrokeText] = useState("");
  const [chamberText, setChamberText] = useState("");
  const [gasketText, setGasketText] = useState("");
  const [deckText, setDeckText] = useState("");
  const [pistonText, setPistonText] = useState("");

  const typed = [boreText, strokeText, chamberText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = compressionRatio({
    boreMm: proParse(boreText) ?? Number.NaN,
    strokeMm: proParse(strokeText) ?? Number.NaN,
    chamberVolumeCc: proParse(chamberText) ?? Number.NaN,
    gasketVolumeCc: proParse(gasketText),
    deckVolumeCc: proParse(deckText),
    pistonVolumeCc: proParse(pistonText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "bore"
        ? s.errorBore
        : field === "stroke"
          ? s.errorStroke
          : field === "chamberVolume"
            ? s.errorChamber
            : field === "gasketVolume"
              ? s.errorGasket
              : field === "deckVolume"
                ? s.errorDeck
                : field === "pistonVolume"
                  ? s.errorPiston
                  : s.errorClearance;

  const copyText = !result.ok
    ? ""
    : [
        `${s.compressionRatio}: ${proNum(result.compressionRatio, 3)}`,
        `${s.sweptVolume}: ${proUnit(proNum(result.sweptVolumeCc, 2), s.unitCc)}`,
        `${s.clearanceVolume}: ${proUnit(proNum(result.clearanceVolumeCc, 2), s.unitCc)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.bore} value={boreText} onChange={setBoreText} />
      <ToolInput label={s.stroke} value={strokeText} onChange={setStrokeText} />
      <ToolInput label={s.chamberVolume} value={chamberText} onChange={setChamberText} />
      <ToolInput label={s.gasketVolume} hint={s.gasketHint} value={gasketText} onChange={setGasketText} />
      <ToolInput label={s.deckVolume} hint={s.deckHint} value={deckText} onChange={setDeckText} />
      <ToolInput label={s.pistonVolume} hint={s.pistonHint} value={pistonText} onChange={setPistonText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.compressionRatio} value={proNum(result.compressionRatio, 3)} />
          <ResultRow label={s.sweptVolume} value={proUnit(proNum(result.sweptVolumeCc, 2), s.unitCc)} />
          <ResultRow label={s.clearanceVolume} value={proUnit(proNum(result.clearanceVolumeCc, 2), s.unitCc)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.chamberVolume, value: proUnit(proNum(proParse(chamberText) ?? 0, 2), s.unitCc) },
              { label: s.pistonVolume, value: proUnit(proNum(proParse(pistonText) ?? 0, 2), s.unitCc) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* mean-piston-speed                                                            */
/* -------------------------------------------------------------------------- */

export function MeanPistonSpeedTool() {
  const s = strings.pro.auto["mean-piston-speed"];
  const [strokeText, setStrokeText] = useState("");
  const [rpmText, setRpmText] = useState("");
  const [limitText, setLimitText] = useState("");

  const typed = [strokeText, rpmText].some((text) => proParse(text) !== undefined);
  const result = meanPistonSpeed({
    strokeMm: proParse(strokeText) ?? Number.NaN,
    rpm: proParse(rpmText) ?? Number.NaN,
    limitMs: proParse(limitText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "stroke"
        ? s.errorStroke
        : field === "rpm"
          ? s.errorRpm
          : s.errorLimit;

  const limit = proParse(limitText);
  const copyText = !result.ok
    ? ""
    : [
        `${s.speed}: ${proUnit(proNum(result.meanPistonSpeedMs, 3), s.unitMs)}`,
        `${s.speedFpm}: ${proUnit(proNum(result.meanPistonSpeedFpm, 0), s.unitFpm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.stroke} value={strokeText} onChange={setStrokeText} />
      <ToolInput label={s.rpm} value={rpmText} onChange={setRpmText} />
      <ToolInput label={s.limit} hint={s.limitHint} value={limitText} onChange={setLimitText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ToolAgainstLimit
            label={s.speed}
            value={proUnit(proNum(result.meanPistonSpeedMs, 3), s.unitMs)}
            limitLabel={s.limit}
            limit={limit === undefined ? undefined : proUnit(proNum(limit, 2), s.unitMs)}
            ratioLabel={s.speedRatio}
            ratio={proRatio(result.speedRatio)}
          />
          <ResultRow label={s.speedPer1000Rpm} value={proUnit(proNum(result.speedPer1000RpmMs, 3), s.unitMs)} />
          <ResultRow label={s.speedFpm} value={proUnit(proNum(result.meanPistonSpeedFpm, 0), s.unitFpm)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.stroke, value: proUnit(proNum(proParse(strokeText) ?? 0, 2), s.unitMm) },
              { label: s.rpm, value: proUnit(proNum(proParse(rpmText) ?? 0, 0), s.unitRpm) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* injector-flow                                                                */
/* -------------------------------------------------------------------------- */

export function InjectorFlowTool() {
  const s = strings.pro.auto["injector-flow"];
  const [powerText, setPowerText] = useState("");
  const [bsfcText, setBsfcText] = useState("");
  const [cylindersText, setCylindersText] = useState("");
  const [dutyText, setDutyText] = useState("");
  const [densityText, setDensityText] = useState("");

  const typed = [powerText, bsfcText, cylindersText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = injectorFlow({
    targetPowerKw: proParse(powerText) ?? Number.NaN,
    bsfcGKwh: proParse(bsfcText) ?? Number.NaN,
    cylinders: proParse(cylindersText) ?? Number.NaN,
    maxDutyPercent: proParse(dutyText) ?? Number.NaN,
    fuelDensityKgPerL: proParse(densityText) ?? Number.NaN,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "targetPower"
        ? s.errorPower
        : field === "bsfc"
          ? s.errorBsfc
          : field === "cylinders"
            ? s.errorCylinders
            : field === "duty"
              ? s.errorDuty
              : s.errorDensity;

  const copyText = !result.ok
    ? ""
    : [
        `${s.injectorFlowCcPerMin}: ${proUnit(proNum(result.injectorFlowCcPerMin, 2), s.unitCcPerMin)}`,
        `${s.injectorFlowLbPerH}: ${proUnit(proNum(result.injectorFlowLbPerH, 2), s.unitLbPerH)}`,
        `${s.fuelMassFlow}: ${proUnit(proNum(result.fuelMassFlowKgPerH, 3), s.unitKgPerH)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.targetPower} value={powerText} onChange={setPowerText} />
      <ToolInput label={s.bsfc} hint={s.bsfcHint} value={bsfcText} onChange={setBsfcText} />
      <ToolInput label={s.cylinders} value={cylindersText} onChange={setCylindersText} />
      <ToolInput label={s.duty} hint={s.dutyHint} value={dutyText} onChange={setDutyText} />
      <ToolInput label={s.fuelDensity} hint={s.fuelDensityHint} value={densityText} onChange={setDensityText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.fuelMassFlow} value={proUnit(proNum(result.fuelMassFlowKgPerH, 3), s.unitKgPerH)} />
          <ResultRow label={s.fuelVolumeFlow} value={proUnit(proNum(result.fuelVolumeFlowLPerH, 3), s.unitLPerH)} />
          <ResultRow label={s.injectorFlow} value={proUnit(proNum(result.injectorFlowLPerH, 3), s.unitLPerH)} />
          <ResultRow
            label={s.injectorFlowCcPerMin}
            value={proUnit(proNum(result.injectorFlowCcPerMin, 2), s.unitCcPerMin)}
          />
          <ResultRow label={s.injectorFlowLbPerH} value={proUnit(proNum(result.injectorFlowLbPerH, 2), s.unitLbPerH)} />
          <ResultRow label={s.dutyUsed} value={`${proNum(result.dutyPercentUsed, 1)}%`} />
          <p className="nx-hint nx-hint--prose">{s.sizingNote}</p>
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.bsfc, value: proUnit(proNum(proParse(bsfcText) ?? 0, 1), s.unitGKwh) },
              { label: s.fuelDensity, value: proUnit(proNum(proParse(densityText) ?? 0, 3), s.unitKgPerL) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* air-fuel-ratio                                                               */
/* -------------------------------------------------------------------------- */

const AFR_MODES: readonly AfrMode[] = ["afrFromMasses", "fuelForTarget"];

export function AirFuelRatioTool() {
  const s = strings.pro.auto["air-fuel-ratio"];
  const [mode, setMode] = useState<AfrMode>("afrFromMasses");
  const [airText, setAirText] = useState("");
  const [fuelText, setFuelText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [stoichText, setStoichText] = useState("");

  const typed = [airText, fuelText, targetText].some((text) => proParse(text) !== undefined);
  const result = airFuelRatio({
    mode,
    airMassG: proParse(airText) ?? Number.NaN,
    fuelMassG: mode === "afrFromMasses" ? proParse(fuelText) : undefined,
    targetAfr: mode === "fuelForTarget" ? proParse(targetText) : undefined,
    stoichiometricAfr: proParse(stoichText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "airMass"
        ? s.errorAir
        : field === "fuelMass"
          ? s.errorFuel
          : field === "targetAfr"
            ? s.errorTarget
            : s.errorStoich;

  const modeLabel = (id: AfrMode): string =>
    id === "afrFromMasses" ? s.modeFromMasses : s.modeForTarget;

  const copyText = !result.ok
    ? ""
    : [
        `${s.airFuelRatio}: ${proNum(result.airFuelRatio, 3)}`,
        result.lambda === undefined ? undefined : `${s.lambda}: ${proNum(result.lambda, 4)}`,
        `${s.fuelMass}: ${proUnit(proNum(result.fuelMassG, 3), s.unitG)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<AfrMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={AFR_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      <ToolInput label={s.airMass} value={airText} onChange={setAirText} />
      {mode === "afrFromMasses" && (
        <ToolInput label={s.fuelMass} value={fuelText} onChange={setFuelText} />
      )}
      {mode === "fuelForTarget" && (
        <ToolInput label={s.targetAfr} value={targetText} onChange={setTargetText} />
      )}
      <ToolInput label={s.stoichiometricAfr} hint={s.stoichiometricHint} value={stoichText} onChange={setStoichText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.airFuelRatio} value={proNum(result.airFuelRatio, 3)} />
          {result.lambda !== undefined && <ResultRow label={s.lambda} value={proNum(result.lambda, 4)} />}
          <ResultRow label={s.fuelMass} value={proUnit(proNum(result.fuelMassG, 3), s.unitG)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: modeLabel(mode) },
              {
                label: s.stoichiometricAfr,
                value:
                  result.stoichiometricAfrUsed === undefined
                    ? s.notGiven
                    : proNum(result.stoichiometricAfrUsed, 2),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* wheel-offset                                                                 */
/* -------------------------------------------------------------------------- */

export function WheelOffsetTool() {
  const s = strings.pro.auto["wheel-offset"];
  const [widthText, setWidthText] = useState("");
  const [offsetText, setOffsetText] = useState("");
  const [referenceWidthText, setReferenceWidthText] = useState("");
  const [referenceOffsetText, setReferenceOffsetText] = useState("");

  const typed = [widthText, offsetText].some((text) => proParse(text) !== undefined);
  const result = wheelOffset({
    rimWidthIn: proParse(widthText) ?? Number.NaN,
    offsetMm: proParse(offsetText) ?? Number.NaN,
    referenceWidthIn: proParse(referenceWidthText),
    referenceOffsetMm: proParse(referenceOffsetText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "rimWidth"
        ? s.errorWidth
        : field === "offset"
          ? s.errorOffset
          : s.errorReference;

  const copyText = !result.ok
    ? ""
    : [
        `${s.backspace}: ${proUnit(proNum(result.backspaceMm, 2), s.unitMm)}`,
        `${s.frontSpace}: ${proUnit(proNum(result.frontSpaceMm, 2), s.unitMm)}`,
        `${s.rimWidthMm}: ${proUnit(proNum(result.rimWidthMm, 1), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.rimWidth} value={widthText} onChange={setWidthText} />
      <ToolInput label={s.offset} hint={s.offsetHint} value={offsetText} onChange={setOffsetText} />
      <ToolInput
        label={s.referenceWidth}
        hint={s.referenceHint}
        value={referenceWidthText}
        onChange={setReferenceWidthText}
      />
      <ToolInput label={s.referenceOffset} value={referenceOffsetText} onChange={setReferenceOffsetText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.rimWidthMm} value={proUnit(proNum(result.rimWidthMm, 1), s.unitMm)} />
          <ResultRow label={s.backspace} value={proUnit(proNum(result.backspaceMm, 2), s.unitMm)} />
          <ResultRow label={s.backspaceIn} value={proUnit(proNum(result.backspaceIn, 3), s.unitIn)} />
          <ResultRow label={s.frontSpace} value={proUnit(proNum(result.frontSpaceMm, 2), s.unitMm)} />
          {result.outerFaceShiftMm !== undefined && (
            <ResultRow
              label={s.outerFaceShift}
              value={proUnit(proNum(result.outerFaceShiftMm, 2), s.unitMm)}
            />
          )}
          {result.innerFaceShiftMm !== undefined && (
            <ResultRow
              label={s.innerFaceShift}
              value={proUnit(proNum(result.innerFaceShiftMm, 2), s.unitMm)}
            />
          )}
          <p className="nx-hint nx-hint--prose">{s.shiftNote}</p>
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rimWidth, value: proUnit(proNum(proParse(widthText) ?? 0, 2), s.unitIn) },
              { label: s.offset, value: proUnit(proNum(proParse(offsetText) ?? 0, 1), s.unitMm) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * One entry per tool id, spelled exactly as the assignment spells it — a missing
 * or misspelled id makes the tool unreachable.
 */
export const AUTO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "engine-displacement": EngineDisplacementTool,
  "compression-ratio": CompressionRatioTool,
  "mean-piston-speed": MeanPistonSpeedTool,
  "injector-flow": InjectorFlowTool,
  "air-fuel-ratio": AirFuelRatioTool,
  "wheel-offset": WheelOffsetTool,
};
