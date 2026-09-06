import {
  baleCountStorage,
  beeSyrupMix,
  cadastralAreaUnits,
  fertiliserNutrientBlend,
  grainMoistureShrink,
  growingDegreeDays,
  honeyMassMoisture,
  irrigationDepthVolume,
  livestockRationDm,
  machineFieldCapacity,
  orchardTrellisLayout,
  plantSpacingDensity,
  polygonArea,
  seedingRate,
  sprayerCalibration,
  tankMixDose,
  yieldEstimateSamples,
  type BaleMassMode,
  type BaleQuantityMode,
  type BaleShape,
  type CadastralUnit,
  type CalendarDate,
  type DeductionMode,
  type DeductionOrder,
  type FertiliserBlendInput,
  type FlowUnit,
  type GddReading,
  type HoneyQuantityMode,
  type IntakeMode,
  type IrrigationMethod,
  type LeadNutrient,
  type NozzleFlowSource,
  type PlantingPattern,
  type PolygonColumnOrder,
  type PolygonVertex,
  type RationFeed,
  type RoundBaleOrientation,
  type SeedPriceMode,
  type SeedStandMode,
  type SyrupGiven,
  type TankMixDoseMode,
  type TankMixProductInput,
  type TankMixUnit,
  type YieldMethod,
  type YieldSample,
} from "@nexus/core/pro/agro";
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
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Agro" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/agro.ts`'s. Nothing here divides, rounds
 * or compares — every surface shapes fields, hands the numbers to a pure
 * core function, and prints what comes back.
 *
 * `fertiliser-nutrient-blend`, `sprayer-calibration` and `tank-mix-dose` are
 * `life-safety`: those three print a quantity and, where the user typed one,
 * their own limit — and never a word about what the two mean together.
 */

/** True when a comma-, semicolon- or tab-separated block has at least one row. */
function hasPastedRows(text: string): boolean {
  return text.trim() !== "";
}

/** One pasted line split on tab, semicolon or comma — the drawer's one row shape. */
function splitRow(line: string): readonly string[] {
  return line.split(/[\t;,]/).map((cell) => cell.trim());
}

export function BaleCountStorageTool() {
  const s = strings.pro.agro["bale-count-storage"];
  const [shape, setShape] = useState<BaleShape>("round");
  const [diameterM, setDiameterM] = useState("");
  const [roundWidthM, setRoundWidthM] = useState("");
  const [lengthM, setLengthM] = useState("");
  const [squareWidthM, setSquareWidthM] = useState("");
  const [heightM, setHeightM] = useState("");
  const [massMode, setMassMode] = useState<BaleMassMode>("measured");
  const [measuredMassKg, setMeasuredMassKg] = useState("");
  const [densityKgM3, setDensityKgM3] = useState("");
  const [quantityMode, setQuantityMode] = useState<BaleQuantityMode>("yieldPerArea");
  const [yieldTHa, setYieldTHa] = useState("");
  const [totalMassT, setTotalMassT] = useState("");
  const [areaHa, setAreaHa] = useState("");
  const [balingLossPercent, setBalingLossPercent] = useState("");
  const [storageLengthM, setStorageLengthM] = useState("");
  const [storageWidthM, setStorageWidthM] = useState("");
  const [storageHeightM, setStorageHeightM] = useState("");
  const [roundOrientation, setRoundOrientation] = useState<RoundBaleOrientation>("onEnd");

  const shapeFields = shape === "round" ? [diameterM, roundWidthM] : [lengthM, squareWidthM, heightM];
  const massFields = massMode === "measured" ? [measuredMassKg] : [densityKgM3];
  const quantityFields = quantityMode === "yieldPerArea" ? [yieldTHa, areaHa] : [totalMassT];
  const typed = [...shapeFields, ...massFields, ...quantityFields].some((v) => proParse(v) !== undefined);
  const storageTyped =
    storageLengthM.trim() !== "" || storageWidthM.trim() !== "" || storageHeightM.trim() !== "";

  const result = baleCountStorage({
    shape,
    round:
      shape === "round"
        ? { diameterM: proParse(diameterM) ?? Number.NaN, widthM: proParse(roundWidthM) ?? Number.NaN }
        : undefined,
    square:
      shape === "square"
        ? {
            lengthM: proParse(lengthM) ?? Number.NaN,
            widthM: proParse(squareWidthM) ?? Number.NaN,
            heightM: proParse(heightM) ?? Number.NaN,
          }
        : undefined,
    massMode,
    measuredMassKg: proParse(measuredMassKg),
    densityKgM3: proParse(densityKgM3),
    quantityMode,
    yieldTHa: proParse(yieldTHa),
    totalMassT: proParse(totalMassT),
    areaHa: proParse(areaHa),
    balingLossPercent: proParse(balingLossPercent) ?? 0,
    storage: storageTyped
      ? {
          lengthM: proParse(storageLengthM) ?? Number.NaN,
          widthM: proParse(storageWidthM) ?? Number.NaN,
          usableHeightM: proParse(storageHeightM) ?? Number.NaN,
        }
      : undefined,
    roundOrientation,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "round" || result.reason === "square"
        ? s.errorShape
        : result.reason === "diameterM"
          ? s.errorDiameterM
          : result.reason === "widthM"
            ? s.errorWidthM
            : result.reason === "lengthM"
              ? s.errorLengthM
              : result.reason === "heightM"
                ? s.errorHeightM
                : result.reason === "measuredMassKg"
                  ? s.errorMeasuredMassKg
                  : result.reason === "densityKgM3"
                    ? s.errorDensityKgM3
                    : result.reason === "baleMassKg"
                      ? s.errorBaleMassKg
                      : result.reason === "balingLossPercent"
                        ? s.errorBalingLossPercent
                        : result.reason === "areaHa"
                          ? s.errorAreaHa
                          : result.reason === "yieldTHa"
                            ? s.errorYieldTHa
                            : result.reason === "totalMassT"
                              ? s.errorTotalMassT
                              : result.reason === "storageLengthM"
                                ? s.errorStorageLengthM
                                : result.reason === "storageWidthM"
                                  ? s.errorStorageWidthM
                                  : result.reason === "usableHeightM"
                                    ? s.errorUsableHeightM
                                    : s.errorGeneric;

  const orientationLabel =
    result.ok && result.storage !== undefined
      ? result.storage.orientation === "onEnd"
        ? s.orientationOnEnd
        : result.storage.orientation === "onSide"
          ? s.orientationOnSide
          : result.storage.orientation === "footprint"
            ? s.orientationFootprint
            : result.storage.orientation === "onLengthFace"
              ? s.orientationOnLengthFace
              : result.storage.orientation === "onWidthFace"
                ? s.orientationOnWidthFace
                : "—"
      : "—";

  const copyText = !result.ok
    ? ""
    : [
        `${s.baleVolume}: ${proUnit(proNum(result.baleVolumeM3, 4), s.unitM3)}`,
        `${s.baleMass}: ${proUnit(proNum(result.baleMassKg, 2), s.unitKg)}`,
        `${s.totalMassAfterLoss}: ${proUnit(proNum(result.totalMassAfterLossT, 3), s.unitT)}`,
        `${s.countExact}: ${proNum(result.countExact, 2)}`,
        `${s.countCeil}: ${proNum(result.countCeil, 0)}`,
        `${s.totalVolume}: ${proUnit(proNum(result.totalVolumeM3, 2), s.unitM3)}`,
        result.balesPerHa === undefined ? undefined : `${s.balesPerHa}: ${proNum(result.balesPerHa, 2)}`,
        result.storage === undefined
          ? undefined
          : `${s.storageOrientation}: ${orientationLabel}\n${s.storagePerRow}: ${proNum(result.storage.perRow, 0)}\n${s.storagePerColumn}: ${proNum(result.storage.perColumn, 0)}\n${s.storageLayers}: ${proNum(result.storage.layers, 0)}\n${s.storageCapacity}: ${proNum(result.storage.capacity, 0)}\n${s.storageCapacityTonnes}: ${proUnit(proNum(result.storage.capacityTonnes, 2), s.unitT)}\n${s.unusedLength}: ${proUnit(proNum(result.storage.unusedLengthM, 2), s.unitM)}\n${s.unusedWidth}: ${proUnit(proNum(result.storage.unusedWidthM, 2), s.unitM)}${result.shortfall === undefined ? "" : `\n${s.shortfall}: ${proNum(result.shortfall, 0)}`}`,
        "",
        `${s.shape}: ${shape === "round" ? s.shapeRound : s.shapeSquare}`,
        `${s.balingLossPercent}: ${proNum(proParse(balingLossPercent) ?? 0, 1)}${s.unitPercent}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<BaleShape>
        label={s.shape}
        value={shape}
        onChange={setShape}
        options={[
          { id: "round", label: s.shapeRound },
          { id: "square", label: s.shapeSquare },
        ]}
      />
      {shape === "round" ? (
        <>
          <ToolInput label={s.diameterM} hint={s.diameterMHint} value={diameterM} onChange={setDiameterM} />
          <ToolInput label={s.roundWidthM} value={roundWidthM} onChange={setRoundWidthM} />
          <ToolSelect<RoundBaleOrientation>
            label={s.roundOrientation}
            value={roundOrientation}
            onChange={setRoundOrientation}
            options={[
              { id: "onEnd", label: s.orientationOnEnd },
              { id: "onSide", label: s.orientationOnSide },
            ]}
          />
        </>
      ) : (
        <>
          <ToolInput label={s.lengthM} value={lengthM} onChange={setLengthM} />
          <ToolInput label={s.squareWidthM} value={squareWidthM} onChange={setSquareWidthM} />
          <ToolInput label={s.heightM} value={heightM} onChange={setHeightM} />
        </>
      )}
      <ToolSelect<BaleMassMode>
        label={s.massMode}
        value={massMode}
        onChange={setMassMode}
        options={[
          { id: "measured", label: s.massModeMeasured },
          { id: "density", label: s.massModeDensity },
        ]}
      />
      {massMode === "measured" ? (
        <ToolInput label={s.measuredMassKg} value={measuredMassKg} onChange={setMeasuredMassKg} />
      ) : (
        <ToolInput label={s.densityKgM3} hint={s.densityKgM3Hint} value={densityKgM3} onChange={setDensityKgM3} />
      )}
      <ToolSelect<BaleQuantityMode>
        label={s.quantityMode}
        value={quantityMode}
        onChange={setQuantityMode}
        options={[
          { id: "yieldPerArea", label: s.quantityModeYield },
          { id: "totalMass", label: s.quantityModeTotal },
        ]}
      />
      {quantityMode === "yieldPerArea" ? (
        <ToolInput label={s.yieldTHa} value={yieldTHa} onChange={setYieldTHa} />
      ) : (
        <ToolInput label={s.totalMassT} value={totalMassT} onChange={setTotalMassT} />
      )}
      <ToolInput label={s.areaHa} hint={s.areaHaHint} value={areaHa} onChange={setAreaHa} />
      <ToolInput
        label={s.balingLossPercent}
        value={balingLossPercent}
        onChange={setBalingLossPercent}
        placeholder="0"
      />
      <ToolSection title={s.storage}>
        <ToolInput label={s.storageLengthM} value={storageLengthM} onChange={setStorageLengthM} />
        <ToolInput label={s.storageWidthM} value={storageWidthM} onChange={setStorageWidthM} />
        <ToolInput
          label={s.storageHeightM}
          hint={s.storageHeightMHint}
          value={storageHeightM}
          onChange={setStorageHeightM}
        />
      </ToolSection>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.baleVolume} value={proUnit(proNum(result.baleVolumeM3, 4), s.unitM3)} />
          <ResultRow label={s.baleMass} value={proUnit(proNum(result.baleMassKg, 2), s.unitKg)} />
          <ResultRow label={s.totalMassAfterLoss} value={proUnit(proNum(result.totalMassAfterLossT, 3), s.unitT)} />
          <ResultRow label={s.countExact} value={proNum(result.countExact, 2)} />
          <ResultRow label={s.countCeil} value={proNum(result.countCeil, 0)} />
          <ResultRow label={s.totalVolume} value={proUnit(proNum(result.totalVolumeM3, 2), s.unitM3)} />
          {result.balesPerHa !== undefined && <ResultRow label={s.balesPerHa} value={proNum(result.balesPerHa, 2)} />}
          {result.storage !== undefined && (
            <ToolSection title={s.storageResults}>
              <ResultRow label={s.storageOrientation} value={orientationLabel} />
              <ResultRow label={s.storagePerRow} value={proNum(result.storage.perRow, 0)} />
              <ResultRow label={s.storagePerColumn} value={proNum(result.storage.perColumn, 0)} />
              <ResultRow label={s.storagePerLayer} value={proNum(result.storage.perLayer, 0)} />
              <ResultRow label={s.storageLayers} value={proNum(result.storage.layers, 0)} />
              <ResultRow label={s.storageCapacity} value={proNum(result.storage.capacity, 0)} />
              <ResultRow
                label={s.storageCapacityTonnes}
                value={proUnit(proNum(result.storage.capacityTonnes, 2), s.unitT)}
              />
              <ResultRow label={s.unusedLength} value={proUnit(proNum(result.storage.unusedLengthM, 2), s.unitM)} />
              <ResultRow label={s.unusedWidth} value={proUnit(proNum(result.storage.unusedWidthM, 2), s.unitM)} />
              {result.shortfall !== undefined && (
                <ResultRow label={s.shortfall} value={proNum(result.shortfall, 0)} />
              )}
              <p className="nx-hint nx-hint--prose">{s.stackingNote}</p>
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.shape, value: shape === "round" ? s.shapeRound : s.shapeSquare },
              { label: s.massMode, value: massMode === "measured" ? s.massModeMeasured : s.massModeDensity },
              {
                label: s.quantityMode,
                value: quantityMode === "yieldPerArea" ? s.quantityModeYield : s.quantityModeTotal,
              },
              {
                label: s.areaHa,
                value: areaHa.trim() === "" ? "—" : proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa),
              },
              {
                label: s.balingLossPercent,
                value: `${proNum(proParse(balingLossPercent) ?? 0, 1)}${s.unitPercent}`,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function CadastralAreaUnitsTool() {
  const s = strings.pro.agro["cadastral-area-units"];
  const [value, setValue] = useState("");
  const [fromUnit, setFromUnit] = useState<CadastralUnit>("m2");
  const [jutroM2Override, setJutroM2Override] = useState("");

  const typed = proParse(value) !== undefined;
  const result = cadastralAreaUnits({
    value: proParse(value) ?? Number.NaN,
    fromUnit,
    jutroM2Override: proParse(jutroM2Override),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "value"
        ? s.errorValue
        : result.reason === "jutroM2Override"
          ? s.errorJutroM2Override
          : s.errorGeneric;

  const unitLabel = (u: CadastralUnit): string =>
    u === "m2"
      ? s.unitM2
      : u === "ar"
        ? s.unitAr
        : u === "ha"
          ? s.unitHa
          : u === "hvat2"
            ? s.unitHvat2
            : s.unitJutro;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultM2}: ${proUnit(proNum(result.m2, 2), s.unitM2)}`,
        `${s.resultAr}: ${proUnit(proNum(result.ar, 4), s.unitAr)}`,
        `${s.resultHa}: ${proUnit(proNum(result.ha, 6), s.unitHa)}`,
        `${s.resultHvat2}: ${proUnit(proNum(result.hvat2, 3), s.unitHvat2)}`,
        `${s.resultJutro}: ${proUnit(proNum(result.jutro, 6), s.unitJutro)}`,
        `${s.jutroUsed}: ${proUnit(proNum(result.jutroM2Used, 4), s.unitM2)}`,
        "",
        `${s.value}: ${proNum(proParse(value) ?? 0, 4)} ${unitLabel(fromUnit)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.value} value={value} onChange={setValue} />
      <ToolSelect<CadastralUnit>
        label={s.fromUnit}
        value={fromUnit}
        onChange={setFromUnit}
        options={[
          { id: "m2", label: s.unitM2 },
          { id: "ar", label: s.unitAr },
          { id: "ha", label: s.unitHa },
          { id: "hvat2", label: s.unitHvat2 },
          { id: "jutro", label: s.unitJutro },
        ]}
      />
      <ToolInput
        label={s.jutroM2Override}
        hint={s.jutroM2OverrideHint}
        value={jutroM2Override}
        onChange={setJutroM2Override}
        placeholder="5754,6425"
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultM2} value={proUnit(proNum(result.m2, 2), s.unitM2)} />
          <ResultRow label={s.resultAr} value={proUnit(proNum(result.ar, 4), s.unitAr)} />
          <ResultRow label={s.resultHa} value={proUnit(proNum(result.ha, 6), s.unitHa)} />
          <ResultRow label={s.resultHvat2} value={proUnit(proNum(result.hvat2, 3), s.unitHvat2)} />
          <ResultRow label={s.resultJutro} value={proUnit(proNum(result.jutro, 6), s.unitJutro)} />
          <ResultRow label={s.jutroUsed} value={proUnit(proNum(result.jutroM2Used, 4), s.unitM2)} />
          <p className="nx-hint nx-hint--prose">{s.sourceNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.value, value: `${proNum(proParse(value) ?? 0, 4)} ${unitLabel(fromUnit)}` }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * `financial`: the reference moisture and the impurity-free allowance are
 * contract figures — the tool prints only physically derived quantities and
 * never chooses which deduction order or which allowance applies.
 */
export function GrainMoistureShrinkTool() {
  const s = strings.pro.agro["grain-moisture-shrink"];
  const [grossMassKg, setGrossMassKg] = useState("");
  const [measuredMoisturePercent, setMeasuredMoisturePercent] = useState("");
  const [targetMoisturePercent, setTargetMoisturePercent] = useState("");
  const [impuritiesPercent, setImpuritiesPercent] = useState("0");
  const [impuritiesFreeLimitPercent, setImpuritiesFreeLimitPercent] = useState("");
  const [order, setOrder] = useState<DeductionOrder>("impuritiesFirst");
  const [deductionMode, setDeductionMode] = useState<DeductionMode>("excessOnly");
  const [pricePerKg, setPricePerKg] = useState("");
  const [dryerEfficiencyPercent, setDryerEfficiencyPercent] = useState("");

  const typed =
    proParse(grossMassKg) !== undefined ||
    proParse(measuredMoisturePercent) !== undefined ||
    proParse(targetMoisturePercent) !== undefined;

  const result = grainMoistureShrink({
    grossMassKg: proParse(grossMassKg) ?? Number.NaN,
    measuredMoisturePercent: proParse(measuredMoisturePercent) ?? Number.NaN,
    targetMoisturePercent: proParse(targetMoisturePercent) ?? Number.NaN,
    impuritiesPercent: proParse(impuritiesPercent) ?? 0,
    impuritiesFreeLimitPercent: proParse(impuritiesFreeLimitPercent) ?? Number.NaN,
    order,
    deductionMode,
    pricePerKg: proParse(pricePerKg),
    dryerEfficiencyPercent: proParse(dryerEfficiencyPercent),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "grossMassKg"
        ? s.errorGrossMassKg
        : result.reason === "measuredMoisturePercent"
          ? s.errorMeasuredMoisturePercent
          : result.reason === "targetMoisturePercent"
            ? s.errorTargetMoisturePercent
            : result.reason === "impuritiesPercent"
              ? s.errorImpuritiesPercent
              : result.reason === "impuritiesFreeLimitPercent"
                ? s.errorImpuritiesFreeLimitPercent
                : result.reason === "pricePerKg"
                  ? s.errorPricePerKg
                  : result.reason === "dryerEfficiencyPercent"
                    ? s.errorDryerEfficiencyPercent
                    : s.errorGeneric;

  const branchText = (label: string, b: { impurityDeductionKg: number; finalMassKg: number; waterOutKg: number }): string =>
    `${label}: ${s.impurityDeductionKg} ${proUnit(proNum(b.impurityDeductionKg, 2), s.unitKg)}   ${s.finalMassKg} ${proUnit(proNum(b.finalMassKg, 2), s.unitKg)}   ${s.waterOutKg} ${proUnit(proNum(b.waterOutKg, 2), s.unitKg)}`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.driedMassKg}: ${proUnit(proNum(result.driedMassKg, 2), s.unitKg)}`,
        `${s.waterOutKg}: ${proUnit(proNum(result.waterOutKg, 2), s.unitKg)}`,
        `${s.shrinkPercent}: ${proNum(result.shrinkPercent, 4)}${s.unitPercent}`,
        `${s.shrinkPercentMassIndependent}: ${proNum(result.shrinkPercentMassIndependent, 4)}${s.unitPercent}`,
        branchText(s.impuritiesFirst, result.impuritiesFirst),
        branchText(s.moistureFirst, result.moistureFirst),
        `${s.selected}: ${order === "impuritiesFirst" ? s.orderImpuritiesFirst : s.orderMoistureFirst}`,
        result.value === undefined
          ? undefined
          : `${s.grossValue}: ${proUnit(proNum(result.value.grossValue, 2), s.unitRsd)}   ` +
            `${s.netValue}: ${proUnit(proNum(result.value.netValue, 2), s.unitRsd)}   ` +
            `${s.valueDifference}: ${proUnit(proNum(result.value.valueDifference, 2), s.unitRsd)}`,
        result.actualEnergy === undefined
          ? `${s.minimumEnergyMJ}: ${proUnit(proNum(result.minimumEnergyMJ, 2), s.unitMj)}   ` +
            `${s.minimumEnergyKWh}: ${proUnit(proNum(result.minimumEnergyKWh, 2), s.unitKwh)}`
          : `${s.actualEnergyMJ}: ${proUnit(proNum(result.actualEnergy.actualEnergyMJ, 2), s.unitMj)}   ` +
            `${s.actualEnergyKWh}: ${proUnit(proNum(result.actualEnergy.actualEnergyKWh, 2), s.unitKwh)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.grossMassKg} value={grossMassKg} onChange={setGrossMassKg} />
      <ToolInput
        label={s.measuredMoisturePercent}
        value={measuredMoisturePercent}
        onChange={setMeasuredMoisturePercent}
      />
      <ToolInput
        label={s.targetMoisturePercent}
        hint={s.targetMoisturePercentHint}
        value={targetMoisturePercent}
        onChange={setTargetMoisturePercent}
      />
      <ToolInput label={s.impuritiesPercent} value={impuritiesPercent} onChange={setImpuritiesPercent} placeholder="0" />
      <ToolInput
        label={s.impuritiesFreeLimitPercent}
        hint={s.impuritiesFreeLimitPercentHint}
        value={impuritiesFreeLimitPercent}
        onChange={setImpuritiesFreeLimitPercent}
      />
      <ToolSelect<DeductionOrder>
        label={s.order}
        value={order}
        onChange={setOrder}
        options={[
          { id: "impuritiesFirst", label: s.orderImpuritiesFirst },
          { id: "moistureFirst", label: s.orderMoistureFirst },
        ]}
      />
      <ToolSelect<DeductionMode>
        label={s.deductionMode}
        value={deductionMode}
        onChange={setDeductionMode}
        options={[
          { id: "excessOnly", label: s.deductionModeExcessOnly },
          { id: "twoSided", label: s.deductionModeTwoSided },
        ]}
      />
      <ToolInput label={s.pricePerKg} value={pricePerKg} onChange={setPricePerKg} />
      <ToolInput label={s.dryerEfficiencyPercent} value={dryerEfficiencyPercent} onChange={setDryerEfficiencyPercent} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.driedMassKg} value={proUnit(proNum(result.driedMassKg, 2), s.unitKg)} />
          <ResultRow label={s.waterOutKg} value={proUnit(proNum(result.waterOutKg, 2), s.unitKg)} />
          <ResultRow label={s.shrinkPercent} value={`${proNum(result.shrinkPercent, 4)}${s.unitPercent}`} />
          <ResultRow
            label={s.shrinkPercentMassIndependent}
            value={`${proNum(result.shrinkPercentMassIndependent, 4)}${s.unitPercent}`}
          />
          <p className="nx-hint nx-hint--prose">{s.physicalModelNote}</p>
          <ToolSection title={s.impuritiesFirst}>
            <ResultRow
              label={s.impurityDeductionKg}
              value={proUnit(proNum(result.impuritiesFirst.impurityDeductionKg, 2), s.unitKg)}
            />
            <ResultRow label={s.finalMassKg} value={proUnit(proNum(result.impuritiesFirst.finalMassKg, 2), s.unitKg)} />
            <ResultRow label={s.waterOutKg} value={proUnit(proNum(result.impuritiesFirst.waterOutKg, 2), s.unitKg)} />
          </ToolSection>
          <ToolSection title={s.moistureFirst}>
            <ResultRow
              label={s.impurityDeductionKg}
              value={proUnit(proNum(result.moistureFirst.impurityDeductionKg, 2), s.unitKg)}
            />
            <ResultRow label={s.finalMassKg} value={proUnit(proNum(result.moistureFirst.finalMassKg, 2), s.unitKg)} />
            <ResultRow label={s.waterOutKg} value={proUnit(proNum(result.moistureFirst.waterOutKg, 2), s.unitKg)} />
          </ToolSection>
          <ResultRow
            label={s.selected}
            value={order === "impuritiesFirst" ? s.orderImpuritiesFirst : s.orderMoistureFirst}
          />
          {result.value !== undefined && (
            <ToolSection title={s.value}>
              <ResultRow label={s.grossValue} value={proUnit(proNum(result.value.grossValue, 2), s.unitRsd)} />
              <ResultRow label={s.netValue} value={proUnit(proNum(result.value.netValue, 2), s.unitRsd)} />
              <ResultRow
                label={s.valueDifference}
                value={proUnit(proNum(result.value.valueDifference, 2), s.unitRsd)}
              />
            </ToolSection>
          )}
          <ToolSection title={s.energy}>
            <ResultRow label={s.minimumEnergyMJ} value={proUnit(proNum(result.minimumEnergyMJ, 2), s.unitMj)} />
            <ResultRow label={s.minimumEnergyKWh} value={proUnit(proNum(result.minimumEnergyKWh, 2), s.unitKwh)} />
            {result.actualEnergy !== undefined && (
              <>
                <ResultRow
                  label={s.actualEnergyMJ}
                  value={proUnit(proNum(result.actualEnergy.actualEnergyMJ, 2), s.unitMj)}
                />
                <ResultRow
                  label={s.actualEnergyKWh}
                  value={proUnit(proNum(result.actualEnergy.actualEnergyKWh, 2), s.unitKwh)}
                />
              </>
            )}
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.grossMassKg, value: proUnit(proNum(proParse(grossMassKg) ?? 0, 1), s.unitKg) },
              {
                label: s.measuredMoisturePercent,
                value: `${proNum(proParse(measuredMoisturePercent) ?? 0, 2)}${s.unitPercent}`,
              },
              {
                label: s.targetMoisturePercent,
                value: `${proNum(proParse(targetMoisturePercent) ?? 0, 2)}${s.unitPercent}`,
              },
              { label: s.impuritiesPercent, value: `${proNum(proParse(impuritiesPercent) ?? 0, 2)}${s.unitPercent}` },
              {
                label: s.impuritiesFreeLimitPercent,
                value: `${proNum(proParse(impuritiesFreeLimitPercent) ?? 0, 2)}${s.unitPercent}`,
              },
              { label: s.order, value: order === "impuritiesFirst" ? s.orderImpuritiesFirst : s.orderMoistureFirst },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * `financial`: density and moisture are the seller's own readings and are
 * never derived from one another, even when a sample mass/volume pair can
 * compute an independent density — the two are physically linked, but
 * coupling them here would let an impossible pair read as confirmed.
 */
export function HoneyMassMoistureTool() {
  const s = strings.pro.agro["honey-mass-moisture"];
  const [quantityMode, setQuantityMode] = useState<HoneyQuantityMode>("grossTare");
  const [grossMassKg, setGrossMassKg] = useState("");
  const [tareKg, setTareKg] = useState("");
  const [containerVolumeL, setContainerVolumeL] = useState("");
  const [densityKgL, setDensityKgL] = useState("");
  const [sampleMassKg, setSampleMassKg] = useState("");
  const [sampleVolumeL, setSampleVolumeL] = useState("");
  const [moisturePercent, setMoisturePercent] = useState("");
  const [targetMoisturePercent, setTargetMoisturePercent] = useState("");
  const [jarVolumeMl, setJarVolumeMl] = useState("");
  const [jarDeclaredNetMassG, setJarDeclaredNetMassG] = useState("");
  const [jarToleranceG, setJarToleranceG] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");

  const quantityFields = quantityMode === "grossTare" ? [grossMassKg, tareKg] : [containerVolumeL];
  const typed = [...quantityFields, densityKgL, moisturePercent].some((v) => proParse(v) !== undefined);

  const result = honeyMassMoisture({
    quantityMode,
    grossMassKg: proParse(grossMassKg),
    tareKg: proParse(tareKg),
    containerVolumeL: proParse(containerVolumeL),
    densityKgL: proParse(densityKgL) ?? Number.NaN,
    sampleMassKg: proParse(sampleMassKg),
    sampleVolumeL: proParse(sampleVolumeL),
    moisturePercent: proParse(moisturePercent) ?? Number.NaN,
    targetMoisturePercent: proParse(targetMoisturePercent),
    jarVolumeMl: proParse(jarVolumeMl),
    jarDeclaredNetMassG: proParse(jarDeclaredNetMassG),
    jarToleranceG: proParse(jarToleranceG),
    pricePerKg: proParse(pricePerKg),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "grossMassKg"
        ? s.errorGrossMassKg
        : result.reason === "tareKg"
          ? s.errorTareKg
          : result.reason === "netMassKg"
            ? s.errorNetMassKg
            : result.reason === "containerVolumeL"
              ? s.errorContainerVolumeL
              : result.reason === "densityKgL"
                ? s.errorDensityKgL
                : result.reason === "sampleMassKg"
                  ? s.errorSampleMassKg
                  : result.reason === "sampleVolumeL"
                    ? s.errorSampleVolumeL
                    : result.reason === "sampleDensity"
                      ? s.errorSampleDensity
                      : result.reason === "moisturePercent"
                        ? s.errorMoisturePercent
                        : result.reason === "targetMoisturePercent"
                          ? s.errorTargetMoisturePercent
                          : result.reason === "jarVolumeMl"
                            ? s.errorJarVolumeMl
                            : result.reason === "jarDeclaredNetMassG"
                              ? s.errorJarDeclaredNetMassG
                              : result.reason === "jarToleranceG"
                                ? s.errorJarToleranceG
                                : result.reason === "pricePerKg"
                                  ? s.errorPricePerKg
                                  : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.netMassKg}: ${proUnit(proNum(result.netMassKg, 3), s.unitKg)}`,
        `${s.volumeFromMassL}: ${proUnit(proNum(result.volumeFromMassL, 3), s.unitL)}`,
        result.measuredDensityKgL === undefined
          ? undefined
          : `${s.measuredDensityKgL}: ${proUnit(proNum(result.measuredDensityKgL, 4), s.unitKgL)}`,
        `${s.waterMassKg}: ${proUnit(proNum(result.waterMassKg, 3), s.unitKg)}`,
        `${s.dryMatterMassKg}: ${proUnit(proNum(result.dryMatterMassKg, 3), s.unitKg)}`,
        result.drying === undefined
          ? undefined
          : `${s.driedMassKg}: ${proUnit(proNum(result.drying.driedMassKg, 3), s.unitKg)}   ` +
            `${s.waterRemovedKg}: ${proUnit(proNum(result.drying.waterRemovedKg, 3), s.unitKg)}   ` +
            `${s.shrinkPercent}: ${proNum(result.drying.shrinkPercent, 4)}${s.unitPercent}`,
        result.jars === undefined
          ? undefined
          : `${s.massPerJarKg}: ${proUnit(proNum(result.jars.massPerJarKg, 4), s.unitKg)} ` +
            `(${proUnit(proNum(result.jars.massPerJarG, 1), s.unitG)})   ` +
            `${s.fullJars}: ${proNum(result.jars.fullJars, 0)}   ` +
            `${s.jarRemainderKg}: ${proUnit(proNum(result.jars.jarRemainderKg, 4), s.unitKg)}`,
        result.jarsFromDeclaredMass === undefined
          ? undefined
          : `${s.jarsFromDeclaredMass}: ${proNum(result.jarsFromDeclaredMass, 0)}`,
        result.jars?.fillMassVsDeclaredG === undefined
          ? undefined
          : `${s.fillMassVsDeclaredG}: ${proUnit(proNum(result.jars.fillMassVsDeclaredG, 2), s.unitG)}`,
        result.value === undefined
          ? undefined
          : `${s.grossValue}: ${proUnit(proNum(result.value.grossValue, 2), s.unitRsd)}`,
        result.value?.driedValue === undefined
          ? undefined
          : `${s.driedValue}: ${proUnit(proNum(result.value.driedValue, 2), s.unitRsd)}`,
        "",
        `${s.densityKgL}: ${proUnit(proNum(proParse(densityKgL) ?? 0, 4), s.unitKgL)}`,
        `${s.moisturePercent}: ${proNum(proParse(moisturePercent) ?? 0, 2)}${s.unitPercent}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<HoneyQuantityMode>
        label={s.quantityMode}
        value={quantityMode}
        onChange={setQuantityMode}
        options={[
          { id: "grossTare", label: s.quantityModeGrossTare },
          { id: "volume", label: s.quantityModeVolume },
        ]}
      />
      {quantityMode === "grossTare" ? (
        <>
          <ToolInput label={s.grossMassKg} value={grossMassKg} onChange={setGrossMassKg} />
          <ToolInput label={s.tareKg} value={tareKg} onChange={setTareKg} />
        </>
      ) : (
        <ToolInput label={s.containerVolumeL} value={containerVolumeL} onChange={setContainerVolumeL} />
      )}
      <ToolInput
        label={s.densityKgL}
        hint={s.densityKgLHint}
        value={densityKgL}
        onChange={setDensityKgL}
      />
      <ToolInput label={s.sampleMassKg} hint={s.sampleHint} value={sampleMassKg} onChange={setSampleMassKg} />
      <ToolInput label={s.sampleVolumeL} value={sampleVolumeL} onChange={setSampleVolumeL} />
      <ToolInput label={s.moisturePercent} value={moisturePercent} onChange={setMoisturePercent} />
      <ToolInput
        label={s.targetMoisturePercent}
        value={targetMoisturePercent}
        onChange={setTargetMoisturePercent}
      />
      <ToolInput label={s.jarVolumeMl} value={jarVolumeMl} onChange={setJarVolumeMl} />
      <ToolInput
        label={s.jarDeclaredNetMassG}
        value={jarDeclaredNetMassG}
        onChange={setJarDeclaredNetMassG}
      />
      <ToolInput
        label={s.jarToleranceG}
        hint={s.jarToleranceGHint}
        value={jarToleranceG}
        onChange={setJarToleranceG}
      />
      <ToolInput label={s.pricePerKg} value={pricePerKg} onChange={setPricePerKg} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.netMassKg} value={proUnit(proNum(result.netMassKg, 3), s.unitKg)} />
          <ResultRow label={s.volumeFromMassL} value={proUnit(proNum(result.volumeFromMassL, 3), s.unitL)} />
          {result.measuredDensityKgL !== undefined && (
            <ResultRow
              label={s.measuredDensityKgL}
              value={proUnit(proNum(result.measuredDensityKgL, 4), s.unitKgL)}
            />
          )}
          <p className="nx-hint nx-hint--prose">{s.independenceNote}</p>
          <ResultRow label={s.waterMassKg} value={proUnit(proNum(result.waterMassKg, 3), s.unitKg)} />
          <ResultRow label={s.dryMatterMassKg} value={proUnit(proNum(result.dryMatterMassKg, 3), s.unitKg)} />
          {result.drying !== undefined && (
            <ToolSection title={s.drying}>
              <ResultRow
                label={s.driedMassKg}
                value={proUnit(proNum(result.drying.driedMassKg, 3), s.unitKg)}
              />
              <ResultRow
                label={s.waterRemovedKg}
                value={proUnit(proNum(result.drying.waterRemovedKg, 3), s.unitKg)}
              />
              <ResultRow
                label={s.shrinkPercent}
                value={`${proNum(result.drying.shrinkPercent, 4)}${s.unitPercent}`}
              />
            </ToolSection>
          )}
          {result.jars !== undefined && (
            <ToolSection title={s.jars}>
              <ResultRow
                label={s.massPerJarKg}
                value={proUnit(proNum(result.jars.massPerJarKg, 4), s.unitKg)}
              />
              <ResultRow label={s.massPerJarG} value={proUnit(proNum(result.jars.massPerJarG, 1), s.unitG)} />
              <ResultRow label={s.fullJars} value={proNum(result.jars.fullJars, 0)} />
              <ResultRow
                label={s.jarRemainderKg}
                value={proUnit(proNum(result.jars.jarRemainderKg, 4), s.unitKg)}
              />
              {result.jars.fillMassVsDeclaredG !== undefined && (
                <ResultRow
                  label={s.fillMassVsDeclaredG}
                  value={proUnit(proNum(result.jars.fillMassVsDeclaredG, 2), s.unitG)}
                />
              )}
            </ToolSection>
          )}
          {result.jarsFromDeclaredMass !== undefined && (
            <ResultRow label={s.jarsFromDeclaredMass} value={proNum(result.jarsFromDeclaredMass, 0)} />
          )}
          {result.value !== undefined && (
            <ToolSection title={s.value}>
              <ResultRow label={s.grossValue} value={proUnit(proNum(result.value.grossValue, 2), s.unitRsd)} />
              {result.value.driedValue !== undefined && (
                <ResultRow
                  label={s.driedValue}
                  value={proUnit(proNum(result.value.driedValue, 2), s.unitRsd)}
                />
              )}
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.densityKgL, value: proUnit(proNum(proParse(densityKgL) ?? 0, 4), s.unitKgL) },
              { label: s.moisturePercent, value: `${proNum(proParse(moisturePercent) ?? 0, 2)}${s.unitPercent}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type NozzleFlowUnit = "lh" | "m3h";

export function IrrigationDepthVolumeTool() {
  const s = strings.pro.agro["irrigation-depth-volume"];
  const [normMm, setNormMm] = useState("");
  const [areaHa, setAreaHa] = useState("");
  const [efficiencyPercent, setEfficiencyPercent] = useState("");
  const [flowUnit, setFlowUnit] = useState<FlowUnit>("m3h");
  const [flowValue, setFlowValue] = useState("");
  const [method, setMethod] = useState<IrrigationMethod>("sprinkler");
  const [spacingInRowM, setSpacingInRowM] = useState("");
  const [spacingBetweenRowsM, setSpacingBetweenRowsM] = useState("");
  const [nozzleFlowUnit, setNozzleFlowUnit] = useState<NozzleFlowUnit>("lh");
  const [nozzleFlowValue, setNozzleFlowValue] = useState("");
  const [dripsPerPlant, setDripsPerPlant] = useState("");
  const [dripFlowLh, setDripFlowLh] = useState("");
  const [areaPerPlantM2, setAreaPerPlantM2] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("24");

  const typed = [normMm, areaHa, efficiencyPercent, flowValue].some((v) => proParse(v) !== undefined);
  // The only multiplication in this surface: a unit switch (m³/h → l/h), the
  // same exception the format kit makes for showing metres beside millimetres.
  const nozzleFlowParsed = proParse(nozzleFlowValue);
  const nozzleFlowLh =
    nozzleFlowParsed === undefined ? undefined : nozzleFlowUnit === "m3h" ? nozzleFlowParsed * 1000 : nozzleFlowParsed;

  const result = irrigationDepthVolume({
    normMm: proParse(normMm) ?? Number.NaN,
    areaHa: proParse(areaHa) ?? Number.NaN,
    efficiencyPercent: proParse(efficiencyPercent) ?? Number.NaN,
    flowUnit,
    flowValue: proParse(flowValue) ?? Number.NaN,
    method,
    sprinklerSpacingInRowM: proParse(spacingInRowM),
    sprinklerSpacingBetweenRowsM: proParse(spacingBetweenRowsM),
    nozzleFlowLh,
    dripsPerPlant: proParse(dripsPerPlant),
    dripFlowLh: proParse(dripFlowLh),
    areaPerPlantM2: proParse(areaPerPlantM2),
    hoursPerDay: proParse(hoursPerDay) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "normMm"
        ? s.errorNormMm
        : result.reason === "areaHa"
          ? s.errorAreaHa
          : result.reason === "efficiencyPercent"
            ? s.errorEfficiencyPercent
            : result.reason === "flowValue"
              ? s.errorFlowValue
              : result.reason === "hoursPerDay"
                ? s.errorHoursPerDay
                : result.reason === "sprinklerSpacingInRowM"
                  ? s.errorSpacingInRowM
                  : result.reason === "sprinklerSpacingBetweenRowsM"
                    ? s.errorSpacingBetweenRowsM
                    : result.reason === "nozzleFlowLh"
                      ? s.errorNozzleFlowLh
                      : result.reason === "dripsPerPlant"
                        ? s.errorDripsPerPlant
                        : result.reason === "dripFlowLh"
                          ? s.errorDripFlowLh
                          : result.reason === "areaPerPlantM2"
                            ? s.errorAreaPerPlantM2
                            : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.netVolumeM3}: ${proUnit(proNum(result.netVolumeM3, 2), s.unitM3)}   ${s.netVolumeL}: ${proUnit(proNum(result.netVolumeL, 0), s.unitL)}`,
        `${s.grossVolumeM3}: ${proUnit(proNum(result.grossVolumeM3, 2), s.unitM3)}`,
        `${s.flowM3h}: ${proUnit(proNum(result.flowM3h, 3), s.unitM3h)}`,
        `${s.timeHours}: ${proNum(result.timeHoursPart, 0)} ${s.unitH} ${proNum(result.timeMinutesPart, 0)} ${s.unitMin}`,
        `${s.daysNeeded}: ${proNum(result.daysNeeded, 0)}`,
        result.sprinkler === undefined
          ? undefined
          : `${s.intensityMmH}: ${proUnit(proNum(result.sprinkler.intensityMmH, 3), s.unitMmH)}`,
        result.sprinkler === undefined
          ? undefined
          : `${s.netTimePerPositionH}: ${proUnit(proNum(result.sprinkler.netTimePerPositionH, 2), s.unitH)}   ` +
            `${s.grossTimePerPositionH}: ${proUnit(proNum(result.sprinkler.grossTimePerPositionH, 2), s.unitH)}`,
        result.sprinkler === undefined
          ? undefined
          : `${s.positions}: ${proNum(result.sprinkler.positions, 2)}   ` +
            `${s.positionsPerDay}: ${proNum(result.sprinkler.positionsPerDay, 0)}`,
        result.drip === undefined
          ? undefined
          : `${s.netLitersPerPlant}: ${proUnit(proNum(result.drip.netLitersPerPlant, 2), s.unitL)}   ` +
            `${s.netDripDurationH}: ${proUnit(proNum(result.drip.netDripDurationH, 2), s.unitH)}`,
        result.drip === undefined
          ? undefined
          : `${s.grossLitersPerPlant}: ${proUnit(proNum(result.drip.grossLitersPerPlant, 2), s.unitL)}   ` +
            `${s.grossDripDurationH}: ${proUnit(proNum(result.drip.grossDripDurationH, 2), s.unitH)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.normMm} hint={s.normMmHint} value={normMm} onChange={setNormMm} />
      <ToolInput label={s.areaHa} value={areaHa} onChange={setAreaHa} />
      <ToolInput
        label={s.efficiencyPercent}
        hint={s.efficiencyPercentHint}
        value={efficiencyPercent}
        onChange={setEfficiencyPercent}
      />
      <ToolSelect<FlowUnit>
        label={s.flowUnit}
        value={flowUnit}
        onChange={setFlowUnit}
        options={[
          { id: "m3h", label: s.flowUnitM3h },
          { id: "ls", label: s.flowUnitLs },
        ]}
      />
      <ToolInput label={s.flowValue} value={flowValue} onChange={setFlowValue} />
      <ToolSelect<IrrigationMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "sprinkler", label: s.methodSprinkler },
          { id: "drip", label: s.methodDrip },
        ]}
      />
      {method === "sprinkler" ? (
        <>
          <ToolInput label={s.spacingInRowM} value={spacingInRowM} onChange={setSpacingInRowM} />
          <ToolInput label={s.spacingBetweenRowsM} value={spacingBetweenRowsM} onChange={setSpacingBetweenRowsM} />
          <ToolSelect<NozzleFlowUnit>
            label={s.nozzleFlowUnit}
            value={nozzleFlowUnit}
            onChange={setNozzleFlowUnit}
            options={[
              { id: "lh", label: s.unitLh },
              { id: "m3h", label: s.unitM3h },
            ]}
          />
          <ToolInput label={s.nozzleFlowValue} value={nozzleFlowValue} onChange={setNozzleFlowValue} />
        </>
      ) : (
        <>
          <ToolInput label={s.dripsPerPlant} value={dripsPerPlant} onChange={setDripsPerPlant} />
          <ToolInput label={s.dripFlowLh} value={dripFlowLh} onChange={setDripFlowLh} />
          <ToolInput label={s.areaPerPlantM2} value={areaPerPlantM2} onChange={setAreaPerPlantM2} />
        </>
      )}
      <ToolInput label={s.hoursPerDay} value={hoursPerDay} onChange={setHoursPerDay} placeholder="24" />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.netVolumeM3} value={proUnit(proNum(result.netVolumeM3, 2), s.unitM3)} />
          <ResultRow label={s.netVolumeL} value={proUnit(proNum(result.netVolumeL, 0), s.unitL)} />
          <ResultRow label={s.grossVolumeM3} value={proUnit(proNum(result.grossVolumeM3, 2), s.unitM3)} />
          <ResultRow label={s.flowM3h} value={proUnit(proNum(result.flowM3h, 3), s.unitM3h)} />
          <ResultRow
            label={s.timeHours}
            value={`${proNum(result.timeHoursPart, 0)} ${s.unitH} ${proNum(result.timeMinutesPart, 0)} ${s.unitMin}`}
          />
          <ResultRow label={s.daysNeeded} value={proNum(result.daysNeeded, 0)} />
          {result.sprinkler !== undefined && (
            <ToolSection title={s.sprinklerResults}>
              <ResultRow
                label={s.intensityMmH}
                value={proUnit(proNum(result.sprinkler.intensityMmH, 3), s.unitMmH)}
              />
              <ResultRow
                label={s.netTimePerPositionH}
                value={proUnit(proNum(result.sprinkler.netTimePerPositionH, 2), s.unitH)}
              />
              <ResultRow
                label={s.grossTimePerPositionH}
                value={proUnit(proNum(result.sprinkler.grossTimePerPositionH, 2), s.unitH)}
              />
              <ResultRow label={s.positions} value={proNum(result.sprinkler.positions, 2)} />
              <ResultRow label={s.positionsPerDay} value={proNum(result.sprinkler.positionsPerDay, 0)} />
            </ToolSection>
          )}
          {result.drip !== undefined && (
            <ToolSection title={s.dripResults}>
              <ResultRow
                label={s.netLitersPerPlant}
                value={proUnit(proNum(result.drip.netLitersPerPlant, 2), s.unitL)}
              />
              <ResultRow
                label={s.netDripDurationH}
                value={proUnit(proNum(result.drip.netDripDurationH, 2), s.unitH)}
              />
              <ResultRow
                label={s.grossLitersPerPlant}
                value={proUnit(proNum(result.drip.grossLitersPerPlant, 2), s.unitL)}
              />
              <ResultRow
                label={s.grossDripDurationH}
                value={proUnit(proNum(result.drip.grossDripDurationH, 2), s.unitH)}
              />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.normMm, value: proUnit(proNum(proParse(normMm) ?? 0, 2), s.unitMm) },
              { label: s.areaHa, value: proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa) },
              {
                label: s.efficiencyPercent,
                value: `${proNum(proParse(efficiencyPercent) ?? 0, 1)}${s.unitPercent}`,
              },
              { label: s.method, value: method === "sprinkler" ? s.methodSprinkler : s.methodDrip },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** One pasted feed row: naziv;SM %;udeo %;cena po kg (opciono);masa pakovanja (opciono). */
function parseFeedRow(line: string): RationFeed | undefined {
  const cells = splitRow(line);
  const name = cells[0];
  const dmText = cells[1];
  const shareText = cells[2];
  if (name === undefined || name === "" || dmText === undefined || shareText === undefined) return undefined;
  const dmPercent = proParse(dmText);
  const shareOfDmPercent = proParse(shareText);
  if (dmPercent === undefined || shareOfDmPercent === undefined) return undefined;
  const priceText = cells[3];
  const packageText = cells[4];
  return {
    name,
    dmPercent,
    shareOfDmPercent,
    pricePerKgFresh: priceText === undefined || priceText === "" ? undefined : proParse(priceText),
    packageMassKg: packageText === undefined || packageText === "" ? undefined : proParse(packageText),
  };
}

/**
 * Reads the feed mix as a pasted block — `naziv;SM %;udeo %;cena;pakovanje`,
 * one row per feed — rather than a fixed set of fields, so the ration can
 * hold anywhere from one to twenty feeds without twenty rows of state.
 */
export function LivestockRationDmTool() {
  const s = strings.pro.agro["livestock-ration-dm"];
  const [headCount, setHeadCount] = useState("");
  const [avgBodyMassKg, setAvgBodyMassKg] = useState("");
  const [intakeMode, setIntakeMode] = useState<IntakeMode>("percentOfBody");
  const [intakeValue, setIntakeValue] = useState("");
  const [feedsText, setFeedsText] = useState("");
  const [days, setDays] = useState("1");
  const [wastePercent, setWastePercent] = useState("0");

  const feedLines = feedsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const parsedFeeds = feedLines.map(parseFeedRow);
  const hasFeedParseError = feedLines.length > 0 && parsedFeeds.some((f) => f === undefined);
  const feeds: readonly RationFeed[] = parsedFeeds.filter((f): f is RationFeed => f !== undefined);

  const typed = [headCount, avgBodyMassKg, intakeValue].some((v) => proParse(v) !== undefined);

  const coreResult = hasFeedParseError
    ? undefined
    : livestockRationDm({
        headCount: proParse(headCount) ?? Number.NaN,
        avgBodyMassKg: proParse(avgBodyMassKg) ?? Number.NaN,
        intakeMode,
        intakeValue: proParse(intakeValue) ?? Number.NaN,
        feeds,
        days: proParse(days) ?? Number.NaN,
        wastePercent: proParse(wastePercent) ?? 0,
      });

  const reasonKey = coreResult === undefined || coreResult.ok ? "" : (coreResult.reason.split(":")[0] ?? "");
  const failure = !typed
    ? undefined
    : hasFeedParseError
      ? s.errorFeedParse
      : coreResult === undefined || coreResult.ok
        ? undefined
        : reasonKey === "headCount"
          ? s.errorHeadCount
          : reasonKey === "avgBodyMassKg"
            ? s.errorAvgBodyMassKg
            : reasonKey === "intakeValue"
              ? s.errorIntakeValue
              : reasonKey === "feeds"
                ? s.errorFeeds
                : reasonKey === "days"
                  ? s.errorDays
                  : reasonKey === "wastePercent"
                    ? s.errorWastePercent
                    : reasonKey === "dmPercent"
                      ? s.errorDmPercent
                      : reasonKey === "shareOfDmPercent"
                        ? s.errorShareOfDmPercent
                        : reasonKey === "pricePerKgFresh"
                          ? s.errorPricePerKgFresh
                          : reasonKey === "packageMassKg"
                            ? s.errorPackageMassKg
                            : s.errorGeneric;

  const result = coreResult !== undefined && coreResult.ok ? coreResult : undefined;

  const copyText =
    result === undefined
      ? ""
      : [
          `${s.dmPerHeadKgDay}: ${proUnit(proNum(result.dmPerHeadKgDay, 3), s.unitKg)}`,
          `${s.dmHerdKgDay}: ${proUnit(proNum(result.dmHerdKgDay, 2), s.unitKg)}`,
          `${s.shareSumPercent}: ${proNum(result.shareSumPercent, 2)}${s.unitPercent}`,
          ...result.feeds.map(
            (f) =>
              `${f.name}: ${s.freshIssuedKgPerDay} ${proUnit(proNum(f.freshIssuedKgPerDay, 2), s.unitKg)}   ${s.periodIssuedKg} ${proUnit(proNum(f.periodIssuedKg, 1), s.unitKg)}${f.packagesCeil === undefined ? "" : `   ${s.packagesCeil} ${proNum(f.packagesCeil, 0)}`}`,
          ),
          `${s.totalFreshEatenKgDay}: ${proUnit(proNum(result.totalFreshEatenKgDay, 2), s.unitKg)}`,
          `${s.totalFreshIssuedKgDay}: ${proUnit(proNum(result.totalFreshIssuedKgDay, 2), s.unitKg)}`,
          result.rationDmPercentAsIssued === undefined
            ? undefined
            : `${s.rationDmPercentAsIssued}: ${proNum(result.rationDmPercentAsIssued, 2)}${s.unitPercent}`,
          result.cost === undefined
            ? undefined
            : `${s.totalDailyCost}: ${proUnit(proNum(result.cost.totalDailyCost, 2), s.unitRsd)}   ` +
              `${s.totalPeriodCost}: ${proUnit(proNum(result.cost.totalPeriodCost, 2), s.unitRsd)}`,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

  return (
    <>
      <ToolInput label={s.headCount} value={headCount} onChange={setHeadCount} />
      <ToolInput label={s.avgBodyMassKg} value={avgBodyMassKg} onChange={setAvgBodyMassKg} />
      <ToolSelect<IntakeMode>
        label={s.intakeMode}
        value={intakeMode}
        onChange={setIntakeMode}
        options={[
          { id: "percentOfBody", label: s.intakeModePercent },
          { id: "kgPerHeadPerDay", label: s.intakeModeKg },
        ]}
      />
      <ToolInput label={s.intakeValue} hint={s.intakeValueHint} value={intakeValue} onChange={setIntakeValue} />
      <ToolTextArea
        label={s.feedsText}
        hint={s.feedsTextHint}
        value={feedsText}
        onChange={setFeedsText}
        placeholder={s.feedsTextPlaceholder}
        rows={8}
      />
      <ToolInput label={s.days} value={days} onChange={setDays} placeholder="1" />
      <ToolInput label={s.wastePercent} value={wastePercent} onChange={setWastePercent} placeholder="0" />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && (
        <ToolSection title={s.results}>
          <ResultRow label={s.dmPerHeadKgDay} value={proUnit(proNum(result.dmPerHeadKgDay, 3), s.unitKg)} />
          <ResultRow label={s.dmHerdKgDay} value={proUnit(proNum(result.dmHerdKgDay, 2), s.unitKg)} />
          <ResultRow label={s.shareSumPercent} value={`${proNum(result.shareSumPercent, 2)}${s.unitPercent}`} />
          <ToolTable
            head={[s.colFeed, s.colDmKgDay, s.colFreshEaten, s.colFreshIssued, s.colPeriodIssued, s.colPackages, s.colCost]}
            rows={result.feeds.map((f) => [
              f.name,
              proNum(f.dmKgPerDay, 2),
              proNum(f.freshEatenKgPerDay, 2),
              proNum(f.freshIssuedKgPerDay, 2),
              proUnit(proNum(f.periodIssuedKg, 1), s.unitKg),
              f.packagesCeil === undefined ? "—" : proNum(f.packagesCeil, 0),
              f.dailyCost === undefined ? "—" : proUnit(proNum(f.dailyCost, 2), s.unitRsd),
            ])}
            prose={[0]}
          />
          <ResultRow label={s.totalFreshEatenKgDay} value={proUnit(proNum(result.totalFreshEatenKgDay, 2), s.unitKg)} />
          <ResultRow
            label={s.totalFreshIssuedKgDay}
            value={proUnit(proNum(result.totalFreshIssuedKgDay, 2), s.unitKg)}
          />
          <ResultRow
            label={s.totalFreshEatenPerHeadKgDay}
            value={proUnit(proNum(result.totalFreshEatenPerHeadKgDay, 3), s.unitKg)}
          />
          {result.rationDmPercentAsIssued !== undefined && (
            <ResultRow
              label={s.rationDmPercentAsIssued}
              value={`${proNum(result.rationDmPercentAsIssued, 2)}${s.unitPercent}`}
            />
          )}
          {result.cost !== undefined && (
            <ToolSection title={s.cost}>
              <ResultRow label={s.totalDailyCost} value={proUnit(proNum(result.cost.totalDailyCost, 2), s.unitRsd)} />
              <ResultRow
                label={s.totalPeriodCost}
                value={proUnit(proNum(result.cost.totalPeriodCost, 2), s.unitRsd)}
              />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.headCount, value: proNum(proParse(headCount) ?? 0, 0) },
              { label: s.avgBodyMassKg, value: proUnit(proNum(proParse(avgBodyMassKg) ?? 0, 1), s.unitKg) },
              { label: s.days, value: proNum(proParse(days) ?? 0, 0) },
              { label: s.wastePercent, value: `${proNum(proParse(wastePercent) ?? 0, 1)}${s.unitPercent}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function MachineFieldCapacityTool() {
  const s = strings.pro.agro["machine-field-capacity"];
  const [nominalWidthM, setNominalWidthM] = useState("");
  const [overlapPercent, setOverlapPercent] = useState("0");
  const [speedKmh, setSpeedKmh] = useState("");
  const [utilizationPercent, setUtilizationPercent] = useState("");
  const [areaHa, setAreaHa] = useState("");
  const [fuelLPerHour, setFuelLPerHour] = useState("");
  const [fuelPricePerL, setFuelPricePerL] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("8");
  const [turnSeconds, setTurnSeconds] = useState("");
  const [fieldLengthM, setFieldLengthM] = useState("");

  const typed = [nominalWidthM, speedKmh, utilizationPercent, areaHa].some((v) => proParse(v) !== undefined);
  const result = machineFieldCapacity({
    nominalWidthM: proParse(nominalWidthM) ?? Number.NaN,
    overlapPercent: proParse(overlapPercent) ?? 0,
    speedKmh: proParse(speedKmh) ?? Number.NaN,
    utilizationPercent: proParse(utilizationPercent) ?? Number.NaN,
    areaHa: proParse(areaHa) ?? Number.NaN,
    fuelLPerHour: proParse(fuelLPerHour),
    fuelPricePerL: proParse(fuelPricePerL),
    hoursPerDay: proParse(hoursPerDay) ?? Number.NaN,
    turnSeconds: proParse(turnSeconds),
    fieldLengthM: proParse(fieldLengthM),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "nominalWidthM"
        ? s.errorNominalWidthM
        : result.reason === "overlapPercent"
          ? s.errorOverlapPercent
          : result.reason === "speedKmh"
            ? s.errorSpeedKmh
            : result.reason === "utilizationPercent"
              ? s.errorUtilizationPercent
              : result.reason === "areaHa"
                ? s.errorAreaHa
                : result.reason === "hoursPerDay"
                  ? s.errorHoursPerDay
                  : result.reason === "fuelLPerHour"
                    ? s.errorFuelLPerHour
                    : result.reason === "fuelPricePerL"
                      ? s.errorFuelPricePerL
                      : result.reason === "turnSeconds"
                        ? s.errorTurnSeconds
                        : result.reason === "fieldLengthM"
                          ? s.errorFieldLengthM
                          : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.actualWidthM}: ${proUnit(proNum(result.actualWidthM, 2), s.unitM)}`,
        `${s.theoreticalCapacityHaH}: ${proUnit(proNum(result.theoreticalCapacityHaH, 2), s.unitHaH)}`,
        `${s.effectiveCapacityHaH}: ${proUnit(proNum(result.effectiveCapacityHaH, 2), s.unitHaH)}`,
        `${s.timeHours}: ${proNum(result.timeHoursPart, 0)} ${s.unitH} ${proNum(result.timeMinutesPart, 0)} ${s.unitMin}`,
        `${s.daysNeeded}: ${proNum(result.daysNeeded, 0)}`,
        `${s.capacityPerDayHa}: ${proUnit(proNum(result.capacityPerDayHa, 2), s.unitHa)}`,
        `${s.lastDayHours}: ${proUnit(proNum(result.lastDayHours, 2), s.unitH)}`,
        result.fuel === undefined
          ? undefined
          : `${s.fuelLPerHa}: ${proUnit(proNum(result.fuel.fuelLPerHa, 2), s.unitLHa)}   ` +
            `${s.fuelTotalL}: ${proUnit(proNum(result.fuel.fuelTotalL, 1), s.unitL)}`,
        result.fuel?.cost === undefined
          ? undefined
          : `${s.fuelCostPerHa}: ${proUnit(proNum(result.fuel.cost.fuelCostPerHa, 2), s.unitRsd)}   ` +
            `${s.fuelCostTotal}: ${proUnit(proNum(result.fuel.cost.fuelCostTotal, 2), s.unitRsd)}`,
        result.turns === undefined
          ? undefined
          : `${s.turnCount}: ${proNum(result.turns.turnCount, 0)}   ` +
            `${s.turnTimeHours}: ${proUnit(proNum(result.turns.turnTimeHours, 2), s.unitH)}   ` +
            `${s.turnTimeSharePercent}: ${proNum(result.turns.turnTimeSharePercent, 2)}${s.unitPercent}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.nominalWidthM} value={nominalWidthM} onChange={setNominalWidthM} />
      <ToolInput label={s.overlapPercent} value={overlapPercent} onChange={setOverlapPercent} placeholder="0" />
      <ToolInput label={s.speedKmh} value={speedKmh} onChange={setSpeedKmh} />
      <ToolInput
        label={s.utilizationPercent}
        hint={s.utilizationPercentHint}
        value={utilizationPercent}
        onChange={setUtilizationPercent}
      />
      <ToolInput label={s.areaHa} value={areaHa} onChange={setAreaHa} />
      <ToolInput label={s.fuelLPerHour} value={fuelLPerHour} onChange={setFuelLPerHour} />
      <ToolInput label={s.fuelPricePerL} value={fuelPricePerL} onChange={setFuelPricePerL} />
      <ToolInput label={s.hoursPerDay} value={hoursPerDay} onChange={setHoursPerDay} placeholder="8" />
      <ToolInput label={s.turnSeconds} value={turnSeconds} onChange={setTurnSeconds} />
      <ToolInput label={s.fieldLengthM} value={fieldLengthM} onChange={setFieldLengthM} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.actualWidthM} value={proUnit(proNum(result.actualWidthM, 2), s.unitM)} />
          <ResultRow label={s.theoreticalCapacityHaH} value={proUnit(proNum(result.theoreticalCapacityHaH, 2), s.unitHaH)} />
          <ResultRow label={s.effectiveCapacityHaH} value={proUnit(proNum(result.effectiveCapacityHaH, 2), s.unitHaH)} />
          <ResultRow
            label={s.timeHours}
            value={`${proNum(result.timeHoursPart, 0)} ${s.unitH} ${proNum(result.timeMinutesPart, 0)} ${s.unitMin}`}
          />
          <ResultRow label={s.daysNeeded} value={proNum(result.daysNeeded, 0)} />
          <ResultRow label={s.capacityPerDayHa} value={proUnit(proNum(result.capacityPerDayHa, 2), s.unitHa)} />
          <ResultRow label={s.lastDayHours} value={proUnit(proNum(result.lastDayHours, 2), s.unitH)} />
          {result.fuel !== undefined && (
            <ToolSection title={s.fuel}>
              <ResultRow label={s.fuelLPerHa} value={proUnit(proNum(result.fuel.fuelLPerHa, 2), s.unitLHa)} />
              <ResultRow label={s.fuelTotalL} value={proUnit(proNum(result.fuel.fuelTotalL, 1), s.unitL)} />
              {result.fuel.cost !== undefined && (
                <>
                  <ResultRow
                    label={s.fuelCostPerHa}
                    value={proUnit(proNum(result.fuel.cost.fuelCostPerHa, 2), s.unitRsd)}
                  />
                  <ResultRow
                    label={s.fuelCostTotal}
                    value={proUnit(proNum(result.fuel.cost.fuelCostTotal, 2), s.unitRsd)}
                  />
                </>
              )}
            </ToolSection>
          )}
          {result.turns !== undefined && (
            <ToolSection title={s.turns}>
              <ResultRow label={s.turnCount} value={proNum(result.turns.turnCount, 0)} />
              <ResultRow label={s.turnTimeHours} value={proUnit(proNum(result.turns.turnTimeHours, 2), s.unitH)} />
              <ResultRow
                label={s.turnTimeSharePercent}
                value={`${proNum(result.turns.turnTimeSharePercent, 2)}${s.unitPercent}`}
              />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.nominalWidthM, value: proUnit(proNum(proParse(nominalWidthM) ?? 0, 2), s.unitM) },
              { label: s.speedKmh, value: proUnit(proNum(proParse(speedKmh) ?? 0, 2), s.unitKmh) },
              {
                label: s.utilizationPercent,
                value: `${proNum(proParse(utilizationPercent) ?? 0, 1)}${s.unitPercent}`,
              },
              { label: s.areaHa, value: proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function OrchardTrellisLayoutTool() {
  const s = strings.pro.agro["orchard-trellis-layout"];
  const [lengthM, setLengthM] = useState("");
  const [widthM, setWidthM] = useState("");
  const [rowSpacingM, setRowSpacingM] = useState("");
  const [headlandM, setHeadlandM] = useState("0");
  const [boundaryOffsetM, setBoundaryOffsetM] = useState("0");
  const [postSpacingM, setPostSpacingM] = useState("");
  const [wireRows, setWireRows] = useState("");
  const [wireDiameterMm, setWireDiameterMm] = useState("");
  const [wireSlackPercent, setWireSlackPercent] = useState("5");
  const [plantSpacingM, setPlantSpacingM] = useState("");
  const [anchorsPerEnd, setAnchorsPerEnd] = useState("1");
  const [coilLengthM, setCoilLengthM] = useState("");
  const [plantAtBothEnds, setPlantAtBothEnds] = useState<"yes" | "no">("yes");
  const [wireMassPerKmOverride, setWireMassPerKmOverride] = useState("");

  const typed = [lengthM, widthM, rowSpacingM, postSpacingM, wireRows, plantSpacingM].some(
    (v) => proParse(v) !== undefined,
  );
  const result = orchardTrellisLayout({
    lengthM: proParse(lengthM) ?? Number.NaN,
    widthM: proParse(widthM) ?? Number.NaN,
    rowSpacingM: proParse(rowSpacingM) ?? Number.NaN,
    headlandM: proParse(headlandM) ?? 0,
    boundaryOffsetM: proParse(boundaryOffsetM) ?? 0,
    postSpacingM: proParse(postSpacingM) ?? Number.NaN,
    wireRows: proParse(wireRows) ?? Number.NaN,
    wireDiameterMm: proParse(wireDiameterMm),
    wireSlackPercent: proParse(wireSlackPercent) ?? 0,
    plantSpacingM: proParse(plantSpacingM) ?? Number.NaN,
    anchorsPerEnd: proParse(anchorsPerEnd) ?? 0,
    coilLengthM: proParse(coilLengthM),
    plantAtBothEnds: plantAtBothEnds === "yes",
    wireMassPerKmOverride: proParse(wireMassPerKmOverride),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "lengthM"
        ? s.errorLengthM
        : result.reason === "widthM"
          ? s.errorWidthM
          : result.reason === "rowSpacingM"
            ? s.errorRowSpacingM
            : result.reason === "headlandM"
              ? s.errorHeadlandM
              : result.reason === "boundaryOffsetM"
                ? s.errorBoundaryOffsetM
                : result.reason === "postSpacingM"
                  ? s.errorPostSpacingM
                  : result.reason === "wireRows"
                    ? s.errorWireRows
                    : result.reason === "wireDiameterMm"
                      ? s.errorWireDiameterMm
                      : result.reason === "wireSlackPercent"
                        ? s.errorWireSlackPercent
                        : result.reason === "plantSpacingM"
                          ? s.errorPlantSpacingM
                          : result.reason === "anchorsPerEnd"
                            ? s.errorAnchorsPerEnd
                            : result.reason === "coilLengthM"
                              ? s.errorCoilLengthM
                              : result.reason === "wireMassPerKmOverride"
                                ? s.errorWireMassPerKmOverride
                                : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.rowsCount}: ${proNum(result.rowsCount, 0)}${result.zeroRows ? ` (${s.zeroRowsNote})` : ""}`,
        `${s.rowLengthM}: ${proUnit(proNum(result.rowLengthM, 2), s.unitM)}`,
        `${s.totalRowLengthM}: ${proUnit(proNum(result.totalRowLengthM, 1), s.unitM)}`,
        `${s.postsPerRow}: ${proNum(result.postsPerRow, 0)} (${s.endPostsPerRow} ${proNum(result.endPostsPerRow, 0)}, ${s.midPostsPerRow} ${proNum(result.midPostsPerRow, 0)})`,
        `${s.actualPostSpacingM}: ${proUnit(proNum(result.actualPostSpacingM, 3), s.unitM)}`,
        `${s.totalPosts}: ${proNum(result.totalPosts, 0)}`,
        `${s.anchors}: ${proNum(result.anchors, 0)}`,
        `${s.wireLengthM}: ${proUnit(proNum(result.wireLengthM, 1), s.unitM)}`,
        result.wireMassKg === undefined ? undefined : `${s.wireMassKg}: ${proUnit(proNum(result.wireMassKg, 2), s.unitKg)}`,
        result.coils === undefined
          ? undefined
          : `${s.coilsCeil}: ${proNum(result.coils.coilsCeil, 0)}` +
            (result.coils.kgPerCoil === undefined
              ? ""
              : `   ${s.kgPerCoil}: ${proUnit(proNum(result.coils.kgPerCoil, 2), s.unitKg)}`),
        `${s.plantsPerRow}: ${proNum(result.plantsPerRow, 0)}`,
        `${s.totalPlants}: ${proNum(result.totalPlants, 0)}`,
        `${s.plotAreaHa}: ${proUnit(proNum(result.plotAreaHa, 3), s.unitHa)}`,
        `${s.usedAreaHa}: ${proUnit(proNum(result.usedAreaHa, 3), s.unitHa)}`,
        `${s.densityPerHa}: ${proNum(result.densityPerHa, 1)}   ${s.theoreticalDensityPerHa}: ${proNum(result.theoreticalDensityPerHa, 1)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.lengthM} value={lengthM} onChange={setLengthM} />
      <ToolInput label={s.widthM} value={widthM} onChange={setWidthM} />
      <ToolInput label={s.rowSpacingM} value={rowSpacingM} onChange={setRowSpacingM} />
      <ToolInput label={s.headlandM} value={headlandM} onChange={setHeadlandM} placeholder="0" />
      <ToolInput label={s.boundaryOffsetM} value={boundaryOffsetM} onChange={setBoundaryOffsetM} placeholder="0" />
      <ToolInput
        label={s.postSpacingM}
        hint={s.postSpacingMHint}
        value={postSpacingM}
        onChange={setPostSpacingM}
      />
      <ToolInput label={s.wireRows} value={wireRows} onChange={setWireRows} />
      <ToolInput label={s.wireDiameterMm} value={wireDiameterMm} onChange={setWireDiameterMm} />
      <ToolInput label={s.wireSlackPercent} value={wireSlackPercent} onChange={setWireSlackPercent} placeholder="5" />
      <ToolInput label={s.plantSpacingM} value={plantSpacingM} onChange={setPlantSpacingM} />
      <ToolInput label={s.anchorsPerEnd} value={anchorsPerEnd} onChange={setAnchorsPerEnd} placeholder="1" />
      <ToolInput
        label={s.coilLengthM}
        hint={s.coilLengthMHint}
        value={coilLengthM}
        onChange={setCoilLengthM}
      />
      <ToolSelect<"yes" | "no">
        label={s.plantAtBothEnds}
        value={plantAtBothEnds}
        onChange={setPlantAtBothEnds}
        options={[
          { id: "yes", label: s.plantAtBothEndsYes },
          { id: "no", label: s.plantAtBothEndsNo },
        ]}
      />
      <ToolInput
        label={s.wireMassPerKmOverride}
        hint={s.wireMassPerKmOverrideHint}
        value={wireMassPerKmOverride}
        onChange={setWireMassPerKmOverride}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.zeroRows && <p className="nx-hint nx-hint--prose">{s.zeroRowsNote}</p>}
          <ResultRow label={s.rowsCount} value={proNum(result.rowsCount, 0)} />
          <ResultRow label={s.rowLengthM} value={proUnit(proNum(result.rowLengthM, 2), s.unitM)} />
          <ResultRow label={s.totalRowLengthM} value={proUnit(proNum(result.totalRowLengthM, 1), s.unitM)} />
          <ResultRow label={s.postsPerRow} value={proNum(result.postsPerRow, 0)} />
          <ResultRow label={s.endPostsPerRow} value={proNum(result.endPostsPerRow, 0)} />
          <ResultRow label={s.midPostsPerRow} value={proNum(result.midPostsPerRow, 0)} />
          <ResultRow label={s.actualPostSpacingM} value={proUnit(proNum(result.actualPostSpacingM, 3), s.unitM)} />
          <ResultRow label={s.totalPosts} value={proNum(result.totalPosts, 0)} />
          <ResultRow label={s.anchors} value={proNum(result.anchors, 0)} />
          <ResultRow label={s.wireLengthM} value={proUnit(proNum(result.wireLengthM, 1), s.unitM)} />
          {result.wireMassKg !== undefined && (
            <ResultRow label={s.wireMassKg} value={proUnit(proNum(result.wireMassKg, 2), s.unitKg)} />
          )}
          {result.coils !== undefined && (
            <>
              <ResultRow label={s.coilsCeil} value={proNum(result.coils.coilsCeil, 0)} />
              {result.coils.kgPerCoil !== undefined && (
                <ResultRow
                  label={s.kgPerCoil}
                  value={proUnit(proNum(result.coils.kgPerCoil, 2), s.unitKg)}
                />
              )}
            </>
          )}
          <ResultRow label={s.plantsPerRow} value={proNum(result.plantsPerRow, 0)} />
          <ResultRow label={s.totalPlants} value={proNum(result.totalPlants, 0)} />
          <ResultRow label={s.plotAreaHa} value={proUnit(proNum(result.plotAreaHa, 3), s.unitHa)} />
          <ResultRow label={s.usedAreaHa} value={proUnit(proNum(result.usedAreaHa, 3), s.unitHa)} />
          <ResultRow label={s.densityPerHa} value={proNum(result.densityPerHa, 1)} />
          <ResultRow label={s.theoreticalDensityPerHa} value={proNum(result.theoreticalDensityPerHa, 1)} />
          <p className="nx-hint nx-hint--prose">{s.geometryNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.lengthM, value: proUnit(proNum(proParse(lengthM) ?? 0, 1), s.unitM) },
              { label: s.widthM, value: proUnit(proNum(proParse(widthM) ?? 0, 1), s.unitM) },
              { label: s.rowSpacingM, value: proUnit(proNum(proParse(rowSpacingM) ?? 0, 2), s.unitM) },
              { label: s.postSpacingM, value: proUnit(proNum(proParse(postSpacingM) ?? 0, 2), s.unitM) },
              { label: s.plantSpacingM, value: proUnit(proNum(proParse(plantSpacingM) ?? 0, 2), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function PlantSpacingDensityTool() {
  const s = strings.pro.agro["plant-spacing-density"];
  const [pattern, setPattern] = useState<PlantingPattern>("rectangular");
  const [rowSpacingM, setRowSpacingM] = useState("");
  const [spacingM, setSpacingM] = useState("");
  const [lengthM, setLengthM] = useState("");
  const [widthM, setWidthM] = useState("");
  const [headlandM, setHeadlandM] = useState("0");
  const [boundaryOffsetM, setBoundaryOffsetM] = useState("0");
  const [desiredDensityPerHa, setDesiredDensityPerHa] = useState("");

  const typed = proParse(rowSpacingM) !== undefined || proParse(spacingM) !== undefined;
  const result = plantSpacingDensity({
    pattern,
    rowSpacingM: proParse(rowSpacingM) ?? Number.NaN,
    spacingM: proParse(spacingM) ?? Number.NaN,
    lengthM: proParse(lengthM),
    widthM: proParse(widthM),
    headlandM: proParse(headlandM) ?? 0,
    boundaryOffsetM: proParse(boundaryOffsetM) ?? 0,
    desiredDensityPerHa: proParse(desiredDensityPerHa),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "rowSpacingM"
        ? s.errorRowSpacingM
        : result.reason === "spacingM"
          ? s.errorSpacingM
          : result.reason === "headlandM"
            ? s.errorHeadlandM
            : result.reason === "boundaryOffsetM"
              ? s.errorBoundaryOffsetM
              : result.reason === "desiredDensityPerHa"
                ? s.errorDesiredDensityPerHa
                : result.reason === "lengthM"
                  ? s.errorLengthM
                  : result.reason === "widthM"
                    ? s.errorWidthM
                    : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.areaPerPlantM2}: ${proUnit(proNum(result.areaPerPlantM2, 4), s.unitM2)}`,
        `${s.theoreticalDensityPerHa}: ${proNum(result.theoreticalDensityPerHa, 2)}`,
        result.onParcel === undefined
          ? undefined
          : `${s.rowsCount}: ${proNum(result.onParcel.rowsCount, 0)}   ` +
            `${s.plantsPerRow}: ${proNum(result.onParcel.plantsPerRow, 0)}   ` +
            `${s.totalPlants}: ${proNum(result.onParcel.totalPlants, 0)}`,
        result.onParcel === undefined
          ? undefined
          : `${s.plotAreaHa}: ${proUnit(proNum(result.onParcel.plotAreaHa, 3), s.unitHa)}   ` +
            `${s.usedAreaHa}: ${proUnit(proNum(result.onParcel.usedAreaHa, 3), s.unitHa)}   ` +
            `${s.actualDensityPerHa}: ${proNum(result.onParcel.actualDensityPerHa, 2)}`,
        result.desired === undefined
          ? undefined
          : `${s.requiredInRowSpacingM}: ${proUnit(proNum(result.desired.requiredInRowSpacingM, 4), s.unitM)}   ` +
            `${s.requiredSpacingRoundedM}: ${proUnit(proNum(result.desired.requiredSpacingRoundedM, 2), s.unitM)}   ` +
            `${s.densityAtRoundedSpacing}: ${proNum(result.desired.densityAtRoundedSpacing, 2)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<PlantingPattern>
        label={s.pattern}
        value={pattern}
        onChange={setPattern}
        options={[
          { id: "rectangular", label: s.patternRectangular },
          { id: "triangular", label: s.patternTriangular },
        ]}
      />
      <ToolInput label={s.rowSpacingM} value={rowSpacingM} onChange={setRowSpacingM} />
      <ToolInput label={s.spacingM} hint={s.spacingMHint} value={spacingM} onChange={setSpacingM} />
      <ToolInput label={s.lengthM} value={lengthM} onChange={setLengthM} />
      <ToolInput label={s.widthM} value={widthM} onChange={setWidthM} />
      <ToolInput label={s.headlandM} value={headlandM} onChange={setHeadlandM} placeholder="0" />
      <ToolInput label={s.boundaryOffsetM} value={boundaryOffsetM} onChange={setBoundaryOffsetM} placeholder="0" />
      <ToolInput label={s.desiredDensityPerHa} value={desiredDensityPerHa} onChange={setDesiredDensityPerHa} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.areaPerPlantM2} value={proUnit(proNum(result.areaPerPlantM2, 4), s.unitM2)} />
          <ResultRow label={s.theoreticalDensityPerHa} value={proNum(result.theoreticalDensityPerHa, 2)} />
          {result.onParcel !== undefined && (
            <ToolSection title={s.onParcel}>
              <ResultRow label={s.rowsCount} value={proNum(result.onParcel.rowsCount, 0)} />
              <ResultRow label={s.rowLengthM} value={proUnit(proNum(result.onParcel.rowLengthM, 2), s.unitM)} />
              <ResultRow label={s.plantsPerRow} value={proNum(result.onParcel.plantsPerRow, 0)} />
              <ResultRow label={s.totalPlants} value={proNum(result.onParcel.totalPlants, 0)} />
              <ResultRow label={s.plotAreaHa} value={proUnit(proNum(result.onParcel.plotAreaHa, 3), s.unitHa)} />
              <ResultRow label={s.usedAreaHa} value={proUnit(proNum(result.onParcel.usedAreaHa, 3), s.unitHa)} />
              <ResultRow label={s.actualDensityPerHa} value={proNum(result.onParcel.actualDensityPerHa, 2)} />
            </ToolSection>
          )}
          {pattern === "triangular" && <p className="nx-hint nx-hint--prose">{s.triangularNote}</p>}
          {result.desired !== undefined && (
            <ToolSection title={s.reverse}>
              <ResultRow
                label={s.requiredInRowSpacingM}
                value={proUnit(proNum(result.desired.requiredInRowSpacingM, 4), s.unitM)}
              />
              <ResultRow
                label={s.requiredSpacingRoundedM}
                value={proUnit(proNum(result.desired.requiredSpacingRoundedM, 2), s.unitM)}
              />
              <ResultRow
                label={s.densityAtRoundedSpacing}
                value={proNum(result.desired.densityAtRoundedSpacing, 2)}
              />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pattern, value: pattern === "rectangular" ? s.patternRectangular : s.patternTriangular },
              { label: s.rowSpacingM, value: proUnit(proNum(proParse(rowSpacingM) ?? 0, 2), s.unitM) },
              { label: s.spacingM, value: proUnit(proNum(proParse(spacingM) ?? 0, 2), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** One pasted vertex row, „a b" separated by whitespace, semicolon or tab. */
function parseVertexRow(line: string): PolygonVertex | undefined {
  const cells = line
    .trim()
    .split(/[\s;\t]+/)
    .filter((c) => c !== "");
  const aText = cells[0];
  const bText = cells[1];
  if (aText === undefined || bText === undefined) return undefined;
  const a = proParse(aText);
  const b = proParse(bText);
  return a === undefined || b === undefined ? undefined : { a, b };
}

type AreaUnitDisplay = "all" | "m2" | "ar" | "ha";

/** Reads a pasted coordinate list, one vertex per line — the shape a Serbian cadastral sheet is copied out in. */
export function PolygonAreaTool() {
  const s = strings.pro.agro["polygon-area"];
  const [verticesText, setVerticesText] = useState("");
  const [columnOrder, setColumnOrder] = useState<PolygonColumnOrder>("YX");
  const [unitDisplay, setUnitDisplay] = useState<AreaUnitDisplay>("all");

  const lines = verticesText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const parsedVertices = lines.map(parseVertexRow);
  const hasParseError = lines.length > 0 && parsedVertices.some((v) => v === undefined);
  const vertices: readonly PolygonVertex[] = parsedVertices.filter((v): v is PolygonVertex => v !== undefined);
  const typed = hasPastedRows(verticesText);

  const coreResult = hasParseError ? undefined : polygonArea({ vertices, columnOrder });
  const reasonKey = coreResult === undefined || coreResult.ok ? "" : (coreResult.reason.split(":")[0] ?? "");
  const failure = !typed
    ? undefined
    : hasParseError
      ? s.errorParse
      : coreResult === undefined || coreResult.ok
        ? undefined
        : reasonKey === "vertices"
          ? s.errorVertices
          : reasonKey === "intersect"
            ? s.errorIntersect
            : s.errorGeneric;

  const result = coreResult !== undefined && coreResult.ok ? coreResult : undefined;
  const windingLabel = result === undefined ? "—" : result.winding === "ccw" ? s.windingCcw : s.windingCw;
  const colFirst = columnOrder === "YX" ? s.colY : s.colX;
  const colSecond = columnOrder === "YX" ? s.colX : s.colY;

  const copyText =
    result === undefined
      ? ""
      : [
          `${s.areaM2}: ${proUnit(proNum(result.areaM2, 3), s.unitM2)}`,
          `${s.areaAr}: ${proUnit(proNum(result.areaAr, 3), s.unitAr)}`,
          `${s.areaHa}: ${proUnit(proNum(result.areaHa, 3), s.unitHa)}`,
          `${s.perimeterM}: ${proUnit(proNum(result.perimeterM, 3), s.unitM)}`,
          result.centroid === undefined
            ? s.centroidUndefined
            : `${s.centroid}: (${colFirst} ${proNum(result.centroid.a, 4)}, ${colSecond} ${proNum(result.centroid.b, 4)})`,
          `${s.winding}: ${windingLabel}`,
        ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.verticesText}
        hint={s.verticesTextHint}
        value={verticesText}
        onChange={setVerticesText}
        placeholder={"0 0\n30 0\n0 40"}
        rows={10}
      />
      <ToolSelect<PolygonColumnOrder>
        label={s.columnOrder}
        value={columnOrder}
        onChange={setColumnOrder}
        options={[
          { id: "YX", label: s.columnOrderYX },
          { id: "XY", label: s.columnOrderXY },
        ]}
      />
      <ToolSelect<AreaUnitDisplay>
        label={s.unitDisplay}
        value={unitDisplay}
        onChange={setUnitDisplay}
        options={[
          { id: "all", label: s.unitDisplayAll },
          { id: "m2", label: s.unitM2 },
          { id: "ar", label: s.unitAr },
          { id: "ha", label: s.unitHa },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && (
        <ToolSection title={s.results}>
          {(unitDisplay === "all" || unitDisplay === "m2") && (
            <ResultRow label={s.areaM2} value={proUnit(proNum(result.areaM2, 3), s.unitM2)} />
          )}
          {(unitDisplay === "all" || unitDisplay === "ar") && (
            <ResultRow label={s.areaAr} value={proUnit(proNum(result.areaAr, 3), s.unitAr)} />
          )}
          {(unitDisplay === "all" || unitDisplay === "ha") && (
            <ResultRow label={s.areaHa} value={proUnit(proNum(result.areaHa, 3), s.unitHa)} />
          )}
          <ResultRow label={s.perimeterM} value={proUnit(proNum(result.perimeterM, 3), s.unitM)} />
          {result.centroid === undefined ? (
            <p className="nx-hint nx-hint--prose">{s.centroidUndefined}</p>
          ) : (
            <ResultRow
              label={s.centroid}
              value={`(${colFirst} ${proNum(result.centroid.a, 4)}, ${colSecond} ${proNum(result.centroid.b, 4)})`}
            />
          )}
          <ResultRow label={s.winding} value={windingLabel} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.columnOrder, value: columnOrder === "YX" ? s.columnOrderYX : s.columnOrderXY },
              { label: s.vertexCount, value: proNum(vertices.length, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function SeedingRateTool() {
  const s = strings.pro.agro["seeding-rate"];
  const [standMode, setStandMode] = useState<SeedStandMode>("perM2");
  const [standValue, setStandValue] = useState("");
  const [tkwGrams, setTkwGrams] = useState("");
  const [germinationPercent, setGerminationPercent] = useState("");
  const [purityPercent, setPurityPercent] = useState("100");
  const [fieldLossPercent, setFieldLossPercent] = useState("0");
  const [areaHa, setAreaHa] = useState("1");
  const [bagMassKg, setBagMassKg] = useState("25");
  const [rowSpacingCm, setRowSpacingCm] = useState("");
  const [seedsPerUnit, setSeedsPerUnit] = useState("");
  const [priceMode, setPriceMode] = useState<SeedPriceMode | "none">("none");
  const [pricePerKg, setPricePerKg] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");

  const typed = [standValue, tkwGrams, germinationPercent].some((v) => proParse(v) !== undefined);
  // Both fields are PRE-FILLED rather than optional, so „cleared" is a state the
  // user can reach and these two lines are what it means. `seedingRate` takes
  // both as required, so the default is this surface's — and it was written
  // twice with two different values: the call used 100 and the echo below used
  // `?? 0`, so clearing the purity box made the arithmetic use 100 while the
  // screen said „0 %". One expression, read by both.
  const purityUsed = proParse(purityPercent) ?? 100;
  const fieldLossUsed = proParse(fieldLossPercent) ?? 0;
  const result = seedingRate({
    standMode,
    standValue: proParse(standValue) ?? Number.NaN,
    tkwGrams: proParse(tkwGrams) ?? Number.NaN,
    germinationPercent: proParse(germinationPercent) ?? Number.NaN,
    purityPercent: purityUsed,
    fieldLossPercent: fieldLossUsed,
    areaHa: proParse(areaHa) ?? Number.NaN,
    bagMassKg: proParse(bagMassKg) ?? Number.NaN,
    rowSpacingCm: proParse(rowSpacingCm),
    seedsPerUnit: proParse(seedsPerUnit),
    priceMode: priceMode === "none" ? undefined : priceMode,
    pricePerKg: proParse(pricePerKg),
    pricePerUnit: proParse(pricePerUnit),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "standValue"
        ? s.errorStandValue
        : result.reason === "tkwGrams"
          ? s.errorTkwGrams
          : result.reason === "germinationPercent"
            ? s.errorGerminationPercent
            : result.reason === "purityPercent"
              ? s.errorPurityPercent
              : result.reason === "fieldLossPercent"
                ? s.errorFieldLossPercent
                : result.reason === "areaHa"
                  ? s.errorAreaHa
                  : result.reason === "bagMassKg"
                    ? s.errorBagMassKg
                    : result.reason === "rowSpacingCm"
                      ? s.errorRowSpacingCm
                      : result.reason === "seedsPerUnit"
                        ? s.errorSeedsPerUnit
                        : result.reason === "pricePerKg"
                          ? s.errorPricePerKg
                          : result.reason === "pricePerUnit"
                            ? s.errorPricePerUnit
                            : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.normKgHa}: ${proUnit(proNum(result.normKgHa, 2), s.unitKgHa)}`,
        `${s.seedsPerM2}: ${proNum(result.seedsPerM2, 2)}   ${s.seedsPerHa}: ${proNum(result.seedsPerHa, 0)}`,
        `${s.totalSeedKg}: ${proUnit(proNum(result.totalSeedKg, 2), s.unitKg)}`,
        `${s.bagsExact}: ${proNum(result.bagsExact, 2)}   ${s.bagsCeil}: ${proNum(result.bagsCeil, 0)}`,
        `${s.totalSeeds}: ${proNum(result.totalSeeds, 0)}`,
        result.units === undefined
          ? undefined
          : `${s.unitsExact}: ${proNum(result.units.unitsExact, 2)}   ` +
            `${s.unitsCeil}: ${proNum(result.units.unitsCeil, 0)}`,
        result.perRow === undefined
          ? undefined
          : `${s.seedsPerLinearMeter}: ${proNum(result.perRow.seedsPerLinearMeter, 2)}   ` +
            `${s.spacingInRowCm}: ${proUnit(proNum(result.perRow.spacingInRowCm, 2), s.unitCm)}`,
        `${s.reverseStandCheckPerM2}: ${proNum(result.reverseStandCheckPerM2, 2)}`,
        result.totalCost === undefined ? undefined : `${s.totalCost}: ${proUnit(proNum(result.totalCost, 2), s.unitRsd)}`,
        // The inputs, as every other tool in the drawer copies them and this one
        // did not. A sowing rate pasted into an order with no germination,
        // purity or field loss beside it is a kilogram figure nobody can check.
        "",
        `${s.standValue}: ${proNum(proParse(standValue) ?? 0, 2)}`,
        `${s.tkwGrams}: ${proUnit(proNum(proParse(tkwGrams) ?? 0, 2), s.unitG)}`,
        `${s.germinationPercent}: ${proNum(proParse(germinationPercent) ?? 0, 1)}${s.unitPercent}`,
        `${s.purityPercent}: ${proNum(purityUsed, 1)}${s.unitPercent}`,
        `${s.fieldLossPercent}: ${proNum(fieldLossUsed, 1)}${s.unitPercent}`,
        `${s.areaHa}: ${proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<SeedStandMode>
        label={s.standMode}
        value={standMode}
        onChange={setStandMode}
        options={[
          { id: "perM2", label: s.standModePerM2 },
          { id: "perHa", label: s.standModePerHa },
        ]}
      />
      <ToolInput label={s.standValue} hint={s.standValueHint} value={standValue} onChange={setStandValue} />
      <ToolInput label={s.tkwGrams} value={tkwGrams} onChange={setTkwGrams} />
      <ToolInput label={s.germinationPercent} value={germinationPercent} onChange={setGerminationPercent} />
      <ToolInput label={s.purityPercent} value={purityPercent} onChange={setPurityPercent} placeholder="100" />
      <ToolInput label={s.fieldLossPercent} value={fieldLossPercent} onChange={setFieldLossPercent} placeholder="0" />
      <ToolInput label={s.areaHa} value={areaHa} onChange={setAreaHa} placeholder="1" />
      <ToolInput label={s.bagMassKg} value={bagMassKg} onChange={setBagMassKg} placeholder="25" />
      <ToolInput label={s.rowSpacingCm} value={rowSpacingCm} onChange={setRowSpacingCm} />
      <ToolInput label={s.seedsPerUnit} value={seedsPerUnit} onChange={setSeedsPerUnit} />
      <ToolSelect<SeedPriceMode | "none">
        label={s.priceMode}
        value={priceMode}
        onChange={setPriceMode}
        options={[
          { id: "none", label: s.priceModeNone },
          { id: "perKg", label: s.priceModePerKg },
          { id: "perUnit", label: s.priceModePerUnit },
        ]}
      />
      {priceMode === "perKg" && <ToolInput label={s.pricePerKg} value={pricePerKg} onChange={setPricePerKg} />}
      {priceMode === "perUnit" && <ToolInput label={s.pricePerUnit} value={pricePerUnit} onChange={setPricePerUnit} />}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.normKgHa} value={proUnit(proNum(result.normKgHa, 2), s.unitKgHa)} />
          <ResultRow label={s.seedsPerM2} value={proNum(result.seedsPerM2, 2)} />
          <ResultRow label={s.seedsPerHa} value={proNum(result.seedsPerHa, 0)} />
          <ResultRow label={s.totalSeedKg} value={proUnit(proNum(result.totalSeedKg, 2), s.unitKg)} />
          <ResultRow label={s.bagsExact} value={proNum(result.bagsExact, 2)} />
          <ResultRow label={s.bagsCeil} value={proNum(result.bagsCeil, 0)} />
          <ResultRow label={s.totalSeeds} value={proNum(result.totalSeeds, 0)} />
          {result.units !== undefined && (
            <>
              <ResultRow label={s.unitsExact} value={proNum(result.units.unitsExact, 2)} />
              <ResultRow label={s.unitsCeil} value={proNum(result.units.unitsCeil, 0)} />
            </>
          )}
          {result.perRow !== undefined && (
            <ToolSection title={s.rowSetting}>
              <ResultRow label={s.seedsPerLinearMeter} value={proNum(result.perRow.seedsPerLinearMeter, 2)} />
              <ResultRow
                label={s.spacingInRowCm}
                value={proUnit(proNum(result.perRow.spacingInRowCm, 2), s.unitCm)}
              />
            </ToolSection>
          )}
          <ResultRow label={s.reverseStandCheckPerM2} value={proNum(result.reverseStandCheckPerM2, 2)} />
          {result.totalCost !== undefined && (
            <ResultRow label={s.totalCost} value={proUnit(proNum(result.totalCost, 2), s.unitRsd)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.standValue, value: proNum(proParse(standValue) ?? 0, 2) },
              { label: s.tkwGrams, value: proUnit(proNum(proParse(tkwGrams) ?? 0, 2), s.unitG) },
              {
                label: s.germinationPercent,
                value: `${proNum(proParse(germinationPercent) ?? 0, 1)}${s.unitPercent}`,
              },
              { label: s.purityPercent, value: `${proNum(purityUsed, 1)}${s.unitPercent}` },
              // Field loss was in the arithmetic and nowhere on the screen. It
              // scales the whole sowing rate, so a run at 8 % and a run at 0 %
              // were two different answers with identical echoes.
              { label: s.fieldLossPercent, value: `${proNum(fieldLossUsed, 1)}${s.unitPercent}` },
              { label: s.areaHa, value: proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type NozzleFlowMode = "direct" | "catch";

/**
 * `life-safety`: a wrong calibration is an under- or over-dosed field. The
 * label rate is the user's own typed limit; the ratio against it is a plain
 * number, never a colour or a word.
 */
export function SprayerCalibrationTool() {
  const s = strings.pro.agro["sprayer-calibration"];
  const [nozzleFlowMode, setNozzleFlowMode] = useState<NozzleFlowMode>("direct");
  const [flowLMin, setFlowLMin] = useState("");
  const [catchVolumeMl, setCatchVolumeMl] = useState("");
  const [nozzleSpacingM, setNozzleSpacingM] = useState("0,5");
  const [nozzleCount, setNozzleCount] = useState("");
  const [workingWidthM, setWorkingWidthM] = useState("");
  const [speedKmh, setSpeedKmh] = useState("");
  const [catchTimeS, setCatchTimeS] = useState("60");
  const [targetRateLHa, setTargetRateLHa] = useState("");
  const [tankVolumeL, setTankVolumeL] = useState("");

  const nozzleFlow: NozzleFlowSource =
    nozzleFlowMode === "direct"
      ? { mode: "direct", flowLMin: proParse(flowLMin) ?? Number.NaN }
      : { mode: "catch", volumeMl: proParse(catchVolumeMl) ?? Number.NaN };

  const typed =
    proParse(flowLMin) !== undefined ||
    proParse(catchVolumeMl) !== undefined ||
    proParse(speedKmh) !== undefined;

  const result = sprayerCalibration({
    nozzleFlow,
    nozzleSpacingM: proParse(nozzleSpacingM) ?? Number.NaN,
    nozzleCount: proParse(nozzleCount),
    workingWidthM: proParse(workingWidthM),
    speedKmh: proParse(speedKmh) ?? Number.NaN,
    catchTimeS: proParse(catchTimeS) ?? Number.NaN,
    targetRateLHa: proParse(targetRateLHa),
    tankVolumeL: proParse(tankVolumeL),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "nozzleSpacingM"
        ? s.errorNozzleSpacingM
        : result.reason === "speedKmh"
          ? s.errorSpeedKmh
          : result.reason === "catchTimeS"
            ? s.errorCatchTimeS
            : result.reason === "nozzleCount"
              ? s.errorNozzleCount
              : result.reason === "workingWidthM"
                ? s.errorWorkingWidthM
                : result.reason === "targetRateLHa"
                  ? s.errorTargetRateLHa
                  : result.reason === "tankVolumeL"
                    ? s.errorTankVolumeL
                    : result.reason === "nozzleFlowLMin"
                      ? s.errorNozzleFlowLMin
                      : result.reason === "catchVolumeMl"
                        ? s.errorCatchVolumeMl
                        : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.nozzleFlowLMin}: ${proUnit(proNum(result.nozzleFlowLMin, 3), s.unitLMin)}`,
        `${s.rateFromSpacingLHa}: ${proUnit(proNum(result.rateFromSpacingLHa, 1), s.unitLHa)}`,
        result.fromCount === undefined
          ? undefined
          : `${s.totalFlowLMin}: ${proUnit(proNum(result.fromCount.totalFlowLMin, 2), s.unitLMin)}` +
            `   ${s.widthFromCountM}: ${proUnit(proNum(result.fromCount.widthFromCountM, 2), s.unitM)}`,
        result.fromCount?.widthDifferenceM === undefined
          ? undefined
          : `${s.widthDifferenceM}: ${proUnit(proNum(result.fromCount.widthDifferenceM, 2), s.unitM)}`,
        result.fromCount === undefined
          ? undefined
          : `${s.rateFromCountWidthLHa}: ` +
            `${proUnit(proNum(result.fromCount.rateFromCountWidthLHa, 1), s.unitLHa)}`,
        result.target === undefined
          ? undefined
          : `${s.requiredNozzleFlowLMin}: ` +
            `${proUnit(proNum(result.target.requiredNozzleFlowLMin, 3), s.unitLMin)}` +
            `   ${s.expectedCatchVolumeMl}: ` +
            `${proUnit(proNum(result.target.expectedCatchVolumeMl, 1), s.unitMl)}`,
        result.target?.ratio === undefined
          ? undefined
          : `${s.rateFromSpacingLHa}: ${proUnit(proNum(result.rateFromSpacingLHa, 1), s.unitLHa)}` +
            `   ${s.targetRateLHa}: ${proUnit(proNum(proParse(targetRateLHa) ?? 0, 1), s.unitLHa)}` +
            `   ${s.ratio}: ${proRatio(result.target.ratio)}`,
        result.tank === undefined
          ? undefined
          : `${s.coverageHaPerTank}: ${proUnit(proNum(result.tank.coverageHaPerTank, 3), s.unitHa)}` +
            (result.tank.distancePerTankM === undefined
              ? ""
              : `   ${s.distancePerTankM}: ${proUnit(proNum(result.tank.distancePerTankM, 1), s.unitM)}`),
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<NozzleFlowMode>
        label={s.nozzleFlowMode}
        value={nozzleFlowMode}
        onChange={setNozzleFlowMode}
        options={[
          { id: "direct", label: s.nozzleFlowModeDirect },
          { id: "catch", label: s.nozzleFlowModeCatch },
        ]}
      />
      {nozzleFlowMode === "direct" ? (
        <ToolInput label={s.flowLMin} hint={s.flowLMinHint} value={flowLMin} onChange={setFlowLMin} />
      ) : (
        <ToolInput label={s.catchVolumeMl} value={catchVolumeMl} onChange={setCatchVolumeMl} />
      )}
      <ToolInput label={s.catchTimeS} value={catchTimeS} onChange={setCatchTimeS} placeholder="60" />
      <ToolInput label={s.nozzleSpacingM} value={nozzleSpacingM} onChange={setNozzleSpacingM} placeholder="0,5" />
      <ToolInput label={s.nozzleCount} value={nozzleCount} onChange={setNozzleCount} />
      <ToolInput
        label={s.workingWidthM}
        hint={s.workingWidthMHint}
        value={workingWidthM}
        onChange={setWorkingWidthM}
      />
      <ToolInput label={s.speedKmh} value={speedKmh} onChange={setSpeedKmh} />
      <ToolInput label={s.targetRateLHa} hint={s.limitHint} value={targetRateLHa} onChange={setTargetRateLHa} />
      <ToolInput label={s.tankVolumeL} value={tankVolumeL} onChange={setTankVolumeL} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.nozzleFlowLMin} value={proUnit(proNum(result.nozzleFlowLMin, 3), s.unitLMin)} />
          <ResultRow label={s.rateFromSpacingLHa} value={proUnit(proNum(result.rateFromSpacingLHa, 1), s.unitLHa)} />
          {result.fromCount !== undefined && (
            <ToolSection title={s.boomCheck}>
              <ResultRow
                label={s.totalFlowLMin}
                value={proUnit(proNum(result.fromCount.totalFlowLMin, 2), s.unitLMin)}
              />
              <ResultRow
                label={s.widthFromCountM}
                value={proUnit(proNum(result.fromCount.widthFromCountM, 2), s.unitM)}
              />
              {result.fromCount.widthDifferenceM !== undefined && (
                <ResultRow
                  label={s.widthDifferenceM}
                  value={proUnit(proNum(result.fromCount.widthDifferenceM, 2), s.unitM)}
                />
              )}
              <ResultRow
                label={s.rateFromCountWidthLHa}
                value={proUnit(proNum(result.fromCount.rateFromCountWidthLHa, 1), s.unitLHa)}
              />
            </ToolSection>
          )}
          {result.target !== undefined && (
            <ToolSection title={s.fromLabel}>
              <ResultRow
                label={s.requiredNozzleFlowLMin}
                value={proUnit(proNum(result.target.requiredNozzleFlowLMin, 3), s.unitLMin)}
              />
              <ResultRow
                label={s.expectedCatchVolumeMl}
                value={proUnit(proNum(result.target.expectedCatchVolumeMl, 1), s.unitMl)}
              />
              <ToolAgainstLimit
                label={s.rateFromSpacingLHa}
                value={proUnit(proNum(result.rateFromSpacingLHa, 1), s.unitLHa)}
                limitLabel={s.targetRateLHa}
                limit={proUnit(proNum(proParse(targetRateLHa) ?? 0, 1), s.unitLHa)}
                ratioLabel={s.ratio}
                ratio={proRatio(result.target.ratio)}
              />
            </ToolSection>
          )}
          {result.tank !== undefined && (
            <ToolSection title={s.tank}>
              <ResultRow
                label={s.coverageHaPerTank}
                value={proUnit(proNum(result.tank.coverageHaPerTank, 3), s.unitHa)}
              />
              {result.tank.distancePerTankM !== undefined && (
                <ResultRow
                  label={s.distancePerTankM}
                  value={proUnit(proNum(result.tank.distancePerTankM, 1), s.unitM)}
                />
              )}
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.nozzleFlowLMin, value: proUnit(proNum(result.nozzleFlowLMin, 3), s.unitLMin) },
              { label: s.nozzleSpacingM, value: proUnit(proNum(proParse(nozzleSpacingM) ?? 0, 2), s.unitM) },
              { label: s.speedKmh, value: proUnit(proNum(proParse(speedKmh) ?? 0, 2), s.unitKmh) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** One pasted product row: naziv;l|kg;ha|%|ml;vrednost. */
function parseProductRow(line: string): TankMixProductInput | undefined {
  const cells = splitRow(line);
  const name = cells[0];
  const unitText = cells[1];
  const modeText = cells[2];
  const valueText = cells[3];
  if (
    name === undefined ||
    name === "" ||
    unitText === undefined ||
    modeText === undefined ||
    valueText === undefined
  ) {
    return undefined;
  }
  const unit: TankMixUnit | undefined = unitText === "l" ? "l" : unitText === "kg" ? "kg" : undefined;
  const value = proParse(valueText);
  if (unit === undefined || value === undefined) return undefined;
  const dose: TankMixDoseMode | undefined =
    modeText === "ha"
      ? { mode: "perHectare", value }
      : modeText === "%"
        ? { mode: "concentrationPercent", percent: value }
        : modeText === "ml"
          ? { mode: "concentrationPerLiter", perLiter: value }
          : undefined;
  return dose === undefined ? undefined : { name, unit, dose };
}

/**
 * `life-safety`: doses are the label's, never Nexus's. Reads the product
 * list as a pasted block — `naziv;l|kg;ha|%|ml;vrednost` — because a tank
 * mix commonly holds several products and the drawer must not invent a
 * private idea of how many rows „enough" is.
 */
export function TankMixDoseTool() {
  const s = strings.pro.agro["tank-mix-dose"];
  const [productsText, setProductsText] = useState("");
  const [sprayRateLHa, setSprayRateLHa] = useState("");
  const [tankVolumeL, setTankVolumeL] = useState("");
  const [areaHa, setAreaHa] = useState("");

  const productLines = productsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const parsedProducts = productLines.map(parseProductRow);
  const hasParseError = productLines.length > 0 && parsedProducts.some((p) => p === undefined);
  const products: readonly TankMixProductInput[] = parsedProducts.filter(
    (p): p is TankMixProductInput => p !== undefined,
  );
  const typed = [sprayRateLHa, tankVolumeL, areaHa].some((v) => proParse(v) !== undefined);

  const coreResult = hasParseError
    ? undefined
    : tankMixDose({
        products,
        sprayRateLHa: proParse(sprayRateLHa) ?? Number.NaN,
        tankVolumeL: proParse(tankVolumeL) ?? Number.NaN,
        areaHa: proParse(areaHa) ?? Number.NaN,
      });

  const reasonKey = coreResult === undefined || coreResult.ok ? "" : (coreResult.reason.split(":")[0] ?? "");
  const failure = !typed
    ? undefined
    : hasParseError
      ? s.errorParse
      : coreResult === undefined || coreResult.ok
        ? undefined
        : reasonKey === "products"
          ? s.errorProducts
          : reasonKey === "sprayRateLHa"
            ? s.errorSprayRateLHa
            : reasonKey === "tankVolumeL"
              ? s.errorTankVolumeL
              : reasonKey === "areaHa"
                ? s.errorAreaHa
                : reasonKey === "dose"
                  ? s.errorDose
                  : s.errorGeneric;

  const result = coreResult !== undefined && coreResult.ok ? coreResult : undefined;

  const basisLabel = (basis: "volumeVolume" | "massVolume"): string =>
    basis === "volumeVolume" ? s.basisVolumeVolume : s.basisMassVolume;

  const copyText =
    result === undefined
      ? ""
      : [
          ...result.products.map(
            (p) =>
              `${p.name}: ${s.colDosePerHa} ${proNum(p.doseKgOrLPerHa, 3)} ${p.unit}${s.unitPerHaSuffix}   ${s.perFullTankAmount} ${proNum(p.perFullTankAmount, 3)} ${p.unit}   ${s.totalAmount} ${proNum(p.totalAmount, 3)} ${p.unit}   ${s.remainderAmount} ${proNum(p.remainderAmount, 3)} ${p.unit}   ${s.concentrationPercent} ${proNum(p.concentrationPercent, 3)}% (${basisLabel(p.concentrationBasis)})`,
          ),
          `${s.fullTankAreaHa}: ${proUnit(proNum(result.fullTankAreaHa, 3), s.unitHa)}`,
          `${s.totalSprayVolumeL}: ${proUnit(proNum(result.totalSprayVolumeL, 1), s.unitL)}`,
          `${s.fullFills}: ${proNum(result.fullFills, 0)}   ${s.remainderVolumeL}: ${proUnit(proNum(result.remainderVolumeL, 1), s.unitL)}   ${s.remainderAreaHa}: ${proUnit(proNum(result.remainderAreaHa, 3), s.unitHa)}`,
          `${s.fullTankCarrierL}: ${proUnit(proNum(result.fullTankCarrierL, 1), s.unitL)}`,
          `${s.totalCarrierL}: ${proUnit(proNum(result.totalCarrierL, 1), s.unitL)}`,
        ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.productsText}
        hint={s.productsTextHint}
        value={productsText}
        onChange={setProductsText}
        placeholder={s.productsTextPlaceholder}
        rows={6}
      />
      <ToolInput label={s.sprayRateLHa} hint={s.limitHint} value={sprayRateLHa} onChange={setSprayRateLHa} />
      <ToolInput label={s.tankVolumeL} value={tankVolumeL} onChange={setTankVolumeL} />
      <ToolInput label={s.areaHa} value={areaHa} onChange={setAreaHa} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colProduct, s.colDosePerHa, s.colPerTank, s.colTotal, s.colRemainder, s.colConcentration]}
            rows={result.products.map((p) => [
              p.name,
              proUnit(proNum(p.doseKgOrLPerHa, 3), `${p.unit}${s.unitPerHaSuffix}`),
              proUnit(proNum(p.perFullTankAmount, 3), p.unit),
              proUnit(proNum(p.totalAmount, 3), p.unit),
              proUnit(proNum(p.remainderAmount, 3), p.unit),
              `${proNum(p.concentrationPercent, 3)}% (${basisLabel(p.concentrationBasis)})`,
            ])}
            prose={[0, 5]}
          />
          <ResultRow label={s.fullTankAreaHa} value={proUnit(proNum(result.fullTankAreaHa, 3), s.unitHa)} />
          <ResultRow label={s.totalSprayVolumeL} value={proUnit(proNum(result.totalSprayVolumeL, 1), s.unitL)} />
          <ResultRow label={s.fullFills} value={proNum(result.fullFills, 0)} />
          <ResultRow label={s.remainderVolumeL} value={proUnit(proNum(result.remainderVolumeL, 1), s.unitL)} />
          <ResultRow label={s.remainderAreaHa} value={proUnit(proNum(result.remainderAreaHa, 3), s.unitHa)} />
          <ResultRow label={s.fullTankCarrierL} value={proUnit(proNum(result.fullTankCarrierL, 1), s.unitL)} />
          <ResultRow label={s.totalCarrierL} value={proUnit(proNum(result.totalCarrierL, 1), s.unitL)} />
          <p className="nx-hint nx-hint--prose">{s.labelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sprayRateLHa, value: proUnit(proNum(proParse(sprayRateLHa) ?? 0, 1), s.unitLHa) },
              { label: s.tankVolumeL, value: proUnit(proNum(proParse(tankVolumeL) ?? 0, 1), s.unitL) },
              { label: s.areaHa, value: proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa) },
              { label: s.productCount, value: proNum(products.length, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type FertDirection = "nutrientsToFertiliser" | "fertiliserToNutrients";
type LeadOrNone = LeadNutrient | "none";

/**
 * `life-safety`: excess nitrogen is a regulated pollution risk, and a wrong
 * blend under-feeds or over-feeds a crop. This surface prints the target the
 * user typed, what the chosen fertilisers deliver, and their plain
 * difference — never a word on whether the plan is adequate.
 */
export function FertiliserNutrientBlendTool() {
  const s = strings.pro.agro["fertiliser-nutrient-blend"];
  const [direction, setDirection] = useState<FertDirection>("nutrientsToFertiliser");
  const [targetForm, setTargetForm] = useState<"oxide" | "element">("oxide");
  const [targetN, setTargetN] = useState("");
  const [targetP, setTargetP] = useState("");
  const [targetK, setTargetK] = useState("");
  const [primaryN, setPrimaryN] = useState("");
  const [primaryP2o5, setPrimaryP2o5] = useState("");
  const [primaryK2o, setPrimaryK2o] = useState("");
  const [primaryLead, setPrimaryLead] = useState<LeadNutrient>("N");
  const [secondaryN, setSecondaryN] = useState("");
  const [secondaryP2o5, setSecondaryP2o5] = useState("");
  const [secondaryK2o, setSecondaryK2o] = useState("");
  const [secondaryLead, setSecondaryLead] = useState<LeadOrNone>("none");
  const [areaHa, setAreaHa] = useState("1");
  const [bagMassKg, setBagMassKg] = useState("50");
  const [reverseN, setReverseN] = useState("");
  const [reverseP2o5, setReverseP2o5] = useState("");
  const [reverseK2o, setReverseK2o] = useState("");
  const [doseKgHa, setDoseKgHa] = useState("");

  const secondaryEntered = secondaryN.trim() !== "" || secondaryP2o5.trim() !== "" || secondaryK2o.trim() !== "";
  const typed =
    direction === "nutrientsToFertiliser"
      ? [targetN, targetP, targetK, primaryN, primaryP2o5, primaryK2o].some((v) => proParse(v) !== undefined)
      : [reverseN, reverseP2o5, reverseK2o, doseKgHa].some((v) => proParse(v) !== undefined);

  const input: FertiliserBlendInput =
    direction === "nutrientsToFertiliser"
      ? {
          direction: "nutrientsToFertiliser",
          targetForm,
          targetN: proParse(targetN) ?? Number.NaN,
          targetP: proParse(targetP) ?? Number.NaN,
          targetK: proParse(targetK) ?? Number.NaN,
          primary: {
            nPercent: proParse(primaryN) ?? Number.NaN,
            p2o5Percent: proParse(primaryP2o5) ?? Number.NaN,
            k2oPercent: proParse(primaryK2o) ?? Number.NaN,
          },
          primaryLead,
          secondary: secondaryEntered
            ? {
                nPercent: proParse(secondaryN) ?? Number.NaN,
                p2o5Percent: proParse(secondaryP2o5) ?? Number.NaN,
                k2oPercent: proParse(secondaryK2o) ?? Number.NaN,
              }
            : undefined,
          secondaryLead: secondaryLead === "none" ? undefined : secondaryLead,
          areaHa: proParse(areaHa) ?? Number.NaN,
          bagMassKg: proParse(bagMassKg) ?? Number.NaN,
        }
      : {
          direction: "fertiliserToNutrients",
          composition: {
            nPercent: proParse(reverseN) ?? Number.NaN,
            p2o5Percent: proParse(reverseP2o5) ?? Number.NaN,
            k2oPercent: proParse(reverseK2o) ?? Number.NaN,
          },
          doseKgHa: proParse(doseKgHa) ?? Number.NaN,
          areaHa: proParse(areaHa) ?? Number.NaN,
          bagMassKg: proParse(bagMassKg) ?? Number.NaN,
        };

  const result = fertiliserNutrientBlend(input);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "areaHa"
        ? s.errorAreaHa
        : result.reason === "bagMassKg"
          ? s.errorBagMassKg
          : result.reason === "composition"
            ? s.errorComposition
            : result.reason === "doseKgHa"
              ? s.errorDoseKgHa
              : result.reason === "targetN"
                ? s.errorTargetN
                : result.reason === "targetP"
                  ? s.errorTargetP
                  : result.reason === "targetK"
                    ? s.errorTargetK
                    : result.reason === "primary"
                      ? s.errorPrimary
                      : result.reason === "secondary"
                        ? s.errorSecondary
                        : result.reason === "primaryLead"
                          ? s.errorPrimaryLead
                          : s.errorGeneric;

  const leadLabel = (lead: LeadNutrient | undefined): string =>
    lead === "N" ? s.leadN : lead === "P2O5" ? s.leadP2o5 : lead === "K2O" ? s.leadK2o : "—";

  const copyLines = (): string[] => {
    if (!result.ok) return [];
    const out: string[] = [];
    result.lines.forEach((line, i) => {
      out.push(`${s.line} ${i + 1} (${leadLabel(line.lead)}):`);
      out.push(`  ${s.doseKgHa}: ${proUnit(proNum(line.doseKgHa, 2), s.unitKgHa)}`);
      out.push(`  ${s.totalKg}: ${proUnit(proNum(line.totalKg, 1), s.unitKg)}`);
      out.push(`  ${s.bagsExact}: ${proNum(line.bagsExact, 2)}   ${s.bagsCeil}: ${proNum(line.bagsCeil, 0)}`);
      out.push(`  ${s.actualDoseKgHa}: ${proUnit(proNum(line.actualDoseKgHa, 2), s.unitKgHa)}`);
    });
    out.push("");
    out.push(`${s.deliveredN}: ${proUnit(proNum(result.deliveredNKgHa, 2), s.unitKgHa)}`);
    out.push(`${s.deliveredP2o5}: ${proUnit(proNum(result.deliveredP2o5KgHa, 2), s.unitKgHa)}`);
    out.push(`${s.deliveredK2o}: ${proUnit(proNum(result.deliveredK2oKgHa, 2), s.unitKgHa)}`);
    out.push(`${s.deliveredPElement}: ${proUnit(proNum(result.deliveredPElementKgHa, 3), s.unitKgHa)}`);
    out.push(`${s.deliveredKElement}: ${proUnit(proNum(result.deliveredKElementKgHa, 3), s.unitKgHa)}`);
    out.push(`${s.totalDeliveredN}: ${proUnit(proNum(result.totalDeliveredNKg, 1), s.unitKg)}`);
    out.push(`${s.totalDeliveredP2o5}: ${proUnit(proNum(result.totalDeliveredP2o5Kg, 1), s.unitKg)}`);
    out.push(`${s.totalDeliveredK2o}: ${proUnit(proNum(result.totalDeliveredK2oKg, 1), s.unitKg)}`);
    const target = result.target;
    if (target !== undefined) {
      out.push("");
      out.push(`${s.targetN}: ${proUnit(proNum(target.targetNKgHa, 2), s.unitKgHa)}`);
      out.push(`${s.targetMinusDeliveredN}: ${proUnit(proNum(target.targetMinusDeliveredN, 2), s.unitKgHa)}`);
      out.push(`${s.targetP2o5}: ${proUnit(proNum(target.targetP2o5KgHa, 2), s.unitKgHa)}`);
      out.push(
        `${s.targetMinusDeliveredP2o5}: ${proUnit(proNum(target.targetMinusDeliveredP2o5, 2), s.unitKgHa)}`,
      );
      out.push(`${s.targetK2o}: ${proUnit(proNum(target.targetK2oKgHa, 2), s.unitKgHa)}`);
      out.push(`${s.targetMinusDeliveredK2o}: ${proUnit(proNum(target.targetMinusDeliveredK2o, 2), s.unitKgHa)}`);
    }
    return out;
  };

  const copyText = result.ok ? copyLines().join("\n") : "";

  return (
    <>
      <ToolSelect<FertDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "nutrientsToFertiliser", label: s.directionForward },
          { id: "fertiliserToNutrients", label: s.directionReverse },
        ]}
      />
      {direction === "nutrientsToFertiliser" ? (
        <>
          <ToolSelect<"oxide" | "element">
            label={s.targetForm}
            value={targetForm}
            onChange={setTargetForm}
            options={[
              { id: "oxide", label: s.targetFormOxide },
              { id: "element", label: s.targetFormElement },
            ]}
          />
          <ToolInput label={s.targetN} hint={s.targetHint} value={targetN} onChange={setTargetN} />
          <ToolInput
            label={targetForm === "oxide" ? s.targetP2o5 : s.targetPElement}
            value={targetP}
            onChange={setTargetP}
          />
          <ToolInput
            label={targetForm === "oxide" ? s.targetK2o : s.targetKElement}
            value={targetK}
            onChange={setTargetK}
          />
          <ToolSection title={s.primary}>
            <ToolInput label={s.compositionN} value={primaryN} onChange={setPrimaryN} />
            <ToolInput label={s.compositionP2o5} value={primaryP2o5} onChange={setPrimaryP2o5} />
            <ToolInput label={s.compositionK2o} value={primaryK2o} onChange={setPrimaryK2o} />
            <ToolSelect<LeadNutrient>
              label={s.lead}
              value={primaryLead}
              onChange={setPrimaryLead}
              options={[
                { id: "N", label: s.leadN },
                { id: "P2O5", label: s.leadP2o5 },
                { id: "K2O", label: s.leadK2o },
              ]}
            />
          </ToolSection>
          <ToolSection title={s.secondary}>
            <ToolInput label={s.compositionN} value={secondaryN} onChange={setSecondaryN} />
            <ToolInput label={s.compositionP2o5} value={secondaryP2o5} onChange={setSecondaryP2o5} />
            <ToolInput label={s.compositionK2o} value={secondaryK2o} onChange={setSecondaryK2o} />
            <ToolSelect<LeadOrNone>
              label={s.lead}
              value={secondaryLead}
              onChange={setSecondaryLead}
              options={[
                { id: "none", label: s.leadNone },
                { id: "N", label: s.leadN },
                { id: "P2O5", label: s.leadP2o5 },
                { id: "K2O", label: s.leadK2o },
              ]}
            />
          </ToolSection>
        </>
      ) : (
        <ToolSection title={s.composition}>
          <ToolInput label={s.compositionN} value={reverseN} onChange={setReverseN} />
          <ToolInput label={s.compositionP2o5} value={reverseP2o5} onChange={setReverseP2o5} />
          <ToolInput label={s.compositionK2o} value={reverseK2o} onChange={setReverseK2o} />
          <ToolInput label={s.doseKgHa} value={doseKgHa} onChange={setDoseKgHa} />
        </ToolSection>
      )}
      <ToolInput label={s.areaHa} value={areaHa} onChange={setAreaHa} placeholder="1" />
      <ToolInput label={s.bagMassKg} value={bagMassKg} onChange={setBagMassKg} placeholder="50" />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.lines.map((line, i) => (
            <ToolSection key={i} title={`${s.line} ${i + 1} (${leadLabel(line.lead)})`}>
              <ResultRow label={s.doseKgHa} value={proUnit(proNum(line.doseKgHa, 2), s.unitKgHa)} />
              <ResultRow label={s.totalKg} value={proUnit(proNum(line.totalKg, 1), s.unitKg)} />
              <ResultRow label={s.bagsExact} value={proNum(line.bagsExact, 2)} />
              <ResultRow label={s.bagsCeil} value={proNum(line.bagsCeil, 0)} />
              <ResultRow label={s.actualDoseKgHa} value={proUnit(proNum(line.actualDoseKgHa, 2), s.unitKgHa)} />
            </ToolSection>
          ))}
          <ToolSection title={s.delivered}>
            <ResultRow label={s.deliveredN} value={proUnit(proNum(result.deliveredNKgHa, 2), s.unitKgHa)} />
            <ResultRow label={s.deliveredP2o5} value={proUnit(proNum(result.deliveredP2o5KgHa, 2), s.unitKgHa)} />
            <ResultRow label={s.deliveredK2o} value={proUnit(proNum(result.deliveredK2oKgHa, 2), s.unitKgHa)} />
            <ResultRow
              label={s.deliveredPElement}
              value={proUnit(proNum(result.deliveredPElementKgHa, 3), s.unitKgHa)}
            />
            <ResultRow
              label={s.deliveredKElement}
              value={proUnit(proNum(result.deliveredKElementKgHa, 3), s.unitKgHa)}
            />
            <ResultRow label={s.totalDeliveredN} value={proUnit(proNum(result.totalDeliveredNKg, 1), s.unitKg)} />
            <ResultRow
              label={s.totalDeliveredP2o5}
              value={proUnit(proNum(result.totalDeliveredP2o5Kg, 1), s.unitKg)}
            />
            <ResultRow label={s.totalDeliveredK2o} value={proUnit(proNum(result.totalDeliveredK2oKg, 1), s.unitKg)} />
          </ToolSection>
          {result.target !== undefined && (
            <ToolSection title={s.balance}>
              <ResultRow label={s.targetN} value={proUnit(proNum(result.target.targetNKgHa, 2), s.unitKgHa)} />
              <ResultRow
                label={s.targetMinusDeliveredN}
                value={proUnit(proNum(result.target.targetMinusDeliveredN, 2), s.unitKgHa)}
              />
              <ResultRow label={s.targetP2o5} value={proUnit(proNum(result.target.targetP2o5KgHa, 2), s.unitKgHa)} />
              <ResultRow
                label={s.targetMinusDeliveredP2o5}
                value={proUnit(proNum(result.target.targetMinusDeliveredP2o5, 2), s.unitKgHa)}
              />
              <ResultRow label={s.targetK2o} value={proUnit(proNum(result.target.targetK2oKgHa, 2), s.unitKgHa)} />
              <ResultRow
                label={s.targetMinusDeliveredK2o}
                value={proUnit(proNum(result.target.targetMinusDeliveredK2o, 2), s.unitKgHa)}
              />
              <ResultRow
                label={s.targetPElement}
                value={proUnit(proNum(result.target.targetPElementKgHa, 3), s.unitKgHa)}
              />
              <ResultRow
                label={s.targetKElement}
                value={proUnit(proNum(result.target.targetKElementKgHa, 3), s.unitKgHa)}
              />
            </ToolSection>
          )}
          <p className="nx-hint nx-hint--prose">{s.userInputNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.direction, value: direction === "nutrientsToFertiliser" ? s.directionForward : s.directionReverse },
              { label: s.areaHa, value: proUnit(proNum(proParse(areaHa) ?? 0, 2), s.unitHa) },
              { label: s.bagMassKg, value: proUnit(proNum(proParse(bagMassKg) ?? 0, 1), s.unitKg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** „DD.MM.GGGG" only — the one date shape a Serbian weather log is pasted in. */
function parseCalendarDate(text: string): CalendarDate | undefined {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (m === null) return undefined;
  const dayText = m[1];
  const monthText = m[2];
  const yearText = m[3];
  if (dayText === undefined || monthText === undefined || yearText === undefined) return undefined;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return undefined;
  return { year, month, day };
}

function formatCalendarDate(d: CalendarDate): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.day)}.${pad(d.month)}.${d.year}`;
}

/**
 * Reads a pasted block, one day per line — `datum;Tmax;Tmin`. A season runs
 * 60–120 rows, and typing them one field at a time is not a workflow, it is
 * the saved history this drawer refuses to hold.
 */
export function GrowingDegreeDaysTool() {
  const s = strings.pro.agro["growing-degree-days"];
  const [rowsText, setRowsText] = useState("");
  const [baseTempC, setBaseTempC] = useState("10");
  const [upperLimitC, setUpperLimitC] = useState("");
  const [targetSum, setTargetSum] = useState("");
  const [averageWindowDays, setAverageWindowDays] = useState("7");

  const lines = rowsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const parsedRows: (GddReading | undefined)[] = lines.map((line) => {
    const cells = splitRow(line);
    const dateText = cells[0];
    const tMaxText = cells[1];
    const tMinText = cells[2];
    const date = dateText === undefined ? undefined : parseCalendarDate(dateText);
    const tMax = tMaxText === undefined ? undefined : proParse(tMaxText);
    const tMin = tMinText === undefined ? undefined : proParse(tMinText);
    return date === undefined || tMax === undefined || tMin === undefined
      ? undefined
      : { date, tMaxC: tMax, tMinC: tMin };
  });
  const hasParseError = lines.length > 0 && parsedRows.some((r) => r === undefined);
  const readings: readonly GddReading[] = parsedRows.filter((r): r is GddReading => r !== undefined);
  const typed = hasPastedRows(rowsText);

  const coreResult = hasParseError
    ? undefined
    : growingDegreeDays({
        readings,
        baseTempC: proParse(baseTempC) ?? Number.NaN,
        upperLimitC: proParse(upperLimitC),
        targetSum: proParse(targetSum),
        averageWindowDays: proParse(averageWindowDays) ?? Number.NaN,
      });

  const reasonKey = coreResult === undefined || coreResult.ok ? "" : (coreResult.reason.split(":")[0] ?? "");
  const failure = !typed
    ? undefined
    : hasParseError
      ? s.errorParse
      : coreResult === undefined || coreResult.ok
        ? undefined
        : reasonKey === "readings"
          ? s.errorReadings
          : reasonKey === "baseTempC"
            ? s.errorBaseTempC
            : reasonKey === "upperLimitC"
              ? s.errorUpperLimitC
              : reasonKey === "targetSum"
                ? s.errorTargetSum
                : reasonKey === "averageWindowDays"
                  ? s.errorAverageWindowDays
                  : reasonKey === "tMaxC"
                    ? s.errorTMaxC
                    : reasonKey === "tMinC"
                      ? s.errorTMinC
                      : reasonKey === "row"
                        ? s.errorRowOrder
                        : reasonKey === "date"
                          ? s.errorDateOrder
                          : s.errorGeneric;

  const result = coreResult !== undefined && coreResult.ok ? coreResult : undefined;

  const copyText =
    result === undefined
      ? ""
      : [
          `${s.totalSimple}: ${proNum(result.totalSimple, 2)}`,
          `${s.totalModified}: ${proNum(result.totalModified, 2)}`,
          `${s.averageSimple}: ${proNum(result.averageSimple, 3)}`,
          `${s.averageSimpleRecent} (${proNum(result.recentWindowDays, 0)} ${s.days}): ${proNum(result.averageSimpleRecent, 3)}`,
          `${s.zeroContributionDays}: ${proNum(result.zeroContributionDays, 0)}`,
          result.remainingToTarget === undefined
            ? undefined
            : `${s.remainingToTarget}: ${proNum(result.remainingToTarget, 2)}`,
          result.daysToTarget === undefined ? undefined : `${s.daysToTarget}: ${proNum(result.daysToTarget, 0)}`,
          result.projectedDate === undefined
            ? undefined
            : `${s.projectedDate}: ${formatCalendarDate(result.projectedDate)}`,
          "",
          `${s.baseTempC}: ${proNum(proParse(baseTempC) ?? 0, 1)}${s.unitDeg}`,
          `${s.rowCount}: ${proNum(readings.length, 0)}`,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

  return (
    <>
      <ToolTextArea
        label={s.rowsText}
        hint={s.rowsTextHint}
        value={rowsText}
        onChange={setRowsText}
        placeholder={"01.05.2026;28;14\n02.05.2026;31;18"}
        rows={10}
      />
      <ToolInput
        label={s.baseTempC}
        hint={s.baseTempCHint}
        value={baseTempC}
        onChange={setBaseTempC}
        placeholder="10"
      />
      <ToolInput label={s.upperLimitC} value={upperLimitC} onChange={setUpperLimitC} />
      <ToolInput label={s.targetSum} value={targetSum} onChange={setTargetSum} />
      <ToolInput
        label={s.averageWindowDays}
        value={averageWindowDays}
        onChange={setAverageWindowDays}
        placeholder="7"
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colDate, s.colSimpleDaily, s.colSimpleCumulative, s.colModifiedDaily, s.colModifiedCumulative]}
            rows={result.rows.map((r) => [
              formatCalendarDate(r.date),
              proNum(r.simpleDaily, 2),
              proNum(r.simpleCumulative, 2),
              proNum(r.modifiedDaily, 2),
              proNum(r.modifiedCumulative, 2),
            ])}
          />
          <ResultRow label={s.totalSimple} value={proNum(result.totalSimple, 2)} />
          <ResultRow label={s.totalModified} value={proNum(result.totalModified, 2)} />
          <ResultRow label={s.averageSimple} value={proNum(result.averageSimple, 3)} />
          <ResultRow
            label={s.averageSimpleRecent}
            value={`${proNum(result.averageSimpleRecent, 3)} (${proNum(result.recentWindowDays, 0)} ${s.days})`}
          />
          <ResultRow label={s.zeroContributionDays} value={proNum(result.zeroContributionDays, 0)} />
          {result.remainingToTarget !== undefined && (
            <ToolSection title={s.projection}>
              <ResultRow label={s.remainingToTarget} value={proNum(result.remainingToTarget, 2)} />
              {result.daysToTarget !== undefined && (
                <>
                  <ResultRow label={s.daysToTarget} value={proNum(result.daysToTarget, 0)} />
                  <ResultRow
                    label={s.projectedDate}
                    value={result.projectedDate === undefined ? "—" : formatCalendarDate(result.projectedDate)}
                  />
                </>
              )}
              <p className="nx-hint nx-hint--prose">{s.projectionNote}</p>
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.baseTempC, value: `${proNum(proParse(baseTempC) ?? 0, 1)}${s.unitDeg}` },
              { label: s.rowCount, value: proNum(readings.length, 0) },
              { label: s.averageWindowDays, value: proNum(proParse(averageWindowDays) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type SyrupPreset = "1:1" | "2:1" | "3:2" | "1:2" | "custom";

export function BeeSyrupMixTool() {
  const s = strings.pro.agro["bee-syrup-mix"];
  const [preset, setPreset] = useState<SyrupPreset>("2:1");
  const [ratioA, setRatioA] = useState("2");
  const [ratioB, setRatioB] = useState("1");
  const [given, setGiven] = useState<SyrupGiven>("targetVolume");
  const [value, setValue] = useState("");
  const [hiveCount, setHiveCount] = useState("");
  const [literPerHive, setLiterPerHive] = useState("");
  const [bagMassKg, setBagMassKg] = useState("25");

  const applyPreset = (p: SyrupPreset): void => {
    setPreset(p);
    if (p === "1:1") {
      setRatioA("1");
      setRatioB("1");
    } else if (p === "2:1") {
      setRatioA("2");
      setRatioB("1");
    } else if (p === "3:2") {
      setRatioA("3");
      setRatioB("2");
    } else if (p === "1:2") {
      setRatioA("1");
      setRatioB("2");
    }
  };

  const typed = proParse(ratioA) !== undefined && proParse(ratioB) !== undefined && proParse(value) !== undefined;
  const result = beeSyrupMix({
    ratioA: proParse(ratioA) ?? Number.NaN,
    ratioB: proParse(ratioB) ?? Number.NaN,
    given,
    value: proParse(value) ?? Number.NaN,
    hiveCount: proParse(hiveCount),
    literPerHive: proParse(literPerHive),
    bagMassKg: proParse(bagMassKg) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "ratioA"
        ? s.errorRatioA
        : result.reason === "ratioB"
          ? s.errorRatioB
          : result.reason === "value"
            ? s.errorValue
            : result.reason === "bagMassKg"
              ? s.errorBagMassKg
              : result.reason === "hiveCount"
                ? s.errorHiveCount
                : result.reason === "literPerHive"
                  ? s.errorLiterPerHive
                  : s.errorGeneric;

  const givenLabel =
    given === "targetVolume"
      ? s.givenTargetVolume
      : given === "targetMass"
        ? s.givenTargetMass
        : s.givenAvailableSugar;

  const copyText = !result.ok
    ? ""
    : [
        `${s.sugarKg}: ${proUnit(proNum(result.sugarKg, 3), s.unitKg)}`,
        `${s.waterVolumeL}: ${proUnit(proNum(result.waterVolumeL, 3), s.unitL)}`,
        `${s.waterMassKg}: ${proUnit(proNum(result.waterMassKg, 3), s.unitKg)}`,
        `${s.syrupMassKg}: ${proUnit(proNum(result.syrupMassKg, 3), s.unitKg)}`,
        `${s.syrupVolumeL}: ${proUnit(proNum(result.syrupVolumeL, 3), s.unitL)}`,
        `${s.densityKgL}: ${proUnit(proNum(result.densityKgL, 4), s.unitKgL)} (${s.densityEstimated})`,
        `${s.concentrationPercent}: ${proNum(result.concentrationPercent, 2)}${s.unitPercent}`,
        `${s.bagsExact}: ${proNum(result.bagsExact, 2)}`,
        `${s.bagsCeil}: ${proNum(result.bagsCeil, 0)}`,
        result.hives === undefined
          ? undefined
          : `${s.hivesCovered}: ${proNum(result.hives.hivesCovered, 0)}   ` +
            `${s.hivesRemainderL}: ${proUnit(proNum(result.hives.hivesRemainderL, 3), s.unitL)}`,
        result.apiary === undefined
          ? undefined
          : `${s.apiaryVolumeL}: ${proUnit(proNum(result.apiary.volumeL, 2), s.unitL)}   ${s.apiarySugarKg}: ${proUnit(proNum(result.apiary.sugarKg, 3), s.unitKg)}   ${s.apiaryBagsCeil}: ${proNum(result.apiary.bagsCeil, 0)}`,
        "",
        `${s.ratio}: ${ratioA.trim()}:${ratioB.trim()}`,
        `${s.given}: ${givenLabel}`,
        `${s.value}: ${proNum(proParse(value) ?? 0, 3)}`,
        `${s.bagMassKg}: ${proUnit(proNum(proParse(bagMassKg) ?? 0, 1), s.unitKg)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<SyrupPreset>
        label={s.preset}
        value={preset}
        onChange={applyPreset}
        options={[
          { id: "1:1", label: "1:1" },
          { id: "2:1", label: "2:1" },
          { id: "3:2", label: "3:2" },
          { id: "1:2", label: "1:2" },
          { id: "custom", label: s.presetCustom },
        ]}
      />
      <ToolInput
        label={s.ratioA}
        hint={s.ratioHint}
        value={ratioA}
        onChange={(v) => {
          setPreset("custom");
          setRatioA(v);
        }}
      />
      <ToolInput
        label={s.ratioB}
        value={ratioB}
        onChange={(v) => {
          setPreset("custom");
          setRatioB(v);
        }}
      />
      <ToolSelect<SyrupGiven>
        label={s.given}
        value={given}
        onChange={setGiven}
        options={[
          { id: "targetVolume", label: s.givenTargetVolume },
          { id: "targetMass", label: s.givenTargetMass },
          { id: "availableSugar", label: s.givenAvailableSugar },
        ]}
      />
      <ToolInput label={s.value} hint={s.valueHint} value={value} onChange={setValue} />
      <ToolInput label={s.hiveCount} value={hiveCount} onChange={setHiveCount} />
      <ToolInput label={s.literPerHive} value={literPerHive} onChange={setLiterPerHive} />
      <ToolInput label={s.bagMassKg} value={bagMassKg} onChange={setBagMassKg} placeholder="25" />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.sugarKg} value={proUnit(proNum(result.sugarKg, 3), s.unitKg)} />
          <ResultRow label={s.waterVolumeL} value={proUnit(proNum(result.waterVolumeL, 3), s.unitL)} />
          <ResultRow label={s.waterMassKg} value={proUnit(proNum(result.waterMassKg, 3), s.unitKg)} />
          <ResultRow label={s.syrupMassKg} value={proUnit(proNum(result.syrupMassKg, 3), s.unitKg)} />
          <ResultRow label={s.syrupVolumeL} value={proUnit(proNum(result.syrupVolumeL, 3), s.unitL)} />
          <ResultRow label={s.densityKgL} value={proUnit(proNum(result.densityKgL, 4), s.unitKgL)} />
          <p className="nx-hint nx-hint--prose">{s.densityNote}</p>
          <ResultRow
            label={s.concentrationPercent}
            value={`${proNum(result.concentrationPercent, 2)}${s.unitPercent}`}
          />
          <ResultRow label={s.bagsExact} value={proNum(result.bagsExact, 2)} />
          <ResultRow label={s.bagsCeil} value={proNum(result.bagsCeil, 0)} />
          {result.hives !== undefined && (
            <>
              <ResultRow label={s.hivesCovered} value={proNum(result.hives.hivesCovered, 0)} />
              <ResultRow
                label={s.hivesRemainderL}
                value={proUnit(proNum(result.hives.hivesRemainderL, 3), s.unitL)}
              />
            </>
          )}
          {result.apiary !== undefined && (
            <ToolSection title={s.apiary}>
              <ResultRow label={s.apiaryVolumeL} value={proUnit(proNum(result.apiary.volumeL, 2), s.unitL)} />
              <ResultRow label={s.apiarySugarKg} value={proUnit(proNum(result.apiary.sugarKg, 3), s.unitKg)} />
              <ResultRow label={s.apiaryBagsCeil} value={proNum(result.apiary.bagsCeil, 0)} />
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.ratio, value: `${ratioA.trim()}:${ratioB.trim()}` },
              { label: s.given, value: givenLabel },
              { label: s.value, value: proNum(proParse(value) ?? 0, 3) },
              { label: s.bagMassKg, value: proUnit(proNum(proParse(bagMassKg) ?? 0, 1), s.unitKg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** One pasted sample row, shaped by the chosen method. */
function parseSampleRow(line: string, method: YieldMethod): YieldSample | undefined {
  const cells = splitRow(line);
  if (method === "smallGrain") {
    const earsPerM2 = proParse(cells[0] ?? "");
    const grainsPerEar = proParse(cells[1] ?? "");
    return earsPerM2 === undefined || grainsPerEar === undefined
      ? undefined
      : { method, earsPerM2, grainsPerEar };
  }
  if (method === "rowCrop") {
    const plantsPerHa = proParse(cells[0] ?? "");
    const earsPerPlant = proParse(cells[1] ?? "");
    const grainsPerEar = proParse(cells[2] ?? "");
    return plantsPerHa === undefined || earsPerPlant === undefined || grainsPerEar === undefined
      ? undefined
      : { method, plantsPerHa, earsPerPlant, grainsPerEar };
  }
  const sampleAreaM2 = proParse(cells[0] ?? "");
  const sampleMassKg = proParse(cells[1] ?? "");
  return sampleAreaM2 === undefined || sampleMassKg === undefined
    ? undefined
    : { method, sampleAreaM2, sampleMassKg };
}

/**
 * `none`: an estimate from a handful of samples, never a certified yield.
 * Every sample is converted to t/ha on its own BEFORE averaging — the core
 * function does that, this surface only echoes it — because averaging the
 * raw counts first is a different, wrong number.
 */
export function YieldEstimateSamplesTool() {
  const s = strings.pro.agro["yield-estimate-samples"];
  const [method, setMethod] = useState<YieldMethod>("smallGrain");
  const [samplesText, setSamplesText] = useState("");
  const [tkwGrams, setTkwGrams] = useState("");
  const [tkwMoisturePercent, setTkwMoisturePercent] = useState("");
  const [sampleMoisturePercent, setSampleMoisturePercent] = useState("");
  const [referenceMoisturePercent, setReferenceMoisturePercent] = useState("");
  const [harvestLossPercent, setHarvestLossPercent] = useState("");
  const [plotAreaHa, setPlotAreaHa] = useState("1");

  const sampleLines = samplesText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const parsedSamples = sampleLines.map((line) => parseSampleRow(line, method));
  const hasParseError = sampleLines.length > 0 && parsedSamples.some((r) => r === undefined);
  const samples: readonly YieldSample[] = parsedSamples.filter((r): r is YieldSample => r !== undefined);
  const typed = [tkwGrams, plotAreaHa].some((v) => proParse(v) !== undefined) || sampleLines.length > 0;

  const coreResult = hasParseError
    ? undefined
    : yieldEstimateSamples({
        samples,
        tkwGrams: proParse(tkwGrams) ?? Number.NaN,
        tkwMoisturePercent: proParse(tkwMoisturePercent),
        sampleMoisturePercent: proParse(sampleMoisturePercent),
        referenceMoisturePercent: proParse(referenceMoisturePercent),
        harvestLossPercent: proParse(harvestLossPercent),
        plotAreaHa: proParse(plotAreaHa) ?? Number.NaN,
      });

  const reasonKey = coreResult === undefined || coreResult.ok ? "" : (coreResult.reason.split(":")[0] ?? "");
  const failure = !typed
    ? undefined
    : hasParseError
      ? s.errorParse
      : coreResult === undefined || coreResult.ok
        ? undefined
        : reasonKey === "samples"
          ? s.errorSamples
          : reasonKey === "tkwGrams"
            ? s.errorTkwGrams
            : reasonKey === "tkwMoisturePercent"
              ? s.errorTkwMoisturePercent
              : reasonKey === "sampleMoisturePercent"
                ? s.errorSampleMoisturePercent
                : reasonKey === "referenceMoisturePercent"
                  ? s.errorReferenceMoisturePercent
                  : reasonKey === "harvestLossPercent"
                    ? s.errorHarvestLossPercent
                    : reasonKey === "plotAreaHa"
                      ? s.errorPlotAreaHa
                      : reasonKey === "earsPerM2"
                        ? s.errorEarsPerM2
                        : reasonKey === "grainsPerEar"
                          ? s.errorGrainsPerEar
                          : reasonKey === "plantsPerHa"
                            ? s.errorPlantsPerHa
                            : reasonKey === "earsPerPlant"
                              ? s.errorEarsPerPlant
                              : reasonKey === "sampleAreaM2"
                                ? s.errorSampleAreaM2
                                : reasonKey === "sampleMassKg"
                                  ? s.errorSampleMassKg
                                  : s.errorGeneric;

  const result = coreResult !== undefined && coreResult.ok ? coreResult : undefined;

  const methodLabel =
    method === "smallGrain" ? s.methodSmallGrain : method === "rowCrop" ? s.methodRowCrop : s.methodMeasuredArea;

  const copyText =
    result === undefined
      ? ""
      : [
          `${s.meanTHa}: ${proUnit(proNum(result.meanTHa, 3), s.unitTHa)}`,
          `${s.minTHa} / ${s.maxTHa}: ${proNum(result.minTHa, 3)} / ${proNum(result.maxTHa, 3)} ${s.unitTHa}`,
          result.spread === undefined
            ? s.singleSampleNote
            : `${s.stdDevTHa}: ${proUnit(proNum(result.spread.stdDevTHa, 3), s.unitTHa)}   ` +
              `${s.standardErrorTHa}: ${proUnit(proNum(result.spread.standardErrorTHa, 3), s.unitTHa)}` +
              `${
                result.spread.coefficientOfVariationPercent === undefined
                  ? ""
                  : `   ${s.coefficientOfVariationPercent}: ${proNum(result.spread.coefficientOfVariationPercent, 1)}${s.unitPercent}`
              }`,
          result.meanAtReferenceMoistureTHa === undefined
            ? ""
            : `${s.meanAtReferenceMoistureTHa}: ${proUnit(proNum(result.meanAtReferenceMoistureTHa, 3), s.unitTHa)}`,
          `${s.meanAfterLossTHa}: ${proUnit(proNum(result.meanAfterLossTHa, 3), s.unitTHa)}`,
          `${s.totalYieldT}: ${proUnit(proNum(result.totalYieldT, 2), s.unitT)}`,
        ]
          .filter((l) => l !== "")
          .join("\n");

  return (
    <>
      <ToolSelect
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "smallGrain", label: s.methodSmallGrain },
          { id: "rowCrop", label: s.methodRowCrop },
          { id: "measuredArea", label: s.methodMeasuredArea },
        ]}
      />
      <ToolTextArea
        label={s.samplesText}
        hint={
          method === "smallGrain"
            ? s.samplesTextHintSmallGrain
            : method === "rowCrop"
              ? s.samplesTextHintRowCrop
              : s.samplesTextHintMeasuredArea
        }
        value={samplesText}
        onChange={setSamplesText}
        placeholder={method === "smallGrain" ? "450;32\n430;30" : method === "rowCrop" ? "65000;1;512" : "2;2,4"}
        rows={5}
      />
      {(method === "smallGrain" || method === "rowCrop") && (
        <>
          <ToolInput label={s.tkwGrams} value={tkwGrams} onChange={setTkwGrams} />
          <ToolInput
            label={s.tkwMoisturePercent}
            hint={s.tkwMoisturePercentHint}
            value={tkwMoisturePercent}
            onChange={setTkwMoisturePercent}
          />
        </>
      )}
      {method === "measuredArea" && (
        <ToolInput
          label={s.sampleMoisturePercent}
          hint={s.sampleMoisturePercentHint}
          value={sampleMoisturePercent}
          onChange={setSampleMoisturePercent}
        />
      )}
      <ToolInput
        label={s.referenceMoisturePercent}
        hint={s.limitHint}
        value={referenceMoisturePercent}
        onChange={setReferenceMoisturePercent}
      />
      <ToolInput label={s.harvestLossPercent} value={harvestLossPercent} onChange={setHarvestLossPercent} />
      <ToolInput label={s.plotAreaHa} value={plotAreaHa} onChange={setPlotAreaHa} placeholder="1" />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colSample, s.colYieldTHa]}
            rows={result.sampleYieldsTHa.map((y, i) => [proNum(i + 1, 0), proUnit(proNum(y, 3), s.unitTHa)])}
            prose={[0]}
          />
          <ResultRow label={s.meanTHa} value={proUnit(proNum(result.meanTHa, 3), s.unitTHa)} />
          <ResultRow label={s.minTHa} value={proUnit(proNum(result.minTHa, 3), s.unitTHa)} />
          <ResultRow label={s.maxTHa} value={proUnit(proNum(result.maxTHa, 3), s.unitTHa)} />
          {result.spread === undefined ? (
            <p className="nx-hint nx-hint--prose">{s.singleSampleNote}</p>
          ) : (
            <>
              <ResultRow
                label={s.stdDevTHa}
                value={proUnit(proNum(result.spread.stdDevTHa, 3), s.unitTHa)}
              />
              <ResultRow
                label={s.standardErrorTHa}
                value={proUnit(proNum(result.spread.standardErrorTHa, 3), s.unitTHa)}
              />
              {result.spread.coefficientOfVariationPercent !== undefined && (
                <ResultRow
                  label={s.coefficientOfVariationPercent}
                  value={`${proNum(result.spread.coefficientOfVariationPercent, 1)}${s.unitPercent}`}
                />
              )}
            </>
          )}
          {result.meanAtReferenceMoistureTHa !== undefined && (
            <ResultRow
              label={s.meanAtReferenceMoistureTHa}
              value={proUnit(proNum(result.meanAtReferenceMoistureTHa, 3), s.unitTHa)}
            />
          )}
          <ResultRow label={s.meanAfterLossTHa} value={proUnit(proNum(result.meanAfterLossTHa, 3), s.unitTHa)} />
          <ResultRow label={s.totalYieldT} value={proUnit(proNum(result.totalYieldT, 2), s.unitT)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.method, value: methodLabel },
              { label: s.sampleCount, value: proNum(result.sampleCount, 0) },
              { label: s.tkwGrams, value: proUnit(proNum(proParse(tkwGrams) ?? 0, 2), s.unitG) },
              { label: s.plotAreaHa, value: proUnit(proNum(proParse(plotAreaHa) ?? 0, 2), s.unitHa) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const AGRO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "bale-count-storage": BaleCountStorageTool,
  "bee-syrup-mix": BeeSyrupMixTool,
  "cadastral-area-units": CadastralAreaUnitsTool,
  "fertiliser-nutrient-blend": FertiliserNutrientBlendTool,
  "grain-moisture-shrink": GrainMoistureShrinkTool,
  "growing-degree-days": GrowingDegreeDaysTool,
  "honey-mass-moisture": HoneyMassMoistureTool,
  "irrigation-depth-volume": IrrigationDepthVolumeTool,
  "livestock-ration-dm": LivestockRationDmTool,
  "machine-field-capacity": MachineFieldCapacityTool,
  "orchard-trellis-layout": OrchardTrellisLayoutTool,
  "plant-spacing-density": PlantSpacingDensityTool,
  "polygon-area": PolygonAreaTool,
  "seeding-rate": SeedingRateTool,
  "sprayer-calibration": SprayerCalibrationTool,
  "tank-mix-dose": TankMixDoseTool,
  "yield-estimate-samples": YieldEstimateSamplesTool,
};
