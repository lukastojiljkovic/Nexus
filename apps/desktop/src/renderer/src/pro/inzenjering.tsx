import {
  awgToMetric,
  metricToAwg,
  type ConductorMaterial,
  batteryBankRuntime,
  type BatteryLoad,
  beltDrive,
  gearPair,
  cableCrossSection,
  type SupplySystem,
  inductionMotorRating,
  type PhaseSystem,
  junctionTemperature,
  requiredSinkResistance,
  permissibleDissipation,
  metricThread,
  ohmsLaw,
  pipeFlow,
  type FlowUnit,
  powerFactorCorrection,
  type CapacitorConnection,
  convertPressure,
  pistonForce,
  type PressureUnit,
  type PressureKind,
  resistorFromBands,
  resistorBandsForValue,
  nearestPreferredValue,
  type BandColour,
  type PreferredSeries,
  rlcResponse,
  type FirstOrderCorner,
  type RlcConnection,
  sectionProperties,
  type SectionShape,
  networkEquivalent,
  voltageDivider,
  type PassiveElement,
  type NetworkConnection,
  threePhasePower,
  type WindingConnection,
  torqueSpeedPower,
} from "@nexus/core/pro/inzenjering";
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
  ToolTextArea,
} from "./shared.js";

/**
 * „Inženjering i elektrotehnika" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/inzenjering.ts`'s. This file shapes
 * fields, hands typed numbers to it and reads the answer onto the page —
 * nothing here divides, rounds or compares. Almost every tool in this pack is
 * `life-safety`: a conductor, a fastener, a pressure vessel, a belt guard. The
 * host draws the notice and appends the copy-button's travelling line from the
 * registration; what stays here is the part the registration cannot enforce —
 * show the formula, echo the inputs, and where a rule sets a limit, put the
 * user's own figure beside the computed one with nothing but a ratio between
 * them. No word is ever spent on what that ratio means.
 */

/** Parses one value per line — for the tools that take a small list rather than a single field. */
function parseLines(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

const MATERIAL_OPTIONS: readonly { readonly id: ConductorMaterial; readonly label: string }[] = [
  { id: "copper", label: "bakar" },
  { id: "aluminium", label: "aluminijum" },
];

/* ========================================================================== *
 * AWG i mm²
 * ========================================================================== */

export function AwgConverterTool() {
  const s = strings.pro.inzenjering["awg-to-mm2"];
  const [direction, setDirection] = useState<"toMetric" | "toAwg">("toMetric");
  const [gauge, setGauge] = useState("");
  const [material, setMaterial] = useState<ConductorMaterial>("copper");
  const [known, setKnown] = useState<"diameter" | "area">("diameter");
  const [value, setValue] = useState("");

  const isForward = direction === "toMetric";
  const typed = isForward ? proParse(gauge) !== undefined : proParse(value) !== undefined;

  const forward = awgToMetric({ gauge: proParse(gauge) ?? Number.NaN, material });
  const reverse = metricToAwg({
    diameterMm: known === "diameter" ? proParse(value) : undefined,
    areaMm2: known === "area" ? proParse(value) : undefined,
    material,
  });
  const result = isForward ? forward : reverse;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "gauge"
        ? s.errorGauge
        : result.reason === "diameter"
          ? s.errorDiameter
          : result.reason === "area"
            ? s.errorArea
            : s.errorKnown;

  const materialLabel = material === "copper" ? s.materialCopper : s.materialAluminium;
  const copyText = !result.ok
    ? ""
    : isForward && forward.ok
      ? [
          `${s.diameterMm}: ${proUnit(proNum(forward.diameterMm, 5), s.unitMm)}`,
          `${s.diameterIn}: ${proUnit(proNum(forward.diameterInch, 6), s.unitIn)}`,
          `${s.areaMm2}: ${proUnit(proNum(forward.areaMm2, 5), s.unitMm2)}`,
          `${s.resistance}: ${proUnit(proNum(forward.resistanceOhmPerKm, 5), s.unitOhmKm)}`,
          "",
          `${s.gauge}: ${gauge.trim()}`,
          `${s.material}: ${materialLabel}`,
        ].join("\n")
      : !isForward && reverse.ok
        ? [
            `${s.diameterMm}: ${proUnit(proNum(reverse.diameterMm, 5), s.unitMm)}`,
            `${s.areaMm2}: ${proUnit(proNum(reverse.areaMm2, 5), s.unitMm2)}`,
            `${s.fractionalGauge}: ${proNum(reverse.gauge, 3)}`,
            reverse.nearest === undefined
              ? ""
              : `${s.nearestGauge}: ${proNum(reverse.nearest.gauge, 0)} (${proUnit(proNum(reverse.nearest.diameterMm, 5), s.unitMm)}, ${proUnit(proNum(reverse.nearest.areaMm2, 5), s.unitMm2)})`,
            `${s.resistance}: ${proUnit(proNum(reverse.resistanceOhmPerKm, 5), s.unitOhmKm)}`,
            "",
            `${s.known}: ${known === "diameter" ? s.knownDiameter : s.knownArea} = ${value.trim()}`,
            `${s.material}: ${materialLabel}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<"toMetric" | "toAwg">
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "toMetric", label: s.directionToMetric },
          { id: "toAwg", label: s.directionToAwg },
        ]}
      />
      <ToolSelect<ConductorMaterial>
        label={s.material}
        value={material}
        onChange={setMaterial}
        hint={s.materialHint}
        options={MATERIAL_OPTIONS}
      />
      {isForward ? (
        <ToolInput label={s.gauge} hint={s.gaugeHint} value={gauge} onChange={setGauge} />
      ) : (
        <>
          <ToolSelect<"diameter" | "area">
            label={s.known}
            value={known}
            onChange={setKnown}
            options={[
              { id: "diameter", label: s.knownDiameter },
              { id: "area", label: s.knownArea },
            ]}
          />
          <ToolInput
            label={known === "diameter" ? s.diameterMm : s.areaMm2}
            value={value}
            onChange={setValue}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {isForward && forward.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.diameterMm} value={proUnit(proNum(forward.diameterMm, 5), s.unitMm)} />
          <ResultRow label={s.diameterIn} value={proUnit(proNum(forward.diameterInch, 6), s.unitIn)} />
          <ResultRow label={s.areaMm2} value={proUnit(proNum(forward.areaMm2, 5), s.unitMm2)} />
          <ResultRow
            label={s.resistance}
            value={proUnit(proNum(forward.resistanceOhmPerKm, 5), s.unitOhmKm)}
          />
          <p className="nx-hint nx-hint--prose">{s.resistanceNote}</p>
          <p className="nx-hint nx-hint--prose">{s.tableNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.gauge, value: gauge.trim() },
              { label: s.material, value: materialLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {!isForward && reverse.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.diameterMm} value={proUnit(proNum(reverse.diameterMm, 5), s.unitMm)} />
          <ResultRow label={s.areaMm2} value={proUnit(proNum(reverse.areaMm2, 5), s.unitMm2)} />
          <ResultRow label={s.fractionalGauge} value={proNum(reverse.gauge, 3)} />
          {reverse.nearest === undefined ? (
            <p className="nx-hint nx-hint--prose">{s.outsideSeriesNote}</p>
          ) : (
            <>
              <ResultRow label={s.nearestGauge} value={proNum(reverse.nearest.gauge, 0)} />
              <ResultRow
                label={s.nearestDiameter}
                value={proUnit(proNum(reverse.nearest.diameterMm, 5), s.unitMm)}
              />
              <ResultRow
                label={s.nearestArea}
                value={proUnit(proNum(reverse.nearest.areaMm2, 5), s.unitMm2)}
              />
            </>
          )}
          <ResultRow
            label={s.resistance}
            value={proUnit(proNum(reverse.resistanceOhmPerKm, 5), s.unitOhmKm)}
          />
          <p className="nx-hint nx-hint--prose">{s.resistanceNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.known, value: known === "diameter" ? s.knownDiameter : s.knownArea },
              { label: s.value, value: value.trim() },
              { label: s.material, value: materialLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Baterija i autonomija
 * ========================================================================== */

export function BatteryBankRuntimeTool() {
  const s = strings.pro.inzenjering["battery-bank-runtime"];
  const [cellCapacityAh, setCellCapacityAh] = useState("");
  const [cellVoltage, setCellVoltage] = useState("");
  const [series, setSeries] = useState("");
  const [parallel, setParallel] = useState("");
  const [depthOfDischargePct, setDepthOfDischargePct] = useState("");
  const [loadKind, setLoadKind] = useState<"power" | "current">("power");
  const [loadValue, setLoadValue] = useState("");
  const [efficiencyPct, setEfficiencyPct] = useState("");
  const [peukertExponent, setPeukertExponent] = useState("");
  const [ratedDischargeHours, setRatedDischargeHours] = useState("");

  const typed =
    proParse(cellCapacityAh) !== undefined ||
    proParse(cellVoltage) !== undefined ||
    proParse(loadValue) !== undefined;

  const load: BatteryLoad =
    loadKind === "power"
      ? { kind: "power", watts: proParse(loadValue) ?? Number.NaN }
      : { kind: "current", amps: proParse(loadValue) ?? Number.NaN };

  const result = batteryBankRuntime({
    cellCapacityAh: proParse(cellCapacityAh) ?? Number.NaN,
    cellVoltage: proParse(cellVoltage) ?? Number.NaN,
    series: proParse(series),
    parallel: proParse(parallel),
    depthOfDischargePct: proParse(depthOfDischargePct) ?? Number.NaN,
    load,
    converterEfficiencyPct: proParse(efficiencyPct),
    peukertExponent: proParse(peukertExponent),
    ratedDischargeHours: proParse(ratedDischargeHours),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "capacity"
        ? s.errorCapacity
        : result.reason === "voltage"
          ? s.errorVoltage
          : result.reason === "series"
            ? s.errorSeries
            : result.reason === "parallel"
              ? s.errorParallel
              : result.reason === "depthOfDischarge"
                ? s.errorDepthOfDischarge
                : result.reason === "efficiency"
                  ? s.errorEfficiency
                  : result.reason === "peukert"
                    ? s.errorPeukert
                    : result.reason === "load"
                      ? s.errorLoad
                      : s.errorRatedHours;

  const hasPeukert = result.ok && result.peukertFullHours !== undefined;
  const copyText = !result.ok
    ? ""
    : [
        `${s.packVoltage}: ${proUnit(proNum(result.packVoltage, 3), s.unitV)}`,
        `${s.packCapacity}: ${proUnit(proNum(result.packCapacityAh, 3), s.unitAh)}`,
        `${s.energy}: ${proUnit(proNum(result.energyWh, 1), s.unitWh)}`,
        `${s.usableEnergy}: ${proUnit(proNum(result.usableEnergyWh, 1), s.unitWh)}`,
        `${s.packCurrent}: ${proUnit(proNum(result.packCurrentA, 4), s.unitA)}`,
        `${s.hours}: ${proNum(result.hours, 4)} ${s.unitH} (${result.wholeHours} ${s.unitH} ${result.minutes} min)`,
        hasPeukert ? `${s.hoursWithoutPeukert}: ${proNum(result.hoursWithoutPeukert, 4)} ${s.unitH}` : "",
        "",
        `${s.cellCapacity}: ${proUnit(proNum(proParse(cellCapacityAh) ?? 0, 2), s.unitAh)}`,
        `${s.cellVoltage}: ${proUnit(proNum(proParse(cellVoltage) ?? 0, 2), s.unitV)}`,
        `${s.series}: ${proNum(result.seriesUsed, 0)}`,
        `${s.parallel}: ${proNum(result.parallelUsed, 0)}`,
        `${s.depthOfDischarge}: ${proNum(proParse(depthOfDischargePct) ?? 0, 1)} %`,
        `${s.load}: ${loadKind === "power" ? s.loadPower : s.loadCurrent} = ${loadValue.trim()}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput
        label={s.cellCapacity}
        hint={s.cellCapacityHint}
        value={cellCapacityAh}
        onChange={setCellCapacityAh}
      />
      <ToolInput label={s.cellVoltage} value={cellVoltage} onChange={setCellVoltage} />
      <ToolInput label={s.series} hint={s.seriesHint} value={series} onChange={setSeries} />
      <ToolInput label={s.parallel} hint={s.parallelHint} value={parallel} onChange={setParallel} />
      <ToolInput
        label={s.depthOfDischarge}
        hint={s.depthOfDischargeHint}
        value={depthOfDischargePct}
        onChange={setDepthOfDischargePct}
      />
      <ToolSelect<"power" | "current">
        label={s.loadKind}
        value={loadKind}
        onChange={setLoadKind}
        options={[
          { id: "power", label: s.loadPower },
          { id: "current", label: s.loadCurrent },
        ]}
      />
      <ToolInput
        label={loadKind === "power" ? s.loadPower : s.loadCurrent}
        value={loadValue}
        onChange={setLoadValue}
      />
      <ToolInput
        label={s.efficiency}
        hint={s.efficiencyHint}
        value={efficiencyPct}
        onChange={setEfficiencyPct}
      />
      <ToolInput label={s.peukert} hint={s.peukertHint} value={peukertExponent} onChange={setPeukertExponent} />
      <ToolInput
        label={s.ratedHours}
        hint={s.ratedHoursHint}
        value={ratedDischargeHours}
        onChange={setRatedDischargeHours}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.packVoltage} value={proUnit(proNum(result.packVoltage, 3), s.unitV)} />
          <ResultRow label={s.packCapacity} value={proUnit(proNum(result.packCapacityAh, 3), s.unitAh)} />
          <ResultRow label={s.energy} value={proUnit(proNum(result.energyWh, 1), s.unitWh)} />
          <ResultRow label={s.usableEnergy} value={proUnit(proNum(result.usableEnergyWh, 1), s.unitWh)} />
          <ResultRow label={s.packCurrent} value={proUnit(proNum(result.packCurrentA, 4), s.unitA)} />
          <ResultRow
            label={s.hours}
            value={`${proNum(result.hours, 4)} ${s.unitH} (${result.wholeHours} ${s.unitH} ${result.minutes} min)`}
          />
          {hasPeukert && (
            <>
              <ResultRow
                label={s.hoursWithoutPeukert}
                value={`${proNum(result.hoursWithoutPeukert, 4)} ${s.unitH}`}
              />
              <p className="nx-hint nx-hint--prose">{s.peukertNote}</p>
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.efficiencyNote}</p>
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.cellCapacity, value: proUnit(proNum(proParse(cellCapacityAh) ?? 0, 2), s.unitAh) },
              { label: s.cellVoltage, value: proUnit(proNum(proParse(cellVoltage) ?? 0, 2), s.unitV) },
              { label: s.series, value: proNum(result.seriesUsed, 0) },
              { label: s.parallel, value: proNum(result.parallelUsed, 0) },
              { label: s.depthOfDischarge, value: `${proNum(proParse(depthOfDischargePct) ?? 0, 1)} %` },
              { label: s.loadKind, value: loadKind === "power" ? s.loadPower : s.loadCurrent },
              { label: s.efficiency, value: `${proNum(result.efficiencyPctUsed, 1)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Prenos i kaiš
 * ========================================================================== */

/**
 * Two unrelated machine elements share one surface — a belt-and-pulley pair
 * and a spur-gear pair — so `s.regime` is a visible toggle rather than a
 * silent guess at which one the inputs describe, exactly as the core module's
 * own review note requires.
 */
export function BeltAndGearDriveTool() {
  const s = strings.pro.inzenjering["belt-and-gear-drive"];
  const [regime, setRegime] = useState<"belt" | "gear">("belt");

  // Belt fields.
  const [drivingDiameterMm, setDrivingDiameterMm] = useState("");
  const [drivenDiameterMm, setDrivenDiameterMm] = useState("");
  const [beltSpeedRpm, setBeltSpeedRpm] = useState("");
  const [centreDistanceMm, setCentreDistanceMm] = useState("");
  const [beltTorqueNm, setBeltTorqueNm] = useState("");
  const [beltEfficiencyPct, setBeltEfficiencyPct] = useState("");

  // Gear fields.
  const [drivingTeeth, setDrivingTeeth] = useState("");
  const [drivenTeeth, setDrivenTeeth] = useState("");
  const [gearSpeedRpm, setGearSpeedRpm] = useState("");
  const [moduleMm, setModuleMm] = useState("");
  const [gearTorqueNm, setGearTorqueNm] = useState("");
  const [gearEfficiencyPct, setGearEfficiencyPct] = useState("");

  const belt = beltDrive({
    drivingDiameterMm: proParse(drivingDiameterMm) ?? Number.NaN,
    drivenDiameterMm: proParse(drivenDiameterMm) ?? Number.NaN,
    drivingSpeedRpm: proParse(beltSpeedRpm) ?? Number.NaN,
    centreDistanceMm: proParse(centreDistanceMm) ?? Number.NaN,
    drivingTorqueNm: proParse(beltTorqueNm),
    efficiencyPct: proParse(beltEfficiencyPct),
  });
  const gear = gearPair({
    drivingTeeth: proParse(drivingTeeth) ?? Number.NaN,
    drivenTeeth: proParse(drivenTeeth) ?? Number.NaN,
    drivingSpeedRpm: proParse(gearSpeedRpm) ?? Number.NaN,
    moduleMm: proParse(moduleMm),
    drivingTorqueNm: proParse(gearTorqueNm),
    efficiencyPct: proParse(gearEfficiencyPct),
  });

  const typedBelt =
    proParse(drivingDiameterMm) !== undefined ||
    proParse(drivenDiameterMm) !== undefined ||
    proParse(centreDistanceMm) !== undefined;
  const typedGear = proParse(drivingTeeth) !== undefined || proParse(drivenTeeth) !== undefined;

  const beltFailure =
    belt.ok || !typedBelt
      ? undefined
      : belt.reason === "drivingDiameter"
        ? s.errorDrivingDiameter
        : belt.reason === "drivenDiameter"
          ? s.errorDrivenDiameter
          : belt.reason === "speed"
            ? s.errorSpeed
            : belt.reason === "centreDistance"
              ? s.errorCentreDistance
              : belt.reason === "efficiency"
                ? s.errorEfficiency
                : s.errorTorque;
  const gearFailure =
    gear.ok || !typedGear
      ? undefined
      : gear.reason === "drivingTeeth"
        ? s.errorDrivingTeeth
        : gear.reason === "drivenTeeth"
          ? s.errorDrivenTeeth
          : gear.reason === "speed"
            ? s.errorSpeed
            : gear.reason === "module"
              ? s.errorModule
              : gear.reason === "efficiency"
                ? s.errorEfficiency
                : s.errorTorque;

  const beltCopyText = !belt.ok
    ? ""
    : [
        `${s.ratio}: ${proNum(belt.ratio, 5)}`,
        `${s.drivenSpeed}: ${proUnit(proNum(belt.drivenSpeedRpm, 3), s.unitRpm)}`,
        `${s.beltSpeed}: ${proUnit(proNum(belt.beltSpeedMs, 5), s.unitMs)}`,
        `${s.beltLength}: ${proUnit(proNum(belt.beltLengthMm, 2), s.unitMm)}`,
        `${s.wrapSmall}: ${proNum(belt.wrapSmallDeg, 3)}${s.unitDeg}`,
        `${s.wrapLarge}: ${proNum(belt.wrapLargeDeg, 3)}${s.unitDeg}`,
        belt.drivenTorqueNm === undefined
          ? ""
          : `${s.drivenTorque}: ${proUnit(proNum(belt.drivenTorqueNm, 3), s.unitNm)}`,
        "",
        `${s.drivingDiameter}: ${proUnit(proNum(proParse(drivingDiameterMm) ?? 0, 2), s.unitMm)}`,
        `${s.drivenDiameter}: ${proUnit(proNum(proParse(drivenDiameterMm) ?? 0, 2), s.unitMm)}`,
        `${s.drivingSpeed}: ${proUnit(proNum(proParse(beltSpeedRpm) ?? 0, 2), s.unitRpm)}`,
        `${s.centreDistance}: ${proUnit(proNum(proParse(centreDistanceMm) ?? 0, 2), s.unitMm)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  const gearCopyText = !gear.ok
    ? ""
    : [
        `${s.ratio}: ${proNum(gear.ratio, 5)}`,
        `${s.drivenSpeed}: ${proUnit(proNum(gear.drivenSpeedRpm, 3), s.unitRpm)}`,
        gear.drivingPitchDiameterMm === undefined
          ? ""
          : `${s.drivingPitchDiameter}: ${proUnit(proNum(gear.drivingPitchDiameterMm, 3), s.unitMm)}`,
        gear.drivenPitchDiameterMm === undefined
          ? ""
          : `${s.drivenPitchDiameter}: ${proUnit(proNum(gear.drivenPitchDiameterMm, 3), s.unitMm)}`,
        gear.centreDistanceMm === undefined
          ? ""
          : `${s.gearCentreDistance}: ${proUnit(proNum(gear.centreDistanceMm, 3), s.unitMm)}`,
        gear.drivenTorqueNm === undefined
          ? ""
          : `${s.drivenTorque}: ${proUnit(proNum(gear.drivenTorqueNm, 3), s.unitNm)}`,
        "",
        `${s.drivingTeeth}: ${drivingTeeth.trim()}`,
        `${s.drivenTeeth}: ${drivenTeeth.trim()}`,
        `${s.drivingSpeed}: ${proUnit(proNum(proParse(gearSpeedRpm) ?? 0, 2), s.unitRpm)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<"belt" | "gear">
        label={s.regime}
        value={regime}
        onChange={setRegime}
        options={[
          { id: "belt", label: s.regimeBelt },
          { id: "gear", label: s.regimeGear },
        ]}
      />

      {regime === "belt" ? (
        <>
          <ToolInput
            label={s.drivingDiameter}
            hint={s.pitchDiameterHint}
            value={drivingDiameterMm}
            onChange={setDrivingDiameterMm}
          />
          <ToolInput
            label={s.drivenDiameter}
            hint={s.pitchDiameterHint}
            value={drivenDiameterMm}
            onChange={setDrivenDiameterMm}
          />
          <ToolInput label={s.drivingSpeed} value={beltSpeedRpm} onChange={setBeltSpeedRpm} />
          <ToolInput label={s.centreDistance} value={centreDistanceMm} onChange={setCentreDistanceMm} />
          <ToolInput label={s.drivingTorque} value={beltTorqueNm} onChange={setBeltTorqueNm} />
          <ToolInput
            label={s.efficiency}
            hint={s.efficiencyHint}
            value={beltEfficiencyPct}
            onChange={setBeltEfficiencyPct}
          />

          {beltFailure !== undefined && <ToolFailure>{beltFailure}</ToolFailure>}

          {belt.ok && (
            <ToolSection title={s.results}>
              <ResultRow label={s.ratio} value={proNum(belt.ratio, 5)} />
              <ResultRow label={s.drivenSpeed} value={proUnit(proNum(belt.drivenSpeedRpm, 3), s.unitRpm)} />
              <ResultRow label={s.beltSpeed} value={proUnit(proNum(belt.beltSpeedMs, 5), s.unitMs)} />
              <ResultRow label={s.beltLength} value={proUnit(proNum(belt.beltLengthMm, 2), s.unitMm)} />
              <ResultRow label={s.wrapSmall} value={`${proNum(belt.wrapSmallDeg, 3)}${s.unitDeg}`} />
              <ResultRow label={s.wrapLarge} value={`${proNum(belt.wrapLargeDeg, 3)}${s.unitDeg}`} />
              {belt.drivenTorqueNm !== undefined && (
                <ResultRow label={s.drivenTorque} value={proUnit(proNum(belt.drivenTorqueNm, 3), s.unitNm)} />
              )}
              <p className="nx-hint nx-hint--prose">{s.beltPitchNote}</p>
              <ToolFormula>{s.beltFormula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  { label: s.drivingDiameter, value: proUnit(proNum(proParse(drivingDiameterMm) ?? 0, 2), s.unitMm) },
                  { label: s.drivenDiameter, value: proUnit(proNum(proParse(drivenDiameterMm) ?? 0, 2), s.unitMm) },
                  { label: s.drivingSpeed, value: proUnit(proNum(proParse(beltSpeedRpm) ?? 0, 2), s.unitRpm) },
                  { label: s.centreDistance, value: proUnit(proNum(proParse(centreDistanceMm) ?? 0, 2), s.unitMm) },
                ]}
              />
              <CopyButton value={beltCopyText} />
            </ToolSection>
          )}
        </>
      ) : (
        <>
          <ToolInput label={s.drivingTeeth} value={drivingTeeth} onChange={setDrivingTeeth} />
          <ToolInput label={s.drivenTeeth} value={drivenTeeth} onChange={setDrivenTeeth} />
          <ToolInput label={s.drivingSpeed} value={gearSpeedRpm} onChange={setGearSpeedRpm} />
          <ToolInput label={s.module} hint={s.moduleHint} value={moduleMm} onChange={setModuleMm} />
          <ToolInput label={s.drivingTorque} value={gearTorqueNm} onChange={setGearTorqueNm} />
          <ToolInput
            label={s.efficiency}
            hint={s.efficiencyHint}
            value={gearEfficiencyPct}
            onChange={setGearEfficiencyPct}
          />

          {gearFailure !== undefined && <ToolFailure>{gearFailure}</ToolFailure>}

          {gear.ok && (
            <ToolSection title={s.results}>
              <ResultRow label={s.ratio} value={proNum(gear.ratio, 5)} />
              <ResultRow label={s.drivenSpeed} value={proUnit(proNum(gear.drivenSpeedRpm, 3), s.unitRpm)} />
              {gear.drivingPitchDiameterMm !== undefined && (
                <ResultRow
                  label={s.drivingPitchDiameter}
                  value={proUnit(proNum(gear.drivingPitchDiameterMm, 3), s.unitMm)}
                />
              )}
              {gear.drivenPitchDiameterMm !== undefined && (
                <ResultRow
                  label={s.drivenPitchDiameter}
                  value={proUnit(proNum(gear.drivenPitchDiameterMm, 3), s.unitMm)}
                />
              )}
              {gear.centreDistanceMm !== undefined && (
                <ResultRow
                  label={s.gearCentreDistance}
                  value={proUnit(proNum(gear.centreDistanceMm, 3), s.unitMm)}
                />
              )}
              {gear.drivenTorqueNm !== undefined && (
                <ResultRow label={s.drivenTorque} value={proUnit(proNum(gear.drivenTorqueNm, 3), s.unitNm)} />
              )}
              <p className="nx-hint nx-hint--prose">{s.gearCentreDistanceNote}</p>
              <ToolFormula>{s.gearFormula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  { label: s.drivingTeeth, value: drivingTeeth.trim() },
                  { label: s.drivenTeeth, value: drivenTeeth.trim() },
                  { label: s.drivingSpeed, value: proUnit(proNum(proParse(gearSpeedRpm) ?? 0, 2), s.unitRpm) },
                ]}
              />
              <CopyButton value={gearCopyText} />
            </ToolSection>
          )}
        </>
      )}
    </>
  );
}

/* ========================================================================== *
 * Potreban presek
 * ========================================================================== */

const SYSTEM_OPTIONS: readonly { readonly id: SupplySystem; readonly label: string }[] = [
  { id: "dc", label: "DC" },
  { id: "single", label: "1-fazno" },
  { id: "three", label: "3-fazno" },
];

export function CableCrossSectionTool() {
  const s = strings.pro.inzenjering["cable-cross-section"];
  const [system, setSystem] = useState<SupplySystem>("single");
  const [material, setMaterial] = useState<ConductorMaterial>("copper");
  const [lengthM, setLengthM] = useState("");
  const [currentA, setCurrentA] = useState("");
  const [voltageV, setVoltageV] = useState("");
  const [permittedDropPct, setPermittedDropPct] = useState("");
  const [conductorTempC, setConductorTempC] = useState("");
  const [chosenAreaMm2, setChosenAreaMm2] = useState("");

  const typed =
    proParse(lengthM) !== undefined ||
    proParse(currentA) !== undefined ||
    proParse(voltageV) !== undefined ||
    proParse(permittedDropPct) !== undefined;

  const result = cableCrossSection({
    system,
    material,
    lengthM: proParse(lengthM) ?? Number.NaN,
    currentA: proParse(currentA) ?? Number.NaN,
    voltageV: proParse(voltageV) ?? Number.NaN,
    permittedDropPct: proParse(permittedDropPct) ?? Number.NaN,
    conductorTempC: proParse(conductorTempC),
    chosenAreaMm2: proParse(chosenAreaMm2),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "length"
        ? s.errorLength
        : result.reason === "current"
          ? s.errorCurrent
          : result.reason === "voltage"
            ? s.errorVoltage
            : result.reason === "permittedDrop"
              ? s.errorPermittedDrop
              : result.reason === "temperature"
                ? s.errorTemperature
                : s.errorChosenArea;

  const kLabel = (k: number): string => (Math.abs(k - 2) < 1e-9 ? "2" : "√3");
  const copyText = !result.ok
    ? ""
    : [
        `${s.resistivity}: ${proUnit(proNum(result.resistivity, 6), s.unitOhmMmM)}`,
        `${s.loopFactor}: ${kLabel(result.loopFactor)}`,
        `${s.maxDrop}: ${proUnit(proNum(result.maxDropV, 4), s.unitV)}`,
        `${s.minimumArea}: ${proUnit(proNum(result.minimumAreaMm2, 4), s.unitMm2)}`,
        result.dropAtChosenV === undefined || result.dropAtChosenPct === undefined
          ? ""
          : `${s.dropAtChosenPct}: ${proUnit(proNum(result.dropAtChosenV, 5), s.unitV)} = ${proNum(result.dropAtChosenPct, 4)} %`,
        result.dropRatio === undefined ? "" : `${s.dropRatio}: ${proRatio(result.dropRatio)}`,
        "",
        `${s.system}: ${system === "dc" ? "DC" : system === "single" ? "1-fazno" : "3-fazno"}`,
        `${s.material}: ${material === "copper" ? s.materialCopper : s.materialAluminium}`,
        `${s.length}: ${proUnit(proNum(proParse(lengthM) ?? 0, 2), s.unitM)}`,
        `${s.current}: ${proUnit(proNum(proParse(currentA) ?? 0, 2), s.unitA)}`,
        `${s.voltage}: ${proUnit(proNum(proParse(voltageV) ?? 0, 1), s.unitV)}`,
        `${s.permittedDrop}: ${proNum(proParse(permittedDropPct) ?? 0, 2)} %`,
        `${s.temperature}: ${proNum(result.conductorTempCUsed, 1)}${s.unitDeg}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<SupplySystem> label={s.system} value={system} onChange={setSystem} options={SYSTEM_OPTIONS} />
      <ToolSelect<ConductorMaterial>
        label={s.material}
        value={material}
        onChange={setMaterial}
        options={MATERIAL_OPTIONS}
      />
      <ToolInput label={s.length} hint={s.lengthHint} value={lengthM} onChange={setLengthM} />
      <ToolInput label={s.current} value={currentA} onChange={setCurrentA} />
      <ToolInput label={s.voltage} hint={s.voltageHint} value={voltageV} onChange={setVoltageV} />
      <ToolInput
        label={s.permittedDrop}
        hint={s.permittedDropHint}
        value={permittedDropPct}
        onChange={setPermittedDropPct}
      />
      <ToolInput
        label={s.temperature}
        hint={s.temperatureHint}
        value={conductorTempC}
        onChange={setConductorTempC}
      />
      <ToolInput
        label={s.chosenArea}
        hint={s.chosenAreaHint}
        value={chosenAreaMm2}
        onChange={setChosenAreaMm2}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resistivity} value={proUnit(proNum(result.resistivity, 6), s.unitOhmMmM)} />
          <ResultRow label={s.loopFactor} value={kLabel(result.loopFactor)} />
          <ResultRow label={s.maxDrop} value={proUnit(proNum(result.maxDropV, 4), s.unitV)} />
          <ResultRow label={s.minimumArea} value={proUnit(proNum(result.minimumAreaMm2, 4), s.unitMm2)} />
          <p className="nx-hint nx-hint--prose">{s.roundUpNote}</p>
          {result.dropAtChosenPct !== undefined && (
            <ToolAgainstLimit
              label={s.dropAtChosenPct}
              value={`${proNum(result.dropAtChosenPct, 4)} %`}
              limitLabel={s.permittedDrop}
              limit={`${proNum(proParse(permittedDropPct) ?? 0, 2)} %`}
              ratioLabel={s.dropRatio}
              ratio={proRatio(result.dropRatio)}
            />
          )}
          {result.dropAtChosenV !== undefined && (
            <ResultRow label={s.dropAtChosenV} value={proUnit(proNum(result.dropAtChosenV, 5), s.unitV)} />
          )}
          <p className="nx-hint nx-hint--prose">{s.reactanceNote}</p>
          <p className="nx-hint nx-hint--prose">{s.temperatureNote}</p>
          <p className="nx-hint nx-hint--prose">{s.lengthNote}</p>
          <p className="nx-hint nx-hint--prose">{s.systemNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.system, value: system === "dc" ? "DC" : system === "single" ? "1-fazno" : "3-fazno" },
              { label: s.material, value: material === "copper" ? s.materialCopper : s.materialAluminium },
              { label: s.length, value: proUnit(proNum(proParse(lengthM) ?? 0, 2), s.unitM) },
              { label: s.current, value: proUnit(proNum(proParse(currentA) ?? 0, 2), s.unitA) },
              { label: s.voltage, value: proUnit(proNum(proParse(voltageV) ?? 0, 1), s.unitV) },
              { label: s.permittedDrop, value: `${proNum(proParse(permittedDropPct) ?? 0, 2)} %` },
              { label: s.temperature, value: `${proNum(result.conductorTempCUsed, 1)}${s.unitDeg}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Asinhroni motor
 * ========================================================================== */

export function InductionMotorTool() {
  const s = strings.pro.inzenjering["induction-motor-rating"];
  const [shaftPowerKw, setShaftPowerKw] = useState("");
  const [lineVoltageV, setLineVoltageV] = useState("");
  const [powerFactor, setPowerFactor] = useState("");
  const [efficiencyPct, setEfficiencyPct] = useState("");
  const [poles, setPoles] = useState("");
  const [frequencyHz, setFrequencyHz] = useState("");
  const [measuredSpeedRpm, setMeasuredSpeedRpm] = useState("");
  const [system, setSystem] = useState<PhaseSystem>("three");

  const typed =
    proParse(shaftPowerKw) !== undefined ||
    proParse(lineVoltageV) !== undefined ||
    proParse(powerFactor) !== undefined;

  const result = inductionMotorRating({
    shaftPowerKw: proParse(shaftPowerKw) ?? Number.NaN,
    lineVoltageV: proParse(lineVoltageV) ?? Number.NaN,
    powerFactor: proParse(powerFactor) ?? Number.NaN,
    efficiencyPct: proParse(efficiencyPct) ?? Number.NaN,
    poles: proParse(poles) ?? Number.NaN,
    frequencyHz: proParse(frequencyHz),
    measuredSpeedRpm: proParse(measuredSpeedRpm),
    system,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "power"
        ? s.errorPower
        : result.reason === "voltage"
          ? s.errorVoltage
          : result.reason === "powerFactor"
            ? s.errorPowerFactor
            : result.reason === "efficiency"
              ? s.errorEfficiency
              : result.reason === "poles"
                ? s.errorPoles
                : result.reason === "frequency"
                  ? s.errorFrequency
                  : s.errorSpeed;

  const voltageLabel = system === "single" ? s.voltageSingle : s.voltageThree;
  // Narrowed to the VALUE, not to a boolean beside it. A `hasSlip` const does
  // not narrow the field at the places that read it, so each of them carried a
  // `?? 0` that could not fire and would have printed „0 %" — a motor running
  // exactly at synchronism — if it ever had.
  const slip = result.ok ? result.slipPercent : undefined;
  const isGenerating = slip !== undefined && slip < 0;
  // Above synchronism the machine is being driven. The word alone is not the
  // answer: the core returns a negative number deliberately („it is a number,
  // not an error"), and the screen used to drop it while the copied text kept
  // it, so what the user read and what they pasted disagreed.
  const slipText =
    slip === undefined
      ? ""
      : isGenerating
        ? `${s.generating} (${proNum(slip, 3)} %)`
        : `${proNum(slip, 3)} %`;
  const copyText = !result.ok
    ? ""
    : [
        `${s.current}: ${proUnit(proNum(result.currentA, 4), s.unitA)}`,
        `${s.inputPower}: ${proUnit(proNum(result.inputPowerKw, 5), s.unitKw)}`,
        `${s.synchronousSpeed}: ${proUnit(proNum(result.synchronousSpeedRpm, 0), s.unitRpm)}`,
        slip === undefined ? "" : `${s.slip}: ${slipText}`,
        `${s.torque}: ${proUnit(proNum(result.torqueNm, 4), s.unitNm)} (${measuredSpeedRpm.trim() === "" ? s.atSynchronous : s.atMeasured})`,
        "",
        `${s.shaftPower}: ${proUnit(proNum(proParse(shaftPowerKw) ?? 0, 3), s.unitKw)}`,
        `${voltageLabel}: ${proUnit(proNum(proParse(lineVoltageV) ?? 0, 1), s.unitV)}`,
        `${s.powerFactor}: ${proNum(proParse(powerFactor) ?? 0, 3)}`,
        `${s.efficiency}: ${proNum(proParse(efficiencyPct) ?? 0, 1)} %`,
        `${s.poles}: ${poles.trim()}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<PhaseSystem>
        label={s.system}
        value={system}
        onChange={setSystem}
        options={[
          { id: "single", label: "1-fazno" },
          { id: "three", label: "3-fazno" },
        ]}
      />
      <ToolInput label={s.shaftPower} hint={s.shaftPowerHint} value={shaftPowerKw} onChange={setShaftPowerKw} />
      <ToolInput label={voltageLabel} value={lineVoltageV} onChange={setLineVoltageV} />
      <ToolInput label={s.powerFactor} hint={s.plateHint} value={powerFactor} onChange={setPowerFactor} />
      <ToolInput label={s.efficiency} hint={s.plateHint} value={efficiencyPct} onChange={setEfficiencyPct} />
      <ToolInput label={s.poles} hint={s.polesHint} value={poles} onChange={setPoles} />
      <ToolInput label={s.frequency} value={frequencyHz} onChange={setFrequencyHz} />
      <ToolInput
        label={s.measuredSpeed}
        hint={s.measuredSpeedHint}
        value={measuredSpeedRpm}
        onChange={setMeasuredSpeedRpm}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.current} value={proUnit(proNum(result.currentA, 4), s.unitA)} />
          <ResultRow label={s.inputPower} value={proUnit(proNum(result.inputPowerKw, 5), s.unitKw)} />
          <ResultRow
            label={s.synchronousSpeed}
            value={proUnit(proNum(result.synchronousSpeedRpm, 0), s.unitRpm)}
          />
          {slip !== undefined && <ResultRow label={s.slip} value={slipText} />}
          <ResultRow
            label={s.torque}
            value={`${proUnit(proNum(result.torqueNm, 4), s.unitNm)} (${measuredSpeedRpm.trim() === "" ? s.atSynchronous : s.atMeasured})`}
          />
          <p className="nx-hint nx-hint--prose">{s.currentNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.shaftPower, value: proUnit(proNum(proParse(shaftPowerKw) ?? 0, 3), s.unitKw) },
              { label: voltageLabel, value: proUnit(proNum(proParse(lineVoltageV) ?? 0, 1), s.unitV) },
              { label: s.powerFactor, value: proNum(proParse(powerFactor) ?? 0, 3) },
              { label: s.efficiency, value: `${proNum(proParse(efficiencyPct) ?? 0, 1)} %` },
              { label: s.poles, value: poles.trim() },
              { label: s.frequency, value: proUnit(proNum(result.frequencyHzUsed, 1), s.unitHz) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Termički otpor
 * ========================================================================== */

/**
 * Three answers behind one figure — the junction temperature a chain
 * produces, the sink resistance a limit leaves room for, and the dissipation
 * a chain tolerates — so `s.regime` picks which of the three core functions
 * runs, the way the belt/gear surface picks between its own two.
 */
export function JunctionTemperatureTool() {
  const s = strings.pro.inzenjering["junction-temperature"];
  const [regime, setRegime] = useState<"junction" | "sink" | "power">("junction");
  const [dissipationW, setDissipationW] = useState("");
  const [ambientC, setAmbientC] = useState("");
  const [junctionToCase, setJunctionToCase] = useState("");
  const [caseToSink, setCaseToSink] = useState("");
  const [sinkToAmbient, setSinkToAmbient] = useState("");
  const [maxJunctionC, setMaxJunctionC] = useState("");

  const forward = junctionTemperature({
    dissipationW: proParse(dissipationW) ?? Number.NaN,
    ambientC: proParse(ambientC) ?? Number.NaN,
    junctionToCase: proParse(junctionToCase) ?? Number.NaN,
    caseToSink: proParse(caseToSink) ?? Number.NaN,
    sinkToAmbient: proParse(sinkToAmbient) ?? Number.NaN,
  });
  const sink = requiredSinkResistance({
    maxJunctionC: proParse(maxJunctionC) ?? Number.NaN,
    ambientC: proParse(ambientC) ?? Number.NaN,
    dissipationW: proParse(dissipationW) ?? Number.NaN,
    junctionToCase: proParse(junctionToCase) ?? Number.NaN,
    caseToSink: proParse(caseToSink) ?? Number.NaN,
  });
  const power = permissibleDissipation({
    maxJunctionC: proParse(maxJunctionC) ?? Number.NaN,
    ambientC: proParse(ambientC) ?? Number.NaN,
    junctionToCase: proParse(junctionToCase) ?? Number.NaN,
    caseToSink: proParse(caseToSink) ?? Number.NaN,
    sinkToAmbient: proParse(sinkToAmbient) ?? Number.NaN,
  });

  const typed = proParse(ambientC) !== undefined || proParse(dissipationW) !== undefined;

  const chainError = (reason: string): string =>
    reason === "dissipation"
      ? s.errorDissipation
      : reason === "ambient"
        ? s.errorAmbient
        : reason === "junctionToCase"
          ? s.errorJunctionToCase
          : reason === "caseToSink"
            ? s.errorCaseToSink
            : reason === "sinkToAmbient"
              ? s.errorSinkToAmbient
              : reason === "maxJunction"
                ? s.errorMaxJunction
                : reason === "ambientAtOrAboveLimit"
                  ? s.errorAmbientAtOrAboveLimit
                  : s.errorChainOverBudget;

  const failure =
    regime === "junction"
      ? forward.ok || !typed
        ? undefined
        : chainError(forward.reason)
      : regime === "sink"
        ? sink.ok || !typed
          ? undefined
          : chainError(sink.reason)
        : power.ok || !typed
          ? undefined
          : chainError(power.reason);

  const forwardCopyText = !forward.ok
    ? ""
    : [
        `${s.totalRth}: ${proUnit(proNum(forward.totalResistance, 4), s.unitKW)}`,
        `${s.junctionTemp}: ${proNum(forward.junctionC, 2)}${s.unitDeg}`,
        `${s.caseTemp}: ${proNum(forward.caseC, 2)}${s.unitDeg}`,
        `${s.sinkTemp}: ${proNum(forward.sinkC, 2)}${s.unitDeg}`,
        "",
        `${s.dissipation}: ${proUnit(proNum(proParse(dissipationW) ?? 0, 2), s.unitW)}`,
        `${s.ambient}: ${proNum(proParse(ambientC) ?? 0, 1)}${s.unitDeg}`,
        `${s.junctionToCase}: ${proUnit(proNum(proParse(junctionToCase) ?? 0, 3), s.unitKW)}`,
        `${s.caseToSink}: ${proUnit(proNum(proParse(caseToSink) ?? 0, 3), s.unitKW)}`,
        `${s.sinkToAmbient}: ${proUnit(proNum(proParse(sinkToAmbient) ?? 0, 3), s.unitKW)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"junction" | "sink" | "power">
        label={s.regime}
        value={regime}
        onChange={setRegime}
        options={[
          { id: "junction", label: s.regimeJunction },
          { id: "sink", label: s.regimeSink },
          { id: "power", label: s.regimePower },
        ]}
      />
      <ToolInput label={s.ambient} value={ambientC} onChange={setAmbientC} />
      <ToolInput label={s.junctionToCase} hint={s.junctionToCaseHint} value={junctionToCase} onChange={setJunctionToCase} />
      <ToolInput label={s.caseToSink} hint={s.caseToSinkHint} value={caseToSink} onChange={setCaseToSink} />
      {regime !== "sink" && (
        <ToolInput
          label={s.sinkToAmbient}
          hint={s.sinkToAmbientHint}
          value={sinkToAmbient}
          onChange={setSinkToAmbient}
        />
      )}
      {regime === "junction" && (
        <ToolInput label={s.dissipation} value={dissipationW} onChange={setDissipationW} />
      )}
      {regime === "sink" && (
        <ToolInput label={s.dissipation} value={dissipationW} onChange={setDissipationW} />
      )}
      {regime !== "junction" && (
        <ToolInput label={s.maxJunction} hint={s.maxJunctionHint} value={maxJunctionC} onChange={setMaxJunctionC} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {regime === "junction" && forward.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalRth} value={proUnit(proNum(forward.totalResistance, 4), s.unitKW)} />
          <ResultRow label={s.junctionTemp} value={`${proNum(forward.junctionC, 2)}${s.unitDeg}`} />
          <ResultRow label={s.caseTemp} value={`${proNum(forward.caseC, 2)}${s.unitDeg}`} />
          <ResultRow label={s.sinkTemp} value={`${proNum(forward.sinkC, 2)}${s.unitDeg}`} />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.dissipation, value: proUnit(proNum(proParse(dissipationW) ?? 0, 2), s.unitW) },
              { label: s.ambient, value: `${proNum(proParse(ambientC) ?? 0, 1)}${s.unitDeg}` },
              { label: s.junctionToCase, value: proUnit(proNum(proParse(junctionToCase) ?? 0, 3), s.unitKW) },
              { label: s.caseToSink, value: proUnit(proNum(proParse(caseToSink) ?? 0, 3), s.unitKW) },
              { label: s.sinkToAmbient, value: proUnit(proNum(proParse(sinkToAmbient) ?? 0, 3), s.unitKW) },
            ]}
          />
          <CopyButton value={forwardCopyText} />
        </ToolSection>
      )}

      {regime === "sink" && sink.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.availableRise} value={`${proNum(sink.availableRiseK, 3)} K`} />
          <ResultRow
            label={s.requiredSink}
            value={proUnit(proNum(sink.requiredSinkResistance, 4), s.unitKW)}
          />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.sinkFormula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.maxJunction, value: `${proNum(proParse(maxJunctionC) ?? 0, 1)}${s.unitDeg}` },
              { label: s.ambient, value: `${proNum(proParse(ambientC) ?? 0, 1)}${s.unitDeg}` },
              { label: s.dissipation, value: proUnit(proNum(proParse(dissipationW) ?? 0, 2), s.unitW) },
              { label: s.junctionToCase, value: proUnit(proNum(proParse(junctionToCase) ?? 0, 3), s.unitKW) },
              { label: s.caseToSink, value: proUnit(proNum(proParse(caseToSink) ?? 0, 3), s.unitKW) },
            ]}
          />
          <CopyButton
            value={[
              `${s.availableRise}: ${proNum(sink.availableRiseK, 3)} K`,
              `${s.requiredSink}: ${proUnit(proNum(sink.requiredSinkResistance, 4), s.unitKW)}`,
            ].join("\n")}
          />
        </ToolSection>
      )}

      {regime === "power" && power.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalRth} value={proUnit(proNum(power.totalResistance, 4), s.unitKW)} />
          <ResultRow label={s.maxDissipation} value={proUnit(proNum(power.maxDissipationW, 3), s.unitW)} />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.powerFormula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.maxJunction, value: `${proNum(proParse(maxJunctionC) ?? 0, 1)}${s.unitDeg}` },
              { label: s.ambient, value: `${proNum(proParse(ambientC) ?? 0, 1)}${s.unitDeg}` },
              { label: s.junctionToCase, value: proUnit(proNum(proParse(junctionToCase) ?? 0, 3), s.unitKW) },
              { label: s.caseToSink, value: proUnit(proNum(proParse(caseToSink) ?? 0, 3), s.unitKW) },
              { label: s.sinkToAmbient, value: proUnit(proNum(proParse(sinkToAmbient) ?? 0, 3), s.unitKW) },
            ]}
          />
          <CopyButton
            value={[
              `${s.totalRth}: ${proUnit(proNum(power.totalResistance, 4), s.unitKW)}`,
              `${s.maxDissipation}: ${proUnit(proNum(power.maxDissipationW, 3), s.unitW)}`,
            ].join("\n")}
          />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Metrički navoj
 * ========================================================================== */

export function MetricThreadTool() {
  const s = strings.pro.inzenjering["metric-thread-strength"];
  const [nominalDiameterMm, setNominalDiameterMm] = useState("");
  const [pitchMm, setPitchMm] = useState("");
  const [strengthMpa, setStrengthMpa] = useState("");
  const [tappingDrillMm, setTappingDrillMm] = useState("");

  const typed = proParse(nominalDiameterMm) !== undefined || proParse(pitchMm) !== undefined;
  const result = metricThread({
    nominalDiameterMm: proParse(nominalDiameterMm) ?? Number.NaN,
    pitchMm: proParse(pitchMm) ?? Number.NaN,
    strengthMpa: proParse(strengthMpa),
    tappingDrillMm: proParse(tappingDrillMm),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "diameter"
        ? s.errorDiameter
        : result.reason === "pitch"
          ? s.errorPitch
          : result.reason === "strength"
            ? s.errorStrength
            : s.errorDrill;

  const copyText = !result.ok
    ? ""
    : [
        `${s.fundamentalHeight}: ${proUnit(proNum(result.fundamentalHeightMm, 5), s.unitMm)}`,
        `${s.pitchDiameter}: ${proUnit(proNum(result.pitchDiameterMm, 5), s.unitMm)}`,
        `${s.minorDiameterBolt}: ${proUnit(proNum(result.minorDiameterBoltMm, 5), s.unitMm)}`,
        `${s.minorDiameterNut}: ${proUnit(proNum(result.minorDiameterNutMm, 5), s.unitMm)}`,
        `${s.stressArea}: ${proUnit(proNum(result.stressAreaMm2, 4), s.unitMm2)}`,
        result.forceKn === undefined ? "" : `${s.force}: ${proUnit(proNum(result.forceKn, 4), s.unitKn)}`,
        result.engagement === undefined
          ? ""
          : `${s.engagement}: ${proNum(result.engagement.isoPct, 4)} %`,
        result.engagement === undefined
          ? ""
          : `${s.engagementWorkshop}: ${proNum(result.engagement.workshopPct, 4)} %`,
        "",
        `${s.nominalDiameter}: ${proUnit(proNum(proParse(nominalDiameterMm) ?? 0, 3), s.unitMm)}`,
        `${s.pitch}: ${proUnit(proNum(proParse(pitchMm) ?? 0, 3), s.unitMm)}`,
        strengthMpa.trim() === "" ? "" : `${s.strength}: ${proUnit(proNum(proParse(strengthMpa) ?? 0, 1), s.unitMpa)}`,
        tappingDrillMm.trim() === "" ? "" : `${s.drill}: ${proUnit(proNum(proParse(tappingDrillMm) ?? 0, 3), s.unitMm)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.nominalDiameter} value={nominalDiameterMm} onChange={setNominalDiameterMm} />
      <ToolInput label={s.pitch} hint={s.pitchHint} value={pitchMm} onChange={setPitchMm} />
      <ToolInput label={s.strength} hint={s.strengthHint} value={strengthMpa} onChange={setStrengthMpa} />
      <ToolInput label={s.drill} hint={s.drillHint} value={tappingDrillMm} onChange={setTappingDrillMm} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.fundamentalHeight} value={proUnit(proNum(result.fundamentalHeightMm, 5), s.unitMm)} />
          <ResultRow label={s.pitchDiameter} value={proUnit(proNum(result.pitchDiameterMm, 5), s.unitMm)} />
          <ResultRow label={s.minorDiameterBolt} value={proUnit(proNum(result.minorDiameterBoltMm, 5), s.unitMm)} />
          <ResultRow label={s.minorDiameterNut} value={proUnit(proNum(result.minorDiameterNutMm, 5), s.unitMm)} />
          <ResultRow label={s.stressArea} value={proUnit(proNum(result.stressAreaMm2, 4), s.unitMm2)} />
          {result.forceKn !== undefined && (
            <>
              <ResultRow label={s.force} value={proUnit(proNum(result.forceKn, 4), s.unitKn)} />
              <p className="nx-hint nx-hint--prose">{s.forceNote}</p>
            </>
          )}
          {result.engagement !== undefined && (
            <>
              <ResultRow label={s.engagement} value={`${proNum(result.engagement.isoPct, 4)} %`} />
              <p className="nx-hint nx-hint--prose">{s.engagementNote}</p>
              <ResultRow
                label={s.engagementWorkshop}
                value={`${proNum(result.engagement.workshopPct, 4)} %`}
              />
              <p className="nx-hint nx-hint--prose">{s.engagementWorkshopNote}</p>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.nominalDiameter, value: proUnit(proNum(proParse(nominalDiameterMm) ?? 0, 3), s.unitMm) },
              { label: s.pitch, value: proUnit(proNum(proParse(pitchMm) ?? 0, 3), s.unitMm) },
              {
                label: s.strength,
                value: strengthMpa.trim() === "" ? "—" : proUnit(proNum(proParse(strengthMpa) ?? 0, 1), s.unitMpa),
              },
              {
                label: s.drill,
                value: tappingDrillMm.trim() === "" ? "—" : proUnit(proNum(proParse(tappingDrillMm) ?? 0, 3), s.unitMm),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Omov zakon i snaga
 * ========================================================================== */

export function OhmsLawTool() {
  const s = strings.pro.inzenjering["ohms-law-power"];
  const [voltageV, setVoltageV] = useState("");
  const [currentA, setCurrentA] = useState("");
  const [resistanceOhm, setResistanceOhm] = useState("");
  const [powerW, setPowerW] = useState("");

  const parsedU = proParse(voltageV);
  const parsedI = proParse(currentA);
  const parsedR = proParse(resistanceOhm);
  const parsedP = proParse(powerW);
  const typed =
    parsedU !== undefined || parsedI !== undefined || parsedR !== undefined || parsedP !== undefined;

  const result = ohmsLaw({ voltageV: parsedU, currentA: parsedI, resistanceOhm: parsedR, powerW: parsedP });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "pair"
        ? s.errorPair
        : result.reason === "voltage"
          ? s.errorVoltage
          : result.reason === "current"
            ? s.errorCurrent
            : result.reason === "resistance"
              ? s.errorResistance
              : s.errorPower;

  const given = {
    voltage: parsedU !== undefined,
    current: parsedI !== undefined,
    resistance: parsedR !== undefined,
    power: parsedP !== undefined,
  };
  const enteredLabel = (isGiven: boolean): string => (isGiven ? s.entered : s.computed);

  const copyText = !result.ok
    ? ""
    : [
        `${s.voltage}: ${proUnit(proNum(result.voltageV, 6), s.unitV)} (${enteredLabel(given.voltage)})`,
        `${s.current}: ${proUnit(proNum(result.currentA, 6), s.unitA)} (${enteredLabel(given.current)})`,
        `${s.resistance}: ${proUnit(proNum(result.resistanceOhm, 6), s.unitOhm)} (${enteredLabel(given.resistance)})`,
        `${s.power}: ${proUnit(proNum(result.powerW, 6), s.unitW)} (${enteredLabel(given.power)})`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.voltage} value={voltageV} onChange={setVoltageV} />
      <ToolInput label={s.current} value={currentA} onChange={setCurrentA} />
      <ToolInput label={s.resistance} value={resistanceOhm} onChange={setResistanceOhm} />
      <ToolInput label={s.power} hint={s.pairHint} value={powerW} onChange={setPowerW} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.voltage}
            value={`${proUnit(proNum(result.voltageV, 6), s.unitV)} (${enteredLabel(given.voltage)})`}
          />
          <ResultRow
            label={s.current}
            value={`${proUnit(proNum(result.currentA, 6), s.unitA)} (${enteredLabel(given.current)})`}
          />
          <ResultRow
            label={s.resistance}
            value={`${proUnit(proNum(result.resistanceOhm, 6), s.unitOhm)} (${enteredLabel(given.resistance)})`}
          />
          <ResultRow
            label={s.power}
            value={`${proUnit(proNum(result.powerW, 6), s.unitW)} (${enteredLabel(given.power)})`}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.voltage, value: given.voltage ? proUnit(proNum(parsedU ?? 0, 6), s.unitV) : "—" },
              { label: s.current, value: given.current ? proUnit(proNum(parsedI ?? 0, 6), s.unitA) : "—" },
              { label: s.resistance, value: given.resistance ? proUnit(proNum(parsedR ?? 0, 6), s.unitOhm) : "—" },
              { label: s.power, value: given.power ? proUnit(proNum(parsedP ?? 0, 6), s.unitW) : "—" },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Protok kroz cev
 * ========================================================================== */

const FLOW_UNIT_OPTIONS: readonly { readonly id: FlowUnit; readonly label: string }[] = [
  { id: "l/s", label: "l/s" },
  { id: "l/min", label: "l/min" },
  { id: "m3/h", label: "m³/h" },
  { id: "m3/s", label: "m³/s" },
];

export function PipeFlowTool() {
  const s = strings.pro.inzenjering["pipe-flow-velocity"];
  const [innerDiameterMm, setInnerDiameterMm] = useState("");
  const [known, setKnown] = useState<"flow" | "velocity">("flow");
  const [flowValue, setFlowValue] = useState("");
  const [flowUnit, setFlowUnit] = useState<FlowUnit>("l/s");
  const [velocityMs, setVelocityMs] = useState("");
  const [kinematicViscosityMm2S, setKinematicViscosityMm2S] = useState("");
  const [densityKgM3, setDensityKgM3] = useState("");

  const typed =
    proParse(innerDiameterMm) !== undefined ||
    proParse(flowValue) !== undefined ||
    proParse(velocityMs) !== undefined;

  const result = pipeFlow({
    innerDiameterMm: proParse(innerDiameterMm) ?? Number.NaN,
    flow: known === "flow" ? { value: proParse(flowValue) ?? Number.NaN, unit: flowUnit } : undefined,
    velocityMs: known === "velocity" ? proParse(velocityMs) ?? Number.NaN : undefined,
    kinematicViscosityMm2S: proParse(kinematicViscosityMm2S),
    densityKgM3: proParse(densityKgM3),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "diameter"
        ? s.errorDiameter
        : result.reason === "flow"
          ? s.errorFlow
          : result.reason === "velocity"
            ? s.errorVelocity
            : result.reason === "viscosity"
              ? s.errorViscosity
              : result.reason === "density"
                ? s.errorDensity
                : s.errorKnown;

  const copyText = !result.ok
    ? ""
    : [
        `${s.areaMm2}: ${proUnit(proNum(result.areaMm2, 3), s.unitMm2)} (${proUnit(proNum(result.areaM2, 6), s.unitM2)})`,
        `${s.velocity}: ${proUnit(proNum(result.velocityMs, 5), s.unitMs)}`,
        `${s.flowLs}: ${proUnit(proNum(result.flowLs, 5), s.unitLs)}`,
        `${s.flowLmin}: ${proUnit(proNum(result.flowLmin, 4), s.unitLmin)}`,
        `${s.flowM3h}: ${proUnit(proNum(result.flowM3h, 5), s.unitM3h)}`,
        `${s.flowM3s}: ${proUnit(proNum(result.flowM3s, 8), s.unitM3s)}`,
        result.reynolds === undefined ? "" : `${s.reynolds}: ${proNum(result.reynolds, 1)}`,
        result.massFlow === undefined
          ? ""
          : `${s.massFlowKgS}: ${proUnit(proNum(result.massFlow.kgS, 5), s.unitKgS)}`,
        result.massFlow === undefined
          ? ""
          : `${s.massFlowKgH}: ${proUnit(proNum(result.massFlow.kgH, 3), s.unitKgH)}`,
        "",
        `${s.innerDiameter}: ${proUnit(proNum(proParse(innerDiameterMm) ?? 0, 2), s.unitMm)}`,
        known === "flow"
          ? `${s.flow}: ${proUnit(proNum(proParse(flowValue) ?? 0, 3), flowUnit)}`
          : `${s.velocity}: ${proUnit(proNum(proParse(velocityMs) ?? 0, 3), s.unitMs)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.innerDiameter} hint={s.innerDiameterHint} value={innerDiameterMm} onChange={setInnerDiameterMm} />
      <ToolSelect<"flow" | "velocity">
        label={s.known}
        value={known}
        onChange={setKnown}
        options={[
          { id: "flow", label: s.knownFlow },
          { id: "velocity", label: s.knownVelocity },
        ]}
      />
      {known === "flow" ? (
        <>
          <ToolInput label={s.flow} value={flowValue} onChange={setFlowValue} />
          <ToolSelect<FlowUnit> label={s.flowUnit} value={flowUnit} onChange={setFlowUnit} options={FLOW_UNIT_OPTIONS} />
        </>
      ) : (
        <ToolInput label={s.velocity} value={velocityMs} onChange={setVelocityMs} />
      )}
      <ToolInput
        label={s.viscosity}
        hint={s.viscosityHint}
        value={kinematicViscosityMm2S}
        onChange={setKinematicViscosityMm2S}
      />
      <ToolInput label={s.density} hint={s.densityHint} value={densityKgM3} onChange={setDensityKgM3} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.areaMm2}
            value={`${proUnit(proNum(result.areaMm2, 3), s.unitMm2)} · ${proUnit(proNum(result.areaM2, 6), s.unitM2)}`}
          />
          <ResultRow label={s.velocity} value={proUnit(proNum(result.velocityMs, 5), s.unitMs)} />
          <p className="nx-hint nx-hint--prose">{s.velocityNote}</p>
          <ResultRow label={s.flowLs} value={proUnit(proNum(result.flowLs, 5), s.unitLs)} />
          <ResultRow label={s.flowLmin} value={proUnit(proNum(result.flowLmin, 4), s.unitLmin)} />
          <ResultRow label={s.flowM3h} value={proUnit(proNum(result.flowM3h, 5), s.unitM3h)} />
          <ResultRow label={s.flowM3s} value={proUnit(proNum(result.flowM3s, 8), s.unitM3s)} />
          {result.reynolds !== undefined && <ResultRow label={s.reynolds} value={proNum(result.reynolds, 1)} />}
          {result.reynolds === undefined && <p className="nx-hint nx-hint--prose">{s.reynoldsHint}</p>}
          {result.massFlow !== undefined && (
            <>
              <ResultRow label={s.massFlowKgS} value={proUnit(proNum(result.massFlow.kgS, 5), s.unitKgS)} />
              <ResultRow label={s.massFlowKgH} value={proUnit(proNum(result.massFlow.kgH, 3), s.unitKgH)} />
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.roundDuctNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.innerDiameter, value: proUnit(proNum(proParse(innerDiameterMm) ?? 0, 2), s.unitMm) },
              {
                label: s.known,
                value:
                  known === "flow"
                    ? proUnit(proNum(proParse(flowValue) ?? 0, 3), flowUnit)
                    : proUnit(proNum(proParse(velocityMs) ?? 0, 3), s.unitMs),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Kompenzacija reaktivne snage
 * ========================================================================== */

export function PowerFactorCorrectionTool() {
  const s = strings.pro.inzenjering["power-factor-correction"];
  const [activePowerKw, setActivePowerKw] = useState("");
  const [presentPowerFactor, setPresentPowerFactor] = useState("");
  const [targetPowerFactor, setTargetPowerFactor] = useState("");
  const [lineVoltageV, setLineVoltageV] = useState("");
  const [frequencyHz, setFrequencyHz] = useState("");
  const [system, setSystem] = useState<PhaseSystem>("three");
  const [connection, setConnection] = useState<CapacitorConnection>("delta");

  const typed =
    proParse(activePowerKw) !== undefined ||
    proParse(presentPowerFactor) !== undefined ||
    proParse(targetPowerFactor) !== undefined;

  const result = powerFactorCorrection({
    activePowerKw: proParse(activePowerKw) ?? Number.NaN,
    presentPowerFactor: proParse(presentPowerFactor) ?? Number.NaN,
    targetPowerFactor: proParse(targetPowerFactor) ?? Number.NaN,
    lineVoltageV: proParse(lineVoltageV) ?? Number.NaN,
    frequencyHz: proParse(frequencyHz),
    system,
    connection,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "power"
        ? s.errorPower
        : result.reason === "presentPowerFactor"
          ? s.errorPresentPowerFactor
          : result.reason === "targetPowerFactor"
            ? s.errorTargetPowerFactor
            : result.reason === "voltage"
              ? s.errorVoltage
              : s.errorFrequency;

  const copyText = !result.ok
    ? ""
    : [
        `${s.reactiveBefore}: ${proUnit(proNum(result.reactiveBeforeKvar, 5), s.unitKvar)}`,
        `${s.reactiveAfter}: ${proUnit(proNum(result.reactiveAfterKvar, 5), s.unitKvar)}`,
        `${s.correction}: ${proUnit(proNum(result.correctionKvar, 5), s.unitKvar)}`,
        `${s.capacitance}: ${proUnit(proNum(result.capacitancePerPhaseUf, 3), s.unitUf)}`,
        `${s.currentBefore}: ${proUnit(proNum(result.currentBeforeA, 4), s.unitA)}`,
        `${s.currentAfter}: ${proUnit(proNum(result.currentAfterA, 4), s.unitA)}`,
        "",
        `${s.activePower}: ${proUnit(proNum(proParse(activePowerKw) ?? 0, 3), s.unitKw)}`,
        `${s.presentPowerFactor}: ${proNum(proParse(presentPowerFactor) ?? 0, 3)}`,
        `${s.targetPowerFactor}: ${proNum(proParse(targetPowerFactor) ?? 0, 3)}`,
        `${s.lineVoltage}: ${proUnit(proNum(proParse(lineVoltageV) ?? 0, 1), s.unitV)}`,
        `${s.connection}: ${connection === "delta" ? s.connectionDelta : s.connectionStar}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.activePower} value={activePowerKw} onChange={setActivePowerKw} />
      <ToolInput label={s.presentPowerFactor} value={presentPowerFactor} onChange={setPresentPowerFactor} />
      <ToolInput label={s.targetPowerFactor} value={targetPowerFactor} onChange={setTargetPowerFactor} />
      <ToolInput label={s.lineVoltage} value={lineVoltageV} onChange={setLineVoltageV} />
      <ToolInput label={s.frequency} value={frequencyHz} onChange={setFrequencyHz} />
      <ToolSelect<PhaseSystem>
        label={s.system}
        value={system}
        onChange={setSystem}
        options={[
          { id: "single", label: "1-fazno" },
          { id: "three", label: "3-fazno" },
        ]}
      />
      <ToolSelect<CapacitorConnection>
        label={s.connection}
        value={connection}
        onChange={setConnection}
        hint={s.connectionHint}
        options={[
          { id: "delta", label: s.connectionDelta },
          { id: "star", label: s.connectionStar },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.reactiveBefore} value={proUnit(proNum(result.reactiveBeforeKvar, 5), s.unitKvar)} />
          <ResultRow label={s.reactiveAfter} value={proUnit(proNum(result.reactiveAfterKvar, 5), s.unitKvar)} />
          <ResultRow label={s.correction} value={proUnit(proNum(result.correctionKvar, 5), s.unitKvar)} />
          <ResultRow label={s.capacitance} value={proUnit(proNum(result.capacitancePerPhaseUf, 3), s.unitUf)} />
          <ResultRow label={s.currentBefore} value={proUnit(proNum(result.currentBeforeA, 4), s.unitA)} />
          <ResultRow label={s.currentAfter} value={proUnit(proNum(result.currentAfterA, 4), s.unitA)} />
          <p className="nx-hint nx-hint--prose">{s.starDeltaNote}</p>
          <p className="nx-hint nx-hint--prose">{s.harmonicsNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.activePower, value: proUnit(proNum(proParse(activePowerKw) ?? 0, 3), s.unitKw) },
              { label: s.presentPowerFactor, value: proNum(proParse(presentPowerFactor) ?? 0, 3) },
              { label: s.targetPowerFactor, value: proNum(proParse(targetPowerFactor) ?? 0, 3) },
              { label: s.lineVoltage, value: proUnit(proNum(proParse(lineVoltageV) ?? 0, 1), s.unitV) },
              { label: s.connection, value: connection === "delta" ? s.connectionDelta : s.connectionStar },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Pritisak i sila klipa
 * ========================================================================== */

const PRESSURE_UNIT_OPTIONS: readonly { readonly id: PressureUnit; readonly label: string }[] = [
  { id: "Pa", label: "Pa" },
  { id: "kPa", label: "kPa" },
  { id: "MPa", label: "MPa" },
  { id: "bar", label: "bar" },
  { id: "mbar", label: "mbar" },
  { id: "psi", label: "psi" },
  { id: "kgf/cm2", label: "kgf/cm²" },
  { id: "atm", label: "atm" },
  { id: "mmHg", label: "mmHg" },
  { id: "torr", label: "torr" },
  { id: "inHg", label: "inHg" },
  { id: "mH2O", label: "mH₂O" },
  { id: "mmH2O", label: "mmH₂O" },
];

const PRESSURE_UNIT_ORDER: readonly PressureUnit[] = PRESSURE_UNIT_OPTIONS.map((option) => option.id);

export function PressurePistonForceTool() {
  const s = strings.pro.inzenjering["pressure-and-piston-force"];
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<PressureUnit>("bar");
  const [kind, setKind] = useState<PressureKind>("gauge");
  const [atmosphericPa, setAtmosphericPa] = useState("");
  const [boreMm, setBoreMm] = useState("");
  const [rodMm, setRodMm] = useState("");

  const typed = proParse(value) !== undefined;
  const conversion = convertPressure({
    value: proParse(value) ?? Number.NaN,
    unit,
    kind,
    atmosphericPa: proParse(atmosphericPa),
  });

  const conversionFailure =
    conversion.ok || !typed
      ? undefined
      : conversion.reason === "atmospheric"
        ? s.errorAtmospheric
        : s.errorValue;

  const force =
    conversion.ok && proParse(boreMm) !== undefined
      ? pistonForce({
          gaugePressurePa: conversion.gaugePa,
          boreMm: proParse(boreMm) ?? Number.NaN,
          rodMm: proParse(rodMm),
          atmosphericPa: proParse(atmosphericPa),
        })
      : undefined;
  const forceFailure =
    force === undefined || force.ok
      ? undefined
      : force.reason === "bore"
        ? s.errorBore
        : force.reason === "rod"
          ? s.errorRod
          : force.reason === "atmospheric"
            ? s.errorAtmospheric
            : s.errorValue;

  const unitLabel = (u: PressureUnit): string =>
    PRESSURE_UNIT_OPTIONS.find((option) => option.id === u)?.label ?? u;

  const copyText = !conversion.ok
    ? ""
    : [
        `${s.gauge}: ${proUnit(proNum(conversion.gaugePa, 1), "Pa")}`,
        `${s.absolute}: ${proUnit(proNum(conversion.absolutePa, 1), "Pa")}`,
        ...PRESSURE_UNIT_ORDER.map(
          (u) =>
            `${unitLabel(u)} — ${s.gauge}: ${proNum(conversion.gauge[u], 5)}  ${s.absolute}: ${proNum(conversion.absolute[u], 5)}`,
        ),
        "",
        force !== undefined && force.ok
          ? [
              `${s.boreArea}: ${proUnit(proNum(force.boreAreaMm2, 3), s.unitMm2)}`,
              `${s.annulusArea}: ${proUnit(proNum(force.annulusAreaMm2, 3), s.unitMm2)}`,
              `${s.extendForce}: ${proUnit(proNum(force.extendForceN, 1), s.unitN)} (${proUnit(proNum(force.extendForceN / 1000, 4), s.unitKn)})`,
              `${s.retractForce}: ${proUnit(proNum(force.retractForceN, 1), s.unitN)} (${proUnit(proNum(force.retractForceN / 1000, 4), s.unitKn)})`,
            ].join("\n")
          : "",
        "",
        `${s.value}: ${proUnit(proNum(proParse(value) ?? 0, 4), unitLabel(unit))}`,
        `${s.kind}: ${kind === "gauge" ? s.kindGauge : s.kindAbsolute}`,
        // The atmosphere is the whole difference between the two readings
        // above, so a copied answer without it is a pair of numbers whose
        // relationship the reader cannot check.
        `${s.atmospheric}: ${proUnit(proNum(conversion.atmosphericPaUsed, 0), "Pa")}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.value} value={value} onChange={setValue} />
      <ToolSelect<PressureUnit> label={s.unit} value={unit} onChange={setUnit} options={PRESSURE_UNIT_OPTIONS} />
      <ToolSelect<PressureKind>
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "gauge", label: s.kindGauge },
          { id: "absolute", label: s.kindAbsolute },
        ]}
      />
      <ToolInput label={s.atmospheric} hint={s.atmosphericHint} value={atmosphericPa} onChange={setAtmosphericPa} />
      <ToolInput label={s.bore} value={boreMm} onChange={setBoreMm} />
      <ToolInput label={s.rod} hint={s.rodHint} value={rodMm} onChange={setRodMm} />

      {conversionFailure !== undefined && <ToolFailure>{conversionFailure}</ToolFailure>}

      {conversion.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.gauge} value={proUnit(proNum(conversion.gaugePa, 1), "Pa")} />
          <ResultRow label={s.absolute} value={proUnit(proNum(conversion.absolutePa, 1), "Pa")} />
          <ToolTableUnits gauge={conversion.gauge} absolute={conversion.absolute} labelFor={unitLabel} s={s} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.value, value: proUnit(proNum(proParse(value) ?? 0, 4), unitLabel(unit)) },
              { label: s.kind, value: kind === "gauge" ? s.kindGauge : s.kindAbsolute },
              {
                label: s.atmospheric,
                value: proUnit(proNum(conversion.atmosphericPaUsed, 0), "Pa"),
              },
            ]}
          />

          {forceFailure !== undefined && <ToolFailure>{forceFailure}</ToolFailure>}
          {force !== undefined && force.ok && (
            <ToolSection title={s.forceResults}>
              <ResultRow label={s.boreArea} value={proUnit(proNum(force.boreAreaMm2, 3), s.unitMm2)} />
              <ResultRow label={s.annulusArea} value={proUnit(proNum(force.annulusAreaMm2, 3), s.unitMm2)} />
              <ResultRow
                label={s.extendForce}
                value={`${proUnit(proNum(force.extendForceN, 1), s.unitN)} (${proUnit(proNum(force.extendForceN / 1000, 4), s.unitKn)})`}
              />
              <ResultRow
                label={s.retractForce}
                value={`${proUnit(proNum(force.retractForceN, 1), s.unitN)} (${proUnit(proNum(force.retractForceN / 1000, 4), s.unitKn)})`}
              />
              <p className="nx-hint nx-hint--prose">{s.theoreticalForceNote}</p>
              <ToolFormula>{s.forceFormula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  { label: s.bore, value: proUnit(proNum(proParse(boreMm) ?? 0, 2), s.unitMm) },
                  { label: s.rod, value: proUnit(proNum(force.rodMmUsed, 2), s.unitMm) },
                ]}
              />
            </ToolSection>
          )}

          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * The 13-unit gauge/absolute table — pulled out of `PressurePistonForceTool`
 * only so the component above it stays a single `ToolSection`'s worth of
 * reading. It renders, nothing more; every number in it already came back
 * from `convertPressure`.
 */
function ToolTableUnits({
  gauge,
  absolute,
  labelFor,
  s,
}: {
  gauge: Record<PressureUnit, number>;
  absolute: Record<PressureUnit, number>;
  labelFor: (unit: PressureUnit) => string;
  s: { readonly gauge: string; readonly absolute: string };
}) {
  return (
    <div className="tool__echo">
      {PRESSURE_UNIT_ORDER.map((u) => (
        <ResultRow
          key={u}
          label={labelFor(u)}
          value={`${s.gauge} ${proNum(gauge[u], 5)} · ${s.absolute} ${proNum(absolute[u], 5)}`}
        />
      ))}
    </div>
  );
}

/* ========================================================================== *
 * Boje otpornika
 * ========================================================================== */

/**
 * The twelve IEC 60062 ring colours, in the order the standard lists them —
 * shared by every ring selector below, since a colour is a colour whichever
 * position it is painted in. Core refuses a colour that has no meaning in the
 * position it occupies (gold as a digit, orange as a tolerance), so offering
 * the same full palette everywhere and reading `fail()`'s reason back is
 * simpler than a surface trying to pre-filter what each ring may hold.
 */
const BAND_COLOUR_ORDER: readonly BandColour[] = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet",
  "grey",
  "white",
  "gold",
  "silver",
];

function bandColourOptions(s: {
  readonly colourBlack: string;
  readonly colourBrown: string;
  readonly colourRed: string;
  readonly colourOrange: string;
  readonly colourYellow: string;
  readonly colourGreen: string;
  readonly colourBlue: string;
  readonly colourViolet: string;
  readonly colourGrey: string;
  readonly colourWhite: string;
  readonly colourGold: string;
  readonly colourSilver: string;
}): readonly { readonly id: BandColour; readonly label: string }[] {
  const names: Record<BandColour, string> = {
    black: s.colourBlack,
    brown: s.colourBrown,
    red: s.colourRed,
    orange: s.colourOrange,
    yellow: s.colourYellow,
    green: s.colourGreen,
    blue: s.colourBlue,
    violet: s.colourViolet,
    grey: s.colourGrey,
    white: s.colourWhite,
    gold: s.colourGold,
    silver: s.colourSilver,
  };
  return BAND_COLOUR_ORDER.map((id) => ({ id, label: names[id] }));
}

const SERIES_OPTIONS: readonly { readonly id: PreferredSeries; readonly label: string }[] = [
  { id: "E6", label: "E6" },
  { id: "E12", label: "E12" },
  { id: "E24", label: "E24" },
];

export function ResistorColourCodeTool() {
  const s = strings.pro.inzenjering["resistor-colour-code"];
  const colourOptions = bandColourOptions(s);
  const colourLabel = (colour: BandColour): string =>
    colourOptions.find((option) => option.id === colour)?.label ?? colour;

  const [direction, setDirection] = useState<"toValue" | "toBands">("toValue");
  const [bandCount, setBandCount] = useState<"3" | "4" | "5" | "6">("4");
  const [band1, setBand1] = useState<BandColour>("brown");
  const [band2, setBand2] = useState<BandColour>("black");
  const [band3, setBand3] = useState<BandColour>("black");
  const [band4, setBand4] = useState<BandColour>("red");
  const [band5, setBand5] = useState<BandColour>("brown");
  const [band6, setBand6] = useState<BandColour>("brown");
  const [series, setSeries] = useState<PreferredSeries>("E24");
  const [ohms, setOhms] = useState("");
  const [tolerancePct, setTolerancePct] = useState("");
  const [tempCoefficientPpmK, setTempCoefficientPpmK] = useState("");

  const count = Number(bandCount);
  const allBands: readonly BandColour[] = [band1, band2, band3, band4, band5, band6].slice(0, count);
  const forward = resistorFromBands({ bands: allBands, series });
  const reverse = resistorBandsForValue({
    ohms: proParse(ohms) ?? Number.NaN,
    tolerancePct: proParse(tolerancePct),
    bandCount: count,
    tempCoefficientPpmK: proParse(tempCoefficientPpmK),
  });
  const reversePreferred =
    reverse.ok && proParse(ohms) !== undefined
      ? nearestPreferredValue(proParse(ohms) ?? Number.NaN, series)
      : undefined;

  const typed = direction === "toValue" ? true : proParse(ohms) !== undefined;

  const forwardFailure =
    forward.ok || direction !== "toValue"
      ? undefined
      : forward.reason === "bandCount"
        ? s.errorBandCount
        : forward.reason === "digitBand"
          ? s.errorDigitBand
          : forward.reason === "multiplierBand"
            ? s.errorMultiplierBand
            : forward.reason === "toleranceBand"
              ? s.errorToleranceBand
              : forward.reason === "tempCoefficientBand"
                ? s.errorTempCoefficientBand
                : s.errorValue;

  const reverseFailure =
    reverse.ok || !typed || direction !== "toBands"
      ? undefined
      : reverse.reason === "bandCount"
        ? s.errorBandCount
        : reverse.reason === "value"
          ? s.errorValue
          : reverse.reason === "multiplier"
            ? s.errorMultiplierRange
            : reverse.reason === "precision"
              ? s.errorPrecision
              : reverse.reason === "tolerance"
                ? s.errorToleranceValue
                : s.errorTempCoefficientValue;

  const forwardCopyText = !forward.ok
    ? ""
    : [
        `${s.value}: ${proUnit(proNum(forward.ohms, 2), s.unitOhm)}`,
        `${s.tolerance}: ±${proNum(forward.tolerancePct, 2)} %`,
        `${s.range}: ${proUnit(proNum(forward.minOhms, 2), s.unitOhm)} – ${proUnit(proNum(forward.maxOhms, 2), s.unitOhm)}`,
        forward.tempCoefficientPpmK === undefined
          ? ""
          : `${s.tempCoefficient}: ${proNum(forward.tempCoefficientPpmK, 0)} ${s.unitPpmK}`,
        `${s.preferred}: ${proUnit(proNum(forward.preferredValueOhms, 3), s.unitOhm)} (${proNum(forward.preferredDeviationPct, 4)} %)`,
        "",
        `${s.bands}: ${allBands.map(colourLabel).join(", ")}`,
        `${s.series}: ${series}`,
      ].join("\n");

  const reverseCopyText = !reverse.ok
    ? ""
    : [
        `${s.bands}: ${reverse.bands.map(colourLabel).join(", ")}`,
        reversePreferred === undefined || !reversePreferred.ok
          ? ""
          : `${s.preferred}: ${proUnit(proNum(reversePreferred.value, 3), s.unitOhm)} (${proNum(reversePreferred.deviationPct, 4)} %)`,
        "",
        `${s.value}: ${proUnit(proNum(proParse(ohms) ?? 0, 2), s.unitOhm)}`,
        tolerancePct.trim() === "" ? "" : `${s.tolerance}: ±${proNum(proParse(tolerancePct) ?? 0, 2)} %`,
        `${s.bandCount}: ${bandCount}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<"toValue" | "toBands">
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "toValue", label: s.directionToValue },
          { id: "toBands", label: s.directionToBands },
        ]}
      />
      <ToolSelect<"3" | "4" | "5" | "6">
        label={s.bandCount}
        value={bandCount}
        onChange={setBandCount}
        options={[
          { id: "3", label: "3" },
          { id: "4", label: "4" },
          { id: "5", label: "5" },
          { id: "6", label: "6" },
        ]}
      />
      <ToolSelect<PreferredSeries>
        label={s.series}
        value={series}
        onChange={setSeries}
        hint={s.seriesHint}
        options={SERIES_OPTIONS}
      />

      {direction === "toValue" ? (
        <>
          <ToolSelect<BandColour> label={s.band1} value={band1} onChange={setBand1} options={colourOptions} />
          <ToolSelect<BandColour> label={s.band2} value={band2} onChange={setBand2} options={colourOptions} />
          {count >= 5 && (
            <ToolSelect<BandColour> label={s.band3digit} value={band3} onChange={setBand3} options={colourOptions} />
          )}
          <ToolSelect<BandColour>
            label={s.multiplierBand}
            value={count >= 5 ? band4 : band3}
            onChange={count >= 5 ? setBand4 : setBand3}
            options={colourOptions}
          />
          {count >= 4 && (
            <ToolSelect<BandColour>
              label={s.toleranceBand}
              value={count >= 5 ? band5 : band4}
              onChange={count >= 5 ? setBand5 : setBand4}
              options={colourOptions}
            />
          )}
          {count === 6 && (
            <ToolSelect<BandColour>
              label={s.tempCoefficientBand}
              hint={s.tempCoefficientHint}
              value={band6}
              onChange={setBand6}
              options={colourOptions}
            />
          )}

          {forwardFailure !== undefined && <ToolFailure>{forwardFailure}</ToolFailure>}

          {forward.ok && (
            <ToolSection title={s.results}>
              <ResultRow label={s.value} value={proUnit(proNum(forward.ohms, 2), s.unitOhm)} />
              <ResultRow label={s.tolerance} value={`±${proNum(forward.tolerancePct, 2)} %`} />
              {count === 3 && <p className="nx-hint nx-hint--prose">{s.unmarkedToleranceNote}</p>}
              <ResultRow
                label={s.range}
                value={`${proUnit(proNum(forward.minOhms, 2), s.unitOhm)} – ${proUnit(proNum(forward.maxOhms, 2), s.unitOhm)}`}
              />
              {forward.tempCoefficientPpmK !== undefined && (
                <ResultRow
                  label={s.tempCoefficient}
                  value={`${proNum(forward.tempCoefficientPpmK, 0)} ${s.unitPpmK}`}
                />
              )}
              <ResultRow
                label={s.preferred}
                value={`${proUnit(proNum(forward.preferredValueOhms, 3), s.unitOhm)} (${proNum(forward.preferredDeviationPct, 4)} %)`}
              />
              <ToolFormula>{s.formula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  { label: s.bands, value: allBands.map(colourLabel).join(", ") },
                  { label: s.series, value: series },
                ]}
              />
              <CopyButton value={forwardCopyText} />
            </ToolSection>
          )}
        </>
      ) : (
        <>
          <ToolInput label={s.value} hint={s.valueHint} value={ohms} onChange={setOhms} />
          {count >= 4 && (
            <ToolInput
              label={s.toleranceInput}
              hint={s.toleranceInputHint}
              value={tolerancePct}
              onChange={setTolerancePct}
            />
          )}
          {count === 6 && (
            <ToolInput
              label={s.tempCoefficientInput}
              hint={s.tempCoefficientHint}
              value={tempCoefficientPpmK}
              onChange={setTempCoefficientPpmK}
            />
          )}

          {reverseFailure !== undefined && <ToolFailure>{reverseFailure}</ToolFailure>}

          {reverse.ok && typed && (
            <ToolSection title={s.results}>
              <ResultRow label={s.bands} value={reverse.bands.map(colourLabel).join(", ")} />
              {reversePreferred !== undefined && reversePreferred.ok && (
                <ResultRow
                  label={s.preferred}
                  value={`${proUnit(proNum(reversePreferred.value, 3), s.unitOhm)} (${proNum(reversePreferred.deviationPct, 4)} %)`}
                />
              )}
              <ToolFormula>{s.reverseFormula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  { label: s.value, value: proUnit(proNum(proParse(ohms) ?? 0, 2), s.unitOhm) },
                  {
                    label: s.toleranceInput,
                    value: tolerancePct.trim() === "" ? "—" : `±${proNum(proParse(tolerancePct) ?? 0, 2)} %`,
                  },
                  { label: s.bandCount, value: bandCount },
                ]}
              />
              <CopyButton value={reverseCopyText} />
            </ToolSection>
          )}
        </>
      )}
    </>
  );
}

/* ========================================================================== *
 * Impedansa i rezonansa
 * ========================================================================== */

export function RlcImpedanceTool() {
  const s = strings.pro.inzenjering["rlc-impedance"];
  const [frequencyHz, setFrequencyHz] = useState("");
  const [resistanceOhm, setResistanceOhm] = useState("");
  const [inductanceH, setInductanceH] = useState("");
  const [capacitanceF, setCapacitanceF] = useState("");
  const [connection, setConnection] = useState<RlcConnection>("series");

  const typed = proParse(frequencyHz) !== undefined || proParse(resistanceOhm) !== undefined;
  const result = rlcResponse({
    frequencyHz: proParse(frequencyHz) ?? Number.NaN,
    resistanceOhm: proParse(resistanceOhm) ?? Number.NaN,
    inductanceH: proParse(inductanceH),
    capacitanceF: proParse(capacitanceF),
    connection,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "frequency"
        ? s.errorFrequency
        : result.reason === "resistance"
          ? s.errorResistance
          : result.reason === "inductance"
            ? s.errorInductance
            : s.errorCapacitance;

  // The corner and its τ are written the same way in both branches and in the
  // copied text; one spelling, so the three cannot drift apart. Declared after
  // `s` because it reads it.
  const cornerText = (corner: FirstOrderCorner): string => {
    const hz = proUnit(proNum(corner.cornerHz, 5), s.unitHz);
    return `${hz} (τ = ${proUnit(proNum(corner.timeConstantS, 6), s.unitS2)})`;
  };

  const copyText = !result.ok
    ? ""
    : [
        result.reactanceInductiveOhm === undefined
          ? ""
          : `${s.reactanceInductive}: ${proUnit(proNum(result.reactanceInductiveOhm, 5), s.unitOhm)}`,
        result.reactanceCapacitiveOhm === undefined
          ? ""
          : `${s.reactanceCapacitive}: ${proUnit(proNum(result.reactanceCapacitiveOhm, 5), s.unitOhm)}`,
        result.netReactanceOhm === undefined
          ? ""
          : `${s.netReactance}: ${proUnit(proNum(result.netReactanceOhm, 5), s.unitOhm)}`,
        result.conductanceS === undefined
          ? ""
          : `${s.conductance}: ${proUnit(proNum(result.conductanceS, 6), s.unitS)}`,
        result.susceptanceS === undefined
          ? ""
          : `${s.susceptance}: ${proUnit(proNum(result.susceptanceS, 6), s.unitS)}`,
        `${s.impedance}: ${proUnit(proNum(result.impedanceOhm, 5), s.unitOhm)}`,
        `${s.phase}: ${proNum(result.phaseDeg, 4)}${s.unitDeg}`,
        result.resonanceHz === undefined ? "" : `${s.resonance}: ${proUnit(proNum(result.resonanceHz, 5), s.unitHz)}`,
        result.qualityFactor === undefined ? "" : `${s.qualityFactor}: ${proNum(result.qualityFactor, 5)}`,
        result.bandwidthHz === undefined ? "" : `${s.bandwidth}: ${proUnit(proNum(result.bandwidthHz, 5), s.unitHz)}`,
        result.rc === undefined ? "" : `${s.cornerRc}: ${cornerText(result.rc)}`,
        result.rl === undefined ? "" : `${s.cornerRl}: ${cornerText(result.rl)}`,
        "",
        `${s.frequency}: ${proUnit(proNum(proParse(frequencyHz) ?? 0, 2), s.unitHz)}`,
        `${s.resistance}: ${proUnit(proNum(proParse(resistanceOhm) ?? 0, 3), s.unitOhm)}`,
        inductanceH.trim() === "" ? "" : `${s.inductance}: ${proUnit(proNum(proParse(inductanceH) ?? 0, 6), s.unitH)}`,
        capacitanceF.trim() === "" ? "" : `${s.capacitance}: ${proUnit(proNum(proParse(capacitanceF) ?? 0, 9), s.unitF)}`,
        `${s.connection}: ${connection === "series" ? s.connectionSeries : s.connectionParallel}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.frequency} value={frequencyHz} onChange={setFrequencyHz} />
      <ToolInput label={s.resistance} value={resistanceOhm} onChange={setResistanceOhm} />
      <ToolInput label={s.inductance} hint={s.inductanceHint} value={inductanceH} onChange={setInductanceH} />
      <ToolInput label={s.capacitance} hint={s.capacitanceHint} value={capacitanceF} onChange={setCapacitanceF} />
      <ToolSelect<RlcConnection>
        label={s.connection}
        value={connection}
        onChange={setConnection}
        options={[
          { id: "series", label: s.connectionSeries },
          { id: "parallel", label: s.connectionParallel },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.reactanceInductiveOhm !== undefined && (
            <ResultRow label={s.reactanceInductive} value={proUnit(proNum(result.reactanceInductiveOhm, 5), s.unitOhm)} />
          )}
          {result.reactanceCapacitiveOhm !== undefined && (
            <ResultRow
              label={s.reactanceCapacitive}
              value={proUnit(proNum(result.reactanceCapacitiveOhm, 5), s.unitOhm)}
            />
          )}
          {result.netReactanceOhm !== undefined && (
            <ResultRow label={s.netReactance} value={proUnit(proNum(result.netReactanceOhm, 5), s.unitOhm)} />
          )}
          {result.conductanceS !== undefined && (
            <ResultRow label={s.conductance} value={proUnit(proNum(result.conductanceS, 6), s.unitS)} />
          )}
          {result.susceptanceS !== undefined && (
            <ResultRow label={s.susceptance} value={proUnit(proNum(result.susceptanceS, 6), s.unitS)} />
          )}
          <ResultRow label={s.impedance} value={proUnit(proNum(result.impedanceOhm, 5), s.unitOhm)} />
          <ResultRow label={s.phase} value={`${proNum(result.phaseDeg, 4)}${s.unitDeg}`} />
          <p className="nx-hint nx-hint--prose">{s.phaseSignNote}</p>
          {result.resonanceHz !== undefined && (
            <ResultRow label={s.resonance} value={proUnit(proNum(result.resonanceHz, 5), s.unitHz)} />
          )}
          {result.qualityFactor !== undefined && (
            <ResultRow label={s.qualityFactor} value={proNum(result.qualityFactor, 5)} />
          )}
          {result.bandwidthHz !== undefined && (
            <ResultRow label={s.bandwidth} value={proUnit(proNum(result.bandwidthHz, 5), s.unitHz)} />
          )}
          {result.rc !== undefined && <ResultRow label={s.cornerRc} value={cornerText(result.rc)} />}
          {result.rl !== undefined && <ResultRow label={s.cornerRl} value={cornerText(result.rl)} />}
          <p className="nx-hint nx-hint--prose">{s.absentNote}</p>
          <ToolFormula>{connection === "series" ? s.formulaSeries : s.formulaParallel}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.frequency, value: proUnit(proNum(proParse(frequencyHz) ?? 0, 2), s.unitHz) },
              { label: s.resistance, value: proUnit(proNum(proParse(resistanceOhm) ?? 0, 3), s.unitOhm) },
              {
                label: s.inductance,
                value: inductanceH.trim() === "" ? "—" : proUnit(proNum(proParse(inductanceH) ?? 0, 6), s.unitH),
              },
              {
                label: s.capacitance,
                value: capacitanceF.trim() === "" ? "—" : proUnit(proNum(proParse(capacitanceF) ?? 0, 9), s.unitF),
              },
              { label: s.connection, value: connection === "series" ? s.connectionSeries : s.connectionParallel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Karakteristike preseka
 * ========================================================================== */

type SectionKind = SectionShape["kind"];

export function SectionModulusTool() {
  const s = strings.pro.inzenjering["section-modulus"];
  const [kind, setKind] = useState<SectionKind>("rectangle");
  const [widthMm, setWidthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [diameterMm, setDiameterMm] = useState("");
  const [outerDiameterMm, setOuterDiameterMm] = useState("");
  const [innerDiameterMm, setInnerDiameterMm] = useState("");
  const [outerWidthMm, setOuterWidthMm] = useState("");
  const [outerHeightMm, setOuterHeightMm] = useState("");
  const [innerWidthMm, setInnerWidthMm] = useState("");
  const [innerHeightMm, setInnerHeightMm] = useState("");
  const [flangeWidthMm, setFlangeWidthMm] = useState("");
  const [depthMm, setDepthMm] = useState("");
  const [flangeThicknessMm, setFlangeThicknessMm] = useState("");
  const [webThicknessMm, setWebThicknessMm] = useState("");
  const [allowableStressMpa, setAllowableStressMpa] = useState("");
  const [bendingMomentNm, setBendingMomentNm] = useState("");
  const [torsionMomentNm, setTorsionMomentNm] = useState("");

  const isCircular = kind === "circle" || kind === "tube";
  const formula =
    kind === "rectangle"
      ? s.formulaRectangle
      : kind === "circle"
        ? s.formulaCircle
        : kind === "tube"
          ? s.formulaTube
          : kind === "rectangularTube"
            ? s.formulaRectangularTube
            : s.formulaISection;

  const shape: SectionShape =
    kind === "rectangle"
      ? { kind, widthMm: proParse(widthMm) ?? Number.NaN, heightMm: proParse(heightMm) ?? Number.NaN }
      : kind === "circle"
        ? { kind, diameterMm: proParse(diameterMm) ?? Number.NaN }
        : kind === "tube"
          ? {
              kind,
              outerDiameterMm: proParse(outerDiameterMm) ?? Number.NaN,
              innerDiameterMm: proParse(innerDiameterMm) ?? Number.NaN,
            }
          : kind === "rectangularTube"
            ? {
                kind,
                outerWidthMm: proParse(outerWidthMm) ?? Number.NaN,
                outerHeightMm: proParse(outerHeightMm) ?? Number.NaN,
                innerWidthMm: proParse(innerWidthMm) ?? Number.NaN,
                innerHeightMm: proParse(innerHeightMm) ?? Number.NaN,
              }
            : {
                kind,
                flangeWidthMm: proParse(flangeWidthMm) ?? Number.NaN,
                depthMm: proParse(depthMm) ?? Number.NaN,
                flangeThicknessMm: proParse(flangeThicknessMm) ?? Number.NaN,
                webThicknessMm: proParse(webThicknessMm) ?? Number.NaN,
              };

  const typed =
    proParse(widthMm) !== undefined ||
    proParse(diameterMm) !== undefined ||
    proParse(outerDiameterMm) !== undefined ||
    proParse(outerWidthMm) !== undefined ||
    proParse(flangeWidthMm) !== undefined;

  const result = sectionProperties({
    shape,
    allowableStressMpa: proParse(allowableStressMpa),
    bendingMomentNm: proParse(bendingMomentNm),
    torsionMomentNm: isCircular ? proParse(torsionMomentNm) : undefined,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "dimensions"
        ? s.errorDimensions
        : result.reason === "allowableStress"
          ? s.errorAllowableStress
          : result.reason === "bendingMoment"
            ? s.errorBendingMoment
            : result.reason === "torsionMoment"
              ? s.errorTorsionMoment
              : s.errorDimensions;

  const dimensionEntries: readonly { readonly label: string; readonly value: string }[] =
    kind === "rectangle"
      ? [
          { label: s.width, value: proUnit(proNum(proParse(widthMm) ?? 0, 2), s.unitMm) },
          { label: s.height, value: proUnit(proNum(proParse(heightMm) ?? 0, 2), s.unitMm) },
        ]
      : kind === "circle"
        ? [{ label: s.diameter, value: proUnit(proNum(proParse(diameterMm) ?? 0, 2), s.unitMm) }]
        : kind === "tube"
          ? [
              { label: s.outerDiameter, value: proUnit(proNum(proParse(outerDiameterMm) ?? 0, 2), s.unitMm) },
              { label: s.innerDiameter, value: proUnit(proNum(proParse(innerDiameterMm) ?? 0, 2), s.unitMm) },
            ]
          : kind === "rectangularTube"
            ? [
                { label: s.outerWidth, value: proUnit(proNum(proParse(outerWidthMm) ?? 0, 2), s.unitMm) },
                { label: s.outerHeight, value: proUnit(proNum(proParse(outerHeightMm) ?? 0, 2), s.unitMm) },
                { label: s.innerWidth, value: proUnit(proNum(proParse(innerWidthMm) ?? 0, 2), s.unitMm) },
                { label: s.innerHeight, value: proUnit(proNum(proParse(innerHeightMm) ?? 0, 2), s.unitMm) },
              ]
            : [
                { label: s.flangeWidth, value: proUnit(proNum(proParse(flangeWidthMm) ?? 0, 2), s.unitMm) },
                { label: s.depth, value: proUnit(proNum(proParse(depthMm) ?? 0, 2), s.unitMm) },
                { label: s.flangeThickness, value: proUnit(proNum(proParse(flangeThicknessMm) ?? 0, 2), s.unitMm) },
                { label: s.webThickness, value: proUnit(proNum(proParse(webThicknessMm) ?? 0, 2), s.unitMm) },
              ];

  const copyText = !result.ok
    ? ""
    : [
        `${s.area}: ${proUnit(proNum(result.areaMm2, 4), s.unitMm2)}`,
        `${s.momentOfInertiaX}: ${proUnit(proNum(result.momentOfInertiaXMm4, 5), s.unitMm4)}`,
        `${s.momentOfInertiaY}: ${proUnit(proNum(result.momentOfInertiaYMm4, 5), s.unitMm4)}`,
        `${s.sectionModulusX}: ${proUnit(proNum(result.sectionModulusXMm3, 5), s.unitMm3)}`,
        `${s.sectionModulusY}: ${proUnit(proNum(result.sectionModulusYMm3, 5), s.unitMm3)}`,
        `${s.radiusOfGyrationX}: ${proUnit(proNum(result.radiusOfGyrationXMm, 4), s.unitMm)}`,
        `${s.radiusOfGyrationY}: ${proUnit(proNum(result.radiusOfGyrationYMm, 4), s.unitMm)}`,
        result.polar === undefined
          ? ""
          : `${s.polarMoment}: ${proUnit(proNum(result.polar.momentMm4, 5), s.unitMm4)}`,
        result.polar === undefined
          ? ""
          : `${s.polarModulus}: ${proUnit(proNum(result.polar.modulusMm3, 5), s.unitMm3)}`,
        result.allowableMomentNm === undefined
          ? ""
          : `${s.allowableMoment}: ${proUnit(proNum(result.allowableMomentNm, 3), s.unitNm)}`,
        result.bendingStressMpa === undefined
          ? ""
          : `${s.bendingStress}: ${proUnit(proNum(result.bendingStressMpa, 4), s.unitMpa)}`,
        result.stressRatio === undefined ? "" : `${s.stressRatio}: ${proRatio(result.stressRatio)}`,
        result.torsionalStressMpa === undefined
          ? ""
          : `${s.torsionalStress}: ${proUnit(proNum(result.torsionalStressMpa, 4), s.unitMpa)}`,
        "",
        ...dimensionEntries.map((entry) => `${entry.label}: ${entry.value}`),
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<SectionKind>
        label={s.shape}
        value={kind}
        onChange={setKind}
        options={[
          { id: "rectangle", label: s.shapeRectangle },
          { id: "circle", label: s.shapeCircle },
          { id: "tube", label: s.shapeTube },
          { id: "rectangularTube", label: s.shapeRectangularTube },
          { id: "iSection", label: s.shapeISection },
        ]}
      />

      {kind === "rectangle" && (
        <>
          <ToolInput label={s.width} value={widthMm} onChange={setWidthMm} />
          <ToolInput label={s.height} value={heightMm} onChange={setHeightMm} />
        </>
      )}
      {kind === "circle" && <ToolInput label={s.diameter} value={diameterMm} onChange={setDiameterMm} />}
      {kind === "tube" && (
        <>
          <ToolInput label={s.outerDiameter} value={outerDiameterMm} onChange={setOuterDiameterMm} />
          <ToolInput label={s.innerDiameter} value={innerDiameterMm} onChange={setInnerDiameterMm} />
        </>
      )}
      {kind === "rectangularTube" && (
        <>
          <ToolInput label={s.outerWidth} value={outerWidthMm} onChange={setOuterWidthMm} />
          <ToolInput label={s.outerHeight} value={outerHeightMm} onChange={setOuterHeightMm} />
          <ToolInput label={s.innerWidth} value={innerWidthMm} onChange={setInnerWidthMm} />
          <ToolInput label={s.innerHeight} value={innerHeightMm} onChange={setInnerHeightMm} />
        </>
      )}
      {kind === "iSection" && (
        <>
          <ToolInput label={s.flangeWidth} value={flangeWidthMm} onChange={setFlangeWidthMm} />
          <ToolInput label={s.depth} value={depthMm} onChange={setDepthMm} />
          <ToolInput label={s.flangeThickness} value={flangeThicknessMm} onChange={setFlangeThicknessMm} />
          <ToolInput label={s.webThickness} value={webThicknessMm} onChange={setWebThicknessMm} />
          <p className="nx-hint nx-hint--prose">{s.iSectionNote}</p>
        </>
      )}

      <ToolInput
        label={s.allowableStress}
        hint={s.allowableStressHint}
        value={allowableStressMpa}
        onChange={setAllowableStressMpa}
      />
      <ToolInput label={s.bendingMoment} value={bendingMomentNm} onChange={setBendingMomentNm} />
      {isCircular && (
        <ToolInput label={s.torsionMoment} hint={s.torsionHint} value={torsionMomentNm} onChange={setTorsionMomentNm} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.area} value={proUnit(proNum(result.areaMm2, 4), s.unitMm2)} />
          <ResultRow label={s.momentOfInertiaX} value={proUnit(proNum(result.momentOfInertiaXMm4, 5), s.unitMm4)} />
          <ResultRow label={s.momentOfInertiaY} value={proUnit(proNum(result.momentOfInertiaYMm4, 5), s.unitMm4)} />
          <ResultRow label={s.sectionModulusX} value={proUnit(proNum(result.sectionModulusXMm3, 5), s.unitMm3)} />
          <ResultRow label={s.sectionModulusY} value={proUnit(proNum(result.sectionModulusYMm3, 5), s.unitMm3)} />
          <ResultRow label={s.radiusOfGyrationX} value={proUnit(proNum(result.radiusOfGyrationXMm, 4), s.unitMm)} />
          <ResultRow label={s.radiusOfGyrationY} value={proUnit(proNum(result.radiusOfGyrationYMm, 4), s.unitMm)} />
          {result.polar === undefined ? (
            <p className="nx-hint nx-hint--prose">{s.noPolarNote}</p>
          ) : (
            <>
              <ResultRow label={s.polarMoment} value={proUnit(proNum(result.polar.momentMm4, 5), s.unitMm4)} />
              <ResultRow label={s.polarModulus} value={proUnit(proNum(result.polar.modulusMm3, 5), s.unitMm3)} />
            </>
          )}
          {result.allowableMomentNm !== undefined && (
            <ResultRow label={s.allowableMoment} value={proUnit(proNum(result.allowableMomentNm, 3), s.unitNm)} />
          )}
          {result.bendingStressMpa !== undefined && (
            <ToolAgainstLimit
              label={s.bendingStress}
              value={proUnit(proNum(result.bendingStressMpa, 4), s.unitMpa)}
              limitLabel={s.allowableStress}
              limit={
                proParse(allowableStressMpa) === undefined
                  ? undefined
                  : proUnit(proNum(proParse(allowableStressMpa) ?? 0, 1), s.unitMpa)
              }
              ratioLabel={s.stressRatio}
              ratio={proRatio(result.stressRatio)}
            />
          )}
          {result.torsionalStressMpa !== undefined && (
            <ResultRow label={s.torsionalStress} value={proUnit(proNum(result.torsionalStressMpa, 4), s.unitMpa)} />
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={dimensionEntries} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Serija i paralela
 * ========================================================================== */

const ELEMENT_UNIT: Record<PassiveElement, string> = { resistor: "Ω", inductor: "H", capacitor: "F" };

/**
 * Two unrelated tools on one surface, exactly as the belt/gear and thermal
 * surfaces above — an n-element network and a two-resistor divider — so
 * `s.regime` is a visible toggle rather than a silent guess.
 */
export function SeriesParallelNetworkTool() {
  const s = strings.pro.inzenjering["series-parallel-network"];
  const [regime, setRegime] = useState<"network" | "divider">("network");
  const [element, setElement] = useState<PassiveElement>("resistor");
  const [connection, setConnection] = useState<NetworkConnection>("parallel");
  const [valuesText, setValuesText] = useState("");
  const [inputVoltageV, setInputVoltageV] = useState("");
  const [upperOhm, setUpperOhm] = useState("");
  const [lowerOhm, setLowerOhm] = useState("");

  const unit = ELEMENT_UNIT[element];
  const values = parseLines(valuesText).map((line) => proParse(line) ?? Number.NaN);
  const typedNetwork = parseLines(valuesText).length > 0;
  const network = networkEquivalent({ element, connection, values });
  const networkFailure =
    network.ok || !typedNetwork
      ? undefined
      : network.reason === "values"
        ? s.errorValues
        : s.errorTooMany;

  const typedDivider =
    proParse(inputVoltageV) !== undefined || proParse(upperOhm) !== undefined || proParse(lowerOhm) !== undefined;
  const divider = voltageDivider({
    inputVoltageV: proParse(inputVoltageV) ?? Number.NaN,
    upperOhm: proParse(upperOhm) ?? Number.NaN,
    lowerOhm: proParse(lowerOhm) ?? Number.NaN,
  });
  const dividerFailure =
    divider.ok || !typedDivider
      ? undefined
      : divider.reason === "inputVoltage"
        ? s.errorInputVoltage
        : divider.reason === "upper"
          ? s.errorUpper
          : divider.reason === "lower"
            ? s.errorLower
            : s.errorTotal;

  const networkCopyText = !network.ok
    ? ""
    : [
        `${s.equivalent}: ${proUnit(proNum(network.equivalent, 5), unit)}`,
        "",
        `${s.element}: ${element === "resistor" ? s.elementResistor : element === "inductor" ? s.elementInductor : s.elementCapacitor}`,
        `${s.connection}: ${connection === "series" ? s.connectionSeries : s.connectionParallel}`,
        `${s.values}: ${parseLines(valuesText).join("; ")}`,
      ].join("\n");

  const dividerCopyText = !divider.ok
    ? ""
    : [
        `${s.outputVoltage}: ${proUnit(proNum(divider.outputVoltageV, 4), s.unitV)}`,
        `${s.current}: ${proUnit(proNum(divider.currentA, 6), s.unitA)}`,
        `${s.upperPower}: ${proUnit(proNum(divider.upperPowerW, 5), s.unitW)}`,
        `${s.lowerPower}: ${proUnit(proNum(divider.lowerPowerW, 5), s.unitW)}`,
        `${s.totalPower}: ${proUnit(proNum(divider.totalPowerW, 5), s.unitW)}`,
        `${s.theveninResistance}: ${proUnit(proNum(divider.theveninResistanceOhm, 3), s.unitOhm)}`,
        "",
        `${s.inputVoltage}: ${proUnit(proNum(proParse(inputVoltageV) ?? 0, 3), s.unitV)}`,
        `${s.upper}: ${proUnit(proNum(proParse(upperOhm) ?? 0, 3), s.unitOhm)}`,
        `${s.lower}: ${proUnit(proNum(proParse(lowerOhm) ?? 0, 3), s.unitOhm)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"network" | "divider">
        label={s.regime}
        value={regime}
        onChange={setRegime}
        options={[
          { id: "network", label: s.regimeNetwork },
          { id: "divider", label: s.regimeDivider },
        ]}
      />

      {regime === "network" ? (
        <>
          <ToolSelect<PassiveElement>
            label={s.element}
            value={element}
            onChange={setElement}
            options={[
              { id: "resistor", label: s.elementResistor },
              { id: "inductor", label: s.elementInductor },
              { id: "capacitor", label: s.elementCapacitor },
            ]}
          />
          <ToolSelect<NetworkConnection>
            label={s.connection}
            value={connection}
            onChange={setConnection}
            options={[
              { id: "series", label: s.connectionSeries },
              { id: "parallel", label: s.connectionParallel },
            ]}
          />
          <ToolTextArea
            label={s.values}
            hint={s.valuesHint}
            value={valuesText}
            onChange={setValuesText}
            rows={6}
          />

          {networkFailure !== undefined && <ToolFailure>{networkFailure}</ToolFailure>}

          {network.ok && (
            <ToolSection title={s.results}>
              <ResultRow label={s.equivalent} value={proUnit(proNum(network.equivalent, 5), unit)} />
              <p className="nx-hint nx-hint--prose">{s.zeroNote}</p>
              <ToolFormula>{s.formula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  {
                    label: s.element,
                    value:
                      element === "resistor" ? s.elementResistor : element === "inductor" ? s.elementInductor : s.elementCapacitor,
                  },
                  { label: s.connection, value: connection === "series" ? s.connectionSeries : s.connectionParallel },
                  { label: s.values, value: parseLines(valuesText).join("; ") },
                ]}
              />
              <CopyButton value={networkCopyText} />
            </ToolSection>
          )}
        </>
      ) : (
        <>
          <ToolInput label={s.inputVoltage} value={inputVoltageV} onChange={setInputVoltageV} />
          <ToolInput label={s.upper} value={upperOhm} onChange={setUpperOhm} />
          <ToolInput label={s.lower} value={lowerOhm} onChange={setLowerOhm} />

          {dividerFailure !== undefined && <ToolFailure>{dividerFailure}</ToolFailure>}

          {divider.ok && (
            <ToolSection title={s.results}>
              <ResultRow label={s.outputVoltage} value={proUnit(proNum(divider.outputVoltageV, 4), s.unitV)} />
              <p className="nx-hint nx-hint--prose">{s.unloadedNote}</p>
              <ResultRow label={s.current} value={proUnit(proNum(divider.currentA, 6), s.unitA)} />
              <ResultRow label={s.upperPower} value={proUnit(proNum(divider.upperPowerW, 5), s.unitW)} />
              <ResultRow label={s.lowerPower} value={proUnit(proNum(divider.lowerPowerW, 5), s.unitW)} />
              <ResultRow label={s.totalPower} value={proUnit(proNum(divider.totalPowerW, 5), s.unitW)} />
              <ResultRow label={s.theveninResistance} value={proUnit(proNum(divider.theveninResistanceOhm, 3), s.unitOhm)} />
              <ToolFormula>{s.dividerFormula}</ToolFormula>
              <ToolInputEcho
                title={s.inputs}
                entries={[
                  { label: s.inputVoltage, value: proUnit(proNum(proParse(inputVoltageV) ?? 0, 3), s.unitV) },
                  { label: s.upper, value: proUnit(proNum(proParse(upperOhm) ?? 0, 3), s.unitOhm) },
                  { label: s.lower, value: proUnit(proNum(proParse(lowerOhm) ?? 0, 3), s.unitOhm) },
                ]}
              />
              <CopyButton value={dividerCopyText} />
            </ToolSection>
          )}
        </>
      )}
    </>
  );
}

/* ========================================================================== *
 * Trofazna snaga
 * ========================================================================== */

export function ThreePhasePowerTool() {
  const s = strings.pro.inzenjering["three-phase-power"];
  const [system, setSystem] = useState<PhaseSystem>("three");
  const [lineVoltageV, setLineVoltageV] = useState("");
  const [known, setKnown] = useState<"current" | "activePower" | "apparentPower">("activePower");
  const [knownValue, setKnownValue] = useState("");
  const [powerFactor, setPowerFactor] = useState("");
  const [connection, setConnection] = useState<WindingConnection>("star");

  const typed = proParse(lineVoltageV) !== undefined || proParse(knownValue) !== undefined;
  const result = threePhasePower({
    system,
    lineVoltageV: proParse(lineVoltageV) ?? Number.NaN,
    powerFactor: proParse(powerFactor) ?? Number.NaN,
    currentA: known === "current" ? proParse(knownValue) ?? Number.NaN : undefined,
    activePowerKw: known === "activePower" ? proParse(knownValue) ?? Number.NaN : undefined,
    apparentPowerKva: known === "apparentPower" ? proParse(knownValue) ?? Number.NaN : undefined,
    connection,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "voltage"
        ? s.errorVoltage
        : result.reason === "powerFactor"
          ? s.errorPowerFactor
          : result.reason === "current"
            ? s.errorCurrent
            : result.reason === "activePower"
              ? s.errorActivePower
              : result.reason === "apparentPower"
                ? s.errorApparentPower
                : s.errorKnown;

  const voltageLabel = system === "single" ? s.voltageSingle : s.voltageThree;
  const knownLabel =
    known === "current" ? s.knownCurrent : known === "activePower" ? s.knownActivePower : s.knownApparentPower;

  const copyText = !result.ok
    ? ""
    : [
        `${s.apparent}: ${proUnit(proNum(result.apparentKva, 5), s.unitKva)}`,
        `${s.active}: ${proUnit(proNum(result.activeKw, 5), s.unitKw)}`,
        `${s.reactive}: ${proUnit(proNum(result.reactiveKvar, 5), s.unitKvar)}`,
        `${s.current}: ${proUnit(proNum(result.currentA, 5), s.unitA)}`,
        `${s.phase}: ${proNum(result.phaseDeg, 4)}${s.unitDeg}`,
        `${s.tanPhi}: ${proNum(result.tanPhi, 6)}`,
        `${s.phaseVoltage}: ${proUnit(proNum(result.phaseVoltageV, 4), s.unitV)}`,
        `${s.phaseCurrent}: ${proUnit(proNum(result.phaseCurrentA, 5), s.unitA)}`,
        "",
        `${s.system}: ${system === "single" ? "1-fazno" : "3-fazno"}`,
        `${voltageLabel}: ${proUnit(proNum(proParse(lineVoltageV) ?? 0, 1), s.unitV)}`,
        `${knownLabel}: ${knownValue.trim()}`,
        `${s.powerFactor}: ${proNum(proParse(powerFactor) ?? 0, 3)}`,
        system === "three" ? `${s.connection}: ${connection === "star" ? s.connectionStar : s.connectionDelta}` : "",
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<PhaseSystem>
        label={s.system}
        value={system}
        onChange={setSystem}
        options={[
          { id: "single", label: "1-fazno" },
          { id: "three", label: "3-fazno" },
        ]}
      />
      <ToolInput label={voltageLabel} value={lineVoltageV} onChange={setLineVoltageV} />
      <ToolSelect<"current" | "activePower" | "apparentPower">
        label={s.known}
        value={known}
        onChange={setKnown}
        options={[
          { id: "current", label: s.knownCurrent },
          { id: "activePower", label: s.knownActivePower },
          { id: "apparentPower", label: s.knownApparentPower },
        ]}
      />
      <ToolInput label={knownLabel} value={knownValue} onChange={setKnownValue} />
      <ToolInput label={s.powerFactor} value={powerFactor} onChange={setPowerFactor} />
      {system === "three" && (
        <ToolSelect<WindingConnection>
          label={s.connection}
          hint={s.connectionHint}
          value={connection}
          onChange={setConnection}
          options={[
            { id: "star", label: s.connectionStar },
            { id: "delta", label: s.connectionDelta },
          ]}
        />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.apparent} value={proUnit(proNum(result.apparentKva, 5), s.unitKva)} />
          <ResultRow label={s.active} value={proUnit(proNum(result.activeKw, 5), s.unitKw)} />
          <ResultRow label={s.reactive} value={proUnit(proNum(result.reactiveKvar, 5), s.unitKvar)} />
          <ResultRow label={s.current} value={proUnit(proNum(result.currentA, 5), s.unitA)} />
          <ResultRow label={s.phase} value={`${proNum(result.phaseDeg, 4)}${s.unitDeg}`} />
          <ResultRow label={s.tanPhi} value={proNum(result.tanPhi, 6)} />
          <ResultRow label={s.phaseVoltage} value={proUnit(proNum(result.phaseVoltageV, 4), s.unitV)} />
          <ResultRow label={s.phaseCurrent} value={proUnit(proNum(result.phaseCurrentA, 5), s.unitA)} />
          <p className="nx-hint nx-hint--prose">{s.inductiveNote}</p>
          <p className="nx-hint nx-hint--prose">{s.balancedNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.system, value: system === "single" ? "1-fazno" : "3-fazno" },
              { label: voltageLabel, value: proUnit(proNum(proParse(lineVoltageV) ?? 0, 1), s.unitV) },
              { label: knownLabel, value: knownValue.trim() },
              { label: s.powerFactor, value: proNum(proParse(powerFactor) ?? 0, 3) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ========================================================================== *
 * Moment i snaga
 * ========================================================================== */

export function TorqueSpeedPowerTool() {
  const s = strings.pro.inzenjering["torque-speed-power"];
  const [torqueNm, setTorqueNm] = useState("");
  const [speedRpm, setSpeedRpm] = useState("");
  const [angularVelocityRadS, setAngularVelocityRadS] = useState("");
  const [powerW, setPowerW] = useState("");

  const parsedTorque = proParse(torqueNm);
  const parsedSpeed = proParse(speedRpm);
  const parsedOmega = proParse(angularVelocityRadS);
  const parsedPower = proParse(powerW);
  const typed =
    parsedTorque !== undefined || parsedSpeed !== undefined || parsedOmega !== undefined || parsedPower !== undefined;

  const result = torqueSpeedPower({
    torqueNm: parsedTorque,
    speedRpm: parsedSpeed,
    angularVelocityRadS: parsedOmega,
    powerW: parsedPower,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "speed"
        ? s.errorSpeed
        : result.reason === "torque"
          ? s.errorTorque
          : result.reason === "power"
            ? s.errorPower
            : s.errorPair;

  const copyText = !result.ok
    ? ""
    : [
        `${s.torque}: ${proUnit(proNum(result.torqueNm, 5), s.unitNm)} = ${proUnit(proNum(result.torqueKgfM, 5), s.unitKgfM)} = ${proUnit(proNum(result.torqueLbfFt, 5), s.unitLbfFt)}`,
        `${s.speed}: ${proUnit(proNum(result.speedRpm, 5), s.unitRpm)}`,
        `${s.angularVelocity}: ${proUnit(proNum(result.angularVelocityRadS, 5), s.unitRadS)}`,
        `${s.power}: ${proUnit(proNum(result.powerW, 5), s.unitW)} = ${proUnit(proNum(result.powerKw, 5), s.unitKw)} = ${proUnit(proNum(result.powerMetricHp, 5), s.unitKs)} = ${proUnit(proNum(result.powerMechanicalHp, 5), s.unitHp)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.torque} value={torqueNm} onChange={setTorqueNm} />
      <ToolInput label={s.speed} hint={s.speedOmegaHint} value={speedRpm} onChange={setSpeedRpm} />
      <ToolInput
        label={s.angularVelocity}
        hint={s.speedOmegaHint}
        value={angularVelocityRadS}
        onChange={setAngularVelocityRadS}
      />
      <ToolInput label={s.power} hint={s.pairHint} value={powerW} onChange={setPowerW} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.torque}
            value={`${proUnit(proNum(result.torqueNm, 5), s.unitNm)} = ${proUnit(proNum(result.torqueKgfM, 5), s.unitKgfM)} = ${proUnit(proNum(result.torqueLbfFt, 5), s.unitLbfFt)}`}
          />
          <ResultRow label={s.speed} value={proUnit(proNum(result.speedRpm, 5), s.unitRpm)} />
          <ResultRow label={s.angularVelocity} value={proUnit(proNum(result.angularVelocityRadS, 5), s.unitRadS)} />
          <ResultRow
            label={s.power}
            value={`${proUnit(proNum(result.powerW, 5), s.unitW)} = ${proUnit(proNum(result.powerKw, 5), s.unitKw)} = ${proUnit(proNum(result.powerMetricHp, 5), s.unitKs)} = ${proUnit(proNum(result.powerMechanicalHp, 5), s.unitHp)}`}
          />
          <p className="nx-hint nx-hint--prose">{s.hpNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.torque,
                value: parsedTorque === undefined ? s.computed : proUnit(proNum(parsedTorque, 5), s.unitNm),
              },
              {
                label: s.speed,
                value: parsedSpeed === undefined ? s.computed : proUnit(proNum(parsedSpeed, 5), s.unitRpm),
              },
              {
                label: s.angularVelocity,
                value: parsedOmega === undefined ? s.computed : proUnit(proNum(parsedOmega, 5), s.unitRadS),
              },
              {
                label: s.power,
                value: parsedPower === undefined ? s.computed : proUnit(proNum(parsedPower, 5), s.unitW),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const INZENJERING_SURFACES: Readonly<Record<string, ComponentType>> = {
  "awg-to-mm2": AwgConverterTool,
  "battery-bank-runtime": BatteryBankRuntimeTool,
  "belt-and-gear-drive": BeltAndGearDriveTool,
  "cable-cross-section": CableCrossSectionTool,
  "induction-motor-rating": InductionMotorTool,
  "junction-temperature": JunctionTemperatureTool,
  "metric-thread-strength": MetricThreadTool,
  "ohms-law-power": OhmsLawTool,
  "pipe-flow-velocity": PipeFlowTool,
  "power-factor-correction": PowerFactorCorrectionTool,
  "pressure-and-piston-force": PressurePistonForceTool,
  "resistor-colour-code": ResistorColourCodeTool,
  "rlc-impedance": RlcImpedanceTool,
  "section-modulus": SectionModulusTool,
  "series-parallel-network": SeriesParallelNetworkTool,
  "three-phase-power": ThreePhasePowerTool,
  "torque-speed-power": TorqueSpeedPowerTool,
};
