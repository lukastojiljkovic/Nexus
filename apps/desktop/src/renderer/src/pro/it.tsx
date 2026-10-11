import {
  convertRate,
  normaliseMac,
  raidCapacity,
  transferTime,
  uptimeDowntime,
  vlsmSplit,
  type DataUnit,
  type DiskSizeUnit,
  type RaidLevel,
  type RateUnit,
  type UptimeMode,
} from "@nexus/core/pro/it";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
  reasonField,
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
 * „IT" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/it.ts`'s. This file parses fields with
 * `proParse`, hands the numbers to the core function and prints what comes back.
 *
 * **The decimal and binary unit names are copy in both directions.** Every size
 * and rate row prints the unit the tool actually used (`MB` or `MiB`, `Mbit/s`
 * or `MiB/s`), because a table that wrote a bare „MB" for a binary figure is the
 * 4 % dispute this toolkit exists to make visible.
 */

/** The rate units in the order the table prints them: decimal bit, decimal byte, binary byte. */
const RATE_UNIT_IDS: readonly RateUnit[] = [
  "bitPerSecond",
  "kbitPerSecond",
  "MbitPerSecond",
  "GbitPerSecond",
  "bytePerSecond",
  "kBPerSecond",
  "MBPerSecond",
  "GBPerSecond",
  "KiBPerSecond",
  "MiBPerSecond",
  "GiBPerSecond",
];

/** The size units in the order the select offers them: bits, decimal bytes, binary bytes. */
const DATA_UNIT_IDS: readonly DataUnit[] = [
  "bit",
  "kbit",
  "Mbit",
  "Gbit",
  "Tbit",
  "B",
  "kB",
  "MB",
  "GB",
  "TB",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
];

/* -------------------------------------------------------------------------- */
/* transfer-time                                                                */
/* -------------------------------------------------------------------------- */

export function TransferTimeTool() {
  const s = strings.pro.it["transfer-time"];
  const [sizeText, setSizeText] = useState("");
  const [sizeUnit, setSizeUnit] = useState<DataUnit>("GB");
  const [rateText, setRateText] = useState("");
  const [rateUnit, setRateUnit] = useState<RateUnit>("MbitPerSecond");
  const [overheadText, setOverheadText] = useState("");

  const typed = sizeText.trim() !== "" || rateText.trim() !== "";
  const result = transferTime({
    size: proParse(sizeText) ?? Number.NaN,
    sizeUnit,
    rate: proParse(rateText) ?? Number.NaN,
    rateUnit,
    overheadPercent: proParse(overheadText),
  });

  const sizeUnitLabel = (unit: DataUnit): string => strings.pro.it.units.data[unit];
  const rateUnitLabel = (unit: RateUnit): string => strings.pro.it.units.rate[unit];

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "size"
        ? s.errorSize
        : field === "rate"
          ? s.errorRate
          : s.errorOverhead;

  const durationLabel = !result.ok
    ? ""
    : [
        result.days > 0 ? `${proNum(result.days, 0)} ${s.unitDays}` : undefined,
        result.hours > 0 ? `${proNum(result.hours, 0)} ${s.unitHours}` : undefined,
        result.minutes > 0 ? `${proNum(result.minutes, 0)} ${s.unitMinutes}` : undefined,
        `${proNum(result.seconds, 3)} ${s.unitSeconds}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join(" ");

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalTime}: ${durationLabel}`,
        `${s.totalSeconds}: ${proUnit(proNum(result.totalSeconds, 3), s.unitSeconds)}`,
        `${s.effectiveBytes}: ${proUnit(proNum(result.effectiveBytes, 0), s.unitB)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.size} value={sizeText} onChange={setSizeText} />
      <ToolSelect<DataUnit>
        label={s.sizeUnit}
        value={sizeUnit}
        onChange={setSizeUnit}
        options={DATA_UNIT_IDS.map((id) => ({ id, label: sizeUnitLabel(id) }))}
      />
      <ToolInput label={s.rate} value={rateText} onChange={setRateText} />
      <ToolSelect<RateUnit>
        label={s.rateUnit}
        value={rateUnit}
        onChange={setRateUnit}
        options={RATE_UNIT_IDS.map((id) => ({ id, label: rateUnitLabel(id) }))}
      />
      <ToolInput label={s.overhead} hint={s.overheadHint} value={overheadText} onChange={setOverheadText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalTime} value={durationLabel} />
          <ResultRow label={s.totalSeconds} value={proUnit(proNum(result.totalSeconds, 3), s.unitSeconds)} />
          <ResultRow
            label={s.effectiveBytes}
            value={proUnit(proNum(result.effectiveBytes, 0), s.unitB)}
          />
          <ResultRow label={s.overheadUsed} value={`${proNum(result.overheadPercentUsed, 1)}%`} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.sizeUnit, value: sizeUnitLabel(sizeUnit) },
              { label: s.rateUnit, value: rateUnitLabel(rateUnit) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* transfer-rate                                                                */
/* -------------------------------------------------------------------------- */

export function TransferRateTool() {
  const s = strings.pro.it["transfer-rate"];
  const [valueText, setValueText] = useState("");
  const [unit, setUnit] = useState<RateUnit>("MbitPerSecond");

  const typed = valueText.trim() !== "";
  const result = convertRate({ value: proParse(valueText) ?? Number.NaN, unit });

  const unitLabel = (id: RateUnit): string => strings.pro.it.units.rate[id];

  const rows = result.ok
    ? RATE_UNIT_IDS.map((id) => [unitLabel(id), proNum(result.perUnit[id], 6)] as const)
    : [];

  return (
    <>
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolSelect<RateUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={RATE_UNIT_IDS.map((id) => ({ id, label: unitLabel(id) }))}
      />
      <p className="nx-hint nx-hint--prose">{s.binaryNote}</p>

      {!result.ok && typed && <ToolFailure>{s.errorValue}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ToolTable head={[s.colUnit, s.colValue]} rows={rows} prose={[0]} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.unit, value: unitLabel(unit) }]} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* raid-capacity                                                                */
/* -------------------------------------------------------------------------- */

const RAID_LEVEL_IDS: readonly RaidLevel[] = ["0", "1", "5", "6", "10"];
const DISK_SIZE_UNIT_IDS: readonly DiskSizeUnit[] = ["GB", "TB", "TiB"];

export function RaidCapacityTool() {
  const s = strings.pro.it["raid-capacity"];
  const [level, setLevel] = useState<RaidLevel>("5");
  const [countText, setCountText] = useState("");
  const [sizeText, setSizeText] = useState("");
  const [sizeUnit, setSizeUnit] = useState<DiskSizeUnit>("TB");
  const [sparesText, setSparesText] = useState("");
  const [rebuildText, setRebuildText] = useState("");

  const typed = countText.trim() !== "" || sizeText.trim() !== "";
  const result = raidCapacity({
    level,
    diskCount: proParse(countText) ?? Number.NaN,
    diskSize: proParse(sizeText) ?? Number.NaN,
    diskSizeUnit: sizeUnit,
    hotSpares: proParse(sparesText),
    rebuildRateMbps: proParse(rebuildText),
  });

  const sizeUnitLabel = (id: DiskSizeUnit): string => strings.pro.it.units.diskSize[id];

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "diskCount"
        ? s.errorCount
        : field === "diskCountEven"
          ? s.errorCountEven
          : field === "diskCountTwo"
            ? s.errorCountTwo
            : field === "diskSize"
              ? s.errorSize
              : field === "hotSpares"
                ? s.errorSpares
                : field === "rebuildRate"
                  ? s.errorRebuild
                  : s.errorSize;

  const levelLabel = (id: RaidLevel): string =>
    id === "0"
      ? s.level0
      : id === "1"
        ? s.level1
        : id === "5"
          ? s.level5
          : id === "6"
            ? s.level6
            : s.level10;

  const copyText = !result.ok
    ? ""
    : [
        `${s.usableBytes}: ${proUnit(proNum(result.usableBytes, 0), s.unitB)}`,
        `${s.efficiency}: ${proNum(result.efficiencyPercent, 2)}%`,
        `${s.toleratedFailures}: ${proNum(result.toleratedFailures, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<RaidLevel>
        label={s.level}
        value={level}
        onChange={setLevel}
        options={RAID_LEVEL_IDS.map((id) => ({ id, label: levelLabel(id) }))}
      />
      <ToolInput label={s.diskCount} hint={s.diskCountHint} value={countText} onChange={setCountText} />
      <ToolInput label={s.diskSize} value={sizeText} onChange={setSizeText} />
      <ToolSelect<DiskSizeUnit>
        label={s.diskSizeUnit}
        value={sizeUnit}
        onChange={setSizeUnit}
        options={DISK_SIZE_UNIT_IDS.map((id) => ({ id, label: sizeUnitLabel(id) }))}
      />
      <ToolInput label={s.hotSpares} hint={s.hotSparesHint} value={sparesText} onChange={setSparesText} />
      <ToolInput label={s.rebuildRate} hint={s.rebuildRateHint} value={rebuildText} onChange={setRebuildText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.rawBytes} value={proUnit(proNum(result.rawBytes, 0), s.unitB)} />
          <ResultRow label={s.usableBytes} value={proUnit(proNum(result.usableBytes, 0), s.unitB)} />
          <ResultRow label={s.usableTiB} value={proUnit(proNum(result.usableTiB, 3), s.unitTiB)} />
          <ResultRow label={s.efficiency} value={`${proNum(result.efficiencyPercent, 2)}%`} />
          <ResultRow label={s.toleratedFailures} value={proNum(result.toleratedFailures, 0)} />
          <ResultRow label={s.redundancyDisks} value={proNum(result.redundancyDisks, 0)} />
          <ResultRow label={s.dataDisks} value={proNum(result.dataDisks, 0)} />
          <ResultRow label={s.hotSparesOut} value={proNum(result.hotSpares, 0)} />
          {result.rebuildHours !== undefined && (
            <ResultRow label={s.rebuildTime} value={proUnit(proNum(result.rebuildHours, 2), s.unitHours)} />
          )}
          <p className="nx-hint nx-hint--prose">{s.capacityNote}</p>
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.level, value: levelLabel(level) },
              { label: s.diskSizeUnit, value: sizeUnitLabel(sizeUnit) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* uptime-downtime                                                              */
/* -------------------------------------------------------------------------- */

const UPTIME_MODES: readonly UptimeMode[] = ["fromUptime", "fromMonthlyDowntime"];

export function UptimeDowntimeTool() {
  const s = strings.pro.it["uptime-downtime"];
  const [mode, setMode] = useState<UptimeMode>("fromUptime");
  const [uptimeText, setUptimeText] = useState("");
  const [downtimeText, setDowntimeText] = useState("");

  const typed = uptimeText.trim() !== "" || downtimeText.trim() !== "";
  const result = uptimeDowntime({
    mode,
    uptimePercent: mode === "fromUptime" ? proParse(uptimeText) : undefined,
    monthlyDowntimeMinutes: mode === "fromMonthlyDowntime" ? proParse(downtimeText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "uptime"
        ? s.errorUptime
        : field === "uptimeHundred"
          ? s.errorUptimeHundred
          : s.errorDowntime;

  const modeLabel = (id: UptimeMode): string =>
    id === "fromUptime" ? s.modeFromUptime : s.modeFromDowntime;

  const copyText = !result.ok
    ? ""
    : [
        `${s.uptime}: ${proNum(result.uptimePercent, 5)}%`,
        `${s.nines}: ${proNum(result.nines, 3)}`,
        `${s.perMonth}: ${proUnit(proNum(result.downtimeMinutesPerMonth, 3), s.unitMinutes)}`,
        `${s.perYear}: ${proUnit(proNum(result.downtimeMinutesPerYear, 3), s.unitMinutes)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<UptimeMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={UPTIME_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      {mode === "fromUptime" && (
        <ToolInput label={s.uptime} value={uptimeText} onChange={setUptimeText} />
      )}
      {mode === "fromMonthlyDowntime" && (
        <ToolInput label={s.monthlyDowntime} value={downtimeText} onChange={setDowntimeText} />
      )}
      <p className="nx-hint nx-hint--prose">{s.periodNote}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.uptime} value={`${proNum(result.uptimePercent, 5)}%`} />
          <ResultRow label={s.unavailable} value={`${proNum(result.unavailablePercent, 5)}%`} />
          <ResultRow label={s.nines} value={proNum(result.nines, 3)} />
          <ResultRow label={s.perDay} value={proUnit(proNum(result.downtimeMinutesPerDay, 3), s.unitMinutes)} />
          <ResultRow label={s.perWeek} value={proUnit(proNum(result.downtimeMinutesPerWeek, 3), s.unitMinutes)} />
          <ResultRow label={s.perMonth} value={proUnit(proNum(result.downtimeMinutesPerMonth, 3), s.unitMinutes)} />
          <ResultRow label={s.perYear} value={proUnit(proNum(result.downtimeMinutesPerYear, 3), s.unitMinutes)} />
          <ResultRow label={s.perMonthSeconds} value={proUnit(proNum(result.downtimeSecondsPerMonth, 3), s.unitSeconds)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.mode, value: modeLabel(mode) }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* vlsm-split                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The host counts a user typed, one per subnet.
 *
 * Exported and tested for the reason `pro/kuhinja.tsx` exports its four word
 * parsers: the hint above the field NAMES the separators (a comma, a semicolon or
 * a space), so the parser has to accept exactly those — and a hint that promises
 * a separator the parser does not read is a field that silently drops a subnet.
 *
 * **The comma is a separator here and not a decimal mark, and that is a decision
 * worth stating because the app writes decimals with a comma.** It is safe
 * because the field takes WHOLE numbers: a comma can never be part of a legal
 * value, so its only possible job is to separate two — and „2,0" therefore reads
 * as two counts, the second of which the core refuses by name. The hint says so
 * out loud, because a rule the user has to guess is the defect this house treats
 * as a defect.
 *
 * An unreadable part becomes `NaN` and the core refuses the whole list by name
 * rather than allocating a subnet of size zero.
 */
export function hostCountsFromText(text: string): readonly number[] {
  return text
    .split(/[\s,;]+/)
    .filter((part) => part !== "")
    .map((part) => proParse(part) ?? Number.NaN);
}

export function VlsmSplitTool() {
  const s = strings.pro.it["vlsm-split"];
  const [address, setAddress] = useState("");
  const [prefixText, setPrefixText] = useState("");
  const [countsText, setCountsText] = useState("");

  const hostCounts = hostCountsFromText(countsText);
  const typed = address.trim() !== "" || countsText.trim() !== "";
  const result = vlsmSplit({
    baseAddress: address,
    prefix: proParse(prefixText) ?? Number.NaN,
    hostCounts,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "baseAddress"
        ? s.errorAddress
        : field === "prefix"
          ? s.errorPrefix
          : field === "doesNotFit"
            ? s.errorDoesNotFit
            : s.errorCounts;

  const copyText = !result.ok
    ? ""
    : result.blocks
        .map(
          (block) =>
            `${block.network}/${block.prefix}  ${block.firstHost}–${block.lastHost}  (${proNum(block.hostCount, 0)} ${s.unitHosts})`,
        )
        .join("\n");

  return (
    <>
      <ToolInput label={s.baseAddress} hint={s.baseAddressHint} value={address} onChange={setAddress} mono />
      <ToolInput label={s.prefix} value={prefixText} onChange={setPrefixText} />
      <ToolInput label={s.hostCounts} hint={s.hostCountsHint} value={countsText} onChange={setCountsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.baseNetwork} value={`${result.baseNetwork}/${proNum(proParse(prefixText) ?? 0, 0)}`} />
          <ResultRow label={s.baseBroadcast} value={result.baseBroadcast} />
          <ToolTable
            head={[s.colRequested, s.colPrefix, s.colNetwork, s.colFirst, s.colLast, s.colBroadcast, s.colUsable]}
            rows={result.blocks.map((block) => [
              proNum(block.hostCount, 0),
              `/${proNum(block.prefix, 0)}`,
              block.network,
              block.firstHost,
              block.lastHost,
              block.broadcast,
              proNum(block.usableHosts, 0),
            ])}
          />
          <ResultRow label={s.totalRequested} value={proNum(result.totalRequestedHosts, 0)} />
          <ResultRow label={s.totalAllocated} value={proNum(result.totalAllocatedHosts, 0)} />
          <ResultRow label={s.freeAddresses} value={proNum(result.freeAddresses, 0)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* mac-normalise                                                                */
/* -------------------------------------------------------------------------- */

export function MacNormaliseTool() {
  const s = strings.pro.it["mac-normalise"];
  const [address, setAddress] = useState("");

  const typed = address.trim() !== "";
  const result = normaliseMac({ address });

  const copyText = !result.ok
    ? ""
    : [
        `${s.colon}: ${result.colon}`,
        `${s.dash}: ${result.dash}`,
        `${s.dotted}: ${result.dotted}`,
        `${s.bare}: ${result.bare}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.address} hint={s.addressHint} value={address} onChange={setAddress} mono />

      {!result.ok && typed && <ToolFailure>{s.errorAddress}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.colon} value={result.colon} />
          <ResultRow label={s.dash} value={result.dash} />
          <ResultRow label={s.dotted} value={result.dotted} />
          <ResultRow label={s.bare} value={result.bare} />
          <ResultRow label={s.oui} value={result.oui} />
          <ResultRow label={s.groupBit} value={result.multicast ? s.multicast : s.unicast} />
          <ResultRow
            label={s.adminBit}
            value={result.locallyAdministered ? s.locallyAdministered : s.globallyAdministered}
          />
          <ToolFormula>{s.formulaLine}</ToolFormula>
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
export const IT_SURFACES: Readonly<Record<string, ComponentType>> = {
  "transfer-time": TransferTimeTool,
  "transfer-rate": TransferRateTool,
  "raid-capacity": RaidCapacityTool,
  "uptime-downtime": UptimeDowntimeTool,
  "vlsm-split": VlsmSplitTool,
  "mac-normalise": MacNormaliseTool,
};
