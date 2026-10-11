import {
  arraySizing,
  autonomyDays,
  batteryBankSizing,
  chargeControllerCurrent,
  deviceDailyEnergy,
  inverterSizing,
  type DeviceLoad,
} from "@nexus/core/pro/energija";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolTable,
  ToolTextArea,
  proRows,
  reasonField,
} from "./shared.js";

/**
 * „Energija — solarni i vanmrežni sistemi" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/energija.ts`'s. Nothing here divides,
 * rounds or compares an energy figure; this file shapes fields, hands the
 * numbers over and reads the answers onto the page.
 *
 * **No irradiance figure is drawn, and the field says where to get one.** The
 * peak sun hours are asked for rather than looked up, because a monthly average
 * for a place this app has never seen would be exactly the fabricated source
 * the drawer refuses; the hint names the local solar resource map the figure
 * comes from and stops there.
 *
 * **Every limit is a field.** The depth of discharge is a battery's own figure,
 * the derate is the installation's, and the controller margin is a convention —
 * so the screens draw quantities with the formula that produced them and never
 * a green light.
 */

/** Whether any of the given raw fields has something typed into it. */
function anyTyped(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/** A typed field as a number, or `NaN` when it is empty — the core refuses it by name. */
function num(text: string): number {
  return proParse(text) ?? Number.NaN;
}

/** A quantity with its unit, spaced the way SI spaces it. */
function amount(value: number, digits: number, unit: string): string {
  return proUnit(proNum(value, digits), unit);
}

/** One device per line, `name; watts; hours per day` — the drawer's rows convention. */
function parseDevices(text: string): readonly DeviceLoad[] {
  return proRows(text).map((cells) => ({
    name: cells[0] ?? "",
    watts: num(cells[1] ?? ""),
    hoursPerDay: num(cells[2] ?? ""),
  }));
}

export function DeviceDailyEnergyTool() {
  const s = strings.pro.energija["device-daily-energy"];
  const [devicesText, setDevicesText] = useState("");

  const typed = anyTyped(devicesText);
  const result = deviceDailyEnergy(parseDevices(devicesText));
  // The core names a bad ROW as „watts:3"; the surface only needs to know which
  // of its two messages fits, which is what `reasonField` strips the index for.
  const failure =
    result.ok || !typed
      ? undefined
      : reasonField(result.reason) === "devices"
        ? s.errorDevices
        : s.errorRow;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.name}: ${amount(row.watts, 1, s.unitW)} × ${amount(row.hoursPerDay, 2, s.unitH)}` +
            ` = ${amount(row.wattHoursPerDay, 1, s.unitWh)}`,
        ),
        `${s.outTotal}: ${amount(result.totalWattHoursPerDay, 1, s.unitWh)}`,
        `${s.outTotalKwh}: ${amount(result.totalKwhPerDay, 3, s.unitKwh)}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.devices}
        hint={s.devicesHint}
        value={devicesText}
        onChange={setDevicesText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.tableName, s.tableWatts, s.tableHours, s.tableWattHours]}
            rows={result.rows.map((row) => [
              row.name,
              amount(row.watts, 1, s.unitW),
              amount(row.hoursPerDay, 2, s.unitH),
              amount(row.wattHoursPerDay, 1, s.unitWh),
            ])}
            prose={[0]}
          />
          <ResultRow label={s.outTotal} value={amount(result.totalWattHoursPerDay, 1, s.unitWh)} />
          <ResultRow label={s.outTotalKwh} value={amount(result.totalKwhPerDay, 3, s.unitKwh)} />
          <ResultRow label={s.outConnected} value={amount(result.connectedWatts, 1, s.unitW)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function BatteryBankSizingTool() {
  const s = strings.pro.energija["battery-bank-sizing"];
  const [energyText, setEnergyText] = useState("");
  const [autonomyText, setAutonomyText] = useState("");
  const [depthText, setDepthText] = useState("");
  const [voltageText, setVoltageText] = useState("");

  const typed = anyTyped(energyText, autonomyText, depthText, voltageText);
  const result = batteryBankSizing({
    dailyEnergyWh: num(energyText),
    autonomyDays: num(autonomyText),
    depthOfDischargePct: num(depthText),
    systemVoltageV: num(voltageText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "dailyEnergy"
        ? s.errorDailyEnergy
        : result.reason === "autonomy"
          ? s.errorAutonomy
          : result.reason === "depthOfDischarge"
            ? s.errorDepthOfDischarge
            : s.errorVoltage;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outLoad}: ${amount(result.loadWh, 1, s.unitWh)}`,
        `${s.outRequiredWh}: ${amount(result.requiredWh, 1, s.unitWh)}`,
        `${s.outRequiredAh}: ${amount(result.requiredAh, 1, s.unitAh)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.dailyEnergy}
        hint={s.dailyEnergyHint}
        value={energyText}
        onChange={setEnergyText}
      />
      <ToolInput
        label={s.autonomy}
        hint={s.autonomyHint}
        value={autonomyText}
        onChange={setAutonomyText}
      />
      <ToolInput
        label={s.depthOfDischarge}
        hint={s.depthOfDischargeHint}
        value={depthText}
        onChange={setDepthText}
      />
      <ToolInput
        label={s.voltage}
        hint={s.voltageHint}
        value={voltageText}
        onChange={setVoltageText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outLoad} value={amount(result.loadWh, 1, s.unitWh)} />
          <ResultRow label={s.outRequiredWh} value={amount(result.requiredWh, 1, s.unitWh)} />
          <ResultRow label={s.outRequiredAh} value={amount(result.requiredAh, 1, s.unitAh)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.dailyEnergy, value: amount(num(energyText), 1, s.unitWh) },
              { label: s.autonomy, value: amount(num(autonomyText), 2, s.unitDays) },
              { label: s.depthOfDischarge, value: amount(num(depthText), 1, s.unitPercent) },
              { label: s.voltage, value: amount(num(voltageText), 1, s.unitV) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function ArraySizingTool() {
  const s = strings.pro.energija["array-sizing"];
  const [energyText, setEnergyText] = useState("");
  const [sunHoursText, setSunHoursText] = useState("");
  const [derateText, setDerateText] = useState("");
  const [panelText, setPanelText] = useState("");

  const typed = anyTyped(energyText, sunHoursText, derateText, panelText);
  const result = arraySizing({
    dailyEnergyWh: num(energyText),
    peakSunHours: num(sunHoursText),
    deratePct: num(derateText),
    panelWp: anyTyped(panelText) ? num(panelText) : undefined,
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "dailyEnergy"
        ? s.errorDailyEnergy
        : result.reason === "peakSunHours"
          ? s.errorPeakSunHours
          : result.reason === "derate"
            ? s.errorDerate
            : s.errorPanel;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outArray}: ${amount(result.arrayWp, 1, s.unitWp)}`,
        `${s.outDerate}: ${amount(result.derateUsed * 100, 1, s.unitPercent)}`,
        ...(result.panelCount === undefined
          ? []
          : [`${s.outPanels}: ${proNum(result.panelCount, 0)}`]),
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.dailyEnergy}
        hint={s.dailyEnergyHint}
        value={energyText}
        onChange={setEnergyText}
      />
      <ToolInput
        label={s.peakSunHours}
        hint={s.peakSunHoursHint}
        value={sunHoursText}
        onChange={setSunHoursText}
      />
      <ToolInput label={s.derate} hint={s.derateHint} value={derateText} onChange={setDerateText} />
      <ToolInput label={s.panelWp} hint={s.panelWpHint} value={panelText} onChange={setPanelText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outArray} value={amount(result.arrayWp, 1, s.unitWp)} />
          <ResultRow
            label={s.outDerate}
            value={amount(result.derateUsed * 100, 1, s.unitPercent)}
          />
          {result.panelCount !== undefined && (
            <ResultRow label={s.outPanels} value={proNum(result.panelCount, 0)} />
          )}
          {result.installedWp !== undefined && (
            <ResultRow label={s.outInstalled} value={amount(result.installedWp, 1, s.unitWp)} />
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.dailyEnergy, value: amount(num(energyText), 1, s.unitWh) },
              { label: s.peakSunHours, value: amount(num(sunHoursText), 2, s.unitH) },
              { label: s.derate, value: amount(num(derateText), 1, s.unitPercent) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function InverterSizingTool() {
  const s = strings.pro.energija["inverter-sizing"];
  const [continuousText, setContinuousText] = useState("");
  const [surgeText, setSurgeText] = useState("");
  const [powerFactorText, setPowerFactorText] = useState("");

  const typed = anyTyped(continuousText, surgeText, powerFactorText);
  const result = inverterSizing({
    continuousW: num(continuousText),
    surgeW: num(surgeText),
    powerFactor: num(powerFactorText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "continuous"
        ? s.errorContinuous
        : result.reason === "surge"
          ? s.errorSurge
          : s.errorPowerFactor;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outContinuousVa}: ${amount(result.continuousVa, 1, s.unitVa)}`,
        `${s.outSurgeVa}: ${amount(result.surgeVa, 1, s.unitVa)}`,
        `${s.outRatio}: ${proNum(result.surgeRatio, 3)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.continuous}
        hint={s.continuousHint}
        value={continuousText}
        onChange={setContinuousText}
      />
      <ToolInput label={s.surge} hint={s.surgeHint} value={surgeText} onChange={setSurgeText} />
      <ToolInput
        label={s.powerFactor}
        hint={s.powerFactorHint}
        value={powerFactorText}
        onChange={setPowerFactorText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outContinuousVa} value={amount(result.continuousVa, 1, s.unitVa)} />
          <ResultRow label={s.outSurgeVa} value={amount(result.surgeVa, 1, s.unitVa)} />
          <ResultRow label={s.outRatio} value={proNum(result.surgeRatio, 3)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.continuous, value: amount(num(continuousText), 1, s.unitW) },
              { label: s.surge, value: amount(num(surgeText), 1, s.unitW) },
              { label: s.powerFactor, value: proNum(num(powerFactorText), 3) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function ChargeControllerCurrentTool() {
  const s = strings.pro.energija["charge-controller-current"];
  const [arrayText, setArrayText] = useState("");
  const [voltageText, setVoltageText] = useState("");
  const [marginText, setMarginText] = useState("");

  const typed = anyTyped(arrayText, voltageText, marginText);
  const result = chargeControllerCurrent({
    arrayWp: num(arrayText),
    systemVoltageV: num(voltageText),
    marginPct: num(marginText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "array"
        ? s.errorArray
        : result.reason === "voltage"
          ? s.errorVoltage
          : s.errorMargin;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outCurrent}: ${amount(result.currentA, 2, s.unitA)}`,
        `${s.outWithMargin}: ${amount(result.currentWithMarginA, 2, s.unitA)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.arrayWp} hint={s.arrayWpHint} value={arrayText} onChange={setArrayText} />
      <ToolInput
        label={s.voltage}
        hint={s.voltageHint}
        value={voltageText}
        onChange={setVoltageText}
      />
      <ToolInput label={s.margin} hint={s.marginHint} value={marginText} onChange={setMarginText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outCurrent} value={amount(result.currentA, 2, s.unitA)} />
          <ResultRow
            label={s.outWithMargin}
            value={amount(result.currentWithMarginA, 2, s.unitA)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.arrayWp, value: amount(num(arrayText), 1, s.unitWp) },
              { label: s.voltage, value: amount(num(voltageText), 1, s.unitV) },
              { label: s.margin, value: amount(num(marginText), 1, s.unitPercent) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function AutonomyDaysTool() {
  const s = strings.pro.energija["autonomy-days"];
  const [capacityText, setCapacityText] = useState("");
  const [voltageText, setVoltageText] = useState("");
  const [depthText, setDepthText] = useState("");
  const [energyText, setEnergyText] = useState("");

  const typed = anyTyped(capacityText, voltageText, depthText, energyText);
  const result = autonomyDays({
    bankAh: num(capacityText),
    systemVoltageV: num(voltageText),
    depthOfDischargePct: num(depthText),
    dailyEnergyWh: num(energyText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "capacity"
        ? s.errorCapacity
        : result.reason === "voltage"
          ? s.errorVoltage
          : result.reason === "depthOfDischarge"
            ? s.errorDepthOfDischarge
            : s.errorDailyEnergy;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outUsable}: ${amount(result.usableWh, 1, s.unitWh)}`,
        `${s.outDays}: ${amount(result.days, 3, s.unitDays)}`,
        `${s.outWholeDays}: ${proNum(result.wholeDays, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.capacity}
        hint={s.capacityHint}
        value={capacityText}
        onChange={setCapacityText}
      />
      <ToolInput
        label={s.voltage}
        hint={s.voltageHint}
        value={voltageText}
        onChange={setVoltageText}
      />
      <ToolInput
        label={s.depthOfDischarge}
        hint={s.depthOfDischargeHint}
        value={depthText}
        onChange={setDepthText}
      />
      <ToolInput
        label={s.dailyEnergy}
        hint={s.dailyEnergyHint}
        value={energyText}
        onChange={setEnergyText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outUsable} value={amount(result.usableWh, 1, s.unitWh)} />
          <ResultRow label={s.outDays} value={amount(result.days, 3, s.unitDays)} />
          <ResultRow label={s.outWholeDays} value={proNum(result.wholeDays, 0)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.capacity, value: amount(num(capacityText), 1, s.unitAh) },
              { label: s.voltage, value: amount(num(voltageText), 1, s.unitV) },
              { label: s.depthOfDischarge, value: amount(num(depthText), 1, s.unitPercent) },
              { label: s.dailyEnergy, value: amount(num(energyText), 1, s.unitWh) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const ENERGIJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "array-sizing": ArraySizingTool,
  "autonomy-days": AutonomyDaysTool,
  "battery-bank-sizing": BatteryBankSizingTool,
  "charge-controller-current": ChargeControllerCurrentTool,
  "device-daily-energy": DeviceDailyEnergyTool,
  "inverter-sizing": InverterSizingTool,
};
