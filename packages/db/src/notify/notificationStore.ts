import type Database from "better-sqlite3-multiple-ciphers";
import { isAlwaysOnSource } from "@nexus/core";
import type { NotificationSource } from "@nexus/core";
import { NotificationNotFoundError, NotificationValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed ledger-status domain (migration 009 CHECK). Dismissal is terminal — see `dismiss`. */
export type NotificationStatus = "delivered" | "snoozed" | "dismissed";

/** Ledger statuses in wire order. */
export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  "delivered",
  "snoozed",
  "dismissed",
];

/**
 * Every source a LEDGER row may carry (migration 053's `notifications.source`
 * CHECK), in canonical order — each newcomer appended last (`"event"` by
 * migration 019 / CAL-006, `"task"` by migration 021 / ADR-028, `"security"` by
 * migration 037 / NTF-007, `"subscription"` by migration 053 / FIN slice d), so
 * the sources that came before keep the order every existing list and UI already
 * shows.
 */
export const NOTIFICATION_SOURCES: readonly NotificationSource[] = [
  "document",
  "exam",
  "study-day",
  "event",
  "task",
  "security",
  "subscription",
];

/**
 * The narrower domain of `ntf_source_settings.source`, which migration 037
 * deliberately left where migration 021 put it: the sources a profile may
 * switch off. `"security"` is absent because a security notification cannot be
 * silenced (`ALWAYS_ON_SOURCES` in `@nexus/core`) — so there is no preference
 * to store, and the table's own CHECK is the last line of that enforcement.
 *
 * Exported like `NOTIFICATION_STATUSES` so `RestoreStore` writes
 * `ntf_source_settings` from this list rather than a second copy of the
 * migration's CHECK, and so main validates a toggle request against it rather
 * than against a hand-typed respelling.
 */
export const TOGGLEABLE_NOTIFICATION_SOURCES: readonly NotificationSource[] =
  NOTIFICATION_SOURCES.filter((source) => !isAlwaysOnSource(source));

/**
 * The four snooze presets a reminder can be put off by (migration 041's
 * `ntf_settings.snooze_default` CHECK), in the order the notification center
 * offers them — shortest first. Exported like `NOTIFICATION_SOURCES` so main
 * validates a wire value against this list rather than a hand-typed respelling
 * of the same four strings, and so the archive reader can do the same.
 *
 * What each one RESOLVES to is deliberately not here: an absolute `until`
 * depends on the clock and on the profile's morning hour, and main computes it
 * (SEC-EL-02 — a deadline is never accepted from the renderer). This is only
 * the closed domain.
 */
export const SNOOZE_PRESETS = ["10m", "1h", "tonight", "tomorrow-morning"] as const;

/** One of the four snooze presets (see `SNOOZE_PRESETS`). */
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

/**
 * What the center's plain „Odloži“ button means for a profile that has not
 * chosen otherwise: the shortest preset, which is what that button did before
 * the preference existed and the one whose being wrong costs the least.
 */
export const DEFAULT_SNOOZE_PRESET: SnoozePreset = "10m";

const DEFAULT_MORNING_HOUR = "08:00";
const MAX_TEXT_LENGTH = 500;

/** A ledger row as the store returns it: camelCase keys, the exact text snapshot that was shown. */
export interface NotificationRecord {
  id: string;
  profileId: string;
  source: NotificationSource;
  entityId: string;
  occurrenceKey: string;
  title: string;
  body: string;
  status: NotificationStatus;
  snoozedUntil: string | null;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when recording a freshly delivered occurrence; all five are required. */
export interface RecordDeliveredInput {
  source: NotificationSource;
  entityId: string;
  occurrenceKey: string;
  title: string;
  body: string;
}

/** The identity of one ledger entry, without its text — what `NotificationStore`'s caller diffs fresh candidates against. */
export interface NotificationLedgerKey {
  source: NotificationSource;
  entityId: string;
  occurrenceKey: string;
  status: NotificationStatus;
}

/** This profile's resolved NTF preferences (defaults already applied). */
export interface NotificationSettings {
  quietFrom: string | null;
  quietTo: string | null;
  morningHour: string;
  /**
   * The sources whose reminders this profile wants — the appetite the engine
   * derives under. Only ever the TOGGLEABLE ones: an always-on source
   * (`"security"`) is not an appetite, it is delivered regardless, so listing it
   * here would suggest a switch that does not exist.
   */
  enabledSources: NotificationSource[];
  /**
   * Which preset the notification center's plain „Odloži“ button means
   * (NTF-009). The four presets stay offered explicitly beside it — this is the
   * one reached for by default, not the only one available.
   */
  snoozeDefault: SnoozePreset;
  /**
   * Whether the one-time "how much should Nexus remind you" question has been
   * PUT to this profile (NTF-008 / ADR-033) — not what was answered, since
   * keeping the defaults closes it just as finally as picking a preset. False
   * whenever the settings row is absent, which is exactly the profile the ask
   * exists for. Set only by `markAppetiteAsked`.
   */
  appetiteAsked: boolean;
}

/** A partial patch of the profile's settings; an omitted key is left untouched. */
export interface UpdateNotificationSettingsInput {
  quietFrom?: string | null;
  quietTo?: string | null;
  morningHour?: string;
  snoozeDefault?: SnoozePreset;
}

interface NotificationRow {
  id: string;
  profile_id: string;
  source: NotificationSource;
  entity_id: string;
  occurrence_key: string;
  title: string;
  body: string;
  status: NotificationStatus;
  snoozed_until: string | null;
  delivered_at: string;
  created_at: string;
  updated_at: string;
}

interface SettingsRow {
  quiet_from: string | null;
  quiet_to: string | null;
  morning_hour: string;
  snooze_default: SnoozePreset;
  appetite_asked: number;
}

interface SourceSettingRow {
  source: NotificationSource;
  enabled: number;
}

const COLUMNS =
  "id, profile_id, source, entity_id, occurrence_key, title, body, status, " +
  "snoozed_until, delivered_at, created_at, updated_at";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Accepts a full ISO-8601 date-time (the `now`/`until` every method takes). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Notification-ledger + settings persistence for a single profile, over
 * prepared, parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Mirrors `PlanStore`/`FocusStore`: construct one per profile,
 * reuse it. Inputs are revalidated here because the renderer is untrusted
 * (SEC-EL-02), and every statement is scoped by `profile_id`.
 *
 * This store never decides *what* is due — that is
 * `deriveNotificationCandidates` (`@nexus/core`), a pure function over plain
 * arrays. `notifications` here is only ever a ledger of what the engine
 * already decided was due: `recordDelivered` writes an occurrence once
 * (a UNIQUE collision means it was already recorded — re-fires after a
 * snooze go through `markRefired` on the same row), and `listLedgerKeys`
 * is what the (later) scheduler diffs fresh candidates against. Every method
 * that stamps a timestamp takes an explicit `now: string` — the store never
 * reads the clock itself.
 */
export class NotificationStore {
  private readonly insert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectLedgerKeys: Database.Statement;
  private readonly selectDueSnoozed: Database.Statement;
  private readonly selectCenter: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly updateSnoozedStatement: Database.Statement;
  private readonly updateRefiredStatement: Database.Statement;
  private readonly updateDismissedStatement: Database.Statement;
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly markAppetiteAskedStatement: Database.Statement;
  private readonly selectSourceSettings: Database.Statement;
  private readonly upsertSourceSetting: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO notifications
         (id, profile_id, source, entity_id, occurrence_key, title, body, status,
          snoozed_until, delivered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', NULL, ?, ?, ?)`,
    );
    this.selectById = db.prepare(
      `SELECT ${COLUMNS} FROM notifications WHERE id = ? AND profile_id = ?`,
    );
    this.selectLedgerKeys = db.prepare(
      `SELECT source, entity_id, occurrence_key, status FROM notifications
       WHERE profile_id = ?
       ORDER BY source, entity_id, occurrence_key`,
    );
    this.selectDueSnoozed = db.prepare(
      `SELECT ${COLUMNS} FROM notifications
       WHERE profile_id = ? AND status = 'snoozed' AND snoozed_until <= ?
       ORDER BY snoozed_until, id`,
    );
    this.selectCenter = db.prepare(
      `SELECT ${COLUMNS} FROM notifications
       WHERE profile_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    );
    this.selectAll = db.prepare(
      `SELECT ${COLUMNS} FROM notifications
       WHERE profile_id = ?
       ORDER BY delivered_at, id`,
    );
    this.updateSnoozedStatement = db.prepare(
      `UPDATE notifications SET status = 'snoozed', snoozed_until = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND status != 'dismissed'`,
    );
    this.updateRefiredStatement = db.prepare(
      `UPDATE notifications
         SET status = 'delivered', delivered_at = ?, snoozed_until = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND status = 'snoozed'`,
    );
    this.updateDismissedStatement = db.prepare(
      `UPDATE notifications SET status = 'dismissed', updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.selectSettings = db.prepare(
      `SELECT quiet_from, quiet_to, morning_hour, snooze_default, appetite_asked
       FROM ntf_settings WHERE profile_id = ?`,
    );
    // `appetite_asked` is deliberately absent from both halves: the INSERT
    // branch lets the column's own DEFAULT 0 stand (a first settings edit is
    // not an answer to the NTF-008 question), and the UPDATE branch leaves an
    // already-set flag alone — nothing but `markAppetiteAsked` ever moves it.
    this.upsertSettings = db.prepare(
      `INSERT INTO ntf_settings
         (profile_id, quiet_from, quiet_to, morning_hour, snooze_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         quiet_from = excluded.quiet_from,
         quiet_to = excluded.quiet_to,
         morning_hour = excluded.morning_hour,
         snooze_default = excluded.snooze_default,
         updated_at = excluded.updated_at`,
    );
    // The mirror image: the INSERT branch writes the very defaults `getSettings`
    // would have reported for the absent row it replaces, so marking the flag
    // can never be mistaken for the user having chosen quiet hours; the UPDATE
    // branch touches nothing but the flag and the timestamp.
    this.markAppetiteAskedStatement = db.prepare(
      `INSERT INTO ntf_settings
         (profile_id, quiet_from, quiet_to, morning_hour, snooze_default, appetite_asked,
          created_at, updated_at)
       VALUES (?, NULL, NULL, ?, ?, 1, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         appetite_asked = 1,
         updated_at = excluded.updated_at`,
    );
    this.selectSourceSettings = db.prepare(
      `SELECT source, enabled FROM ntf_source_settings WHERE profile_id = ?`,
    );
    this.upsertSourceSetting = db.prepare(
      `INSERT INTO ntf_source_settings (profile_id, source, enabled)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id, source) DO UPDATE SET enabled = excluded.enabled`,
    );
  }

  /**
   * This profile's resolved NTF preferences: no quiet hours, morning hour
   * 08:00, every source enabled, and the NTF-008 appetite question unasked when
   * their rows are absent. Never writes.
   */
  getSettings(): NotificationSettings {
    const settingsRow = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    const sourceRows = this.selectSourceSettings.all(this.profileId) as SourceSettingRow[];
    const overrides = new Map(sourceRows.map((row) => [row.source, row.enabled === 1]));
    const enabledSources = TOGGLEABLE_NOTIFICATION_SOURCES.filter(
      (source) => overrides.get(source) ?? true,
    );

    return {
      quietFrom: settingsRow?.quiet_from ?? null,
      quietTo: settingsRow?.quiet_to ?? null,
      morningHour: settingsRow?.morning_hour ?? DEFAULT_MORNING_HOUR,
      enabledSources,
      snoozeDefault: settingsRow?.snooze_default ?? DEFAULT_SNOOZE_PRESET,
      appetiteAsked: settingsRow?.appetite_asked === 1,
    };
  }

  /**
   * Records that this profile has been asked the one-time NTF-008 appetite
   * question (ADR-033) — whatever the answer was, including "keep the
   * defaults" and a dismissal, because the question is asked once, ever.
   * Idempotent, and never touches quiet hours, the morning hour or any source
   * toggle: writing the answer is the caller's separate business
   * (`setSourceEnabled`), and this only closes the question.
   */
  markAppetiteAsked(now: string): void {
    const validNow = validateDateTime(now, "now");
    this.markAppetiteAskedStatement.run(
      this.profileId,
      DEFAULT_MORNING_HOUR,
      DEFAULT_SNOOZE_PRESET,
      validNow,
      validNow,
    );
  }

  /**
   * Upserts a partial patch of quiet hours / morning hour. `null` clears a
   * quiet-hours bound; after the patch is applied, `quietFrom`/`quietTo` must
   * be both set or both cleared — never exactly one (rejected as
   * `NotificationValidationError`).
   */
  updateSettings(changes: UpdateNotificationSettingsInput, now: string): NotificationSettings {
    const validNow = validateDateTime(now, "now");
    const current = this.getSettings();

    const quietFrom =
      changes.quietFrom !== undefined
        ? changes.quietFrom === null
          ? null
          : validateHHMM(changes.quietFrom, "quietFrom")
        : current.quietFrom;
    const quietTo =
      changes.quietTo !== undefined
        ? changes.quietTo === null
          ? null
          : validateHHMM(changes.quietTo, "quietTo")
        : current.quietTo;
    const morningHour =
      changes.morningHour !== undefined
        ? validateHHMM(changes.morningHour, "morningHour")
        : current.morningHour;
    const snoozeDefault =
      changes.snoozeDefault !== undefined
        ? validateSnoozePreset(changes.snoozeDefault)
        : current.snoozeDefault;

    if ((quietFrom === null) !== (quietTo === null)) {
      throw new NotificationValidationError(
        '"quietFrom" and "quietTo" must be both set or both cleared.',
      );
    }

    this.upsertSettings.run(
      this.profileId,
      quietFrom,
      quietTo,
      morningHour,
      snoozeDefault,
      validNow,
      validNow,
    );

    return {
      quietFrom,
      quietTo,
      morningHour,
      enabledSources: current.enabledSources,
      snoozeDefault,
      // Untouched by this upsert (see `upsertSettings`) — editing a setting is
      // not an answer to, nor an escape from, the one-time appetite question.
      appetiteAsked: current.appetiteAsked,
    };
  }

  /**
   * Enables or disables one source for this profile (upserted; validated
   * against the toggleable set). An always-on source is refused outright rather
   * than quietly ignored: a caller asking to silence security notifications has
   * a wrong idea of the contract, and swallowing that would leave the settings
   * UI showing a switch that did nothing.
   */
  setSourceEnabled(source: NotificationSource, enabled: boolean, now: string): void {
    validateDateTime(now, "now");
    const validSource = validateToggleableSource(source);
    this.upsertSourceSetting.run(this.profileId, validSource, enabled ? 1 : 0);
  }

  /**
   * Records a freshly delivered occurrence. `title`/`body` are the exact text
   * snapshot shown, 1-500 characters. A UNIQUE collision on
   * (profile, source, entity, occurrence) means it was already recorded —
   * surfaced as `NotificationValidationError`; re-fires after a snooze go
   * through `markRefired` on the same row, never a second insert here.
   */
  recordDelivered(input: RecordDeliveredInput, now: string): NotificationRecord {
    const validNow = validateDateTime(now, "now");
    const source = validateSource(input.source);
    const entityId = validateNonEmpty(input.entityId, "entityId");
    const occurrenceKey = validateNonEmpty(input.occurrenceKey, "occurrenceKey");
    const title = validateText(input.title, "title");
    const body = validateText(input.body, "body");
    const id = uuidv7();

    try {
      this.insert.run(
        id,
        this.profileId,
        source,
        entityId,
        occurrenceKey,
        title,
        body,
        validNow,
        validNow,
        validNow,
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new NotificationValidationError(
          `Occurrence "${occurrenceKey}" of ${source} "${entityId}" is already recorded for this profile.`,
        );
      }
      throw error;
    }

    return {
      id,
      profileId: this.profileId,
      source,
      entityId,
      occurrenceKey,
      title,
      body,
      status: "delivered",
      snoozedUntil: null,
      deliveredAt: validNow,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /** Every ledger entry of this profile — the scheduler diffs fresh candidates against this. */
  listLedgerKeys(): NotificationLedgerKey[] {
    const rows = this.selectLedgerKeys.all(this.profileId) as {
      source: NotificationSource;
      entity_id: string;
      occurrence_key: string;
      status: NotificationStatus;
    }[];
    return rows.map((row) => ({
      source: row.source,
      entityId: row.entity_id,
      occurrenceKey: row.occurrence_key,
      status: row.status,
    }));
  }

  /** Snoozed rows of this profile whose `snoozedUntil` is at or before `now`. */
  dueSnoozed(now: string): NotificationRecord[] {
    const validNow = validateDateTime(now, "now");
    const rows = this.selectDueSnoozed.all(this.profileId, validNow) as NotificationRow[];
    return rows.map(toRecord);
  }

  /**
   * Snoozes a notification of this profile until `until` (must strictly follow
   * `now`). A dismissed row cannot be snoozed — dismissal is terminal, so the
   * wrong-state case throws the same `NotificationNotFoundError` as an unknown
   * id (mirrors `markRefired`'s wrong-state idiom).
   */
  snooze(id: string, until: string, now: string): NotificationRecord {
    const validNow = validateDateTime(now, "now");
    const validUntil = validateDateTime(until, "until");
    if (validUntil <= validNow) {
      throw new NotificationValidationError('"until" must be strictly after "now".');
    }
    const { changes } = this.updateSnoozedStatement.run(validUntil, validNow, id, this.profileId);
    if (changes === 0) {
      throw new NotificationNotFoundError(`No notification "${id}" in this profile.`);
    }
    return this.requireById(id);
  }

  /** Moves a snoozed row of this profile back to `delivered`, re-stamping `deliveredAt`. */
  markRefired(id: string, now: string): NotificationRecord {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.updateRefiredStatement.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new NotificationNotFoundError(
        `No snoozed notification "${id}" to re-fire in this profile.`,
      );
    }
    return this.requireById(id);
  }

  /** Dismisses a notification of this profile — terminal; dismissing an already-dismissed row is a no-op. */
  dismiss(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const row = this.selectById.get(id, this.profileId) as NotificationRow | undefined;
    if (!row) {
      throw new NotificationNotFoundError(`No notification "${id}" in this profile.`);
    }
    if (row.status === "dismissed") return;
    this.updateDismissedStatement.run(validNow, id, this.profileId);
  }

  /** The notification center's listing for this profile: every status, newest `updatedAt` first, capped. */
  listCenter(limit = 50): NotificationRecord[] {
    const validLimit = validateLimit(limit);
    const rows = this.selectCenter.all(this.profileId, validLimit) as NotificationRow[];
    return rows.map(toRecord);
  }

  /**
   * The full ledger of this profile, every status, no cap (IMEX full export —
   * the delivered/snoozed/dismissed history IS user history), ordered by
   * `deliveredAt` then id.
   */
  listAll(): NotificationRecord[] {
    const rows = this.selectAll.all(this.profileId) as NotificationRow[];
    return rows.map(toRecord);
  }

  /** Reads a ledger row of this profile or throws — enforces scope + existence. */
  private requireById(id: string): NotificationRecord {
    const row = this.selectById.get(id, this.profileId) as NotificationRow | undefined;
    if (!row) {
      throw new NotificationNotFoundError(`No notification "${id}" in this profile.`);
    }
    return toRecord(row);
  }
}

function toRecord(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    source: row.source,
    entityId: row.entity_id,
    occurrenceKey: row.occurrence_key,
    title: row.title,
    body: row.body,
    status: row.status,
    snoozedUntil: row.snoozed_until,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateSource(value: NotificationSource): NotificationSource {
  if (!NOTIFICATION_SOURCES.includes(value)) {
    throw new NotificationValidationError(`"${value}" is not a known notification source.`);
  }
  return value;
}

function validateToggleableSource(value: NotificationSource): NotificationSource {
  if (!TOGGLEABLE_NOTIFICATION_SOURCES.includes(value)) {
    throw new NotificationValidationError(
      `"${value}" notifications cannot be switched off (NTF-007).`,
    );
  }
  return value;
}

function validateNonEmpty(value: string, field: string): string {
  if (value.length === 0) {
    throw new NotificationValidationError(`"${field}" must not be empty.`);
  }
  return value;
}

function validateText(value: string, field: string): string {
  if (value.length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new NotificationValidationError(
      `"${field}" must be between 1 and ${MAX_TEXT_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSnoozePreset(value: SnoozePreset): SnoozePreset {
  if (!SNOOZE_PRESETS.includes(value)) {
    throw new NotificationValidationError(`"${value}" is not a known snooze preset.`);
  }
  return value;
}

function validateHHMM(value: string, field: string): string {
  if (!HH_MM.test(value)) {
    throw new NotificationValidationError(`"${field}" must be an "HH:MM" time.`);
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new NotificationValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new NotificationValidationError('"limit" must be a positive integer.');
  }
  return value;
}

/** better-sqlite3 raises `SQLITE_CONSTRAINT_UNIQUE` for a violated UNIQUE index. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
