import type Database from "better-sqlite3-multiple-ciphers";
import { PrivateSettingsValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** The auto-lock bound migration 045's CHECK also states, and the default a fresh setup starts on (ADR-057). */
export const MIN_PRIV_AUTO_LOCK_MINUTES = 1;
export const MAX_PRIV_AUTO_LOCK_MINUTES = 60;
export const DEFAULT_PRIV_AUTO_LOCK_MINUTES = 5;

/** Bounds what one opaque field (a serialized KDF descriptor, salt, or wrap) may occupy — SEC-EL-02's cap on what a row can ever hold, not a format check. */
const MAX_PRIV_OPAQUE_LENGTH = 8192;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * One profile's PRIV key-chain row (migration 045, ADR-057 §4). The four
 * opaque fields are exactly that — opaque: the store never parses `kdf` into
 * parameters or a wrap into nonce and ciphertext. Only
 * `apps/desktop/src/main/priv.ts` reads meaning into them, the same division
 * `PrivateNoteStore` keeps with its sealed blobs.
 */
export interface PrivateSettings {
  /** The serialized KDF parameter descriptor the wraps were derived under. */
  kdf: string;
  /** The credential wrap's Argon2id salt (base64). */
  passSalt: string;
  /** The PRIV DEK wrapped under the credential-derived KEK (serialized). */
  passWrap: string;
  /** The Recovery Kit wrap's salt (base64), or null when the user opted out — always beside `kitWrap`, both or neither. */
  kitSalt: string | null;
  /** The PRIV DEK wrapped under the Recovery Kit code (serialized), or null with `kitSalt`. */
  kitWrap: string | null;
  /** Whether the credential IS the account passcode (true) or a separate passphrase (false). */
  usesAccountPasscode: boolean;
  /** Idle minutes before main drops the unwrapped DEK, `MIN_PRIV_AUTO_LOCK_MINUTES`..`MAX_PRIV_AUTO_LOCK_MINUTES`. */
  autoLockMinutes: number;
  /** Whether minimizing the window also drops the DEK. */
  lockOnMinimize: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Everything a first-time setup writes (ADR-057): the whole wrap set plus the two lock preferences. */
export interface CreatePrivateSettingsInput {
  kdf: string;
  passSalt: string;
  passWrap: string;
  kitSalt: string | null;
  kitWrap: string | null;
  usesAccountPasscode: boolean;
  autoLockMinutes: number;
  lockOnMinimize: boolean;
}

/** The wrap-set half of the row alone — what a kit regeneration or credential change replaces, leaving the lock preferences standing. */
export type ReplacePrivateWrapsInput = Omit<
  CreatePrivateSettingsInput,
  "autoLockMinutes" | "lockOnMinimize"
>;

interface SettingsRow {
  kdf: string;
  pass_salt: string;
  pass_wrap: string;
  kit_salt: string | null;
  kit_wrap: string | null;
  uses_account_passcode: number;
  auto_lock_minutes: number;
  lock_on_minimize: number;
  created_at: string;
  updated_at: string;
}

/**
 * The `private_settings` table (migration 045 / ADR-057), over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Constructed one per profile and reused, like every other
 * store here.
 *
 * Unlike the get-or-default settings stores (`dashboard_settings`,
 * `backup_settings`), absence is MEANINGFUL here: no row IS "PRIV was never
 * set up", which is why `get` answers null rather than defaults and `create`
 * refuses a second setup — overwriting an existing wrap set would destroy the
 * only paths to a DEK that seals real data.
 *
 * Two mutation surfaces, deliberately split: `updateLockPrefs` touches the
 * two behaviour knobs and can never brush a wrap; `replaceWraps` swaps the
 * whole wrap set atomically (kit regeneration, credential change) and can
 * never brush a lock preference. There is no statement that writes both.
 */
export class PrivateSettingsStore {
  private readonly selectSettings: Database.Statement;
  private readonly insertSettings: Database.Statement;
  private readonly updatePrefs: Database.Statement;
  private readonly updateWraps: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectSettings = db.prepare(
      `SELECT kdf, pass_salt, pass_wrap, kit_salt, kit_wrap, uses_account_passcode,
              auto_lock_minutes, lock_on_minimize, created_at, updated_at
         FROM private_settings
        WHERE profile_id = ?`,
    );
    this.insertSettings = db.prepare(
      `INSERT INTO private_settings
         (profile_id, kdf, pass_salt, pass_wrap, kit_salt, kit_wrap,
          uses_account_passcode, auto_lock_minutes, lock_on_minimize, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updatePrefs = db.prepare(
      `UPDATE private_settings
          SET auto_lock_minutes = ?, lock_on_minimize = ?, updated_at = ?
        WHERE profile_id = ?`,
    );
    this.updateWraps = db.prepare(
      `UPDATE private_settings
          SET kdf = ?, pass_salt = ?, pass_wrap = ?, kit_salt = ?, kit_wrap = ?,
              uses_account_passcode = ?, updated_at = ?
        WHERE profile_id = ?`,
    );
  }

  /** This profile's PRIV settings, or null while PRIV was never set up — absence IS the answer, never a default. */
  get(): PrivateSettings | null {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    return row === undefined ? null : toSettings(row);
  }

  /** First-time setup: writes the whole row. Refuses a second setup outright — see the class doc comment. */
  create(input: CreatePrivateSettingsInput, now: string): PrivateSettings {
    if (this.get() !== null) {
      throw new PrivateSettingsValidationError(
        "Private notes are already set up for this profile.",
      );
    }
    validateWraps(input);
    validateLockPrefs(input.autoLockMinutes, input.lockOnMinimize);
    const validNow = validateDateTime(now);
    this.insertSettings.run(
      this.profileId,
      input.kdf,
      input.passSalt,
      input.passWrap,
      input.kitSalt,
      input.kitWrap,
      input.usesAccountPasscode ? 1 : 0,
      input.autoLockMinutes,
      input.lockOnMinimize ? 1 : 0,
      validNow,
      validNow,
    );
    return this.require();
  }

  /** Changes the two lock preferences alone, leaving every wrap untouched. */
  updateLockPrefs(
    autoLockMinutes: number,
    lockOnMinimize: boolean,
    now: string,
  ): PrivateSettings {
    validateLockPrefs(autoLockMinutes, lockOnMinimize);
    const validNow = validateDateTime(now);
    const result = this.updatePrefs.run(
      autoLockMinutes,
      lockOnMinimize ? 1 : 0,
      validNow,
      this.profileId,
    );
    if (result.changes === 0) {
      throw new PrivateSettingsValidationError(
        "Private notes are not set up for this profile.",
      );
    }
    return this.require();
  }

  /** Replaces the whole wrap set at once — kit regeneration and credential change ride this one statement — leaving the lock preferences alone. */
  replaceWraps(input: ReplacePrivateWrapsInput, now: string): PrivateSettings {
    validateWraps(input);
    const validNow = validateDateTime(now);
    const result = this.updateWraps.run(
      input.kdf,
      input.passSalt,
      input.passWrap,
      input.kitSalt,
      input.kitWrap,
      input.usesAccountPasscode ? 1 : 0,
      validNow,
      this.profileId,
    );
    if (result.changes === 0) {
      throw new PrivateSettingsValidationError(
        "Private notes are not set up for this profile.",
      );
    }
    return this.require();
  }

  /** The row a write just touched. `changes`/`create` already proved it exists, so a miss here would be a bug, not a data case. */
  private require(): PrivateSettings {
    const settings = this.get();
    if (settings === null) {
      throw new PrivateSettingsValidationError(
        "Private notes are not set up for this profile.",
      );
    }
    return settings;
  }
}

function toSettings(row: SettingsRow): PrivateSettings {
  return {
    kdf: row.kdf,
    passSalt: row.pass_salt,
    passWrap: row.pass_wrap,
    kitSalt: row.kit_salt,
    kitWrap: row.kit_wrap,
    usesAccountPasscode: row.uses_account_passcode === 1,
    autoLockMinutes: row.auto_lock_minutes,
    lockOnMinimize: row.lock_on_minimize === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateOpaque(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PRIV_OPAQUE_LENGTH) {
    throw new PrivateSettingsValidationError(
      `"${field}" must be a non-empty string of at most ${MAX_PRIV_OPAQUE_LENGTH} characters.`,
    );
  }
}

function validateWraps(input: ReplacePrivateWrapsInput): void {
  validateOpaque(input.kdf, "kdf");
  validateOpaque(input.passSalt, "passSalt");
  validateOpaque(input.passWrap, "passWrap");
  // Both or neither — migration 045's CHECK, restated here so the refusal is a
  // named error instead of a bare constraint failure.
  if ((input.kitSalt === null) !== (input.kitWrap === null)) {
    throw new PrivateSettingsValidationError(
      `"kitSalt" and "kitWrap" must be set together or both be null.`,
    );
  }
  if (input.kitSalt !== null) validateOpaque(input.kitSalt, "kitSalt");
  if (input.kitWrap !== null) validateOpaque(input.kitWrap, "kitWrap");
  if (typeof input.usesAccountPasscode !== "boolean") {
    throw new PrivateSettingsValidationError(`"usesAccountPasscode" must be a boolean.`);
  }
}

function validateLockPrefs(autoLockMinutes: number, lockOnMinimize: boolean): void {
  if (
    !Number.isInteger(autoLockMinutes) ||
    autoLockMinutes < MIN_PRIV_AUTO_LOCK_MINUTES ||
    autoLockMinutes > MAX_PRIV_AUTO_LOCK_MINUTES
  ) {
    throw new PrivateSettingsValidationError(
      `"autoLockMinutes" must be a whole number between ${MIN_PRIV_AUTO_LOCK_MINUTES} and ${MAX_PRIV_AUTO_LOCK_MINUTES}.`,
    );
  }
  if (typeof lockOnMinimize !== "boolean") {
    throw new PrivateSettingsValidationError(`"lockOnMinimize" must be a boolean.`);
  }
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new PrivateSettingsValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
