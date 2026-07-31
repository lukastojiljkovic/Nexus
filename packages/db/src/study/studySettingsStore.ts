import type Database from "better-sqlite3-multiple-ciphers";
import { StudySettingsValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * The retention the scheduler aims for when the profile has never chosen one
 * (migration 034's column default, named once so the store, the settings row
 * and the archive's parser all read the same number). 0.9 is also ts-fsrs's own
 * library default, which is what keeps every card scheduled before this setting
 * existed scheduled exactly as it was.
 */
export const DEFAULT_TARGET_RETENTION = 0.9;

/**
 * The closed window `target_retention` lives in, matching migration 034's CHECK.
 * Below 0.70 the intervals stretch past anything worth calling "learned"; above
 * 0.97 they collapse into daily drilling, which is not scheduling.
 */
export const MIN_TARGET_RETENTION = 0.7;
export const MAX_TARGET_RETENTION = 0.97;

/** New cards a day for a profile that has never chosen — migration 034's column default, and the number the reviewer capped at before this setting existed. */
export const DEFAULT_NEW_PER_DAY = 20;

/** The most New cards a day anyone may ask for (migration 034's CHECK). 100 unseen cards is already more than a day's honest work. */
export const MAX_NEW_PER_DAY = 100;

/** The largest daily review cap (migration 034's CHECK). `null` — not 0 — is how "no cap" is said. */
export const MAX_REVIEWS_PER_DAY = 1000;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** This profile's resolved study preferences (defaults already applied). */
export interface StudySettings {
  /** ts-fsrs's `request_retention`: the recall probability the scheduler aims for, `MIN_TARGET_RETENTION`..`MAX_TARGET_RETENTION`. */
  targetRetention: number;
  /** How many New cards one day's queue may offer, 0..`MAX_NEW_PER_DAY`. */
  newPerDay: number;
  /** How many reviews one local day may hold, 1..`MAX_REVIEWS_PER_DAY`, or `null` for no cap at all. */
  maxReviewsPerDay: number | null;
}

interface SettingsRow {
  target_retention: number;
  new_per_day: number;
  max_reviews_per_day: number | null;
}

/**
 * The STUDY module's per-profile scheduling preferences (STUDY-007, migration
 * 034), over prepared, parameterized statements (SEC-API-03; every value is
 * bound, never interpolated). Constructed one per profile and reused, like every
 * other store here.
 *
 * `get` is a get-or-default read that never writes — the `dashboard_settings`
 * arrangement (migration 030 / `DashboardSettingsStore.get`), which is itself
 * the `ntf_settings` arrangement: a profile that has never opened these settings
 * costs no row, and the defaults live in one place rather than being seeded into
 * every profile at creation. `save` materializes the row on the first write.
 *
 * `save` takes the WHOLE triple rather than one field at a time. The three are
 * one form on one card in Podešavanja, they are read together on every queue
 * fetch, and a per-field setter would invite a renderer to write two of them and
 * leave the third describing a decision the user did not make.
 *
 * Every write revalidates its input because the renderer is untrusted
 * (SEC-EL-02), and each rule here restates one of migration 034's CHECKs — so a
 * bad value is a named `StudySettingsValidationError` rather than a raw SQLite
 * constraint error, and the row is refused before anything is written.
 */
export class StudySettingsStore {
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectSettings = db.prepare(
      `SELECT target_retention, new_per_day, max_reviews_per_day
         FROM study_settings
        WHERE profile_id = ?`,
    );
    // `created_at` is deliberately NOT in the update list: it records when this
    // profile first expressed a preference, and a later edit does not move that.
    this.upsertSettings = db.prepare(
      `INSERT INTO study_settings
         (profile_id, target_retention, new_per_day, max_reviews_per_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         target_retention = excluded.target_retention,
         new_per_day = excluded.new_per_day,
         max_reviews_per_day = excluded.max_reviews_per_day,
         updated_at = excluded.updated_at`,
    );
  }

  /** This profile's resolved preferences: the library-default retention, 20 new cards and no review cap while the row is absent. Never writes. */
  get(): StudySettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    if (row === undefined) {
      return {
        targetRetention: DEFAULT_TARGET_RETENTION,
        newPerDay: DEFAULT_NEW_PER_DAY,
        maxReviewsPerDay: null,
      };
    }
    return {
      targetRetention: row.target_retention,
      newPerDay: row.new_per_day,
      maxReviewsPerDay: row.max_reviews_per_day,
    };
  }

  /** Writes all three preferences at once, creating the row on the first call, and answers with what is now stored. */
  save(settings: StudySettings, now: string): StudySettings {
    const validNow = validateDateTime(now);
    const validated: StudySettings = {
      targetRetention: validateRetention(settings.targetRetention),
      newPerDay: validateNewPerDay(settings.newPerDay),
      maxReviewsPerDay: validateReviewCap(settings.maxReviewsPerDay),
    };
    this.upsertSettings.run(
      this.profileId,
      validated.targetRetention,
      validated.newPerDay,
      validated.maxReviewsPerDay,
      validNow,
      validNow,
    );
    return validated;
  }
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new StudySettingsValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateRetention(value: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < MIN_TARGET_RETENTION ||
    value > MAX_TARGET_RETENTION
  ) {
    throw new StudySettingsValidationError(
      `"targetRetention" must be a number between ${MIN_TARGET_RETENTION} and ${MAX_TARGET_RETENTION}.`,
    );
  }
  return value;
}

function validateNewPerDay(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_NEW_PER_DAY) {
    throw new StudySettingsValidationError(
      `"newPerDay" must be a whole number between 0 and ${MAX_NEW_PER_DAY}.`,
    );
  }
  return value;
}

function validateReviewCap(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_REVIEWS_PER_DAY) {
    throw new StudySettingsValidationError(
      `"maxReviewsPerDay" must be null, or a whole number between 1 and ${MAX_REVIEWS_PER_DAY}.`,
    );
  }
  return value;
}
