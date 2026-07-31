import type Database from "better-sqlite3-multiple-ciphers";
import { BackupSettingsValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** The two rhythms a schedule can run on (SET-011 / ADR-056) — migration 044's own CHECK domain. */
export const BACKUP_CADENCES = ["daily", "weekly"] as const;
export type BackupCadence = (typeof BACKUP_CADENCES)[number];

/** How a recorded run ended — migration 044's `last_status` CHECK domain. */
export const BACKUP_RUN_STATUSES = ["ok", "failed"] as const;
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];

/** How many archives a folder keeps when the profile never chose (migration 044's column default, named once). */
export const DEFAULT_BACKUP_KEEP_LAST = 5;
export const MIN_BACKUP_KEEP_LAST = 2;
export const MAX_BACKUP_KEEP_LAST = 50;

/** Bounds what a folder path / serialized wrap may occupy — SEC-EL-02's cap on what a row can ever hold, not a format check. */
const MAX_FOLDER_PATH_LENGTH = 1024;
const MAX_PASSPHRASE_WRAP_LENGTH = 8192;
/** `last_error` carries a short machine code the renderer maps to copy, never prose — anything longer is a bug. */
const MAX_RUN_ERROR_LENGTH = 128;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** This profile's resolved scheduled-backup settings (defaults already applied). */
export interface BackupSettings {
  enabled: boolean;
  cadence: BackupCadence;
  /** The absolute folder the archives land in, or null while none is chosen. Main's directory dialog is the only writer. */
  folderPath: string | null;
  /**
   * The archive passphrase, sealed by `@nexus/core/auth`'s
   * `wrapBackupPassphrase` under this account's data key — never plaintext,
   * and never sent to the renderer (main strips it into a `passphraseSet`
   * boolean at the IPC boundary).
   */
  passphraseWrapped: string | null;
  /** How many archives the retention sweep leaves in the folder, `MIN_BACKUP_KEEP_LAST`..`MAX_BACKUP_KEEP_LAST`. */
  keepLast: number;
  /** When the last run was attempted (success or failure alike — `lastStatus` says which), or null before the first. */
  lastRunAt: string | null;
  lastStatus: BackupRunStatus | null;
  /** The failed run's machine-readable reason (`BackupRunErrorCode` on the wire), null exactly while `lastStatus` is not "failed". */
  lastError: string | null;
}

interface SettingsRow {
  enabled: number;
  cadence: BackupCadence;
  folder_path: string | null;
  passphrase_wrapped: string | null;
  keep_last: number;
  last_run_at: string | null;
  last_status: BackupRunStatus | null;
  last_error: string | null;
}

/**
 * The per-profile scheduled-backup settings (SET-011 / ADR-056), over
 * prepared, parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Constructed one per profile and reused, like every other
 * store here.
 *
 * `get` is a get-or-default read that never writes — the `dashboard_settings`
 * arrangement (migration 030 / `DashboardSettingsStore.get`): a profile that
 * never opened the setting costs no row, and the defaults live in one place.
 *
 * `setSchedule` refuses `enabled: true` while no folder or no wrapped
 * passphrase exists, mirroring migration 044's own CHECK: an enabled schedule
 * that cannot run is a misconfiguration nothing may hold, and the renderer's
 * disabled toggle is UX, never the gate (SEC-EL-02).
 *
 * Deliberately device-local, like the table it wraps: excluded from the export
 * archive and from the restore wipe (see the migration's doc comment), so a
 * restore never interrupts the routine that protects against a bad one.
 */
export class BackupSettingsStore {
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectSettings = db.prepare(
      `SELECT enabled, cadence, folder_path, passphrase_wrapped, keep_last,
              last_run_at, last_status, last_error
         FROM backup_settings
        WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO backup_settings
         (profile_id, enabled, cadence, folder_path, passphrase_wrapped, keep_last,
          last_run_at, last_status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         enabled = excluded.enabled,
         cadence = excluded.cadence,
         folder_path = excluded.folder_path,
         passphrase_wrapped = excluded.passphrase_wrapped,
         keep_last = excluded.keep_last,
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
    );
  }

  /** This profile's resolved settings: disabled, daily, keep 5, nothing configured while the row is absent. Never writes. */
  get(): BackupSettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    if (row === undefined) {
      return {
        enabled: false,
        cadence: "daily",
        folderPath: null,
        passphraseWrapped: null,
        keepLast: DEFAULT_BACKUP_KEEP_LAST,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      };
    }
    return {
      enabled: row.enabled === 1,
      cadence: row.cadence,
      folderPath: row.folder_path,
      passphraseWrapped: row.passphrase_wrapped,
      keepLast: row.keep_last,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
    };
  }

  /** Sets the schedule's three choices together — the shape `backup:set-settings` carries — leaving folder, wrap and run record alone. */
  setSchedule(
    input: { enabled: boolean; cadence: BackupCadence; keepLast: number },
    now: string,
  ): BackupSettings {
    if (typeof input.enabled !== "boolean") {
      throw new BackupSettingsValidationError(`"enabled" must be a boolean.`);
    }
    if (!BACKUP_CADENCES.includes(input.cadence)) {
      throw new BackupSettingsValidationError(
        `"cadence" must be one of: ${BACKUP_CADENCES.join(", ")}.`,
      );
    }
    if (
      !Number.isInteger(input.keepLast) ||
      input.keepLast < MIN_BACKUP_KEEP_LAST ||
      input.keepLast > MAX_BACKUP_KEEP_LAST
    ) {
      throw new BackupSettingsValidationError(
        `"keepLast" must be a whole number between ${MIN_BACKUP_KEEP_LAST} and ${MAX_BACKUP_KEEP_LAST}.`,
      );
    }
    const current = this.get();
    if (input.enabled && (current.folderPath === null || current.passphraseWrapped === null)) {
      throw new BackupSettingsValidationError(
        "Cannot enable scheduled backups before a folder and a passphrase are set.",
      );
    }
    return this.write(
      {
        ...current,
        enabled: input.enabled,
        cadence: input.cadence,
        keepLast: input.keepLast,
      },
      validateDateTime(now),
    );
  }

  /** Points the schedule at a folder main's directory dialog returned, leaving every other choice alone. */
  setFolderPath(folderPath: string, now: string): BackupSettings {
    if (
      typeof folderPath !== "string" ||
      folderPath.length === 0 ||
      folderPath.length > MAX_FOLDER_PATH_LENGTH
    ) {
      throw new BackupSettingsValidationError(
        `"folderPath" must be a non-empty string of at most ${MAX_FOLDER_PATH_LENGTH} characters.`,
      );
    }
    return this.write({ ...this.get(), folderPath }, validateDateTime(now));
  }

  /** Replaces the wrapped passphrase for FUTURE runs — archives already written keep opening under whatever sealed them. */
  setPassphraseWrapped(wrapped: string, now: string): BackupSettings {
    if (
      typeof wrapped !== "string" ||
      wrapped.length === 0 ||
      wrapped.length > MAX_PASSPHRASE_WRAP_LENGTH
    ) {
      throw new BackupSettingsValidationError(
        `"wrapped" must be a non-empty string of at most ${MAX_PASSPHRASE_WRAP_LENGTH} characters.`,
      );
    }
    return this.write({ ...this.get(), passphraseWrapped: wrapped }, validateDateTime(now));
  }

  /**
   * Records one run's outcome — the attempt's own timestamp, its status, and
   * (for a failed one, exactly) its machine-readable reason. `at` doubles as
   * the row's `updated_at`: the run IS the update.
   */
  recordRun(at: string, status: BackupRunStatus, error: string | null): BackupSettings {
    const validAt = validateDateTime(at);
    if (!BACKUP_RUN_STATUSES.includes(status)) {
      throw new BackupSettingsValidationError(
        `"status" must be one of: ${BACKUP_RUN_STATUSES.join(", ")}.`,
      );
    }
    if (status === "failed") {
      if (typeof error !== "string" || error.length === 0 || error.length > MAX_RUN_ERROR_LENGTH) {
        throw new BackupSettingsValidationError(
          `A failed run must name its error (at most ${MAX_RUN_ERROR_LENGTH} characters).`,
        );
      }
    } else if (error !== null) {
      throw new BackupSettingsValidationError("A successful run cannot carry an error.");
    }
    return this.write(
      { ...this.get(), lastRunAt: validAt, lastStatus: status, lastError: error },
      validAt,
    );
  }

  /** One upsert for every mutation above: writes the whole merged row, `created_at` only on first insert. */
  private write(settings: BackupSettings, now: string): BackupSettings {
    this.upsertSettings.run(
      this.profileId,
      settings.enabled ? 1 : 0,
      settings.cadence,
      settings.folderPath,
      settings.passphraseWrapped,
      settings.keepLast,
      settings.lastRunAt,
      settings.lastStatus,
      settings.lastError,
      now,
      now,
    );
    return settings;
  }
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new BackupSettingsValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
