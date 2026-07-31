import type Database from "better-sqlite3-multiple-ciphers";
import { isValidDayKey } from "@nexus/core";
import { CalendarSettingsValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** This profile's semester term (CAL-010 / ADR-054): both bare day keys, or both null for "no term set". */
export interface CalendarSettings {
  /** First day of the term, `YYYY-MM-DD`; null exactly when `semesterEnd` is. */
  semesterStart: string | null;
  /** Last day of the term, inclusive, `YYYY-MM-DD`; never before `semesterStart`. */
  semesterEnd: string | null;
}

interface SettingsRow {
  semester_start: string | null;
  semester_end: string | null;
}

/**
 * The calendar's per-profile facts (migration 042 / ADR-054) — today the
 * semester's fixed dates, which is what anchors the Semestar view — over
 * prepared, parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Constructed one per profile and reused, like every other
 * store here.
 *
 * `get` is a get-or-default read that never writes — the `dashboard_settings`
 * arrangement (migration 030 / `DashboardSettingsStore.get`): a profile that
 * has never set its term costs no row, and both-null IS "unset" whether the
 * row is absent or cleared in place.
 *
 * `save` takes the WHOLE pair, both-or-neither, in one upsert: a term with one
 * edge means nothing, so a half-set pair is refused here even though migration
 * 042's table tolerates it (its per-column CHECKs exist only so one statement
 * can stage the halves). Clearing is a both-null save — the same one write,
 * which is why there is no separate `clear`.
 *
 * Every write revalidates its input because the renderer is untrusted
 * (SEC-EL-02): each date must be a REAL calendar day (`isValidDayKey` — the
 * GLOB CHECK knows shapes, not February), and the closed range must run
 * forward, restating the table's own pair CHECK so a bad value is a named
 * `CalendarSettingsValidationError` rather than a raw SQLite constraint error.
 */
export class CalendarSettingsStore {
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectSettings = db.prepare(
      `SELECT semester_start, semester_end FROM calendar_settings WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO calendar_settings (profile_id, semester_start, semester_end)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         semester_start = excluded.semester_start,
         semester_end = excluded.semester_end`,
    );
  }

  /** This profile's term: both null — no term set — while the row is absent. Never writes. */
  get(): CalendarSettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    if (row === undefined) return { semesterStart: null, semesterEnd: null };
    return { semesterStart: row.semester_start, semesterEnd: row.semester_end };
  }

  /** Writes the validated pair in one upsert — both dates, or both null to clear — and answers with what is now stored. */
  save(settings: CalendarSettings): CalendarSettings {
    const validated = validatePair(settings);
    this.upsertSettings.run(this.profileId, validated.semesterStart, validated.semesterEnd);
    return validated;
  }
}

function validatePair(settings: CalendarSettings): CalendarSettings {
  const { semesterStart, semesterEnd } = settings;
  if ((semesterStart === null) !== (semesterEnd === null)) {
    throw new CalendarSettingsValidationError(
      `"semesterStart" and "semesterEnd" must be set together or cleared together.`,
    );
  }
  if (semesterStart === null || semesterEnd === null) {
    return { semesterStart: null, semesterEnd: null };
  }
  for (const [field, value] of [
    ["semesterStart", semesterStart],
    ["semesterEnd", semesterEnd],
  ] as const) {
    if (!isValidDayKey(value)) {
      throw new CalendarSettingsValidationError(
        `"${field}" must be a real "YYYY-MM-DD" calendar day.`,
      );
    }
  }
  // Bare day keys compare lexicographically AS dates — the same fact the
  // table's own pair CHECK leans on.
  if (semesterStart > semesterEnd) {
    throw new CalendarSettingsValidationError(
      `"semesterStart" must not be after "semesterEnd".`,
    );
  }
  return { semesterStart, semesterEnd };
}
