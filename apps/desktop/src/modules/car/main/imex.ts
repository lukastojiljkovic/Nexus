import {
  DEFAULT_DUE_SOON_DAYS,
  DEFAULT_DUE_SOON_DISTANCE,
  MAX_DUE_SOON_DAYS,
  MAX_INTERVAL_KM,
  type CarExport,
  type CarSettings,
} from "@nexus/db";

/**
 * CAR's archive payload (ADR-090's imex arm): what this module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it
 * enforces are the STORE's, imported from `@nexus/db`, which no file under
 * `shared/` may reach. A second copy of 365 and 1 000 000 up there would be two
 * numbers that agree until one moves.
 *
 * **Why the payload IS the store's own export, with one field beside it.** The
 * seven collections are exactly `CarStore.exportData`'s value -- the module
 * does not re-shape a single row, so a column added to a car table reaches the
 * archive by being added to the store's mapping and nowhere else. The `settings`
 * field is the module's ONE preference, which is not content and therefore not
 * part of that value: `CarSettings` says why, and `apply` says where it lands.
 *
 * **Why `version` is checked and the rows are not, here.** `importData` hands
 * the whole value to `CarStore.importData`, which validates EVERY row -- ids,
 * enums, every number, every date, every reference between rows, and the one
 * rule a single row cannot state -- before it writes anything, inside the host's
 * one restore transaction. Re-checking a row here would be a second definition
 * of what a car archive is, and the two would drift. What this half owns is what
 * the store cannot see: the payload's own shape, its version, and the preference
 * that rides beside the content.
 */

/** The schema of the payload `exportData` writes. A new shape is a new number, never a quiet reinterpretation. */
export const CAR_EXPORT_VERSION = 1;

/**
 * The whole payload: the store's export, plus the store's own settings type.
 *
 * The preference is `CarSettings` rather than a shape declared here, because it
 * IS the store's row: `buildCarExport` is handed what `CarStore.settings()`
 * answered and `apply` writes it back through `setDueThresholds`, so a second
 * declaration would be a third place the two numbers are spelled.
 */
export interface CarExportPayload extends CarExport {
  settings: CarSettings;
}

/** What `exportData` is handed: the store's own value and the store's own settings, neither re-shaped. */
export function buildCarExport(data: CarExport, settings: CarSettings): CarExportPayload {
  return {
    ...data,
    settings: {
      dueSoonDays: settings.dueSoonDays,
      dueSoonDistance: settings.dueSoonDistance,
    },
  };
}

/**
 * The value an archive that says nothing about CAR leaves behind: no vehicles,
 * and the module's shipped thresholds.
 *
 * A restore replaces a profile whole (`ModuleContext.importData`), so "the
 * archive does not mention this module" is this profile's car history going back
 * to empty -- not the previous owner's garage standing where the archive had
 * nothing to put.
 */
export function emptyCarExport(): CarExportPayload {
  return {
    version: CAR_EXPORT_VERSION,
    vehicles: [],
    readings: [],
    services: [],
    serviceAttachments: [],
    intervals: [],
    fuel: [],
    faults: [],
    settings: {
      dueSoonDays: DEFAULT_DUE_SOON_DAYS,
      dueSoonDistance: DEFAULT_DUE_SOON_DISTANCE,
    },
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the refusal reaches the user
 * before they confirm a restore) and again before any module writes, and it must
 * write nothing itself. Every message names the field that is wrong.
 */
export function parseCarExportPayload(value: unknown): CarExportPayload {
  const record = asRecord(value, "payload");
  if (record.version !== CAR_EXPORT_VERSION) {
    throw new Error(
      `Car data was written by another version of this module (found ${String(record.version)}, expected ${CAR_EXPORT_VERSION}).`,
    );
  }
  for (const field of CAR_COLLECTIONS) {
    if (!Array.isArray(record[field])) {
      throw new Error(`Car data: "${field}" must be an array.`);
    }
  }
  const settings = asRecord(record.settings, "settings");
  const dueSoonDays = asThreshold(
    settings.dueSoonDays,
    "settings.dueSoonDays",
    MAX_DUE_SOON_DAYS,
  );
  const dueSoonDistance = asThreshold(
    settings.dueSoonDistance,
    "settings.dueSoonDistance",
    MAX_INTERVAL_KM,
  );
  return {
    version: CAR_EXPORT_VERSION,
    vehicles: record.vehicles as CarExport["vehicles"],
    readings: record.readings as CarExport["readings"],
    services: record.services as CarExport["services"],
    serviceAttachments: record.serviceAttachments as CarExport["serviceAttachments"],
    intervals: record.intervals as CarExport["intervals"],
    fuel: record.fuel as CarExport["fuel"],
    faults: record.faults as CarExport["faults"],
    settings: { dueSoonDays, dueSoonDistance },
  };
}

/** The store's seven collections, in `CarExport`'s own order. */
const CAR_COLLECTIONS = [
  "vehicles",
  "readings",
  "services",
  "serviceAttachments",
  "intervals",
  "fuel",
  "faults",
] as const;

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Car data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** One "due soon" threshold: a whole number the settings column's own CHECK would accept. */
function asThreshold(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Car data: "${field}" must be a whole number between 1 and ${max}.`);
  }
  return value;
}
