import {
  LAB_EXPORT_VERSION,
  MAX_LAB_BATTERY_WH,
  MAX_LAB_DEVICES,
  MAX_LAB_DEVICE_NAME_LENGTH,
  MAX_LAB_DEVICE_WATTS,
  MAX_LAB_LOGS,
  MAX_LAB_LOG_NAME_LENGTH,
  MAX_LAB_SAMPLES,
} from "@nexus/db";

/**
 * The LAB's archive payload (ADR-090 §imex): what this module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it enforces
 * are the STORE's — `MAX_LAB_LOGS`, `MAX_LAB_SAMPLES` and the name length come
 * from `@nexus/db`, which no file under `shared/` may import (it is SQLite and
 * therefore Node-only, and the renderer shares that folder). A second copy of 24
 * and 5000 up there would be two numbers that agree until one moves, which is
 * `main/imex.ts`'s arrangement one module over.
 *
 * **What the payload carries, and why all of it.** A log is a name, its columns
 * and its readings, and a reading is only meaningful inside the log whose header
 * named its columns — so the three travel together or not at all, which is also
 * why the payload is a nested array rather than a flat list of rows keyed by
 * log. The off-grid budget travels with them because it is the same kind of fact:
 * something the user typed, which a restore has to put back.
 *
 * **Why the readings are capped at the module's own window.** `MAX_LAB_SAMPLES`
 * is what a log keeps while it runs, and an archive that carried more would be
 * an archive no store would take back — so a file claiming ten thousand readings
 * for one log is refused by name rather than imported in part. The version is
 * checked first for the reason `Timers`' is: a payload written by a later build
 * of this module must be refused by name rather than half-read.
 */

/** One reading as the archive carries it. */
export interface LabSampleExport {
  at: string;
  values: number[];
}

/** One log: what it is called, its columns, and every reading it holds. */
export interface LabLogExport {
  name: string;
  columns: string[];
  samples: LabSampleExport[];
}

/** One device of the off-grid list. */
export interface LabDeviceExport {
  name: string;
  watts: number;
  hoursPerDay: number;
}

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface LabExport {
  version: number;
  logs: LabLogExport[];
  offGrid: {
    devices: LabDeviceExport[];
    batteryWh: number;
    depthOfDischarge: number;
    sunHours: number;
  } | null;
}

/** What `exportData` is handed: the module's own rows, already read from the store. */
export function buildLabExport(
  logs: readonly { name: string; columns: readonly string[]; samples: readonly { at: string; values: readonly number[] }[] }[],
  offGrid: {
    devices: readonly LabDeviceExport[];
    batteryWh: number;
    depthOfDischarge: number;
    sunHours: number;
  } | null,
): LabExport {
  return {
    version: LAB_EXPORT_VERSION,
    logs: logs.map((log) => ({
      name: log.name,
      columns: [...log.columns],
      samples: log.samples.map((sample) => ({ at: sample.at, values: [...sample.values] })),
    })),
    offGrid:
      offGrid === null
        ? null
        : {
            devices: offGrid.devices.map((device) => ({ ...device })),
            batteryWh: offGrid.batteryWh,
            depthOfDischarge: offGrid.depthOfDischarge,
            sunHours: offGrid.sunHours,
          },
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * at the preview (so the refusal reaches the user before they confirm a restore
 * that replaces their profile) and again before any module writes, and it must
 * write nothing itself. So it has no early return and no partial result: it
 * either answers a fully validated, normalised payload or it throws, and every
 * message names the field that is wrong — a half-validated payload that failed
 * on its four-hundredth reading would leave a profile holding a fragment.
 */
export function parseLabExport(value: unknown): LabExport {
  const record = asRecord(value, "payload");
  if (record.version !== LAB_EXPORT_VERSION) {
    throw new Error(
      `Lab data was written by another version of this module (found ${String(record.version)}, expected ${LAB_EXPORT_VERSION}).`,
    );
  }
  const rawLogs = record.logs;
  if (!Array.isArray(rawLogs)) throw new Error('Lab data: "logs" must be an array.');
  if (rawLogs.length > MAX_LAB_LOGS) {
    throw new Error(`Lab data: at most ${MAX_LAB_LOGS} logs may be restored.`);
  }
  const logs: LabLogExport[] = [];
  const names = new Set<string>();
  for (const entry of rawLogs) {
    const log = asRecord(entry, "logs[]");
    const name = asName(log.name);
    if (names.has(name)) throw new Error(`Lab data: two logs are named "${name}".`);
    names.add(name);
    const columns = asColumns(log.columns);
    const rawSamples = log.samples;
    if (!Array.isArray(rawSamples)) {
      throw new Error(`Lab data: "logs[].samples" must be an array (log "${name}").`);
    }
    if (rawSamples.length > MAX_LAB_SAMPLES) {
      throw new Error(
        `Lab data: a log may carry at most ${MAX_LAB_SAMPLES} readings (log "${name}").`,
      );
    }
    const samples: LabSampleExport[] = rawSamples.map((sample) => {
      const row = asRecord(sample, "logs[].samples[]");
      if (typeof row.at !== "string" || row.at.trim() === "") {
        throw new Error('Lab data: "logs[].samples[].at" must be a non-empty string.');
      }
      const values = row.values;
      if (!Array.isArray(values) || values.length !== columns.length) {
        throw new Error(
          `Lab data: a reading must carry ${columns.length} values (log "${name}").`,
        );
      }
      return {
        at: row.at,
        values: values.map((each) => {
          if (typeof each !== "number" || !Number.isFinite(each)) {
            throw new Error('Lab data: "logs[].samples[].values" must be finite numbers.');
          }
          return each;
        }),
      };
    });
    logs.push({ name, columns, samples });
  }

  const rawOffGrid = record.offGrid;
  if (rawOffGrid === null || rawOffGrid === undefined) {
    return { version: LAB_EXPORT_VERSION, logs, offGrid: null };
  }
  const offGrid = asRecord(rawOffGrid, "offGrid");
  const rawDevices = offGrid.devices;
  if (!Array.isArray(rawDevices)) throw new Error('Lab data: "offGrid.devices" must be an array.');
  if (rawDevices.length > MAX_LAB_DEVICES) {
    throw new Error(`Lab data: at most ${MAX_LAB_DEVICES} devices may be listed.`);
  }
  const devices: LabDeviceExport[] = rawDevices.map((device) => {
    const row = asRecord(device, "offGrid.devices[]");
    return {
      name: asDeviceName(row.name),
      watts: asNumber(row.watts, "offGrid.devices[].watts", 0, MAX_LAB_DEVICE_WATTS, true),
      hoursPerDay: asNumber(row.hoursPerDay, "offGrid.devices[].hoursPerDay", 0, 24, true),
    };
  });
  return {
    version: LAB_EXPORT_VERSION,
    logs,
    offGrid: {
      devices,
      batteryWh: asNumber(offGrid.batteryWh, "offGrid.batteryWh", 0, MAX_LAB_BATTERY_WH, true),
      depthOfDischarge: asNumber(offGrid.depthOfDischarge, "offGrid.depthOfDischarge", 0, 1, false),
      sunHours: asNumber(offGrid.sunHours, "offGrid.sunHours", 0, 24, false),
    },
  };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Lab data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** A log's name: the store's own bound, applied before the store ever sees it. */
function asName(value: unknown): string {
  if (typeof value !== "string") throw new Error('Lab data: "logs[].name" must be a string.');
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_LAB_LOG_NAME_LENGTH) {
    throw new Error(`Lab data: a log name must be 1..${MAX_LAB_LOG_NAME_LENGTH} characters.`);
  }
  return name;
}

/**
 * The column names of one log.
 *
 * The shape is checked here — non-empty strings, no duplicates — and the NAMES
 * are checked by the store, on the same rule the header line and the wire are
 * checked by (`@nexus/core`'s `sensorColumnName`). This file does not repeat
 * that rule: it is the store's `validColumns` that refuses `23.5` as a name, and
 * a second reading of the rule here would be a second thing to keep in step.
 */
function asColumns(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Lab data: "logs[].columns" must be a non-empty array.');
  }
  const columns = value.map((each) => {
    if (typeof each !== "string") {
      throw new Error('Lab data: "logs[].columns" must be strings.');
    }
    return each;
  });
  return columns;
}

/** A device's name, trimmed, at the store's own length. */
function asDeviceName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error('Lab data: "offGrid.devices[].name" must be a string.');
  }
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_LAB_DEVICE_NAME_LENGTH) {
    throw new Error(
      `Lab data: a device name must be 1..${MAX_LAB_DEVICE_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

/** A number inside a range, optionally refusing the range's own lower end. */
function asNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
  allowZero: boolean,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Lab data: "${field}" must be a finite number.`);
  }
  if (value < min || (!allowZero && value <= min) || value > max) {
    throw new Error(`Lab data: "${field}" is outside ${min}..${max}.`);
  }
  return value;
}
