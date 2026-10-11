import { useCallback, useEffect, useState } from "react";
import { Button, Card, Icon, ListRow, TextField } from "@nexus/ui";
import {
  batteryHealth,
  daysOfPower,
  deviceWhPerDay,
  requiredCapacityWh,
  requiredPanelWatts,
  usableWh,
  whPerDay,
} from "@nexus/core";
import { activeLocale } from "../../../renderer/src/strings.js";
import type { LabBatteryView, LabDeviceView, LabView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { LabFigure } from "./parts.js";
import type { LabRun } from "./Page.js";
import { formatDurationMs, formatInstant, formatMeasure, formatPercent } from "./reading.js";

/**
 * The battery card: Windows' own report, the live reading Chromium offers, and
 * the off-grid budget.
 *
 * **Why the report is a button rather than something the page reads on mount.**
 * Reading it runs `powercfg` and writes a file — a process, on a page that was
 * merely opened. So it happens when the user asks, and the page says where the
 * numbers came from: the design capacity, the full-charge capacity and the cycle
 * count are the battery's OWN report, and „health" here is that one ratio and
 * nothing more. It is not a diagnosis, and the card says so in one line.
 *
 * **Why the off-grid budget is this module's arithmetic rather than a tool.** It
 * is five lines of arithmetic over a list the user types — device × hours, summed
 * over a day, divided into a pack's usable capacity — and `@nexus/core` owns it,
 * so the page draws a figure and the tests pin the same function. The depth of
 * discharge, the sun hours and the charge efficiency are INPUTS rather than
 * constants this file chose: a pack's chemistry and a roof's latitude are not
 * things an app can know, and a default would be a number nobody could check.
 */

/** The charge efficiency the panel figure assumes — stated on screen, never silently. */
const CHARGE_EFFICIENCY = 0.8;

export function BatteryCard({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: LabView;
  run: LabRun;
}) {
  const [report, setReport] = useState<LabBatteryView | null>(null);
  const [reading, setReading] = useState(false);
  const [live, setLive] = useState<{ level: number; charging: boolean } | null>(null);
  const [liveUnsupported, setLiveUnsupported] = useState(false);

  /** The live reading Chromium offers where it has one; nothing here is stored or sent anywhere. */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const manager = await navigator.getBattery();
        if (!active) return;
        const update = (): void => setLive({ level: manager.level, charging: manager.charging });
        update();
        manager.addEventListener("levelchange", update);
        manager.addEventListener("chargingchange", update);
      } catch {
        if (active) setLiveUnsupported(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const readReport = useCallback(async () => {
    setReading(true);
    try {
      setReport(await window.nexus.modules.lab.battery({}));
    } catch (failure) {
      setReport({ status: "unavailable", report: null });
      console.error("Nexus: the battery report could not be read:", failure);
    } finally {
      setReading(false);
    }
  }, []);

  const pack = report?.report?.batteries[0] ?? null;
  // The ratio comes from `@nexus/core`, which is where the rule is tested —
  // a second division here would be the same arithmetic with a second chance to
  // disagree about what „health" means when the pack reports nothing.
  const health =
    pack === null
      ? null
      : batteryHealth({
          id: pack.id,
          designCapacityMWh: pack.designCapacityMWh,
          fullChargeCapacityMWh: pack.fullChargeCapacityMWh,
          cycleCount: pack.cycleCount,
        });

  return (
    <Card className="lab__card" title={copy.battery.title}>
      <div className="lab__row">
        <Button size="sm" variant="primary" onClick={() => void readReport()} disabled={reading}>
          {copy.battery.read}
        </Button>
        {live !== null && (
          <span className="nx-hint">
            {`${copy.battery.live} ${formatPercent(live.level, activeLocale())} · ${
              live.charging ? copy.battery.charging : copy.battery.onBattery
            }`}
          </span>
        )}
        {liveUnsupported && <span className="nx-hint">{copy.battery.liveUnsupported}</span>}
      </div>
      {report !== null && (
        <div className="lab__panel">
          {report.status === "timeout" && <p className="nx-hint">{copy.battery.timeout}</p>}
          {report.status === "unavailable" && <p className="nx-hint">{copy.battery.unavailable}</p>}
          {report.status === "ok" && pack === null && <p className="nx-hint">{copy.battery.none}</p>}
          {report.status === "ok" && pack !== null && (
            <>
              <div className="lab__figures">
                <LabFigure
                  label={copy.battery.design}
                  value={
                    pack.designCapacityMWh === null
                      ? "—"
                      : `${formatMeasure(pack.designCapacityMWh, 0, activeLocale())} mWh`
                  }
                />
                <LabFigure
                  label={copy.battery.full}
                  value={
                    pack.fullChargeCapacityMWh === null
                      ? "—"
                      : `${formatMeasure(pack.fullChargeCapacityMWh, 0, activeLocale())} mWh`
                  }
                />
                <LabFigure
                  label={copy.battery.health}
                  value={health === null ? "—" : formatPercent(health, activeLocale())}
                />
                <LabFigure
                  label={copy.battery.cycles}
                  value={pack.cycleCount === null ? "—" : String(pack.cycleCount)}
                />
                {report.report !== null && report.report.scannedAt !== null && (
                  <LabFigure
                    label={copy.battery.scanned}
                    value={formatInstant(report.report.scannedAt, activeLocale())}
                  />
                )}
              </div>
              {/* The one line that keeps „health" honest: the ratio is the
                  battery's own report of itself, not a measurement this app made. */}
              <p className="nx-hint">{copy.battery.healthNote}</p>
              {report.report !== null && report.report.recentUsage.length > 0 && (
                <div className="lab__list">
                  <div className="nx-eyebrow">{copy.battery.usageTitle}</div>
                  {report.report.recentUsage.slice(-8).map((entry, index) => (
                    <ListRow key={`${entry.at ?? "unknown"}-${String(index)}`} leading={<Icon name="clock" />}>
                      <span className="lab__log-meta">
                        {entry.at === null ? "—" : formatInstant(entry.at, activeLocale())}
                        {` · ${entry.ac === true ? copy.battery.onMains : copy.battery.onBattery}`}
                        {entry.durationMs === null
                          ? ""
                          : ` · ${formatDurationMs(entry.durationMs, activeLocale())}`}
                      </span>
                    </ListRow>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <OffGridForm profileId={profileId} offGrid={view.offGrid} run={run} />
    </Card>
  );
}

/** The off-grid budget: the devices, the three numbers, and the arithmetic `@nexus/core` owns. */
function OffGridForm({
  profileId,
  offGrid,
  run,
}: {
  profileId: string;
  offGrid: LabView["offGrid"];
  run: LabRun;
}) {
  const [devices, setDevices] = useState<readonly LabDeviceView[]>(offGrid?.devices ?? []);
  const [batteryWh, setBatteryWh] = useState(offGrid === null ? "" : String(offGrid.batteryWh));
  const [depth, setDepth] = useState(offGrid === null ? "0.5" : String(offGrid.depthOfDischarge));
  const [sun, setSun] = useState(offGrid === null ? "4" : String(offGrid.sunHours));
  const [days, setDays] = useState("3");
  const [draft, setDraft] = useState({ name: "", watts: "", hours: "" });
  const [saved, setSaved] = useState(false);

  const battery = Number(batteryWh);
  const depthOfDischarge = Number(depth);
  const sunHours = Number(sun);
  const reserveDays = Number(days);
  const daily = whPerDay(devices);
  const usable = Number.isFinite(battery) && Number.isFinite(depthOfDischarge)
    ? usableWh(battery, depthOfDischarge)
    : 0;
  const lasts = daysOfPower(usable, daily);
  const bank =
    Number.isFinite(reserveDays) && depthOfDischarge > 0
      ? requiredCapacityWh(daily, reserveDays, depthOfDischarge)
      : null;
  const panel = sunHours > 0 ? requiredPanelWatts(daily, sunHours, CHARGE_EFFICIENCY) : null;

  return (
    <div className="lab__panel">
      <div className="nx-eyebrow">{copy.offgrid.title}</div>
      {devices.length === 0 ? (
        <p className="nx-hint">{copy.offgrid.empty}</p>
      ) : (
        <div className="lab__list">
          {devices.map((device, index) => (
            <ListRow
              key={`${device.name}-${String(index)}`}
              leading={<Icon name="flame" />}
              trailing={
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`${copy.offgrid.remove} ${device.name}`}
                  onClick={() => setDevices(devices.filter((_, at) => at !== index))}
                >
                  {copy.offgrid.remove}
                </Button>
              }
            >
              <span className="lab__log-meta">
                {`${device.name} — ${formatMeasure(deviceWhPerDay(device), 1, activeLocale())} Wh`}
              </span>
            </ListRow>
          ))}
        </div>
      )}
      <div className="lab__row">
        <TextField
          label={copy.offgrid.deviceName}
          value={draft.name}
          maxLength={60}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <TextField
          label={copy.offgrid.deviceWatts}
          inputMode="decimal"
          value={draft.watts}
          onChange={(event) => setDraft({ ...draft, watts: event.target.value })}
        />
        <TextField
          label={copy.offgrid.deviceHours}
          inputMode="decimal"
          value={draft.hours}
          onChange={(event) => setDraft({ ...draft, hours: event.target.value })}
        />
        <Button
          size="sm"
          onClick={() => {
            const watts = Number(draft.watts);
            const hours = Number(draft.hours);
            if (draft.name.trim() === "" || !Number.isFinite(watts) || !Number.isFinite(hours)) {
              return;
            }
            setDevices([...devices, { name: draft.name.trim(), watts, hoursPerDay: hours }]);
            setDraft({ name: "", watts: "", hours: "" });
          }}
        >
          {copy.offgrid.addDevice}
        </Button>
      </div>
      <div className="lab__row">
        <TextField
          label={copy.offgrid.batteryWh}
          inputMode="decimal"
          value={batteryWh}
          onChange={(event) => setBatteryWh(event.target.value)}
        />
        <TextField
          label={copy.offgrid.depth}
          inputMode="decimal"
          value={depth}
          onChange={(event) => setDepth(event.target.value)}
        />
        <TextField
          label={copy.offgrid.sun}
          inputMode="decimal"
          value={sun}
          onChange={(event) => setSun(event.target.value)}
        />
        <TextField
          label={copy.offgrid.days}
          inputMode="numeric"
          value={days}
          onChange={(event) => setDays(event.target.value)}
        />
      </div>
      <div className="lab__figures">
        <LabFigure label={copy.offgrid.perDay} value={`${formatMeasure(daily, 1, activeLocale())} Wh`} />
        <LabFigure
          label={copy.offgrid.lasts}
          value={
            lasts === null
              ? "—"
              : `${formatMeasure(lasts, 2, activeLocale())} ${copy.offgrid.daysUnit}`
          }
        />
        <LabFigure
          label={copy.offgrid.bank}
          value={bank === null ? "—" : `${formatMeasure(bank, 0, activeLocale())} Wh`}
        />
        <LabFigure
          label={copy.offgrid.panel}
          value={panel === null ? "—" : `${formatMeasure(panel, 0, activeLocale())} W`}
        />
      </div>
      {/* The efficiency is an input, not a constant in the arithmetic, so the
          page states which value the panel figure used. */}
      <p className="nx-hint">{`${copy.offgrid.panelNote} ${formatPercent(CHARGE_EFFICIENCY, activeLocale())}.`}</p>
      <div className="lab__row">
        <Button
          size="sm"
          variant="primary"
          disabled={
            devices.length === 0 ||
            !Number.isFinite(battery) ||
            depthOfDischarge <= 0 ||
            depthOfDischarge > 1 ||
            sunHours <= 0 ||
            sunHours > 24
          }
          onClick={() => {
            void (async () => {
              await run((lab) =>
                lab.setOffGrid({
                  profileId,
                  devices: [...devices],
                  batteryWh: battery,
                  depthOfDischarge,
                  sunHours,
                }),
              );
              setSaved(true);
            })();
          }}
        >
          {copy.offgrid.save}
        </Button>
        {saved && <span className="nx-hint">{copy.offgrid.saved}</span>}
      </div>
    </div>
  );
}
