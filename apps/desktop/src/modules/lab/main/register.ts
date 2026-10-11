import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_LAB_APPEND_BATCH,
  MAX_LAB_BATTERY_WH,
  MAX_LAB_DEVICES,
  MAX_LAB_DEVICE_NAME_LENGTH,
  MAX_LAB_DEVICE_WATTS,
  MAX_LAB_LOG_NAME_LENGTH,
  LabStore,
} from "@nexus/db";
import {
  MAX_SENSOR_COLUMNS,
  type BatteryReport,
  formatSensorCsv,
  parseSensorLine,
  sensorColumnName,
} from "@nexus/core";
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import type {
  LabBatteryView,
  LabLogView,
  LabOffGridView,
  LabSampleView,
  LabSamplesView,
  LabView,
} from "../shared/ipc.js";
import { contract } from "../shared/ipc.js";
import { readBatteryReport, type BatteryReadResult } from "./batteryReport.js";
import { LAB_DIALOG_COPY, dialogText } from "./dialogCopy.js";
import { buildLabExport, parseLabExport } from "./imex.js";
import { clearDeviceLocation, deviceLocation, setDeviceLocation } from "./location.js";
import { saveTextFile } from "./saveFile.js";

/**
 * THE LAB in the main process (ADR-090): its handlers, the machine's own battery
 * report, the device-wide location, and its archive section.
 *
 * **What main is here for, and what it deliberately is not.** The page does the
 * work that belongs to a page — Web Serial, Web Audio, the lamp — and main does
 * the three things a renderer cannot: it answers the session's
 * `select-serial-port` (a dialog, in `serialPicker.ts`, wired at startup), it
 * runs `powercfg` and parses what Windows wrote (`batteryReport.ts`), and it
 * owns the database. There is no op for the sound or the light, because neither
 * has anything to store and nothing about either needs a second process.
 *
 * **Why the readings are parsed HERE rather than in the page.** `appendSamples`
 * takes the device's own LINES, and this file turns them into numbers with the
 * same `@nexus/core` function the page charts with. That is `SEC-EL-02`'s rule
 * in its concrete form: the renderer never hands main a value it computed and
 * asks main to store it, so a page that had been tampered with cannot write a
 * reading the device never printed — the line either parses or it is refused by
 * name.
 *
 * **Why the location is set from a validated pair and cleared at session end.**
 * A fix is a fact about the machine right now (`location.ts` argues it), so main
 * holds it and drops it when the session ends. The bounds are checked twice —
 * on the wire (`asCoordinate`) and in `setDeviceLocation` — because the second
 * check is the one that keeps the app's idea of where it is on the planet.
 *
 * **Why a read never touches the device.** `list` and `logSamples` read the
 * database and nothing else; the battery report is a SEPARATE op the page calls
 * once, when the user opens that card. A read with the side effect of running a
 * process would be a cost nobody could see from the call site, which is
 * `timers/register.ts`'s rule about arming applied to a spawn.
 */

/** Something that can open this module's store for a profile — the shape a handler's `ModuleCall` and a session both have. */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function labStore(bearer: StoreBearer, profileId: string): LabStore {
    return bearer.profileDb(profileId, (db, id) => new LabStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and
   * the wire's cannot drift apart field by field: a column renamed in a
   * migration is a compile error here rather than `undefined` in the renderer.
   */
  function viewOf(bearer: StoreBearer, profileId: string): LabView {
    const lab = labStore(bearer, profileId);
    const logs: LabLogView[] = lab.listLogs().map((log) => ({
      id: log.id,
      name: log.name,
      columns: log.columns,
      sampleCount: log.sampleCount,
      lastAt: log.lastAt,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    }));
    return { logs, offGrid: lab.offGrid(), location: deviceLocation() };
  }

  /**
   * The off-grid budget off the wire: an array of devices with three bounded
   * numbers each, checked here as well as in the store.
   *
   * The device list is the one shape this module takes that the shared `as*`
   * helpers cannot describe — they validate a field, and a list of objects is a
   * structure — so it is walked here, and every bound it is held to is the
   * STORE's constant rather than a number written twice.
   */
  function asDevices(value: unknown): { name: string; watts: number; hoursPerDay: number }[] {
    const list = asArray(value, "devices");
    if (list.length > MAX_LAB_DEVICES) {
      throw new Error(`Invalid IPC payload: "devices" may name at most ${MAX_LAB_DEVICES} devices.`);
    }
    return list.map((entry) => {
      const device = asPlainObject(entry, "devices[]");
      const name = typeof device["name"] === "string" ? device["name"].trim() : "";
      if (name.length === 0 || name.length > MAX_LAB_DEVICE_NAME_LENGTH) {
        throw new Error(
          `Invalid IPC payload: "devices[].name" must be 1..${MAX_LAB_DEVICE_NAME_LENGTH} characters.`,
        );
      }
      return {
        name,
        watts: asNumber(device["watts"], "devices[].watts", 0, MAX_LAB_DEVICE_WATTS, true),
        hoursPerDay: asNumber(device["hoursPerDay"], "devices[].hoursPerDay", 0, 24, true),
      };
    });
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("logSamples", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const logId = call.as.asId(payload.logId, "logId");
    const lab = labStore(call, profileId);
    const log = lab.log(logId);
    if (log === null) {
      // A log id this profile does not hold is a caller's bug rather than an
      // empty log, and saying so is the difference between „no readings yet" and
      // „the row you asked for is gone" — which the page renders differently.
      throw new Error(`Invalid IPC payload: no log "${logId}" in this profile.`);
    }
    const samples: LabSampleView[] = lab.readSamples(logId).map((sample) => ({
      at: sample.at,
      values: sample.values,
    }));
    return { logId, columns: log.columns, samples } satisfies LabSamplesView;
  });

  ctx.handle("createLog", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    labStore(call, profileId).createLog(
      { name: logName(call, payload.name), columns: asColumns(payload.columns) },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("appendSamples", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const logId = call.as.asId(payload.logId, "logId");
    const lab = labStore(call, profileId);
    const log = lab.log(logId);
    if (log === null) throw new Error(`Invalid IPC payload: no log "${logId}" in this profile.`);
    const lines = asArray(payload.lines, "lines");
    if (lines.length > MAX_LAB_APPEND_BATCH) {
      throw new Error(
        `Invalid IPC payload: "lines" may carry at most ${MAX_LAB_APPEND_BATCH} readings.`,
      );
    }
    const at = instant(call.now());
    const rows: { at: string; values: readonly number[] }[] = [];
    for (const line of lines) {
      if (typeof line !== "string" || line.length > 512) {
        throw new Error('Invalid IPC payload: "lines" must be strings of at most 512 characters.');
      }
      // The parser IS the validator here: a line that is not `columnCount`
      // finite numbers is refused by name rather than stored in a column the
      // device did not put it in.
      const values = parseSensorLine(line, log.columns.length);
      if (values === null) {
        throw new Error(
          `Invalid IPC payload: "${line}" is not ${log.columns.length} comma-separated numbers.`,
        );
      }
      rows.push({ at, values });
    }
    lab.appendSamples({ logId, rows }, at);
    return viewOf(call, profileId);
  });

  ctx.handle("removeLog", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    labStore(call, profileId).removeLog(call.as.asId(payload.logId, "logId"));
    return viewOf(call, profileId);
  });

  ctx.handle("exportLogCsv", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const logId = call.as.asId(payload.logId, "logId");
    const lab = labStore(call, profileId);
    const log = lab.log(logId);
    if (log === null) throw new Error(`Invalid IPC payload: no log "${logId}" in this profile.`);
    // The CSV is written from ONE log's every reading, in time order: this is
    // the export, so the retention window's whole content goes out rather than
    // the tail the page charts. The saver's own result IS the wire's shape, on
    // purpose: a second mapping of two identical objects would be one more place
    // for the two to disagree.
    return saveTextFile({
      title: dialogText(LAB_DIALOG_COPY.saveCsvTitle),
      defaultFileName: `${safeFileName(log.name)}.csv`,
      text: formatSensorCsv(
        log.columns,
        lab.readLogSamples(logId).map((sample) => ({ at: sample.at, values: sample.values })),
      ),
    });
  });

  ctx.handle("saveTerminalLog", async (payload, call) => {
    // The terminal's text is the user's own screen contents, so it is bounded
    // and written as it stands: no parsing, no reformatting, and no path — the
    // dialog is where a path comes from.
    const text = call.as.asCappedChars(payload.text, "text", 2_000_000);
    return saveTextFile({
      title: dialogText(LAB_DIALOG_COPY.saveLogTitle),
      defaultFileName: "terminal.log",
      text,
    });
  });

  ctx.handle("setOffGrid", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const offGrid: LabOffGridView = {
      devices: asDevices(payload.devices),
      batteryWh: asNumber(payload.batteryWh, "batteryWh", 0, MAX_LAB_BATTERY_WH, true),
      depthOfDischarge: asNumber(payload.depthOfDischarge, "depthOfDischarge", 0, 1, false),
      sunHours: asNumber(payload.sunHours, "sunHours", 0, 24, false),
    };
    labStore(call, profileId).setOffGrid(offGrid, instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("battery", async () => {
    const result = await readBatteryReport();
    return batteryView(result);
  });

  ctx.handle("setLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    setDeviceLocation({
      latitude: asCoordinate(payload.latitude, "latitude", 90),
      longitude: asCoordinate(payload.longitude, "longitude", 180),
      at: instant(call.now()),
    });
    // The location is device state rather than profile data, and the answer is
    // still the profile's view: every mutation answers with one shape, so the
    // page has exactly one way to update.
    return viewOf(call, profileId);
  });

  ctx.handle("clearLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    clearDeviceLocation();
    return viewOf(call, profileId);
  });

  // --- The session ----------------------------------------------------------

  ctx.onSessionEnd(() => {
    // A fix is about where the machine is NOW, and a locked or switched profile
    // is the moment the app stops being in a position to vouch for it
    // (`location.ts` carries the whole argument). The next session starts with
    // no location rather than with one from the previous morning.
    clearDeviceLocation();
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    const lab = labStore(session, profileId);
    const logs = lab.listLogs();
    const samples = lab.readAllSamples();
    return buildLabExport(
      logs.map((log) => ({
        name: log.name,
        columns: log.columns,
        samples: samples
          .filter((sample) => sample.logId === log.id)
          .map((sample) => ({ at: sample.at, values: sample.values })),
      })),
      lab.offGrid(),
    );
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload — the version first — and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseLabExport,
    // The writing half. `undefined` is an archive that says nothing about the
    // Lab, which for a restore that replaces a profile whole means empty: no
    // logs, and no budget row at all, so a restored profile answers „never
    // filled one in" rather than a set of zeroes nobody entered.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        labStore(session, profileId).replaceFromArchive(
          {
            logs: payload?.logs ?? [],
            offGrid: payload?.offGrid ?? null,
          },
          instant(session.now()),
        );
      }
    },
  });
}

/**
 * The battery read as the wire declares it: the status, and the report's four
 * facts only when there is one.
 *
 * The mapping is spelled out field by field rather than passed through, on this
 * file's own rule — a store's shape and the wire's must not be able to drift
 * apart silently, and a report field that stopped being read is a compile error
 * here rather than `undefined` on the page.
 */
function batteryView(result: BatteryReadResult): LabBatteryView {
  if (result.status !== "ok") return { status: result.status, report: null };
  const report: BatteryReport = result.report;
  return {
    status: "ok",
    report: {
      scannedAt: report.scannedAt,
      batteries: report.batteries.map((battery) => ({
        id: battery.id,
        designCapacityMWh: battery.designCapacityMWh,
        fullChargeCapacityMWh: battery.fullChargeCapacityMWh,
        cycleCount: battery.cycleCount,
      })),
      recentUsage: report.recentUsage.map((entry) => ({
        at: entry.at,
        ac: entry.ac,
        entryType: entry.entryType,
        dischargeMWh: entry.dischargeMWh,
        durationMs: entry.durationMs,
      })),
    },
  };
}

/**
 * The one profile a session is about, or `null` when it names none or several —
 * `timers/register.ts`'s rule, and the same reason: an archive is written one
 * profile at a time, and answering `null` rather than guessing keeps that true.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A log's name off the wire, at the store's own length. */
function logName(
  call: {
    readonly as: {
      asNonEmptyString(value: unknown, field: string): string;
      asCappedChars(value: unknown, field: string, max: number): string;
    };
  },
  value: unknown,
): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "name"),
    "name",
    MAX_LAB_LOG_NAME_LENGTH,
  );
}

/** The column names off the wire, by the same rule the header line and the store use. */
function asColumns(value: unknown): readonly string[] {
  const list = asArray(value, "columns");
  if (list.length === 0 || list.length > MAX_SENSOR_COLUMNS) {
    throw new Error(`Invalid IPC payload: "columns" must name 1..${MAX_SENSOR_COLUMNS} columns.`);
  }
  const columns = list.map((each) => {
    const name = sensorColumnName(each);
    if (name === null) {
      throw new Error(`Invalid IPC payload: "${String(each)}" is not a column name.`);
    }
    return name;
  });
  if (new Set(columns).size !== columns.length) {
    throw new Error('Invalid IPC payload: "columns" names one column twice.');
  }
  return columns;
}

/**
 * A finite number inside a range.
 *
 * The shared `as*` set has no float validator, deliberately: everything else in
 * this app is an integer, an id or a string, and the one place a fraction is
 * data — a watt, an hour, a depth of discharge — is here. So the check lives
 * beside the handlers that use it, which is where `ipcValidators.ts`'s own
 * header says a validator that knows what a field IS belongs.
 */
function asNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
  allowZero: boolean,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be a finite number.`);
  }
  if (value < min || (!allowZero && value <= min) || value > max) {
    throw new Error(`Invalid IPC payload: "${field}" must be in ${min}…${max}.`);
  }
  return value;
}

/** A coordinate: a finite number inside the planet's own bounds. */
function asCoordinate(value: unknown, field: string, limit: number): number {
  return asNumber(value, field, -limit, limit, true);
}

/** A payload field that must be an array, refused rather than defaulted to an empty one. */
function asArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an array.`);
  }
  return value;
}

/** A payload field that must be a plain object. */
function asPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** A log's name as a file name: a path separator in a suggested name would be a directory the dialog cannot open. */
function safeFileName(name: string): string {
  const cleaned = name.replaceAll(/[\\/:*?"<>|]/g, "-").trim();
  return cleaned === "" ? "lab-log" : cleaned.slice(0, 60);
}
