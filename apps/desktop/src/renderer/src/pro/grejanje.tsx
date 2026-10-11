import {
  heatingCost,
  pipePressureDrop,
  powerUnits,
  radiatorOutput,
  roomHeatLoss,
  waterHeater,
  type EnvelopeSurface,
  type FlowUnit,
  type FuelRow,
  type PowerUnit,
} from "@nexus/core/pro/grejanje";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  proRows,
  reasonField,
  ResultRow,
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
 * „Grejanje i vodovod" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/grejanje.ts`'s. This file parses fields
 * with `proParse`, hands the numbers over and prints what comes back — nothing
 * here divides, rounds or compares.
 *
 * **No surface states a verdict.** The u-values, the air-change rate and the
 * radiator's exponent are the user's own figures, echoed back beside the
 * answer; `heating-cost` puts several fuels' costs side by side and names the
 * lowest, which is a comparison of the user's own prices and not advice about
 * what to install.
 */

/* -------------------------------------------------------------------------- */
/* room-heat-loss                                                             */
/* -------------------------------------------------------------------------- */

export function RoomHeatLossTool() {
  const s = strings.pro.grejanje["room-heat-loss"];
  const [temperatureText, setTemperatureText] = useState("");
  const [surfacesText, setSurfacesText] = useState("");
  const [bridgeText, setBridgeText] = useState("");
  const [basis, setBasis] = useState<"airChanges" | "perArea">("airChanges");
  const [airChangesText, setAirChangesText] = useState("");
  const [volumeText, setVolumeText] = useState("");
  const [airFlowText, setAirFlowText] = useState("");
  const [floorAreaText, setFloorAreaText] = useState("");

  const rows = proRows(surfacesText);
  const surfaces: EnvelopeSurface[] = rows.map((cells) => ({
    area: proParse(cells[0] ?? "") ?? Number.NaN,
    uValue: proParse(cells[1] ?? "") ?? Number.NaN,
  }));

  const result = roomHeatLoss({
    temperatureDifference: proParse(temperatureText) ?? Number.NaN,
    surfaces,
    thermalBridgeCoefficient: proParse(bridgeText),
    airChangesPerHour: basis === "airChanges" ? proParse(airChangesText) : undefined,
    volume: basis === "airChanges" ? proParse(volumeText) : undefined,
    airFlowPerArea: basis === "perArea" ? proParse(airFlowText) : undefined,
    floorArea: basis === "perArea" ? proParse(floorAreaText) : undefined,
  });

  const typed =
    proParse(temperatureText) !== undefined ||
    rows.length > 0 ||
    proParse(airChangesText) !== undefined ||
    proParse(airFlowText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    temperatureDifference: s.errorTemperature,
    surfaces: s.errorSurfaces,
    thermalBridgeCoefficient: s.errorBridge,
    ventilation: s.errorVentilation,
    airChangesPerHour: s.errorAirChanges,
    volume: s.errorVolume,
    airFlowPerArea: s.errorAirFlow,
    floorArea: s.errorFloorArea,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput
        label={s.temperature}
        hint={s.temperatureHint}
        value={temperatureText}
        onChange={setTemperatureText}
      />
      <ToolTextArea
        label={s.surfaces}
        hint={s.surfacesHint}
        value={surfacesText}
        onChange={setSurfacesText}
        placeholder={"20; 0,3"}
        rows={5}
      />
      <ToolInput label={s.bridge} hint={s.bridgeHint} value={bridgeText} onChange={setBridgeText} />
      <ToolSelect<"airChanges" | "perArea">
        label={s.ventilation}
        value={basis}
        onChange={setBasis}
        options={[
          { id: "airChanges", label: s.ventilationAirChanges },
          { id: "perArea", label: s.ventilationPerArea },
        ]}
      />
      {basis === "airChanges" ? (
        <>
          <ToolInput
            label={s.airChanges}
            hint={s.airChangesHint}
            value={airChangesText}
            onChange={setAirChangesText}
          />
          <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />
        </>
      ) : (
        <>
          <ToolInput label={s.airFlow} hint={s.airFlowHint} value={airFlowText} onChange={setAirFlowText} />
          <ToolInput
            label={s.floorArea}
            hint={s.floorAreaHint}
            value={floorAreaText}
            onChange={setFloorAreaText}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow
              label={s.transmissionCoefficient}
              value={proUnit(proNum(result.transmissionCoefficient, 2), s.unitWK)}
            />
            <ResultRow
              label={s.ventilationCoefficient}
              value={proUnit(proNum(result.ventilationCoefficient, 2), s.unitWK)}
            />
            <ResultRow
              label={s.transmissionLoss}
              value={proUnit(proNum(result.transmissionLoss, 0), s.unitW)}
            />
            <ResultRow
              label={s.ventilationLoss}
              value={proUnit(proNum(result.ventilationLoss, 0), s.unitW)}
            />
            <ResultRow label={s.totalLoss} value={proUnit(proNum(result.totalLoss, 0), s.unitW)} />
            {result.lossPerFloorArea !== undefined && (
              <ResultRow
                label={s.lossPerArea}
                value={proUnit(proNum(result.lossPerFloorArea, 1), s.unitWPerM2)}
              />
            )}
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.temperature,
                value: proUnit(proNum(proParse(temperatureText) ?? 0, 1), s.unitK),
              },
              {
                label: s.bridge,
                value: proUnit(proNum(proParse(bridgeText) ?? 0, 2), s.unitWK),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* radiator-output                                                            */
/* -------------------------------------------------------------------------- */

export function RadiatorOutputTool() {
  const s = strings.pro.grejanje["radiator-output"];
  const [nominalText, setNominalText] = useState("");
  const [exponentText, setExponentText] = useState("");
  const [mode, setMode] = useState<"temperatures" | "spread">("temperatures");
  const [flowText, setFlowText] = useState("");
  const [backText, setBackText] = useState("");
  const [roomText, setRoomText] = useState("");
  const [spreadText, setSpreadText] = useState("");
  const [nominalSpreadText, setNominalSpreadText] = useState("");
  const [requiredText, setRequiredText] = useState("");

  const result = radiatorOutput({
    nominalOutput: proParse(nominalText) ?? Number.NaN,
    exponent: proParse(exponentText) ?? Number.NaN,
    flowTemperature: mode === "temperatures" ? proParse(flowText) : undefined,
    returnTemperature: mode === "temperatures" ? proParse(backText) : undefined,
    roomTemperature: mode === "temperatures" ? proParse(roomText) : undefined,
    spread: mode === "spread" ? proParse(spreadText) : undefined,
    nominalSpread: proParse(nominalSpreadText),
    requiredOutput: proParse(requiredText),
  });

  const typed = proParse(nominalText) !== undefined || proParse(exponentText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    nominalOutput: s.errorNominal,
    exponent: s.errorExponent,
    flowTemperature: s.errorTemperatures,
    spread: mode === "spread" ? s.errorSpreadValue : s.errorSpread,
    nominalSpread: s.errorNominalSpread,
    requiredOutput: s.errorRequired,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput
        label={s.nominalOutput}
        hint={s.nominalOutputHint}
        value={nominalText}
        onChange={setNominalText}
      />
      <ToolInput label={s.exponent} hint={s.exponentHint} value={exponentText} onChange={setExponentText} />
      <ToolSelect<"temperatures" | "spread">
        label={s.temperatureMode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "temperatures", label: s.modeTemperatures },
          { id: "spread", label: s.modeSpread },
        ]}
      />
      {mode === "temperatures" ? (
        <>
          <ToolInput label={s.flow} value={flowText} onChange={setFlowText} />
          <ToolInput label={s.back} value={backText} onChange={setBackText} />
          <ToolInput label={s.room} value={roomText} onChange={setRoomText} />
        </>
      ) : (
        <ToolInput label={s.spread} hint={s.spreadHint} value={spreadText} onChange={setSpreadText} />
      )}
      <ToolInput
        label={s.nominalSpread}
        hint={s.nominalSpreadHint}
        value={nominalSpreadText}
        onChange={setNominalSpreadText}
      />
      <ToolInput
        label={s.requiredOutput}
        hint={s.requiredOutputHint}
        value={requiredText}
        onChange={setRequiredText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.spreadUsed} value={proUnit(proNum(result.spreadUsed, 1), s.unitK)} />
            <ResultRow label={s.output} value={proUnit(proNum(result.output, 0), s.unitW)} />
            {result.requiredSpread !== undefined && (
              <ResultRow
                label={s.neededSpread}
                value={proUnit(proNum(result.requiredSpread, 1), s.unitK)}
              />
            )}
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.nominalOutput,
                value: proUnit(proNum(proParse(nominalText) ?? 0, 0), s.unitW),
              },
              { label: s.exponent, value: proNum(proParse(exponentText) ?? 0, 3) },
              {
                label: s.nominalSpread,
                value: proUnit(proNum(proParse(nominalSpreadText) ?? 50, 1), s.unitK),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* water-heater-time                                                          */
/* -------------------------------------------------------------------------- */

export function WaterHeaterTool() {
  const s = strings.pro.grejanje["water-heater-time"];
  const [volumeText, setVolumeText] = useState("");
  const [initialText, setInitialText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [powerText, setPowerText] = useState("");
  const [lossText, setLossText] = useState("");

  const result = waterHeater({
    volume: proParse(volumeText) ?? Number.NaN,
    initialTemperature: proParse(initialText) ?? Number.NaN,
    targetTemperature: proParse(targetText) ?? Number.NaN,
    power: proParse(powerText) ?? Number.NaN,
    lossPercent: proParse(lossText),
  });

  const typed = proParse(volumeText) !== undefined || proParse(powerText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    volume: s.errorVolume,
    initialTemperature: s.errorInitial,
    targetTemperature: s.errorTarget,
    power: s.errorPower,
    lossPercent: s.errorLoss,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />
      <ToolInput label={s.initial} value={initialText} onChange={setInitialText} />
      <ToolInput label={s.target} value={targetText} onChange={setTargetText} />
      <ToolInput label={s.power} hint={s.powerHint} value={powerText} onChange={setPowerText} />
      <ToolInput label={s.loss} hint={s.lossHint} value={lossText} onChange={setLossText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.rise} value={proUnit(proNum(result.temperatureRise, 1), s.unitK)} />
            <ResultRow label={s.mass} value={proUnit(proNum(result.mass, 1), s.unitKg)} />
            <ResultRow label={s.energy} value={proUnit(proNum(result.energyKwh, 3), s.unitKwh)} />
            <ResultRow
              label={s.timeSeconds}
              value={proUnit(proNum(result.timeSeconds, 0), s.unitSeconds)}
            />
            <ResultRow
              label={s.timeMinutes}
              value={proUnit(proNum(result.timeMinutes, 1), s.unitMinutes)}
            />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.volume, value: proUnit(proNum(proParse(volumeText) ?? 0, 1), s.unitL) },
              {
                label: s.initial,
                value: proUnit(proNum(proParse(initialText) ?? 0, 1), s.unitC),
              },
              { label: s.target, value: proUnit(proNum(proParse(targetText) ?? 0, 1), s.unitC) },
              { label: s.power, value: proUnit(proNum(proParse(powerText) ?? 0, 0), s.unitW) },
              { label: s.loss, value: proUnit(proNum(proParse(lossText) ?? 0, 1), s.unitPercent) },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* pipe-pressure-drop                                                         */
/* -------------------------------------------------------------------------- */

const FLOW_UNITS: readonly { readonly id: FlowUnit; readonly label: string }[] = [
  { id: "l/s", label: "l/s" },
  { id: "l/min", label: "l/min" },
  { id: "m3/h", label: "m³/h" },
  { id: "m3/s", label: "m³/s" },
];

export function PipePressureDropTool() {
  const s = strings.pro.grejanje["pipe-pressure-drop"];
  const [diameterText, setDiameterText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [known, setKnown] = useState<"flow" | "velocity">("flow");
  const [flowText, setFlowText] = useState("");
  const [flowUnit, setFlowUnit] = useState<FlowUnit>("l/s");
  const [velocityText, setVelocityText] = useState("");
  const [roughnessText, setRoughnessText] = useState("");
  const [viscosityText, setViscosityText] = useState("");
  const [densityText, setDensityText] = useState("");
  const [fittingsText, setFittingsText] = useState("");

  const flowValue = proParse(flowText);
  const result = pipePressureDrop({
    innerDiameterMm: proParse(diameterText) ?? Number.NaN,
    lengthM: proParse(lengthText) ?? Number.NaN,
    flow: known === "flow" && flowValue !== undefined ? { value: flowValue, unit: flowUnit } : undefined,
    velocityMs: known === "velocity" ? proParse(velocityText) : undefined,
    roughnessMm: proParse(roughnessText) ?? Number.NaN,
    kinematicViscosityMm2S: proParse(viscosityText) ?? Number.NaN,
    densityKgM3: proParse(densityText) ?? Number.NaN,
    fittingsEquivalentLengthM: proParse(fittingsText),
  });

  const typed =
    proParse(diameterText) !== undefined ||
    proParse(lengthText) !== undefined ||
    flowValue !== undefined;
  const errors: Readonly<Record<string, string>> = {
    innerDiameterMm: s.errorDiameter,
    lengthM: s.errorLength,
    known: s.errorKnown,
    flow: s.errorFlow,
    velocity: s.errorVelocity,
    roughnessMm: s.errorRoughness,
    kinematicViscosityMm2S: s.errorViscosity,
    densityKgM3: s.errorDensity,
    fittingsEquivalentLengthM: s.errorFittings,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];
  const regimeLabel =
    result.ok && result.regime === "laminar"
      ? s.regimeLaminar
      : result.ok && result.regime === "transitional"
        ? s.regimeTransitional
        : s.regimeTurbulent;

  return (
    <>
      <ToolInput label={s.diameter} hint={s.diameterHint} value={diameterText} onChange={setDiameterText} />
      <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />
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
          <ToolInput label={s.flow} hint={s.flowHint} value={flowText} onChange={setFlowText} />
          <ToolSelect<FlowUnit>
            label={s.flow}
            value={flowUnit}
            onChange={setFlowUnit}
            options={FLOW_UNITS}
          />
        </>
      ) : (
        <ToolInput label={s.velocity} hint={s.velocityHint} value={velocityText} onChange={setVelocityText} />
      )}
      <ToolInput
        label={s.roughness}
        hint={s.roughnessHint}
        value={roughnessText}
        onChange={setRoughnessText}
      />
      <ToolInput label={s.viscosity} hint={s.viscosityHint} value={viscosityText} onChange={setViscosityText} />
      <ToolInput label={s.density} hint={s.densityHint} value={densityText} onChange={setDensityText} />
      <ToolInput label={s.fittings} hint={s.fittingsHint} value={fittingsText} onChange={setFittingsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.velocity} value={proUnit(proNum(result.velocityMs, 4), s.unitMs)} />
            <ResultRow label={s.reynolds} value={proNum(result.reynolds, 0)} />
            <ResultRow label={s.regime} value={regimeLabel} mono={false} />
            <ResultRow label={s.friction} value={proNum(result.frictionFactor, 5)} />
            <ResultRow label={s.totalLength} value={proUnit(proNum(result.totalLengthM, 2), s.unitM)} />
            <ResultRow label={s.headLoss} value={proUnit(proNum(result.headLossM, 4), s.unitM)} />
            <ResultRow label={s.pressureDrop} value={proUnit(proNum(result.pressureDropKpa, 3), s.unitKpa)} />
            <ResultRow label={s.pressureDrop} value={proUnit(proNum(result.pressureDropBar, 4), s.unitBar)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.diameter,
                value: proUnit(proNum(proParse(diameterText) ?? 0, 1), s.unitMm),
              },
              { label: s.length, value: proUnit(proNum(proParse(lengthText) ?? 0, 2), s.unitM) },
              {
                label: s.roughness,
                value: proUnit(proNum(proParse(roughnessText) ?? 0, 4), s.unitMm),
              },
              {
                label: s.viscosity,
                value: proUnit(proNum(proParse(viscosityText) ?? 0, 3), s.unitMm2S),
              },
              {
                label: s.density,
                value: proUnit(proNum(proParse(densityText) ?? 0, 1), s.unitKgM3),
              },
              {
                label: s.pressureDrop,
                value: proUnit(proNum(result.pressureDropPa, 0), s.unitPa),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* power-units                                                                */
/* -------------------------------------------------------------------------- */

const POWER_UNITS: readonly { readonly id: PowerUnit; readonly key: string }[] = [
  { id: "w", key: "unitW" },
  { id: "kw", key: "unitKw" },
  { id: "btuPerHour", key: "unitBtu" },
  { id: "kcalPerHour", key: "unitKcal" },
];

export function PowerUnitsTool() {
  const s = strings.pro.grejanje["power-units"];
  const [valueText, setValueText] = useState("");
  const [unit, setUnit] = useState<PowerUnit>("kw");
  const result = powerUnits({ value: proParse(valueText) ?? Number.NaN, unit });
  const typed = proParse(valueText) !== undefined;

  return (
    <>
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolSelect<PowerUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={POWER_UNITS.map((entry) => ({
          id: entry.id,
          label: s[entry.key as "unitW" | "unitKw" | "unitBtu" | "unitKcal"],
        }))}
      />

      {typed && !result.ok && result.reason === "value" && <ToolFailure>{s.errorValue}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.watts} value={proUnit(proNum(result.watts, 2), "W")} />
            <ResultRow label={s.kilowatts} value={proUnit(proNum(result.kilowatts, 4), "kW")} />
            <ResultRow label={s.btuPerHour} value={proNum(result.btuPerHour, 2)} />
            <ResultRow label={s.kcalPerHour} value={proNum(result.kcalPerHour, 2)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* heating-cost                                                               */
/* -------------------------------------------------------------------------- */

export function HeatingCostTool() {
  const s = strings.pro.grejanje["heating-cost"];
  const [fuelsText, setFuelsText] = useState("");

  const rows = proRows(fuelsText);
  const fuels: FuelRow[] = rows.map((cells) => ({
    name: cells[0] ?? "",
    pricePerUnit: proParse(cells[1] ?? "") ?? Number.NaN,
    energyPerUnit: proParse(cells[2] ?? "") ?? Number.NaN,
    efficiency: proParse(cells[3] ?? "") ?? Number.NaN,
  }));
  const result = heatingCost({ fuels });
  const failure = result.ok || rows.length === 0 ? undefined : s.errorFuels;

  return (
    <>
      <ToolTextArea
        label={s.fuels}
        hint={s.fuelsHint}
        value={fuelsText}
        onChange={setFuelsText}
        placeholder={"Gas; 50; 9,97; 0,9"}
        rows={5}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            {result.cheapestIndex !== undefined && (
              <ResultRow
                label={s.cheapest}
                mono={false}
                value={result.fuels[result.cheapestIndex]?.name ?? ""}
              />
            )}
            <ToolTable
              head={[s.colFuel, s.colDelivered, s.colUseful]}
              prose={[0]}
              rows={result.fuels.map((fuel) => [
                fuel.name,
                proUnit(proNum(fuel.costPerDeliveredKwh, 4), s.unitCurrency),
                proUnit(proNum(fuel.costPerUsefulKwh, 4), s.unitCurrency),
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
export const GREJANJE_SURFACES: Readonly<Record<string, ComponentType>> = {
  "room-heat-loss": RoomHeatLossTool,
  "radiator-output": RadiatorOutputTool,
  "water-heater-time": WaterHeaterTool,
  "pipe-pressure-drop": PipePressureDropTool,
  "power-units": PowerUnitsTool,
  "heating-cost": HeatingCostTool,
};
